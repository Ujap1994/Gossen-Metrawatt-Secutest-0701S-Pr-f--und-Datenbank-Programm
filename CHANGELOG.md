# Änderungsprotokoll

Alle Änderungen am Secutest Prüfmanager, die neueste oben. Der jeweils oberste Abschnitt erscheint automatisch (mit Bildern) in den Notizen des GitHub-Releases.

> ⚠ Open-Source-Software ohne Gewähr. Prüfungen nur durch Elektrofachkräfte. Siehe [Haftungsausschluss](README.md#haftungsausschluss).

## 1.2.0 – Passwort & 2FA optional, Speicherort frei wählbar, Erinnerungen nach Wunsch

### Neu: Passwort und Zwei-Faktor-Anmeldung sind freiwillig
Beim Anlegen einer Datenbank wählst du selbst: **mit oder ohne Passwort** (Verschlüsselung AES-256) und **mit oder ohne Zwei-Faktor-Anmeldung**. Beides bleibt empfohlen und lässt sich jederzeit unter *Einstellungen → Sicherheit & Speicherort* ändern:

* **Passwort festlegen:** Die bisher offene Datei wird verschlüsselt. Danach bietet das Programm an, alte unverschlüsselte Sicherungen zu löschen.
* **Passwort ändern** oder **entfernen**. Beim Entfernen wird die Datei nach einer deutlichen Warnung entschlüsselt.
* **2FA einrichten**, **neu einrichten** (z. B. bei neuem Handy) oder **abschalten**. Beim ersten Einschalten gibt es 10 Wiederherstellungscodes.
* Kritische Änderungen bestätigst du mit dem App-Code, ohne 2FA mit dem Passwort. **Neu:** Ist das Handy weg, geht das auch mit einem **Wiederherstellungscode**.
* Datenbanken ohne Passwort sind in der Liste mit **🔓 ohne Passwort** markiert und öffnen sich mit einem Klick.

<img src="docs/images/60-neue-datenbank-optional.png" alt="Neue Datenbank: Speicherort, Passwort und 2FA optional" width="720">

<img src="docs/images/66-sicherheit-ungeschuetzt.png" alt="Sicherheit – ungeschützte Datenbank" width="720">

<img src="docs/images/68-sicherheit-geschuetzt.png" alt="Sicherheit – Passwort und 2FA aktiv" width="720">

### Neu: Datenbank lokal, in der Cloud oder im eigenen Ordner – und verschiebbar
* Speicherort beim Anlegen: **OneDrive/iCloud Drive**, **nur auf diesem Rechner (lokal)** oder ein **eigener Ordner** (USB-Stick, NAS, Nextcloud …).
* **Datenbank verschieben**, z. B. von lokal nach OneDrive und zurück. Ablauf: Sicherung → Kopie → Kopie öffnen und prüfen → Original entfernen. Die Sicherungen ziehen mit um, und du bleibst angemeldet.

<img src="docs/images/69-datenbank-verschieben.png" alt="Datenbank verschieben" width="640">

### Neu: Erinnerungen nach Wunsch – E-Mail, Kalender, monatlich gebündelt
Unter *Einstellungen → Erinnerungen* wählst du, **wie** du erinnert wirst (**E-Mail**, **Kalender** oder **beides**) und **wann**:
* **zum Fälligkeitstermin**: jedes Gerät einzeln zu seinem Termin, oder
* **monatsweise gebündelt**: eine Sammelmail bzw. ein Sammeltermin am Monatsersten mit allen in diesem Monat fälligen Geräten. Überfällige Geräte erscheinen jeden Monat erneut.

Kalendertermine haben jetzt eine feste ID. Ein erneuter Import oder eine automatische Kalendereinladung **aktualisiert** den vorhandenen Termin, statt ihn zu verdoppeln. Verschobene Termine wandern mit, leere Monate werden abgesagt.

<img src="docs/images/65-erinnerungen-konfigurieren.png" alt="Erinnerungen konfigurieren" width="720">

### Neu: Fällige Prüfungen verschieben, Prüfintervall je Gerät ändern
* **⏭ Auf den nächsten Monat verschieben** (oder auf ein Datum): einzeln aus der Übersicht, „alle verschieben“ oder für mehrere ausgewählte Geräte in der Geräteliste. Eine Begründung landet im Änderungsprotokoll. Der ursprüngliche Termin bleibt bis zur nächsten Prüfung sichtbar (**„⏭ verschoben“**).
* **⏱ Prüfintervall ändern** für ein oder mehrere Geräte, gespeichert **je Gerät in der Datenbank**, mit Vorschau der neuen Termine. Wahlweise wird der nächste Termin neu berechnet oder beibehalten.

<img src="docs/images/61-uebersicht-verschieben.png" alt="Übersicht mit Verschieben" width="720">

<img src="docs/images/62-termin-verschieben.png" alt="Termin verschieben" width="560"> <img src="docs/images/64-intervall-aendern.png" alt="Prüfintervall ändern" width="560">

<img src="docs/images/71-geraet-verschoben.png" alt="Gerät mit verschobenem Termin" width="720">

### Neu: RS-232-Terminal ein- und ausschaltbar
Unter *Einstellungen → Programm* lässt sich das Terminal auf der SECUTEST-Seite abschalten. Es ist dann ausgeblendet und auch über die Schnittstelle gesperrt.

<img src="docs/images/70-programm-terminal.png" alt="Einstellungen – Programm" width="720">

### Verbessert
* Einstellungen mit Unterreitern: **Allgemein · Erinnerungen · Sicherheit & Speicherort · Programm**.
* Behoben: Die Auswahl „Qualifikation“ beim Anlegen einer Datenbank war leer.
* Behoben: Die Warnung „Nur noch … Wiederherstellungscodes“ erschien auch ohne 2FA.
* Das Erinnerungsskript (`npm run reminders`) fragt bei Datenbanken ohne Passwort kein Passwort mehr ab.
* Release-Test für openSUSE gegen kurzzeitig gestörte Spiegelserver abgesichert.
* Neue Tests für Verschlüsselung an/aus, optionale 2FA, Verschieben der Datenbank, Termine verschieben, Intervalländerung, monatliche Bündelung und Terminal-Schalter (jetzt 42 Tests).

## 1.1.0 – Pakete für alle Plattformen, „Programm beenden“

### Neu: Installationspakete für fast jedes System
<img src="packaging/icons/icon-128.png" alt="Programm-Icon" width="96" align="right">

Zu jedem Release gehören jetzt fertige Pakete mit eigenem Programm-Icon, fast alle mit integriertem Node.js:

| System | Paket |
|---|---|
| **Windows** x64 und **ARM64** (Snapdragon, Surface) | `.zip` mit `Secutest-Pruefmanager.cmd` |
| **macOS Universal** (Apple Silicon + Intel), dazu getrennt arm64 und Intel | `.zip` mit **„Secutest Pruefmanager.app“** (eigenes Icon, Doppelklick) und `.command` |
| **Ubuntu, Linux Mint, Debian, Pop!_OS, Raspberry Pi OS** (x64 + ARM64) | `.deb` |
| **Fedora, openSUSE, RHEL/Alma/Rocky** (x64 + ARM64) | `.rpm` |
| **Arch, Manjaro, EndeavourOS** (x64 + ARM64) | `.pkg.tar.zst` |
| **Alpine Linux, postmarketOS** (x64 + ARM64) | `.apk` (nutzt das Node.js der Distribution) |
| **Jede Linux-Distribution** | `.AppImage` (x64 + ARM64), `.flatpak` (x64) und `.snap` (x64) |
| Linux portabel | `.tar.gz` (x64 + ARM64), dazu musl-Varianten für Void-musl & Co. |

* Die Linux-Pakete installieren das Programm nach `/opt/secutest-pruefmanager`. Sie legen einen **Startmenü-Eintrag mit Icon** an, inklusive Aktion „Mit Simulator starten“, und den Befehl `secutest-pruefmanager`.
* **Unterstützte Linux-Distributionen:** Ubuntu ab 22.04, Linux Mint ab 21, Debian ab 12, Fedora ab 35, RHEL/Alma/Rocky ab 9, openSUSE Tumbleweed/Leap 16, Arch/Manjaro/EndeavourOS, Raspberry Pi OS 64-Bit ab Bookworm, Alpine ab 3.19. Ältere Systeme nehmen das Flatpak. Die Pakete prüfen die Mindestanforderung (glibc ≥ 2.34) schon bei der Installation.
* Jedes Paket wird automatisch getestet: Selbsttest auf Windows, macOS und Linux sowie Installation in echten **Ubuntu-, Debian-, Fedora-, Rocky-, openSUSE-, Arch- und Alpine-Containern**, dazu Snap- und Flatpak-Installation auf Ubuntu. Zusätzlich laufen Tests auf ARM64-Hardware (Linux, Windows) und auf Intel-Macs.

### Neu: „Programm beenden“ und Einzelinstanz
Ein Startsymbol (macOS-App, Linux-Menü, AppImage, Flatpak) startet das Programm ohne Terminalfenster. Beenden lässt es sich deshalb jetzt direkt in der Oberfläche, über **⏻ Programm beenden** in der Seitenleiste oder auf der Anmeldeseite. Startet man das Programm ein zweites Mal, öffnet sich einfach das bereits laufende im Browser.

<img src="docs/images/50-programm-beenden.png" alt="Programm beenden" width="720">

<img src="docs/images/51-programm-beendet.png" alt="Programm beendet" width="720">

### Verbessert
* Der Haftungsausschluss steht jetzt ganz oben auf der GitHub-Seite.
* Die Release-Notizen enthalten automatisch den Abschnitt aus diesem Änderungsprotokoll, samt Bildern.
* Behoben: Die Einträge „Hell/Dunkel“, „Haftungsausschluss“ und „Programm beenden“ in der Seitenleiste waren immer als aktiv markiert.

## 1.0.0 – Erste Version

* Prüfabläufe nach DIN VDE 0701/0702 für AUTO, SK I, SK II, SK III, T 240 (EDV/Büro), Verlängerungsleitungen (EL1) und Festanschluss; der AUTO-Modus wird für EDV-Geräte, SK III, Leitungen und Festanschluss automatisch gesperrt.
* RS-232-Steuerung des SECUTEST 0701S (gerätegeführt, PC-gesteuert, manuell), Auto-Ping/Hot-Plug-Erkennung, Simulator, Terminal.
* Animierte Grafik zu jedem Prüfschritt.
* Verschlüsselte Datenbanken (SQLCipher) in OneDrive/iCloud, mehrere getrennte Datenbanken, 2FA (TOTP), Wiederherstellungscodes.
* Bewertung nach aktueller Norm oder den SECUTEST-Grenzwerten von 1997, Maßnahmenliste bei „nicht bestanden“.
* Prüferinnerungen per E-Mail und Kalender (.ics), Prüfprotokoll, Prüfplaketten mit QR-Code, Export.

<img src="docs/images/22-schritt-schutzleiter-live.png" alt="Prüfassistent" width="720">
