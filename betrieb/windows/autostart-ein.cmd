@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart-ein.ps1" %*
pause
