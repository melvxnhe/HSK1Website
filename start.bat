@echo off
REM Double-click this file to start the HSK 1 site on http://localhost:8000
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8000 -Open
pause
