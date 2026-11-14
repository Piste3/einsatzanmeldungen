# Browser-App (frontend) oder Backend einzeln starten, stoppen, neu starten oder den Stand zeigen
# Aufruf: teil.ps1 frontend|backend start|stop|neustart|status  (Doppelklick: frontend-start.cmd usw.)
param(
  [Parameter(Mandatory = $true)][ValidateSet('frontend', 'backend')][string]$Teil,
  [Parameter(Mandatory = $true)][ValidateSet('start', 'stop', 'neustart', 'status')][string]$Aktion
)
. "$PSScriptRoot\_gemeinsam.ps1"

$Label = @{ frontend = 'Browser-App'; backend = 'Backend' }[$Teil]
$StatusFile = Join-Path $DataDir 'status.json'
$CtlDir = Join-Path $DataDir 'steuerung'

# Stand vom Starter (src/launcher.js); $null, wenn der Starter nicht läuft
function Get-LauncherStatus {
  if (-not (Test-Path $StatusFile)) { return $null }
  try { $s = Get-Content $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
  if (-not (Get-Process -Id $s.launcherPid -ErrorAction SilentlyContinue)) { return $null }
  return $s
}

function Test-Answer {
  $url = if ($Teil -eq 'frontend') { "http://localhost:$Port/login" } else { "http://127.0.0.1:$ApiPort/health" }
  try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5; return "antwortet (HTTP $($r.StatusCode))" } catch { return 'antwortet nicht' }
}

function Show-Status {
  $s = Get-LauncherStatus
  if (-not $s) { Write-Host "Der Einsatzplaner läuft nicht (kein Starter). Mit start.cmd starten oder mit $Teil-start.cmd nur diesen Teil."; return }
  $p = $s.parts.$Teil
  if (-not $p) { Write-Host "$Label gibt es in dieser Betriebsart nicht (KKB_BETRIEB=einzeln)."; return }
  $port = if ($Teil -eq 'frontend') { $Port } else { $ApiPort }
  if ($p.running) { Write-Host "$Label läuft (PID $($p.pid), Port $port, seit $($p.since))." -ForegroundColor Green }
  elseif (-not $p.wanted) { Write-Host "$Label ist gestoppt (von Hand). Mit $Teil-start.cmd wieder starten." -ForegroundColor Yellow }
  else { Write-Host "$Label startet gerade neu." -ForegroundColor Yellow }
  Write-Host "$Label $(Test-Answer)"
}

if ($Aktion -eq 'status') { Show-Status; exit 0 }

$s = Get-LauncherStatus
if (-not $s) {
  if ($Aktion -eq 'stop') { Write-Host 'Der Einsatzplaner läuft nicht.'; exit 0 }
  # Starter läuft nicht: nur diesen Teil starten (der andere lässt sich danach mit seinem Skript dazu starten)
  if (-not (Test-Path (Join-Path $AppDir 'node_modules'))) { Write-Host 'Installiere Abhängigkeiten ...'; npm ci --omit=dev }
  if ($Teil -eq 'frontend') { Install-Frontend }
  $env:KKB_NUR = $Teil
  $p = Start-Process -FilePath $NodeBin -ArgumentList $NodeArgs -WorkingDirectory $AppDir `
    -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile -WindowStyle Hidden -PassThru
  Remove-Item Env:KKB_NUR
  $p.Id | Set-Content $PidFile
  Start-Sleep -Seconds 3
  Show-Status
  exit 0
}

$before = $s.parts.$Teil
if (-not $before) { Write-Host "$Label gibt es in dieser Betriebsart nicht (KKB_BETRIEB=einzeln)."; exit 1 }
New-Item -ItemType Directory -Force -Path $CtlDir | Out-Null
New-Item -ItemType File -Force -Path (Join-Path $CtlDir "$Teil-$Aktion") | Out-Null

# Warten, bis der Starter den Auftrag ausgeführt hat (höchstens 15 Sekunden)
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  $now = (Get-LauncherStatus).parts.$Teil
  if (-not $now) { continue }
  $done = switch ($Aktion) {
    'stop' { -not $now.running }
    'start' { $now.running }
    'neustart' { $now.running -and $now.pid -ne $before.pid }
  }
  if ($done) { break }
}
if ($Aktion -ne 'stop') { Start-Sleep -Seconds 1 }
Show-Status
