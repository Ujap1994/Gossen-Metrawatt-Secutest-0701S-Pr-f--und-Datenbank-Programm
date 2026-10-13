#!/bin/sh
# Menü- und Icon-Cache aktualisieren (falls vorhanden)
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications >/dev/null 2>&1
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor >/dev/null 2>&1
echo ""
echo "Secutest Prüfmanager wurde installiert – Start über das Anwendungsmenü oder: secutest-pruefmanager"
echo "USB-RS232-Adapter: Benutzer in die Gruppe 'dialout' (Debian/Ubuntu/Fedora/openSUSE)"
echo "bzw. 'uucp' (Arch) aufnehmen und neu anmelden, z. B.: sudo usermod -aG dialout \$USER"
echo "(Alpine: sudo addgroup \$USER dialout)"
echo "⚠ Prüfungen nur durch Elektrofachkräfte. Open-Source-Software ohne Gewähr."
exit 0
