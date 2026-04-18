/**
 * Shared: Quản lý checkbox chọn nhiều dòng trong Table.
 * Dùng cho bulk delete, bulk activate, ...
 */
import { useState, useCallback } from 'react';
import type { TableRowSelection } from 'antd/es/table/interface';

export function useRowSelection<T extends { id?: number }>() {
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const rowSelection: TableRowSelection<T> = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys as React.Key[]),
  };

  const clearSelection = useCallback(() => setSelectedRowKeys([]), []);

  const removeFromSelection = useCallback((id: number) => {
    setSelectedRowKeys((keys) => keys.filter((k) => k !== id && Number(k) !== id));
  }, []);

  const selectedIds = selectedRowKeys
    .map((k) => Number(k))
    .filter((n) => !Number.isNaN(n) && n > 0);

  return {
    selectedRowKeys,
    setSelectedRowKeys,
    rowSelection,
    clearSelection,
    removeFromSelection,
    selectedIds,
    selectedCount: selectedIds.length,
  };
}
