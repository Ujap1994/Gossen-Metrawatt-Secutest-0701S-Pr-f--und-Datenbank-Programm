// Einstellungen (Allgemein, Erinnerungen, Sicherheit & Speicherort, Programm), Prüfungsliste, Änderungsprotokoll
import { h, clear, fmt, toast, field, input, select, modal, resultBadge, confirmDialog, add, fill, choices, subTabs } from '../ui.js';
import { get, post, put } from '../api.js';
import { state, loadMeta, procName } from '../state.js';

const SETTINGS_TABS = [
  ['#/settings', '⚙️ Allgemein'],
  ['#/reminders', '🔔 Erinnerungen'],
  ['#/settings/security', '🔐 Sicherheit & Speicherort'],
  ['#/settings/program', '🖥 Programm'],
];
const PROVIDER = { onedrive: ['☁️', 'OneDrive'], icloud: ['🍏', 'iCloud Drive'], local: ['💻', 'Lokal / eigener Ordner'] };

function settingsHead(active, title = 'Einstellungen') {
  return [h('div', { class: 'page-head' }, h('h1', {}, title)), subTabs(SETTINGS_TABS, active)];
}

// ---------------------------------------------------------------------------
// Einstellungen – Allgemein
// ---------------------------------------------------------------------------
export async function renderSettings({ navigate }) {
  const meta = await loadMeta();
  const s = meta.settings;
  const f = (path, attrs = {}) => {
    const [a, b] = path.split('.');
    const v = b ? s[a]?.[b] : s[a];
    const el = input({ value: v ?? '', ...attrs });
    el.dataset.path = path;
    return el;
  };
  const form = h('div', { class: 'stack' });
  const dbName = input({ value: meta.db.name });
  const profile = select(meta.profiles.map((p) => [p.id, p.name]), s.limitProfile);
  const std = select([['VDE 0702', 'DIN VDE 0702 (Wiederholungsprüfung)'], ['VDE 0701', 'DIN VDE 0701 (nach Instandsetzung)']], s.defaultStandard);
  const corr = h('input', { type: 'checkbox', checked: s.manualDisplayCorrection });
  const env = select([['', '— nicht festgelegt —'], ...meta.environments.map((e) => [e.id, e.label])], s.defaultUsageEnv || '');

  const save = async () => {
    const patch = { owner: {}, inspector: {} };
    for (const el of form.querySelectorAll('[data-path]')) {
      const [a, b] = el.dataset.path.split('.');
      const val = el.type === 'number' ? Number(el.value) : el.value;
      if (b) (patch[a] ||= {})[b] = val;
      else patch[a] = val;
    }
    patch.limitProfile = profile.value;
    patch.defaultStandard = std.value;
    patch.manualDisplayCorrection = corr.checked;
    patch.defaultUsageEnv = env.value;
    patch.db_name = dbName.value;
    try {
      await put('/settings', patch);
      await loadMeta();
      toast('Einstellungen gespeichert', 'ok');
      navigate('#/settings');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  add(
    form,
    h('fieldset', {}, h('legend', {}, 'Datenbank'), h('div', { class: 'grid c2' }, field('Name', dbName), field('Datei', h('code', { style: { wordBreak: 'break-all' } }, meta.db.file))), h('p', { class: 'small muted' }, `Angelegt ${fmt.dateTime(meta.db.created_at)} · Rechner: ${meta.db.host} · `, h('a', { href: '#/settings/security' }, 'Speicherort ändern / Datenbank verschieben'))),
    h('fieldset', {}, h('legend', {}, 'Eigentümer / Kunde'), h('div', { class: 'grid c3' }, field('Name', f('owner.name')), field('Straße', f('owner.street')), field('PLZ', f('owner.zip')), field('Ort', f('owner.city')), field('Telefon', f('owner.phone')), field('E-Mail', f('owner.email', { type: 'email' })))),
    h('fieldset', {}, h('legend', {}, 'Prüfer'), h('div', { class: 'grid c3' }, field('Name', f('inspector.name')), field('Qualifikation', f('inspector.qualification')), field('Firma (optional)', f('inspector.company')))),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Prüfung'),
      h('div', { class: 'grid c3' }, field('Grenzwert-Profil', profile), field('Standard-Norm', std), field('Standard-Prüfintervall für neue Geräte (Monate)', f('defaultIntervalMonths', { type: 'number', min: 1, max: 120 }), 'Bestehende Geräte: Geräte → auswählen → ⏱ Prüfintervall ändern'), field('Standard-Einsatzbereich neuer Geräte', env, 'für den Intervallvorschlag nach DGUV V3'), field('Präfix Inventarnummer', f('inventoryPrefix')), field('Automatisch sperren nach (Minuten)', f('autoLockMinutes', { type: 'number', min: 1, max: 240 }))),
      h('label', { class: 'check', style: { marginTop: '8px' } }, corr, 'Manuelle Eingabe: SECUTEST-Anzeigewerte mit Gebrauchsfehler-Tabelle bewerten (Anhang der Anleitung)')
    ),
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: save }, 'Speichern'))
  );

  return h(
    'div',
    {},
    settingsHead('#/settings'),
    h('div', { class: 'card' }, form),
    h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'row between' }, h('div', {}, h('b', {}, 'Weitere Datenbank'), h('div', { class: 'small muted' }, 'Für Bekannte eine eigene, getrennte Datenbank anlegen oder eine andere öffnen.')), h('button', { class: 'btn', onclick: async () => (await confirmDialog('Aktuelle Datenbank sperren und zur Datenbank-Auswahl wechseln?')) && (await post('/lock'), location.reload()) }, 'Datenbank wechseln / neu anlegen')))
  );
}

// ---------------------------------------------------------------------------
// Einstellungen – Sicherheit & Speicherort
// ---------------------------------------------------------------------------

/**
 * Bestätigung für kritische Aktionen: mit 2FA → Code, sonst mit Passwort → aktuelles Passwort,
 * sonst nur „OK“. Liefert {code} / {current} / {} oder null (abgebrochen).
 */
async function askReauth(sec, { title, body, confirmLabel = 'Weiter', danger = false, validate }) {
  const code = sec.twoFactor ? input({ class: 'input code', inputmode: 'numeric', maxlength: 6, placeholder: '000000', autocomplete: 'one-time-code' }) : null;
  const rec = sec.twoFactor ? input({ placeholder: 'XXXXX-XXXXX', autocomplete: 'off', style: { maxWidth: '240px' } }) : null;
  const pw = !sec.twoFactor && sec.encrypted ? input({ type: 'password', autocomplete: 'current-password' }) : null;
  let useRec = false;
  const codeBox = h('div');
  const renderCode = () =>
    fill(
      codeBox,
      useRec ? field('Wiederherstellungscode', rec, 'Wird dabei verbraucht.') : field('Aktueller Code aus der Authenticator-App', code),
      h('a', { href: '#', class: 'small', onclick: (e) => (e.preventDefault(), (useRec = !useRec), renderCode()) }, useRec ? 'Code aus der App verwenden' : 'Handy nicht zur Hand? Wiederherstellungscode verwenden')
    );
  if (code) renderCode();
  return modal({
    title,
    body: h('div', { class: 'stack' }, body, code ? codeBox : null, pw ? field('Aktuelles Passwort der Datenbank', pw) : null),
    actions: [
      { label: 'Abbrechen', value: null },
      {
        label: confirmLabel,
        class: danger ? 'danger' : 'primary',
        onClick: () => {
          if (validate && validate() === false) return false;
          if (code && useRec) return rec.value.trim() ? { recoveryCode: rec.value.trim() } : (rec.classList.add('invalid'), false);
          if (code) return code.value.length === 6 ? { code: code.value } : (code.classList.add('invalid'), false);
          if (pw) return pw.value ? { current: pw.value } : (pw.classList.add('invalid'), false);
          return {};
        },
      },
    ],
  });
}

function showRecoveryCodes(codes) {
  return modal({ title: 'Wiederherstellungscodes', body: h('div', { class: 'stack' }, h('p', {}, 'Falls dein Handy verloren geht, meldest du dich mit einem dieser Codes an. Jeder Code gilt einmal. Bitte ausdrucken oder z. B. in Bitwarden speichern – sie werden nur jetzt angezeigt.'), h('div', { class: 'codes' }, codes.map((c) => h('span', {}, c))), h('button', { class: 'btn', onclick: () => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Kopiert', 'ok')) }, '📋 Kopieren')) });
}

export async function renderSecuritySettings({ navigate }) {
  const meta = await loadMeta();
  const sec = meta.security;
  const backups = await get('/backups').catch(() => []);
  const plainBackups = backups.filter((b) => !b.encrypted);
  const reload = async () => (await loadMeta(), navigate('#/settings/security'));
  const fail = (e) => toast(e.message, 'bad', 7000);

  const newPasswordFields = () => {
    const p1 = input({ type: 'password', autocomplete: 'new-password' });
    const p2 = input({ type: 'password', autocomplete: 'new-password' });
    return { p1, p2, body: h('div', { class: 'grid c2' }, field('Neues Passwort (mind. 8 Zeichen)', p1), field('Wiederholen', p2)), validate: () => (p1.value.length >= 8 && p1.value === p2.value ? true : (toast(p1.value.length < 8 ? 'Mindestens 8 Zeichen.' : 'Die Passwörter stimmen nicht überein.', 'warn'), false)) };
  };

  const offerPurge = async (n) => {
    if (!n) return;
    if (await confirmDialog(`Es gibt noch ${n} Sicherung(en) aus der Zeit ohne Passwort. Diese Dateien sind unverschlüsselt lesbar. Jetzt löschen? (Eine verschlüsselte Sicherung wird beim nächsten Öffnen bzw. über „Sicherung jetzt erstellen“ angelegt.)`, { title: 'Unverschlüsselte Sicherungen', confirmLabel: 'Löschen', danger: true })) {
      const r = await post('/security/backups/purge-plain').catch(fail);
      if (r) toast(`${r.removed} unverschlüsselte Sicherung(en) gelöscht`, 'ok');
    }
  };

  const setPassword = async () => {
    const np = newPasswordFields();
    const auth = await askReauth(sec, {
      title: sec.encrypted ? 'Passwort ändern' : 'Passwort festlegen (Datenbank verschlüsseln)',
      body: h('div', { class: 'stack' }, np.body, h('p', { class: 'small muted' }, sec.encrypted ? 'Vorher wird automatisch eine Sicherung erstellt. Andere Rechner benötigen danach ebenfalls das neue Passwort.' : 'Die Datei wird mit AES-256 verschlüsselt. Vorher wird automatisch eine Sicherung erstellt. Bewahre das Passwort sicher auf (z. B. in Bitwarden) – ohne Passwort ist die Datei nicht wiederherstellbar.')),
      confirmLabel: sec.encrypted ? 'Passwort ändern' : 'Verschlüsseln',
      validate: np.validate,
    });
    if (!auth) return;
    try {
      const r = await post('/security/password', { ...auth, next: np.p1.value, next2: np.p2.value });
      toast(sec.encrypted ? 'Passwort geändert' : 'Datenbank ist jetzt verschlüsselt', 'ok');
      await offerPurge(r.plainBackups);
      reload();
    } catch (e) {
      fail(e);
    }
  };

  const removePassword = async () => {
    const auth = await askReauth(sec, {
      title: 'Passwort entfernen (Verschlüsselung aufheben)',
      body: h('div', { class: 'alert bad' }, h('b', {}, 'Achtung:'), 'Die Datei wird entschlüsselt. Danach kann jeder, der Zugriff auf die Datei hat (dieser Rechner, die Cloud, ein USB-Stick), alle Geräte, Prüfungen und Kontaktdaten lesen. Das gilt auch für neue Sicherungen.'),
      confirmLabel: 'Verschlüsselung entfernen',
      danger: true,
    });
    if (!auth) return;
    try {
      await post('/security/password/remove', { ...auth, confirm: true });
      toast('Verschlüsselung entfernt – die Datenbank öffnet sich jetzt ohne Passwort.', 'warn', 6000);
      reload();
    } catch (e) {
      fail(e);
    }
  };

  const setup2fa = async () => {
    const auth = await askReauth(sec, {
      title: sec.twoFactor ? 'Zwei-Faktor-Anmeldung neu einrichten' : 'Zwei-Faktor-Anmeldung einrichten',
      body: h('p', {}, sec.twoFactor ? 'Z. B. bei einem neuen Handy. Danach gilt nur noch der neue Eintrag in der App.' : 'Beim Öffnen der Datenbank wird zusätzlich ein 6-stelliger Code aus einer Authenticator-App abgefragt (Bitwarden Authenticator, Microsoft/Google Authenticator, Aegis, 2FAS …).'),
    });
    if (!auth) return;
    try {
      const r = await post('/security/2fa/begin', auth);
      const c2 = input({ class: 'input code', inputmode: 'numeric', maxlength: 6, placeholder: '000000', autocomplete: 'one-time-code' });
      const res = await modal({
        title: 'QR-Code mit der Authenticator-App scannen',
        body: h('div', { class: 'stack' }, h('ol', { class: 'instr' }, h('li', {}, 'App öffnen → „+“ / Konto hinzufügen → QR-Code scannen (oder Schlüssel eingeben).'), h('li', {}, 'Den angezeigten 6-stelligen Code eintragen.')), h('div', { class: 'qr-box' }, h('img', { src: r.qr, alt: 'QR-Code' }), h('code', { style: { wordBreak: 'break-all' } }, r.secret.replace(/(.{4})/g, '$1 ').trim())), field('Code aus der App', c2)),
        actions: [
          { label: 'Abbrechen', value: null },
          {
            label: 'Bestätigen',
            class: 'primary',
            onClick: async () => {
              try {
                return await post('/security/2fa/finish', { code: c2.value });
              } catch (e) {
                fail(e);
                return false;
              }
            },
          },
        ],
      });
      if (!res) return;
      toast(sec.twoFactor ? 'Zwei-Faktor-Anmeldung neu eingerichtet' : 'Zwei-Faktor-Anmeldung aktiviert', 'ok');
      if (res.recoveryCodes) await showRecoveryCodes(res.recoveryCodes);
      reload();
    } catch (e) {
      fail(e);
    }
  };

  const disable2fa = async () => {
    const auth = await askReauth(sec, { title: 'Zwei-Faktor-Anmeldung abschalten', body: h('div', { class: 'alert warn' }, 'Die Datenbank öffnet sich danach nur noch mit dem Passwort', sec.encrypted ? '' : ' – bzw. ganz ohne Abfrage, da kein Passwort gesetzt ist', '. Wiederherstellungscodes werden ungültig.'), confirmLabel: '2FA abschalten', danger: true });
    if (!auth) return;
    try {
      await post('/security/2fa/disable', auth);
      toast('Zwei-Faktor-Anmeldung abgeschaltet', 'warn');
      reload();
    } catch (e) {
      fail(e);
    }
  };

  const newRecovery = async () => {
    const auth = await askReauth(sec, { title: 'Neue Wiederherstellungscodes', body: h('p', {}, 'Die bisherigen Codes werden ungültig.') });
    if (!auth) return;
    try {
      const r = await post('/security/recovery', auth);
      await showRecoveryCodes(r.codes);
      reload();
    } catch (e) {
      fail(e);
    }
  };

  const move = async () => {
    const locs = await get('/database/locations');
    const currentDir = locs.current.replace(/[\\/][^\\/]+$/, '');
    const opts = [
      ...locs.cloud.map((c) => ({ value: c.folder, icon: PROVIDER[c.provider]?.[0], title: c.label, text: c.folder })),
      { value: locs.local, icon: '💻', title: 'Nur auf diesem Rechner (lokal)', text: locs.local },
      { value: '__custom', icon: '📁', title: 'Eigener Ordner …', text: 'USB-Stick, NAS, Nextcloud/Dropbox …' },
    ].map((o) => (o.value === currentDir ? { ...o, disabled: true, title: `${o.title} (aktueller Ort)` } : o));
    const custom = input({ placeholder: 'Absoluter Ordnerpfad', style: { display: 'none' } });
    const firstFree = opts.find((o) => !o.disabled);
    const target = choices(opts, firstFree?.value, { cols: Math.min(3, opts.length), onchange: (v) => (custom.style.display = v === '__custom' ? '' : 'none') });
    const withBackups = h('input', { type: 'checkbox', checked: true });
    const code = sec.twoFactor ? input({ class: 'input code', inputmode: 'numeric', maxlength: 6, placeholder: '000000' }) : null;
    const pw = sec.encrypted ? input({ type: 'password', autocomplete: 'current-password' }) : null;
    const r = await modal({
      title: 'Datenbank verschieben',
      wide: true,
      body: h(
        'div',
        { class: 'stack' },
        h('p', { class: 'small muted' }, 'Aktuell: ', h('code', { style: { wordBreak: 'break-all' } }, locs.current)),
        field('Neuer Speicherort', target),
        custom,
        h('label', { class: 'check' }, withBackups, 'Sicherungen (Ordner „Sicherungen“) mitnehmen'),
        h('div', { class: 'alert info small' }, 'Ablauf: Sicherung → Kopie am neuen Ort → Kopie wird geöffnet und geprüft → erst dann wird die alte Datei entfernt. Andere Rechner finden die Datenbank in OneDrive/iCloud automatisch; ein eigener Ordner muss dort über „Datei hinzufügen“ eingetragen werden.'),
        code ? field('Aktueller Code aus der Authenticator-App', code) : null,
        pw ? field('Passwort der Datenbank', pw, 'Wird zum Öffnen der Kopie benötigt.') : null
      ),
      actions: [
        { label: 'Abbrechen', value: null },
        {
          label: 'Verschieben',
          class: 'primary',
          onClick: async () => {
            const folder = target.value === '__custom' ? custom.value.trim() : target.value;
            if (!folder) return (toast('Bitte einen Zielordner wählen.', 'warn'), false);
            try {
              return await post('/database/move', { folder, withBackups: withBackups.checked, code: code?.value, current: pw?.value, password: pw?.value });
            } catch (e) {
              fail(e);
              return false;
            }
          },
        },
      ],
    });
    if (!r) return;
    toast(`Datenbank verschoben nach ${r.file}${r.backups ? ` (${r.backups} Sicherungen mitgenommen)` : ''}`, 'ok', 7000);
    reload();
  };

  const backup = async () => {
    try {
      const r = await post('/backup');
      toast(`Sicherung erstellt: ${r.file}`, 'ok', 6000);
      reload();
    } catch (e) {
      fail(e);
    }
  };

  const state_ = (on, onText, offText) => h('span', { class: `sec-state ${on ? 'on' : 'off'}` }, on ? `✅ ${onText}` : `⚠ ${offText}`);
  const [pIcon, pName] = PROVIDER[meta.db.provider] || PROVIDER.local;

  return h(
    'div',
    {},
    settingsHead('#/settings/security'),
    !sec.encrypted && !sec.twoFactor ? h('div', { class: 'alert warn' }, h('b', {}, 'Diese Datenbank ist ungeschützt:'), 'kein Passwort und keine Zwei-Faktor-Anmeldung. Für Kundendaten oder Datenbanken in der Cloud wird mindestens ein Passwort empfohlen.') : null,
    h(
      'div',
      { class: 'grid c2' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '🔐 Zugangsschutz'),
        h('p', { class: 'small muted' }, 'Beides ist freiwillig und lässt sich jederzeit ein- und ausschalten.'),
        h(
          'div',
          { class: 'sec-row' },
          h('span', { class: 'ico' }, '🔑'),
          h('div', { class: 'grow' }, h('div', {}, h('b', {}, 'Passwort & Verschlüsselung '), state_(sec.encrypted, 'aktiv (AES-256)', 'aus – Datei unverschlüsselt')), h('div', { class: 'small muted' }, sec.encrypted ? 'Ohne Passwort ist die Datei unlesbar (SQLCipher, PBKDF2-SHA512).' : 'Jeder mit Zugriff auf die Datei kann die Daten lesen.'), h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: setPassword }, sec.encrypted ? 'Passwort ändern' : 'Passwort festlegen'), sec.encrypted ? h('button', { class: 'btn ghost', onclick: removePassword }, 'Passwort entfernen') : null))
        ),
        h(
          'div',
          { class: 'sec-row' },
          h('span', { class: 'ico' }, '📱'),
          h('div', { class: 'grow' }, h('div', {}, h('b', {}, 'Zwei-Faktor-Anmeldung '), state_(sec.twoFactor, 'aktiv', 'aus')), h('div', { class: 'small muted' }, 'Zusätzlicher Code aus der Authenticator-App beim Öffnen (TOTP).'), h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: setup2fa }, sec.twoFactor ? '2FA neu einrichten' : '2FA einrichten'), sec.twoFactor ? h('button', { class: 'btn ghost', onclick: disable2fa }, '2FA abschalten') : null))
        ),
        sec.twoFactor ? h('div', { class: 'sec-row' }, h('span', { class: 'ico' }, '🧾'), h('div', { class: 'grow' }, h('div', {}, h('b', {}, 'Wiederherstellungscodes '), h('span', { class: 'muted' }, `${sec.recoveryRemaining} übrig`)), h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: newRecovery }, 'Neue Codes erzeugen')))) : null
      ),
      h(
        'div',
        { class: 'card stack' },
        h('h2', {}, '📁 Speicherort'),
        h('div', {}, h('span', { class: 'badge info' }, `${pIcon} ${pName}`)),
        h('code', { style: { wordBreak: 'break-all' } }, meta.db.file),
        h('p', { class: 'small muted' }, 'Die Datenbank kann lokal auf diesem Rechner, in OneDrive/iCloud Drive (automatisch auf allen Geräten) oder in einem eigenen Ordner liegen.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: move }, 'Datenbank verschieben …'))
      )
    ),
    h(
      'div',
      { class: 'card stack', style: { marginTop: '14px' } },
      h('h2', {}, '💾 Sicherung & Export'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: backup }, 'Sicherung jetzt erstellen'), h('a', { class: 'btn', href: '/api/export.json' }, 'Export JSON'), h('a', { class: 'btn', href: '/api/export.csv' }, 'Export CSV (Excel)')),
      h('p', { class: 'small muted' }, `Automatische Sicherung beim ersten Öffnen jedes Tages (max. 15) im Ordner „Sicherungen“ neben der Datenbank${sec.encrypted ? ' – ebenfalls verschlüsselt' : ' – derzeit unverschlüsselt'}.`),
      sec.encrypted && plainBackups.length ? h('div', { class: 'alert warn small' }, `${plainBackups.length} Sicherung(en) stammen aus der Zeit ohne Passwort und sind unverschlüsselt. `, h('button', { class: 'btn sm', onclick: async () => (await offerPurge(plainBackups.length), reload()) }, 'Jetzt löschen …')) : null,
      backups.length ? h('ul', { class: 'small' }, backups.slice(0, 6).map((b) => h('li', {}, `${b.name} (${Math.round(b.size / 1024)} KB)${b.encrypted ? '' : ' – unverschlüsselt'}`))) : null
    )
  );
}

// ---------------------------------------------------------------------------
// Einstellungen – Programm (dieser Rechner)
// ---------------------------------------------------------------------------
/** Kalibrierzustand als Text (für Einstellungen, Übersicht, Prüfassistent) */
export function calibrationText(c) {
  if (!c || c.state === 'off') return null;
  if (c.state === 'unknown') return 'Kalibrierdatum des SECUTEST ist noch nicht eingetragen.';
  if (c.state === 'overdue') return `Kalibrierung des SECUTEST ist seit ${-c.daysLeft} Tag(en) überfällig (fällig am ${fmt.date(c.nextDate)}).`;
  if (c.state === 'soon') return `Kalibrierung des SECUTEST ist in ${c.daysLeft} Tag(en) fällig (${fmt.date(c.nextDate)}).`;
  return `Kalibriert bis ${fmt.date(c.nextDate)}.`;
}

export async function renderProgramSettings({ navigate }) {
  const st = await get('/secutest/status');
  const cfg = st.config || {};
  const terminal = h('input', { type: 'checkbox', checked: cfg.terminal !== false });
  const auto = h('input', { type: 'checkbox', checked: cfg.autoConnect !== false });
  const save = async () => {
    try {
      await put('/secutest/config', { terminal: terminal.checked, autoConnect: auto.checked });
      toast('Gespeichert', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
  terminal.addEventListener('change', save);
  auto.addEventListener('change', save);

  // ---------- Kalibrier-Erinnerung ----------
  const cal = await get('/secutest/calibration');
  const calOn = h('input', { type: 'checkbox', checked: cal.enabled });
  const lastDate = input({ type: 'date', value: cal.lastDate || '', max: fmt.today() });
  const interval = select([[12, '12 Monate (übliche Empfehlung)'], [24, '24 Monate'], [36, '36 Monate'], [6, '6 Monate']].some(([v]) => v === cal.intervalMonths) ? [[12, '12 Monate (übliche Empfehlung)'], [24, '24 Monate'], [36, '36 Monate'], [6, '6 Monate']] : [[cal.intervalMonths, `${cal.intervalMonths} Monate`], [12, '12 Monate (übliche Empfehlung)'], [24, '24 Monate'], [36, '36 Monate']], cal.intervalMonths);
  const warnDays = input({ type: 'number', min: 0, max: 180, value: cal.warnDays, style: { maxWidth: '110px' } });
  const deviceId = input({ value: cal.deviceId, placeholder: 'vom Typschild oder per IDN?' });
  const calNo = input({ value: cal.calibrationNo, placeholder: 'z. B. 05', style: { maxWidth: '120px' } });
  const lab = input({ value: cal.lab, placeholder: 'Kalibrierlabor / Zertifikat-Nr. (optional)' });
  const calFields = h('div', { class: 'stack' });
  const stateBox = h('div');
  const drawState = (c) => {
    const txt = calibrationText(c);
    fill(
      stateBox,
      c.enabled
        ? h('div', { class: `alert ${c.state === 'ok' ? 'ok' : c.state === 'overdue' ? 'bad' : 'warn'} small` }, h('span', { class: `cal-state ${c.state}` }, c.state === 'ok' ? '✅ ' : '⚠ '), txt, c.nextDate ? [' ', h('a', { href: '/api/secutest/calibration.ics' }, '📅 Termin in den Kalender')] : null)
        : h('div', { class: 'small muted' }, 'Ausgeschaltet – es erscheinen keine Hinweise.'),
      c.changedOnDevice ? h('div', { class: 'alert warn small' }, `Das verbundene SECUTEST meldet die Kalibrier-Nr. ${c.deviceCalibrationNo} (gespeichert: ${c.calibrationNo}). Wurde es neu kalibriert? Dann Datum und Nummer aktualisieren.`) : null
    );
    calFields.style.display = c.enabled ? '' : 'none';
  };
  const saveCal = async () => {
    try {
      const c = await put('/secutest/calibration', { enabled: calOn.checked, lastDate: lastDate.value, intervalMonths: Number(interval.value), warnDays: Number(warnDays.value), deviceId: deviceId.value, calibrationNo: calNo.value, lab: lab.value });
      drawState(c);
      await loadMeta();
      toast('Kalibrierdaten gespeichert', 'ok');
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };
  const fromDevice = async () => {
    try {
      const c = await post('/secutest/calibration/from-device');
      deviceId.value = c.deviceId;
      calNo.value = c.calibrationNo;
      drawState(c);
      toast('Geräte-ID und Kalibrier-Nr. aus dem SECUTEST übernommen', 'ok');
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };
  calOn.addEventListener('change', () => (calFields.style.display = calOn.checked ? '' : 'none', saveCal()));
  add(
    calFields,
    h('div', { class: 'grid c3' }, field('Letzte Kalibrierung am', lastDate, 'Datum auf Kalibrierschein bzw. Prüfmarke'), field('Kalibrierintervall', interval, 'Herstellerempfehlung bzw. eigene Festlegung'), field('Vorwarnung (Tage vorher)', warnDays)),
    h('div', { class: 'grid c3' }, field('Geräte-ID / Seriennummer', deviceId), field('Kalibrier-Nr. (IDN „AC“)', calNo), field('Labor / Zertifikat', lab)),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: saveCal }, 'Speichern'), h('button', { class: 'btn', onclick: fromDevice, disabled: !st.connected, title: st.connected ? '' : 'SECUTEST nicht verbunden' }, '📟 Geräte-ID & Kalibrier-Nr. aus SECUTEST übernehmen'))
  );
  drawState(cal);

  return h(
    'div',
    {},
    settingsHead('#/settings/program'),
    h(
      'div',
      { class: 'card stack' },
      h('h2', {}, '📏 Kalibrierung des SECUTEST'),
      h('p', { class: 'small muted' }, 'Messgeräte für die Prüfung nach DIN VDE 0701-0702 müssen regelmäßig kalibriert werden. Mit eingeschalteter Erinnerung warnt das Programm in der Übersicht und vor jeder Prüfung rechtzeitig, und der Kalibrierstand erscheint im Prüfprotokoll.'),
      h('label', { class: 'check' }, calOn, h('b', {}, 'Kalibrier-Erinnerung einschalten')),
      stateBox,
      calFields
    ),
    h(
      'div',
      { class: 'card stack', style: { marginTop: '14px' } },
      h('h2', {}, '📟 SECUTEST-Schnittstelle'),
      h('p', { class: 'small muted' }, 'Diese Einstellungen gelten für dieses Programm auf diesem Rechner (nicht je Datenbank) – ebenso die Kalibrierdaten oben.'),
      h('label', { class: 'check' }, terminal, h('span', {}, h('b', {}, 'RS-232-Terminal anzeigen'), h('div', { class: 'small muted' }, 'Freie Befehle an das SECUTEST senden (für Fehlersuche und Fortgeschrittene). Ausgeschaltet ist das Terminal auf der SECUTEST-Seite ausgeblendet und gesperrt.'))),
      h('label', { class: 'check' }, auto, h('span', {}, h('b', {}, 'USB-RS232-Adapter automatisch erkennen und verbinden'), h('div', { class: 'small muted' }, 'Eingesteckte Adapter werden angepingt; antwortet ein SECUTEST, wird verbunden.'))),
      h('p', { class: 'small' }, 'Weitere Schnittstellen-Einstellungen (Adresse, Timeout, Schalterstellungen) findest du auf der ', h('a', { href: '#/secutest' }, 'SECUTEST-Seite'), '.')
    )
  );
}

// ---------------------------------------------------------------------------
// Erinnerungen
// ---------------------------------------------------------------------------
export async function renderReminders({ navigate }) {
  const meta = await loadMeta();
  const r = meta.settings.reminders;
  const log = await get('/reminders/log').catch(() => []);
  const enabled = h('input', { type: 'checkbox', checked: r.enabled });
  const channel = choices(
    [
      { value: 'mail', icon: '✉️', title: 'Per E-Mail', text: 'Erinnerungsmails an die Empfänger – benötigt einen SMTP-Zugang.' },
      { value: 'calendar', icon: '📅', title: 'Per Kalender', text: 'Termine mit Alarm in Outlook, Apple/iCloud, Google, Thunderbird … – keine Erinnerungsmails.' },
      { value: 'both', icon: '✉️📅', title: 'E-Mail und Kalender', text: 'Erinnerungsmails mit Kalenderdatei im Anhang (empfohlen).' },
    ],
    r.channel || 'both',
    { cols: 3, onchange: () => update() }
  );
  const grouping = choices(
    [
      { value: 'due', icon: '📌', title: 'Zum Fälligkeitstermin', text: 'Jedes Gerät wird zu seinem eigenen Termin erinnert (Kalender: ein Termin je Gerät).' },
      { value: 'monthly', icon: '🗓', title: 'Monatsweise gebündelt', text: 'Eine Erinnerung pro Monat mit allen in diesem Monat fälligen Geräten (Kalender: ein Sammeltermin am Monatsersten).' },
    ],
    r.grouping || 'due',
    { onchange: () => update() }
  );
  const recipients = input({ value: r.recipients || meta.settings.owner.email || '', placeholder: 'max@example.de, nachbar@example.de' });
  const daysBefore = input({ value: (r.daysBefore || []).join(', ') });
  const onDue = h('input', { type: 'checkbox', checked: r.onDue });
  const overdue = input({ type: 'number', min: 0, max: 90, value: r.overdueEveryDays });
  const overdueMonthly = h('input', { type: 'checkbox', checked: r.overdueMonthly !== false });
  const invite = h('input', { type: 'checkbox', checked: r.calendarInvite });
  const alarm = input({ type: 'number', min: 0, max: 60, value: r.calendarAlarmDays });
  const preset = select([['', 'Anbieter-Vorlage wählen …'], ...Object.entries(meta.smtpPresets).map(([k, p]) => [k, p.label])], '');
  const host = input({ value: r.smtp.host });
  const port = input({ type: 'number', value: r.smtp.port });
  const secure = h('input', { type: 'checkbox', checked: r.smtp.secure });
  const user = input({ value: r.smtp.user, autocomplete: 'off' });
  const pass = input({ type: 'password', placeholder: r.smtp.hasPass ? '•••••••• (gespeichert – leer lassen = unverändert)' : 'Passwort / App-Passwort', autocomplete: 'new-password' });
  const from = input({ value: r.smtp.from, placeholder: 'Absender, z. B. pruefung@example.de' });
  preset.addEventListener('change', () => {
    const p = meta.smtpPresets[preset.value];
    if (!p) return;
    host.value = p.host;
    port.value = p.port;
    secure.checked = p.secure;
  });
  const out = h('div');

  // Beschriftungen und sichtbare Felder je nach Auswahl
  const lblBefore = h('span');
  const lblDue = h('span');
  const rowOverdueDays = field('Bei Überfälligkeit alle … Tage erneut (0 = nie)', overdue);
  const rowOverdueMonthly = h('label', { class: 'check' }, overdueMonthly, 'Überfällige Geräte in jeder Monatsübersicht erneut aufführen');
  const mailCard = h('div');
  const calCard = h('div');
  const summary = h('div', { class: 'alert info small' });
  const icsLink = h('a', { class: 'btn' }, '📅 Kalenderdatei (.ics) herunterladen');
  function update() {
    const monthly = grouping.value === 'monthly';
    const mail = channel.value !== 'calendar';
    const cal = channel.value !== 'mail';
    lblBefore.textContent = monthly ? 'Tage vor Monatsbeginn erinnern' : 'Tage vor Fälligkeit erinnern';
    lblDue.textContent = monthly ? 'Am Monatsersten erinnern (Monatsübersicht)' : 'Am Fälligkeitstag erinnern';
    rowOverdueDays.style.display = monthly ? 'none' : '';
    rowOverdueMonthly.style.display = monthly ? '' : 'none';
    mailCard.style.display = mail ? '' : 'none';
    calCard.style.display = cal ? '' : 'none';
    icsLink.href = `/api/calendar.ics?grouping=${grouping.value}`;
    summary.textContent = `So wirst du erinnert: ${mail ? (monthly ? 'eine Sammelmail pro Monat' : 'eine Mail, sobald ein Gerät fällig wird') : 'keine Mails'}${cal ? `${mail ? ' + ' : ''}${monthly ? 'ein Kalendertermin am Monatsersten je Monat' : 'ein Kalendertermin je Gerät am Fälligkeitstag'}` : ''}.`;
  }

  const save = async (silent) => {
    await put('/settings', {
      reminders: {
        enabled: enabled.checked,
        channel: channel.value,
        grouping: grouping.value,
        recipients: recipients.value,
        daysBefore: daysBefore.value,
        onDue: onDue.checked,
        overdueEveryDays: Number(overdue.value),
        overdueMonthly: overdueMonthly.checked,
        calendarInvite: invite.checked,
        calendarAlarmDays: Number(alarm.value),
        smtp: { host: host.value, port: Number(port.value), secure: secure.checked, user: user.value, pass: pass.value, from: from.value },
      },
    });
    await loadMeta();
    if (!silent) toast('Gespeichert', 'ok');
  };
  const test = async () => {
    try {
      await save(true);
      const res = await post('/reminders/test');
      toast(`Testmail an ${res.to.join(', ')} gesendet`, 'ok', 6000);
    } catch (e) {
      toast(`Fehler: ${e.message}`, 'bad', 8000);
    }
  };
  const run = async (dryRun) => {
    try {
      await save(true);
      const res = await post('/reminders/run', { dryRun });
      clear(out).appendChild(h('div', { class: `alert ${res.error ? 'bad' : res.sent ? 'ok' : 'info'}` }, res.error ? `Fehler: ${res.error}` : res.skipped ? res.skipped : dryRun ? `${res.count} Gerät(e) würden jetzt erinnert: ${res.devices.map((d) => d.name).join(', ') || '—'}` : res.sent ? `Erinnerung für ${res.count} Gerät(e) versendet.` : 'Derzeit ist nichts fällig (oder bereits erinnert).'));
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  fill(
    mailCard,
    h(
      'div',
      { class: 'card stack' },
      h('h2', {}, '✉️ E-Mail-Versand (SMTP)'),
      h('div', { class: 'grid c3' }, field('Vorlage', preset), field('SMTP-Server', host), field('Port', port), field('Benutzer', user), field('Passwort', pass, 'Bei Gmail/iCloud/Outlook mit 2FA ein App-Passwort verwenden. Wird in der Datenbank gespeichert (verschlüsselt, sofern ein Passwort gesetzt ist).'), field('Absender', from)),
      h('label', { class: 'check' }, secure, 'SSL/TLS direkt (Port 465) – sonst STARTTLS'),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: test }, 'Testmail senden'), h('button', { class: 'btn', onclick: () => run(true) }, 'Vorschau: was ist fällig?'), h('button', { class: 'btn', onclick: () => run(false) }, 'Jetzt prüfen & senden'), h('button', { class: 'btn primary', onclick: () => save() }, 'Speichern')),
      out
    )
  );
  fill(
    calCard,
    h(
      'div',
      { class: 'card stack' },
      h('h2', {}, '📅 Kalender'),
      h('div', { class: 'grid c2' }, field('Kalender-Alarm … Tage vorher', alarm), h('div')),
      h('label', { class: 'check' }, invite, 'Geänderte Termine automatisch per Mail als Kalendereinladung senden (nach Prüfung, Verschieben, Intervalländerung – benötigt SMTP)'),
      h('p', { class: 'small muted' }, 'Ohne Mailversand: Kalenderdatei herunterladen und in den Kalender importieren. Bei erneutem Import werden vorhandene Termine aktualisiert (gleiche Termin-ID), verschobene Termine wandern mit.'),
      h('div', { class: 'row' }, icsLink, h('button', { class: 'btn primary', onclick: () => save() }, 'Speichern'))
    )
  );
  update();

  return h(
    'div',
    {},
    settingsHead('#/reminders', 'Einstellungen'),
    h(
      'div',
      { class: 'card stack' },
      h('label', { class: 'check' }, enabled, h('b', {}, 'Prüferinnerungen für diese Datenbank aktivieren')),
      h('h3', {}, 'Wie möchtest du erinnert werden?'),
      channel,
      h('h3', {}, 'Wann?'),
      grouping,
      summary,
      h('div', { class: 'grid c2' }, field('Empfänger (Komma-getrennt)', recipients, 'z. B. du selbst und/oder der Eigentümer der Geräte'), field(lblBefore, daysBefore, 'z. B. „30, 7“')),
      h('div', { class: 'grid c2' }, h('label', { class: 'check' }, onDue, lblDue), h('div', {}, rowOverdueDays, rowOverdueMonthly)),
      h('div', { class: 'alert info small' }, 'Mails werden versendet, solange das Programm läuft und die Datenbank geöffnet ist (beim Öffnen und alle 6 Stunden). Kalendertermine erinnern dagegen immer – auch wenn das Programm geschlossen ist. Fällige Geräte lassen sich unter „Geräte“ bzw. in der Übersicht auf den nächsten Monat verschieben (⏭).'),
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => save() }, 'Speichern'))
    ),
    mailCard,
    calCard,
    h('div', { class: 'card' }, h('h2', {}, 'Versandprotokoll'), log.length ? h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Gerät'), h('th', {}, 'Art'), h('th', {}, 'Empfänger'), h('th', {}, ''))), h('tbody', {}, log.map((l) => h('tr', {}, h('td', {}, fmt.dateTime(l.sent_at)), h('td', {}, l.device_name ? `${l.inventory_no} ${l.device_name}` : '—'), h('td', {}, `${l.channel} · ${l.kind}`), h('td', { class: 'small' }, l.recipient), h('td', {}, l.ok ? h('span', { class: 'badge ok' }, 'ok') : h('span', { class: 'badge bad', title: l.error }, 'Fehler')))))) : h('div', { class: 'muted' }, 'Noch nichts versendet.'))
  );
}

// ---------------------------------------------------------------------------
// Prüfungsliste
// ---------------------------------------------------------------------------
export async function renderInspections({ navigate }) {
  const list = await get('/inspections?limit=500');
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, 'Prüfungen'), h('a', { class: 'btn primary', href: '#/inspect' }, '+ Prüfung')),
    h('div', { class: 'card' }, list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Datum'), h('th', {}, 'Gerät'), h('th', {}, 'Ablauf'), h('th', {}, 'Norm'), h('th', {}, 'Ergebnis'), h('th', {}, 'Nächste'), h('th', {}, ''))), h('tbody', {}, list.map((i) => h('tr', { class: 'click', onclick: () => navigate(`#/inspections/${i.id}`) }, h('td', {}, fmt.date(i.inspection_date)), h('td', {}, h('b', {}, i.device_name), h('div', { class: 'small muted' }, i.inventory_no)), h('td', {}, procName(i.procedure)), h('td', {}, i.standard), h('td', {}, resultBadge(i.result)), h('td', {}, fmt.date(i.next_due_date)), h('td', {}, h('a', { class: 'btn sm', href: `/api/inspections/${i.id}/report`, target: '_blank', onclick: (e) => e.stopPropagation() }, '🖨'))))))) : h('div', { class: 'empty' }, 'Noch keine Prüfungen.'))
  );
}

// ---------------------------------------------------------------------------
// Änderungsprotokoll
// ---------------------------------------------------------------------------
export async function renderAudit() {
  const rows = await get('/audit');
  const tbody = h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { class: 'small' }, fmt.dateTime(r.ts)), h('td', {}, r.action), h('td', { class: 'small' }, r.details || ''))));
  const table = h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Aktion'), h('th', {}, 'Details'))), tbody);
  return h('div', {}, h('div', { class: 'page-head' }, h('h1', {}, 'Änderungsprotokoll')), h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, table)));
}
