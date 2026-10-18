'use strict';
/**
 * Treiber für die RS-232-Schnittstelle des SECUTEST 0701/0702S.
 *  - Befehlswarteschlange (immer nur ein Befehl unterwegs)
 *  - Prüfsumme, Quittungen (Y/N), Timeouts
 *  - Ereignisse: 'log' {dir, text, ts}, 'state', 'line'
 *
 * Verbindung: 9-polige D-SUB-Buchse (10). Am PC ein USB-RS232-Adapter (z. B. FTDI/Prolific)
 * mit 1:1-Kabel bzw. – je nach Adapter – Nullmodemkabel.
 */
const { EventEmitter } = require('events');
const { CTRL, KEYS, SWITCH_POSITIONS, buildCommand, cleanLine, parseLine, parseWer, parseMes, parseIdn, parsePro } = require('./protocol');
const { SimulatedSecutest } = require('./simulator');

let SerialPortCtor = null;
let serialLoadError = null;
function loadSerialPort() {
  if (SerialPortCtor || serialLoadError) return SerialPortCtor;
  try {
    SerialPortCtor = require('serialport').SerialPort;
  } catch (e) {
    serialLoadError = e;
  }
  return SerialPortCtor;
}

async function listPorts() {
  const SP = loadSerialPort();
  if (!SP) return { ports: [], error: `Modul „serialport“ nicht verfügbar: ${serialLoadError?.message}` };
  try {
    const ports = await SP.list();
    return {
      ports: ports.map((p) => ({ path: p.path, manufacturer: p.manufacturer || '', serialNumber: p.serialNumber || '', vendorId: p.vendorId || '', productId: p.productId || '', friendly: p.friendlyName || '' })),
      error: null,
    };
  } catch (e) {
    return { ports: [], error: e.message };
  }
}

/** Abfragen werden bei verfälschter Antwort so oft wiederholt */
const MAX_RETRIES = 2;

class SecutestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class SecutestDriver extends EventEmitter {
  constructor(options = {}) {
    super();
    this.opts = {
      address: null,
      withChecksum: true,
      timeoutMs: 2500,
      // Mindestabstand zwischen zwei Befehlen: Die Firmware verkraftet nur wenige Abfragen pro Sekunde
      // (bei etwa 5/s bricht der SECUTEST S die Messung ab bzw. startet neu – am Gerät gemessen)
      settleMs: 250,
      switchPositions: { ...SWITCH_POSITIONS },
      ...options,
    };
    this.port = null;
    this.connected = false;
    this.simulator = null;
    this.portPath = null;
    this.rxBuffer = '';
    this.queue = [];
    this.pending = null;
    this.identity = null;
    this.logBuffer = [];
    this.timeoutsInRow = 0;
    this.responding = true;
  }

  // -------------------------------------------------------------------------
  // Verbindung
  // -------------------------------------------------------------------------
  async connect({ path, simulator = false, scenario, simulatorOptions = {} } = {}) {
    if (this.connected) await this.disconnect();
    if (simulator) {
      this.simulator = new SimulatedSecutest({ scenario, ...simulatorOptions });
      this.port = this.simulator;
      this.portPath = 'SIMULATOR';
    } else {
      const SP = loadSerialPort();
      if (!SP) throw new SecutestError('NO_SERIAL', `Serielle Schnittstelle nicht verfügbar: ${serialLoadError?.message}`);
      if (!path) throw new SecutestError('NO_PORT', 'Bitte eine serielle Schnittstelle (z. B. COM3 oder /dev/ttyUSB0) auswählen.');
      const port = new SP({ path, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, xon: true, xoff: true, rtscts: false, autoOpen: false });
      await new Promise((resolve, reject) => port.open((err) => (err ? reject(new SecutestError('OPEN_FAILED', `Schnittstelle ${path} konnte nicht geöffnet werden: ${err.message}`)) : resolve())));
      this.port = port;
      this.portPath = path;
    }
    this.port.on('data', (buf) => this._onData(buf));
    this.port.on('close', () => this._onClose());
    this.port.on('error', (e) => this._log('err', e.message));
    this.connected = true;
    this.timeoutsInRow = 0;
    this.responding = true;
    this._log('info', `Verbunden mit ${this.portPath}`);
    // Echo aus (Rechnersteuerung)
    await this._writeRaw(CTRL.ECHO_OFF);
    await sleep(80);
    try {
      this.identity = await this.identify();
    } catch (e) {
      this._log('warn', `Keine Antwort auf IDN? (${e.message}). Kabel, Schnittstelle und Gerät prüfen.`);
      this.identity = null;
    }
    this.emit('state', this.status());
    return this.status();
  }

  async disconnect() {
    if (!this.port) return;
    const port = this.port;
    this._failAll(new SecutestError('DISCONNECTED', 'Verbindung getrennt'));
    try {
      if (this.remoteActive) await this.setRemote(false).catch(() => {});
    } finally {
      await new Promise((r) => {
        try {
          port.close(() => r());
        } catch {
          r();
        }
      });
      this._onClose();
    }
  }

  _onClose() {
    if (!this.connected && !this.port) return;
    this.connected = false;
    this.port = null;
    this.simulator = null;
    this.remoteActive = false;
    this._failAll(new SecutestError('DISCONNECTED', 'Verbindung getrennt'));
    this._log('info', 'Verbindung getrennt');
    this.emit('state', this.status());
  }

  status() {
    return { connected: this.connected, responding: this.responding, port: this.portPath, simulator: !!this.simulator, scenario: this.simulator?.scenarioName || null, identity: this.identity, remote: !!this.remoteActive, queue: this.queue.length };
  }

  // -------------------------------------------------------------------------
  // Senden / Empfangen
  // -------------------------------------------------------------------------
  _log(dir, text) {
    const entry = { dir, text, ts: new Date().toISOString() };
    this.logBuffer.push(entry);
    if (this.logBuffer.length > 500) this.logBuffer.shift();
    this.emit('log', entry);
  }

  _writeRaw(str) {
    return new Promise((resolve, reject) => {
      if (!this.port) return reject(new SecutestError('NOT_CONNECTED', 'Nicht mit dem SECUTEST verbunden.'));
      this.port.write(Buffer.from(str, 'latin1'), (err) => (err ? reject(err) : resolve()));
    });
  }

  _onData(buf) {
    this.rxBuffer += buf.toString('latin1');
    let idx;
    while ((idx = this.rxBuffer.search(/[\r\n]/)) >= 0) {
      const line = this.rxBuffer.slice(0, idx);
      this.rxBuffer = this.rxBuffer.slice(idx + 1);
      const trimmed = cleanLine(line);
      if (!trimmed) continue;
      this._handleLine(trimmed);
    }
    if (this.rxBuffer.length > 4096) this.rxBuffer = this.rxBuffer.slice(-1024);
  }

  _handleLine(text) {
    const parsed = parseLine(text);
    this._log('rx', text + (parsed.checksumOk === false ? '   ⚠ Prüfsumme abweichend' : ''));
    this.emit('line', parsed);
    // unaufgeforderte Meldung – gehört nie zu einem Befehl
    if (parsed.type === 'event' && parsed.checksumOk !== false) {
      this._log('info', 'SECUTEST meldet: Protokoll fertig (PRF)');
      this.emit('device-event', { type: 'protocol-ready', ts: new Date().toISOString() });
      return;
    }
    const p = this.pending;
    if (!p) return;
    if (p.expect === 'any') return this._resolve(parsed);
    // Verfälschte Antworten nie übernehmen. Die Prüfsumme ist eine reine Zeichensumme und erkennt
    // vertauschte Zeichen (am Gerät beobachtet: „WRETE“, „0A“ statt „A0“) nicht – daher zusätzlich p.validate.
    if (parsed.checksumOk === false) return this._garbled(new SecutestError('CHECKSUM', `Antwort auf „${p.command}“ mit falscher Prüfsumme verworfen.`));
    if (parsed.type === 'unknown') {
      if (text === p.frame.replace(/\r/g, '')) {
        // Echo des eigenen Befehls: Nach einem Neustart hat das Gerät das Echo wieder an – abschalten
        if (Date.now() - (this._echoOffAt || 0) > 2000) {
          this._echoOffAt = Date.now();
          this._log('warn', 'SECUTEST sendet Echo (nach Neustart?) – Echo wieder ausgeschaltet');
          this._writeRaw(CTRL.ECHO_OFF).catch(() => {});
        }
        return;
      }
      return this._garbled(new SecutestError('GARBLED', `Unverständliche Antwort auf „${p.command}“ verworfen.`));
    }
    if (parsed.type === 'error') {
      const err = new SecutestError('DEVICE_ERROR', `SECUTEST meldet Fehler (E) bei „${p.command}“ – Gerät noch beschäftigt oder Befehl in diesem Zustand nicht möglich.`);
      // „.Ex“ kommt am Gerät gelegentlich, solange es misst – Abfragen nach kurzer Pause wiederholen
      return p.command.includes('?') ? this._garbled(err, 300) : this._reject(err);
    }
    if (p.expect === 'answer') {
      if (parsed.type === 'answer') return p.validate && !p.validate(parsed) ? this._garbled(new SecutestError('GARBLED', `Unplausible Antwort auf „${p.command}“ verworfen.`)) : this._resolve(parsed);
      if (parsed.type === 'nak') return this._reject(new SecutestError('NAK', `SECUTEST hat „${p.command}“ nicht ausgeführt (N).`));
      // Y vor der Antwort ignorieren
    } else if (p.expect === 'ack') {
      if (parsed.type === 'ack') return this._resolve(parsed);
      if (parsed.type === 'nak') return this._reject(new SecutestError('NAK', `SECUTEST hat „${p.command}“ nicht ausgeführt (N).`));
      if (parsed.type === 'answer') return this._resolve(parsed);
    }
  }

  /** Verfälschte Antwort oder „beschäftigt“: Abfragen (?) wiederholen; Befehle (!) nicht – TAS!4 würde sonst z. B. doppelt drücken */
  _garbled(err, delayMs = this.opts.settleMs) {
    const p = this.pending;
    if (p.command.includes('?') && (p.retries || 0) < MAX_RETRIES) {
      p.retries = (p.retries || 0) + 1;
      clearTimeout(p.timer);
      this._log('warn', `${err.message} Wiederholung ${p.retries}/${MAX_RETRIES}.`);
      setTimeout(() => this.pending === p && this._transmit(p), delayMs);
      return;
    }
    if (!p.command.includes('?')) err.message += ' Der Befehl wurde möglicherweise trotzdem ausgeführt.';
    this._reject(err);
  }

  _resolve(v) {
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    this._setResponding(true);
    this._lastDoneAt = Date.now();
    p.resolve(v);
    this._next();
  }

  /** Antwortet das Gerät nicht mehr (z. B. aus- und wieder eingeschaltet), Echo erneut abschalten */
  _onTimeout() {
    this.timeoutsInRow += 1;
    if (this.timeoutsInRow >= 2) {
      this._setResponding(false);
      this._writeRaw(CTRL.ECHO_OFF).catch(() => {});
    }
  }

  _setResponding(on) {
    if (on) this.timeoutsInRow = 0;
    if (this.responding === on) return;
    this.responding = on;
    this._log(on ? 'info' : 'warn', on ? 'SECUTEST antwortet wieder' : 'SECUTEST antwortet nicht – eingeschaltet und Kabel gesteckt?');
    this.emit('state', this.status());
  }

  _reject(err) {
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    this._lastDoneAt = Date.now();
    p.reject(err);
    this._next();
  }

  _failAll(err) {
    clearTimeout(this._nextTimer);
    this._nextTimer = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(err);
      this.pending = null;
    }
    while (this.queue.length) this.queue.shift().reject(err);
  }

  /** nächsten Befehl senden – frühestens settleMs nach der letzten Antwort (auch wenn der Aufrufer erst danach sendet) */
  _next() {
    if (this.pending || !this.queue.length || this._nextTimer) return;
    const wait = this.opts.settleMs - (Date.now() - (this._lastDoneAt || 0));
    if (wait > 0) {
      this._nextTimer = setTimeout(() => {
        this._nextTimer = null;
        this._next();
      }, wait);
      return;
    }
    const job = this.queue.shift();
    this.pending = job;
    this._transmit(job);
  }

  _transmit(job) {
    job.frame = buildCommand(job.command, { address: this.opts.address, withChecksum: job.withChecksum ?? this.opts.withChecksum });
    this._log('tx', job.frame.replace(/\r/g, ''));
    job.timer = setTimeout(() => {
      if (this.pending !== job) return;
      this._onTimeout();
      this._reject(new SecutestError('TIMEOUT', `Keine Antwort auf „${job.command}“ (Timeout ${job.timeout} ms).`));
    }, job.timeout);
    this._writeRaw(job.frame).catch((e) => this.pending === job && this._reject(e));
  }

  /**
   * Befehl senden. expect: 'answer' (für ?), 'ack' (für !), 'any'
   * validate(parsed): false -> Antwort gilt als verfälscht, Abfrage wird wiederholt
   */
  send(command, { expect, timeout, withChecksum, validate } = {}) {
    if (!this.connected) return Promise.reject(new SecutestError('NOT_CONNECTED', 'Nicht mit dem SECUTEST verbunden.'));
    const cmd = String(command).trim();
    const exp = expect || (cmd.includes('?') ? 'answer' : 'ack');
    // dieselbe Abfrage wartet schon (mehrere Live-Anzeigen fragen ab): mitbenutzen statt die Warteschlange aufzustauen
    const waiting = exp === 'answer' && this.queue.find((j) => j.command === cmd && j.expect === exp);
    if (waiting) return waiting.promise;
    const job = { command: cmd, expect: exp, timeout: timeout || this.opts.timeoutMs, withChecksum, validate };
    job.promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
    this.queue.push(job);
    this._next();
    return job.promise;
  }

  /** So lange lesen, bis zwei Antworten nacheinander übereinstimmen (gegen vertauschte Zeichen) */
  async _readTwice(read, key, what) {
    let prev = null;
    for (let i = 0; i < 4; i++) {
      const cur = await read();
      if (prev && key(cur) === key(prev)) return cur;
      prev = cur;
    }
    throw new SecutestError('UNSTABLE', `${what} wurde nicht zweimal gleich gelesen – Verbindung prüfen und erneut versuchen.`);
  }

  /** Rohes Terminal: Zeichenkette mit optionaler Prüfsumme senden, erste Antwortzeile zurückgeben */
  async raw(command, { withChecksum = true } = {}) {
    if (/^\^[CDFG]$/i.test(command)) {
      const map = { C: CTRL.ABORT, D: CTRL.ECHO_ON, F: CTRL.ECHO_OFF, G: CTRL.BELL };
      await this._writeRaw(map[command[1].toUpperCase()]);
      this._log('tx', command);
      return null;
    }
    return this.send(command, { expect: 'any', withChecksum });
  }

  // -------------------------------------------------------------------------
  // Komfortfunktionen
  // -------------------------------------------------------------------------
  async identify() {
    const r = await this.send('IDN?', { validate: (a) => a.operation === 'IDN' });
    return parseIdn(r.params);
  }

  async getValues(nums = []) {
    const want = nums.map(Number).join();
    // „.Nx“: mindestens eine Nummer gibt es nicht; sonst müssen genau die angefragten Nummern zurückkommen
    const validate = (a) => a.operation === 'WERTE' && (/^\.?N(\d+|x)?$/.test(a.params) || Object.keys(parseWer(a.params)).map(Number).sort((x, y) => x - y).join() === nums.map(Number).sort((x, y) => x - y).join());
    const r = await this.send(`WER?${want}`, { validate });
    return parseWer(r.params);
  }

  /** confirm: zweimal gleich lesen (Anschlusskontrolle) – das Gerät vertauscht gelegentlich die Hex-Ziffern („0A“ statt „A0“) */
  async getStatus({ confirm = false } = {}) {
    const read = () => this.send('MES?', { validate: (a) => a.operation === 'MES' && /^[0-9A-Fa-f]{2}(;\d+)*;?$/.test(a.params) });
    const r = confirm ? await this._readTwice(read, (a) => a.params, 'Der Anschlussstatus (MES?)') : await read();
    return { ...parseMes(r.params), raw: r.params };
  }

  /** Startet Messung (Remote-Modus). Liefert true bei Y, false bei N (z. B. Kontrollmessungen 1–4). */
  async startMeasurement(n) {
    try {
      // Kontrollmessung MES!1 (Kurzschluss) quittiert das Gerät erst nach ca. 2,5 s
      await this.send(`MES!${n}`, { timeout: Math.max(this.opts.timeoutMs, 6000) });
      return true;
    } catch (e) {
      if (e.code === 'NAK') return false;
      throw e;
    }
  }

  async pressKey(key) {
    const t = KEYS[key] ?? key;
    await this.send(`TAS!${t}`);
  }

  async setRemote(on) {
    await this.send(`TAS!${on ? KEYS.REMOTE_ON : KEYS.REMOTE_OFF}`);
    this.remoteActive = !!on;
    this.emit('state', this.status());
  }

  async setSwitch(position) {
    const a = typeof position === 'number' ? position : this.opts.switchPositions[position];
    if (!a) throw new SecutestError('BAD_POSITION', `Unbekannte Schalterstellung: ${position}`);
    await this.send(`RST!${a}`, { timeout: 4000 });
    await sleep(600); // Gerät startet neu (ca. 500 ms)
  }

  /** Protokoll (PRO?) – wird ins Prüfprotokoll übernommen, daher zweimal gleich gelesen */
  async readProtocol() {
    const read = () => this.send('PRO?', { timeout: 4000, validate: (a) => a.operation === 'PROTOKOLL' && /^[^;]*;[0-9A-Fa-f]{16}(;|$)/.test(a.params) });
    const r = await this._readTwice(read, (a) => a.raw, 'Das Protokoll (PRO?)');
    return { raw: r.raw, ...parsePro(r.params) };
  }

  async abort() {
    await this._writeRaw(CTRL.ABORT);
    this._log('tx', '^C (Abbruch)');
  }

  setScenario(name) {
    if (!this.simulator) throw new SecutestError('NO_SIMULATOR', 'Nur im Simulator möglich.');
    this.simulator.setScenario(name);
    this.emit('state', this.status());
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { SecutestDriver, SecutestError, listPorts };
