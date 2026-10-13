'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { limitsFor, displayLimit } = require('../src/vde/limits');
const { autoModeCheck, applicableProcedures, buildProcedure, suggestDeviceType } = require('../src/vde/procedures');
const { evaluateInspection, parseValue } = require('../src/vde/evaluate');

const sk1 = { protection_class: 'SK I', device_type: 'standard', connection_type: 'plug', phases: 1, name: 'Bohrmaschine' };

test('Grenzwerte aktuelle Norm je Schutzklasse', () => {
  const l1 = limitsFor(sk1);
  assert.equal(l1.RSL.value, 0.3);
  assert.equal(l1.RISO.value, 1.0);
  assert.equal(l1.IEA.value, 3.5);
  const l2 = limitsFor({ ...sk1, protection_class: 'SK II' });
  assert.equal(l2.RSL, undefined);
  assert.equal(l2.RISO.value, 2.0);
  assert.equal(l2.IB.value, 0.5);
  assert.equal(limitsFor({ ...sk1, protection_class: 'SK III' }).RISO.value, 0.25);
});

test('R_SL-Grenzwert wächst mit der Leitungslänge (max. 1 Ω)', () => {
  assert.equal(limitsFor({ ...sk1, cable_length_m: 5 }).RSL.value, 0.3);
  assert.equal(limitsFor({ ...sk1, cable_length_m: 12.5 }).RSL.value, 0.4);
  assert.equal(limitsFor({ ...sk1, cable_length_m: 25 }).RSL.value, 0.6);
  assert.equal(limitsFor({ ...sk1, cable_length_m: 100 }).RSL.value, 1.0);
  // altes Profil 0701: je 5 m
  assert.equal(limitsFor({ ...sk1, cable_length_m: 15 }, { profile: 'secutest-1997', standard: 'VDE 0701' }).RSL.value, 0.5);
});

test('Heizgeräte: R_ISO 0,3 MΩ und 1 mA/kW (max. 10 mA)', () => {
  const l = limitsFor({ ...sk1, device_type: 'heating', heating_power_kw: 6 });
  assert.equal(l.RISO.value, 0.3);
  assert.equal(l.IEA.value, 6);
  assert.equal(limitsFor({ ...sk1, device_type: 'heating', heating_power_kw: 18 }).IEA.value, 10);
  const old = limitsFor({ ...sk1, device_type: 'heating', heating_power_kw: 6 }, { profile: 'secutest-1997' });
  assert.equal(old.IEA.value, 15);
  assert.equal(old.RISO.value, 0.5);
});

test('Gebrauchsfehler-Tabelle aus dem Anhang', () => {
  assert.equal(displayLimit('RSL', 0.3), 0.275);
  assert.equal(displayLimit('RISO', 1.0), 1.06);
  assert.equal(displayLimit('IEA', 3.5), 3.23);
  assert.ok(displayLimit('RISO', 1.5) > 1.06 && displayLimit('RISO', 1.5) < 2.2);
});

test('Auto-Modus gesperrt für EDV/Büro, SK III, Leitungen und Festanschluss', () => {
  assert.equal(autoModeCheck(sk1).allowed, true);
  for (const name of ['Monitor Dell U2415', 'PC Tower', 'Laserdrucker HP', 'Notebook-Netzteil Laptop']) {
    const r = autoModeCheck({ ...sk1, name });
    assert.equal(r.allowed, false, name);
    assert.equal(r.alternative, 'EDV');
  }
  assert.equal(autoModeCheck({ ...sk1, device_type: 'it' }).alternative, 'EDV');
  assert.equal(autoModeCheck({ ...sk1, protection_class: 'SK III' }).alternative, 'SK3');
  assert.equal(autoModeCheck({ ...sk1, device_type: 'extension' }).alternative, 'VL');
  assert.throws(() => buildProcedure('AUTO', { ...sk1, name: 'Monitor' }), (e) => e.code === 'AUTO_NOT_ALLOWED');
  const ap = applicableProcedures({ ...sk1, name: 'Monitor' });
  assert.equal(ap.recommended, 'EDV');
  assert.equal(ap.procedures.find((p) => p.id === 'AUTO').disabled, true);
});

test('Geräteart-Vorschlag', () => {
  assert.equal(suggestDeviceType({ name: 'Wasserkocher' }), 'heating');
  assert.equal(suggestDeviceType({ name: 'Kabeltrommel 25 m' }), 'extension');
  assert.equal(suggestDeviceType({ name: 'Fernseher Wohnzimmer' }), 'electronic');
  assert.equal(suggestDeviceType({ name: 'Bohrmaschine' }), null);
});

test('Jede Prozedur liefert Schritte mit Grafik-Szene', () => {
  for (const [id, dev] of [['SK1', sk1], ['SK2', { ...sk1, protection_class: 'SK II' }], ['SK3', { ...sk1, protection_class: 'SK III' }], ['EDV', { ...sk1, device_type: 'it' }], ['VL', { ...sk1, device_type: 'extension' }], ['FEST', { ...sk1, connection_type: 'fixed' }], ['AUTO', sk1]]) {
    const p = buildProcedure(id, dev);
    assert.ok(p.steps.length >= 4, id);
    for (const s of p.steps) assert.ok(s.scene && s.scene.switchPos, `${id}/${s.id} braucht eine Szene`);
    assert.equal(p.steps.at(-1).type, 'result');
  }
});

test('Bewertung: bestanden / nicht bestanden / fehlende Werte', () => {
  const ok = evaluateInspection({
    device: sk1,
    procedureId: 'SK1',
    measurements: [{ key: 'RSL', value: 0.1 }, { key: 'RISO', valueText: '>310.0' }, { key: 'IEA', value: 0.4 }],
    checks: [{ group: 'sicht', item: 'gehaeuse', passed: true }],
  });
  assert.equal(ok.passed, true, ok.failures.join('; '));
  const bad = evaluateInspection({ device: sk1, procedureId: 'SK1', measurements: [{ key: 'RSL', value: 0.45 }, { key: 'RISO', value: 0.8 }, { key: 'IEA', value: 4 }], checks: [{ group: 'sicht', item: 'gehaeuse', passed: true }] });
  assert.equal(bad.passed, false);
  assert.equal(bad.failures.length, 3);
  const missing = evaluateInspection({ device: sk1, procedureId: 'SK1', measurements: [{ key: 'RSL', value: 0.1 }], checks: [{ group: 'sicht', item: 'x', passed: true }] });
  assert.ok(missing.failures.some((f) => f.includes('Messwert fehlt')));
  const skipped = evaluateInspection({ device: sk1, procedureId: 'SK1', measurements: [{ key: 'RSL', value: 0.1 }, { key: 'RISO', value: 50 }], checks: [{ group: 'sicht', item: 'x', passed: true }], skipped: [{ step: 'iea', reason: 'Test' }] });
  assert.equal(skipped.passed, true);
  const visualFail = evaluateInspection({ device: sk1, procedureId: 'SK1', measurements: [{ key: 'RSL', value: 0.1 }, { key: 'RISO', value: 50 }, { key: 'IEA', value: 1 }], checks: [{ group: 'sicht', item: 'kabel', label: 'Leitung', passed: false }] });
  assert.equal(visualFail.passed, false);
});

test('Anzeigewerte mit Gebrauchsfehler bewerten', () => {
  const r = evaluateInspection({ device: sk1, procedureId: 'SK1', measurements: [{ key: 'RSL', value: 0.29, display: true }] });
  assert.equal(r.measurements[0].passed, 0, '0,29 Ω Anzeige > 0,275 Ω zulässiger Anzeigewert');
  const r2 = evaluateInspection({ device: sk1, procedureId: 'SK1', measurements: [{ key: 'RSL', value: 0.29 }] });
  assert.equal(r2.measurements[0].passed, 1);
});

test('Profil 1997: kleiner R_ISO bei Heizgerät durch bestandenen I_EA ausgeglichen', () => {
  const heat = { ...sk1, device_type: 'heating', heating_power_kw: 2 };
  const r = evaluateInspection({ device: heat, procedureId: 'SK1', profile: 'secutest-1997', measurements: [{ key: 'RSL', value: 0.1 }, { key: 'RISO', value: 0.3 }, { key: 'IEA', value: 2 }], checks: [{ group: 'sicht', item: 'x', passed: true }] });
  assert.equal(r.passed, true, r.failures.join('; '));
});

test('Werte mit Vergleichszeichen', () => {
  assert.deepEqual(parseValue('>310,0'), { value: 310, qualifier: '>', text: '>310,0' });
  assert.equal(parseValue('---.-').value, null);
});
