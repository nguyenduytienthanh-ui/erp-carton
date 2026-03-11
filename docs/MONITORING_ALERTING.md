# Monitoring And Alerting

Tài liệu này mô tả lớp quan sát tối thiểu để vận hành `ERP Carton` ổn định hơn.

## 1. Health endpoints

- `GET /health/live/`
  - dùng cho liveness probe
  - chỉ trả trạng thái tiến trình còn sống
- `GET /health/ready/`
  - dùng cho readiness probe
  - kiểm tra `database` và `media`
- `GET /health/`
  - dùng cho dashboard hoặc kiểm tra sâu
  - có thêm `disk`, `memory`, `queue`, `data`

Mỗi response backend sẽ trả thêm header `X-Request-ID` để truy vết log.

## 2. Sentry

### Backend

Biến môi trường:

```env
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0
SENTRY_SEND_DEFAULT_PII=False
```

### Frontend

Biến môi trường:

```env
VITE_SENTRY_DSN=
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
```

Nguyên tắc:
- staging có thể dùng DSN riêng
- production nên bật DSN thật
- chỉ tăng sample rate khi đã kiểm soát chi phí

## 3. File logging

Biến môi trường backend:

```env
LOG_TO_FILE=True
LOG_DIR=/opt/erp-carton/backend/logs
LOG_FILE_MAX_BYTES=10485760
LOG_FILE_BACKUP_COUNT=5
```

Khi bật `LOG_TO_FILE`, backend sẽ ghi log quay vòng bằng `RotatingFileHandler`.
Mỗi dòng log backend có thêm `req:<request_id>` để đối chiếu với header trả về cho client.

## 4. Log rotation ngoài ứng dụng

Template có sẵn:

- `deploy/logrotate/erp-carton`

Triển khai trên Linux:

```bash
sudo cp deploy/logrotate/erp-carton /etc/logrotate.d/erp-carton
sudo logrotate -d /etc/logrotate.d/erp-carton
```

## 5. Alert gợi ý

Nên cảnh báo khi:
- `/health/ready/` không còn `healthy`
- worker `django_q` chết
- scheduler `run_workflow_automation_scheduler` chết
- queue depth tăng cao bất thường
- Sentry có lỗi mới ở `production`
- backup hằng ngày không tạo được file mới

## 6. Quy trình kiểm tra nhanh

```powershell
.\scripts\preflight-check.ps1
.\scripts\smoke-check.ps1
```

Nếu production:
- xác nhận `SENTRY_DSN` đã bật
- xác nhận `LOG_TO_FILE=True` hoặc đang dùng journald/log aggregator
- xác nhận backup và restore rehearsal đã chạy ít nhất 1 lần trên staging
