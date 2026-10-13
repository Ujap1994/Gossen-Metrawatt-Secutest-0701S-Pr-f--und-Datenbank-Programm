#!/usr/bin/env node
'use strict';
/**
 * Baut portable, sofort startbare Pakete (inkl. Node.js-Laufzeit):
 *   Windows x64 / ARM64, macOS Apple Silicon / Intel / Universal (.app), Linux x64 / ARM64
 *
 *   node scripts/build-release.js                 → alle Plattformen (lädt Node.js von nodejs.org)
 *   node scripts/build-release.js --only linux-x64 --local-node   → nur aktuelle Plattform, ohne Download
 *
 * Die nativen Module (SQLCipher, serialport) bringen vorkompilierte Binärdateien für alle
 * Plattformen mit – daher kann alles auf einem Linux-Rechner (GitHub Actions) gebaut werden.
 * Ergebnis: dist/release/*.zip|*.tar.gz + SHA256SUMS.txt
 * Linux-Distributionspakete (deb/rpm/Arch/AppImage) baut danach scripts/build-linux-packages.js.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'release');
const pkg = require('../package.json');

const APP_NAME = 'Secutest Prüfmanager';
const APP_BUNDLE = 'Secutest Pruefmanager.app'; // ASCII-Ordnername (sicher in ZIP-Dateien), Anzeigename kommt aus Info.plist
const BUNDLE_ID = 'io.github.pruefmanager.Secutest';

const TARGETS = {
  'windows-x64': { nodes: ['win-x64'], archive: 'zip', platform: 'win32', archs: ['x64'] },
  'windows-arm64': { nodes: ['win-arm64'], archive: 'zip', platform: 'win32', archs: ['arm64'] },
  'macos-arm64': { nodes: ['darwin-arm64'], archive: 'zip', platform: 'darwin', archs: ['arm64'] },
  'macos-x64': { nodes: ['darwin-x64'], archive: 'zip', platform: 'darwin', archs: ['x64'] },
  'macos-universal': { nodes: ['darwin-arm64', 'darwin-x64'], archive: 'zip', platform: 'darwin', archs: ['arm64', 'x64'] },
  'linux-x64': { nodes: ['linux-x64'], archive: 'tar.gz', platform: 'linux', archs: ['x64'] },
  'linux-arm64': { nodes: ['linux-arm64'], archive: 'tar.gz', platform: 'linux', archs: ['arm64'] },
  // musl (Alpine, postmarketOS, Void-musl): ohne gebündeltes Node.js – nutzt das Node.js der Distribution
  'linux-musl-x64': { nodes: [], archive: 'tar.gz', platform: 'linux', archs: ['x64'], musl: true },
  'linux-musl-arm64': { nodes: [], archive: 'tar.gz', platform: 'linux', archs: ['arm64'], musl: true },
};

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : Object.keys(TARGETS);
const localNode = args.includes('--local-node');
const nodeMajor = process.env.BUNDLE_NODE_MAJOR || '22';
const buildNo = process.env.GITHUB_RUN_NUMBER || 'local';
const version = `${pkg.version}${buildNo === 'local' ? '' : `-build.${buildNo}`}`;

const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: 'inherit', ...opts });

function rm(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copy(src, dst) {
  fs.cpSync(src, dst, { recursive: true, filter: (s) => !/node_modules[\\/]\.cache|\.DS_Store$/.test(s) });
}

function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode) fs.chmodSync(file, mode);
}

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status}): ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

async function resolveNodeVersion() {
  if (process.env.BUNDLE_NODE_VERSION) return process.env.BUNDLE_NODE_VERSION;
  const index = JSON.parse((await fetchBuffer('https://nodejs.org/dist/index.json')).toString());
  const rel = index.find((r) => r.version.startsWith(`v${nodeMajor}.`) && r.lts);
  if (!rel) throw new Error(`Keine LTS-Version v${nodeMajor} gefunden`);
  return rel.version;
}

let shasums = null;
/** Lädt die Node.js-Binärdatei (mit SHA-256-Prüfung) und kopiert sie nach destDir */
async function fetchNode(nodeVersion, nodeTarget, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const cache = path.join(DIST, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const base = `node-${nodeVersion}-${nodeTarget}`;
  const file = nodeTarget.startsWith('win') ? `${base}.zip` : nodeTarget.startsWith('linux') ? `${base}.tar.xz` : `${base}.tar.gz`;
  const local = path.join(cache, file);
  if (!fs.existsSync(local)) {
    const url = `https://nodejs.org/dist/${nodeVersion}/${file}`;
    console.log(`  ↓ ${url}`);
    const buf = await fetchBuffer(url);
    shasums ||= (await fetchBuffer(`https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`)).toString();
    const expected = shasums.split('\n').find((l) => l.endsWith(`  ${file}`))?.split(/\s+/)[0];
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (!expected || expected !== actual) throw new Error(`SHA-256 von ${file} stimmt nicht!`);
    fs.writeFileSync(local, buf);
  }
  const tmp = path.join(cache, `x-${nodeTarget}`);
  rm(tmp);
  fs.mkdirSync(tmp, { recursive: true });
  if (file.endsWith('.zip')) sh('unzip', ['-q', local, `${base}/node.exe`, `${base}/LICENSE`, '-d', tmp]);
  else sh('tar', ['-xf', local, '-C', tmp, `${base}/bin/node`, `${base}/LICENSE`]);
  const bin = file.endsWith('.zip') ? path.join(tmp, base, 'node.exe') : path.join(tmp, base, 'bin', 'node');
  fs.copyFileSync(bin, path.join(destDir, path.basename(bin)));
  fs.chmodSync(path.join(destDir, path.basename(bin)), 0o755);
  fs.copyFileSync(path.join(tmp, base, 'LICENSE'), path.join(destDir, 'NODE-LICENSE.txt'));
  rm(tmp);
}

/** Native Binärdateien anderer Plattformen entfernen (kleinere Downloads) */
function prunePrebuilds(appDir, t) {
  // SQLCipher: <platform>-<arch>.node bzw. linuxmusl-<arch>.node
  const sqPrefix = t.musl ? 'linuxmusl-' : `${t.platform}-`;
  const keepSq = (f) => t.archs.some((a) => f.startsWith(`${sqPrefix}${a}`));
  // serialport: Ordner <platform>-<arch> (enthält glibc- und musl-Variante), macOS: darwin-x64+arm64
  const keepSp = (d) => t.archs.some((a) => d.startsWith(`${t.platform}-`) && d.includes(a));
  const sq = path.join(appDir, 'node_modules', 'better-sqlite3-multiple-ciphers', 'prebuilds');
  if (fs.existsSync(sq)) for (const f of fs.readdirSync(sq)) if (!keepSq(f)) rm(path.join(sq, f));
  const sp = path.join(appDir, 'node_modules', '@serialport', 'bindings-cpp', 'prebuilds');
  if (fs.existsSync(sp)) {
    for (const d of fs.readdirSync(sp)) {
      if (!keepSp(d)) rm(path.join(sp, d));
      else if (t.platform === 'linux') for (const f of fs.readdirSync(path.join(sp, d))) if (f.includes(t.musl ? '.glibc.' : '.musl.')) rm(path.join(sp, d, f));
    }
  }
}

/** Apple-Icon (.icns) aus PNG-Dateien zusammensetzen (PNG-Einträge ic07–ic10) */
function makeIcns() {
  const parts = [
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
  ].map(([type, size]) => {
    const data = fs.readFileSync(path.join(ROOT, 'packaging', 'icons', `icon-${size}.png`));
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

function infoPlist() {
  const v = pkg.version;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleVersion</key><string>${buildNo === 'local' ? v : buildNo}</string>
  <key>CFBundleShortVersionString</key><string>${v}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>secutest-pruefmanager</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>MIT-Lizenz · Open Source ohne Gewähr</string>
</dict>
</plist>
`;
}

/** Shell-Schnipsel: passende Node.js-Laufzeit wählen (Universal: Apple Silicon oder Intel) */
const MAC_NODE_SELECT = `if [ -x "$RES/runtime/node" ]; then
  NODE="$RES/runtime/node"
elif [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then
  NODE="$RES/runtime/darwin-arm64/node"
else
  NODE="$RES/runtime/darwin-x64/node"
fi`;

function writeLaunchers(dir, target, contentDir) {
  const t = TARGETS[target];
  if (t.platform === 'win32') {
    const cmd = (extra) => `@echo off\r\nchcp 65001 >nul\r\ntitle Secutest Pruefmanager\r\ncd /d "%~dp0app"\r\n"%~dp0runtime\\node.exe" src\\server.js ${extra}%*\r\nif errorlevel 1 pause\r\n`;
    write(path.join(dir, 'Secutest-Pruefmanager.cmd'), cmd(''));
    write(path.join(dir, 'Simulator-ohne-Hardware.cmd'), cmd('--simulator '));
    write(path.join(dir, 'Erinnerungen-senden.cmd'), `@echo off\r\ncd /d "%~dp0app"\r\n"%~dp0runtime\\node.exe" scripts\\send-reminders.js %*\r\npause\r\n`);
  } else if (t.platform === 'darwin') {
    // .app-Bundle (Doppelklick, ohne Terminal) …
    const appExe = path.join(contentDir, '..', 'MacOS', 'secutest-pruefmanager');
    write(appExe, `#!/bin/sh\n# ${APP_NAME} – startet den lokalen Server und öffnet den Browser\nRES="$(cd "$(dirname "$0")/../Resources" && pwd)"\n${MAC_NODE_SELECT}\nexec "$NODE" "$RES/app/src/server.js" "$@"\n`, 0o755);
    write(path.join(contentDir, '..', 'Info.plist'), infoPlist());
    write(path.join(contentDir, 'AppIcon.icns'), makeIcns());
    // … und .command-Dateien (mit Terminalfenster und Log-Ausgabe)
    const script = (entry, extra) => `#!/bin/sh\n# ${APP_NAME}\nDIR="$(cd "$(dirname "$0")" && pwd)"\nRES="$DIR/${APP_BUNDLE}/Contents/Resources"\n${MAC_NODE_SELECT}\ncd "$RES/app" || exit 1\nexec "$NODE" ${entry} ${extra}"$@"\n`;
    write(path.join(dir, 'Secutest-Pruefmanager.command'), script('src/server.js', ''), 0o755);
    write(path.join(dir, 'Simulator-ohne-Hardware.command'), script('src/server.js', '--simulator '), 0o755);
    write(path.join(dir, 'Erinnerungen-senden.command'), script('scripts/send-reminders.js', ''), 0o755);
  } else {
    const node = t.musl ? 'node' : '"$DIR/runtime/node"';
    const script = (entry, extra) => `#!/bin/sh\n# ${APP_NAME} starten\nDIR="$(cd "$(dirname "$0")" && pwd)"\ncd "$DIR/app" || exit 1\nexec ${node} ${entry} ${extra}"$@"\n`;
    write(path.join(dir, 'Secutest-Pruefmanager.sh'), script('src/server.js', ''), 0o755);
    write(path.join(dir, 'Simulator-ohne-Hardware.sh'), script('src/server.js', '--simulator '), 0o755);
    write(path.join(dir, 'Erinnerungen-senden.sh'), script('scripts/send-reminders.js', ''), 0o755);
  }
  const hints = {
    win32:
      'Doppelklick auf „Secutest-Pruefmanager.cmd“. SmartScreen: „Weitere Informationen“ → „Trotzdem ausführen“. Fragt die Windows-Firewall nach, genügt „Abbrechen“ – das Programm ist nur lokal (127.0.0.1) erreichbar.',
    darwin:
      'Doppelklick auf „Secutest Pruefmanager.app“ (läuft im Hintergrund, Beenden über „Programm beenden“ in der Oberfläche) oder „Secutest-Pruefmanager.command“ (mit Terminalfenster).\r\n  Beim ersten Start: Rechtsklick → „Öffnen“ bzw. Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“.\r\n  Falls macOS den Start weiterhin blockiert, einmalig im Terminal:  xattr -dr com.apple.quarantine <Pfad zu diesem Ordner>',
    linux: 'Im Terminal: ./Secutest-Pruefmanager.sh  – für die serielle Schnittstelle muss der Benutzer in der Gruppe „dialout“ (Arch: „uucp“) sein: sudo usermod -aG dialout $USER, danach neu anmelden.',
  };
  if (t.musl) hints.linux = 'musl-Variante (Alpine, postmarketOS, Void-musl) – benötigt Node.js ≥ 20 der Distribution (Alpine: apk add nodejs). Start: ./Secutest-Pruefmanager.sh  – serielle Schnittstelle: Benutzer in Gruppe „dialout“.';
  write(
    path.join(dir, 'LIESMICH.txt'),
    `${APP_NAME} ${version} – ${target}\r\n\r\nSTART\r\n  ${hints[t.platform]}\r\n\r\nDer Browser öffnet sich automatisch mit http://127.0.0.1:3701\r\nOhne Prüfgerät ausprobieren: „Simulator-ohne-Hardware“ starten.\r\nBeenden: „Programm beenden“ in der Oberfläche oder Strg+C im Terminal.\r\n\r\nUPDATE\r\n  Neue Version herunterladen und entpacken. Deine Datenbanken liegen NICHT in diesem\r\n  Ordner (sondern in OneDrive/iCloud/Dokumente) und bleiben erhalten.\r\n\r\n⚠ HAFTUNGSAUSSCHLUSS\r\n  Prüfungen und Arbeiten an elektrischen Geräten nur durch Elektrofachkräfte.\r\n  Open-Source-Software ohne Gewähr, kann Fehler enthalten. Keine Haftung für\r\n  Personen-, Sach- oder Vermögensschäden. Details: README.md und LICENSE.\r\n`
  );
}

async function main() {
  rm(OUT);
  fs.mkdirSync(OUT, { recursive: true });
  // 1) Anwendung inkl. Produktions-Abhängigkeiten vorbereiten
  const stage = path.join(DIST, 'stage');
  rm(stage);
  fs.mkdirSync(stage, { recursive: true });
  for (const f of ['src', 'public', 'scripts', 'package.json', 'package-lock.json', '.npmrc', 'README.md', 'LICENSE']) {
    if (fs.existsSync(path.join(ROOT, f))) copy(path.join(ROOT, f), path.join(stage, f));
  }
  if (fs.existsSync(path.join(ROOT, 'docs'))) copy(path.join(ROOT, 'docs'), path.join(stage, 'docs'));
  console.log('• npm ci --omit=dev');
  sh(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage });
  const nodeVersion = localNode ? process.version : await resolveNodeVersion();
  console.log(`• Node.js-Laufzeit ${nodeVersion}`);

  const sums = [];
  for (const target of only) {
    const t = TARGETS[target];
    if (!t) throw new Error(`Unbekanntes Ziel ${target}`);
    const name = `Secutest-Pruefmanager-${version}-${target}`;
    const dir = path.join(DIST, name);
    console.log(`• ${name}`);
    rm(dir);
    // macOS: alles liegt im .app-Bundle (Contents/Resources), sonst direkt im Ordner
    const contentDir = t.platform === 'darwin' ? path.join(dir, APP_BUNDLE, 'Contents', 'Resources') : dir;
    copy(stage, path.join(contentDir, 'app'));
    prunePrebuilds(path.join(contentDir, 'app'), t);
    if (t.nodes.length === 0) {
      // musl: Node.js der Distribution
    } else if (localNode) {
      fs.mkdirSync(path.join(contentDir, 'runtime'), { recursive: true });
      fs.copyFileSync(process.execPath, path.join(contentDir, 'runtime', path.basename(process.execPath)));
    } else if (t.nodes.length === 1) {
      await fetchNode(nodeVersion, t.nodes[0], path.join(contentDir, 'runtime'));
    } else {
      for (const n of t.nodes) await fetchNode(nodeVersion, n, path.join(contentDir, 'runtime', n));
    }
    writeLaunchers(dir, target, contentDir);
    if (t.platform !== 'win32') {
      for (const f of ['README.md', 'LICENSE']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    }
    const archive = path.join(OUT, `${name}.${t.archive}`);
    if (t.archive === 'zip') sh('zip', ['-qr', '-y', archive, name], { cwd: DIST });
    else sh('tar', ['-czf', archive, name], { cwd: DIST });
    const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    sums.push(`${hash}  ${path.basename(archive)}`);
    console.log(`  → ${path.relative(ROOT, archive)} (${(fs.statSync(archive).size / 1048576).toFixed(1)} MB)`);
    rm(dir);
  }
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'VERSION.txt'), `${version}\n`);
  rm(stage);
  console.log(`\nFertig: ${OUT}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { TARGETS, makeIcns };
