# ERP Carton

Hệ thống ERP cho doanh nghiệp thùng carton, gồm các nhóm nghiệp vụ bán hàng, mua hàng, kho, sản xuất, tài chính, quản trị và điều hành tác vụ.

## Đọc trước

- Bộ tài liệu chuẩn: [docs/START_HERE.md](docs/START_HERE.md)
- Bản quyết định cho chủ dự án: [docs/OWNER_DECISION_GUIDE.md](docs/OWNER_DECISION_GUIDE.md)
- Quy tắc dùng chung bắt buộc: [docs/COMMON_RULES_STANDARD.md](docs/COMMON_RULES_STANDARD.md)
- Quy tắc nghiệp vụ lõi: [docs/BUSINESS_RULES_STANDARD.md](docs/BUSINESS_RULES_STANDARD.md)
- Quy tắc theo module: [docs/MODULE_RULES_STANDARD.md](docs/MODULE_RULES_STANDARD.md)
- Quy tắc làm việc của AI: [AGENTS.md](AGENTS.md)

## Thiết lập và đồng bộ

- Setup máy mới: [docs/SETUP_MACHINE_MOI.md](docs/SETUP_MACHINE_MOI.md)
- Đồng bộ Git an toàn: [docs/GIT_WORKFLOW_GUIDE.md](docs/GIT_WORKFLOW_GUIDE.md)
- User, role, team mẫu để UAT: [docs/UAT_DEMO_USERS.md](docs/UAT_DEMO_USERS.md)

## Vận hành và go-live

- Production runbook: [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md)
- Monitoring và alerting: [docs/MONITORING_ALERTING.md](docs/MONITORING_ALERTING.md)
- Checklist diễn tập staging: [docs/STAGING_REHEARSAL_CHECKLIST.md](docs/STAGING_REHEARSAL_CHECKLIST.md)
- Docker/systemd templates: [deploy/README.md](deploy/README.md)
- CI workflow: `.github/workflows/ci.yml`

## Chạy ứng dụng

```powershell
# Terminal 1 - Backend
cd backend
python manage.py runserver

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Mở `http://localhost:5173/`

## Frontend API endpoint

```powershell
cd frontend
copy .env.example .env.local
```

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

## Smoke check nhanh

```powershell
cd backend
python manage.py bootstrap_uat_demo --reset-passwords --password Demo123!
python manage.py smoke_http --backend-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:5173 --username uat_admin --password Demo123!
```

## Kiểm tra chất lượng một lệnh

```powershell
.\scripts\quality-check.ps1
```

Script này sẽ tự chuẩn bị `backend/.env`, đồng bộ dependency còn thiếu và chạy lại `lint`, `build`, cùng bộ test backend chuẩn.

## Ops scripts

```powershell
.\scripts\preflight-check.ps1
.\scripts\backup-now.ps1
.\scripts\smoke-check.ps1
.\scripts\deploy-validate.ps1
.\scripts\quality-check.ps1
```

## Browser smoke test

```powershell
cd frontend
npx playwright install chromium
npm run e2e:smoke
```
