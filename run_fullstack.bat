@echo off
setlocal

set ROOT_DIR=D:\Projects\erp-carton
set BACKEND_DIR=%ROOT_DIR%\backend
set FRONTEND_DIR=%ROOT_DIR%\frontend
set PYTHON_EXE=%BACKEND_DIR%\.venv\Scripts\python.exe

echo [ERP Carton] Starting backend and frontend...

if not exist "%PYTHON_EXE%" (
  echo [ERROR] Python venv not found: %PYTHON_EXE%
  echo Please run setup once or contact support.
  pause
  exit /b 1
)

start "ERP Backend" cmd /k "cd /d %BACKEND_DIR% && %PYTHON_EXE% manage.py runserver 127.0.0.1:8000"
start "ERP Frontend" cmd /k "cd /d %FRONTEND_DIR% && npm run dev"

timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:5174

echo [ERP Carton] Done. If 5174 is busy, frontend may open another port shown in the frontend window.
endlocal

