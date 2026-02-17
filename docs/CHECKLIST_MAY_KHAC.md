# Checklist — Máy khác có đủ như máy này?

Sau khi `git pull`, kiểm tra:

## Code & Config

- [ ] `.cursorrules` — Quy tắc dự án
- [ ] `backend/.env` — Copy từ `.env.example`, điền DB
- [ ] `backend/requirements.txt` — `pip install -r requirements.txt`
- [ ] `frontend/package.json` — `npm install`

## Master Data (form Thêm sản phẩm)

- [ ] ĐVT (Đơn vị tính) — `python manage.py seed_units`
- [ ] Danh mục — `python manage.py seed_categories`
- [ ] Sóng, Kiểu thùng — `python manage.py seed_waves_boxtypes`

**Hoặc chạy một lệnh:** `python manage.py seed_master_data`

## Scripts

- [ ] `scripts/sync-pull.ps1` — Tải từ Git + cài deps + seed
- [ ] `scripts/sync-push.ps1` — Đẩy lên Git

## Chạy thử

- [ ] Backend: `python manage.py runserver`
- [ ] Frontend: `npm run dev`
- [ ] Mở http://localhost:5173/
- [ ] Form Thêm sản phẩm: dropdown ĐVT có danh sách
