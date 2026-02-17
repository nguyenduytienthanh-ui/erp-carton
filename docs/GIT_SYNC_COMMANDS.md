# Đồng bộ dự án ERP-Carton (máy công ty ↔ máy nhà)

Mọi code, giao diện quản trị, giao diện người dùng đều nằm trong Git. Chạy đúng lệnh để 2 máy luôn giống nhau.

---

## KẾT THÚC LÀM VIỆC — Đẩy toàn bộ lên Git

**Chạy trước khi rời máy (công ty hoặc nhà):**

```powershell
cd <thư mục dự án>   # VD: d:\ERP-Carton hoặc D:\Projects\erp-carton
git add .
git status
git commit -m "Mô tả thay đổi"
git push
```

**Hoặc chạy script:** `.\scripts\sync-push.ps1` (chạy từ thư mục gốc dự án)

---

## BẮT ĐẦU LÀM VIỆC — Tải toàn bộ từ Git

**Chạy khi bắt đầu làm việc (công ty hoặc nhà):**

```powershell
cd <thư mục dự án>   # VD: d:\ERP-Carton hoặc D:\Projects\erp-carton
git pull
```

**Nếu có thay đổi package/migration, chạy thêm:**

```powershell
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_master_data

cd ..\frontend
npm install
```

**Lưu ý:** `seed_master_data` tạo ĐVT, Sóng, Kiểu thùng. Cần cho form Thêm sản phẩm (chọn ĐVT).

**Hoặc chạy script:** `.\scripts\sync-pull.ps1`

---

## Tóm tắt

| Thời điểm | Lệnh |
|-----------|------|
| **Kết thúc** (trước khi đổi máy) | `git add .` → `git commit -m "..."` → `git push` |
| **Bắt đầu** (khi vào máy) | `git pull` |

---

## Lưu ý

- **`.env`** không nằm trong Git (bảo mật). Máy nhà cần có file `.env` riêng (đã có).
- **`node_modules`** không nằm trong Git. Sau `git pull` nếu `package.json` đổi → chạy `npm install`.
- Luôn **push** trước khi rời máy, **pull** khi bắt đầu làm việc.

---

## Máy nhà thiếu .env?

Copy từ `backend/.env.example` thành `backend/.env`, rồi điền DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT phù hợp máy nhà.

---

## Không chọn được ĐVT khi Thêm sản phẩm?

**Nguyên nhân:** Database máy nhà chưa có dữ liệu ĐVT (Đơn vị tính).

**Cách sửa:** Chạy seed (từ thư mục dự án):

```powershell
cd backend
python manage.py seed_units
```

Hoặc seed toàn bộ master data (ĐVT + Sóng + Kiểu):

```powershell
python manage.py seed_master_data
```

Sau đó mở lại form Thêm sản phẩm → dropdown ĐVT sẽ có dữ liệu.
