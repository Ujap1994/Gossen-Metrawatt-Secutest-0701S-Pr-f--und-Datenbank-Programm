'use strict';
/**
 * SQLite-Datenbank, wahlweise verschlüsselt (SQLCipher-kompatibel, AES-256, PBKDF2-HMAC-SHA512)
 * oder – auf ausdrücklichen Wunsch – ohne Passwort. Die Verschlüsselung lässt sich jederzeit
 * nachträglich ein- und ausschalten (PRAGMA rekey).
 *
 * Eine Datei = ein Mandant (z. B. „Meine Geräte“, „Familie Müller“).
 * Die Datei kann in OneDrive / iCloud Drive liegen:
 *  - journal_mode = DELETE (keine -wal/-shm-Dateien, die der Sync zerreißen könnte)
 *  - Sperrdatei <datei>.lock warnt, wenn die DB auf einem anderen Rechner geöffnet ist
 *  - automatische Sicherungen im Unterordner „Sicherungen“
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3-multiple-ciphers');
const { MIGRATIONS, SCHEMA_VERSION } = require('./schema');
const { DB_EXTENSION } = require('../config');

const MIN_PASSWORD_LENGTH = 8;
const LOCK_STALE_MS = 3 * 60 * 1000; // Sperre gilt als verwaist, wenn > 3 min kein Lebenszeichen
const LOCK_HEARTBEAT_MS = 60 * 1000;
const MAX_BACKUPS = 15;

class DbError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

function cipherConfig(db) {
  db.pragma("cipher='sqlcipher'");
  db.pragma('legacy=4');
}

function applyKey(db, password) {
  cipherConfig(db);
  db.key(Buffer.from(String(password), 'utf8'));
}

/** Unverschlüsselte SQLite-Dateien beginnen mit „SQLite format 3\0“, verschlüsselte sehen zufällig aus. */
function isEncryptedFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    return !(n === 16 && buf.equals(SQLITE_HEADER));
  } catch {
    return true;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) {
    throw new DbError('WEAK_PASSWORD', `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
  }
}

function configure(db) {
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON');
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  let version = row ? Number(row.value) : 0;
  if (version > SCHEMA_VERSION) {
    throw new DbError('NEWER_SCHEMA', 'Diese Datenbank wurde mit einer neueren Programmversion erstellt. Bitte Programm aktualisieren.');
  }
  while (version < SCHEMA_VERSION) {
    const sql = MIGRATIONS[version];
    db.transaction(() => {
      db.exec(sql);
      version += 1;
      db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(version));
    })();
  }
}

// ---------------------------------------------------------------------------
// Sperrdatei (Lock) – wichtig bei Cloud-Sync über mehrere Rechner
// ---------------------------------------------------------------------------
function lockPath(file) {
  return file + '.lock';
}

function readLock(file) {
  try {
    const info = JSON.parse(fs.readFileSync(lockPath(file), 'utf8'));
    const age = Date.now() - new Date(info.heartbeat || info.since).getTime();
    return { ...info, stale: !(age < LOCK_STALE_MS), mine: info.host === os.hostname() && info.pid === process.pid };
  } catch {
    return null;
  }
}

function writeLock(file, since) {
  const info = { host: os.hostname(), user: os.userInfo().username, pid: process.pid, since, heartbeat: new Date().toISOString() };
  fs.writeFileSync(lockPath(file), JSON.stringify(info), 'utf8');
}

function removeLock(file) {
  const l = readLock(file);
  if (l && l.host === os.hostname() && l.pid === process.pid) {
    try {
      fs.unlinkSync(lockPath(file));
    } catch {
      /* egal */
    }
  }
}

// ---------------------------------------------------------------------------
// Sicherungen
// ---------------------------------------------------------------------------
function backupDir(file) {
  return path.join(path.dirname(file), 'Sicherungen');
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Kopiert die (verschlüsselte) Datei. better-sqlite3 arbeitet synchron, zwischen zwei Aufrufen ist keine Transaktion offen. */
function createBackup(file, reason = 'manuell') {
  const dir = backupDir(file);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(file, DB_EXTENSION);
  const target = path.join(dir, `${base}_${stamp()}_${reason}${DB_EXTENSION}`);
  fs.copyFileSync(file, target);
  // alte Sicherungen aufräumen
  const all = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(base + '_') && f.endsWith(DB_EXTENSION))
    .sort();
  while (all.length > MAX_BACKUPS) {
    try {
      fs.unlinkSync(path.join(dir, all.shift()));
    } catch {
      break;
    }
  }
  return target;
}

function listBackups(file) {
  const dir = backupDir(file);
  const base = path.basename(file, DB_EXTENSION);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(base + '_') && f.endsWith(DB_EXTENSION))
      .sort()
      .reverse()
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { file: path.join(dir, f), name: f, size: st.size, mtime: st.mtime.toISOString(), encrypted: isEncryptedFile(path.join(dir, f)) };
      });
  } catch {
    return [];
  }
}

function lastAutoBackupToday(file) {
  const today = stamp().slice(0, 8);
  return listBackups(file).some((b) => b.name.includes(`_${today}-`) && b.name.includes('_auto'));
}

// ---------------------------------------------------------------------------
// Öffnen / Anlegen
// ---------------------------------------------------------------------------
class SecuDb {
  constructor(db, file, { encrypted = true } = {}) {
    this.db = db;
    this.file = file;
    this.encrypted = encrypted;
    this.lockSince = new Date().toISOString();
    writeLock(file, this.lockSince);
    this.heartbeat = setInterval(() => {
      try {
        writeLock(file, this.lockSince);
      } catch {
        /* Cloud-Ordner evtl. kurz nicht erreichbar */
      }
    }, LOCK_HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  getMeta(key, fallback = null) {
    const r = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    return r ? r.value : fallback;
  }

  setMeta(key, value) {
    this.db
      .prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value == null ? null : String(value));
  }

  getJson(key, fallback) {
    const v = this.getMeta(key);
    if (v == null) return fallback;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  }

  setJson(key, obj) {
    this.setMeta(key, JSON.stringify(obj));
  }

  /** Passwort ändern – oder eine bisher unverschlüsselte Datenbank verschlüsseln. */
  changePassword(newPassword) {
    validatePassword(newPassword);
    createBackup(this.file, this.encrypted ? 'vor-passwortwechsel' : 'vor-verschluesselung');
    if (!this.encrypted) cipherConfig(this.db);
    this.db.rekey(Buffer.from(newPassword, 'utf8'));
    this.encrypted = true;
  }

  /** Verschlüsselung entfernen – die Datei ist danach ohne Passwort lesbar. */
  removePassword() {
    if (!this.encrypted) return;
    createBackup(this.file, 'vor-entschluesselung');
    this.db.rekey(Buffer.alloc(0));
    this.encrypted = false;
  }

  backup(reason) {
    return createBackup(this.file, reason);
  }

  close() {
    clearInterval(this.heartbeat);
    try {
      this.db.close();
    } finally {
      removeLock(this.file);
    }
  }
}

function openRaw(file, password) {
  const encrypted = isEncryptedFile(file);
  if (encrypted && !password) throw new DbError('PASSWORD_REQUIRED', 'Diese Datenbank ist mit einem Passwort geschützt.');
  const db = new Database(file, { fileMustExist: true });
  try {
    if (encrypted) applyKey(db, password);
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
  } catch (e) {
    db.close();
    if (e.code === 'SQLITE_NOTADB') throw new DbError('WRONG_PASSWORD', 'Passwort falsch oder Datei ist keine Prüfmanager-Datenbank.');
    throw e;
  }
  return { db, encrypted };
}

/**
 * Öffnet eine Datenbank. Wirft LOCKED (mit lock-Info), wenn sie auf einem anderen Rechner/Prozess
 * offen zu sein scheint – mit force=true kann trotzdem geöffnet werden.
 */
function openDatabase(file, password, { force = false } = {}) {
  if (!fs.existsSync(file)) throw new DbError('NOT_FOUND', `Datenbank-Datei nicht gefunden: ${file}`);
  const lock = readLock(file);
  if (lock && !lock.stale && !lock.mine && !force) {
    throw new DbError('LOCKED', `Die Datenbank ist vermutlich auf „${lock.host}“ (${lock.user}) geöffnet (seit ${lock.since}). Gleichzeitiges Arbeiten über die Cloud kann Daten überschreiben.`, { lock });
  }
  const { db, encrypted } = openRaw(file, password);
  configure(db);
  // Vor Migrationen / einmal täglich automatisch sichern
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
    if ((row && Number(row.value) < SCHEMA_VERSION) || !lastAutoBackupToday(file)) createBackup(file, 'auto');
  } catch {
    /* Sicherung darf das Öffnen nicht verhindern */
  }
  migrate(db);
  return new SecuDb(db, file, { encrypted });
}

/** Legt eine Datenbank an – mit Passwort verschlüsselt, ohne Passwort (null/'') unverschlüsselt. */
function createDatabase(file, password, { name, settings = {} } = {}) {
  const encrypted = !!password;
  if (encrypted) validatePassword(password);
  if (!file.toLowerCase().endsWith(DB_EXTENSION)) file += DB_EXTENSION;
  if (fs.existsSync(file)) throw new DbError('EXISTS', `Die Datei existiert bereits: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  if (encrypted) applyKey(db, password);
  configure(db);
  migrate(db);
  const handle = new SecuDb(db, file, { encrypted });
  handle.setMeta('db_uuid', crypto.randomUUID());
  handle.setMeta('db_name', name || path.basename(file, DB_EXTENSION));
  handle.setMeta('created_at', new Date().toISOString());
  handle.setJson('settings', settings);
  return handle;
}

/** Prüft nur das Passwort (z. B. vor kritischen Aktionen), ohne die DB dauerhaft zu öffnen. */
function verifyPassword(file, password) {
  const { db } = openRaw(file, password);
  db.close();
  return true;
}

/** Löscht unverschlüsselte Sicherungen (z. B. nachdem die Datenbank verschlüsselt wurde). */
function purgePlainBackups(file) {
  let n = 0;
  for (const b of listBackups(file)) {
    if (b.encrypted) continue;
    try {
      fs.unlinkSync(b.file);
      n += 1;
    } catch {
      /* Datei evtl. gesperrt (Cloud) – beim nächsten Mal */
    }
  }
  return n;
}

/**
 * Kopiert die Sicherungen einer Datenbank in den Sicherungsordner neben `targetFile`
 * und entfernt sie am alten Ort (beim Verschieben der Datenbank).
 */
function moveBackups(sourceFile, targetFile) {
  const from = listBackups(sourceFile);
  if (!from.length) return 0;
  const dir = backupDir(targetFile);
  fs.mkdirSync(dir, { recursive: true });
  const oldBase = path.basename(sourceFile, DB_EXTENSION);
  const newBase = path.basename(targetFile, DB_EXTENSION);
  let n = 0;
  for (const b of from) {
    const dest = path.join(dir, newBase + b.name.slice(oldBase.length));
    if (fs.existsSync(dest)) continue;
    fs.copyFileSync(b.file, dest);
    fs.unlinkSync(b.file);
    n += 1;
  }
  try {
    fs.rmdirSync(backupDir(sourceFile)); // nur wenn leer
  } catch {
    /* nicht leer oder schon weg */
  }
  return n;
}

module.exports = {
  DbError,
  MIN_PASSWORD_LENGTH,
  openDatabase,
  createDatabase,
  verifyPassword,
  isEncryptedFile,
  createBackup,
  listBackups,
  purgePlainBackups,
  moveBackups,
  readLock,
  validatePassword,
};
