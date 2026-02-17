# Lệnh Git đồng bộ dự án (máy công ty ↔ máy nhà)

## Trước khi làm việc (chạy trên máy đang dùng)

```powershell
cd d:\ERP-Carton
git pull
```

## Sau khi làm việc (chạy trước khi chuyển máy)

```powershell
cd d:\ERP-Carton
git add .
git status
git commit -m "Mô tả thay đổi của bạn"
git push
```

## Ví dụ commit message

- `feat: Thêm tính năng X`
- `fix: Sửa lỗi Y`
- `docs: Cập nhật tài liệu`
- `refactor: Tái cấu trúc module Z`

## Lưu ý

- Luôn **pull** trước khi bắt đầu làm việc
- Luôn **push** sau khi xong việc
- Dùng chung cho cả 2 máy (công ty và nhà)
