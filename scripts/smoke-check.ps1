param(
    [string]$BackendBase = "http://127.0.0.1:8000",
    [string]$FrontendBase = "http://127.0.0.1:5173",
    [string]$Username = "uat_admin",
    [string]$Password = "Demo123!"
)

Set-Location "$PSScriptRoot\.."

Write-Host "=== ERP Carton Smoke Check ===" -ForegroundColor Cyan
Push-Location backend
python manage.py smoke_http --backend-base $BackendBase --frontend-base $FrontendBase --username $Username --password $Password
Pop-Location
