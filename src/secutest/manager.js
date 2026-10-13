'use strict';
/**
 * Zentrale Verwaltung der SECUTEST-Verbindung für den Server:
 * Treiber, Auto-Erkennung/Hot-Plug, Live-Ereignisse (Server-Sent Events) und
 * die Mess-Operationen für den PC-gesteuerten und den gerätegeführten Modus.
 */
const config = require('../config');
const { SecutestDriver, listPorts } = require('./driver');
const { scan, listCandidates, PortWatcher } = require('./scanner');
const { SCENARIOS } = require('./simulator');
const { SWITCH_POSITIONS } = require('./protocol');
const { REMOTE, groupForMeasurementNo } = require('../vde/procedures');

const DEFAULT_SECUTEST_CFG = {
  address: null,
  withChecksum: true,
  timeoutMs: 2500,
  switchPositions: { ...SWITCH_POSITIONS },
  softwareMains: false, // Netz an Prüfdose per TAS!5 (nur mit codiertem Schnittstellenstecker)
  autoConnect: true, // eingesteckten Adapter automatisch anpingen und verbinden
  lastPort: '',
};

class SecutestManager {
  constructor() {
    this.driver = null;
    this.clients = new Set();
    this.watcher = null;
    this.lastScan = null;
    this.scanning = false;
    this._build();
  }

  cfg() {
    const c = config.load();
    return { ...DEFAULT_SECUTEST_CFG, ...(c.secutest || {}), switchPositions: { ...SWITCH_POSITIONS, ...((c.secutest || {}).switchPositions || {}) } };
  }

  updateCfg(patch) {
    config.update((c) => {
      c.secutest = { ...this.cfg(), ...patch };
    });
    if (this.driver) Object.assign(this.driver.opts, this._driverOpts());
    if ('autoConnect' in patch) (patch.autoConnect ? this.startWatcher() : this.stopWatcher());
    return this.cfg();
  }

  _driverOpts() {
    const c = this.cfg();
    return { address: c.address === '' ? null : c.address, withChecksum: c.withChecksum, timeoutMs: c.timeoutMs, switchPositions: c.switchPositions };
  }

  _build() {
    this.driver = new SecutestDriver(this._driverOpts());
    this.driver.on('log', (e) => this.broadcast('log', e));
    this.driver.on('state', (s) => this.broadcast('state', this.status()));
  }

  // -------------------- Server-Sent Events --------------------
  subscribe(res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: state\ndata: ${JSON.stringify(this.status())}\n\n`);
    for (const e of this.driver.logBuffer.slice(-100)) res.write(`event: log\ndata: ${JSON.stringify(e)}\n\n`);
    this.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    res.on('close', () => {
      clearInterval(ping);
      this.clients.delete(res);
    });
  }

  broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) c.write(msg);
  }

  status() {
    return { ...this.driver.status(), config: this.cfg(), scanning: this.scanning, lastScan: this.lastScan, watcher: !!this.watcher, scenarios: Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label })) };
  }

  // -------------------- Verbindung --------------------
  async listPorts() {
    const [a, b] = await Promise.all([listPorts(), listCandidates()]);
    const map = new Map();
    for (const p of b.candidates) map.set(p.path, p);
    for (const p of a.ports) if (!map.has(p.path)) map.set(p.path, p);
    return { ports: [...map.values()], error: a.ports.length || b.candidates.length ? null : a.error || b.error };
  }

  async connect({ path, simulator, scenario } = {}) {
    const st = await this.driver.connect({ path, simulator, scenario });
    if (!simulator && path) this.updateCfg({ lastPort: path });
    this.broadcast('state', this.status());
    return st;
  }

  async disconnect() {
    await this.driver.disconnect();
    this.broadcast('state', this.status());
    return this.status();
  }

  /** Auto-Ping aller Ports. connect=true: beim Fund sofort verbinden */
  async autoDetect({ connect = true } = {}) {
    if (this.scanning) throw Object.assign(new Error('Suche läuft bereits'), { status: 409 });
    this.scanning = true;
    this.broadcast('state', this.status());
    const wasWatching = !!this.watcher;
    if (this.watcher) this.watcher.paused = true;
    try {
      // zuletzt benutzten Port zuerst – ist das Programm schon verbunden, wird nicht gescannt
      if (this.driver.connected && !this.driver.simulator) return { found: { path: this.driver.portPath, identity: this.driver.identity }, results: [], alreadyConnected: true };
      if (this.driver.connected && this.driver.simulator) await this.driver.disconnect();
      const res = await scan({ onProgress: (p) => this.broadcast('scan', p) });
      this.lastScan = { at: new Date().toISOString(), found: res.found ? res.found.path : null, tried: res.results.map((r) => ({ path: r.path, ok: r.ok, error: r.error || null, chip: r.chip })) };
      if (res.found && connect) await this.connect({ path: res.found.path });
      return res;
    } finally {
      this.scanning = false;
      if (wasWatching && this.watcher) this.watcher.paused = false;
      this.broadcast('state', this.status());
    }
  }

  startWatcher() {
    if (this.watcher) return;
    this.watcher = new PortWatcher({ intervalMs: 3000 });
    this.watcher.on('added', (p) => this.broadcast('port-added', p));
    this.watcher.on('removed', (p) => {
      this.broadcast('port-removed', p);
      if (this.driver.connected && this.driver.portPath === p.path) this.driver.disconnect().catch(() => {});
    });
    this.watcher.on('found', async (r) => {
      this.broadcast('device-found', { path: r.path, identity: r.identity });
      if (!this.driver.connected && this.cfg().autoConnect) {
        try {
          await this.connect({ path: r.path });
        } catch (e) {
          this.broadcast('log', { dir: 'err', text: e.message, ts: new Date().toISOString() });
        }
      }
    });
    this.watcher.start();
  }

  stopWatcher() {
    if (this.watcher) this.watcher.stop();
    this.watcher = null;
  }

  // -------------------- Messungen --------------------
  mapValues(group, wer) {
    const def = REMOTE[group];
    const out = {};
    if (!def) return out;
    for (const [key, n] of Object.entries(def.map)) {
      if (wer[n]) out[key] = wer[n];
    }
    return out;
  }

  /** Anschlusskontrolle vor der Prüfung (Remote): Kurzschluss, Einschaltzustand, Schutzleiter */
  async precheck() {
    const d = this.driver;
    await d.setRemote(true);
    const res = {};
    res.noShort = await d.startMeasurement(1);
    res.probe = await d.startMeasurement(2);
    res.switchedOn = await d.startMeasurement(3);
    res.protectiveConductor = await d.startMeasurement(4);
    try {
      res.status = await d.getStatus();
    } catch {
      res.status = null;
    }
    return res;
  }

  async remoteStart(group, { second = false } = {}) {
    const def = REMOTE[group];
    if (!def) throw Object.assign(new Error(`Für „${group}“ gibt es keine Fernsteuerung.`), { status: 400 });
    const d = this.driver;
    if (!d.remoteActive) await d.setRemote(true);
    if (group === 'FT') {
      if (!this.cfg().softwareMains) return { started: false, manual: true, message: 'Bitte Taste FUNCTION-TEST (14) am Gerät drücken (Netz an Prüfdose).' };
      await d.pressKey('FUNCTION_TEST');
      return { started: true };
    }
    const cmds = second && def.second ? def.second : def.start;
    for (const c of cmds) {
      const ok = await d.startMeasurement(c.replace(/^MES!/, ''));
      if (!ok) throw Object.assign(new Error(`SECUTEST hat ${c} abgelehnt (N). Anschluss und Schalterstellung prüfen.`), { status: 409 });
    }
    return { started: true };
  }

  async remoteRead(group) {
    const def = REMOTE[group];
    if (!def) throw Object.assign(new Error(`Unbekannte Messgruppe ${group}`), { status: 400 });
    const wer = await this.driver.getValues(def.read);
    return { group, raw: wer, values: this.mapValues(group, wer) };
  }

  async remoteStopFunctionTest() {
    if (this.cfg().softwareMains) await this.driver.pressKey('FUNCTION_TEST');
    return { ok: true };
  }

  async remoteEnd() {
    if (this.driver.connected && this.driver.remoteActive) await this.driver.setRemote(false);
    return { ok: true };
  }

  /** Gerätegeführter Modus: was läuft gerade? + Live-Werte */
  async live() {
    const st = await this.driver.getStatus();
    const groups = [...new Set(st.running.map(groupForMeasurementNo).filter(Boolean))];
    const group = groups[0] || null;
    let values = {};
    if (group) {
      try {
        const wer = await this.driver.getValues(REMOTE[group].read);
        values = this.mapValues(group, wer);
      } catch {
        /* egal */
      }
    }
    return { flags: st.flags, running: st.running, group, values };
  }

  /** Ergebnis (PRO?) + Funktionstest-Werte (WER?) abholen */
  async fetchResult() {
    const pro = await this.driver.readProtocol();
    let ft = {};
    try {
      const wer = await this.driver.getValues(REMOTE.FT.read);
      ft = this.mapValues('FT', wer);
      for (const k of Object.keys(ft)) if (ft[k].value == null) delete ft[k];
    } catch {
      /* Funktionstest nicht durchgeführt */
    }
    return { protocol: pro, functionTest: ft, identity: this.driver.identity };
  }
}

const manager = new SecutestManager();
module.exports = { manager, SecutestManager };
