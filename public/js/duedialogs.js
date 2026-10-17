// Dialoge „Prüftermin verschieben“ und „Prüfintervall ändern“ – für ein oder mehrere Geräte.
// Die Änderungen werden je Gerät in der Datenbank gespeichert (nicht in den Einstellungen).
import { h, fmt, toast, field, input, select, modal, choices, fill } from './ui.js';
import { post } from './api.js';

export const INTERVAL_PRESETS = [
  [3, '3 Monate (Baustelle, starke Beanspruchung)'],
  [6, '6 Monate (Werkstatt, häufiger Gebrauch)'],
  [12, '12 Monate (Standard / privat)'],
  [24, '24 Monate (Büro, geringe Beanspruchung)'],
  [36, '36 Monate'],
  [48, '48 Monate'],
];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());

/** wie repo.postponeTarget: gleicher Tag im Folgemonat (bei überfälligen Geräten: Folgemonat von heute) */
export function postponeTarget(due, today = todayIso()) {
  const [y, m, d] = due.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  const [by, bm] = y * 12 + m >= ty * 12 + tm ? [y, m] : [ty, tm];
  const target = new Date(by, bm, 1);
  target.setDate(Math.min(d, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
  return iso(target);
}

function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(y, m - 1 + Number(months), 1);
  target.setDate(Math.min(d, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
  return iso(target);
}

function inviteToast(invite) {
  if (!invite) return;
  if (invite.ok) toast(`Aktualisierte Kalendertermine an ${invite.to.join(', ')} gesendet`, 'ok', 6000);
  else toast(`Kalendertermine konnten nicht gesendet werden: ${invite.error}`, 'warn', 8000);
}

/**
 * Prüftermin(e) verschieben.
 * @param {Array} devices  Geräte mit id, name, inventory_no, next_due_date
 * @returns {Promise<boolean>} true, wenn etwas verschoben wurde
 */
export async function postponeDialog(devices) {
  const list = devices.filter((d) => d.next_due_date && d.status !== 'ausgemustert');
  if (!list.length) {
    toast('Für die ausgewählten Geräte ist kein Prüftermin eingetragen.', 'warn');
    return false;
  }
  const date = input({ type: 'date', min: iso(new Date(Date.now() + 86400000)), style: { maxWidth: '200px', display: 'none' } });
  const note = input({ placeholder: 'z. B. Gerät verliehen, Prüfung gemeinsam mit nächster Lieferung', maxlength: 500 });
  const preview = h('div', { class: 'preview-list' });
  const mode = choices(
    [
      { value: 'month', icon: '⏭', title: 'Auf den nächsten Monat', text: 'Gleicher Tag im Folgemonat. Überfällige Geräte: Folgemonat von heute.' },
      { value: 'date', icon: '📅', title: 'Auf ein bestimmtes Datum', text: 'Für alle ausgewählten Geräte dasselbe Datum.' },
    ],
    'month',
    { onchange: () => render() }
  );
  const render = () => {
    date.style.display = mode.value === 'date' ? '' : 'none';
    fill(
      preview,
      list.map((d) => {
        const to = mode.value === 'date' ? date.value : postponeTarget(d.next_due_date);
        return h('div', {}, h('b', {}, d.inventory_no), ` ${d.name}: ${fmt.date(d.next_due_date)} → `, to ? h('b', {}, fmt.date(to)) : '…');
      })
    );
  };
  date.addEventListener('input', render);
  render();
  const r = await modal({
    title: list.length === 1 ? `Prüftermin verschieben – ${list[0].name}` : `${list.length} Prüftermine verschieben`,
    wide: true,
    body: h(
      'div',
      { class: 'stack' },
      mode,
      date,
      field('Neue Termine', preview),
      field('Begründung (optional)', note, 'Erscheint im Änderungsprotokoll der Datenbank.'),
      h('div', { class: 'alert warn small' }, h('b', {}, 'Hinweis:'), 'Prüffristen dienen der Sicherheit (DGUV Vorschrift 3, BetrSichV). Verschiebe eine Prüfung nur, wenn das Gerät bis dahin sicher benutzt werden kann. Die Verantwortung liegt beim Betreiber. Der ursprüngliche Termin bleibt bis zur nächsten Prüfung vermerkt.')
    ),
    actions: [
      { label: 'Abbrechen', value: null },
      {
        label: 'Verschieben',
        class: 'primary',
        onClick: async () => {
          if (mode.value === 'date' && !date.value) {
            date.classList.add('invalid');
            return false;
          }
          try {
            return await post('/devices/postpone', { ids: list.map((d) => d.id), date: mode.value === 'date' ? date.value : null, note: note.value });
          } catch (e) {
            toast(e.message, 'bad', 6000);
            return false;
          }
        },
      },
    ],
  });
  if (!r) return false;
  toast(`${r.updated.length} Prüftermin${r.updated.length === 1 ? '' : 'e'} verschoben${r.skipped.length ? ` · ${r.skipped.length} übersprungen (${r.skipped.map((s) => `${s.name || s.id}: ${s.reason}`).join(', ')})` : ''}`, r.updated.length ? 'ok' : 'warn', 6000);
  inviteToast(r.invite);
  return r.updated.length > 0;
}

/**
 * Prüfintervall eines oder mehrerer Geräte ändern.
 * @param {Array} devices  Geräte mit id, name, inventory_no, interval_months, next_due_date, last_inspection_date, last_result
 */
export async function intervalDialog(devices) {
  if (!devices.length) return false;
  const current = devices.length === 1 ? Number(devices[0].interval_months) : 12;
  const presets = INTERVAL_PRESETS.some(([v]) => v === current) ? INTERVAL_PRESETS : [...INTERVAL_PRESETS, [current, `${current} Monate`]];
  const sel = select(presets, current);
  const months = input({ type: 'number', min: 1, max: 120, value: current, style: { maxWidth: '120px' } });
  sel.addEventListener('change', () => ((months.value = sel.value), render()));
  months.addEventListener('input', render);
  const recalc = choices(
    [
      { value: 'yes', icon: '🔄', title: 'Nächsten Termin neu berechnen', text: 'Ab der letzten bestandenen Prüfung + neues Intervall.' },
      { value: 'no', icon: '📌', title: 'Termin beibehalten', text: 'Das neue Intervall gilt ab der nächsten Prüfung.' },
    ],
    'yes',
    { onchange: () => render() }
  );
  const preview = h('div', { class: 'preview-list' });
  // DGUV-V3-Vorschlag je Gerät (Map id → Vorschlag); null = ein Intervall für alle
  let suggestions = null;
  const suggestBtn = h('button', { type: 'button', class: 'btn sm', onclick: () => toggleSuggest() }, '💡 Vorschlag nach DGUV V3 je Gerät');
  const suggestNote = h('div', { class: 'small muted' });
  async function toggleSuggest() {
    if (suggestions) {
      suggestions = null;
      suggestBtn.textContent = '💡 Vorschlag nach DGUV V3 je Gerät';
      sel.disabled = months.disabled = false;
      suggestNote.textContent = '';
      return render();
    }
    try {
      const list = await post('/devices/interval-suggestions', { ids: devices.map((d) => d.id) });
      suggestions = new Map(list.map((x) => [x.id, x]));
      suggestBtn.textContent = '✕ Vorschlag verwerfen (ein Intervall für alle)';
      sel.disabled = months.disabled = true;
      suggestNote.textContent = 'Vorschlag nach Einsatzbereich und Fehlerquote der Datenbank (DGUV Vorschrift 3, Tab. 1B; Privathaushalt: Empfehlung). Ohne Gewähr – maßgeblich ist die Gefährdungsbeurteilung.';
      render();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
  const monthsFor = (d) => (suggestions ? suggestions.get(d.id)?.months : Number(months.value));
  function render() {
    fill(
      preview,
      devices.map((d) => {
        const m = monthsFor(d);
        const to = recalc.value === 'yes' && m >= 1 && d.last_inspection_date && d.last_result === 'bestanden' ? addMonths(d.last_inspection_date, m) : d.next_due_date;
        const sg = suggestions?.get(d.id);
        return h(
          'div',
          {},
          h('b', {}, d.inventory_no),
          ` ${d.name}: ${d.interval_months} → ${m || '?'} Monate · nächste Prüfung `,
          to ? h('b', {}, fmt.date(to)) : 'offen',
          to !== d.next_due_date && d.next_due_date ? h('span', { class: 'muted' }, ` (bisher ${fmt.date(d.next_due_date)})`) : null,
          sg ? h('div', { class: 'small muted' }, `💡 ${sg.envLabel}: ${sg.reasons.slice(1).join(' ') || sg.reasons[0]}`) : null
        );
      })
    );
  }
  render();
  const r = await modal({
    title: devices.length === 1 ? `Prüfintervall ändern – ${devices[0].name}` : `Prüfintervall für ${devices.length} Geräte ändern`,
    wide: true,
    body: h('div', { class: 'stack' }, h('div', { class: 'grid c2' }, field('Vorschlag', sel), field('Intervall in Monaten (1–120)', months)), h('div', {}, suggestBtn, suggestNote), recalc, field('Vorschau', preview), h('p', { class: 'small muted' }, 'Das Intervall wird je Gerät in der Datenbank gespeichert. Das Standard-Intervall für neue Geräte steht in den Einstellungen.')),
    actions: [
      { label: 'Abbrechen', value: null },
      {
        label: 'Übernehmen',
        class: 'primary',
        onClick: async () => {
          try {
            if (suggestions) {
              // je vorgeschlagenem Intervall ein Aufruf
              const groups = new Map();
              for (const d of devices) {
                const m = monthsFor(d);
                if (!groups.has(m)) groups.set(m, []);
                groups.get(m).push(d.id);
              }
              const all = { devices: [], invite: null };
              for (const [m, ids] of groups) {
                const r = await post('/devices/interval', { ids, months: m, recalc: recalc.value === 'yes' });
                all.devices.push(...r.devices);
                all.invite = r.invite || all.invite;
              }
              return all;
            }
            const m = Number(months.value);
            if (!(m >= 1 && m <= 120)) {
              months.classList.add('invalid');
              return false;
            }
            return await post('/devices/interval', { ids: devices.map((d) => d.id), months: m, recalc: recalc.value === 'yes' });
          } catch (e) {
            toast(e.message, 'bad', 6000);
            return false;
          }
        },
      },
    ],
  });
  if (!r) return false;
  toast(`Prüfintervall für ${r.devices.length} Gerät${r.devices.length === 1 ? '' : 'e'} geändert`, 'ok');
  inviteToast(r.invite);
  return true;
}
