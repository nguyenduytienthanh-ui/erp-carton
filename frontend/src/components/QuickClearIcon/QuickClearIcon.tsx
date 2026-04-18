import type { CSSProperties } from 'react';

/**
 * **QuickClearIcon — Chuẩn UI xóa nhanh dùng chung.** KHÔNG dùng allowClear của Ant Design.
 * Mọi ô input/search/filter dùng QuickClearIcon trong suffix (hoặc đặt cạnh ô). Xem docs/QUICK_CLEAR_ICON_USAGE.md.
 *
 * ## Cách dùng
 *
 * 1. **InputNumber** (ô số): truyền vào prop `suffix`, chỉ hiện icon khi có giá trị.
 * 2. **Input** (ô text): truyền vào prop `suffix`, chỉ hiện icon khi có nội dung.
 * 3. **Đặt cạnh ô**: render điều kiện khi có giá trị, bấm gọi onClear.
 *
 * ## Ví dụ
 *
 * // InputNumber — cần wrapper + className input-number-with-clear để padding đúng
 * <div className="input-number-with-clear-wrapper" style={{ width: 120 }}>
 *   <InputNumber
 *     value={value}
 *     controls={false}
 *     className="input-number-with-clear"
 *     suffix={value != null ? <QuickClearIcon onClear={() => setValue(null)} /> : undefined}
 *   />
 * </div>
 *
 * // Input (ô text)
 * <Input
 *   value={note}
 *   suffix={note?.trim() ? <QuickClearIcon onClear={() => setNote(null)} title="Xóa nhanh" /> : undefined}
 * />
 *
 * // Đặt cạnh ô (không dùng suffix)
 * {searchText && <QuickClearIcon onClear={() => setSearchText('')} title="Xóa tìm kiếm" />}
 */
export interface QuickClearIconProps {
  /** Gọi khi bấm xóa */
  onClear: () => void;
  /** Tooltip (mặc định: "Xóa nhanh") */
  title?: string;
  /** Class thêm cho wrapper (mặc định dùng ant-input-clear-icon để giống ô Tìm kiếm) */
  className?: string;
  /** Style thêm (merge với style mặc định giống ô Tìm kiếm) */
  style?: CSSProperties;
}

/** Style chuẩn icon xóa nhanh (dùng chung toàn app) */
const DEFAULT_STYLE: CSSProperties = {
  margin: 0,
  padding: 0,
  lineHeight: 0,
  color: 'rgba(0, 0, 0, 0.25)',
  fontSize: 12,
  cursor: 'pointer',
  transition: 'color 0.2s',
  border: 'none',
  outline: 'none',
  backgroundColor: 'transparent',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const QuickClearIcon = ({
  onClear,
  title = 'Xóa nhanh',
  className = 'ant-input-clear-icon quick-clear-icon',
  style,
}: QuickClearIconProps) => {
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      className={className}
      style={{ ...DEFAULT_STYLE, ...style }}
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClear();
        }
      }}
    >
      <svg
        viewBox="0 0 1024 1024"
        width="1em"
        height="1em"
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block', fill: 'currentColor' }}
      >
        <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm173.3 594.6a32 32 0 01-45.3 45.3L512 557.3 384 703.9a32 32 0 01-45.3-45.3L466.7 512 338.7 365.4a32 32 0 0145.3-45.3L512 466.7l128-146.6a32 32 0 0145.3 45.3L557.3 512l128 146.6z" />
      </svg>
    </span>
  );
};

export default QuickClearIcon;
