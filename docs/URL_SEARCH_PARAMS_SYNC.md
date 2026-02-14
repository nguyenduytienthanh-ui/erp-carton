# Đồng bộ URL ↔ state (Tìm kiếm / Lọc) — tránh nhảy chữ khi gõ nhanh

Khi trang danh sách đồng bộ ô **Tìm kiếm** và **Bộ lọc** với URL (để bookmark, chia sẻ link), nếu mỗi lần state đổi đều ghi URL rồi đọc lại URL vào state thì sẽ bị **ghi đè** ô đang gõ → nhảy chữ / nhảy màn hình. Cách xử lý: **chuẩn hóa chuỗi URL** theo cùng một thứ tự key và chỉ **áp dụng URL lên state** khi chuỗi URL khác chuỗi “vừa do mình ghi”.

## Code dùng chung

- **File:** `frontend/src/utils/urlSearchParamsSync.ts`
- **Hàm:**
  - `normalizeSearchParamsToOrderedString(searchParams, orderedKeys)` — từ `URLSearchParams` tạo chuỗi query theo đúng thứ tự `orderedKeys`.
  - `normalizeParamsToOrderedString(params, orderedKeys)` — từ object `params` tạo chuỗi query theo đúng thứ tự `orderedKeys`.

## Cách dùng (ví dụ: ProductList)

1. **Định nghĩa danh sách key cố định** (đủ mọi param của trang, thứ tự nhất quán):

```ts
const ORDERED_URL_KEYS = [
  'q', 'code', 'name', 'category', 'unit', 'status', 'wave', 'box_type',
  'min_cost_price', 'max_cost_price', 'min_sale_price', 'max_sale_price',
  'size_po_dai', 'size_po_rong', 'size_po_cao', 'size_sx_dai', 'size_sx_rong', 'size_sx_cao',
  'waterproof', 'co_cm', 'note',
  'activeFilters', 'page', 'pageSize', 'exact_search',
];
```

2. **Đọc URL → state (useLayoutEffect):**

- Build chuỗi hiện tại: `currentUrlStr = normalizeSearchParamsToOrderedString(searchParams, ORDERED_URL_KEYS)`.
- Nếu `currentUrlStr === lastWrittenParams.current` → **return** (không áp URL lên state).
- Nếu có params từ URL: parse URL → set state → ghi lại `lastWrittenParams.current = normalizeParamsToOrderedString(writtenParams, ORDERED_URL_KEYS)` (dùng cùng `ORDERED_URL_KEYS`).

3. **Ghi state → URL (useEffect):**

- `params = yourSerializeStateToParams(...)`.
- `str = normalizeParamsToOrderedString(params, ORDERED_URL_KEYS)`.
- Nếu `str === lastWrittenParams.current` → return.
- **Nên debounce** (300–400ms) việc ghi URL: chỉ ghi sau khi user ngừng gõ để tránh nhảy chữ. Lần đầu (mount) ghi ngay; các lần sau debounce.
- `lastWrittenParams.current = str` rồi `setSearchParams(...)`. Khi xóa param cũ dùng cùng `ORDERED_URL_KEYS`.

**Quan trọng:** Cả “đọc URL” và “ghi URL” phải dùng **cùng một `ORDERED_URL_KEYS`** và cùng hai hàm chuẩn hóa thì so sánh mới trùng và không ghi đè khi user đang gõ.

## Các danh mục khác

Trang danh sách khác (Khách hàng, Đơn hàng, …) chỉ cần:

1. Import `normalizeSearchParamsToOrderedString`, `normalizeParamsToOrderedString` từ `utils/urlSearchParamsSync`.
2. Định nghĩa `ORDERED_URL_KEYS` của trang (đủ và đúng thứ tự).
3. Trong useLayoutEffect đọc URL: so sánh chuỗi chuẩn hóa với `lastWrittenParams.current`, chỉ áp URL khi khác.
4. Trong useEffect ghi URL: tạo `str` bằng `normalizeParamsToOrderedString(params, ORDERED_URL_KEYS)` rồi so sánh/ghi như trên.

Không cần viết lại logic chuẩn hóa — dùng chung hai hàm và pattern này.
