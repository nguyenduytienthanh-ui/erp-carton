# Hướng dẫn dùng chung: Icon Xóa nhanh (QuickClearIcon)

## Quy định (BẮT BUỘC)

**Trong toàn bộ phần mềm:**
- **KHÔNG** dùng `allowClear` của Ant Design.
- Mọi ô input / search / filter đều dùng component **QuickClearIcon**.
- QuickClearIcon là **chuẩn UI dùng chung** để xóa nhanh.
- Làm giống cách ô tìm kiếm Sản phẩm đã được chuẩn hóa.

Chỉ cần import và dùng theo mẫu dưới.

---

## Import

```tsx
import { QuickClearIcon } from '../../components';
// hoặc từ components tương ứng với đường dẫn của bạn
```

---

## Cách dùng

### 1. Ô số (InputNumber)

Icon hiện **bên trong ô** khi có giá trị. Cần:

- Bọc trong `div` có class `input-number-with-clear-wrapper` (và set `width` nếu cần).
- `InputNumber`: thêm `controls={false}`, `className="input-number-with-clear"`, và `suffix` có điều kiện.

```tsx
<div className="input-number-with-clear-wrapper" style={{ width: 120 }}>
  <InputNumber
    placeholder="Dài PO (mm)"
    style={{ width: '100%' }}
    controls={false}
    value={filterValues.size_po_dai ?? undefined}
    onChange={(v) => setFilterValues((prev) => ({ ...prev, size_po_dai: v ?? null }))}
    min={0}
    className="input-number-with-clear"
    suffix={
      filterValues.size_po_dai != null ? (
        <QuickClearIcon onClear={() => setFilterValues((prev) => ({ ...prev, size_po_dai: null }))} />
      ) : undefined
    }
  />
</div>
```

**Lưu ý:** CSS cho `.input-number-with-clear` (padding-right cho icon) nằm trong `frontend/src/styles/global.css`. Nếu dùng ở app khác, cần copy đoạn CSS đó.

---

### 2. Ô text (Input)

Dùng prop `suffix` của Ant Design Input. Chỉ hiện icon khi ô có nội dung:

```tsx
<Input
  placeholder="Ghi chú chung chứa..."
  value={filterValues.note ?? ''}
  onChange={(e) => setFilterValues((prev) => ({ ...prev, note: e.target.value.trim() || null }))}
  suffix={
    (filterValues.note?.trim() ?? '') ? (
      <QuickClearIcon onClear={() => setFilterValues((prev) => ({ ...prev, note: null }))} title="Xóa nhanh" />
    ) : undefined
  }
/>
```

---

### 3. Ô Giá vốn / Đơn giá (hai ô Từ – Đến)

Mỗi ô (Từ và Đến) dùng một lần QuickClearIcon trong `suffix`:

```tsx
<Space size={8}>
  <div className="input-number-with-clear-wrapper" style={{ width: 100 }}>
    <InputNumber
      placeholder="Từ"
      style={{ width: '100%' }}
      min={0}
      controls={false}
      value={filterValues.min_cost_price ?? undefined}
      onChange={(v) => setFilterValues((prev) => ({ ...prev, min_cost_price: v ?? null }))}
      className="input-number-with-clear"
      suffix={
        filterValues.min_cost_price != null ? (
          <QuickClearIcon onClear={() => setFilterValues((prev) => ({ ...prev, min_cost_price: null }))} />
        ) : undefined
      }
    />
  </div>
  <span>–</span>
  <div className="input-number-with-clear-wrapper" style={{ width: 100 }}>
    <InputNumber
      placeholder="Đến"
      ...
      suffix={filterValues.max_cost_price != null ? <QuickClearIcon onClear={...} /> : undefined}
    />
  </div>
</Space>
```

---

### 4. Đặt cạnh ô (không dùng suffix)

Khi không gắn vào `suffix` của Input/InputNumber, có thể render icon bên cạnh và chỉ hiện khi có giá trị:

```tsx
{searchText && (
  <QuickClearIcon onClear={() => setSearchText('')} title="Xóa tìm kiếm" />
)}
```

---

## Props của QuickClearIcon

| Prop      | Kiểu       | Bắt buộc | Mô tả |
|----------|------------|----------|--------|
| `onClear`| `() => void` | Có     | Hàm gọi khi bấm xóa. |
| `title`  | `string`   | Không   | Tooltip (mặc định: "Xóa nhanh"). |
| `className` | `string` | Không | Class thêm (mặc định đã dùng style giống ô Tìm kiếm). |
| `style`  | `CSSProperties` | Không | Style bổ sung. |

---

## Vị trí file

- **Component:** `frontend/src/components/QuickClearIcon/QuickClearIcon.tsx`
- **Export:** `frontend/src/components/index.ts` (export `QuickClearIcon`)
- **CSS liên quan:** `frontend/src/styles/global.css` (`.input-number-with-clear`, `.input-number-with-clear-wrapper`, `.quick-clear-icon`)

---

## Tích hợp đã hoàn tất (mọi ô input/search/filter)

| Trang / component | Ô dùng QuickClearIcon |
|-------------------|------------------------|
| **ProductList** | Ô tìm kiếm (suffix); Mã/Tên (suffix); Danh mục, Đơn vị, Trạng thái, Sóng, Kiểu (icon cạnh Select); Giá vốn/Đơn giá/Dài-Rộng-Cao (FilterNumberInput + Ghi chú FilterTextInput có clear); C. thấm, Có CM (icon cạnh Select); Ghi chú (FilterTextInput showClear); Số dòng/trang (icon cạnh). |
| **ProductForm** | Tên (suffix); Giá vốn, Đơn giá, Tồn tối thiểu (cạnh InputNumber); Mô tả, Size PO/SX, Dung sai (suffix/cạnh); toàn bộ Select (SelectWithQuickClear); HH đơn vị/%, Xả/In/Bồi/… (cạnh InputNumber); Mã phim, Mã khuôn (suffix); Số màu (cạnh); Chống thấm (SelectWithQuickClear); Con lắp: Tên, SL, Thứ tự, Ghi chú (suffix/cạnh); Ghi chú công đoạn, Ghi chú chung (cạnh TextArea). |
| **Login** | Tên đăng nhập, Mật khẩu (suffix). |
| **CompactFilters** | Ô tìm kiếm (suffix). |

**Không có `allowClear`** ở bất kỳ file nào. Khi thêm ô input/search/filter mới, dùng **QuickClearIcon** theo các mẫu trên. **Không dùng `allowClear` của Ant Design.**
