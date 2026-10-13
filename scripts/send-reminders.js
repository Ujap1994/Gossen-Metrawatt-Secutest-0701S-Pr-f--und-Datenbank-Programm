#!/usr/bin/env node
'use strict';
/**
 * Prüferinnerungen ohne geöffnete Oberfläche versenden – z. B. täglich per
 * Windows-Aufgabenplanung, macOS launchd oder cron.
 *
 *   npm run reminders -- --db "Meine Geräte"            (Name oder Pfad der Datenbank)
 *   npm run reminders -- --db pfad/zur/datei.secudb --dry-run
 *
 * Passwort: Umgebungsvariable SECUTEST_DB_PASSWORD oder interaktive Eingabe.
 *
 * ⚠ Sicherheitshinweis: Für den unbeaufsichtigten Betrieb muss das Datenbank-Passwort
 * auf dem Rechner hinterlegt werden (z. B. in der Aufgabe). Die Zwei-Faktor-Anmeldung
 * gilt nur für die Oberfläche. Nur auf einem eigenen, geschützten Rechner verwenden –
 * alternativ die Kalender-Erinnerungen (.ics) nutzen, die ganz ohne Programm funktionieren.
 */
const path = require('path');
const readline = require('readline');
const config = require('../src/config');
const { openDatabase } = require('../src/db/database');
const { runReminders } = require('../src/reminders/scheduler');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = true;
    rl._writeToOutput = function write(s) {
      if (!rl.stdoutMuted || s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const dbArg = arg('--db');
  const dryRun = process.argv.includes('--dry-run');
  const dbs = config.load().databases;
  if (!dbArg) {
    console.log('Verwendung: npm run reminders -- --db "<Name oder Pfad>" [--dry-run]\n\nBekannte Datenbanken:');
    for (const d of dbs) console.log(`  • ${d.name}  (${d.path})`);
    process.exit(1);
  }
  const entry = dbs.find((d) => d.name === dbArg || d.id === dbArg);
  const file = entry ? entry.path : path.resolve(dbArg);
  const password = process.env.SECUTEST_DB_PASSWORD || (await askHidden(`Passwort für ${path.basename(file)}: `));
  let sdb;
  try {
    sdb = openDatabase(file, password, { force: true });
  } catch (e) {
    console.error(`Fehler: ${e.message}`);
    process.exit(2);
  }
  try {
    const r = await runReminders(sdb, { dryRun });
    if (r.skipped) console.log(`Übersprungen: ${r.skipped}`);
    else if (r.error) {
      console.error(`Versand fehlgeschlagen: ${r.error}`);
      process.exitCode = 3;
    } else if (dryRun) console.log(`${r.count} Gerät(e) würden erinnert: ${r.devices.map((d) => d.name).join(', ') || '—'}`);
    else console.log(r.sent ? `Erinnerung für ${r.count} Gerät(e) versendet.` : 'Nichts fällig.');
  } finally {
    sdb.close();
  }
}

main();
