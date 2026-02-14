/**
 * Bộ phân trang dùng chung: Tổng số + Pagination + Ô chọn số dòng/trang (X / trang)
 * Dùng cho ProductList, CustomerList, ...
 */
import { useState, useRef } from 'react';
import { Pagination, InputNumber, Space, message } from 'antd';
import QuickClearIcon from '../QuickClearIcon';

export interface ListPaginationProps {
  current: number;
  pageSize: number;
  total: number;
  totalLabel: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  minPageSize?: number;
  maxPageSize?: number;
  /** className cho wrapper (vd: products-list-bottom-bar) */
  className?: string;
}

export default function ListPagination({
  current,
  pageSize,
  total,
  totalLabel,
  onPageChange,
  onPageSizeChange,
  minPageSize = 1,
  maxPageSize = 500,
  className = '',
}: ListPaginationProps) {
  const [pageSizeDraft, setPageSizeDraft] = useState<number | null>(null);
  const [isEditingPageSize, setIsEditingPageSize] = useState(false);
  const pageSizeInputRef = useRef<HTMLInputElement | null>(null);

  const handleApplyPageSize = (v: number | null) => {
    if (v == null) return;
    if (v < minPageSize || v > maxPageSize) {
      message.error(`Nhập số từ ${minPageSize}-${maxPageSize}`);
      return;
    }
    onPageSizeChange(v);
    onPageChange(1);
    setPageSizeDraft(null);
    setIsEditingPageSize(false);
  };

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        marginTop: 16,
        padding: '8px 16px',
        background: '#fafafa',
        borderRadius: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', marginLeft: 'auto' }}>
        <Space size={16} align="center" wrap>
          <span style={{ fontSize: 13, color: '#595959' }}>
            Tổng {total} {totalLabel}
          </span>
          <Pagination
            current={current}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            onChange={(newPage) => onPageChange(newPage)}
            size="small"
            simple={false}
          />
          <div className="input-number-with-clear-wrapper" style={{ width: 110, display: 'inline-block', position: 'relative' }}>
            <InputNumber
              ref={pageSizeInputRef as any}
              size="small"
              min={minPageSize}
              max={maxPageSize}
              controls={false}
              style={{ width: '100%' }}
              className="input-number-with-clear"
              value={isEditingPageSize ? pageSizeDraft : pageSize}
              formatter={(v) => {
                if (isEditingPageSize && (v == null || v === '')) return '';
                return `${v ?? ''} / trang`;
              }}
              parser={(v) => {
                const digits = String(v ?? '').replace(/[^\d]/g, '');
                if (!digits) return '';
                const n = parseInt(digits, 10);
                return Number.isNaN(n) ? '' : n;
              }}
              onFocus={() => {
                setIsEditingPageSize(true);
                setPageSizeDraft(null);
              }}
              onClick={() => {
                setIsEditingPageSize(true);
                setPageSizeDraft(null);
              }}
              onChange={(v) => setPageSizeDraft(typeof v === 'number' ? v : null)}
              onBlur={() => {
                const v = pageSizeDraft;
                if (v == null) {
                  setPageSizeDraft(null);
                  setIsEditingPageSize(false);
                  return;
                }
                handleApplyPageSize(v);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const v = pageSizeDraft;
                if (v == null) return;
                handleApplyPageSize(v);
                (pageSizeInputRef.current as any)?.blur?.();
              }}
            />
            {(isEditingPageSize ? pageSizeDraft : pageSize) != null &&
              (isEditingPageSize ? pageSizeDraft : pageSize) !== '' && (
                <QuickClearIcon
                  onClear={() => {
                    setPageSizeDraft(null);
                    setIsEditingPageSize(true);
                  }}
                  title="Xóa nhanh"
                  style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}
                />
              )}
          </div>
        </Space>
      </div>
    </div>
  );
}
