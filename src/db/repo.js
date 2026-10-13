'use strict';
/**
 * Datenzugriff: Geräte, Prüfungen, Messwerte, Anhänge, Einstellungen.
 * Alle Funktionen erhalten das geöffnete SecuDb-Objekt (siehe database.js).
 */
const { evaluateInspection } = require('../vde/evaluate');
const { findAction } = require('../vde/actions');
const { DEFAULT_PROFILE } = require('../vde/limits');

class RepoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Datum
// ---------------------------------------------------------------------------
function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00').getTime());
}

/** Monate addieren, Monatsende wird geklemmt (31.01. + 1 Monat = 28./29.02.) */
function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1 + Number(months), 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return today(target);
}

function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso + 'T00:00:00');
  const b = new Date(toIso + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  owner: { name: '', street: '', zip: '', city: '', phone: '', email: '' },
  inspector: { name: '', qualification: 'Elektrofachkraft', company: '' },
  inventoryPrefix: 'G-',
  defaultIntervalMonths: 12,
  limitProfile: DEFAULT_PROFILE,
  defaultStandard: 'VDE 0702',
  autoLockMinutes: 15,
  manualDisplayCorrection: true,
  reminders: {
    enabled: false,
    channel: 'both', // mail | calendar | both
    grouping: 'due', // due = zum Fälligkeitstermin je Gerät, monthly = monatsweise gebündelt
    daysBefore: [30, 7],
    onDue: true,
    overdueEveryDays: 14,
    overdueMonthly: true, // monatlich gebündelt: überfällige Geräte in jeder Monatsübersicht aufführen
    recipients: '',
    calendarInvite: true,
    calendarAlarmDays: 7,
    smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: '' },
  },
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

function getSettings(sdb) {
  return deepMerge(DEFAULT_SETTINGS, sdb.getJson('settings', {}));
}

function updateSettings(sdb, patch) {
  const next = deepMerge(getSettings(sdb), patch);
  next.defaultIntervalMonths = clampInt(next.defaultIntervalMonths, 1, 120, 12);
  next.autoLockMinutes = clampInt(next.autoLockMinutes, 1, 240, 15);
  if (!['mail', 'calendar', 'both'].includes(next.reminders.channel)) next.reminders.channel = 'both';
  if (!['due', 'monthly'].includes(next.reminders.grouping)) next.reminders.grouping = 'due';
  sdb.setJson('settings', next);
  audit(sdb, 'einstellungen', 'settings', null, Object.keys(patch).join(', '));
  return next;
}

/** Einstellungen ohne Passwörter (für die Oberfläche) */
function publicSettings(s) {
  const c = JSON.parse(JSON.stringify(s));
  if (c.reminders?.smtp) {
    c.reminders.smtp.hasPass = !!c.reminders.smtp.pass;
    c.reminders.smtp.pass = '';
  }
  return c;
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
function audit(sdb, action, entity, entityId, details) {
  sdb.db.prepare('INSERT INTO audit_log(action, entity, entity_id, details) VALUES (?,?,?,?)').run(action, entity, entityId ?? null, details ? String(details).slice(0, 2000) : null);
}

function listAudit(sdb, limit = 200) {
  return sdb.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
}

// ---------------------------------------------------------------------------
// Geräte
// ---------------------------------------------------------------------------
const DEVICE_FIELDS = {
  inventory_no: 'text',
  name: 'text',
  manufacturer: 'text',
  model: 'text',
  serial_no: 'text',
  category: 'text',
  protection_class: 'enum:SK I|SK II|SK III',
  device_type: 'enum:standard|heating|electronic|it|extension|battery',
  connection_type: 'enum:plug|fixed|terminals',
  phases: 'int',
  rated_voltage: 'num',
  rated_power: 'num',
  rated_current: 'num',
  heating_power_kw: 'num',
  cable_length_m: 'num',
  cable_cross_section: 'num',
  location: 'text',
  owner: 'text',
  purchase_date: 'date',
  interval_months: 'int',
  status: 'enum:aktiv|gesperrt|reparatur|ausgemustert',
  reminder_enabled: 'bool',
  next_due_date: 'date',
  notes: 'text',
};

function cleanDevice(input, { partial = false } = {}) {
  const out = {};
  for (const [field, type] of Object.entries(DEVICE_FIELDS)) {
    if (!(field in input)) continue;
    let v = input[field];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (type === 'text') v = String(v).trim().slice(0, 2000) || null;
      else if (type === 'int') {
        v = parseInt(v, 10);
        if (!Number.isFinite(v)) throw new RepoError(`Ungültige Zahl im Feld ${field}`);
      } else if (type === 'num') {
        v = Number(String(v).replace(',', '.'));
        if (!Number.isFinite(v)) throw new RepoError(`Ungültige Zahl im Feld ${field}`);
      } else if (type === 'bool') v = v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0;
      else if (type === 'date') {
        if (!isIsoDate(v)) throw new RepoError(`Ungültiges Datum im Feld ${field} (erwartet JJJJ-MM-TT)`);
      } else if (type.startsWith('enum:')) {
        const allowed = type.slice(5).split('|');
        if (!allowed.includes(v)) throw new RepoError(`Ungültiger Wert für ${field}: ${v}`);
      }
    }
    out[field] = v;
  }
  if (!partial) {
    if (!out.name) throw new RepoError('Bitte eine Gerätebezeichnung angeben.');
  } else if ('name' in out && !out.name) {
    throw new RepoError('Die Gerätebezeichnung darf nicht leer sein.');
  }
  if (out.interval_months != null && (out.interval_months < 1 || out.interval_months > 120)) throw new RepoError('Prüfintervall muss zwischen 1 und 120 Monaten liegen.');
  if (out.phases != null && ![1, 3].includes(out.phases)) throw new RepoError('Phasen: 1 oder 3');
  return out;
}

function nextInventoryNo(sdb) {
  const prefix = getSettings(sdb).inventoryPrefix || 'G-';
  const rows = sdb.db.prepare('SELECT inventory_no FROM devices WHERE inventory_no LIKE ?').all(prefix + '%');
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.inventory_no.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(4, '0');
}

function decorateDevice(d, ref = today()) {
  if (!d) return d;
  let dueState = 'none';
  let dueInDays = null;
  if (d.status === 'ausgemustert') dueState = 'retired';
  else if (d.status === 'gesperrt' || d.status === 'reparatur') dueState = 'blocked';
  else if (d.next_due_date) {
    dueInDays = daysBetween(ref, d.next_due_date);
    dueState = dueInDays < 0 ? 'overdue' : dueInDays <= 30 ? 'soon' : 'ok';
  } else if (!d.last_inspection_date) dueState = 'never';
  return { ...d, due_state: dueState, due_in_days: dueInDays };
}

function listDevices(sdb, { q, status, due, protection_class, category, location, sort = 'name' } = {}) {
  const where = [];
  const params = {};
  if (q) {
    where.push(`(name LIKE @q OR inventory_no LIKE @q OR manufacturer LIKE @q OR model LIKE @q OR serial_no LIKE @q OR location LIKE @q OR owner LIKE @q OR category LIKE @q OR notes LIKE @q)`);
    params.q = `%${q}%`;
  }
  if (status) {
    if (status === 'alle-aktiven') where.push("status != 'ausgemustert'");
    else {
      where.push('status = @status');
      params.status = status;
    }
  }
  if (protection_class) {
    where.push('protection_class = @pc');
    params.pc = protection_class;
  }
  if (category) {
    where.push('category = @cat');
    params.cat = category;
  }
  if (location) {
    where.push('location = @loc');
    params.loc = location;
  }
  const t = today();
  if (due === 'overdue') {
    where.push("next_due_date < @t AND status != 'ausgemustert'");
    params.t = t;
  } else if (due === 'soon') {
    where.push("next_due_date >= @t AND next_due_date <= @t30 AND status != 'ausgemustert'");
    params.t = t;
    params.t30 = addDaysIso(t, 30);
  } else if (due === 'never') where.push("last_inspection_date IS NULL AND status != 'ausgemustert'");
  else if (due === 'failed') where.push("last_result = 'nicht_bestanden'");
  const order = {
    name: 'name COLLATE NOCASE',
    inventory: 'inventory_no',
    due: "CASE WHEN next_due_date IS NULL THEN 1 ELSE 0 END, next_due_date",
    location: 'location COLLATE NOCASE, name COLLATE NOCASE',
    updated: 'updated_at DESC',
  }[sort] || 'name COLLATE NOCASE';
  const sql = `SELECT * FROM devices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  return sdb.db.prepare(sql).all(params).map((d) => decorateDevice(d, t));
}

function addDaysIso(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return today(d);
}

function getDevice(sdb, id) {
  const d = sdb.db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  if (!d) throw new RepoError('Gerät nicht gefunden', 404);
  return decorateDevice(d);
}

function getDeviceDetail(sdb, id) {
  const device = getDevice(sdb, id);
  const inspections = sdb.db
    .prepare('SELECT id, inspection_date, standard, reason, procedure, mode, protection_class, result, device_verdict, action, next_due_date, inspector FROM inspections WHERE device_id = ? ORDER BY inspection_date DESC, id DESC')
    .all(id);
  const attachments = sdb.db.prepare('SELECT id, filename, mime, size, inspection_id, created_at FROM attachments WHERE device_id = ? ORDER BY id DESC').all(id);
  return { device, inspections, attachments };
}

function createDevice(sdb, input) {
  const data = cleanDevice(input);
  const settings = getSettings(sdb);
  if (!data.inventory_no) data.inventory_no = nextInventoryNo(sdb);
  if (data.interval_months == null) data.interval_months = settings.defaultIntervalMonths;
  if (sdb.db.prepare('SELECT 1 FROM devices WHERE inventory_no = ?').get(data.inventory_no)) {
    throw new RepoError(`Die Inventarnummer ${data.inventory_no} ist bereits vergeben.`, 409);
  }
  const cols = Object.keys(data);
  const info = sdb.db.prepare(`INSERT INTO devices (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(data);
  audit(sdb, 'geraet-angelegt', 'device', info.lastInsertRowid, `${data.inventory_no} ${data.name}`);
  return getDevice(sdb, info.lastInsertRowid);
}

function updateDevice(sdb, id, input) {
  const before = getDevice(sdb, id);
  const data = cleanDevice(input, { partial: true });
  if (data.inventory_no && data.inventory_no !== before.inventory_no) {
    if (sdb.db.prepare('SELECT 1 FROM devices WHERE inventory_no = ? AND id != ?').get(data.inventory_no, id)) {
      throw new RepoError(`Die Inventarnummer ${data.inventory_no} ist bereits vergeben.`, 409);
    }
  }
  if ('inventory_no' in data && !data.inventory_no) delete data.inventory_no;
  // Intervall geändert -> nächsten Termin neu berechnen (sofern nicht explizit gesetzt)
  if (data.interval_months && data.interval_months !== before.interval_months && !('next_due_date' in data) && before.last_inspection_date && before.last_result === 'bestanden') {
    data.next_due_date = addMonths(before.last_inspection_date, data.interval_months);
  }
  // Neuer Termin (berechnet oder von Hand) hebt eine frühere Verschiebung auf
  if ('next_due_date' in data && data.next_due_date !== before.next_due_date) Object.assign(data, { postponed_from: null, postpone_count: 0 });
  const cols = Object.keys(data);
  if (!cols.length) return before;
  sdb.db.prepare(`UPDATE devices SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...data, id });
  const changed = cols.filter((c) => !['postponed_from', 'postpone_count'].includes(c) && String(before[c] ?? '') !== String(data[c] ?? ''));
  if (changed.length) audit(sdb, 'geraet-geaendert', 'device', id, changed.map((c) => `${c}: ${before[c] ?? '—'} → ${data[c] ?? '—'}`).join('; '));
  return getDevice(sdb, id);
}

function deleteDevice(sdb, id) {
  const d = getDevice(sdb, id);
  sdb.db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  audit(sdb, 'geraet-geloescht', 'device', id, `${d.inventory_no} ${d.name}`);
  return { ok: true };
}

function duplicateDevice(sdb, id) {
  const d = getDevice(sdb, id);
  const copy = {};
  for (const f of Object.keys(DEVICE_FIELDS)) copy[f] = d[f];
  delete copy.inventory_no;
  delete copy.serial_no;
  delete copy.next_due_date;
  copy.status = 'aktiv';
  copy.name = d.name;
  return createDevice(sdb, copy);
}

// ---------------------------------------------------------------------------
// Prüftermine verschieben / Prüfintervall ändern (mehrere Geräte auf einmal)
// ---------------------------------------------------------------------------

/**
 * „Auf den nächsten Monat“: gleicher Tag im Folgemonat des Fälligkeitsmonats. Bei überfälligen
 * Geräten zählt der aktuelle Monat, damit der neue Termin nicht wieder in der Vergangenheit liegt.
 */
function postponeTarget(dueIso, todayIso = today()) {
  const [y, m, d] = dueIso.split('-').map(Number);
  const [ty, tm] = todayIso.split('-').map(Number);
  const base = y * 12 + (m - 1) >= ty * 12 + (tm - 1) ? [y, m] : [ty, tm];
  const target = new Date(base[0], base[1], 1); // Monat + 1
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return today(target);
}

function idList(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!list.length) throw new RepoError('Bitte mindestens ein Gerät auswählen.');
  if (list.length > 5000) throw new RepoError('Zu viele Geräte auf einmal.');
  return list;
}

/**
 * Prüftermine verschieben. Ohne `date` → auf den nächsten Monat, mit `date` → auf dieses Datum.
 * Der ursprüngliche Termin bleibt in postponed_from erhalten (bis zur nächsten Prüfung).
 */
function postponeDevices(sdb, ids, { date, note } = {}) {
  if (date != null && date !== '' && !isIsoDate(date)) throw new RepoError('Ungültiges Datum (erwartet JJJJ-MM-TT).');
  const t = today();
  if (date && date <= t) throw new RepoError('Der neue Termin muss in der Zukunft liegen.');
  const cleanNote = note ? String(note).trim().slice(0, 500) : '';
  const updated = [];
  const skipped = [];
  sdb.db.transaction(() => {
    for (const id of idList(ids)) {
      const d = sdb.db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
      if (!d) {
        skipped.push({ id, reason: 'nicht gefunden' });
        continue;
      }
      if (d.status === 'ausgemustert') {
        skipped.push({ id, name: d.name, reason: 'ausgemustert' });
        continue;
      }
      if (!d.next_due_date) {
        skipped.push({ id, name: d.name, reason: 'kein Prüftermin eingetragen' });
        continue;
      }
      const to = date || postponeTarget(d.next_due_date, t);
      sdb.db
        .prepare("UPDATE devices SET next_due_date = ?, postponed_from = COALESCE(postponed_from, ?), postpone_count = postpone_count + 1, updated_at = datetime('now') WHERE id = ?")
        .run(to, d.next_due_date, id);
      audit(sdb, 'pruefung-verschoben', 'device', id, `${d.inventory_no} ${d.name}: ${d.next_due_date} → ${to}${cleanNote ? ` – ${cleanNote}` : ''}`);
      updated.push({ id, name: d.name, inventory_no: d.inventory_no, from: d.next_due_date, to });
    }
  })();
  return { updated, skipped };
}

/**
 * Prüfintervall mehrerer Geräte ändern (gespeichert je Gerät in der Datenbank).
 * recalc=true: nächsten Termin ab der letzten bestandenen Prüfung neu berechnen.
 */
function changeInterval(sdb, ids, months, { recalc = true } = {}) {
  const m = parseInt(months, 10);
  if (!Number.isFinite(m) || m < 1 || m > 120) throw new RepoError('Prüfintervall muss zwischen 1 und 120 Monaten liegen.');
  const result = [];
  sdb.db.transaction(() => {
    for (const id of idList(ids)) {
      const before = getDevice(sdb, id);
      const patch = { interval_months: m };
      if (!recalc) patch.next_due_date = before.next_due_date;
      const after = updateDevice(sdb, id, patch);
      result.push({ id, name: after.name, inventory_no: after.inventory_no, intervalFrom: before.interval_months, intervalTo: m, dueFrom: before.next_due_date, dueTo: after.next_due_date });
    }
  })();
  return result;
}

function distinctValues(sdb) {
  const col = (c) => sdb.db.prepare(`SELECT DISTINCT ${c} AS v FROM devices WHERE ${c} IS NOT NULL AND ${c} != '' ORDER BY ${c} COLLATE NOCASE`).all().map((r) => r.v);
  return { category: col('category'), location: col('location'), owner: col('owner'), manufacturer: col('manufacturer') };
}

// ---------------------------------------------------------------------------
// Prüfungen
// ---------------------------------------------------------------------------
const STANDARDS = ['VDE 0701', 'VDE 0702'];
const REASONS = {
  erstpruefung: 'Erstprüfung / Aufnahme in den Bestand',
  wiederholung: 'Wiederholungsprüfung',
  instandsetzung: 'Prüfung nach Instandsetzung',
  aenderung: 'Prüfung nach Änderung',
};
const MODES = ['secutest-geraet', 'secutest-pc', 'manuell'];

/**
 * Speichert eine Prüfung inkl. Messwerten und Checklisten.
 * Das Prüfdatum wird automatisch auf HEUTE gesetzt (oder auf das übergebene Datum),
 * Gerät: letztes Prüfdatum, Ergebnis, nächster Termin und Status werden aktualisiert.
 */
function saveInspection(sdb, input) {
  const device = getDevice(sdb, Number(input.device_id));
  const settings = getSettings(sdb);
  const standard = STANDARDS.includes(input.standard) ? input.standard : settings.defaultStandard;
  const mode = MODES.includes(input.mode) ? input.mode : 'manuell';
  const date = input.inspection_date && isIsoDate(input.inspection_date) ? input.inspection_date : today();
  if (date > today()) throw new RepoError('Das Prüfdatum darf nicht in der Zukunft liegen.');
  const profile = input.limit_profile || settings.limitProfile;
  const interval = clampInt(input.interval_months ?? device.interval_months, 1, 120, device.interval_months || 12);
  // Für die Bewertung die Gerätedaten mit evtl. während der Prüfung geänderten Werten kombinieren
  const devForEval = { ...device, ...(input.device_overrides ? cleanDevice(input.device_overrides, { partial: true }) : {}) };

  const evaluation = evaluateInspection({
    device: devForEval,
    procedureId: input.procedure,
    profile,
    standard,
    measurements: Array.isArray(input.measurements) ? input.measurements : [],
    checks: Array.isArray(input.checks) ? input.checks : [],
    skipped: Array.isArray(input.skipped) ? input.skipped : [],
  });

  let result = evaluation.result;
  if (input.aborted) result = 'abgebrochen';
  let action = null;
  if (result !== 'bestanden') {
    action = findAction(input.action);
    if (!action && result === 'nicht_bestanden') throw new RepoError('Prüfung nicht bestanden – bitte eine Maßnahme auswählen.');
    if (action?.requiresNote && !String(input.action_note || '').trim()) throw new RepoError('Bitte die Maßnahme im Freitext beschreiben.');
  }

  let nextDue;
  let newStatus = device.status;
  if (result === 'bestanden') {
    nextDue = addMonths(date, interval);
    if (device.status !== 'ausgemustert') newStatus = 'aktiv';
  } else if (result === 'abgebrochen') {
    nextDue = device.next_due_date;
  } else {
    nextDue = action.retest ? date : null;
    newStatus = action.status;
  }

  const notesText = [input.notes, ...evaluation.notes].filter(Boolean).join('\n');
  const tx = sdb.db.transaction(() => {
    const info = sdb.db
      .prepare(
        `INSERT INTO inspections (device_id, inspection_date, started_at, finished_at, standard, reason, procedure, mode, protection_class, limit_profile, inspector,
          result, device_verdict, action, action_note, interval_months, next_due_date, meter_idn, raw_protocol, notes)
         VALUES (@device_id, @inspection_date, @started_at, @finished_at, @standard, @reason, @procedure, @mode, @protection_class, @limit_profile, @inspector,
          @result, @device_verdict, @action, @action_note, @interval_months, @next_due_date, @meter_idn, @raw_protocol, @notes)`
      )
      .run({
        device_id: device.id,
        inspection_date: date,
        started_at: input.started_at || null,
        finished_at: new Date().toISOString(),
        standard,
        reason: REASONS[input.reason] ? input.reason : 'wiederholung',
        procedure: String(input.procedure || 'MANUELL'),
        mode,
        protection_class: devForEval.protection_class,
        limit_profile: profile,
        inspector: input.inspector || settings.inspector.name || null,
        result,
        device_verdict: input.device_verdict || null,
        action: action ? action.id : null,
        action_note: input.action_note || null,
        interval_months: interval,
        next_due_date: nextDue,
        meter_idn: input.meter_idn || null,
        raw_protocol: input.raw_protocol || null,
        notes: notesText || null,
      });
    const inspId = info.lastInsertRowid;
    const insM = sdb.db.prepare(
      `INSERT INTO measurements (inspection_id, step, key, label, point, value, value_text, unit, limit_value, limit_op, limit_text, passed, source, sort)
       VALUES (@inspection_id, @step, @key, @label, @point, @value, @value_text, @unit, @limit_value, @limit_op, @limit_text, @passed, @source, @sort)`
    );
    for (const m of evaluation.measurements) {
      const { note, ...row } = m; // eslint-disable-line no-unused-vars
      insM.run({ inspection_id: inspId, ...row });
    }
    const insC = sdb.db.prepare('INSERT INTO inspection_checks (inspection_id, group_name, item, label, passed, note, sort) VALUES (@inspection_id, @group_name, @item, @label, @passed, @note, @sort)');
    for (const c of evaluation.checks) insC.run({ inspection_id: inspId, ...c });
    for (const s of input.skipped || []) {
      insC.run({ inspection_id: inspId, group_name: 'entfaellt', item: String(s.step), label: s.title || String(s.step), passed: null, note: s.reason || null, sort: 999 });
    }

    // Gerät aktualisieren (Overrides aus der Prüfung, Datum, Ergebnis, Termin, Status)
    const devPatch = input.device_overrides ? cleanDevice(input.device_overrides, { partial: true }) : {};
    if (result !== 'abgebrochen') {
      Object.assign(devPatch, { last_inspection_date: date, last_result: result, next_due_date: nextDue, status: newStatus, interval_months: interval, postponed_from: null, postpone_count: 0 });
    }
    const cols = Object.keys(devPatch);
    if (cols.length) {
      sdb.db.prepare(`UPDATE devices SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...devPatch, id: device.id });
    }
    audit(sdb, 'pruefung-gespeichert', 'inspection', inspId, `${device.inventory_no} ${device.name}: ${result}${action ? ` (Maßnahme: ${action.label})` : ''}`);
    return inspId;
  });
  const id = tx();
  return { inspection: getInspection(sdb, id), evaluation };
}

function getInspection(sdb, id) {
  const insp = sdb.db.prepare('SELECT * FROM inspections WHERE id = ?').get(id);
  if (!insp) throw new RepoError('Prüfung nicht gefunden', 404);
  insp.measurements = sdb.db.prepare('SELECT * FROM measurements WHERE inspection_id = ? ORDER BY sort, id').all(id);
  insp.checks = sdb.db.prepare('SELECT * FROM inspection_checks WHERE inspection_id = ? ORDER BY sort, id').all(id);
  insp.device = getDevice(sdb, insp.device_id);
  return insp;
}

/** Löscht eine Prüfung und berechnet die Gerätedaten aus der jüngsten verbleibenden Prüfung neu. */
function deleteInspection(sdb, id) {
  const insp = sdb.db.prepare('SELECT * FROM inspections WHERE id = ?').get(id);
  if (!insp) throw new RepoError('Prüfung nicht gefunden', 404);
  sdb.db.transaction(() => {
    sdb.db.prepare('DELETE FROM inspections WHERE id = ?').run(id);
    const latest = sdb.db.prepare("SELECT * FROM inspections WHERE device_id = ? AND result != 'abgebrochen' ORDER BY inspection_date DESC, id DESC LIMIT 1").get(insp.device_id);
    sdb.db
      .prepare("UPDATE devices SET last_inspection_date = ?, last_result = ?, next_due_date = ?, postponed_from = NULL, postpone_count = 0, updated_at = datetime('now') WHERE id = ?")
      .run(latest?.inspection_date ?? null, latest?.result ?? null, latest?.next_due_date ?? null, insp.device_id);
    audit(sdb, 'pruefung-geloescht', 'inspection', id, `Prüfung vom ${insp.inspection_date} (Gerät ${insp.device_id})`);
  })();
  return { ok: true };
}

function listInspections(sdb, { limit = 50, from, to } = {}) {
  const where = [];
  const p = { limit };
  if (from) {
    where.push('i.inspection_date >= @from');
    p.from = from;
  }
  if (to) {
    where.push('i.inspection_date <= @to');
    p.to = to;
  }
  return sdb.db
    .prepare(
      `SELECT i.id, i.inspection_date, i.result, i.procedure, i.mode, i.standard, i.action, i.next_due_date, d.id AS device_id, d.name AS device_name, d.inventory_no
       FROM inspections i JOIN devices d ON d.id = i.device_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY i.inspection_date DESC, i.id DESC LIMIT @limit`
    )
    .all(p);
}

function stats(sdb) {
  const t = today();
  const one = (sql, p = {}) => sdb.db.prepare(sql).get(p).n;
  return {
    devices: one("SELECT count(*) n FROM devices WHERE status != 'ausgemustert'"),
    retired: one("SELECT count(*) n FROM devices WHERE status = 'ausgemustert'"),
    overdue: one("SELECT count(*) n FROM devices WHERE next_due_date < @t AND status != 'ausgemustert'", { t }),
    soon: one("SELECT count(*) n FROM devices WHERE next_due_date >= @t AND next_due_date <= @t30 AND status != 'ausgemustert'", { t, t30: addDaysIso(t, 30) }),
    never: one("SELECT count(*) n FROM devices WHERE last_inspection_date IS NULL AND status != 'ausgemustert'"),
    blocked: one("SELECT count(*) n FROM devices WHERE status IN ('gesperrt','reparatur')"),
    inspectionsYear: one('SELECT count(*) n FROM inspections WHERE inspection_date >= @y', { y: t.slice(0, 4) + '-01-01' }),
    failedYear: one("SELECT count(*) n FROM inspections WHERE result = 'nicht_bestanden' AND inspection_date >= @y", { y: t.slice(0, 4) + '-01-01' }),
  };
}

/** Geräte, deren Prüfung innerhalb von `days` Tagen fällig ist (inkl. überfällig) */
function dueDevices(sdb, days = 30) {
  const t = today();
  return sdb.db
    .prepare("SELECT * FROM devices WHERE status NOT IN ('ausgemustert') AND next_due_date IS NOT NULL AND next_due_date <= ? ORDER BY next_due_date")
    .all(addDaysIso(t, days))
    .map((d) => decorateDevice(d, t));
}

// ---------------------------------------------------------------------------
// Anhänge
// ---------------------------------------------------------------------------
const MAX_ATTACHMENT = 8 * 1024 * 1024;
const ALLOWED_MIME = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;

function addAttachment(sdb, deviceId, { filename, mime, dataBase64, inspection_id }) {
  getDevice(sdb, deviceId);
  if (!ALLOWED_MIME.test(mime || '')) throw new RepoError('Nur Bilder (PNG, JPEG, WebP, GIF) und PDF-Dateien sind erlaubt.');
  const buf = Buffer.from(String(dataBase64 || ''), 'base64');
  if (!buf.length) throw new RepoError('Leere Datei');
  if (buf.length > MAX_ATTACHMENT) throw new RepoError('Datei zu groß (max. 8 MB).');
  const info = sdb.db
    .prepare('INSERT INTO attachments (device_id, inspection_id, filename, mime, size, data) VALUES (?,?,?,?,?,?)')
    .run(deviceId, inspection_id || null, String(filename || 'datei').slice(0, 200), mime, buf.length, buf);
  audit(sdb, 'anhang-hinzugefuegt', 'device', deviceId, filename);
  return { id: info.lastInsertRowid };
}

function getAttachment(sdb, id) {
  const a = sdb.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  if (!a) throw new RepoError('Anhang nicht gefunden', 404);
  return a;
}

function deleteAttachment(sdb, id) {
  const a = getAttachment(sdb, id);
  sdb.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
  audit(sdb, 'anhang-geloescht', 'device', a.device_id, a.filename);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function exportAll(sdb) {
  return {
    exported_at: new Date().toISOString(),
    db_name: sdb.getMeta('db_name'),
    devices: sdb.db.prepare('SELECT * FROM devices ORDER BY id').all(),
    inspections: sdb.db.prepare('SELECT * FROM inspections ORDER BY id').all(),
    measurements: sdb.db.prepare('SELECT * FROM measurements ORDER BY id').all(),
    checks: sdb.db.prepare('SELECT * FROM inspection_checks ORDER BY id').all(),
  };
}

module.exports = {
  RepoError,
  today,
  addMonths,
  daysBetween,
  isIsoDate,
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings,
  publicSettings,
  audit,
  listAudit,
  listDevices,
  getDevice,
  getDeviceDetail,
  createDevice,
  updateDevice,
  deleteDevice,
  duplicateDevice,
  nextInventoryNo,
  distinctValues,
  REASONS,
  STANDARDS,
  saveInspection,
  getInspection,
  deleteInspection,
  listInspections,
  stats,
  dueDevices,
  postponeTarget,
  postponeDevices,
  changeInterval,
  addAttachment,
  getAttachment,
  deleteAttachment,
  exportAll,
};
