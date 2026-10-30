#!/usr/bin/env bash
# Neueste Version von GitHub holen, vorher sichern, danach neu starten
source "$(dirname "$0")/_gemeinsam.sh"
DIR="$APP_DIR/betrieb/linux"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Es gibt lokale Änderungen am Code. Update abgebrochen:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

echo "1/4 Datenbank sichern …"
npm run --silent backup

echo "2/4 Neueste Version holen …"
BEFORE="$(git rev-parse HEAD)"
git pull --ff-only origin main
AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then echo "Bereits auf dem neuesten Stand."; exit 0; fi
git --no-pager log --oneline "$BEFORE..$AFTER"

echo "3/4 Abhängigkeiten installieren …"
npm ci --omit=dev

echo "4/4 Server neu starten …"
"$DIR/neustart.sh"
