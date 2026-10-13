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
const { CTRL, KEYS, SWITCH_POSITIONS, buildCommand, parseLine, parseWer, parseMes, parseIdn, parsePro } = require('./protocol');
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
      settleMs: 60,
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
    return { connected: this.connected, port: this.portPath, simulator: !!this.simulator, scenario: this.simulator?.scenarioName || null, identity: this.identity, remote: !!this.remoteActive, queue: this.queue.length };
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
      const trimmed = line.replace(/[\x11\x13\x00]/g, '').trim();
      if (!trimmed) continue;
      this._handleLine(trimmed);
    }
    if (this.rxBuffer.length > 4096) this.rxBuffer = this.rxBuffer.slice(-1024);
  }

  _handleLine(text) {
    const parsed = parseLine(text);
    this._log('rx', text + (parsed.checksumOk === false ? '   ⚠ Prüfsumme abweichend' : ''));
    this.emit('line', parsed);
    const p = this.pending;
    if (!p) return;
    if (p.expect === 'answer') {
      if (parsed.type === 'answer') return this._resolve(parsed);
      if (parsed.type === 'nak') return this._reject(new SecutestError('NAK', `SECUTEST hat „${p.command}“ nicht ausgeführt (N).`));
      // Y vor der Antwort ignorieren
    } else if (p.expect === 'ack') {
      if (parsed.type === 'ack') return this._resolve(parsed);
      if (parsed.type === 'nak') return this._reject(new SecutestError('NAK', `SECUTEST hat „${p.command}“ nicht ausgeführt (N).`));
      if (parsed.type === 'answer') return this._resolve(parsed);
    } else if (p.expect === 'any') {
      return this._resolve(parsed);
    }
  }

  _resolve(v) {
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    p.resolve(v);
    setTimeout(() => this._next(), this.opts.settleMs);
  }

  _reject(err) {
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    p.reject(err);
    setTimeout(() => this._next(), this.opts.settleMs);
  }

  _failAll(err) {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(err);
      this.pending = null;
    }
    while (this.queue.length) this.queue.shift().reject(err);
  }

  _next() {
    if (this.pending || !this.queue.length) return;
    const job = this.queue.shift();
    this.pending = job;
    const frame = buildCommand(job.command, { address: this.opts.address, withChecksum: job.withChecksum ?? this.opts.withChecksum });
    this._log('tx', frame.replace(/\r/g, ''));
    job.timer = setTimeout(() => {
      if (this.pending === job) this._reject(new SecutestError('TIMEOUT', `Keine Antwort auf „${job.command}“ (Timeout ${job.timeout} ms).`));
    }, job.timeout);
    this._writeRaw(frame).catch((e) => this.pending === job && this._reject(e));
  }

  /**
   * Befehl senden. expect: 'answer' (für ?), 'ack' (für !), 'any'
   */
  send(command, { expect, timeout, withChecksum } = {}) {
    if (!this.connected) return Promise.reject(new SecutestError('NOT_CONNECTED', 'Nicht mit dem SECUTEST verbunden.'));
    const cmd = String(command).trim();
    const exp = expect || (cmd.includes('?') ? 'answer' : 'ack');
    return new Promise((resolve, reject) => {
      this.queue.push({ command: cmd, expect: exp, timeout: timeout || this.opts.timeoutMs, withChecksum, resolve, reject });
      this._next();
    });
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
    const r = await this.send('IDN?');
    return parseIdn(r.params);
  }

  async getValues(nums = []) {
    const r = await this.send(`WER?${nums.join(',')}`);
    return parseWer(r.params);
  }

  async getStatus() {
    const r = await this.send('MES?');
    return parseMes(r.params);
  }

  /** Startet Messung (Remote-Modus). Liefert true bei Y, false bei N (z. B. Kontrollmessungen 1–4). */
  async startMeasurement(n) {
    try {
      await this.send(`MES!${n}`);
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

  async readProtocol() {
    const r = await this.send('PRO?', { timeout: 4000 });
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
