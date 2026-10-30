#!/usr/bin/env bash
# Sofort eine Sicherung der Datenbank erstellen (auch während der Server läuft)
source "$(dirname "$0")/_gemeinsam.sh"
npm run --silent backup
