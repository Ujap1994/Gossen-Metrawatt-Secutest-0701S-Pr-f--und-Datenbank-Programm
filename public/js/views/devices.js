// Geräteverwaltung: Liste, Anlegen/Bearbeiten, Detail mit Historie und Fotos
import { h, clear, fmt, toast, field, input, select, datalist, dueBadge, resultBadge, skSymbol, STATUS_LABEL, confirmDialog, modal, debounce, add, fill } from '../ui.js';
import { get, post, put, del } from '../api.js';
import { state, loadMeta, procName, deviceTypeLabel, actionLabel } from '../state.js';

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------
export async function renderDeviceList({ params, navigate }) {
  const filters = { q: params.q || '', status: params.status || 'alle-aktiven', due: params.due || '', protection_class: params.sk || '', sort: params.sort || 'name' };
  const tableBox = h('div', { class: 'table-wrap' });
  const selected = new Set();
  const bulk = h('div', { class: 'row' });

  const load = async () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const devices = await get(`/devices?${qs}`);
    selected.clear();
    renderBulk();
    clear(tableBox).appendChild(
      devices.length
        ? h(
            'table',
            { class: 't' },
            h('thead', {}, h('tr', {}, h('th', {}, h('input', { type: 'checkbox', onchange: (e) => (tableBox.querySelectorAll('tbody input[type=checkbox]').forEach((c) => ((c.checked = e.target.checked), c.dispatchEvent(new Event('change'))))) })), h('th', {}, 'Inv.-Nr.'), h('th', {}, 'Gerät'), h('th', {}, 'SK'), h('th', {}, 'Standort'), h('th', {}, 'Letzte Prüfung'), h('th', {}, 'Nächste Prüfung'), h('th', {}, ''))),
            h(
              'tbody',
              {},
              devices.map((d) =>
                h(
                  'tr',
                  { class: 'click', onclick: (e) => e.target.tagName !== 'INPUT' && navigate(`#/devices/${d.id}`) },
                  h('td', {}, h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? selected.add(d.id) : selected.delete(d.id), renderBulk()) })),
                  h('td', { class: 'mono' }, d.inventory_no),
                  h('td', {}, h('b', {}, d.name), h('div', { class: 'small muted' }, [d.manufacturer, d.model].filter(Boolean).join(' ') || deviceTypeLabel(d.device_type))),
                  h('td', {}, skSymbol(d.protection_class, 18)),
                  h('td', {}, d.location || '—'),
                  h('td', {}, fmt.date(d.last_inspection_date), ' ', d.last_inspection_date ? resultBadge(d.last_result) : null),
                  h('td', {}, dueBadge(d)),
                  h('td', {}, h('a', { class: 'btn sm', href: `#/inspect?device=${d.id}`, onclick: (e) => e.stopPropagation() }, 'Prüfen'))
                )
              )
            )
          )
        : h('div', { class: 'empty' }, 'Keine Geräte gefunden. ', h('a', { href: '#/devices/new' }, 'Neues Gerät anlegen'))
    );
  };
  function renderBulk() {
    clear(bulk);
    if (!selected.size) return;
    const ids = [...selected].join(',');
    add(bulk, h('span', { class: 'muted' }, `${selected.size} ausgewählt:`), h('a', { class: 'btn sm', href: `/api/labels?ids=${ids}`, target: '_blank' }, '🏷 Plaketten'), h('a', { class: 'btn sm', href: `/api/calendar.ics?ids=${ids}` }, '📅 Kalender'));
  }

  const search = input({ placeholder: '🔍 Suchen (Name, Inv.-Nr., Hersteller, Standort …)', value: filters.q, oninput: debounce((e) => ((filters.q = e.target.value), load()), 250) });
  const sel = (key, opts) => select(opts, filters[key], { onchange: (e) => ((filters[key] = e.target.value), load()), style: { width: 'auto' } });
  const node = h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, 'Geräte'), h('div', { class: 'row' }, h('a', { class: 'btn', href: '/api/export.csv' }, '⬇ CSV'), h('a', { class: 'btn primary', href: '#/devices/new' }, '+ Neues Gerät'))),
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'row', style: { marginBottom: '10px' } },
        h('div', { style: { flex: '1 1 260px' } }, search),
        sel('status', [['alle-aktiven', 'Status: alle (ohne ausgemustert)'], ['', 'Status: alle'], ['aktiv', 'aktiv'], ['gesperrt', 'gesperrt'], ['reparatur', 'in Reparatur'], ['ausgemustert', 'ausgemustert']]),
        sel('due', [['', 'Fälligkeit: alle'], ['overdue', 'überfällig'], ['soon', 'fällig ≤ 30 Tage'], ['never', 'nie geprüft'], ['failed', 'zuletzt nicht bestanden']]),
        sel('protection_class', [['', 'Schutzklasse: alle'], ['SK I', 'SK I'], ['SK II', 'SK II'], ['SK III', 'SK III']]),
        sel('sort', [['name', 'Sortierung: Name'], ['inventory', 'Inventar-Nr.'], ['due', 'Fälligkeit'], ['location', 'Standort'], ['updated', 'zuletzt geändert']])
      ),
      bulk,
      tableBox
    )
  );
  await load();
  return node;
}

// ---------------------------------------------------------------------------
// Formular
// ---------------------------------------------------------------------------
const INTERVAL_PRESETS = [
  [3, '3 Monate (Baustelle, starke Beanspruchung)'],
  [6, '6 Monate (Werkstatt, häufiger Gebrauch)'],
  [12, '12 Monate (Standard / privat)'],
  [24, '24 Monate (Büro, geringe Beanspruchung)'],
  [36, '36 Monate'],
  [48, '48 Monate'],
];

export async function renderDeviceForm({ args, params, navigate }) {
  const id = args[0] ? Number(args[0]) : null;
  const meta = state.meta;
  const d = id ? (await get(`/devices/${id}`)).device : { protection_class: 'SK I', device_type: 'standard', connection_type: 'plug', phases: 1, interval_months: meta.settings.defaultIntervalMonths, reminder_enabled: 1, status: 'aktiv', name: params.name || '' };
  const f = {};
  const inp = (name, attrs = {}) => (f[name] = input({ name, value: d[name] ?? '', ...attrs }));
  const hintBox = h('div');
  const limitBox = h('div', { class: 'small muted' });

  const skRadio = h(
    'div',
    { class: 'grid c3' },
    ['SK I', 'SK II', 'SK III'].map((sk) => {
      const lbl = h(
        'label',
        { class: `choice ${d.protection_class === sk ? 'on' : ''}` },
        h('input', { type: 'radio', name: 'protection_class', value: sk, checked: d.protection_class === sk, style: { display: 'none' }, onchange: () => (skRadio.querySelectorAll('.choice').forEach((c) => c.classList.remove('on')), lbl.classList.add('on'), check()) }),
        h('div', { class: 't' }, skSymbol(sk, 26), sk),
        h('div', { class: 'd' }, { 'SK I': 'Schutzleiter (Schuko-Stecker mit Erdung, Metallgehäuse)', 'SK II': 'Schutzisoliert ◻◻ – Flachstecker / ohne Schutzleiter', 'SK III': 'Schutzkleinspannung (≤ 50 V AC), Netzteil/Trafo' }[sk])
      );
      return lbl;
    })
  );
  f.device_type = select(meta.deviceTypes.map((t) => [t.id, t.label]), d.device_type, { name: 'device_type', onchange: () => check() });
  f.connection_type = select([['plug', 'Stecker (an Prüfdose)'], ['fixed', 'Festanschluss'], ['terminals', 'Klemmen / Prüfbuchsen']], d.connection_type, { name: 'connection_type', onchange: () => check() });
  f.phases = select([[1, 'einphasig (230 V)'], [3, 'dreiphasig (400 V)']], d.phases, { name: 'phases' });
  f.status = select(Object.entries(STATUS_LABEL), d.status, { name: 'status' });
  f.interval_months = select(INTERVAL_PRESETS.some(([v]) => v === Number(d.interval_months)) ? INTERVAL_PRESETS : [...INTERVAL_PRESETS, [d.interval_months, `${d.interval_months} Monate`]], d.interval_months, { name: 'interval_months' });
  f.reminder_enabled = h('input', { type: 'checkbox', name: 'reminder_enabled', checked: !!d.reminder_enabled });
  f.notes = h('textarea', { class: 'input', name: 'notes' }, d.notes || '');
  const heatingField = field('Heizleistung (kW)', inp('heating_power_kw', { type: 'number', step: '0.1', min: 0 }), 'für Grenzwerte bei Heizgeräten');

  const check = debounce(async () => {
    const body = collect();
    heatingField.style.display = body.device_type === 'heating' ? '' : 'none';
    try {
      const r = await post('/devices/suggest', body);
      clear(hintBox);
      if (r.suggestedType && r.suggestedType !== body.device_type && body.device_type === 'standard') {
        const t = meta.deviceTypes.find((x) => x.id === r.suggestedType);
        hintBox.appendChild(h('div', { class: 'alert info' }, h('b', {}, 'Erkannt:'), `${t.label} – ${t.hint}. `, h('button', { type: 'button', class: 'btn sm', onclick: () => ((f.device_type.value = r.suggestedType), check()) }, 'Geräteart übernehmen')));
      }
      if (!r.autoMode.allowed) hintBox.appendChild(h('div', { class: 'alert warn' }, h('b', {}, '⚠ Kein Auto-Modus:'), r.autoMode.reason));
      const l = r.limits;
      fill(limitBox, 'Grenzwerte (', meta.profiles.find((p) => p.id === meta.settings.limitProfile)?.short, '): ', [l.RSL && `R_SL ${l.RSL.text}`, l.RISO && `R_ISO ${l.RISO.text}`, body.protection_class === 'SK I' && l.IEA && `I_EA ${l.IEA.text}`, body.protection_class === 'SK II' && l.IB && `Berührungsstrom ${l.IB.text}`].filter(Boolean).join(' · '));
    } catch {
      /* egal */
    }
  }, 350);

  const form = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const body = collect();
      try {
        const saved = id ? await put(`/devices/${id}`, body) : await post('/devices', body);
        toast(id ? 'Gerät gespeichert' : `Gerät ${saved.inventory_no} angelegt`, 'ok');
        loadMeta().catch(() => {});
        if (!id && e.submitter?.dataset.next === 'inspect') navigate(`#/inspect?device=${saved.id}`);
        else navigate(`#/devices/${saved.id}`);
      } catch (ex) {
        toast(ex.message, 'bad', 6000);
      }
    },
  });

  function collect() {
    const out = {};
    for (const el of form.querySelectorAll('[name]')) {
      if (el.type === 'radio') {
        if (el.checked) out[el.name] = el.value;
      } else if (el.type === 'checkbox') out[el.name] = el.checked;
      else out[el.name] = el.value;
    }
    out.phases = Number(out.phases);
    out.interval_months = Number(out.interval_months);
    return out;
  }

  add(form, 
    h('fieldset', {}, h('legend', {}, 'Stammdaten'), h('div', { class: 'grid c3' }, field('Bezeichnung', inp('name', { required: true, placeholder: 'z. B. Wasserkocher Küche, Monitor Dell U2415', oninput: () => check() }), null, { required: true }), field('Inventar-Nr.', inp('inventory_no', { placeholder: id ? '' : `automatisch: ${meta.nextInventoryNo}` })), field('Kategorie', inp('category', { list: 'dl-cat', placeholder: 'Haushalt, Werkzeug, IT …', oninput: () => check() })), field('Hersteller', inp('manufacturer', { list: 'dl-man' })), field('Typ / Modell', inp('model', { oninput: () => check() })), field('Serien-Nr.', inp('serial_no')), field('Standort / Raum', inp('location', { list: 'dl-loc' })), field('Eigentümer / Nutzer', inp('owner', { list: 'dl-own' })), field('Kaufdatum', inp('purchase_date', { type: 'date' })))),
    h('fieldset', {}, h('legend', {}, 'Schutzklasse'), skRadio),
    hintBox,
    h('fieldset', {}, h('legend', {}, 'Elektrische Daten'), h('div', { class: 'grid c3' }, field('Geräteart', f.device_type), field('Anschluss', f.connection_type), field('Phasen', f.phases), field('Nennspannung (V)', inp('rated_voltage', { type: 'number', step: 'any', placeholder: '230' })), field('Nennleistung (W)', inp('rated_power', { type: 'number', step: 'any', oninput: () => check() })), field('Nennstrom (A)', inp('rated_current', { type: 'number', step: 'any' })), heatingField, field('Leitungslänge (m)', inp('cable_length_m', { type: 'number', step: '0.1', min: 0, oninput: () => check() }), 'über 5 m erhöht sich der R_SL-Grenzwert'), field('Querschnitt (mm²)', inp('cable_cross_section', { type: 'number', step: 'any', placeholder: '1,5' }))), limitBox),
    h('fieldset', {}, h('legend', {}, 'Prüfung & Erinnerung'), h('div', { class: 'grid c3' }, field('Prüfintervall', f.interval_months), field('Status', f.status), field('Nächste Prüfung (optional manuell)', inp('next_due_date', { type: 'date' }), 'wird nach jeder Prüfung automatisch berechnet')), h('label', { class: 'check', style: { marginTop: '10px' } }, f.reminder_enabled, 'Prüferinnerung per Mail/Kalender für dieses Gerät')),
    h('fieldset', {}, h('legend', {}, 'Notizen'), f.notes),
    datalist('dl-cat', meta.distinct.category),
    datalist('dl-loc', meta.distinct.location),
    datalist('dl-own', meta.distinct.owner),
    datalist('dl-man', meta.distinct.manufacturer),
    h('div', { class: 'row end' }, h('a', { class: 'btn ghost', href: id ? `#/devices/${id}` : '#/devices' }, 'Abbrechen'), !id ? h('button', { class: 'btn', type: 'submit', 'data-next': 'inspect' }, 'Speichern & prüfen') : null, h('button', { class: 'btn primary', type: 'submit' }, 'Speichern'))
  );
  check();
  return h('div', {}, h('div', { class: 'page-head' }, h('h1', {}, id ? `Gerät bearbeiten – ${d.inventory_no}` : 'Neues Gerät')), h('div', { class: 'card' }, form));
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
export async function renderDeviceDetail({ args, navigate }) {
  const id = Number(args[0]);
  const { device: d, inspections, attachments } = await get(`/devices/${id}`);
  const meta = state.meta;
  const kv = (k, v) => [h('dt', {}, k), h('dd', {}, v ?? '—')];

  const changeInterval = async () => {
    const sel = select(INTERVAL_PRESETS, d.interval_months);
    const custom = input({ type: 'number', min: 1, max: 120, value: d.interval_months });
    sel.addEventListener('change', () => (custom.value = sel.value));
    const r = await modal({ title: 'Prüfintervall ändern', body: h('div', { class: 'stack' }, field('Vorschlag', sel), field('Monate', custom), h('p', { class: 'small muted' }, 'Der nächste Termin wird ab der letzten bestandenen Prüfung neu berechnet.')), actions: [{ label: 'Abbrechen', value: null }, { label: 'Übernehmen', class: 'primary', onClick: () => Number(custom.value) }] });
    if (!r) return;
    await put(`/devices/${id}`, { interval_months: r });
    toast('Intervall geändert', 'ok');
    navigate(`#/devices/${id}`);
  };

  const changeStatus = async () => {
    const sel = select(Object.entries(STATUS_LABEL), d.status);
    const r = await modal({ title: 'Status ändern', body: field('Neuer Status', sel), actions: [{ label: 'Abbrechen', value: null }, { label: 'Übernehmen', class: 'primary', onClick: () => sel.value }] });
    if (!r) return;
    await put(`/devices/${id}`, { status: r });
    navigate(`#/devices/${id}`);
  };

  const remove = async () => {
    if (!(await confirmDialog(`Gerät „${d.name}“ mit allen ${inspections.length} Prüfungen und Fotos endgültig löschen? Tipp: Statt löschen kann ein Gerät auch „ausgemustert“ werden – dann bleibt die Prüfhistorie erhalten.`, { danger: true, confirmLabel: 'Endgültig löschen', requireText: d.inventory_no }))) return;
    await del(`/devices/${id}`);
    toast('Gerät gelöscht', 'ok');
    navigate('#/devices');
  };

  const invite = async () => {
    try {
      const r = await post(`/devices/${id}/invite`);
      toast(`Kalendereinladung an ${r.to.join(', ')} gesendet`, 'ok');
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };

  const upload = h('input', {
    type: 'file',
    accept: 'image/*,application/pdf',
    multiple: true,
    style: { display: 'none' },
    onchange: async (e) => {
      for (const file of e.target.files) {
        try {
          const { mime, data, name } = await prepareFile(file);
          await post(`/devices/${id}/attachments`, { filename: name, mime, dataBase64: data });
        } catch (ex) {
          toast(`${file.name}: ${ex.message}`, 'bad');
        }
      }
      navigate(`#/devices/${id}`);
    },
  });

  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'muted mono' }, d.inventory_no), h('h1', {}, d.name)), h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/inspect?device=${id}` }, '✅ Jetzt prüfen'), h('a', { class: 'btn', href: `#/devices/${id}/edit` }, '✏️ Bearbeiten'), h('button', { class: 'btn', onclick: async () => navigate(`#/devices/${(await post(`/devices/${id}/duplicate`)).id}/edit`) }, '⧉ Duplizieren'), h('button', { class: 'btn danger', onclick: remove }, '🗑 Löschen'))),
    d.status !== 'aktiv' ? h('div', { class: `alert ${d.status === 'ausgemustert' ? 'info' : 'bad'}` }, h('b', {}, `Status: ${STATUS_LABEL[d.status]}.`), d.status === 'ausgemustert' ? 'Gerät wird nicht mehr geprüft.' : 'Gerät darf bis zur bestandenen Nachprüfung NICHT benutzt werden.') : null,
    h(
      'div',
      { class: 'grid c2' },
      h('div', { class: 'card' }, h('h2', {}, 'Gerätedaten'), h('dl', { class: 'kv' }, kv('Schutzklasse', h('span', {}, skSymbol(d.protection_class, 18), ' ', d.protection_class)), kv('Geräteart', deviceTypeLabel(d.device_type)), kv('Hersteller / Typ', [d.manufacturer, d.model].filter(Boolean).join(' / ')), kv('Serien-Nr.', d.serial_no), kv('Kategorie', d.category), kv('Standort', d.location), kv('Eigentümer', d.owner), kv('Nennwerte', [d.rated_voltage && `${d.rated_voltage} V`, d.rated_power && `${d.rated_power} W`, d.rated_current && `${d.rated_current} A`].filter(Boolean).join(' · ')), kv('Leitung', d.cable_length_m ? `${fmt.num(d.cable_length_m)} m${d.cable_cross_section ? ` · ${d.cable_cross_section} mm²` : ''}` : null), kv('Kaufdatum', d.purchase_date ? fmt.date(d.purchase_date) : null)), d.notes ? h('p', { class: 'muted', style: { marginTop: '10px', whiteSpace: 'pre-wrap' } }, d.notes) : null),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Prüfstatus'),
        h('dl', { class: 'kv' }, kv('Letzte Prüfung', d.last_inspection_date ? h('span', {}, fmt.date(d.last_inspection_date), ' ', resultBadge(d.last_result)) : resultBadge(null)), kv('Nächste Prüfung', dueBadge(d)), kv('Prüfintervall', h('span', {}, `${d.interval_months} Monate `, h('button', { class: 'btn sm', onclick: changeInterval }, 'ändern'))), kv('Status', h('span', {}, STATUS_LABEL[d.status], ' ', h('button', { class: 'btn sm', onclick: changeStatus }, 'ändern'))), kv('Erinnerung', d.reminder_enabled ? 'aktiv' : 'aus')),
        h('div', { class: 'row', style: { marginTop: '12px' } }, h('a', { class: 'btn sm', href: `/api/calendar.ics?ids=${id}` }, '📅 Termin (.ics)'), meta.settings.reminders.smtp.host ? h('button', { class: 'btn sm', onclick: invite }, '✉️ Kalendereinladung mailen') : null, h('a', { class: 'btn sm', href: `/api/labels?ids=${id}`, target: '_blank' }, '🏷 Prüfplakette'))
      )
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, `Prüfhistorie (${inspections.length})`)),
      inspections.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Datum'), h('th', {}, 'Ablauf'), h('th', {}, 'Norm'), h('th', {}, 'Ergebnis'), h('th', {}, 'Maßnahme'), h('th', {}, 'Nächste'), h('th', {}, ''))), h('tbody', {}, inspections.map((i) => h('tr', { class: 'click', onclick: () => navigate(`#/inspections/${i.id}`) }, h('td', {}, fmt.date(i.inspection_date)), h('td', {}, procName(i.procedure), h('div', { class: 'small muted' }, meta.modes[i.mode] || i.mode)), h('td', {}, i.standard), h('td', {}, resultBadge(i.result)), h('td', {}, i.action ? actionLabel(i.action) : '—'), h('td', {}, fmt.date(i.next_due_date)), h('td', {}, h('a', { class: 'btn sm', href: `/api/inspections/${i.id}/report`, target: '_blank', onclick: (e) => e.stopPropagation() }, '🖨 Protokoll')))))))
        : h('div', { class: 'empty' }, 'Noch nicht geprüft. ', h('a', { href: `#/inspect?device=${id}` }, 'Erstprüfung starten'))
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Fotos & Dokumente'), h('div', {}, upload, h('button', { class: 'btn sm', onclick: () => upload.click() }, '+ Hinzufügen'))),
      attachments.length
        ? h(
            'div',
            { class: 'thumbs' },
            attachments.map((a) =>
              h(
                'div',
                { class: 'thumb' },
                h('a', { href: `/api/attachments/${a.id}`, target: '_blank' }, a.mime.startsWith('image/') ? h('img', { src: `/api/attachments/${a.id}`, alt: a.filename, loading: 'lazy' }) : h('div', { style: { height: '90px', display: 'grid', placeItems: 'center', fontSize: '2rem' } }, '📄')),
                h('div', { class: 'cap' }, h('span', { title: a.filename, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a.filename), h('button', { class: 'icon-btn', title: 'Löschen', onclick: async () => (await confirmDialog(`„${a.filename}“ löschen?`, { danger: true, confirmLabel: 'Löschen' })) && (await del(`/attachments/${a.id}`), navigate(`#/devices/${id}`)) }, '✕'))
              )
            )
          )
        : h('div', { class: 'muted small' }, 'Z. B. Foto vom Typschild, vom Gerät oder von Mängeln. Wird verschlüsselt in der Datenbank gespeichert.')
    )
  );
}

/** Bilder vor dem Hochladen verkleinern (max. 1600 px, JPEG) */
async function prepareFile(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 8 * 1024 * 1024) throw new Error('PDF größer als 8 MB');
    return { mime: file.type, data: await toBase64(file), name: file.name };
  }
  if (!file.type.startsWith('image/')) throw new Error('Nur Bilder und PDF');
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Bild nicht lesbar'));
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return { mime: 'image/jpeg', data: await toBase64(blob), name: file.name.replace(/\.\w+$/, '') + '.jpg' };
}

function toBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('Lesefehler'));
    r.readAsDataURL(blob);
  });
}
