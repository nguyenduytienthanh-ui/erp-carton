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
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

Mở `http://localhost:5173/`.

## Smoke nhanh

```powershell
cd backend
python manage.py bootstrap_uat_demo --reset-passwords --password Demo123!
python manage.py smoke_http --backend-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:5173 --username uat_admin --password Demo123!
```

## Hybrid readiness

- API contract: frontend uses `VITE_API_BASE_URL` ending in `/api`.
- Backend hybrid env template: `backend/.env.hybrid.example`.
- Backup/restore tooling: install PostgreSQL client tools on the Mini PC or ops machine, then add the PostgreSQL `bin` folder to Windows `PATH` so `pg_dump` and `psql` are available in a new PowerShell window.
- `release_readiness` can stay blocked until a fresh backup, restore dry-run, and alert delivery drill are completed with explicit approval.
- Safe checks before release:

```powershell
cd backend
python manage.py preflight_check
python manage.py release_readiness
```
