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
const { SWITCH_POSITIONS, convertUnit } = require('./protocol');
const { REMOTE, groupForMeasurementNo } = require('../vde/procedures');
const { QUANTITIES } = require('../vde/limits');

/** Das Gerät sendet die Einheit mit (z. B. kΩ statt MΩ) – auf die Einheit der Messgröße umrechnen */
function toQuantityUnit(key, v) {
  const q = QUANTITIES[key] || QUANTITIES[key.replace(/_(MIN|MAX|AC|DC|TRMS|LIVE)$/, '')];
  if (!v.unit || !q || v.unit === q.unit || v.value == null) return v;
  const value = convertUnit(v.value, v.unit, q.unit);
  // nicht umrechenbar (falsche Größe) -> Wert verwerfen statt falsch skaliert übernehmen
  if (value == null) return { ...v, value: null, text: `${v.text} ${v.unit}` };
  return { ...v, value, text: `${v.qualifier || ''}${value}`, unit: q.unit };
}

/**
 * Funktionstest: Das Gerät liefert U, I, P … auch ohne Netz an der Prüfdose (Netzspannung am SECUTEST, Rauschen).
 * Der Energiezähler W (Nr. 55) hat nur einen Wert, solange der Funktionstest läuft bzw. noch nicht abgeschlossen ist.
 */
const ftActive = (values) => values.W?.value != null;
// nach dem Ende des Funktionstests zeigen I und P nur noch den Leerlauf – das Gerät hält die Maximalwerte
const FT_HELD = { P: 'P_MAX', I: 'I_MAX' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Zwei Anzeigewerte gleich bis auf das Kippen der letzten Stelle (höchstens 2 % bzw. 2 Stellen) */
function near(a, b) {
  if (a?.value == null || b?.value == null || a.qualifier !== b.qualifier || a.unit !== b.unit) return false;
  if (a.text === b.text) return true;
  const digit = 10 ** -((String(a.text).split('.')[1] || '').replace(/\D/g, '').length);
  return Math.abs(a.value - b.value) <= Math.max(Math.abs(b.value) * 0.02, 2 * digit);
}

/**
 * Unruhe während der Messung (z. B. Prüfling berührt): Das Gerät hält Minimum/Maximum, und der übernommene
 * Wert hängt daran. Liegt das Minimum (R_ISO) weit unter bzw. das Maximum (I_B, I_EA) weit über dem
 * eingeschwungenen Anzeigewert, wäre der Wert verfälscht – dann nicht still übernehmen.
 */
const TRANSIENT = {
  RISO: (v) => v.RISO_MIN?.value != null && v.RISO_LIVE?.value != null && ((v.RISO_LIVE.qualifier === '>' && v.RISO_MIN.qualifier !== '>') || v.RISO_MIN.value < v.RISO_LIVE.value * 0.5),
  IB: (v) => v.IB_MAX?.value != null && v.IB_LIVE?.value != null && v.IB_MAX.value > v.IB_LIVE.value * 2 && v.IB_MAX.value - v.IB_LIVE.value > 0.05,
  IEA: (v) => v.IEA_MAX?.value != null && v.IEA_LIVE?.value != null && v.IEA_MAX.value > v.IEA_LIVE.value * 2 && v.IEA_MAX.value - v.IEA_LIVE.value > 0.05,
};

const DEFAULT_SECUTEST_CFG = {
  address: null,
  withChecksum: true,
  timeoutMs: 2500,
  switchPositions: { ...SWITCH_POSITIONS },
  softwareMains: false, // Netz an Prüfdose per TAS!5 (nur mit codiertem Schnittstellenstecker)
  autoConnect: true, // eingesteckten Adapter automatisch anpingen und verbinden
  terminal: true, // RS-232-Terminal (freie Befehle) auf der SECUTEST-Seite anzeigen – in den Einstellungen abschaltbar
  lastPort: '',
  debugLog: false, // jede gesendete/empfangene Zeile ins Log (wie SECUTEST_DEBUG=1) – zur Fehlersuche
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
    this.driver.on('log', (e) => {
      this.broadcast('log', e);
      // ohne Terminal (macOS-App) landet das in der Logdatei – hilft bei „findet das Gerät nicht“
      // SECUTEST_DEBUG=1 bzw. debugLog: auch jede gesendete und empfangene Zeile
      if (this.logToConsole && (process.env.SECUTEST_DEBUG || this.cfg().debugLog || (e.dir !== 'tx' && e.dir !== 'rx'))) console.log(`${new Date().toISOString().slice(11, 23)} [SECUTEST] ${e.dir.padEnd(4)} ${e.text}`);
    });
    this.driver.on('state', (s) => this.broadcast('state', this.status()));
    this.driver.on('device-event', (e) => this.broadcast(e.type, e));
  }

  // -------------------- Server-Sent Events --------------------
  /**
   * Nur ein Browser-Tab ist aktiv: Ein neuer Tab pausiert die älteren. Sonst steuern mehrere Tabs
   * gleichzeitig das Gerät, und jeder offene Ereignis-Kanal belegt eine der ca. 6 Verbindungen,
   * die ein Browser je Adresse zulässt – ab dem 6. Tab lädt dann gar nichts mehr.
   */
  subscribe(res) {
    for (const old of this.clients) {
      old.write('event: superseded\ndata: {}\n\n');
      old.end();
    }
    this.clients.clear();
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
    this.manualDisconnect = false;
    const st = await this.driver.connect({ path, simulator, scenario });
    if (!simulator && path) this.updateCfg({ lastPort: path });
    this.broadcast('state', this.status());
    return st;
  }

  /** Trennen durch den Benutzer: nicht gleich wieder automatisch verbinden (erst nach erneutem Einstecken oder Suchen) */
  async disconnect() {
    this.manualDisconnect = true;
    await this.driver.disconnect();
    this.broadcast('state', this.status());
    return this.status();
  }

  /** Auto-Ping aller Ports. connect=true: beim Fund sofort verbinden */
  async autoDetect({ connect = true } = {}) {
    if (this.scanning) throw Object.assign(new Error('Suche läuft bereits'), { status: 409 });
    this.scanning = true;
    this.manualDisconnect = false;
    this.broadcast('state', this.status());
    const wasWatching = !!this.watcher;
    if (this.watcher) this.watcher.paused = true;
    try {
      // zuletzt benutzten Port zuerst – ist das Programm schon verbunden, wird nicht gescannt
      if (this.driver.connected && !this.driver.simulator) return { found: { path: this.driver.portPath, identity: this.driver.identity }, results: [], alreadyConnected: true };
      if (this.driver.connected && this.driver.simulator) await this.driver.disconnect();
      const res = await scan({ onProgress: (p) => this.broadcast('scan', p) });
      if (this.logToConsole && !res.found) console.log(`[SECUTEST] Automatische Suche ohne Treffer: ${res.results.map((r) => `${r.path} (${r.error || 'keine Antwort'})`).join(', ') || 'keine USB-Seriell-Adapter gefunden'}`);
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
    this.watcher = new PortWatcher({ intervalMs: 3000, shouldProbe: () => !this.driver.connected && !this.scanning && !this.manualDisconnect && this.cfg().autoConnect });
    this.watcher.on('added', (p) => {
      this.manualDisconnect = false; // neu eingesteckt: wieder automatisch verbinden
      this.broadcast('port-added', p);
    });
    this.watcher.on('removed', (p) => {
      this.broadcast('port-removed', p);
      if (this.driver.connected && this.driver.portPath === p.path) this.driver.disconnect().catch(() => {});
    });
    this.watcher.on('found', async (r) => {
      if (this.logToConsole) console.log(`[SECUTEST] Gefunden an ${r.path}`);
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
  mapValues(group, wer, map = REMOTE[group]?.map) {
    const out = {};
    if (!map) return out;
    for (const [key, n] of Object.entries(map)) {
      if (wer[n]) out[key] = toQuantityUnit(key, wer[n]);
    }
    return out;
  }

  /**
   * Werte zum Übernehmen: jede Größe muss zweimal nacheinander gleich gelesen werden – das Gerät vertauscht
   * gelegentlich Zeichen, und die Prüfsumme (reine Zeichensumme) erkennt das nicht.
   */
  async readConfirmed(group) {
    const def = REMOTE[group];
    const keys = Object.keys(def.map);
    const values = {};
    let last = null;
    for (let i = 0; i < 4 && keys.some((k) => !(k in values) && (!last || last[k])); i++) {
      const cur = this.mapValues(group, await this.driver.getValues(def.read));
      if (last) for (const k of keys) if (!(k in values) && cur[k] && last[k] && cur[k].text === last[k].text && cur[k].unit === last[k].unit) values[k] = cur[k];
      last = cur;
    }
    return { values, last: last || {}, unconfirmed: keys.filter((k) => !(k in values) && last?.[k]?.value != null) };
  }

  /** Hauptwerte und Anzeigewert in EINER Abfrage – das Gerät verkraftet nur wenige Abfragen pro Sekunde */
  async _readGroup(group, liveMap) {
    const def = REMOTE[group];
    const extra = Object.values(liveMap || {}).filter((n) => !def.read.includes(n));
    let wer = await this.driver.getValues([...def.read, ...extra]);
    // „.Nx“ (Anzeigewert-Nummer kennt das Gerät nicht): nur die Hauptwerte
    if (extra.length && !Object.keys(wer).length) wer = await this.driver.getValues(def.read);
    return { main: this.mapValues(group, wer), live: liveMap ? this.mapValues(group, wer, liveMap) : {} };
  }

  /** Anschlussstatus erst übernehmen, wenn er zweimal gleich gemeldet wurde (Gerät vertauscht gelegentlich Hex-Ziffern) */
  _stableStatus(st) {
    const same = st.raw === this._lastStatusRaw;
    this._lastStatusRaw = st.raw;
    if (same || !this._stableStatusValue) this._stableStatusValue = st;
    return this._stableStatusValue;
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
      res.status = await d.getStatus({ confirm: true });
    } catch {
      res.status = null;
    }
    return res;
  }

  async remoteStart(group, { second = false } = {}) {
    const def = REMOTE[group];
    if (!def) throw Object.assign(new Error(`Für „${group}“ gibt es keine Fernsteuerung.`), { status: 400 });
    if (group === 'FT') return this.releaseForFunctionTest();
    const d = this.driver;
    if (!d.remoteActive) await d.setRemote(true);
    const cmds = second && def.second ? def.second : def.start;
    for (const c of cmds) {
      const ok = await d.startMeasurement(c.replace(/^MES!/, ''));
      if (!ok) throw Object.assign(new Error(`SECUTEST hat ${c} abgelehnt (N). Anschluss und Schalterstellung prüfen.`), { status: 409 });
    }
    return { started: true };
  }

  /**
   * Automatik (PC-gesteuert): Messung starten (R_SL in beiden Polungen), einschwingen lassen und den Wert
   * übernehmen, sobald er in zwei Ablesungen im Abstand von einer Sekunde gleich ist – eingeschwungen und
   * nicht verfälscht übertragen. Höchstens eine Abfrage pro Sekunde: Bei etwa 5 Abfragen/s bricht der
   * SECUTEST die Messung ab bzw. startet neu (am Gerät gemessen). Die Oberfläche bekommt die Live-Werte
   * deshalb per Ereignis „measure“, statt selbst zusätzlich abzufragen.
   */
  async autoMeasure(group, { settleMs = 2500, readEveryMs = 1000, maxMs = 25000, fresh = false } = {}) {
    const def = REMOTE[group];
    if (!def || group === 'FT') throw Object.assign(new Error(`Für „${group}“ gibt es keine automatische Messung.`), { status: 400 });
    // Wiederholung: Fernsteuerung kurz aus – erst dann setzt das Gerät Minimum/Maximum zurück
    if (fresh && this.driver.remoteActive) await this.driver.setRemote(false);
    await this.remoteStart(group);
    if (def.second) {
      await sleep(settleMs);
      await this.remoteStart(group, { second: true });
    }
    const t0 = Date.now();
    await sleep(settleMs);
    let prev = null;
    for (;;) {
      const { main, live } = await this._readGroup(group, def.live);
      this.broadcast('measure', { group, values: { ...live, ...main } });
      const m = main[def.final];
      const liveKey = Object.keys(live)[0];
      // eingeschwungen: übernommener Wert in zwei Ablesungen gleich und auch die Anzeige ruhig
      const steady = m?.value != null && prev?.main[def.final]?.text === m.text && prev.main[def.final].unit === m.unit && (!liveKey || near(live[liveKey], prev.live[liveKey]));
      if (steady) {
        const values = {};
        const unconfirmed = [];
        for (const [k, v] of Object.entries(main)) {
          if (prev.main[k]?.text === v.text) values[k] = v;
          else if (v.value != null) unconfirmed.push(k);
        }
        const transient = !!TRANSIENT[group]?.({ ...main, ...live });
        return { group, values, live, unconfirmed, transient, ms: Date.now() - t0 };
      }
      prev = { main, live };
      if (Date.now() - t0 > maxMs) throw Object.assign(new Error(`Kein stabiler Messwert innerhalb von ${Math.round(maxMs / 1000)} s – wird der Prüfling berührt? Anschluss prüfen und wiederholen.`), { status: 504, code: 'UNSTABLE' });
      await sleep(readEveryMs);
    }
  }

  /**
   * Funktionstest (PC-gesteuert): Den führt der Prüfer am SECUTEST durch. Fernsteuerung aus (sonst sperrt
   * das Gerät seine Tasten) und Programm FUNCTION-TEST wählen – nur die Fernsteuerung abzuschalten bringt
   * das Gerät an den Anfang seines Prüfprogramms zurück, von dort käme man erst über dessen ganzen Ablauf
   * zum Funktionstest. Danach stellt das Programm nichts mehr um; beendet wird am Gerät.
   * (Am Gerät gemessen: vor Taste 14 meldet das Programm FUNCTION-TEST keine Werte, „bereit“ ist über die
   * Schnittstelle nicht erkennbar; ^C beendet einen Funktionstest nicht.)
   */
  async releaseForFunctionTest() {
    const d = this.driver;
    if (this.cfg().softwareMains) {
      if (!d.remoteActive) await d.setRemote(true);
      await d.pressKey('FUNCTION_TEST');
      return { started: true };
    }
    if (d.remoteActive) await d.setRemote(false);
    await d.setSwitch('FUNCTION-TEST');
    return { started: false, manual: true, message: 'SECUTEST steht auf FUNCTION-TEST – sobald die Lampe (15) blinkt, mit Taste 14 starten.' };
  }

  /** confirm: Werte zum Übernehmen (zweimal gleich gelesen), sonst Live-Werte inkl. Anzeigewert */
  async remoteRead(group, { confirm = false } = {}) {
    const def = REMOTE[group];
    if (!def) throw Object.assign(new Error(`Unbekannte Messgruppe ${group}`), { status: 400 });
    const r = confirm ? await this.readConfirmed(group) : await this._readGroup(group, group === 'FT' ? null : def.live).then(({ main, live }) => ({ values: { ...live, ...main }, last: main, unconfirmed: [] }));
    if (group === 'FT') {
      const active = ftActive(r.last);
      return { group, values: active ? r.values : {}, unconfirmed: active ? r.unconfirmed : [], ftActive: active };
    }
    return { group, values: r.values, unconfirmed: r.unconfirmed };
  }

  async remoteStopFunctionTest() {
    if (this.cfg().softwareMains) await this.driver.pressKey('FUNCTION_TEST');
    return { ok: true };
  }

  async remoteEnd() {
    if (this.driver.connected && this.driver.remoteActive) await this.driver.setRemote(false);
    return { ok: true };
  }

  /** Gerätegeführter Modus: was läuft gerade? + Live-Werte (confirm: zum Übernehmen zweimal gleich gelesen) */
  async live({ confirm = false } = {}) {
    const st = this._stableStatus(await this.driver.getStatus());
    const groups = [...new Set(st.running.map(groupForMeasurementNo).filter(Boolean))];
    const group = groups[0] || null;
    let values = {};
    let unconfirmed = [];
    let ftOn = null;
    if (group) {
      try {
        const def = REMOTE[group];
        // Anzeigewert: die laufende Messnummer (z. B. R_ISO Nr. 18, I_EA über Sonde Nr. 24) – in derselben Abfrage
        const nums = st.running.filter((n) => groupForMeasurementNo(n) === group && !def.read.includes(n));
        const liveMap = group === 'FT' ? null : nums.length ? { [`${def.final}_LIVE`]: nums[0] } : def.live;
        const r = confirm ? await this.readConfirmed(group) : await this._readGroup(group, liveMap).then(({ main, live }) => ({ values: { ...live, ...main }, last: main, unconfirmed: [] }));
        values = r.values;
        unconfirmed = r.unconfirmed;
        if (group === 'FT') {
          ftOn = ftActive(r.last);
          if (!ftOn) (values = {}), (unconfirmed = []);
        }
      } catch {
        /* egal */
      }
    }
    return { flags: st.flags, running: st.running, group, values, unconfirmed, ftActive: ftOn };
  }

  /** Ergebnis (PRO?, zweimal gleich gelesen) + Funktionstest-Werte (WER?) abholen */
  async fetchResult() {
    const pro = await this.driver.readProtocol();
    let ft = {};
    try {
      const r = await this.readConfirmed('FT');
      if (ftActive(r.last)) ft = { ...r.values };
      else if (pro.performed.FT || pro.performed.DI) {
        // am Gerät schon abgeschlossen: Leerlaufwerte nicht als Messwerte des Funktionstests übernehmen
        ft = { ...r.values };
        for (const [k, held] of Object.entries(FT_HELD)) ft[k] = r.values[held] && { ...r.values[held], fromMax: true };
        for (const k of ['S', 'PF', 'DI_LIVE']) delete ft[k];
      }
      for (const k of Object.keys(ft)) if (ft[k]?.value == null) delete ft[k];
    } catch {
      /* Funktionstest nicht durchgeführt */
    }
    return { protocol: pro, functionTest: ft, identity: this.driver.identity };
  }
}

const manager = new SecutestManager();
module.exports = { manager, SecutestManager };
