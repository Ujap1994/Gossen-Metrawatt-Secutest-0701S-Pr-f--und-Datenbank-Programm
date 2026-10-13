// Gemeinsamer Zustand der Oberfläche
import { get } from './api.js';

export const state = {
  meta: null, // /api/meta
  secutest: null, // Status der Schnittstelle
  listeners: new Set(),
  events: null,
};

export async function loadMeta() {
  state.meta = await get('/meta');
  return state.meta;
}

export function onSecutest(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

function emit(type, data) {
  for (const fn of state.listeners) {
    try {
      fn(type, data);
    } catch (e) {
      console.error(e);
    }
  }
}

/** Server-Sent Events der SECUTEST-Schnittstelle (Log, Status, Hot-Plug) */
export function connectEvents() {
  if (state.events) return;
  const es = new EventSource('/api/secutest/events');
  state.events = es;
  for (const type of ['state', 'log', 'scan', 'port-added', 'port-removed', 'device-found']) {
    es.addEventListener(type, (ev) => {
      const data = JSON.parse(ev.data);
      if (type === 'state') state.secutest = data;
      emit(type, data);
    });
  }
  es.onerror = () => {
    // Browser verbindet automatisch neu; bei Sperre wird die Seite neu geladen
  };
}

export function disconnectEvents() {
  if (state.events) state.events.close();
  state.events = null;
}

export function procName(id) {
  return state.meta?.procedures.find((p) => p.id === id)?.name || id;
}

export function deviceTypeLabel(id) {
  return state.meta?.deviceTypes.find((t) => t.id === id)?.label || id;
}

export function actionLabel(id) {
  return state.meta?.actions.find((a) => a.id === id)?.label || id;
}
