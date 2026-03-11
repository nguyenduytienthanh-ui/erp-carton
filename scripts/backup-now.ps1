Set-Location "$PSScriptRoot\.."

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
Write-Host "=== ERP Carton Backup ($timestamp) ===" -ForegroundColor Cyan
Push-Location backend
python manage.py backup --output backups
Pop-Location
