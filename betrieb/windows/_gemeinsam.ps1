# Gemeinsame Einstellungen für alle Skripte (wird per Punkt-Aufruf geladen)
$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $AppDir

function Get-EnvValue([string]$Name, [string]$Default) {
  $file = Join-Path $AppDir '.env'
  if (Test-Path $file) {
    $line = Get-Content $file | Where-Object { $_ -match "^\s*$Name=" } | Select-Object -Last 1
    if ($line) { return ($line -replace "^\s*$Name=", '').Trim().Trim('"').Trim("'") }
  }
  return $Default
}

$DataDir = Get-EnvValue 'DATA_DIR' (Join-Path $AppDir 'data')
if (-not [System.IO.Path]::IsPathRooted($DataDir)) { $DataDir = Join-Path $AppDir $DataDir }
$Port = Get-EnvValue 'PORT' '3000'
# Backend (Datenbank, Schnittstelle) läuft getrennt auf API_PORT, nur für diesen Rechner erreichbar
$ApiPort = Get-EnvValue 'API_PORT' ([string]([int]$Port + 1))
# Erkennt die node-Prozesse dieses Projekts: Starter, Backend, Browser-App
$AppPattern = 'src[\\/](server|launcher)\.js|frontend[\\/]server\.cjs'
$PidFile = Join-Path $DataDir 'server.pid'
$LogFile = Join-Path $DataDir 'server.log'
$ErrFile = Join-Path $DataDir 'server-fehler.log'
$TaskName = 'KKB-Einsatzplaner'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) { throw 'Node.js wurde nicht gefunden. Bitte Node.js 22.13 oder neuer installieren.' }
$NodeBin = $NodeCmd.Source
$NodeArgs = '--disable-warning=ExperimentalWarning --env-file-if-exists=.env src/launcher.js'

function Get-Task { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

function Get-ServerProcess {
  if (Test-Path $PidFile) {
    $id = [int](Get-Content $PidFile)
    return Get-Process -Id $id -ErrorAction SilentlyContinue
  }
  return $null
}

function Test-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Beendet den Server der Autostart-Aufgabe (cmd.exe beendet node.exe nicht immer mit)
function Stop-TaskServer {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match $AppPattern -and $_.CommandLine -like '*env-file-if-exists*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

# Alle Prozesse des Einsatzplaners finden: Prozess auf dem Port und node-Prozesse dieses Projekts
# (auch wenn der Server ohne die Skripte gestartet wurde, z. B. mit «npm start»)
function Get-AppProcessIds {
  $ids = @()
  # Wer die Ports belegt (Browser-App, Backend) – aber nur, wenn es ein node-Prozess ist (nie fremde Programme beenden)
  foreach ($port in @([int]$Port, [int]$ApiPort)) {
    try {
      foreach ($c in Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop) {
        $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -eq 'node') { $ids += $p.Id }
      }
    } catch { }
  }
  $ids += Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match $AppPattern -and $_.CommandLine -like '*env-file-if-exists*' } |
    ForEach-Object { $_.ProcessId }
  return $ids | Where-Object { $_ -and $_ -ne $PID } | Sort-Object -Unique
}

# Browser-App: Pakete installieren und bauen, wenn sie fehlt oder sich der Code geändert hat ($Force)
function Install-Frontend([switch]$Force) {
  $front = Join-Path $AppDir 'frontend'
  Push-Location $front
  try {
    if ($Force -or -not (Test-Path (Join-Path $front 'node_modules'))) {
      Write-Host 'Installiere Pakete der Browser-App ...'
      npm ci --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw 'npm ci für die Browser-App fehlgeschlagen.' }
    }
    if ($Force -or -not (Test-Path (Join-Path $front 'dist\index.html'))) {
      Write-Host 'Baue die Browser-App ...'
      npm run build
      if ($LASTEXITCODE -ne 0) { throw 'Bauen der Browser-App fehlgeschlagen.' }
    }
  } finally { Pop-Location }
}

function Stop-AppProcesses {
  $ids = Get-AppProcessIds
  foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  return @($ids).Count
}
