@echo off
REM Abre un tunel publico (Cloudflare) hacia la api local en :8080 para el webhook de WhatsApp.
cd /d "%~dp0"
if exist tunel.log del tunel.log
cloudflared.exe tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:8080 --logfile "%~dp0tunel.log"
