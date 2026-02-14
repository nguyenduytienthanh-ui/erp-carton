import { useState, useCallback, useEffect, useRef } from 'react';
import { useUserPreferences } from './useUserPreferences';

export interface UseColumnSettingsOptions {
  /** Cột hiển thị mặc định khi chưa có config (vd. lần đầu). */
  defaultVisibleColumns: string[];
  /**
   * Nếu có: bật chế độ "Hiển thị kích thước" (3 cột riêng vs 1 cột gộp).
   * Khi đổi mode, visibleColumns được cập nhật (swap keys).
   */
  sizeColumns?: {
    separated: string[];
    merged: string[];
  };
}

export interface UseColumnSettingsResult {
  visibleColumns: string[];
  sizeDisplayMode: 'merged' | 'separated';
  handleVisibleColumnsChange: (newColumns: string[]) => Promise<void>;
  handleSizeDisplayModeChange: (mode: 'merged' | 'separated') => Promise<void>;
}

/**
 * Hook dùng chung cho "Cài đặt cột" (thêm/ẩn cột) trên mọi màn danh sách.
 * Đọc/ghi config qua useUserPreferences(pageKey). Trả về visibleColumns, sizeDisplayMode (nếu dùng sizeColumns), và 2 handler.
 * Màn hình danh sách chỉ cần: gọi hook → build danh sách cột cho modal từ column defs → render ColumnChooser (ColumnSettings).
 */
export function useColumnSettings(
  pageKey: string,
  options: UseColumnSettingsOptions
): UseColumnSettingsResult {
  const { defaultVisibleColumns, sizeColumns } = options;
  const { config, saveConfig } = useUserPreferences(pageKey);
  const configRef = useRef(config);
  configRef.current = config;

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const cols = (config?.columns as string[] | undefined);
    if (Array.isArray(cols) && cols.length > 0) return cols;
    return defaultVisibleColumns;
  });

  const [sizeDisplayMode, setSizeDisplayMode] = useState<'merged' | 'separated'>(() => {
    if (!sizeColumns) return 'separated';
    const mode = config?.sizeDisplayMode as 'merged' | 'separated' | undefined;
    return mode === 'merged' || mode === 'separated' ? mode : 'separated';
  });

  // Đồng bộ từ config khi load / restore từ server
  useEffect(() => {
    if (config == null) return;
    const cols = (config.columns as string[] | undefined);
    if (Array.isArray(cols) && cols.length > 0) setVisibleColumns(cols);
    if (sizeColumns) {
      const mode = config.sizeDisplayMode as 'merged' | 'separated' | undefined;
      if (mode === 'merged' || mode === 'separated') setSizeDisplayMode(mode);
    }
  }, [config, sizeColumns]);

  const savePreferences = useCallback(
    async (partial: Record<string, unknown>) => {
      const merged = { ...(configRef.current || {}), ...partial };
      await saveConfig(merged as any);
    },
    [saveConfig]
  );

  const handleVisibleColumnsChange = useCallback(
    async (newColumns: string[]) => {
      setVisibleColumns(newColumns);
      await savePreferences({ columns: newColumns });
    },
    [savePreferences]
  );

  const handleSizeDisplayModeChange = useCallback(
    async (mode: 'merged' | 'separated') => {
      if (!sizeColumns) return;
      setSizeDisplayMode(mode);
      const { separated, merged } = sizeColumns;
      const newCols =
        mode === 'merged'
          ? [...visibleColumns.filter((k) => !separated.includes(k)), ...merged]
          : [...visibleColumns.filter((k) => !merged.includes(k)), ...separated];
      setVisibleColumns(newCols);
      await savePreferences({ columns: newCols, sizeDisplayMode: mode });
    },
    [visibleColumns, sizeColumns, savePreferences]
  );

  return {
    visibleColumns,
    sizeDisplayMode,
    handleVisibleColumnsChange,
    handleSizeDisplayModeChange,
  };
}
