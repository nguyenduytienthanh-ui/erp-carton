# Deploy Templates

Thư mục này chứa artifact mẫu để triển khai `ERP Carton` chuyên nghiệp hơn.

## 1. Docker Compose

File: `deploy/docker-compose.production.yml`

Chạy từ thư mục `deploy`:

```bash
docker compose -f docker-compose.production.yml up -d --build
```

Mặc định:
- frontend: `http://localhost:8080`
- backend: `http://localhost:8000`
- postgres: `localhost:5432`

Lưu ý:
- tạo `backend/.env` trước khi chạy
- chỉnh `VITE_API_BASE_URL` nếu frontend gọi API qua domain public

## 2. systemd

Các template:
- `deploy/systemd/erp-backend.service`
- `deploy/systemd/erp-worker.service`
- `deploy/systemd/erp-workflow-scheduler.service`
- `deploy/systemd/erp-reminder.service`
- `deploy/systemd/erp-reminder.timer`

Quy trình gợi ý:
- copy file vào `/etc/systemd/system/`
- sửa `WorkingDirectory`, `EnvironmentFile`, đường dẫn `.venv`
- chạy:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now erp-backend erp-worker erp-workflow-scheduler erp-reminder.timer
```

## 3. Trước khi go-live

1. `python manage.py backup --output backups`
2. `python manage.py migrate`
3. `python manage.py preflight_check --strict`
4. `python manage.py check`
5. `python manage.py bootstrap_uat_demo --reset-passwords --password Demo123!`
6. `python manage.py smoke_http --backend-base <backend-url> --frontend-base <frontend-url> --username uat_admin --password Demo123!`

Có thể chạy nhanh bằng script:

```powershell
.\scripts\deploy-validate.ps1 -BackendBase <backend-url> -FrontendBase <frontend-url>
```

Nếu cần kiểm tra nhanh môi trường cục bộ trước khi đóng gói:

```powershell
.\scripts\quality-check.ps1
```
