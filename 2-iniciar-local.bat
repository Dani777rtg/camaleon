@echo off
REM Arranca Carpeta Camaleon 100% en este PC: api (Node) + voz (Python) + ngrok.
cd /d "%~dp0"

if not exist .env goto :sinenv

if not exist node_modules (
  echo Instalando dependencias de Node (solo la primera vez^)...
  call npm install
)

if not exist voz\.venv (
  echo Creando entorno de Python para la voz (solo la primera vez^)...
  py -3.13 -m venv voz\.venv 2>nul || python -m venv voz\.venv
  call voz\.venv\Scripts\pip install -r voz\requirements.txt
)

start "Camaleon API :8080" cmd /k npm run dev
start "Camaleon VOZ :7860" cmd /k "cd voz && .venv\Scripts\uvicorn app:app --port 7860"

where ngrok >nul 2>nul
if %errorlevel%==0 (
  start "ngrok (webhook WhatsApp)" cmd /k ngrok http 8080
) else (
  echo [aviso] No encontre ngrok: WhatsApp no llegara al PC. La llamada desde el navegador si funciona.
)

echo Esperando a que arranque la api...
timeout /t 10 /nobreak >nul
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if "%%a"=="LLAMADA_TOKEN" set LT=%%b
if defined LT start "" "http://localhost:8080/llamada?token=%LT%"
echo.
echo Todo arriba. Cierra las ventanas para apagarlo.
pause
exit /b 0

:sinenv
echo Falta el archivo .env. Ejecuta primero 1-traer-secretos.ps1
pause
exit /b 1
