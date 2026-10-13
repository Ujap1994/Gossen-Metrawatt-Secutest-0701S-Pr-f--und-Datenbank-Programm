'use strict';
/**
 * E-Mail-Versand über SMTP (z. B. Outlook/Hotmail, iCloud-Mail, GMX, Web.de, Gmail mit App-Passwort).
 */
const nodemailer = require('nodemailer');

const PRESETS = {
  outlook: { label: 'Outlook / Hotmail / Microsoft 365', host: 'smtp-mail.outlook.com', port: 587, secure: false },
  icloud: { label: 'iCloud Mail (App-spezifisches Passwort)', host: 'smtp.mail.me.com', port: 587, secure: false },
  gmail: { label: 'Gmail (App-Passwort)', host: 'smtp.gmail.com', port: 465, secure: true },
  gmx: { label: 'GMX', host: 'mail.gmx.net', port: 587, secure: false },
  webde: { label: 'WEB.DE', host: 'smtp.web.de', port: 587, secure: false },
  tonline: { label: 'T-Online', host: 'securesmtp.t-online.de', port: 465, secure: true },
};

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function recipientsOf(settings) {
  return String(settings.reminders?.recipients || settings.owner?.email || '')
    .split(/[;,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

function smtpConfigured(settings) {
  const s = settings.reminders?.smtp || {};
  return !!(s.host && s.port && (s.from || s.user));
}

function transport(settings) {
  const s = settings.reminders.smtp;
  return nodemailer.createTransport({
    host: s.host,
    port: Number(s.port) || 587,
    secure: !!s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    requireTLS: !s.secure,
    connectionTimeout: 15000,
  });
}

async function sendMail(settings, { to, subject, text, html, attachments }) {
  if (!smtpConfigured(settings)) throw new Error('SMTP ist nicht eingerichtet (Einstellungen → Erinnerungen).');
  const rcpt = to && to.length ? to : recipientsOf(settings);
  if (!rcpt.length) throw new Error('Keine gültige Empfänger-Adresse hinterlegt.');
  const s = settings.reminders.smtp;
  const info = await transport(settings).sendMail({ from: s.from || s.user, to: rcpt.join(', '), subject, text, html, attachments });
  return { messageId: info.messageId, to: rcpt };
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Sammel-Mail mit allen fälligen Geräten */
function reminderContent(dbName, items) {
  const rows = items
    .map(({ device: d, days }) => {
      const state = days < 0 ? `seit ${-days} Tag(en) überfällig` : days === 0 ? 'heute fällig' : `in ${days} Tag(en) fällig`;
      return { d, state };
    })
    .sort((a, b) => (a.d.next_due_date < b.d.next_due_date ? -1 : 1));
  const subject = `Prüferinnerung (${dbName}): ${items.length} Gerät(e) – DIN VDE 0701-0702`;
  const text =
    `Hallo,\n\nfolgende Geräte aus der Datenbank „${dbName}“ müssen geprüft werden:\n\n` +
    rows.map(({ d, state }) => `• ${d.inventory_no}  ${d.name}${d.location ? ` (${d.location})` : ''} – fällig am ${fmtDate(d.next_due_date)}, ${state}`).join('\n') +
    `\n\nDiese Nachricht wurde automatisch vom Secutest Prüfmanager erstellt.`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d2733">
  <h2 style="color:#0b5cad;margin:0 0 8px">Prüferinnerung</h2>
  <p>Folgende Geräte aus der Datenbank <b>${escHtml(dbName)}</b> sind zur Wiederholungsprüfung nach DIN VDE 0701-0702 fällig:</p>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #d5dde6">
    <tr style="background:#eef3f8"><th align="left">Inv.-Nr.</th><th align="left">Gerät</th><th align="left">Standort</th><th align="left">Fällig am</th><th align="left">Status</th></tr>
    ${rows
      .map(
        ({ d, state }) =>
          `<tr><td style="border-top:1px solid #d5dde6">${escHtml(d.inventory_no)}</td><td style="border-top:1px solid #d5dde6">${escHtml(d.name)}</td><td style="border-top:1px solid #d5dde6">${escHtml(d.location || '')}</td><td style="border-top:1px solid #d5dde6">${fmtDate(d.next_due_date)}</td><td style="border-top:1px solid #d5dde6;color:${state.includes('überfällig') ? '#b3261e' : '#8a5a00'}">${escHtml(state)}</td></tr>`
      )
      .join('')}
  </table>
  <p style="color:#5b6b7b;font-size:12px">Automatisch erstellt vom Secutest Prüfmanager.</p></div>`;
  return { subject, text, html };
}

module.exports = { PRESETS, sendMail, recipientsOf, smtpConfigured, reminderContent, fmtDate, escHtml };
