# RS-232-Schnittstelle des SECUTEST 0701/0702S

Zusammenfassung von Kapitel 8 der Bedienungsanleitung (3-348-692-01, 9/7.97) und wie das Programm die Schnittstelle nutzt.
Die Umsetzung folgt der Anleitung, ein echtes Gerät war beim Schreiben **nicht** verfügbar. Weicht dein Gerät (andere Firmware) ab, helfen das **Terminal** und die **erweiterten Schnittstellen-Einstellungen** auf der Seite „SECUTEST“. Ein [Issue](../../../issues) mit dem Mitschnitt hilft allen.

## Hardware

| Merkmal | Wert |
|---|---|
| Buchse | 9-polige D-SUB-Buchse **RS232 (10)** oben links |
| Format | 9600 Baud, 8 Datenbits, keine Parität, 1 Stoppbit (9600 8N1) |
| Handshake | Software, XON/XOFF (^Q / ^S) |
| Protokoll | nach DIN 19244, Ende einer Meldung = `<CR>` (0x0D), `<LF>` wird ignoriert |
| Netz an Prüfdose per Befehl | nur mit codiertem Schnittstellenstecker (Pin 1–9 und Pin 5–6 gebrückt), sonst Taste (14) |

Am PC: ein USB-RS232-Adapter (FTDI, Prolific PL2303, WCH CH340 oder Silicon Labs CP210x). Meist genügt ein 1:1-Kabel. Kommt keine Antwort, ein Nullmodemkabel bzw. einen Nullmodemadapter probieren.

## Steuerzeichen

| Zeichen | Bedeutung |
|---|---|
| `^C` (0x03) | Abbruch jeder Funktion |
| `^D` (0x04) | Echo ein (Terminalbetrieb) |
| `^F` (0x06) | Echo aus (Rechnersteuerung). Das Programm sendet das beim Verbinden |
| `^G` (0x07) | Piepser |
| `^S` / `^Q` | Software-Handshake |

## Telegrammaufbau

```
<OPERATION><ADRESSE><OPERATOR>[PARAMETER[;PARAMETER]]$<CHKSUM><CR>
```

* **OPERATOR**: `?` Anfrage, `!` Zuweisung, `=` Antwort
* **ADRESSE**: 0…90, nur nötig, wenn mehrere Geräte am Bus hängen (`IDNx!y` vergibt eine Adresse)
* **CHKSUM**: Summe der ASCII-Werte aller Zeichen *inklusive* `$`, Übertrag über FF abgeschnitten, als 2 Hex-Zeichen
* Das Gerät prüft nur die ersten drei Zeichen des Befehls. Groß-/Kleinschreibung ist egal.
* Quittung: `Y<ADR>$<CS>` (ausgeführt) bzw. `N<ADR>$<CS>` (nicht ausgeführt)

Beispiel: `IDN?` → gesendet wird `IDN?$` + Prüfsumme + CR.

> Die Beispiel-Prüfsummen in der Anleitung passen teils nicht zum Text (Druckfehler). Das Programm meldet abweichende Prüfsummen deshalb nur als Warnung im Terminal und verwirft die Antwort nicht.

## Befehle

| Befehl | Funktion | Verwendung im Programm |
|---|---|---|
| `IDN?` | Geräteidentifikation (Hersteller, Typ, Firmware, Datum, Geräte-ID, Kalibrierung) | Auto-Ping/Erkennung, Protokoll „Messgerät“ |
| `IDN!y` | Adresse setzen | erweiterte Einstellungen |
| `MES?` | Anschlussflags (Hex) + laufende Messnummern (max. 4) | gerätegeführter Modus (Live), Live-Monitor |
| `MES!m` | Messung mit Messnummer *m* starten (Remote) | PC-gesteuerter Modus |
| `WER?m1,m2` | Messwerte abfragen (`---.-` = nicht ermittelt) | Live-Werte, Übernahme |
| `TAS!t` | Taste simulieren: 0 loslassen, 1 HILFE, 2 ▼, 3 ▲, 4 ↵, 5 FUNCTION-TEST; `R`/`r` Remote ein/aus; `M`/`m` Bereichswahl manuell/automatisch | Fernbedienung, Remote-Modus |
| `RST!a` | Neustart in Schalterstellung *a* (1…8, 1 = FUNCTION-TEST) | „Schalterstellung per Schnittstelle setzen“ |
| `PRO?` | Ergebnis der letzten Sicherheitsprüfung (701-Ergebnisstring) | gerätegeführter Modus → „Ergebnis abholen“ |

### Schalterstellungen für `RST!a`

Laut Anleitung ist nur **1 = FUNCTION-TEST** festgelegt. Die übrigen Nummern leitet das Programm aus der Reihenfolge am Drehschalter ab (im Uhrzeigersinn) und lassen sich in den Einstellungen anpassen:

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|
| FUNCTION-TEST | MENUE | OFF | AUTO | SK I | SK II | SK III | T 240 |

### Anschlussflags (`MES?`, Byte AA)

| Bit | Bedeutung |
|---|---|
| 5 | Prüfling an Prüfdose |
| 4 | Buchse L belegt |
| 3 | Buchse N belegt |
| 2 | Fingerkontakt erkannt |
| 1 | Schutzleiter an Buchse SL |
| 0 | Schutzleiter an Prüfdose |

## Messnummern (Auszug, Kap. 8.5)

| Nr. | Messart | genutzt für |
|---|---|---|
| 0 | löscht alle Messwerte | |
| 1 / 2 / 3 / 4 | Kurzschluss- / Sonden- / Einschalt- / Schutzleiterkontrolle (Y/N) | Anschlusskontrolle |
| 8 / 10 | R<sub>SL</sub> starten, Polung + / − (3 Ω) | R<sub>SL</sub> |
| 12 / 13 / 14 / 15 | R<sub>SL</sub> Min / Max / Diff / **WC** | R<sub>SL</sub> (WC = um Gebrauchsfehler korrigiert) |
| 16 (17, 18) | R<sub>ISO</sub> starten (Bereich 1/10/100 MΩ) | R<sub>ISO</sub> |
| 19 / 20 / 21 | R<sub>ISO</sub> Min / Max / **WC** | R<sub>ISO</sub> |
| 96 / 97 / 98 | Isolationsspannung U<sub>ISO</sub> / Min / Max | U<sub>ISO</sub> |
| 24 / 26 | Ersatz-Ableitstrom über Sonde / über Klemme (20 mA) | I<sub>B</sub> (SK II) / I<sub>EA</sub> (SK I) |
| 28 / 29 / 30 | I<sub>EA</sub> Min / Max / **WC** | I<sub>EA</sub>, I<sub>B</sub> |
| 32 / 33 / 34 / 36 | I<sub>Sonde</sub> AC / DC / TRMS / AC-Max | Berührungsstrom T 240 |
| 48–63 | Netzmessung: P (52), λ (49), W (55), I (56), S (57), U (58), f (59), P<sub>max</sub> (51), I<sub>max</sub> (61) | Funktionstest |
| 64 / 66 / 67 | ΔI / ΔI-Max / ΔI-**WC** | Funktionstest |
| 72 / 73 / 74 | Kleinspannung U<sub>AC</sub> / U<sub>DC</sub> / TRMS | Versorgungsspannung SK III |

## Ergebnisstring `PRO?`

```
PROTOKOLLx=Geräte-ID;BBCCDDEEFFGGHHII;MW1;GW1;…;MWn;GWn$CS
```

| Byte | Inhalt |
|---|---|
| BB | durchgeführte Messungen: .0 R<sub>SL</sub>, .1 R<sub>ISO</sub>, .2 I<sub>EA</sub>, .3 I<sub>Sonde</sub>, .4 U<sub>AC/DC</sub>, .5 ΔI, .6 Funktionstest |
| CC | Klassifizierung 1: .0 SK I, .1 SK III, .2 elektronisch (T200), .3 hoher I<sub>EA</sub>, .4 EDV (T240), .5 Leitungslänge eingegeben, .6 ΔI-Auslösung, .7 Anschluss an Klemme |
| DD | Klassifizierung 2: .0 keine Sichtprüfung, .1 Prüfling war aus, .2 Geräteverbund, .3 Abtastmodus SK II, .4 Netzumpolung, .5 keine I<sub>EA</sub> nötig |
| EE | nicht bestanden: .0 R<sub>SL</sub>, .1 R<sub>ISO</sub>, .2 I<sub>EA</sub>, .3 I<sub>Sonde</sub>, .4 U, .5 ΔI, **.7 Gesamtprüfung nicht bestanden** |
| FF | Sichtprüfung nicht bestanden: .0 Schutzleiter, .1 Isolierteile, .2 Gehäuse, .3 Anschlussleitung, .4 Typschild, .5 unsachgemäßer Gebrauch, .7 Funktionstest n. b. |

Die Messwert-/Grenzwertpaare folgen der Reihenfolge der gesetzten Bits in BB: R<sub>SL</sub> (2 Werte, bei Geräteverbund 4), R<sub>ISO</sub> (4: R und U<sub>ISO</sub>), I<sub>EA</sub> (2), I<sub>Sonde</sub> (2), U bei SK III (4: AC, DC), ΔI (2). Die Messwerte sind die **schlechtesten Werte, um den Gebrauchsfehler korrigiert**.

Das Programm übernimmt daraus alle Messwerte, die Sichtprüfungsmängel und die Bewertung des Geräts („device verdict“). Danach bewertet es **zusätzlich selbst** nach dem gewählten Grenzwertprofil. Weichen die beiden Bewertungen ab (z. B. 1997 noch 7 mA, heute 3,5 mA Schutzleiterstrom), zeigt es einen Hinweis an. Maßgeblich ist die Bewertung nach aktueller Norm.

## Betriebsarten im Programm

1. **Gerätegeführt (empfohlen):** Du bedienst das SECUTEST wie gewohnt. Das Programm fragt per `MES?` und `WER?` ab, was gerade gemessen wird, und zeigt die passende Grafik mit den Live-Werten. Am Ende liest es das Ergebnis per `PRO?` ein.
2. **PC-gesteuert:** `TAS!R` (Remote ein) → `MES!m` je Schritt → `WER?…` für Live- und Endwerte (WC) → `TAS!r`.
3. **Manuell:** keine Schnittstelle nötig.

## Automatische Erkennung („Auto-Ping“)

* Alle seriellen Ports werden aufgelistet: Windows `COMx`, macOS `/dev/cu.*`, Linux `/dev/ttyUSB*`, `/dev/ttyACM*` und `/dev/ttyS0–3`. USB-Seriell-Chips (FTDI, PL2303, CH340, CP210x) werden zuerst geprüft.
* Jeder Port wird mit 9600 8N1 geöffnet. Dann gehen `^F` und `IDN?` an das Gerät, zwei Versuche mit je 1,5 s Wartezeit.
* Antwortet ein Gerät mit `IDN…=` bzw. `GMN`/`SecuTest`, verbindet sich das Programm mit diesem Port.
* Hot-Plug: Alle 3 s wird geprüft, ob ein neuer Adapter eingesteckt wurde. Der wird sofort angepingt.
