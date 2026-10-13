'use strict';
/**
 * Automatische Suche nach dem SECUTEST an allen seriellen Schnittstellen
 * („Auto-Ping“) – Windows (COMx), macOS (/dev/cu.*) und Linux (/dev/ttyUSB*, /dev/ttyACM*, /dev/ttyS*).
 *
 * Ablauf je Port: öffnen mit 9600 8N1 XON/XOFF → ^F (Echo aus) → IDN? mit Prüfsumme →
 * auf Antwort warten. Antwortet ein Gerät mit IDN…= / GMN / SecuTest, ist es gefunden.
 *
 * Zusätzlich: Hot-Plug-Überwachung – wird ein neuer USB-Seriell-Adapter eingesteckt,
 * wird er automatisch angepingt (und optional verbunden).
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { buildCommand, parseLine, parseIdn, CTRL } = require('./protocol');

// Bekannte USB-Seriell-Chips (Vendor-IDs) → werden zuerst geprüft
const USB_SERIAL_VENDORS = {
  '0403': 'FTDI',
  '067b': 'Prolific PL2303',
  '1a86': 'WCH CH340/CH341',
  '10c4': 'Silicon Labs CP210x',
  '04e2': 'Exar',
  '0557': 'ATEN',
  '2341': 'Arduino (kein SECUTEST)',
};

function loadSerialPort() {
  try {
    return require('serialport').SerialPort;
  } catch {
    return null;
  }
}

/** Fallback, falls SerialPort.list() nicht funktioniert (z. B. Linux ohne udevadm) */
function devFallback() {
  const out = [];
  const add = (p) => out.push({ path: p, manufacturer: '', vendorId: '', productId: '', serialNumber: '' });
  if (process.platform === 'win32') return out;
  let entries = [];
  try {
    entries = fs.readdirSync('/dev');
  } catch {
    return out;
  }
  for (const e of entries) {
    if (process.platform === 'darwin') {
      if (/^cu\.(usbserial|usbmodem|wchusbserial|SLAB_USBtoUART|PL2303|serial)/i.test(e)) add(path.join('/dev', e));
    } else if (/^tty(USB|ACM)\d+$/.test(e)) add(path.join('/dev', e));
  }
  // klassische Onboard-Schnittstellen (Linux) – nur die ersten vier
  if (process.platform === 'linux') for (let i = 0; i < 4; i++) if (entries.includes(`ttyS${i}`)) add(`/dev/ttyS${i}`);
  return out;
}

/** Liefert Kandidaten sortiert nach Wahrscheinlichkeit */
async function listCandidates() {
  const SP = loadSerialPort();
  let ports = [];
  let error = null;
  if (SP) {
    try {
      ports = await SP.list();
    } catch (e) {
      error = e.message;
    }
  } else error = 'Modul „serialport“ nicht verfügbar';
  if (!ports.length) ports = devFallback();
  // macOS: /dev/tty.* blockiert ohne DCD → /dev/cu.* bevorzugen
  if (process.platform === 'darwin') {
    ports = ports.map((p) => ({ ...p, path: p.path.replace(/^\/dev\/tty\./, '/dev/cu.') }));
  }
  const seen = new Set();
  ports = ports.filter((p) => (seen.has(p.path) ? false : seen.add(p.path)));
  const score = (p) => {
    const vid = String(p.vendorId || '').toLowerCase();
    let s = 0;
    if (USB_SERIAL_VENDORS[vid]) s += vid === '2341' ? -5 : 10;
    if (/usb|serial|uart|ftdi|prolific|ch34|cp21/i.test(`${p.path} ${p.manufacturer} ${p.friendlyName || ''}`)) s += 5;
    if (/bluetooth|debug-console|wlan|modem/i.test(`${p.path} ${p.manufacturer} ${p.friendlyName || ''}`)) s -= 20;
    if (/^\/dev\/ttyS\d/.test(p.path)) s -= 3;
    return s;
  };
  const candidates = ports
    .map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
      serialNumber: p.serialNumber || '',
      friendly: p.friendlyName || '',
      chip: USB_SERIAL_VENDORS[String(p.vendorId || '').toLowerCase()] || null,
      score: score(p),
    }))
    .filter((p) => p.score > -20)
    .sort((a, b) => b.score - a.score);
  return { candidates, error };
}

/**
 * Einzelnen Port anpingen. Liefert {ok, identity?, response?, error?}
 * Hinweis: Ein Port, der bereits vom Programm benutzt wird, kann nicht gepingt werden.
 */
function pingPort(portPath, { timeoutMs = 1500, attempts = 2 } = {}) {
  const SP = loadSerialPort();
  if (!SP) return Promise.resolve({ path: portPath, ok: false, error: 'serialport nicht verfügbar' });
  return new Promise((resolve) => {
    let done = false;
    let buffer = '';
    let tries = 0;
    let timer = null;
    const port = new SP({ path: portPath, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, xon: true, xoff: true, autoOpen: false });
    const finish = (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        if (port.isOpen) port.close(() => resolve({ path: portPath, ...res }));
        else resolve({ path: portPath, ...res });
      } catch {
        resolve({ path: portPath, ...res });
      }
    };
    const sendPing = () => {
      tries += 1;
      try {
        port.write(Buffer.from(CTRL.ECHO_OFF + buildCommand('IDN?'), 'latin1'));
      } catch (e) {
        return finish({ ok: false, error: e.message });
      }
      timer = setTimeout(() => (tries < attempts ? sendPing() : finish({ ok: false, error: buffer ? `Unerwartete Antwort: ${buffer.slice(0, 80)}` : 'keine Antwort' })), timeoutMs);
    };
    port.on('data', (b) => {
      buffer += b.toString('latin1');
      for (const line of buffer.split(/[\r\n]+/)) {
        const p = parseLine(line);
        if (p.type === 'answer' && (p.operation === 'IDN' || /GMN|secutest/i.test(p.params))) {
          return finish({ ok: true, identity: parseIdn(p.params), response: p.raw });
        }
      }
    });
    port.on('error', (e) => finish({ ok: false, error: e.message }));
    port.open((err) => {
      if (err) return finish({ ok: false, error: /busy|access|denied|EBUSY|EACCES/i.test(err.message) ? `Port belegt oder keine Berechtigung (${err.message})` : err.message });
      setTimeout(sendPing, 150);
    });
  });
}

/** Alle Kandidaten nacheinander anpingen, beim ersten Treffer aufhören (stopOnFirst) */
async function scan({ stopOnFirst = true, exclude = [], onProgress } = {}) {
  const { candidates, error } = await listCandidates();
  const results = [];
  for (const c of candidates) {
    if (exclude.includes(c.path)) {
      results.push({ ...c, ok: false, skipped: true, error: 'bereits verbunden' });
      continue;
    }
    onProgress?.({ path: c.path, state: 'ping' });
    const r = await pingPort(c.path);
    const entry = { ...c, ...r };
    results.push(entry);
    onProgress?.({ path: c.path, state: r.ok ? 'found' : 'none', error: r.error });
    if (r.ok && stopOnFirst) break;
  }
  return { found: results.find((r) => r.ok) || null, results, listError: error };
}

/**
 * Hot-Plug-Überwachung: prüft alle `intervalMs`, ob neue Ports dazugekommen sind,
 * und pingt diese an. Ereignisse: 'added' {port}, 'removed' {path}, 'found' {result}
 */
class PortWatcher extends EventEmitter {
  constructor({ intervalMs = 3000 } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.known = null;
    this.timer = null;
    this.busy = false;
    this.paused = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy || this.paused) return;
    this.busy = true;
    try {
      const { candidates } = await listCandidates();
      const paths = new Set(candidates.map((c) => c.path));
      if (this.known) {
        for (const c of candidates) {
          if (!this.known.has(c.path)) {
            this.emit('added', c);
            const r = await pingPort(c.path);
            if (r.ok) this.emit('found', { ...c, ...r });
          }
        }
        for (const p of this.known) if (!paths.has(p)) this.emit('removed', { path: p });
      }
      this.known = paths;
    } catch {
      /* nächster Versuch */
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { listCandidates, pingPort, scan, PortWatcher, USB_SERIAL_VENDORS };
