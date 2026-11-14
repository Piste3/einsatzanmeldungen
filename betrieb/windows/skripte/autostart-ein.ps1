# Server beim Hochfahren von Windows automatisch starten (geplante Aufgabe, braucht Administratorrechte)
. "$PSScriptRoot\_gemeinsam.ps1"
if (-not (Test-Admin)) { throw 'Bitte als Administrator ausführen (Rechtsklick > Als Administrator ausführen).' }

$p = Get-ServerProcess
if ($p) { Stop-Process -Id $p.Id -Force; Remove-Item $PidFile -ErrorAction SilentlyContinue }
if (-not (Test-Path (Join-Path $AppDir 'node_modules'))) { npm ci --omit=dev }

# Ausgabe ins Protokoll umleiten, damit protokoll.ps1 auch hier funktioniert
$cmd = "/c `"`"$NodeBin`" $NodeArgs >> `"$LogFile`" 2>&1`""
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmd -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Autostart eingerichtet. Der Server läuft jetzt als geplante Aufgabe «$TaskName»."
