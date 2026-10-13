// Secutest Prüfmanager – Oberfläche (ohne Build-Schritt, native ES-Module)
import { h, $, clear, toast, modal } from './ui.js';
import { disclaimerContent } from './disclaimer.js';
import { shutdownApp } from './shutdown.js';
import { get, post, setLockedOutHandler } from './api.js';
import { state, loadMeta, connectEvents, disconnectEvents, onSecutest } from './state.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderDeviceList, renderDeviceForm, renderDeviceDetail } from './views/devices.js';
import { renderInspect, renderInspectionDetail, wizardDirty } from './views/inspect.js';
import { renderSecutest } from './views/secutest.js';
import { renderSettings, renderReminders, renderAudit, renderInspections } from './views/settings.js';

const root = document.getElementById('app');

// ---------- Theme ----------
const savedTheme = (() => {
  try {
    return localStorage.getItem('theme');
  } catch {
    return null;
  }
})();
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* egal */
  }
}

// ---------- Routing ----------
const ROUTES = [
  [/^#\/?$/, () => renderDashboard],
  [/^#\/dashboard$/, () => renderDashboard],
  [/^#\/devices$/, () => renderDeviceList],
  [/^#\/devices\/new$/, () => renderDeviceForm],
  [/^#\/devices\/(\d+)\/edit$/, () => renderDeviceForm],
  [/^#\/devices\/(\d+)$/, () => renderDeviceDetail],
  [/^#\/inspect$/, () => renderInspect],
  [/^#\/inspections$/, () => renderInspections],
  [/^#\/inspections\/(\d+)$/, () => renderInspectionDetail],
  [/^#\/secutest$/, () => renderSecutest],
  [/^#\/reminders$/, () => renderReminders],
  [/^#\/settings$/, () => renderSettings],
  [/^#\/audit$/, () => renderAudit],
];

const NAV = [
  ['#/dashboard', '🏠', 'Übersicht'],
  ['#/devices', '🔌', 'Geräte'],
  ['#/inspect', '✅', 'Prüfen'],
  ['#/inspections', '📋', 'Prüfungen'],
  ['#/secutest', '📟', 'SECUTEST'],
  ['#/reminders', '⏰', 'Erinnerungen'],
  ['#/settings', '⚙️', 'Einstellungen'],
];

let shell = null;

function parseHash() {
  const [path, query = ''] = location.hash.split('?');
  return { path: path || '#/', params: Object.fromEntries(new URLSearchParams(query)) };
}

async function route() {
  const { path, params } = parseHash();
  if (!shell) return;
  const match = ROUTES.find(([re]) => re.test(path));
  const view = match ? match[1]() : renderDashboard;
  const args = match ? path.match(match[0]).slice(1) : [];
  for (const a of shell.querySelectorAll('.nav a')) a.classList.toggle('active', path.startsWith(a.getAttribute('href')) || (path === '#/' && a.getAttribute('href') === '#/dashboard'));
  shell.querySelector('.sidebar').classList.remove('open');
  const content = $('.content', shell);
  clear(content);
  content.appendChild(h('div', { class: 'muted' }, 'Lade …'));
  try {
    const node = await view({ params, args, navigate });
    clear(content);
    if (node) content.appendChild(node);
    window.scrollTo(0, 0);
  } catch (e) {
    if (e.status === 401) return;
    clear(content);
    content.appendChild(h('div', { class: 'alert bad' }, h('b', {}, 'Fehler:'), e.message));
  }
}

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

let lastHash = location.hash;
window.addEventListener('hashchange', (e) => {
  if (wizardDirty() && lastHash.startsWith('#/inspect') && !location.hash.startsWith('#/inspect')) {
    if (!confirm('Die laufende Prüfung wurde noch nicht gespeichert. Seite wirklich verlassen?')) {
      history.replaceState(null, '', lastHash);
      e.preventDefault?.();
      return;
    }
  }
  lastHash = location.hash;
  route();
});
window.addEventListener('beforeunload', (e) => {
  if (wizardDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- Layout ----------
function secutestPill() {
  const s = state.secutest;
  const connected = s?.connected;
  const label = !s ? 'SECUTEST …' : connected ? (s.simulator ? 'Simulator verbunden' : `SECUTEST an ${s.port}`) : s.scanning ? 'Suche SECUTEST …' : 'SECUTEST nicht verbunden';
  return h('a', { class: 'pill-status', href: '#/secutest', title: 'SECUTEST-Verbindung' }, h('span', { class: `dot ${connected ? (s.simulator ? 'sim' : 'on') : 'off'}` }), label);
}

function buildShell() {
  const meta = state.meta;
  const pillBox = h('span', {}, secutestPill());
  onSecutest((type, data) => {
    if (type === 'state') clear(pillBox).appendChild(secutestPill());
    if (type === 'device-found') toast(`SECUTEST an ${data?.path || 'neuem Port'} gefunden`, 'ok');
    if (type === 'port-added') toast(`Neue serielle Schnittstelle erkannt: ${data?.path} – prüfe auf SECUTEST …`, 'info');
  });
  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    h('div', { class: 'brand' }, h('img', { src: '/img/icon.svg', alt: '' }), h('div', {}, 'Prüfmanager', h('small', {}, 'SECUTEST 0701S · VDE 0701/0702'))),
    h('nav', { class: 'nav' }, NAV.map(([href, ico, label]) => h('a', { href }, h('span', { class: 'ico' }, ico), label))),
    h('div', { class: 'spacer' }),
    h('nav', { class: 'nav' }, h('a', { href: '#/audit' }, h('span', { class: 'ico' }, '🕘'), 'Änderungsprotokoll'), h('a', { href: '#', onclick: (e) => (e.preventDefault(), toggleTheme()) }, h('span', { class: 'ico' }, '🌓'), 'Hell/Dunkel'), h('a', { href: '#', onclick: (e) => (e.preventDefault(), modal({ title: 'Sicherheitshinweis & Haftungsausschluss', body: disclaimerContent(), wide: true })) }, h('span', { class: 'ico' }, '⚠'), 'Haftungsausschluss'), h('a', { href: '#', onclick: (e) => (e.preventDefault(), shutdownApp()) }, h('span', { class: 'ico' }, '⏻'), 'Programm beenden'))
  );
  shell = h(
    'div',
    { class: 'layout' },
    sidebar,
    h(
      'div',
      { class: 'main' },
      h(
        'header',
        { class: 'topbar' },
        h('button', { class: 'btn sm menu-btn', onclick: () => sidebar.classList.toggle('open') }, '☰'),
        h('span', { class: 'db', title: meta.db.file }, '🗄 ', meta.db.name),
        h('span', { class: 'grow' }),
        pillBox,
        h('a', { class: 'btn sm primary', href: '#/inspect' }, '+ Prüfung'),
        h('button', { class: 'btn sm', title: 'Datenbank sperren (abmelden)', onclick: lock }, '🔒 Sperren')
      ),
      h('main', { class: 'content' })
    )
  );
  clear(root).appendChild(shell);
}

async function lock() {
  if (wizardDirty() && !confirm('Die laufende Prüfung geht verloren. Trotzdem sperren?')) return;
  await post('/lock').catch(() => {});
  showLogin('Datenbank gesperrt.');
}

function showLogin(message) {
  disconnectEvents();
  shell = null;
  state.meta = null;
  renderLogin(root, { message, onUnlocked: startApp });
}

async function startApp() {
  await loadMeta();
  try {
    state.secutest = await get('/secutest/status');
  } catch {
    state.secutest = null;
  }
  buildShell();
  connectEvents();
  if (state.meta.recoveryRemaining <= 2) toast(`Nur noch ${state.meta.recoveryRemaining} Wiederherstellungscodes übrig – bitte in den Einstellungen neue erzeugen.`, 'warn', 8000);
  route();
}

setLockedOutHandler(() => {
  if (shell) showLogin('Die Sitzung wurde gesperrt (Inaktivität oder anderer Zugriff). Bitte erneut anmelden.');
});

(async function boot() {
  try {
    const st = await get('/status');
    if (st.authed) await startApp();
    else showLogin();
  } catch (e) {
    clear(root).appendChild(h('div', { class: 'boot' }, `Server nicht erreichbar: ${e.message}`));
  }
})();
