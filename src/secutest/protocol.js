'use strict';
/**
 * Schnittstellenprotokoll SECUTEST 0701/0702S (Bedienungsanleitung Kap. 8.3 – 8.5)
 *
 *  9600 Baud, 8 Bit, keine Parität, 1 Stoppbit, XON/XOFF, Protokoll nach DIN 19244
 *  Meldung:  <OPERATION><ADRESSE><OPERATOR>[PARAMETER[;PARAMETER]]$<CHKSUM><CR>
 *            OPERATOR: ? Anfrage, ! Zuweisung, = Antwort
 *  Prüfsumme: Summe der ASCII-Werte aller Zeichen inkl. '$', Übertrag über FF abgeschnitten,
 *             als 2 ASCII-Hex-Zeichen.
 *  Quittung:  Y<ADRESSE>$<CHKSUM><CR> (ausgeführt) bzw. N<ADRESSE>$<CHKSUM><CR> (nicht ausgeführt)
 *
 *  Abweichungen des echten Geräts (SECUTEST S, Firmware GTM5015000R0001, Mitschnitt am FTDI-Adapter):
 *   - ohne eingestellte Adresse steht „x“ an Stelle der Adresse: IDNx=x;…, WERTEx=…, .Yx
 *   - Quittungen mit führendem Punkt: .Yx / .Nx, dazu .Ex (Fehler, z. B. Gerät noch beschäftigt)
 *   - Messwerte mit Doppelpunkt und Einheit: WERTEx=28:00.19mA;21:>310.0MΩ (Ω = 0xEA, µ = 0xE6, Codepage 437)
 *   - jede Antwort ist eingerahmt: XOFF … CR LF „>“ XON, nach TAS!r folgt zusätzlich ^C
 */

const CTRL = {
  ABORT: '\x03', // ^C Abbruch jeder Funktion
  ECHO_ON: '\x04', // ^D Echo ein (Terminalbetrieb)
  ECHO_OFF: '\x06', // ^F Echo aus (Rechnersteuerung)
  BELL: '\x07', // ^G Piepser
  XON: '\x11', // ^Q
  XOFF: '\x13', // ^S
  CR: '\r',
};

/** Tastencodes für TAS!t */
const KEYS = { RELEASE: '0', HELP: '1', DOWN: '2', UP: '3', ENTER: '4', FUNCTION_TEST: '5', REMOTE_ON: 'R', REMOTE_OFF: 'r', RANGE_MANUAL: 'M', RANGE_AUTO: 'm' };

/**
 * Schalterstellungen für RSTx!a (a = 1…8, 1 = FUNCTION-TEST laut Anleitung).
 * Die übrigen Nummern ergeben sich aus der Reihenfolge am Drehschalter (im Uhrzeigersinn ab
 * FUNCTION-TEST). Falls Ihr Gerät anders nummeriert, in den Einstellungen anpassen.
 */
const SWITCH_POSITIONS = { 'FUNCTION-TEST': 1, MENUE: 2, OFF: 3, AUTO: 4, 'SK I': 5, 'SK II': 6, 'SK III': 7, 'T 240': 8 };

function checksum(str) {
  let sum = 0;
  for (const b of Buffer.from(str, 'latin1')) sum = (sum + b) & 0xff;
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Baut ein Befehlstelegramm. Eingabe z. B. "WER?12,14" oder "MES!8".
 * Die Adresse wird hinter den 3-Buchstaben-Befehl gesetzt, falls angegeben.
 */
function buildCommand(command, { address = null, withChecksum = true } = {}) {
  const m = String(command).trim().match(/^([A-Za-z]{3})(\d*)([?!=])(.*)$/);
  let body;
  if (m) {
    const addr = m[2] || (address != null && address !== '' ? String(address) : '');
    body = `${m[1].toUpperCase()}${addr}${m[3]}${m[4]}`;
  } else {
    body = String(command).trim();
  }
  if (!withChecksum) return body + CTRL.CR;
  const withDelim = body.endsWith('$') ? body : body + '$';
  return withDelim + checksum(withDelim) + CTRL.CR;
}

/** Zerlegt eine empfangene Zeile. */
function parseLine(raw) {
  const line = String(raw).replace(/[\r\n\x00]+/g, '').trim();
  const res = { raw: line, body: line, checksum: null, checksumOk: null, type: 'unknown', operation: null, address: null, params: '' };
  if (!line) return { ...res, type: 'empty' };
  const idx = line.lastIndexOf('$');
  if (idx >= 0) {
    const cs = line.slice(idx + 1, idx + 3);
    res.body = line.slice(0, idx);
    if (/^[0-9A-Fa-f]{2}$/.test(cs)) {
      res.checksum = cs.toUpperCase();
      res.checksumOk = checksum(line.slice(0, idx + 1)) === res.checksum;
    }
  }
  const b = res.body.trim();
  let m;
  // unaufgeforderte Meldung „Protokoll fertig“ (nach der Sicherheitsprüfung und nach dem Funktionstest)
  if ((m = b.match(/^PRF(\d+|x)?$/))) {
    res.type = 'event';
    res.operation = 'PRF';
    res.address = m[1] && m[1] !== 'x' ? m[1] : null;
    return res;
  }
  if ((m = b.match(/^\.?([YNE])(\d+|x)?$/))) {
    res.type = { Y: 'ack', N: 'nak', E: 'error' }[m[1]];
    res.address = m[2] && m[2] !== 'x' ? m[2] : null;
    return res;
  }
  if ((m = b.match(/^([A-Za-z]+?)(\d+|x)?\s*=\s*([\s\S]*)$/))) {
    res.type = 'answer';
    res.operation = m[1].toUpperCase();
    res.address = m[2] && m[2] !== 'x' ? m[2] : null;
    res.params = m[3].trim();
    return res;
  }
  // MES?-Antwort evtl. ohne Kopf: "AA;BB;nn"
  if (/^[0-9A-Fa-f]{2}(;\d+)*;?$/.test(b)) {
    res.type = 'answer';
    res.operation = 'MES';
    res.params = b;
  }
  return res;
}

const CP437 = { '\xe6': 'µ', '\xea': 'Ω' };
// das Gerät sendet die elektrische Arbeit als „xJ“, im Display steht kWh
const UNIT_ALIAS = { xJ: 'kWh' };

/** "0.077" | ">310.0" | "---.-" | "00.0-" | "00.19mA" | "0538.V" -> {text, value, qualifier[, unit]} */
function parseNumber(text) {
  let t = String(text ?? '').trim();
  let unit = null;
  const u = t.match(/^(.*[\d.-])\s*([A-Za-z%\xb5\xe6\xeaΩ]+)$/);
  if (u) {
    t = u[1];
    unit = u[2].replace(/[\xe6\xea]/g, (c) => CP437[c]);
    unit = UNIT_ALIAS[unit] || unit;
  }
  const withUnit = (r) => (unit ? { ...r, unit } : r);
  if (!t || /^-+\.?-*$/.test(t)) return withUnit({ text: t, value: null, qualifier: null });
  const m = t.replace(',', '.').match(/^([<>])?\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*(-)?$/);
  if (!m) return withUnit({ text: t, value: null, qualifier: null });
  let v = parseFloat(m[2]);
  if (m[3]) v = -v;
  return withUnit({ text: t, value: v, qualifier: m[1] || null });
}

const SI_PREFIX = { p: 1e-12, n: 1e-9, µ: 1e-6, m: 1e-3, '': 1, k: 1e3, M: 1e6, G: 1e9 };
const BASE_UNITS = ['VA', 'Wh', 'Hz', 'Ω', 'A', 'V', 'W', 's', '%'];

function splitUnit(unit) {
  for (const base of BASE_UNITS) {
    const prefix = unit.slice(0, -base.length);
    if (unit.endsWith(base) && prefix in SI_PREFIX) return { prefix, base };
  }
  return null;
}

/** Wert von der Geräteeinheit (z. B. kΩ) in die erwartete Einheit (z. B. MΩ) umrechnen; null, wenn nicht umrechenbar */
function convertUnit(value, from, to) {
  if (value == null || !from || from === to) return value;
  const a = splitUnit(from);
  const b = splitUnit(to ?? '');
  if (!a || !b || a.base !== b.base) return null;
  return value * (SI_PREFIX[a.prefix] / SI_PREFIX[b.prefix]);
}

/** WERTEx=m1,Inhalt;m2,Inhalt (Anleitung) bzw. WERTEx=m1:Inhalt;m2:Inhalt (Gerät) -> { 12: {text,value,qualifier}, … } */
function parseWer(params) {
  const out = {};
  for (const part of String(params).split(';')) {
    const p = part.trim();
    if (!p) continue;
    const i = p.search(/[,:]/);
    if (i < 0) continue;
    const n = parseInt(p.slice(0, i), 10);
    if (Number.isFinite(n)) out[n] = parseNumber(p.slice(i + 1));
  }
  return out;
}

const CONNECTION_FLAGS = [
  ['slDose', 0, 'Schutzleiter an Prüfdose'],
  ['slKlemme', 1, 'Schutzleiter an Buchse SL'],
  ['finger', 2, 'Fingerkontakt erkannt'],
  ['nKlemme', 3, 'Buchse N belegt'],
  ['lKlemme', 4, 'Buchse L belegt'],
  ['dose', 5, 'Prüfling an Prüfdose'],
];

/** MES?-Antwort: "AA;BB;nn;…" -> {flags, running[]} */
function parseMes(params) {
  const parts = String(params).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const aa = parseInt(parts[0] || '0', 16) || 0;
  const flags = { raw: parts[0] || '00', list: [] };
  for (const [name, bit, label] of CONNECTION_FLAGS) {
    flags[name] = !!(aa & (1 << bit));
    if (flags[name]) flags.list.push(label);
  }
  const running = parts
    .slice(1)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return { flags, running };
}

/** IDN-Antwort: "0;GMN;SecuTest S;GTM5015000R0001;18. Juli 1994 164931;Schäfer;05" */
function parseIdn(params) {
  // unbeschriebene Felder im Gerät kommen als 0xFF-Bytes
  const p = String(params).split(/[;,]/).map((s) => s.replace(/\xff/g, '').trim());
  return { address: p[0] && p[0] !== 'x' ? p[0] : null, manufacturer: p[1] || null, model: p[2] || null, firmware: p[3] || null, date: p[4] || null, deviceId: p[5] || null, calibration: p[6] || null, raw: params };
}

const bit = (byte, n) => !!(byte & (1 << n));

/**
 * PRO?-Antwort (701-Ergebnisstring):
 *   Geräte-ID;BBCCDDEEFFGGHHII;MW1;GW1;…;MWn;GWn
 */
function parsePro(params) {
  const parts = String(params).split(';').map((s) => s.trim());
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  const deviceId = (parts[0] || '').replace(/\xff/g, '').trim();
  const hex = (parts[1] || '').replace(/[^0-9A-Fa-f]/g, '').padEnd(16, '0');
  const byte = (i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  const [BB, CC, DD, EE, FF, GG, HH] = [0, 1, 2, 3, 4, 5, 6].map(byte);
  const performed = { RSL: bit(BB, 0), RISO: bit(BB, 1), IEA: bit(BB, 2), ISONDE: bit(BB, 3), UV: bit(BB, 4), DI: bit(BB, 5), FT: bit(BB, 6) };
  const classification = {
    protectionClass: bit(CC, 1) ? 'SK III' : bit(CC, 0) ? 'SK I' : 'SK II',
    electronic: bit(CC, 2),
    highLeakage: bit(CC, 3),
    itDevice: bit(CC, 4),
    cableLengthEntered: bit(CC, 5),
    rcdTrip: bit(CC, 6),
    terminalConnection: bit(CC, 7),
    noVisualInspection: bit(DD, 0),
    dutNotSwitchedOn: bit(DD, 1),
    deviceGroup: bit(DD, 2),
    scanModeSk2: bit(DD, 3),
    mainsReversal: bit(DD, 4),
    noLeakageNeeded: bit(DD, 5),
  };
  const failed = { RSL: bit(EE, 0), RISO: bit(EE, 1), IEA: bit(EE, 2), ISONDE: bit(EE, 3), UV: bit(EE, 4), DI: bit(EE, 5), overall: bit(EE, 7) };
  const visualFailed = { schutzleiter: bit(FF, 0), isolierteile: bit(FF, 1), gehaeuse: bit(FF, 2), anschlussleitung: bit(FF, 3), typschild: bit(FF, 4), gebrauch: bit(FF, 5), functionTest: bit(FF, 7) };

  const vals = parts.slice(2);
  let i = 0;
  const take = () => parseNumber(vals[i++]);
  const measurements = [];
  const add = (key, mw, gw, extra = {}) => measurements.push({ key, value: mw.value, valueText: mw.text, qualifier: mw.qualifier, limitText: gw.text, limitValue: gw.value, ...extra });
  if (performed.RSL) {
    const mw = take();
    const gw = take();
    add('RSL', mw, gw, { failed: failed.RSL });
    if (classification.deviceGroup) {
      const d = take();
      const dg = take();
      add('RSL_DIFF', d, dg, { failed: failed.RSL });
    }
  }
  if (performed.RISO) {
    const mw = take();
    const gw = take();
    add('RISO', mw, gw, { failed: failed.RISO });
    const u = take();
    const ug = take();
    add('UISO', u, ug, { info: true });
  }
  if (performed.IEA) {
    const mw = take();
    const gw = take();
    add(classification.protectionClass === 'SK I' ? 'IEA' : 'IB', mw, gw, { failed: failed.IEA, notRequired: classification.noLeakageNeeded });
  }
  if (performed.ISONDE) {
    const mw = take();
    const gw = take();
    add('ISONDE', mw, gw, { failed: failed.ISONDE });
  }
  if (performed.UV) {
    const ac = take();
    const acg = take();
    const dc = take();
    const dcg = take();
    add('UV_AC', ac, acg, { failed: failed.UV });
    add('UV_DC', dc, dcg, { failed: failed.UV });
  }
  if (performed.DI) {
    const mw = take();
    const gw = take();
    add('DI', mw, gw, { failed: failed.DI });
  }
  return {
    deviceId,
    hex: hex.toUpperCase(),
    performed,
    classification,
    failed,
    visualFailed,
    counter: GG,
    autostore: bit(HH, 0),
    verdict: failed.overall ? 'nicht_bestanden' : 'bestanden',
    measurements,
    extraValues: vals.slice(i),
  };
}

module.exports = { CTRL, KEYS, SWITCH_POSITIONS, checksum, buildCommand, parseLine, parseNumber, convertUnit, parseWer, parseMes, parseIdn, parsePro, CONNECTION_FLAGS };
