'use strict';
/**
 * Erkennung von OneDrive- und iCloud-Drive-Ordnern auf Windows, macOS und Linux.
 * Die Datenbank wird einfach als Datei in einen dieser Ordner gelegt – der
 * jeweilige Sync-Client (OneDrive / iCloud) sorgt für die Verfügbarkeit auf
 * allen Rechnern.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { APP_NAME, DB_EXTENSION } = require('../config');

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listDir(p) {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

/** Liefert alle gefundenen Cloud-Speicherorte als [{provider, label, root, folder}] */
function detectCloudLocations() {
  const home = os.homedir();
  const found = [];
  const add = (provider, label, root) => {
    if (!root || !isDir(root)) return;
    if (found.some((f) => path.resolve(f.root) === path.resolve(root))) return;
    found.push({ provider, label, root, folder: path.join(root, APP_NAME) });
  };

  // ---- OneDrive ----
  for (const env of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    if (process.env[env]) add('onedrive', `OneDrive (${env === 'OneDriveCommercial' ? 'Geschäftlich' : 'Privat'})`, process.env[env]);
  }
  add('onedrive', 'OneDrive', path.join(home, 'OneDrive'));
  // macOS: ~/Library/CloudStorage/OneDrive-Persönlich, OneDrive-Firma …
  const cloudStorage = path.join(home, 'Library', 'CloudStorage');
  for (const entry of listDir(cloudStorage)) {
    if (/^OneDrive/i.test(entry)) add('onedrive', entry.replace(/-/, ' – '), path.join(cloudStorage, entry));
    if (/^iCloud/i.test(entry)) add('icloud', 'iCloud Drive', path.join(cloudStorage, entry));
  }
  // Windows: weitere "OneDrive - Firma" Ordner im Benutzerprofil
  for (const entry of listDir(home)) {
    if (/^OneDrive - /i.test(entry)) add('onedrive', entry, path.join(home, entry));
  }

  // ---- iCloud Drive ----
  add('icloud', 'iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
  add('icloud', 'iCloud Drive (Windows)', path.join(home, 'iCloudDrive'));
  if (process.env.USERPROFILE) add('icloud', 'iCloud Drive (Windows)', path.join(process.env.USERPROFILE, 'iCloudDrive'));

  return found;
}

/** Lokaler Fallback-Ordner, falls keine Cloud gefunden wurde. */
function localFolder() {
  return path.join(os.homedir(), 'Documents', APP_NAME);
}

/** Sucht in allen Cloud-Ordnern (+ lokal) nach vorhandenen Datenbank-Dateien. */
function discoverDatabases() {
  const folders = [...detectCloudLocations().map((l) => ({ ...l })), { provider: 'local', label: 'Lokal (Dokumente)', folder: localFolder() }];
  const result = [];
  for (const loc of folders) {
    for (const file of listDir(loc.folder)) {
      if (file.toLowerCase().endsWith(DB_EXTENSION)) {
        result.push({ provider: loc.provider, label: loc.label, path: path.join(loc.folder, file), name: path.basename(file, DB_EXTENSION) });
      }
    }
  }
  return result;
}

function providerForPath(p) {
  const abs = path.resolve(p).toLowerCase();
  if (abs.includes('onedrive')) return 'onedrive';
  if (abs.includes('icloud') || abs.includes('mobile documents')) return 'icloud';
  return 'local';
}

module.exports = { detectCloudLocations, discoverDatabases, localFolder, providerForPath };
