# Báo cáo kiểm tra hệ thống – Còn thiếu / Chưa xong

*Cập nhật: 2025-03-13*

## 1. Đã xử lý trong phiên này

- **Yêu cầu mua (Purchase Request)**
  - Sửa URL API: frontend gọi đúng `submit/`, `approve/`, `reject/` (trước gọi nhầm `submit_request/`, …).
  - Sửa URL danh sách: `getRequests` dùng `/purchasing/requests/?params` (có trailing slash).
  - Trang **PurchaseRequestList** chuyển sang dùng `purchasingApi` (axios + JWT) thay cho `purchaseRequestApi` (fetch không gửi token) để tránh 401.

- **Khuyến nghị đã triển khai (phiên tiếp theo):**
  - **Route + menu:** Thêm route và mục menu cho **Dự báo đơn mua** (`/purchase-order-forecast`) và **Phân tích nhà cung cấp** (`/supplier-analytics`) trong nhóm Mua hàng.
  - **Sổ quỹ:** Trang **CashBook** dùng API thật: `financeApi.getCashTransactions` + `financeApi.getCashFlowSummary` (lọc theo khoảng ngày, bảng giao dịch + thẻ tổng thu/chi/chênh lệch).
  - **Báo cáo tài chính:** **FinanceSummary** gọi `financeApi.getCashFlowSummary` theo khoảng ngày và hiển thị tổng thu, tổng chi, chênh lệch, số giao dịch.
  - **Quote Analytics:** **QuoteAnalytics** dùng `salesApi.getQuotes` theo khoảng ngày, tính tổng báo giá, số chuyển đổi (ACCEPTED), tỷ lệ chuyển đổi, từ chối/hết hạn; bảng “chuyển đổi” = các báo giá đã chấp nhận.
  - **Reports Center:** Gọi `reportsApi.getCustomReports()` (GET `/api/reports/custom/`), hiển thị bảng báo cáo tùy chỉnh; thêm card **Báo cáo nhanh** với link tới Báo cáo tài chính, Sổ quỹ, Công nợ phải thu/trả, Phân tích quá hạn.
  - **Backend Phase 5:** Đăng ký vào `core/urls.py`: `purchasing/forecast`, `purchasing/supplier-analytics`, `inventory/forecast`, `reports/custom` (import từ `phase5_viewsets`, bọc trong try/except để không lỗi khi thiếu file).
  - **Dự báo đơn mua & Phân tích NCC:** Trang **PurchaseOrderForecast** và **SupplierPerformanceAnalytics** nối API Phase 5 (`purchasingApi.getPurchaseOrderForecast`, `purchasingApi.getSupplierAnalytics`).

- **Khuyến nghị đã triển khai thêm:**
  - **Đối soát ngân hàng:** Bổ sung backend thật cho `finance/bank-reconciliations` gồm model, serializer, viewset, route và migration. Frontend `BankReconciliationList` có thể CRUD/approve/post với API thật.
  - **Báo giá:** Chuẩn hóa `QuoteListNew` sang contract backend thật: dùng `salesApi`, status `DRAFT/SENT/ACCEPTED/REJECTED/EXPIRED`, action `send/accept/reject/convert_to_order`, field `valid_until`.
  - **Lệnh sản xuất:** Chuẩn hóa `ProductionOrderList` sang workflow backend thật: `submit -> approve -> release -> issue_materials -> receive_output -> cancel`.
  - **AR/AP frontend:** Adapter API `accountsReceivableApi` và `accountsPayableApi` map dữ liệu/status backend hiện tại (`OPEN/PARTIAL/SETTLED/CANCELLED`) sang shape cũ của UI để 2 màn công nợ chạy với backend thật.
  - **Purchase Return -> AP:** Khi `post_return`, hệ thống tự động phân bổ giảm `PayableDocument` liên quan cùng đơn mua, không giảm xuống dưới số đã thanh toán; nếu không đủ công nợ khả dụng sẽ chặn post để bảo toàn số liệu.
  - **Warehouse Transfer -> Inventory:** `post_transfer` sinh chứng từ xuất kho nguồn, `receive_transfer` sinh chứng từ nhập kho đích, `cancel_transfer` hoàn nhập kho nguồn nếu hủy lúc đang vận chuyển.
  - **Phase 5 APIs:** `PurchaseOrderForecastViewSet`, `SupplierPerformanceViewSet`, `InventoryForecastViewSet`, `CustomReportViewSet` đã chuyển từ dữ liệu hardcode sang dữ liệu derive từ Sales/Purchasing/Inventory/Audit thực tế của hệ thống.

---

## 2. Trang frontend đang dùng mock data (chưa gọi API thật)

| Trang | File | Ghi chú |
|-------|------|--------|
| Phân tích nhà cung cấp | `Purchasing/SupplierPerformanceAnalytics.tsx` | Mock table + CSV |
| Dự báo đơn mua | `Purchasing/PurchaseOrderForecast.tsx` | Mock table |
| Dự báo tồn kho | `Inventory/InventoryForecast.tsx` | Mock |
| BI Dashboard | `Management/BIDashboard.tsx` | Mock KPIs |
| Cổng khách hàng | `Sales/CustomerPortal.tsx` | Mock customer |
| Quản lý chiết khấu | `Sales/DiscountManagement.tsx` | Mock data + count |
| Phân tích bán hàng | `Sales/SalesAnalyticsDashboard.tsx` | Mock – replace with API |
| Quote Analytics | `Management/QuoteAnalytics.tsx` | Mock – replace with API |
| Trung tâm báo cáo | `Management/ReportsCenter.tsx` | Mock results + count |
| Báo cáo tài chính | `Finance/FinanceSummary.tsx` | Mock – replace with API |
| Sổ quỹ (danh sách) | `Finance/CashBookList.tsx` | Mock – replace with API |

**Khuyến nghị:** Lần lượt thay mock bằng API (backend có sẵn hoặc bổ sung endpoint) cho từng trang theo ưu tiên nghiệp vụ.

---

## 3. Trang có file nhưng chưa có route / menu

| Trang | File | Route hiện tại | Menu |
|-------|------|----------------|-------|
| Dự báo đơn mua | `Purchasing/PurchaseOrderForecast.tsx` | Không | Không |
| Phân tích nhà cung cấp | `Purchasing/SupplierPerformanceAnalytics.tsx` | Không | Không |

**Khuyến nghị:** Nếu cần dùng ngay: thêm route trong `AppRouter.tsx` (ví dụ `/purchase-order-forecast`, `/supplier-analytics`) và thêm mục tương ứng trong `MainLayout.tsx` (menu Mua hàng hoặc nhóm phù hợp).

---

## 4. Backend – API chưa đăng ký (Phase 5)

Các ViewSet trong `backend/phase5_viewsets.py` (forecast, supplier-analytics, budgets, inventory/forecast, …) **chưa** được đăng ký trong `backend/core/urls.py`.

**Khuyến nghị:** Khi frontend chuyển từ mock sang API thật cho từng tính năng Phase 5, cần:
- Import ViewSet tương ứng vào `core/urls.py`,
- `router.register(...)` với prefix phù hợp (ví dụ `inventory/forecast`, `purchasing/supplier-analytics`).

---

## 5. Trùng / phân tách trang Sổ quỹ

- Route hiện tại: `/cash-book` → component **CashBook**.
- Tồn tại thêm **CashBookList.tsx** (đang mock).

**Khuyến nghị:** Thống nhất một trang (ví dụ dùng CashBook và gọi API sổ quỹ thật), hoặc dùng CashBookList làm trang chính và cập nhật route; xóa hoặc đánh dấu deprecated trang còn lại để tránh nhầm lẫn.

---

## 6. Tóm tắt ưu tiên

1. **Đã xong:** Purchase Request – API URL + auth (purchasingApi).
2. **Ưu tiên cao:** Các trang Phase 4/5 đang mock: Reports Center, Finance Summary, Cash Book (Sổ quỹ), Quote Analytics – nối API và bỏ mock.
3. **Tiếp theo:** Thêm route + menu cho Purchase Order Forecast và Supplier Performance Analytics (và nối API khi backend sẵn sàng).
4. **Backend:** Đăng ký từng API Phase 5 vào `core/urls.py` khi frontend cần.

Nếu cần, có thể tách tiếp từng mục thành task trong backlog (ví dụ từng trang mock → API, từng endpoint Phase 5 → đăng ký route).
