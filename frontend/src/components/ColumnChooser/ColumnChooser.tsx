import { useState } from 'react';
import { Button, Checkbox, Modal, Radio } from 'antd';
import { SettingOutlined } from '@ant-design/icons';

interface Column {
  key: string;
  title: string;
  required?: boolean;
}

interface ColumnChooserProps {
  columns: Column[];
  visibleColumns: string[];
  onChange: (visibleColumns: string[]) => void;
  sizeDisplayMode?: 'merged' | 'separated';
  onSizeDisplayModeChange?: (mode: 'merged' | 'separated') => void;
}

const ColumnChooser = ({
  columns,
  visibleColumns,
  onChange,
  sizeDisplayMode,
  onSizeDisplayModeChange,
}: ColumnChooserProps) => {
  const [open, setOpen] = useState(false);

  const requiredKeys = columns.filter((c) => c.required).map((c) => c.key);
  const optionalKeys = columns.filter((c) => !c.required).map((c) => c.key);
  const visibleOptional = optionalKeys.filter((k) => visibleColumns.includes(k));
  const allOptionalVisible = optionalKeys.length > 0 && visibleOptional.length === optionalKeys.length;
  const someOptionalVisible = visibleOptional.length > 0;
  const hasHiddenColumns = optionalKeys.length > 0 && visibleOptional.length < optionalKeys.length;
  const columnButtonColor = hasHiddenColumns ? '#ff4d4f' : undefined;
  const columnButtonStyle = hasHiddenColumns
    ? { color: columnButtonColor, borderColor: '#ff4d4f' as const }
    : { color: columnButtonColor };

  const handleChange = (columnKey: string, checked: boolean) => {
    if (checked) {
      onChange([...visibleColumns, columnKey]);
    } else {
      onChange(visibleColumns.filter((key) => key !== columnKey));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onChange([...requiredKeys, ...optionalKeys]);
    } else {
      onChange([...requiredKeys]);
    }
  };

  const content = (
    <div style={{ maxHeight: 420, overflow: 'auto' }}>
      {/* Chọn tất cả — một dòng trên cùng */}
      {optionalKeys.length > 0 && (
        <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
          <Checkbox
            checked={allOptionalVisible}
            indeterminate={someOptionalVisible && !allOptionalVisible}
            onChange={(e) => handleSelectAll(e.target.checked)}
            style={{ fontSize: 13 }}
          >
            Chọn tất cả / Bỏ chọn tất cả
          </Checkbox>
        </div>
      )}
      {/* Hiển thị kích thước — ngay dưới "Chọn tất cả..." */}
      {sizeDisplayMode != null && onSizeDisplayModeChange != null && (
        <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Hiển thị kích thước</div>
          <Radio.Group
            value={sizeDisplayMode}
            onChange={(e) => onSizeDisplayModeChange(e.target.value)}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <Radio value="separated">
              <span style={{ fontSize: 13 }}>3 cột riêng (Dài | Rộng | Cao)</span>
            </Radio>
            <Radio value="merged">
              <span style={{ fontSize: 13 }}>1 cột gộp (Dài x Rộng x Cao)</span>
            </Radio>
          </Radio.Group>
        </div>
      )}
      {/* Danh sách cột: mỗi dòng một checkbox + nhãn (giống hình chuẩn) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {columns.map((col) => (
          <label
            key={col.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 0',
              cursor: col.required ? 'default' : 'pointer',
              borderBottom: '1px solid #f5f5f5',
              fontSize: 14,
              color: 'rgba(0,0,0,0.88)',
            }}
          >
            <Checkbox
              checked={visibleColumns.includes(col.key)}
              onChange={(e) => !col.required && handleChange(col.key, e.target.checked)}
              disabled={col.required}
              style={{ marginLeft: 0, flexShrink: 0 }}
            />
            <span style={{ flex: 1 }}>{col.title}{col.required ? ' (*)' : ''}</span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <Button
        icon={<SettingOutlined style={{ color: columnButtonColor }} />}
        onClick={() => setOpen(true)}
        style={columnButtonStyle}
      >
        Cột
      </Button>
      <Modal
        title="Hiển thị cột"
        open={open}
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setOpen(false)}>
            Xong
          </Button>,
        ]}
        width={320}
        destroyOnHidden={false}
      >
        {content}
      </Modal>
    </>
  );
};

export default ColumnChooser;
