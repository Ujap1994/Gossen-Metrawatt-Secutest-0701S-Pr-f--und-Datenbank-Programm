# Änderungsprotokoll

Alle Änderungen am Secutest Prüfmanager, die neueste oben. Der jeweils oberste Abschnitt erscheint automatisch (mit Bildern) in den Notizen des GitHub-Releases.

> ⚠ Open-Source-Software ohne Gewähr. Prüfungen nur durch Elektrofachkräfte. Siehe [Haftungsausschluss](README.md#haftungsausschluss).

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
