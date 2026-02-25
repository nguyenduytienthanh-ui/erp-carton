# Hướng Dẫn Đồng Bộ Máy Nhà Với Máy Công Ty

## ✅ XÁC NHẬN: CÓ, GIAO DIỆN SẼ GIỐNG NHAU!

Sau khi thực hiện đúng các bước dưới đây, giao diện máy nhà sẽ **GIỐNG HỆT** máy công ty.

---

## 📋 QUY TRÌNH ĐẦY ĐỦ

### BƯỚC 1: Ở máy công ty - Push code lên Git

```powershell
cd D:\Projects\erp-carton; git checkout sprint2-business-models; git add .; git commit -m "feat: Sync all changes from company machine"; git push origin sprint2-business-models; git status
```

**Kiểm tra kết quả:**
- Phải thấy: `Your branch is up to date with 'origin/sprint2-business-models'`
- Nếu có lỗi, xem file `docs/NGUYEN_NHAN_KHONG_CO_TREN_GIT.md`

---

### BƯỚC 2: Ở máy nhà - Pull code từ Git

```powershell
cd D:\Projects\erp-carton
git pull origin sprint2-business-models
```

**Kiểm tra kết quả:**
- Phải thấy: `Updating...` hoặc `Already up to date`
- Nếu có conflict, xem phần "Xử lý Conflict" bên dưới

---

### BƯỚC 3: Kiểm tra file CustomerList.tsx đã có chưa

```powershell
Test-Path "frontend\src\pages\Customers\CustomerList.tsx"
```

**Kết quả mong đợi:** `True`

**Nếu là `False`:**
→ File chưa được push từ máy công ty. Quay lại BƯỚC 1.

---

### BƯỚC 4: Cài đặt dependencies (nếu có thay đổi)

#### Frontend:
```powershell
cd frontend
npm install
```

**Khi nào cần chạy:**
- Sau khi pull code mới
- Khi thấy lỗi "module not found"
- Khi `package.json` có thay đổi

#### Backend:
```powershell
cd backend
# Nếu có venv, activate nó
if (Test-Path "venv\Scripts\activate.ps1") { & "venv\Scripts\activate.ps1" }
pip install -r requirements.txt
```

**Khi nào cần chạy:**
- Sau khi pull code mới
- Khi thấy lỗi "module not found"
- Khi `requirements.txt` có thay đổi

---

### BƯỚC 5: Restart Frontend và Backend

#### Dừng server cũ (nếu đang chạy):
- Nhấn `Ctrl+C` trong terminal đang chạy server

#### Chạy Backend:
```powershell
cd D:\Projects\erp-carton\backend
if (Test-Path "venv\Scripts\activate.ps1") { & "venv\Scripts\activate.ps1"; python manage.py runserver 127.0.0.1:8000 } else { python manage.py runserver 127.0.0.1:8000 }
```

**Kiểm tra:**
- Mở: http://127.0.0.1:8000/
- Phải thấy Django admin hoặc API response

#### Chạy Frontend:
```powershell
cd D:\Projects\erp-carton\frontend
npm run dev
```

**Kiểm tra:**
- Mở: http://127.0.0.1:5173/
- Phải thấy giao diện ứng dụng

---

### BƯỚC 6: Kiểm tra giao diện

1. **Mở:** http://127.0.0.1:5173/
2. **Đăng nhập** (nếu cần)
3. **Vào trang "Danh sách khách hàng"** (`/customers`)
4. **Kiểm tra:**
   - [ ] Có filter panel không?
   - [ ] Có nút "Cột" (Column Chooser) không?
   - [ ] Có checkbox để chọn nhiều dòng không?
   - [ ] Có đủ 5 icon trong cột "Thao tác" không? (Xem, Duyệt, Lịch sử, Sửa, Xóa)
   - [ ] Giao diện giống máy công ty không?

---

## ⚠️ XỬ LÝ CÁC VẤN ĐỀ

### Vấn đề 1: Conflict khi pull

**Lỗi:**
```
Auto-merging failed
CONFLICT (content): Merge conflict in ...
```

**Giải pháp:**
```powershell
# Xem file conflict
git status

# Nếu muốn giữ code từ máy công ty (khuyến nghị)
git checkout --theirs frontend/src/pages/Customers/CustomerList.tsx
git add .
git commit -m "fix: Resolve merge conflict - keep company version"
git push origin sprint2-business-models
```

---

### Vấn đề 2: File CustomerList.tsx vẫn không có

**Kiểm tra:**
```powershell
# Kiểm tra trên Git
git ls-tree -r origin/sprint2-business-models --name-only | Select-String "CustomerList"

# Nếu không có kết quả
→ File chưa được push từ máy công ty
→ Quay lại BƯỚC 1
```

---

### Vấn đề 3: Lỗi "module not found"

**Frontend:**
```powershell
cd frontend
rm -rf node_modules
npm install
```

**Backend:**
```powershell
cd backend
if (Test-Path "venv\Scripts\activate.ps1") { & "venv\Scripts\activate.ps1" }
pip install -r requirements.txt
```

---

### Vấn đề 4: Giao diện vẫn khác

**Kiểm tra:**
1. File `CustomerList.tsx` có tồn tại không?
2. Frontend đã restart chưa? (Ctrl+C rồi chạy lại `npm run dev`)
3. Browser cache? (Thử Ctrl+Shift+R để hard refresh)
4. Đang ở đúng branch không? (`git branch` phải là `sprint2-business-models`)

---

## 📝 CHECKLIST HOÀN CHỈNH

### Ở máy công ty:
- [ ] Đã chạy lệnh push
- [ ] `git status` hiển thị "up to date"
- [ ] File `CustomerList.tsx` có trong commit (`git show HEAD --name-only`)

### Ở máy nhà:
- [ ] Đã pull code (`git pull origin sprint2-business-models`)
- [ ] File `CustomerList.tsx` tồn tại (`Test-Path` = `True`)
- [ ] Đã cài dependencies (`npm install` và `pip install`)
- [ ] Đã restart frontend và backend
- [ ] Giao diện giống máy công ty

---

## 🎯 KẾT QUẢ MONG ĐỢI

Sau khi hoàn thành tất cả các bước:

✅ **Giao diện máy nhà = Giao diện máy công ty**

Bao gồm:
- ✅ Filter panel đầy đủ
- ✅ Column chooser
- ✅ Row selection (checkbox)
- ✅ Đủ 5 icon trong Actions
- ✅ Layout giống hệt
- ✅ Tất cả tính năng hoạt động

---

## 💡 LỆNH NHANH (Copy/Paste)

### Ở máy công ty:
```powershell
cd D:\Projects\erp-carton; git checkout sprint2-business-models; git add .; git commit -m "feat: Sync all changes from company machine"; git push origin sprint2-business-models; git status
```

### Ở máy nhà:
```powershell
cd D:\Projects\erp-carton; git pull origin sprint2-business-models; Test-Path "frontend\src\pages\Customers\CustomerList.tsx"; cd frontend; npm install; cd ..\backend; if (Test-Path "venv\Scripts\activate.ps1") { & "venv\Scripts\activate.ps1"; pip install -r requirements.txt } else { pip install -r requirements.txt }
```

**Sau đó restart frontend và backend!**

---

## ❓ CÂU HỎI THƯỜNG GẶP

**Q: Tại sao phải restart server?**  
A: Để load code mới. Code cũ vẫn đang chạy trong memory.

**Q: Có cần cài lại dependencies mỗi lần pull không?**  
A: Chỉ cần khi `package.json` hoặc `requirements.txt` thay đổi.

**Q: Nếu giao diện vẫn khác thì sao?**  
A: Kiểm tra lại checklist, đảm bảo đã restart server và hard refresh browser.

**Q: Có cách nào tự động không?**  
A: Có thể tạo script, nhưng khuyến nghị làm thủ công để kiểm soát tốt hơn.
