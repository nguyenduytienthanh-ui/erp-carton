# Chuẩn Chứng từ (Document Standard)

Tài liệu mô tả chuẩn chứng từ áp dụng cho SalesOrder và các loại chứng từ khác (Invoice, PurchaseOrder, …).

## 1. NumberSequence theo doc_type + kỳ (YYYYMM)

- **Model**: `sales.PeriodSequence` — `doc_type`, `period` (YYYYMM), `current_number`, `padding`.
- **Format**: `{doc_type}-{period}-{number}` ví dụ `SO-202602-00015`.
- **Lấy mã mới**: `get_next_code()` trong transaction với `select_for_update()` để tránh trùng.
- **Service**: `get_next_sales_order_code(order_date)` → dùng `order_date.strftime('%Y%m')` làm period.

## 2. Snapshot dữ liệu tham chiếu khi Posted

- **Mục đích**: Master (customer, product, price…) đổi sau không ảnh hưởng chứng từ đã vào sổ.
- **Lưu**: Trường JSON `posted_snapshot` trên header (customer + lines: product code/name, qty, unit_price, line_total, total).
- **Thời điểm**: Ghi trong `post_sales_order()` ngay trước khi set status = POSTED.
- **Service**: `build_posted_snapshot(order)` → dict; gán `order.posted_snapshot = ...` rồi save.

## 3. Money policy

- **File**: `sales/document_policy.py`.
- **Quy tắc**: Làm tròn 2 chữ số (HALF_UP). Thứ tự: **subtotal → discount (theo %) → after_discount → tax (theo %) → line_total**.
- **Hàm**: `calc_line_totals(qty, unit_price, discount_pct, tax_pct)` → (line_subtotal, discount_amount, tax_amount, line_total).
- **Line**: Trong `SalesOrderLine.save()` gọi policy để set `line_subtotal`, `discount_amount`, `tax_amount`, `line_total`. Header có `recalc_totals()` cộng từ lines.

## 4. Post: atomic + idempotent

- **Atomic**: Toàn bộ post trong `transaction.atomic()`; lock row bằng `select_for_update().get(pk=...)`.
- **Idempotent**: Nếu `posted_at` và `post_number` đã có → return `(True, 'Already posted (idempotent).')` không ghi lại.
- **Check**: Đầu hàm và sau lock đều kiểm tra `posted_at`; set `post_number = code` (hoặc rule khác), `posted_at`, `posted_by`, status = POSTED.
- **PostingLog**: Mỗi lần post thật (không idempotent) tạo 1 bản ghi `SalesOrderPostingLog` để audit.

## 5. Permission matrix (action + status)

- **EDIT**: Chỉ khi status = DRAFT.
- **SUBMIT**: Chỉ khi DRAFT; role/action tùy config (e.g. `SalesOrder.submit`).
- **APPROVE / REJECT**: Chỉ khi SUBMITTED; thường role Finance/Manager.
- **POST**: Chỉ khi APPROVED; role Finance (action `SalesOrder.post`).
- **VOID**: Khi APPROVED hoặc POSTED; có thể giới hạn role.
- **Implementation**: `sales.permissions` — `can_edit_sales_order`, `can_post_sales_order`, … gọi `check_action_permission(user, 'SalesOrder', action)` và kiểm tra status.

## 6. Rule bắt buộc attachments/comments theo bước

- **Void**: Bắt buộc `void_reason` (API + admin); có thể mở rộng bắt buộc attachment/comment khi void.
- **Submit/Approve**: Có thể yêu cầu file (chưa implement: có thể thêm config trên WorkflowDefinition hoặc kiểm tra số lượng Attachment trước khi cho transition).

## 7. Performance

- **List API**: `select_related('customer', 'owner', 'team', 'created_by', …)` và `prefetch_related('lines', 'lines__product')`.
- **Index**: Header có index trên `code`, `order_date`, `status`, `team`, `posted_at`, `post_number` (theo migration).

## 8. Void vs Reversal

- **Void**: Đặt status = VOID; ghi `voided_by`, `voided_at`, `void_reason`; ghi AuditLog action VOID với old/new status + reason. Không tạo chứng từ mới.
- **Reversal**: Nếu chứng từ đã tạo tác động (ví dụ đã ghi sổ kho), hỗ trợ tạo chứng từ đảo: model có `reversal_of` FK; logic tạo chứng từ đảo (reversal document) thực hiện riêng khi cần.

## 9. AuditLog

- **POST**: action `POST`, entity_type `SalesOrder`, `old_values` = {status: APPROVED}, `new_values` = {status: POSTED, post_number}.
- **VOID**: action `VOID`, `old_values`/`new_values` có status; ghi thêm reason (trong new_values hoặc field riêng nếu có).
- **SUBMIT**: action `SUBMIT` khi gửi duyệt; tương tự ghi old/new status.

## 10. Tests tối thiểu

- **Money policy**: `calc_line_totals`, `round_money` (số và thứ tự discount/tax).
- **Totals**: Tạo order + lines, gọi `recalc_totals()`, assert subtotal/total.
- **Transition**: `workflow_can_transition('SalesOrder', from, to)` cho vài cặp hợp lệ và không hợp lệ.
- **Cannot edit when posted**: Serializer update với instance status = POSTED → `is_valid()` false hoặc lỗi khi save (validate status = DRAFT).
- **Idempotent post**: Post lần 1 thành công; post lần 2 trả success, không đổi `post_number`/posted_at, message chứa idempotent/Already.

---

## Áp dụng cho chứng từ khác

- Tạo model Header + Lines tương tự (code, doc_type, period, status, approval/posting/void fields, `posted_snapshot`, `version`).
- Thêm `PeriodSequence` cho doc_type mới (e.g. INV, PO).
- Dùng cùng `document_policy` (hoặc mở rộng policy theo loại).
- Service: `get_next_*_code(date)`, `build_posted_snapshot(*)`, `post_*(doc, user, request)` atomic + idempotent.
- Permission theo action + status; ViewSet với select_related/prefetch và filter.
- WorkflowDefinition + transitions; AuditLog POST/VOID/SUBMIT.
- Void bắt buộc lý do; Reversal qua FK `reversal_of` và logic tạo chứng từ đảo khi có tác động.
