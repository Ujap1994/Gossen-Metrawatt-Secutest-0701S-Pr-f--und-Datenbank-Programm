'use strict';
/**
 * iCalendar-Export (RFC 5545) für Prüftermine – importierbar in Outlook, Apple Kalender
 * (iCloud), Google Kalender, Thunderbird …  Jeder Termin enthält eine Erinnerung (VALARM).
 */

function esc(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** Zeilen > 75 Oktette falten */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = '';
  let len = 0;
  for (const ch of line) {
    const l = Buffer.byteLength(ch, 'utf8');
    if (len + l > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      len = 0;
    }
    current += ch;
    len += l;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function utcStamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dateValue(iso) {
  return iso.replace(/-/g, '');
}

function nextDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function deDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** SEQUENCE muss bei jeder Änderung steigen, damit Kalender den Termin aktualisieren (Minuten seit 2024). */
function sequence(now = Date.now()) {
  return Math.max(0, Math.floor((now - Date.UTC(2024, 0, 1)) / 60000));
}

function deviceLines(d, ownerName) {
  return [
    `Gerät: ${d.name}`,
    d.manufacturer || d.model ? `Hersteller/Typ: ${[d.manufacturer, d.model].filter(Boolean).join(' ')}` : null,
    `Inventar-Nr.: ${d.inventory_no}`,
    `Schutzklasse: ${d.protection_class}`,
    d.location ? `Standort: ${d.location}` : null,
    d.owner || ownerName ? `Eigentümer: ${d.owner || ownerName}` : null,
    d.last_inspection_date ? `Letzte Prüfung: ${d.last_inspection_date} (${d.last_result === 'bestanden' ? 'bestanden' : 'nicht bestanden'})` : null,
    d.postponed_from ? `Verschoben (ursprünglich fällig am ${deDate(d.postponed_from)})` : null,
  ].filter(Boolean);
}

function event(lines, { uid, stamp, seq, date, summary, desc, location, alarmDays, cancelled = false }) {
  lines.push(
    'BEGIN:VEVENT',
    `UID:${esc(uid)}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${seq}`,
    `DTSTART;VALUE=DATE:${dateValue(date)}`,
    `DTEND;VALUE=DATE:${dateValue(nextDay(date))}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(desc)}`,
    ...(location ? [`LOCATION:${esc(location)}`] : []),
    'CATEGORIES:Geräteprüfung',
    'TRANSP:TRANSPARENT',
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`
  );
  if (!cancelled) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, `TRIGGER:-P${Math.max(0, Number(alarmDays) || 0)}D`, 'END:VALARM');
  lines.push('END:VEVENT');
}

/**
 * @param {Array} devices  Geräte mit next_due_date
 * @param {object} o  {dbUuid, dbName, alarmDays, ownerName, grouping: 'due'|'monthly', cancelMonths: ['JJJJ-MM'], now}
 *
 * grouping 'due':     ein Termin je Gerät am Fälligkeitstag (UID je Gerät → Verschieben aktualisiert den Termin)
 * grouping 'monthly': ein Sammeltermin je Monat am Monatsersten mit allen in diesem Monat fälligen Geräten.
 *                     cancelMonths: Monate ohne Geräte mehr (z. B. nach dem Verschieben) → Termin wird abgesagt.
 */
function buildCalendar(devices, { dbUuid = 'secutest', dbName = 'Prüfmanager', alarmDays = 7, ownerName = '', grouping = 'due', cancelMonths = [], now = Date.now() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Secutest Pruefmanager//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(`Prüftermine ${dbName}`)}`];
  const stamp = utcStamp(new Date(now));
  const seq = sequence(now);
  const due = devices.filter((d) => d.next_due_date);
  if (grouping === 'monthly') {
    const months = new Map();
    for (const d of due) {
      const ym = d.next_due_date.slice(0, 7);
      if (!months.has(ym)) months.set(ym, []);
      months.get(ym).push(d);
    }
    for (const ym of [...months.keys()].sort()) {
      const list = months.get(ym).sort((a, b) => (a.next_due_date < b.next_due_date ? -1 : a.next_due_date > b.next_due_date ? 1 : 0));
      const summary = `Geräteprüfungen ${monthLabel(ym)}: ${list.length} Gerät${list.length === 1 ? '' : 'e'}`;
      const desc = [
        `Wiederholungsprüfung nach DIN VDE 0701-0702 – im ${monthLabel(ym)} fällig:`,
        '',
        ...list.map((d) => `• ${deDate(d.next_due_date)}  ${d.inventory_no}  ${d.name}${d.location ? ` (${d.location})` : ''}${d.postponed_from ? ' – verschoben' : ''}`),
        '',
        `Datenbank: ${dbName}`,
      ].join('\n');
      event(lines, { uid: `${dbUuid}-monat-${ym}@secutest-pruefmanager`, stamp, seq, date: `${ym}-01`, summary, desc, alarmDays });
    }
    for (const ym of cancelMonths) {
      if (months.has(ym)) continue;
      event(lines, { uid: `${dbUuid}-monat-${ym}@secutest-pruefmanager`, stamp, seq, date: `${ym}-01`, summary: `Geräteprüfungen ${monthLabel(ym)}: keine mehr fällig`, desc: `Alle Prüfungen dieses Monats wurden erledigt oder verschoben.\nDatenbank: ${dbName}`, alarmDays, cancelled: true });
    }
  } else {
    for (const d of due) {
      const summary = `Geräteprüfung fällig: ${d.name} (${d.inventory_no})`;
      const desc = ['Wiederholungsprüfung nach DIN VDE 0701-0702 fällig.', ...deviceLines(d, ownerName), `Datenbank: ${dbName}`].join('\n');
      event(lines, { uid: `${dbUuid}-geraet-${d.id}@secutest-pruefmanager`, stamp, seq, date: d.next_due_date, summary, desc, location: d.location, alarmDays });
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar, esc, fold, monthLabel };
