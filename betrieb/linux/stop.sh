#!/usr/bin/env bash
# Server sauber beenden
source "$(dirname "$0")/_gemeinsam.sh"

if uses_systemd; then sudo systemctl stop "$SERVICE"; echo "Gestoppt (Dienst)."; exit 0; fi
if uses_launchd; then launchctl stop ch.kkb.einsatzplaner; launchctl unload "$PLIST" 2>/dev/null || true; echo "Gestoppt (Dienst)."; exit 0; fi

if ! pid_running; then
  # Ohne PID-Datei gestartet (z. B. «npm start»)? Dann die Prozesse dieses Projekts beenden.
  if pkill -f "env-file-if-exists=.env src/(server|launcher).js" 2>/dev/null; then echo "Server gestoppt."; else echo "Der Server läuft nicht."; fi
  rm -f "$PID_FILE"; exit 0
fi
PID="$(cat "$PID_FILE")"
kill "$PID"
for _ in $(seq 1 20); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID"; fi
rm -f "$PID_FILE"
echo "Server gestoppt."
