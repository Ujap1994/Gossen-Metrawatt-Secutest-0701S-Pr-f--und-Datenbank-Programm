#!/bin/sh
# Secutest Prüfmanager (Alpine/musl) – nutzt das Node.js der Distribution
exec node /opt/secutest-pruefmanager/app/src/server.js "$@"
