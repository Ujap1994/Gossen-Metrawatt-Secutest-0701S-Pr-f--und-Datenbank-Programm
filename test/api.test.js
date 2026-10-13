'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secutest-api-'));
process.env.SECUTEST_HOME = path.join(dir, 'home');
const { createApp } = require('../src/server');
const { SecutestManager } = require('../src/secutest/manager');
const totp = require('../src/auth/totp');

let server;
let sessions;
let base;
let cookie = '';
const secutest = new SecutestManager();

async function call(method, p, body, { headers = {} } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'secutest', cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}

test.before(async () => {
  const created = createApp({ secutest });
  const { app } = created;
  sessions = created.sessions;
  await new Promise((res) => (server = app.listen(0, '127.0.0.1', res)));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  await secutest.disconnect().catch(() => {});
  sessions.lock('Testende'); // Datenbank schließen (Windows sperrt geöffnete Dateien)
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('Kompletter Ablauf: Datenbank + 2FA, Gerät, Prüfung, Sperren, Entsperren', async () => {
  assert.equal((await call('GET', '/status')).body.authed, false);
  assert.equal((await call('GET', '/devices')).status, 401);
  assert.equal((await call('POST', '/lock', {}, { headers: { 'X-Requested-With': '' } })).status, 403, 'CSRF-Schutz');

  const s = await call('POST', '/setup/begin', { name: 'Familie Muster', folder: path.join(dir, 'OneDrive'), password: 'kurz', password2: 'kurz' });
  assert.equal(s.status, 400);
  const begin = await call('POST', '/setup/begin', { name: 'Familie Muster', folder: path.join(dir, 'OneDrive'), password: 'langes-passwort', password2: 'langes-passwort' });
  assert.equal(begin.status, 200);
  assert.match(begin.body.qr, /^data:image\/png;base64,/);
  assert.equal((await call('POST', '/setup/finish', { setupToken: begin.body.setupToken, code: '000000' })).status, 401);
  const fin = await call('POST', '/setup/finish', { setupToken: begin.body.setupToken, code: totp.totp(begin.body.secret) });
  assert.equal(fin.status, 200);
  assert.equal(fin.body.recoveryCodes.length, 10);
  assert.ok(fs.existsSync(path.join(dir, 'OneDrive', 'Familie_Muster.secudb')));

  const dev = await call('POST', '/devices', { name: 'Monitor', protection_class: 'SK I' });
  assert.equal(dev.status, 201);
  const auto = await call('POST', '/procedure', { procedureId: 'AUTO', deviceId: dev.body.id });
  assert.equal(auto.status, 409);
  assert.equal(auto.body.alternative, 'EDV');

  const insp = await call('POST', '/inspections', { device_id: dev.body.id, procedure: 'EDV', mode: 'manuell', measurements: [{ key: 'RSL', value: 0.12 }, { key: 'ISONDE', value: 0.01 }], checks: [{ group: 'sicht', item: 'gehaeuse', label: 'Gehäuse', passed: true }] });
  assert.equal(insp.status, 201, JSON.stringify(insp.body));
  assert.equal(insp.body.inspection.result, 'bestanden');
  const rep = await call('GET', `/inspections/${insp.body.inspection.id}/report`);
  assert.match(rep.body, /Prüfprotokoll/);
  assert.match(rep.body, /BESTANDEN/);
  assert.match((await call('GET', '/calendar.ics')).body, /BEGIN:VEVENT/);
  assert.match((await call('GET', '/labels')).body, /<svg/);

  await call('POST', '/lock');
  assert.equal((await call('GET', '/devices')).status, 401);
  const dbs = await call('GET', '/databases');
  const id = dbs.body.registered[0].id;
  assert.equal((await call('POST', '/unlock', { dbId: id, password: 'falsch-falsch' })).status, 401);
  const un = await call('POST', '/unlock', { dbId: id, password: 'langes-passwort' });
  assert.equal(un.status, 200);
  // nächstes Zeitfenster (gleicher Code wie beim Anlegen wäre ein Replay)
  const ok = await call('POST', '/unlock/2fa', { pendingToken: un.body.pendingToken, code: totp.totp(begin.body.secret, Date.now() + 30000) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await call('GET', '/devices')).body.length, 1);
});

test('SECUTEST-Simulator über die API', async () => {
  const c = await call('POST', '/secutest/connect', { simulator: true, scenario: 'sk2-ok' });
  assert.equal(c.status, 200);
  assert.equal(c.body.identity.model, 'SecuTest S');
  const pre = await call('POST', '/secutest/precheck');
  assert.equal(pre.body.protectiveConductor, false, 'SK II ohne Schutzleiter');
  await call('POST', '/secutest/remote/start', { group: 'RISO' });
  const r = await call('GET', '/secutest/remote/read?group=RISO');
  assert.ok(r.body.values.RISO.value > 2);
  const term = await call('POST', '/secutest/command', { command: 'IDN?' });
  assert.equal(term.body.response.type, 'answer');
  await call('POST', '/secutest/remote/end');
  await call('POST', '/secutest/disconnect');
});
