#!/usr/bin/env bash
# Neueste Version von GitHub holen, vorher sichern, danach neu starten
source "$(dirname "$0")/_gemeinsam.sh"
DIR="$APP_DIR/betrieb/linux"

# Paketlisten ändert npm selbst (z. B. nach «npm install» von Hand): auf den Stand von GitHub zurücksetzen
git checkout -- package.json package-lock.json frontend/package.json frontend/package-lock.json 2>/dev/null || true
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Es gibt lokale Änderungen am Code. Update abgebrochen:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

echo "1/5 Datenbank sichern …"
npm run --silent backup

echo "2/5 Neueste Version holen …"
BEFORE="$(git rev-parse HEAD)"
git pull --ff-only origin main
AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then echo "Bereits auf dem neuesten Stand."; exit 0; fi
git --no-pager log --oneline "$BEFORE..$AFTER"

echo "3/5 Abhängigkeiten installieren …"
npm ci --omit=dev

echo "4/5 Browser-App bauen …"
install_frontend force

echo "5/5 Server neu starten …"
"$DIR/neustart.sh"
