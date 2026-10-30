#!/usr/bin/env bash
# Server starten (im Hintergrund)
source "$(dirname "$0")/_gemeinsam.sh"

if uses_systemd; then sudo systemctl start "$SERVICE"; echo "Gestartet (Dienst)."; exit 0; fi
if uses_launchd; then launchctl load -w "$PLIST" 2>/dev/null || true; launchctl start ch.kkb.einsatzplaner; echo "Gestartet (Dienst)."; exit 0; fi

if pid_running; then echo "Der Server läuft bereits (PID $(cat "$PID_FILE"))."; exit 0; fi
if [ ! -d node_modules ]; then echo "Installiere Abhängigkeiten …"; npm ci --omit=dev; fi

nohup "$NODE_BIN" --disable-warning=ExperimentalWarning --env-file-if-exists=.env src/server.js >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 2
if pid_running; then
  echo "Server gestartet (PID $(cat "$PID_FILE")) auf Port $PORT."
  echo "Protokoll: $LOG_FILE"
else
  echo "Der Server konnte nicht starten. Letzte Zeilen aus dem Protokoll:" >&2
  tail -n 20 "$LOG_FILE" >&2
  rm -f "$PID_FILE"
  exit 1
fi
