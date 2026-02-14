# Kiểm tra: Lọc động (Dynamic filter từ FE) – Bộ dùng chung

## 1. Tổng quan

**Lọc động** = Frontend gửi tham số (search, filter theo cột, sort, page) qua query string → Backend nhận và áp dụng vào queryset → trả về dữ liệu đã lọc/sắp xếp/phân trang.

---

## 2. Backend – Đã có, theo từng entity

### 2.1 Cơ chế chung (Django REST + django-filter)

- **DRF**: `filter_queryset(self.get_queryset())` áp dụng mọi filter backend.
- **DjangoFilterBackend**: Đọc `request.GET` / `request.query_params` và áp dụng `FilterSet`.
- Mỗi ViewSet gắn **một FilterSet** (ví dụ `ProductFilter`, `CustomerFilter`).

### 2.2 Đã triển khai

| Entity   | FilterSet      | File           | Ghi chú |
|----------|----------------|----------------|---------|
| **Product**  | `ProductFilter` | `core/filters.py` | code, name, category, unit, status, wave, box_type, giá (min/max), size PO/SX, waterproof, co_cm, note, ... |
| **Customer** | `CustomerFilter` | `core/filters.py` | q (search), name, company_name, phone, email, created_at range |

- **ProductViewSet** (`products/views.py`): `filterset_class = ProductFilter`, `filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]`. Tìm kiếm thêm qua `search` / `q` (search_text) và ordering.
- **Customer**: ViewSet dùng `CustomerFilter` (trong core/views).

### 2.3 Kết luận backend

- **Lọc động từ FE đã có**: Query params từ FE (code, name, category, ...) được backend áp dụng đầy đủ qua FilterSet.
- **Chưa có “bộ dùng chung” generic**: Mỗi entity có FilterSet riêng (ProductFilter, CustomerFilter). Không có base class hay factory chung; đây là cách làm chuẩn của django-filter (mỗi model khác nhau field/lookup khác nhau).

---

## 3. Frontend – Một phần dùng chung, phần còn lại gắn Products

### 3.1 Đã có và có thể dùng chung

| Thành phần | File | Mô tả |
|------------|------|--------|
| **useSearchFilterIntent** | `hooks/useSearchFilterIntent.ts` | Hook generic: tách **input** (không debounce) và **intent** (debounced) cho search + filter. Type `TFilters` generic, chỉ cần cung cấp `serializeFilters` / `parseFilters`. Mọi màn hình có search/filter nên dùng (theo SEARCH_FILTER_GUIDELINE.md). |
| **urlSearchParamsSync** | `utils/urlSearchParamsSync.ts` | Chuẩn hóa query string theo thứ tự key cố định (tránh nhảy URL khi gõ). Hàm `normalizeSearchParamsToOrderedString`, `normalizeParamsToOrderedString` — không phụ thuộc entity. |
| **CompactFilters** | `components/CompactFilters/CompactFilters.tsx` | UI: ô tìm kiếm + slot `filters` (ReactNode) + nút “Xóa bộ lọc”. Dùng được cho mọi trang danh sách (truyền searchValue, onSearchChange, filters, onReset). |

### 3.2 Chưa dùng chung (gắn chặt Products)

| Thành phần | File | Vấn đề |
|------------|------|--------|
| **ProductsListFilterContext** | `contexts/ProductsListFilterContext.tsx` | Context lưu searchInput, search, activeFilters, filterValues, pagination. **FilterKey** và **FilterValues** là type cố định cho Product (category, unit, status, wave, box_type, code, name, giá, size_*, waterproof, co_cm, note). Không generic. |
| **Parse URL ↔ state** | `ProductList.tsx` | `parseProductListParams(searchParams)` và `productListParamsToSearch(...)` — map URL ↔ FilterValues + pagination + activeFilters. Toàn bộ theo cấu trúc Product (tên param, số field). |
| **Map intent → API params** | `ProductList.tsx` | Đoạn build `params` từ `intentFilters` (code, name, category, ...) gửi lên API — lặp lại từng field của Product. |
| **UI hàng lọc inline + modal lọc** | `ProductList.tsx` | Các ô lọc (Mã hàng, Tên hàng, Danh mục, ...) và modal “Lọc” render theo **activeFilters** và **filterValues** của Product. |

### 3.3 Luồng hiện tại (Products)

1. **State**: ProductsListFilterProvider → searchInput, filterValues, activeFilters, pagination.
2. **Intent**: useSearchFilterIntent(filterValues, serializeFilters, parseFilters) → intentSearch, intentFilters (debounced).
3. **URL**: Đọc URL lần đầu → parseProductListParams → set state + setIntentImmediate. Khi intent/state đổi → productListParamsToSearch → setSearchParams.
4. **API**: useQuery dùng intentSearch + intentFilters để build params (search, code, name, category, ...) → GET /products/products/?...

---

## 4. Kết luận: Đã làm chức năng dùng chung chưa?

| Tầng | Bộ dùng chung? | Chi tiết |
|------|----------------|----------|
| **Backend** | ✅ Theo từng entity (đúng với django-filter) | FilterSet per entity (ProductFilter, CustomerFilter). Không có (và thường không cần) base generic. |
| **Frontend – Hook/Utils** | ✅ Một phần | useSearchFilterIntent (generic), urlSearchParamsSync (generic), CompactFilters (generic UI). |
| **Frontend – Context + URL + API map** | ❌ Chưa | Context, parse URL, build params API đều nằm trong ProductList/ProductsListFilterContext với type và field cố định cho Product. |

**Trả lời ngắn:**  
- **Lọc động từ FE** (FE gửi params → backend lọc) **đã có** và hoạt động cho Products (và Customer ở backend).  
- **Bộ dùng chung** ở frontend **mới chỉ có** ở tầng hook (useSearchFilterIntent), utils (urlSearchParamsSync) và component UI (CompactFilters). Phần **context + đồng bộ URL + map filter → params API** **chưa** tách thành config/chung; đang gắn chặt với Products. Để trang Categories, Units, Customers, … cũng có lọc động giống Products thì hiện tại phải **copy/lặp** logic parse URL, build params và context, hoặc **tách thành bộ dùng chung** (xem đề xuất dưới đây).

---

## 5. Đề xuất: Hướng tới bộ dùng chung (Frontend)

Nếu muốn nhiều màn hình danh sách dùng chung “lọc động” mà không copy toàn bộ ProductList:

1. **Generic context (hoặc hook) cho list filter**
   - Khai báo config: danh sách key URL, cách parse URL → object filter, cách object filter → query string, default filter/pagination.
   - Ví dụ: `useListFilterConfig<T>({ urlKeyOrder, parseSearchParams, toSearchParams, defaultValues })` trả về state + setState + sync với URL (một lần đọc URL, mỗi lần intent đổi thì ghi URL).
   - Mỗi trang (Products, Categories, …) chỉ cần truyền config (và type T cho filter).

2. **Map filter → API params**
   - Tách hàm thuần: `filterValuesToApiParams(filterValues, options?)` nhận object filter + (tùy chọn) tên param khác nhau per backend. Mỗi trang gọi với filter type của mình. Có thể đặt trong từng api/*.ts (products, categories, …) hoặc một `listFilterToParams.ts` nhận config.

3. **UI lọc (inline + modal)**
   - Giữ CompactFilters làm slot chung. Phần “hàng lọc inline” và “modal lọc” có thể:
     - Hoặc tiếp tục render theo config (danh sách field + label + type: text, number, select, range) do từng trang truyền vào (generic FilterPanel nhận config),
     - Hoặc mỗi trang tự render như hiện tại ProductList, nhưng state + URL + API đã dùng chung ở bước 1–2.

4. **Guideline**
   - Cập nhật SEARCH_FILTER_GUIDELINE.md (hoặc doc tương tự): “Màn hình danh sách có lọc: dùng useSearchFilterIntent + [useListFilterConfig nếu đã có] + CompactFilters; map filter → params theo config của entity.”

---

*Tài liệu kiểm tra: Lọc động (Dynamic filter từ FE) và mức độ bộ dùng chung – cập nhật sau khi rà soát code.*
