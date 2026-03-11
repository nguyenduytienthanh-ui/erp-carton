# Staging Rehearsal Checklist

Tài liệu này dùng để diễn tập trước khi go-live production.

## 1. Chuẩn bị

- Đồng bộ code đúng branch release.
- Xác nhận `backend/.env` và `frontend/.env` đã trỏ đúng domain staging.
- Chạy:

```powershell
.\scripts\preflight-check.ps1
```

Nếu có `ERROR`, phải xử lý trước khi diễn tập tiếp.

## 2. Backup trước diễn tập

```powershell
.\scripts\backup-now.ps1
```

Xác nhận:
- có thư mục backup mới trong `backend/backups`
- có `database.sql`
- có `backup_info.txt`

## 3. Deploy rehearsal

1. `python manage.py migrate`
2. `python manage.py check`
3. `python manage.py bootstrap_uat_demo --reset-passwords --password Demo123!`
4. build frontend
5. chạy:

```powershell
.\scripts\smoke-check.ps1 -BackendBase https://staging-api.example.com -FrontendBase https://staging.example.com
```

## 4. Browser/UAT rehearsal

Chạy:

```powershell
cd frontend
npm run e2e:smoke
```

Kiểm tra thêm thủ công:
- `uat_admin` vào được governance/admin
- `uat_sales` không vào được governance/admin
- `uat_finance` thao tác được `Tài chính`
- `uat_hr` thao tác được `Nhân sự`

## 5. Rollback rehearsal

Diễn tập ít nhất 1 lần:

1. Chụp backup mới.
2. Chọn 1 backup cũ.
3. Restore trên staging:

```powershell
cd backend
python manage.py restore .\backups\<timestamp> --confirm
```

4. Sau restore, chạy:

```powershell
python manage.py check
python manage.py smoke_http --backend-base https://staging-api.example.com --frontend-base https://staging.example.com --username uat_admin --password Demo123!
```

## 6. Điều kiện đạt

- preflight không có `ERROR`
- smoke check pass
- Playwright smoke pass
- restore rehearsal pass
- governance routes chặn/cho đúng role
- không có lỗi nghiêm trọng trong log backend/frontend
