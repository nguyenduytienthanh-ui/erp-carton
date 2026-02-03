@echo off
REM Chay Django server tu DUNG thu muc backend (co route export Excel)
REM Double-click file nay hoac chay: run_server.bat
cd /d "%~dp0backend"
echo Dang chay server tu: %CD%
echo Neu ban thay 404 khi xuat Excel, kiem tra dong "[URLs] Loaded from:" phai la ...\ERP-Carton\backend\config\urls.py
echo.
python manage.py runserver
pause
