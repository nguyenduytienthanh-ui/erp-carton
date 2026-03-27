# Quy tắc theo module

## Mục tiêu

Tài liệu này phân biệt rõ phần nào của từng module nên quay về bộ chuẩn dùng chung, và phần nào nên giữ quyền làm riêng vì khác biệt nghiệp vụ là thật.

## Sales

### Nên quay về dùng chung

- Danh sách, tìm kiếm, lọc, xóa nhanh, cài đặt cột, lưu tùy chọn người dùng
- Chuẩn chứng từ, mã chứng từ, audit, phân quyền, trạng thái nền
- Empty state, loading state, thông báo, command palette, workspace shell

### Nên làm riêng

- Xác nhận đơn hàng, shipment, giao hàng, customer portal
- Snapshot giá và dữ liệu khách hàng tại thời điểm quan trọng
- Các quyết định liên quan giá bán, chiết khấu, doanh số, material plan, fulfillment

## Purchasing

### Nên quay về dùng chung

- Danh sách nghiệp vụ chuẩn
- Search/filter, bulk action, delete pattern, export pattern
- Chuẩn chứng từ và quyền theo trạng thái

### Nên làm riêng

- PR, PO, Receipt, Return và các điều kiện chuyển trạng thái riêng
- Quy tắc nhận hàng, số lượng đã nhận, phân bổ, đóng gói nhận hàng
- Supplier performance analytics và các màn phân tích riêng

## Inventory

### Nên quay về dùng chung

- Search/filter, list layout, xóa nhanh, trạng thái màn hình, export
- Chuẩn audit, quyền thao tác, đánh số chứng từ nếu có

### Nên làm riêng

- Stock transaction semantics, reservation, shipment sequencing
- Scan center, scan-origin flow, cảnh báo và xử lý tại hiện trường
- Stock overview, stocktake, luồng kho nhiều bước hoặc theo ngữ cảnh thực tế

## Production

### Nên quay về dùng chung

- Danh sách chuẩn, bộ lọc chuẩn, quick entry, empty/loading/error state
- Chuẩn chứng từ, audit và quyền thao tác nền

### Nên làm riêng

- BOM, định mức, material issue, production receipt
- Routing, sequencing, dispatch owner, block reason, planning board
- Các màn detail content, planning board hoặc workspace điều phối sản xuất

## Finance

### Nên quay về dùng chung

- List/search/filter, export, cài đặt cột, trạng thái màn hình
- Quy tắc nền về làm tròn, audit, quyền, khóa sau ghi sổ

### Nên làm riêng

- Cash book, bank reconciliation, AR/AP, general ledger, trial balance
- Logic đối soát, bút toán, delta, aging, budget và báo cáo tài chính

## Admin, Workflow, Tasks

### Nên quay về dùng chung

- Command palette, quick launcher, page header, workspace shell
- Empty state, loading state, toast, quick clear, search/filter
- User preferences và các pattern điều hướng dùng chung

### Nên làm riêng

- Phân quyền, onboarding, offboarding, access review, approval tower
- AI work brief, task workspace, workflow board, governance center
- Mọi logic liên quan vòng đời user, exception, audit nghiệp vụ quản trị

## Workforce và Management

### Nên quay về dùng chung

- Danh sách, lọc, nhập nhanh, xóa nhanh, lưu cột và filter
- Command palette, loading/empty/error, export pattern

### Nên làm riêng

- Payroll, attendance, bonus/penalty
- KPI, báo cáo điều hành, cockpit, BI dashboard, performance report

## Nguyên tắc quyết định cho mọi module

- Nếu chỉ khác tên field, label hoặc tập filter: quay về bộ dùng chung.
- Nếu khác quy tắc trạng thái, công thức, hậu quả dữ liệu hoặc trách nhiệm phê duyệt: làm riêng.
- Nếu là màn điều hành chuyên sâu, planning board, scan flow hoặc cockpit: cho phép làm riêng về bố cục nhưng vẫn giữ chung các hành vi nền như tìm kiếm, xóa nhanh, trạng thái màn hình và thông báo.

## Không nên

- Không biến mỗi module thành một "thế giới riêng" về search, filter, toast, loading và xóa nhanh.
- Không ép mọi màn nâng cao phải giống hệt danh sách chuẩn nếu điều đó làm giảm hiệu quả thao tác thực tế.
- Không lấy dashboard hoặc command center đặc thù rồi suy ngược thành chuẩn chung cho toàn hệ thống.
