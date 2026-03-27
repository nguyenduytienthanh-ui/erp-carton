. "$PSScriptRoot\ensure-workspace-ready.ps1"

Set-Location "$PSScriptRoot\.."

Write-Host "=== ERP Carton Preflight Check ===" -ForegroundColor Cyan
Ensure-WorkspaceReady -EnsureBackendEnv -EnsureBackendDependencies
Push-Location backend
python manage.py preflight_check
Pop-Location
