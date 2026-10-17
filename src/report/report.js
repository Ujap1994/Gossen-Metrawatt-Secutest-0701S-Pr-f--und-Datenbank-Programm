'use strict';
/**
 * Druckansichten: Prüfprotokoll (A4) und Prüfplakette mit QR-Code.
 * Im Browser über „Drucken“ → „Als PDF speichern“ archivierbar.
 */
const QRCode = require('qrcode');
const { escHtml: e, fmtDate } = require('../reminders/mailer');
const { PROCEDURES } = require('../vde/procedures');
const { PROFILES } = require('../vde/limits');
const { findAction, DEVICE_STATUS } = require('../vde/actions');
const { REASONS } = require('../db/repo');

const DEVICE_TYPES = {
  standard: 'Standardgerät',
  heating: 'Gerät mit Heizelementen',
  electronic: 'Elektronisches Gerät',
  it: 'EDV-/Bürogerät',
  extension: 'Verlängerungsleitung / Mehrfachsteckdose',
  battery: 'Batterie-/Akkugerät',
};
const MODES = { 'secutest-geraet': 'SECUTEST – gerätegeführt (Ergebnis per RS-232)', 'secutest-pc': 'SECUTEST – PC-gesteuert (RS-232)', manuell: 'Manuelle Eingabe' };

function num(v, unit) {
  if (v == null) return '—';
  const n = Number(v);
  const d = Math.abs(n) >= 100 ? 1 : Math.abs(n) >= 10 ? 2 : 3;
  return `${n.toLocaleString('de-DE', { maximumFractionDigits: d })} ${unit || ''}`.trim();
}

function okCell(p) {
  if (p === 1) return '<td class="ok">✔ i. O.</td>';
  if (p === 0) return '<td class="bad">✘ n. i. O.</td>';
  return '<td class="na">–</td>';
}

const STYLE = `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 10.5pt; color: #111; margin: 0; background: #fff; }
  .page { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0b5cad; padding-bottom: 6px; margin-bottom: 10px; }
  h1 { font-size: 16pt; margin: 0; color: #0b5cad; }
  h2 { font-size: 11pt; margin: 14px 0 4px; padding: 3px 6px; background: #eef3f8; border-left: 4px solid #0b5cad; }
  .meta { text-align: right; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 3px 6px; vertical-align: top; text-align: left; }
  table.grid td, table.grid th { border: 1px solid #c9d3dd; }
  table.grid th { background: #f4f7fa; font-weight: 600; }
  table.kv td:first-child { width: 38%; color: #444; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .ok { color: #116b2e; font-weight: 600; white-space: nowrap; }
  .bad { color: #b3261e; font-weight: 700; white-space: nowrap; }
  .na { color: #777; }
  .result { margin-top: 14px; padding: 10px 14px; border: 3px solid; font-size: 14pt; font-weight: 700; display: flex; justify-content: space-between; }
  .result.pass { border-color: #116b2e; color: #116b2e; }
  .result.fail { border-color: #b3261e; color: #b3261e; }
  .small { font-size: 8.5pt; color: #555; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 28px; }
  .sign div { border-top: 1px solid #333; padding-top: 3px; font-size: 9pt; }
  .warn { border: 1px solid #e0a800; background: #fff8e1; padding: 6px 8px; margin-top: 8px; font-size: 9.5pt; }
  .noprint { margin: 10px 0; }
  .noprint button { font-size: 11pt; padding: 6px 14px; }
  @media print { .noprint { display: none; } .page { padding: 0; } }
`;

function inspectionReport(insp, settings, { dbName }) {
  const d = insp.device;
  const passed = insp.result === 'bestanden';
  const proc = PROCEDURES[insp.procedure];
  const action = insp.action ? findAction(insp.action) : null;
  const visual = insp.checks.filter((c) => c.group_name === 'sicht');
  const func = insp.checks.filter((c) => c.group_name === 'funktion' || c.group_name === 'sonstiges');
  const skipped = insp.checks.filter((c) => c.group_name === 'entfaellt');
  const owner = settings.owner || {};
  const insp_ = settings.inspector || {};
  const protoNo = `P-${insp.inspection_date.slice(0, 4)}-${String(insp.id).padStart(5, '0')}`;
  const titleNorm = insp.standard === 'VDE 0701' ? 'DIN VDE 0701 / DIN EN 50678 – Prüfung nach Instandsetzung/Änderung' : 'DIN VDE 0702 / DIN EN 50699 – Wiederholungsprüfung';
  const safety = insp.measurements.filter((m) => m.limit_op);
  const info = insp.measurements.filter((m) => !m.limit_op);

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Prüfprotokoll ${e(protoNo)} – ${e(d.name)}</title><style>${STYLE}</style></head><body><div class="page">
  <div class="noprint"><button onclick="window.print()">🖨 Drucken / als PDF speichern</button></div>
  <header>
    <div><h1>Prüfprotokoll elektrisches Gerät</h1><div>${e(titleNorm)}</div></div>
    <div class="meta"><b>Protokoll-Nr. ${e(protoNo)}</b><br>Prüfdatum: <b>${fmtDate(insp.inspection_date)}</b><br>Datenbank: ${e(dbName)}</div>
  </header>

  <div class="cols">
    <div><h2>Auftraggeber / Eigentümer</h2><table class="kv">
      <tr><td>Name</td><td>${e(d.owner || owner.name || '—')}</td></tr>
      ${owner.street || owner.city ? `<tr><td>Anschrift</td><td>${e([owner.street, [owner.zip, owner.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</td></tr>` : ''}
      ${d.location ? `<tr><td>Standort</td><td>${e(d.location)}</td></tr>` : ''}
    </table></div>
    <div><h2>Prüfer</h2><table class="kv">
      <tr><td>Name</td><td>${e(insp.inspector || insp_.name || '—')}</td></tr>
      <tr><td>Qualifikation</td><td>${e(insp_.qualification || '—')}</td></tr>
      ${insp_.company ? `<tr><td>Firma</td><td>${e(insp_.company)}</td></tr>` : ''}
    </table></div>
  </div>

  <h2>Prüfling</h2>
  <div class="cols"><table class="kv">
    <tr><td>Inventar-Nr.</td><td><b>${e(d.inventory_no)}</b></td></tr>
    <tr><td>Bezeichnung</td><td><b>${e(d.name)}</b></td></tr>
    <tr><td>Hersteller / Typ</td><td>${e([d.manufacturer, d.model].filter(Boolean).join(' / ') || '—')}</td></tr>
    <tr><td>Serien-Nr.</td><td>${e(d.serial_no || '—')}</td></tr>
  </table><table class="kv">
    <tr><td>Schutzklasse</td><td><b>${e(insp.protection_class || d.protection_class)}</b></td></tr>
    <tr><td>Geräteart</td><td>${e(DEVICE_TYPES[d.device_type] || d.device_type)}</td></tr>
    <tr><td>Nennwerte</td><td>${e([d.rated_voltage && `${d.rated_voltage} V`, d.rated_power && `${d.rated_power} W`, d.rated_current && `${d.rated_current} A`].filter(Boolean).join(' · ') || '—')}</td></tr>
    <tr><td>Leitungslänge</td><td>${d.cable_length_m ? `${num(d.cable_length_m, 'm')}${d.cable_cross_section ? ` · ${num(d.cable_cross_section, 'mm²')}` : ''}` : '≤ 5 m / —'}</td></tr>
  </table></div>

  <h2>Prüfung</h2>
  <table class="kv">
    <tr><td>Anlass</td><td>${e(REASONS[insp.reason] || insp.reason || '—')}</td></tr>
    <tr><td>Prüfablauf</td><td>${e(proc ? `${proc.name} (Schalterstellung ${proc.switchPos})` : insp.procedure)}</td></tr>
    <tr><td>Durchführung</td><td>${e(MODES[insp.mode] || insp.mode)}</td></tr>
    <tr><td>Grenzwerte</td><td>${e(PROFILES[insp.limit_profile]?.name || insp.limit_profile || '—')}</td></tr>
    <tr><td>Messgerät</td><td>Gossen Metrawatt SECUTEST 0701S${insp.meter_idn ? ` – ${e(insp.meter_idn)}` : ''}${insp.meter_calibration ? `<br><span class="small">${e(insp.meter_calibration)}</span>` : ''}</td></tr>
  </table>

  <h2>Sichtprüfung</h2>
  ${visual.length ? `<table class="grid"><tr><th>Prüfpunkt</th><th style="width:22%">Ergebnis</th></tr>${visual.map((c) => `<tr><td>${e(c.label)}${c.note ? `<br><span class="small">${e(c.note)}</span>` : ''}</td>${okCell(c.passed)}</tr>`).join('')}</table>` : '<p class="small">nicht dokumentiert</p>'}

  <h2>Messungen</h2>
  ${safety.length ? `<table class="grid"><tr><th>Messgröße</th><th>Messpunkt</th><th>Messwert</th><th>Grenzwert</th><th style="width:16%">Ergebnis</th></tr>
    ${safety.map((m) => `<tr><td>${e(m.label)}</td><td>${e(m.point || '—')}</td><td><b>${e(m.value_text && /[<>]/.test(m.value_text) ? `${m.value_text} ${m.unit}` : num(m.value, m.unit))}</b></td><td>${e(m.limit_text || '—')}</td>${okCell(m.passed)}</tr>`).join('')}</table>` : '<p class="small">keine Messwerte</p>'}
  ${skipped.length ? `<p class="small"><b>Entfallene Prüfschritte:</b> ${skipped.map((s) => `${e(s.label)} – ${e(s.note || '')}`).join('; ')}</p>` : ''}

  ${info.length || func.length ? `<h2>Funktionsprüfung</h2>
  ${info.length ? `<table class="grid"><tr>${info.map((m) => `<th>${e(m.label)}</th>`).join('')}</tr><tr>${info.map((m) => `<td>${e(num(m.value, m.unit))}</td>`).join('')}</tr></table>` : ''}
  ${func.length ? `<table class="grid" style="margin-top:6px">${func.map((c) => `<tr><td>${e(c.label)}${c.note ? `<br><span class="small">${e(c.note)}</span>` : ''}</td>${okCell(c.passed)}</tr>`).join('')}</table>` : ''}` : ''}

  <div class="result ${passed ? 'pass' : 'fail'}"><span>Gesamtergebnis: ${passed ? 'BESTANDEN' : insp.result === 'abgebrochen' ? 'ABGEBROCHEN' : 'NICHT BESTANDEN'}</span>
    <span>${passed ? `Nächste Prüfung: ${fmtDate(insp.next_due_date)}` : ''}</span></div>
  ${insp.device_verdict && insp.device_verdict !== insp.result ? `<div class="warn">Hinweis: Das SECUTEST hat mit seinen eingebauten Grenzwerten (Stand 1997) „${insp.device_verdict === 'bestanden' ? 'bestanden' : 'nicht bestanden'}“ gemeldet. Maßgeblich ist die Bewertung nach dem oben genannten Grenzwertprofil.</div>` : ''}
  ${action ? `<h2>Maßnahme</h2><p><b>${e(action.label)}</b><br>${e(action.description)}${insp.action_note ? `<br><i>${e(insp.action_note)}</i>` : ''}<br>Gerätestatus: <b>${e(DEVICE_STATUS[action.status])}</b></p>` : ''}
  ${insp.notes ? `<h2>Bemerkungen</h2><p>${e(insp.notes).replace(/\n/g, '<br>')}</p>` : ''}

  <div class="sign"><div>Ort, Datum</div><div>Unterschrift Prüfer${insp.inspector || insp_.name ? ` (${e(insp.inspector || insp_.name)})` : ''}</div></div>
  <p class="small" style="margin-top:18px">Erstellt mit Secutest Prüfmanager am ${fmtDate(new Date().toISOString().slice(0, 10))}. Die Messwerte des SECUTEST sind um den Gebrauchsfehler korrigiert (Worst-Case-Werte), sofern per Schnittstelle übernommen.
  Open-Source-Software ohne Gewähr – die Bewertung ist von der verantwortlichen Elektrofachkraft zu prüfen; maßgeblich sind die gültigen Normen.</p>
</div></body></html>`;
}

/**
 * Inhalt des QR-Codes einer Prüfplakette – lesbar für Menschen und für den QR-Scanner des Programms:
 * „G-0001 | Wasserkocher | nächste Prüfung 2027-10-13 | DB 1a2b3c4d“ (DB = Kennung der Datenbank)
 */
function labelCode(d, dbUuid) {
  return `${d.inventory_no} | ${d.name} | nächste Prüfung ${d.next_due_date || '-'}${dbUuid ? ` | DB ${String(dbUuid).replace(/-/g, '').slice(0, 8)}` : ''}`;
}

/** Gegenstück zu labelCode: Inventarnummer und Datenbank-Kennung aus gescanntem Text */
function parseLabelCode(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const parts = t.split('|').map((x) => x.trim()).filter(Boolean);
  const db = parts.map((x) => x.match(/^DB\s+([0-9a-f]{8})$/i)).find(Boolean)?.[1]?.toLowerCase() || null;
  return { code: parts[0] || t, db, raw: t };
}

async function labelSheet(devices, settings, { dbUuid } = {}) {
  const items = await Promise.all(
    devices.map(async (d) => {
      const qr = await QRCode.toString(labelCode(d, dbUuid), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
      return { d, qr };
    })
  );
  const css = `
    @page { size: A4; margin: 10mm; }
    body { font-family: Arial, sans-serif; margin: 0; }
    .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
    .label { width: 62mm; height: 34mm; border: 0.4mm solid #0b5cad; border-radius: 2mm; padding: 2mm; display: grid; grid-template-columns: 1fr 22mm; gap: 2mm; page-break-inside: avoid; }
    .label.fail { border-color: #b3261e; }
    .t { font-size: 6.5pt; font-weight: bold; color: #fff; background: #0b5cad; padding: 0.6mm 1mm; border-radius: 1mm; }
    .fail .t { background: #b3261e; }
    .n { font-size: 9pt; font-weight: bold; margin-top: 1mm; }
    .s { font-size: 6.5pt; color: #333; line-height: 1.25; }
    .due { font-size: 13pt; font-weight: bold; color: #0b5cad; }
    .qr svg { width: 22mm; height: 22mm; }
    .noprint { margin: 10px; } @media print { .noprint { display: none; } }`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Prüfplaketten</title><style>${css}</style></head><body>
  <div class="noprint"><button onclick="window.print()">🖨 Etiketten drucken</button> <small>Tipp: auf Etikettenpapier oder Klebefolie drucken und mit Klarsichtfolie abdecken.</small></div>
  <div class="sheet">${items
    .map(({ d, qr }) => {
      const fail = d.last_result === 'nicht_bestanden' || d.status === 'gesperrt' || d.status === 'reparatur';
      const due = d.next_due_date ? `${d.next_due_date.slice(5, 7)}/${d.next_due_date.slice(0, 4)}` : '—';
      return `<div class="label ${fail ? 'fail' : ''}"><div>
        <div class="t">${fail ? 'GESPERRT – NICHT BENUTZEN' : 'GEPRÜFT nach DIN VDE 0701-0702'}</div>
        <div class="n">${e(d.inventory_no)}</div>
        <div class="s">${e(d.name.slice(0, 40))}</div>
        <div class="s">Geprüft: ${fmtDate(d.last_inspection_date)}${settings.inspector?.name ? ` · ${e(settings.inspector.name)}` : ''}</div>
        <div class="s">Nächste Prüfung:</div><div class="due">${fail ? '—' : e(due)}</div>
      </div><div class="qr">${qr}</div></div>`;
    })
    .join('')}</div></body></html>`;
}

module.exports = { labelCode, parseLabelCode, inspectionReport, labelSheet, DEVICE_TYPES, MODES };
