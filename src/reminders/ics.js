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

/**
 * @param {Array} devices  Geräte mit next_due_date
 * @param {object} o  {dbUuid, dbName, alarmDays, ownerName}
 */
function buildCalendar(devices, { dbUuid = 'secutest', dbName = 'Prüfmanager', alarmDays = 7, ownerName = '' } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Secutest Pruefmanager//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(`Prüftermine ${dbName}`)}`];
  const stamp = utcStamp();
  for (const d of devices) {
    if (!d.next_due_date) continue;
    const summary = `Gerätprüfung fällig: ${d.name} (${d.inventory_no})`;
    const desc = [
      `Wiederholungsprüfung nach DIN VDE 0701-0702 fällig.`,
      `Gerät: ${d.name}`,
      d.manufacturer || d.model ? `Hersteller/Typ: ${[d.manufacturer, d.model].filter(Boolean).join(' ')}` : null,
      `Inventar-Nr.: ${d.inventory_no}`,
      `Schutzklasse: ${d.protection_class}`,
      d.location ? `Standort: ${d.location}` : null,
      d.owner || ownerName ? `Eigentümer: ${d.owner || ownerName}` : null,
      d.last_inspection_date ? `Letzte Prüfung: ${d.last_inspection_date} (${d.last_result === 'bestanden' ? 'bestanden' : 'nicht bestanden'})` : null,
      `Datenbank: ${dbName}`,
    ]
      .filter(Boolean)
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(`${dbUuid}-${d.id}-${d.next_due_date}@secutest-pruefmanager`)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateValue(d.next_due_date)}`,
      `DTEND;VALUE=DATE:${dateValue(nextDay(d.next_due_date))}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(desc)}`,
      ...(d.location ? [`LOCATION:${esc(d.location)}`] : []),
      'CATEGORIES:Geräteprüfung',
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(summary)}`,
      `TRIGGER:-P${Math.max(0, Number(alarmDays) || 0)}D`,
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar, esc, fold };
