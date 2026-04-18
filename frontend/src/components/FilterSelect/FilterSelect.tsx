/**
 * FilterSelect — Select dùng chung cho ô lọc (Trạng thái, Hoạt động, Danh mục, v.v.)
 * - Dùng native <select>: luôn mở và chọn được
 * - Tùy chọn QuickClearIcon khi có giá trị
 * - Style thống nhất: size small, height 22
 */
import QuickClearIcon from '../QuickClearIcon';

export interface FilterSelectOption {
  label: string;
  value: string | number;
}

export interface FilterSelectProps {
  value?: string | number | null;
  onChange?: (value: string | number | null) => void;
  options: FilterSelectOption[];
  placeholder?: string;
  showClear?: boolean;
  onClear?: () => void;
  hasValue?: boolean;
  style?: React.CSSProperties;
  disabled?: boolean;
}

const FILTER_SELECT_STYLE: React.CSSProperties = {
  width: '100%',
  height: 22,
  minHeight: 22,
  padding: '0 8px',
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
  color: '#262626',
  boxSizing: 'border-box',
  appearance: 'auto',
  cursor: 'pointer',
};

export default function FilterSelect({
  value,
  onChange,
  options,
  placeholder = '',
  showClear = false,
  onClear,
  hasValue,
  style,
  disabled = false,
}: FilterSelectProps) {
  const showClearIcon = showClear && hasValue && onClear;
  const strValue = value === undefined || value === null ? '' : String(value);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange?.(null);
      return;
    }
    const opt = options.find((o) => String(o.value) === raw);
    onChange?.(opt ? opt.value : raw);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <select
        value={strValue}
        onChange={handleChange}
        disabled={disabled}
        style={{
          ...FILTER_SELECT_STYLE,
          ...(showClearIcon ? { paddingRight: 28 } : {}),
          ...style,
        }}
        className="filter-select-native"
      >
        <option value="">{placeholder || ' '}</option>
        {options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </option>
        ))}
      </select>
      {showClearIcon && (
        <QuickClearIcon
          onClear={onClear}
          title="Xóa nhanh"
          style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}
        />
      )}
    </div>
  );
}
