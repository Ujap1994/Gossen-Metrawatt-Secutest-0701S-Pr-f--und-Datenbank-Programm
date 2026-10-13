'use strict';
/**
 * Bewertung einer Prüfung: jeder Messwert wird gegen den Grenzwert des gewählten
 * Profils geprüft, dazu Sicht-/Funktionsprüfung und Vollständigkeit.
 */
const { limitsFor, QUANTITIES, displayLimit, risoCompensatedByLeakage, fmt, DEFAULT_PROFILE } = require('./limits');
const { buildProcedure } = require('./procedures');

/** ">310.0" -> {value:310, qualifier:'>'}, "---.-" -> {value:null} */
function parseValue(input) {
  if (input == null || input === '') return { value: null, qualifier: null, text: null };
  if (typeof input === 'number') return { value: Number.isFinite(input) ? input : null, qualifier: null, text: String(input) };
  const text = String(input).trim();
  if (/^-+\.?-*$/.test(text)) return { value: null, qualifier: null, text };
  const m = text.replace(',', '.').match(/^([<>])?\s*([-+]?\d*\.?\d+)\s*(-)?$/);
  if (!m) return { value: null, qualifier: null, text };
  let value = parseFloat(m[2]);
  if (m[3]) value = -value; // nachgestelltes Minus (SECUTEST-Format)
  return { value, qualifier: m[1] || null, text };
}

function compare(value, qualifier, op, limit) {
  if (value == null || limit == null || !op) return null;
  if (op === '<=') {
    if (qualifier === '>') return false; // Messbereich überschritten
    return value <= limit + 1e-12;
  }
  if (op === '>=') {
    if (qualifier === '<') return false;
    return value >= limit - 1e-12;
  }
  return null;
}

function unitFmt(v, key) {
  const q = QUANTITIES[key] || {};
  return `${fmt(v, q.digits ?? 2)} ${q.unit || ''}`.trim();
}

/**
 * @param {object} p
 * @param {object} p.device
 * @param {string} p.procedureId
 * @param {string} [p.profile]
 * @param {string} [p.standard]
 * @param {Array}  p.measurements [{step,key,point,value|valueText,source,display}]
 * @param {Array}  p.checks       [{group,item,label,passed,note}]
 * @param {Array}  [p.skipped]    [{step,reason}]
 */
function evaluateInspection({ device, procedureId, profile = DEFAULT_PROFILE, standard = 'VDE 0702', measurements = [], checks = [], skipped = [] }) {
  const limits = limitsFor(device, { profile, standard });
  let proc = null;
  try {
    proc = buildProcedure(procedureId, device, { profile, standard });
  } catch (e) {
    if (e.code !== 'AUTO_NOT_ALLOWED') throw e;
  }
  const failures = [];
  const warnings = [];
  const notes = [];

  const out = measurements.map((m, idx) => {
    const key = m.key;
    const q = QUANTITIES[key] || { label: key, unit: m.unit || '', op: null };
    const pv = m.value != null && m.value !== '' && typeof m.value === 'number' ? { value: m.value, qualifier: m.qualifier || null, text: m.valueText || String(m.value) } : parseValue(m.valueText ?? m.value);
    const lim = limits[key];
    const limitValue = m.limitValue != null ? Number(m.limitValue) : lim ? lim.value : null;
    const op = q.op;
    // Anzeigewert vom SECUTEST (nicht WC-korrigiert) -> Grenzwert um Gebrauchsfehler verschärfen
    const effLimit = m.display && limitValue != null ? displayLimit(key, limitValue) : limitValue;
    const passed = op ? compare(pv.value, pv.qualifier, op, effLimit) : null;
    const rec = {
      step: m.step || null,
      key,
      label: m.label || q.label,
      point: m.point || null,
      value: pv.value,
      value_text: pv.text,
      unit: q.unit || m.unit || '',
      limit_value: op ? limitValue : null,
      limit_op: op ? op : null,
      limit_text: op && limitValue != null ? `${op === '<=' ? '≤' : '≥'} ${unitFmt(limitValue, key)}${effLimit !== limitValue ? ` (Anzeige ${op === '<=' ? '≤' : '≥'} ${fmt(effLimit, 3)})` : ''}` : null,
      passed: passed == null ? null : passed ? 1 : 0,
      source: m.source || 'manuell',
      note: null,
      sort: m.sort ?? idx,
    };
    return rec;
  });

  // R_ISO-Ausgleich durch bestandene Ableitstrommessung (Profil 1997, Heizgeräte / Elektronik SK II)
  if (risoCompensatedByLeakage(device, profile)) {
    const leak = out.filter((r) => (r.key === 'IEA' || r.key === 'IB') && r.passed != null);
    if (leak.length && leak.every((r) => r.passed === 1)) {
      for (const r of out) {
        if (r.key === 'RISO' && r.passed === 0) {
          r.passed = 1;
          r.note = 'R_ISO unter Grenzwert, aber zulässig, da Ersatzableitstrom-Messung bestanden (Kap. 6.1.2).';
          notes.push(r.note);
        }
      }
    }
  }

  for (const r of out) {
    if (r.passed === 0) {
      const shown = r.value == null ? r.value_text ?? '—' : /[<>]/.test(r.value_text || '') ? r.value_text : fmt(r.value, (QUANTITIES[r.key] || {}).digits ?? 2);
      failures.push(`${r.label}${r.point ? ` (${r.point})` : ''}: ${shown} ${r.unit} – Grenzwert ${r.limit_text}`);
    }
  }

  const outChecks = checks.map((c, idx) => ({
    group_name: c.group || c.group_name || 'sicht',
    item: c.item,
    label: c.label || c.item,
    passed: c.passed == null ? null : c.passed ? 1 : 0,
    note: c.note || null,
    sort: c.sort ?? idx,
  }));
  for (const c of outChecks) {
    if (c.passed === 0) failures.push(`${c.group_name === 'sicht' ? 'Sichtprüfung' : c.group_name === 'funktion' ? 'Funktionsprüfung' : 'Prüfung'}: ${c.label}${c.note ? ` – ${c.note}` : ''}`);
  }

  // Vollständigkeit: Pflichtmessungen vorhanden oder begründet übersprungen?
  if (proc) {
    const skippedSteps = new Map(skipped.map((s) => [s.step, s.reason]));
    for (const step of proc.steps) {
      if (step.type !== 'measure') continue;
      const has = out.some((r) => r.key === step.key && r.value != null);
      if (has) continue;
      if (skippedSteps.has(step.id)) {
        const reason = skippedSteps.get(step.id);
        if (!reason || !String(reason).trim()) failures.push(`${step.title}: übersprungen ohne Begründung`);
        else notes.push(`${step.title} entfällt: ${reason}`);
        continue;
      }
      if (step.optional) continue;
      failures.push(`${step.title}: Messwert fehlt`);
    }
    const visualStep = proc.steps.find((s) => s.type === 'visual');
    if (visualStep && !outChecks.some((c) => c.group_name === 'sicht' && c.passed != null)) {
      failures.push('Sichtprüfung wurde nicht dokumentiert');
    }
  }

  // Hinweis: SK I ohne Leitungslänge > 5 m
  if (device.protection_class === 'SK I' && !(Number(device.cable_length_m) > 0)) {
    const rsl = out.find((r) => r.key === 'RSL' && r.value > 0.3);
    if (rsl) warnings.push('R_SL > 0,3 Ω: Ist die Anschlussleitung länger als 5 m? Dann Leitungslänge beim Gerät eintragen – der Grenzwert erhöht sich.');
  }

  const passed = failures.length === 0;
  return { passed, result: passed ? 'bestanden' : 'nicht_bestanden', measurements: out, checks: outChecks, failures, warnings, notes, limits };
}

module.exports = { evaluateInspection, parseValue, compare };
