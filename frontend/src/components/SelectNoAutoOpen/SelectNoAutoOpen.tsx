import { useState, useRef, useEffect } from 'react';
import { Select } from 'antd';
import type { SelectProps } from 'antd';

/**
 * Select áp dụng quy ước nhập liệu nhanh cho dropdown:
 * - KHÔNG auto-open khi focus (Tab/Enter bỏ qua).
 * - Chỉ mở khi: click chuột hoặc Alt + ArrowDown.
 * - Esc đóng dropdown nếu đang mở.
 * - Wrapper có data-quick-entry-skip-tab (Tab bỏ qua) và data-dropdown-open khi mở (Enter trong dropdown mở = chọn option).
 */
export default function SelectNoAutoOpen(props: SelectProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const openFromUserRef = useRef(false);
  const altDownRef = useRef(false);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (open) {
      el.setAttribute('data-dropdown-open', 'true');
    } else {
      el.removeAttribute('data-dropdown-open');
    }
  }, [open]);

  const handleMouseDownCapture = () => {
    openFromUserRef.current = true;
  };

  const handleKeyDownCapture = (e: React.KeyboardEvent) => {
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      altDownRef.current = true;
      setOpen(true);
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const handleDropdownVisibleChange = (visible: boolean) => {
    if (visible) {
      if (openFromUserRef.current || altDownRef.current) {
        setOpen(true);
      } else {
        setOpen(false);
      }
    } else {
      setOpen(false);
    }
    openFromUserRef.current = false;
    altDownRef.current = false;
  };

  return (
    <div
      ref={wrapperRef}
      data-quick-entry-skip-tab
      onMouseDownCapture={handleMouseDownCapture}
      onKeyDownCapture={handleKeyDownCapture}
      style={{ display: 'inline-block', width: '100%' }}
    >
      <Select
        {...props}
        open={open}
        onDropdownVisibleChange={handleDropdownVisibleChange}
      />
    </div>
  );
}
