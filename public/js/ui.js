// Kleine DOM-Helfer ohne Framework
export function h(tag, attrs = {}, ...children) {
  const el = tag === 'frag' ? document.createDocumentFragment() : document.createElement(tag);
  if (attrs && tag !== 'frag') {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v; // nur für vertrauenswürdige, intern erzeugte Inhalte (SVG)
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Kinder anhängen (Arrays werden geglättet, null/false ignoriert) */
export function add(el, ...children) {
  append(el, children);
  return el;
}

/** Inhalt ersetzen */
export function fill(el, ...children) {
  return add(clear(el), ...children);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------- Formatierung ----------------
export const fmt = {
  date(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}.${m}.${y}`;
  },
  dateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  },
  num(v, digits) {
    if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
    const n = Number(v);
    const d = digits ?? (Math.abs(n) >= 100 ? 1 : Math.abs(n) >= 10 ? 2 : 3);
    return n.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, n % 1 === 0 ? 0 : 1) });
  },
  today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
  addMonths(iso, months) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(y, m - 1 + Number(months), 1);
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    t.setDate(Math.min(d, last));
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  },
};

export const RESULT_LABEL = { bestanden: 'bestanden', nicht_bestanden: 'nicht bestanden', abgebrochen: 'abgebrochen' };
export const STATUS_LABEL = { aktiv: 'aktiv', gesperrt: 'gesperrt', reparatur: 'in Reparatur', ausgemustert: 'ausgemustert' };

export function resultBadge(result) {
  if (!result) return h('span', { class: 'badge muted' }, 'noch nie geprüft');
  return h('span', { class: `badge ${result === 'bestanden' ? 'ok' : result === 'abgebrochen' ? 'muted' : 'bad'}` }, RESULT_LABEL[result] || result);
}

export function dueBadge(d) {
  switch (d.due_state) {
    case 'overdue':
      return h('span', { class: 'badge bad', title: fmt.date(d.next_due_date) }, `überfällig (${-d.due_in_days} T.)`);
    case 'soon':
      return h('span', { class: 'badge warn', title: fmt.date(d.next_due_date) }, d.due_in_days === 0 ? 'heute fällig' : `in ${d.due_in_days} Tagen`);
    case 'ok':
      return h('span', { class: 'badge ok-soft' }, fmt.date(d.next_due_date));
    case 'blocked':
      return h('span', { class: 'badge bad' }, STATUS_LABEL[d.status]);
    case 'retired':
      return h('span', { class: 'badge muted' }, 'ausgemustert');
    case 'never':
      return h('span', { class: 'badge warn' }, 'Erstprüfung offen');
    default:
      return h('span', { class: 'badge muted' }, '—');
  }
}

export function skSymbol(sk, size = 22) {
  const s = size;
  if (sk === 'SK I')
    return h('span', {
      class: 'sk-sym',
      title: 'Schutzklasse I (Schutzleiter)',
      html: `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 4.5v8M6.5 12.5h11M8.5 15.5h7M10.5 18.5h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    });
  if (sk === 'SK II')
    return h('span', { class: 'sk-sym', title: 'Schutzklasse II (schutzisoliert)', html: `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="7" y="7" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>` });
  if (sk === 'SK III')
    return h('span', { class: 'sk-sym', title: 'Schutzklasse III (Schutzkleinspannung)', html: `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M12 1.5 22.5 12 12 22.5 1.5 12z" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="15.6" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" font-family="Arial">III</text></svg>` });
  return h('span', {}, sk || '');
}

// ---------------- Toasts ----------------
export function toast(message, type = 'info', ms = 4200) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${type}`, role: 'status' }, message);
  box.appendChild(t);
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// ---------------- Modal ----------------
export function modal({ title, body, actions = [{ label: 'Schließen', value: null }], wide = false }) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'modal-overlay' });
    const close = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => e.key === 'Escape' && close(null);
    const dlg = h(
      'div',
      { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onclick: () => close(null) }, '✕')),
      h('div', { class: 'modal-body' }, body),
      h(
        'div',
        { class: 'modal-foot' },
        actions.map((a) =>
          h(
            'button',
            {
              class: `btn ${a.class || ''}`,
              onclick: async () => {
                if (a.onClick) {
                  const r = await a.onClick();
                  if (r === false) return;
                  return close(r === undefined ? a.value : r);
                }
                close(a.value);
              },
            },
            a.label
          )
        )
      )
    );
    overlay.appendChild(dlg);
    overlay.addEventListener('mousedown', (e) => e.target === overlay && close(null));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    const first = dlg.querySelector('input,select,textarea');
    (first || dlg.querySelector('.modal-foot .btn:last-child'))?.focus();
  });
}

export async function confirmDialog(text, { title = 'Bitte bestätigen', confirmLabel = 'OK', danger = false, requireText = null } = {}) {
  const input = requireText ? h('input', { class: 'input', placeholder: requireText }) : null;
  const body = h('div', {}, h('p', {}, text), requireText ? h('p', { class: 'muted' }, `Zur Bestätigung „${requireText}“ eingeben:`) : null, input);
  const r = await modal({
    title,
    body,
    actions: [
      { label: 'Abbrechen', value: false },
      {
        label: confirmLabel,
        class: danger ? 'danger' : 'primary',
        onClick: () => {
          if (requireText && input.value.trim() !== requireText) {
            input.classList.add('invalid');
            return false;
          }
          return true;
        },
      },
    ],
  });
  return r === true;
}

// ---------------- Formular-Helfer ----------------
export function field(label, control, hint, opts = {}) {
  return h('label', { class: `field ${opts.class || ''}` }, h('span', { class: 'field-label' }, label, opts.required ? h('span', { class: 'req' }, ' *') : null), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function input(attrs = {}) {
  return h('input', { class: 'input', ...attrs });
}

export function select(options, value, attrs = {}) {
  return h(
    'select',
    { class: 'input', ...attrs },
    options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o.value ?? o.id, o.label ?? o.name];
      return h('option', { value: v, selected: String(v) === String(value) }, l);
    })
  );
}

export function datalist(id, values) {
  return h('datalist', { id }, (values || []).map((v) => h('option', { value: v })));
}

export function formData(form) {
  const out = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else out[el.name] = el.value;
  }
  return out;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function download(url) {
  const a = h('a', { href: url, download: '' });
  document.body.appendChild(a);
  a.click();
  a.remove();
}
