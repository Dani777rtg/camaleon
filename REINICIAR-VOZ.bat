@echo off
REM Instala lo que falte de la voz y la arranca en :7860
cd /d "%~dp0"
call voz\.venv\Scripts\pip install -q tzdata
cd voz
.venv\Scripts\uvicorn app:app --port 7860
