# ================================================================
# SCRIPT TỰ ĐỘNG PUSH TOÀN BỘ CODE LÊN GIT
# Copy toàn bộ script này và chạy một lần ở máy công ty
# ================================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "SCRIPT TỰ ĐỘNG PUSH TOÀN BỘ CODE LÊN GIT" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# 1. Vào thư mục dự án
Write-Host "[1/8] Vào thư mục dự án..." -ForegroundColor Yellow
$projectPath = "D:\Projects\erp-carton"
if (-not (Test-Path $projectPath)) {
    Write-Host "✗ Không tìm thấy thư mục: $projectPath" -ForegroundColor Red
    Write-Host "Vui lòng sửa đường dẫn trong script." -ForegroundColor Yellow
    exit 1
}
cd $projectPath
Write-Host "✓ Đã vào thư mục: $projectPath" -ForegroundColor Green

# 2. Kiểm tra Git repository
Write-Host "`n[2/8] Kiểm tra Git repository..." -ForegroundColor Yellow
if (-not (Test-Path ".git")) {
    Write-Host "✗ Không phải Git repository!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Đây là Git repository" -ForegroundColor Green

# 3. Kiểm tra branch hiện tại
Write-Host "`n[3/8] Kiểm tra branch hiện tại..." -ForegroundColor Yellow
$currentBranch = git branch --show-current
Write-Host "Branch hiện tại: $currentBranch" -ForegroundColor Cyan

# 4. Chuyển sang branch sprint2-business-models (nếu chưa ở đó)
Write-Host "`n[4/8] Chuyển sang branch sprint2-business-models..." -ForegroundColor Yellow
if ($currentBranch -ne "sprint2-business-models") {
    git checkout sprint2-business-models
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Không thể chuyển sang branch sprint2-business-models!" -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Đã chuyển sang branch sprint2-business-models" -ForegroundColor Green
} else {
    Write-Host "✓ Đã ở branch sprint2-business-models" -ForegroundColor Green
}

# 5. Kiểm tra file CustomerList.tsx có tồn tại không
Write-Host "`n[5/8] Kiểm tra file CustomerList.tsx..." -ForegroundColor Yellow
$customerListPath = "frontend\src\pages\Customers\CustomerList.tsx"
if (Test-Path $customerListPath) {
    Write-Host "✓ File CustomerList.tsx tồn tại" -ForegroundColor Green
} else {
    Write-Host "⚠ File CustomerList.tsx KHÔNG tồn tại!" -ForegroundColor Yellow
    Write-Host "  (Có thể file này chưa được tạo hoặc ở vị trí khác)" -ForegroundColor Yellow
}

# 6. Kiểm tra trạng thái Git
Write-Host "`n[6/8] Kiểm tra trạng thái Git..." -ForegroundColor Yellow
git status --short
$statusOutput = git status --porcelain
if ([string]::IsNullOrWhiteSpace($statusOutput)) {
    Write-Host "⚠ Không có file nào thay đổi!" -ForegroundColor Yellow
    Write-Host "  (Có thể đã commit hết rồi, hoặc chưa có thay đổi)" -ForegroundColor Yellow
} else {
    Write-Host "✓ Có file thay đổi cần commit" -ForegroundColor Green
}

# 7. Add tất cả file
Write-Host "`n[7/8] Add tất cả file vào staging area..." -ForegroundColor Yellow
git add .
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Lỗi khi add file!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Đã add tất cả file" -ForegroundColor Green

# Kiểm tra lại những gì sẽ được commit
Write-Host "`n  Danh sách file sẽ được commit:" -ForegroundColor Cyan
git status --short

# 8. Commit
Write-Host "`n[8/8] Commit code..." -ForegroundColor Yellow
$commitMessage = "feat: Sync all changes from company machine - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ Không có gì để commit (có thể đã commit rồi)" -ForegroundColor Yellow
} else {
    Write-Host "✓ Đã commit thành công" -ForegroundColor Green
}

# 9. Push lên Git (QUAN TRỌNG: chỉ định rõ branch)
Write-Host "`n[9/9] Push lên Git (branch: sprint2-business-models)..." -ForegroundColor Yellow
git push origin sprint2-business-models
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Lỗi khi push!" -ForegroundColor Red
    Write-Host "  Có thể cần pull trước hoặc có conflict." -ForegroundColor Yellow
    Write-Host "  Thử chạy: git pull origin sprint2-business-models" -ForegroundColor Yellow
    exit 1
}
Write-Host "✓ Đã push thành công!" -ForegroundColor Green

# 10. Kiểm tra kết quả cuối cùng
Write-Host "`n[10/10] Kiểm tra kết quả..." -ForegroundColor Yellow
git status
$finalStatus = git status --porcelain
if ([string]::IsNullOrWhiteSpace($finalStatus)) {
    Write-Host "✓ Không còn file nào chưa commit" -ForegroundColor Green
} else {
    Write-Host "⚠ Vẫn còn file chưa commit:" -ForegroundColor Yellow
    git status --short
}

# Kiểm tra branch tracking
Write-Host "`n  Thông tin branch:" -ForegroundColor Cyan
git branch -vv | Select-String "sprint2-business-models"

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "HOÀN TẤT! Code đã được push lên Git." -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

Write-Host "Để kiểm tra trên GitHub:" -ForegroundColor Cyan
Write-Host "https://github.com/nguyenduytienthanh-ui/erp-carton/tree/sprint2-business-models" -ForegroundColor Cyan
