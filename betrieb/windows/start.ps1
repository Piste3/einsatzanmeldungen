# Server starten (im Hintergrund)
. "$PSScriptRoot\_gemeinsam.ps1"

if (Get-Task) { Start-ScheduledTask -TaskName $TaskName; Write-Host 'Gestartet (Autostart-Aufgabe).'; exit 0 }
if (Get-ServerProcess) { Write-Host "Der Server läuft bereits (PID $(Get-Content $PidFile))."; exit 0 }
if (-not (Test-Path (Join-Path $AppDir 'node_modules'))) { Write-Host 'Installiere Abhängigkeiten ...'; npm ci --omit=dev }

$p = Start-Process -FilePath $NodeBin -ArgumentList $NodeArgs -WorkingDirectory $AppDir `
  -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile -WindowStyle Hidden -PassThru
$p.Id | Set-Content $PidFile
Start-Sleep -Seconds 2
if (Get-ServerProcess) {
  Write-Host "Server gestartet (PID $($p.Id)) auf http://localhost:$Port"
  Write-Host "Protokoll: $LogFile"
} else {
  Write-Host 'Der Server konnte nicht starten:' -ForegroundColor Red
  Get-Content $ErrFile, $LogFile -Tail 20 -ErrorAction SilentlyContinue
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  exit 1
}
