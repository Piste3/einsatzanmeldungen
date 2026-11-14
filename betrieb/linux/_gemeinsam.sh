# Gemeinsame Einstellungen für alle Skripte (wird per «source» geladen)
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$APP_DIR"

# Werte aus .env lesen (nur einfache Zeilen NAME=WERT)
env_value() {
  local name="$1" default="$2" line
  if [ -f .env ]; then
    line="$(grep -E "^[[:space:]]*${name}=" .env | tail -n 1 || true)"
    if [ -n "$line" ]; then
      line="${line#*=}"; line="${line%\"}"; line="${line#\"}"; line="${line%\'}"; line="${line#\'}"
      echo "$line"; return
    fi
  fi
  echo "$default"
}

DATA_DIR="$(env_value DATA_DIR "$APP_DIR/data")"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$APP_DIR/${DATA_DIR#./}" ;; esac
PORT="$(env_value PORT 3000)"
# Backend (Datenbank, Schnittstelle) läuft getrennt auf API_PORT, nur für diesen Rechner erreichbar
API_PORT="$(env_value API_PORT $((PORT + 1)))"
# Erkennt die node-Prozesse dieses Projekts: Starter, Backend, Browser-App
APP_PATTERN="env-file-if-exists=.env .*(src/(server|launcher)\.js|frontend/server\.cjs)"
PID_FILE="$DATA_DIR/server.pid"
LOG_FILE="$DATA_DIR/server.log"
SERVICE=kkb-einsatzplaner
PLIST="$HOME/Library/LaunchAgents/ch.kkb.einsatzplaner.plist"
mkdir -p "$DATA_DIR"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Node.js wurde nicht gefunden. Bitte Node.js 22.13 oder neuer installieren." >&2
  exit 1
fi

# Läuft der Server als Dienst (Autostart)?
uses_systemd() { command -v systemctl >/dev/null 2>&1 && [ -f "/etc/systemd/system/$SERVICE.service" ]; }
uses_launchd() { [ "$(uname)" = "Darwin" ] && [ -f "$PLIST" ]; }

# Browser-App: Pakete installieren und bauen, wenn sie fehlt oder sich der Code geändert hat (force)
install_frontend() {
  local force="${1:-}"
  if [ -n "$force" ] || [ ! -d frontend/node_modules/vite ]; then echo "Installiere Pakete der Browser-App …"; (cd frontend && npm ci --include=dev --no-audit --no-fund); fi
  if [ -n "$force" ] || [ ! -f frontend/dist/index.html ]; then echo "Baue die Browser-App …"; (cd frontend && npm run build); fi
}

pid_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}
