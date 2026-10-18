'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secutest-drv-'));
process.env.SECUTEST_HOME = path.join(dir, 'home');
const { SecutestDriver } = require('../src/secutest/driver');
const { SecutestManager } = require('../src/secutest/manager');
const { parseWer, buildCommand, checksum } = require('../src/secutest/protocol');

test.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

/**
 * Spielt mitgeschnittene Antworten des echten Geräts ab (Befehlstelegramm -> empfangene Bytes).
 * Ein Array wird der Reihe nach abgespielt, der letzte Eintrag wiederholt sich.
 */
class ReplayPort extends EventEmitter {
  constructor(recording) {
    super();
    this.recording = recording;
    this.isOpen = true;
    this.writes = [];
  }

  write(buf, cb) {
    const key = buf.toString('latin1').replace(/\r$/, '');
    this.writes.push(key);
    let reply = this.recording[key];
    if (Array.isArray(reply)) reply = reply.length > 1 ? reply.shift() : reply[0];
    if (reply) setTimeout(() => this.emit('data', Buffer.from(reply, 'latin1')), 2);
    if (cb) cb();
  }

  close(cb) {
    this.isOpen = false;
    this.emit('close');
    if (cb) cb();
  }
}

function attach(driver, recording) {
  driver.port = new ReplayPort(recording);
  driver.port.on('data', (b) => driver._onData(b));
  driver.connected = true;
  return driver.port;
}

// Mitschnitt SECUTEST S am FTDI-Adapter, SK-II-Netzteil an der Prüfdose, Sonde am Metallteil
const frame = (body) => `\x13${body}\r\n>\x11`;
const dev = (body) => frame(`${body}$${checksum(`${body}$`)}`);
const cmd = (c) => buildCommand(c).replace(/\r$/, '');
const FT_READ = 'WER?58,56,52,57,49,55,59,64,66,67,51,61$35';
// Funktionstest: vor Taste 14 (Energiezähler ----.), läuft (0.000 kWh), am Gerät abgeschlossen
const FT_IDLE = frame('WERTEx=58:235.1V;56:00.06A;52:0001.W;57:0014.VA;49:----.;55:----.xJ;59:050.0Hz;64:00.02mA;66:00.02mA;67:00.12mA;51:0001.W;61:00.06A$86');
const FT_ON = frame('WERTEx=58:235.4V;56:00.01A;52:0001.W;57:0002.VA;49:----.;55:0.000xJ;59:050.0Hz;64:00.06mA;66:00.10mA;67:00.21mA;51:0006.W;61:00.06A$95');
const FT_DONE = frame('WERTEx=58:235.7V;56:00.00A;52:0001.W;57:0000.VA;49:----.;55:----.xJ;59:050.0Hz;64:00.02mA;66:00.10mA;67:00.21mA;51:0006.W;61:00.06A$85');
const PRO_SAFETY = frame('Protokollx=\xff\xff\xff\xff\xff\xff\xff\xff;0600210000050000;>310.0;>02.00;0538;>0500;00.21;>0000$62');
const PRO_FINAL = 'Protokollx=\xff\xff\xff\xff\xff\xff\xff\xff;2600210000060000;>310.0;>02.00;0538;>0500;00.21;>0000;00.21;<03.50$FE';
const SK2_RECORDING = {
  'TAS!R$7F': frame('.Yx$23'),
  'MES!1$5B': frame('.Yx$23'),
  'MES!2$5C': frame('.Yx$23'),
  'MES!3$5D': frame('.Yx$23'),
  'MES!4$5E': frame('.Nx$18'),
  'MES?$48': frame('A0;$D0'),
  'MES!16$91': frame('.Yx$23'),
  'WER?19,20,21,96$73': frame('WERTEx=19:>310.0M\xea;20:>310.0M\xea;21:>310.0M\xea;96:0538.V$20'),
  'MES!24$90': frame('.Yx$23'),
  'WER?28,29,30$E1': frame('WERTEx=28:00.08mA;29:00.08mA;30:00.18mA$A9'),
  // Haupt- und Anzeigewert in einer Abfrage (am Gerät geprüft: WER?18,19,20,21,96)
  [cmd('WER?19,20,21,96,18')]: dev('WERTEx=19:>310.0M\xea;20:>310.0M\xea;21:>310.0M\xea;96:0538.V;18:>310.0M\xea'),
  [cmd('WER?28,29,30,24')]: dev('WERTEx=28:00.08mA;29:00.08mA;30:00.18mA;24:00.10mA'),
  'TAS!r$9F': frame('.Yx$23') + '\x03',
  'PRO?$54': frame('.Nx$18'),
};

test('Treiber ↔ Simulator: Identifikation, Remote-Messung, gerätegeführter Ablauf, PRO?', async () => {
  const d = new SecutestDriver({ settleMs: 5 });
  await d.connect({ simulator: true, scenario: 'sk1-ok', simulatorOptions: { latencyMs: 2, stepMs: 60 } });
  assert.equal(d.identity.manufacturer, 'GMN');
  await d.setRemote(true);
  assert.equal(await d.startMeasurement(4), true, 'Schutzleiter erkannt');
  await d.startMeasurement(8);
  const v = await d.getValues([12, 13, 14, 15]);
  assert.ok(v[15].value > 0.05 && v[15].value < 0.2);
  await d.setRemote(false);
  await d.setSwitch('AUTO');
  await d.pressKey('ENTER');
  await new Promise((r) => setTimeout(r, 400));
  const pro = await d.readProtocol();
  assert.equal(pro.classification.protectionClass, 'SK I');
  assert.deepEqual(pro.measurements.map((m) => m.key), ['RSL', 'RISO', 'UISO', 'IEA']);
  assert.equal(pro.verdict, 'bestanden');
  await assert.rejects(d.send('XYZ!1'), (e) => e.code === 'NAK');
  await d.disconnect();
  assert.equal(d.connected, false);
});

test('Simulator: gerätegeführter Ablauf wie am SECUTEST S – jeder Schritt bis ↵, dann Meldung, Funktionstest, Frage', async () => {
  const d = new SecutestDriver({ settleMs: 1 });
  await d.connect({ simulator: true, scenario: 'sk2-ok', simulatorOptions: { latencyMs: 1 } });
  const running = async () => (await d.getStatus()).running;
  await d.setSwitch('SK II');
  await d.pressKey('ENTER'); // Start
  assert.deepEqual(await running(), [16], 'R_ISO läuft, bis ↵');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(await running(), [16]);
  await d.pressKey('ENTER');
  assert.deepEqual(await running(), [24], 'Ableitstrom über die Sonde');
  await d.pressKey('ENTER');
  assert.deepEqual(await running(), [115], 'Meldung „Prüfling ausschalten“');
  await d.pressKey('ENTER');
  assert.deepEqual(await running(), [64, 48, 56], 'Funktionstest bereit');
  await d.pressKey('FUNCTION_TEST'); // Taste 14: Netz an
  assert.ok((await d.getValues([55]))[55].value != null, 'Energiezähler läuft');
  await d.pressKey('FUNCTION_TEST'); // Taste 14: Netz aus → Frage „bestanden?“
  assert.ok((await d.getValues([55]))[55].value != null, 'Werte stehen bis zur Antwort');
  const prf = new Promise((r) => d.once('device-event', r));
  await d.pressKey('ENTER'); // bestanden
  assert.equal((await prf).type, 'protocol-ready');
  const pro = await d.readProtocol();
  assert.deepEqual([pro.performed.RISO, pro.performed.IEA, pro.performed.DI, pro.verdict], [true, true, true, 'bestanden']);
  await d.disconnect();
});

test('Simulator-Szenario mit Isolationsfehler', async () => {
  const d = new SecutestDriver({ settleMs: 5 });
  await d.connect({ simulator: true, scenario: 'sk1-riso', simulatorOptions: { latencyMs: 2 } });
  await d.setRemote(true);
  await d.startMeasurement(16);
  const v = await d.getValues([21, 96]);
  assert.ok(v[21].value < 0.5);
  assert.ok(v[96].value > 500);
  await d.disconnect();
});

test('Prompt ">" des echten Geräts verfälscht die folgende Antwort nicht', () => {
  // Mitschnitt SECUTEST S am FTDI-Adapter: IDN? und MES? direkt hintereinander
  const rx = [
    '\x13IDNx=x;GMN;SecuTest S;GTM5015000R0001;18. Juli 1994  16:49:31;\xff\xff\xff\xff\xff\xff\xff\xff;00$EF\r\n>\x11',
    '\x1380;$C7\r\n>\x11',
  ];
  const d = new SecutestDriver();
  const lines = [];
  d.on('line', (l) => lines.push(l));
  for (const chunk of rx) d._onData(Buffer.from(chunk, 'latin1'));
  assert.deepEqual(lines.map((l) => [l.type, l.checksumOk]), [['answer', true], ['answer', true]]);
  assert.equal(lines[1].params, '80;');
  assert.ok(d.logBuffer.every((e) => !e.text.includes('Prüfsumme abweichend')));
});

test('SK-II-Prüfung mit Mitschnitt des echten Geräts (PC-gesteuert)', async () => {
  const mgr = new SecutestManager();
  const d = mgr.driver;
  attach(d, SK2_RECORDING);
  const pre = await mgr.precheck();
  assert.deepEqual([pre.noShort, pre.probe, pre.switchedOn, pre.protectiveConductor], [true, true, true, false]);
  assert.equal(pre.status.flags.dose, true);
  assert.deepEqual(await mgr.remoteStart('RISO'), { started: true });
  const riso = await mgr.remoteRead('RISO');
  assert.deepEqual([riso.values.RISO.value, riso.values.RISO.qualifier, riso.values.UISO.value], [310, '>', 538]);
  await mgr.remoteStart('IB');
  assert.equal((await mgr.remoteRead('IB')).values.IB.value, 0.18);
  await mgr.remoteEnd();
  // ^C nach TAS!r darf die nächste Antwort nicht verfälschen
  assert.equal((await d.getStatus()).flags.dose, true);
  await assert.rejects(d.readProtocol(), (e) => e.code === 'NAK');
  assert.ok(d.logBuffer.every((e) => !e.text.includes('Prüfsumme abweichend')));
});

test('Geräteeinheiten werden auf die Einheit der Messgröße umgerechnet', () => {
  const mgr = new SecutestManager();
  const riso = mgr.mapValues('RISO', parseWer('21:250k\xea;96:0538.V'));
  assert.deepEqual([riso.RISO.value, riso.RISO.unit, riso.UISO.value], [0.25, 'MΩ', 538]);
  // falsche Größe -> Wert verwerfen statt falsch skaliert übernehmen
  assert.equal(mgr.mapValues('IB', parseWer('30:12.0V')).IB.value, null);
});

test('Verfälschte Antworten werden verworfen und Abfragen sofort wiederholt', async () => {
  const d = new SecutestDriver({ settleMs: 1 });
  const port = attach(d, {
    // falsche Prüfsumme (am Gerät beobachtet), danach korrekt
    'MES?$48': [frame(';0;64;48;56$87'), frame('A0;64;48;56$87')],
    // vertauschte Zeichen mit korrekter Prüfsumme: „WRETE“ und „=x“ (am Gerät beobachtet)
    'WER?28,29,30$E1': [frame('WRETEx=28:00.08mA;29:00.08mA;30:00.18mA$A9'), frame('WERTE=x28:00.08mA;29:00.08mA;30:00.18mA$A9'), frame('WERTEx=28:00.08mA;29:00.08mA;30:00.18mA$A9')],
  });
  const st = await d.getStatus();
  assert.deepEqual([st.flags.dose, st.running], [true, [64, 48, 56]]);
  assert.equal((await d.getValues([28, 29, 30]))[30].value, 0.18);
  assert.equal(port.writes.filter((w) => w === 'MES?$48').length, 2);
  assert.equal(port.writes.filter((w) => w === 'WER?28,29,30$E1').length, 3);
  assert.ok(d.logBuffer.some((e) => e.dir === 'warn' && e.text.includes('Wiederholung')));
});

test('„.Ex“ (beschäftigt) auf eine Abfrage: kurz warten und erneut fragen', async () => {
  const d = new SecutestDriver({ settleMs: 1 });
  const port = attach(d, { 'IDN?$3E': [frame('.Ex$0F'), frame('IDNx=x;GMN;SecuTest S;GTM5015000R0001;18. Juli 1994  16:49:31;\xff\xff\xff\xff\xff\xff\xff\xff;00$EF')] });
  assert.equal((await d.identify()).model, 'SecuTest S');
  assert.equal(port.writes.length, 2);
});

test('Befehle (!) werden bei verfälschter Quittung nicht wiederholt (sonst doppelter Tastendruck)', async () => {
  const d = new SecutestDriver({ settleMs: 1 });
  const port = attach(d, { [cmd('TAS!4')]: frame('.Yx$24') });
  await assert.rejects(d.pressKey('ENTER'), (e) => e.code === 'CHECKSUM' && /möglicherweise trotzdem ausgeführt/.test(e.message));
  assert.equal(port.writes.length, 1);
});

test('„PRF“ (Protokoll fertig) wird gemeldet und stört eine laufende Abfrage nicht', async () => {
  const d = new SecutestDriver({ settleMs: 1 });
  attach(d, { 'MES?$48': frame('PRFx$84') + frame('A0;$D0') });
  const events = [];
  d.on('device-event', (e) => events.push(e.type));
  assert.equal((await d.getStatus()).flags.dose, true);
  assert.deepEqual(events, ['protocol-ready']);
});

test('Protokoll (PRO?) wird zweimal gleich gelesen – vertauschte Ziffern im Messwert fallen auf', async () => {
  const d = new SecutestDriver({ settleMs: 1 });
  // „00.21“ -> „00.12“ hat dieselbe Prüfsumme
  const swapped = PRO_FINAL.replace(';00.21;<03.50', ';00.12;<03.50');
  const port = attach(d, { 'PRO?$54': [frame(swapped), frame(PRO_FINAL), frame(PRO_FINAL)] });
  const pro = await d.readProtocol();
  assert.equal(pro.measurements.find((m) => m.key === 'DI').value, 0.21);
  assert.equal(pro.deviceId, '');
  assert.equal(port.writes.length, 3);
});

test('Werte zum Übernehmen müssen zweimal gleich gelesen werden', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  const ok = frame('WERTEx=28:00.08mA;29:00.11mA;30:00.21mA$9D');
  attach(mgr.driver, { 'WER?28,29,30$E1': [ok, frame('WERTEx=28:00.08mA;29:00.11mA;30:00.12mA$9D'), ok, ok] });
  const r = await mgr.readConfirmed('IB');
  assert.deepEqual([r.values.IB.value, r.values.IB_MAX.value, r.unconfirmed], [0.21, 0.11, []]);
});

test('Funktionstest-Werte nur bei Netz an der Prüfdose (Energiezähler Nr. 55)', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  attach(mgr.driver, { [FT_READ]: [FT_IDLE, FT_ON] });
  const idle = await mgr.remoteRead('FT');
  assert.deepEqual([idle.ftActive, idle.values], [false, {}]);
  const on = await mgr.remoteRead('FT');
  assert.equal(on.ftActive, true);
  assert.deepEqual([on.values.DI_LIVE.value, on.values.DI.value, on.values.P_MAX.value, on.values.W.value, on.values.W.unit], [0.06, 0.21, 6, 0, 'Wh']);
});

test('Ergebnis abholen: ohne Funktionstest keine FT-Werte, danach die gehaltenen Maximalwerte', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  attach(mgr.driver, { 'PRO?$54': PRO_SAFETY, [FT_READ]: FT_IDLE });
  assert.deepEqual((await mgr.fetchResult()).functionTest, {});

  attach(mgr.driver, { 'PRO?$54': frame(PRO_FINAL), [FT_READ]: FT_DONE });
  const r = await mgr.fetchResult();
  assert.equal(r.protocol.performed.DI, true);
  const ft = r.functionTest;
  assert.deepEqual([ft.P.value, ft.P.fromMax, ft.I.value, ft.DI.value, ft.U.value], [6, true, 0.06, 0.21, 235.7]);
  assert.ok(!('S' in ft) && !('PF' in ft) && !('DI_LIVE' in ft));
});

test('Anschlussstatus erst nach zwei gleichen Meldungen übernehmen („0A“ statt „A0“)', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  attach(mgr.driver, { 'MES?$48': [frame('A0;$D0'), frame('0A;$D0'), frame('A0;$D0'), frame('80;$C7'), frame('80;$C7')] });
  const seen = [];
  for (let i = 0; i < 5; i++) seen.push((await mgr.live()).flags.dose);
  assert.deepEqual(seen, [true, true, true, true, false]);
});

test('Anzeigewert des Displays wird mitgelesen (I_EA über Sonde = Nr. 24), aber nicht übernommen', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  const port = attach(mgr.driver, SK2_RECORDING);
  const live = await mgr.remoteRead('IB');
  assert.deepEqual(port.writes, [cmd('WER?28,29,30,24')], 'eine Abfrage statt zwei');
  assert.deepEqual([live.values.IB_LIVE.value, live.values.IB.value], [0.1, 0.18]);
  assert.ok(!('IB_LIVE' in (await mgr.remoteRead('IB', { confirm: true })).values));
});

test('Automatik: höchstens eine Abfrage je Ablesung, Wert erst übernehmen, wenn er zweimal gleich gelesen wurde', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  const busy = dev('WERTEx=19:----.M\xea;20:----.M\xea;21:----.M\xea;96:0538.V;18:>11.00M\xea');
  const port = attach(mgr.driver, { ...SK2_RECORDING, [cmd('WER?19,20,21,96,18')]: [busy, SK2_RECORDING[cmd('WER?19,20,21,96,18')]] });
  const events = [];
  mgr.broadcast = (type, data) => type === 'measure' && events.push(data.values.RISO_LIVE?.text);
  const r = await mgr.autoMeasure('RISO', { settleMs: 1, readEveryMs: 1 });
  assert.deepEqual([r.values.RISO.value, r.values.RISO.qualifier, r.values.UISO.value], [310, '>', 538]);
  const reads = port.writes.filter((w) => w.startsWith('WER?'));
  assert.deepEqual(reads, Array(3).fill(cmd('WER?19,20,21,96,18')), '„----.“, dann zweimal >310');
  assert.deepEqual(events, ['>11.00', '>310.0', '>310.0'], 'Live-Werte per Ereignis an die Oberfläche');
});

test('Treiber hält Abstand zwischen Befehlen – auch wenn der Aufrufer auf jede Antwort wartet', async () => {
  assert.ok(new SecutestDriver().opts.settleMs >= 250);
  const d = new SecutestDriver({ settleMs: 120 });
  const port = attach(d, { 'MES?$48': frame('A0;$D0') });
  const times = [];
  port.on('data', () => times.push(Date.now()));
  for (let i = 0; i < 4; i++) await d.getStatus(); // nacheinander, wie die Anschlusskontrolle
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  assert.ok(gaps.every((g) => g >= 110), `Abstände ${gaps.join(', ')} ms`);
});

test('Echo nach einem Neustart des Geräts wird wieder abgeschaltet', async () => {
  const d = new SecutestDriver({ settleMs: 1 });
  const port = attach(d, { 'MES?$48': 'MES?$48\r\n' + frame('A0;$D0') });
  assert.equal((await d.getStatus()).flags.dose, true);
  assert.ok(port.writes.includes('\x06'), '^F gesendet');
});

test('Automatik wartet, bis auch die Anzeige ruhig ist, und erkennt Unruhe während der Messung (Prüfling berührt)', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  // echter Mitschnitt (Desktop-Programm, 18.10.): Anzeige steigt 24,5 → 30,0 MΩ, Minimum 15,7 MΩ gehalten …
  const a = dev('WERTEx=19:015.7M\xea;20:035.8M\xea;21:013.1M\xea;96:0538.V;18:024.5M\xea');
  const b = dev('WERTEx=19:015.7M\xea;20:042.4M\xea;21:013.1M\xea;96:0538.V;18:030.0M\xea');
  // … danach losgelassen: Anzeige >310, das gehaltene Minimum bleibt
  const c = dev('WERTEx=19:015.7M\xea;20:>310.0M\xea;21:013.1M\xea;96:0538.V;18:>310.0M\xea');
  const port = attach(mgr.driver, { ...SK2_RECORDING, [cmd('WER?19,20,21,96,18')]: [a, b, c, c] });
  const r = await mgr.autoMeasure('RISO', { settleMs: 1, readEveryMs: 1 });
  assert.equal(port.writes.filter((w) => w.startsWith('WER?')).length, 4, 'nicht schon nach „13,1“ zweimal gleich, sondern erst bei ruhiger Anzeige');
  assert.equal(r.transient, true, 'Minimum 15,7 MΩ weit unter der Anzeige >310 MΩ');
  assert.equal(r.values.RISO.value, 13.1);

  // ruhige Messung: keine Unruhe
  attach(mgr.driver, SK2_RECORDING);
  assert.equal((await mgr.autoMeasure('RISO', { settleMs: 1, readEveryMs: 1 })).transient, false);
});

test('Messung wiederholen: Fernsteuerung kurz aus, damit das Gerät Minimum/Maximum zurücksetzt', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  const port = attach(mgr.driver, SK2_RECORDING);
  await mgr.driver.setRemote(true);
  await mgr.autoMeasure('RISO', { settleMs: 1, readEveryMs: 1, fresh: true });
  assert.deepEqual(port.writes.slice(0, 4), ['TAS!R$7F', 'TAS!r$9F', 'TAS!R$7F', 'MES!16$91']);
});

test('Automatik R_SL misst beide Polungen', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  const port = attach(mgr.driver, { 'TAS!R$7F': frame('.Yx$23'), [cmd('MES!8')]: frame('.Yx$23'), [cmd('MES!10')]: frame('.Yx$23'), [cmd('WER?12,13,14,15')]: dev('WERTEx=12:0.081\xea;13:0.084\xea;14:0.003\xea;15:0.098\xea') });
  const r = await mgr.autoMeasure('RSL', { settleMs: 1, readEveryMs: 1 });
  assert.equal(r.values.RSL.value, 0.098);
  assert.ok(port.writes.indexOf(cmd('MES!10')) > port.writes.indexOf(cmd('MES!8')));
});

test('PC-gesteuert, Funktionstest: nur Fernsteuerung aus – kein künstliches Umstellen, keine Taste', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  const port = attach(mgr.driver, { 'TAS!R$7F': frame('.Yx$23'), 'TAS!r$9F': frame('.Yx$23') + '\x03' });
  await mgr.driver.setRemote(true);
  const r = await mgr.remoteStart('FT');
  assert.equal(r.manual, true);
  assert.equal(mgr.driver.remoteActive, false, 'sonst sind die Tasten gesperrt');
  assert.deepEqual(port.writes, ['TAS!R$7F', 'TAS!r$9F']);
});

test('Gerätegeführt mit Automatik: wartet, bis das SECUTEST den Schritt misst, und liest ihn schonend mit', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  const riso = dev('WERTEx=19:>310.0M\xea;20:>310.0M\xea;21:>310.0M\xea;96:0538.V;18:>310.0M\xea');
  // Mitschnitt gerätegeführt: erst noch kein Schritt, dann läuft R_ISO (Laufnummern 18 und 96)
  const port = attach(mgr.driver, { 'MES?$48': [frame('A0;$D0'), frame('A0;$D0'), frame('A0;18;96$E3')], [cmd('WER?19,20,21,96,18')]: riso });
  const r = await mgr.deviceAwait('RISO', { readEveryMs: 1 });
  assert.deepEqual([r.values.RISO.value, r.values.RISO.qualifier, r.live.RISO_LIVE.qualifier, r.transient], [310, '>', '>', false]);
  const order = port.writes.map((w) => w.slice(0, 4));
  assert.deepEqual(order.slice(0, 3), ['MES?', 'MES?', 'MES?'], 'liest Werte erst, wenn das Gerät den Schritt misst');
  assert.equal(order.filter((w) => w === 'WER?').length, 2, 'zwei gleiche Ablesungen');
});

test('Gerätegeführt: I_B über die Sonde ist am Gerät der I_EA-Schritt; ein neues Mitlesen beendet das alte', async () => {
  const mgr = new SecutestManager();
  await mgr.connect({ simulator: true, scenario: 'sk2-ok', simulatorOptions: { latencyMs: 1 } });
  mgr.driver.opts.settleMs = 1;
  try {
    await mgr.driver.setSwitch('SK II');
    await mgr.driver.pressKey('ENTER'); // Start: R_ISO
    const old = assert.rejects(mgr.deviceAwait('IB', { readEveryMs: 5 }), (e) => e.code === 'CANCELLED'); // wartet, R_ISO ist nicht sein Schritt
    await new Promise((r) => setTimeout(r, 30));
    const riso = await mgr.deviceAwait('RISO', { readEveryMs: 5 });
    await old;
    assert.ok(riso.values.RISO.value > 1);
    await mgr.driver.pressKey('ENTER'); // weiter zum Ableitstrom über die Sonde (Laufnummer 24)
    const ib = await mgr.deviceAwait('IB', { readEveryMs: 5 });
    assert.ok(ib.values.IB.value != null && ib.live.IB_LIVE.value != null, 'Werte als I_B');
  } finally {
    await mgr.disconnect();
  }
});

test('Programm FUNCTION-TEST: vor Taste 14 keine Werte, danach zählt der Energiezähler', async () => {
  const mgr = new SecutestManager();
  mgr.driver.opts.settleMs = 1;
  // am Gerät gemessen: 25 s nach RST!1 noch alles „----.“; nach Taste 14 Spannung und Energiezähler
  const before = dev('WERTEx=58:----.V;56:----.A;52:----.W;57:----.VA;49:----.;55:----.xJ;59:----.Hz;64:----.mA;66:----.mA;67:----.mA;51:----.W;61:----.A');
  attach(mgr.driver, { [FT_READ]: [before, FT_ON] });
  assert.deepEqual([(await mgr.remoteRead('FT')).ftActive, (await mgr.remoteRead('FT')).ftActive], [false, true]);
});

test('Timeout ohne Gerät', async () => {
  const d = new SecutestDriver({ timeoutMs: 100, settleMs: 1 });
  await d.connect({ simulator: true, simulatorOptions: { latencyMs: 1 } });
  d.port.isOpen = false; // Simulator "stumm schalten"
  await assert.rejects(d.send('IDN?'), (e) => e.code === 'TIMEOUT');
  d.port.isOpen = true;
  await d.disconnect();
});
