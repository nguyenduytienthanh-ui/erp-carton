/**
 * Shared: Chuẩn hoá Confirm Dialog cho xoá 1 dòng & xoá nhiều dòng.
 * Dùng App.useApp().modal.confirm với format chuẩn.
 */

export const CONFIRM_DELETE = {
  TITLE: 'Xác nhận xoá',
  CANNOT_UNDO: 'Hành động này không thể hoàn tác.',
  BTN_CANCEL: 'Huỷ',
  BTN_DELETE: 'Xoá',
} as const;

/** Message cho xoá 1 dòng: "Bạn chắc chắn muốn xoá {Tên/Code}? Hành động này không thể hoàn tác." */
export function getSingleDeleteMessage(nameOrCode: string): string {
  return `Bạn chắc chắn muốn xoá ${nameOrCode}? ${CONFIRM_DELETE.CANNOT_UNDO}`;
}

/** Message cho xoá nhiều dòng: "Bạn chắc chắn muốn xoá {n} dòng? Hành động này không thể hoàn tác." */
export function getBulkDeleteMessage(count: number): string {
  return `Bạn chắc chắn muốn xoá ${count} dòng? ${CONFIRM_DELETE.CANNOT_UNDO}`;
}
