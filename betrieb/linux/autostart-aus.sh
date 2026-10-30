#!/usr/bin/env bash
# Autostart wieder entfernen (der Server wird dabei gestoppt)
source "$(dirname "$0")/_gemeinsam.sh"

if uses_launchd; then
  launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Autostart entfernt."
elif uses_systemd; then
  sudo systemctl disable --now "$SERVICE"
  sudo rm -f "/etc/systemd/system/$SERVICE.service"
  sudo systemctl daemon-reload
  echo "Autostart entfernt."
else
  echo "Es ist kein Autostart eingerichtet."
fi
