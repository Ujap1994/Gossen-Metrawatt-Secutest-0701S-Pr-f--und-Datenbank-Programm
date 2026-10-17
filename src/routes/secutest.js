'use strict';
/**
 * SECUTEST-Schnittstelle: Verbinden, Auto-Erkennung, Terminal, Fernsteuerung, Live-Werte.
 */
const { asyncRouter } = require('./util');
const { KEYS } = require('../secutest/protocol');
const calibration = require('../secutest/calibration');
const { esc, fold } = require('../reminders/ics');

module.exports = function secutestRoutes(manager) {
  const r = asyncRouter();
  const d = () => manager.driver;
  const need = () => {
    if (!d().connected) throw Object.assign(new Error('Nicht mit dem SECUTEST verbunden.'), { status: 409, code: 'NOT_CONNECTED' });
  };

  r.get('/status', (req, res) => res.json(manager.status()));
  r.get('/events', (req, res) => manager.subscribe(res));
  r.get('/ports', async (req, res) => res.json(await manager.listPorts()));

  r.post('/scan', async (req, res) => res.json(await manager.autoDetect({ connect: req.body?.connect !== false })));

  r.post('/connect', async (req, res) => {
    const { path, simulator, scenario } = req.body || {};
    res.json(await manager.connect({ path, simulator: !!simulator, scenario }));
  });

  r.post('/disconnect', async (req, res) => res.json(await manager.disconnect()));

  r.post('/scenario', (req, res) => {
    d().setScenario(String(req.body?.scenario || ''));
    res.json(manager.status());
  });

  r.put('/config', (req, res) => {
    const b = req.body || {};
    const patch = {};
    if ('address' in b) patch.address = b.address === '' || b.address == null ? null : Math.max(0, Math.min(90, parseInt(b.address, 10) || 0));
    if ('withChecksum' in b) patch.withChecksum = !!b.withChecksum;
    if ('timeoutMs' in b) patch.timeoutMs = Math.max(300, Math.min(20000, parseInt(b.timeoutMs, 10) || 2500));
    if ('softwareMains' in b) patch.softwareMains = !!b.softwareMains;
    if ('autoConnect' in b) patch.autoConnect = !!b.autoConnect;
    if ('terminal' in b) patch.terminal = !!b.terminal;
    if (b.switchPositions && typeof b.switchPositions === 'object') {
      patch.switchPositions = {};
      for (const [k, v] of Object.entries(b.switchPositions)) {
        const n = parseInt(v, 10);
        if (n >= 1 && n <= 8) patch.switchPositions[k] = n;
      }
    }
    res.json(manager.updateCfg(patch));
  });

  // ---------- Kalibrierung des Prüfgeräts (Einstellungen → Programm) ----------
  r.get('/calibration', (req, res) => res.json(calibration.status({ identity: d().identity })));

  r.put('/calibration', (req, res) => res.json(calibration.update(req.body || {})));

  /** Kalibriernummer und Geräte-ID aus der IDN?-Antwort des verbundenen Geräts übernehmen */
  r.post('/calibration/from-device', (req, res) => {
    const id = d().identity;
    if (!id) throw Object.assign(new Error('Kein SECUTEST verbunden bzw. keine Geräte-Identifikation (IDN?) vorhanden.'), { status: 409, code: 'NOT_CONNECTED' });
    const patch = { calibrationNo: id.calibration || '', deviceId: id.deviceId || '' };
    if (req.body?.lastDate) patch.lastDate = req.body.lastDate;
    res.json(calibration.update(patch));
  });

  /** Kalendertermin für die nächste Kalibrierung */
  r.get('/calibration.ics', (req, res) => {
    const s = calibration.status();
    if (!s.nextDate) return res.status(404).json({ error: 'Kein Kalibrierdatum hinterlegt.' });
    const dv = (iso) => iso.replace(/-/g, '');
    const next = new Date(s.nextDate + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    const summary = 'Kalibrierung SECUTEST 0701S fällig';
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Secutest Pruefmanager//DE', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:kalibrierung-secutest@secutest-pruefmanager', `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      `DTSTART;VALUE=DATE:${dv(s.nextDate)}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(`Prüfgerät zur Kalibrierung geben.\nLetzte Kalibrierung: ${s.lastDate.split('-').reverse().join('.')}${s.calibrationNo ? `\nKalibrier-Nr.: ${s.calibrationNo}` : ''}${s.deviceId ? `\nGeräte-ID: ${s.deviceId}` : ''}${s.lab ? `\nLabor/Zertifikat: ${s.lab}` : ''}`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, `TRIGGER:-P${s.warnDays}D`, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ];
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Kalibrierung_SECUTEST.ics"');
    res.send(lines.map(fold).join('\r\n') + '\r\n');
  });

  r.get('/identify', async (req, res) => {
    need();
    res.json(await d().identify());
  });

  /** Terminal: beliebigen Befehl senden (nur wenn das Terminal in den Einstellungen eingeschaltet ist) */
  r.post('/command', async (req, res) => {
    if (manager.cfg().terminal === false) throw Object.assign(new Error('Das RS-232-Terminal ist in den Einstellungen ausgeschaltet.'), { status: 403, code: 'TERMINAL_OFF' });
    need();
    const cmd = String(req.body?.command || '').trim();
    if (!cmd) throw Object.assign(new Error('Befehl fehlt'), { status: 400 });
    if (cmd.length > 120) throw Object.assign(new Error('Befehl zu lang'), { status: 400 });
    const resp = await d().raw(cmd, { withChecksum: req.body?.withChecksum !== false });
    res.json({ response: resp });
  });

  r.post('/key', async (req, res) => {
    need();
    const key = String(req.body?.key || '');
    if (!(key in KEYS) && !/^[0-5RrMm]$/.test(key)) throw Object.assign(new Error('Unbekannte Taste'), { status: 400 });
    await d().pressKey(key);
    res.json({ ok: true });
  });

  r.post('/switch', async (req, res) => {
    need();
    await d().setSwitch(req.body?.position);
    res.json({ ok: true });
  });

  r.post('/abort', async (req, res) => {
    need();
    await d().abort();
    res.json({ ok: true });
  });

  // --------- PC-gesteuert ---------
  r.post('/precheck', async (req, res) => {
    need();
    res.json(await manager.precheck());
  });

  r.post('/remote/start', async (req, res) => {
    need();
    res.json(await manager.remoteStart(String(req.body?.group || ''), { second: !!req.body?.second }));
  });

  r.get('/remote/read', async (req, res) => {
    need();
    res.json(await manager.remoteRead(String(req.query.group || ''), { confirm: req.query.confirm === '1' }));
  });

  r.post('/remote/stop-ft', async (req, res) => {
    need();
    res.json(await manager.remoteStopFunctionTest());
  });

  r.post('/remote/end', async (req, res) => res.json(await manager.remoteEnd()));

  // --------- gerätegeführt ---------
  r.get('/live', async (req, res) => {
    need();
    res.json(await manager.live({ confirm: req.query.confirm === '1' }));
  });

  r.get('/result', async (req, res) => {
    need();
    res.json(await manager.fetchResult());
  });

  return r;
};
