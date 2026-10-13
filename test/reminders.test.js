'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secutest-rem-'));
process.env.SECUTEST_HOME = path.join(dir, 'home');
const { buildCalendar } = require('../src/reminders/ics');
const { runReminders, pendingKinds } = require('../src/reminders/scheduler');
const { createDatabase } = require('../src/db/database');
const repo = require('../src/db/repo');

test.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

test('iCalendar mit Ganztagstermin und Erinnerung', () => {
  const ics = buildCalendar([{ id: 1, name: 'Wasserkocher, Küche; groß', inventory_no: 'G-0001', protection_class: 'SK I', next_due_date: '2027-03-31' }], { dbUuid: 'u', dbName: 'Test', alarmDays: 7 });
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270331\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20270401\r\n/);
  assert.match(ics, /TRIGGER:-P7D/);
  assert.ok(ics.replace(/\r\n /g, '').includes('Wasserkocher\\, Küche\\; groß'), 'Sonderzeichen escaped (nach Entfalten)');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `Zeile zu lang: ${line}`);
});

test('Erinnerungslogik: Schwellen, Fälligkeit, keine Doppelversendung', async () => {
  const db = createDatabase(path.join(dir, 'x.secudb'), 'geheim-123', { name: 'X' });
  const d = repo.createDevice(db, { name: 'Fön', next_due_date: repo.addMonths(repo.today(), 0) });
  const settings = repo.getSettings(db);
  const due = pendingKinds(db, repo.getDevice(db, d.id), settings, repo.today());
  assert.deepEqual(due.kinds, ['due']);
  const future = new Date();
  future.setDate(future.getDate() + 5);
  repo.updateDevice(db, d.id, { next_due_date: repo.today(future) });
  assert.deepEqual(pendingKinds(db, repo.getDevice(db, d.id), settings, repo.today()).kinds, ['before-30', 'before-7']);
  db.db.prepare("INSERT INTO reminder_log (device_id, due_date, kind, channel, ok) VALUES (?,?,?,?,1)").run(d.id, repo.today(future), 'before-7', 'mail');
  assert.deepEqual(pendingKinds(db, repo.getDevice(db, d.id), settings, repo.today()).kinds, ['before-30']);
  assert.match((await runReminders(db)).skipped, /deaktiviert/);
  repo.updateSettings(db, { reminders: { enabled: true, recipients: 'test@example.org', smtp: { host: 'localhost', port: 2525, from: 'a@example.org' } } });
  const dry = await runReminders(db, { dryRun: true });
  assert.equal(dry.count, 1);
  db.close();
});

test('Monatlich gebündelt: Vorlauf zum Monatsersten, Überfällige einmal pro Monat', () => {
  const db = createDatabase(path.join(dir, 'monat.secudb'), null, { name: 'Monat' });
  repo.updateSettings(db, { reminders: { grouping: 'monthly', daysBefore: [7] } });
  const settings = repo.getSettings(db);
  const d = repo.getDevice(db, repo.createDevice(db, { name: 'Bohrmaschine', next_due_date: '2026-11-20' }).id);
  assert.deepEqual(pendingKinds(db, d, settings, '2026-10-20').kinds, [], '12 Tage vor dem Monatsersten');
  assert.deepEqual(pendingKinds(db, d, settings, '2026-10-26').kinds, ['m-before-7']);
  assert.deepEqual(pendingKinds(db, d, settings, '2026-11-01').kinds, ['m-due'], 'Monatsübersicht am Monatsersten');
  assert.deepEqual(pendingKinds(db, d, settings, '2026-11-25').kinds, ['m-due'], 'erst ab dem Folgemonat als überfällig gebündelt');
  assert.deepEqual(pendingKinds(db, d, settings, '2026-12-01').kinds, ['m-due', 'm-overdue-2026-12']);
  db.db.prepare("INSERT INTO reminder_log (device_id, due_date, kind, channel, ok) VALUES (?,?,?,?,1)").run(d.id, d.next_due_date, 'm-overdue-2026-12', 'mail');
  assert.deepEqual(pendingKinds(db, d, settings, '2026-12-15').kinds, ['m-due']);
  db.close();
});

test('Kanal „Kalender“: keine Erinnerungsmails, Kalender monatlich als Sammeltermin', async () => {
  const db = createDatabase(path.join(dir, 'kal.secudb'), null, { name: 'Kal' });
  repo.updateSettings(db, { reminders: { enabled: true, channel: 'calendar', recipients: 'a@example.org', smtp: { host: 'localhost', from: 'a@example.org' } } });
  assert.match((await runReminders(db)).skipped, /Kalender/);
  const devs = [
    { id: 1, name: 'A', inventory_no: 'G-1', protection_class: 'SK I', next_due_date: '2027-02-03' },
    { id: 2, name: 'B', inventory_no: 'G-2', protection_class: 'SK II', next_due_date: '2027-02-27' },
    { id: 3, name: 'C', inventory_no: 'G-3', protection_class: 'SK I', next_due_date: '2027-03-10' },
  ];
  const ics = buildCalendar(devs, { dbUuid: 'u', grouping: 'monthly', cancelMonths: ['2027-01'] });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3, 'Februar, März, abgesagter Januar');
  assert.match(ics, /UID:u-monat-2027-02@secutest-pruefmanager/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270201/);
  assert.match(ics, /SUMMARY:Geräteprüfungen Februar 2027: 2 Geräte/);
  assert.match(ics, /STATUS:CANCELLED/);
  const per = buildCalendar(devs.slice(0, 1), { dbUuid: 'u' });
  assert.match(per, /UID:u-geraet-1@secutest-pruefmanager/, 'stabile UID je Gerät → Verschieben aktualisiert den Termin');
  db.close();
});
