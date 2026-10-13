// „Programm beenden“ – stoppt den lokalen Server (wichtig, wenn ohne Terminalfenster gestartet)
import { h, clear, confirmDialog, toast } from './ui.js';
import { post } from './api.js';

export async function shutdownApp() {
  if (!(await confirmDialog('Secutest Prüfmanager beenden? Die Datenbank wird gesperrt und die SECUTEST-Verbindung getrennt.', { title: 'Programm beenden', confirmLabel: 'Beenden' }))) return;
  try {
    await post('/shutdown');
  } catch (e) {
    return toast(e.message, 'bad');
  }
  const root = document.getElementById('app');
  clear(root).appendChild(h('div', { class: 'boot' }, h('div', { style: { textAlign: 'center' } }, h('h2', {}, '⏻ Secutest Prüfmanager wurde beendet'), h('p', { class: 'muted' }, 'Dieses Browserfenster kann geschlossen werden. Zum erneuten Starten das Programm wieder öffnen.'))));
}
