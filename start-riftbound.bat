@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-riftbound.ps1"
if errorlevel 1 (
  echo.
  pause
)
