import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Hook debounce dùng chung cho ô tìm kiếm và ô lọc.
 * Giá trị trả về chỉ cập nhật sau `delayMs` khi nguồn không đổi; không cập nhật ngay khi user gõ.
 *
 * @param value - Giá trị nguồn (thay đổi ngay khi user gõ/chọn)
 * @param delayMs - Số ms không đổi thì mới cập nhật (vd: 650)
 * @returns [debouncedValue, setDebouncedImmediate]
 *   - debouncedValue: dùng cho API, queryKey, URL
 *   - setDebouncedImmediate: gán ngay không qua debounce (khi áp từ URL hoặc load preferences)
 *
 * Sử dụng trong ProductList: tìm kiếm (searchInput → debouncedSearch) và lọc (filterStableString → debouncedFilterString), cùng DEBOUNCE_MS.
 */
function shallowCopyIfObject<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return { ...v } as T;
  return v;
}

export function useDebouncedValue<T>(value: T, delayMs: number): [T, (v: T) => void] {
  const [debouncedValue, setDebouncedValue] = useState<T>(() => shallowCopyIfObject(value));
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef<T>(value);

  const setImmediate = useCallback((v: T) => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    latestValueRef.current = shallowCopyIfObject(v);
    setDebouncedValue(shallowCopyIfObject(v));
  }, []);

  useEffect(() => {
    latestValueRef.current = value;
    if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
    const delay = Math.max(0, Number(delayMs));
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setDebouncedValue(shallowCopyIfObject(latestValueRef.current));
    }, delay);
    return () => {
      if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
    };
  }, [value, delayMs]);

  return [debouncedValue, setImmediate];
}
