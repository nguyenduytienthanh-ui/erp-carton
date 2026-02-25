# Sửa Lỗi Push Bị Reject

## Vấn đề

Khi push, gặp lỗi:
```
! [rejected]        sprint2-business-models -> sprint2-business-models (fetch first)
error: failed to push some refs
hint: Updates were rejected because the remote contains work that you do not have locally.
```

## Nguyên nhân

Remote (GitHub) có code mới hơn local (máy công ty). Có thể:
- Máy nhà đã push code lên trước đó
- Hoặc có người khác đã push code

## Giải pháp

### Bước 1: Pull code mới nhất từ remote

```powershell
# Ở máy công ty, chạy:
cd D:\ERP-Carton
git pull origin sprint2-business-models
```

**Nếu có conflict:**
- Git sẽ báo conflict
- Xem phần "Xử lý Conflict" bên dưới

**Nếu không có conflict:**
- Git sẽ tự động merge
- Tiếp tục Bước 2

### Bước 2: Push lại

```powershell
git push origin sprint2-business-models
```

## Xử lý Conflict

### Nếu pull có conflict:

**Kiểm tra file conflict:**
```powershell
git status
```

**Nếu muốn giữ code từ máy công ty (khuyến nghị):**
```powershell
# Xem file nào conflict
git status

# Giữ code từ máy công ty cho file cụ thể
git checkout --ours frontend/src/pages/Customers/CustomerList.tsx

# Hoặc giữ tất cả code từ máy công ty
git checkout --ours .

# Add và commit
git add .
git commit -m "fix: Resolve merge conflict - keep company version"
git push origin sprint2-business-models
```

**Nếu muốn giữ code từ remote (máy nhà):**
```powershell
git checkout --theirs .
git add .
git commit -m "fix: Resolve merge conflict - keep remote version"
git push origin sprint2-business-models
```

## Lệnh đầy đủ (Copy/Paste)

### Ở máy công ty:

```powershell
cd D:\ERP-Carton
git checkout sprint2-business-models
git pull origin sprint2-business-models
# Nếu có conflict, xem phần "Xử lý Conflict" trên
git add .
git commit -m "feat: Sync all changes from company machine"
git push origin sprint2-business-models
git status
```

## Lưu ý về đường dẫn

**Vấn đề:** Đường dẫn có thể khác nhau:
- `D:\ERP-Carton` (chữ hoa)
- `D:\Projects\erp-carton` (chữ thường)

**Giải pháp:**
- Kiểm tra đường dẫn thực tế: `Get-Location` hoặc `pwd`
- Sử dụng đúng đường dẫn trong lệnh

## Kiểm tra sau khi push

```powershell
git status
```

**Kết quả mong đợi:**
```
On branch sprint2-business-models
Your branch is up to date with 'origin/sprint2-business-models'.
nothing to commit, working tree clean
```

## Nếu vẫn lỗi

### Thử force push (CẨN THẬN - chỉ dùng nếu chắc chắn):

```powershell
# CHỈ dùng nếu bạn chắc chắn muốn ghi đè code trên remote
git push origin sprint2-business-models --force
```

**⚠️ CẢNH BÁO:** Force push sẽ ghi đè code trên remote. Chỉ dùng nếu:
- Bạn chắc chắn code local đúng
- Không có người khác đang làm việc trên branch này
- Đã backup code trên remote
