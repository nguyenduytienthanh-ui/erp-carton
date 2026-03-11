import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useUserPreferences } from './useUserPreferences';
import type { PreferencesConfig } from '../types/preferences';

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
  const configRef = useRef<PreferencesConfig>(config);

  const savedVisibleColumns = useMemo(() => {
    const cols = (config?.columns as string[] | undefined);
    return Array.isArray(cols) && cols.length > 0 ? cols : defaultVisibleColumns;
  }, [config, defaultVisibleColumns]);

  const savedSizeDisplayMode = useMemo<'merged' | 'separated'>(() => {
    if (!sizeColumns) return 'separated';
    const mode = config?.sizeDisplayMode as 'merged' | 'separated' | undefined;
    return mode === 'merged' || mode === 'separated' ? mode : 'separated';
  }, [config, sizeColumns]);

  const [visibleColumnsOverride, setVisibleColumnsOverride] = useState<string[] | null>(null);
  const [sizeDisplayModeOverride, setSizeDisplayModeOverride] = useState<'merged' | 'separated' | null>(null);

  const visibleColumns = visibleColumnsOverride ?? savedVisibleColumns;
  const sizeDisplayMode = sizeDisplayModeOverride ?? savedSizeDisplayMode;

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const savePreferences = useCallback(
    async (partial: Record<string, unknown>) => {
      const merged = { ...(configRef.current || {}), ...partial };
      await saveConfig(merged);
    },
    [saveConfig],
  );

  const handleVisibleColumnsChange = useCallback(
    async (newColumns: string[]) => {
      setVisibleColumnsOverride(newColumns);
      await savePreferences({ columns: newColumns });
    },
    [savePreferences],
  );

  const handleSizeDisplayModeChange = useCallback(
    async (mode: 'merged' | 'separated') => {
      if (!sizeColumns) return;
      const { separated, merged } = sizeColumns;
      const newCols =
        mode === 'merged'
          ? [...visibleColumns.filter((k) => !separated.includes(k)), ...merged]
          : [...visibleColumns.filter((k) => !merged.includes(k)), ...separated];
      setSizeDisplayModeOverride(mode);
      setVisibleColumnsOverride(newCols);
      await savePreferences({ columns: newCols, sizeDisplayMode: mode });
    },
    [visibleColumns, sizeColumns, savePreferences],
  );

  return {
    visibleColumns,
    sizeDisplayMode,
    handleVisibleColumnsChange,
    handleSizeDisplayModeChange,
  };
}
