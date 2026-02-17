# Tải toàn bộ từ Git — chạy khi BẮT ĐẦU làm việc (công ty hoặc nhà)
Set-Location $PSScriptRoot\..
Write-Host "=== TAI TU GIT (sync-pull) ===" -ForegroundColor Cyan
git pull
Write-Host "`nKiem tra dependencies..." -ForegroundColor Yellow
if (Test-Path "backend\requirements.txt") {
    Push-Location backend
    pip install -r requirements.txt -q 2>$null
    python manage.py migrate --noinput 2>$null
    Pop-Location
}
if (Test-Path "frontend\package.json") {
    Push-Location frontend
    npm install 2>$null
    Pop-Location
}
Write-Host "Da tai va dong bo xong." -ForegroundColor Green
