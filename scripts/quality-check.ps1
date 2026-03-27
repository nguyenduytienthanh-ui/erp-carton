. "$PSScriptRoot\ensure-workspace-ready.ps1"

Set-Location "$PSScriptRoot\.."

Write-Host "=== ERP Carton Quality Check ===" -ForegroundColor Cyan
Ensure-WorkspaceReady -EnsureBackendEnv -EnsureBackendDependencies -EnsureFrontendDependencies

Push-Location frontend
try {
    npm run lint
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    npm run build
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

Push-Location backend
try {
    python manage.py test core.tests_auth_smoke core.tests_module_permissions core.tests_operations_log --keepdb --noinput
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

Write-Host "Quality check completed successfully." -ForegroundColor Green
