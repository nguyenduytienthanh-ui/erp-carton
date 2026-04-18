import type { ReactNode } from 'react';
import { Space, Input, Button } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import QuickClearIcon from '../QuickClearIcon';

interface CompactFiltersProps {
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: ReactNode;
  onReset?: () => void;
  showReset?: boolean;
}

const CompactFilters = ({
  searchPlaceholder = 'Tìm kiếm...',
  searchValue,
  onSearchChange,
  filters,
  onReset,
  showReset = true,
}: CompactFiltersProps) => {
  return (
    <div
      style={{
        padding: '16px',
        background: '#ffffff',
        borderBottom: '1px solid #f3f4f6',
        marginBottom: '0',
      }}
    >
      <Space size={12} wrap style={{ width: '100%' }}>
        <Input
          placeholder={searchPlaceholder}
          prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
          suffix={(searchValue?.trim() ?? '') !== '' ? <QuickClearIcon onClear={() => onSearchChange?.('')} title="Xóa tìm kiếm" /> : undefined}
          value={searchValue}
          onChange={(e) => onSearchChange?.(e.target.value)}
          style={{
            width: 'min(100%, 300px)',
            borderRadius: '8px',
          }}
        />

        {filters}

        {showReset && onReset && (
          <Button
            icon={<ReloadOutlined />}
            onClick={onReset}
            style={{
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
            }}
          >
            Xóa bộ lọc
          </Button>
        )}
      </Space>
    </div>
  );
};

export default CompactFilters;
