/**
 * Danh sách khách hàng - chuẩn ProductList:
 * - Icon thao tác (Xem, Nhân bản, Sửa, Xóa) - tím, xanh lá, xanh dương, đỏ
 * - Bộ lọc (Lọc) với modal chọn bộ lọc
 * - Cài đặt cột (ColumnChooser)
 * - Tìm kiếm, Xuất Excel/PDF, Nhập Excel, Thêm mới
 * - useUserPreferences (customers-list), useSearchFilterIntent
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Table,
  Button,
  message,
  Modal,
  Card,
  Checkbox,
} from 'antd';
import {
  PlusOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  ExportOutlined,
  UploadOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../api/customers';
import type { Customer, CustomerStatus } from '../../types/customer';
import { CUSTOMER_STATUS_LABELS } from '../../types/customer';
import { theme } from '../../styles/theme';
import {
  EmptyState,
  ImportModal,
  ColumnChooser,
  QuickClearIcon,
  FilterSelect,
  ListSearchInput,
} from '../../components';
import CustomerForm from './CustomerForm';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useConfirmDelete } from '../../hooks/useConfirmDelete';
import { useBulkDelete } from '../../hooks/useBulkDelete';
import { useRowSelection } from '../../hooks/useRowSelection';
import { TOAST } from '../../shared/toast';
import { PAGES } from '../../utils/constants';

const DEFAULT_CUSTOMER_VISIBLE_COLUMNS: string[] = [
  'code', 'name', 'company_name', 'phone', 'email', 'tax_code',
  'contact_person', 'contact_phone', 'payment_terms', 'credit_limit',
  'status', 'is_active', 'actions',
];

type FilterKey = 'code' | 'name' | 'company_name' | 'status' | 'is_active' | 'phone' | 'email';
const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'code', label: 'Mã KH' },
  { key: 'name', label: 'Tên KH' },
  { key: 'company_name', label: 'Công ty' },
  { key: 'phone', label: 'Điện thoại' },
  { key: 'email', label: 'Email' },
  { key: 'status', label: 'Trạng thái' },
  { key: 'is_active', label: 'Hoạt động' },
];

type FilterValues = {
  code: string | null;
  name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  status: CustomerStatus | null;
  is_active: boolean | null;
};

const EMPTY_FILTER_VALUES: FilterValues = {
  code: null,
  name: null,
  company_name: null,
  phone: null,
  email: null,
  status: null,
  is_active: null,
};

function FilterTextInput(props: {
  'data-field': string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  onClear?: () => void;
  showClear?: boolean;
}) {
  const { 'data-field': dataField, value, onChange, placeholder, style, onClear, showClear } = props;
  const showClearIcon = showClear ?? ((value ?? '').trim() !== '');
  return (
    <div style={{ position: 'relative', width: style?.width ?? '100%', display: 'inline-block', minWidth: 0 }}>
      <input
        key={dataField}
        data-field={dataField}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        style={{
          width: '100%',
          height: 22,
          boxSizing: 'border-box',
          padding: '0 8px',
          paddingRight: showClearIcon && onClear ? 22 : 8,
          fontSize: 14,
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          outline: 'none',
          ...style,
        }}
      />
      {showClearIcon && onClear && (
        <QuickClearIcon
          onClear={onClear}
          title="Xóa nhanh"
          style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}
        />
      )}
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = 650;
const FILTER_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;

function filterValuesToStableString(fv: FilterValues): string {
  return JSON.stringify(fv);
}
function parseStableFilterString(s: string | undefined): FilterValues {
  if (!s || typeof s !== 'string') return { ...EMPTY_FILTER_VALUES };
  try {
    const o = JSON.parse(s) as Partial<FilterValues>;
    return { ...EMPTY_FILTER_VALUES, ...o };
  } catch {
    return { ...EMPTY_FILTER_VALUES };
  }
}

function parseCustomerListParams(searchParams: URLSearchParams): {
  searchInput: string;
  search: string;
  filterValues: FilterValues;
  activeFilters: FilterKey[];
  page: number;
  pageSize: number;
} {
  const q = searchParams.get('q') ?? '';
  const code = searchParams.get('code') ?? '';
  const name = searchParams.get('name') ?? '';
  const company_name = searchParams.get('company_name') ?? '';
  const phone = searchParams.get('phone') ?? '';
  const email = searchParams.get('email') ?? '';
  const status = searchParams.get('status') as CustomerStatus | null;
  const is_activeParam = searchParams.get('is_active');
  const is_active = is_activeParam === 'true' ? true : is_activeParam === 'false' ? false : null;
  const activeFiltersRaw = searchParams.get('activeFilters') ?? '';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.max(1, Math.min(500, parseInt(searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10)));

  const filterValues: FilterValues = {
    code: code.trim() || null,
    name: name.trim() || null,
    company_name: company_name.trim() || null,
    phone: phone.trim() || null,
    email: email.trim() || null,
    status: status && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(status) ? status : null,
    is_active,
  };
  const activeFromUrl = activeFiltersRaw.split(',').map((s) => s.trim()).filter(Boolean).filter((k): k is FilterKey => FILTER_OPTIONS.some((o) => o.key === k));
  const activeFromValues = (FILTER_OPTIONS.map((o) => o.key)).filter((k) => {
    const v = filterValues[k];
    return v != null && v !== '';
  });
  const activeFilters = activeFromUrl.length > 0 ? activeFromUrl : activeFromValues;

  return { searchInput: q, search: q, filterValues, activeFilters, page, pageSize };
}

function customerListParamsToSearch(
  search: string,
  filterValues: FilterValues,
  activeFilters: FilterKey[],
  current: number,
  pageSize: number
): Record<string, string> {
  const params: Record<string, string> = {};
  if (search.trim()) params.q = search.trim();
  if (filterValues.code?.trim()) params.code = filterValues.code.trim();
  if (filterValues.name?.trim()) params.name = filterValues.name.trim();
  if (filterValues.company_name?.trim()) params.company_name = filterValues.company_name.trim();
  if (filterValues.phone?.trim()) params.phone = filterValues.phone.trim();
  if (filterValues.email?.trim()) params.email = filterValues.email.trim();
  if (filterValues.status != null) params.status = filterValues.status;
  if (filterValues.is_active === true) params.is_active = 'true';
  if (filterValues.is_active === false) params.is_active = 'false';
  if (activeFilters.length > 0) params.activeFilters = activeFilters.join(',');
  if (current > 1) params.page = String(current);
  if (pageSize !== DEFAULT_PAGE_SIZE) params.pageSize = String(pageSize);
  return params;
}

const CustomerList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const parsed = useMemo(() => parseCustomerListParams(searchParams), [searchParams]);

  const [searchInput, setSearchInput] = useState(parsed.searchInput);
  const [filterValues, setFilterValues] = useState<FilterValues>(parsed.filterValues);
  const [activeFilters, setActiveFilters] = useState<FilterKey[]>(parsed.activeFilters);
  const [pagination, setPagination] = useState({ current: parsed.page, pageSize: parsed.pageSize });
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [importModalVisible, setImportModalVisible] = useState(false);

  const {
    visibleColumns,
    handleVisibleColumnsChange,
  } = useColumnSettings(PAGES.CUSTOMERS_LIST, {
    defaultVisibleColumns: DEFAULT_CUSTOMER_VISIBLE_COLUMNS,
  });

  const {
    intentSearch,
    intentFilters,
    setIntentImmediate,
  } = useSearchFilterIntent({
    searchInput,
    filterValues,
    searchDebounceMs: SEARCH_DEBOUNCE_MS,
    filterDebounceMs: FILTER_DEBOUNCE_MS,
    serializeFilters: filterValuesToStableString,
    parseFilters: parseStableFilterString,
  });

  const apiParams = useMemo(() => {
    const p: Record<string, unknown> = {
      page: pagination.current,
      page_size: pagination.pageSize,
      ordering: 'code',
    };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.code?.trim()) p.code = intentFilters.code.trim();
    if (intentFilters.name?.trim()) p.name = intentFilters.name.trim();
    if (intentFilters.company_name?.trim()) p.company_name = intentFilters.company_name.trim();
    if (intentFilters.phone?.trim()) p.phone = intentFilters.phone.trim();
    if (intentFilters.email?.trim()) p.email = intentFilters.email.trim();
    if (intentFilters.status != null) p.status = intentFilters.status;
    if (intentFilters.is_active === true) p.is_active = 'true';
    if (intentFilters.is_active === false) p.is_active = 'false';
    return p;
  }, [intentSearch, intentFilters, pagination.current, pagination.pageSize]);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', apiParams],
    queryFn: () => customersApi.getCustomers(apiParams as Record<string, string>),
  });

  const results = data?.results ?? [];
  const total = data?.count ?? 0;

  const { selectedIds, selectedCount, rowSelection, clearSelection } = useRowSelection<Customer>();
  const { confirmDeleteOne, confirmBulkDelete } = useConfirmDelete();
  const { bulkDeleteMutation } = useBulkDelete({
    queryKey: ['customers'],
    deleteFn: (id) => customersApi.deleteCustomer(id),
    onClearSelection: clearSelection,
  });

  const applyFilterChange = useCallback((updater: (prev: FilterValues) => FilterValues) => {
    setFilterValues(updater);
    setPagination((p) => ({ ...p, current: 1 }));
  }, []);

  const handleToggleFilter = useCallback((key: FilterKey) => {
    setActiveFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setFilterValues({ ...EMPTY_FILTER_VALUES });
    setActiveFilters([]);
    setPagination((p) => ({ ...p, current: 1 }));
    setIntentImmediate(searchInput, EMPTY_FILTER_VALUES);
  }, [searchInput, setIntentImmediate]);

  const syncUrl = useCallback(() => {
    const params = customerListParamsToSearch(intentSearch, intentFilters, activeFilters, pagination.current, pagination.pageSize);
    setSearchParams(params, { replace: true });
  }, [intentSearch, intentFilters, activeFilters, pagination, setSearchParams]);

  useEffect(() => {
    syncUrl();
  }, [intentSearch, intentFilters, activeFilters, pagination.current, pagination.pageSize]);

  const handleAdd = () => {
    setEditingCustomer(null);
    setFormVisible(true);
  };

  const handleEdit = (record: Customer) => {
    setEditingCustomer(record);
    setFormVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await customersApi.deleteCustomer(id);
      message.success('Đã xóa khách hàng.');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch (err: unknown) {
      message.error((err as Error)?.message ?? 'Xóa thất bại');
    }
  };

  const handleExport = async (format: 'excel' | 'pdf') => {
    try {
      const blob = await customersApi.exportCustomers(format, apiParams as Record<string, string>);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customers_${new Date().toISOString().slice(0, 10)}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(`Đã xuất ${format === 'pdf' ? 'PDF' : 'Excel'}`);
    } catch (err: unknown) {
      message.error((err as Error)?.message ?? `Xuất ${format} thất bại`);
    }
  };

  const handleImportSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    setImportModalVisible(false);
  };

  const allColumnsBase: (ColumnsType<Customer>[number] & { sortField?: string })[] = [
    {
      title: 'Mã KH',
      dataIndex: 'code',
      key: 'code',
      sortField: 'code',
      width: 100,
      fixed: 'left' as const,
      render: (code: string, record: Customer) => (
        <span
          role="button"
          tabIndex={0}
          onClick={() => handleEdit(record)}
          onKeyDown={(e) => e.key === 'Enter' && handleEdit(record)}
          style={{ fontWeight: 500, color: theme.colors.primary, cursor: 'pointer' }}
        >
          {code ?? '-'}
        </span>
      ),
    },
    { title: 'Tên KH', dataIndex: 'name', key: 'name', sortField: 'name', width: 180, ellipsis: true, render: (n: string) => n ?? '-' },
    { title: 'Công ty', dataIndex: 'company_name', key: 'company_name', sortField: 'company_name', width: 160, ellipsis: true, render: (t: string) => t ?? '-' },
    { title: 'Điện thoại', dataIndex: 'phone', key: 'phone', width: 110, render: (t: string) => t ?? '-' },
    { title: 'Email', dataIndex: 'email', key: 'email', width: 160, ellipsis: true, render: (t: string) => t ?? '-' },
    { title: 'Mã số thuế', dataIndex: 'tax_code', key: 'tax_code', width: 100, render: (t: string) => t ?? '-' },
    { title: 'Người liên hệ', dataIndex: 'contact_person', key: 'contact_person', width: 120, ellipsis: true, render: (t: string) => t ?? '-' },
    { title: 'SĐT liên hệ', dataIndex: 'contact_phone', key: 'contact_phone', width: 110, render: (t: string) => t ?? '-' },
    { title: 'Hạn TT (ngày)', dataIndex: 'payment_terms', key: 'payment_terms', width: 90, align: 'right' as const, render: (v: number) => v != null ? v : '-' },
    { title: 'Hạn mức', dataIndex: 'credit_limit', key: 'credit_limit', width: 100, align: 'right' as const, render: (v: number) => v != null ? v.toLocaleString('vi-VN') : '-' },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      sortField: 'status',
      width: 110,
      align: 'center' as const,
      render: (v: string) => (CUSTOMER_STATUS_LABELS as Record<string, string>)[v] ?? v ?? '-',
    },
    {
      title: 'Hoạt động',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      align: 'center' as const,
      render: (v: boolean) => (v ? 'Có' : 'Không'),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      fixed: 'right' as const,
      width: 130,
      align: 'center' as const,
      render: (_: unknown, record: Customer) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Button type="text" size="small" icon={<EyeOutlined style={{ fontSize: 18, color: '#722ed1' }} />} onClick={(e) => { e.stopPropagation(); handleEdit(record); }} title="Xem chi tiết" />
          <Button type="text" size="small" icon={<CopyOutlined style={{ fontSize: 18, color: '#52c41a' }} />} onClick={(e) => { e.stopPropagation(); const cloned = { ...record }; delete (cloned as Record<string, unknown>).id; delete (cloned as Record<string, unknown>).code; (cloned as Record<string, unknown>).name = `${record.name} (Copy)`; setEditingCustomer(cloned); setFormVisible(true); }} title="Nhân bản" />
          <Button type="text" size="small" icon={<EditOutlined style={{ fontSize: 18, color: '#1890ff' }} />} onClick={(e) => { e.stopPropagation(); handleEdit(record); }} title="Chỉnh sửa" />
          <Button type="text" size="small" danger icon={<DeleteOutlined style={{ fontSize: 18 }} />} onClick={(e) => { e.stopPropagation(); confirmDeleteOne(record.name || record.code || String(record.id), () => handleDelete(record.id)); }} title="Xóa" />
        </div>
      ),
    },
  ];

  const columnKeyToTitle: Record<string, string> = {};
  allColumnsBase.forEach((col) => {
    if (typeof col.title === 'string') columnKeyToTitle[col.key as string] = col.title;
  });
  const columnChooserList = allColumnsBase.map((col) => ({
    key: col.key as string,
    title: columnKeyToTitle[col.key as string] ?? (col.key as string),
    required: col.key === 'code' || col.key === 'name',
  }));

  const displayColumns = allColumnsBase.filter((col) => (visibleColumns ?? []).includes(col.key as string));
  const columns = displayColumns;

  const allFiltersSelected = FILTER_OPTIONS.length > 0 && activeFilters.length === FILTER_OPTIONS.length;
  const someFiltersSelected = activeFilters.length > 0;

  const handleSelectAllFilters = useCallback((checked: boolean) => {
    if (checked) {
      setActiveFilters(FILTER_OPTIONS.map((o) => o.key));
    } else {
      handleClearAllFilters();
    }
  }, [handleClearAllFilters]);

  const filterModalContent = (
    <div style={{ padding: '4px 0' }}>
      <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 14 }}>Chọn bộ lọc — tick để bật và chọn giá trị bên dưới</div>
      <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #f0f0f0' }}>
        <Checkbox checked={allFiltersSelected} indeterminate={someFiltersSelected && !allFiltersSelected} onChange={(e) => handleSelectAllFilters(e.target.checked)} style={{ fontWeight: 600 }}>
          Chọn tất cả / Bỏ chọn tất cả
        </Checkbox>
      </div>
      {FILTER_OPTIONS.map((opt) => (
        <div key={opt.key} style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Checkbox checked={activeFilters.includes(opt.key)} onChange={() => handleToggleFilter(opt.key)}>
            {opt.label}
          </Checkbox>
          {activeFilters.includes(opt.key) && (
            <>
              {opt.key === 'code' && (
                <FilterTextInput value={filterValues.code ?? ''} onChange={(v) => applyFilterChange((p) => ({ ...p, code: v === '' ? null : v }))} placeholder="Mã KH chứa..." style={{ width: 220 }} data-field="code_filter" onClear={() => applyFilterChange((p) => ({ ...p, code: null }))} showClear={(filterValues.code ?? '').trim() !== ''} />
              )}
              {opt.key === 'name' && (
                <FilterTextInput value={filterValues.name ?? ''} onChange={(v) => applyFilterChange((p) => ({ ...p, name: v === '' ? null : v }))} placeholder="Tên KH chứa..." style={{ width: 220 }} data-field="name_filter" onClear={() => applyFilterChange((p) => ({ ...p, name: null }))} showClear={(filterValues.name ?? '').trim() !== ''} />
              )}
              {opt.key === 'company_name' && (
                <FilterTextInput value={filterValues.company_name ?? ''} onChange={(v) => applyFilterChange((p) => ({ ...p, company_name: v === '' ? null : v }))} placeholder="Công ty chứa..." style={{ width: 220 }} data-field="company_filter" onClear={() => applyFilterChange((p) => ({ ...p, company_name: null }))} showClear={(filterValues.company_name ?? '').trim() !== ''} />
              )}
              {opt.key === 'phone' && (
                <FilterTextInput value={filterValues.phone ?? ''} onChange={(v) => applyFilterChange((p) => ({ ...p, phone: v === '' ? null : v }))} placeholder="Điện thoại chứa..." style={{ width: 180 }} data-field="phone_filter" onClear={() => applyFilterChange((p) => ({ ...p, phone: null }))} showClear={(filterValues.phone ?? '').trim() !== ''} />
              )}
              {opt.key === 'email' && (
                <FilterTextInput value={filterValues.email ?? ''} onChange={(v) => applyFilterChange((p) => ({ ...p, email: v === '' ? null : v }))} placeholder="Email chứa..." style={{ width: 220 }} data-field="email_filter" onClear={() => applyFilterChange((p) => ({ ...p, email: null }))} showClear={(filterValues.email ?? '').trim() !== ''} />
              )}
              {opt.key === 'status' && (
                <div style={{ width: 180 }}>
                  <FilterSelect
                    placeholder="Chọn trạng thái"
                    style={{ width: 180 }}
                    value={filterValues.status ?? undefined}
                    onChange={(v) => applyFilterChange((p) => ({ ...p, status: (v as CustomerStatus) ?? null }))}
                    options={Object.entries(CUSTOMER_STATUS_LABELS).map(([val, label]) => ({ label, value: val }))}
                    showClear
                    hasValue={filterValues.status != null}
                    onClear={() => applyFilterChange((p) => ({ ...p, status: null }))}
                  />
                </div>
              )}
              {opt.key === 'is_active' && (
                <div style={{ width: 140 }}>
                  <FilterSelect
                    placeholder="Hoạt động"
                    style={{ width: 140 }}
                    value={filterValues.is_active === null ? undefined : filterValues.is_active ? 'true' : 'false'}
                    onChange={(v) => applyFilterChange((p) => ({ ...p, is_active: v === undefined ? null : v === 'true' }))}
                    options={[
                      { label: 'Có', value: 'true' },
                      { label: 'Không', value: 'false' },
                    ]}
                    showClear
                    hasValue={filterValues.is_active !== null}
                    onClear={() => applyFilterChange((p) => ({ ...p, is_active: null }))}
                  />
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <Card variant="borderless" style={{ margin: 0, background: 'transparent', padding: 0 }}>
        <div style={{ background: 'white', padding: '16px 24px', borderRadius: '8px 8px 0 0', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>👥 Quản lý khách hàng</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <ListSearchInput
                placeholder="Tìm theo mã, tên, công ty, SĐT, email..."
                value={searchInput}
                onChange={(v) => setSearchInput(v)}
                onClear={() => { setSearchInput(''); setPagination((p) => ({ ...p, current: 1 })); }}
              />
              <Button icon={<FilterOutlined />} onClick={() => setFilterModalOpen(true)}>
                Lọc {activeFilters.length > 0 ? `(${activeFilters.length})` : ''}
              </Button>
              <Modal
                title="Bộ lọc khách hàng"
                open={filterModalOpen}
                onCancel={() => setFilterModalOpen(false)}
                footer={[
                  <Button key="clear" size="small" onClick={handleClearAllFilters}>Xóa hết bộ lọc</Button>,
                  <Button key="close" type="primary" onClick={() => setFilterModalOpen(false)}>Xong</Button>,
                ]}
                width={400}
              >
                {filterModalContent}
              </Modal>
              <ColumnChooser
                columns={columnChooserList}
                visibleColumns={visibleColumns ?? []}
                onChange={handleVisibleColumnsChange}
              />
              <Button icon={<UploadOutlined />} onClick={() => setImportModalVisible(true)}>Nhập Excel</Button>
              <Button icon={<ExportOutlined />} onClick={() => handleExport('excel')}>Xuất Excel</Button>
              <Button icon={<ExportOutlined />} onClick={() => handleExport('pdf')}>Xuất PDF</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>Thêm mới</Button>
              {selectedCount > 0 && (
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    if (selectedIds.length === 0) { message.warning(TOAST.SELECT_AT_LEAST_ONE); return; }
                    confirmBulkDelete(selectedCount, () => bulkDeleteMutation.mutateAsync(selectedIds));
                  }}
                >
                  Xóa ({selectedCount})
                </Button>
              )}
            </div>
          </div>
        </div>

        <div style={{ background: 'white', padding: '0 24px 24px', borderRadius: '0 0 8px 8px' }}>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={results}
            loading={isLoading}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total,
              showSizeChanger: true,
              showTotal: (t) => `Tổng ${t} khách hàng`,
              onChange: (page, size) => setPagination((p) => ({ ...p, current: page, pageSize: size ?? p.pageSize })),
            }}
            rowSelection={rowSelection}
            scroll={{ x: 1200 }}
            size="small"
            locale={{ emptyText: <EmptyState description="Chưa có khách hàng. Nhấn Thêm mới để tạo." /> }}
          />
        </div>
      </Card>

      <CustomerForm visible={formVisible} onClose={() => { setFormVisible(false); setEditingCustomer(null); queryClient.invalidateQueries({ queryKey: ['customers'] }); }} editingCustomer={editingCustomer} />

      <ImportModal
        visible={importModalVisible}
        onClose={() => setImportModalVisible(false)}
        onSuccess={handleImportSuccess}
        onDownloadTemplate={() => customersApi.downloadTemplate().then((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'template_khach_hang.xlsx';
          a.click();
          URL.revokeObjectURL(url);
        })}
        onImport={(file, opts) => customersApi.importCustomers(file, opts)}
        entityName="khách hàng"
      />
    </>
  );
};

export default CustomerList;
