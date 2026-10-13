'use strict';
/**
 * Geräte, Prüfungen, Einstellungen, Erinnerungen, Export – nur nach Anmeldung.
 */
const os = require('os');
const QRCode = require('qrcode');
const { asyncRouter } = require('./util');
const repo = require('../db/repo');
const { listBackups } = require('../db/database');
const { applicableProcedures, buildProcedure, listProcedures, suggestDeviceType, autoModeCheck } = require('../vde/procedures');
const { evaluateInspection } = require('../vde/evaluate');
const { PROFILES, QUANTITIES, limitsFor } = require('../vde/limits');
const { FAIL_ACTIONS, DEVICE_STATUS } = require('../vde/actions');
const { buildCalendar } = require('../reminders/ics');
const { runReminders, sendCalendarInvite } = require('../reminders/scheduler');
const { sendMail, PRESETS, smtpConfigured } = require('../reminders/mailer');
const { inspectionReport, labelSheet, DEVICE_TYPES, MODES } = require('../report/report');
const totp = require('../auth/totp');
const { AuthError } = require('../auth/session');

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
      db: { id: req.dbEntry.id, name: sdb.getMeta('db_name'), uuid: sdb.getMeta('db_uuid'), created_at: sdb.getMeta('created_at'), file: sdb.file, host: os.hostname() },
      settings: repo.publicSettings(repo.getSettings(sdb)),
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

  // ---------- Sicherheit ----------
  r.post('/security/password', (req, res) => {
    const { code, next, next2 } = req.body || {};
    sessions.reauth(req.sdb, { code });
    if (next !== next2) throw new AuthError('Die neuen Passwörter stimmen nicht überein.', 400);
    req.sdb.changePassword(next);
    repo.audit(req.sdb, 'passwort-geaendert', 'db', null, null);
    res.json({ ok: true });
  });

  r.post('/security/2fa/begin', async (req, res) => {
    sessions.reauth(req.sdb, { code: req.body.code });
    const secret = totp.generateSecret();
    pending2fa.set(req.sdb, secret);
    const uri = totp.otpauthUri(secret, { account: req.sdb.getMeta('db_name') });
    res.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) });
  });

  r.post('/security/2fa/finish', (req, res) => {
    const secret = pending2fa.get(req.sdb);
    if (!secret) throw new AuthError('Bitte die Neueinrichtung zuerst starten.', 400);
    const step = totp.verify(secret, req.body.code);
    if (step == null) throw new AuthError('Code der neuen Einrichtung ist falsch.', 401);
    req.sdb.setMeta('totp_secret', secret);
    req.sdb.setMeta('totp_last_step', String(step));
    pending2fa.delete(req.sdb);
    repo.audit(req.sdb, '2fa-neu-eingerichtet', 'db', null, null);
    res.json({ ok: true });
  });

  r.post('/security/recovery', (req, res) => {
    sessions.reauth(req.sdb, { code: req.body.code });
    const codes = totp.generateRecoveryCodes();
    req.sdb.setJson('recovery_codes', codes.map(totp.hashRecoveryCode));
    repo.audit(req.sdb, 'wiederherstellungscodes-neu', 'db', null, null);
    res.json({ codes });
  });

  r.post('/backup', (req, res) => {
    res.json({ file: req.sdb.backup('manuell'), backups: listBackups(req.sdb.file) });
  });

  r.get('/backups', (req, res) => res.json(listBackups(req.sdb.file)));

  // ---------- Geräte ----------
  r.get('/devices', (req, res) => res.json(repo.listDevices(req.sdb, req.query)));
  r.post('/devices', (req, res) => res.status(201).json(repo.createDevice(req.sdb, req.body || {})));
  r.get('/devices/:id', (req, res) => res.json(repo.getDeviceDetail(req.sdb, Number(req.params.id))));
  r.put('/devices/:id', (req, res) => res.json(repo.updateDevice(req.sdb, Number(req.params.id), req.body || {})));
  r.delete('/devices/:id', (req, res) => res.json(repo.deleteDevice(req.sdb, Number(req.params.id))));
  r.post('/devices/:id/duplicate', (req, res) => res.status(201).json(repo.duplicateDevice(req.sdb, Number(req.params.id))));

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
    const out = repo.saveInspection(req.sdb, req.body || {});
    let invite = null;
    const settings = repo.getSettings(req.sdb);
    const wantInvite = req.body.sendInvite ?? (settings.reminders.enabled && settings.reminders.calendarInvite);
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
    res.type('html').send(await labelSheet(devices, repo.getSettings(req.sdb)));
  });

  // ---------- Kalender & Erinnerungen ----------
  r.get('/calendar.ics', (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map(Number)
      .filter(Boolean);
    const devices = (ids.length ? ids.map((id) => repo.getDevice(req.sdb, id)) : repo.listDevices(req.sdb, { status: 'alle-aktiven' })).filter((d) => d.next_due_date && d.reminder_enabled);
    const settings = repo.getSettings(req.sdb);
    const ics = buildCalendar(devices, { dbUuid: req.sdb.getMeta('db_uuid'), dbName: req.sdb.getMeta('db_name'), alarmDays: settings.reminders.calendarAlarmDays, ownerName: settings.owner.name });
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
