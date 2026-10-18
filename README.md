> [!CAUTION]
> ## ⚠ Haftungsausschluss / Sicherheitshinweis
> **Prüfungen nach DIN VDE 0701/0702 und alle Arbeiten an elektrischen Anlagen und Geräten dürfen ausschließlich von Elektrofachkräften durchgeführt werden** (oder von elektrotechnisch unterwiesenen Personen unter Leitung und Aufsicht einer Elektrofachkraft). **Elektrischer Strom ist lebensgefährlich.**
>
> Dieses Projekt ist **Open Source und wird ohne jede Gewähr bereitgestellt. Es kann Fehler enthalten**, insbesondere bei Grenzwerten, Bewertungen, der Kommunikation mit dem Prüfgerät und den Anleitungen. Die Software ersetzt weder die Bedienungsanleitung des Prüfgeräts noch die gültigen Normen oder die fachliche Beurteilung durch eine Elektrofachkraft.
>
> **Die Autoren und Mitwirkenden übernehmen – soweit gesetzlich zulässig – keinerlei Haftung für Personen-, Sach- oder Vermögensschäden**, die direkt oder indirekt durch die Nutzung dieser Software entstehen. Die Nutzung erfolgt auf eigene Verantwortung. → [Vollständiger Haftungsausschluss](#haftungsausschluss)

# Secutest Prüfmanager

**Freies Prüf- und Datenbankprogramm für den Gossen Metrawatt SECUTEST 0701S / 0702S. Damit prüfst du elektrische Geräte nach DIN VDE 0701/0702, verwaltest sie und katalogisierst sie.**

Das Programm steuert das Prüfgerät über die eingebaute RS-232-Schnittstelle und führt dich Schritt für Schritt mit Grafiken durch jede Prüfung. Alle Messwerte landen in einer verschlüsselten Datenbank, die in OneDrive oder iCloud Drive liegen kann. Die Anmeldung ist per Zwei-Faktor-Code geschützt (Bitwarden, Microsoft oder Google Authenticator), und an fällige Prüfungen erinnert das Programm per E-Mail oder Kalender.
Es geht auch **ganz ohne Prüfgerät**: Messwerte lassen sich von Hand eintragen, oder du nimmst den eingebauten Simulator.

<p align="center"><img src="docs/images/22-schritt-schutzleiter-live.png" alt="Prüfassistent: Schutzleiterwiderstand mit Live-Werten und Anschlussgrafik" width="900"></p>

---

## Inhalt

1. [Funktionen im Überblick](#funktionen-im-überblick)
2. [Download & Start](#download--start)
3. [Erste Schritte](#erste-schritte)
4. [SECUTEST anschließen (RS-232)](#secutest-anschließen-rs-232)
5. [Prüfen: Betriebsarten](#prüfen-betriebsarten)
6. [Prüfabläufe je Schutzklasse](#prüfabläufe-je-schutzklasse)
7. [Grafische Schritt-Erklärungen](#grafische-schritt-erklärungen)
8. [Grenzwerte & Bewertung](#grenzwerte--bewertung)
9. [Nicht bestanden – was nun?](#nicht-bestanden--was-nun)
10. [Arbeitshilfen: Plakette scannen, Serienprüfung, Intervallvorschlag, Kalibrierung](#arbeitshilfen-plakette-scannen-serienprüfung-intervallvorschlag-kalibrierung)
11. [Datenbanken, Cloud & Sicherheit](#datenbanken-cloud--sicherheit)
12. [Prüferinnerungen per E-Mail & Kalender](#prüferinnerungen-per-e-mail--kalender)
13. [Protokolle, Prüfplaketten, Export](#protokolle-prüfplaketten-export)
14. [Gespeicherte Daten](#gespeicherte-daten)
15. [Entwicklung & automatische Releases](#entwicklung--automatische-releases)
16. [Ideen für weitere Funktionen](#ideen-für-weitere-funktionen)
17. [Fehlerbehebung (FAQ)](#fehlerbehebung-faq)
18. [Haftungsausschluss](#haftungsausschluss) · [Lizenz](#lizenz)

---

## Funktionen im Überblick

| Bereich | Was das Programm kann |
|---|---|
| **Prüfen nach VDE 0701/0702** | Fertige Abläufe für **AUTO** (automatische SK-I/SK-II-Erkennung), **SK I**, **SK II**, **SK III**, **T 240** (EDV/Büro), **Verlängerungsleitungen** (Adapter EL1) und **Festanschluss** (Einzelmessungen) |
| **Auto-Modus-Schutz** | Sperrt den AUTO-Modus automatisch bei **EDV-/Bürogeräten** (Monitor, PC, Drucker …), **SK III**, Leitungen und Festanschluss und schlägt den richtigen Ablauf vor. Das entspricht der Bedienungsanleitung, Kap. 5.2 |
| **RS-232-Steuerung** | Gerätegeführt mit Live-Anzeige und Ergebnis-Übernahme (`PRO?`) oder PC-gesteuert (`MES!`/`WER?`). Dazu Fernbedienung, Terminal (in den Einstellungen abschaltbar) und Protokollmitschnitt |
| **Auto-Ping & Hot-Plug** | Findet das SECUTEST automatisch an jedem USB-RS232-Adapter unter Windows, macOS und Linux |
| **Manueller Betrieb** | Geräte anlegen, prüfen und bearbeiten **ohne** Prüfgerät, auf Wunsch mit Gebrauchsfehler-Korrektur der Anzeigewerte |
| **Grafische Anleitung** | Zu jedem Prüfschritt eine animierte Skizze: Drehschalterstellung, Prüfdose, Sonde, Messpunkt und Handgriff (Leitung bewegen, Stecker drehen …) |
| **Bewertung** | Automatisch nach **aktueller Norm** (DIN VDE 0701-0702:2008, DIN EN 50678/50699) oder nach den **Gerätegrenzwerten von 1997**. Weicht die Bewertung des SECUTEST ab, zeigt das Programm einen Hinweis |
| **Maßnahmen** | Ist ein Gerät durchgefallen, wählst du aus einer Liste, wie es weitergeht (sperren, reparieren, Leitung tauschen, ausmustern …). Der Gerätestatus wird automatisch gesetzt |
| **Datenbank** | SQLite, auf Wunsch verschlüsselt mit **SQLCipher (AES-256)**. Liegt **lokal**, in **OneDrive**, **iCloud Drive** oder einem eigenen Ordner und lässt sich jederzeit **verschieben**. Beliebig viele, voneinander getrennte Datenbanken, z. B. für Bekannte |
| **Anmeldung** | **Passwort** und **Zwei-Faktor-Code (TOTP)** aus Bitwarden, Microsoft oder Google Authenticator, Aegis, 2FAS … – beides **optional** und jederzeit in den Einstellungen ein- und ausschaltbar. Dazu Wiederherstellungscodes und automatische Sperre bei Inaktivität |
| **Prüftermine** | Prüfdatum wird automatisch eingetragen und der nächste Termin aus dem Prüfintervall berechnet. Fällige Prüfungen lassen sich **auf den nächsten Monat verschieben**, das **Prüfintervall** wird je Gerät gespeichert – auch für mehrere Geräte auf einmal, mit **Intervallvorschlag nach DGUV Vorschrift 3** (Einsatzbereich und Fehlerquote) |
| **Plakette scannen** | QR-Code der Prüfplakette per **Kamera**, **USB-Handscanner** oder **Foto** lesen – das Gerät öffnet sich oder die Prüfung startet sofort |
| **Serienprüfung** | Gleiche Geräte **mehrfach anlegen** und nacheinander prüfen; Einstellungen und (auf Wunsch) Sichtprüfung werden vom Vorgänger übernommen, am Ende Plaketten für alle |
| **Prüfmittel** | **Kalibrier-Erinnerung** für das SECUTEST (ein-/ausschaltbar): Warnung vor Ablauf, Kalibrierstand im Prüfprotokoll |
| **Erinnerungen** | Wahlweise per **E-Mail**, per **Kalender** oder beides – **zum Fälligkeitstermin je Gerät** oder **monatsweise gebündelt**. Kalendertermine (.ics) mit Alarm, automatische Kalendereinladungen nach Änderungen |
| **Dokumentation** | Druckfertiges **Prüfprotokoll** (PDF über den Druckdialog), **Prüfplaketten mit QR-Code**, Fotos und PDFs pro Gerät, Änderungsprotokoll, Export als CSV und JSON |
| **Plattformen** | Windows (x64, ARM64), macOS (Universal, Apple Silicon, Intel), Linux als .deb, .rpm, Arch, Alpine (.apk), Snap, Flatpak, AppImage und tar.gz (x64, ARM64, auch musl). Mit integriertem Node.js (Alpine/musl: Node.js der Distribution) |

<table>
<tr>
<td><img src="docs/images/10-uebersicht.png" alt="Übersicht" width="420"><br><sub>Übersicht mit fälligen Prüfungen</sub></td>
<td><img src="docs/images/11-geraeteliste.png" alt="Geräteliste" width="420"><br><sub>Geräteliste mit Filtern und Fälligkeiten</sub></td>
</tr>
<tr>
<td><img src="docs/images/13-pruefung-auto-gesperrt.png" alt="Auto-Modus gesperrt" width="420"><br><sub>Monitor erkannt: AUTO gesperrt, T 240 empfohlen</sub></td>
<td><img src="docs/images/24-ergebnis-nicht-bestanden-massnahmen.png" alt="Nicht bestanden" width="420"><br><sub>Nicht bestanden: Gründe und Maßnahmenliste</sub></td>
</tr>
<tr>
<td><img src="docs/images/40-pruefprotokoll.png" alt="Prüfprotokoll" width="420"><br><sub>Druckfertiges Prüfprotokoll</sub></td>
<td><img src="docs/images/15-uebersicht-dunkel.png" alt="Dunkelmodus" width="420"><br><sub>Hell- und Dunkelmodus</sub></td>
</tr>
</table>

---

## Download & Start

### Fertige Pakete (empfohlen)

Der Prüfmanager ist ein **Desktop-Programm mit eigenem Fenster** (Electron) für Windows, macOS und Linux. Bei jeder Änderung baut und testet GitHub automatisch ein neues Release. Unter **[Releases → neueste Version](../../releases/latest)** lädst du das passende Paket herunter – es ist nichts weiter zu installieren.

Maßgeblich ist die **Download-Tabelle im jeweiligen Release**: Sie nennt genau die Dateien, die dort liegen. Fehlt ein Pflichtpaket, wird gar nicht veröffentlicht. Snap und Flatpak entstehen in eigenen Build-Schritten; scheitert einer davon ausnahmsweise, steht das im Release unter „Diesmal nicht enthalten“.

| System | Datei | Installation / Start |
|---|---|---|
| **Windows 10/11** (x64) | `…-win-x64-setup.exe` | Doppelklick, Installation ohne Administratorrechte, Startmenü- und Desktop-Verknüpfung |
| **Windows 11 ARM64** (Snapdragon, Surface) | `…-win-arm64-setup.exe` | wie oben |
| Windows – ein Installer für beide | `…-win-setup.exe` | wählt x64 oder ARM64 selbst (größerer Download) |
| Windows portabel | `…-win-x64-portable.exe` / `…-win-arm64-portable.exe` | ohne Installation starten, z. B. vom USB-Stick |
| **macOS Universal** (Apple Silicon + Intel) | `…-mac-universal.dmg` | Öffnen, **„Secutest Pruefmanager“** in *Programme* ziehen (beim ersten Start Rechtsklick → *Öffnen*) |
| macOS nur Apple Silicon / nur Intel | `…-mac-arm64.dmg` / `…-mac-x64.dmg` | wie oben, kleinerer Download (auch als `.zip`) |
| **Ubuntu, Linux Mint, Debian, Pop!_OS** | `…-linux-amd64.deb` | `sudo apt install ./…-linux-amd64.deb` |
| **Raspberry Pi OS / Ubuntu ARM64** | `…-linux-arm64.deb` | `sudo apt install ./…-linux-arm64.deb` |
| **Fedora, openSUSE, RHEL/Alma/Rocky** | `…-linux-x86_64.rpm` (ARM: `…-linux-aarch64.rpm`) | `sudo dnf install ./….rpm` bzw. `sudo zypper install --allow-unsigned-rpm ./….rpm` |
| **Arch, Manjaro, EndeavourOS** | `…-linux-x64.pacman` (ARM: `…-linux-arm64.pacman`) | `sudo pacman -U ./….pacman` |
| **Snap** (jede Distribution mit snapd) | `…-linux-amd64.snap` | `sudo snap install --dangerous ./….snap` |
| **Flatpak** (jede Distribution) | `….flatpak` | `flatpak install --user ./….flatpak` |
| **AppImage** (jede Distribution) | `…-linux-x86_64.AppImage` / `…-linux-arm64.AppImage` | `chmod +x ….AppImage` und doppelklicken |
| Linux portabel | `…-linux-x64.tar.gz` / `…-linux-arm64.tar.gz` | `tar xzf …` und `./secutest-pruefmanager` |

* **Start:** wie jedes Programm über Startmenü, Dock bzw. Programme-Ordner. Es läuft immer nur **ein** Fenster; ein zweiter Start holt das vorhandene nach vorn.
* **Beenden:** Fenster schließen oder **⏻ Programm beenden**. Die Datenbank wird dabei gesperrt und die SECUTEST-Verbindung getrennt. Bei einer nicht gespeicherten Prüfung fragt das Programm vorher nach.
* **Ohne Prüfgerät ausprobieren:** `secutest-pruefmanager --simulator` (macOS: `open -a "Secutest Pruefmanager" --args --simulator`, Windows: Verknüpfung mit `--simulator` am Ende).
* **Protokolldateien** (Fehlersuche): Menü *Hilfe → Protokolldateien öffnen*.
* **Update:** einfach das neue Paket installieren. Deine Datenbanken und Einstellungen liegen nicht im Programmordner und bleiben erhalten – auch beim Umstieg von der früheren Browser-Version.
* Prüfsummen aller Dateien stehen in `SHA256SUMS.txt`. Was sich geändert hat, steht im **[Änderungsprotokoll](CHANGELOG.md)**.

<details>
<summary><b>Hinweise zu Windows SmartScreen / macOS Gatekeeper / Linux-Rechten</b></summary>

* **Windows:** Das Programm ist nicht signiert. Bei „Der Computer wurde durch Windows geschützt“ klickst du auf *Weitere Informationen* → *Trotzdem ausführen*.
* **macOS:** Die App ist nicht von Apple signiert. Beim ersten Start: Rechtsklick → *Öffnen*, oder *Systemeinstellungen → Datenschutz & Sicherheit → Trotzdem öffnen*. Blockiert macOS weiterhin, einmalig im Terminal ausführen:
  `xattr -dr com.apple.quarantine "/Applications/Secutest Pruefmanager.app"`
  Bitte die App vorher in den Programme-Ordner ziehen – direkt aus „Downloads“ gestartet, führt macOS sie aus einem schreibgeschützten Schattenordner aus.
* **Linux:** Für den USB-RS232-Adapter muss dein Benutzer in der Gruppe `dialout` sein (Debian, Ubuntu, Mint, Fedora, openSUSE) bzw. in `uucp` (Arch, Manjaro): `sudo usermod -aG dialout $USER`, danach ab- und wieder anmelden.
</details>

### Unterstützte Linux-Distributionen

Voraussetzung ist **glibc ≥ 2.34** und **libstdc++ aus GCC ≥ 11** (für das mitgelieferte SQLCipher-Modul) sowie eine grafische Oberfläche. Auf älteren Systemen hilft das **Flatpak**, denn es bringt seine eigenen Bibliotheken mit. Electron gibt es nur für glibc-Systeme; musl-Distributionen (Alpine, Void-musl) werden daher nicht mehr unterstützt.

| Distribution | Mindestversion | Paket | getestet |
|---|---|---|---|
| Ubuntu (inkl. Kubuntu, Xubuntu …) | **22.04 LTS** | `.deb` | ✅ 22.04, 24.04 |
| Linux Mint | **21** | `.deb` | (basiert auf Ubuntu 22.04/24.04) |
| Debian | **12 „Bookworm“** | `.deb` | ✅ 12 |
| Pop!_OS, elementary OS, Zorin OS, KDE neon | 22.04-Basis | `.deb` | – |
| Raspberry Pi OS **64-Bit** | **12 „Bookworm“** | `-linux-arm64.deb` | ✅ ARM64-CI (Ubuntu) |
| Fedora | **35** | `.rpm` | ✅ aktuelle Version |
| RHEL, AlmaLinux, Rocky Linux, CentOS Stream | **9** | `.rpm` | ✅ Rocky 9 |
| openSUSE | **Tumbleweed**, Leap **16** | `.rpm` | ✅ Tumbleweed |
| Arch Linux, Manjaro, EndeavourOS, Garuda | rollierend | `.pacman` | ✅ aktuell |
| Distributionen mit snapd | snapd installiert | `.snap` | Snap-CI |
| Andere glibc-Distributionen (Gentoo, Solus, Void-glibc, Slackware 15+) | glibc ≥ 2.34 | `.AppImage` / `.tar.gz` | – |
| Ältere Systeme, NixOS, unveränderliche Systeme (Silverblue, SteamOS) | Flatpak installiert | `.flatpak` | Flatpak-CI |
| ChromeOS (Linux-Umgebung) | Debian 12 | `.deb` | – |

Nicht unterstützt: 32-Bit-Systeme (i386, armhf/armv7, also auch das 32-Bit-Raspberry-Pi-OS).

### Aus dem Quellcode

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
git clone <URL dieses Repositorys>
cd <Ordner>
npm install
npm run app            # Desktop-Programm
npm run app:simulator  # mit simuliertem SECUTEST
npm test               # Unit- und Integrationstests
npm run test:e2e       # Oberfläche im Desktop-Programm (Playwright, Simulator)
npm run dist:mac       # Pakete bauen (dist/electron/), ebenso dist:win, dist:linux
```

Ohne Fenster im Browser (z. B. zur Entwicklung): `npm start` bzw. `npm run simulator`, Optionen `--port 3701`, `--host 127.0.0.1`, `--simulator`, `--no-open`, `--selftest`.

---

## Erste Schritte

### 1. Haftungsausschluss bestätigen

Beim ersten Start zeigt das Programm den Sicherheitshinweis. Er muss einmal bestätigt werden.

<img src="docs/images/01-haftungsausschluss.png" alt="Haftungsausschluss" width="700">

### 2. Datenbank anlegen

Unter **„+ Neue Datenbank“** vergibst du einen Namen, z. B. *Meine Geräte* oder *Familie Beispiel*, und wählst den Speicherort:

* **OneDrive / iCloud Drive** (falls gefunden, Unterordner `SecutestPruefmanager`) – die Datei ist automatisch auf allen deinen Rechnern verfügbar,
* **Nur auf diesem Rechner (lokal)** – Ordner `Dokumente/SecutestPruefmanager`,
* **Eigener Ordner** – z. B. USB-Stick, NAS, Nextcloud- oder Dropbox-Ordner.

Dazu kommen Eigentümer, Prüfer und Standard-Prüfintervall. **Passwort und Zwei-Faktor-Anmeldung sind empfohlen, aber freiwillig.** Mit Passwort wird die Datei verschlüsselt; ohne Passwort ist sie nicht wiederherstellbar. Ohne Passwort bleibt die Datei lesbar für jeden, der Zugriff darauf hat. Beides lässt sich später unter *Einstellungen → Sicherheit & Speicherort* ein- und ausschalten.

<img src="docs/images/60-neue-datenbank-optional.png" alt="Neue Datenbank – Speicherort, Passwort und 2FA optional" width="700">

### 3. Zwei-Faktor-Anmeldung einrichten (optional)

Scanne den QR-Code mit deiner Authenticator-App, z. B. **Bitwarden Authenticator**, Microsoft Authenticator, Google Authenticator, Aegis oder 2FAS, und gib den 6-stelligen Code ein. Erst dann wird die Datenbank angelegt. Bewahre die **10 Wiederherstellungscodes** sicher auf, z. B. in Bitwarden. Damit kommst du auch ohne Handy an die Daten.

<img src="docs/images/04-zwei-faktor.png" alt="2FA einrichten" width="700">

> TOTP (RFC 6238) ist ein offener Standard. Er funktioniert offline und kostenlos, ohne Konto bei einem Anbieter.

### 4. Anmelden

Datenbank wählen, Passwort eingeben, dann den Code aus der App. Ohne Passwort und ohne 2FA öffnet ein Klick die Datenbank direkt; sie ist in der Liste mit **🔓 ohne Passwort** gekennzeichnet.

<img src="docs/images/02-datenbank-auswahl.png" alt="Datenbank-Auswahl" width="49%"> <img src="docs/images/05-anmeldung-2fa.png" alt="2FA-Anmeldung" width="49%">

### 5. Gerät anlegen und prüfen

Pflichtangaben sind nur Bezeichnung und Schutzklasse, die Inventarnummer wird automatisch vergeben. Aus der Bezeichnung erkennt das Programm die **Geräteart** und schlägt sie vor (EDV, Heizgerät, Elektronik, Leitung). Bei EDV-Geräten erscheint sofort der Hinweis, dass der AUTO-Modus nicht möglich ist.

<img src="docs/images/12-geraet-anlegen-edv-hinweis.png" alt="Gerät anlegen" width="700">

---

## SECUTEST anschließen (RS-232)

1. **USB-RS232-Adapter** am PC einstecken (FTDI, Prolific PL2303, CH340 oder CP210x), ggf. den Treiber installieren.
2. Mit der **9-poligen Buchse RS232 (10)** oben links am SECUTEST verbinden. Meist reicht ein 1:1-Kabel. Kommt keine Antwort, ein **Nullmodem**-Kabel oder einen Nullmodemadapter versuchen.
3. SECUTEST einschalten. Der Drehschalter darf nicht auf OFF stehen.
4. Das Programm **findet das Gerät automatisch** (Auto-Ping mit `IDN?` an allen Ports). Ein eingesteckter Adapter wird sofort erkannt (Hot-Plug). Alternativ: Seite **SECUTEST** → *Automatisch suchen* oder den Port von Hand wählen.

| System | Typischer Port |
|---|---|
| Windows | `COM3`, `COM4` … |
| macOS | `/dev/cu.usbserial-…`, `/dev/cu.usbmodem…` |
| Linux | `/dev/ttyUSB0`, `/dev/ttyACM0` |

Die Seite **SECUTEST** zeigt Status und Geräte-Identität. Dazu kommen ein Live-Monitor, eine Fernbedienung (▲ ▼ ↵ ⓘ FUNCTION-TEST) und ein **Terminal**, über das sich jeder Befehl direkt senden lässt. Unter *Erweiterte Einstellungen* stellst du Adresse, Prüfsumme, Timeout und die Nummern der Schalterstellungen ein.

Das Terminal ist ein Werkzeug für Fehlersuche und Fortgeschrittene. Unter *Einstellungen → Programm* lässt es sich **ausschalten**; dann ist es ausgeblendet und auch über die Schnittstelle gesperrt. Die Einstellung gilt für das Programm auf diesem Rechner.

<img src="docs/images/30-secutest-schnittstelle.png" alt="SECUTEST-Seite" width="800">

<img src="docs/images/70-programm-terminal.png" alt="Einstellungen – Programm: Terminal ein/aus" width="700">

Technische Details zum Protokoll: **[docs/RS232-PROTOKOLL.md](docs/RS232-PROTOKOLL.md)**.

> [!NOTE]
> Die Schnittstelle ist nach Kapitel 8 der Bedienungsanleitung umgesetzt. Mit einem echten Gerät wurde sie bisher **nicht** getestet. Mit dem Simulator und den Tests ist sie geprüft. Weicht dein Gerät ab, hilft das Terminal; Rückmeldungen als Issue sind willkommen.

---

## Prüfen: Betriebsarten

| Betriebsart | Ablauf | Geeignet für |
|---|---|---|
| **SECUTEST – gerätegeführt** (empfohlen) | Das SECUTEST führt durch seinen eigenen Prüfablauf (z. B. SK II: R<sub>ISO</sub> → Ableitstrom → Funktionstest). Das Programm erkennt per `MES?`, welcher Schritt gerade läuft, und zeigt Grafik und Live-Werte. Mit **Automatik** drückt es Start bzw. ↵ (`TAS!4`), übernimmt jeden stabilen Wert und schaltet weiter; den Funktionstest machst du am Gerät. Am Ende übernimmt es **alle** Messwerte samt Sichtprüfungsmängeln per `PRO?` | normale Prüfungen, auch im AUTO-Modus |
| **SECUTEST – PC-gesteuert** | Das Programm macht eine **Anschlusskontrolle** (Kurzschluss, Sonde, Prüfling eingeschaltet, Schutzleiter), startet dann jede Messung selbst (`MES!`), zeigt Live-Werte und übernimmt die WC-Werte (`WER?`) | Einzelmessungen, mehrere Messpunkte, volle Kontrolle |
| **Manuell** | Werte vom Display oder einem anderen Prüfgerät eintippen. Optional berücksichtigt das Programm den Gebrauchsfehler laut Tabelle im Anhang | ohne Schnittstelle, andere Prüfgeräte, Nachtragen |

Der Prüfassistent führt dich durch: **Anschließen → Sichtprüfung → Messungen → Funktionstest → Bewertung**. In jedem Schritt siehst du die Grafik, die nummerierten Handgriffe, Hinweise, die Grenzwerte und eine Ampel für jeden Messwert.
Schritte, die nicht zutreffen, lassen sich **mit Begründung** überspringen, z. B. „keine berührbaren leitfähigen Teile“.

<img src="docs/images/20-schritt-anschluss.png" alt="Anschlusskontrolle" width="49%"> <img src="docs/images/21-schritt-sichtpruefung.png" alt="Sichtprüfung" width="49%">

<img src="docs/images/23-ergebnis-bestanden.png" alt="Ergebnis bestanden" width="800">

**Prüfdatum und nächster Termin werden automatisch eingetragen.** Das gilt für neue Geräte genauso wie für jede Wiederholungsprüfung: Prüfdatum ist der Prüftag, der nächste Termin ergibt sich aus Prüfdatum plus Prüfintervall.

---

## Prüfabläufe je Schutzklasse

| Ablauf | Drehschalter | Messschritte | Hinweise |
|---|---|---|---|
| **AUTO** | AUTO | Sichtprüfung → R<sub>SL</sub> (nur SK I) → R<sub>ISO</sub> → I<sub>EA</sub> → Funktionstest | Gerät erkennt SK I/II selbst. **Nicht** für SK III, EDV/Büro, Leitungen, Festanschluss. Das Programm sperrt AUTO in diesen Fällen |
| **SK I** | SK I | Sichtprüfung → R<sub>SL</sub> (Leitung bewegen, mehrere Messpunkte) → R<sub>ISO</sub> → I<sub>EA</sub> → optional Berührungsstrom an Teilen ohne PE → Funktionstest | Grenzwert R<sub>SL</sub> hängt von der Leitungslänge ab |
| **SK II** | SK II | Sichtprüfung → R<sub>ISO</sub> mit Sonde je Metallteil → Ersatz-Berührungsstrom je Teil → Funktionstest | schutzisolierte Geräte |
| **SK III** | SK III | Sichtprüfung → R<sub>ISO</sub> (Versorgungsanschlüsse an L/N, spannungsfrei) → optional Versorgungsspannung → Funktionsprüfung | kein Funktionstest an der Prüfdose. R<sub>ISO</sub> entfällt bei ≤ 20 VA und ≤ 42 V |
| **T 240 (EDV/Büro)** | T 240 | Sichtprüfung → R<sub>SL</sub> (SK I) → Berührungsstrom I<sub>Sonde</sub> in **beiden Steckerpositionen** (Netzumpolung) → Funktionstest | keine Isolationsmessung. Unterbricht den Betrieb, Daten vorher sichern |
| **Verlängerungsleitung** | AUTO → Untermenü | Sichtprüfung → R<sub>SL</sub> → R<sub>ISO</sub> → Durchgang/Kurzschluss/Polarität | Zubehör **Adapter EL1**. Kabeltrommeln vorher abwickeln |
| **Festanschluss** | MENUE | Einzelmessungen R<sub>SL</sub>, R<sub>ISO</sub>, I<sub>EA</sub> mit Sonde | Sicherungen entfernen, N auftrennen. Nur durch Elektrofachkräfte |

**Sichtprüfung.** Die Checkliste deckt sich mit den Sichtprüfungs-Bits des SECUTEST: Schutzleiter, Isolierteile, Gehäuse, Anschlussleitung, Typschild, unsachgemäßer Gebrauch. Ergänzt wird sie um Sicherungen, Kühlöffnungen und Bedienteile.

**Funktionstest.** Gemessen werden Differenzstrom ΔI, Netzspannung, Strom, Wirk- und Scheinleistung, Leistungsfaktor und elektrische Arbeit. Er ist nur nach bestandener Sicherheitsprüfung erlaubt. Den Prüfling vor dem Einschalten der Prüfdose am eigenen Schalter **ausschalten**.

---

## Grafische Schritt-Erklärungen

Jeder Schritt zeigt eine vereinfachte Frontansicht des SECUTEST 0701S mit den Nummern aus der Bedienungsanleitung. Zu sehen sind Drehschalter (6), Tasten (7, 8, 12, 13, 14), Buchsen L/N/SL (1–3), Sonde (4/5) und Prüfdose (18). Dazu kommen der Prüfling, die Sonde mit dem markierten Messpunkt und die Handlung, z. B. *Leitung bewegen*, *nicht berühren – 500 V*, *beide Steckerpositionen* oder *Taste 14*.

| | |
|---|---|
| <img src="docs/images/schritt-sk1-schutzleiter.svg" alt="SK I Schutzleiterwiderstand" width="400"><br><sub>SK I – Schutzleiterwiderstand: Sonde an Metallteil, Leitung bewegen</sub> | <img src="docs/images/schritt-sk2-isolation.svg" alt="SK II Isolation" width="400"><br><sub>SK II – Isolationswiderstand: jedes Metallteil abtasten, nicht berühren</sub> |
| <img src="docs/images/schritt-edv-beruehrungsstrom.svg" alt="EDV" width="400"><br><sub>T 240 – Berührungsstrom in beiden Steckerpositionen</sub> | <img src="docs/images/schritt-sk3-anschluss.svg" alt="SK III" width="400"><br><sub>SK III – spannungsfrei, Versorgungsanschlüsse an L/N</sub> |
| <img src="docs/images/schritt-verlaengerung-el1.svg" alt="Verlängerungsleitung" width="400"><br><sub>Verlängerungsleitung mit Adapter EL1</sub> | <img src="docs/images/schritt-funktionstest.svg" alt="Funktionstest" width="400"><br><sub>Funktionstest: Netz an Prüfdose über Taste 14</sub> |

---

## Grenzwerte & Bewertung

Das Programm bewertet **immer selbst**. Zur Wahl stehen zwei Profile; für jede Prüfung wird gespeichert, welches benutzt wurde.

| Messgröße | Aktuell (DIN VDE 0701-0702:2008 / DIN EN 50678 & 50699) | SECUTEST-Gerätewerte (Stand 1997) |
|---|---|---|
| Schutzleiterwiderstand R<sub>SL</sub> | ≤ 0,3 Ω bis 5 m, je weitere 7,5 m + 0,1 Ω, max. 1 Ω | ≤ 0,3 Ω bis 5 m, + 0,1 Ω je 5 m (0701) bzw. 7,5 m (0702); Festanschluss EDV 1 Ω |
| Isolationswiderstand R<sub>ISO</sub> SK I | ≥ 1 MΩ (Heizelemente > 3,5 kW: ≥ 0,3 MΩ) | ≥ 0,5 MΩ (Heizgeräte: Ausgleich durch bestandenen I<sub>EA</sub>) |
| R<sub>ISO</sub> SK II | ≥ 2 MΩ | ≥ 2 MΩ (elektronisch: Ausgleich durch I<sub>EA</sub>) |
| R<sub>ISO</sub> SK III / Batterie | ≥ 0,25 MΩ (250 V) | ≥ 0,25 MΩ |
| Schutzleiter-/Ersatzableitstrom I<sub>EA</sub> SK I | ≤ 3,5 mA (Heizgeräte ≥ 3,5 kW: 1 mA/kW, max. 10 mA) | ≤ 7 mA (≥ 6 kW: 15 mA; Elektronik: 1 mA bzw. 0,5 mA mehrphasig) |
| Berührungsstrom (SK II / Teile ohne PE) | ≤ 0,5 mA | ≤ 0,5 mA |
| Berührungsstrom I<sub>Sonde</sub> (T 240) | ≤ 0,5 mA | ≤ 0,25 mA |
| Differenzstrom ΔI | SK I wie I<sub>EA</sub>, SK II ≤ 0,5 mA | dto. |
| Versorgungsspannung SK III | ≤ 50 V AC / ≤ 120 V DC | dto. |

* **Gebrauchsfehler:** Werte, die per Schnittstelle kommen, sind *Worst-Case*-Werte und bereits um den Gebrauchsfehler korrigiert. Bei manuell eingegebenen **Anzeigewerten** rechnet das Programm den Grenzwert nach der Tabelle im Anhang der Anleitung auf den zulässigen Anzeigewert um, z. B. 0,3 Ω → 0,275 Ω.
* **Abweichung zum Gerät:** Das SECUTEST von 1997 kennt teils ältere, mildere Grenzwerte, z. B. 7 mA statt 3,5 mA. Meldet das Gerät „bestanden“, das Programm nach aktueller Norm aber „nicht bestanden“, siehst du einen deutlichen Hinweis. Maßgeblich ist die Norm.
* **Vollständigkeit:** Fehlt ein Pflicht-Messwert ohne Begründung oder wurde die Sichtprüfung nicht dokumentiert, gilt die Prüfung als nicht bestanden.

> Grenzwerte ohne Gewähr. Sie sind zentral in `src/vde/limits.js` hinterlegt und dort nachvollziehbar und anpassbar. Maßgeblich sind die jeweils gültigen Normen.

---

## Nicht bestanden – was nun?

Fällt ein Gerät durch, musst du vor dem Speichern eine **Maßnahme** wählen. Der Gerätestatus wird automatisch gesetzt, und bei Bedarf wird das Gerät sofort zur Nachprüfung fällig:

| Maßnahme | Gerätestatus |
|---|---|
| Gerät sperren und kennzeichnen („Defekt – nicht benutzen“) | gesperrt |
| Instandsetzung veranlassen (danach Prüfung nach VDE 0701) | in Reparatur |
| Anschlussleitung / Stecker erneuern und erneut prüfen | in Reparatur |
| Messung wiederholen / Nachprüfung (Verdacht auf Mess- oder Anschlussfehler) | gesperrt |
| An Hersteller / Fachwerkstatt senden (Garantie) | in Reparatur |
| Rückgabe an Eigentümer mit schriftlichem Mängelhinweis | gesperrt |
| Ausmustern / fachgerecht entsorgen (Elektroschrott) | ausgemustert |
| Sonstige Maßnahme (Freitext) | gesperrt |

Gesperrte Geräte erscheinen rot in Übersicht und Liste. Auch ihre Prüfplakette ist rot markiert („GESPERRT – NICHT BENUTZEN“).

---

## Arbeitshilfen: Plakette scannen, Serienprüfung, Intervallvorschlag, Kalibrierung

### 📷 Prüfplakette scannen
Menü **Plakette scannen**: QR-Code der Prüfplakette mit der **Webcam** bzw. eingebauten Kamera lesen, mit einem **USB-Handscanner** (arbeitet wie eine Tastatur – auch Inventar- oder Seriennummer eintippen geht) oder aus einem **Foto**. Danach wahlweise *Gerät anzeigen*, *gleich prüfen* oder *hier bleiben* und die nächste Plakette scannen. Der QR-Code neuer Plaketten enthält eine kurze Kennung der Datenbank – gehört eine Plakette zu einer anderen Datenbank, sagt das Programm das. Das Kamerabild bleibt auf dem Rechner.

<img src="docs/images/82-plakette-scannen.png" alt="Plakette scannen" width="800">

### 🔁 Serienprüfung gleicher Geräte
1. Im Gerätedetail **⧉× Mehrfach anlegen**: z. B. aus einer Verlängerungsleitung zehn identische machen (eigene Inventarnummern, auf Wunsch „#1“, „#2“ …) – oder in der Geräteliste mehrere Geräte auswählen.
2. **▶ Serienprüfung** starten: Die Geräte werden nacheinander geprüft. Prüfablauf, Durchführung, Norm, Grenzwerte und Prüfer kommen vom vorherigen Gerät, die Sichtprüfung lässt sich vorausfüllen – mit dem Hinweis, jeden Punkt am Gerät zu kontrollieren. Eine Leiste zeigt den Fortschritt, Geräte lassen sich überspringen.
3. Am Ende: Übersicht aller Ergebnisse und **Prüfplaketten für alle bestandenen Geräte** auf einen Klick.

<table>
<tr>
<td><img src="docs/images/84-serienpruefung-start.png" alt="Serienprüfung starten" width="420"><br><sub>Fortschrittsleiste und übernommene Einstellungen</sub></td>
<td><img src="docs/images/85-serienpruefung-sicht-uebernommen.png" alt="Sichtprüfung übernommen" width="420"><br><sub>Sichtprüfung vom Vorgänger – am Gerät kontrollieren</sub></td>
</tr>
<tr>
<td><img src="docs/images/83-mehrfach-anlegen.png" alt="Mehrfach anlegen" width="420"><br><sub>Gleiche Geräte mehrfach anlegen</sub></td>
<td><img src="docs/images/86-serienpruefung-ergebnis.png" alt="Ergebnis der Serie" width="420"><br><sub>Ergebnis und Plaketten für alle</sub></td>
</tr>
</table>

### 💡 Intervallvorschlag nach DGUV Vorschrift 3
Jedes Gerät hat einen **Einsatzbereich** (Standard für neue Geräte in den Einstellungen). Der Knopf **💡 Vorschlag nach DGUV V3** im Geräteformular bzw. im Dialog „Prüfintervall ändern“ (dort je Gerät) schlägt das Intervall nach DGUV Vorschrift 3, Durchführungsanweisung zu § 5, **Tabelle 1B** vor:

| Einsatzbereich | Richtwert | Maximalwert bei Fehlerquote < 2 % |
|---|---|---|
| Baustelle, Montage, Außeneinsatz | 3 Monate | 1 Jahr |
| Werkstatt, Fertigung, Lager, Landwirtschaft, gewerbliche Küche | 6 Monate | 1 Jahr |
| Büro, Verwaltung, Schule, Praxis, Hotelzimmer | 6 Monate | 2 Jahre |
| Privathaushalt (keine DGUV-Pflicht – Empfehlung) | 12 Monate | 2 Jahre |

Die **Fehlerquote** berechnet das Programm aus den Prüfungen der letzten 24 Monate im selben Einsatzbereich (mindestens 10 Prüfungen, sonst gilt der Richtwert). Geräte, die schon einmal durchgefallen sind, bleiben beim Richtwert; Verlängerungsleitungen erhalten höchstens 12 Monate, Heizgeräte im Haushalt 12 Monate. Jeder Vorschlag nennt seine Begründung – **ohne Gewähr**, maßgeblich ist die Gefährdungsbeurteilung des Betreibers (BetrSichV, TRBS 1201).

<img src="docs/images/87-dguv-vorschlag-geraet.png" alt="Vorschlag im Geräteformular" width="49%"> <img src="docs/images/88-dguv-vorschlag-mehrere.png" alt="Vorschlag für mehrere Geräte" width="49%">

### 📏 Kalibrierung des SECUTEST
Unter *Einstellungen → Programm* lässt sich die **Kalibrier-Erinnerung ein- und ausschalten**: letzte Kalibrierung, Intervall (üblich 12 Monate), Vorwarnzeit, Geräte-ID, Kalibrier-Nr. und Labor/Zertifikat. Geräte-ID und Kalibrier-Nr. lassen sich per `IDN?` aus dem verbundenen Gerät übernehmen (das SECUTEST meldet die Nummer der aktuellen Kalibrierung, aber kein Datum). Ist die Erinnerung eingeschaltet, warnen Übersicht und Prüfassistent rechtzeitig, jedes Prüfprotokoll nennt den Kalibrierstand, der Termin lässt sich als `.ics` in den Kalender übernehmen, und eine neue Kalibrier-Nr. im Gerät wird erkannt. Die Daten gelten für das Prüfgerät an diesem Rechner (nicht je Datenbank).

<img src="docs/images/80-kalibrierung-einstellungen.png" alt="Kalibrierung" width="49%"> <img src="docs/images/81-kalibrierung-warnung.png" alt="Kalibrier-Warnung" width="49%">

---

## Datenbanken, Cloud & Sicherheit

* **Eine Datei pro Datenbank** (`*.secudb`). Für jeden Bekannten legst du eine eigene, komplett getrennte Datenbank an, jeweils mit eigenem Passwort und eigener 2FA (oder ohne).
* **Speicherort:** lokal, in der Cloud (z. B. `OneDrive/SecutestPruefmanager/`, `iCloud Drive/SecutestPruefmanager/`) oder in einem eigenen Ordner. Cloud-Datenbanken tauchen auf anderen Rechnern automatisch unter *In der Cloud gefunden* auf.
* **Verschieben:** *Einstellungen → Sicherheit & Speicherort → Datenbank verschieben*. Ablauf: Sicherung → Kopie am neuen Ort → Kopie öffnen und prüfen (`quick_check`) → erst dann wird die alte Datei entfernt. Die Sicherungen ziehen auf Wunsch mit um, die Anmeldung bleibt bestehen.
* **Verschlüsselung (optional):** SQLCipher-kompatibel (AES-256, PBKDF2-HMAC-SHA512). Mit Passwort liegen auch Fotos, SMTP-Passwort und 2FA-Geheimnis nur verschlüsselt in der Datei. Öffnen lässt sie sich zur Not auch mit *DB Browser for SQLite (SQLCipher)*. Ein Passwort lässt sich jederzeit **festlegen** (die Datei wird dann verschlüsselt), **ändern** oder **entfernen** (die Datei wird entschlüsselt). Nach dem Verschlüsseln bietet das Programm an, die alten unverschlüsselten Sicherungen zu löschen.
* **Zwei-Faktor-Anmeldung (optional):** einrichten, neu einrichten (neues Handy) oder abschalten. Kritische Änderungen bestätigst du mit dem Code aus der App – oder mit einem Wiederherstellungscode, wenn das Handy weg ist; ohne 2FA mit dem Passwort.
* **Sync-Sicherheit:** Das Programm nutzt keinen WAL-Modus, also keine Zusatzdateien, die der Cloud-Sync zerreißen könnte. Eine **Sperrdatei** (`*.lock`) warnt, wenn die Datenbank auf einem anderen Rechner geöffnet ist.
* **Sicherungen:** beim ersten Öffnen jedes Tages automatisch, zusätzlich auf Knopfdruck. Sie landen im Ordner `Sicherungen` neben der Datei (verschlüsselt, sofern ein Passwort gesetzt ist); die letzten 15 bleiben erhalten.
* **Anmeldung:** Passwort und TOTP-Code (sofern eingeschaltet) mit Schutz gegen wiederverwendete Codes. Nach 5 Fehlversuchen wird 5 Minuten gesperrt. Bei Inaktivität sperrt das Programm automatisch (Standard 15 min) und entfernt dabei den Schlüssel aus dem Speicher.
* **Lokal:** Der Server lauscht nur auf `127.0.0.1`, mit CSRF- und DNS-Rebinding-Schutz.

<table>
<tr>
<td><img src="docs/images/66-sicherheit-ungeschuetzt.png" alt="Sicherheit – ungeschützt" width="420"><br><sub>Ohne Passwort und 2FA: deutlicher Hinweis</sub></td>
<td><img src="docs/images/68-sicherheit-geschuetzt.png" alt="Sicherheit – geschützt" width="420"><br><sub>Passwort und 2FA aktiv</sub></td>
</tr>
<tr>
<td><img src="docs/images/67-2fa-einrichten.png" alt="2FA nachträglich einrichten" width="420"><br><sub>2FA nachträglich einrichten</sub></td>
<td><img src="docs/images/69-datenbank-verschieben.png" alt="Datenbank verschieben" width="420"><br><sub>Datenbank verschieben (lokal → OneDrive)</sub></td>
</tr>
</table>

> **Ehrlicher Hinweis zum Sicherheitsmodell:** Die Verschlüsselung der Datei hängt am **Passwort**. Die Zwei-Faktor-Anmeldung schützt nur den Zugang über das Programm – **ohne Passwort ist die Datei selbst ungeschützt**, auch mit 2FA. Wer Datei *und* Passwort hat, kann sie mit SQLCipher-Werkzeugen öffnen. Wähle daher ein starkes Passwort und verwahre es z. B. in Bitwarden.

Lokale Programmeinstellungen (Liste der Datenbanken, Schnittstelle) liegen in:
Windows `%APPDATA%\SecutestPruefmanager`, macOS `~/Library/Application Support/SecutestPruefmanager`, Linux `~/.config/secutest-pruefmanager`.

---

## Prüferinnerungen per E-Mail & Kalender

Unter *Einstellungen → Erinnerungen* legst du fest, **wie** und **wann** erinnert wird:

| | Zum Fälligkeitstermin (je Gerät) | Monatsweise gebündelt |
|---|---|---|
| **✉️ E-Mail** | Mail x Tage vor dem Termin, am Fälligkeitstag und regelmäßig bei Überfälligkeit | **eine Sammelmail pro Monat** mit allen in diesem Monat fälligen Geräten (x Tage vor bzw. am Monatsersten), Überfällige erscheinen jeden Monat erneut |
| **📅 Kalender** | ein Termin je Gerät am Fälligkeitstag, mit Alarm | **ein Sammeltermin am Monatsersten** mit der Liste aller Geräte des Monats |
| **✉️📅 Beides** | Mail mit Kalenderdatei im Anhang | Sammelmail mit Monats-Kalenderdatei |

<img src="docs/images/65-erinnerungen-konfigurieren.png" alt="Erinnerungen konfigurieren" width="800">

* **E-Mail:** SMTP mit Vorlagen für Outlook/Hotmail, iCloud, Gmail, GMX, WEB.DE und T-Online, jeweils mit App-Passwort. Jede Erinnerung geht nur einmal raus, alles steht im Versandprotokoll.
* **Kalender:** Termine lassen sich als `.ics` herunterladen – passend für Outlook, Apple-/iCloud-Kalender, Google und Thunderbird. Jeder Termin hat eine feste ID: Beim erneuten Import (oder per automatischer **Kalendereinladung** nach einer Prüfung, einer Verschiebung oder einer Intervalländerung) wird der vorhandene Termin **aktualisiert** statt verdoppelt. Monate ohne fällige Geräte werden abgesagt. Kalendertermine erinnern **auch dann, wenn das Programm geschlossen ist**.
* Erinnerung **pro Gerät** ein- und ausschaltbar; Empfänger pro Datenbank, z. B. der Eigentümer.
* E-Mails werden versendet, solange das Programm läuft und die Datenbank entsperrt ist (beim Öffnen und alle 6 h). Für den Betrieb ohne geöffnetes Programm gibt es ein Skript, das du z. B. täglich über die Aufgabenplanung startest:
  ```bash
  npm run reminders -- --db "Meine Geräte"         # Passwort-Abfrage
  SECUTEST_DB_PASSWORD=… npm run reminders -- --db "Meine Geräte"
  ```
  ⚠ Dafür muss das Datenbank-Passwort auf dem Rechner hinterlegt sein. Das nur auf einem eigenen, geschützten Rechner tun.

### Fällige Prüfungen verschieben, Prüfintervall ändern

* **⏭ Verschieben:** in der Übersicht (einzeln oder „alle verschieben“), in der Geräteliste für mehrere ausgewählte Geräte oder im Gerätedetail. Standard ist **„auf den nächsten Monat“** (gleicher Tag im Folgemonat; bei überfälligen Geräten der Folgemonat von heute), alternativ ein festes Datum. Eine Begründung landet im Änderungsprotokoll. Der **ursprüngliche Termin bleibt sichtbar** („⏭ verschoben“), bis das Gerät geprüft wurde.
* **⏱ Prüfintervall:** wird **je Gerät in der Datenbank** gespeichert – im Gerätedetail oder für mehrere ausgewählte Geräte in der Geräteliste. Wahlweise wird der nächste Termin ab der letzten bestandenen Prüfung neu berechnet oder beibehalten. In den Einstellungen steht nur das Standard-Intervall für **neue** Geräte.

> Prüffristen dienen der Sicherheit (DGUV Vorschrift 3, BetrSichV). Verschiebe eine Prüfung nur, wenn das Gerät bis dahin sicher benutzt werden kann – die Verantwortung liegt beim Betreiber.

<table>
<tr>
<td><img src="docs/images/61-uebersicht-verschieben.png" alt="Übersicht mit Verschieben" width="420"><br><sub>Übersicht: ⏭ je Gerät oder „alle verschieben“</sub></td>
<td><img src="docs/images/62-termin-verschieben.png" alt="Termin verschieben" width="420"><br><sub>Auf den nächsten Monat oder ein Datum</sub></td>
</tr>
<tr>
<td><img src="docs/images/63-geraete-mehrfachauswahl.png" alt="Mehrfachauswahl" width="420"><br><sub>Mehrere Geräte auswählen</sub></td>
<td><img src="docs/images/64-intervall-aendern.png" alt="Intervall ändern" width="420"><br><sub>Prüfintervall für mehrere Geräte, mit Vorschau</sub></td>
</tr>
</table>

---

## Protokolle, Prüfplaketten, Export

* **Prüfprotokoll** pro Prüfung mit Auftraggeber, Prüfer, Prüfling, Norm, Ablauf, Messgerät, Sichtprüfung, allen Messwerten samt Grenzwerten, Funktionstest, Gesamtergebnis, Maßnahme, nächstem Termin und Unterschriftsfeld. Drucken oder über den Druckdialog als PDF speichern.
* **Prüfplaketten** (62 × 34 mm) mit Inventarnummer, Prüfdatum, nächster Prüfung (MM/JJJJ) und QR-Code, zum Ausdrucken auf Etiketten.
* **Fotos & PDFs** pro Gerät (Typschild, Mängel), verschlüsselt gespeichert und automatisch verkleinert.
* **Export:** CSV (Excel) und JSON (komplette Daten). Dazu ein **Änderungsprotokoll** aller Aktionen.

<img src="docs/images/41-pruefplaketten.png" alt="Prüfplaketten" width="600">

---

## Gespeicherte Daten

| Tabelle | Inhalt |
|---|---|
| `devices` | Inventar-Nr., Bezeichnung, Hersteller, Typ, Seriennummer, Kategorie, Schutzklasse, Geräteart, Anschlussart, Phasen, Nennspannung/-leistung/-strom, Heizleistung, Leitungslänge und Querschnitt, Standort, Eigentümer, Kaufdatum, Prüfintervall, Status, Erinnerung, letzte Prüfung und Ergebnis, nächster Termin, ursprünglicher Termin und Anzahl Verschiebungen, Einsatzbereich (für den Intervallvorschlag), Notizen |
| `inspections` | Prüfdatum, Start und Ende, Norm (0701/0702), Anlass, Ablauf, Betriebsart, Schutzklasse, Grenzwertprofil, Prüfer, Ergebnis, Bewertung des SECUTEST, Maßnahme, Intervall, nächster Termin, Messgerät (IDN) und Kalibrierstand, Rohdaten (`PRO?`), Bemerkungen |
| `measurements` | je Messwert: Messgröße (R<sub>SL</sub>, R<sub>ISO</sub>, U<sub>ISO</sub>, I<sub>EA</sub>, I<sub>B</sub>, I<sub>Sonde</sub>, ΔI, U<sub>AC/DC</sub>, U, I, P, S, λ, W, f …), Messpunkt, Wert, Originalanzeige (z. B. `>310.0`), Einheit, Grenzwert, Vergleich, Ergebnis, Quelle |
| `inspection_checks` | Sicht- und Funktionsprüfung je Punkt (i. O. / Mangel / entfällt) mit Notiz, entfallene Schritte mit Begründung |
| `attachments` | Fotos und PDFs |
| `reminder_log`, `audit_log` | versendete Erinnerungen, Änderungsprotokoll |

---

## Entwicklung & automatische Releases

```
src/
  server.js            Express-Server (nur 127.0.0.1), Sicherheits-Header, Selbsttest
  config.js            lokale App-Konfiguration
  auth/                TOTP (RFC 6238), Sitzungen, Wiederherstellungscodes
  db/                  SQLCipher-Datenbank, Schema/Migrationen, Cloud-Ordner, Datenzugriff
  vde/                 Grenzwerte, Prüfabläufe je Schutzklasse, Bewertung, Maßnahmen, Intervallvorschlag DGUV V3
  secutest/            RS-232-Protokoll, Treiber, Auto-Ping/Hot-Plug, Simulator, Manager, Kalibrierung
  reminders/           SMTP-Mails, iCalendar, Zeitplan
  report/              Prüfprotokoll & Prüfplaketten
  routes/              REST-API
public/                Oberfläche (HTML/CSS/JavaScript-Module, ohne Build-Schritt)
  js/illustrations.js  SVG-Grafiken der Prüfschritte
  js/views/scan.js     QR-Scanner für Prüfplaketten (Kamera, Handscanner, Foto)
electron/main.js       Desktop-Programm: Fenster, Einzelinstanz, Menü, Kamera-Freigabe, Protokolldatei
build/                 Programm-Icons für die Pakete (aus packaging/icons)
scripts/               release-notes.js, selftest-packaged.js (Selbsttest im gepackten Programm), send-reminders.js
packaging/icons/       Icon als SVG und PNG in allen Größen
test/                  Tests (node:test) – Protokoll, Mitschnitte des echten Geräts, TOTP, Grenzwerte, DB, Simulator, API
e2e/                   End-to-End-Tests des Desktop-Programms (Playwright + Electron, Simulator)
```

* **Technik:** Electron (Desktop-Programm), Node.js (JavaScript, kein Build-Schritt), Express (nur 127.0.0.1, im Programm eingebettet), better-sqlite3-multiple-ciphers (SQLCipher), serialport, nodemailer, qrcode, jsQR (QR-Erkennung für Browser ohne eingebauten BarcodeDetector, Apache-2.0).
* **Tests:** `npm test` (77 Tests, darunter Mitschnitte des echten SECUTEST als Replay) und `npm run test:e2e` (Prüfdurchlauf im Desktop-Programm). `npm run app:simulator` startet das Programm mit simuliertem SECUTEST und mehreren Szenarien, auch mit Fehlerfällen.
* **CI:** Jeder Pull Request wird unter Windows, macOS und Linux getestet – Unit-Tests, Selbsttest und die komplette Oberfläche im Desktop-Programm mit simuliertem SECUTEST (`.github/workflows/ci.yml`).
* **Releases:** Jeder Push bzw. Merge auf `main` löst `.github/workflows/release.yml` aus. Ablauf: Tests → Pakete mit [electron-builder](https://www.electron.build) auf echten Windows-, macOS- und Linux-Rechnern bauen → **jedes gepackte Programm testen** (Selbsttest von SQLCipher, serialport und Simulator sowie ein kompletter Prüfdurchlauf in der Oberfläche) → Installation in Ubuntu-, Debian-, Fedora-, Rocky-, openSUSE- und Arch-Containern, zusätzlich auf ARM64 und Intel-Mac → Snap und Flatpak → Veröffentlichung als GitHub-Release `v<Version>-build.<Nr>`. Die Release-Notizen kommen samt Bildern aus dem obersten Abschnitt von [`CHANGELOG.md`](CHANGELOG.md) (`scripts/release-notes.js`). Pull Requests, die das Paketieren ändern, durchlaufen dieselbe Kette ohne Veröffentlichung.
* Pakete lokal bauen: `npm run dist:mac` / `dist:win` / `dist:linux` (Windows-Pakete lassen sich auch auf macOS bauen; rpm braucht `rpmbuild`). Gepacktes Programm testen: `node scripts/selftest-packaged.js <Programmordner>` und `SECUTEST_E2E_APP=<Programmdatei> npm run test:e2e`.
* **Bei jeder Änderung:** einen Abschnitt in `CHANGELOG.md` mit Beschreibung und Screenshots (`docs/images/`) ergänzen und die Version in `package.json` anheben.

Beiträge sind willkommen. Bitte vor einem Pull Request `npm test` ausführen.

---

## Ideen für weitere Funktionen

Vorschläge, die für Prüfer besonders nützlich wären (umgesetzt sind bereits QR-Scanner, Serienprüfung, Intervallvorschlag nach DGUV V3 und Kalibrier-Erinnerung):

1. **Kunden- und Auftragsverwaltung** mit Sammelprotokoll und Rechnung bzw. Prüfbericht für Bekannte als PDF.
2. **Digitale Unterschrift** von Prüfer und Kunde direkt am Tablet oder mit der Maus.
3. **Statistiken:** Ausfallquoten nach Kategorie, Hersteller und Alter, Trend der Messwerte über Jahre, etwa ein langsam steigender Ableitstrom als Frühwarnung.
4. **Mobil-Ansicht / PWA** für Tablet-Bedienung am Prüfplatz (z. B. Plakette mit der Tablet-Kamera scannen).
5. **Import** aus PC.doc/PS3 oder CSV, um bestehende Geräte zu übernehmen.
6. **SECUTEST PSI** (Drucker-/Speichermodul) auslesen und Autostore-Protokolle importieren.
7. **Sprachausgabe/Signalton** bei Grenzwertverletzung und für Schrittansagen, damit die Hände frei bleiben.
8. **Weitere Prüfgeräte** (SECUTEST S2N+, BENNING ST 725, Fluke 6500), sofern deren Protokolle offen sind.
9. **Hersteller-Prüfanweisungen** pro Gerätetyp als Vorlage hinterlegen.
10. **Mehrbenutzer** mit Rollen (Prüfer/Leser) und Protokollfreigabe.
11. **Kalibrier-Erinnerung per E-Mail** zusätzlich zur Warnung im Programm und zur Kalenderdatei.

---

## Fehlerbehebung (FAQ)

<details><summary><b>Das SECUTEST wird nicht gefunden</b></summary>

* Ist der Adapter-Treiber installiert? Unter Windows im Geräte-Manager unter „Anschlüsse (COM & LPT)“ nachsehen.
* SECUTEST eingeschaltet, Drehschalter nicht auf OFF?
* 1:1- statt Nullmodemkabel probieren oder umgekehrt.
* Seite **SECUTEST** → *Automatisch suchen* zeigt pro Port das Ergebnis. Im **Terminal** testweise `IDN?` senden, auch einmal ohne Prüfsumme. (Ist das Terminal nicht zu sehen: *Einstellungen → Programm → RS-232-Terminal anzeigen*.)
* Linux: Benutzer in Gruppe `dialout`? macOS: `/dev/cu.*` statt `/dev/tty.*` verwenden (macht das Programm automatisch).
</details>

<details><summary><b>„Die Datenbank ist vermutlich auf … geöffnet“</b></summary>

Die Datenbank ist auf einem anderen Rechner offen oder das Programm wurde nicht sauber beendet. Schließe sie dort. Wenn das nicht geht, z. B. nach einem Absturz, wähle *Trotzdem öffnen*. Gleichzeitiges Arbeiten auf zwei Rechnern über die Cloud kann Änderungen überschreiben.
</details>

<details><summary><b>Handy verloren / neue Authenticator-App</b></summary>

Melde dich mit einem **Wiederherstellungscode** an und richte unter *Einstellungen → Sicherheit & Speicherort → 2FA neu einrichten* die neue App ein. Die Rückfrage dort bestätigst du ebenfalls mit einem Wiederherstellungscode („Handy nicht zur Hand?“). Danach am besten neue Wiederherstellungscodes erzeugen.
</details>

<details><summary><b>Passwort oder 2FA wieder abschalten</b></summary>

*Einstellungen → Sicherheit & Speicherort*: „Passwort entfernen“ entschlüsselt die Datei, „2FA abschalten“ entfernt die Code-Abfrage. Beides wird vorher mit Code bzw. Passwort bestätigt. Ohne Passwort kann jeder mit Zugriff auf die Datei die Daten lesen.
</details>

<details><summary><b>Code wird abgelehnt</b></summary>

Die Uhrzeit von PC und Handy muss stimmen (automatische Zeit aktivieren). Jeder Code gilt nur einmal, also gegebenenfalls den nächsten abwarten.
</details>

<details><summary><b>Konflikt-Kopien in OneDrive/iCloud („… (1).secudb“, „…-PCNAME.secudb“)</b></summary>

Die entstehen, wenn auf zwei Rechnern gleichzeitig geändert wurde. Öffne beide Dateien und übertrage die fehlenden Prüfungen. Im Zweifel hilft der JSON-Export oder eine Sicherung.
</details>

<details><summary><b>Port 3701 belegt</b></summary>

Läuft das Programm bereits? Sonst mit `--port 3702` starten.
</details>

---

## Haftungsausschluss

* **Nur für Fachpersonal:** Prüfungen nach DIN VDE 0701/0702 (DIN EN 50678 / DIN EN 50699) und alle Arbeiten an elektrischen Anlagen und Geräten dürfen nur von **Elektrofachkräften** durchgeführt werden, oder von elektrotechnisch unterwiesenen Personen unter Leitung und Aufsicht einer Elektrofachkraft. Elektrischer Strom ist lebensgefährlich.
* **Open Source ohne Gewähr:** Diese Software wird „wie besehen“ ohne jegliche Gewährleistung bereitgestellt. Sie **kann Fehler enthalten**, insbesondere bei Grenzwerten, Bewertungen, der RS-232-Kommunikation und den grafischen Anleitungen.
* **Kein Ersatz für Fachwissen:** Die Software ersetzt weder die Bedienungsanleitung des Prüfgeräts noch die geltenden Normen und Vorschriften (z. B. DGUV Vorschrift 3) noch die fachliche Beurteilung durch die verantwortliche Elektrofachkraft. Jede automatische Bewertung ist von der prüfenden Person zu kontrollieren. Im Zweifel gilt ein Gerät als nicht bestanden.
* **Keine Haftung:** Die Autoren und Mitwirkenden übernehmen, soweit gesetzlich zulässig, **keinerlei Haftung für Personen-, Sach- oder Vermögensschäden**, die direkt oder indirekt durch die Nutzung, Fehlfunktion oder fehlerhafte Ergebnisse dieser Software entstehen. Die Nutzung erfolgt ausschließlich auf eigene Verantwortung.
* **Marken:** Gossen Metrawatt und SECUTEST sind Marken der jeweiligen Inhaber. Dieses Projekt ist unabhängig und steht in keiner Verbindung zur GMC-I Messtechnik GmbH. Für das Prüfgerät gilt ausschließlich dessen Bedienungsanleitung.

## Lizenz

[MIT](LICENSE). Frei nutzbar, veränderbar und weitergebbar, jeweils mit Lizenz- und Haftungshinweis.
