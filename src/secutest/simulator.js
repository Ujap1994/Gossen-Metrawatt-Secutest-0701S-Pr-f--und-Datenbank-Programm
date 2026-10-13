'use strict';
/**
 * Simuliertes SECUTEST 0701/0702S – spricht dasselbe Protokoll wie das echte Gerät.
 * Damit lässt sich das Programm komplett ohne Prüfgerät ausprobieren (npm run simulator).
 *
 * Unterstützt: IDN? MES? MES!m WER?… TAS!t RST!a PRO? sowie ^C/^D/^F.
 * Gerätegeführter Ablauf: Nach RST!/Schalterstellung und TAS!4 (↵) läuft die
 * Prüfsequenz wie am echten Gerät automatisch durch (RSL → RISO → IEA …).
 */
const { EventEmitter } = require('events');
const { checksum, parseLine, CTRL } = require('./protocol');

const SCENARIOS = {
  'sk1-ok': { label: 'SK I – in Ordnung (z. B. Wasserkocher)', sk: 'SK I', RSL: 0.084, RISO: 310, IEA: 0.42, ISONDE: 0.004, DI: 0.11, P: 1980, I: 8.62, U: 230.4, PF: 0.99 },
  'sk1-rsl': { label: 'SK I – Schutzleiter fehlerhaft (R_SL zu hoch)', sk: 'SK I', RSL: 0.71, RISO: 120, IEA: 0.38, ISONDE: 0.004, DI: 0.12, P: 1980, I: 8.6, U: 230.1, PF: 0.99 },
  'sk1-riso': { label: 'SK I – Isolationsfehler (R_ISO zu klein)', sk: 'SK I', RSL: 0.091, RISO: 0.38, IEA: 1.9, ISONDE: 0.01, DI: 1.4, P: 1950, I: 8.5, U: 230.0, PF: 0.98 },
  'sk1-iea': { label: 'SK I – Ableitstrom zu hoch (3,5 mA überschritten, 7 mA alt nicht)', sk: 'SK I', RSL: 0.11, RISO: 4.2, IEA: 4.6, ISONDE: 0.01, DI: 4.1, P: 2400, I: 10.5, U: 229.6, PF: 0.99 },
  'sk2-ok': { label: 'SK II – in Ordnung (z. B. Bohrmaschine)', sk: 'SK II', RISO: 180, IEA: 0.03, ISONDE: 0.003, DI: 0.02, P: 640, I: 3.1, U: 230.6, PF: 0.9 },
  'sk2-riso': { label: 'SK II – Isolationsfehler', sk: 'SK II', RISO: 1.2, IEA: 0.72, ISONDE: 0.2, DI: 0.6, P: 640, I: 3.2, U: 230.2, PF: 0.9 },
  'it-ok': { label: 'EDV SK I – Monitor/PC in Ordnung', sk: 'SK I', it: true, RSL: 0.095, RISO: 50, IEA: 0.6, ISONDE: 0.008, DI: 0.5, P: 38, I: 0.27, U: 230.3, PF: 0.61 },
  'sk3-ok': { label: 'SK III – in Ordnung (Schutzkleinspannung)', sk: 'SK III', RISO: 45, UAC: 12.2, UDC: 0.1, ISONDE: 0.001, DI: 0, P: 0, I: 0, U: 230, PF: 0 },
};

const DEFAULT_SCENARIO = 'sk1-ok';

function jitter(v, pct = 0.04) {
  if (!v) return v;
  return v * (1 + (Math.random() * 2 - 1) * pct);
}

function fmtVal(v, digits, maxRange) {
  if (v == null) return '---.-';
  if (maxRange != null && v > maxRange) return '>' + maxRange.toFixed(digits);
  return v.toFixed(digits);
}

const SWITCH_NAMES = { 1: 'FUNCTION-TEST', 2: 'MENUE', 3: 'OFF', 4: 'AUTO', 5: 'SK I', 6: 'SK II', 7: 'SK III', 8: 'T 240' };

class SimulatedSecutest extends EventEmitter {
  constructor({ scenario = DEFAULT_SCENARIO, latencyMs = 25, stepMs = null } = {}) {
    super();
    this.latency = latencyMs;
    this.stepMs = stepMs; // nur für Tests: Dauer je Messschritt im gerätegeführten Ablauf
    this.buffer = '';
    this.echo = true;
    this.remote = false;
    this.address = null;
    this.switchPos = 'AUTO';
    this.values = {};
    this.running = [];
    this.timers = [];
    this.sequence = null; // gerätegeführter Ablauf
    this.lastProtocol = null;
    this.mainsOn = false;
    this.isOpen = true;
    this.setScenario(scenario);
  }

  setScenario(name) {
    this.scenarioName = SCENARIOS[name] ? name : DEFAULT_SCENARIO;
    this.s = SCENARIOS[this.scenarioName];
    this.values = {};
    this.lastProtocol = null;
  }

  // --------- Transport-API (wie serialport) ---------
  write(data, cb) {
    const str = Buffer.isBuffer(data) ? data.toString('latin1') : String(data);
    for (const ch of str) this._rx(ch);
    if (cb) cb();
    return true;
  }

  drain(cb) {
    if (cb) cb();
  }

  close(cb) {
    this.isOpen = false;
    this._clearTimers();
    this.emit('close');
    if (cb) cb();
  }

  _send(body) {
    const msg = body + '$';
    const line = msg + checksum(msg) + '\r\n';
    const t = setTimeout(() => this.isOpen && this.emit('data', Buffer.from(line, 'latin1')), this.latency);
    this.timers.push(t);
  }

  _ack(ok = true) {
    this._send((ok ? 'Y' : 'N') + (this.address ?? ''));
  }

  _clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  _rx(ch) {
    if (ch === CTRL.ABORT) {
      this._abort();
      return;
    }
    if (ch === CTRL.ECHO_ON) {
      this.echo = true;
      return;
    }
    if (ch === CTRL.ECHO_OFF) {
      this.echo = false;
      return;
    }
    if (ch === CTRL.XON || ch === CTRL.XOFF || ch === CTRL.BELL || ch === '\n') return;
    if (this.echo) this.emit('data', Buffer.from(ch, 'latin1'));
    if (ch === '\r') {
      const line = this.buffer;
      this.buffer = '';
      if (line.trim()) this._handle(line);
      return;
    }
    this.buffer += ch;
  }

  _abort() {
    this.running = [];
    this.sequence = null;
    this.mainsOn = false;
  }

  // --------- Messwerte erzeugen ---------
  _gen(n) {
    const s = this.s;
    const v = this.values;
    const set = (k, val) => {
      v[k] = val;
    };
    if (n >= 8 && n <= 15) {
      if (s.sk !== 'SK I') {
        set(12, null);
        set(13, null);
        set(14, null);
        set(15, null);
        return;
      }
      const a = jitter(s.RSL, 0.03);
      const b = jitter(s.RSL, 0.05);
      set(12, Math.min(a, b));
      set(13, Math.max(a, b));
      set(14, Math.abs(a - b));
      set(15, Math.max(a, b) * 1.05 + 0.01);
    } else if ((n >= 16 && n <= 21) || (n >= 96 && n <= 98)) {
      const r = s.RISO >= 310 ? 311 : jitter(s.RISO, 0.02);
      set(19, r);
      set(20, r * 1.01);
      set(21, r >= 310 ? 311 : r * 0.95);
      const u = jitter(537, 0.005);
      set(96, u);
      set(97, u - 1);
      set(98, u + 1);
    } else if (n >= 24 && n <= 30) {
      const i = jitter(s.IEA, 0.03);
      set(28, i * 0.98);
      set(29, i * 1.02);
      set(30, i * 1.05 + 0.01);
    } else if (n >= 32 && n <= 38) {
      const i = jitter(s.ISONDE, 0.1);
      set(32, i);
      set(33, 0);
      set(34, i);
      set(35, i * 0.9);
      set(36, i * 1.1);
      set(37, 0);
      set(38, 0);
    } else if (n >= 72 && n <= 78) {
      set(72, s.UAC != null ? jitter(s.UAC, 0.01) : 0);
      set(73, s.UDC != null ? s.UDC : 0);
      set(74, s.UAC != null ? s.UAC : 0);
    } else if ((n >= 48 && n <= 67) || n === 'FT') {
      if (!this.mainsOn) return;
      const p = jitter(s.P, 0.02);
      const i = jitter(s.I, 0.02);
      const u = jitter(s.U, 0.002);
      set(52, p);
      set(48, p);
      set(51, p * 1.03);
      set(56, i);
      set(61, i * 1.04);
      set(57, u * i);
      set(49, s.PF);
      set(58, u);
      set(59, 50.0);
      this._energy = (this._energy || 0) + p / 3600;
      set(55, this._energy);
      const di = jitter(s.DI, 0.05);
      set(64, di);
      set(66, di * 1.1);
      set(67, di * 1.12 + 0.01);
    }
  }

  _format(n) {
    const v = this.values[n];
    if (v === undefined || v === null) return '---.-';
    if (n >= 12 && n <= 15) return fmtVal(v, 3, 31);
    if (n >= 19 && n <= 21) return v >= 310 ? '>310.0' : fmtVal(v, v < 1.5 ? 3 : v < 11 ? 2 : 1);
    if (n >= 96 && n <= 98) return fmtVal(v, 0);
    if (n >= 28 && n <= 30) return fmtVal(v, 2);
    if (n >= 32 && n <= 38) return fmtVal(v, 3);
    if ([49].includes(n)) return fmtVal(v, 2);
    if ([48, 51, 52, 57].includes(n)) return fmtVal(v, 0);
    if ([56, 61].includes(n)) return fmtVal(v, 2);
    if ([58, 59, 72, 73, 74].includes(n)) return fmtVal(v, 1);
    if (n === 55) return fmtVal(v, 2);
    if (n >= 64 && n <= 67) return fmtVal(v, 2);
    return fmtVal(v, 2);
  }

  _startMeasurement(n) {
    if (n === 0) {
      this.values = {};
      this.running = [];
      return true;
    }
    if (n === 1) return this.s.short !== true; // Kurzschlusskontrolle
    if (n === 2) return true; // Sonde angeschlossen
    if (n === 3) return true; // Prüfling eingeschaltet
    if (n === 4) return this.s.sk === 'SK I'; // Schutzleiter vorhanden
    if (n === 56 || n === 58 || n === 63) {
      this.mainsOn = true;
      this._energy = 0;
      this.running = [56, 64];
      this._gen('FT');
      return true;
    }
    if (n === 64) {
      this.mainsOn = false;
      this.running = [];
      return true;
    }
    const groupStart = { 8: [8, 12, 13, 14, 15], 9: [9], 10: [10, 12, 13, 14, 15], 11: [11], 16: [16, 96], 17: [17, 96], 18: [18, 96], 24: [24], 25: [25], 26: [26], 27: [27], 32: [32], 72: [72], 73: [73], 80: [80], 82: [82] };
    this.running = groupStart[n] ? [n] : [n];
    this._gen(n);
    return true;
  }

  // --------- Gerätegeführter Ablauf (Simulation der eingebauten Bedienerführung) ---------
  _sequenceSteps() {
    const sk = this.s.sk;
    switch (this.switchPos) {
      case 'AUTO':
      case 'SK I':
      case 'SK II':
        if (sk === 'SK III') return [];
        return [...(sk === 'SK I' && this.switchPos !== 'SK II' ? [{ m: 8, g: [8, 12, 13, 14, 15] }] : []), { m: 16, g: [16, 19, 20, 21, 96] }, { m: sk === 'SK I' ? 26 : 24, g: [28, 29, 30] }];
      case 'T 240':
        return [...(sk === 'SK I' ? [{ m: 8, g: [8, 12, 13, 14, 15] }] : []), { m: 32, g: [32, 33, 34, 36] }];
      case 'SK III':
        return [{ m: 16, g: [16, 19, 20, 21, 96] }, { m: 72, g: [72, 73] }];
      default:
        return [];
    }
  }

  _enterPressed() {
    if (this.remote) return;
    if (this.sequence && this.sequence.done) {
      this.sequence = null; // „neue Prüfung“
      return;
    }
    if (this.sequence) return;
    const steps = this._sequenceSteps();
    if (!steps.length) return;
    this.values = {};
    this.sequence = { steps, idx: 0, done: false };
    this._runSequenceStep();
  }

  _runSequenceStep() {
    const seq = this.sequence;
    if (!seq) return;
    if (seq.idx >= seq.steps.length) {
      seq.done = true;
      this.running = [];
      this.lastProtocol = this._buildProtocol();
      return;
    }
    const st = seq.steps[seq.idx];
    this.running = [st.m];
    this._gen(st.m);
    const dur = this.stepMs ?? (st.m === 8 ? 4000 : 2500);
    const t = setTimeout(() => {
      seq.idx += 1;
      this._runSequenceStep();
    }, dur);
    this.timers.push(t);
  }

  _buildProtocol() {
    const s = this.s;
    let BB = 0;
    let CC = 0;
    let DD = 0;
    let EE = 0;
    const vals = [];
    const v = this.values;
    const f3 = (x) => (x >= 310 ? '>310.0' : x.toFixed(x < 1.5 ? 3 : 2));
    if (v[15] != null) {
      BB |= 1;
      vals.push(v[15].toFixed(3), '<0.300');
      if (v[15] > 0.3) EE |= 1;
    }
    if (v[21] != null) {
      BB |= 2;
      const lim = s.sk === 'SK II' ? 2 : s.sk === 'SK III' ? 0.25 : 0.5;
      vals.push(f3(v[21]), '>' + lim.toFixed(3), String(Math.round(v[96] || 537)).padStart(4, '0'), '>0500');
      if (v[21] < lim) EE |= 2;
    }
    if (v[30] != null) {
      BB |= 4;
      const lim = s.sk === 'SK I' ? 7 : 0.5;
      vals.push(v[30].toFixed(2).padStart(5, '0'), '<' + lim.toFixed(3));
      if (v[30] > lim) EE |= 4;
    }
    if (v[34] != null) {
      BB |= 8;
      vals.push(v[34].toFixed(3), '<0.250');
      if (v[34] > 0.25) EE |= 8;
    }
    if (v[72] != null) {
      BB |= 16;
      vals.push(v[72].toFixed(1), '<50.0', (v[73] || 0).toFixed(1), '<120.0');
    }
    if (s.sk === 'SK I') CC |= 1;
    if (s.sk === 'SK III') CC |= 2;
    if (s.it || this.switchPos === 'T 240') CC |= 16;
    if (EE) EE |= 0x80;
    const hx = (n) => n.toString(16).toUpperCase().padStart(2, '0');
    return `SIM-0001;${hx(BB)}${hx(CC)}${hx(DD)}${hx(EE)}000100${'00'};${vals.join(';')}`;
  }

  // --------- Befehlsinterpreter ---------
  _handle(line) {
    const p = parseLine(line);
    const body = p.body.trim();
    const m = body.match(/^([A-Za-z]{3})[A-Za-z]*?(\d*)([?!])(.*)$/);
    if (!m) {
      this._ack(false);
      return;
    }
    const op = m[1].toUpperCase();
    const addr = m[2] || null;
    const operator = m[3];
    const params = m[4];
    if (this.address != null && addr != null && addr !== String(this.address)) return; // anderes Gerät
    const A = this.address ?? '';

    if (op === 'IDN' && operator === '?') {
      const d = new Date();
      const mon = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][d.getMonth()];
      this._send(`IDN${A}=${A || 0};GMN;SecuTest S;SIMULATOR-0701S;${d.getDate()}. ${mon} ${d.getFullYear()} 120000;SIM-0001;00`);
      return;
    }
    if (op === 'IDN' && operator === '!') {
      const n = parseInt(params, 10);
      if (Number.isFinite(n) && n >= 0 && n <= 90) {
        this.address = n;
        this._ack(true);
      } else this._ack(false);
      return;
    }
    if (op === 'MES' && operator === '?') {
      let aa = 0;
      if (this.s.sk !== 'SK III' || this.switchPos !== 'SK III') aa |= 1 << 5;
      if (this.s.sk === 'SK I') aa |= 1;
      if (this.s.sk === 'SK III') aa = (1 << 4) | (1 << 3);
      // laufende Messungen aktualisieren (Live-Werte)
      for (const n of this.running) this._gen(n >= 48 && n <= 67 ? 'FT' : n);
      this._send(`MES${A}=${aa.toString(16).toUpperCase().padStart(2, '0')};${this.running.slice(0, 4).join(';')}`);
      return;
    }
    if (op === 'MES' && operator === '!') {
      const mm = params.match(/^(\d+)/);
      if (!mm) {
        // Steuerzeichen S/s/R/r
        this._ack(/^[SsRr]$/.test(params));
        return;
      }
      const ok = this._startMeasurement(parseInt(mm[1], 10));
      this._ack(ok);
      return;
    }
    if (op === 'WER' && operator === '?') {
      for (const n of this.running) this._gen(n >= 48 && n <= 67 ? 'FT' : n);
      const nums = params
        ? params
            .split(/[,;]/)
            .map((x) => parseInt(x, 10))
            .filter(Number.isFinite)
        : Object.keys(this.values).map(Number).sort((a, b) => a - b);
      this._send(`WERTE${A}=${nums.map((n) => `${n},${this._format(n)}`).join(';')}`);
      return;
    }
    if (op === 'TAS' && operator === '!') {
      const t = params.trim();
      if (t === 'R') this.remote = true;
      else if (t === 'r') this.remote = false;
      else if (t === '4') this._enterPressed();
      else if (t === '5') {
        this.mainsOn = !this.mainsOn;
        this.running = this.mainsOn ? [56, 64] : [];
        if (this.mainsOn) {
          this._energy = 0;
          this._gen('FT');
        }
      } else if (!/^[0-3Mm]$/.test(t)) {
        this._ack(false);
        return;
      }
      this._ack(true);
      return;
    }
    if (op === 'TAS' && operator === '?') {
      this._send(`TAS${A}=0`);
      return;
    }
    if (op === 'RST' && operator === '!') {
      const a = parseInt(params, 10);
      this._abort();
      if (SWITCH_NAMES[a]) this.switchPos = SWITCH_NAMES[a];
      this._ack(true);
      return;
    }
    if (op === 'PRO' && operator === '?') {
      if (!this.lastProtocol) {
        if (Object.keys(this.values).length) this.lastProtocol = this._buildProtocol();
        else {
          this._ack(false);
          return;
        }
      }
      this._send(`PROTOKOLL${A}=${this.lastProtocol}`);
      return;
    }
    this._ack(false);
  }
}

module.exports = { SimulatedSecutest, SCENARIOS, DEFAULT_SCENARIO };
