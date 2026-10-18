// REST-Client
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let onLockedOut = null;
let paused = false;
let boot = '';

/** Kennung des Serverstarts (aus /api/status) – der Server erkennt damit Tabs mit veraltetem Programmcode */
export function setBoot(id) {
  boot = id || '';
}
export const getBoot = () => boot;

/** Server neu gestartet oder aktualisiert: Seite neu laden (höchstens alle 15 s, damit es keine Schleife wird) */
export function reloadOutdated() {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem('secutest-reload') || 0);
    sessionStorage.setItem('secutest-reload', String(Date.now()));
  } catch {
    /* ohne Speicher trotzdem neu laden */
  }
  if (Date.now() - last > 15000) location.reload();
}

/** Tab pausiert (Programm in einem anderen Tab geöffnet): keine Anfragen mehr, damit nicht zwei Tabs das Gerät steuern */
export function setPaused(on) {
  paused = !!on;
}

export function setLockedOutHandler(fn) {
  onLockedOut = fn;
}

export async function api(method, path, body) {
  if (paused) throw new ApiError('Pausiert – der Prüfmanager ist in einem anderen Tab geöffnet.', 0, { code: 'PAUSED' });
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'secutest', 'X-UI-Boot': boot },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 409 && data?.code === 'RELOAD') reloadOutdated();
    if (res.status === 401 && data && data.code === 'LOCKED_OUT' && onLockedOut) onLockedOut();
    throw new ApiError((data && data.error) || `Fehler ${res.status}`, res.status, data);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);
