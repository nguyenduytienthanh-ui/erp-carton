# Shared Modules (Bộ 54) – Hướng dẫn sử dụng

## Tổng quan

Các module dùng chung cho màn danh sách (Product, Category, Unit, Khách hàng, Chứng từ...) để đảm bảo hành vi thống nhất: xoá 1 dòng, xoá nhiều dòng, confirm dialog, toast, map lỗi API.

## 1. Xoá 1 dòng + Confirm Dialog

```tsx
import { useConfirmDelete } from '../../hooks/useConfirmDelete';
import { useBulkDelete } from '../../hooks/useBulkDelete';

const { confirmDeleteOne } = useConfirmDelete();
const { deleteOneMutation } = useBulkDelete({ ... });

// Trong cột Actions:
<Button
  danger
  icon={<DeleteOutlined />}
  onClick={() => confirmDeleteOne(
    record.name || record.code || String(record.id),
    () => deleteOneMutation.mutateAsync(record.id)
  )}
/>
```

- **Title**: "Xác nhận xoá"
- **Message**: "Bạn chắc chắn muốn xoá {Tên/Code}? Hành động này không thể hoàn tác."
- **Buttons**: "Huỷ" / "Xoá"
- **Toast thành công**: "Đã xoá thành công."

## 2. Xoá nhiều dòng (Bulk Delete)

```tsx
import { useRowSelection } from '../../hooks/useRowSelection';
import { useConfirmDelete } from '../../hooks/useConfirmDelete';
import { useBulkDelete } from '../../hooks/useBulkDelete';
import { TOAST } from '../../shared/toast';

const { rowSelection, selectedIds, selectedCount, clearSelection, removeFromSelection } = useRowSelection();
const { confirmBulkDelete, bulkDeleteMutation } = useBulkDelete({
  queryKey: ['products'],
  deleteFn: (id) => productsApi.deleteProduct(id),
  onClearSelection: clearSelection,
  onRemoveFromSelection: removeFromSelection,
});

// Nút Xóa (n):
{selectedCount > 0 && (
  <Button danger onClick={() => {
    if (selectedIds.length === 0) {
      message.warning(TOAST.SELECT_AT_LEAST_ONE);
      return;
    }
    confirmBulkDelete(selectedIds.length, () => bulkDeleteMutation.mutateAsync(selectedIds));
  }}>
    Xóa ({selectedCount})
  </Button>
)}

// Table:
<Table rowSelection={rowSelection} ... />
```

- **Message**: "Bạn chắc chắn muốn xoá {n} dòng? Hành động này không thể hoàn tác."
- **Toast thành công**: "Đã xoá {n} dòng."

## 3. Map lỗi API (required, unique code)

```tsx
import { parseApiError, getToastMessage } from '../../shared/apiError';

// Trong catch của form submit:
const { fieldErrors, generalMessage } = parseApiError(e);
setSubmitError(generalMessage);
message.error(generalMessage);

// Lỗi trùng mã: hiển thị "Mã hàng này đã tồn tại, hãy đổi lại."
```

## 4. Toast helpers

```tsx
import { TOAST } from '../../shared/toast';

TOAST.DELETE_SUCCESS        // "Đã xoá thành công."
TOAST.DELETE_BULK_SUCCESS(n) // "Đã xoá {n} dòng."
TOAST.SELECT_AT_LEAST_ONE    // "Chọn ít nhất một mục để xóa."
```

## 5. Cấu hình theo resource

Có thể thay `queryKey`, `deleteFn`, tên hiển thị (record.name, record.code) theo từng màn. UX giống nhau, chỉ khác cấu hình.
