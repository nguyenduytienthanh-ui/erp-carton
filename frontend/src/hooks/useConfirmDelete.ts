/**
 * Shared: Hiển thị Confirm Dialog xoá 1 dòng hoặc nhiều dòng.
 * Dùng App.useApp().modal.confirm với format chuẩn.
 */
import { useCallback } from 'react';
import { App } from 'antd';
import {
  CONFIRM_DELETE,
  getSingleDeleteMessage,
  getBulkDeleteMessage,
} from '../shared/confirmDelete';

export function useConfirmDelete() {
  const { modal } = App.useApp();

  const confirmDeleteOne = useCallback(
    (nameOrCode: string, onOk: () => Promise<void> | void) => {
      modal.confirm({
        title: CONFIRM_DELETE.TITLE,
        content: getSingleDeleteMessage(nameOrCode),
        okText: CONFIRM_DELETE.BTN_DELETE,
        okType: 'danger',
        cancelText: CONFIRM_DELETE.BTN_CANCEL,
        onOk,
      });
    },
    [modal]
  );

  const confirmBulkDelete = useCallback(
    (count: number, onOk: () => Promise<void> | void) => {
      modal.confirm({
        title: CONFIRM_DELETE.TITLE,
        content: getBulkDeleteMessage(count),
        okText: CONFIRM_DELETE.BTN_DELETE,
        okType: 'danger',
        cancelText: CONFIRM_DELETE.BTN_CANCEL,
        onOk,
      });
    },
    [modal]
  );

  return { confirmDeleteOne, confirmBulkDelete };
}
