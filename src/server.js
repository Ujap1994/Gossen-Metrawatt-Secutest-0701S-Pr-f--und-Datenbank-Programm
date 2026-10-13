'use strict';
/**
 * Secutest Prüfmanager – lokaler Webserver.
 *
 *   npm start                → http://127.0.0.1:3701 (Browser öffnet automatisch)
 *   npm run simulator        → mit simuliertem SECUTEST (ohne Hardware)
 *
 * Optionen: --port 3701  --host 127.0.0.1  --simulator  --no-open
 */
const path = require('path');
const express = require('express');
const config = require('./config');
const { SessionManager, AuthError } = require('./auth/session');
const { manager } = require('./secutest/manager');
const { ReminderScheduler } = require('./reminders/scheduler');
const pkg = require('../package.json');

const DISCLAIMER_VERSION = 1;

function parseArgs(argv) {
  const a = { simulator: false, open: true };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--simulator') a.simulator = true;
    else if (v === '--no-open') a.open = false;
    else if (v === '--selftest') a.selftest = true;
    else if (v === '--port') a.port = Number(argv[++i]);
    else if (v === '--host') a.host = argv[++i];
  }
  return a;
}

function createApp({ sessions = new SessionManager(), scheduler = new ReminderScheduler(), secutest = manager } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  sessions.onUnlock = (active) => scheduler.start(active.sdb);
  sessions.onLock = () => scheduler.stop();

  // Sicherheits-Header
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"
    );
    next();
  });

  app.use(express.json({ limit: '14mb' }));

  // CSRF-Schutz: schreibende API-Aufrufe nur mit eigenem Header (kann eine fremde Webseite nicht setzen)
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-Requested-With') !== 'secutest') {
      return res.status(403).json({ error: 'Ungültige Anfrage (CSRF-Schutz).' });
    }
    // DNS-Rebinding: nur localhost-Hosts akzeptieren
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host) && !process.env.SECUTEST_ALLOW_HOST?.split(',').includes(host)) {
      return res.status(403).json({ error: `Zugriff über Host „${host}“ nicht erlaubt.` });
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/status', (req, res) => {
    const authed = sessions.isAuthed(req);
    const disc = config.load().disclaimer || {};
    res.json({
      version: pkg.version,
      platform: process.platform,
      disclaimerAccepted: Number(disc.version) >= DISCLAIMER_VERSION,
      authed,
      db: authed ? { id: sessions.active.dbEntry.id, name: sessions.active.sdb.getMeta('db_name'), file: sessions.active.sdb.file } : null,
      secutest: authed ? { connected: secutest.driver.connected, port: secutest.driver.portPath, simulator: !!secutest.driver.simulator } : null,
    });
  });

  app.post('/api/disclaimer/accept', (req, res) => {
    config.update((c) => {
      c.disclaimer = { version: DISCLAIMER_VERSION, acceptedAt: new Date().toISOString() };
    });
    res.json({ ok: true });
  });

  app.use('/api', require('./routes/auth')(sessions));
  app.use('/api/secutest', sessions.require(), require('./routes/secutest')(secutest));
  app.use('/api', sessions.require(), require('./routes/data')(sessions, scheduler));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Unbekannter API-Pfad' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: 0 }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // Fehlerbehandlung
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || 500;
    if (!err.status && err.code) {
      status = { WRONG_PASSWORD: 401, WEAK_PASSWORD: 400, EXISTS: 409, NOT_FOUND: 404, LOCKED: 423, BAD_INPUT: 400, NAK: 409, TIMEOUT: 504, NOT_CONNECTED: 409, OPEN_FAILED: 409, NO_PORT: 400, NO_SERIAL: 500, BAD_POSITION: 400, NO_SIMULATOR: 400, NEWER_SCHEMA: 409, SQLITE_CONSTRAINT_UNIQUE: 409 }[err.code] || 500;
    }
    if (err.type === 'entity.too.large') status = 413;
    if (status >= 500 && !(err instanceof AuthError)) console.error(err);
    res.status(status).json({ error: err.message || 'Interner Fehler', code: err.code || null });
  });

  return { app, sessions, scheduler, secutest };
}

function openBrowser(url) {
  const { spawn } = require('child_process');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const p = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
  } catch {
    /* kein Browser verfügbar */
  }
}

/** Prüft, ob Laufzeit und native Module funktionieren (für Release-Pakete) */
async function selfTest() {
  const os = require('os');
  const fs = require('fs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secutest-selftest-'));
  try {
    const { createDatabase, openDatabase } = require('./db/database');
    const file = path.join(tmp, 'selbsttest.secudb');
    createDatabase(file, 'selbsttest-passwort', { name: 'Selbsttest' }).close();
    const db = openDatabase(file, 'selbsttest-passwort');
    console.log(`✔ SQLCipher-Datenbank: ${db.db.prepare('SELECT sqlite_version() AS v').get().v}`);
    db.close();
    // native Binärdatei von serialport explizit laden
    require('node-gyp-build')(path.dirname(require.resolve('@serialport/bindings-cpp/package.json')));
    const { autoDetect } = require('@serialport/bindings-cpp');
    const ports = await autoDetect().list().catch((e) => ({ error: e.message }));
    console.log(`✔ Serielle Schnittstelle (serialport): ${Array.isArray(ports) ? `${ports.length} Port(s)` : `geladen (${ports.error})`}`);
    const { SecutestDriver } = require('./secutest/driver');
    const d = new SecutestDriver();
    await d.connect({ simulator: true });
    console.log(`✔ Simulator: ${d.identity.model}`);
    await d.disconnect();
    console.log(`✔ Selbsttest erfolgreich (Node.js ${process.version}, ${process.platform}-${process.arch})`);
    return true;
  } catch (e) {
    console.error('✘ Selbsttest fehlgeschlagen:', e);
    return false;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) process.exit((await selfTest()) ? 0 : 1);
  const cfg = config.load();
  const host = args.host || cfg.server.host;
  const port = args.port || cfg.server.port;
  const { app, sessions, secutest } = createApp();

  const server = app.listen(port, host, () => {
    const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
    console.log(`\n  Secutest Prüfmanager ${pkg.version}`);
    console.log(`  ➜ Oberfläche: ${url}`);
    console.log(`  ➜ Konfiguration: ${config.appDataDir()}`);
    if (args.simulator) console.log('  ➜ SECUTEST-Simulator aktiv (keine Hardware nötig)');
    console.log('  Beenden mit Strg+C\n');
    if (args.open && !process.env.CI) openBrowser(url);
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} ist bereits belegt – läuft das Programm schon? (Option --port …)` : e.message);
    process.exit(1);
  });

  if (args.simulator) {
    secutest.connect({ simulator: true }).catch((e) => console.error('Simulator:', e.message));
  } else if (secutest.cfg().autoConnect) {
    secutest.startWatcher();
    secutest.autoDetect({ connect: true }).then(
      (r) => r.found && console.log(`  SECUTEST automatisch gefunden an ${r.found.path}`),
      () => {}
    );
  }

  const shutdown = async () => {
    console.log('\nBeende …');
    sessions.lock('Programm beendet');
    await secutest.disconnect().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();

module.exports = { createApp, parseArgs };
