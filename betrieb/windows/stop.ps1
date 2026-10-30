# Server beenden
. "$PSScriptRoot\_gemeinsam.ps1"

$task = Get-Task
if ($task) { Stop-TaskServer; Write-Host 'Gestoppt (Autostart-Aufgabe).'; exit 0 }
$p = Get-ServerProcess
if (-not $p) { Write-Host 'Der Server läuft nicht.'; Remove-Item $PidFile -ErrorAction SilentlyContinue; exit 0 }
Stop-Process -Id $p.Id -Force
Remove-Item $PidFile -ErrorAction SilentlyContinue
Write-Host 'Server gestoppt.'
