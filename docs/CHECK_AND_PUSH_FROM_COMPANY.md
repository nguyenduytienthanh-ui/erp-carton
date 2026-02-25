# Kiểm tra và Push lại từ Máy Công Ty

## Vấn đề
Code từ máy công ty chưa được push lên Git thành công. File `CustomerList.tsx` và các thay đổi khác chưa có trên Git.

## Các bước kiểm tra và push lại

### 1. Mở Terminal/PowerShell ở máy công ty
```powershell
cd D:\Projects\erp-carton
# hoặc đường dẫn tương ứng
```

### 2. Kiểm tra branch hiện tại
```powershell
git branch
```

**Kết quả mong đợi:** Phải thấy dấu `*` ở `sprint2-business-models`
```
  main
* sprint2-business-models
```

**Nếu không đúng branch:**
```powershell
git checkout sprint2-business-models
```

### 3. Kiểm tra trạng thái
```powershell
git status
```

**Kiểm tra:**
- [ ] File `frontend/src/pages/Customers/CustomerList.tsx` có trong danh sách không?
- [ ] Có commit nào chưa push không? (thấy "Your branch is ahead of...")

### 4. Kiểm tra commit gần nhất
```powershell
git log --oneline -5
```

**Kiểm tra:**
- [ ] Có commit với message "Mô tả thay đổi của bạn" không?
- [ ] Commit đó có chứa file `CustomerList.tsx` không?

### 5. Kiểm tra file có trong commit không
```powershell
git show HEAD --name-only
```

**Hoặc xem commit cụ thể:**
```powershell
git log --oneline --all --grep="Mô tả" -i
# Lấy hash của commit, ví dụ: abc1234
git show abc1234 --name-only
```

**Kiểm tra:**
- [ ] File `frontend/src/pages/Customers/CustomerList.tsx` có trong danh sách không?

### 6. Nếu file chưa được add vào commit

**Kiểm tra file có tồn tại không:**
```powershell
Test-Path "frontend\src\pages\Customers\CustomerList.tsx"
```

**Nếu file tồn tại nhưng chưa được commit:**
```powershell
# Add file
git add frontend/src/pages/Customers/CustomerList.tsx

# Hoặc add tất cả
git add .

# Kiểm tra lại
git status

# Commit lại
git commit -m "feat: Add CustomerList with filter panel, column chooser, and row selection"
```

### 7. Push lên Git (QUAN TRỌNG: chỉ định rõ branch)
```powershell
git push origin sprint2-business-models
```

**KHÔNG dùng:** `git push` (có thể push nhầm branch)

### 8. Kiểm tra push thành công
```powershell
git status
```

**Kết quả mong đợi:**
```
On branch sprint2-business-models
Your branch is up to date with 'origin/sprint2-business-models'.
```

**Nếu thấy "Your branch is ahead of...":**
→ Push chưa thành công, thử lại:
```powershell
git push origin sprint2-business-models
```

### 9. Xác nhận trên GitHub (nếu có quyền truy cập)
- Vào: https://github.com/nguyenduytienthanh-ui/erp-carton
- Kiểm tra branch `sprint2-business-models`
- Xem file `frontend/src/pages/Customers/CustomerList.tsx` có không

## Lệnh đầy đủ (copy/paste)

```powershell
# 1. Vào thư mục
cd D:\Projects\erp-carton

# 2. Kiểm tra branch
git branch

# 3. Đảm bảo ở đúng branch
git checkout sprint2-business-models

# 4. Kiểm tra trạng thái
git status

# 5. Add tất cả file (nếu cần)
git add .

# 6. Kiểm tra lại
git status

# 7. Commit (nếu chưa commit)
git commit -m "feat: Add CustomerList with filter panel, column chooser, and row selection"

# 8. Push (QUAN TRỌNG: chỉ định rõ branch)
git push origin sprint2-business-models

# 9. Kiểm tra lại
git status
```

## Troubleshooting

### Lỗi: "error: failed to push some refs"
```powershell
# Pull code mới nhất trước
git pull origin sprint2-business-models

# Giải quyết conflict nếu có, sau đó push lại
git push origin sprint2-business-models
```

### Lỗi: "authentication failed"
→ Cần cấu hình Git credentials hoặc SSH key

### Không thấy file CustomerList.tsx trong commit
→ File chưa được add. Chạy:
```powershell
git add frontend/src/pages/Customers/CustomerList.tsx
git commit -m "feat: Add CustomerList"
git push origin sprint2-business-models
```

## Sau khi push thành công

**Ở máy nhà, chạy:**
```powershell
cd D:\Projects\erp-carton
git pull origin sprint2-business-models
```

**Kiểm tra file đã có:**
```powershell
Test-Path "frontend\src\pages\Customers\CustomerList.tsx"
```

**Kết quả:** Phải là `True`
