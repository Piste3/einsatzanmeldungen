# Server neu starten
. "$PSScriptRoot\_gemeinsam.ps1"
Request-Admin $PSCommandPath $args
& "$PSScriptRoot\stop.ps1"
& "$PSScriptRoot\start.ps1"
