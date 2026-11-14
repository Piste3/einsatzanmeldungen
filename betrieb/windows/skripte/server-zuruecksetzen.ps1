# Notausgang: Server-Einstellungen aus der Verwaltung löschen (dann gilt wieder die .env) und neu starten.
# Ohne Angabe alle Werte, sonst nur die genannten, z. B. wartung\server-zuruecksetzen.cmd AUTH_PROVIDERS
. "$PSScriptRoot\_gemeinsam.ps1"
npm run --silent server:zuruecksetzen -- @args
& "$PSScriptRoot\neustart.ps1"
