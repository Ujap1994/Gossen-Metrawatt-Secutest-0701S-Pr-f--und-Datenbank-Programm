#!/usr/bin/env node
'use strict';
/**
 * Selbsttest eines gepackten Desktop-Programms – ohne Fenster, daher auch in Containern ohne Bildschirm:
 * startet die Programmdatei im Node-Modus (ELECTRON_RUN_AS_NODE) mit src/server.js aus dem App-Archiv
 * und prüft SQLCipher, serialport und den Simulator.
 *
 *   node scripts/selftest-packaged.js "dist/electron/mac-arm64/Secutest Pruefmanager.app"
 *   node scripts/selftest-packaged.js dist/electron/win-unpacked
 *   node scripts/selftest-packaged.js "/opt/Secutest Pruefmanager"        (installiertes deb/rpm/pacman)
 *
 * Ohne Node.js (z. B. in Distributions-Containern) dasselbe von Hand:
 *   ELECTRON_RUN_AS_NODE=1 "<Programm>" "<resources>/app.asar/src/server.js" --selftest
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function locate(dir) {
  const abs = path.resolve(dir);
  if (abs.endsWith('.app')) {
    const macos = path.join(abs, 'Contents', 'MacOS');
    return { exe: path.join(macos, fs.readdirSync(macos)[0]), resources: path.join(abs, 'Contents', 'Resources') };
  }
  const resources = path.join(abs, 'resources');
  const exe = fs.readdirSync(abs).map((f) => path.join(abs, f)).find((f) => (process.platform === 'win32' ? /\.exe$/i.test(f) && !/uninstall/i.test(f) : /secutest-pruefmanager$/.test(f)));
  return { exe, resources };
}

const dir = process.argv[2];
if (!dir) {
  console.error('Aufruf: node scripts/selftest-packaged.js <Programmordner oder .app>');
  process.exit(2);
}
const { exe, resources } = locate(dir);
const server = path.join(resources, 'app.asar', 'src', 'server.js');
if (!exe || !fs.existsSync(exe) || !fs.existsSync(path.join(resources, 'app.asar'))) {
  console.error(`Kein gepacktes Programm gefunden in ${dir} (Programm: ${exe || '–'}, Archiv: ${path.join(resources, 'app.asar')})`);
  process.exit(2);
}
console.log(`Selbsttest: ${exe}`);
const r = spawnSync(exe, [server, '--selftest'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
process.exit(r.status ?? 1);
