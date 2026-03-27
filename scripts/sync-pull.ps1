# Tải toàn bộ từ Git — chạy khi BẮT ĐẦU làm việc (công ty hoặc nhà)
. "$PSScriptRoot\ensure-workspace-ready.ps1"

Set-Location $PSScriptRoot\..
Write-Host "=== TAI TU GIT (sync-pull) ===" -ForegroundColor Cyan
git pull
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "`nKiem tra va chuan bi moi truong..." -ForegroundColor Yellow
Ensure-WorkspaceReady -EnsureBackendEnv -EnsureBackendDependencies -EnsureFrontendDependencies

Push-Location backend
try {
    python manage.py migrate --noinput
    if ($LASTEXITCODE -ne 0) {
        throw "python manage.py migrate that bai."
    }

    python manage.py seed_master_data
    if ($LASTEXITCODE -ne 0) {
        throw "python manage.py seed_master_data that bai."
    }
} finally {
    Pop-Location
}

Write-Host "Da tai va dong bo xong." -ForegroundColor Green
