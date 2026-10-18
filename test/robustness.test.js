'use strict';
// 1.3.1: Gerätesuche, Warteschlange, mehrere Tabs und hängende Instanzen
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secutest-rob-'));
process.env.SECUTEST_HOME = path.join(dir, 'home');
const { PortWatcher, pingPort } = require('../src/secutest/scanner');
const { SecutestDriver } = require('../src/secutest/driver');
const { SecutestManager } = require('../src/secutest/manager');

test.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FTDI = { path: '/dev/cu.usbserial-TEST', score: 15 };

test('Gerätesuche pingt vorhandene Adapter erneut an, solange keine Verbindung besteht', async () => {
  const pings = [];
  let probe = true;
  const w = new PortWatcher({ probeEveryMs: 0, shouldProbe: () => probe, list: async () => ({ candidates: [FTDI, { path: '/dev/cu.usbmodem-MONITOR', score: -15 }] }), ping: async (p) => (pings.push(p), { ok: pings.length >= 2, identity: {} }) });
  const found = [];
  w.on('found', (r) => found.push(r.path));
  await w.tick(); // erster Durchlauf: Bestand merken
  await w.tick(); // SECUTEST noch aus
  await w.tick(); // jetzt eingeschaltet
  assert.deepEqual(pings, [FTDI.path, FTDI.path], 'nur USB-Seriell-Adapter, kein Monitor-Anschluss');
  assert.deepEqual(found, [FTDI.path]);
  probe = false; // verbunden bzw. vom Benutzer getrennt
  await w.tick();
  assert.equal(pings.length, 2);
});

test('Gerätesuche bleibt nicht hängen, wenn das Auflisten der Ports nicht zurückkommt', async () => {
  let calls = 0;
  const w = new PortWatcher({ listTimeoutMs: 200, list: () => (++calls === 1 ? new Promise(() => {}) : Promise.resolve({ candidates: [] })) });
  const t0 = Date.now();
  await w.tick();
  assert.ok(Date.now() - t0 >= 180, 'wartet höchstens die Sicherheitszeit');
  assert.equal(w.busy, false);
  await w.tick();
  assert.equal(calls, 2);
});

test('Manuell getrennt: nicht sofort wieder automatisch verbinden', async () => {
  const mgr = new SecutestManager();
  await mgr.connect({ simulator: true });
  mgr.startWatcher();
  const probe = mgr.watcher.shouldProbe;
  await mgr.disconnect();
  assert.equal(probe(), false);
  mgr.watcher.emit('added', FTDI); // Adapter neu eingesteckt
  assert.equal(mgr.manualDisconnect, false);
  mgr.stopWatcher();
});

test('Gerätesuche erkennt den SECUTEST auch, wenn er zuerst „beschäftigt“ (.Ex) meldet', async () => {
  // echte Bytes: .Ex, danach steht der Prompt „>“ vor der IDN-Antwort
  const replies = ['\x13.Ex$0F\r\n>\x11', '\x13IDNx=x;GMN;SecuTest S;GTM5015000R0001;18. Juli 1994  16:49:31;\xff\xff\xff\xff\xff\xff\xff\xff;00$EF\r\n>\x11'];
  class FakeSerial extends EventEmitter {
    constructor() {
      super();
      this.isOpen = false;
    }

    open(cb) {
      this.isOpen = true;
      cb();
    }

    write() {
      const r = replies.shift();
      // wie am echten Adapter in Stücken: erst ein halbe Zeile, dann der Rest
      if (r) for (const [i, part] of [r.slice(0, 16), r.slice(16)].entries()) setTimeout(() => this.emit('data', Buffer.from(part, 'latin1')), 5 + i * 20);
    }

    close(cb) {
      this.isOpen = false;
      cb();
    }
  }
  const t0 = Date.now();
  const r = await pingPort('/dev/cu.usbserial-TEST', { SerialPort: FakeSerial });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.identity.model, 'SecuTest S');
  assert.ok(Date.now() - t0 < 1500, 'ohne den vollen Timeout abzuwarten');
});

/** Port, der nur zählt und nie antwortet */
class SilentPort extends EventEmitter {
  constructor() {
    super();
    this.isOpen = true;
    this.writes = [];
  }

  write(buf, cb) {
    this.writes.push(buf.toString('latin1'));
    if (cb) cb();
  }

  close(cb) {
    this.emit('close');
    if (cb) cb();
  }
}

test('Gleiche Abfragen in der Warteschlange werden zusammengelegt (kein Aufstauen beim Abfragen)', async () => {
  const d = new SecutestDriver({ timeoutMs: 80, settleMs: 1 });
  d.port = new SilentPort();
  d.connected = true;
  const all = [d.getStatus(), d.getStatus(), d.getStatus(), d.getValues([28, 29, 30]), d.getValues([28, 29, 30]), d.getStatus()];
  assert.equal(d.queue.length, 2, 'eine wartende MES? und eine WER?');
  await Promise.allSettled(all);
  assert.equal(d.port.writes.filter((w) => w.startsWith('MES?')).length, 2, 'die erste läuft schon, alle weiteren teilen sich eine');
});

test('Antwortet das Gerät nicht mehr, meldet der Treiber das und schaltet das Echo erneut ab', async () => {
  const d = new SecutestDriver({ timeoutMs: 30, settleMs: 1 });
  d.port = new SilentPort();
  d.connected = true;
  const states = [];
  d.on('state', (s) => states.push(s.responding));
  await assert.rejects(d.getStatus(), (e) => e.code === 'TIMEOUT');
  assert.equal(d.responding, true, 'eine Zeitüberschreitung allein ist noch kein Ausfall');
  await assert.rejects(d.getStatus(), (e) => e.code === 'TIMEOUT');
  assert.equal(d.responding, false);
  assert.ok(d.port.writes.includes('\x06'), '^F (Echo aus) erneut gesendet');
  assert.deepEqual(states, [false]);
});

test('Ein neuer Browser-Tab pausiert die älteren (Verbindungsgrenze des Browsers)', () => {
  const mgr = new SecutestManager();
  const res = () => Object.assign(new EventEmitter(), { out: '', ended: false, writeHead() {}, write(s) { this.out += s; }, end() { this.ended = true; } });
  const a = res();
  const b = res();
  mgr.subscribe(a);
  mgr.subscribe(b);
  assert.match(a.out, /event: superseded/);
  assert.equal(a.ended, true);
  assert.equal(b.ended, false);
  assert.deepEqual([...mgr.clients], [b]);
  a.emit('close');
  b.emit('close');
});

test('Tab mit veraltetem Programmcode (vor Neustart/Update) wird abgewiesen', async () => {
  const { createApp } = require('../src/server');
  const { app } = createApp({ secutest: new SecutestManager() });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const { boot } = await fetch(`${base}/status`).then((r) => r.json());
    assert.match(boot, /^[0-9a-f]{12}$/);
    // Programm-Abfrage des Browsers ohne bzw. mit alter Kennung
    for (const h of [{}, { 'X-UI-Boot': 'abcdef123456' }]) {
      const r = await fetch(`${base}/meta`, { headers: { 'Sec-Fetch-Site': 'same-origin', ...h } });
      assert.equal(r.status, 409);
      assert.equal((await r.json()).code, 'RELOAD');
    }
    // Ereignis-Kanal alter Tabs (EventSource kann keine Header setzen)
    assert.equal((await fetch(`${base}/secutest/events`, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 409);
    // Links (Prüfprotokoll, Plaketten, Downloads) und Bilder sind keine Programm-Abfragen und bleiben erlaubt
    // (Node-fetch erzwingt Sec-Fetch-Mode: cors – daher hier http.get mit genau den Headern eines Browsers)
    const statusOf = (headers) => new Promise((resolve, reject) => require('http').get(`${base}/meta`, { headers }, (res) => (res.resume(), resolve(res.statusCode))).on('error', reject));
    for (const mode of ['navigate', 'no-cors']) assert.notEqual(await statusOf({ 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': mode }), 409, mode);
    assert.equal(await statusOf({ 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' }), 409);
    // aktuelle Kennung: weiter zur Anmeldeprüfung
    assert.notEqual((await fetch(`${base}/meta`, { headers: { 'Sec-Fetch-Site': 'same-origin', 'X-UI-Boot': boot } })).status, 409);
    assert.notEqual((await fetch(`${base}/meta`)).status, 409, 'Skripte/Tests ohne Browser-Header sind nicht betroffen');
  } finally {
    server.close();
  }
});

test('Neustart beendet eine hängende alte Instanz und startet selbst', { skip: process.platform === 'win32' && 'SIGSTOP gibt es unter Windows nicht', timeout: 40000 }, async () => {
  const port = String(38000 + Math.floor(Math.random() * 1000));
  const env = { ...process.env, SECUTEST_HOME: path.join(dir, 'instanz'), CI: '1' };
  const start = () => {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js'), '--no-open', '--simulator', '--port', port], { env });
    p.output = '';
    p.stdout.on('data', (b) => (p.output += b));
    p.stderr.on('data', (b) => (p.output += b));
    return p;
  };
  const waitFor = async (p, re) => {
    for (let i = 0; i < 300 && !re.test(p.output); i++) await sleep(100);
    assert.match(p.output, re);
  };
  const a = start();
  await waitFor(a, /Oberfläche/);
  process.kill(a.pid, 'SIGSTOP'); // hängt: antwortet nicht mehr
  const b = start();
  try {
    await waitFor(b, /Oberfläche/);
    assert.match(b.output, new RegExp(`Vorherige Instanz \\(PID ${a.pid}\\) reagiert nicht`));
    const status = await fetch(`http://127.0.0.1:${port}/api/status`).then((r) => r.json());
    assert.ok(status.version);
  } finally {
    for (const p of [a, b]) {
      try {
        process.kill(p.pid, 'SIGKILL');
      } catch {
        /* schon beendet */
      }
    }
  }
});
