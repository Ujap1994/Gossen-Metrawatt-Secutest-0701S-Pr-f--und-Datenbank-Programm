'use strict';
/**
 * Zwei-Faktor-Anmeldung per TOTP (RFC 6238, HMAC-SHA1, 6 Stellen, 30 s).
 * Offener Standard – funktioniert offline und kostenlos mit Bitwarden Authenticator,
 * Microsoft Authenticator, Google Authenticator, Aegis, 2FAS, Authy …
 */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

function timeStep(now = Date.now(), period = 30) {
  return Math.floor(now / 1000 / period);
}

function totp(secret, now = Date.now()) {
  return hotp(secret, timeStep(now));
}

/**
 * Prüft einen Code mit ±1 Zeitfenster Toleranz.
 * lastStep verhindert, dass derselbe Code zweimal verwendet wird (Replay-Schutz).
 * @returns {number|null} verwendeter Zeitschritt oder null
 */
function verify(secret, code, { now = Date.now(), window = 1, lastStep = -1 } = {}) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const step = timeStep(now);
  for (let w = -window; w <= window; w++) {
    const s = step + w;
    if (s <= lastStep) continue;
    const expected = hotp(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return s;
  }
  return null;
}

/** otpauth://-URI für den QR-Code */
function otpauthUri(secret, { issuer = 'Secutest Prüfmanager', account = 'Datenbank' } = {}) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------------- Wiederherstellungscodes ----------------
function generateRecoveryCodes(n = 10) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

function hashRecoveryCode(code) {
  const salt = crypto.randomBytes(16);
  const norm = String(code).toUpperCase().replace(/[^0-9A-F]/g, '');
  const hash = crypto.scryptSync(norm, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function matchRecoveryCode(code, stored) {
  const norm = String(code).toUpperCase().replace(/[^0-9A-F]/g, '');
  if (norm.length !== 10) return -1;
  for (let i = 0; i < stored.length; i++) {
    const [saltHex, hashHex] = String(stored[i]).split(':');
    const h = crypto.scryptSync(norm, Buffer.from(saltHex, 'hex'), 32);
    if (crypto.timingSafeEqual(h, Buffer.from(hashHex, 'hex'))) return i;
  }
  return -1;
}

module.exports = { base32Encode, base32Decode, generateSecret, hotp, totp, verify, timeStep, otpauthUri, generateRecoveryCodes, hashRecoveryCode, matchRecoveryCode };
