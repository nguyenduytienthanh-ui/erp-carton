/**
 * FormInputWithClear — Input form (native) + QuickClearIcon khi có giá trị.
 * Dùng cho ProductForm, form thêm/sửa có nhiều ô nhập.
 */
import type { InputHTMLAttributes } from 'react';
import QuickClearIcon from '../QuickClearIcon';

export interface FormInputWithClearProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string | number | undefined;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Gọi khi bấm xóa */
  onClear: () => void;
  /** Có giá trị để hiện icon xóa (mặc định: value không rỗng) */
  hasValue?: boolean;
}

export default function FormInputWithClear({
  value,
  onChange,
  onClear,
  hasValue,
  className,
  style,
  ...rest
}: FormInputWithClearProps) {
  const showClear = hasValue ?? (value !== '' && value !== undefined && value !== null && String(value).trim() !== '');

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <input
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
          style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}
        />
      )}
    </div>
  );
}
