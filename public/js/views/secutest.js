// SECUTEST: Verbindung, Auto-Erkennung, Live-Monitor, Fernbedienung, Terminal, Einstellungen
import { h, clear, toast, field, input, select, fill } from '../ui.js';
import { get, post, put } from '../api.js';
import { state, onSecutest } from '../state.js';

export async function renderSecutest() {
  let st = await get('/secutest/status');
  const showTerminal = st.config?.terminal !== false; // in Einstellungen → Programm abschaltbar
  const statusBox = h('div');
  const portSel = select([['', 'Lade Schnittstellen …']], '');
  const scanLog = h('div', { class: 'small' });
  const term = h('div', { class: 'term' });
  const liveBox = h('div');
  let liveTimer = null;

  const drawStatus = () => {
    const id = st.identity;
    fill(statusBox, 
      h('div', { class: 'row' }, h('span', { class: `dot ${st.connected ? (st.simulator ? 'sim' : 'on') : 'off'}` }), h('b', {}, st.connected ? (st.simulator ? 'Simulator verbunden' : `Verbunden mit ${st.port}`) : st.scanning ? 'Suche läuft …' : 'Nicht verbunden'), st.remote ? h('span', { class: 'badge warn' }, 'Remote-Modus aktiv') : null),
      id ? h('dl', { class: 'kv', style: { marginTop: '8px' } }, h('dt', {}, 'Gerät'), h('dd', {}, [id.manufacturer, id.model].filter(Boolean).join(' ')), h('dt', {}, 'Firmware'), h('dd', {}, id.firmware || '—'), h('dt', {}, 'Datum im Gerät'), h('dd', {}, id.date || '—'), h('dt', {}, 'Geräte-ID'), h('dd', {}, id.deviceId || '—'), h('dt', {}, 'Kalibrierung'), h('dd', {}, id.calibration || '—'), h('dt', {}, 'Adresse'), h('dd', {}, id.address ?? '—')) : st.connected ? h('div', { class: 'alert warn small' }, `Verbunden, aber keine Antwort auf IDN?. Kabel (ggf. Nullmodem), Port und Gerät prüfen${showTerminal ? ' – Terminal unten nutzen' : ''}.`) : null,
      st.lastScan ? h('div', { class: 'small muted', style: { marginTop: '6px' } }, `Letzte Suche ${new Date(st.lastScan.at).toLocaleTimeString('de-DE')}: `, st.lastScan.found ? `gefunden an ${st.lastScan.found}` : `nichts gefunden (${st.lastScan.tried.map((t) => `${t.path}: ${t.error || 'ok'}`).join('; ') || 'keine Ports'})`) : null
    );
  };

  const loadPorts = async () => {
    const r = await get('/secutest/ports');
    clear(portSel);
    if (!r.ports.length) portSel.appendChild(h('option', { value: '' }, r.error ? `Keine Ports (${r.error})` : 'Keine seriellen Schnittstellen gefunden'));
    for (const p of r.ports) portSel.appendChild(h('option', { value: p.path, selected: p.path === st.config.lastPort }, `${p.path}${p.chip ? ` – ${p.chip}` : p.manufacturer ? ` – ${p.manufacturer}` : ''}`));
  };

  const scan = async () => {
    clear(scanLog).appendChild(h('div', {}, '🔎 Pinge alle seriellen Schnittstellen an (IDN?) …'));
    try {
      const r = await post('/secutest/scan', { connect: true });
      if (r.alreadyConnected) toast('Bereits verbunden', 'info');
      else if (r.found) toast(`SECUTEST gefunden an ${r.found.path}`, 'ok');
      else toast('Kein SECUTEST gefunden – Kabel/Adapter prüfen.', 'warn', 6000);
      st = await get('/secutest/status');
      drawStatus();
      loadPorts();
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  const connect = async () => {
    if (!portSel.value) return toast('Bitte Schnittstelle auswählen', 'warn');
    try {
      st = { ...st, ...(await post('/secutest/connect', { path: portSel.value })) };
      st = await get('/secutest/status');
      drawStatus();
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };

  const scenSel = select(st.scenarios.map((s) => [s.id, s.label]), st.scenario || 'sk1-ok');
  const simulate = async () => {
    try {
      if (st.connected && st.simulator) await post('/secutest/scenario', { scenario: scenSel.value });
      else await post('/secutest/connect', { simulator: true, scenario: scenSel.value });
      st = await get('/secutest/status');
      drawStatus();
      toast('Simulator aktiv', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  const disconnect = async () => {
    await post('/secutest/disconnect').catch(() => {});
    st = await get('/secutest/status');
    drawStatus();
  };

  // ---------- Terminal ----------
  const addLog = (e) => {
    const time = new Date(e.ts).toLocaleTimeString('de-DE');
    term.appendChild(h('div', { class: e.dir }, `${time} ${e.dir === 'tx' ? '→' : e.dir === 'rx' ? '←' : '•'} ${e.text}`));
    while (term.childNodes.length > 400) term.removeChild(term.firstChild);
    term.scrollTop = term.scrollHeight;
  };
  const cmd = input({ placeholder: 'Befehl, z. B. IDN?  WER?12,15  MES?  PRO?  TAS!4  ^C', class: 'input mono' });
  const withCs = h('input', { type: 'checkbox', checked: true });
  const send = async (c = cmd.value) => {
    if (!c.trim()) return;
    try {
      await post('/secutest/command', { command: c, withChecksum: withCs.checked });
    } catch (e) {
      addLog({ dir: 'err', text: e.message, ts: new Date().toISOString() });
    }
  };
  cmd.addEventListener('keydown', (e) => e.key === 'Enter' && (send(), cmd.select()));

  const unsub = onSecutest((type, data) => {
    if (!document.body.contains(statusBox)) return unsub();
    if (type === 'log' && showTerminal) addLog(data);
    if (type === 'state') {
      st = data;
      drawStatus();
    }
    if (type === 'scan') clear(scanLog).appendChild(h('div', {}, data.state === 'ping' ? `🔎 Prüfe ${data.path} …` : data.state === 'found' ? `✅ SECUTEST an ${data.path}` : `– ${data.path}: ${data.error || 'keine Antwort'}`));
  });

  // ---------- Live ----------
  const liveToggle = h('input', {
    type: 'checkbox',
    onchange: (e) => {
      clearInterval(liveTimer);
      if (e.target.checked)
        liveTimer = setInterval(async () => {
          if (!document.body.contains(liveBox)) return clearInterval(liveTimer);
          try {
            const r = await get('/secutest/live');
            fill(liveBox, h('div', {}, '🔌 ', r.flags.list.join(' · ') || 'kein Prüfling erkannt'), h('div', {}, 'Laufende Messung: ', h('b', {}, r.group || '—'), r.running.length ? ` (Nr. ${r.running.join(', ')})` : ''), h('div', { class: 'live' }, Object.entries(r.values).map(([k, v]) => h('div', { class: 'lv' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v.text)))));
          } catch (err) {
            clear(liveBox).appendChild(h('div', { class: 'muted' }, err.message));
          }
        }, 900);
    },
  });

  // ---------- Fernbedienung / Schalter ----------
  const press = (key) => post('/secutest/key', { key }).catch((e) => toast(e.message, 'bad'));
  const posSel = select(Object.keys(st.config.switchPositions), 'AUTO');

  // ---------- Konfiguration ----------
  const c = st.config;
  const cfgAuto = h('input', { type: 'checkbox', checked: c.autoConnect });
  const cfgCs = h('input', { type: 'checkbox', checked: c.withChecksum });
  const cfgMains = h('input', { type: 'checkbox', checked: c.softwareMains });
  const cfgAddr = input({ type: 'number', min: 0, max: 90, value: c.address ?? '', placeholder: 'leer = ohne Adresse', style: { maxWidth: '160px' } });
  const cfgTimeout = input({ type: 'number', min: 300, max: 20000, value: c.timeoutMs, style: { maxWidth: '120px' } });
  const swInputs = Object.entries(c.switchPositions).map(([k, v]) => [k, input({ type: 'number', min: 1, max: 8, value: v, style: { width: '70px' } })]);
  const saveCfg = async () => {
    try {
      await put('/secutest/config', { autoConnect: cfgAuto.checked, withChecksum: cfgCs.checked, softwareMains: cfgMains.checked, address: cfgAddr.value, timeoutMs: cfgTimeout.value, switchPositions: Object.fromEntries(swInputs.map(([k, i]) => [k, i.value])) });
      toast('Schnittstellen-Einstellungen gespeichert', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  drawStatus();
  loadPorts();
  get('/secutest/status').then(() => {});
  // bisheriges Log holen
  setTimeout(() => (state.secutest = st), 0);

  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, 'SECUTEST 0701S – RS-232')),
    h(
      'div',
      { class: 'grid c2' },
      h(
        'div',
        { class: 'card stack' },
        h('h2', {}, 'Verbindung'),
        statusBox,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: scan }, '🔎 Automatisch suchen'), h('button', { class: 'btn', onclick: disconnect }, 'Trennen')),
        scanLog,
        h('div', { class: 'row' }, h('div', { style: { flex: 1, minWidth: '200px' } }, portSel), h('button', { class: 'btn', onclick: loadPorts }, '↻'), h('button', { class: 'btn', onclick: connect }, 'Verbinden')),
        h('details', {}, h('summary', {}, '🧪 Simulator (ohne Hardware testen)'), h('div', { class: 'row', style: { marginTop: '8px' } }, h('div', { style: { flex: 1, minWidth: '220px' } }, scenSel), h('button', { class: 'btn', onclick: simulate }, 'Simulator starten / Szenario setzen')))
      ),
      h(
        'div',
        { class: 'card stack' },
        h('h2', {}, 'Anschluss-Hilfe'),
        h('ol', { class: 'instr small' }, h('li', {}, 'USB-RS232-Adapter (FTDI, Prolific PL2303, CH340 oder CP210x) am PC einstecken, ggf. Treiber installieren.'), h('li', {}, 'Mit der 9-poligen D-SUB-Buchse RS232 (10) oben links am SECUTEST verbinden. Meist reicht ein 1:1-Kabel; kommt keine Antwort, ein Nullmodemkabel/-adapter probieren.'), h('li', {}, 'SECUTEST einschalten (Drehschalter nicht auf OFF).'), h('li', {}, '„Automatisch suchen“ – oder einfach einstecken: neue Adapter werden automatisch erkannt und angepingt.')),
        h('div', { class: 'small muted' }, 'Windows: COM3, COM4 … · macOS: /dev/cu.usbserial-… · Linux: /dev/ttyUSB0 (Benutzer in Gruppe „dialout“). Schnittstelle: 9600 Baud, 8N1, XON/XOFF.')
      )
    ),
    h(
      'div',
      { class: 'grid c2', style: { marginTop: '14px' } },
      h('div', { class: 'card stack' }, h('div', { class: 'card-head' }, h('h2', {}, 'Live-Monitor'), h('label', { class: 'check' }, liveToggle, 'aktiv (MES? / WER?)')), liveBox),
      h(
        'div',
        { class: 'card stack' },
        h('h2', {}, 'Fernbedienung'),
        h('div', { class: 'keypad' }, h('button', { class: 'btn', onclick: () => press('UP') }, '▲ (7)'), h('button', { class: 'btn', onclick: () => press('DOWN') }, '▼ (8)'), h('button', { class: 'btn primary', onclick: () => press('ENTER') }, '↵ (12)'), h('button', { class: 'btn', onclick: () => press('HELP') }, 'ⓘ (13)'), h('button', { class: 'btn', onclick: () => press('FUNCTION_TEST') }, 'FUNCTION-TEST (14)')),
        h('div', { class: 'row' }, posSel, h('button', { class: 'btn', onclick: () => post('/secutest/switch', { position: posSel.value }).then(() => toast('Schalterstellung gesetzt', 'ok')).catch((e) => toast(e.message, 'bad')) }, 'Schalterstellung setzen (RST!)'), h('button', { class: 'btn', onclick: () => post('/secutest/abort').catch((e) => toast(e.message, 'bad')) }, '^C Abbruch')),
        h('div', { class: 'small muted' }, 'FUNCTION-TEST per Schnittstelle schaltet nur Netz auf die Prüfdose, wenn der Schnittstellenstecker codiert ist (Pin 1–9 und 5–6 gebrückt).')
      )
    ),
    !showTerminal
      ? h('div', { class: 'card small muted', style: { marginTop: '14px' } }, '📟 Das RS-232-Terminal ist ausgeschaltet – einschalten unter ', h('a', { href: '#/settings/program' }, 'Einstellungen → Programm'), '.')
      : h(
      'div',
      { class: 'card stack', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' }, h('h2', {}, 'Terminal / Protokoll'), h('div', { class: 'row' }, ['IDN?', 'MES?', 'WER?', 'PRO?', 'TAS!R', 'TAS!r', '^C'].map((q) => h('button', { class: 'btn sm', onclick: () => send(q) }, q)), h('button', { class: 'btn sm', onclick: () => clear(term) }, 'Leeren'))),
      term,
      h('div', { class: 'row' }, h('div', { style: { flex: 1, minWidth: '240px' } }, cmd), h('label', { class: 'check small' }, withCs, '$Prüfsumme anhängen'), h('button', { class: 'btn', onclick: () => send() }, 'Senden'))
    ),
    h(
      'details',
      { class: 'card', style: { marginTop: '14px' } },
      h('summary', {}, h('b', {}, 'Erweiterte Schnittstellen-Einstellungen')),
      h('div', { class: 'stack', style: { marginTop: '10px' } },
        h('label', { class: 'check' }, cfgAuto, 'Eingesteckte USB-Seriell-Adapter automatisch anpingen und verbinden'),
        h('label', { class: 'check' }, cfgCs, 'Befehle mit $Prüfsumme senden (laut Anleitung; bei Problemen testweise ausschalten)'),
        h('label', { class: 'check' }, cfgMains, 'Funktionstest-Netz per Software schalten (TAS!5) – nur mit codiertem Schnittstellenstecker!'),
        h('div', { class: 'grid c2' }, field('Geräteadresse (IDN!x)', cfgAddr, '0–90, nur bei mehreren Geräten nötig'), field('Timeout (ms)', cfgTimeout)),
        h('div', {}, h('div', { class: 'field-label' }, 'Nummern der Schalterstellungen für RST!a'), h('div', { class: 'small muted' }, 'Laut Anleitung: 1 = FUNCTION-TEST. Die übrigen ergeben sich aus der Reihenfolge am Drehschalter – bei Abweichung hier korrigieren.'), h('div', { class: 'row', style: { marginTop: '6px' } }, swInputs.map(([k, i]) => h('label', { class: 'field' }, h('span', { class: 'field-label small' }, k), i)))),
        h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: saveCfg }, 'Speichern'))
      )
    )
  );
}
