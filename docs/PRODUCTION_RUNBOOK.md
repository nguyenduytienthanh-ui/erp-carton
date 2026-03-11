# Production Runbook

Tài liệu này là checklist vận hành để đưa `ERP Carton` lên môi trường thật ổn định hơn.

## 1. Biến môi trường backend

Các biến tối thiểu trong `backend/.env`:

```env
SECRET_KEY=...
DEBUG=False
APP_ENV=production

DB_NAME=...
DB_USER=...
DB_PASSWORD=...
DB_HOST=...
DB_PORT=5432

ALLOWED_HOSTS=erp.example.com,api.erp.example.com
CORS_ALLOWED_ORIGINS=https://erp.example.com
CSRF_TRUSTED_ORIGINS=https://erp.example.com,https://api.erp.example.com

SESSION_COOKIE_SECURE=True
CSRF_COOKIE_SECURE=True
SECURE_SSL_REDIRECT=True
SECURE_CONTENT_TYPE_NOSNIFF=True
SECURE_HSTS_SECONDS=31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS=True
SECURE_HSTS_PRELOAD=True
X_FRAME_OPTIONS=DENY
REFERRER_POLICY=same-origin
USE_X_FORWARDED_PROTO=True
VITE_API_BASE_URL=https://erp.example.com/api

PERMISSION_STRICT_DEFAULT=False
LOG_LEVEL=INFO
LOG_TO_FILE=True
LOG_DIR=/opt/erp-carton/backend/logs
LOG_FILE_MAX_BYTES=10485760
LOG_FILE_BACKUP_COUNT=5
SENTRY_DSN=...
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0
SENTRY_SEND_DEFAULT_PII=False
Q_CLUSTER_WORKERS=4
Q_CLUSTER_TIMEOUT=90
Q_CLUSTER_RETRY=120
Q_CLUSTER_QUEUE_LIMIT=50
Q_CLUSTER_BULK=10
Q_CLUSTER_SAVE_LIMIT=250
```

Gợi ý:
- Giữ `PERMISSION_STRICT_DEFAULT=False` cho đến khi đã kiểm tra đầy đủ toàn bộ permission seed trong production.
- Khi reverse proxy truyền `X-Forwarded-Proto`, bật `USE_X_FORWARDED_PROTO=True`.
- Xem thêm chi tiết monitoring: [MONITORING_ALERTING.md](./MONITORING_ALERTING.md)

## 2. Deploy checklist

1. Pull đúng branch release.
2. Backup trước khi deploy:

```powershell
cd backend
python manage.py backup --output backups
```

3. Apply migration:

```powershell
python manage.py migrate
```

4. Bootstrap UAT hoặc môi trường staging nếu cần:

```powershell
python manage.py bootstrap_uat_demo --reset-passwords --password Demo123!
```

5. Chạy kiểm tra Django:

```powershell
python manage.py check
```

6. Build frontend:

```powershell
cd ..\frontend
npm install
npm run build
```

Nếu build khác domain local, tạo `.env.production` hoặc truyền `VITE_API_BASE_URL` trước khi build.

7. Chạy smoke check sau deploy:

```powershell
cd ..\backend
python manage.py smoke_http --backend-base https://api.erp.example.com --frontend-base https://erp.example.com --username uat_admin --password Demo123!
```

8. Nếu môi trường có trình duyệt CI/CD, chạy thêm:

```powershell
cd ..\frontend
npx playwright install chromium
npm run e2e:smoke
```

## 3. Scheduler và nền tác vụ

Các job cần giám sát:
- `python manage.py run_workflow_automation_scheduler`
- `python manage.py send_task_overdue_reminders`
- worker `django_q`

Khuyến nghị production:
- chạy bằng service manager riêng
- có restart policy
- log stdout/stderr tập trung
- có cảnh báo nếu worker chết hoặc queue tăng bất thường

## 4. Backup và restore

### Backup

```powershell
cd backend
python manage.py backup --output backups
```

Khuyến nghị:
- backup tối thiểu hằng ngày
- giữ nhiều phiên bản
- copy offsite sau khi backup local thành công

### Restore

```powershell
cd backend
python manage.py restore .\backups\<timestamp> --confirm
```

Nguyên tắc:
- restore trên staging trước khi restore production
- luôn chụp backup mới ngay trước khi restore
- sau restore phải chạy smoke check

## 5. Rollback checklist

1. Dừng deploy mới.
2. Chụp backup hiện trạng lỗi.
3. Nếu lỗi thuộc frontend: rollback build frontend trước.
4. Nếu lỗi thuộc backend không phá schema: rollback code backend.
5. Nếu lỗi thuộc dữ liệu/schema:
- restore DB từ backup gần nhất đã xác nhận tốt
- restore media nếu cần
- chạy `python manage.py check`
- chạy `smoke_http`

## 6. Go-live smoke tối thiểu

- `/health/live/` trả `alive`
- `/health/ready/` trả `healthy`
- `/health/` trả `200` và có đầy đủ check mở rộng
- login thành công
- `/api/users/me/` trả đúng profile
- `notifications`, `operations log`, `module permissions history` tải được với user phù hợp
- user không có quyền bị `403` đúng ở admin/governance
- background jobs hoạt động và có log
