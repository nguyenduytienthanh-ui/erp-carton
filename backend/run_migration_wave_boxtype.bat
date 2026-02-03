@echo off
REM Chay migration va seed cho Wave va BoxType
REM Cach dung: Double-click file nay HOAC chay tu thu muc backend: run_migration_wave_boxtype.bat

cd /d "%~dp0"
echo ========================================
echo Dang chay migration va seed...
echo ========================================
echo.

echo [1/2] Chay migrate...
python manage.py migrate
if errorlevel 1 (
    echo LOI: migrate that bai!
    pause
    exit /b 1
)
echo.

echo [2/2] Seed waves va box types...
python manage.py seed_waves_boxtypes
if errorlevel 1 (
    echo LOI: seed that bai!
    pause
    exit /b 1
)
echo.
echo ========================================
echo HOAN THANH! Khoi dong lai server neu can.
echo ========================================
pause
