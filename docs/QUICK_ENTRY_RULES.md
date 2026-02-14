# Bộ quy tắc nhập nhanh (Quick Entry Rules)

**Áp dụng BẮT BUỘC cho TẤT CẢ chức năng:** thêm mới, chỉnh sửa, bộ lọc.  
Mọi form/màn thêm/sửa/lọc phải tuân thủ giống nhau.

---

## 1. Tab / Shift+Tab

- Di chuyển giữa các ô theo **thứ tự logic** (trái → phải, trên → dưới).
- **Không chặn** hành vi mặc định: dùng hook để điều khiển thứ tự và bỏ qua dropdown (xem mục 3).

---

## 2. Enter với input

| Tình huống | Hành vi |
|------------|--------|
| Chưa phải ô cuối | Focus ô kế tiếp. |
| Ô cuối **form** (thêm/sửa) | **Lưu** (submit form). |
| Ô cuối **bộ lọc** | **Áp dụng lọc** (sync + đóng modal nếu đang trong modal). |
| Không submit form ngầm | Không để Enter submit form khi đang nhập ở ô giữa; chỉ submit khi Enter ở **ô cuối**. |

---

## 3. Dropdown / Select

| Quy tắc | Cách làm |
|--------|----------|
| **Không auto-open khi focus** | Dropdown không được mở khi ô nhận focus (vd: do Tab/Enter). |
| **Enter hoặc Tab khi dropdown đang đóng** | Bỏ qua ô dropdown, focus sang **ô tiếp theo**. |
| **Chỉ mở khi user chủ động** | Mở khi **click** chuột hoặc **Alt + ↓** (Alt + ArrowDown). |
| **Khi đang mở** | ↑↓ chọn option, **Enter** xác nhận, **Esc** đóng, **Tab** đóng và chuyển sang ô tiếp. |

**Kỹ thuật:** Dùng component **SelectNoAutoOpen** (bọc Ant Design Select) và đánh dấu ô dropdown bằng **data-quick-entry-skip-tab** để Tab/Enter bỏ qua. Chi tiết: hook `useQuickEntryKeys`, component `SelectNoAutoOpen`.

---

## 4. Esc

- **Xóa giá trị** ô đang focus (hành vi giống QuickClearIcon).
- Mỗi ô cần xử lý Esc (onKeyDown) và gọi logic clear tương ứng (form.setFieldsValue, setState, v.v.).

---

## 5. Xóa nhanh (QuickClearIcon)

- **Mọi** ô xóa nhanh đều dùng **QuickClearIcon**.
- **Không** dùng `allowClear` của Ant Design.
- Chi tiết: `docs/QUICK_CLEAR_ICON_USAGE.md`, `.cursorrules` §4.

---

## Tóm tắt kỹ thuật

- **Hook:** `useQuickEntryKeys(containerRef, { onLastFieldEnter, enabled })` — xử lý Enter (focus next / submit) và Tab/Shift+Tab (bỏ qua ô có `data-quick-entry-skip-tab`).
- **Ô tham gia:** Bọc trong wrapper có **data-quick-entry**; thứ tự DOM = thứ tự focus.
- **Dropdown:** Dùng **SelectNoAutoOpen**, wrapper có **data-quick-entry-skip-tab**; component tự set **data-dropdown-open** khi mở để Enter trong dropdown = chọn option.
- **Form:** `onKeyDown` trên Form: `if (e.key === 'Enter' && !e.shiftKey) e.preventDefault()`; submit chỉ qua nút Lưu hoặc Enter ở ô cuối (do hook gọi onLastFieldEnter).

---

## Tham chiếu code

- Hook: `frontend/src/hooks/useQuickEntryKeys.ts`
- Component Select: `frontend/src/components/SelectNoAutoOpen/`
- Mẫu form: `frontend/src/pages/Products/ProductForm.tsx`
- Mẫu lọc: `frontend/src/pages/Products/ProductList.tsx` (modal lọc + hàng lọc inline)
