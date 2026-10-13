#!/bin/sh
# Secutest Prüfmanager – startet den lokalen Server und öffnet den Browser
exec /opt/secutest-pruefmanager/runtime/node /opt/secutest-pruefmanager/app/src/server.js "$@"
