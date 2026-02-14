@echo off
REM Chay migration products de cap nhat search_text (tim 503020 ra 50x30x20)
REM Cach dung: Double-click file nay trong thu muc backend

cd /d "%~dp0"
echo ========================================
echo   Cap nhat tim kiem (search_text)
echo ========================================
echo.
echo Dang chay migration products...
echo (Neu da chay roi se hien "No migrations to apply")
echo.

python manage.py migrate products

if errorlevel 1 (
    echo.
    echo LOI: Migration that bai. Hay chup man hinh va gui cho IT.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   HOAN THANH
echo ========================================
echo Ban co the F5 lai trang San pham va thu tim "503020".
echo.
pause
