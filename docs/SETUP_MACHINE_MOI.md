# Setup dự án trên máy mới (máy nhà / máy khác)

Làm theo từng bước để máy mới có đầy đủ như máy hiện tại.

---

## 1. Clone dự án

```powershell
cd D:\Projects
git clone https://github.com/nguyenduytienthanh-ui/erp-carton.git erp-carton
cd erp-carton
git checkout sprint2-business-models
```

*(Đổi `D:\Projects` nếu bạn đặt thư mục khác)*

---

## 2. Backend (Django)

```powershell
cd backend
```

### 2.1 Tạo .env

```powershell
copy .env.example .env
```

Mở `.env` và điền: SECRET_KEY, DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT (PostgreSQL).

### 2.2 Cài đặt và migrate

```powershell
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_master_data
python manage.py bootstrap_uat_demo --reset-passwords --password Demo123!
```

### 2.3 Tạo superuser (để quản trị hệ thống)

```powershell
python manage.py createsuperuser
```

Ngoài superuser, dự án có thể dùng ngay bộ user UAT ở tài liệu:

- [UAT_DEMO_USERS.md](./UAT_DEMO_USERS.md)

---

## 3. Frontend

```powershell
cd ..\frontend
npm install
```

---

## 4. Chạy ứng dụng

**Terminal 1 – Backend:**
```powershell
cd backend
python manage.py runserver
```

**Terminal 2 – Frontend:**
```powershell
cd frontend
npm run dev
```

Mở trình duyệt: http://localhost:5173/

### 4.1 Smoke check nhanh

```powershell
cd backend
python manage.py smoke_http --backend-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:5173 --username uat_admin --password Demo123!
```

---

## 5. Đồng bộ hàng ngày

- **Bắt đầu làm việc:** `git pull` (hoặc `.\scripts\sync-pull.ps1`)
- **Kết thúc làm việc:** `git add .` → `git commit -m "..."` → `git push` (hoặc `.\scripts\sync-push.ps1`)

Chi tiết: [GIT_SYNC_COMMANDS.md](./GIT_SYNC_COMMANDS.md)
