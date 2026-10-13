#!/usr/bin/env node
'use strict';
/**
 * Baut portable, sofort startbare Pakete (inkl. Node.js-Laufzeit) für
 *   Windows x64, macOS Apple Silicon (arm64), macOS Intel (x64), Linux x64
 *
 *   node scripts/build-release.js                 → alle Plattformen (lädt Node.js von nodejs.org)
 *   node scripts/build-release.js --only linux-x64 --local-node   → nur aktuelle Plattform, ohne Download
 *
 * Die nativen Module (SQLCipher, serialport) bringen vorkompilierte Binärdateien für alle
 * Plattformen mit – daher kann alles auf einem Linux-Rechner (GitHub Actions) gebaut werden.
 * Ergebnis: dist/release/*.zip|*.tar.gz + SHA256SUMS.txt
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'release');
const pkg = require('../package.json');

const TARGETS = {
  'windows-x64': { node: 'win-x64', archive: 'zip', platform: 'win32', arch: 'x64' },
  'macos-arm64': { node: 'darwin-arm64', archive: 'zip', platform: 'darwin', arch: 'arm64' },
  'macos-x64': { node: 'darwin-x64', archive: 'zip', platform: 'darwin', arch: 'x64' },
  'linux-x64': { node: 'linux-x64', archive: 'tar.gz', platform: 'linux', arch: 'x64' },
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

/** Lädt die Node.js-Binärdatei für ein Ziel und legt sie nach runtime/ */
async function fetchNode(nodeVersion, target, destDir) {
  const t = TARGETS[target];
  fs.mkdirSync(destDir, { recursive: true });
  const cache = path.join(DIST, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const base = `node-${nodeVersion}-${t.node}`;
  const file = t.node.startsWith('win') ? `${base}.zip` : t.node.startsWith('linux') ? `${base}.tar.xz` : `${base}.tar.gz`;
  const url = `https://nodejs.org/dist/${nodeVersion}/${file}`;
  const local = path.join(cache, file);
  if (!fs.existsSync(local)) {
    console.log(`  ↓ ${url}`);
    const buf = await fetchBuffer(url);
    // Prüfsumme gegen SHASUMS256.txt von nodejs.org
    const sums = (await fetchBuffer(`https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`)).toString();
    const expected = sums.split('\n').find((l) => l.endsWith(`  ${file}`))?.split(/\s+/)[0];
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (!expected || expected !== actual) throw new Error(`SHA-256 von ${file} stimmt nicht!`);
    fs.writeFileSync(local, buf);
  }
  const tmp = path.join(cache, `x-${target}`);
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
  const sq = path.join(appDir, 'node_modules', 'better-sqlite3-multiple-ciphers', 'prebuilds');
  if (fs.existsSync(sq)) for (const f of fs.readdirSync(sq)) if (!f.startsWith(`${t.platform}-${t.arch}.`)) rm(path.join(sq, f));
  const sp = path.join(appDir, 'node_modules', '@serialport', 'bindings-cpp', 'prebuilds');
  if (fs.existsSync(sp)) for (const d of fs.readdirSync(sp)) if (!(d.startsWith(`${t.platform}-`) && d.includes(t.arch))) rm(path.join(sp, d));
}

function writeLaunchers(dir, target) {
  const t = TARGETS[target];
  if (t.platform === 'win32') {
    const cmd = (extra) => `@echo off\r\nchcp 65001 >nul\r\ntitle Secutest Pruefmanager\r\ncd /d "%~dp0app"\r\n"%~dp0runtime\\node.exe" src\\server.js ${extra}%*\r\nif errorlevel 1 pause\r\n`;
    fs.writeFileSync(path.join(dir, 'Secutest-Pruefmanager.cmd'), cmd(''));
    fs.writeFileSync(path.join(dir, 'Simulator-ohne-Hardware.cmd'), cmd('--simulator '));
    fs.writeFileSync(path.join(dir, 'Erinnerungen-senden.cmd'), `@echo off\r\ncd /d "%~dp0app"\r\n"%~dp0runtime\\node.exe" scripts\\send-reminders.js %*\r\npause\r\n`);
  } else {
    const ext = t.platform === 'darwin' ? '.command' : '.sh';
    const script = (extra) => `#!/bin/sh\n# Secutest Prüfmanager starten\nDIR="$(cd "$(dirname "$0")" && pwd)"\ncd "$DIR/app" || exit 1\nexec "$DIR/runtime/node" src/server.js ${extra}"$@"\n`;
    const files = { [`Secutest-Pruefmanager${ext}`]: script(''), [`Simulator-ohne-Hardware${ext}`]: script('--simulator '), [`Erinnerungen-senden${ext}`]: `#!/bin/sh\nDIR="$(cd "$(dirname "$0")" && pwd)"\ncd "$DIR/app" || exit 1\nexec "$DIR/runtime/node" scripts/send-reminders.js "$@"\n` };
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
      fs.chmodSync(path.join(dir, name), 0o755);
    }
  }
  const hints = {
    win32: 'Doppelklick auf „Secutest-Pruefmanager.cmd“. Beim ersten Start fragt die Windows-Firewall evtl. nach – „Abbrechen“ genügt, das Programm ist nur lokal (127.0.0.1) erreichbar. SmartScreen: „Weitere Informationen“ → „Trotzdem ausführen“.',
    darwin: 'Rechtsklick auf „Secutest-Pruefmanager.command“ → „Öffnen“ (beim ersten Mal wegen Gatekeeper). Falls macOS den Start blockiert, im Terminal einmalig ausführen:\n    xattr -dr com.apple.quarantine <Pfad zu diesem Ordner>',
    linux: 'Im Terminal: ./Secutest-Pruefmanager.sh  – für die serielle Schnittstelle muss der Benutzer in der Gruppe „dialout“ sein (sudo usermod -aG dialout $USER, danach neu anmelden).',
  };
  fs.writeFileSync(
    path.join(dir, 'LIESMICH.txt'),
    `Secutest Prüfmanager ${version} – ${target}\r\n\r\nSTART\r\n  ${hints[t.platform]}\r\n\r\nDer Browser öffnet sich automatisch mit http://127.0.0.1:3701\r\nOhne Prüfgerät ausprobieren: „Simulator-ohne-Hardware“ starten.\r\n\r\nUPDATE\r\n  Neue Version herunterladen und entpacken. Deine Datenbanken liegen NICHT in diesem\r\n  Ordner (sondern in OneDrive/iCloud/Dokumente) und bleiben erhalten.\r\n\r\n⚠ HAFTUNGSAUSSCHLUSS\r\n  Prüfungen und Arbeiten an elektrischen Geräten nur durch Elektrofachkräfte.\r\n  Open-Source-Software ohne Gewähr, kann Fehler enthalten. Keine Haftung für\r\n  Personen-, Sach- oder Vermögensschäden. Details: app/README.md und app/LICENSE.\r\n`
  );
}

async function main() {
  rm(OUT);
  fs.mkdirSync(OUT, { recursive: true });
  // 1) Anwendung inkl. Produktions-Abhängigkeiten vorbereiten
  const stage = path.join(DIST, 'stage');
  rm(stage);
  fs.mkdirSync(stage, { recursive: true });
  for (const f of ['src', 'public', 'scripts', 'package.json', 'package-lock.json', 'README.md', 'LICENSE']) {
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
    copy(stage, path.join(dir, 'app'));
    prunePrebuilds(path.join(dir, 'app'), t);
    if (localNode) {
      fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
      fs.copyFileSync(process.execPath, path.join(dir, 'runtime', path.basename(process.execPath)));
    } else await fetchNode(nodeVersion, target, path.join(dir, 'runtime'));
    writeLaunchers(dir, target);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
