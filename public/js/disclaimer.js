// Sicherheitshinweis & Haftungsausschluss (wird beim ersten Start bestätigt)
import { h } from './ui.js';

export const DISCLAIMER_VERSION = 1;

export function disclaimerContent() {
  return h(
    'div',
    { class: 'stack disclaimer' },
    h('div', { class: 'alert bad' }, h('b', {}, '⚡ Lebensgefahr durch elektrischen Strom.'), 'Prüfungen nach DIN VDE 0701/0702 (DIN EN 50678 / DIN EN 50699) und alle Arbeiten an elektrischen Anlagen und Geräten dürfen nur von Elektrofachkräften bzw. elektrotechnisch unterwiesenen Personen unter Leitung und Aufsicht einer Elektrofachkraft durchgeführt werden.'),
    h(
      'ul',
      {},
      h('li', {}, h('b', {}, 'Open Source ohne Gewähr: '), 'Diese Software ist ein freies Open-Source-Projekt und wird „wie besehen“ ohne jegliche Gewährleistung bereitgestellt. Sie kann Fehler enthalten – insbesondere bei Grenzwerten, Bewertungen, der RS-232-Kommunikation mit dem Prüfgerät und den grafischen Anleitungen.'),
      h('li', {}, h('b', {}, 'Kein Ersatz für Fachwissen: '), 'Die Software ersetzt weder die Bedienungsanleitung des Prüfgeräts noch die geltenden Normen und Vorschriften (z. B. DGUV Vorschrift 3) oder die fachliche Beurteilung durch die verantwortliche Elektrofachkraft. Maßgeblich sind allein die jeweils gültigen Normen und Herstellerangaben.'),
      h('li', {}, h('b', {}, 'Keine Haftung: '), 'Die Autoren und Mitwirkenden übernehmen – soweit gesetzlich zulässig – keinerlei Haftung für Personen-, Sach- oder Vermögensschäden, die direkt oder indirekt durch die Nutzung, Fehlfunktion oder fehlerhafte Ergebnisse dieser Software entstehen. Die Nutzung erfolgt ausschließlich auf eigene Verantwortung und Gefahr.'),
      h('li', {}, h('b', {}, 'Prüfergebnisse kontrollieren: '), 'Jede automatische Bewertung ist von der prüfenden Person zu kontrollieren. Im Zweifel gilt ein Gerät als nicht bestanden und darf nicht benutzt werden.'),
      h('li', {}, h('b', {}, 'Marken: '), 'Gossen Metrawatt und SECUTEST sind Marken der jeweiligen Inhaber. Dieses Projekt ist unabhängig und steht in keiner Verbindung zur GMC-I Messtechnik GmbH.')
    )
  );
}
