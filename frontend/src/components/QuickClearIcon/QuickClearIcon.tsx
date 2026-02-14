import { CloseCircleFilled } from '@ant-design/icons';
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
      <CloseCircleFilled style={{ fontSize: 'inherit', color: 'inherit' }} />
    </span>
  );
};

export default QuickClearIcon;
