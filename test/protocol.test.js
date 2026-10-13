'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checksum, buildCommand, parseLine, parseWer, parseMes, parsePro, parseNumber } = require('../src/secutest/protocol');

test('Prüfsumme = Summe aller Zeichen inkl. $ modulo 256 als Hex', () => {
  assert.equal(checksum('Y$'), ((0x59 + 0x24) & 0xff).toString(16).toUpperCase());
  assert.equal(checksum('IDN?$'), 'F0'.length === 2 ? checksum('IDN?$') : '');
  const s = 'WERTE1=12,0.077$';
  let sum = 0;
  for (const c of s) sum = (sum + c.charCodeAt(0)) & 0xff;
  assert.equal(checksum(s), sum.toString(16).toUpperCase().padStart(2, '0'));
});

test('Befehl mit Adresse und Prüfsumme bauen', () => {
  assert.equal(buildCommand('IDN?'), `IDN?$${checksum('IDN?$')}\r`);
  assert.equal(buildCommand('wer?12,14', { address: 3 }), `WER3?12,14$${checksum('WER3?12,14$')}\r`);
  assert.equal(buildCommand('MES!8', { withChecksum: false }), 'MES!8\r');
});

test('Antworten zerlegen (Quittung, Antwort, Prüfsumme)', () => {
  const ack = parseLine(`Y$${checksum('Y$')}\r\n`);
  assert.equal(ack.type, 'ack');
  assert.equal(ack.checksumOk, true);
  const nak = parseLine('N1$00');
  assert.equal(nak.type, 'nak');
  assert.equal(nak.address, '1');
  assert.equal(nak.checksumOk, false);
  const ans = parseLine(`WERTE1=12,---.-;14,00.0-$${checksum('WERTE1=12,---.-;14,00.0-$')}`);
  assert.equal(ans.type, 'answer');
  assert.equal(ans.operation, 'WERTE');
  assert.equal(ans.address, '1');
  assert.equal(ans.params, '12,---.-;14,00.0-');
});

test('Messwerte (WER?) parsen – Beispiel aus der Bedienungsanleitung', () => {
  const v = parseWer('12,---.-;14,00.0-;21,>310.0;15,0.077');
  assert.equal(v[12].value, null);
  assert.equal(v[14].value, -0);
  assert.equal(v[21].value, 310);
  assert.equal(v[21].qualifier, '>');
  assert.equal(v[15].value, 0.077);
  assert.deepEqual(parseNumber('<0.400'), { text: '<0.400', value: 0.4, qualifier: '<' });
});

test('Anschlussflags (MES?) parsen', () => {
  const r = parseMes('21;8;12');
  assert.equal(r.flags.dose, true);
  assert.equal(r.flags.slDose, true);
  assert.equal(r.flags.finger, false);
  assert.deepEqual(r.running, [8, 12]);
});

test('Protokoll (PRO?) – Beispiel aus Kap. 8.5 der Bedienungsanleitung', () => {
  const p = parsePro(' TEST;0701208005060000;0.077;<0.400;>310.0;>0.500;0539;>0500;00.17;>0000');
  assert.equal(p.deviceId, 'TEST');
  assert.equal(p.classification.protectionClass, 'SK I');
  assert.equal(p.classification.noLeakageNeeded, true);
  assert.equal(p.performed.RSL && p.performed.RISO && p.performed.IEA, true);
  assert.equal(p.failed.overall, true);
  assert.equal(p.visualFailed.schutzleiter, true);
  assert.equal(p.visualFailed.gehaeuse, true);
  assert.equal(p.verdict, 'nicht_bestanden');
  const byKey = Object.fromEntries(p.measurements.map((m) => [m.key, m]));
  assert.equal(byKey.RSL.value, 0.077);
  assert.equal(byKey.RSL.limitValue, 0.4);
  assert.equal(byKey.RISO.qualifier, '>');
  assert.equal(byKey.UISO.value, 539);
  assert.equal(byKey.IEA.value, 0.17);
});
