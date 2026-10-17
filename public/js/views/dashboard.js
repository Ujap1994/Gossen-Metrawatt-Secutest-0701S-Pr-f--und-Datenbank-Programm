import { h, fmt, dueBadge, resultBadge, skSymbol } from '../ui.js';
import { get } from '../api.js';
import { state, procName } from '../state.js';
import { postponeDialog } from '../duedialogs.js';
import { calibrationText } from './settings.js';

export async function renderDashboard({ navigate }) {
  const { stats, due, recent } = await get('/dashboard');
  const s = state.secutest;
  const stat = (v, l, cls, href) => h('a', { class: `card stat ${cls || ''}`, href }, h('span', { class: 'v' }, v), h('span', { class: 'l' }, l));
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, 'Übersicht'), h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/devices/new' }, '+ Gerät anlegen'), h('a', { class: 'btn primary', href: '#/inspect' }, '✅ Gerät prüfen'))),
    h(
      'div',
      { class: 'grid c4' },
      stat(stats.devices, 'Geräte im Bestand', '', '#/devices'),
      stat(stats.overdue, 'überfällig', stats.overdue ? 'bad' : 'ok', '#/devices?due=overdue'),
      stat(stats.soon, 'in den nächsten 30 Tagen fällig', stats.soon ? 'warn' : '', '#/devices?due=soon'),
      stat(stats.blocked, 'gesperrt / in Reparatur', stats.blocked ? 'bad' : '', '#/devices?status=gesperrt')
    ),
    ['soon', 'overdue', 'unknown'].includes(state.meta?.calibration?.state)
      ? h('div', { class: `alert ${state.meta.calibration.state === 'overdue' ? 'bad' : 'warn'}` }, h('b', {}, '📏 Prüfmittel: '), calibrationText(state.meta.calibration), ' ', h('a', { href: '#/settings/program' }, 'Kalibrierdaten bearbeiten'))
      : null,
    stats.never ? h('div', { class: 'alert warn' }, h('b', {}, `${stats.never} Gerät(e)`), 'wurden noch nie geprüft. ', h('a', { href: '#/devices?due=never' }, 'Anzeigen')) : null,
    !s?.connected
      ? h('div', { class: 'alert info' }, h('b', {}, 'SECUTEST nicht verbunden.'), 'USB-RS232-Adapter einstecken – das Programm sucht automatisch. Oder ', h('a', { href: '#/secutest' }, 'manuell verbinden / Simulator starten'), '. Prüfen geht auch ohne Gerät (manuelle Eingabe).')
      : null,
    h(
      'div',
      { class: 'grid c2', style: { marginTop: '14px' } },
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'card-head' },
          h('h2', {}, 'Fällige Prüfungen (30 Tage)'),
          h('div', { class: 'row' }, due.length > 1 ? h('button', { class: 'btn sm', title: 'Alle hier angezeigten Prüfungen verschieben', onclick: async () => (await postponeDialog(due)) && navigate('#/dashboard') }, '⏭ alle verschieben') : null, h('a', { href: '#/devices?due=soon', class: 'small' }, 'alle'))
        ),
        due.length
          ? h(
              'table',
              { class: 't' },
              h(
                'tbody',
                {},
                due.map((d) =>
                  h(
                    'tr',
                    { class: 'click', onclick: () => navigate(`#/devices/${d.id}`) },
                    h('td', {}, skSymbol(d.protection_class, 18)),
                    h('td', {}, h('b', {}, d.name), h('div', { class: 'small muted' }, `${d.inventory_no}${d.location ? ' · ' + d.location : ''}`)),
                    h('td', {}, dueBadge(d), d.postponed_from ? h('div', { class: 'small muted' }, '⏭ verschoben') : null),
                    h(
                      'td',
                      { style: { whiteSpace: 'nowrap', textAlign: 'right' } },
                      h('button', { class: 'btn sm', title: 'Auf den nächsten Monat verschieben …', onclick: async (e) => (e.stopPropagation(), (await postponeDialog([d])) && navigate('#/dashboard')) }, '⏭'),
                      ' ',
                      h('a', { class: 'btn sm', href: `#/inspect?device=${d.id}`, onclick: (e) => e.stopPropagation() }, 'Prüfen')
                    )
                  )
                )
              )
            )
          : h('div', { class: 'empty' }, '🎉 Keine Prüfungen in den nächsten 30 Tagen fällig.')
      ),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Letzte Prüfungen'), h('a', { href: '#/inspections', class: 'small' }, 'alle')),
        recent.length
          ? h('table', { class: 't' }, h('tbody', {}, recent.map((r) => h('tr', { class: 'click', onclick: () => navigate(`#/inspections/${r.id}`) }, h('td', {}, fmt.date(r.inspection_date)), h('td', {}, h('b', {}, r.device_name), h('div', { class: 'small muted' }, `${r.inventory_no} · ${procName(r.procedure)}`)), h('td', {}, resultBadge(r.result))))))
          : h('div', { class: 'empty' }, 'Noch keine Prüfungen durchgeführt.')
      )
    ),
    h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'row between' }, h('div', {}, h('b', {}, `${stats.inspectionsYear} Prüfungen`), ` in ${new Date().getFullYear()}, davon `, h('b', { style: { color: 'var(--bad)' } }, `${stats.failedYear} nicht bestanden`), stats.retired ? ` · ${stats.retired} ausgemustert` : ''), h('div', { class: 'row' }, h('a', { class: 'btn sm', href: '/api/calendar.ics' }, '📅 Alle Termine als Kalender (.ics)'), h('a', { class: 'btn sm', href: '/api/labels', target: '_blank' }, '🏷 Prüfplaketten drucken'))))
  );
}
