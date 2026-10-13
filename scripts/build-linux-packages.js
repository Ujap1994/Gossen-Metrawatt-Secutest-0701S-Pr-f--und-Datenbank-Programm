#!/usr/bin/env node
'use strict';
/**
 * Baut aus den Linux-Paketen von build-release.js (linux-x64 / linux-arm64 .tar.gz) die
 * Distributionspakete:
 *   .deb  (Debian, Ubuntu, Linux Mint, Pop!_OS, Raspberry Pi OS)
 *   .rpm  (Fedora, openSUSE, RHEL/Alma/Rocky)
 *   .pkg.tar.zst (Arch, Manjaro, EndeavourOS)
 *   .apk  (Alpine Linux, postmarketOS – musl, nutzt Node.js der Distribution)
 *   .AppImage (universell)
 * und bereitet die Quellen für Flatpak (dist/flatpak-src) und Snap (dist/snap) vor –
 * diese werden im CI mit flatpak-builder bzw. snapcraft gebaut.
 *
 * Benötigt: nfpm (https://nfpm.goreleaser.com) und – für AppImage – appimagetool (wird bei Bedarf geladen).
 *   node scripts/build-linux-packages.js [--skip-appimage] [--arch x64|arm64]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'release');
const WORK = path.join(DIST, 'linux');
const pkg = require('../package.json');
const APP_ID = 'io.github.pruefmanager.Secutest';

const args = process.argv.slice(2);
const skipAppImage = args.includes('--skip-appimage');
const onlyArch = args.includes('--arch') ? args[args.indexOf('--arch') + 1] : null;
const version = fs.readFileSync(path.join(OUT, 'VERSION.txt'), 'utf8').trim();
const release = process.env.GITHUB_RUN_NUMBER || '0';

const ARCHS = {
  x64: { nfpm: 'amd64', appimage: 'x86_64' },
  arm64: { nfpm: 'arm64', appimage: 'aarch64' },
};

const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { stdio: 'inherit', ...opts });
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });

function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode) fs.chmodSync(file, mode);
}

function tool(envName, name) {
  if (process.env[envName]) return process.env[envName];
  try {
    execFileSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' });
    return name;
  } catch {
    return null;
  }
}

async function appimagetool() {
  const t = tool('APPIMAGETOOL', 'appimagetool');
  if (t) return t;
  const file = path.join(DIST, 'cache', 'appimagetool-x86_64.AppImage');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const url = 'https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage';
    console.log(`  ↓ ${url}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`appimagetool konnte nicht geladen werden (${r.status})`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    fs.chmodSync(file, 0o755);
  }
  return file;
}

function metainfo(launchable) {
  return fs
    .readFileSync(path.join(ROOT, 'packaging', 'linux', 'secutest-pruefmanager.metainfo.xml'), 'utf8')
    .replace('@VERSION@', pkg.version)
    .replace('@DATE@', new Date().toISOString().slice(0, 10))
    .replace('<launchable type="desktop-id">secutest-pruefmanager.desktop</launchable>', `<launchable type="desktop-id">${launchable}</launchable>`);
}

/** Tarball entpacken → Verzeichnis mit app/ und runtime/ */
function extract(arch) {
  const tarball = path.join(OUT, `Secutest-Pruefmanager-${version}-linux-${arch}.tar.gz`);
  if (!fs.existsSync(tarball)) return null;
  const dir = path.join(WORK, arch);
  rm(dir);
  fs.mkdirSync(dir, { recursive: true });
  sh('tar', ['-xzf', tarball, '-C', dir]);
  const top = path.join(dir, `Secutest-Pruefmanager-${version}-linux-${arch}`);
  const stage = path.join(dir, 'opt');
  fs.mkdirSync(stage);
  for (const d of ['app', 'runtime']) fs.renameSync(path.join(top, d), path.join(stage, d));
  rm(top);
  return stage;
}

function nfpmPackages(arch, stage, nfpm) {
  const meta = path.join(WORK, 'metainfo.xml');
  write(meta, metainfo('secutest-pruefmanager.desktop'));
  // Platzhalter selbst ersetzen (nfpm expandiert Umgebungsvariablen nicht in allen Feldern)
  const vars = { NFPM_ARCH: ARCHS[arch].nfpm, PKG_VERSION: pkg.version, PKG_RELEASE: release, PKG_STAGE: stage, PKG_METAINFO: meta };
  const cfg = path.join(WORK, `nfpm-${arch}.yaml`);
  write(cfg, fs.readFileSync(path.join(ROOT, 'packaging', 'linux', 'nfpm.yaml'), 'utf8').replace(/\$\{(\w+)\}/g, (m, k) => vars[k] ?? m));
  for (const packager of ['deb', 'rpm', 'archlinux']) {
    console.log(`  • ${packager} (${arch})`);
    sh(nfpm, ['pkg', '--config', cfg, '--packager', packager, '--target', OUT + path.sep], { cwd: ROOT });
  }
}

async function appImage(arch, stage) {
  const a = ARCHS[arch].appimage;
  const appDir = path.join(WORK, `AppDir-${arch}`);
  rm(appDir);
  fs.mkdirSync(path.join(appDir, 'usr', 'lib'), { recursive: true });
  fs.cpSync(stage, path.join(appDir, 'usr', 'lib', 'secutest-pruefmanager'), { recursive: true, verbatimSymlinks: true });
  write(
    path.join(appDir, 'AppRun'),
    '#!/bin/sh\n# Secutest Prüfmanager (AppImage)\nHERE="$(dirname "$(readlink -f "$0")")"\nexec "$HERE/usr/lib/secutest-pruefmanager/runtime/node" "$HERE/usr/lib/secutest-pruefmanager/app/src/server.js" "$@"\n',
    0o755
  );
  fs.copyFileSync(path.join(ROOT, 'packaging', 'linux', 'secutest-pruefmanager.desktop'), path.join(appDir, 'secutest-pruefmanager.desktop'));
  fs.copyFileSync(path.join(ROOT, 'packaging', 'icons', 'icon-256.png'), path.join(appDir, 'secutest-pruefmanager.png'));
  fs.copyFileSync(path.join(ROOT, 'packaging', 'icons', 'icon-256.png'), path.join(appDir, '.DirIcon'));
  const out = path.join(OUT, `Secutest-Pruefmanager-${version}-${a}.AppImage`);
  console.log(`  • AppImage (${a})`);
  sh(await appimagetool(), ['--no-appstream', appDir, out], { env: { ...process.env, ARCH: a, APPIMAGE_EXTRACT_AND_RUN: '1' } });
  fs.chmodSync(out, 0o755);
}

/** Quellen für flatpak-builder (packaging/flatpak/*.yml verweist auf dist/flatpak-src) */
function flatpakSource(stage) {
  const dir = path.join(DIST, 'flatpak-src');
  rm(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(stage, dir, { recursive: true, verbatimSymlinks: true });
  write(path.join(dir, 'secutest-pruefmanager.sh'), '#!/bin/sh\nexec /app/lib/secutest-pruefmanager/runtime/node /app/lib/secutest-pruefmanager/app/src/server.js "$@"\n', 0o755);
  const desktop = fs.readFileSync(path.join(ROOT, 'packaging', 'linux', 'secutest-pruefmanager.desktop'), 'utf8').replace('Icon=secutest-pruefmanager', `Icon=${APP_ID}`);
  write(path.join(dir, `${APP_ID}.desktop`), desktop);
  write(path.join(dir, `${APP_ID}.metainfo.xml`), metainfo(`${APP_ID}.desktop`));
  for (const f of ['icon.svg', 'icon-128.png', 'icon-256.png', 'icon-512.png']) fs.copyFileSync(path.join(ROOT, 'packaging', 'icons', f), path.join(dir, f));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'));
}

/** Alpine-Paket aus dem musl-Tarball (ohne gebündeltes Node.js) */
function alpinePackage(arch, nfpm) {
  const tarball = path.join(OUT, `Secutest-Pruefmanager-${version}-linux-musl-${arch}.tar.gz`);
  if (!fs.existsSync(tarball)) return;
  const dir = path.join(WORK, `musl-${arch}`);
  rm(dir);
  fs.mkdirSync(dir, { recursive: true });
  sh('tar', ['-xzf', tarball, '-C', dir]);
  const stage = path.join(dir, `Secutest-Pruefmanager-${version}-linux-musl-${arch}`);
  const vars = { NFPM_ARCH: ARCHS[arch].nfpm, PKG_VERSION: pkg.version, PKG_RELEASE: release, PKG_STAGE: stage };
  const cfg = path.join(WORK, `nfpm-alpine-${arch}.yaml`);
  write(cfg, fs.readFileSync(path.join(ROOT, 'packaging', 'linux', 'nfpm-alpine.yaml'), 'utf8').replace(/\$\{(\w+)\}/g, (m, k) => vars[k] ?? m));
  console.log(`  • apk / Alpine (${arch})`);
  sh(nfpm, ['pkg', '--config', cfg, '--packager', 'apk', '--target', OUT + path.sep], { cwd: ROOT });
}

/** snapcraft-Projekt (classic confinement – Zugriff auf serielle Schnittstellen) */
function snapProject(stage) {
  const dir = path.join(DIST, 'snap');
  rm(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.cpSync(stage, path.join(dir, 'src'), { recursive: true, verbatimSymlinks: true });
  write(path.join(dir, 'src', 'bin', 'secutest-pruefmanager'), '#!/bin/sh\nexec "$SNAP/runtime/node" "$SNAP/app/src/server.js" "$@"\n', 0o755);
  write(
    path.join(dir, 'snap', 'snapcraft.yaml'),
    `name: secutest-pruefmanager
base: core24
version: '${pkg.version}'
summary: Geräteprüfung DIN VDE 0701/0702 mit dem Gossen Metrawatt SECUTEST 0701S
description: |
  Freies Prüf- und Datenbankprogramm für den SECUTEST 0701S: RS-232-Steuerung,
  grafisch geführte Prüfabläufe je Schutzklasse, verschlüsselte Datenbank,
  Zwei-Faktor-Anmeldung, Prüferinnerungen, Protokolle und Prüfplaketten.
  Open-Source-Software ohne Gewähr – Prüfungen nur durch Elektrofachkräfte.
grade: stable
confinement: classic
license: MIT
platforms:
  amd64:
apps:
  secutest-pruefmanager:
    command: bin/secutest-pruefmanager
parts:
  app:
    plugin: dump
    source: src/
lint:
  ignore:
    - classic
    - library
`
  );
  const desktop = fs
    .readFileSync(path.join(ROOT, 'packaging', 'linux', 'secutest-pruefmanager.desktop'), 'utf8')
    .replace('Icon=secutest-pruefmanager', 'Icon=${SNAP}/meta/gui/secutest-pruefmanager.png');
  write(path.join(dir, 'snap', 'gui', 'secutest-pruefmanager.desktop'), desktop);
  fs.copyFileSync(path.join(ROOT, 'packaging', 'icons', 'icon-256.png'), path.join(dir, 'snap', 'gui', 'secutest-pruefmanager.png'));
}

async function main() {
  const nfpm = tool('NFPM', 'nfpm');
  if (!nfpm) throw new Error('nfpm nicht gefunden (go install github.com/goreleaser/nfpm/v2/cmd/nfpm@latest oder Umgebungsvariable NFPM)');
  fs.mkdirSync(WORK, { recursive: true });
  for (const arch of Object.keys(ARCHS)) {
    if (onlyArch && onlyArch !== arch) continue;
    const stage = extract(arch);
    if (!stage) {
      console.log(`– linux-${arch}.tar.gz nicht vorhanden, übersprungen`);
      continue;
    }
    console.log(`• Linux ${arch}`);
    nfpmPackages(arch, stage, nfpm);
    if (!skipAppImage && os.arch() === 'x64') {
      try {
        await appImage(arch, stage);
      } catch (e) {
        if (arch === 'x64') throw e;
        console.warn(`  ⚠ AppImage ${arch} fehlgeschlagen: ${e.message}`);
      }
    }
    if (arch === 'x64') {
      flatpakSource(stage);
      snapProject(stage);
    }
  }
  for (const arch of Object.keys(ARCHS)) if (!onlyArch || onlyArch === arch) alpinePackage(arch, nfpm);
  // Prüfsummen ergänzen
  const sumsFile = path.join(OUT, 'SHA256SUMS.txt');
  const known = new Set(fs.readFileSync(sumsFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/\s+/)[1]));
  const add = [];
  for (const f of fs.readdirSync(OUT)) {
    if (known.has(f) || /^(SHA256SUMS|VERSION)\.txt$/.test(f)) continue;
    add.push(`${crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex')}  ${f}`);
  }
  fs.appendFileSync(sumsFile, add.map((l) => l + '\n').join(''));
  rm(WORK);
  console.log('\nLinux-Pakete:');
  for (const f of fs.readdirSync(OUT).filter((f) => /\.(deb|rpm|zst|apk|AppImage)$/.test(f))) console.log(`  ${f} (${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
