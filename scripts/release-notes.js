#!/usr/bin/env node
'use strict';
/**
 * Erzeugt die Release-Notizen (Markdown) für GitHub:
 *  - Download-Tabelle aller Pakete, die tatsächlich im Release-Ordner liegen
 *  - neuester Abschnitt aus CHANGELOG.md – inkl. Bilder (relative Pfade → raw.githubusercontent-URLs)
 *  - Haftungsausschluss
 *
 *   node scripts/release-notes.js <version> <release-ordner>          Notizen ausgeben
 *   node scripts/release-notes.js <version> <release-ordner> --check  prüfen, ob alle Pflichtpakete da sind
 *
 * Die Download-Tabelle enthält nur Dateien, die wirklich im Release liegen. Pflichtpakete müssen
 * vorhanden sein, sonst wird nicht veröffentlicht; optionale (eigene Build-Schritte, die ausnahmsweise
 * scheitern können) werden andernfalls unter „Diesmal nicht enthalten“ genannt.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const checkOnly = process.argv.includes('--check');
const [version = 'lokal', dir = path.join(ROOT, 'dist', 'release')] = args;
const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
const repo = process.env.GITHUB_REPOSITORY || '';
const sha = process.env.GITHUB_SHA || 'main';

const find = (re) => files.find((f) => re.test(f));
const PACKAGES = [
  ['Windows 10/11 (x64)', /-windows-x64\.zip$/, 'Entpacken → `Secutest-Pruefmanager.cmd` doppelklicken'],
  ['Windows 11 ARM64 (Snapdragon / Surface)', /-windows-arm64\.zip$/, 'Entpacken → `Secutest-Pruefmanager.cmd` doppelklicken'],
  ['macOS Universal (Apple Silicon + Intel)', /-macos-universal\.zip$/, 'Entpacken → `Secutest Pruefmanager.app` (Rechtsklick → Öffnen)'],
  ['macOS Apple Silicon (M1–M4)', /-macos-arm64\.zip$/, 'Entpacken → `Secutest Pruefmanager.app` (kleinerer Download)'],
  ['macOS Intel', /-macos-x64\.zip$/, 'Entpacken → `Secutest Pruefmanager.app` (kleinerer Download)'],
  ['Ubuntu / Linux Mint / Debian / Pop!_OS (x64)', /_amd64\.deb$/, '`sudo apt install ./<datei>.deb`'],
  ['Raspberry Pi OS / Ubuntu ARM64', /_arm64\.deb$/, '`sudo apt install ./<datei>.deb`'],
  ['Fedora / openSUSE / RHEL (x64)', /\.x86_64\.rpm$/, '`sudo dnf install ./<datei>.rpm`'],
  ['Fedora / openSUSE ARM64', /\.aarch64\.rpm$/, '`sudo dnf install ./<datei>.rpm`'],
  ['Arch / Manjaro / EndeavourOS (x64)', /-x86_64\.pkg\.tar\.zst$/, '`sudo pacman -U <datei>`'],
  ['Arch Linux ARM (aarch64)', /-aarch64\.pkg\.tar\.zst$/, '`sudo pacman -U <datei>`'],
  ['Alpine Linux / postmarketOS (x64)', /_x86_64\.apk$/, '`sudo apk add --allow-untrusted <datei>.apk` (nutzt `nodejs` der Distribution)'],
  ['Alpine Linux / postmarketOS (ARM64)', /_aarch64\.apk$/, '`sudo apk add --allow-untrusted <datei>.apk`'],
  ['Snap (Ubuntu & alle Distributionen mit snapd, x64)', /\.snap$/, '`sudo snap install --dangerous --classic <datei>.snap`', false],
  ['Flatpak (alle Distributionen, x64)', /\.flatpak$/, '`flatpak install --user <datei>.flatpak`', false],
  ['AppImage (alle Distributionen, x64)', /-x86_64\.AppImage$/, '`chmod +x <datei>` und starten'],
  ['AppImage (ARM64)', /-aarch64\.AppImage$/, '`chmod +x <datei>` und starten', false],
  ['Linux portabel (x64)', /-linux-x64\.tar\.gz$/, '`tar xzf …` → `./Secutest-Pruefmanager.sh`'],
  ['Linux portabel (ARM64)', /-linux-arm64\.tar\.gz$/, '`tar xzf …` → `./Secutest-Pruefmanager.sh`'],
  ['Linux portabel, musl (x64, z. B. Void musl)', /-linux-musl-x64\.tar\.gz$/, 'Node.js ≥ 20 installieren → `./Secutest-Pruefmanager.sh`'],
  ['Linux portabel, musl (ARM64)', /-linux-musl-arm64\.tar\.gz$/, 'Node.js ≥ 20 installieren → `./Secutest-Pruefmanager.sh`'],
];

function latestChangelog() {
  const file = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(file)) return '';
  const text = fs.readFileSync(file, 'utf8');
  const parts = text.split(/^## /m);
  if (parts.length < 2) return '';
  let section = '## ' + parts[1].trim();
  // Bilder/Links relativ zum Repo → absolute URLs (in Release-Notizen funktionieren keine relativen Pfade)
  if (repo) {
    section = section
      .replace(/(!\[[^\]]*\]\()(?!https?:)([^)]+)\)/g, (m, a, p) => `${a}https://raw.githubusercontent.com/${repo}/${sha}/${p.replace(/^\.\//, '')})`)
      .replace(/(<img[^>]+src=")(?!https?:)([^"]+)"/g, (m, a, p) => `${a}https://raw.githubusercontent.com/${repo}/${sha}/${p.replace(/^\.\//, '')}"`);
  }
  return section.replace(/^### /gm, '#### ').replace(/^## /, '### ');
}

const rows = PACKAGES.map(([sys, re, how]) => {
  const f = find(re);
  return f ? `| ${sys} | \`${f}\` | ${how} |` : null;
}).filter(Boolean);
const missing = PACKAGES.filter(([, re]) => !find(re));
const missingRequired = missing.filter(([, , , required = true]) => required);

if (checkOnly) {
  console.log(`${PACKAGES.length - missing.length} von ${PACKAGES.length} Paketen vorhanden.`);
  for (const [sys, , , required = true] of missing) console.log(`  ${required ? '✘ FEHLT (Pflicht)' : '– fehlt (optional)'}: ${sys}`);
  if (missingRequired.length) {
    console.error(`\nNicht veröffentlichen: ${missingRequired.length} Pflichtpaket(e) fehlen.`);
    process.exit(1);
  }
  process.exit(0);
}

const out = `## Secutest Prüfmanager ${version}

> ⚠ **Haftungsausschluss:** Prüfungen und Arbeiten an elektrischen Geräten dürfen nur von Elektrofachkräften durchgeführt werden. Open-Source-Software ohne Gewähr – sie kann Fehler enthalten. Keine Haftung für Personen-, Sach- oder Vermögensschäden.

${latestChangelog()}

### Download – passendes Paket wählen
| System | Datei | Installation / Start |
|---|---|---|
${rows.join('\n')}
${missing.length ? `\n_Diesmal nicht enthalten (Build-Schritt fehlgeschlagen): ${missing.map(([sys]) => sys).join(', ')}._\n` : ''}
Node.js ist in allen Paketen enthalten – keine weitere Installation nötig (Ausnahme: Alpine/musl nutzen das Node.js der Distribution). Ohne Prüfgerät testen: „Simulator-ohne-Hardware“ starten bzw. \`secutest-pruefmanager --simulator\`.
Linux: Für den USB-RS232-Adapter den Benutzer in die Gruppe \`dialout\` (Arch: \`uucp\`) aufnehmen. Prüfsummen: \`SHA256SUMS.txt\`.
`;

process.stdout.write(out);
