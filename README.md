# ERP Carton

Hệ thống ERP quản lý bán hàng, mua hàng, kho, sản xuất, tài chính và vận hành nội bộ.

Mọi quy tắc làm việc, định hướng kiến trúc và chuẩn hoàn thành xem tại `AGENTS.md`.

## Chạy local

```powershell
cd backend
python manage.py runserver
```

```powershell
cd frontend
copy .env.example .env.local
npm run dev
```

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1
```

Mở `http://localhost:5173/`.

## Smoke nhanh

```powershell
cd backend
python manage.py bootstrap_uat_demo --reset-passwords --password Demo123!
python manage.py smoke_http --backend-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:5173 --username uat_admin --password Demo123!
```
