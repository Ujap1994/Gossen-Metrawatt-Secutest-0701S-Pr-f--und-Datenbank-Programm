'use strict';
/**
 * Anmeldung an einer Datenbank: Passwort (entschlüsselt die Datei) und TOTP-Code (2FA) –
 * beides optional und je Datenbank in den Einstellungen ein- und ausschaltbar.
 * Es ist immer höchstens EINE Datenbank geöffnet. Nach Inaktivität wird automatisch gesperrt
 * (Datenbank geschlossen, Schlüssel aus dem Speicher entfernt).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDatabase, createDatabase, verifyPassword, moveBackups, DbError } = require('../db/database');
const config = require('../config');
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
  /** Neue Datenbank ohne Zwei-Faktor-Anmeldung: sofort anlegen. */
  createWithout2fa({ file, password, name, settings }) {
    const sdb = createDatabase(file, password || null, { name, settings });
    repo.audit(sdb, 'datenbank-angelegt', 'db', null, `${name}${password ? '' : ' (ohne Passwort)'}, ohne 2FA`);
    return { sdb, file: sdb.file };
  }

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
    const sdb = createDatabase(s.file, s.password || null, { name: s.name, settings: s.settings });
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
      if (e.code === 'PASSWORD_REQUIRED') throw new AuthError(e.message, 401, 'PASSWORD_REQUIRED');
      if (e.code === 'LOCKED') throw Object.assign(new AuthError(e.message, 423, 'LOCKED'), { lock: e.lock });
      throw e;
    }
    // Ohne Zwei-Faktor-Anmeldung ist man nach dem Passwort (bzw. sofort) angemeldet
    if (!sdb.getMeta('totp_secret')) {
      this.failures.delete(dbEntry.path);
      return { name: sdb.getMeta('db_name'), ...this._activate(dbEntry, sdb) };
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

  /** Welche Schutzmechanismen sind für die Datenbank aktiv? */
  static security(sdb) {
    return { encrypted: !!sdb.encrypted, twoFactor: !!sdb.getMeta('totp_secret'), recoveryRemaining: sdb.getJson('recovery_codes', []).length };
  }

  /**
   * Erneute Bestätigung für kritische Aktionen (Passwort ändern, 2FA ändern, verschieben …):
   * mit 2FA → Code aus der App (oder Wiederherstellungscode), sonst mit Passwort → aktuelles Passwort,
   * sonst ohne Abfrage.
   */
  reauth(sdb, { code, recoveryCode, password } = {}) {
    const f = sdb.file;
    this._checkLockout(f);
    if (sdb.getMeta('totp_secret') && recoveryCode) {
      // Handy verloren: Wiederherstellungscode statt App-Code (wird verbraucht)
      const stored = sdb.getJson('recovery_codes', []);
      const idx = totp.matchRecoveryCode(recoveryCode, stored);
      if (idx < 0) {
        this._fail(f);
        throw new AuthError('Wiederherstellungscode ungültig oder bereits benutzt.', 401, 'BAD_CODE');
      }
      stored.splice(idx, 1);
      sdb.setJson('recovery_codes', stored);
      repo.audit(sdb, 'bestaetigung-wiederherstellungscode', 'db', null, `${stored.length} Codes verbleibend`);
    } else if (sdb.getMeta('totp_secret')) {
      const step = totp.verify(sdb.getMeta('totp_secret'), code, { lastStep: Number(sdb.getMeta('totp_last_step', '-1')) });
      if (step == null) {
        this._fail(f);
        throw new AuthError('Authenticator-Code falsch.', 401, 'BAD_CODE');
      }
      sdb.setMeta('totp_last_step', String(step));
    } else if (sdb.encrypted) {
      try {
        verifyPassword(f, String(password || ''));
      } catch (e) {
        this._fail(f);
        throw new AuthError('Das aktuelle Passwort ist falsch.', 401, 'WRONG_PASSWORD');
      }
    }
  }

  /**
   * Geöffnete Datenbank an einen anderen Ort verschieben (z. B. lokal ↔ OneDrive/iCloud).
   * Ablauf: Sicherung → Kopie am Ziel → Kopie öffnen und prüfen → Original entfernen.
   * Die Anmeldung bleibt bestehen.
   */
  moveActive({ folder, password, withBackups = true }) {
    const a = this.active;
    if (!a) throw new AuthError('Keine Datenbank geöffnet.', 401);
    const dir = String(folder || '').trim();
    if (!dir || !path.isAbsolute(dir)) throw new DbError('BAD_INPUT', 'Bitte einen absoluten Zielordner angeben.');
    const source = a.sdb.file;
    if (config.samePath(path.dirname(source), dir)) throw new DbError('BAD_INPUT', 'Die Datenbank liegt bereits in diesem Ordner.');
    const target = path.join(dir, path.basename(source));
    if (fs.existsSync(target)) throw new DbError('EXISTS', `Im Zielordner gibt es bereits eine Datei „${path.basename(target)}“.`);
    const pw = a.sdb.encrypted ? String(password || '') : null;
    if (pw) verifyPassword(source, pw); // für das Öffnen der Kopie nötig (Schlüssel wird nicht gespeichert)
    else if (a.sdb.encrypted) throw new AuthError('Zum Verschieben bitte das Passwort der Datenbank eingeben.', 401, 'PASSWORD_REQUIRED');
    fs.mkdirSync(dir, { recursive: true });
    a.sdb.backup('vor-verschieben');
    repo.audit(a.sdb, 'datenbank-verschoben', 'db', null, `${source} → ${target}`);
    a.sdb.close();
    let moved;
    try {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      moved = openDatabase(target, pw, { force: true });
      const check = moved.db.pragma('quick_check', { simple: true });
      if (check !== 'ok') throw new DbError('COPY_FAILED', `Die Kopie ist fehlerhaft (${check}).`);
    } catch (e) {
      try {
        moved?.close();
      } catch {
        /* egal */
      }
      fs.rmSync(target, { force: true });
      // Original wieder öffnen, damit die Sitzung weiterläuft – klappt das nicht, sauber sperren
      try {
        a.sdb = openDatabase(source, pw, { force: true });
      } catch {
        this.active = null;
        if (this.onLock) this.onLock('Verschieben fehlgeschlagen');
      }
      throw e;
    }
    fs.rmSync(source, { force: true });
    let backups = 0;
    if (withBackups) {
      try {
        backups = moveBackups(source, target);
      } catch {
        /* Sicherungen bleiben dann am alten Ort */
      }
    }
    let entry = a.dbEntry;
    config.update((cfg) => {
      const e = cfg.databases.find((d) => d.id === entry.id);
      if (e) {
        e.path = path.resolve(target);
        entry = e;
      }
    });
    a.sdb = moved;
    a.dbEntry = { ...entry, path: path.resolve(target) };
    a.lastActivity = Date.now();
    if (this.onUnlock) this.onUnlock(a);
    return { file: target, backups };
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
