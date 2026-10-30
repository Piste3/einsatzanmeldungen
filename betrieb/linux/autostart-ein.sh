#!/usr/bin/env bash
# Server beim Hochfahren automatisch starten (Linux: systemd, macOS: launchd)
source "$(dirname "$0")/_gemeinsam.sh"

# Einen von Hand gestarteten Server zuerst beenden
if pid_running; then kill "$(cat "$PID_FILE")"; sleep 2; rm -f "$PID_FILE"; fi
if [ ! -d node_modules ]; then npm ci --omit=dev; fi

if [ "$(uname)" = "Darwin" ]; then
  mkdir -p "$(dirname "$PLIST")"
  cat >"$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ch.kkb.einsatzplaner</string>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>ProgramArguments</key><array>
    <string>$NODE_BIN</string><string>--disable-warning=ExperimentalWarning</string>
    <string>--env-file-if-exists=.env</string><string>src/launcher.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_FILE</string>
  <key>StandardErrorPath</key><string>$LOG_FILE</string>
</dict></plist>
PL
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
  echo "Autostart eingerichtet (startet bei der Anmeldung dieses Benutzers)."
  exit 0
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd wurde nicht gefunden. Autostart bitte von Hand einrichten." >&2
  exit 1
fi
sudo tee "/etc/systemd/system/$SERVICE.service" >/dev/null <<UNIT
[Unit]
Description=KKB-Einsatzplaner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning --env-file-if-exists=.env src/launcher.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE"
echo "Autostart eingerichtet. Der Server läuft jetzt als Dienst «$SERVICE»."
