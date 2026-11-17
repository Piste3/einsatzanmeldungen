# Server beenden
. "$PSScriptRoot\_gemeinsam.ps1"
Request-Admin $PSCommandPath $args

$task = Get-Task
if ($task) { Stop-TaskServer }
$n = Stop-AppProcesses
Remove-Item $PidFile -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
if ((Get-AppProcessIds) -and -not (Test-Admin)) { Request-Admin $PSCommandPath $args -Always }
if (Get-AppProcessIds) { Write-Host 'Der Server konnte nicht beendet werden (evtl. als Administrator ausführen).' -ForegroundColor Red; exit 1 }
if ($task -or $n -gt 0) { Write-Host 'Server gestoppt.' } else { Write-Host 'Der Server läuft nicht.' }
