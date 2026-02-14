import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([disabled]), [tabindex="0"]';

function getFocusable(el: Element): HTMLElement | null {
  if (el.matches(FOCUSABLE_SELECTOR)) return el as HTMLElement;
  const first = el.querySelector(FOCUSABLE_SELECTOR);
  return first ? (first as HTMLElement) : null;
}

/** Chỉ số ô tiếp theo (direction: 1 = Tab, -1 = Shift+Tab), bỏ qua ô có data-quick-entry-skip-tab (dropdown). */
function getNextIndex(currentIndex: number, direction: number, wrappers: NodeListOf<Element>): number {
  let next = currentIndex + direction;
  while (next >= 0 && next < wrappers.length && wrappers[next].hasAttribute('data-quick-entry-skip-tab')) {
    next += direction;
  }
  return next;
}

export interface UseQuickEntryKeysOptions {
  /** Gọi khi user nhấn Enter ở ô cuối (submit form / áp dụng lọc). */
  onLastFieldEnter?: () => void;
  /** Bật xử lý (mặc định true). */
  enabled?: boolean;
}

/**
 * Quy ước nhập liệu nhanh cho form / bộ lọc:
 * - Enter: focus ô kế tiếp (bỏ qua dropdown); ô cuối → onLastFieldEnter. Nếu đang trong dropdown đang mở → không xử lý (chọn option).
 * - Shift+Enter: không xử lý (textarea xuống dòng).
 * - Tab / Shift+Tab: focus ô kế tiếp / trước, bỏ qua ô có data-quick-entry-skip-tab (dropdown).
 * - Esc: do từng ô xử lý (clear).
 *
 * Container phải chứa các ô được bọc trong wrapper có data-quick-entry. Dropdown thêm data-quick-entry-skip-tab và data-dropdown-open khi mở.
 */
export function useQuickEntryKeys(
  containerRef: React.RefObject<HTMLElement | null>,
  options: UseQuickEntryKeysOptions = {}
) {
  const { onLastFieldEnter, enabled = true } = options;
  const onLastRef = useRef(onLastFieldEnter);
  onLastRef.current = onLastFieldEnter;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const wrappers = container.querySelectorAll('[data-quick-entry]');
      if (wrappers.length === 0) return;

      const active = document.activeElement;
      if (!active || !container.contains(active)) return;

      let currentIndex = -1;
      for (let i = 0; i < wrappers.length; i++) {
        if (wrappers[i].contains(active)) {
          currentIndex = i;
          break;
        }
      }
      if (currentIndex === -1) return;

      const wrapper = wrappers[currentIndex];

      // Tab / Shift+Tab: bỏ qua dropdown (data-quick-entry-skip-tab)
      if (e.key === 'Tab') {
        e.preventDefault();
        const nextIndex = getNextIndex(currentIndex, e.shiftKey ? -1 : 1, wrappers);
        if (nextIndex >= 0 && nextIndex < wrappers.length) {
          const focusable = getFocusable(wrappers[nextIndex]);
          focusable?.focus();
        }
        return;
      }

      if (e.key !== 'Enter') return;
      if (e.shiftKey) return; // Shift+Enter: giữ xuống dòng (textarea)

      // Enter khi dropdown đang mở → không xử lý (để Select chọn option)
      const dropdownOpen = wrapper.getAttribute('data-dropdown-open') === 'true' || wrapper.querySelector('[data-dropdown-open]');
      if (wrapper.hasAttribute('data-quick-entry-skip-tab') && dropdownOpen) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Enter: focus ô kế tiếp (bỏ qua dropdown) hoặc submit
      const nextIndex = getNextIndex(currentIndex, 1, wrappers);
      if (nextIndex < wrappers.length) {
        const focusable = getFocusable(wrappers[nextIndex]);
        focusable?.focus();
      } else {
        onLastRef.current?.();
      }
    };

    // Lắng nghe trên document (capture) → không phụ thuộc container mount sớm hay muộn
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [containerRef, enabled]);
}
