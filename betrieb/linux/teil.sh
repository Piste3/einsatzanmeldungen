#!/usr/bin/env bash
# Browser-App (frontend) oder Backend einzeln starten, stoppen, neu starten oder den Stand zeigen
# Aufruf: betrieb/linux/teil.sh frontend|backend start|stop|neustart|status
source "$(dirname "$0")/_gemeinsam.sh"
set +e  # Rückgabewerte von field() selbst auswerten

TEIL="${1:-}"; AKTION="${2:-}"
case "$TEIL" in frontend) LABEL="Browser-App"; URL="http://localhost:$PORT/login" ;; backend) LABEL="Backend"; URL="http://127.0.0.1:$API_PORT/health" ;; *) echo "Aufruf: $0 frontend|backend start|stop|neustart|status" >&2; exit 1 ;; esac
case "$AKTION" in start|stop|neustart|status) ;; *) echo "Aufruf: $0 frontend|backend start|stop|neustart|status" >&2; exit 1 ;; esac
STATUS_FILE="$DATA_DIR/status.json"
CTL_DIR="$DATA_DIR/steuerung"

# Feld aus status.json: läuft der Starter? running/wanted/pid des Teils
field() {
  "$NODE_BIN" -e '
    const fs = require("fs");
    try {
      const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      try { process.kill(s.launcherPid, 0); } catch { process.exit(2); }
      const p = s.parts[process.argv[2]]; if (!p) process.exit(3);
      console.log(String(p[process.argv[3]]));
    } catch { process.exit(2); }' "$STATUS_FILE" "$TEIL" "$1"
}

show_status() {
  local running; running="$(field running)"; local rc=$?
  if [ $rc -eq 2 ]; then echo "Der Einsatzplaner läuft nicht (kein Starter). Mit start.sh starten oder mit «teil.sh $TEIL start» nur diesen Teil."; return; fi
  if [ $rc -eq 3 ]; then echo "$LABEL gibt es in dieser Betriebsart nicht (KKB_BETRIEB=einzeln)."; return; fi
  if [ "$running" = "true" ]; then echo "$LABEL läuft (PID $(field pid), seit $(field since)).";
  elif [ "$(field wanted)" = "false" ]; then echo "$LABEL ist gestoppt (von Hand). Mit «teil.sh $TEIL start» wieder starten.";
  else echo "$LABEL startet gerade neu."; fi
  if command -v curl >/dev/null 2>&1; then
    CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)"
    if [ "$CODE" = "200" ]; then echo "$LABEL antwortet."; else echo "$LABEL antwortet nicht."; fi
  fi
}

if [ "$AKTION" = "status" ]; then show_status; exit 0; fi

BEFORE="$(field pid)"; RC=$?
if [ $RC -eq 2 ]; then
  if [ "$AKTION" = "stop" ]; then echo "Der Einsatzplaner läuft nicht."; exit 0; fi
  [ -d node_modules ] || npm ci --omit=dev
  if [ "$TEIL" = "frontend" ]; then install_frontend; fi
  KKB_NUR="$TEIL" nohup "$NODE_BIN" --disable-warning=ExperimentalWarning --env-file-if-exists=.env src/launcher.js >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 3; show_status; exit 0
fi
if [ $RC -eq 3 ]; then echo "$LABEL gibt es in dieser Betriebsart nicht (KKB_BETRIEB=einzeln)."; exit 1; fi

mkdir -p "$CTL_DIR"; touch "$CTL_DIR/$TEIL-$AKTION"
for _ in $(seq 1 30); do
  sleep 0.5
  R="$(field running)"; P="$(field pid)"
  case "$AKTION" in
    stop) [ "$R" = "false" ] && break ;;
    start) [ "$R" = "true" ] && break ;;
    neustart) [ "$R" = "true" ] && [ "$P" != "$BEFORE" ] && break ;;
  esac
done
[ "$AKTION" = "stop" ] || sleep 1
show_status
