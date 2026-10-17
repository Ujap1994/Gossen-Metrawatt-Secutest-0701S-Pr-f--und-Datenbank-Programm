'use strict';
// 1.3.0: Intervallvorschlag DGUV V3, Kalibrier-Erinnerung, QR-Plaketten-Suche, gleiche Geräte mehrfach anlegen
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secutest-feat-'));
process.env.SECUTEST_HOME = path.join(dir, 'home');
const { createDatabase } = require('../src/db/database');
const repo = require('../src/db/repo');
const { suggestInterval, ENVIRONMENTS } = require('../src/vde/dguv');
const calibration = require('../src/secutest/calibration');
const { labelCode, parseLabelCode } = require('../src/report/report');
const { createApp } = require('../src/server');
const { SecutestManager } = require('../src/secutest/manager');

test.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

function addInspections(db, deviceId, n, failed = 0) {
  const ins = db.db.prepare("INSERT INTO inspections (device_id, inspection_date, standard, procedure, mode, result) VALUES (?, ?, 'VDE 0702', 'SK1', 'manuell', ?)");
  for (let i = 0; i < n; i++) ins.run(deviceId, repo.today(), i < failed ? 'nicht_bestanden' : 'bestanden');
}

test('Intervallvorschlag nach DGUV V3: Richtwert, Verlängerung bei Fehlerquote < 2 %, Sonderfälle', () => {
  const db = createDatabase(path.join(dir, 'dguv.secudb'), null, { name: 'DGUV' });
  const buero = repo.createDevice(db, { name: 'Monitor', device_type: 'it', usage_env: 'buero' });
  // zu wenige Prüfungen → Richtwert
  let s = suggestInterval(db, repo.getDevice(db, buero.id));
  assert.equal(s.months, ENVIRONMENTS.buero.base);
  assert.match(s.reasons.join(' '), /mindestens 10/);
  // 20 bestandene Prüfungen im Büro → Fehlerquote 0 % → Maximalwert 24 Monate
  const other = repo.createDevice(db, { name: 'Drucker', device_type: 'it', usage_env: 'buero' });
  addInspections(db, other.id, 20);
  s = suggestInterval(db, repo.getDevice(db, buero.id));
  assert.equal(s.months, 24);
  assert.equal(s.stats.n, 20);
  // Fehlerquote ≥ 2 % → wieder Richtwert
  addInspections(db, other.id, 1, 1);
  s = suggestInterval(db, repo.getDevice(db, buero.id));
  assert.equal(s.months, 6);
  // Baustelle: Richtwert 3 Monate
  const bau = repo.createDevice(db, { name: 'Bohrhammer', usage_env: 'baustelle' });
  assert.equal(suggestInterval(db, repo.getDevice(db, bau.id)).months, 3);
  // Verlängerungsleitung wird auf 12 Monate begrenzt, auch wenn Büro 24 erlaubt
  const db2 = createDatabase(path.join(dir, 'dguv2.secudb'), null, { name: 'DGUV2' });
  const kabel = repo.createDevice(db2, { name: 'Verlängerung', device_type: 'extension', usage_env: 'buero' });
  addInspections(db2, repo.createDevice(db2, { name: 'PC', usage_env: 'buero' }).id, 15);
  s = suggestInterval(db2, repo.getDevice(db2, kabel.id));
  assert.equal(s.months, 12);
  // ohne Einsatzbereich: Annahme Privathaushalt (Empfehlung, keine DGUV-Pflicht)
  const ohne = repo.createDevice(db2, { name: 'Toaster' });
  s = suggestInterval(db2, repo.getDevice(db2, ohne.id));
  assert.equal(s.env, 'privat');
  assert.equal(s.dguv, false);
  assert.match(s.reasons.join(' '), /Kein Einsatzbereich/);
  // eigene Ausfälle → keine Verlängerung
  const kaputt = repo.createDevice(db2, { name: 'Lampe', usage_env: 'buero' });
  addInspections(db2, kaputt.id, 1, 1);
  assert.equal(suggestInterval(db2, repo.getDevice(db2, kaputt.id)).months, 6);
  // Standard-Einsatzbereich für neue Geräte
  repo.updateSettings(db2, { defaultUsageEnv: 'werkstatt' });
  assert.equal(repo.createDevice(db2, { name: 'Flex' }).usage_env, 'werkstatt');
  repo.updateSettings(db2, { defaultUsageEnv: 'unsinn' });
  assert.equal(repo.getSettings(db2).defaultUsageEnv, '');
  db.close();
  db2.close();
});

test('Gleiche Geräte mehrfach anlegen: Kopien mit eigener Inventarnummer und Nummerierung', () => {
  const db = createDatabase(path.join(dir, 'serie.secudb'), null, { name: 'Serie' });
  const orig = repo.createDevice(db, { name: 'Verlängerung 10 m', device_type: 'extension', cable_length_m: 10, serial_no: 'S-1', location: 'Lager' });
  const r = repo.duplicateDeviceMany(db, orig.id, { count: 3 });
  assert.equal(r.created.length, 3);
  assert.equal(r.original.name, 'Verlängerung 10 m #1');
  assert.deepEqual(r.created.map((d) => d.name), ['Verlängerung 10 m #2', 'Verlängerung 10 m #3', 'Verlängerung 10 m #4']);
  assert.equal(new Set([r.original, ...r.created].map((d) => d.inventory_no)).size, 4, 'eigene Inventarnummern');
  assert.ok(r.created.every((d) => d.cable_length_m === 10 && d.location === 'Lager' && d.serial_no === null));
  // erneut: Nummerierung läuft weiter
  assert.equal(repo.duplicateDeviceMany(db, orig.id, { count: 1 }).created[0].name, 'Verlängerung 10 m #5');
  assert.throws(() => repo.duplicateDeviceMany(db, orig.id, { count: 0 }), /1 bis 200/);
  db.close();
});

test('Prüfplakette: QR-Inhalt mit Datenbank-Kennung und Auswertung', () => {
  const code = labelCode({ inventory_no: 'G-0042', name: 'Wasserkocher', next_due_date: '2027-05-01' }, '1A2B3C4D-5E6F-7a8b-9c0d-112233445566');
  assert.equal(code, 'G-0042 | Wasserkocher | nächste Prüfung 2027-05-01 | DB 1A2B3C4D');
  assert.deepEqual({ ...parseLabelCode(code), raw: undefined }, { code: 'G-0042', db: '1a2b3c4d', raw: undefined });
  assert.equal(parseLabelCode('G-0042 | Föhn | nächste Prüfung -').db, null, 'alte Plaketten ohne Kennung');
  assert.equal(parseLabelCode('  SN-777  ').code, 'SN-777');
  assert.equal(parseLabelCode(''), null);
});

test('Kalibrier-Erinnerung: Zustände, Protokolltext, Eingaben prüfen', () => {
  assert.equal(calibration.status().state, 'off');
  assert.equal(calibration.update({ enabled: true }).state, 'unknown');
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const back = (months, days = 0) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() - months);
    d.setDate(d.getDate() + days);
    return iso(d);
  };
  assert.equal(calibration.update({ lastDate: back(2), intervalMonths: 12, warnDays: 30 }).state, 'ok');
  assert.equal(calibration.update({ lastDate: back(12, 10) }).state, 'soon');
  const over = calibration.update({ lastDate: back(13), calibrationNo: '05' });
  assert.equal(over.state, 'overdue');
  assert.ok(over.daysLeft < 0);
  assert.match(calibration.protocolText(over), /kalibriert .*gültig bis .*Kalibrier-Nr\. 05.*ÜBERFÄLLIG/);
  assert.equal(calibration.status({ identity: { calibration: '06' } }).changedOnDevice, true, 'neue Kalibrier-Nr. im Gerät erkannt');
  assert.throws(() => calibration.update({ lastDate: '2099-01-01' }), /Zukunft/);
  assert.throws(() => calibration.update({ lastDate: '31.12.2025' }), /JJJJ-MM-TT/);
  assert.throws(() => calibration.update({ intervalMonths: 0 }), /1 bis 60/);
  assert.equal(calibration.update({ enabled: false }).state, 'off');
});

test('API: Plakette scannen, Vorschläge, Mehrfach anlegen, Kalibrierung im Prüfprotokoll', async () => {
  const secutest = new SecutestManager();
  const created = createApp({ secutest });
  let server;
  await new Promise((res) => (server = created.app.listen(0, '127.0.0.1', res)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'secutest', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  try {
    await call('POST', '/setup/begin', { name: 'Werkstatt', folder: path.join(dir, 'api'), usePassword: false, twoFactor: false });
    const meta = (await call('GET', '/meta')).body;
    assert.equal(meta.environments.length, 4);
    const d = (await call('POST', '/devices', { name: 'Kreissäge', serial_no: 'KS-99', usage_env: 'werkstatt' })).body;
    // Plaketten-Suche
    const tag = String(meta.db.uuid).replace(/-/g, '').slice(0, 8);
    const ok = await call('GET', `/devices/lookup?code=${encodeURIComponent(`${d.inventory_no} | Kreissäge | nächste Prüfung - | DB ${tag}`)}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.device.id, d.id);
    assert.equal((await call('GET', `/devices/lookup?code=KS-99`)).body.device.id, d.id, 'per Seriennummer');
    assert.equal((await call('GET', `/devices/lookup?code=${d.inventory_no.toLowerCase()}`)).body.device.id, d.id, 'Groß-/Kleinschreibung egal');
    const fremd = await call('GET', `/devices/lookup?code=${encodeURIComponent('G-9999 | X | nächste Prüfung - | DB deadbeef')}`);
    assert.equal(fremd.status, 404);
    assert.equal(fremd.body.code, 'OTHER_DB');
    assert.match((await call('GET', '/labels')).body, /<svg/);
    // Vorschläge
    const sg = (await call('POST', '/devices/interval-suggestions', { ids: [d.id] })).body[0];
    assert.equal(sg.env, 'werkstatt');
    assert.equal(sg.months, 6);
    assert.equal((await call('POST', '/devices/interval-suggestions', { ids: [], usage_env: 'baustelle' })).body[0].months, 3, 'Vorschlag für ein neues Gerät');
    // Mehrfach anlegen
    const many = await call('POST', `/devices/${d.id}/duplicate-many`, { count: 2 });
    assert.equal(many.status, 201);
    assert.equal(many.body.created.length, 2);
    // Kalibrierung → Protokoll
    const lastYear = new Date();
    lastYear.setMonth(lastYear.getMonth() - 3);
    const cal = await call('PUT', '/secutest/calibration', { enabled: true, lastDate: lastYear.toISOString().slice(0, 10), intervalMonths: 12, calibrationNo: '05' });
    assert.equal(cal.body.state, 'ok');
    assert.equal((await call('GET', '/meta')).body.calibration.state, 'ok');
    assert.match((await call('GET', '/secutest/calibration.ics')).body, /SUMMARY:Kalibrierung SECUTEST 0701S fällig/);
    const insp = await call('POST', '/inspections', { device_id: d.id, procedure: 'EDV', mode: 'manuell', measurements: [{ key: 'RSL', value: 0.1 }, { key: 'ISONDE', value: 0.01 }], checks: [{ group: 'sicht', item: 'gehaeuse', label: 'Gehäuse', passed: true }] });
    assert.equal(insp.status, 201, JSON.stringify(insp.body));
    assert.match(insp.body.inspection.meter_calibration, /Kalibrier-Nr\. 05/);
    assert.match((await call('GET', `/inspections/${insp.body.inspection.id}/report`)).body, /Kalibrier-Nr\. 05/);
    // Gerätedaten aus dem (simulierten) SECUTEST übernehmen
    assert.equal((await call('POST', '/secutest/calibration/from-device')).status, 409, 'ohne Verbindung');
    await call('POST', '/secutest/connect', { simulator: true });
    const fromDev = await call('POST', '/secutest/calibration/from-device');
    assert.equal(fromDev.status, 200);
    assert.equal(fromDev.body.deviceId, 'SIM-0001');
    await call('POST', '/secutest/disconnect');
    await call('PUT', '/secutest/calibration', { enabled: false });
  } finally {
    await secutest.disconnect().catch(() => {});
    created.sessions.closeAll('Testende');
    await new Promise((r) => server.close(r));
  }
});
