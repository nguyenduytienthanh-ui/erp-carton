# UAT Demo Users

Tài liệu này dùng cho môi trường `UAT` hoặc máy demo nội bộ. Không dùng nguyên password mẫu cho production.

## 1. Bootstrap nhanh

```powershell
cd backend
python manage.py migrate
python manage.py bootstrap_uat_demo --reset-passwords --password Demo123!
```

Lệnh trên sẽ:
- tạo hoặc cập nhật permission nền cho `Workforce`, `Finance`, `Ops`, `Workflow`, `RBAC`, `Products`, `Sales`
- tạo role UAT chuẩn
- tạo team mẫu
- tạo user demo và gán role/team tương ứng

## 2. Danh sách user mẫu

Password mặc định theo ví dụ trên: `Demo123!`

| Username | Vai trò chính | Mục đích |
|---|---|---|
| `uat_admin` | `ADMIN` | Test toàn bộ hệ thống bằng RBAC thay vì superuser |
| `uat_manager` | `MANAGER` | Test góc nhìn quản lý liên phòng ban |
| `uat_finance` | `FINANCE_MANAGER`, `ACCOUNTANT` | Test tài chính và post đơn |
| `uat_hr` | `HR_MANAGER`, `PAYROLL` | Test nhân sự và bảng lương |
| `uat_ops` | `OPS_MANAGER` | Test điều hành, workflow, operations log |
| `uat_sales` | `SALES` | Test submit đơn hàng |
| `uat_sales_manager` | `SALES_MANAGER` | Test approve/reject/void đơn hàng |
| `uat_product` | `PRODUCT_MANAGER` | Test thao tác dữ liệu sản phẩm |
| `uat_auditor` | `AUDITOR` | Test xem log vận hành và audit phân quyền |

## 3. Nguyên tắc dùng UAT user

- Giữ `is_staff=False` cho toàn bộ user demo để không bypass RBAC.
- Chỉ dùng `superuser` cho cứu hộ hệ thống hoặc bootstrap ban đầu.
- Khi test quyền, luôn đăng nhập bằng `uat_*` thay vì `admin` superuser.

## 4. Smoke check sau bootstrap

```powershell
cd backend
python manage.py smoke_http --backend-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:5173 --username uat_admin --password Demo123!
```

## 5. Kịch bản UAT tối thiểu

- `uat_sales` submit được đơn nhưng không vào được `operations log` và `module permissions`.
- `uat_ops` vào được `operations log`, `workflow`, nhưng không vào `module permission settings`.
- `uat_auditor` xem được `operations log` và `module permissions history`, nhưng không sửa quyền.
- `uat_finance` thao tác được `Tài chính` và `post` đơn hàng.
- `uat_hr` thao tác được `Nhân sự`.
