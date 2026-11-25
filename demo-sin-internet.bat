@echo off
REM Demo por consola: no usa claves, ni internet, ni Google Cloud. Plan B para el video.
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run demo
pause
