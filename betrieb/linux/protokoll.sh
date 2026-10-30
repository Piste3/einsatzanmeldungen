#!/usr/bin/env bash
# Laufendes Protokoll anzeigen (Beenden mit Ctrl+C)
source "$(dirname "$0")/_gemeinsam.sh"

if uses_systemd; then exec journalctl -u "$SERVICE" -f -n 50; fi
touch "$LOG_FILE"
exec tail -n 50 -f "$LOG_FILE"
