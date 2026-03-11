param(
    [string]$BackendBase = "http://127.0.0.1:8000",
    [string]$FrontendBase = "http://127.0.0.1:5173",
    [string]$Username = "uat_admin",
    [string]$Password = "Demo123!"
)

Set-Location "$PSScriptRoot\.."

Write-Host "=== ERP Carton Deploy Validate ===" -ForegroundColor Cyan

Push-Location backend
python manage.py preflight_check --strict
if (-not $?) { Pop-Location; exit 1 }

python manage.py check
if (-not $?) { Pop-Location; exit 1 }

python manage.py smoke_http --backend-base $BackendBase --frontend-base $FrontendBase --username $Username --password $Password
if (-not $?) { Pop-Location; exit 1 }
Pop-Location

Push-Location frontend
npm run e2e:smoke
if (-not $?) { Pop-Location; exit 1 }
Pop-Location

Write-Host "Deploy validation completed successfully." -ForegroundColor Green
