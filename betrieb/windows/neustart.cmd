@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0neustart.ps1" %*
pause
