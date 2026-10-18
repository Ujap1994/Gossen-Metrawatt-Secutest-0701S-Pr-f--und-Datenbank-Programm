'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checksum, buildCommand, parseLine, parseWer, parseMes, parsePro, parseNumber, parseIdn, convertUnit } = require('../src/secutest/protocol');

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

test('Antworten des echten Geräts (SECUTEST S, Adresse „x“, Quittung mit Punkt, Werte mit Einheit)', () => {
  assert.deepEqual(['.Yx$23', '.Nx$18', '.Ex$0F'].map((l) => [parseLine(l).type, parseLine(l).checksumOk, parseLine(l).address]), [
    ['ack', true, null],
    ['nak', true, null],
    ['error', true, null],
  ]);
  const idn = parseLine('IDNx=x;GMN;SecuTest S;GTM5015000R0001;18. Juli 1994  16:49:31;\xff\xff\xff\xff\xff\xff\xff\xff;00$EF');
  assert.equal(idn.checksumOk, true);
  assert.equal(idn.operation, 'IDN');
  assert.deepEqual([parseIdn(idn.params).address, parseIdn(idn.params).deviceId, parseIdn(idn.params).model], [null, null, 'SecuTest S']);
  const wer = parseLine('WERTEx=19:>310.0M\xea;20:>310.0M\xea;21:>310.0M\xea;96:0538.V$20');
  assert.equal(wer.checksumOk, true);
  const v = parseWer(wer.params);
  assert.deepEqual(v[21], { text: '>310.0', value: 310, qualifier: '>', unit: 'MΩ' });
  assert.deepEqual(v[96], { text: '0538.', value: 538, qualifier: null, unit: 'V' });
  assert.deepEqual(parseWer('28:00.18mA;12:----.\xea'), { 28: { text: '00.18', value: 0.18, qualifier: null, unit: 'mA' }, 12: { text: '----.', value: null, qualifier: null, unit: 'Ω' } });
});

test('„PRF“ (Protokoll fertig), Arbeit „xJ“ = kWh, Geräte-ID im Protokoll', () => {
  const prf = parseLine('PRFx$84');
  assert.deepEqual([prf.type, prf.checksumOk], ['event', true]);
  assert.deepEqual(parseNumber('0.000xJ'), { text: '0.000', value: 0, qualifier: null, unit: 'kWh' });
  assert.equal(convertUnit(0.012, 'kWh', 'Wh'), 12);
  assert.equal(parsePro('\xff\xff\xff\xff\xff\xff\xff\xff;0600210000050000;>310.0;>02.00;0538;>0500;00.21;>0000').deviceId, '');
});

test('Einheiten umrechnen (Gerät → Messgröße)', () => {
  assert.equal(convertUnit(250, 'kΩ', 'MΩ'), 0.25);
  assert.equal(convertUnit(190, 'µA', 'mA'), 0.19);
  assert.equal(convertUnit(0.18, 'mA', 'mA'), 0.18);
  assert.equal(convertUnit(5, 'V', 'mA'), null);
  assert.equal(convertUnit(1, 'xJ', 'Wh'), null);
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
