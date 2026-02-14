# Hook dùng chung: useDebouncedValue

Dùng khi cần **gõ xong một lát (vd 650ms) mới gọi API / cập nhật danh sách** — tránh gõ 1 ký tự đã tìm/lọc.

- **File:** `frontend/src/hooks/useDebouncedValue.ts`
- **Dùng cho:** ô Tìm kiếm, ô Lọc (Dài/Rộng/Cao, Giá vốn, Đơn giá...), hoặc bất kỳ input nào tương tự.

## Cách dùng

```ts
const [debouncedValue, setDebouncedImmediate] = useDebouncedValue(value, delayMs);
```

- **value** — giá trị nguồn (cập nhật ngay khi user gõ), bind vào `value` của Input.
- **delayMs** — số ms không đổi thì mới cập nhật (vd: 650).
- **debouncedValue** — dùng cho API, queryKey, URL, export.
- **setDebouncedImmediate(v)** — gán ngay không qua debounce (vd: khi áp params từ URL).

## Ví dụ: Tìm kiếm

```ts
const [searchInput, setSearchInput] = useState('');
const [debouncedSearch, setDebouncedSearchImmediate] = useDebouncedValue(searchInput, 650);

// Input: value={searchInput} onChange={e => setSearchInput(e.target.value)}
// API / URL: dùng debouncedSearch
// Khi load từ URL: setDebouncedSearchImmediate(parsed.search);
```

## Ví dụ: Bộ lọc (object)

```ts
const [filterValues, setFilterValues] = useState(initialFilters);
const [debouncedFilterValues, setDebouncedFiltersImmediate] = useDebouncedValue(filterValues, 650);

// Các ô lọc: value={filterValues.xxx} onChange => setFilterValues(...)
// API / queryKey / export: dùng debouncedFilterValues
// Khi load từ URL: setDebouncedFiltersImmediate({ ...parsed.filterValues });
```

## Trang đã tích hợp

- **ProductList:**  
  - **Tìm kiếm:** `debouncedSearch` từ `useDebouncedValue(searchInput, 650)`.  
  - **Các ô lọc (đã tích hợp chung):** Mã, Tên, Danh mục, Đơn vị, Trạng thái, Sóng, Loại thùng, Giá vốn (từ–đến), Đơn giá (từ–đến), Dài/Rộng/Cao PO, Dài/Rộng/Cao SX, C. thấm, Có CM, Ghi chú — tất cả bind `filterValues` (hiển thị ngay), API/query/URL/export dùng `debouncedFilterValues` từ `useDebouncedValue(filterValues, 650)`.

Các danh mục khác (Khách hàng, Đơn hàng, …) chỉ cần import hook và dùng tương tự, không cần viết lại logic debounce.
