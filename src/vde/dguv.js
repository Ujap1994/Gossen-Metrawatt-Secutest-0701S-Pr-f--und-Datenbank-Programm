'use strict';
/**
 * Prüffristen-Vorschlag für ortsveränderliche elektrische Betriebsmittel nach
 * DGUV Vorschrift 3, Durchführungsanweisung zu § 5, Tabelle 1B:
 *
 *   Richtwert 6 Monate, auf Baustellen 3 Monate (DGUV Information 203-005).
 *   Wird bei den Prüfungen eine Fehlerquote < 2 % erreicht, kann die Prüffrist entsprechend
 *   verlängert werden. Maximalwerte: Baustellen, Fertigungsstätten, Werkstätten oder unter
 *   ähnlichen Bedingungen 1 Jahr; Büros oder unter ähnlichen Bedingungen 2 Jahre.
 *
 * Für Privathaushalte gilt die DGUV V3 nicht – dort ist der Wert eine Empfehlung.
 * Maßgeblich bleibt immer die Gefährdungsbeurteilung des Betreibers (BetrSichV, TRBS 1201).
 */

const ENVIRONMENTS = {
  baustelle: { label: 'Baustelle, Montage, Außeneinsatz', base: 3, max: 12, dguv: true, note: 'Baustellen: Richtwert 3 Monate (DGUV Information 203-005)' },
  werkstatt: { label: 'Werkstatt, Fertigung, Lager, Landwirtschaft, gewerbliche Küche', base: 6, max: 12, dguv: true, note: 'Fertigungsstätten/Werkstätten: Richtwert 6 Monate, höchstens 1 Jahr' },
  buero: { label: 'Büro, Verwaltung, Schule, Praxis, Hotelzimmer', base: 6, max: 24, dguv: true, note: 'Büros und ähnliche Bedingungen: Richtwert 6 Monate, höchstens 2 Jahre' },
  privat: { label: 'Privathaushalt (keine DGUV-Pflicht)', base: 12, max: 24, dguv: false, note: 'Privathaushalt: keine gesetzliche Pflicht – Empfehlung 12 Monate, bei seltener Nutzung bis 24 Monate' },
};

const MAX_FAIL_RATE = 0.02; // 2 %
const MIN_SAMPLE = 10; // darunter ist die Fehlerquote nicht aussagekräftig

/**
 * Fehlerquote aus der Datenbank: Prüfungen der letzten 24 Monate (ohne abgebrochene),
 * für den Einsatzbereich – oder für alle Geräte, wenn env leer ist.
 */
function failureStats(sdb, env, { months = 24, today } = {}) {
  const d = today ? new Date(today + 'T00:00:00') : new Date();
  d.setMonth(d.getMonth() - months);
  const from = d.toISOString().slice(0, 10);
  const row = sdb.db
    .prepare(
      `SELECT count(*) AS n, sum(CASE WHEN i.result = 'nicht_bestanden' THEN 1 ELSE 0 END) AS failed
         FROM inspections i JOIN devices dv ON dv.id = i.device_id
        WHERE i.result != 'abgebrochen' AND i.inspection_date >= @from ${env ? 'AND dv.usage_env = @env' : ''}`
    )
    .get({ from, env: env || null });
  const n = row.n || 0;
  const failed = row.failed || 0;
  return { n, failed, rate: n ? failed / n : null, from };
}

/**
 * Vorschlag für ein Gerät.
 * @returns {{months:number, base:number, max:number, env:string|null, reasons:string[], stats:object, dguv:boolean}}
 */
function suggestInterval(sdb, device, { defaultEnv = 'privat' } = {}) {
  const envKey = ENVIRONMENTS[device.usage_env] ? device.usage_env : ENVIRONMENTS[defaultEnv] ? defaultEnv : 'privat';
  const env = ENVIRONMENTS[envKey];
  const stats = failureStats(sdb, device.usage_env ? envKey : null);
  const reasons = [env.note];
  let months = env.base;
  const ownFailures = sdb.db.prepare("SELECT count(*) AS n FROM inspections WHERE device_id = ? AND result = 'nicht_bestanden'").get(device.id || 0).n;
  if (!device.usage_env) reasons.push(`Kein Einsatzbereich hinterlegt – angenommen: ${env.label}.`);
  if (stats.n < MIN_SAMPLE) {
    reasons.push(`Erst ${stats.n} Prüfung(en) in den letzten 24 Monaten – für eine Verlängerung sind mindestens ${MIN_SAMPLE} nötig, damit die Fehlerquote aussagekräftig ist.`);
  } else if (stats.rate < MAX_FAIL_RATE) {
    months = env.max;
    reasons.push(`Fehlerquote ${(stats.rate * 100).toFixed(1).replace('.', ',')} % (${stats.failed} von ${stats.n}) liegt unter 2 % → Verlängerung bis zum Maximalwert möglich.`);
  } else {
    reasons.push(`Fehlerquote ${(stats.rate * 100).toFixed(1).replace('.', ',')} % (${stats.failed} von ${stats.n}) liegt bei 2 % oder darüber → Richtwert beibehalten.`);
  }
  if (ownFailures > 0 && months > env.base) {
    months = env.base;
    reasons.push('Dieses Gerät ist schon einmal durchgefallen → Richtwert statt Verlängerung.');
  }
  if (device.device_type === 'extension' && months > env.base) {
    months = Math.max(env.base, Math.min(months, 12));
    reasons.push('Verlängerungsleitungen und Kabeltrommeln werden stark beansprucht → höchstens 12 Monate empfohlen.');
  }
  if (device.device_type === 'heating' && envKey === 'privat' && months > 12) {
    months = 12;
    reasons.push('Heizgeräte (Brandgefahr) → 12 Monate empfohlen.');
  }
  return { months, base: env.base, max: env.max, env: envKey, envLabel: env.label, dguv: env.dguv, reasons, stats: { n: stats.n, failed: stats.failed, rate: stats.rate } };
}

module.exports = { ENVIRONMENTS, suggestInterval, failureStats, MAX_FAIL_RATE, MIN_SAMPLE };
