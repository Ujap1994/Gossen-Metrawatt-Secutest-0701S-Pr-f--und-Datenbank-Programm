'use strict';
/**
 * Grenzwerte für die Prüfung elektrischer Geräte.
 *
 * Zwei Grenzwert-Profile:
 *  - "aktuell":  DIN VDE 0701-0702:2008-06 bzw. DIN EN 50678 (VDE 0701):2021 / DIN EN 50699 (VDE 0702):2021
 *  - "secutest-1997": die im SECUTEST 0701/0702S (Stand 9/1997) hinterlegten Werte
 *                     (DIN VDE 0701 Teil 1/200/240, DIN VDE 0702) – siehe Bedienungsanleitung Kap. 5/6
 *
 * Das Programm bewertet IMMER selbst nach dem gewählten Profil. Die Bewertung des
 * SECUTEST (PRO?-Telegramm) wird zusätzlich gespeichert und bei Abweichungen angezeigt –
 * das alte Gerät kennt z. B. noch 7 mA statt heute 3,5 mA Schutzleiterstrom.
 */

const PROFILES = {
  aktuell: {
    id: 'aktuell',
    name: 'DIN VDE 0701-0702:2008 / DIN EN 50678 & 50699 (aktuell)',
    short: 'VDE 0701-0702 aktuell',
  },
  'secutest-1997': {
    id: 'secutest-1997',
    name: 'SECUTEST-Gerätegrenzwerte (DIN VDE 0701 T1/T200/T240, 0702 – Stand 1997)',
    short: 'SECUTEST 1997',
  },
};

const DEFAULT_PROFILE = 'aktuell';

/** Einheiten und Bezeichnungen aller Messgrößen */
const QUANTITIES = {
  RSL: { label: 'Schutzleiterwiderstand R_SL', unit: 'Ω', op: '<=', digits: 3 },
  RSL_DIFF: { label: 'R_SL Differenz (Max − Min)', unit: 'Ω', op: '<=', digits: 3 },
  RISO: { label: 'Isolationswiderstand R_ISO', unit: 'MΩ', op: '>=', digits: 2 },
  UISO: { label: 'Prüfspannung U_ISO', unit: 'V', op: '>=', digits: 0 },
  IEA: { label: 'Ersatzableitstrom / Schutzleiterstrom I_EA', unit: 'mA', op: '<=', digits: 2 },
  IB: { label: 'Ersatz-Berührungsstrom (Sonde)', unit: 'mA', op: '<=', digits: 2 },
  ISONDE: { label: 'Berührungsstrom I_Sonde (Spannungsfreiheit)', unit: 'mA', op: '<=', digits: 3 },
  DI: { label: 'Differenzstrom ΔI', unit: 'mA', op: '<=', digits: 2 },
  UV_AC: { label: 'Versorgungsspannung SK III (AC)', unit: 'V', op: '<=', digits: 1 },
  UV_DC: { label: 'Versorgungsspannung SK III (DC)', unit: 'V', op: '<=', digits: 1 },
  U: { label: 'Netzspannung U_L-N', unit: 'V', op: null, digits: 1 },
  I: { label: 'Verbraucherstrom I_V', unit: 'A', op: null, digits: 2 },
  P: { label: 'Wirkleistung P', unit: 'W', op: null, digits: 0 },
  S: { label: 'Scheinleistung S', unit: 'VA', op: null, digits: 0 },
  PF: { label: 'Leistungsfaktor λ (cos φ)', unit: '', op: null, digits: 2 },
  W: { label: 'Elektrische Arbeit W', unit: 'Wh', op: null, digits: 1 },
  F: { label: 'Netzfrequenz f', unit: 'Hz', op: null, digits: 1 },
  P_MAX: { label: 'max. Wirkleistung P_max', unit: 'W', op: null, digits: 0 },
  I_MAX: { label: 'max. Verbraucherstrom I_max', unit: 'A', op: null, digits: 2 },
  DI_MAX: { label: 'max. Differenzstrom ΔI_max', unit: 'mA', op: null, digits: 2 },
  T_ON: { label: 'Einschaltdauer', unit: 's', op: null, digits: 0 },
};

function round(v, d = 3) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function fmt(v, d) {
  return Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function isHeating(device) {
  return device.device_type === 'heating';
}

function heatingKw(device) {
  const kw = Number(device.heating_power_kw);
  if (Number.isFinite(kw) && kw > 0) return kw;
  const p = Number(device.rated_power);
  return isHeating(device) && Number.isFinite(p) && p > 0 ? p / 1000 : 0;
}

// ---------------------------------------------------------------------------
// Schutzleiterwiderstand
// ---------------------------------------------------------------------------
function rslLimit(device, profile, standard) {
  const len = Number(device.cable_length_m) > 0 ? Number(device.cable_length_m) : null;
  if (profile === 'secutest-1997') {
    if (device.device_type === 'it' && device.connection_type === 'fixed') {
      return { value: 1.0, basis: 'Festanschluss EDV (DIN VDE 0701 Teil 240): max. 1 Ω' };
    }
    if (!len || len <= 5) return { value: 0.3, basis: 'Leitung bis 5 m: max. 0,3 Ω' };
    const step = standard === 'VDE 0702' ? 7.5 : 5;
    const add = Math.ceil((len - 5) / step) * 0.1;
    return {
      value: round(0.3 + add),
      basis: `0,3 Ω + 0,1 Ω je weitere ${fmt(step, 1)} m (${standard === 'VDE 0702' ? 'DIN VDE 0702' : 'DIN VDE 0701 T1'}) bei ${fmt(len, 1)} m`,
    };
  }
  if (!len || len <= 5) return { value: 0.3, basis: 'Leitung bis 5 m: max. 0,3 Ω' };
  const add = Math.ceil((len - 5) / 7.5) * 0.1;
  const value = Math.min(round(0.3 + add), 1.0);
  return { value, basis: `0,3 Ω + 0,1 Ω je weitere 7,5 m, max. 1 Ω (bei ${fmt(len, 1)} m)` };
}

// ---------------------------------------------------------------------------
// Isolationswiderstand
// ---------------------------------------------------------------------------
function risoLimit(device, profile) {
  const sk = device.protection_class;
  if (sk === 'SK III' || device.device_type === 'battery') {
    return { value: 0.25, basis: 'SK III / batteriebetrieben: min. 0,25 MΩ' };
  }
  if (sk === 'SK II') return { value: 2.0, basis: 'SK II: min. 2 MΩ' };
  if (profile === 'secutest-1997') return { value: 0.5, basis: 'SK I: min. 0,5 MΩ (DIN VDE 0701 T1)' };
  if (isHeating(device) && heatingKw(device) > 3.5) {
    return { value: 0.3, basis: 'SK I mit Heizelementen > 3,5 kW: min. 0,3 MΩ (Schutzleiterstrom muss eingehalten sein)' };
  }
  return { value: 1.0, basis: 'SK I: min. 1 MΩ' };
}

/** Prüfspannung für die Isolationsmessung */
function risoTestVoltage(device, profile) {
  if (profile === 'aktuell' && (device.protection_class === 'SK III' || device.device_type === 'battery')) return 250;
  return 500;
}

/**
 * Darf ein zu kleiner R_ISO durch eine bestandene Ersatzableitstrom-Messung „ausgeglichen“ werden?
 * (Bedienungsanleitung Kap. 6.1.2: SK I mit Heizkörpern < 0,5 MΩ, elektronische SK II < 2 MΩ)
 */
function risoCompensatedByLeakage(device, profile) {
  if (profile === 'secutest-1997') {
    return (device.protection_class === 'SK I' && isHeating(device)) || (device.protection_class === 'SK II' && device.device_type === 'electronic');
  }
  return false;
}

// ---------------------------------------------------------------------------
// Ableit-/Schutzleiterstrom, Berührungsstrom, Differenzstrom
// ---------------------------------------------------------------------------
function ieaLimit(device, profile) {
  if (profile === 'secutest-1997') {
    if (device.device_type === 'electronic') {
      return Number(device.phases) > 1
        ? { value: 0.5, basis: 'elektronisches Gerät mehrphasig (DIN VDE 0701 T200): max. 0,5 mA' }
        : { value: 1.0, basis: 'elektronisches Gerät einphasig (DIN VDE 0701 T200): max. 1 mA' };
    }
    if (isHeating(device) && heatingKw(device) >= 6) return { value: 15, basis: 'Heizleistung ≥ 6 kW: max. 15 mA' };
    return { value: 7, basis: 'SK I: max. 7 mA (DIN VDE 0701 T1)' };
  }
  const kw = heatingKw(device);
  if (isHeating(device) && kw >= 3.5) {
    const v = Math.min(round(kw * 1.0, 2), 10);
    return { value: v, basis: `Heizleistung ${fmt(kw, 1)} kW: 1 mA/kW, max. 10 mA` };
  }
  return { value: 3.5, basis: 'SK I: max. 3,5 mA' };
}

function ibLimit() {
  return { value: 0.5, basis: 'berührbare leitfähige Teile (SK II bzw. nicht mit PE verbunden): max. 0,5 mA' };
}

function isondeLimit(device, profile) {
  if (profile === 'secutest-1997') return { value: 0.25, basis: 'Spannungsfreiheit EDV/Büro (DIN VDE 0701 T240): max. 0,25 mA' };
  return { value: 0.5, basis: 'Berührungsstrom: max. 0,5 mA' };
}

function diLimit(device, profile) {
  if (device.protection_class === 'SK I') {
    const l = ieaLimit(device, profile === 'secutest-1997' ? 'aktuell' : profile);
    return { value: l.value, basis: `Differenzstrom-Verfahren SK I: ${l.basis.replace(/^SK I: /, '')}` };
  }
  return { value: 0.5, basis: 'Differenzstrom-Verfahren SK II: max. 0,5 mA' };
}

/** Liefert alle Grenzwerte für ein Gerät: { KEY: {value, op, unit, text, basis} } */
function limitsFor(device, { profile = DEFAULT_PROFILE, standard = 'VDE 0702' } = {}) {
  const d = { protection_class: 'SK I', device_type: 'standard', connection_type: 'plug', phases: 1, ...device };
  const out = {};
  const put = (key, l) => {
    if (!l) return;
    const q = QUANTITIES[key];
    out[key] = {
      key,
      value: l.value,
      op: q.op,
      unit: q.unit,
      text: `${q.op === '<=' ? '≤' : '≥'} ${fmt(l.value, l.value < 1 ? 3 : l.value < 10 ? 2 : 1)} ${q.unit}`.trim(),
      basis: l.basis,
    };
  };
  if (d.protection_class === 'SK I') {
    put('RSL', rslLimit(d, profile, standard));
    put('IEA', ieaLimit(d, profile));
  }
  if (d.device_type === 'extension') put('RSL', rslLimit(d, profile, standard));
  put('RISO', risoLimit(d, profile));
  const uiso = risoTestVoltage(d, profile);
  put('UISO', { value: uiso, basis: `Nenn-Prüfspannung ${uiso} V DC` });
  put('IB', ibLimit(d, profile));
  put('ISONDE', isondeLimit(d, profile));
  put('DI', diLimit(d, profile));
  put('UV_AC', { value: 50, basis: 'Schutzkleinspannung (SELV/PELV): max. 50 V AC' });
  put('UV_DC', { value: 120, basis: 'Schutzkleinspannung (SELV/PELV): max. 120 V DC' });
  return out;
}

// ---------------------------------------------------------------------------
// Gebrauchsfehler des SECUTEST (Anhang der Bedienungsanleitung, Kap. 11)
// Zu einem Grenzwert gehört ein minimaler bzw. maximaler ANZEIGEWERT.
// ---------------------------------------------------------------------------
const METER_ERROR_TABLES = {
  RISO: [ // Grenzwert MΩ -> minimaler Anzeigewert
    [0.1, 0.115], [0.25, 0.273], [0.5, 0.535], [1.0, 1.06], [2.0, 2.2], [5.0, 5.35], [7.0, 7.45], [10.0, 10.6], [20.0, 23.0], [75.0, 83.5],
  ],
  RSL: [ // Grenzwert Ω -> maximaler Anzeigewert
    [0.1, 0.085], [0.2, 0.18], [0.3, 0.275], [0.4, 0.37], [0.5, 0.465], [0.6, 0.56], [0.7, 0.655], [0.8, 0.75], [0.9, 0.845], [1.0, 0.94], [1.1, 1.035],
  ],
  IEA: [ // Grenzwert mA -> maximaler Anzeigewert
    [1.0, 0.85], [3.5, 3.23], [7.0, 6.55], [10.0, 9.4], [15.0, 14.15], [20.0, 18.9],
  ],
  ISONDE: [
    [0.1, 0.085], [0.25, 0.227], [0.5, 0.465], [1.0, 0.94], [2.0, 1.89], [3.5, 3.315],
  ],
  DI: [
    [0.25, 0.12], [0.5, 0.35], [1.0, 0.8], [2.0, 1.7], [3.5, 3.05], [5.0, 4.4], [7.0, 6.2], [10.0, 8.9], [15.0, 13.4], [20.0, 17.9], [25.0, 22.4],
  ],
};
METER_ERROR_TABLES.IB = METER_ERROR_TABLES.IEA;

function interpolate(table, x) {
  if (x <= table[0][0]) return (x * table[0][1]) / table[0][0];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (x <= x1) return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
  }
  const [xl, yl] = table[table.length - 1];
  return (x * yl) / xl;
}

/** Grenzwert -> zulässiger Anzeigewert des SECUTEST (Gebrauchsfehler berücksichtigt) */
function displayLimit(key, limit) {
  const t = METER_ERROR_TABLES[key];
  if (!t || !Number.isFinite(limit)) return limit;
  return round(interpolate(t, limit), 3);
}

module.exports = {
  PROFILES,
  DEFAULT_PROFILE,
  QUANTITIES,
  limitsFor,
  rslLimit,
  risoLimit,
  ieaLimit,
  risoTestVoltage,
  risoCompensatedByLeakage,
  displayLimit,
  METER_ERROR_TABLES,
  fmt,
};
