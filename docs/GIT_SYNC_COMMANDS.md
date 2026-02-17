# Đồng bộ dự án ERP-Carton (máy công ty ↔ máy nhà)

Mọi code, giao diện quản trị, giao diện người dùng đều nằm trong Git. Chạy đúng lệnh để 2 máy luôn giống nhau.

---

## KẾT THÚC LÀM VIỆC — Đẩy toàn bộ lên Git

**Chạy trước khi rời máy (công ty hoặc nhà):**

```powershell
cd d:\ERP-Carton
git add .
git status
git commit -m "Mô tả thay đổi"
git push
```

**Hoặc chạy script:** `.\scripts\sync-push.ps1`

---

## BẮT ĐẦU LÀM VIỆC — Tải toàn bộ từ Git

**Chạy khi bắt đầu làm việc (công ty hoặc nhà):**

```powershell
cd d:\ERP-Carton
git pull
```

**Nếu có thay đổi package/migration, chạy thêm:**

```powershell
cd d:\ERP-Carton\backend
pip install -r requirements.txt
python manage.py migrate

cd d:\ERP-Carton\frontend
npm install
```

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
