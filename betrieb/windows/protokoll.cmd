@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0protokoll.ps1" %*
pause
