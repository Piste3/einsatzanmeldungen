# Laufendes Protokoll anzeigen (Beenden mit Ctrl+C)
. "$PSScriptRoot\_gemeinsam.ps1"
if (-not (Test-Path $LogFile)) { New-Item -ItemType File -Path $LogFile | Out-Null }
Get-Content $LogFile -Tail 50 -Wait
