'use strict';
/**
 * Secutest Prüfmanager als Desktop-Programm (Electron).
 *
 * Der vorhandene Server (src/server.js) läuft im Hauptprozess auf 127.0.0.1, das Programmfenster zeigt die
 * Oberfläche. Nur eine Instanz; das Fenster schließen beendet das Programm (Datenbank gesperrt, SECUTEST getrennt).
 *
 *   npm run app              → Desktop-Programm
 *   npm run app:simulator    → mit simuliertem SECUTEST
 */
const { app, BrowserWindow, Menu, shell, dialog, session } = require('electron');
const fs = require('fs');
const path = require('path');

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const SIMULATOR = process.argv.includes('--simulator') || process.env.SECUTEST_SIMULATOR === '1';
// Tests: eigener Programmordner (sonst greift die Einzelinstanz-Sperre des echten Programms) und eigener Port
if (process.env.SECUTEST_USER_DATA) {
  app.setPath('userData', process.env.SECUTEST_USER_DATA);
  app.setAppLogsPath(path.join(process.env.SECUTEST_USER_DATA, 'logs'));
}
const PORT = Number(process.env.SECUTEST_DESKTOP_PORT ?? 37017);

// ---------------------------------------------------------------------------
// Protokolldatei (ohne Terminal sonst unsichtbar): macOS ~/Library/Logs/…, Windows/Linux im Benutzerordner
// ---------------------------------------------------------------------------
function logToFile() {
  const dir = app.getPath('logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'main.log');
  try {
    if (fs.statSync(file).size > 2_000_000) fs.renameSync(file, `${file}.1`);
  } catch {
    /* noch keine Datei */
  }
  const out = fs.createWriteStream(file, { flags: 'a' });
  out.write(`--- Start ${new Date().toISOString()} (${app.getVersion()}, ${process.platform}-${process.arch})\n`);
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      out.write(`${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
    };
  }
}

// ---------------------------------------------------------------------------
// Fenstergröße und -position merken
// ---------------------------------------------------------------------------
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
  } catch {
    return { width: 1400, height: 950 };
  }
}
function saveBounds(win) {
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    /* nur Komfort */
  }
}

// ---------------------------------------------------------------------------
// Programm
// ---------------------------------------------------------------------------
let mainWindow = null;
let server = null;

if (!app.requestSingleInstanceLock()) {
  // läuft schon: das vorhandene Fenster kommt nach vorn (second-instance)
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(start, (e) => fail(e));
}

function fail(e) {
  console.error(e);
  dialog.showErrorBox('Secutest Prüfmanager', `Das Programm konnte nicht gestartet werden:\n\n${e.message}`);
  app.exit(1);
}

async function start() {
  logToFile();
  // gleiche Daten wie die Browser-Version (Konfiguration, Datenbanken) – siehe src/config.js
  const { startEmbedded } = require('../src/server');
  try {
    server = await startEmbedded({ simulator: SIMULATOR, port: PORT, onQuit: () => app.quit() });
  } catch (e) {
    return fail(e);
  }
  const origin = new URL(server.url).origin;
  const sameOrigin = (url) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };

  // Kamera nur für die eigene Oberfläche (QR-Scanner der Prüfplaketten)
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(permission === 'media' && sameOrigin(details.requestingUrl || wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => permission === 'media' && requestingOrigin === origin);

  Menu.setApplicationMenu(buildMenu());
  const b = loadBounds();
  mainWindow = new BrowserWindow({
    ...b,
    minWidth: 900,
    minHeight: 600,
    title: 'Secutest Prüfmanager',
    icon: ICON,
    show: false,
    backgroundColor: '#f3f6f9',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  // immer maximiert starten (Wunsch des Prüfers); die gemerkte Größe gilt beim Verkleinern
  mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => saveBounds(mainWindow));
  mainWindow.on('closed', () => (mainWindow = null));
  guardContents(mainWindow.webContents, sameOrigin);
  logRenderer(mainWindow.webContents);
  await mainWindow.loadURL(server.url);
}

/** Fehler, Seitenwechsel und Abstürze der Oberfläche in die Protokolldatei – sonst nicht nachvollziehbar */
function logRenderer(contents) {
  const levels = { 2: 'WARN', 3: 'FEHLER' };
  contents.on('console-message', (e) => {
    const level = e.level ?? e.params?.level;
    const name = typeof level === 'number' ? levels[level] : { warning: 'WARN', error: 'FEHLER' }[level];
    if (name) console.log(`[Oberfläche] ${name} ${e.message ?? e.params?.message} (${e.sourceId ?? ''}:${e.lineNumber ?? ''})`);
  });
  contents.on('did-navigate', (e, url) => console.log(`[Oberfläche] Seite geladen: ${url}`));
  contents.on('did-navigate-in-page', (e, url) => console.log(`[Oberfläche] Ansicht: ${new URL(url).hash || '/'}`));
  contents.on('render-process-gone', (e, d) => console.error(`[Oberfläche] abgestürzt: ${d.reason} (${d.exitCode})`));
  contents.on('unresponsive', () => console.error('[Oberfläche] reagiert nicht'));
}

/** Eigene Seiten (Prüfprotokoll, Plaketten, Anhänge) in eigenen Programmfenstern, alles andere im Standardbrowser */
function guardContents(contents, sameOrigin) {
  contents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 900, icon: ICON, autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } } };
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', (child) => guardContents(child.webContents, sameOrigin));
  contents.on('will-navigate', (e, url) => {
    if (sameOrigin(url)) return;
    e.preventDefault();
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
  });
  // „Seite verlassen?“ der Oberfläche (laufende, nicht gespeicherte Prüfung) als Programmdialog
  contents.on('will-prevent-unload', (e) => {
    const win = BrowserWindow.fromWebContents(contents);
    const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Trotzdem schließen', 'Abbrechen'], defaultId: 1, cancelId: 1, title: 'Secutest Prüfmanager', message: 'Die laufende Prüfung wurde noch nicht gespeichert.', detail: 'Beim Schließen gehen die eingegebenen Werte verloren.' });
    if (choice === 0) e.preventDefault();
  });
}

function buildMenu() {
  const dev = !app.isPackaged;
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : [{ label: 'Datei', submenu: [{ role: 'quit', label: 'Beenden' }] }]),
    { role: 'editMenu' },
    {
      label: 'Ansicht',
      submenu: [{ role: 'reload', label: 'Neu laden' }, ...(dev ? [{ role: 'toggleDevTools' }] : []), { type: 'separator' }, { role: 'resetZoom', label: 'Originalgröße' }, { role: 'zoomIn', label: 'Vergrößern' }, { role: 'zoomOut', label: 'Verkleinern' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Vollbild' }],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Projektseite (GitHub)', click: () => shell.openExternal('https://github.com/Ujap1994/Gossen-Metrawatt-Secutest-0701S-Pr-f--und-Datenbank-Programm') }, { label: 'Protokolldateien öffnen', click: () => shell.openPath(app.getPath('logs')) }] },
  ];
  return Menu.buildFromTemplate(template);
}

// Fenster schließen = Programm beenden (auch unter macOS) – vorher sauber: Datenbank sperren, Gerät trennen
app.on('window-all-closed', () => app.quit());
let stopping = false;
app.on('before-quit', (e) => {
  if (!server || stopping === 'done') return;
  e.preventDefault();
  if (stopping) return;
  stopping = true;
  server
    .stop('Programm beendet')
    .catch((err) => console.error(err))
    .finally(() => {
      stopping = 'done';
      app.quit();
    });
});
