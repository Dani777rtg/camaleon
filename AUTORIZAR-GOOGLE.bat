@echo off
REM Da permiso a Camaleon en tu cuenta de Google (Gmail, Calendar, Drive, Docs, Sheets, Tasks y Contactos).
cd /d "%~dp0"
call npm run oauth
echo.
echo Listo. Ya puedes cerrar esta ventana.
pause
