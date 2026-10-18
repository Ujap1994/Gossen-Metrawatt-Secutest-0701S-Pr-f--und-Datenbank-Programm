'use strict';
// serialport öffnet Schnittstellen im libuv-Threadpool (Standard 4 Threads). Hängt das Öffnen eines Ports,
// bleibt ein Thread belegt – mit mehr Threads blockiert das nicht gleich Dateizugriffe und Anmeldung.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';
/**
 * Secutest Prüfmanager – lokaler Webserver.
 *
 *   npm start                → http://127.0.0.1:3701 (Browser öffnet automatisch)
 *   npm run simulator        → mit simuliertem SECUTEST (ohne Hardware)
 *
 * Optionen: --port 3701  --host 127.0.0.1  --simulator  --no-open
 */
const fs = require('fs');
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

function createApp({ sessions = new SessionManager(), scheduler = new ReminderScheduler(), secutest = manager, onShutdown = null } = {}) {
  const app = express();
  // Kennung dieses Serverstarts: ein Browser-Tab mit älterem Programmcode (vor Neustart/Update) wird erkannt
  const bootId = require('crypto').randomBytes(6).toString('hex');
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

  // QR-Erkennung (jsQR, Apache-2.0) für Browser ohne eingebauten BarcodeDetector (Firefox, Safari)
  app.get('/vendor/jsQR.js', (req, res) => res.sendFile(require.resolve('jsqr/dist/jsQR.js')));

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
    // Veralteter Tab: Programm-Abfragen des Browsers (fetch/EventSource: Sec-Fetch-Mode cors bzw. same-origin; Node-fetch
    // sendet kein Sec-Fetch-Site) ohne die Kennung dieses Starts abweisen – sonst steuert ein Tab mit altem Programmcode
    // das Gerät weiter und holt sich den Ereignis-Kanal zurück. Links (Prüfprotokoll, Plaketten, Downloads) und Bilder bleiben frei.
    const ui = req.get('X-UI-Boot') || req.query.boot;
    const mode = req.get('Sec-Fetch-Mode');
    if (req.get('Sec-Fetch-Site') && (mode === 'cors' || mode === 'same-origin') && req.path !== '/status' && ui !== bootId) {
      return res.status(409).json({ error: 'Der Prüfmanager wurde neu gestartet oder aktualisiert – bitte diese Seite neu laden.', code: 'RELOAD' });
    }
    next();
  });

  app.get('/api/status', (req, res) => {
    const authed = sessions.isAuthed(req);
    const disc = config.load().disclaimer || {};
    res.json({
      version: pkg.version,
      boot: bootId,
      platform: process.platform,
      disclaimerAccepted: Number(disc.version) >= DISCLAIMER_VERSION,
      authed,
      db: authed ? { id: sessions.active.dbEntry.id, name: sessions.active.sdb.getMeta('db_name'), file: sessions.active.sdb.file } : null,
      secutest: authed ? { connected: secutest.driver.connected, port: secutest.driver.portPath, simulator: !!secutest.driver.simulator } : null,
    });
  });

  // Programm beenden (Button in der Oberfläche – wichtig bei Start ohne Terminalfenster)
  app.post('/api/shutdown', (req, res) => {
    if (!onShutdown) return res.status(501).json({ error: 'Beenden ist in diesem Modus nicht verfügbar.' });
    res.json({ ok: true });
    setTimeout(() => onShutdown('Beendet über die Oberfläche'), 150);
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
      status = { WRONG_PASSWORD: 401, PASSWORD_REQUIRED: 401, COPY_FAILED: 500, WEAK_PASSWORD: 400, EXISTS: 409, NOT_FOUND: 404, LOCKED: 423, BAD_INPUT: 400, NAK: 409, TIMEOUT: 504, NOT_CONNECTED: 409, OPEN_FAILED: 409, NO_PORT: 400, NO_SERIAL: 500, BAD_POSITION: 400, NO_SIMULATOR: 400, CHECKSUM: 502, GARBLED: 502, DEVICE_ERROR: 409, UNSTABLE: 504, NEWER_SCHEMA: 409, SQLITE_CONSTRAINT_UNIQUE: 409 }[err.code] || 500;
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

// ---------------------------------------------------------------------------
// Einzelinstanz: PID-Datei, damit ein Neustart eine hängende alte Instanz beenden kann
// ---------------------------------------------------------------------------
const pidFile = () => path.join(config.appDataDir(), 'server.pid');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function writePidFile(port) {
  try {
    fs.mkdirSync(config.appDataDir(), { recursive: true });
    fs.writeFileSync(pidFile(), JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }));
  } catch {
    /* nur Komfort */
  }
}

function removePidFile() {
  try {
    if (JSON.parse(fs.readFileSync(pidFile(), 'utf8')).pid === process.pid) fs.unlinkSync(pidFile());
  } catch {
    /* schon weg */
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** Läuft unter der PID wirklich der Prüfmanager? (PIDs werden wiederverwendet) */
function isOurProcess(pid) {
  if (!alive(pid)) return false;
  const { execFileSync } = require('child_process');
  try {
    if (process.platform === 'win32') return /node/i.test(execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }));
    return /src[\\/]server\.js/.test(execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}

/** Antwortet die laufende Instanz (Status und Oberfläche)? Mehrere Versuche – sie kann kurz beschäftigt sein. */
async function runningInstance(url) {
  for (let i = 0; i < 3; i++) {
    const status = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.json())
      .catch(() => null);
    const page = status?.version && (await fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false));
    if (page) return status;
    await sleep(500);
  }
  return null;
}

/** Hängende Instanz aus der PID-Datei beenden (erst freundlich, dann hart). true = Port ist frei */
async function stopStaleInstance(port) {
  let info;
  try {
    info = JSON.parse(fs.readFileSync(pidFile(), 'utf8'));
  } catch {
    return false;
  }
  if (!info?.pid || info.pid === process.pid || Number(info.port) !== Number(port) || !isOurProcess(info.pid)) return false;
  console.log(`Vorherige Instanz (PID ${info.pid}) reagiert nicht – wird beendet …`);
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    try {
      process.kill(info.pid, sig);
    } catch {
      /* schon beendet */
    }
    for (let i = 0; i < 30 && alive(info.pid); i++) await sleep(100);
    if (!alive(info.pid)) return true;
  }
  return false;
}

/** SECUTEST verbinden: Simulator oder automatische Suche samt Hot-Plug-Überwachung */
function connectDevice(secutest, { simulator = false } = {}) {
  if (simulator) {
    secutest.connect({ simulator: true }).catch((e) => console.error('Simulator:', e.message));
  } else if (secutest.cfg().autoConnect) {
    secutest.startWatcher();
    secutest.autoDetect({ connect: true }).then(
      (r) => r.found && console.log(`  SECUTEST automatisch gefunden an ${r.found.path}`),
      () => {}
    );
  }
}

/**
 * Für das Desktop-Programm (Electron): Server nur für das eigene Fenster auf 127.0.0.1, ohne PID-Datei und
 * ohne Browser. Fester Port, damit Einstellungen der Oberfläche (localStorage, z. B. Hell/Dunkel) erhalten
 * bleiben; ist er belegt, ein freier. onQuit: „Programm beenden“ in der Oberfläche.
 */
async function startEmbedded({ simulator = false, port = 37017, onQuit = () => {} } = {}) {
  const { app, sessions, secutest } = createApp({ onShutdown: (reason) => onQuit(reason) });
  secutest.logToConsole = true;
  const listenOn = (p) =>
    new Promise((resolve, reject) => {
      const s = app.listen(p, '127.0.0.1', () => resolve(s));
      s.once('error', reject);
    });
  const server = await listenOn(port).catch((e) => (e.code === 'EADDRINUSE' ? listenOn(0) : Promise.reject(e)));
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`  Secutest Prüfmanager ${pkg.version} (Desktop) – ${url}, Konfiguration: ${config.appDataDir()}`);
  connectDevice(secutest, { simulator });
  let stopped = null;
  const stop = (reason = 'Programm beendet') =>
    (stopped ||= (async () => {
      console.log(`${reason} …`);
      sessions.closeAll(reason);
      await secutest.disconnect().catch(() => {});
      secutest.stopWatcher();
      server.closeAllConnections?.(); // Ereignis-Kanäle (SSE) halten die Verbindung sonst offen
      await new Promise((r) => server.close(() => r()));
    })());
  return { url, stop, secutest };
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
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  let server = null;
  let stopping = false;
  const shutdown = async (reason = 'Programm beendet') => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${reason} …`);
    sessions.closeAll(reason);
    await secutest.disconnect().catch(() => {});
    secutest.stopWatcher();
    removePidFile();
    if (server) server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  const { app, sessions, secutest } = createApp({ onShutdown: shutdown });
  secutest.logToConsole = true;

  let staleStopped = false;
  const listen = () => {
    server = app.listen(port, host, () => {
      writePidFile(port);
      console.log(`\n  Secutest Prüfmanager ${pkg.version}`);
      console.log(`  ➜ Oberfläche: ${url}`);
      console.log(`  ➜ Konfiguration: ${config.appDataDir()}`);
      if (args.simulator) console.log('  ➜ SECUTEST-Simulator aktiv (keine Hardware nötig)');
      console.log('  Beenden mit Strg+C oder über „Programm beenden“ in der Oberfläche\n');
      if (args.open && !process.env.CI) openBrowser(url);
      // Schnittstelle erst nach erfolgreichem Start (sonst belegt eine zweite Instanz die Ports)
      connectDevice(secutest, { simulator: args.simulator });
    });
    server.on('error', async (e) => {
      if (e.code === 'EADDRINUSE') {
        // Läuft das Programm schon? Dann nur den Browser öffnen (Einzelinstanz)
        const running = await runningInstance(url);
        if (running) {
          console.log(`Secutest Prüfmanager läuft bereits – öffne ${url}`);
          if (args.open && !process.env.CI) openBrowser(url);
          process.exit(0);
        }
        // eigene alte Instanz, die nicht mehr antwortet: beenden und neu starten
        if (!staleStopped && (await stopStaleInstance(port))) {
          staleStopped = true;
          await sleep(300);
          return listen();
        }
        console.error(`Port ${port} ist bereits durch ein anderes Programm belegt. Start mit --port <Nummer> möglich.`);
      } else console.error(e.message);
      process.exit(1);
    });
  };
  listen();
  process.on('exit', removePidFile);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();

module.exports = { createApp, parseArgs, startEmbedded };
