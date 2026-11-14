# Neueste Version von GitHub holen, vorher sichern, danach neu starten
. "$PSScriptRoot\_gemeinsam.ps1"

$changes = git status --porcelain --untracked-files=no
if ($changes) { Write-Host 'Es gibt lokale Änderungen am Code. Update abgebrochen:' -ForegroundColor Red; $changes; exit 1 }

Write-Host '1/5 Datenbank sichern ...'
npm run --silent backup
if ($LASTEXITCODE -ne 0) { throw 'Sicherung fehlgeschlagen, Update abgebrochen.' }

Write-Host '2/5 Neueste Version holen ...'
$before = git rev-parse HEAD
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'git pull fehlgeschlagen.' }
$after = git rev-parse HEAD
if ($before -eq $after) { Write-Host 'Bereits auf dem neuesten Stand.'; exit 0 }
git --no-pager log --oneline "$before..$after"

Write-Host '3/5 Abhängigkeiten installieren ...'
& "$PSScriptRoot\stop.ps1"
npm ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'npm ci fehlgeschlagen.' }

Write-Host '4/5 Browser-App bauen ...'
Install-Frontend -Force

Write-Host '5/5 Server starten ...'
& "$PSScriptRoot\start.ps1"
