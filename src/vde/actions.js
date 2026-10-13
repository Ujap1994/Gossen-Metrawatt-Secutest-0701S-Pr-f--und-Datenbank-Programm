'use strict';
/**
 * Maßnahmen bei nicht bestandener Prüfung (Auswahlliste).
 * status   = neuer Gerätestatus
 * retest   = Nachprüfung erforderlich (nächster Termin = sofort fällig)
 */
const FAIL_ACTIONS = [
  {
    id: 'sperren',
    label: 'Gerät sperren und kennzeichnen („Defekt – nicht benutzen“)',
    description: 'Prüfling sofort außer Betrieb nehmen, gegen Wiederinbetriebnahme sichern (z. B. Stecker abkleben, Sperr-Aufkleber) und Nutzer informieren.',
    status: 'gesperrt',
    retest: true,
  },
  {
    id: 'reparatur',
    label: 'Instandsetzung veranlassen (danach Prüfung nach VDE 0701)',
    description: 'Gerät reparieren lassen bzw. selbst instandsetzen (nur Elektrofachkraft). Nach der Reparatur ist eine Prüfung nach DIN VDE 0701 / DIN EN 50678 erforderlich.',
    status: 'reparatur',
    retest: true,
  },
  {
    id: 'leitung',
    label: 'Anschlussleitung / Stecker erneuern und erneut prüfen',
    description: 'Typischer Fehler bei R_SL oder Sichtprüfung: beschädigte Leitung, Stecker oder Zugentlastung ersetzen, dann Prüfung wiederholen.',
    status: 'reparatur',
    retest: true,
  },
  {
    id: 'wiederholen',
    label: 'Messung wiederholen / Nachprüfung (Verdacht auf Mess- oder Anschlussfehler)',
    description: 'Anschluss, Sonde, Schalterstellung und Prüfling-Netzschalter kontrollieren und die Prüfung erneut durchführen. Bis dahin Gerät nicht benutzen.',
    status: 'gesperrt',
    retest: true,
  },
  {
    id: 'hersteller',
    label: 'An Hersteller / Fachwerkstatt senden (Garantie, Gewährleistung)',
    description: 'Bei Geräten in der Garantie keine eigene Reparatur – zum Hersteller oder Händler einsenden. Mängelbericht beilegen.',
    status: 'reparatur',
    retest: true,
  },
  {
    id: 'rueckgabe',
    label: 'Rückgabe an Eigentümer mit schriftlichem Mängelhinweis',
    description: 'Bei Prüfungen für Bekannte: Gerät als „nicht bestanden“ gekennzeichnet zurückgeben, Mängel im Protokoll dokumentieren und Nutzung ausdrücklich untersagen.',
    status: 'gesperrt',
    retest: true,
  },
  {
    id: 'ausmustern',
    label: 'Ausmustern / fachgerecht entsorgen (Elektroschrott)',
    description: 'Reparatur unwirtschaftlich oder nicht möglich: Gerät unbrauchbar machen (Leitung abschneiden) und über den Wertstoffhof bzw. Händler-Rücknahme (ElektroG) entsorgen.',
    status: 'ausgemustert',
    retest: false,
  },
  {
    id: 'sonstiges',
    label: 'Sonstige Maßnahme (bitte beschreiben)',
    description: 'Eigene Maßnahme im Freitextfeld dokumentieren.',
    status: 'gesperrt',
    retest: true,
    requiresNote: true,
  },
];

const DEVICE_STATUS = {
  aktiv: 'aktiv (in Betrieb)',
  gesperrt: 'gesperrt / außer Betrieb',
  reparatur: 'in Reparatur',
  ausgemustert: 'ausgemustert / entsorgt',
};

function findAction(id) {
  return FAIL_ACTIONS.find((a) => a.id === id) || null;
}

module.exports = { FAIL_ACTIONS, DEVICE_STATUS, findAction };
