'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secutest-db-'));
process.env.SECUTEST_HOME = path.join(dir, 'home');
const { createDatabase, openDatabase, listBackups } = require('../src/db/database');
const repo = require('../src/db/repo');

test.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

test('addMonths klemmt Monatsende', () => {
  assert.equal(repo.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(repo.addMonths('2028-02-29', 12), '2029-02-28');
  assert.equal(repo.addMonths('2026-10-13', 12), '2027-10-13');
});

test('Verschlüsselte Datenbank: anlegen, falsches Passwort, Passwortwechsel, Sperrdatei', () => {
  const file = path.join(dir, 'cloud', 'Test.secudb');
  const db = createDatabase(file, 'geheim-123', { name: 'Test' });
  assert.ok(fs.existsSync(file + '.lock'));
  db.close();
  assert.ok(!fs.existsSync(file + '.lock'));
  assert.notEqual(fs.readFileSync(file).subarray(0, 15).toString(), 'SQLite format 3', 'Datei ist verschlüsselt');
  assert.throws(() => openDatabase(file, 'falsch-123'), (e) => e.code === 'WRONG_PASSWORD');
  const db2 = openDatabase(file, 'geheim-123');
  assert.equal(db2.getMeta('db_name'), 'Test');
  db2.changePassword('neues-passwort');
  db2.close();
  assert.throws(() => openDatabase(file, 'geheim-123'), (e) => e.code === 'WRONG_PASSWORD');
  const db3 = openDatabase(file, 'neues-passwort');
  assert.ok(listBackups(file).length >= 1, 'Sicherungen vorhanden');
  // Fremde Sperre simulieren
  fs.writeFileSync(file + '.lock', JSON.stringify({ host: 'anderer-pc', user: 'x', pid: 1, since: new Date().toISOString(), heartbeat: new Date().toISOString() }));
  db3.close();
  fs.writeFileSync(file + '.lock', JSON.stringify({ host: 'anderer-pc', user: 'x', pid: 1, since: new Date().toISOString(), heartbeat: new Date().toISOString() }));
  assert.throws(() => openDatabase(file, 'neues-passwort'), (e) => e.code === 'LOCKED');
  openDatabase(file, 'neues-passwort', { force: true }).close();
});

test('Geräte und Prüfungen: Datum automatisch, nächster Termin, Status, Löschen', () => {
  const db = createDatabase(path.join(dir, 'r.secudb'), 'geheim-123', { name: 'R' });
  const d = repo.createDevice(db, { name: 'Toaster', protection_class: 'SK I', device_type: 'heating', interval_months: 24 });
  assert.equal(d.inventory_no, 'G-0001');
  assert.equal(d.due_state, 'never');
  assert.throws(() => repo.createDevice(db, { name: 'X', inventory_no: 'G-0001' }), /bereits vergeben/);
  const ok = repo.saveInspection(db, { device_id: d.id, procedure: 'SK1', mode: 'manuell', measurements: [{ key: 'RSL', value: 0.1 }, { key: 'RISO', value: 20 }, { key: 'IEA', value: 0.3 }], checks: [{ group: 'sicht', item: 'g', label: 'Gehäuse', passed: true }] });
  assert.equal(ok.inspection.inspection_date, repo.today());
  assert.equal(ok.inspection.result, 'bestanden');
  let dev = repo.getDevice(db, d.id);
  assert.equal(dev.last_inspection_date, repo.today());
  assert.equal(dev.next_due_date, repo.addMonths(repo.today(), 24));
  assert.throws(() => repo.saveInspection(db, { device_id: d.id, procedure: 'SK1', measurements: [{ key: 'RSL', value: 2 }] }), /Maßnahme/);
  const bad = repo.saveInspection(db, { device_id: d.id, procedure: 'SK1', action: 'reparatur', measurements: [{ key: 'RSL', value: 2 }] });
  assert.equal(bad.inspection.result, 'nicht_bestanden');
  dev = repo.getDevice(db, d.id);
  assert.equal(dev.status, 'reparatur');
  assert.equal(dev.next_due_date, repo.today(), 'nach Reparatur sofort fällig');
  repo.deleteInspection(db, bad.inspection.id);
  dev = repo.getDevice(db, d.id);
  assert.equal(dev.last_result, 'bestanden');
  // Intervall ändern -> Termin neu
  dev = repo.updateDevice(db, d.id, { interval_months: 12, status: 'aktiv' });
  assert.equal(dev.next_due_date, repo.addMonths(repo.today(), 12));
  assert.equal(repo.listDevices(db, { q: 'toast' }).length, 1);
  assert.equal(repo.stats(db).devices, 1);
  repo.deleteDevice(db, d.id);
  assert.equal(repo.listDevices(db).length, 0);
  assert.equal(db.db.prepare('SELECT count(*) n FROM inspections').get().n, 0, 'Prüfungen mitgelöscht');
  db.close();
});

test('Einstellungen werden verschlüsselt gespeichert, Passwort wird nicht ausgeliefert', () => {
  const db = createDatabase(path.join(dir, 's.secudb'), 'geheim-123', { name: 'S' });
  repo.updateSettings(db, { reminders: { smtp: { host: 'smtp.example.org', pass: 'xyz' } } });
  const pub = repo.publicSettings(repo.getSettings(db));
  assert.equal(pub.reminders.smtp.pass, '');
  assert.equal(pub.reminders.smtp.hasPass, true);
  assert.equal(repo.getSettings(db).reminders.smtp.port, 587, 'Standardwerte bleiben erhalten');
  db.close();
});

test('Datenbank ohne Passwort, nachträglich verschlüsseln und wieder entschlüsseln', () => {
  const { isEncryptedFile, openDatabase: open } = require('../src/db/database');
  const file = path.join(dir, 'offen.secudb');
  const db = createDatabase(file, null, { name: 'Offen' });
  repo.createDevice(db, { name: 'Lampe' });
  assert.equal(db.encrypted, false);
  assert.equal(isEncryptedFile(file), false);
  db.changePassword('neues-passwort');
  assert.equal(db.encrypted, true);
  db.close();
  assert.equal(isEncryptedFile(file), true);
  assert.throws(() => open(file, ''), (e) => e.code === 'PASSWORD_REQUIRED');
  assert.throws(() => open(file, 'falsch-falsch'), (e) => e.code === 'WRONG_PASSWORD');
  const db2 = open(file, 'neues-passwort');
  assert.equal(repo.listDevices(db2)[0].name, 'Lampe');
  db2.removePassword();
  db2.close();
  assert.equal(isEncryptedFile(file), false);
  const db3 = open(file, null);
  assert.equal(db3.encrypted, false);
  assert.equal(repo.listDevices(db3).length, 1);
  db3.close();
});
