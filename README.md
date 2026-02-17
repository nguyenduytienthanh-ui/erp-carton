# ERP Carton

Hệ thống ERP quản lý sản phẩm, khách hàng, đơn hàng.

## Setup máy mới

Xem [docs/SETUP_MACHINE_MOI.md](docs/SETUP_MACHINE_MOI.md)

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
