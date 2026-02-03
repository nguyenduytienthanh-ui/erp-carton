import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button, Checkbox, Space } from 'antd';
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
}

const ColumnChooser = ({ columns, visibleColumns, onChange }: ColumnChooserProps) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleChange = (columnKey: string, checked: boolean) => {
    if (checked) {
      onChange([...visibleColumns, columnKey]);
    } else {
      onChange(visibleColumns.filter((key) => key !== columnKey));
    }
  };

  // Đóng khi click ra ngoài
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const rect = wrapRef.current?.getBoundingClientRect();
  const panelStyle: React.CSSProperties = rect
    ? {
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        zIndex: 1100,
        padding: '12px',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        width: '250px',
        maxHeight: '400px',
        overflow: 'auto',
      }
    : {};

  const panel = open ? (
    <div
      ref={panelRef}
      style={panelStyle}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          marginBottom: '12px',
          fontWeight: 600,
          color: '#262626',
          fontSize: '14px',
        }}
      >
        Hiển thị cột
      </div>
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        {columns.map((col) => (
          <Checkbox
            key={col.key}
            checked={visibleColumns.includes(col.key)}
            onChange={(e) => handleChange(col.key, e.target.checked)}
            disabled={col.required}
            style={{ width: '100%' }}
          >
            {col.title} {col.required && '(*)'}
          </Checkbox>
        ))}
      </Space>
    </div>
  ) : null;

  return (
    <>
      <span ref={wrapRef} style={{ display: 'inline-block' }}>
        <Button
          icon={<SettingOutlined />}
          onClick={() => setOpen((v) => !v)}
        >
          Cột
        </Button>
      </span>
      {open && createPortal(panel, document.body)}
    </>
  );
};

export default ColumnChooser;
