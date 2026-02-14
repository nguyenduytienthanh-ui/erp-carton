# Cài đặt cột (thêm/ẩn cột) — dùng chung

Một cách làm duy nhất cho "Cài đặt cột" trên toàn hệ thống. Mọi màn danh sách (Sản phẩm, Khách hàng, Đơn hàng, …) dùng cùng component và hook.

## Thành phần

1. **Hook:** `useColumnSettings(pageKey, options)`  
   - Trả về: `visibleColumns`, `sizeDisplayMode` (nếu dùng), `handleVisibleColumnsChange`, `handleSizeDisplayModeChange`.  
   - Đọc/ghi config qua `useUserPreferences(pageKey)`.

2. **Component:** `ColumnChooser` / `ColumnSettings` (cùng một component)  
   - Nút "Cột" + modal "Hiển thị cột" (checkbox từng cột, đổi màu/viền khi có cột ẩn).  
   - Tùy chọn: "Hiển thị kích thước" (3 cột riêng vs 1 cột gộp) nếu truyền `sizeDisplayMode` + `onSizeDisplayModeChange`.

## Cách dùng (màn danh sách)

1. Gọi hook với `pageKey` và `defaultVisibleColumns` (và nếu cần `sizeColumns`):

```tsx
const {
  visibleColumns,
  sizeDisplayMode,
  handleVisibleColumnsChange,
  handleSizeDisplayModeChange,
} = useColumnSettings('products-list', {
  defaultVisibleColumns: ['code', 'name', ...],
  sizeColumns: {
    separated: ['size_po_dai', 'size_po_rong', ...],
    merged: ['size_po_merged', 'size_sx_merged'],
  },
});
```

2. Từ danh sách cột định nghĩa bảng, lấy danh sách cho modal (key, title, required):

```tsx
const columnChooserList = allowedColumnDefs
  .filter((col) => col.key !== 'actions')
  .map((col) => ({
    key: col.key,
    title: columnKeyToTitle[col.key] ?? col.key,
    required: col.key === 'code' || col.key === 'name',
  }));
```

3. Lọc cột hiển thị trên bảng:

```tsx
const displayColumns = allowedColumnDefs.filter((col) => {
  if (col.key === 'actions') return true;
  return visibleColumns.includes(col.key);
});
```

4. Render component:

```tsx
<ColumnChooser
  columns={columnChooserList}
  visibleColumns={visibleColumns}
  onChange={handleVisibleColumnsChange}
  sizeDisplayMode={sizeDisplayMode}
  onSizeDisplayModeChange={handleSizeDisplayModeChange}
/>
```

Nếu màn hình không có "Hiển thị kích thước", bỏ `sizeDisplayMode` và `onSizeDisplayModeChange`; không truyền `sizeColumns` vào hook.

## File tham chiếu

- Hook: `frontend/src/hooks/useColumnSettings.ts`
- Component: `frontend/src/components/ColumnChooser/ColumnChooser.tsx`
- Mẫu: `frontend/src/pages/Products/ProductList.tsx`
