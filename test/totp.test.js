'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../src/auth/totp');

// RFC 6238 Anhang B: Secret "12345678901234567890" (ASCII), SHA1
const SECRET = totp.base32Encode(Buffer.from('12345678901234567890'));

test('RFC-6238-Testvektoren (6 Stellen)', () => {
  assert.equal(totp.totp(SECRET, 59 * 1000), '287082');
  assert.equal(totp.totp(SECRET, 1111111109 * 1000), '081804');
  assert.equal(totp.totp(SECRET, 1234567890 * 1000), '005924');
  assert.equal(totp.totp(SECRET, 2000000000 * 1000), '279037');
});

test('Base32 hin und zurück', () => {
  const buf = Buffer.from('Secutest 0701S äöü');
  assert.deepEqual(totp.base32Decode(totp.base32Encode(buf)), buf);
});

test('Verifikation mit Zeitfenster und Replay-Schutz', () => {
  const s = totp.generateSecret();
  const now = Date.now();
  const code = totp.totp(s, now);
  const step = totp.verify(s, code, { now });
  assert.equal(typeof step, 'number');
  assert.equal(totp.verify(s, code, { now, lastStep: step }), null, 'gleicher Code darf nicht zweimal gelten');
  assert.notEqual(totp.verify(s, totp.totp(s, now - 30000), { now }), null, 'vorheriges Fenster wird toleriert');
  assert.equal(totp.verify(s, totp.totp(s, now - 120000), { now }), null, 'alter Code wird abgelehnt');
  assert.equal(totp.verify(s, '12345', { now }), null);
});

test('otpauth-URI für Authenticator-Apps', () => {
  const uri = totp.otpauthUri('ABC', { account: 'Meine Geräte' });
  assert.match(uri, /^otpauth:\/\/totp\/Secutest%20Pr%C3%BCfmanager%3AMeine%20Ger%C3%A4te\?secret=ABC&issuer=/);
});

test('Wiederherstellungscodes', () => {
  const codes = totp.generateRecoveryCodes(3);
  const hashes = codes.map(totp.hashRecoveryCode);
  assert.equal(totp.matchRecoveryCode(codes[1].toLowerCase(), hashes), 1);
  assert.equal(totp.matchRecoveryCode('00000-00000', hashes), -1);
});
