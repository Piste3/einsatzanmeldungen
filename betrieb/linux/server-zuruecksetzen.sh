#!/usr/bin/env bash
# Notausgang: Server-Einstellungen aus der Verwaltung löschen (dann gilt wieder die .env) und neu starten.
# Ohne Angabe alle Werte, sonst nur die genannten, z. B. server-zuruecksetzen.sh AUTH_PROVIDERS
source "$(dirname "$0")/_gemeinsam.sh"
npm run --silent server:zuruecksetzen -- "$@"
"$(dirname "$0")/neustart.sh"
