# Đẩy toàn bộ thay đổi lên Git — chạy khi KẾT THÚC làm việc (công ty hoặc nhà)
Set-Location $PSScriptRoot\..
Write-Host "=== ĐẨY LÊN GIT (sync-push) ===" -ForegroundColor Cyan
git add .
$status = git status --short
if ($status) {
    Write-Host "Thay đổi:" -ForegroundColor Yellow
    git status --short
    $msg = "Sync: " + (Get-Date -Format "yyyy-MM-dd HH:mm")
    git commit -m $msg
    git push
    Write-Host "Da day len Git thanh cong." -ForegroundColor Green
} else {
    Write-Host "Khong co thay doi. Da dong bo voi Git." -ForegroundColor Green
    git push 2>$null
}
