// Grafische Erklärung jedes Prüfschritts: SECUTEST 0701S (Frontansicht, vereinfacht),
// Prüfling, Leitungen, Sonde und die jeweilige Handlung – als skalierbares SVG.
// Nummern in Klammern entsprechen der Bedienungsanleitung (z. B. Prüfdose (18)).

const C = {
  body: '#dfe4ea',
  bodyStroke: '#7d8a97',
  panel: '#f5f7f9',
  key: '#3d4b59',
  lcd: '#c7d9a3',
  lcdStroke: '#5f7444',
  lcdText: '#1f2b12',
  metal: '#b9c3cd',
  plastic: '#efe5cf',
  cable: '#2f3b47',
  probe: '#c62828',
  pe: '#3c9a3c',
  accent: '#f59e0b',
  ok: '#1f8b4c',
  bad: '#c62828',
  text: '#1d2733',
  muted: '#5b6b7b',
};

const SWITCH_ANGLES = { 'FUNCTION-TEST': 100, MENUE: 140, OFF: 168, AUTO: 196, 'SK I': 226, 'SK II': 256, 'SK III': 290, 'T 240': 326 };
const SWITCH_SHORT = { 'FUNCTION-TEST': 'FUNC', MENUE: 'MENUE', OFF: 'OFF', AUTO: 'AUTO', 'SK I': 'SK I', 'SK II': 'SK II', 'SK III': 'SK III', 'T 240': 'T240' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const t = (x, y, s, a = '') => `<text x="${x}" y="${y}" ${a}>${esc(s)}</text>`;

function bez(p0, p1, p2, p3, u) {
  const v = 1 - u;
  return [v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]];
}

/** Wendelleitung (Sonde) entlang einer Bezierkurve */
function coil(p0, p1, p2, p3, turns = 14, amp = 4.5) {
  const n = turns * 8;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const [x, y] = bez(p0, p1, p2, p3, u);
    const [x2, y2] = bez(p0, p1, p2, p3, Math.min(1, u + 0.001));
    let nx = -(y2 - y);
    let ny = x2 - x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const fade = Math.min(1, u * 8, (1 - u) * 8);
    const o = Math.sin(u * turns * Math.PI * 2) * amp * fade;
    d += `${i ? 'L' : 'M'}${(x + nx * o).toFixed(1)},${(y + ny * o).toFixed(1)}`;
  }
  return d;
}

const cable = (d, a = '') => `<path d="${d}" fill="none" stroke="${C.cable}" stroke-width="4" stroke-linecap="round" ${a}/>`;

// ---------------------------------------------------------------------------
// SECUTEST
// ---------------------------------------------------------------------------
function secutest(sc) {
  const sw = sc.switchPos || 'AUTO';
  const hl = new Set(sc.highlight || []);
  const cx = 344;
  const cy = 205;
  const ang = ((SWITCH_ANGLES[sw] ?? 196) * Math.PI) / 180;
  let s = '';
  // Gehäuse
  s += `<rect x="70" y="80" width="366" height="250" rx="14" fill="${C.body}" stroke="${C.bodyStroke}" stroke-width="2"/>`;
  s += `<rect x="84" y="112" width="338" height="204" rx="6" fill="${C.panel}" stroke="#c3ccd5"/>`;
  // RS232 (10)
  s += `<rect x="96" y="88" width="50" height="16" rx="5" fill="#9aa6b2" stroke="#5b6b7b"/>`;
  s += `<g fill="#3d4b59">${[0, 1, 2, 3, 4].map((i) => `<circle cx="${104 + i * 8.5}" cy="94" r="1.6"/>`).join('')}${[0, 1, 2, 3].map((i) => `<circle cx="${108 + i * 8.5}" cy="99" r="1.6"/>`).join('')}</g>`;
  s += t(150, 100, 'RS232 (10)', `font-size="9" fill="${C.muted}"`);
  // SONDE (4)(5)
  s += t(300, 100, 'SONDE', `font-size="9" fill="${C.muted}"`);
  s += `<circle cx="352" cy="96" r="7" fill="#222" stroke="${hl.has('probe-sockets') ? C.accent : '#555'}" stroke-width="${hl.has('probe-sockets') ? 3 : 1.5}" class="${hl.has('probe-sockets') ? 'pulse' : ''}"/>`;
  s += `<circle cx="378" cy="96" r="7" fill="#222" stroke="${hl.has('probe-sockets') ? C.accent : '#555'}" stroke-width="${hl.has('probe-sockets') ? 3 : 1.5}" class="${hl.has('probe-sockets') ? 'pulse' : ''}"/>`;
  s += t(349, 88, '5', `font-size="8" fill="${C.muted}"`) + t(375, 88, '4', `font-size="8" fill="${C.muted}"`);
  // Lampe (11), Tasten ↵ (12) ⓘ (13)
  s += `<circle cx="104" cy="134" r="6" fill="${sc.mainsFault ? C.bad : '#7a2a2a'}" stroke="#333"/>`;
  s += key(92, 152, '↵', hl.has('enter'), '12');
  s += key(92, 190, 'i', hl.has('help'), '13');
  // LCD (9)
  s += `<rect x="128" y="124" width="122" height="104" rx="3" fill="${C.lcd}" stroke="${C.lcdStroke}" stroke-width="2"/>`;
  (sc.lcd || []).slice(0, 6).forEach((line, i) => {
    s += t(134, 140 + i * 15, line, `font-size="${i === 1 && /\d/.test(line) && line.length < 18 ? 11 : 8.6}" font-family="ui-monospace,Consolas,monospace" font-weight="${i === 1 ? 700 : 400}" fill="${C.lcdText}"`);
  });
  // ▲ (7) ▼ (8)
  s += key(258, 128, '▲', hl.has('up'), '7');
  s += key(258, 164, '▼', hl.has('down'), '8');
  // FUNCTION-TEST (14), Lampe (15)
  s += key(258, 262, '', hl.has('ft-key'), '14', 30);
  s += `<circle cx="306" cy="273" r="7" fill="${sc.mainsOn ? '#ffd54f' : '#e8e0c0'}" stroke="#776" class="${sc.mainsOn ? 'blink' : ''}"/>`;
  s += t(298, 296, '230 V (15)', `font-size="7.5" fill="${C.muted}"`);
  // Drehschalter (6)
  for (const [name, a] of Object.entries(SWITCH_ANGLES)) {
    const r = (a * Math.PI) / 180;
    const x = cx + Math.cos(r) * 33;
    const y = cy + Math.sin(r) * 33;
    const active = name === sw;
    const anchor = Math.cos(r) < -0.2 ? 'end' : Math.cos(r) > 0.2 ? 'start' : 'middle';
    s += `<circle cx="${(cx + Math.cos(r) * 27).toFixed(1)}" cy="${(cy + Math.sin(r) * 27).toFixed(1)}" r="1.8" fill="${active ? C.accent : '#555'}"/>`;
    s += t(x.toFixed(1), (y + 3).toFixed(1), SWITCH_SHORT[name], `font-size="${active ? 9 : 7.5}" font-weight="${active ? 800 : 500}" text-anchor="${anchor}" fill="${active ? '#b45309' : C.muted}"`);
  }
  s += `<circle cx="${cx}" cy="${cy}" r="21" fill="#e9edf1" stroke="${hl.has('switch') ? C.accent : '#6b7885'}" stroke-width="${hl.has('switch') ? 3.5 : 2}" class="${hl.has('switch') ? 'pulse' : ''}"/>`;
  s += `<line x1="${cx - Math.cos(ang) * 16}" y1="${cy - Math.sin(ang) * 16}" x2="${cx + Math.cos(ang) * 19}" y2="${cy + Math.sin(ang) * 19}" stroke="#3d4b59" stroke-width="7" stroke-linecap="round"/>`;
  s += `<line x1="${cx + Math.cos(ang) * 6}" y1="${cy + Math.sin(ang) * 6}" x2="${cx + Math.cos(ang) * 18}" y2="${cy + Math.sin(ang) * 18}" stroke="${C.accent}" stroke-width="2.5" stroke-linecap="round"/>`;
  // Buchsen L (3), N (2), SL (1)
  const sock = (y, label, num, key) =>
    `<circle cx="414" cy="${y}" r="8" fill="#222" stroke="${hl.has(key) ? C.accent : '#555'}" stroke-width="${hl.has(key) ? 3 : 1.5}" class="${hl.has(key) ? 'pulse' : ''}"/>` + t(397, y + 3, label, `font-size="8.5" font-weight="700" text-anchor="end" fill="${C.text}"`) + t(414, y + 19, num, `font-size="7" text-anchor="middle" fill="${C.muted}"`);
  s += sock(136, 'L', '3', 'L') + sock(172, 'N', '2', 'N') + sock(208, 'SL', '1', 'SL');
  // Prüfdose (18) – seitlich
  s += `<rect x="436" y="236" width="44" height="64" rx="7" fill="#cfd6dd" stroke="${hl.has('socket') ? C.accent : C.bodyStroke}" stroke-width="${hl.has('socket') ? 3.5 : 2}" class="${hl.has('socket') ? 'pulse' : ''}"/>`;
  s += `<circle cx="458" cy="268" r="15" fill="#eef1f4" stroke="#8a96a3"/><circle cx="453" cy="268" r="2.4" fill="#333"/><circle cx="463" cy="268" r="2.4" fill="#333"/><rect x="455" y="252" width="6" height="3" fill="#999"/><rect x="455" y="281" width="6" height="3" fill="#999"/>`;
  s += t(458, 314, 'Prüfdose (18)', `font-size="8.5" text-anchor="middle" fill="${C.muted}"`);
  s += t(92, 310, 'SECUTEST 0701S', `font-size="10" font-weight="700" fill="#45525f"`);
  return s;
}

function key(x, y, label, hl, num, w = 26) {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="24" rx="4" fill="${C.key}" stroke="${hl ? C.accent : '#222'}" stroke-width="${hl ? 3.5 : 1}" class="${hl ? 'pulse' : ''}"/>` +
    (label ? t(x + w / 2, y + 17, label, `font-size="13" font-weight="700" text-anchor="middle" fill="#fff"`) : '') +
    t(x + w + 3, y + 22, `(${num})`, `font-size="6.5" fill="${C.muted}"`)
  );
}

// ---------------------------------------------------------------------------
// Prüflinge – liefern {svg, plugFrom, probeTarget, parts[], switchPos}
// ---------------------------------------------------------------------------
function powerSwitch(x, y, on, hl) {
  return (
    `<rect x="${x}" y="${y}" width="24" height="30" rx="4" fill="#2b2b2b" stroke="${hl ? C.accent : '#111'}" stroke-width="${hl ? 3.5 : 1}" class="${hl ? 'pulse' : ''}"/>` +
    `<rect x="${x + 4}" y="${on ? y + 4 : y + 15}" width="16" height="11" rx="2" fill="${on ? '#e53935' : '#777'}"/>` +
    t(x + 12, y + 13 + (on ? 0 : 11), on ? 'I' : '0', `font-size="9" font-weight="700" text-anchor="middle" fill="#fff"`)
  );
}

function classBadge(x, y, sk) {
  if (sk === 'sk1' || sk === 'it1' || sk === 'cord' || sk === 'fixed')
    return `<g transform="translate(${x},${y})" stroke="${C.pe}" stroke-width="2.2" fill="none" stroke-linecap="round"><circle cx="12" cy="12" r="11"/><path d="M12 4v8M6 12h12M8.5 15.5h7M10.5 19h3"/></g>`;
  if (sk === 'sk2' || sk === 'it2') return `<g transform="translate(${x},${y})" stroke="${C.text}" stroke-width="2" fill="none"><rect x="1" y="1" width="22" height="22"/><rect x="6.5" y="6.5" width="11" height="11"/></g>`;
  if (sk === 'sk3')
    return `<g transform="translate(${x},${y})"><path d="M12 0 24 12 12 24 0 12z" fill="none" stroke="${C.text}" stroke-width="2"/>${t(12, 16, 'III', `font-size="8.5" font-weight="800" text-anchor="middle" fill="${C.text}"`)}</g>`;
  return '';
}

function dutGeneric(kind, sc) {
  const hl = new Set(sc.highlight || []);
  const on = sc.dutOn !== false;
  const metal = kind === 'sk1';
  let s = `<rect x="560" y="104" width="190" height="138" rx="12" fill="${metal ? C.metal : C.plastic}" stroke="#5b6b7b" stroke-width="2"/>`;
  s += `<rect x="578" y="120" width="112" height="58" rx="6" fill="${metal ? '#cfd7df' : '#f7f0de'}" stroke="#8a96a3"/>`;
  s += t(634, 154, metal ? 'Gerät SK I' : 'Gerät SK II', `font-size="12" font-weight="700" text-anchor="middle" fill="${C.text}"`);
  s += t(634, 168, metal ? 'Metallgehäuse' : 'schutzisoliert', `font-size="8.5" text-anchor="middle" fill="${C.muted}"`);
  s += classBadge(578, 196, kind);
  s += powerSwitch(712, 120, on, hl.has('dut-switch'));
  s += t(724, 164, 'Netz-', `font-size="7.5" text-anchor="middle" fill="${C.muted}"`) + t(724, 173, 'schalter', `font-size="7.5" text-anchor="middle" fill="${C.muted}"`);
  // berührbare leitfähige Teile (Schrauben)
  const parts = metal ? [[612, 218], [726, 222], [574, 112]] : [[640, 218], [724, 222]];
  parts.forEach(([x, y], i) => {
    s += `<circle cx="${x}" cy="${y}" r="6" fill="#d6dbe0" stroke="#4a5562" stroke-width="1.5"/><path d="M${x - 4} ${y}h8" stroke="#4a5562" stroke-width="1.5"/>`;
    if (hl.has('parts')) s += `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="${C.accent}" stroke-width="2.5" class="pulse"/>` + t(x + 12, y - 8, String(i + 1), `font-size="10" font-weight="800" fill="#b45309"`);
  });
  return { svg: s, cableStart: [600, 242], probeTarget: parts[0], parts };
}

function dutIT(kind, sc) {
  const hl = new Set(sc.highlight || []);
  const on = sc.dutOn !== false;
  let s = '';
  // Monitor
  s += `<rect x="556" y="96" width="170" height="104" rx="6" fill="#27313b" stroke="#111" stroke-width="2"/>`;
  s += `<rect x="564" y="104" width="154" height="84" rx="2" fill="${on ? '#4f86c6' : '#3a4450'}"/>`;
  if (on) s += t(641, 150, 'EDV / Büro', `font-size="13" font-weight="700" text-anchor="middle" fill="#fff"`);
  s += `<rect x="630" y="200" width="22" height="22" fill="#5b6b7b"/><rect x="604" y="222" width="74" height="8" rx="3" fill="#5b6b7b"/>`;
  s += `<rect x="736" y="118" width="40" height="112" rx="5" fill="${kind === 'it1' ? C.metal : C.plastic}" stroke="#4a5562" stroke-width="2"/>`;
  s += powerSwitch(744, 128, on, hl.has('dut-switch'));
  s += classBadge(744, 196, kind);
  const parts = [[600, 205], [756, 172], [700, 205]];
  parts.forEach(([x, y], i) => {
    s += `<circle cx="${x}" cy="${y}" r="5" fill="#d6dbe0" stroke="#4a5562" stroke-width="1.5"/>`;
    if (hl.has('parts')) s += `<circle cx="${x}" cy="${y}" r="10" fill="none" stroke="${C.accent}" stroke-width="2.5" class="pulse"/>` + t(x + 9, y - 8, String(i + 1), `font-size="10" font-weight="800" fill="#b45309"`);
  });
  s += t(640, 246, 'berührbare Teile: Schrauben, Buchsen', `font-size="8" text-anchor="middle" fill="${C.muted}"`);
  return { svg: s, cableStart: [756, 230], probeTarget: parts[1], parts };
}

function dutSK3(sc) {
  let s = `<rect x="600" y="120" width="130" height="86" rx="10" fill="${C.plastic}" stroke="#5b6b7b" stroke-width="2"/>`;
  s += t(665, 152, 'Gerät SK III', `font-size="12" font-weight="700" text-anchor="middle" fill="${C.text}"`);
  s += t(665, 166, 'z. B. 12-V-Leuchte', `font-size="8.5" text-anchor="middle" fill="${C.muted}"`);
  s += classBadge(612, 174, 'sk3');
  s += `<circle cx="712" cy="190" r="6" fill="#d6dbe0" stroke="#4a5562" stroke-width="1.5"/>`;
  // Versorgungsanschlüsse
  s += `<rect x="586" y="176" width="16" height="22" rx="2" fill="#444"/>`;
  s += t(560, 216, 'Versorgungs-', `font-size="8" fill="${C.muted}"`) + t(560, 226, 'anschluss', `font-size="8" fill="${C.muted}"`);
  // Netzteil (getrennt bzw. angeschlossen)
  const supply = sc.socket === 'terminals-supply';
  s += `<rect x="640" y="290" width="92" height="56" rx="8" fill="#e0e4e8" stroke="#5b6b7b" stroke-width="2"/>`;
  s += t(686, 314, 'Sicherheits-', `font-size="9" text-anchor="middle" fill="${C.text}"`) + t(686, 326, 'trafo / Netzteil', `font-size="9" text-anchor="middle" fill="${C.text}"`);
  if (!supply) s += t(686, 360, '✂ getrennt – spannungsfrei!', `font-size="9.5" font-weight="700" text-anchor="middle" fill="${C.bad}"`);
  return { svg: s, cableStart: [594, 198], probeTarget: [712, 190], parts: [[712, 190]], supply };
}

function dutCord(sc) {
  const hl = new Set(sc.highlight || []);
  let s = '';
  // Steckdosenleiste
  s += `<rect x="560" y="190" width="200" height="48" rx="10" fill="#f4f4f2" stroke="#5b6b7b" stroke-width="2"/>`;
  [0, 1, 2].forEach((i) => {
    const x = 600 + i * 56;
    s += `<circle cx="${x}" cy="214" r="15" fill="#e3e3df" stroke="#999"/><circle cx="${x - 4}" cy="214" r="2" fill="#333"/><circle cx="${x + 4}" cy="214" r="2" fill="#333"/>`;
  });
  s += classBadge(724, 202, 'cord');
  s += t(660, 258, 'Verlängerung / Steckdosenleiste', `font-size="9" text-anchor="middle" fill="${C.muted}"`);
  // Adapter EL1
  s += `<rect x="586" y="128" width="44" height="44" rx="8" fill="#ffd54f" stroke="${hl.has('el1') ? C.accent : '#8a6d00'}" stroke-width="${hl.has('el1') ? 3.5 : 2}" class="${hl.has('el1') ? 'pulse' : ''}"/>`;
  s += t(608, 155, 'EL1', `font-size="12" font-weight="800" text-anchor="middle" fill="#5a4500"`);
  s += `<path d="M608 172 L600 199" stroke="#8a6d00" stroke-width="5"/>`;
  return { svg: s, cableStart: [560, 214], probeTarget: [608, 128], parts: [], el1: [608, 128] };
}

function dutFixed(sc) {
  let s = `<rect x="770" y="70" width="14" height="300" fill="url(#hatch)" stroke="#999"/>`;
  s += `<rect x="600" y="86" width="150" height="190" rx="12" fill="${C.metal}" stroke="#5b6b7b" stroke-width="2"/>`;
  s += t(675, 130, 'Festanschluss', `font-size="12" font-weight="700" text-anchor="middle" fill="${C.text}"`);
  s += t(675, 145, 'z. B. Durchlauferhitzer', `font-size="8.5" text-anchor="middle" fill="${C.muted}"`);
  s += classBadge(612, 238, 'fixed');
  // Klemmleiste
  s += `<rect x="640" y="180" width="70" height="24" rx="3" fill="#f2f2f2" stroke="#666"/>`;
  ['L', 'N', 'PE'].forEach((l, i) => {
    s += `<circle cx="${654 + i * 21}" cy="192" r="5" fill="${l === 'PE' ? C.pe : '#888'}"/>` + t(654 + i * 21, 214, l, `font-size="8" text-anchor="middle" fill="${C.text}"`);
  });
  s += t(690, 266, 'Sicherungen raus, N aufgetrennt', `font-size="8" text-anchor="middle" fill="${C.bad}"`);
  return { svg: s, cableStart: [696, 192], probeTarget: sc.probe === 'l-conductor' ? [654, 192] : [740, 120], parts: [[740, 120]], pe: [696, 192] };
}

// ---------------------------------------------------------------------------
// Aktionen / Hinweise
// ---------------------------------------------------------------------------
function badge(x, y, text, color = C.accent) {
  const w = Math.max(70, text.length * 6.3 + 20);
  return `<g class="pop"><rect x="${x - w / 2}" y="${y - 14}" width="${w}" height="24" rx="12" fill="${color}"/>${t(x, y + 2.5, text, `font-size="10.5" font-weight="700" text-anchor="middle" fill="#fff"`)}</g>`;
}

function waves(points) {
  return points
    .map(([x, y], i) => `<path d="M${x - 12} ${y - 8} q6 -8 12 0 t12 0" fill="none" stroke="${C.accent}" stroke-width="3" stroke-linecap="round" class="wiggle" style="animation-delay:${i * 0.15}s"/>`)
    .join('');
}

function handOff(x, y) {
  return `<g transform="translate(${x},${y})"><circle r="22" fill="#fff" stroke="${C.bad}" stroke-width="3.5"/><path d="M-6 8 v-14 a3 3 0 0 1 6 0 v-4 a3 3 0 0 1 6 0 v4 a3 3 0 0 1 6 0 v10 c0 8 -6 12 -12 12 c-6 0 -9 -4 -12 -8 l-3 -6 a3 3 0 0 1 5 -3 z" fill="#ffe0c2" stroke="#7a4a2a" stroke-width="1.4" transform="translate(-3,-2) scale(0.9)"/><path d="M-16 16 L16 -16" stroke="${C.bad}" stroke-width="4"/></g>`;
}

function magnifier(x, y) {
  return `<g transform="translate(${x},${y})" class="float"><circle r="26" fill="rgba(255,255,255,.35)" stroke="#2d3a46" stroke-width="5"/><path d="M18 18 L40 40" stroke="#2d3a46" stroke-width="9" stroke-linecap="round"/></g>`;
}

function lightning(x, y) {
  return `<path d="M${x} ${y} l-10 22 h9 l-6 20 l18 -27 h-10 l7 -15 z" fill="#ffd54f" stroke="#b45309" stroke-width="1.5" class="blink"/>`;
}

function flipArrows(x, y) {
  return `<g transform="translate(${x},${y})" fill="none" stroke="${C.accent}" stroke-width="3.5" stroke-linecap="round" class="spin"><path d="M-18 -4 a18 18 0 0 1 32 -8"/><path d="M14 -18 l2 7 -7 1"/><path d="M18 4 a18 18 0 0 1 -32 8"/><path d="M-14 18 l-2 -7 7 -1"/></g>`;
}

// ---------------------------------------------------------------------------
// Szene zusammensetzen
// ---------------------------------------------------------------------------
export function renderScene(scene = {}) {
  const sc = { highlight: [], ...scene };
  const hl = new Set(sc.highlight);
  // automatische Hervorhebungen je Aktion
  if (sc.action === 'switch-on') hl.add('dut-switch');
  if (sc.action === 'function-test') {
    hl.add('ft-key');
    sc.mainsOn = true;
  }
  if (sc.action === 'probe-parts' || sc.action === 'flip-plug') hl.add('parts');
  if (sc.probe && sc.probe !== 'parked' && sc.probe !== 'none') hl.add('probe-sockets');
  if (['plug'].includes(sc.socket) && ['connect', 'switch-on'].includes(sc.action)) hl.add('socket');
  if (sc.socket?.startsWith('terminals') && sc.action === 'connect') ['L', 'N'].forEach((k) => hl.add(k));
  if (sc.socket === 'sl-terminal' && sc.action === 'connect') hl.add('SL');
  if (sc.el1) hl.add('el1');
  hl.add('switch');
  sc.highlight = [...hl];

  const dut = sc.dut || 'sk1';
  let D;
  if (dut === 'it1' || dut === 'it2') D = dutIT(dut, sc);
  else if (dut === 'sk3') D = dutSK3(sc);
  else if (dut === 'cord') D = dutCord(sc);
  else if (dut === 'fixed') D = dutFixed(sc);
  else D = dutGeneric(dut === 'sk2' ? 'sk2' : 'sk1', sc);

  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 440" class="scene" role="img" aria-label="Anschluss-Skizze">`;
  s += `<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#aaa" stroke-width="3"/></pattern>
  <style>
    .scene text{font-family:system-ui,"Segoe UI",Roboto,Arial,sans-serif}
    .pulse{animation:pulse 1.4s ease-in-out infinite}
    .blink{animation:blink 1s steps(2,start) infinite}
    .wiggle{animation:wiggle 1s ease-in-out infinite alternate}
    .float{animation:float 2.2s ease-in-out infinite alternate}
    .spin{animation:spin 2.8s linear infinite;transform-box:fill-box;transform-origin:center}
    .pop{animation:pop .5s ease-out}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
    @keyframes blink{to{visibility:hidden}}
    @keyframes wiggle{from{transform:translateY(-3px)}to{transform:translateY(3px)}}
    @keyframes float{from{transform:translate(0,0)}to{transform:translate(14px,8px)}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes pop{from{opacity:0;transform:scale(.8)}to{opacity:1}}
    @media (prefers-reduced-motion:reduce){.pulse,.blink,.wiggle,.float,.spin,.pop{animation:none}}
  </style></defs>`;
  s += `<rect width="800" height="440" fill="transparent"/>`;

  // PC + RS232
  s += `<g><rect x="8" y="10" width="62" height="40" rx="3" fill="#2d3a46"/><rect x="12" y="14" width="54" height="31" fill="#7fb2e5"/><path d="M2 52 h74 l-6 7 h-62 z" fill="#5b6b7b"/>${t(39, 72, 'PC / Laptop', `font-size="8.5" text-anchor="middle" fill="${C.muted}"`)}</g>`;
  s += `<path d="M76 40 C 110 40, 118 60, 121 88" fill="none" stroke="#5b6b7b" stroke-width="3" stroke-dasharray="${sc.connected === false ? '4 4' : '0'}"/>`;
  s += t(88, 30, 'USB-RS232', `font-size="8" fill="${C.muted}"`);
  // Netzsteckdose + Netzleitung (16)
  s += `<rect x="6" y="360" width="50" height="50" rx="6" fill="#f2f2f2" stroke="#888"/><circle cx="31" cy="385" r="15" fill="#e2e2e2" stroke="#999"/><circle cx="27" cy="385" r="2" fill="#333"/><circle cx="35" cy="385" r="2" fill="#333"/>${t(31, 425, '230 V Netz', `font-size="8" text-anchor="middle" fill="${C.muted}"`)}`;
  s += cable('M110 330 C 105 370, 60 370, 46 382');

  s += secutest(sc);
  s += D.svg;

  // Anschlussleitung Prüfling
  const plugX = 482;
  const plugY = 268;
  if (sc.socket === 'plug') {
    const [x0, y0] = D.cableStart;
    s += cable(`M${x0} ${y0} C ${x0} ${y0 + 90}, ${plugX + 70} ${plugY + 40}, ${plugX + 14} ${plugY}`);
    s += `<rect x="${plugX}" y="${plugY - 13}" width="22" height="26" rx="5" fill="#2f3b47"/>`;
    if (sc.action === 'move-cable') s += waves([[x0 - 2, y0 + 50], [x0 - 40, y0 + 78], [plugX + 50, plugY + 28]]);
  } else if (sc.socket?.startsWith('terminals')) {
    const [x0, y0] = D.cableStart;
    s += `<path d="M${x0} ${y0} C 520 ${y0}, 470 136, 422 136" fill="none" stroke="#a52a2a" stroke-width="3"/>`;
    s += `<path d="M${x0} ${y0 + 2} C 520 ${y0 + 20}, 470 172, 422 172" fill="none" stroke="#1565c0" stroke-width="3"/>`;
    s += t(500, 128, 'Prüfleitungen (KS13)', `font-size="8" fill="${C.muted}"`);
    if (D.supply) s += `<path d="M686 290 C 686 250, 610 250, 594 200" fill="none" stroke="#555" stroke-width="3"/>`;
  } else if (sc.socket === 'sl-terminal') {
    s += `<path d="M${D.pe[0]} ${D.pe[1]} C 640 320, 470 300, 422 208" fill="none" stroke="${C.pe}" stroke-width="3.5"/>`;
    s += t(520, 300, 'SL (1) ↔ Schutzleiter PE', `font-size="8.5" fill="${C.pe}"`);
  }

  // Sonde
  const start = [366, 96];
  let tip;
  if (sc.probe === 'el1') tip = D.el1 || D.probeTarget;
  else if (sc.probe && sc.probe !== 'parked' && sc.probe !== 'none') tip = D.probeTarget;
  if (sc.probe === 'el1' && tip) {
    s += `<path d="M352 96 C 360 30, 590 30, ${tip[0] - 6} ${tip[1]}" fill="none" stroke="#8a6d00" stroke-width="3"/><path d="M378 96 C 386 40, 600 40, ${tip[0] + 6} ${tip[1]}" fill="none" stroke="#8a6d00" stroke-width="3"/>`;
  } else if (tip) {
    const [tx, ty] = tip;
    const px = tx - 34;
    const py = ty - 46;
    s += `<path d="${coil(start, [400, 20], [px - 60, py - 70], [px, py])}" fill="none" stroke="${C.probe}" stroke-width="2.2"/>`;
    const a = (Math.atan2(ty - py, tx - px) * 180) / Math.PI;
    s += `<g transform="translate(${px},${py}) rotate(${a})"><rect x="-6" y="-6" width="40" height="12" rx="5" fill="${C.probe}"/><path d="M34 -2 L${Math.hypot(tx - px, ty - py)} 0 L34 2 z" fill="#666"/></g>`;
    s += `<circle cx="${tx}" cy="${ty}" r="13" fill="none" stroke="${C.accent}" stroke-width="3" class="pulse"/>`;
  } else if (sc.probe === 'parked') {
    s += `<path d="${coil([378, 96], [520, 70], [520, 420], [372, 408], 12, 3.5)}" fill="none" stroke="${C.probe}" stroke-width="2" opacity=".75"/>`;
    s += `<g transform="translate(314,408)"><rect x="0" y="-6" width="58" height="12" rx="5" fill="${C.probe}" opacity=".85"/><path d="M0 -2 L-14 0 L0 2 z" fill="#666"/></g>`;
    s += t(343, 430, 'Sonde (hier nicht benötigt)', `font-size="8" text-anchor="middle" fill="${C.muted}"`);
  }

  // Handlung
  const msg = {
    'switch-on': ['Prüfling EINSCHALTEN', C.accent],
    visual: ['Sichtprüfung', '#0b5cad'],
    'move-cable': ['Leitung bewegen!', C.accent],
    'hands-off': ['500 V – nicht berühren', C.bad],
    'probe-parts': ['Alle Metallteile abtasten', C.accent],
    'flip-plug': ['Beide Steckerpositionen', C.accent],
    'function-test': ['Netz an Prüfdose (Taste 14)', '#b45309'],
    result: ['Ergebnis prüfen', C.ok],
    'result-fail': ['Nicht bestanden – Gerät sperren!', C.bad],
    connect: ['Anschließen', '#0b5cad'],
    'measure-voltage': ['Versorgungsspannung messen', '#0b5cad'],
  }[sc.action];
  if (sc.action === 'visual') s += magnifier(690, 196);
  if (sc.action === 'hands-off') s += handOff(705, 300);
  if (sc.action === 'function-test') s += lightning(500, 222);
  if (sc.action === 'flip-plug') s += flipArrows(520, 300);
  if (sc.action === 'result') s += `<g class="pop"><circle cx="705" cy="320" r="26" fill="${C.ok}"/><path d="M692 320 l9 9 l17 -19" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  if (sc.action === 'result-fail') s += `<g class="pop"><circle cx="705" cy="320" r="26" fill="${C.bad}"/><path d="M694 309 l22 22 M716 309 l-22 22" stroke="#fff" stroke-width="5" stroke-linecap="round"/></g>`;
  if (msg) s += badge(620, 395, msg[0], msg[1]);
  s += badge(253, 360, `Drehschalter: ${sc.switchPos || 'AUTO'}`, '#45525f');
  s += '</svg>';
  return s;
}

/** Kleine Legende unter der Grafik */
export function sceneLegend(scene = {}) {
  const items = [`Drehschalter (6) auf „${scene.switchPos || 'AUTO'}“`];
  if (scene.socket === 'plug') items.push('Stecker des Prüflings in Prüfdose (18)');
  if (scene.socket?.startsWith('terminals')) items.push('Prüfleitungen an Buchsen L (3) / N (2)');
  if (scene.socket === 'sl-terminal') items.push('Buchse SL (1) an Schutzleiter');
  if (scene.probe && scene.probe !== 'parked' && scene.probe !== 'none') items.push(scene.probe === 'el1' ? 'Adapter EL1 an Sondenbuchsen (4)/(5)' : 'Sonde an Buchsen (4)/(5), Spitze an markierte Stelle');
  if (scene.action === 'switch-on') items.push('Netzschalter des Prüflings: EIN');
  if (scene.action === 'function-test') items.push('Taste (14) schaltet Netz an die Prüfdose, Lampe (15) leuchtet');
  return items;
}
