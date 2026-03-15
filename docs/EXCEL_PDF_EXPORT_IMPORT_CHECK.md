# Kiểm tra Nhập Excel, Xuất Excel, Xuất PDF – Bộ dùng chung

## 1. Tổng quan

| Chức năng        | Backend dùng chung              | Sản phẩm (Products)                    | Khách hàng (Customers)     |
|------------------|---------------------------------|----------------------------------------|----------------------------|
| **Xuất Excel**   | Có: `core.utils.export_to_excel`, `core.mixins.ExportExcelMixin` | Có nhưng **trùng logic**: view riêng `_export_products_excel_logic` + ViewSet dùng Mixin | Có: `export_to_excel` + ExportTemplate |
| **Xuất PDF**     | Có: `core.utils.export_to_pdf`  | **Chưa**: API frontend gửi `format=pdf` nhưng backend chỉ xử lý excel | Có: `export_pdf` + ExportTemplate |
| **Nhập Excel**   | Có: `core.utils.import_from_excel` | Có: `ProductViewSet.import_excel` (logic riêng, không dùng utils) | Có: `import_excel` + field_mapping |

---

## 2. Backend – Bộ dùng chung đã có

### 2.1 `core/utils.py`

- **`export_to_excel(queryset, fields, headers, filename)`**  
  - Dùng cho bất kỳ queryset nào.  
  - `fields`: tên field (hoặc `__path` như `customer__name`).  
  - `headers`: tiêu đề cột hiển thị.  
  - Đang dùng: Customer (export, admin), Product (admin export).

- **`export_to_pdf(queryset, fields, headers, filename, title)`**  
  - ReportLab, landscape A4.  
  - Đang dùng: Customer (export_pdf, admin).

- **`import_from_excel(file, model_class, field_mapping, user=None)`**  
  - Đọc sheet đầu, map cột Excel → field model, tạo ImportLog.  
  - Đang dùng: Customer (import_excel).  
  - Product không dùng (mapping phức tạp: category/unit/wave/box_type theo code).

### 2.2 `core/mixins.py` – `ExportExcelMixin`

- ViewSet chỉ cần override:
  - `get_export_sheet_title()`
  - `get_export_filename()`
  - `get_export_headers()`
  - `get_export_row(obj)`
- Action: `GET .../export_data/?format=excel` → trả về file Excel.
- **ProductViewSet** đã kế thừa và implement đủ (sheet, filename, headers, row).

---

## 3. Vấn đề hiện tại

### 3.1 Sản phẩm – Xuất Excel

- **Hai nơi** cùng định nghĩa cách xuất Excel:
  1. **ProductViewSet + ExportExcelMixin** → action `export_data` (DRF, URL dạng `/api/.../export_data/`).
  2. **core/views._export_products_excel_logic** → view GET `/export-excel/` (root, dùng cho frontend vì CORS/blob download).

- Hệ quả: trùng headers/row logic; sửa một chỗ dễ quên chỗ kia.  
- **Bug đã sửa**: Trong `_export_products_excel_logic` từng dùng `product.wave_type`, `product.box_type` (không tồn tại); model có `product.wave` (FK) và `product.box_type` (FK) → cần `product.wave.code`, `product.box_type.code`.

### 3.2 Sản phẩm – Xuất PDF

- Frontend: `productsApi.exportProducts('pdf', params)` (trong `api/products.ts`), nút "Xuất PDF" trên ProductList.
- Backend: `GET /api/products/products/export_data/?format=pdf` (ExportExcelMixin.export_data) dùng `core.utils.export_to_pdf` với `get_export_pdf_fields()` và `get_export_headers()` của ProductViewSet.
- Kết luận: **Xuất PDF sản phẩm đã có** (ProductViewSet kế thừa ExportExcelMixin, có `get_export_pdf_fields()`).

### 3.3 Sản phẩm – Nhập Excel

- Đã có: template (`download_import_template`), import (`import_excel`) với validation và báo lỗi từng dòng.
- Logic đặc thù (category/unit/wave/box_type theo code, NumberSequence) nên không dùng `import_from_excel`; giữ logic riêng là hợp lý.

---

## 4. Frontend – Bộ dùng chung

### 4.1 Đã dùng chung

- **`ImportModal`** (`components/ImportModal/ImportModal.tsx`):
  - Props: `visible`, `onClose`, `onSuccess`, `onDownloadTemplate`, `onImport`, `entityName`.
  - Dùng được cho bất kỳ entity nào (Products đang dùng; sau này Customers, … chỉ cần truyền API tương ứng).

### 4.2 Chưa tách thành layer chung

- **Export/Import API** đang nằm trong `api/products.ts`:
  - `exportProducts(format, params)`, `downloadTemplate()`, `importProducts(file)`.
- **Gợi ý**: Khi thêm export/import cho entity khác (vd. Customers), có thể:
  - Tạo `api/exportImport.ts` với hàm generic: `exportData(url, format, params)`, `downloadTemplate(url)`, `importData(url, file)`; hoặc
  - Hook `useExportImport({ exportUrl, templateUrl, importUrl, entityName })` trả về `{ handleExport, handleDownloadTemplate, handleImport }` để nhiều trang dùng chung.

---

## 5. Đề xuất chuẩn hóa (bộ dùng chung)

### 5.1 Backend

1. **Xuất Excel sản phẩm**  
   - Cách 1 (khuyến nghị): View `/export-excel/` không duplicate logic; gọi **ProductViewSet** (hoặc service dùng chung) lấy queryset + headers + rows (cùng nguồn với `ExportExcelMixin`) rồi tạo Workbook/HttpResponse.  
   - Cách 2: Giữ `_export_products_excel_logic` nhưng lấy headers/row từ ProductViewSet (helper hoặc mixin) để chỉ có một nơi định nghĩa cấu trúc Excel.

2. **Xuất PDF sản phẩm**  
   - Đã có: `GET /api/products/products/export_data/?format=pdf` (ExportExcelMixin), dùng `core.utils.export_to_pdf` với `get_export_pdf_fields()` và `get_export_headers()` của ProductViewSet.

3. **Import**  
   - Giữ Product import riêng (logic theo code); entity đơn giản (vd. Customer) tiếp tục dùng `import_from_excel` + field_mapping.

### 5.2 Frontend

1. Giữ **ImportModal** làm component chung; mỗi trang truyền `onDownloadTemplate`, `onImport`, `entityName`.
2. (Tùy chọn) Tách API/hook export-import chung khi có thêm entity (Customers, …) để tránh lặp code.

---

## 6. Checklist nhanh

| Hạng mục                 | Trạng thái | Ghi chú |
|--------------------------|------------|--------|
| core/utils export_to_excel | Có, dùng chung | Customer, admin |
| core/utils export_to_pdf   | Có, dùng chung | Customer |
| core/utils import_from_excel | Có, dùng chung | Customer |
| ExportExcelMixin           | Có, dùng chung | ProductViewSet có, nhưng export thật qua view khác |
| ImportModal (UI)           | Có, dùng chung | Products đang dùng |
| Sản phẩm – Xuất Excel      | Có, trùng logic | Chuẩn hóa 1 nguồn (ViewSet hoặc view) |
| Sản phẩm – Xuất PDF        | Có | ProductViewSet.export_data (format=pdf) + core.utils.export_to_pdf, nút "Xuất PDF" trên ProductList |
| Sản phẩm – Nhập Excel      | Có | Giữ logic riêng, không dùng import_from_excel |
| Bug wave/box_type trong export | Đã sửa | Dùng wave.code, box_type.code |

---

*Tài liệu kiểm tra: Nhập Excel, Xuất Excel, Xuất PDF và bộ dùng chung – cập nhật sau khi rà soát code.*
