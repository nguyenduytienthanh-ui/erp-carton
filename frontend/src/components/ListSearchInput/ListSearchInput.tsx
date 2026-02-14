/**
 * ListSearchInput — Ô tìm kiếm dùng chung cho danh sách (Sản phẩm, Khách hàng, ...)
 * - Ô tìm kiếm + QuickClearIcon tích hợp sẵn (không code riêng)
 */
import { Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import QuickClearIcon from '../QuickClearIcon';

export interface ListSearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  /** Gọi khi bấm xóa (có thể reset pagination, search state) */
  onClear?: () => void;
  style?: React.CSSProperties;
}

export default function ListSearchInput({
  placeholder = 'Tìm kiếm...',
  value,
  onChange,
  onClear,
  style,
}: ListSearchInputProps) {
  const handleClear = () => {
    onChange('');
    onClear?.();
  };

  return (
    <Input
      placeholder={placeholder}
      prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
      suffix={(value?.trim() ?? '') !== '' ? <QuickClearIcon onClear={handleClear} title="Xóa tìm kiếm" /> : undefined}
      style={{ width: 300, borderRadius: 8, ...style }}
      size="middle"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      allowClear={false}
    />
  );
}
