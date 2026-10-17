// QR-Scanner für Prüfplaketten: Kamera (Webcam), USB-Handscanner (tippt wie eine Tastatur) oder Foto/Bild
import { h, clear, toast, field, input, fill, choices, dueBadge, skSymbol, fmt } from '../ui.js';
import { get } from '../api.js';

let stream = null;
let loopTimer = null;
let jsQRPromise = null;

function stopCamera() {
  clearTimeout(loopTimer);
  loopTimer = null;
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
}

window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/scan')) stopCamera();
});

/** jsQR erst bei Bedarf laden (Fallback, wenn der Browser keinen BarcodeDetector hat) */
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsQRPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/jsQR.js';
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => reject(new Error('QR-Erkennung konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
  return jsQRPromise;
}

async function detector() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const d = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (source) => (await d.detect(source))[0]?.rawValue || null;
      }
    } catch {
      /* Fallback */
    }
  }
  const jsQR = await loadJsQR();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (source) => {
    const w = source.videoWidth || source.naturalWidth || source.width;
    const hgt = source.videoHeight || source.naturalHeight || source.height;
    if (!w || !hgt) return null;
    const scale = Math.min(1, 1280 / Math.max(w, hgt));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(hgt * scale);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null;
  };
}

const PREF_KEY = 'scanAction';
const pref = () => {
  try {
    return localStorage.getItem(PREF_KEY) || 'show';
  } catch {
    return 'show';
  }
};

export async function renderScan({ navigate }) {
  stopCamera();
  const result = h('div');
  const video = h('video', { playsinline: true, muted: true, class: 'scan-video' });
  const camBox = h('div', { class: 'scan-cam' }, h('div', { class: 'scan-hint' }, 'Kamera ist aus'));
  const camBtn = h('button', { class: 'btn primary', onclick: () => (stream ? (stopCamera(), resetCam()) : startCamera()) }, '📷 Kamera starten');
  const manual = input({ placeholder: 'Code scannen oder eintippen, z. B. G-0012', autocomplete: 'off', class: 'input mono', style: { fontSize: '1.15rem' } });
  const fileInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' }, onchange: (e) => e.target.files[0] && scanFile(e.target.files[0]) });
  const after = choices(
    [
      { value: 'show', icon: '🔎', title: 'Gerät anzeigen', text: 'Gerätedaten, Historie und Prüfstatus öffnen.' },
      { value: 'inspect', icon: '✅', title: 'Gleich prüfen', text: 'Direkt den Prüfassistenten für das Gerät starten.' },
      { value: 'stay', icon: '📋', title: 'Hier bleiben', text: 'Ergebnis anzeigen und gleich die nächste Plakette scannen.' },
    ],
    pref(),
    {
      cols: 3,
      onchange: (v) => {
        try {
          localStorage.setItem(PREF_KEY, v);
        } catch {
          /* egal */
        }
      },
    }
  );
  let busy = false;
  let lastCode = '';

  const resetCam = () => {
    fill(camBox, h('div', { class: 'scan-hint' }, 'Kamera ist aus'));
    camBtn.textContent = '📷 Kamera starten';
  };

  async function lookup(code) {
    code = String(code || '').trim();
    if (!code || busy) return;
    busy = true;
    try {
      const r = await get(`/devices/lookup?code=${encodeURIComponent(code)}`);
      const d = r.device;
      stopCamera();
      resetCam();
      fill(
        result,
        h(
          'div',
          { class: 'card stack scan-result' },
          h('div', { class: 'row' }, skSymbol(d.protection_class, 30), h('div', { class: 'grow' }, h('div', { class: 'muted mono' }, d.inventory_no), h('h2', { style: { margin: 0 } }, d.name), h('div', { class: 'small muted' }, [d.manufacturer, d.model, d.location].filter(Boolean).join(' · '))), dueBadge(d)),
          h('div', { class: 'small muted' }, 'Gescannt: ', h('code', {}, r.parsed.raw)),
          h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/inspect?device=${d.id}` }, '✅ Jetzt prüfen'), h('a', { class: 'btn', href: `#/devices/${d.id}` }, '🔎 Gerät öffnen'), h('button', { class: 'btn ghost', onclick: () => (clear(result), manual.focus()) }, 'Nächsten Code scannen'))
        )
      );
      toast(`Gefunden: ${d.inventory_no} ${d.name}`, 'ok');
      if (after.value === 'inspect') navigate(`#/inspect?device=${d.id}`);
      else if (after.value === 'show') navigate(`#/devices/${d.id}`);
    } catch (e) {
      fill(result, h('div', { class: `alert ${e.data?.code === 'OTHER_DB' ? 'warn' : 'bad'}` }, h('b', {}, 'Nicht gefunden: '), e.message, h('div', { class: 'small', style: { marginTop: '4px' } }, 'Gescannt: ', h('code', {}, code))));
    } finally {
      busy = false;
      manual.value = '';
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return toast('Dieser Browser erlaubt keinen Kamerazugriff.', 'bad');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch (e) {
      return toast(`Kamera nicht verfügbar: ${e.message}`, 'bad', 7000);
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    fill(camBox, video, h('div', { class: 'scan-frame' }));
    camBtn.textContent = '■ Kamera stoppen';
    const detect = await detector();
    const tick = async () => {
      if (!stream) return;
      try {
        const code = await detect(video);
        if (code && code !== lastCode) {
          lastCode = code;
          setTimeout(() => (lastCode = ''), 3000);
          await lookup(code);
        }
      } catch {
        /* nächster Versuch */
      }
      if (stream) loopTimer = setTimeout(tick, 250);
    };
    tick();
  }

  async function scanFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const code = await (await detector())(img);
      if (code) await lookup(code);
      else fill(result, h('div', { class: 'alert warn' }, 'Auf dem Bild wurde kein QR-Code gefunden. Tipp: Plakette formatfüllend und scharf fotografieren.'));
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      URL.revokeObjectURL(url);
      fileInput.value = '';
    }
  }

  // USB-Handscanner „tippen“ den Inhalt und schließen mit Enter ab
  manual.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      lookup(manual.value);
    }
  });
  setTimeout(() => manual.focus(), 50);

  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, '📷 Prüfplakette scannen')),
    h(
      'div',
      { class: 'grid c2' },
      h(
        'div',
        { class: 'card stack' },
        h('h2', {}, 'Mit der Kamera'),
        camBox,
        h('div', { class: 'row' }, camBtn, h('button', { class: 'btn', onclick: () => fileInput.click() }, '🖼 Foto/Bild wählen …'), fileInput),
        h('p', { class: 'small muted' }, 'Webcam oder eingebaute Kamera auf den QR-Code der Prüfplakette richten. Der Browser fragt beim ersten Mal nach der Erlaubnis. Das Bild bleibt auf diesem Rechner.')
      ),
      h(
        'div',
        { class: 'card stack' },
        h('h2', {}, 'Mit USB-Handscanner oder per Tastatur'),
        field('Code', manual, 'Handscanner einfach auslösen – sie „tippen“ den Inhalt und drücken Enter. Funktioniert auch mit Inventar- oder Seriennummer.'),
        h('h3', {}, 'Nach dem Scannen'),
        after
      )
    ),
    result
  );
}
