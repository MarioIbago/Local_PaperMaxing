@echo off
setlocal
cd /d "%~dp0"

echo.
echo ===============================================
echo   PaperMaxing Local + NotebookLM (sin Docker)
echo ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [PaperMaxing] Node.js 22+ es requerido.
  pause
  exit /b 1
)

if not exist "notebook-llm.zip" if not exist ".papermaxing\runtime\notebook-llm\.venv\Scripts\notebooklm-server.exe" (
  echo [PaperMaxing] Falta notebook-llm.zip en esta carpeta.
  echo [PaperMaxing] Copia el ZIP que ya tienes junto a start-local.bat y vuelve a abrirlo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [PaperMaxing] Instalando dependencias de la interfaz por primera vez...
  call npm install
  if errorlevel 1 (
    echo [PaperMaxing] npm install fallo.
    pause
    exit /b 1
  )
)

echo [PaperMaxing] Preparando el runtime NotebookLM incluido...
call node server\notebooklm-runtime.mjs prepare
if errorlevel 1 (
  pause
  exit /b 1
)

echo [PaperMaxing] Comprobando tu sesion de Google para NotebookLM...
call node server\notebooklm-runtime.mjs ensure-auth
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo [PaperMaxing] Iniciando NotebookLM + API local + UI...
echo [PaperMaxing] URL: http://127.0.0.1:5173
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://127.0.0.1:5173'"
call npm run dev:notebooklm
