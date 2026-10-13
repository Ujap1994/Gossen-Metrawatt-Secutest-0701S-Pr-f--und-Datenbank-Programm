'use strict';
/**
 * Prüferinnerungen: ermittelt fällige Geräte und versendet eine Sammel-Mail.
 * Bereits versendete Erinnerungen stehen in reminder_log und werden nicht wiederholt.
 *
 * Läuft automatisch beim Entsperren der Datenbank und danach alle 6 Stunden, solange
 * das Programm geöffnet ist. Für den unbeaufsichtigten Betrieb: scripts/send-reminders.js
 */
const repo = require('../db/repo');
const { sendMail, reminderContent, smtpConfigured, recipientsOf, fmtDate } = require('./mailer');
const { buildCalendar, monthLabel } = require('./ics');

const usesMail = (r) => r.channel !== 'calendar';
const usesCalendar = (r) => r.channel !== 'mail';
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;

/**
 * Welche Erinnerungsarten sind für ein Gerät heute fällig (und noch nicht versendet)?
 *
 * grouping 'due':     Erinnerung x Tage vor dem Fälligkeitstag, am Fälligkeitstag und bei Überfälligkeit
 *                     alle n Tage – je Gerät zum eigenen Termin.
 * grouping 'monthly': alle in einem Monat fälligen Geräte werden gemeinsam erinnert – x Tage vor dem
 *                     Monatsersten bzw. am Monatsersten. Überfällige Geräte erscheinen einmal pro Monat
 *                     (am Monatsersten) erneut in der Sammelerinnerung.
 */
function pendingKinds(sdb, device, settings, todayIso) {
  const r = settings.reminders;
  const days = repo.daysBetween(todayIso, device.next_due_date);
  const before = [...(r.daysBefore || [])].map(Number).filter((x) => x > 0);
  const kinds = [];
  if (r.grouping === 'monthly') {
    const daysToMonth = repo.daysBetween(todayIso, monthStart(device.next_due_date));
    if (daysToMonth > 0) {
      for (const d of before) if (daysToMonth <= d) kinds.push(`m-before-${d}`);
    } else if (r.onDue) kinds.push('m-due');
    // überfällig seit Beginn des aktuellen Monats → einmal je Monat in die Sammelerinnerung
    if (r.overdueMonthly && device.next_due_date < monthStart(todayIso)) kinds.push(`m-overdue-${todayIso.slice(0, 7)}`);
  } else if (days > 0) {
    for (const d of before) if (days <= d) kinds.push(`before-${d}`);
  } else if (days === 0) {
    if (r.onDue) kinds.push('due');
  } else {
    if (r.onDue) kinds.push('due');
    const every = Math.max(1, Number(r.overdueEveryDays) || 0);
    if (r.overdueEveryDays) kinds.push(`overdue-${Math.floor(-days / every)}`);
  }
  const sent = new Set(
    sdb.db
      .prepare("SELECT kind FROM reminder_log WHERE device_id = ? AND due_date = ? AND channel = 'mail' AND ok = 1")
      .all(device.id, device.next_due_date)
      .map((x) => x.kind)
  );
  return { days, kinds: kinds.filter((k) => !sent.has(k)) };
}

function calendarOptions(sdb, settings, extra = {}) {
  return { dbUuid: sdb.getMeta('db_uuid'), dbName: sdb.getMeta('db_name'), alarmDays: settings.reminders.calendarAlarmDays, ownerName: settings.owner.name, grouping: settings.reminders.grouping, ...extra };
}

/** Alle Geräte, die im Kalender erscheinen sollen */
function calendarDevices(sdb) {
  return repo.listDevices(sdb, { status: 'alle-aktiven' }).filter((d) => d.next_due_date && d.reminder_enabled);
}

/**
 * Kalenderdatei für die Oberfläche bzw. den Export. ids = nur diese Geräte;
 * bei monatlicher Bündelung immer die vollständigen Monate der gewählten Geräte.
 */
function calendarFor(sdb, ids = [], { grouping } = {}) {
  const settings = repo.getSettings(sdb);
  const opts = calendarOptions(sdb, settings, grouping ? { grouping } : {});
  let devices = calendarDevices(sdb);
  if (ids.length) {
    const wanted = new Set(ids);
    if (opts.grouping === 'monthly') {
      const months = new Set(devices.filter((d) => wanted.has(d.id)).map((d) => d.next_due_date.slice(0, 7)));
      devices = devices.filter((d) => months.has(d.next_due_date.slice(0, 7)));
    } else devices = devices.filter((d) => wanted.has(d.id));
  }
  return buildCalendar(devices, opts);
}

/**
 * @returns {{sent:boolean, count:number, devices:Array, error?:string, skipped?:string}}
 */
async function runReminders(sdb, { dryRun = false, now = new Date() } = {}) {
  const settings = repo.getSettings(sdb);
  const r = settings.reminders;
  if (!r.enabled) return { sent: false, count: 0, devices: [], skipped: 'Erinnerungen sind deaktiviert.' };
  if (!usesMail(r)) return { sent: false, count: 0, devices: [], skipped: 'Erinnerung nur per Kalender gewählt – es werden keine Erinnerungsmails versendet.' };
  if (!smtpConfigured(settings)) return { sent: false, count: 0, devices: [], skipped: 'SMTP ist nicht eingerichtet.' };
  const rcpt = recipientsOf(settings);
  if (!rcpt.length) return { sent: false, count: 0, devices: [], skipped: 'Kein Empfänger hinterlegt.' };
  const todayIso = repo.today(now);
  // monatlich: Vorlauf bezieht sich auf den Monatsersten → bis zu 31 Tage weiter vorausschauen
  const horizon = Math.max(0, ...(r.daysBefore || []).map(Number)) + (r.grouping === 'monthly' ? 31 : 0);
  const candidates = repo.dueDevices(sdb, horizon).filter((d) => d.reminder_enabled && d.status !== 'ausgemustert');
  const items = [];
  for (const device of candidates) {
    const { days, kinds } = pendingKinds(sdb, device, settings, todayIso);
    if (kinds.length) items.push({ device, days, kinds });
  }
  if (!items.length) return { sent: false, count: 0, devices: [] };
  if (dryRun) return { sent: false, count: items.length, devices: items.map((i) => ({ id: i.device.id, name: i.device.name, days: i.days, kinds: i.kinds })) };

  const dbName = sdb.getMeta('db_name');
  const content = reminderContent(dbName, items, { grouping: r.grouping });
  const attachments = [];
  if (usesCalendar(r)) {
    const devices = r.grouping === 'monthly' ? calendarDevices(sdb).filter((d) => items.some((i) => i.device.next_due_date.slice(0, 7) === d.next_due_date.slice(0, 7))) : items.map((i) => i.device);
    attachments.push({ filename: 'Prueftermine.ics', content: buildCalendar(devices, calendarOptions(sdb, settings)), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' });
  }
  const log = sdb.db.prepare('INSERT INTO reminder_log (device_id, due_date, kind, channel, recipient, ok, error) VALUES (?,?,?,?,?,?,?)');
  try {
    const info = await sendMail(settings, { ...content, attachments });
    sdb.db.transaction(() => {
      for (const i of items) for (const k of i.kinds) log.run(i.device.id, i.device.next_due_date, k, 'mail', info.to.join(', '), 1, null);
    })();
    repo.audit(sdb, 'erinnerung-versendet', 'reminder', null, `${items.length} Gerät(e) an ${info.to.join(', ')}`);
    return { sent: true, count: items.length, devices: items.map((i) => ({ id: i.device.id, name: i.device.name, days: i.days })) };
  } catch (e) {
    log.run(null, null, 'fehler', 'mail', rcpt.join(', '), 0, e.message);
    return { sent: false, count: items.length, devices: [], error: e.message };
  }
}

/**
 * Aktualisierte Kalendertermine per Mail senden (nach Prüfung, Verschieben, Intervalländerung).
 * previousDue: {deviceId: alterTermin} – bei monatlicher Bündelung werden auch die alten Monate
 * aktualisiert bzw. abgesagt, wenn dort kein Gerät mehr fällig ist.
 */
async function sendCalendarUpdate(sdb, deviceIds, { previousDue = {} } = {}) {
  const settings = repo.getSettings(sdb);
  const all = calendarDevices(sdb);
  const ids = new Set(deviceIds.map(Number));
  const changed = all.filter((d) => ids.has(d.id));
  if (!changed.length) throw new Error('Für diese Geräte ist kein nächster Prüftermin eingetragen.');
  const dbName = sdb.getMeta('db_name');
  let devices = changed;
  let cancelMonths = [];
  let subject;
  if (settings.reminders.grouping === 'monthly') {
    const months = new Set([...changed.map((d) => d.next_due_date.slice(0, 7)), ...Object.values(previousDue).filter(Boolean).map((x) => String(x).slice(0, 7))]);
    devices = all.filter((d) => months.has(d.next_due_date.slice(0, 7)));
    cancelMonths = [...months].filter((m) => !devices.some((d) => d.next_due_date.startsWith(m)));
    subject = `Prüftermine ${[...months].sort().map(monthLabel).join(', ')} (${dbName})`;
  } else {
    subject = changed.length === 1 ? `Prüftermin ${fmtDate(changed[0].next_due_date)}: ${changed[0].name} (${changed[0].inventory_no})` : `${changed.length} Prüftermine aktualisiert (${dbName})`;
  }
  const ics = buildCalendar(devices, calendarOptions(sdb, settings, { cancelMonths }));
  const text = `Im Anhang ${devices.length === 1 && !cancelMonths.length ? 'der Kalendertermin' : 'die Kalendertermine'} für die nächsten Prüfungen aus der Datenbank „${dbName}“.\nEinfach öffnen und in den Kalender übernehmen (Outlook, iCloud, Google …) – bereits übernommene Termine werden dabei aktualisiert.`;
  const info = await sendMail(settings, { subject, text, attachments: [{ filename: 'Prueftermine.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] });
  const log = sdb.db.prepare('INSERT INTO reminder_log (device_id, due_date, kind, channel, recipient, ok) VALUES (?,?,?,?,?,1)');
  for (const d of changed) log.run(d.id, d.next_due_date, 'invite', 'calendar', info.to.join(', '));
  return info;
}

/** Kalendereinladung für den nächsten Prüftermin eines Geräts per Mail senden */
function sendCalendarInvite(sdb, deviceId) {
  return sendCalendarUpdate(sdb, [deviceId]);
}

/** Automatisch aktualisierte Termine senden, wenn so eingestellt. Liefert null, wenn nicht vorgesehen. */
async function autoCalendarUpdate(sdb, deviceIds, opts) {
  const settings = repo.getSettings(sdb);
  const r = settings.reminders;
  if (!r.enabled || !usesCalendar(r) || !r.calendarInvite || !smtpConfigured(settings)) return null;
  // nur Geräte, die überhaupt im Kalender stehen (Erinnerung an, Termin vorhanden, nicht ausgemustert)
  const inCalendar = new Set(calendarDevices(sdb).map((d) => d.id));
  deviceIds = deviceIds.filter((id) => inCalendar.has(Number(id)));
  if (!deviceIds.length) return null;
  try {
    return { ok: true, ...(await sendCalendarUpdate(sdb, deviceIds, opts)) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

class ReminderScheduler {
  constructor() {
    this.timer = null;
    this.lastRun = null;
  }

  start(sdb, onResult) {
    this.stop();
    const run = async () => {
      try {
        this.lastRun = { at: new Date().toISOString(), ...(await runReminders(sdb)) };
        onResult?.(this.lastRun);
      } catch (e) {
        this.lastRun = { at: new Date().toISOString(), error: e.message };
      }
    };
    this.first = setTimeout(run, 10 * 1000);
    this.timer = setInterval(run, 6 * 60 * 60 * 1000);
    this.first.unref?.();
    this.timer.unref?.();
  }

  stop() {
    clearTimeout(this.first);
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { runReminders, sendCalendarInvite, sendCalendarUpdate, autoCalendarUpdate, calendarFor, ReminderScheduler, pendingKinds, usesMail, usesCalendar };
