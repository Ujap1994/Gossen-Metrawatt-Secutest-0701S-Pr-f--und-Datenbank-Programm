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
// [System, Dateimuster, Installation, Pflicht (Standard: ja)] – Dateinamen von electron-builder (package.json → build)
const PACKAGES = [
  ['Windows 10/11 – Installer (x64)', /-win-x64-setup\.exe$/, 'Doppelklick, Installation ohne Administratorrechte'],
  ['Windows 11 ARM64 – Installer (Snapdragon / Surface)', /-win-arm64-setup\.exe$/, 'Doppelklick, Installation ohne Administratorrechte'],
  ['Windows – Installer für x64 und ARM64 (wählt selbst)', /-win-setup\.exe$/, 'Doppelklick (größerer Download)', false],
  ['Windows portabel (x64)', /-win-x64-portable\.exe$/, 'Ohne Installation starten, z. B. vom USB-Stick'],
  ['Windows portabel (ARM64)', /-win-arm64-portable\.exe$/, 'Ohne Installation starten'],
  ['macOS Universal (Apple Silicon + Intel)', /-mac-universal\.dmg$/, 'Öffnen → in „Programme“ ziehen (beim ersten Start Rechtsklick → Öffnen)'],
  ['macOS Apple Silicon (M1–M4)', /-mac-arm64\.dmg$/, 'Öffnen → in „Programme“ ziehen (kleinerer Download)'],
  ['macOS Intel', /-mac-x64\.dmg$/, 'Öffnen → in „Programme“ ziehen (kleinerer Download)'],
  ['macOS als ZIP (Universal / Apple Silicon / Intel)', /-mac-universal\.zip$/, 'Entpacken → `Secutest Pruefmanager.app`', false],
  ['Ubuntu / Linux Mint / Debian / Pop!_OS (x64)', /-linux-amd64\.deb$/, '`sudo apt install ./<datei>.deb`'],
  ['Raspberry Pi OS / Ubuntu ARM64', /-linux-arm64\.deb$/, '`sudo apt install ./<datei>.deb`'],
  ['Fedora / openSUSE / RHEL (x64)', /-linux-x86_64\.rpm$/, '`sudo dnf install ./<datei>.rpm`'],
  ['Fedora / openSUSE ARM64', /-linux-aarch64\.rpm$/, '`sudo dnf install ./<datei>.rpm`'],
  ['Arch / Manjaro / EndeavourOS (x64)', /-linux-(x64|x86_64)\.pacman$/, '`sudo pacman -U <datei>.pacman`'],
  ['Arch Linux ARM (aarch64)', /-linux-(arm64|aarch64)\.pacman$/, '`sudo pacman -U <datei>.pacman`'],
  ['Snap (alle Distributionen mit snapd, x64)', /\.snap$/, '`sudo snap install --dangerous <datei>.snap`', false],
  ['Flatpak (alle Distributionen, x64)', /\.flatpak$/, '`flatpak install --user <datei>.flatpak`', false],
  ['AppImage (alle Distributionen, x64)', /-linux-x86_64\.AppImage$/, '`chmod +x <datei>` und starten'],
  ['AppImage (ARM64)', /-linux-arm64\.AppImage$/, '`chmod +x <datei>` und starten'],
  ['Linux portabel (x64)', /-linux-x64\.tar\.gz$/, '`tar xzf …` → `./secutest-pruefmanager`'],
  ['Linux portabel (ARM64)', /-linux-arm64\.tar\.gz$/, '`tar xzf …` → `./secutest-pruefmanager`'],
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
Desktop-Programm mit eigenem Fenster – keine weitere Installation nötig. Ohne Prüfgerät testen: \`secutest-pruefmanager --simulator\` (macOS: \`open -a "Secutest Pruefmanager" --args --simulator\`).
Linux: Für den USB-RS232-Adapter den Benutzer in die Gruppe \`dialout\` (Arch: \`uucp\`) aufnehmen. Prüfsummen: \`SHA256SUMS.txt\`.
`;

process.stdout.write(out);
