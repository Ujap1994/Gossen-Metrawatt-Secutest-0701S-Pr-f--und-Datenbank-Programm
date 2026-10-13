// Datenbank wählen, anlegen und anmelden (Passwort + Authenticator-Code)
import { h, clear, toast, field, input, select, modal, fill } from '../ui.js';
import { get, post, del } from '../api.js';
import { disclaimerContent } from '../disclaimer.js';
import { shutdownApp } from '../shutdown.js';

const PROVIDER_ICON = { onedrive: '☁️', icloud: '🍏', local: '💻' };
const PROVIDER_NAME = { onedrive: 'OneDrive', icloud: 'iCloud Drive', local: 'Lokal' };

export async function renderLogin(root, { message, onUnlocked }) {
  const box = h('div', { class: 'auth' });
  clear(root).appendChild(h('div', { class: 'auth-wrap' }, box));
  const hero = h('div', { class: 'hero' }, h('img', { src: '/img/icon.svg', alt: '' }), h('div', {}, h('h1', {}, 'Secutest Prüfmanager'), h('div', { class: 'muted' }, 'Geräteprüfung nach DIN VDE 0701/0702 mit dem Gossen Metrawatt SECUTEST 0701S')));

  async function showDisclaimer() {
    const chk = h('input', { type: 'checkbox' });
    const btn = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
      await post('/disclaimer/accept');
      showList(message);
    } }, 'Akzeptieren & weiter');
    chk.addEventListener('change', () => (btn.disabled = !chk.checked));
    fill(box, hero, h('div', { class: 'card stack' }, h('h2', {}, '⚠ Sicherheitshinweis & Haftungsausschluss'), disclaimerContent(), h('label', { class: 'check' }, chk, 'Ich habe den Hinweis gelesen, bin entsprechend qualifiziert und akzeptiere den Haftungsausschluss.'), h('div', { class: 'row end' }, btn)));
  }

  async function showList(msg) {
    let data;
    try {
      data = await get('/databases');
    } catch (e) {
      fill(box, hero, h('div', { class: 'alert bad' }, e.message));
      return;
    }
    const list = h('div', { class: 'db-list' });
    if (!data.registered.length) list.appendChild(h('div', { class: 'empty' }, 'Noch keine Datenbank vorhanden – lege jetzt deine erste an.'));
    for (const d of data.registered) {
      list.appendChild(
        h(
          'div',
          { class: 'db-item', tabindex: 0, onclick: () => d.exists && showUnlock(d), onkeydown: (e) => e.key === 'Enter' && d.exists && showUnlock(d) },
          h('span', { class: 'ico' }, PROVIDER_ICON[d.provider] || '🗄'),
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, d.name), h('div', { class: 'path', title: d.path }, d.path)),
          !d.exists ? h('span', { class: 'badge bad', title: 'Cloud-Ordner noch nicht synchronisiert oder Datei verschoben?' }, 'Datei nicht gefunden') : null,
          d.lock ? h('span', { class: 'badge warn', title: `seit ${d.lock.since}` }, `geöffnet auf ${d.lock.host}`) : null,
          h('span', { class: 'badge info' }, PROVIDER_NAME[d.provider] || 'Lokal'),
          h(
            'button',
            {
              class: 'icon-btn',
              title: 'Aus Liste entfernen (Datei bleibt erhalten)',
              onclick: async (e) => {
                e.stopPropagation();
                if (!confirm(`„${d.name}“ aus der Liste entfernen? Die Datei selbst wird NICHT gelöscht.`)) return;
                await del(`/databases/${d.id}`).catch((ex) => toast(ex.message, 'bad'));
                showList();
              },
            },
            '✕'
          )
        )
      );
    }
    const discovered = data.discovered.length
      ? h(
          'div',
          { class: 'card' },
          h('h3', {}, 'In der Cloud gefunden'),
          h('p', { class: 'muted small' }, 'Diese Datenbanken liegen in deinen Cloud-Ordnern, sind auf diesem Rechner aber noch nicht eingetragen:'),
          h(
            'div',
            { class: 'db-list' },
            data.discovered.map((x) =>
              h(
                'div',
                { class: 'db-item' },
                h('span', { class: 'ico' }, PROVIDER_ICON[x.provider] || '🗄'),
                h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, x.name), h('div', { class: 'path' }, x.path)),
                h(
                  'button',
                  {
                    class: 'btn sm',
                    onclick: async () => {
                      await post('/databases/register', { path: x.path, name: x.name });
                      showList();
                    },
                  },
                  'Hinzufügen'
                )
              )
            )
          )
        )
      : null;
    fill(box, 
      hero,
      msg ? h('div', { class: 'alert info' }, msg) : null,
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Datenbank öffnen'), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => addExisting() }, 'Datei hinzufügen …'), h('button', { class: 'btn primary', onclick: () => showCreate(data) }, '+ Neue Datenbank'))),
        list,
        h('p', { class: 'muted small', style: { marginTop: '12px' } }, 'Jede Datenbank ist eine eigene, verschlüsselte Datei (AES-256) – z. B. eine für deine eigenen Geräte und je eine für Bekannte. Anmeldung mit Passwort + Code aus deiner Authenticator-App (Bitwarden, Microsoft, Google …).')
      ),
      discovered,
      h('p', { class: 'small muted', style: { marginTop: '14px' } }, '⚠ Open-Source-Software ohne Gewähr. Prüfungen nur durch Elektrofachkräfte. ', h('a', { href: '#', onclick: (e) => (e.preventDefault(), showDisclaimer()) }, 'Haftungsausschluss lesen'), ' · ', h('a', { href: '#', onclick: (e) => (e.preventDefault(), shutdownApp()) }, '⏻ Programm beenden'))
    );
  }

  async function addExisting() {
    const path = input({ placeholder: 'z. B. C:\\Users\\Max\\OneDrive\\SecutestPruefmanager\\Meine_Geraete.secudb' });
    const r = await modal({
      title: 'Vorhandene Datenbank-Datei hinzufügen',
      body: h('div', { class: 'stack' }, field('Vollständiger Pfad zur .secudb-Datei', path), h('p', { class: 'muted small' }, 'Tipp: Datenbanken in den OneDrive-/iCloud-Ordnern „SecutestPruefmanager“ werden automatisch gefunden.')),
      actions: [
        { label: 'Abbrechen', value: null },
        { label: 'Hinzufügen', class: 'primary', onClick: () => path.value.trim() || false },
      ],
    });
    if (!r) return;
    try {
      await post('/databases/register', { path: r });
      showList();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  // ---------------- Anmelden ----------------
  function showUnlock(d, force = false) {
    const pw = input({ type: 'password', autocomplete: 'current-password', placeholder: 'Passwort' });
    const err = h('div');
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Weiter');
    const form = h(
      'form',
      {
        class: 'card stack',
        onsubmit: async (e) => {
          e.preventDefault();
          clear(err);
          btn.disabled = true;
          try {
            const r = await post('/unlock', { dbId: d.id, password: pw.value, force });
            showTotp(d, r.pendingToken);
          } catch (ex) {
            if (ex.status === 423) {
              clear(err).appendChild(
                h(
                  'div',
                  { class: 'alert warn' },
                  h('b', {}, 'Achtung:'),
                  ex.message,
                  h('p', { class: 'small', style: { marginTop: '6px' } }, 'Wenn du sicher bist, dass die Datenbank dort nicht mehr geöffnet ist (z. B. Rechner abgestürzt), kannst du trotzdem öffnen.'),
                  h('button', { type: 'button', class: 'btn sm', onclick: () => showUnlock(d, true) }, 'Trotzdem öffnen')
                )
              );
            } else clear(err).appendChild(h('div', { class: 'alert bad' }, ex.message));
          } finally {
            btn.disabled = false;
          }
        },
      },
      h('h2', {}, `🔐 ${d.name}`),
      h('div', { class: 'muted small' }, d.path),
      force ? h('div', { class: 'alert warn' }, 'Öffnen trotz Sperre eines anderen Rechners.') : null,
      field('Passwort', pw),
      err,
      h('div', { class: 'row between' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => showList() }, '← Zurück'), btn)
    );
    fill(box, hero, form);
    pw.focus();
  }

  function showTotp(d, pendingToken) {
    let useRecovery = false;
    const code = input({ class: 'input code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '000000' });
    const rec = input({ placeholder: 'XXXXX-XXXXX', autocomplete: 'off', style: { maxWidth: '260px' } });
    const err = h('div');
    const holder = h('div');
    const submit = async () => {
      clear(err);
      try {
        const r = await post('/unlock/2fa', useRecovery ? { pendingToken, recoveryCode: rec.value } : { pendingToken, code: code.value });
        if (r.usedRecovery) toast(`Wiederherstellungscode verwendet – noch ${r.remainingRecovery} übrig.`, 'warn', 8000);
        onUnlocked();
      } catch (ex) {
        clear(err).appendChild(h('div', { class: 'alert bad' }, ex.message));
        if (ex.status === 410 || ex.status === 429) setTimeout(() => showUnlock(d), 1800);
        code.value = '';
        code.focus();
      }
    };
    code.addEventListener('input', () => {
      code.value = code.value.replace(/\D/g, '').slice(0, 6);
      if (code.value.length === 6) submit();
    });
    const render = () => {
      fill(holder, 
        useRecovery ? field('Wiederherstellungscode', rec, 'Einer der 10 Codes, die du beim Anlegen erhalten hast. Jeder Code funktioniert nur einmal.') : field('6-stelliger Code aus der Authenticator-App', code, 'Bitwarden Authenticator, Microsoft/Google Authenticator o. ä. – Eintrag „Secutest Prüfmanager“'),
        h('a', { href: '#', class: 'small', onclick: (e) => (e.preventDefault(), (useRecovery = !useRecovery), render()) }, useRecovery ? 'Code aus der App verwenden' : 'Handy nicht zur Hand? Wiederherstellungscode verwenden')
      );
      (useRecovery ? rec : code).focus();
    };
    fill(box, 
      hero,
      h(
        'form',
        { class: 'card stack', onsubmit: (e) => (e.preventDefault(), submit()) },
        h('h2', {}, '📱 Zwei-Faktor-Anmeldung'),
        h('div', { class: 'muted' }, `Datenbank „${d.name}“ – Passwort korrekt.`),
        holder,
        err,
        h('div', { class: 'row between' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => showList() }, '← Abbrechen'), h('button', { class: 'btn primary', type: 'submit' }, 'Anmelden'))
      )
    );
    render();
  }

  // ---------------- Neue Datenbank ----------------
  function showCreate(data) {
    const locs = [...data.cloud.map((c) => ({ value: c.folder, label: `${PROVIDER_ICON[c.provider]} ${c.label} – ${c.folder}` })), { value: data.local, label: `💻 Lokal – ${data.local}` }, { value: '__custom', label: '📁 Eigener Ordner …' }];
    const name = input({ placeholder: 'z. B. Meine Geräte, Familie Müller, Werkstatt', required: true });
    const loc = select(locs, locs[0].value);
    const custom = input({ placeholder: 'Absoluter Ordnerpfad', style: { display: 'none' } });
    loc.addEventListener('change', () => (custom.style.display = loc.value === '__custom' ? '' : 'none'));
    const ownerName = input({ placeholder: 'Name des Eigentümers / Kunden' });
    const ownerEmail = input({ type: 'email', placeholder: 'für Prüferinnerungen (optional)' });
    const ownerStreet = input({ placeholder: 'Straße, Nr.' });
    const ownerCity = input({ placeholder: 'PLZ Ort' });
    const inspName = input({ placeholder: 'Dein Name (erscheint im Protokoll)' });
    const inspQual = select(['Elektrofachkraft', 'Elektrotechnisch unterwiesene Person (EuP) mit Messgerät', 'Elektromeister', 'Sonstige'], 'Elektrofachkraft');
    const interval = select([[12, '12 Monate (empfohlen privat)'], [6, '6 Monate'], [24, '24 Monate'], [36, '36 Monate'], [48, '48 Monate']], 12);
    const pw1 = input({ type: 'password', autocomplete: 'new-password' });
    const pw2 = input({ type: 'password', autocomplete: 'new-password' });
    const meter = h('div', { class: 'small muted' });
    pw1.addEventListener('input', () => {
      const v = pw1.value;
      let score = 0;
      if (v.length >= 8) score++;
      if (v.length >= 12) score++;
      if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
      if (/\d/.test(v)) score++;
      if (/[^A-Za-z0-9]/.test(v)) score++;
      meter.textContent = v ? `Stärke: ${['sehr schwach', 'schwach', 'mittel', 'gut', 'stark', 'sehr stark'][score]}` : '';
    });
    const err = h('div');
    const form = h(
      'form',
      {
        class: 'card stack',
        onsubmit: async (e) => {
          e.preventDefault();
          clear(err);
          try {
            const r = await post('/setup/begin', {
              name: name.value,
              folder: loc.value === '__custom' ? custom.value : loc.value,
              password: pw1.value,
              password2: pw2.value,
              owner: { name: ownerName.value, email: ownerEmail.value, street: ownerStreet.value, city: ownerCity.value },
              inspector: { name: inspName.value, qualification: inspQual.value },
              intervalMonths: Number(interval.value),
            });
            showSetup2fa(r, name.value);
          } catch (ex) {
            clear(err).appendChild(h('div', { class: 'alert bad' }, ex.message));
          }
        },
      },
      h('div', { class: 'steps-mini' }, h('span', { class: 'on' }), h('span'), h('span')),
      h('h2', {}, 'Neue Datenbank anlegen'),
      h('div', { class: 'grid c2' }, field('Name der Datenbank', name, 'Für Bekannte einfach je eine eigene Datenbank anlegen.', { required: true }), field('Speicherort', h('div', { class: 'stack' }, loc, custom), data.cloud.length ? 'OneDrive/iCloud gefunden – die Datei wird dort automatisch synchronisiert.' : 'Kein OneDrive/iCloud gefunden – lokalen oder eigenen Ordner wählen.')),
      h('fieldset', {}, h('legend', {}, 'Eigentümer / Kunde'), h('div', { class: 'grid c2' }, field('Name', ownerName), field('E-Mail', ownerEmail), field('Straße', ownerStreet), field('PLZ / Ort', ownerCity))),
      h('fieldset', {}, h('legend', {}, 'Prüfer'), h('div', { class: 'grid c3' }, field('Name', inspName), field('Qualifikation', inspQual), field('Standard-Prüfintervall', interval))),
      h('fieldset', {}, h('legend', {}, 'Passwort (verschlüsselt die Datei)'), h('div', { class: 'grid c2' }, field('Passwort (mind. 8 Zeichen)', pw1, null, { required: true }), field('Passwort wiederholen', pw2, null, { required: true })), meter, h('div', { class: 'alert warn small' }, h('b', {}, 'Wichtig:'), 'Ohne Passwort lässt sich die Datenbank nicht wiederherstellen. Bewahre es z. B. in Bitwarden auf.')),
      err,
      h('div', { class: 'row between' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => showList() }, '← Zurück'), h('button', { class: 'btn primary', type: 'submit' }, 'Weiter zur Zwei-Faktor-Einrichtung →'))
    );
    fill(box, hero, form);
    name.focus();
  }

  function showSetup2fa(r, dbName) {
    const code = input({ class: 'input code', inputmode: 'numeric', maxlength: 6, placeholder: '000000', autocomplete: 'one-time-code' });
    const err = h('div');
    const submit = async () => {
      clear(err);
      try {
        const res = await post('/setup/finish', { setupToken: r.setupToken, code: code.value });
        showRecovery(res.recoveryCodes, dbName);
      } catch (ex) {
        clear(err).appendChild(h('div', { class: 'alert bad' }, ex.message));
        code.value = '';
      }
    };
    code.addEventListener('input', () => {
      code.value = code.value.replace(/\D/g, '').slice(0, 6);
      if (code.value.length === 6) submit();
    });
    fill(box, 
      hero,
      h(
        'form',
        { class: 'card stack', onsubmit: (e) => (e.preventDefault(), submit()) },
        h('div', { class: 'steps-mini' }, h('span', { class: 'on' }), h('span', { class: 'on' }), h('span')),
        h('h2', {}, '📱 Zwei-Faktor-Anmeldung einrichten'),
        h(
          'ol',
          { class: 'instr' },
          h('li', {}, 'Authenticator-App öffnen (Bitwarden Authenticator, Microsoft Authenticator, Google Authenticator, Aegis, 2FAS …).'),
          h('li', {}, '„Konto hinzufügen“ / „+“ → QR-Code scannen. Alternativ den Schlüssel manuell eingeben.'),
          h('li', {}, 'Den angezeigten 6-stelligen Code unten eintragen.')
        ),
        h('div', { class: 'qr-box' }, h('img', { src: r.qr, alt: 'QR-Code für die Authenticator-App' }), h('div', { class: 'stack' }, h('div', { class: 'small muted' }, 'Schlüssel (manuelle Eingabe, TOTP, SHA1, 6 Stellen, 30 s):'), h('code', { style: { fontSize: '1.05rem', wordBreak: 'break-all' } }, r.secret.replace(/(.{4})/g, '$1 ').trim()), h('div', { class: 'small muted' }, `Datei: ${r.file}`))),
        field('Code aus der App', code),
        err,
        h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Bestätigen & Datenbank anlegen'))
      )
    );
    code.focus();
  }

  function showRecovery(codes, dbName) {
    const text = `Secutest Prüfmanager – Wiederherstellungscodes\nDatenbank: ${dbName}\nErstellt: ${new Date().toLocaleString('de-DE')}\n\n${codes.join('\n')}\n\nJeder Code kann einmal statt des Authenticator-Codes verwendet werden.`;
    fill(box, 
      hero,
      h(
        'div',
        { class: 'card stack' },
        h('div', { class: 'steps-mini' }, h('span', { class: 'on' }), h('span', { class: 'on' }), h('span', { class: 'on' })),
        h('h2', {}, '✅ Datenbank angelegt – Wiederherstellungscodes sichern'),
        h('p', {}, 'Falls dein Handy verloren geht, kannst du dich mit einem dieser Codes anmelden. Bitte ausdrucken oder in Bitwarden speichern – sie werden nur jetzt angezeigt!'),
        h('div', { class: 'codes' }, codes.map((c) => h('span', {}, c))),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                const a = h('a', { href: url, download: `Wiederherstellungscodes_${dbName}.txt` });
                document.body.appendChild(a);
                a.click();
                a.remove();
              },
            },
            '⬇ Als Textdatei speichern'
          ),
          h('button', { class: 'btn', onclick: () => navigator.clipboard?.writeText(text).then(() => toast('Kopiert', 'ok')) }, '📋 Kopieren')
        ),
        h('div', { class: 'row end' }, h('button', { class: 'btn primary lg', onclick: () => onUnlocked() }, 'Codes gesichert – los geht’s →'))
      )
    );
  }

  const st = await get('/status').catch(() => ({ disclaimerAccepted: true }));
  if (!st.disclaimerAccepted) showDisclaimer();
  else showList(message);
}
