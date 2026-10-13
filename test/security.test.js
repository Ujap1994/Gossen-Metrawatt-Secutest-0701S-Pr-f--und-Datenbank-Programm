'use strict';
// Optionales Passwort / optionale 2FA, Datenbank verschieben, Termine verschieben, Intervall, Terminal-Schalter
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secutest-sec-'));
process.env.SECUTEST_HOME = path.join(dir, 'home');
const { createApp } = require('../src/server');
const { SecutestManager } = require('../src/secutest/manager');
const { isEncryptedFile } = require('../src/db/database');
const totp = require('../src/auth/totp');
const repo = require('../src/db/repo');

let server;
let sessions;
let base;
let cookie = '';
const secutest = new SecutestManager();

async function call(method, p, body) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'secutest', cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}

test.before(async () => {
  const created = createApp({ secutest });
  sessions = created.sessions;
  await new Promise((res) => (server = created.app.listen(0, '127.0.0.1', res)));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  await secutest.disconnect().catch(() => {});
  sessions.lock('Testende');
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('Datenbank ohne Passwort und ohne 2FA: anlegen, öffnen, nachträglich absichern', async () => {
  const local = path.join(dir, 'Lokal');
  const c = await call('POST', '/setup/begin', { name: 'Werkstatt', folder: local, usePassword: false, twoFactor: false });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.created, true);
  const file = path.join(local, 'Werkstatt.secudb');
  assert.equal(isEncryptedFile(file), false, 'Datei ist unverschlüsselt');
  assert.deepEqual((await call('GET', '/security')).body, { encrypted: false, twoFactor: false, recoveryRemaining: 0 });

  // Sperren und ohne Passwort/Code wieder öffnen
  await call('POST', '/lock');
  const dbs = (await call('GET', '/databases')).body;
  const entry = dbs.registered.find((d) => d.name === 'Werkstatt');
  assert.equal(entry.encrypted, false);
  const un = await call('POST', '/unlock', { dbId: entry.id, password: '' });
  assert.equal(un.status, 200);
  assert.equal(un.body.unlocked, true);
  assert.equal((await call('GET', '/devices')).status, 200);

  // Passwort festlegen → Datei wird verschlüsselt
  assert.equal((await call('POST', '/security/password', { next: 'kurz', next2: 'kurz' })).status, 400);
  const set = await call('POST', '/security/password', { next: 'sicheres-passwort', next2: 'sicheres-passwort' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.ok(set.body.plainBackups >= 1, 'Sicherung von vorher ist unverschlüsselt');
  assert.equal(isEncryptedFile(file), true);
  const purge = await call('POST', '/security/backups/purge-plain');
  assert.equal(purge.body.removed, set.body.plainBackups);
  assert.ok(purge.body.backups.every((b) => b.encrypted));

  // 2FA einschalten: Bestätigung jetzt mit Passwort
  assert.equal((await call('POST', '/security/2fa/begin', { current: 'falsch-falsch' })).status, 401);
  const b = await call('POST', '/security/2fa/begin', { current: 'sicheres-passwort' });
  assert.equal(b.status, 200);
  const fin = await call('POST', '/security/2fa/finish', { code: totp.totp(b.body.secret) });
  assert.equal(fin.status, 200);
  assert.equal(fin.body.recoveryCodes.length, 10, 'beim ersten Einschalten gibt es Wiederherstellungscodes');
  assert.deepEqual((await call('GET', '/security')).body, { encrypted: true, twoFactor: true, recoveryRemaining: 10 });

  // Anmelden braucht jetzt Passwort + Code
  await call('POST', '/lock');
  const u1 = await call('POST', '/unlock', { dbId: entry.id, password: 'sicheres-passwort' });
  assert.ok(u1.body.pendingToken);
  const u2 = await call('POST', '/unlock/2fa', { pendingToken: u1.body.pendingToken, code: totp.totp(b.body.secret, Date.now() + 30000) });
  assert.equal(u2.status, 200, JSON.stringify(u2.body));

  // 2FA abschalten (Code nötig) und Verschlüsselung entfernen (Code nicht mehr, dafür Passwort)
  assert.equal((await call('POST', '/security/2fa/disable', { code: '000000' })).status, 401);
  // Handy „verloren“: Bestätigung mit einem Wiederherstellungscode
  assert.equal((await call('POST', '/security/2fa/disable', { recoveryCode: 'AAAAA-BBBBB' })).status, 401);
  assert.equal((await call('POST', '/security/2fa/disable', { recoveryCode: fin.body.recoveryCodes[0] })).status, 200);
  assert.equal((await call('POST', '/security/password/remove', { current: 'sicheres-passwort' })).status, 400, 'ohne ausdrückliche Bestätigung');
  assert.equal((await call('POST', '/security/password/remove', { current: 'sicheres-passwort', confirm: true })).status, 200);
  assert.equal(isEncryptedFile(file), false);
  assert.deepEqual((await call('GET', '/security')).body, { encrypted: false, twoFactor: false, recoveryRemaining: 0 });
});

test('Datenbank verschieben (lokal → Cloud-Ordner) mit Sicherungen', async () => {
  const before = (await call('GET', '/meta')).body.db.file;
  await call('POST', '/devices', { name: 'Kreissäge' });
  const cloud = path.join(dir, 'OneDrive', 'SecutestPruefmanager');
  assert.equal((await call('POST', '/database/move', { folder: path.dirname(before) })).status, 400, 'gleicher Ordner');
  const mv = await call('POST', '/database/move', { folder: cloud, withBackups: true });
  assert.equal(mv.status, 200, JSON.stringify(mv.body));
  assert.equal(mv.body.provider, 'onedrive');
  assert.ok(fs.existsSync(path.join(cloud, 'Werkstatt.secudb')));
  assert.ok(!fs.existsSync(before), 'Original entfernt');
  assert.ok(fs.readdirSync(path.join(cloud, 'Sicherungen')).length >= 1, 'Sicherungen mitgenommen');
  // Sitzung bleibt bestehen, Daten sind da, Registrierung zeigt den neuen Pfad
  assert.equal((await call('GET', '/devices')).body[0].name, 'Kreissäge');
  const dbs = (await call('GET', '/databases')).body;
  assert.ok(dbs.registered.some((d) => d.path === path.join(cloud, 'Werkstatt.secudb')));
});

test('Prüftermine verschieben und Prüfintervall für mehrere Geräte ändern', async () => {
  const t = repo.today();
  const due = repo.addMonths(t, 0);
  const a = (await call('POST', '/devices', { name: 'Bohrmaschine', next_due_date: due })).body;
  const b = (await call('POST', '/devices', { name: 'Toaster', next_due_date: repo.addMonths(t, -2) })).body;
  const c = (await call('POST', '/devices', { name: 'Neu, nie geprüft' })).body;
  const p = await call('POST', '/devices/postpone', { ids: [a.id, b.id, c.id], note: 'Urlaub' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.updated.length, 2);
  assert.equal(p.body.skipped[0].reason, 'kein Prüftermin eingetragen');
  const ua = p.body.updated.find((x) => x.id === a.id);
  assert.equal(ua.to, repo.postponeTarget(due, t));
  assert.ok(p.body.updated.every((x) => x.to > t), 'neuer Termin liegt in der Zukunft (auch bei überfälligen Geräten)');
  const da = (await call('GET', `/devices/${a.id}`)).body.device;
  assert.equal(da.postponed_from, due);
  assert.equal(da.postpone_count, 1);
  assert.ok((await call('GET', '/audit')).body.some((r) => r.action === 'pruefung-verschoben' && r.details.includes('Urlaub')));
  // fester Termin, Vergangenheit wird abgelehnt
  assert.equal((await call('POST', '/devices/postpone', { ids: [a.id], date: t })).status, 400);
  const fixed = repo.addMonths(t, 3);
  assert.equal((await call('POST', '/devices/postpone', { ids: [a.id], date: fixed })).body.updated[0].to, fixed);
  assert.equal((await call('GET', `/devices/${a.id}`)).body.device.postponed_from, due, 'ursprünglicher Termin bleibt');

  // Intervall: Gerät mit bestandener Prüfung → Termin neu berechnet; Verschiebung aufgehoben
  const insp = await call('POST', '/inspections', { device_id: a.id, procedure: 'EDV', mode: 'manuell', measurements: [{ key: 'RSL', value: 0.12 }, { key: 'ISONDE', value: 0.01 }], checks: [{ group: 'sicht', item: 'gehaeuse', label: 'Gehäuse', passed: true }] });
  assert.equal(insp.status, 201, JSON.stringify(insp.body));
  assert.equal((await call('GET', `/devices/${a.id}`)).body.device.postponed_from, null, 'Prüfung hebt Verschiebung auf');
  const iv = await call('POST', '/devices/interval', { ids: [a.id, c.id], months: 24 });
  assert.equal(iv.status, 200, JSON.stringify(iv.body));
  const ia = iv.body.devices.find((x) => x.id === a.id);
  assert.equal(ia.dueTo, repo.addMonths(insp.body.inspection.inspection_date, 24));
  assert.equal((await call('GET', `/devices/${c.id}`)).body.device.interval_months, 24);
  const keep = await call('POST', '/devices/interval', { ids: [a.id], months: 6, recalc: false });
  assert.equal(keep.body.devices[0].dueTo, ia.dueTo, 'Termin beibehalten');
  assert.equal((await call('POST', '/devices/interval', { ids: [a.id], months: 0 })).status, 400);
});

test('Kalender: monatlich gebündelt bzw. je Gerät', async () => {
  await call('PUT', '/settings', { reminders: { grouping: 'monthly' } });
  const ics = (await call('GET', '/calendar.ics')).body;
  assert.match(ics, /UID:[^\r\n]*-monat-\d{4}-\d{2}@/);
  assert.match(ics, /SUMMARY:Geräteprüfungen /);
  const perDevice = (await call('GET', '/calendar.ics?grouping=due')).body;
  assert.match(perDevice, /UID:[^\r\n]*-geraet-\d+@/);
  assert.equal((await call('GET', '/meta')).body.settings.reminders.grouping, 'monthly');
  await call('PUT', '/settings', { reminders: { channel: 'quatsch' } });
  assert.equal((await call('GET', '/meta')).body.settings.reminders.channel, 'both', 'ungültiger Kanal → Standard');
});

test('RS-232-Terminal lässt sich abschalten', async () => {
  await call('POST', '/secutest/connect', { simulator: true });
  assert.equal((await call('POST', '/secutest/command', { command: 'IDN?' })).status, 200);
  const off = await call('PUT', '/secutest/config', { terminal: false });
  assert.equal(off.body.terminal, false);
  const r = await call('POST', '/secutest/command', { command: 'IDN?' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'TERMINAL_OFF');
  await call('PUT', '/secutest/config', { terminal: true });
  assert.equal((await call('POST', '/secutest/command', { command: 'IDN?' })).status, 200);
  await call('POST', '/secutest/disconnect');
});

test('Ohne Passwort, aber mit 2FA: Datei unverschlüsselt, Anmeldung verlangt den Code', async () => {
  const folder = path.join(dir, 'Nur2FA');
  const begin = await call('POST', '/setup/begin', { name: 'Nachbar', folder, usePassword: false, twoFactor: true });
  assert.equal(begin.status, 200, JSON.stringify(begin.body));
  assert.ok(begin.body.setupToken);
  const fin = await call('POST', '/setup/finish', { setupToken: begin.body.setupToken, code: totp.totp(begin.body.secret) });
  assert.equal(fin.status, 200);
  assert.equal(isEncryptedFile(path.join(folder, 'Nachbar.secudb')), false);
  assert.deepEqual((await call('GET', '/security')).body, { encrypted: false, twoFactor: true, recoveryRemaining: 10 });
  await call('POST', '/lock');
  const entry = (await call('GET', '/databases')).body.registered.find((d) => d.name === 'Nachbar');
  const u = await call('POST', '/unlock', { dbId: entry.id, password: '' });
  assert.ok(u.body.pendingToken, 'ohne Passwort, aber 2FA-Abfrage');
  assert.equal((await call('GET', '/devices')).status, 401, 'noch nicht angemeldet');
});
