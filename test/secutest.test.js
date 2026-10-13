'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SecutestDriver } = require('../src/secutest/driver');

test('Treiber ↔ Simulator: Identifikation, Remote-Messung, gerätegeführter Ablauf, PRO?', async () => {
  const d = new SecutestDriver({ settleMs: 5 });
  await d.connect({ simulator: true, scenario: 'sk1-ok', simulatorOptions: { latencyMs: 2, stepMs: 60 } });
  assert.equal(d.identity.manufacturer, 'GMN');
  await d.setRemote(true);
  assert.equal(await d.startMeasurement(4), true, 'Schutzleiter erkannt');
  await d.startMeasurement(8);
  const v = await d.getValues([12, 13, 14, 15]);
  assert.ok(v[15].value > 0.05 && v[15].value < 0.2);
  await d.setRemote(false);
  await d.setSwitch('AUTO');
  await d.pressKey('ENTER');
  await new Promise((r) => setTimeout(r, 400));
  const pro = await d.readProtocol();
  assert.equal(pro.classification.protectionClass, 'SK I');
  assert.deepEqual(pro.measurements.map((m) => m.key), ['RSL', 'RISO', 'UISO', 'IEA']);
  assert.equal(pro.verdict, 'bestanden');
  await assert.rejects(d.send('XYZ!1'), (e) => e.code === 'NAK');
  await d.disconnect();
  assert.equal(d.connected, false);
});

test('Simulator-Szenario mit Isolationsfehler', async () => {
  const d = new SecutestDriver({ settleMs: 5 });
  await d.connect({ simulator: true, scenario: 'sk1-riso', simulatorOptions: { latencyMs: 2 } });
  await d.setRemote(true);
  await d.startMeasurement(16);
  const v = await d.getValues([21, 96]);
  assert.ok(v[21].value < 0.5);
  assert.ok(v[96].value > 500);
  await d.disconnect();
});

test('Timeout ohne Gerät', async () => {
  const d = new SecutestDriver({ timeoutMs: 100, settleMs: 1 });
  await d.connect({ simulator: true, simulatorOptions: { latencyMs: 1 } });
  d.port.isOpen = false; // Simulator "stumm schalten"
  await assert.rejects(d.send('IDN?'), (e) => e.code === 'TIMEOUT');
  d.port.isOpen = true;
  await d.disconnect();
});
