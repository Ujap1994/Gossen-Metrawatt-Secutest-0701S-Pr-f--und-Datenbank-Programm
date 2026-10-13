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
const { buildCalendar } = require('./ics');

/** Welche Erinnerungsarten sind für ein Gerät heute fällig (und noch nicht versendet)? */
function pendingKinds(sdb, device, settings, todayIso) {
  const r = settings.reminders;
  const days = repo.daysBetween(todayIso, device.next_due_date);
  const kinds = [];
  if (days > 0) {
    for (const d of [...(r.daysBefore || [])].map(Number).filter((x) => x > 0)) if (days <= d) kinds.push(`before-${d}`);
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

/**
 * @returns {{sent:boolean, count:number, devices:Array, error?:string, skipped?:string}}
 */
async function runReminders(sdb, { dryRun = false, now = new Date() } = {}) {
  const settings = repo.getSettings(sdb);
  if (!settings.reminders.enabled) return { sent: false, count: 0, devices: [], skipped: 'Erinnerungen sind deaktiviert.' };
  if (!smtpConfigured(settings)) return { sent: false, count: 0, devices: [], skipped: 'SMTP ist nicht eingerichtet.' };
  const rcpt = recipientsOf(settings);
  if (!rcpt.length) return { sent: false, count: 0, devices: [], skipped: 'Kein Empfänger hinterlegt.' };
  const todayIso = repo.today(now);
  const horizon = Math.max(0, ...(settings.reminders.daysBefore || []).map(Number));
  const candidates = repo.dueDevices(sdb, horizon).filter((d) => d.reminder_enabled && d.status !== 'ausgemustert');
  const items = [];
  for (const device of candidates) {
    const { days, kinds } = pendingKinds(sdb, device, settings, todayIso);
    if (kinds.length) items.push({ device, days, kinds });
  }
  if (!items.length) return { sent: false, count: 0, devices: [] };
  if (dryRun) return { sent: false, count: items.length, devices: items.map((i) => ({ id: i.device.id, name: i.device.name, days: i.days, kinds: i.kinds })) };

  const dbName = sdb.getMeta('db_name');
  const content = reminderContent(dbName, items);
  const ics = buildCalendar(
    items.map((i) => i.device),
    { dbUuid: sdb.getMeta('db_uuid'), dbName, alarmDays: settings.reminders.calendarAlarmDays, ownerName: settings.owner.name }
  );
  const log = sdb.db.prepare('INSERT INTO reminder_log (device_id, due_date, kind, channel, recipient, ok, error) VALUES (?,?,?,?,?,?,?)');
  try {
    const info = await sendMail(settings, { ...content, attachments: [{ filename: 'Pruftermine.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] });
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

/** Kalendereinladung für den nächsten Prüftermin eines Geräts per Mail senden */
async function sendCalendarInvite(sdb, deviceId) {
  const settings = repo.getSettings(sdb);
  const device = repo.getDevice(sdb, deviceId);
  if (!device.next_due_date) throw new Error('Für dieses Gerät ist kein nächster Prüftermin eingetragen.');
  const dbName = sdb.getMeta('db_name');
  const ics = buildCalendar([device], { dbUuid: sdb.getMeta('db_uuid'), dbName, alarmDays: settings.reminders.calendarAlarmDays, ownerName: settings.owner.name });
  const subject = `Prüftermin ${fmtDate(device.next_due_date)}: ${device.name} (${device.inventory_no})`;
  const text = `Im Anhang der Kalendertermin für die nächste Prüfung von „${device.name}“ (${device.inventory_no}).\nEinfach öffnen und in den Kalender übernehmen (Outlook, iCloud, Google …).`;
  const info = await sendMail(settings, { subject, text, attachments: [{ filename: `Prueftermin_${device.inventory_no}.ics`, content: ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] });
  sdb.db.prepare('INSERT INTO reminder_log (device_id, due_date, kind, channel, recipient, ok) VALUES (?,?,?,?,?,1)').run(device.id, device.next_due_date, 'invite', 'calendar', info.to.join(', '));
  return info;
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

module.exports = { runReminders, sendCalendarInvite, ReminderScheduler, pendingKinds };
