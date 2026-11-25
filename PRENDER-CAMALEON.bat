@echo off
REM Doble clic: arma el .env (si falta) y prende Camaleon local.
cd /d "%~dp0"
if not exist .env (
  echo Trayendo las claves desde Google Cloud...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp01-traer-secretos.ps1"
)
if not exist .env (
  echo No se pudo crear .env. Revisa que gcloud este instalado y con tu cuenta.
  pause
  exit /b 1
)
call "%~dp02-iniciar-local.bat"
