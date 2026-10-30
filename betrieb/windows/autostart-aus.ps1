# Autostart wieder entfernen (der Server wird dabei gestoppt)
. "$PSScriptRoot\_gemeinsam.ps1"
if (-not (Get-Task)) { Write-Host 'Es ist kein Autostart eingerichtet.'; exit 0 }
if (-not (Test-Admin)) { throw 'Bitte als Administrator ausführen (Rechtsklick > Als Administrator ausführen).' }
Stop-TaskServer
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host 'Autostart entfernt.'
