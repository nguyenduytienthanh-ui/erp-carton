Set-Location "$PSScriptRoot\.."

Write-Host "=== ERP Carton Preflight Check ===" -ForegroundColor Cyan
Push-Location backend
python manage.py preflight_check
Pop-Location
