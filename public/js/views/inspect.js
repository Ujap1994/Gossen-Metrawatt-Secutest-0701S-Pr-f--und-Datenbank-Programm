// Prüfassistent: Gerät wählen → Ablauf/Modus → Schritte mit Grafik → Bewertung → Speichern
import { h, clear, fmt, toast, field, input, select, resultBadge, skSymbol, confirmDialog, debounce, add, fill } from '../ui.js';
import { get, post, del } from '../api.js';
import { state, procName, deviceTypeLabel, onSecutest } from '../state.js';
import { renderScene, sceneLegend } from '../illustrations.js';
import { calibrationText } from './settings.js';

let W = null; // laufende Prüfung
/**
 * Serienprüfung gleicher Geräte: { ids, results: {id: 'bestanden'|'nicht_bestanden'|'skip'}, template }
 * template = Einstellungen und Sichtprüfung des zuletzt gespeicherten Geräts der Serie.
 */
let SERIES = null;
const timers = new Set();

export function wizardDirty() {
  return !!(W && W.started && !W.saved);
}

function stopTimers() {
  for (const t of timers) {
    t.stopped = true;
    clearTimeout(t.id);
  }
  timers.clear();
}

/** Einmal nach ms – endet mit stopTimers (Schrittwechsel, Neuzeichnen) */
function later(ms, fn) {
  const t = { stopped: false, id: null };
  t.id = setTimeout(() => !t.stopped && fn(), ms);
  timers.add(t);
  return t;
}

/** Wiederholt fn alle ms – die nächste Abfrage startet erst, wenn die vorige fertig ist (sonst stauen sie sich beim Gerät) */
function every(ms, fn) {
  const t = { stopped: false, id: null };
  const run = async () => {
    try {
      await fn();
    } finally {
      if (!t.stopped) t.id = setTimeout(run, ms);
    }
  };
  timers.add(t);
  run();
  return t;
}

window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/inspect')) stopTimers();
});

// gerätegeführt: Das SECUTEST meldet „Protokoll fertig“ (PRF) nach der Sicherheitsprüfung und nach dem Funktionstest
let resultRedraw = null; // gesetzt, solange der Schritt „Bewertung“ angezeigt wird
onSecutest((type) => {
  if (type !== 'protocol-ready' || !W?.started || W.saved || W.cfg.mode !== 'secutest-geraet') return;
  W.protocolReady = true;
  W.protocolFetched = false;
  if (resultRedraw) fetchFromSecutest(resultRedraw);
  else toast('SECUTEST: Protokoll fertig – das Ergebnis wird im Schritt „Bewertung“ automatisch übernommen.', 'ok', 6000);
});

const MODE_INFO = {
  'secutest-geraet': { icon: '📟', title: 'SECUTEST – gerätegeführt (empfohlen)', desc: 'Du bedienst das SECUTEST wie gewohnt (Bedienerführung im Display). Das Programm zeigt passend dazu die Grafiken und Live-Werte und übernimmt am Ende alle Messwerte per RS-232 (PRO?).' },
  'secutest-pc': { icon: '💻', title: 'SECUTEST – PC-gesteuert', desc: 'Das Programm startet jede Messung selbst per Schnittstellenbefehl (MES!/WER?) und liest die Werte. Ideal, um jeden Schritt einzeln zu steuern.' },
  manuell: { icon: '✍️', title: 'Manuell – ohne SECUTEST-Verbindung', desc: 'Messwerte vom Display (oder einem anderen Prüfgerät) von Hand eintragen. Bewertung erfolgt trotzdem automatisch.' },
};

const ITEM_STATE = [
  [1, 'i. O.', 'okb'],
  [0, 'Mangel', 'badb'],
  [null, 'entfällt', ''],
];

function remoteGroupOf(step) {
  if (step.remoteGroup) return step.remoteGroup;
  if (step.type === 'function') return 'FT';
  if (step.key === 'UV_AC') return 'UV';
  return step.key;
}

function passOf(q, v) {
  if (!q.limit || !v || v.value == null) return null;
  const { op, value } = q.limit;
  if (op === '<=') return v.qualifier === '>' ? false : v.value <= value + 1e-12;
  if (op === '>=') return v.qualifier === '<' ? false : v.value >= value - 1e-12;
  return null;
}

function parseInput(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (!t) return null;
  const m = t.match(/^([<>])?\s*([-+]?\d*\.?\d+)$/);
  if (!m) return { text: t, value: null, qualifier: null };
  return { text: t, value: parseFloat(m[2]), qualifier: m[1] || null };
}

function valText(v) {
  if (!v) return '';
  if (v.qualifier) return `${v.qualifier}${fmt.num(v.value)}`;
  return v.value == null ? v.text || '' : fmt.num(v.value);
}

// ===========================================================================
// Einstieg
// ===========================================================================
export async function renderInspect({ params, navigate }) {
  stopTimers();
  if (params.series) {
    const ids = [...new Set(String(params.series).split(',').map(Number).filter(Boolean))];
    if (ids.length) {
      SERIES = { ids, results: {}, template: null };
      W = null;
      return renderSetup(ids[0], navigate);
    }
  }
  if (params.seriesdone && SERIES) return seriesSummary(navigate);
  if (params.device && SERIES && !SERIES.ids.includes(Number(params.device))) SERIES = null; // Serie verlassen
  if (W && !W.saved && W.started && (!params.device || Number(params.device) === W.device.id)) return renderWizard(navigate);
  if (W?.saved || (W && params.device && Number(params.device) !== W.device.id)) W = null;
  if (params.device) return renderSetup(Number(params.device), navigate);
  return renderPicker(navigate);
}

// ---------------------------------------------------------------------------
// Serienprüfung
// ---------------------------------------------------------------------------
function seriesNext(currentId) {
  if (!SERIES) return null;
  const i = SERIES.ids.indexOf(currentId);
  return SERIES.ids.slice(i + 1).find((id) => !SERIES.results[id]) ?? SERIES.ids.find((id) => !SERIES.results[id] && id !== currentId) ?? null;
}

function seriesBar(currentId, navigate, { allowSkip = false } = {}) {
  if (!SERIES || !SERIES.ids.includes(currentId)) return null;
  const pos = SERIES.ids.indexOf(currentId) + 1;
  const done = Object.keys(SERIES.results).length;
  const skip = () => {
    SERIES.results[currentId] = 'skip';
    const next = seriesNext(currentId);
    W = null;
    if (next) navigate(`#/inspect?device=${next}`);
    else navigate('#/inspect?seriesdone=1');
  };
  return h(
    'div',
    { class: 'series-bar' },
    h('b', {}, `🔁 Serienprüfung: Gerät ${pos} von ${SERIES.ids.length}`),
    h('span', { class: 'muted small' }, `${done} erledigt`),
    h('div', { class: 'dots' }, SERIES.ids.map((id) => h('span', { class: `${{ bestanden: 'ok', nicht_bestanden: 'bad', skip: 'skip' }[SERIES.results[id]] || ''} ${id === currentId ? 'cur' : ''}`, title: SERIES.results[id] || 'offen' }))),
    h('span', { style: { flex: 1 } }),
    allowSkip ? h('button', { class: 'btn sm', onclick: skip }, 'Gerät überspringen') : null,
    h('button', { class: 'btn sm ghost', onclick: async () => (await confirmDialog('Serienprüfung beenden? Bereits gespeicherte Prüfungen bleiben erhalten.')) && ((SERIES = null), (W = null), navigate('#/devices')) }, 'Serie beenden')
  );
}

async function seriesSummary(navigate) {
  const s = SERIES;
  const devices = await Promise.all(s.ids.map((id) => get(`/devices/${id}`).then((r) => r.device).catch(() => null)));
  const passed = s.ids.filter((id) => s.results[id] === 'bestanden');
  const label = { bestanden: ['ok', 'bestanden'], nicht_bestanden: ['bad', 'nicht bestanden'], skip: ['muted', 'übersprungen'] };
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, '🔁 Serienprüfung abgeschlossen')),
    h(
      'div',
      { class: 'card stack' },
      h('p', {}, `${s.ids.length} Geräte: `, h('b', { style: { color: 'var(--ok)' } }, `${passed.length} bestanden`), ', ', h('b', { style: { color: 'var(--bad)' } }, `${s.ids.filter((id) => s.results[id] === 'nicht_bestanden').length} nicht bestanden`), `, ${s.ids.filter((id) => !s.results[id] || s.results[id] === 'skip').length} übersprungen/offen.`),
      h('table', { class: 't' }, h('tbody', {}, devices.map((d, i) => (d ? h('tr', { class: 'click', onclick: () => navigate(`#/devices/${d.id}`) }, h('td', { class: 'mono' }, d.inventory_no), h('td', {}, d.name), h('td', {}, h('span', { class: `badge ${(label[s.results[s.ids[i]]] || ['muted'])[0]}` }, (label[s.results[s.ids[i]]] || [null, 'offen'])[1])), h('td', {}, d.next_due_date ? fmt.date(d.next_due_date) : '—')) : null)))),
      h('div', { class: 'row' }, passed.length ? h('a', { class: 'btn primary', href: `/api/labels?ids=${passed.join(',')}`, target: '_blank' }, `🏷 Prüfplaketten für ${passed.length} bestandene Geräte`) : null, h('button', { class: 'btn', onclick: () => ((SERIES = null), navigate('#/devices')) }, 'Zur Geräteliste'))
    )
  );
}

async function renderPicker(navigate) {
  const list = h('div', { class: 'table-wrap' });
  const load = async (q = '') => {
    const devices = await get(`/devices?status=alle-aktiven&sort=due&q=${encodeURIComponent(q)}`);
    clear(list).appendChild(
      devices.length
        ? h('table', { class: 't' }, h('tbody', {}, devices.map((d) => h('tr', { class: 'click', onclick: () => navigate(`#/inspect?device=${d.id}`) }, h('td', {}, skSymbol(d.protection_class, 18)), h('td', { class: 'mono' }, d.inventory_no), h('td', {}, h('b', {}, d.name), h('div', { class: 'small muted' }, [d.manufacturer, d.model, d.location].filter(Boolean).join(' · '))), h('td', {}, d.next_due_date ? fmt.date(d.next_due_date) : 'neu'), h('td', {}, h('span', { class: 'btn sm primary' }, 'Prüfen →'))))))
        : h('div', { class: 'empty' }, 'Kein Gerät gefunden.')
    );
  };
  const search = input({ placeholder: '🔍 Gerät suchen …', oninput: debounce((e) => load(e.target.value), 250) });
  await load();
  setTimeout(() => search.focus(), 50);
  return h('div', {}, h('div', { class: 'page-head' }, h('h1', {}, 'Gerät prüfen'), h('a', { class: 'btn primary', href: '#/devices/new' }, '+ Neues Gerät anlegen & prüfen')), h('div', { class: 'card stack' }, h('p', { class: 'muted' }, 'Welches Gerät möchtest du prüfen? (sortiert nach Fälligkeit)'), search, list));
}

async function renderSetup(deviceId, navigate) {
  const { device } = await get(`/devices/${deviceId}`);
  const procs = await get(`/devices/${deviceId}/procedures`);
  const meta = state.meta;
  const st = state.secutest || (await get('/secutest/status').catch(() => null));
  const connected = !!st?.connected;
  const cfg = {
    procedureId: procs.recommended,
    mode: connected ? 'secutest-geraet' : 'manuell',
    standard: device.last_inspection_date ? meta.settings.defaultStandard : meta.settings.defaultStandard,
    reason: device.last_inspection_date ? 'wiederholung' : 'erstpruefung',
    profile: meta.settings.limitProfile,
  };
  // Serienprüfung: Einstellungen des Vorgängers übernehmen (soweit für dieses Gerät möglich)
  const tpl = SERIES?.ids.includes(deviceId) ? SERIES.template : null;
  if (tpl) {
    const p = procs.procedures.find((x) => x.id === tpl.cfg.procedureId && !x.disabled);
    if (p) cfg.procedureId = p.id;
    if (tpl.cfg.mode === 'manuell' || connected) cfg.mode = tpl.cfg.mode;
    cfg.standard = tpl.cfg.standard;
    cfg.profile = tpl.cfg.profile;
  }
  const copyChecks = h('input', { type: 'checkbox', checked: !!tpl?.checks && Object.keys(tpl.checks).length > 0 });

  const procBox = h('div', { class: 'grid c2' });
  const renderProcs = () => {
    clear(procBox);
    for (const p of procs.procedures) {
      const el = h(
        'div',
        { class: `choice ${cfg.procedureId === p.id ? 'on' : ''} ${p.disabled ? 'disabled' : ''}`, onclick: () => !p.disabled && ((cfg.procedureId = p.id), renderProcs()) },
        h('div', { class: 't' }, p.name, p.recommended ? h('span', { class: 'badge info' }, 'empfohlen') : null),
        h('div', { class: 'd' }, p.description),
        p.disabled ? h('div', { class: 'alert warn small', style: { marginBottom: 0 } }, '⚠ ', p.disabledReason) : null
      );
      procBox.appendChild(el);
    }
  };
  renderProcs();

  const modeBox = h('div', { class: 'grid c3' });
  const renderModes = () => {
    clear(modeBox);
    for (const [id, m] of Object.entries(MODE_INFO)) {
      const needsDevice = id !== 'manuell';
      const dis = needsDevice && !connected;
      modeBox.appendChild(h('div', { class: `choice ${cfg.mode === id ? 'on' : ''} ${dis ? 'disabled' : ''}`, onclick: () => !dis && ((cfg.mode = id), renderModes()) }, h('div', { class: 't' }, m.icon, ' ', m.title), h('div', { class: 'd' }, m.desc), dis ? h('div', { class: 'small', style: { color: 'var(--bad)', marginTop: '4px' } }, 'SECUTEST nicht verbunden') : null));
    }
  };
  renderModes();

  const stdSel = select([['VDE 0702', 'DIN VDE 0702 – Wiederholungsprüfung'], ['VDE 0701', 'DIN VDE 0701 – nach Instandsetzung/Änderung']], cfg.standard, { onchange: (e) => (cfg.standard = e.target.value) });
  const reasonSel = select(Object.entries(meta.reasons), cfg.reason, {
    onchange: (e) => {
      cfg.reason = e.target.value;
      if (['instandsetzung', 'aenderung'].includes(cfg.reason)) stdSel.value = cfg.standard = 'VDE 0701';
    },
  });
  const profSel = select(meta.profiles.map((p) => [p.id, p.name]), cfg.profile, { onchange: (e) => (cfg.profile = e.target.value) });

  const err = h('div');
  const start = async () => {
    clear(err);
    try {
      const proc = await post('/procedure', { procedureId: cfg.procedureId, deviceId, profile: cfg.profile, standard: cfg.standard });
      W = {
        device,
        deviceOverrides: {},
        cfg,
        proc,
        stepIdx: 0,
        points: {},
        checks: {},
        skipped: {},
        display: {},
        started: true,
        startedAt: new Date().toISOString(),
        intervalMonths: device.interval_months,
        inspector: meta.settings.inspector.name || '',
        action: null,
        actionNote: '',
        notes: '',
        deviceVerdict: null,
        rawProtocol: null,
        meterIdn: st?.identity ? [st.identity.model, st.identity.deviceId, st.identity.date].filter(Boolean).join(' · ') : null,
        saved: null,
        remoteActive: false,
        prefilled: false,
        auto: cfg.mode === 'secutest-pc', // Automatik: messen, eintragen, weiterschalten
      };
      if (tpl) {
        W.inspector = tpl.inspector || W.inspector;
        if (copyChecks.checked && tpl.checks) {
          const visual = proc.steps.find((x) => x.type === 'visual');
          for (const it of visual?.items || []) if (tpl.checks[it.item]) W.checks[it.item] = { ...tpl.checks[it.item] };
          W.prefilled = true;
        }
      }
      renderWizard(navigate).then((n) => clear(document.querySelector('.content')).appendChild(n));
    } catch (e) {
      clear(err).appendChild(h('div', { class: 'alert bad' }, e.message));
    }
  };

  const blockers = [];
  const cal = meta.calibration;
  if (['soon', 'overdue', 'unknown'].includes(cal?.state)) blockers.push(h('div', { class: `alert ${cal.state === 'overdue' ? 'bad' : 'warn'}` }, h('b', {}, '📏 Prüfmittel: '), calibrationText(cal), cal.state === 'overdue' ? ' Messwerte eines nicht kalibrierten Prüfgeräts sind nicht belastbar.' : '', ' ', h('a', { href: '#/settings/program' }, 'Kalibrierdaten')));
  if (device.status === 'ausgemustert') blockers.push(h('div', { class: 'alert info' }, 'Dieses Gerät ist ausgemustert. Eine Prüfung ist trotzdem möglich (z. B. Wiederinbetriebnahme).'));
  if (!procs.autoMode.allowed) blockers.push(h('div', { class: 'alert warn' }, h('b', {}, '⚠ Auto-Modus nicht möglich:'), procs.autoMode.reason));

  return h(
    'div',
    {},
    seriesBar(deviceId, navigate, { allowSkip: true }),
    tpl ? h('div', { class: 'alert info' }, h('b', {}, 'Vom vorherigen Gerät übernommen: '), `Prüfablauf, Durchführung, Norm und Grenzwerte${tpl.inspector ? ', Prüfer' : ''}. Bitte prüfen und bei Bedarf ändern.`, tpl.checks && Object.keys(tpl.checks).length ? h('label', { class: 'check', style: { marginTop: '6px' } }, copyChecks, 'Sichtprüfung vorausfüllen (jeden Punkt am Gerät kontrollieren!)') : null) : null,
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'muted mono' }, device.inventory_no), h('h1', {}, `Prüfung: ${device.name}`)), h('a', { class: 'btn ghost', href: `#/devices/${device.id}` }, 'Zum Gerät')),
    h('div', { class: 'card' }, h('div', { class: 'row' }, skSymbol(device.protection_class, 30), h('div', {}, h('b', {}, `${device.protection_class} · ${deviceTypeLabel(device.device_type)}`), h('div', { class: 'small muted' }, [device.manufacturer, device.model, device.location, device.cable_length_m ? `Leitung ${fmt.num(device.cable_length_m)} m` : null].filter(Boolean).join(' · ') || '—')), h('span', { class: 'grow', style: { flex: 1 } }), h('div', { class: 'small muted' }, 'Prüfdatum: ', h('b', {}, `${fmt.date(fmt.today())} (heute)`), ' – wird automatisch eingetragen'))),
    blockers,
    h('div', { class: 'card' }, h('h2', {}, '1. Prüfablauf'), procBox),
    h('div', { class: 'card' }, h('h2', {}, '2. Durchführung'), modeBox, !connected ? h('div', { class: 'row', style: { marginTop: '10px' } }, h('a', { class: 'btn sm', href: '#/secutest' }, '📟 SECUTEST verbinden / suchen'), h('button', { class: 'btn sm', onclick: async () => (await post('/secutest/connect', { simulator: true }), toast('Simulator verbunden', 'ok'), navigate(`#/inspect?device=${deviceId}`)) }, '🧪 Simulator verwenden')) : null),
    h('div', { class: 'card' }, h('h2', {}, '3. Norm & Grenzwerte'), h('div', { class: 'grid c3' }, field('Anlass', reasonSel), field('Norm', stdSel), field('Grenzwerte', profSel, 'Das SECUTEST selbst nutzt die Werte von 1997 – das Programm bewertet zusätzlich nach aktueller Norm.'))),
    err,
    h('div', { class: 'row end' }, h('button', { class: 'btn primary lg', onclick: start }, 'Prüfung starten →'))
  );
}

// ===========================================================================
// Assistent
// ===========================================================================
async function renderWizard(navigate) {
  stopTimers();
  const root = h('div');
  const draw = () => {
    stopTimers();
    clear(root).appendChild(stepView(navigate, draw));
  };
  draw();
  return root;
}

function stepStatus(step) {
  if (step.type === 'measure' || step.type === 'function') {
    if (W.skipped[step.id]) return 'done';
    const pts = W.points[step.id] || [];
    const vals = pts.flatMap((p) => Object.entries(p.values));
    if (!vals.length) return '';
    const fail = vals.some(([k, v]) => {
      const q = step.quantities.find((x) => x.key === k);
      return q && passOf(q, v) === false;
    });
    return fail ? 'fail' : 'done';
  }
  if (step.type === 'visual' || step.type === 'checks') {
    const items = step.items || [];
    const answered = items.filter((i) => W.checks[i.item] && 'passed' in W.checks[i.item]);
    if (!answered.length) return '';
    return answered.some((i) => W.checks[i.item].passed === 0) ? 'fail' : 'done';
  }
  return '';
}

function stepView(navigate, redraw) {
  resultRedraw = null;
  const steps = W.proc.steps;
  const step = steps[W.stepIdx];
  // außerhalb der Messschritte fasst der Prüfer das Gerät an: vor der nächsten Messung mit Prüfspannung neu bestätigen
  if (step.type !== 'measure') W.handsOff = false;
  const progress = h(
    'div',
    { class: 'wizard-progress' },
    steps.map((s, i) => h('button', { class: `${i === W.stepIdx ? 'cur' : ''} ${stepStatus(s)}`, onclick: async () => (step.type !== 'function' || (await functionTestFinished())) && ((W.stepIdx = i), redraw()) }, h('span', { class: 'n' }, `${i + 1}`), s.title.replace(/\s*\(.*\)$/, '')))
  );
  const go = async (delta) => {
    if (delta > 0 && !(await canLeave(step))) return;
    if (step.type === 'function' && !(await functionTestFinished())) return;
    W.stepIdx = Math.max(0, Math.min(steps.length - 1, W.stepIdx + delta));
    redraw();
  };
  const abort = async () => {
    if (!(await confirmDialog('Prüfung abbrechen? Alle eingegebenen Werte gehen verloren.', { danger: true, confirmLabel: 'Prüfung verwerfen' }))) return;
    if (!(await functionTestFinished())) return;
    if (W.remoteActive) post('/secutest/remote/end').catch(() => {});
    const id = W.device.id;
    W = null;
    navigate(`#/devices/${id}`);
  };

  const panel = h('div', { class: 'card stack' });
  add(panel, 
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, `${W.stepIdx + 1}. ${step.title}`), h('div', { class: 'row' }, W.cfg.mode === 'secutest-pc' ? h('button', { class: `btn sm ${W.auto ? 'ok' : ''}`, title: 'Automatik: Messungen starten, Werte eintragen und weiterschalten', onclick: () => ((W.auto = !W.auto), redraw()) }, W.auto ? '⚙ Automatik an' : '⚙ Automatik aus') : null, h('span', { class: 'badge info' }, MODE_INFO[W.cfg.mode].icon + ' ' + (W.cfg.mode === 'manuell' ? 'manuell' : W.cfg.mode === 'secutest-pc' ? 'PC-gesteuert' : 'gerätegeführt')))),
    step.instructions?.length ? h('ol', { class: 'instr' }, step.instructions.map((t) => h('li', {}, t))) : null,
    (step.hints || []).map((t) => h('div', { class: 'hint' }, '💡 ', t))
  );
  const body = h('div');
  panel.appendChild(body);
  const next = () => go(1);
  if (step.type === 'prep') prepPanel(step, body, redraw, next);
  else if (step.type === 'visual' || step.type === 'checks') checksPanel(step, body, redraw, step.type === 'visual' ? 'sicht' : 'sonstiges');
  else if (step.type === 'measure') measurePanel(step, body, redraw, next);
  else if (step.type === 'function') functionPanel(step, body, redraw);
  else if (step.type === 'result') resultPanel(step, body, navigate, redraw);

  panel.appendChild(
    h(
      'div',
      { class: 'row between', style: { marginTop: '16px' } },
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: abort }, '✕ Abbrechen'), W.stepIdx > 0 ? h('button', { class: 'btn', onclick: () => go(-1) }, '← Zurück') : null),
      W.stepIdx < steps.length - 1 ? h('button', { class: 'btn primary', onclick: () => go(1) }, 'Weiter →') : null
    )
  );

  const scene = { ...step.scene };
  if (W.cfg.mode === 'manuell') scene.connected = false;
  return h(
    'div',
    {},
    seriesBar(W.device.id, navigate),
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'muted' }, `${W.device.inventory_no} · ${procName(W.proc.id)}`), h('h1', {}, W.device.name)), h('div', { class: 'small muted' }, `Grenzwerte: ${state.meta.profiles.find((p) => p.id === W.cfg.profile)?.short} · ${W.cfg.standard}`)),
    (W.proc.warnings || []).map((w) => h('div', { class: 'alert warn small' }, '⚠ ', w)),
    progress,
    h('div', { class: 'step-layout' }, h('div', {}, h('div', { class: 'scene-box', html: renderScene(scene) }), h('ul', { class: 'legend' }, sceneLegend(scene).map((l) => h('li', {}, l)))), panel)
  );
}

async function canLeave(step) {
  if (step.type === 'measure' && !step.optional) {
    const has = (W.points[step.id] || []).some((p) => p.values[step.key]?.value != null);
    if (!has && !W.skipped[step.id]) return confirmDialog(`Für „${step.title}“ ist noch kein Messwert eingetragen. Ohne Wert gilt die Prüfung als nicht bestanden (sofern der Schritt nicht begründet entfällt). Trotzdem weiter?`, { confirmLabel: 'Trotzdem weiter' });
  }
  if (step.type === 'visual') {
    const open = step.items.filter((i) => !W.checks[i.item] || !('passed' in W.checks[i.item]));
    if (open.length) return confirmDialog(`${open.length} Punkt(e) der Sichtprüfung sind noch offen. Trotzdem weiter?`, { confirmLabel: 'Weiter' });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Vorbereitung
// ---------------------------------------------------------------------------
function prepPanel(step, body, redraw, next) {
  const sw = W.proc.switchPos;
  if (W.cfg.mode === 'manuell') {
    body.appendChild(h('div', { class: 'alert info small' }, 'Manueller Modus: Messungen am SECUTEST (oder einem anderen Prüfgerät) durchführen und die Anzeigewerte in den folgenden Schritten eintragen.'));
    return;
  }
  const out = h('div');
  const keypad = remoteKeypad();
  add(body, 
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => {
      try {
        await post('/secutest/switch', { position: sw });
        toast(`Programmablauf auf „${sw}“ gesetzt`, 'ok');
      } catch (e) {
        toast(e.message, 'bad');
      }
    } }, `↻ Schalterstellung „${sw}“ per Schnittstelle setzen`)),
    h('p', { class: 'small muted' }, 'Laut Anleitung (RST!) übernimmt das SECUTEST die Stellung per Befehl – drehe den Schalter trotzdem auf die angezeigte Position, damit Gerät und Bildschirm übereinstimmen.'),
    out
  );
  if (W.cfg.mode === 'secutest-pc') {
    body.appendChild(
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          clear(out).appendChild(h('div', { class: 'muted' }, 'Prüfe Anschluss …'));
          try {
            const r = await post('/secutest/precheck');
            W.remoteActive = true;
            const line = (ok, good, bad) => h('div', {}, ok ? '✅ ' : '❌ ', ok ? good : bad);
            const peExpected = W.device.protection_class === 'SK I';
            const allOk = r.noShort && r.probe && r.switchedOn && r.protectiveConductor === peExpected;
            if (allOk && W.auto) later(1500, next);
            fill(out, 
              h('div', { class: 'card' },
                line(r.noShort, 'Kein Kurzschluss am Prüfling', 'KURZSCHLUSS am Prüfling – Prüfung nicht fortsetzen!'),
                line(r.probe, 'Sonde angeschlossen', 'Sonde nicht angeschlossen (Buchsen 4/5)'),
                line(r.switchedOn, 'Prüfling ist eingeschaltet', 'Prüfling scheint AUSGESCHALTET – Netzschalter einschalten!'),
                line(r.protectiveConductor === peExpected, r.protectiveConductor ? 'Schutzleiter erkannt (SK I)' : 'Kein Schutzleiter erkannt (SK II)', r.protectiveConductor ? 'Schutzleiter erkannt – Gerät ist evtl. SK I statt SK II?' : 'KEIN Schutzleiter erkannt, obwohl SK I erfasst – Schutzleiter unterbrochen?'),
                r.status?.flags?.list?.length ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Anschluss: ', r.status.flags.list.join(', ')) : null,
                W.auto ? h('div', { class: 'small', style: { marginTop: '6px' } }, allOk ? '⚙ Alles in Ordnung – weiter zur Sichtprüfung …' : '⚙ Automatik angehalten – Anschluss prüfen und erneut starten.') : null
              )
            );
          } catch (e) {
            clear(out).appendChild(h('div', { class: 'alert bad' }, e.message));
          }
        },
      }, W.auto ? '▶ Automatische Prüfung starten' : '🔍 Anschlusskontrolle durchführen')
    );
  } else {
    const live = h('div');
    add(body, h('h3', {}, 'Live vom SECUTEST'), live, keypad);
    every(2000, async () => {
      try {
        const r = await get('/secutest/live');
        fill(live, h('div', { class: 'small' }, r.flags.list.length ? '🔌 ' + r.flags.list.join(' · ') : 'Kein Prüfling erkannt'), r.flags.slDose && W.device.protection_class !== 'SK I' ? h('div', { class: 'alert warn small' }, 'Schutzleiter an der Prüfdose erkannt – ist das Gerät wirklich SK II?') : null);
      } catch (e) {
        clear(live).appendChild(h('div', { class: 'small muted' }, `Keine Live-Daten: ${e.message}`));
      }
    });
  }
}

function remoteKeypad() {
  const press = (key) => post('/secutest/key', { key }).catch((e) => toast(e.message, 'bad'));
  return h('div', { class: 'stack' }, h('div', { class: 'small muted' }, 'Fernbedienung (simuliert Tastendruck am SECUTEST):'), h('div', { class: 'keypad' }, h('button', { class: 'btn', onclick: () => press('UP') }, '▲'), h('button', { class: 'btn', onclick: () => press('DOWN') }, '▼'), h('button', { class: 'btn primary', onclick: () => press('ENTER') }, '↵ Start/OK'), h('button', { class: 'btn', onclick: () => press('HELP') }, 'ⓘ Hilfe'), h('button', { class: 'btn', onclick: () => post('/secutest/abort').catch(() => {}) }, '^C Abbruch')));
}

// ---------------------------------------------------------------------------
// Sichtprüfung / Checklisten
// ---------------------------------------------------------------------------
function checksPanel(step, body, redraw, group) {
  const list = h('div');
  const draw = () => {
    clear(list);
    for (const it of step.items) {
      const cur = W.checks[it.item];
      const note = input({ placeholder: 'Mangel beschreiben …', value: cur?.note || '', oninput: (e) => (W.checks[it.item].note = e.target.value) });
      list.appendChild(
        h(
          'div',
          { class: 'vis-item' },
          h('div', { class: 'lbl' }, it.label, cur?.passed === 0 ? h('div', { style: { marginTop: '6px' } }, note) : null),
          h('div', { class: 'seg' }, ITEM_STATE.map(([v, l, cls]) => h('button', { class: `${cur && cur.passed === v ? 'on ' + cls : ''}`, onclick: () => ((W.checks[it.item] = { group, label: it.label, passed: v, note: cur?.note || '' }), draw()) }, l)))
        )
      );
    }
  };
  draw();
  if (W.prefilled && step.type === 'visual') body.appendChild(h('div', { class: 'alert warn small' }, h('b', {}, 'Serienprüfung:'), 'Die Antworten wurden vom vorherigen Gerät übernommen. Kontrolliere jeden Punkt an diesem Gerät und ändere ihn bei einem Mangel.'));
  add(body, h('div', { class: 'row end' }, h('button', { class: 'btn sm', onclick: () => (step.items.forEach((it) => (W.checks[it.item] = { group, label: it.label, passed: 1, note: '' })), draw()) }, '✓ Alle in Ordnung')), list);
}

// ---------------------------------------------------------------------------
// Messschritt
// ---------------------------------------------------------------------------
function ensurePoint(step) {
  if (!W.points[step.id] || !W.points[step.id].length) W.points[step.id] = [{ point: step.multiPoint ? 'Messpunkt 1' : '', values: {} }];
  return W.points[step.id];
}

function takeValues(step, values, pointIdx) {
  const pts = ensurePoint(step);
  const p = pts[pointIdx ?? pts.length - 1];
  for (const q of step.quantities) {
    let v = values[q.key];
    if (!v && q.key === step.key) {
      const alt = Object.entries(values).find(([k]) => !k.includes('_'));
      if (alt) v = alt[1];
    }
    if (v && v.value != null) p.values[q.key] = { ...v, source: 'secutest' };
  }
}

/** Zweimal gleich gelesene Werte übernehmen (vertauschte Zeichen erkennt die Prüfsumme des Geräts nicht) */
function takeConfirmed(step, r) {
  const vals = Object.fromEntries(Object.entries(r.values || {}).filter(([, v]) => v.value != null));
  if (!Object.keys(vals).length) {
    toast(r.unconfirmed?.length ? 'Messwert schwankt oder wurde verfälscht übertragen – bitte nochmal übernehmen.' : 'Keine Messwerte vorhanden.', 'warn', 6000);
    return false;
  }
  takeValues(step, vals);
  if (r.unconfirmed?.length) toast(`Nicht stabil gelesen und daher nicht übernommen: ${r.unconfirmed.join(', ')}`, 'warn', 6000);
  return true;
}

function measurePanel(step, body, redraw, next) {
  const pts = ensurePoint(step);
  if (W.display[step.id] == null) W.display[step.id] = W.cfg.mode === 'manuell' && !!state.meta.settings.manualDisplayCorrection;
  const ptsBox = h('div');
  const liveBox = h('div', { class: 'live' });
  const statusLine = h('div', { class: 'small muted' });
  let lastLive = {};

  const drawPoints = () => {
    clear(ptsBox);
    pts.forEach((p, idx) => {
      const rows = step.quantities.map((q) => {
        const v = p.values[q.key];
        const inp = input({
          value: valText(v),
          placeholder: q.limit ? q.limit.text.replace(/[≤≥]\s*/, '') : '',
          inputmode: 'decimal',
          oninput: (e) => {
            const pv = parseInput(e.target.value);
            if (pv) p.values[q.key] = { ...pv, source: 'manuell', display: W.display[step.id] };
            else delete p.values[q.key];
            badge.replaceWith((badge = passBadge(q, p.values[q.key])));
          },
        });
        let badge = passBadge(q, v);
        return h('div', { class: 'qrow' }, h('div', {}, h('div', {}, q.label), h('div', { class: 'lim' }, q.limit ? `Grenzwert ${q.limit.text}` : 'Information')), h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, inp, h('span', { class: 'muted' }, q.unit)), badge);
      });
      ptsBox.appendChild(
        h(
          'div',
          { class: 'point' },
          step.multiPoint
            ? h('div', { class: 'row between' }, h('input', { class: 'input', style: { maxWidth: '320px' }, value: p.point || '', placeholder: 'Messpunkt (z. B. Gehäuseschraube hinten)', oninput: (e) => (p.point = e.target.value) }), pts.length > 1 ? h('button', { class: 'icon-btn', title: 'Messpunkt entfernen', onclick: () => (pts.splice(idx, 1), drawPoints()) }, '✕') : null)
            : null,
          rows
        )
      );
    });
  };
  drawPoints();

  // Leitungslänge (R_SL-Grenzwert)
  if (step.key === 'RSL') {
    const len = input({ type: 'number', step: '0.5', min: 0, value: W.deviceOverrides.cable_length_m ?? W.device.cable_length_m ?? '', placeholder: '≤ 5', style: { maxWidth: '110px' } });
    len.addEventListener(
      'change',
      debounce(async () => {
        W.deviceOverrides.cable_length_m = len.value === '' ? null : Number(len.value);
        await refreshLimits();
        redraw();
      }, 200)
    );
    body.appendChild(h('div', { class: 'row small' }, 'Leitungslänge:', len, 'm → Grenzwert', h('b', {}, step.quantities[0].limit?.text || '—'), h('span', { class: 'muted' }, step.quantities[0].limit?.basis || '')));
  }

  // SECUTEST-Steuerung
  const ctrl = h('div', { class: 'row' });
  const group = remoteGroupOf(step);
  if (W.cfg.mode === 'secutest-pc' && step.remote) {
    let running = false;
    const startBtn = h('button', {
      class: 'btn primary',
      onclick: async () => {
        try {
          await post('/secutest/remote/start', { group });
          W.remoteActive = true;
          running = true;
          statusLine.textContent = '⏱ Messung läuft – Live-Werte werden gelesen …';
          poll();
        } catch (e) {
          toast(e.message, 'bad', 6000);
        }
      },
    }, '▶ Messung starten');
    const poll = () =>
      every(1500, async () => {
        if (!running) return;
        try {
          const r = await get(`/secutest/remote/read?group=${group}`);
          lastLive = r.values;
          drawLive(liveBox, r.values);
        } catch (e) {
          statusLine.textContent = `⚠ ${e.message}`;
        }
      });
    add(ctrl, startBtn);
    if (step.key === 'RSL') add(ctrl, h('button', { class: 'btn', onclick: () => post('/secutest/remote/start', { group, second: true }).then(() => toast('Polarität gewechselt (−)', 'ok')).catch((e) => toast(e.message, 'bad')) }, '⇄ Polung wechseln'));
    add(ctrl, h('button', { class: 'btn ok', onclick: async () => {
      if (!Object.keys(lastLive).length) return toast('Noch keine Messwerte – Messung starten.', 'warn');
      try {
        const r = await get(`/secutest/remote/read?group=${group}&confirm=1`);
        if (!takeConfirmed(step, r)) return;
        running = false;
        stopTimers();
        statusLine.textContent = '✓ Wert übernommen';
        drawPoints();
      } catch (e) {
        toast(e.message, 'bad');
      }
    } }, '✓ Wert übernehmen'));
    if (W.auto) autoMeasureStep(step, { body, liveBox, drawPoints, next, redraw });
  } else if (W.cfg.mode === 'secutest-geraet' && step.deviceGroup) {
    every(1500, async () => {
      try {
        const r = await get('/secutest/live');
        if (r.group) {
          lastLive = r.values;
          statusLine.textContent = r.group === step.deviceGroup ? '⏱ SECUTEST misst gerade diesen Schritt' : `SECUTEST misst gerade: ${r.group}`;
          drawLive(liveBox, r.values);
        } else statusLine.textContent = 'SECUTEST: keine laufende Messung – am Gerät mit ↵ starten bzw. Bedienerführung folgen.';
      } catch (e) {
        statusLine.textContent = `⚠ ${e.message}`;
      }
    });
    add(ctrl, h('button', { class: 'btn', onclick: async () => {
      if (!Object.keys(lastLive).length) return toast('Gerade kein Live-Wert vorhanden', 'warn');
      try {
        const r = await get('/secutest/live?confirm=1');
        if (r.group !== step.deviceGroup) return toast('SECUTEST misst gerade nicht diesen Schritt', 'warn');
        if (takeConfirmed(step, r)) (drawPoints(), toast('Live-Wert übernommen', 'ok'));
      } catch (e) {
        toast(e.message, 'bad');
      }
    } }, '✓ Live-Wert übernehmen'));
    body.appendChild(h('div', { class: 'small muted' }, 'Die endgültigen (um den Gebrauchsfehler korrigierten) Werte holt das Programm am Ende automatisch vom SECUTEST (Schritt „Bewertung“).'));
  }

  if (step.multiPoint) add(ctrl, h('button', { class: 'btn', onclick: () => (pts.push({ point: `Messpunkt ${pts.length + 1}`, values: {} }), drawPoints()) }, '+ Weiterer Messpunkt'));

  const skip = skipControl(step, redraw);
  const disp = W.cfg.mode === 'manuell' && ['RSL', 'RISO', 'IEA', 'IB', 'ISONDE'].includes(step.key)
    ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: W.display[step.id], onchange: (e) => ((W.display[step.id] = e.target.checked), pts.forEach((p) => Object.values(p.values).forEach((v) => (v.display = e.target.checked)))) }), 'Anzeigewerte des SECUTEST (Gebrauchsfehler laut Anhang berücksichtigen)')
    : null;

  add(body, ctrl, statusLine, liveBox, ptsBox, disp, skip);
}

/**
 * Automatik (PC-gesteuert): Vorwarnung → Messung bis zum stabilen, zweimal gleich gelesenen Wert →
 * eintragen → bewerten → weiterschalten. Hält bei Grenzwertverletzung oder Fehler an.
 */
function autoMeasureStep(step, { body, liveBox, drawPoints, next, redraw }) {
  const pts = ensurePoint(step);
  if (pts[pts.length - 1].values[step.key]?.value != null || W.skipped[step.id]) return; // schon gemessen
  const banner = h('div', { class: 'alert info' });
  body.prepend(banner);
  if (step.optional) return fill(banner, '⚙ Optionaler Schritt – „▶ Messung starten“ oder unten als „entfällt“ markieren.');
  const idx = W.stepIdx;
  const group = remoteGroupOf(step);
  const alive = () => W && W.stepIdx === idx && W.auto && document.body.contains(banner);
  const pause = h('button', { class: 'btn sm', onclick: () => ((W.auto = false), redraw()) }, '⏸ Automatik anhalten');
  const unit = (k) => state.meta.quantities[k]?.unit ?? state.meta.quantities[k.replace(/_(MIN|MAX|LIVE)$/, '')]?.unit ?? '';
  const shown = (k, v) => (v ? `${valText(v)} ${unit(k)}` : '–');
  let started = false;
  let running = false;
  let n = step.key === 'RSL' ? 5 : 3;

  // Wert übernehmen, bewerten und weiterschalten (bei Grenzwertverletzung anhalten)
  const finish = (r) => {
    if (!takeConfirmed(step, r)) return fill(banner, '⚙ Kein stabiler Wert – „▶ Messung starten“ / „✓ Wert übernehmen“ von Hand.');
    drawPoints();
    const p = pts[pts.length - 1];
    const fails = step.quantities.filter((q) => passOf(q, p.values[q.key]) === false);
    if (fails.length) {
      banner.className = 'alert bad';
      return fill(banner, `✘ ${fails.map((q) => q.label).join(', ')}: Grenzwert nicht eingehalten – Automatik angehalten. Messung wiederholen oder mit „Weiter“ fortsetzen.`);
    }
    banner.className = 'alert ok';
    let m = 3;
    const more = h('button', { class: 'btn sm', onclick: () => (pts.push({ point: `Messpunkt ${pts.length + 1}`, values: {} }), redraw()) }, '+ Weiterer Messpunkt');
    const advance = () => {
      if (!alive()) return;
      if (m <= 0) return next();
      fill(banner, `✔ Messwert übernommen – weiter in ${m} s `, more, ' ', pause);
      m -= 1;
      later(1000, advance);
    };
    advance();
  };

  const measure = async (fresh = false) => {
    if (running || (started && !fresh) || !alive()) return;
    started = running = true;
    banner.className = 'alert info';
    fill(banner, h('b', {}, '⏱ Messung läuft – Prüfling nicht berühren!'), ' Der Wert wird übernommen, sobald er stabil ist.');
    // Live-Werte schickt der Server während der Messung – kein zusätzliches Abfragen (das Gerät verkraftet nur wenige pro Sekunde)
    const unsub = onSecutest((type, data) => type === 'measure' && data.group === group && document.body.contains(liveBox) && drawLive(liveBox, data.values));
    let r;
    try {
      r = await post('/secutest/remote/auto', { group, fresh });
    } catch (e) {
      if (!document.body.contains(banner)) return;
      banner.className = 'alert bad';
      return fill(banner, `✘ ${e.message} – Automatik angehalten. `, h('button', { class: 'btn sm', onclick: () => measure(true) }, '↻ Messung wiederholen'));
    } finally {
      unsub();
      running = false;
    }
    W.remoteActive = true;
    if (!document.body.contains(banner) || W.stepIdx !== idx) return;
    drawLive(liveBox, { ...r.live, ...r.values });
    if (r.transient) {
      // gehaltenes Minimum/Maximum weit weg von der ruhigen Anzeige: übernommener Wert wäre verfälscht
      const [hk, lk] = group === 'RISO' ? ['RISO_MIN', 'RISO_LIVE'] : [`${group}_MAX`, `${group}_LIVE`];
      banner.className = 'alert warn';
      return fill(banner, h('b', {}, '⚠ Der Messwert war unruhig'), ` (${group === 'RISO' ? 'Minimum' : 'Maximum'} ${shown(hk, r.values[hk])}, Anzeige zuletzt ${shown(lk, r.live[lk])}) – wurde der Prüfling berührt? Der übernommene Wert hängt am ${group === 'RISO' ? 'Minimum' : 'Maximum'} und wäre verfälscht. `, h('button', { class: 'btn sm primary', onclick: () => measure(true) }, '↻ Messung wiederholen'), ' ', h('button', { class: 'btn sm', onclick: () => finish(r) }, 'Wert trotzdem übernehmen'));
    }
    finish(r);
  };

  const countdown = () => {
    if (started || !alive()) return;
    if (n <= 0) return measure();
    fill(banner, h('b', {}, `⚙ Messung startet automatisch in ${n} s`), ` – ${step.key === 'RSL' ? 'Sonde an das Schutzleiter-Teil halten, ' : ''}Prüfling nicht berühren. `, h('button', { class: 'btn sm primary', onclick: () => measure() }, '▶ Sofort messen'), ' ', pause);
    n -= 1;
    later(1000, countdown);
  };

  // Vor der ersten Messung mit Prüfspannung (R_ISO 500 V, Ableitströme) einmal bestätigen lassen, dass niemand
  // den Prüfling berührt – z. B. direkt nach der Sichtprüfung. R_SL misst mit der Sonde in der Hand.
  if (step.key !== 'RSL' && !W.handsOff) {
    banner.className = 'alert warn';
    return fill(banner, h('b', {}, '⚡ Jetzt folgen die Messungen mit Prüfspannung'), ' (R_ISO mit 500 V). Prüfling, Klemme und Sonde nicht mehr berühren – danach misst das Programm automatisch weiter. ', h('button', { class: 'btn sm primary', onclick: () => ((W.handsOff = true), (banner.className = 'alert info'), countdown()) }, '▶ Hände weg – Messungen starten'), ' ', pause);
  }
  later(100, countdown); // erst wenn der Schritt angezeigt wird (alive prüft, ob der Hinweis im Dokument steht)
}

async function refreshLimits() {
  const proc = await post('/procedure', { procedureId: W.proc.id, deviceId: W.device.id, device: W.deviceOverrides, profile: W.cfg.profile, standard: W.cfg.standard });
  W.proc = proc;
}

function passBadge(q, v) {
  const p = passOf(q, v);
  if (p == null) return h('span', { class: 'badge muted' }, v?.value != null ? 'Info' : '—');
  return h('span', { class: `badge ${p ? 'ok' : 'bad'}` }, p ? '✔ i. O.' : '✘ n. i. O.');
}

function drawLive(box, values) {
  const q = state.meta.quantities;
  clear(box);
  for (const [k, v] of Object.entries(values)) {
    if (v.value == null && !v.text) continue;
    const base = k.replace(/_(MIN|MAX|AC|DC|TRMS|LIVE)$/, '');
    const unit = q[k]?.unit ?? q[base]?.unit ?? '';
    box.appendChild(h('div', { class: 'lv' }, h('div', { class: 'k' }, k.replace(/_LIVE$/, ' (Anzeige)').replace(/_/g, ' ')), h('div', { class: 'v' }, `${v.qualifier || ''}${v.value == null ? v.text : fmt.num(v.value)} `, h('small', {}, unit))));
  }
}

function skipControl(step, redraw) {
  if (!(step.skippable || step.optional)) return null;
  const on = W.skipped[step.id] != null;
  const reason = input({ placeholder: 'Begründung (Pflicht), z. B. „keine berührbaren leitfähigen Teile“', value: W.skipped[step.id] || '', oninput: (e) => (W.skipped[step.id] = e.target.value) });
  return h('div', { class: 'stack', style: { marginTop: '10px' } }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => (e.target.checked ? (W.skipped[step.id] = '') : delete W.skipped[step.id], redraw()) }), step.optional ? 'Schritt nicht erforderlich / entfällt' : 'Schritt entfällt (mit Begründung)'), on ? reason : null);
}

// ---------------------------------------------------------------------------
// Funktionstest
// ---------------------------------------------------------------------------
function functionPanel(step, body, redraw) {
  if (step.quantities.length) {
    const fakeStep = { ...step, multiPoint: false, key: 'DI' };
    measurePanelFT(fakeStep, body, redraw);
  }
  if (step.items?.length) {
    body.appendChild(h('h3', { style: { marginTop: '14px' } }, 'Funktionsprüfung'));
    checksPanel(step, body, redraw, 'funktion');
  }
  if (!step.quantities.length) body.appendChild(skipControl({ ...step, skippable: true }, redraw));
}

function measurePanelFT(step, body, redraw) {
  const pts = ensurePoint(step);
  const p = pts[0];
  const liveBox = h('div', { class: 'live' });
  const statusLine = h('div', { class: 'small muted' });
  const grid = h('div', { class: 'grid c3' });
  let lastLive = {};
  const drawInputs = () => {
    clear(grid);
    for (const q of step.quantities) {
      let badge = passBadge(q, p.values[q.key]);
      const inp = input({ value: valText(p.values[q.key]), inputmode: 'decimal', oninput: (e) => {
        const pv = parseInput(e.target.value);
        if (pv) p.values[q.key] = { ...pv, source: 'manuell' };
        else delete p.values[q.key];
        badge.replaceWith((badge = passBadge(q, p.values[q.key])));
      } });
      grid.appendChild(field(`${q.label}${q.unit ? ` [${q.unit}]` : ''}`, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, inp, badge), q.limit ? `Grenzwert ${q.limit.text}` : null));
    }
  };
  drawInputs();
  const ctrl = h('div', { class: 'row' });
  if (W.cfg.mode !== 'manuell' && step.remote) {
    const read = async () => {
      try {
        const r = W.cfg.mode === 'secutest-pc' ? await get('/secutest/remote/read?group=FT') : await get('/secutest/live');
        lastLive = r.values || {};
        const any = Object.values(lastLive).some((v) => v.value != null);
        statusLine.textContent = r.ftActive === false ? 'Funktionstest läuft gerade nicht – am SECUTEST starten (Netz an Prüfdose mit Taste FUNCTION-TEST (14), Lampe 15 leuchtet dann dauernd).' : any ? '⏱ Funktionstest läuft – „📥 Werte vom SECUTEST übernehmen“, solange er läuft.' : 'Noch keine Werte vom SECUTEST.';
        drawLive(liveBox, lastLive);
      } catch (e) {
        statusLine.textContent = `⚠ ${e.message}`;
      }
    };
    if (W.cfg.mode === 'secutest-pc') {
      // Den Funktionstest macht der Prüfer am Gerät (mehrere Tasten) – im Fernsteuermodus wären die Tasten gesperrt
      body.prepend(h('div', { class: 'alert info' }, h('b', {}, '👉 Funktionstest bitte am SECUTEST durchführen.'), ' Die Fernsteuerung ist aus, alle Tasten am Gerät sind frei. Solange der Funktionstest läuft: „📥 Werte vom SECUTEST übernehmen“. Danach am Gerät beenden (Prüfling am eigenen Schalter ausschalten, Taste 14) und unten die Funktion beurteilen.'));
      post('/secutest/remote/end').then(() => (W.remoteActive = false), (e) => toast(e.message, 'bad'));
    }
    every(2000, read);
    add(ctrl, h('button', { class: 'btn ok', onclick: async () => {
      try {
        const r = await get('/secutest/remote/read?group=FT&confirm=1');
        if (r.ftActive === false) return toast('Funktionstest läuft gerade nicht – Werte bitte übernehmen, solange er am SECUTEST läuft.', 'warn', 6000);
        const vals = {};
        for (const [k, v] of Object.entries(r.values)) if (v.value != null) vals[k] = v;
        if (!Object.keys(vals).length) return toast('Keine Werte vorhanden', 'warn');
        for (const q of step.quantities) if (vals[q.key]) p.values[q.key] = { ...vals[q.key], source: 'secutest' };
        drawInputs();
        toast(r.unconfirmed?.length ? `Werte übernommen – nicht stabil gelesen: ${r.unconfirmed.join(', ')}` : 'Werte vom SECUTEST übernommen', r.unconfirmed?.length ? 'warn' : 'ok', 6000);
      } catch (e) {
        toast(e.message, 'bad');
      }
    } }, '📥 Werte vom SECUTEST übernehmen'));
  }
  add(body, ctrl, statusLine, liveBox, grid, skipControl(step, redraw));
}

/**
 * PC-gesteuert: Läuft am SECUTEST noch der Funktionstest (Netz an der Prüfdose), vor dem Verlassen des
 * Schritts daran erinnern – beenden muss ihn der Prüfer am Gerät. false = im Schritt bleiben.
 */
async function functionTestFinished() {
  if (!W || W.cfg.mode !== 'secutest-pc') return true;
  const r = await get('/secutest/remote/read?group=FT').catch(() => null);
  if (!r?.ftActive) return true;
  return confirmDialog('Der Funktionstest ist am SECUTEST noch nicht abgeschlossen – eventuell liegt noch Netzspannung an der Prüfdose. Bitte am Gerät beenden (Prüfling am eigenen Schalter ausschalten, Taste 14) und die Abfrage am Gerät beantworten. Trotzdem weiter?', { title: 'Funktionstest noch aktiv', confirmLabel: 'Trotzdem weiter' });
}

// ---------------------------------------------------------------------------
// Bewertung & Speichern
// ---------------------------------------------------------------------------
function payload() {
  const measurements = [];
  const steps = W.proc.steps;
  for (const step of steps) {
    for (const p of W.points[step.id] || []) {
      for (const [key, v] of Object.entries(p.values)) {
        if (v.value == null && !v.text) continue;
        measurements.push({ step: step.id, key, point: p.point || null, value: v.qualifier ? undefined : v.value, valueText: v.qualifier ? `${v.qualifier}${v.value}` : v.text ?? String(v.value), source: v.source || 'manuell', display: !!v.display });
      }
    }
  }
  const checks = Object.entries(W.checks).map(([item, c]) => ({ group: c.group, item, label: c.label, passed: c.passed, note: c.note }));
  const skipped = Object.entries(W.skipped).map(([stepId, reason]) => ({ step: stepId, title: steps.find((s) => s.id === stepId)?.title, reason }));
  return { measurements, checks, skipped };
}

async function fetchFromSecutest(redraw) {
  try {
    const r = await get('/secutest/result');
    const pro = r.protocol;
    W.deviceVerdict = pro.verdict;
    W.rawProtocol = pro.raw;
    let n = 0;
    for (const m of pro.measurements) {
      const step = W.proc.steps.find((s) => s.type === 'measure' && (s.key === m.key || (s.extraKeys || []).includes(m.key) || (m.key === 'IB' && s.key === 'IEA') || (m.key === 'IEA' && s.key === 'IB')));
      if (!step || m.value == null) continue;
      const pts = ensurePoint(step);
      const key = step.quantities.some((q) => q.key === m.key) ? m.key : step.key;
      pts[0].values[key] = { value: m.value, qualifier: m.qualifier, text: m.valueText, source: 'secutest' };
      delete W.skipped[step.id];
      n++;
    }
    const ft = W.proc.steps.find((s) => s.type === 'function');
    if (ft && r.functionTest && Object.keys(r.functionTest).length) {
      const p = ensurePoint(ft)[0];
      for (const q of ft.quantities) if (r.functionTest[q.key]) p.values[q.key] = { ...r.functionTest[q.key], source: 'secutest' };
    }
    // Sichtprüfungs-Mängel aus dem SECUTEST übernehmen
    const vis = W.proc.steps.find((s) => s.type === 'visual');
    if (vis && !pro.classification.noVisualInspection) {
      for (const it of vis.items) if (it.proBit != null && pro.visualFailed[it.item]) W.checks[it.item] = { group: 'sicht', label: it.label, passed: 0, note: 'Mangel laut SECUTEST-Sichtprüfung' };
    }
    if (pro.classification.protectionClass !== W.device.protection_class && W.proc.id === 'AUTO') {
      toast(`SECUTEST hat ${pro.classification.protectionClass} erkannt (erfasst: ${W.device.protection_class}). Bitte Gerätedaten prüfen.`, 'warn', 9000);
    }
    if (pro.classification.dutNotSwitchedOn) toast('Hinweis vom SECUTEST: Prüfling war bei R_ISO/I_EA nicht eingeschaltet!', 'warn', 9000);
    W.protocolFetched = true;
    toast(`${n} Messwert(e) vom SECUTEST übernommen`, 'ok');
    redraw();
  } catch (e) {
    toast(`Ergebnis konnte nicht gelesen werden: ${e.message}`, 'bad', 7000);
  }
}

function resultPanel(step, body, navigate, redraw) {
  if (W.saved) return savedPanel(body, navigate);
  const meta = state.meta;
  const evalBox = h('div', { class: 'stack' });
  const actBox = h('div', { class: 'action-list' });
  const nextBox = h('span');
  let evaluation = null;

  if (W.cfg.mode === 'secutest-geraet') {
    body.appendChild(h('div', { class: 'alert info' }, h('div', { class: 'row between' }, h('span', {}, W.protocolFetched ? 'Ergebnis vom SECUTEST übernommen. Bei Bedarf erneut abholen:' : 'Hat das SECUTEST „bestanden/nicht bestanden“ angezeigt? Dann jetzt alle Werte übernehmen:'), h('button', { class: 'btn primary', onclick: () => fetchFromSecutest(redraw) }, '📥 Ergebnis vom SECUTEST abholen'))));
    resultRedraw = redraw;
    if (W.protocolReady && !W.protocolFetched) setTimeout(() => fetchFromSecutest(redraw), 0);
  }
  if (W.remoteActive) post('/secutest/remote/end').then(() => (W.remoteActive = false)).catch(() => {});

  const interval = input({ type: 'number', min: 1, max: 120, value: W.intervalMonths, style: { maxWidth: '90px' }, oninput: (e) => ((W.intervalMonths = Number(e.target.value) || W.intervalMonths), drawNext()) });
  const inspector = input({ value: W.inspector, oninput: (e) => (W.inspector = e.target.value) });
  const notes = h('textarea', { class: 'input', placeholder: 'Bemerkungen zur Prüfung (erscheinen im Protokoll)', oninput: (e) => (W.notes = e.target.value) }, W.notes);
  const smtpOk = !!meta.settings.reminders.smtp.host && meta.settings.reminders.enabled;
  if (W.sendInvite == null) W.sendInvite = smtpOk && meta.settings.reminders.calendarInvite && !!W.device.reminder_enabled;
  const invite = smtpOk ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: W.sendInvite, onchange: (e) => (W.sendInvite = e.target.checked) }), 'Kalendereinladung für den nächsten Prüftermin per E-Mail senden') : h('div', { class: 'small muted' }, 'Tipp: Unter „Erinnerungen“ E-Mail einrichten – dann kommt automatisch eine Kalendereinladung.');

  function drawNext() {
    const pass = evaluation?.passed;
    fill(nextBox, pass ? h('b', {}, fmt.date(fmt.addMonths(fmt.today(), W.intervalMonths))) : h('span', { class: 'muted' }, 'nach Behebung/Nachprüfung (sofort fällig)'));
  }

  const saveBtn = h('button', { class: 'btn primary lg', onclick: () => save() }, '💾 Prüfung speichern');
  async function save() {
    if (evaluation && !evaluation.passed && !W.action) return toast('Bitte eine Maßnahme für das nicht bestandene Gerät auswählen.', 'warn');
    saveBtn.disabled = true;
    try {
      const pl = payload();
      const r = await post('/inspections', {
        device_id: W.device.id,
        procedure: W.proc.id,
        mode: W.cfg.mode,
        standard: W.cfg.standard,
        reason: W.cfg.reason,
        limit_profile: W.cfg.profile,
        inspector: W.inspector,
        interval_months: W.intervalMonths,
        action: W.action,
        action_note: W.actionNote,
        notes: W.notes,
        device_verdict: W.deviceVerdict,
        raw_protocol: W.rawProtocol,
        meter_idn: W.meterIdn,
        started_at: W.startedAt,
        device_overrides: Object.keys(W.deviceOverrides).length ? W.deviceOverrides : undefined,
        sendInvite: W.sendInvite,
        ...pl,
      });
      W.saved = r;
      if (SERIES?.ids.includes(W.device.id)) {
        SERIES.results[W.device.id] = r.inspection.result;
        const visual = Object.fromEntries(Object.entries(W.checks).filter(([, c]) => c.group === 'sicht'));
        SERIES.template = { cfg: { ...W.cfg }, checks: visual, inspector: W.inspector };
      }
      if (r.invite?.ok) toast(`Kalendereinladung an ${r.invite.to.join(', ')} gesendet`, 'ok');
      else if (r.invite && !r.invite.ok) toast(`Kalendereinladung fehlgeschlagen: ${r.invite.error}`, 'warn', 7000);
      redraw();
    } catch (e) {
      toast(e.message, 'bad', 7000);
      saveBtn.disabled = false;
    }
  }

  const evaluate = async () => {
    try {
      evaluation = await post('/evaluate', { deviceId: W.device.id, device: W.deviceOverrides, procedureId: W.proc.id, profile: W.cfg.profile, standard: W.cfg.standard, ...payload() });
    } catch (e) {
      clear(evalBox).appendChild(h('div', { class: 'alert bad' }, e.message));
      return;
    }
    const pass = evaluation.passed;
    const rows = evaluation.measurements.filter((m) => m.limit_op || m.value != null);
    const sceneBox = document.querySelector('.scene-box');
    if (sceneBox) sceneBox.innerHTML = renderScene({ ...step.scene, action: pass ? 'result' : 'result-fail', lcd: [step.scene.lcd?.[0] || '', '', pass ? 'bestanden!' : 'nicht bestanden!'] });
    fill(evalBox, 
      h('div', { class: `result-big ${pass ? 'pass' : 'fail'}` }, pass ? '✔ BESTANDEN' : '✘ NICHT BESTANDEN'),
      W.deviceVerdict && W.deviceVerdict !== evaluation.result ? h('div', { class: 'alert warn small' }, h('b', {}, 'Abweichung:'), `Das SECUTEST meldet „${W.deviceVerdict === 'bestanden' ? 'bestanden' : 'nicht bestanden'}“ (Gerätegrenzwerte von 1997). Maßgeblich ist hier das gewählte Grenzwertprofil „${meta.profiles.find((p) => p.id === W.cfg.profile)?.short}“.`) : null,
      evaluation.failures.length ? h('div', { class: 'alert bad' }, h('b', {}, 'Gründe:'), h('ul', { style: { margin: '6px 0 0' } }, evaluation.failures.map((f) => h('li', {}, f)))) : null,
      evaluation.warnings.map((w) => h('div', { class: 'alert warn small' }, w)),
      evaluation.notes.map((w) => h('div', { class: 'alert info small' }, w)),
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't compact' }, h('thead', {}, h('tr', {}, h('th', {}, 'Messgröße'), h('th', {}, 'Punkt'), h('th', {}, 'Wert'), h('th', {}, 'Grenzwert'), h('th', {}, ''))), h('tbody', {}, rows.map((m) => h('tr', {}, h('td', {}, m.label), h('td', {}, m.point || ''), h('td', { class: 'num' }, `${m.value_text && /[<>]/.test(m.value_text) ? m.value_text : fmt.num(m.value)} ${m.unit}`), h('td', {}, m.limit_text || '–'), h('td', {}, m.passed == null ? '' : h('span', { class: `badge ${m.passed ? 'ok' : 'bad'}` }, m.passed ? '✔' : '✘'))))))) : null
    );
    clear(actBox);
    if (!pass) {
      add(actBox, 
        h('h3', {}, '⚠ Wie soll mit dem Gerät weiter verfahren werden?'),
        meta.actions.map((a) => h('div', { class: `choice ${W.action === a.id ? 'on' : ''}`, onclick: () => ((W.action = a.id), evaluate()) }, h('div', { class: 't' }, h('input', { type: 'radio', checked: W.action === a.id }), a.label), h('div', { class: 'd' }, a.description, ' → Gerätestatus: ', h('b', {}, meta.deviceStatus[a.status])))),
        h('textarea', { class: 'input', placeholder: W.action === 'sonstiges' ? 'Maßnahme beschreiben (Pflicht)' : 'Notiz zur Maßnahme (optional)', oninput: (e) => (W.actionNote = e.target.value) }, W.actionNote)
      );
    } else W.action = null;
    drawNext();
  };
  evaluate();

  add(body, 
    evalBox,
    actBox,
    h('fieldset', { style: { marginTop: '12px' } }, h('legend', {}, 'Abschluss'), h('div', { class: 'grid c2' }, field('Prüfdatum', h('div', {}, h('b', {}, fmt.date(fmt.today())), h('span', { class: 'muted' }, ' (heute, automatisch)'))), field('Prüfer', inspector), field('Prüfintervall (Monate)', h('div', { class: 'row' }, interval, 'nächste Prüfung:', nextBox)), field('Messgerät', h('div', { class: 'small' }, W.meterIdn || 'SECUTEST 0701S'))), h('div', { style: { marginTop: '10px' } }, notes), h('div', { style: { marginTop: '10px' } }, invite)),
    h('div', { class: 'row end' }, saveBtn)
  );
}

function savedPanel(body, navigate) {
  const { inspection: i } = W.saved;
  const pass = i.result === 'bestanden';
  add(body, 
    h('div', { class: `result-big ${pass ? 'pass' : 'fail'}` }, pass ? '✔ Gespeichert – BESTANDEN' : '✘ Gespeichert – NICHT BESTANDEN'),
    h('p', {}, `Prüfdatum ${fmt.date(i.inspection_date)} wurde eingetragen. `, pass ? h('span', {}, 'Nächste Prüfung: ', h('b', {}, fmt.date(i.next_due_date))) : h('span', {}, 'Gerätestatus: ', h('b', {}, state.meta.deviceStatus[i.device.status]))),
    h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `/api/inspections/${i.id}/report`, target: '_blank' }, '🖨 Prüfprotokoll'), h('a', { class: 'btn', href: `/api/labels?ids=${i.device_id}`, target: '_blank' }, '🏷 Prüfplakette'), pass ? h('a', { class: 'btn', href: `/api/calendar.ics?ids=${i.device_id}` }, '📅 Termin (.ics)') : null),
    seriesNav(i, navigate) ||
      h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn', onclick: () => ((W = null), navigate(`#/devices/${i.device_id}`)) }, 'Zum Gerät'), h('button', { class: 'btn primary', onclick: () => ((W = null), navigate('#/inspect')) }, 'Nächstes Gerät prüfen →'))
  );
}

function seriesNav(i, navigate) {
  if (!SERIES?.ids.includes(i.device_id)) return null;
  const next = seriesNext(i.device_id);
  const remaining = SERIES.ids.filter((id) => !SERIES.results[id]).length;
  return h(
    'div',
    { class: 'row', style: { marginTop: '14px' } },
    next
      ? h('button', { class: 'btn primary lg', onclick: () => ((W = null), navigate(`#/inspect?device=${next}`)) }, `Nächstes Gerät der Serie (noch ${remaining}) →`)
      : h('button', { class: 'btn primary lg', onclick: () => ((W = null), navigate('#/inspect?seriesdone=1')) }, '✔ Serie abschließen – Übersicht'),
    h('button', { class: 'btn', onclick: () => ((W = null), navigate(`#/devices/${i.device_id}`)) }, 'Zum Gerät')
  );
}

// ===========================================================================
// Detailansicht einer gespeicherten Prüfung
// ===========================================================================
export async function renderInspectionDetail({ args, navigate }) {
  const i = await get(`/inspections/${args[0]}`);
  const meta = state.meta;
  const vis = i.checks.filter((c) => c.group_name === 'sicht');
  const other = i.checks.filter((c) => c.group_name !== 'sicht');
  const remove = async () => {
    if (!(await confirmDialog('Diese Prüfung endgültig löschen? Die Gerätedaten (letzte/nächste Prüfung) werden aus der vorherigen Prüfung neu berechnet.', { danger: true, confirmLabel: 'Löschen' }))) return;
    await del(`/inspections/${i.id}`);
    toast('Prüfung gelöscht', 'ok');
    navigate(`#/devices/${i.device_id}`);
  };
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'muted' }, `${i.device.inventory_no} · ${i.device.name}`), h('h1', {}, `Prüfung vom ${fmt.date(i.inspection_date)}`)), h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `/api/inspections/${i.id}/report`, target: '_blank' }, '🖨 Protokoll'), h('a', { class: 'btn', href: `#/devices/${i.device_id}` }, 'Zum Gerät'), h('button', { class: 'btn danger', onclick: remove }, '🗑'))),
    h('div', { class: 'card' }, h('div', { class: 'row' }, resultBadge(i.result), h('span', {}, procName(i.procedure)), h('span', { class: 'muted' }, `· ${i.standard} · ${meta.modes[i.mode] || i.mode} · ${meta.profiles.find((p) => p.id === i.limit_profile)?.short || ''}`)), i.action ? h('div', { class: 'alert bad', style: { marginTop: '10px' } }, h('b', {}, 'Maßnahme:'), meta.actions.find((a) => a.id === i.action)?.label, i.action_note ? ` – ${i.action_note}` : '') : null, i.notes ? h('p', { style: { whiteSpace: 'pre-wrap', marginTop: '10px' } }, i.notes) : null),
    h('div', { class: 'card' }, h('h2', {}, 'Messwerte'), i.measurements.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Messgröße'), h('th', {}, 'Punkt'), h('th', {}, 'Wert'), h('th', {}, 'Grenzwert'), h('th', {}, 'Quelle'), h('th', {}, ''))), h('tbody', {}, i.measurements.map((m) => h('tr', {}, h('td', {}, m.label), h('td', {}, m.point || ''), h('td', { class: 'num' }, `${m.value_text && /[<>]/.test(m.value_text) ? m.value_text : fmt.num(m.value)} ${m.unit || ''}`), h('td', {}, m.limit_text || '–'), h('td', { class: 'small muted' }, m.source), h('td', {}, m.passed == null ? '' : resultBadge(m.passed ? 'bestanden' : 'nicht_bestanden'))))))) : h('div', { class: 'muted' }, 'keine')),
    h('div', { class: 'card' }, h('h2', {}, 'Sicht- und Funktionsprüfung'), [...vis, ...other].length ? h('table', { class: 't' }, h('tbody', {}, [...vis, ...other].map((c) => h('tr', {}, h('td', {}, c.group_name === 'entfaellt' ? `Entfällt: ${c.label}` : c.label, c.note ? h('div', { class: 'small muted' }, c.note) : null), h('td', {}, c.passed === 1 ? h('span', { class: 'badge ok' }, 'i. O.') : c.passed === 0 ? h('span', { class: 'badge bad' }, 'Mangel') : h('span', { class: 'badge muted' }, '–')))))) : h('div', { class: 'muted' }, 'keine')),
    i.raw_protocol ? h('div', { class: 'card' }, h('h3', {}, 'Rohdaten SECUTEST (PRO?)'), h('code', { style: { wordBreak: 'break-all' } }, i.raw_protocol), i.meter_idn ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, i.meter_idn) : null) : null
  );
}
