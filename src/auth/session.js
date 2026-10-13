'use strict';
/**
 * Anmeldung an einer Datenbank: Passwort (entschlüsselt die Datei) + TOTP-Code (2FA).
 * Es ist immer höchstens EINE Datenbank geöffnet. Nach Inaktivität wird automatisch gesperrt
 * (Datenbank geschlossen, Schlüssel aus dem Speicher entfernt).
 */
const crypto = require('crypto');
const { openDatabase, createDatabase } = require('../db/database');
const totp = require('./totp');
const repo = require('../db/repo');

const PENDING_TTL_MS = 5 * 60 * 1000;
const SETUP_TTL_MS = 15 * 60 * 1000;
const MAX_TOTP_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const COOKIE = 'secutest_sid';

const token = () => crypto.randomBytes(32).toString('hex');

class AuthError extends Error {
  constructor(message, status = 401, code = 'AUTH') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class SessionManager {
  constructor() {
    this.pending = new Map(); // token -> {dbEntry, sdb, expires, attempts}
    this.setups = new Map(); // token -> {file, password, name, settings, secret, expires}
    this.failures = new Map(); // file -> {count, until}
    this.active = null; // {sid, dbEntry, sdb, lastActivity}
    this.onUnlock = null;
    this.onLock = null;
    this.timer = setInterval(() => this._housekeeping(), 15 * 1000);
    this.timer.unref?.();
  }

  _housekeeping() {
    const now = Date.now();
    for (const [t, p] of this.pending) {
      if (p.expires < now) {
        this._closePending(t);
      }
    }
    for (const [t, s] of this.setups) if (s.expires < now) this.setups.delete(t);
    if (this.active) {
      const mins = repo.getSettings(this.active.sdb).autoLockMinutes || 15;
      if (now - this.active.lastActivity > mins * 60 * 1000) this.lock('Automatische Sperre nach Inaktivität');
    }
  }

  _closePending(t) {
    const p = this.pending.get(t);
    this.pending.delete(t);
    if (p && (!this.active || this.active.sdb !== p.sdb)) {
      try {
        p.sdb.close();
      } catch {
        /* egal */
      }
    }
  }

  _checkLockout(file) {
    const f = this.failures.get(file);
    if (f && f.until > Date.now()) {
      const s = Math.ceil((f.until - Date.now()) / 1000);
      throw new AuthError(`Zu viele Fehlversuche. Bitte ${s} Sekunden warten.`, 429, 'LOCKOUT');
    }
  }

  _fail(file) {
    const f = this.failures.get(file) || { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= MAX_TOTP_ATTEMPTS) {
      f.until = Date.now() + LOCKOUT_MS;
      f.count = 0;
    }
    this.failures.set(file, f);
  }

  // ------------------------------------------------------------------
  // Neue Datenbank: Schritt 1 (Daten + Passwort) -> Schritt 2 (2FA bestätigen)
  // ------------------------------------------------------------------
  beginSetup({ file, password, name, settings }) {
    const secret = totp.generateSecret();
    const t = token();
    this.setups.set(t, { file, password, name, settings, secret, expires: Date.now() + SETUP_TTL_MS });
    return { setupToken: t, secret, uri: totp.otpauthUri(secret, { account: name || 'Datenbank' }) };
  }

  /** Legt die Datenbank erst an, wenn der erste TOTP-Code korrekt ist. */
  finishSetup(setupToken, code) {
    const s = this.setups.get(setupToken);
    if (!s || s.expires < Date.now()) throw new AuthError('Einrichtung abgelaufen – bitte neu beginnen.', 410, 'SETUP_EXPIRED');
    const step = totp.verify(s.secret, code);
    if (step == null) throw new AuthError('Der Code aus der Authenticator-App ist falsch. Uhrzeit von PC und Handy prüfen.', 401, 'BAD_CODE');
    const sdb = createDatabase(s.file, s.password, { name: s.name, settings: s.settings });
    const recovery = totp.generateRecoveryCodes();
    sdb.setMeta('totp_secret', s.secret);
    sdb.setMeta('totp_last_step', String(step));
    sdb.setJson('recovery_codes', recovery.map(totp.hashRecoveryCode));
    repo.audit(sdb, 'datenbank-angelegt', 'db', null, s.name);
    this.setups.delete(setupToken);
    return { sdb, recovery, file: sdb.file };
  }

  // ------------------------------------------------------------------
  // Anmelden: Passwort -> 2FA
  // ------------------------------------------------------------------
  unlockPassword(dbEntry, password, { force = false } = {}) {
    this._checkLockout(dbEntry.path);
    let sdb;
    try {
      sdb = openDatabase(dbEntry.path, password, { force });
    } catch (e) {
      if (e.code === 'WRONG_PASSWORD') {
        this._fail(dbEntry.path);
        throw new AuthError(e.message, 401, 'WRONG_PASSWORD');
      }
      if (e.code === 'LOCKED') throw Object.assign(new AuthError(e.message, 423, 'LOCKED'), { lock: e.lock });
      throw e;
    }
    if (!sdb.getMeta('totp_secret')) {
      sdb.close();
      throw new AuthError('Für diese Datenbank ist keine Zwei-Faktor-Anmeldung eingerichtet (Datei beschädigt?).', 500, 'NO_2FA');
    }
    const t = token();
    this.pending.set(t, { dbEntry, sdb, expires: Date.now() + PENDING_TTL_MS, attempts: 0 });
    return { pendingToken: t, name: sdb.getMeta('db_name') };
  }

  unlockTotp(pendingToken, { code, recoveryCode }) {
    const p = this.pending.get(pendingToken);
    if (!p || p.expires < Date.now()) throw new AuthError('Anmeldung abgelaufen – bitte Passwort erneut eingeben.', 410, 'PENDING_EXPIRED');
    this._checkLockout(p.dbEntry.path);
    const sdb = p.sdb;
    let ok = false;
    let usedRecovery = false;
    if (recoveryCode) {
      const stored = sdb.getJson('recovery_codes', []);
      const idx = totp.matchRecoveryCode(recoveryCode, stored);
      if (idx >= 0) {
        stored.splice(idx, 1);
        sdb.setJson('recovery_codes', stored);
        ok = true;
        usedRecovery = true;
        repo.audit(sdb, 'anmeldung-wiederherstellungscode', 'db', null, `${stored.length} Codes verbleibend`);
      }
    } else {
      const step = totp.verify(sdb.getMeta('totp_secret'), code, { lastStep: Number(sdb.getMeta('totp_last_step', '-1')) });
      if (step != null) {
        sdb.setMeta('totp_last_step', String(step));
        ok = true;
      }
    }
    if (!ok) {
      p.attempts += 1;
      this._fail(p.dbEntry.path);
      if (p.attempts >= MAX_TOTP_ATTEMPTS) {
        this._closePending(pendingToken);
        throw new AuthError('Zu viele falsche Codes – Anmeldung abgebrochen.', 429, 'LOCKOUT');
      }
      throw new AuthError(recoveryCode ? 'Wiederherstellungscode ungültig oder bereits benutzt.' : 'Code falsch oder bereits verwendet. Nächsten Code abwarten.', 401, 'BAD_CODE');
    }
    this.pending.delete(pendingToken);
    this.failures.delete(p.dbEntry.path);
    return this._activate(p.dbEntry, sdb, { usedRecovery, remainingRecovery: sdb.getJson('recovery_codes', []).length });
  }

  _activate(dbEntry, sdb, extra = {}) {
    if (this.active && this.active.sdb !== sdb) this.lock('Andere Datenbank geöffnet');
    const sid = token();
    this.active = { sid, dbEntry, sdb, lastActivity: Date.now() };
    repo.audit(sdb, 'anmeldung', 'db', null, require('os').hostname());
    if (this.onUnlock) this.onUnlock(this.active);
    return { sid, ...extra };
  }

  /** Nach dem Anlegen direkt angemeldet */
  activateNew(dbEntry, sdb) {
    return this._activate(dbEntry, sdb);
  }

  lock(reason = 'Gesperrt') {
    if (!this.active) return;
    const a = this.active;
    this.active = null;
    try {
      repo.audit(a.sdb, 'abmeldung', 'db', null, reason);
    } catch {
      /* egal */
    }
    try {
      a.sdb.close();
    } catch {
      /* egal */
    }
    if (this.onLock) this.onLock(reason);
  }

  /** Express-Middleware */
  require() {
    return (req, res, next) => {
      const sid = readCookie(req, COOKIE);
      if (!this.active || !sid || !safeEqual(sid, this.active.sid)) {
        return res.status(401).json({ error: 'Nicht angemeldet oder Sitzung gesperrt.', code: 'LOCKED_OUT' });
      }
      this.active.lastActivity = Date.now();
      req.sdb = this.active.sdb;
      req.dbEntry = this.active.dbEntry;
      next();
    };
  }

  isAuthed(req) {
    const sid = readCookie(req, COOKIE);
    return !!(this.active && sid && safeEqual(sid, this.active.sid));
  }

  /** Erneute Bestätigung für kritische Aktionen (Passwort ändern, 2FA neu, …) */
  reauth(sdb, { code }) {
    const step = totp.verify(sdb.getMeta('totp_secret'), code, { lastStep: Number(sdb.getMeta('totp_last_step', '-1')) });
    if (step == null) throw new AuthError('Authenticator-Code falsch.', 401, 'BAD_CODE');
    sdb.setMeta('totp_last_step', String(step));
  }
}

function readCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function setSessionCookie(res, sid) {
  res.setHeader('Set-Cookie', `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

module.exports = { SessionManager, AuthError, setSessionCookie, clearSessionCookie, COOKIE };
