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

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

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
