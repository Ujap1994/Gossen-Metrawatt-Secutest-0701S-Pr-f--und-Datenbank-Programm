'use strict';
/**
 * Datenbanken auswählen/anlegen und anmelden (Passwort + 2FA). Keine Anmeldung erforderlich.
 */
const fs = require('fs');
const path = require('path');
const { asyncRouter } = require('./util');
const QRCode = require('qrcode');
const config = require('../config');
const { detectCloudLocations, discoverDatabases, localFolder, providerForPath } = require('../db/cloud');
const { readLock, validatePassword, DbError } = require('../db/database');
const { setSessionCookie, clearSessionCookie, AuthError } = require('../auth/session');
const repo = require('../db/repo');

function safeFileName(name) {
  return (
    String(name || 'Pruefdatenbank')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ß/g, 'ss')
      .replace(/[^A-Za-z0-9 _.-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'Pruefdatenbank'
  );
}

module.exports = function authRoutes(sessions) {
  const r = asyncRouter();

  r.get('/databases', (req, res) => {
    const cfg = config.load();
    const registered = cfg.databases.map((d) => {
      const exists = fs.existsSync(d.path);
      const lock = exists ? readLock(d.path) : null;
      return { ...d, exists, provider: providerForPath(d.path), lock: lock && !lock.stale && !lock.mine ? lock : null, active: sessions.active?.dbEntry.id === d.id };
    });
    const discovered = discoverDatabases().filter((x) => !cfg.databases.some((d) => config.samePath(d.path, x.path)));
    res.json({ registered, discovered, cloud: detectCloudLocations(), local: localFolder(), extension: config.DB_EXTENSION });
  });

  r.post('/databases/register', (req, res) => {
    const file = String(req.body.path || '').trim();
    if (!file) throw new DbError('BAD_INPUT', 'Bitte einen Dateipfad angeben.');
    if (!file.toLowerCase().endsWith(config.DB_EXTENSION)) throw new DbError('BAD_INPUT', `Die Datei muss auf ${config.DB_EXTENSION} enden.`);
    if (!fs.existsSync(file)) throw new DbError('NOT_FOUND', 'Datei nicht gefunden.');
    res.json(config.registerDatabase({ file, name: req.body.name }));
  });

  r.delete('/databases/:id', (req, res) => {
    if (sessions.active?.dbEntry.id === req.params.id) sessions.lock('Datenbank aus Liste entfernt');
    config.unregisterDatabase(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Neue Datenbank ----------
  r.post('/setup/begin', async (req, res) => {
    const { name, folder, password, password2, owner = {}, inspector = {}, intervalMonths } = req.body || {};
    if (!String(name || '').trim()) throw new DbError('BAD_INPUT', 'Bitte einen Namen für die Datenbank angeben (z. B. „Meine Geräte“ oder „Familie Müller“).');
    if (password !== password2) throw new DbError('BAD_INPUT', 'Die Passwörter stimmen nicht überein.');
    validatePassword(password);
    const dir = String(folder || '').trim() || localFolder();
    if (!path.isAbsolute(dir)) throw new DbError('BAD_INPUT', 'Bitte einen absoluten Ordnerpfad angeben.');
    const file = path.join(dir, safeFileName(name) + config.DB_EXTENSION);
    if (fs.existsSync(file)) throw new DbError('EXISTS', `In diesem Ordner gibt es bereits eine Datenbank „${path.basename(file)}“.`);
    const settings = {
      owner: { ...repo.DEFAULT_SETTINGS.owner, ...owner },
      inspector: { ...repo.DEFAULT_SETTINGS.inspector, ...inspector },
      defaultIntervalMonths: Number(intervalMonths) || 12,
    };
    const s = sessions.beginSetup({ file, password, name: String(name).trim(), settings });
    const qr = await QRCode.toDataURL(s.uri, { margin: 1, width: 240 });
    res.json({ setupToken: s.setupToken, secret: s.secret, uri: s.uri, qr, file });
  });

  r.post('/setup/finish', (req, res) => {
    const { sdb, recovery, file } = sessions.finishSetup(req.body.setupToken, req.body.code);
    const entry = config.registerDatabase({ file, name: sdb.getMeta('db_name') });
    config.touchDatabase(entry.id);
    const { sid } = sessions.activateNew(entry, sdb);
    setSessionCookie(res, sid);
    res.json({ ok: true, recoveryCodes: recovery, db: entry });
  });

  // ---------- Anmelden ----------
  r.post('/unlock', (req, res) => {
    const entry = config.findDatabase(req.body.dbId);
    if (!entry) throw new AuthError('Datenbank nicht gefunden.', 404, 'NOT_FOUND');
    try {
      const out = sessions.unlockPassword(entry, String(req.body.password || ''), { force: !!req.body.force });
      res.json(out);
    } catch (e) {
      if (e.code === 'LOCKED') return res.status(423).json({ error: e.message, code: 'LOCKED', lock: e.lock });
      throw e;
    }
  });

  r.post('/unlock/2fa', (req, res) => {
    const out = sessions.unlockTotp(req.body.pendingToken, { code: req.body.code, recoveryCode: req.body.recoveryCode });
    config.touchDatabase(sessions.active.dbEntry.id);
    setSessionCookie(res, out.sid);
    res.json({ ok: true, usedRecovery: out.usedRecovery, remainingRecovery: out.remainingRecovery });
  });

  r.post('/lock', (req, res) => {
    if (sessions.isAuthed(req)) sessions.lock('Abgemeldet');
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return r;
};
