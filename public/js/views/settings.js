// Einstellungen, Erinnerungen, Prüfungsliste, Änderungsprotokoll
import { h, clear, fmt, toast, field, input, select, modal, resultBadge, confirmDialog, add } from '../ui.js';
import { get, post, put } from '../api.js';
import { state, loadMeta, procName } from '../state.js';

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
export async function renderSettings({ navigate }) {
  const meta = await loadMeta();
  const s = meta.settings;
  const backups = await get('/backups').catch(() => []);
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

  // Sicherheit
  const askCode = async (title, extra) => {
    const code = input({ class: 'input code', inputmode: 'numeric', maxlength: 6, placeholder: '000000' });
    return modal({ title, body: h('div', { class: 'stack' }, extra, field('Aktueller Code aus der Authenticator-App', code)), actions: [{ label: 'Abbrechen', value: null }, { label: 'Weiter', class: 'primary', onClick: () => (code.value.length === 6 ? code.value : false) }] });
  };
  const changePw = async () => {
    const p1 = input({ type: 'password', autocomplete: 'new-password' });
    const p2 = input({ type: 'password', autocomplete: 'new-password' });
    const code = await askCode('Passwort ändern', h('div', { class: 'stack' }, field('Neues Passwort (mind. 8 Zeichen)', p1), field('Wiederholen', p2), h('p', { class: 'small muted' }, 'Vorher wird automatisch eine Sicherung erstellt. Andere Rechner benötigen danach ebenfalls das neue Passwort.')));
    if (!code) return;
    try {
      await post('/security/password', { code, next: p1.value, next2: p2.value });
      toast('Passwort geändert', 'ok');
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };
  const new2fa = async () => {
    const code = await askCode('Zwei-Faktor neu einrichten', h('p', {}, 'Z. B. bei neuem Handy. Danach gilt nur noch der neue Eintrag in der App.'));
    if (!code) return;
    try {
      const r = await post('/security/2fa/begin', { code });
      const c2 = input({ class: 'input code', inputmode: 'numeric', maxlength: 6, placeholder: '000000' });
      const ok = await modal({ title: 'Neuen QR-Code scannen', body: h('div', { class: 'stack' }, h('div', { class: 'qr-box' }, h('img', { src: r.qr, alt: 'QR' }), h('code', {}, r.secret)), field('Code der NEUEN Einrichtung', c2)), actions: [{ label: 'Abbrechen', value: null }, { label: 'Bestätigen', class: 'primary', onClick: async () => { try { await post('/security/2fa/finish', { code: c2.value }); return true; } catch (e) { toast(e.message, 'bad'); return false; } } }] });
      if (ok) toast('Zwei-Faktor-Anmeldung neu eingerichtet', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
  const newRecovery = async () => {
    const code = await askCode('Neue Wiederherstellungscodes', h('p', {}, 'Die alten Codes werden ungültig.'));
    if (!code) return;
    try {
      const r = await post('/security/recovery', { code });
      await modal({ title: 'Neue Wiederherstellungscodes', body: h('div', { class: 'stack' }, h('p', {}, 'Bitte sicher aufbewahren (z. B. in Bitwarden):'), h('div', { class: 'codes' }, r.codes.map((c) => h('span', {}, c)))) });
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
  const backup = async () => {
    try {
      const r = await post('/backup');
      toast(`Sicherung erstellt: ${r.file}`, 'ok', 6000);
      navigate('#/settings');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  add(form, 
    h('fieldset', {}, h('legend', {}, 'Datenbank'), h('div', { class: 'grid c2' }, field('Name', dbName), field('Datei', h('code', { style: { wordBreak: 'break-all' } }, meta.db.file))), h('p', { class: 'small muted' }, `Angelegt ${fmt.dateTime(meta.db.created_at)} · Rechner: ${meta.db.host}`)),
    h('fieldset', {}, h('legend', {}, 'Eigentümer / Kunde'), h('div', { class: 'grid c3' }, field('Name', f('owner.name')), field('Straße', f('owner.street')), field('PLZ', f('owner.zip')), field('Ort', f('owner.city')), field('Telefon', f('owner.phone')), field('E-Mail', f('owner.email', { type: 'email' })))),
    h('fieldset', {}, h('legend', {}, 'Prüfer'), h('div', { class: 'grid c3' }, field('Name', f('inspector.name')), field('Qualifikation', f('inspector.qualification')), field('Firma (optional)', f('inspector.company')))),
    h('fieldset', {}, h('legend', {}, 'Prüfung'), h('div', { class: 'grid c3' }, field('Grenzwert-Profil', profile), field('Standard-Norm', std), field('Standard-Prüfintervall (Monate)', f('defaultIntervalMonths', { type: 'number', min: 1, max: 120 })), field('Präfix Inventarnummer', f('inventoryPrefix')), field('Automatisch sperren nach (Minuten)', f('autoLockMinutes', { type: 'number', min: 1, max: 240 }))), h('label', { class: 'check', style: { marginTop: '8px' } }, corr, 'Manuelle Eingabe: SECUTEST-Anzeigewerte mit Gebrauchsfehler-Tabelle bewerten (Anhang der Anleitung)')),
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: save }, 'Speichern'))
  );

  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, 'Einstellungen')),
    h('div', { class: 'card' }, form),
    h('div', { class: 'grid c2', style: { marginTop: '14px' } },
      h('div', { class: 'card stack' }, h('h2', {}, '🔐 Sicherheit'), h('p', { class: 'small muted' }, `Verschlüsselung: SQLCipher (AES-256, PBKDF2-SHA512). 2FA: TOTP. Wiederherstellungscodes übrig: ${meta.recoveryRemaining}.`), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: changePw }, 'Passwort ändern'), h('button', { class: 'btn', onclick: new2fa }, '2FA neu einrichten'), h('button', { class: 'btn', onclick: newRecovery }, 'Neue Wiederherstellungscodes'))),
      h('div', { class: 'card stack' }, h('h2', {}, '💾 Sicherung & Export'), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: backup }, 'Sicherung jetzt erstellen'), h('a', { class: 'btn', href: '/api/export.json' }, 'Export JSON'), h('a', { class: 'btn', href: '/api/export.csv' }, 'Export CSV (Excel)')), h('p', { class: 'small muted' }, 'Automatische Sicherung beim ersten Öffnen jedes Tages (max. 15) im Ordner „Sicherungen“ neben der Datenbank – ebenfalls verschlüsselt.'), backups.length ? h('ul', { class: 'small' }, backups.slice(0, 6).map((b) => h('li', {}, `${b.name} (${Math.round(b.size / 1024)} KB)`))) : null)
    ),
    h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'row between' }, h('div', {}, h('b', {}, 'Weitere Datenbank'), h('div', { class: 'small muted' }, 'Für Bekannte eine eigene, getrennte Datenbank anlegen oder eine andere öffnen.')), h('button', { class: 'btn', onclick: async () => (await confirmDialog('Aktuelle Datenbank sperren und zur Datenbank-Auswahl wechseln?')) && (await post('/lock'), location.reload()) }, 'Datenbank wechseln / neu anlegen')))
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
  const recipients = input({ value: r.recipients || meta.settings.owner.email || '', placeholder: 'max@example.de, nachbar@example.de' });
  const daysBefore = input({ value: (r.daysBefore || []).join(', ') });
  const onDue = h('input', { type: 'checkbox', checked: r.onDue });
  const overdue = input({ type: 'number', min: 0, max: 90, value: r.overdueEveryDays });
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

  const save = async (silent) => {
    await put('/settings', { reminders: { enabled: enabled.checked, recipients: recipients.value, daysBefore: daysBefore.value, onDue: onDue.checked, overdueEveryDays: Number(overdue.value), calendarInvite: invite.checked, calendarAlarmDays: Number(alarm.value), smtp: { host: host.value, port: Number(port.value), secure: secure.checked, user: user.value, pass: pass.value, from: from.value } } });
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

  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, 'Prüferinnerungen'), h('a', { class: 'btn', href: '/api/calendar.ics' }, '📅 Alle Termine als .ics')),
    h(
      'div',
      { class: 'card stack' },
      h('label', { class: 'check' }, enabled, h('b', {}, 'E-Mail-Erinnerungen für diese Datenbank aktivieren')),
      h('div', { class: 'grid c2' }, field('Empfänger (Komma-getrennt)', recipients, 'z. B. du selbst und/oder der Eigentümer der Geräte'), field('Tage vor Fälligkeit erinnern', daysBefore, 'z. B. „30, 7“')),
      h('div', { class: 'grid c3' }, h('label', { class: 'check' }, onDue, 'Am Fälligkeitstag erinnern'), field('Bei Überfälligkeit alle … Tage erneut (0 = nie)', overdue), h('div')),
      h('div', { class: 'grid c2' }, h('label', { class: 'check' }, invite, 'Nach jeder bestandenen Prüfung Kalendereinladung (.ics) für den nächsten Termin mailen'), field('Kalender-Alarm … Tage vorher', alarm)),
      h('div', { class: 'alert info small' }, 'Mails werden versendet, solange das Programm läuft und die Datenbank entsperrt ist (beim Öffnen und alle 6 Stunden). Kalendertermine (.ics) erinnern dagegen immer – auch wenn das Programm geschlossen ist. Für Outlook/iCloud/Google einfach die .ics-Datei öffnen oder die Einladung annehmen.')
    ),
    h(
      'div',
      { class: 'card stack' },
      h('h2', {}, '✉️ E-Mail-Versand (SMTP)'),
      h('div', { class: 'grid c3' }, field('Vorlage', preset), field('SMTP-Server', host), field('Port', port), field('Benutzer', user), field('Passwort', pass, 'Bei Gmail/iCloud/Outlook mit 2FA ein App-Passwort verwenden. Wird verschlüsselt in der Datenbank gespeichert.'), field('Absender', from)),
      h('label', { class: 'check' }, secure, 'SSL/TLS direkt (Port 465) – sonst STARTTLS'),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: test }, 'Testmail senden'), h('button', { class: 'btn', onclick: () => run(true) }, 'Vorschau: was ist fällig?'), h('button', { class: 'btn', onclick: () => run(false) }, 'Jetzt prüfen & senden'), h('button', { class: 'btn primary', onclick: () => save() }, 'Speichern')),
      out
    ),
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
