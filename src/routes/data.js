'use strict';
/**
 * Geräte, Prüfungen, Einstellungen, Erinnerungen, Export – nur nach Anmeldung.
 */
const os = require('os');
const QRCode = require('qrcode');
const { asyncRouter } = require('./util');
const repo = require('../db/repo');
const { listBackups, purgePlainBackups } = require('../db/database');
const { detectCloudLocations, localFolder, providerForPath } = require('../db/cloud');
const { applicableProcedures, buildProcedure, listProcedures, suggestDeviceType, autoModeCheck } = require('../vde/procedures');
const { evaluateInspection } = require('../vde/evaluate');
const { PROFILES, QUANTITIES, limitsFor } = require('../vde/limits');
const { FAIL_ACTIONS, DEVICE_STATUS } = require('../vde/actions');
const { runReminders, sendCalendarInvite, autoCalendarUpdate, calendarFor } = require('../reminders/scheduler');
const { sendMail, PRESETS, smtpConfigured } = require('../reminders/mailer');
const { inspectionReport, labelSheet, parseLabelCode, DEVICE_TYPES, MODES } = require('../report/report');
const { ENVIRONMENTS, suggestInterval } = require('../vde/dguv');
const calibration = require('../secutest/calibration');
const totp = require('../auth/totp');
const { AuthError, SessionManager } = require('../auth/session');

const DEVICE_TYPE_HINTS = {
  standard: 'Normales Gerät ohne Besonderheiten',
  heating: 'Heizelemente (Wasserkocher, Heizlüfter …) – Sonderregeln für R_ISO/I_EA',
  electronic: 'Elektronik (TV, Netzteil, Ladegerät …) – Isolationsmessung ggf. eingeschränkt',
  it: 'EDV/Büro (PC, Monitor, Drucker …) – Prüfung nach T 240, NICHT im Auto-Modus',
  extension: 'Verlängerungsleitung, Kabeltrommel, Steckdosenleiste – Adapter EL1',
  battery: 'Akku-/Batteriegerät – wie Schutzklasse III',
};

module.exports = function dataRoutes(sessions, scheduler) {
  const r = asyncRouter();
  const pending2fa = new WeakMap(); // sdb -> neues Geheimnis während 2FA-Neueinrichtung

  // ---------- Stammdaten / Meta ----------
  r.get('/meta', (req, res) => {
    const sdb = req.sdb;
    res.json({
      db: { id: req.dbEntry.id, name: sdb.getMeta('db_name'), uuid: sdb.getMeta('db_uuid'), created_at: sdb.getMeta('created_at'), file: sdb.file, host: os.hostname(), provider: providerForPath(sdb.file) },
      settings: repo.publicSettings(repo.getSettings(sdb)),
      security: SessionManager.security(sdb),
      calibration: calibration.status(),
      environments: Object.entries(ENVIRONMENTS).map(([id, e]) => ({ id, label: e.label, base: e.base, max: e.max, dguv: e.dguv })),
      recoveryRemaining: sdb.getJson('recovery_codes', []).length,
      procedures: listProcedures(),
      actions: FAIL_ACTIONS,
      deviceStatus: DEVICE_STATUS,
      deviceTypes: Object.entries(DEVICE_TYPES).map(([id, label]) => ({ id, label, hint: DEVICE_TYPE_HINTS[id] })),
      profiles: Object.values(PROFILES),
      reasons: repo.REASONS,
      modes: MODES,
      quantities: QUANTITIES,
      smtpPresets: PRESETS,
      distinct: repo.distinctValues(sdb),
      nextInventoryNo: repo.nextInventoryNo(sdb),
      lastReminderRun: scheduler.lastRun,
    });
  });

  r.get('/dashboard', (req, res) => {
    res.json({ stats: repo.stats(req.sdb), due: repo.dueDevices(req.sdb, 30), recent: repo.listInspections(req.sdb, { limit: 10 }) });
  });

  // ---------- Einstellungen ----------
  r.put('/settings', (req, res) => {
    const patch = req.body || {};
    // SMTP-Passwort nur überschreiben, wenn ein neues eingegeben wurde
    if (patch.reminders?.smtp && !patch.reminders.smtp.pass) delete patch.reminders.smtp.pass;
    if (patch.reminders?.smtp) delete patch.reminders.smtp.hasPass;
    if (patch.reminders?.daysBefore && !Array.isArray(patch.reminders.daysBefore)) {
      patch.reminders.daysBefore = String(patch.reminders.daysBefore)
        .split(/[,; ]+/)
        .map(Number)
        .filter((n) => n > 0 && n < 400);
    }
    const s = repo.updateSettings(req.sdb, patch);
    if ('db_name' in patch && String(patch.db_name).trim()) req.sdb.setMeta('db_name', String(patch.db_name).trim());
    res.json(repo.publicSettings(s));
  });

  // ---------- Sicherheit (Passwort und 2FA – beides optional) ----------
  const reauth = (req) => sessions.reauth(req.sdb, { code: req.body?.code, recoveryCode: req.body?.recoveryCode, password: req.body?.current });

  r.get('/security', (req, res) => res.json(SessionManager.security(req.sdb)));

  /** Passwort festlegen (verschlüsselt eine bisher offene Datenbank) oder ändern */
  r.post('/security/password', (req, res) => {
    const { next, next2 } = req.body || {};
    reauth(req);
    if (next !== next2) throw new AuthError('Die neuen Passwörter stimmen nicht überein.', 400);
    const wasEncrypted = req.sdb.encrypted;
    req.sdb.changePassword(next);
    repo.audit(req.sdb, wasEncrypted ? 'passwort-geaendert' : 'verschluesselung-aktiviert', 'db', null, null);
    const plainBackups = listBackups(req.sdb.file).filter((b) => !b.encrypted).length;
    res.json({ ok: true, encrypted: true, plainBackups });
  });

  /** Passwort entfernen – die Datei ist danach unverschlüsselt */
  r.post('/security/password/remove', (req, res) => {
    if (!req.sdb.encrypted) return res.json({ ok: true, encrypted: false });
    reauth(req);
    if (req.body?.confirm !== true) throw new AuthError('Bitte das Entfernen der Verschlüsselung ausdrücklich bestätigen.', 400);
    req.sdb.removePassword();
    repo.audit(req.sdb, 'verschluesselung-entfernt', 'db', null, null);
    res.json({ ok: true, encrypted: false });
  });

  r.post('/security/backups/purge-plain', (req, res) => {
    if (!req.sdb.encrypted) throw new AuthError('Die Datenbank selbst ist unverschlüsselt – zuerst ein Passwort festlegen.', 400);
    const removed = purgePlainBackups(req.sdb.file);
    repo.audit(req.sdb, 'unverschluesselte-sicherungen-geloescht', 'db', null, `${removed} Datei(en)`);
    res.json({ removed, backups: listBackups(req.sdb.file) });
  });

  /** 2FA einrichten (erstmals) oder neu einrichten (z. B. neues Handy) */
  r.post('/security/2fa/begin', async (req, res) => {
    reauth(req);
    const secret = totp.generateSecret();
    pending2fa.set(req.sdb, secret);
    const uri = totp.otpauthUri(secret, { account: req.sdb.getMeta('db_name') });
    res.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) });
  });

  r.post('/security/2fa/finish', (req, res) => {
    const secret = pending2fa.get(req.sdb);
    if (!secret) throw new AuthError('Bitte die Einrichtung zuerst starten.', 400);
    const step = totp.verify(secret, req.body.code);
    if (step == null) throw new AuthError('Code der neuen Einrichtung ist falsch.', 401);
    const first = !req.sdb.getMeta('totp_secret');
    req.sdb.setMeta('totp_secret', secret);
    req.sdb.setMeta('totp_last_step', String(step));
    pending2fa.delete(req.sdb);
    let recoveryCodes = null;
    if (first || !req.sdb.getJson('recovery_codes', []).length) {
      recoveryCodes = totp.generateRecoveryCodes();
      req.sdb.setJson('recovery_codes', recoveryCodes.map(totp.hashRecoveryCode));
    }
    repo.audit(req.sdb, first ? '2fa-aktiviert' : '2fa-neu-eingerichtet', 'db', null, null);
    res.json({ ok: true, recoveryCodes });
  });

  /** 2FA abschalten (Bestätigung mit aktuellem Code) */
  r.post('/security/2fa/disable', (req, res) => {
    if (!req.sdb.getMeta('totp_secret')) return res.json({ ok: true });
    reauth(req);
    req.sdb.db.prepare("DELETE FROM meta WHERE key IN ('totp_secret', 'totp_last_step', 'recovery_codes')").run();
    repo.audit(req.sdb, '2fa-deaktiviert', 'db', null, null);
    res.json({ ok: true });
  });

  r.post('/security/recovery', (req, res) => {
    if (!req.sdb.getMeta('totp_secret')) throw new AuthError('Wiederherstellungscodes gibt es nur mit Zwei-Faktor-Anmeldung.', 400);
    reauth(req);
    const codes = totp.generateRecoveryCodes();
    req.sdb.setJson('recovery_codes', codes.map(totp.hashRecoveryCode));
    repo.audit(req.sdb, 'wiederherstellungscodes-neu', 'db', null, null);
    res.json({ codes });
  });

  // ---------- Speicherort ----------
  r.get('/database/locations', (req, res) => {
    res.json({ current: req.sdb.file, provider: providerForPath(req.sdb.file), cloud: detectCloudLocations(), local: localFolder() });
  });

  /** Datenbank verschieben (lokal ↔ OneDrive/iCloud/eigener Ordner) */
  r.post('/database/move', (req, res) => {
    reauth(req);
    const out = sessions.moveActive({ folder: req.body?.folder, password: req.body?.password ?? req.body?.current, withBackups: req.body?.withBackups !== false });
    res.json({ ok: true, ...out, provider: providerForPath(out.file) });
  });

  r.post('/backup', (req, res) => {
    res.json({ file: req.sdb.backup('manuell'), backups: listBackups(req.sdb.file) });
  });

  r.get('/backups', (req, res) => res.json(listBackups(req.sdb.file)));

  // ---------- Geräte ----------
  r.get('/devices', (req, res) => res.json(repo.listDevices(req.sdb, req.query)));
  r.post('/devices', (req, res) => res.status(201).json(repo.createDevice(req.sdb, req.body || {})));
  /** QR-Scanner: Gerät zu gescanntem Plaketten-Text (oder Inventar-/Seriennummer) finden */
  r.get('/devices/lookup', (req, res) => {
    const parsed = parseLabelCode(req.query.code);
    if (!parsed) return res.status(400).json({ error: 'Kein Code übergeben.' });
    const own = String(req.sdb.getMeta('db_uuid') || '').replace(/-/g, '').slice(0, 8).toLowerCase();
    const find = (sql, v) => req.sdb.db.prepare(sql).get(v);
    const row =
      find('SELECT id FROM devices WHERE inventory_no = ? COLLATE NOCASE', parsed.code) ||
      find('SELECT id FROM devices WHERE serial_no = ? COLLATE NOCASE', parsed.code) ||
      (parsed.raw !== parsed.code ? null : find('SELECT id FROM devices WHERE inventory_no = ? COLLATE NOCASE', parsed.raw.replace(/\s+/g, '')));
    const otherDb = !!(parsed.db && own && parsed.db !== own);
    if (!row) {
      return res.status(404).json({ error: otherDb ? 'Diese Prüfplakette gehört zu einer anderen Datenbank. Bitte die passende Datenbank öffnen.' : `Kein Gerät mit „${parsed.code}“ gefunden.`, code: otherDb ? 'OTHER_DB' : 'NOT_FOUND', parsed });
    }
    res.json({ device: repo.getDevice(req.sdb, row.id), parsed, otherDb });
  });

  r.get('/devices/:id', (req, res) => res.json(repo.getDeviceDetail(req.sdb, Number(req.params.id))));
  r.put('/devices/:id', async (req, res) => {
    const id = Number(req.params.id);
    const before = repo.getDevice(req.sdb, id);
    const after = repo.updateDevice(req.sdb, id, req.body || {});
    const invite = after.next_due_date !== before.next_due_date ? await autoCalendarUpdate(req.sdb, [id], { previousDue: { [id]: before.next_due_date } }) : null;
    res.json({ ...after, invite });
  });

  /** Prüftermine verschieben – ohne Datum auf den nächsten Monat */
  r.post('/devices/postpone', async (req, res) => {
    const out = repo.postponeDevices(req.sdb, req.body?.ids, { date: req.body?.date || null, note: req.body?.note });
    const invite = await autoCalendarUpdate(req.sdb, out.updated.map((u) => u.id), { previousDue: Object.fromEntries(out.updated.map((u) => [u.id, u.from])) });
    res.json({ ...out, invite });
  });

  /** Prüfintervall mehrerer Geräte ändern */
  r.post('/devices/interval', async (req, res) => {
    const out = repo.changeInterval(req.sdb, req.body?.ids, req.body?.months, { recalc: req.body?.recalc !== false });
    const moved = out.filter((x) => x.dueTo !== x.dueFrom);
    const invite = await autoCalendarUpdate(req.sdb, moved.map((x) => x.id), { previousDue: Object.fromEntries(moved.map((x) => [x.id, x.dueFrom])) });
    res.json({ devices: out, invite });
  });
  r.delete('/devices/:id', (req, res) => res.json(repo.deleteDevice(req.sdb, Number(req.params.id))));
  r.post('/devices/:id/duplicate', (req, res) => res.status(201).json(repo.duplicateDevice(req.sdb, Number(req.params.id))));

  /** Gleiche Geräte mehrfach anlegen (für Serienprüfungen) */
  r.post('/devices/:id/duplicate-many', (req, res) => res.status(201).json(repo.duplicateDeviceMany(req.sdb, Number(req.params.id), { count: req.body?.count, numbering: req.body?.numbering !== false })));

  /** Intervallvorschlag nach DGUV V3 für ein oder mehrere Geräte */
  r.post('/devices/interval-suggestions', (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 2000);
    const settings = repo.getSettings(req.sdb);
    const override = req.body?.usage_env && ENVIRONMENTS[req.body.usage_env] ? req.body.usage_env : null;
    const devices = ids.length ? ids.map((id) => repo.getDevice(req.sdb, id)) : [{ id: 0, device_type: req.body?.device_type || 'standard' }];
    res.json(devices.map((d) => ({ id: d.id, name: d.name, current: d.interval_months, ...suggestInterval(req.sdb, override ? { ...d, usage_env: override } : d, { defaultEnv: settings.defaultUsageEnv || 'privat' }) })));
  });

  /** Vorschlag Geräteart + Auto-Modus-Prüfung für (noch nicht gespeicherte) Gerätedaten */
  r.post('/devices/suggest', (req, res) => {
    const d = { protection_class: 'SK I', device_type: 'standard', ...(req.body || {}) };
    const suggestion = suggestDeviceType(d);
    const effective = { ...d, device_type: d.device_type === 'standard' && suggestion ? suggestion : d.device_type };
    res.json({ suggestedType: suggestion, autoMode: autoModeCheck(effective), procedures: applicableProcedures(effective), limits: limitsFor(effective, { profile: repo.getSettings(req.sdb).limitProfile }) });
  });

  r.get('/devices/:id/procedures', (req, res) => {
    const d = repo.getDevice(req.sdb, Number(req.params.id));
    res.json(applicableProcedures(d));
  });

  r.post('/procedure', (req, res) => {
    const { procedureId, deviceId, device: overrides, profile, standard } = req.body || {};
    const base = deviceId ? repo.getDevice(req.sdb, Number(deviceId)) : {};
    const settings = repo.getSettings(req.sdb);
    try {
      res.json(buildProcedure(procedureId, { ...base, ...(overrides || {}) }, { profile: profile || settings.limitProfile, standard: standard || settings.defaultStandard }));
    } catch (e) {
      if (e.code === 'AUTO_NOT_ALLOWED') return res.status(409).json({ error: e.message, code: e.code, alternative: e.alternative });
      throw e;
    }
  });

  r.post('/evaluate', (req, res) => {
    const b = req.body || {};
    const base = b.deviceId ? repo.getDevice(req.sdb, Number(b.deviceId)) : {};
    const settings = repo.getSettings(req.sdb);
    res.json(
      evaluateInspection({
        device: { ...base, ...(b.device || {}) },
        procedureId: b.procedureId,
        profile: b.profile || settings.limitProfile,
        standard: b.standard || settings.defaultStandard,
        measurements: b.measurements || [],
        checks: b.checks || [],
        skipped: b.skipped || [],
      })
    );
  });

  // ---------- Anhänge ----------
  r.post('/devices/:id/attachments', (req, res) => res.status(201).json(repo.addAttachment(req.sdb, Number(req.params.id), req.body || {})));
  r.get('/attachments/:id', (req, res) => {
    const a = repo.getAttachment(req.sdb, Number(req.params.id));
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.filename)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(a.data);
  });
  r.delete('/attachments/:id', (req, res) => res.json(repo.deleteAttachment(req.sdb, Number(req.params.id))));

  // ---------- Prüfungen ----------
  r.get('/inspections', (req, res) => res.json(repo.listInspections(req.sdb, { limit: Math.min(Number(req.query.limit) || 100, 2000), from: req.query.from, to: req.query.to })));

  r.post('/inspections', async (req, res) => {
    const body = { ...(req.body || {}) };
    // Kalibrierstand des Prüfgeräts im Protokoll festhalten (wenn die Kalibrier-Erinnerung eingeschaltet ist)
    const cal = calibration.status();
    if (!body.meter_calibration && cal.enabled && cal.lastDate) body.meter_calibration = calibration.protocolText(cal);
    const out = repo.saveInspection(req.sdb, body);
    let invite = null;
    const settings = repo.getSettings(req.sdb);
    const r = settings.reminders;
    const wantInvite = req.body.sendInvite ?? (r.enabled && r.calendarInvite && r.channel !== 'mail');
    if (wantInvite && out.inspection.result === 'bestanden' && out.inspection.device.reminder_enabled && smtpConfigured(settings)) {
      try {
        invite = { ok: true, ...(await sendCalendarInvite(req.sdb, out.inspection.device_id)) };
      } catch (e) {
        invite = { ok: false, error: e.message };
      }
    }
    res.status(201).json({ ...out, invite });
  });

  r.get('/inspections/:id', (req, res) => res.json(repo.getInspection(req.sdb, Number(req.params.id))));
  r.delete('/inspections/:id', (req, res) => res.json(repo.deleteInspection(req.sdb, Number(req.params.id))));

  r.get('/inspections/:id/report', (req, res) => {
    const insp = repo.getInspection(req.sdb, Number(req.params.id));
    res.type('html').send(inspectionReport(insp, repo.getSettings(req.sdb), { dbName: req.sdb.getMeta('db_name') }));
  });

  r.get('/labels', async (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map(Number)
      .filter(Boolean);
    const devices = ids.length ? ids.map((id) => repo.getDevice(req.sdb, id)) : repo.listDevices(req.sdb, { status: 'alle-aktiven' });
    res.type('html').send(await labelSheet(devices, repo.getSettings(req.sdb), { dbUuid: req.sdb.getMeta('db_uuid') }));
  });

  // ---------- Kalender & Erinnerungen ----------
  r.get('/calendar.ics', (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map(Number)
      .filter(Boolean);
    const grouping = ['due', 'monthly'].includes(req.query.grouping) ? req.query.grouping : undefined;
    const ics = calendarFor(req.sdb, ids, { grouping });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Prueftermine_${encodeURIComponent(req.sdb.getMeta('db_name'))}.ics"`);
    res.send(ics);
  });

  r.post('/devices/:id/invite', async (req, res) => res.json(await sendCalendarInvite(req.sdb, Number(req.params.id))));

  r.post('/reminders/test', async (req, res) => {
    const settings = repo.getSettings(req.sdb);
    const info = await sendMail(settings, {
      subject: 'Testnachricht Secutest Prüfmanager',
      text: `Die E-Mail-Erinnerungen für „${req.sdb.getMeta('db_name')}“ sind korrekt eingerichtet.`,
    });
    res.json(info);
  });

  r.post('/reminders/run', async (req, res) => res.json(await runReminders(req.sdb, { dryRun: !!req.body?.dryRun })));

  r.get('/reminders/log', (req, res) => {
    res.json(
      req.sdb.db
        .prepare('SELECT l.*, d.name AS device_name, d.inventory_no FROM reminder_log l LEFT JOIN devices d ON d.id = l.device_id ORDER BY l.id DESC LIMIT 200')
        .all()
    );
  });

  // ---------- Export / Protokoll ----------
  r.get('/export.json', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="Export_${encodeURIComponent(req.sdb.getMeta('db_name'))}_${repo.today()}.json"`);
    res.json(repo.exportAll(req.sdb));
  });

  r.get('/export.csv', (req, res) => {
    const devices = repo.listDevices(req.sdb, {});
    const cols = ['inventory_no', 'name', 'manufacturer', 'model', 'serial_no', 'category', 'protection_class', 'device_type', 'location', 'owner', 'interval_months', 'status', 'last_inspection_date', 'last_result', 'next_due_date', 'notes'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.join(';'), ...devices.map((d) => cols.map((c) => q(d[c])).join(';'))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Geraete_${encodeURIComponent(req.sdb.getMeta('db_name'))}_${repo.today()}.csv"`);
    res.send(csv);
  });

  r.get('/audit', (req, res) => res.json(repo.listAudit(req.sdb, 300)));

  return r;
};
