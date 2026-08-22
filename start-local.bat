@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [PaperMaxing] Node.js 22+ is required.
  echo Install it from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [PaperMaxing] First run: installing local dependencies...
  call npm install
  if errorlevel 1 (
    echo [PaperMaxing] npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo [PaperMaxing] Starting local UI + local API...
echo [PaperMaxing] URL: http://127.0.0.1:5173
start "PaperMaxing Browser" cmd /c "timeout /t 3 /nobreak >nul && start \"\" http://127.0.0.1:5173"
call npm run dev
