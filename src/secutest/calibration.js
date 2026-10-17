'use strict';
/**
 * Kalibrier-Erinnerung für das Prüfgerät (SECUTEST 0701S).
 *
 * Gespeichert in der lokalen Programmkonfiguration (gilt für das Prüfgerät an diesem Rechner,
 * nicht je Datenbank). Ein- und ausschaltbar unter Einstellungen → Programm.
 * Das SECUTEST meldet per IDN? nur die Nummer der aktuellen Kalibrierung („AC“) und die
 * Geräte-ID – das Kalibrierdatum steht auf dem Kalibrierschein bzw. der Prüfmarke.
 */
const config = require('../config');

const DEFAULTS = {
  enabled: false,
  lastDate: '', // Datum der letzten Kalibrierung (JJJJ-MM-TT)
  intervalMonths: 12, // Kalibrierintervall (Herstellerempfehlung bzw. eigene Festlegung)
  warnDays: 30, // so viele Tage vorher warnen
  deviceId: '', // Geräte-ID aus IDN? bzw. Seriennummer vom Typschild
  calibrationNo: '', // Kalibriernummer „AC“ aus IDN?
  lab: '', // Kalibrierlabor / Zertifikatsnummer (optional)
};

const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00').getTime());

function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1 + Number(months), 1);
  t.setDate(Math.min(d, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function get() {
  return { ...DEFAULTS, ...(config.load().calibration || {}) };
}

function update(patch = {}) {
  const cur = get();
  const next = { ...cur };
  if ('enabled' in patch) next.enabled = !!patch.enabled;
  if ('lastDate' in patch) {
    if (patch.lastDate && !isIso(patch.lastDate)) throw Object.assign(new Error('Ungültiges Kalibrierdatum (erwartet JJJJ-MM-TT).'), { status: 400 });
    if (patch.lastDate && patch.lastDate > today()) throw Object.assign(new Error('Das Kalibrierdatum darf nicht in der Zukunft liegen.'), { status: 400 });
    next.lastDate = patch.lastDate || '';
  }
  if ('intervalMonths' in patch) {
    const n = parseInt(patch.intervalMonths, 10);
    if (!(n >= 1 && n <= 60)) throw Object.assign(new Error('Kalibrierintervall: 1 bis 60 Monate.'), { status: 400 });
    next.intervalMonths = n;
  }
  if ('warnDays' in patch) {
    const n = parseInt(patch.warnDays, 10);
    if (!(n >= 0 && n <= 180)) throw Object.assign(new Error('Vorwarnzeit: 0 bis 180 Tage.'), { status: 400 });
    next.warnDays = n;
  }
  for (const k of ['deviceId', 'calibrationNo', 'lab']) if (k in patch) next[k] = String(patch[k] ?? '').trim().slice(0, 120);
  config.update((c) => {
    c.calibration = next;
  });
  return status();
}

/**
 * Zustand: off (ausgeschaltet) | unknown (kein Datum) | ok | soon (innerhalb der Vorwarnzeit) | overdue
 * identity: aktuelle IDN?-Antwort – erkennt eine neue Kalibrierung (geänderte Kalibriernummer).
 */
function status({ now = new Date(), identity = null } = {}) {
  const c = get();
  const out = { ...c, nextDate: null, daysLeft: null, state: c.enabled ? 'unknown' : 'off', changedOnDevice: false, deviceCalibrationNo: identity?.calibration || null };
  if (c.lastDate) {
    out.nextDate = addMonths(c.lastDate, c.intervalMonths);
    out.daysLeft = Math.round((new Date(out.nextDate + 'T00:00:00') - new Date(today(now) + 'T00:00:00')) / 86400000);
    if (c.enabled) out.state = out.daysLeft < 0 ? 'overdue' : out.daysLeft <= c.warnDays ? 'soon' : 'ok';
  }
  if (c.enabled && identity?.calibration && c.calibrationNo && String(identity.calibration) !== String(c.calibrationNo)) out.changedOnDevice = true;
  return out;
}

/** Kurztext für Prüfprotokolle, z. B. „kalibriert 01.03.2026, gültig bis 01.03.2027 (Nr. 05)“ */
function protocolText(s = status()) {
  if (!s.lastDate) return null;
  const de = (iso) => iso.split('-').reverse().join('.');
  return `kalibriert ${de(s.lastDate)}, gültig bis ${de(s.nextDate)}${s.calibrationNo ? ` (Kalibrier-Nr. ${s.calibrationNo})` : ''}${s.state === 'overdue' ? ' – ÜBERFÄLLIG' : ''}`;
}

module.exports = { DEFAULTS, get, update, status, protocolText, addMonths };
