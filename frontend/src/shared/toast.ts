/**
 * Shared: Toast helpers chuẩn.
 * Gọi từ component có App context (App.useApp().message).
 */

export const TOAST = {
  DELETE_SUCCESS: 'Đã xoá thành công.',
  DELETE_BULK_SUCCESS: (n: number) => `Đã xoá ${n} dòng.`,
  SELECT_AT_LEAST_ONE: 'Chọn ít nhất một mục để xóa.',
} as const;
