# Script đầy đủ để push code từ máy công ty lên Git
# Copy toàn bộ script này và paste vào PowerShell, chạy một lần

# 1. Vào thư mục dự án
cd D:\Projects\erp-carton

# 2. Kiểm tra branch hiện tại
Write-Host "`n=== Kiểm tra branch ===" -ForegroundColor Cyan
git branch

# 3. Đảm bảo ở đúng branch sprint2-business-models
Write-Host "`n=== Chuyển sang branch sprint2-business-models ===" -ForegroundColor Cyan
git checkout sprint2-business-models

# 4. Kiểm tra trạng thái
Write-Host "`n=== Kiểm tra trạng thái ===" -ForegroundColor Cyan
git status

# 5. Add tất cả file thay đổi
Write-Host "`n=== Add tất cả file ===" -ForegroundColor Cyan
git add .

# 6. Kiểm tra lại những gì sẽ được commit
Write-Host "`n=== Kiểm tra file sẽ commit ===" -ForegroundColor Cyan
git status

# 7. Kiểm tra file CustomerList.tsx có tồn tại không
Write-Host "`n=== Kiểm tra file CustomerList.tsx ===" -ForegroundColor Cyan
if (Test-Path "frontend\src\pages\Customers\CustomerList.tsx") {
    Write-Host "✓ File CustomerList.tsx tồn tại" -ForegroundColor Green
} else {
    Write-Host "✗ File CustomerList.tsx KHÔNG tồn tại!" -ForegroundColor Red
    Write-Host "Vui lòng kiểm tra lại đường dẫn file." -ForegroundColor Yellow
}

# 8. Commit với message mô tả
Write-Host "`n=== Commit code ===" -ForegroundColor Cyan
git commit -m "feat: Add CustomerList with filter panel, column chooser, and row selection"

# 9. Push lên Git (chỉ định rõ branch)
Write-Host "`n=== Push lên Git ===" -ForegroundColor Cyan
git push origin sprint2-business-models

# 10. Kiểm tra kết quả
Write-Host "`n=== Kiểm tra kết quả ===" -ForegroundColor Cyan
git status

Write-Host "`n=== HOÀN TẤT ===" -ForegroundColor Green
Write-Host "Nếu thấy 'Your branch is up to date with origin/sprint2-business-models' thì đã push thành công!" -ForegroundColor Green
