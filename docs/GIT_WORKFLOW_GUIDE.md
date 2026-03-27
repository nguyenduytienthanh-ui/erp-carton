# Quy trình Git an toàn

## Mục tiêu

Tài liệu này thay thế các ghi chú Git rời rạc trước đây. Mục tiêu là để người không chuyên kỹ thuật cũng có thể bắt đầu và kết thúc một ngày làm việc an toàn, ít rủi ro mất code.

## Bắt đầu làm việc

Từ thư mục gốc dự án:

```powershell
git pull
```

Hoặc dùng script:

```powershell
.\scripts\sync-pull.ps1
```

Script này sẽ cố gắng tự chuẩn bị môi trường cục bộ: tạo `backend/.env` nếu thiếu, cài dependency còn thiếu và chạy migrate/seed cơ bản.

## Nếu có thay đổi package hoặc migration

```powershell
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_master_data

cd ..\frontend
npm install
```

## Kết thúc làm việc

Từ thư mục gốc dự án:

```powershell
git status
git add .
git commit -m "Mô tả thay đổi"
git push
```

Hoặc dùng script:

```powershell
.\scripts\sync-push.ps1
```

## Kiểm tra nhanh trước khi kết thúc

```powershell
.\scripts\quality-check.ps1
```

Script này tự xử lý các lỗi thường gặp kiểu thiếu `.env`, thiếu `node_modules`, thiếu `eslint` hoặc `tsc`, rồi mới chạy:
- frontend lint
- frontend build
- backend test chuẩn

## Nguyên tắc an toàn

- Luôn `pull` trước khi bắt đầu làm việc.
- Luôn `push` trước khi rời máy hoặc chuyển máy.
- Chỉ commit khi đã xem qua `git status`.
- Không `force push` nếu chưa có xác nhận rất rõ.
- Không dùng các mẹo chọn `ours/theirs` hàng loạt nếu chưa hiểu conflict.
- Nếu thấy có migration, package hoặc seed thay đổi, phải chạy bước cập nhật tương ứng trước khi kết luận hệ thống bị lỗi.

## Khi push bị từ chối

Thực hiện theo thứ tự:

```powershell
git pull
```

Nếu có conflict:

- Dừng lại để xem file nào đang conflict.
- Giải quyết từng file cẩn thận.
- Sau khi giải quyết xong:

```powershell
git add .
git commit -m "Resolve merge conflict"
git push
```

## Khi setup máy mới

Xem:

- `docs/SETUP_MACHINE_MOI.md`
- `docs/UAT_DEMO_USERS.md`

## Kết luận ngắn

- Bắt đầu: `pull`
- Kết thúc: `status -> add -> commit -> push`
- Có lỗi push: `pull` và xử lý cẩn thận, không đẩy mạnh tay
