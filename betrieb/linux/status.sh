#!/usr/bin/env bash
# Zeigt, ob der Server läuft und antwortet
source "$(dirname "$0")/_gemeinsam.sh"

if uses_systemd; then
  systemctl --no-pager status "$SERVICE" | head -n 5
elif uses_launchd; then
  launchctl list | grep ch.kkb.einsatzplaner || echo "Dienst nicht geladen."
elif pid_running; then
  echo "Läuft (PID $(cat "$PID_FILE"))."
else
  echo "Läuft nicht."
fi

if command -v curl >/dev/null 2>&1; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/login" || true)"
  if [ "$CODE" = "200" ] || [ "$CODE" = "302" ]; then echo "Antwortet auf http://localhost:$PORT"; else echo "Keine Antwort auf Port $PORT."; fi
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/health" || true)"
  if [ "$CODE" = "200" ]; then echo "Backend antwortet (Port $API_PORT)."; else echo "Backend antwortet nicht (Port $API_PORT)."; fi
fi
