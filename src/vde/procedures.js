'use strict';
/**
 * Prüfabläufe je Schutzklasse / Geräteart – angelehnt an die Bedienerführung des
 * SECUTEST 0701/0702S (Bedienungsanleitung Kap. 5 und 6).
 *
 * Jeder Schritt enthält
 *  - Anleitungstext + Hinweise
 *  - eine Szenenbeschreibung für die grafische Erklärung (public/js/illustrations.js)
 *  - optional die Fernsteuer-Befehle (MES!/WER?) für den PC-gesteuerten Modus
 *  - die Messnummern, an denen der gerätegeführte Modus den Schritt erkennt (MES?)
 */
const { limitsFor, QUANTITIES, PROFILES, DEFAULT_PROFILE } = require('./limits');

// ---------------------------------------------------------------------------
// Geräteerkennung: EDV-/Bürogeräte, Heizgeräte, Elektronik, Leitungen
// ---------------------------------------------------------------------------
const TYPE_PATTERNS = [
  {
    type: 'it',
    re: /\b(pc|edv|it)\b|monitor|bildschirm|display|computer|rechner|laptop|notebook|netbook|tablet|drucker|printer|plotter|scanner|kopierer|kopiergerät|multifunktionsgerät|fax|server|router|modem|netzwerk-?switch|nas\b|beamer|projektor|büro(maschine|gerät)|buero|aktenvernichter|schreibmaschine|telefonanlage|kassen(system|terminal)|workstation|all-in-one|docking|usv\b|\bups\b|mini-?pc|spielekonsole|konsole/i,
  },
  {
    type: 'heating',
    re: /heiz|wasserkocher|toaster|bügel|herd|backofen|ofen\b|radiator|fön|föhn|haartrockner|kaffee|espresso|heißluft|heissluft|lötkolben|lötstation|waffel|grill|fritteuse|boiler|durchlauferhitzer|warmhalte|raclette|fondue|sandwich|crêpe|crepe|glätteisen|lockenstab|infrarot|wärme/i,
  },
  {
    type: 'extension',
    re: /verlängerung|kabeltrommel|mehrfachsteckdose|steckdosenleiste|tischsteckdose|steckerleiste|anschlussleitung|kaltgeräte(kabel|leitung)|geräteanschlussleitung|adapterleitung/i,
  },
  {
    type: 'electronic',
    re: /fernseh|\btv\b|radio|receiver|verstärker|hifi|hi-fi|stereo|soundbar|lautsprecher|ladegerät|netzteil|led-?treiber|dimmer|audio|video|dvd|blu-?ray|mikrowelle|induktion/i,
  },
  { type: 'battery', re: /akku(?!-?lade)|batterie(?!-?lade)/i },
];

/** Vorschlag für die Geräteart anhand Bezeichnung/Kategorie/Modell */
function suggestDeviceType(device) {
  const text = [device.name, device.category, device.model, device.manufacturer].filter(Boolean).join(' ');
  for (const p of TYPE_PATTERNS) if (p.re.test(text)) return p.type;
  return null;
}

/** EDV-/Bürogerät? Explizit erfasst – oder Geräteart „standard“ und Bezeichnung deutet darauf hin. */
function isItDevice(device) {
  if (device.device_type === 'it') return true;
  return (!device.device_type || device.device_type === 'standard') && suggestDeviceType(device) === 'it';
}

/**
 * Darf der Auto-Modus verwendet werden?
 * Bedienungsanleitung Kap. 5.2: „Geräte der Schutzklasse III sowie Datenverarbeitungs-Einrichtungen
 * und Büromaschinen können in der Funktion AUTO nicht geprüft werden. Hierfür sind die Funktionen
 * SK III und T.240 vorgesehen.“
 */
function autoModeCheck(device) {
  if (device.protection_class === 'SK III') {
    return {
      allowed: false,
      reason: 'Geräte der Schutzklasse III können im AUTO-Modus nicht geprüft werden (Bedienungsanleitung Kap. 5.2). Bitte Drehschalter auf „SK III“ stellen.',
      alternative: 'SK3',
    };
  }
  if (isItDevice(device)) {
    return {
      allowed: false,
      reason: 'Datenverarbeitungs-Einrichtungen und Büromaschinen (z. B. Monitor, PC, Drucker) können im AUTO-Modus nicht geprüft werden (Bedienungsanleitung Kap. 5.2). Bitte Drehschalter auf „T 240“ stellen.',
      alternative: 'EDV',
    };
  }
  if (device.device_type === 'extension') {
    return {
      allowed: false,
      reason: 'Verlängerungsleitungen werden über das Untermenü „Verlängerungsleitung“ (Adapter EL1) geprüft – bitte den Ablauf „Verlängerungsleitung“ wählen.',
      alternative: 'VL',
    };
  }
  if (device.connection_type === 'fixed') {
    return {
      allowed: false,
      reason: 'Fest angeschlossene Geräte können nicht an der Prüfdose geprüft werden – bitte Einzelmessungen (MENUE) verwenden.',
      alternative: 'FEST',
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Sichtprüfung – die ersten 6 Punkte entsprechen den Bits FF.0–FF.5 im PRO?-Telegramm
// ---------------------------------------------------------------------------
const VISUAL_ITEMS = [
  { item: 'schutzleiter', label: 'Schutzleiter: Anschluss, Schutzkontakte am Stecker, grün-gelbe Ader unbeschädigt', proBit: 0, classes: ['SK I'] },
  { item: 'isolierteile', label: 'Isolierteile: keine Risse, Brandspuren, Verformungen oder Verfärbungen', proBit: 1 },
  { item: 'gehaeuse', label: 'Gehäuse: unbeschädigt, alle Schrauben/Abdeckungen vorhanden, kein Zugang zu aktiven Teilen', proBit: 2 },
  { item: 'anschlussleitung', label: 'Anschlussleitung & Stecker: Mantel unbeschädigt, Knickschutz, Zugentlastung, keine Quetschungen', proBit: 3 },
  { item: 'typschild', label: 'Typschild, Aufschriften und Sicherheitskennzeichen vorhanden und lesbar', proBit: 4 },
  { item: 'gebrauch', label: 'Keine Anzeichen von unsachgemäßem Gebrauch oder Überlastung', proBit: 5 },
  { item: 'sicherungen', label: 'Gerätesicherungen: richtiger Bemessungswert, nicht überbrückt' },
  { item: 'kuehlung', label: 'Kühlluftöffnungen / Luftfilter frei, keine Verschmutzung oder Korrosion' },
  { item: 'bedienteile', label: 'Schalter, Bedienteile, Abdeckungen und Schutzeinrichtungen funktionsfähig' },
];

const VISUAL_ITEMS_EXTENSION = [
  { item: 'schutzleiter', label: 'Schutzkontakte in Stecker und Kupplung/Steckdosen vorhanden, nicht verbogen', proBit: 0 },
  { item: 'isolierteile', label: 'Stecker, Kupplung, Steckdosenleiste: keine Risse, Brandspuren, Verfärbungen', proBit: 1 },
  { item: 'gehaeuse', label: 'Gehäuse / Kabeltrommel unbeschädigt, Kinderschutz (falls vorhanden) intakt', proBit: 2 },
  { item: 'anschlussleitung', label: 'Leitungsmantel über gesamte Länge unbeschädigt, Knickschutz, Zugentlastung', proBit: 3 },
  { item: 'typschild', label: 'Aufschriften (Bemessungswerte, Querschnitt, Abwickelhinweis bei Trommeln) lesbar', proBit: 4 },
  { item: 'gebrauch', label: 'Keine Überlastungsspuren (z. B. Schmelzspuren bei aufgewickelter Trommel)', proBit: 5 },
];

const FUNCTION_ITEMS = [
  { item: 'funktion', label: 'Gerät funktioniert bestimmungsgemäß (Probebetrieb)' },
  { item: 'sicherheitsfunktionen', label: 'Sicherheitsrelevante Funktionen in Ordnung (Thermostat, Not-Aus, Schutzschalter, Verriegelungen)' },
];

// ---------------------------------------------------------------------------
// Fernsteuerung (PC-gesteuerter Modus) – Messnummern laut Bedienungsanleitung Kap. 8.5
// ---------------------------------------------------------------------------
const REMOTE = {
  RSL: { start: ['MES!8'], second: ['MES!10'], read: [12, 13, 14, 15], map: { RSL: 15, RSL_MIN: 12, RSL_MAX: 13, RSL_DIFF: 14 }, final: 'RSL' },
  RISO: { start: ['MES!16'], read: [19, 20, 21, 96], map: { RISO: 21, RISO_MIN: 19, RISO_MAX: 20, UISO: 96 }, final: 'RISO' },
  IEA: { start: ['MES!26'], read: [28, 29, 30], map: { IEA: 30, IEA_MIN: 28, IEA_MAX: 29 }, final: 'IEA' },
  IB: { start: ['MES!24'], read: [28, 29, 30], map: { IB: 30, IB_MIN: 28, IB_MAX: 29 }, final: 'IB' },
  ISONDE: { start: ['MES!32'], read: [32, 33, 34, 36], map: { ISONDE: 34, ISONDE_AC: 32, ISONDE_DC: 33, ISONDE_MAX: 36 }, final: 'ISONDE' },
  UV: { start: ['MES!72'], read: [72, 73, 74], map: { UV_AC: 72, UV_DC: 73, UV_TRMS: 74 }, final: 'UV_AC' },
  FT: {
    start: [], // Netz an Prüfdose: Taste (14) am Gerät – per Software nur mit codiertem Schnittstellenstecker (TAS!5)
    read: [58, 56, 52, 57, 49, 55, 59, 64, 66, 67, 51, 61],
    map: { U: 58, I: 56, P: 52, S: 57, PF: 49, W: 55, F: 59, DI: 67, DI_LIVE: 64, DI_MAX: 66, P_MAX: 51, I_MAX: 61 },
    final: 'DI',
  },
};

/** Messnummern (MES?-Antwort) -> Schrittgruppe, für den gerätegeführten Modus */
function groupForMeasurementNo(n) {
  if (n >= 8 && n <= 15) return 'RSL';
  if ((n >= 16 && n <= 21) || (n >= 96 && n <= 98)) return 'RISO';
  if (n >= 24 && n <= 30) return 'IEA';
  if (n >= 32 && n <= 38) return 'ISONDE';
  if (n >= 48 && n <= 67) return 'FT';
  if (n >= 72 && n <= 78) return 'UV';
  return null;
}

// ---------------------------------------------------------------------------
// Schrittbausteine
// ---------------------------------------------------------------------------
const SK_LABEL = { sk1: 'SK I', sk2: 'SK II', sk3: 'SK III', it1: 'SK I', it2: 'SK II', cord: 'SK I', fixed: 'SK I' };

const STEP = {
  prepPlug: (sk, sw) => ({
    id: 'anschluss',
    type: 'prep',
    title: 'Prüfling anschließen',
    instructions: [
      'SECUTEST mit dem Netzstecker (16) an eine abgesicherte 230-V-Schutzkontaktsteckdose (max. 16 A) anschließen. Die Lampe (11) darf nicht leuchten.',
      'Netzstecker des Prüflings in die Prüfdose (18) des SECUTEST stecken.',
      'Prüfsonde an die Buchsen SONDE (4) und (5) anschließen.',
      `Drehschalter (6) auf „${sw}“ stellen.`,
      'Prüfling am eigenen Netzschalter EINSCHALTEN – nur dann werden Fehler hinter dem Schalter erfasst (Schalter, Relais, Temperaturregler beachten).',
    ],
    hints: ['Die Netzspannung muss zwischen 207 V und 253 V liegen.', 'Prüfling vorher vom Netz trennen und sichtprüfen, Kondensatoren können geladen sein.'],
    scene: { dut: sk, socket: 'plug', probe: 'parked', switchPos: sw, action: 'switch-on', lcd: [`An Prüfdose: ${SK_LABEL[sk] || 'SK I'}`, 'Sichtprüfung', '▼ weiter'] },
    remotePrecheck: true,
  }),
  visual: (items = VISUAL_ITEMS, sk, sw) => ({
    id: 'sicht',
    type: 'visual',
    title: 'Sichtprüfung',
    instructions: [
      'Prüfling von außen (bei Instandsetzung auch innen) sorgfältig begutachten.',
      'Jeden Punkt als „i. O.“, „Mangel“ oder „entfällt“ markieren. Ein Mangel führt zu „nicht bestanden“.',
      'Am SECUTEST die Abfrage „Sichtprüfung“ entsprechend mit ▲/▼ und ↵ beantworten (falls in Setup aktiviert).',
    ],
    hints: ['Die Sichtprüfung ist der wichtigste Teil der Prüfung – viele Mängel sind nur hier erkennbar.'],
    items,
    scene: { dut: sk, socket: 'plug', probe: 'parked', switchPos: sw, action: 'visual', lcd: ['Sichtprüfung', 'in Ordnung?', '▲▼ ja/nein  ↵'] },
  }),
  rsl: (sk, sw, opts = {}) => ({
    id: 'rsl',
    type: 'measure',
    key: 'RSL',
    title: 'Schutzleiterwiderstand R_SL',
    multiPoint: true,
    instructions: [
      'Prüfspitze der Sonde fest an ein blankes, mit dem Schutzleiter verbundenes Metallteil des Prüflings drücken (z. B. Gehäuseschraube, Metallgehäuse).',
      'Messung starten (↵ am SECUTEST bzw. „Messung starten“ im Programm).',
      'Während der Messung die Anschlussleitung abschnittsweise über ihre ganze Länge bewegen (Handprobe). Springt der Wert, ist der Schutzleiter beschädigt!',
      'Jedes weitere berührbare Metallteil als eigenen Messpunkt messen.',
    ],
    hints: ['Die Stromrichtung wird automatisch umgepolt (Prüfstrom > 200 mA).', 'Bei Leitungen > 5 m und Werten > 0,3 Ω die Leitungslänge eingeben – der Grenzwert erhöht sich.', ...(opts.hints || [])],
    scene: { dut: sk, socket: opts.socket || 'plug', probe: 'housing', switchPos: sw, action: 'move-cable', lcd: ['Schutzleiterwiderstand', 'RSL   0,041 Ω', '+200 mA Prüfstrom', 'Anschlußleitung bewegen'] },
    remote: REMOTE.RSL,
    deviceGroup: 'RSL',
  }),
  riso: (sk, sw, opts = {}) => ({
    id: 'riso',
    type: 'measure',
    key: 'RISO',
    extraKeys: ['UISO'],
    title: 'Isolationswiderstand R_ISO',
    multiPoint: sk !== 'sk1',
    instructions: opts.instructions || [
      'Prüfling bleibt EINGESCHALTET (alle Schalter, Relais, Regler geschlossen).',
      'Gemessen wird zwischen den aktiven Leitern (L+N) und dem Schutzleiter mit 500 V DC.',
      'Berührbare leitfähige Teile, die NICHT mit dem Schutzleiter verbunden sind, zusätzlich mit der Sonde abtasten.',
      'Prüfling während der Messung nicht berühren!',
    ],
    hints: ['Nach der Messung wird der Prüfling automatisch entladen.', ...(opts.hints || [])],
    scene: { dut: sk, socket: opts.socket || 'plug', probe: opts.probe || (sk === 'sk1' ? 'parked' : 'part'), switchPos: sw, action: 'hands-off', lcd: ['Isolationswiderstand', 'RISO   9,98 MΩ', 'UISO   537 V'] },
    remote: REMOTE.RISO,
    deviceGroup: 'RISO',
    skippable: opts.skippable,
  }),
  iea: (sk, sw) => ({
    id: 'iea',
    type: 'measure',
    key: 'IEA',
    title: 'Ersatzableitstrom / Schutzleiterstrom I_EA',
    instructions: [
      'Prüfling bleibt EINGESCHALTET.',
      'Gemessen wird der Strom zwischen L+N (kurzgeschlossen) und dem Schutzleiter – hochgerechnet auf 1,06 × Netznennspannung.',
      'Messung starten und Wert ablesen.',
    ],
    hints: ['Vorgeschrieben u. a. nach Austausch von Entstörkondensatoren, bei Heizgeräten mit R_ISO < Grenzwert und bei elektronischen Geräten.'],
    scene: { dut: sk, socket: 'plug', probe: 'parked', switchPos: sw, action: 'hands-off', lcd: ['Ersatz-Ableitstrom', 'IEA   1,66 mA'] },
    remote: REMOTE.IEA,
    deviceGroup: 'IEA',
    skippable: true,
  }),
  ib: (sk, sw, opts = {}) => ({
    id: 'ib',
    type: 'measure',
    key: 'IB',
    title: 'Ersatz-Berührungsstrom an berührbaren Teilen (Sonde)',
    multiPoint: true,
    optional: !!opts.optional,
    instructions: [
      'Mit der Prüfspitze jedes berührbare leitfähige Teil abtasten (Schrauben, Metallzierteile, Buchsen, Antennen­anschlüsse …).',
      'Gemessen wird der Strom von L+N über das Teil zur Sonde.',
      'Jedes Teil als eigenen Messpunkt erfassen.',
    ],
    hints: [opts.optional ? 'Nur erforderlich, wenn berührbare leitfähige Teile vorhanden sind, die nicht mit dem Schutzleiter verbunden sind.' : 'Bei rein isolierten Geräten ohne leitfähige Teile: Schritt als „entfällt“ markieren.'],
    scene: { dut: sk, socket: 'plug', probe: 'part', switchPos: sw, action: 'probe-parts', lcd: ['Ersatz-Ableitstrom', 'über Sonde', 'IEA   0,02 mA'] },
    remote: REMOTE.IB,
    deviceGroup: 'IEA',
    skippable: true,
  }),
  isonde: (sk, sw) => ({
    id: 'isonde',
    type: 'measure',
    key: 'ISONDE',
    title: 'Berührungsstrom / Spannungsfreiheit (I_Sonde)',
    multiPoint: true,
    instructions: [
      'Prüfling ist in BETRIEB (eingeschaltet, Netzspannung liegt an).',
      'Mit der Sonde alle berührbaren leitfähigen Teile des Benutzerbereichs abtasten, die nicht mit dem Schutzleiter verbunden sind (Gehäuse, Schnittstellenbuchsen, Schrauben).',
      'Messung in BEIDEN Positionen des Netzsteckers durchführen: Stecker drehen bzw. in Setup „Netzumpolung“ einschalten (jede Betätigung von Taste 14 polt L/N um).',
      'Für jede Steckerposition und jedes Teil einen Messpunkt erfassen (z. B. „Gehäuse – Pos. 1“).',
    ],
    hints: ['Achtung: Die Prüfung in beiden Steckerpositionen unterbricht den Betrieb – Daten vorher sichern!', 'Ein Fehler im Prüfling kann den FI-Schutzschalter der Hausinstallation auslösen.'],
    scene: { dut: sk, socket: 'plug', probe: 'part', switchPos: sw, action: 'flip-plug', lcd: ['Spannungsfreiheit', 'ISonde  0,012 mA', 'Netzumpolung'] },
    remote: REMOTE.ISONDE,
    deviceGroup: 'ISONDE',
  }),
  functionTest: (sk, sw, { diRequired = false } = {}) => ({
    id: 'funktion',
    type: 'function',
    title: 'Funktionstest an der Prüfdose',
    keys: ['DI', 'U', 'I', 'P', 'S', 'PF', 'W'],
    items: FUNCTION_ITEMS,
    instructions: [
      'Nur nach BESTANDENER Sicherheitsprüfung zulässig!',
      'Prüfling zuerst am eigenen Schalter AUSSCHALTEN (z. B. Kreissäge, Trennschleifer – Einschalten muss bewusst erfolgen).',
      'Wenn die Lampe (15) blinkt: Taste FUNCTION-TEST (14) drücken → Netzspannung liegt an der Prüfdose (Lampe leuchtet dauernd).',
      'Prüfling einschalten und Funktion prüfen. Differenzstrom ΔI, Leistung, Strom und Spannung werden gemessen.',
      'Zum Beenden: Prüfling am eigenen Schalter AUSSCHALTEN, danach Taste (14) drücken.',
    ],
    hints: ['Bei Geräten mit hoher Induktivität immer erst am Gerät ausschalten, sonst kann das Prüfgerät beschädigt werden.', 'Ein Kurzschluss im Prüfling wird erkannt – der Funktionstest ist dann gesperrt.'],
    scene: { dut: sk, socket: 'plug', probe: 'parked', switchPos: sw, action: 'function-test', lcd: ['Funktionstest', 'P    1180 W   ΔI 0,05mA', 'U   231,4 V  I  5,12 A', 'LF  0,99'] },
    remote: REMOTE.FT,
    remoteGroup: 'FT',
    deviceGroup: 'FT',
    diRequired,
    skippable: true,
  }),
  result: (sk, sw) => ({
    id: 'ergebnis',
    type: 'result',
    title: 'Bewertung & Abschluss',
    instructions: [
      'Ergebnis prüfen. Mit ▼ (8) zeigt das SECUTEST alle Mess- und Grenzwerte.',
      'Bei „nicht bestanden“: Maßnahme auswählen (z. B. sperren, reparieren, ausmustern) und den Prüfling kennzeichnen.',
      'Speichern – das Prüfdatum (heute) und der nächste Prüftermin werden automatisch eingetragen.',
    ],
    scene: { dut: sk, socket: 'plug', probe: 'parked', switchPos: sw, action: 'result', lcd: [`An Prüfdose: ${SK_LABEL[sk] || 'SK I'}`, '', 'bestanden!', '☺ Funktionstest'] },
  }),
};

// ---------------------------------------------------------------------------
// Prüfabläufe
// ---------------------------------------------------------------------------
const PROCEDURES = {
  AUTO: {
    id: 'AUTO',
    name: 'AUTO – automatische Schutzklassen-Erkennung (SK I / SK II)',
    switchPos: 'AUTO',
    classes: ['SK I', 'SK II'],
    description:
      'Das SECUTEST erkennt selbst, ob ein Schutzleiter vorhanden ist (SK I) oder nicht (SK II) und misst nacheinander Schutzleiterwiderstand, Isolationswiderstand und Ersatzableitstrom. Nicht für SK III, EDV-/Bürogeräte und Verlängerungsleitungen!',
    precondition:
      'Nur wählen, wenn bei SK I alle berührbaren leitfähigen Teile mit dem Schutzleiter verbunden sind bzw. bei SK II alle berührbaren leitfähigen Teile untereinander verbunden sind.',
    build: (sk) => [STEP.prepPlug(sk, 'AUTO'), STEP.visual(VISUAL_ITEMS, sk, 'AUTO'), ...(sk === 'sk1' ? [STEP.rsl(sk, 'AUTO')] : []), STEP.riso(sk, 'AUTO'), sk === 'sk1' ? STEP.iea(sk, 'AUTO') : STEP.ib(sk, 'AUTO'), STEP.functionTest(sk, 'AUTO'), STEP.result(sk, 'AUTO')],
  },
  SK1: {
    id: 'SK1',
    name: 'Schutzklasse I (Schutzleiter) – Vorwahl SK I',
    switchPos: 'SK I',
    classes: ['SK I'],
    description: 'Geräte mit Schutzleiter (Schuko-Stecker, Metallgehäuse). Messschritte werden einzeln per Tastendruck gestartet.',
    build: () => [STEP.prepPlug('sk1', 'SK I'), STEP.visual(VISUAL_ITEMS, 'sk1', 'SK I'), STEP.rsl('sk1', 'SK I'), STEP.riso('sk1', 'SK I'), STEP.iea('sk1', 'SK I'), STEP.ib('sk1', 'SK I', { optional: true }), STEP.functionTest('sk1', 'SK I'), STEP.result('sk1', 'SK I')],
  },
  SK2: {
    id: 'SK2',
    name: 'Schutzklasse II (schutzisoliert) – Vorwahl SK II',
    switchPos: 'SK II',
    classes: ['SK II'],
    description: 'Schutzisolierte Geräte (Symbol ◻ im ◻) ohne Schutzleiter. Alle berührbaren leitfähigen Teile werden mit der Sonde abgetastet.',
    build: () => [
      STEP.prepPlug('sk2', 'SK II'),
      STEP.visual(VISUAL_ITEMS.filter((i) => i.item !== 'schutzleiter'), 'sk2', 'SK II'),
      STEP.riso('sk2', 'SK II', {
        instructions: [
          'Prüfling bleibt EINGESCHALTET.',
          'Mit der Prüfspitze JEDES berührbare leitfähige Teil abtasten (Schrauben, Metallteile, Buchsen) – je Teil ein Messpunkt.',
          'Gemessen wird zwischen L+N und der Sonde mit 500 V DC.',
          'Hat das Gerät keine leitfähigen Teile: an einer Stelle mit Alufolie o. Ä. messen oder als „entfällt“ begründen.',
        ],
      }),
      STEP.ib('sk2', 'SK II'),
      STEP.functionTest('sk2', 'SK II'),
      STEP.result('sk2', 'SK II'),
    ],
  },
  SK3: {
    id: 'SK3',
    name: 'Schutzklasse III (Schutzkleinspannung) – Vorwahl SK III',
    switchPos: 'SK III',
    classes: ['SK III'],
    description: 'Geräte mit Schutzkleinspannung (SELV/PELV, Symbol III im Rhombus). Nicht an der Prüfdose! Isolationsmessung im spannungsfreien Zustand, optional Messung der Versorgungsspannung.',
    build: () => [
      {
        id: 'anschluss',
        type: 'prep',
        title: 'Prüfling anschließen (spannungsfrei)',
        instructions: [
          'Drehschalter (6) auf „SK III“ stellen.',
          'Prüfling von seiner Versorgung (Sicherheitstransformator / Netzteil) trennen – Prüfling spannungsfrei!',
          'Versorgungsanschlüsse des Prüflings miteinander verbinden und an die Buchsen L (3) / N (2) anschließen (Kabelset KS13).',
          'Sonde an Buchsen (4)/(5) anschließen – damit werden die berührbaren leitfähigen Teile abgetastet.',
          'Bei Batteriegeräten: Batterie abklemmen.',
        ],
        hints: ['Die Messung von R_ISO entfällt bei SK III und Batteriegeräten mit Nennleistung ≤ 20 VA UND Nennspannung ≤ 42 V.'],
        scene: { dut: 'sk3', socket: 'terminals', probe: 'parked', switchPos: 'SK III', action: 'connect', lcd: ['Schutzklasse III', '➨ RISO Isolationswiderstand', '  UV Versorgungsspannung'] },
      },
      STEP.visual(VISUAL_ITEMS.filter((i) => i.item !== 'schutzleiter'), 'sk3', 'SK III'),
      STEP.riso('sk3', 'SK III', {
        socket: 'terminals',
        probe: 'part',
        skippable: true,
        instructions: [
          'Menüpunkt „RISO Isolationswiderstand“ wählen und mit ↵ starten.',
          'Mit der Sonde jedes berührbare leitfähige Teil abtasten (je Teil ein Messpunkt).',
          'Gemessen wird zwischen den Versorgungsanschlüssen (L/N-Buchsen) und der Sonde.',
        ],
        hints: ['Entfällt bei ≤ 20 VA und ≤ 42 V Nennspannung – dann „entfällt“ mit Begründung wählen.'],
      }),
      {
        id: 'uv',
        type: 'measure',
        key: 'UV_AC',
        extraKeys: ['UV_DC'],
        title: 'Versorgungsspannung SK III (optional)',
        optional: true,
        skippable: true,
        instructions: [
          'Menüpunkt „UV Versorgungsspannung“ wählen.',
          'Versorgung (Netzteil/Trafo) wieder anschließen und die Ausgangsspannung an den Buchsen L (3) / N (2) messen.',
          'Schutzkleinspannung: max. 50 V AC bzw. 120 V DC.',
        ],
        hints: ['An den Buchsen SL (1) und N (2) dürfen höchstens 10 V anliegen – die Versorgungsspannung nur an L (3)/N (2) anschließen!'],
        scene: { dut: 'sk3', socket: 'terminals-supply', probe: 'parked', switchPos: 'SK III', action: 'measure-voltage', lcd: ['Versorgungsspannung SK III', 'U~   12,1 V', 'U=    0,0 V'] },
        remote: REMOTE.UV,
        remoteGroup: 'UV',
        deviceGroup: 'UV',
      },
      { ...STEP.functionTest('sk3', 'SK III'), keys: [], title: 'Funktionsprüfung', instructions: ['Prüfling wieder an seine Versorgung anschließen und bestimmungsgemäße Funktion prüfen.', 'Ein Funktionstest an der Prüfdose ist bei SK III nicht möglich.'], hints: [], scene: { dut: 'sk3', socket: 'none', probe: 'parked', switchPos: 'SK III', action: 'switch-on', lcd: ['Schutzklasse III'] }, remote: null, deviceGroup: null },
      { ...STEP.result('sk3', 'SK III'), scene: { dut: 'sk3', socket: 'terminals', probe: 'parked', switchPos: 'SK III', action: 'result', lcd: ['Schutzklasse III', '', 'bestanden!'] } },
    ],
  },
  EDV: {
    id: 'EDV',
    name: 'EDV- und Bürogeräte – T 240 (DIN VDE 0701 Teil 240)',
    switchPos: 'T 240',
    classes: ['SK I', 'SK II'],
    description: 'Datenverarbeitungs-Einrichtungen und Büromaschinen (PC, Monitor, Drucker …). Geräteschutzleiter prüfen und Spannungsfreiheit berührbarer leitfähiger Teile in beiden Steckerpositionen feststellen. Keine Isolationsmessung (schont die Elektronik).',
    build: (sk) => [
      {
        ...STEP.prepPlug(sk, 'T 240'),
        instructions: [
          'Drehschalter (6) auf „T 240“ stellen.',
          'Variante A: Prüfling an die Prüfdose (18) des SECUTEST – in Setup „Netzumpolung = ein“ für beide Steckerpositionen.',
          'Variante B: Prüfgerät und Prüfling an zwei getrennte Netzsteckdosen mit GLEICHEM Schutzleiterpotential.',
          'Sonde an Buchsen (4)/(5) anschließen.',
          'Prüfling einschalten (in Betrieb nehmen) – vorher Rücksprache mit dem Nutzer, Daten sichern!',
        ],
        scene: { dut: sk === 'sk1' ? 'it1' : 'it2', socket: 'plug', probe: 'parked', switchPos: 'T 240', action: 'switch-on', lcd: ['Bürogerät an Prüfdose', '▼ weiter ▲ zurück'] },
      },
      STEP.visual(VISUAL_ITEMS.filter((i) => sk === 'sk1' || i.item !== 'schutzleiter'), sk === 'sk1' ? 'it1' : 'it2', 'T 240'),
      ...(sk === 'sk1' ? [{ ...STEP.rsl('it1', 'T 240'), instructions: ['Zuerst den Geräteschutzleiter prüfen: Sonde an mit PE verbundene Metallteile (Gehäuse, Schnittstellen-Schrauben).', 'Anschlussleitung (Kaltgerätekabel) während der Messung über die ganze Länge bewegen.', 'Bei Geräteverbund: alle Schutzleiterverbindungen nacheinander messen.'] }] : []),
      STEP.isonde(sk === 'sk1' ? 'it1' : 'it2', 'T 240'),
      STEP.functionTest(sk === 'sk1' ? 'it1' : 'it2', 'T 240'),
      STEP.result(sk === 'sk1' ? 'it1' : 'it2', 'T 240'),
    ],
  },
  VL: {
    id: 'VL',
    name: 'Verlängerungsleitung / Mehrfachsteckdose (Adapter EL1)',
    switchPos: 'AUTO',
    classes: ['SK I'],
    description: 'Einphasige Verlängerungsleitungen, Kabeltrommeln und Steckdosenleisten mit Zubehör Adapter EL1: Schutzleiterwiderstand, Isolationswiderstand, Durchgangs- und Kurzschlusstest.',
    build: () => [
      {
        id: 'anschluss',
        type: 'prep',
        title: 'Leitung mit Adapter EL1 anschließen',
        instructions: [
          'Drehschalter (6) auf „AUTO“ stellen und zunächst die Sichtkontrolle durchführen.',
          'Stecker der Verlängerungsleitung in die Prüfdose (18) stecken.',
          'Adapter EL1 in die Kupplung der Leitung stecken und an die Sondenbuchsen (4)/(5) anschließen.',
          'Kabeltrommeln vollständig abwickeln!',
          'Am SECUTEST mit ▼ (8) das Untermenü „Verlängerungsleitung“ wählen, mit ↵ starten, Länge (> 5 m) und Norm (0701/0702) eingeben.',
        ],
        hints: ['Die Tasten im Handgriff des Adapters EL1 sind ohne Funktion.', 'Bei Mehrfachsteckdosen jede Steckdose einzeln prüfen (je Steckdose ein Messpunkt).'],
        scene: { dut: 'cord', socket: 'plug', probe: 'el1', switchPos: 'AUTO', action: 'connect', lcd: ['An Prüfdose: SK I', '➨ Verlängerungsleitung', '  (nur mit Zubehör EL1)'] },
      },
      STEP.visual(VISUAL_ITEMS_EXTENSION, 'cord', 'AUTO'),
      { ...STEP.rsl('cord', 'AUTO'), instructions: ['Leitungslänge am SECUTEST eingeben (wird im Programm aus den Gerätedaten übernommen).', 'Messung starten und die Leitung abschnittsweise über die ganze Länge bewegen.', 'Bei Mehrfachsteckdosen: jede Steckdose (Schutzkontakt) als Messpunkt erfassen.'], scene: { dut: 'cord', socket: 'plug', probe: 'el1', switchPos: 'AUTO', action: 'move-cable', lcd: ['Verlängerungsleitung', 'RSL   0,182 Ω'] } },
      { ...STEP.riso('cord', 'AUTO'), multiPoint: false, instructions: ['Isolationswiderstand zwischen L, N und PE (500 V DC) – läuft automatisch.', 'Bei Leitungen mit Schalter: Schalter EIN.'], scene: { dut: 'cord', socket: 'plug', probe: 'el1', switchPos: 'AUTO', action: 'hands-off', lcd: ['Verlängerungsleitung', 'RISO  >310 MΩ'] } },
      {
        id: 'durchgang',
        type: 'checks',
        title: 'Durchgangs- und Kurzschlusstest (Polarität)',
        items: [
          { item: 'durchgang_l', label: 'Durchgang Außenleiter L' },
          { item: 'durchgang_n', label: 'Durchgang Neutralleiter N' },
          { item: 'kurzschluss', label: 'Kein Kurzschluss zwischen den Leitern' },
          { item: 'vertauschung', label: 'Keine Leitervertauschung (bei Kupplungen mit Polung, z. B. CEE)' },
        ],
        instructions: ['Das SECUTEST führt Durchgangs- und Kurzschlusstest automatisch durch und meldet das Ergebnis.', 'Ergebnis hier übernehmen.'],
        scene: { dut: 'cord', socket: 'plug', probe: 'el1', switchPos: 'AUTO', action: 'result', lcd: ['Verlängerungsleitung', 'Durchgang   OK', 'Kurzschluß  nein'] },
      },
      STEP.result('cord', 'AUTO'),
    ],
  },
  FEST: {
    id: 'FEST',
    name: 'Fest angeschlossene Geräte SK I – Einzelmessungen (MENUE)',
    switchPos: 'MENUE',
    classes: ['SK I'],
    description: 'Fest installierte Geräte (z. B. Durchlauferhitzer, Herd) über Einzelmessungen im MENUE: R_SL über die Sonde, R_ISO / I_EA mit der Sonde am Außenleiter.',
    build: () => [
      {
        id: 'anschluss',
        type: 'prep',
        title: 'Vorbereitung Festanschluss',
        instructions: [
          'Drehschalter (6) auf „MENUE“ stellen.',
          'Für R_ISO und I_EA: Gerät freischalten – Netzanschluss-Sicherungen entfernen und Neutralleiter im Prüfobjekt auftrennen.',
          'Buchse SL (1) mit dem Schutzleiter der Installation (bzw. PE-Klemme) verbinden.',
          'Sonde an Buchsen (4)/(5) anschließen.',
        ],
        hints: ['Messungen in elektrischen Anlagen sind mit dem SECUTEST nicht zulässig – nur am freigeschalteten Gerät messen.', 'Arbeiten am Festanschluss nur durch eine Elektrofachkraft!'],
        scene: { dut: 'fixed', socket: 'sl-terminal', probe: 'parked', switchPos: 'MENUE', action: 'connect', lcd: ['RSL      UAC/DC', 'RISO     USonde', 'IEA      R', '➨Setup…'] },
      },
      STEP.visual(VISUAL_ITEMS, 'fixed', 'MENUE'),
      { ...STEP.rsl('fixed', 'MENUE', { socket: 'sl-terminal' }), instructions: ['Im MENUE „RSL“ wählen.', 'Sonde an ein mit dem Schutzleiter verbundenes leitfähiges Teil des Gehäuses halten.', 'Messung starten; Polarität mit ▲/▼ wechseln und beide Werte prüfen.'] },
      { ...STEP.riso('fixed', 'MENUE'), multiPoint: false, instructions: ['Im MENUE „RISO“ wählen.', 'Sonde am Außenleiter L des Prüflings anschließen (N aufgetrennt, Sicherungen entfernt).', 'Messung mit 500 V starten.'], scene: { dut: 'fixed', socket: 'sl-terminal', probe: 'l-conductor', switchPos: 'MENUE', action: 'hands-off', lcd: ['RISO   >310 MΩ', 'UISO   538 V'] } },
      { ...STEP.iea('fixed', 'MENUE'), instructions: ['Im MENUE „IEA“ wählen.', 'Sonde am Außenleiter L (bzw. an L und N verbunden) des Prüflings anschließen.', 'Messung starten.'], scene: { dut: 'fixed', socket: 'sl-terminal', probe: 'l-conductor', switchPos: 'MENUE', action: 'hands-off', lcd: ['IEA   0,85 mA'] }, remote: { ...REMOTE.IB, map: { IEA: 30 } }, remoteGroup: 'IB' },
      { ...STEP.functionTest('fixed', 'MENUE'), keys: [], title: 'Funktionsprüfung', instructions: ['Sicherungen wieder einsetzen, N wieder anklemmen und Gerät in Betrieb nehmen.', 'Bestimmungsgemäße Funktion prüfen.'], remote: null, deviceGroup: null, scene: { dut: 'fixed', socket: 'none', probe: 'parked', switchPos: 'MENUE', action: 'switch-on', lcd: ['MENUE'] } },
      STEP.result('fixed', 'MENUE'),
    ],
  },
};

/** Welche Abläufe passen zum Gerät? Liefert sortierte Liste inkl. Sperr-Grund für AUTO. */
function applicableProcedures(device) {
  const sk = device.protection_class || 'SK I';
  const it = isItDevice(device);
  const auto = autoModeCheck(device);
  const list = [];
  const push = (id, recommended, disabledReason) => list.push({ id, name: PROCEDURES[id].name, description: PROCEDURES[id].description, recommended, disabled: !!disabledReason, disabledReason: disabledReason || null });

  let rec;
  if (device.device_type === 'extension') rec = 'VL';
  else if (device.connection_type === 'fixed') rec = sk === 'SK I' ? 'FEST' : 'SK2';
  else if (sk === 'SK III' || device.device_type === 'battery') rec = 'SK3';
  else if (it) rec = 'EDV';
  else rec = sk === 'SK II' ? 'SK2' : 'SK1';

  push('AUTO', false, auto.allowed ? null : auto.reason);
  if (sk === 'SK I') push('SK1', rec === 'SK1', it ? 'EDV-/Bürogeräte bitte mit „T 240“ prüfen (Bedienungsanleitung Kap. 5.2.5).' : null);
  if (sk === 'SK II') push('SK2', rec === 'SK2', it ? 'EDV-/Bürogeräte bitte mit „T 240“ prüfen (Bedienungsanleitung Kap. 5.2.5).' : null);
  if (sk === 'SK III' || device.device_type === 'battery') push('SK3', true, null);
  if (sk !== 'SK III') push('EDV', rec === 'EDV', null);
  if (sk === 'SK I') push('VL', rec === 'VL', null);
  if (sk === 'SK I') push('FEST', rec === 'FEST', null);
  return { recommended: rec, autoMode: auto, procedures: list };
}

function skScene(device, procId) {
  const sk = device.protection_class === 'SK II' ? 'sk2' : device.protection_class === 'SK III' ? 'sk3' : 'sk1';
  if (procId === 'AUTO') return sk === 'sk3' ? 'sk1' : sk;
  if (procId === 'EDV') return sk;
  return sk;
}

/**
 * Baut den Ablauf für ein konkretes Gerät inkl. berechneter Grenzwerte.
 * @returns {{id,name,switchPos,description,steps,limits,profile,warnings}}
 */
function buildProcedure(procId, device, { profile = DEFAULT_PROFILE, standard = 'VDE 0702' } = {}) {
  const proc = PROCEDURES[procId];
  if (!proc) throw new Error(`Unbekannter Prüfablauf: ${procId}`);
  const warnings = [];
  if (procId === 'AUTO') {
    const chk = autoModeCheck(device);
    if (!chk.allowed) {
      const err = new Error(chk.reason);
      err.code = 'AUTO_NOT_ALLOWED';
      err.alternative = chk.alternative;
      throw err;
    }
    warnings.push(proc.precondition);
  }
  if (!proc.classes.includes(device.protection_class) && !(procId === 'SK3' && device.device_type === 'battery')) {
    warnings.push(`Achtung: Ablauf „${proc.name}“ ist für ${proc.classes.join('/')} vorgesehen, das Gerät ist als ${device.protection_class} erfasst.`);
  }
  const limits = limitsFor(device, { profile, standard });
  const steps = proc.build(skScene(device, procId)).map((s) => {
    const keys = s.type === 'measure' ? [s.key, ...(s.extraKeys || [])] : s.type === 'function' ? s.keys : [];
    return {
      ...s,
      quantities: keys.map((k) => ({ key: k, ...QUANTITIES[k], limit: limits[k] || null, required: s.type === 'measure' && k === s.key && !s.optional })),
    };
  });
  return { id: proc.id, name: proc.name, switchPos: proc.switchPos, description: proc.description, steps, limits, profile, profileName: PROFILES[profile]?.name, standard, warnings };
}

function listProcedures() {
  return Object.values(PROCEDURES).map((p) => ({ id: p.id, name: p.name, switchPos: p.switchPos, classes: p.classes, description: p.description }));
}

module.exports = {
  PROCEDURES,
  VISUAL_ITEMS,
  VISUAL_ITEMS_EXTENSION,
  FUNCTION_ITEMS,
  REMOTE,
  suggestDeviceType,
  isItDevice,
  autoModeCheck,
  applicableProcedures,
  buildProcedure,
  listProcedures,
  groupForMeasurementNo,
};
