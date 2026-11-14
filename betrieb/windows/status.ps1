# Zeigt, ob der Server läuft und antwortet
. "$PSScriptRoot\_gemeinsam.ps1"

$task = Get-Task
if ($task) { Write-Host "Autostart-Aufgabe: $($task.State)" }
elseif (Get-ServerProcess) { Write-Host "Läuft (PID $(Get-Content $PidFile))." }
elseif ($ids = Get-AppProcessIds) { Write-Host "Läuft, aber nicht über start.cmd gestartet (PID $($ids -join ', ')). stop.cmd beendet ihn trotzdem." }
else { Write-Host 'Läuft nicht.' }

try {
  $r = Invoke-WebRequest -Uri "http://localhost:$Port/login" -UseBasicParsing -TimeoutSec 5
  Write-Host "Antwortet auf http://localhost:$Port (HTTP $($r.StatusCode))"
} catch { Write-Host "Keine Antwort auf Port $Port." }
try {
  $h = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/health" -UseBasicParsing -TimeoutSec 5
  Write-Host "Backend antwortet auf Port $ApiPort (HTTP $($h.StatusCode))"
} catch { Write-Host "Backend antwortet nicht (Port $ApiPort)." }
