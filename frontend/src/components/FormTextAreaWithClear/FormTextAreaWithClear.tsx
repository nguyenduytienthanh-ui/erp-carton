/**
 * FormTextAreaWithClear — Textarea form (native) + QuickClearIcon khi có giá trị.
 * Dùng chung cho form thêm/sửa có ô textarea (địa chỉ, ghi chú,...).
 */
import type { TextareaHTMLAttributes } from 'react';
import QuickClearIcon from '../QuickClearIcon';

export interface FormTextAreaWithClearProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string | undefined;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Gọi khi bấm xóa */
  onClear: () => void;
  /** Có giá trị để hiện icon xóa (mặc định: value không rỗng) */
  hasValue?: boolean;
}

export default function FormTextAreaWithClear({
  value,
  onChange,
  onClear,
  hasValue,
  className,
  style,
  ...rest
}: FormTextAreaWithClearProps) {
  const showClear = hasValue ?? (value !== '' && value !== undefined && value !== null && String(value).trim() !== '');

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <textarea
        {...rest}
        className={className}
        value={value ?? ''}
        onChange={onChange}
        style={{
          ...style,
          paddingRight: showClear ? 28 : undefined,
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      {showClear && (
        <QuickClearIcon
          onClear={onClear}
          title="Xóa nhanh"
          style={{ position: 'absolute', right: 14, top: 8, zIndex: 1 }}
        />
      )}
    </div>
  );
}
