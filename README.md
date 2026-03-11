# ERP Carton

Hệ thống ERP quản lý sản phẩm, khách hàng, đơn hàng.

## Setup máy mới

Xem [docs/SETUP_MACHINE_MOI.md](docs/SETUP_MACHINE_MOI.md)

## UAT và demo role

- Bootstrap user/role/team mẫu: [docs/UAT_DEMO_USERS.md](docs/UAT_DEMO_USERS.md)
- Runbook production và deploy: [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md)
- Checklist diễn tập staging: [docs/STAGING_REHEARSAL_CHECKLIST.md](docs/STAGING_REHEARSAL_CHECKLIST.md)
- Monitoring và alerting: [docs/MONITORING_ALERTING.md](docs/MONITORING_ALERTING.md)
- Docker/systemd templates: [deploy/README.md](deploy/README.md)
- CI workflow: `.github/workflows/ci.yml`

## Đồng bộ Git (máy công ty ↔ máy nhà)

- **Bắt đầu:** `git pull` hoặc `.\scripts\sync-pull.ps1`
- **Kết thúc:** `git add .` → `git commit -m "..."` → `git push` hoặc `.\scripts\sync-push.ps1`

Chi tiết: [docs/GIT_SYNC_COMMANDS.md](docs/GIT_SYNC_COMMANDS.md)

## Chạy ứng dụng

```powershell
# Terminal 1 - Backend
cd backend
python manage.py runserver

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Mở http://localhost:5173/

## Frontend API endpoint

Frontend hỗ trợ cấu hình API bằng biến môi trường Vite:

```powershell
cd frontend
copy .env.example .env.local
```

Biến chính:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

## Smoke check sau khi chạy app

```powershell
cd backend
python manage.py bootstrap_uat_demo --reset-passwords --password Demo123!
python manage.py smoke_http --backend-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:5173 --username uat_admin --password Demo123!
```

## Ops scripts

```powershell
.\scripts\preflight-check.ps1
.\scripts\backup-now.ps1
.\scripts\smoke-check.ps1
.\scripts\deploy-validate.ps1
```

## Browser smoke test

```powershell
cd frontend
npx playwright install chromium
npm run e2e:smoke
```
