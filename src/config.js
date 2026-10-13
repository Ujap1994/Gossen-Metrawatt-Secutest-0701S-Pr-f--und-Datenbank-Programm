'use strict';
/**
 * Lokale App-Konfiguration (NICHT in der Cloud):
 *  - Liste der bekannten Datenbanken (Pfade)
 *  - Server-Port, zuletzt genutzte serielle Schnittstelle
 *
 * Alles Sensible (Geräte, Prüfungen, SMTP-Passwort, 2FA-Geheimnis) liegt
 * ausschließlich in der jeweiligen Datenbank-Datei (verschlüsselt, sofern ein Passwort gesetzt ist).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const APP_NAME = 'SecutestPruefmanager';
const DB_EXTENSION = '.secudb';

function appDataDir() {
  if (process.env.SECUTEST_HOME) return process.env.SECUTEST_HOME;
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_NAME);
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', APP_NAME);
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'secutest-pruefmanager');
  }
}

const DEFAULTS = {
  server: { host: '127.0.0.1', port: 3701 },
  serial: { path: '', baudRate: 9600 },
  databases: [],
};

let cache = null;

function configFile() {
  return path.join(appDataDir(), 'config.json');
}

function load() {
  if (cache) return cache;
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    data = {};
  }
  cache = {
    ...DEFAULTS,
    ...data,
    server: { ...DEFAULTS.server, ...(data.server || {}) },
    serial: { ...DEFAULTS.serial, ...(data.serial || {}) },
    databases: Array.isArray(data.databases) ? data.databases : [],
  };
  return cache;
}

function save() {
  const cfg = load();
  fs.mkdirSync(appDataDir(), { recursive: true });
  const tmp = configFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, configFile());
}

function update(mutator) {
  const cfg = load();
  mutator(cfg);
  save();
  return cfg;
}

/** Datenbank in der lokalen Liste registrieren (oder aktualisieren). */
function registerDatabase({ name, file }) {
  const abs = path.resolve(file);
  let entry;
  update((cfg) => {
    entry = cfg.databases.find((d) => samePath(d.path, abs));
    if (!entry) {
      entry = { id: crypto.randomBytes(6).toString('hex'), name: name || path.basename(abs, DB_EXTENSION), path: abs };
      cfg.databases.push(entry);
    } else if (name) {
      entry.name = name;
    }
  });
  return entry;
}

function touchDatabase(id) {
  update((cfg) => {
    const d = cfg.databases.find((x) => x.id === id);
    if (d) d.lastOpened = new Date().toISOString();
  });
}

function unregisterDatabase(id) {
  update((cfg) => {
    cfg.databases = cfg.databases.filter((d) => d.id !== id);
  });
}

function findDatabase(id) {
  return load().databases.find((d) => d.id === id) || null;
}

function samePath(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? na.toLowerCase() === nb.toLowerCase()
    : na === nb;
}

/** Nur für Tests: Cache verwerfen. */
function _reset() {
  cache = null;
}

module.exports = {
  APP_NAME,
  DB_EXTENSION,
  appDataDir,
  load,
  save,
  update,
  registerDatabase,
  touchDatabase,
  unregisterDatabase,
  findDatabase,
  samePath,
  _reset,
};
