/**
 * Danh sách khách hàng - chuẩn ProductList:
 * - Icon thao tác (Xem, Nhân bản, Sửa, Xóa) - tím, xanh lá, xanh dương, đỏ
 * - Bộ lọc (Lọc) với modal chọn bộ lọc
 * - Cài đặt cột (ColumnChooser)
 * - Tìm kiếm, Xuất Excel/PDF, Nhập Excel, Thêm mới
 * - useUserPreferences (customers-list), useSearchFilterIntent
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Table,
  Button,
  Dropdown,
  message,
  Modal,
  Input,
  Card,
  Checkbox,
  Pagination,
  Space,
  Select,
  Segmented,
  Drawer,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  ExportOutlined,
  UploadOutlined,
  FilterOutlined,
  ReloadOutlined,
  MoreOutlined,
  HistoryOutlined,
  CheckOutlined,
  CloseOutlined,
  SendOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi, type ActivityItem } from '../../api/customers';
import type { Customer, CustomerStatus, ApprovalHistoryItem } from '../../types/customer';
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
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { TOAST } from '../../shared/toast';
import { PAGES } from '../../utils/constants';
import type { PreferencesConfig } from '../../types/preferences';

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

type ListViewMode = 'table' | 'cards';
type CardDensity = 'comfortable' | 'compact';
type DesktopTableDensity = 'comfortable' | 'compact';
type CustomerFormMode = 'create' | 'edit' | 'view';

const getCustomerStatusTone = (status: CustomerStatus | string | null | undefined): 'ok' | 'warn' | 'pending' | 'neutral' => {
  if (status === 'APPROVED') return 'ok';
  if (status === 'REJECTED') return 'warn';
  if (status === 'PENDING_APPROVAL') return 'pending';
  return 'neutral';
};

const getHistoryActionCode = (action: string | null | undefined): string => {
  const raw = String(action ?? '').trim().toUpperCase();
  if (raw.includes('SUBMIT')) return 'SUBMIT';
  if (raw.includes('APPROVE')) return 'APPROVE';
  if (raw.includes('REJECT')) return 'REJECT';
  if (raw.includes('CREATE')) return 'CREATE';
  if (raw.includes('UPDATE')) return 'UPDATE';
  if (raw.includes('DELETE')) return 'DELETE';
  if (raw.includes('IMPORT')) return 'IMPORT';
  if (raw.includes('EXPORT')) return 'EXPORT';
  if (raw.includes('COMMENT')) return 'COMMENT';
  return raw || 'UNKNOWN';
};

const getHistoryActionLabelVi = (action: string | null | undefined): string => {
  const code = getHistoryActionCode(action);
  const map: Record<string, string> = {
    SUBMIT: 'Trình duyệt',
    APPROVE: 'Duyệt',
    REJECT: 'Từ chối',
    CREATE: 'Tạo mới',
    UPDATE: 'Cập nhật',
    DELETE: 'Xóa',
    IMPORT: 'Nhập dữ liệu',
    EXPORT: 'Xuất dữ liệu',
    COMMENT: 'Bình luận',
    UNKNOWN: String(action ?? 'Không xác định'),
  };
  return map[code] ?? String(action ?? 'Không xác định');
};

const CUSTOMER_HISTORY_FIELD_LABELS: Record<string, string> = {
  code: 'Mã KH',
  name: 'Tên KH',
  company_name: 'Công ty',
  tax_code: 'Mã số thuế',
  phone: 'Điện thoại',
  email: 'Email',
  address: 'Địa chỉ',
  contact_person: 'Người liên hệ',
  contact_phone: 'SĐT liên hệ',
  payment_terms: 'Hạn TT (ngày)',
  credit_limit: 'Hạn mức',
  is_active: 'Hoạt động',
  status: 'Trạng thái',
  owner: 'Chủ sở hữu',
  team: 'Nhóm',
  reason: 'Lý do',
};

const getHistoryFieldLabelVi = (field: string): string => CUSTOMER_HISTORY_FIELD_LABELS[field] ?? field;

const formatHistoryValueVi = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'number') return value.toLocaleString('vi-VN');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const stableHistoryValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map((v) => stableHistoryValue(v)).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${k}:${stableHistoryValue(obj[k])}`).join('|')}}`;
  }
  return String(value);
};

const getActivityDedupKey = (item: ActivityItem): string => {
  const tsMs = new Date(item.timestamp).getTime();
  const tsSec = Number.isFinite(tsMs) ? Math.floor(tsMs / 1000) : 0;
  return [
    item.type,
    getHistoryActionCode(item.action),
    item.user ?? '',
    String(tsSec),
    stableHistoryValue(item.details?.changed_fields ?? []),
    stableHistoryValue(item.details?.old_values ?? {}),
    stableHistoryValue(item.details?.new_values ?? {}),
    String(item.details?.content ?? ''),
  ].join('||');
};

const buildFallbackDiffRows = (action: string, record?: Customer | null): Array<{ field: string; before: string; after: string }> => {
  const code = getHistoryActionCode(action);
  if (code === 'SUBMIT') return [{ field: 'status', before: 'Nháp', after: 'Chờ duyệt' }];
  if (code === 'APPROVE') return [{ field: 'status', before: 'Chờ duyệt', after: 'Đã duyệt' }];
  if (code === 'REJECT') return [{ field: 'status', before: 'Chờ duyệt', after: 'Từ chối' }];
  if (code === 'CREATE' && record) {
    return [
      { field: 'code', before: '-', after: record.code || '-' },
      { field: 'name', before: '-', after: record.name || '-' },
    ];
  }
  return [];
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
  exactSearch: boolean;
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
  const exactSearch = searchParams.get('exact_search') === '1' || searchParams.get('exact_search') === 'true';

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

  return { searchInput: q, search: q, filterValues, activeFilters, page, pageSize, exactSearch };
}

function customerListParamsToSearch(
  search: string,
  filterValues: FilterValues,
  activeFilters: FilterKey[],
  current: number,
  pageSize: number,
  exactSearch: boolean
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
  if (exactSearch) params.exact_search = '1';
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
  const [exactSearch, setExactSearch] = useState(parsed.exactSearch);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formMode, setFormMode] = useState<CustomerFormMode>('create');
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [viewMode, setViewMode] = useState<ListViewMode>(() => (window.innerWidth <= 768 ? 'cards' : 'table'));
  const [cardDensity, setCardDensity] = useState<CardDensity>('comfortable');
  const [desktopTableDensity, setDesktopTableDensity] = useState<DesktopTableDensity>('comfortable');
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyCustomer, setHistoryCustomer] = useState<Customer | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historyActionFilter, setHistoryActionFilter] = useState<string | undefined>(undefined);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectCustomer, setRejectCustomer] = useState<Customer | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const {
    visibleColumns,
    handleVisibleColumnsChange,
  } = useColumnSettings(PAGES.CUSTOMERS_LIST, {
    defaultVisibleColumns: DEFAULT_CUSTOMER_VISIBLE_COLUMNS,
  });
  const { config, saveConfig } = useUserPreferences(PAGES.CUSTOMERS_LIST);
  const configRef = useRef<PreferencesConfig>({});

  useEffect(() => {
    configRef.current = (config || {}) as PreferencesConfig;
  }, [config]);

  const savePreferences = useCallback(
    async (partial: PreferencesConfig) => {
      const merged = { ...(configRef.current || {}), ...(partial || {}) } as PreferencesConfig;
      configRef.current = merged;
      await saveConfig(merged);
    },
    [saveConfig]
  );

  useEffect(() => {
    const savedMode = config?.mobileListViewMode as ListViewMode | undefined;
    if (savedMode === 'table' || savedMode === 'cards') {
      setViewMode(savedMode);
    }
    const savedDensity = config?.mobileCardDensity as CardDensity | undefined;
    if (savedDensity === 'comfortable' || savedDensity === 'compact') {
      setCardDensity(savedDensity);
    }
    const savedDesktopDensity = config?.desktopTableDensity as DesktopTableDensity | undefined;
    if (savedDesktopDensity === 'comfortable' || savedDesktopDensity === 'compact') {
      setDesktopTableDensity(savedDesktopDensity);
    }
    if (config?.sort && typeof config.sort === 'object' && (config.sort as { field?: string; order?: 'asc' | 'desc' }).field && (config.sort as { field?: string; order?: 'asc' | 'desc' }).order) {
      const s = config.sort as { field: string; order: 'asc' | 'desc' };
      setSortField(s.field);
      setSortOrder(s.order);
    }
  }, [config]);

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
      ordering: sortField ? `${sortOrder === 'desc' ? '-' : ''}${sortField}` : 'code',
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
    if (exactSearch) p.exact_search = '1';
    return p;
  }, [intentSearch, intentFilters, pagination.current, pagination.pageSize, exactSearch, sortField, sortOrder]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['customers', apiParams],
    queryFn: () => customersApi.getCustomers(apiParams as Record<string, string>),
  });

  const { data: activityStream = [], isLoading: isHistoryLoading } = useQuery<ActivityItem[]>({
    queryKey: ['customers', 'activity', historyCustomer?.id ?? null],
    queryFn: () => customersApi.getActivityByEntity('Customer', historyCustomer!.id),
    enabled: historyModalOpen && historyCustomer != null,
  });

  const { data: approvalHistory = [], isLoading: isApprovalHistoryLoading } = useQuery<ApprovalHistoryItem[]>({
    queryKey: ['customers', 'approval-history-fallback', historyCustomer?.id ?? null],
    queryFn: () => customersApi.getApprovalHistory(historyCustomer!.id),
    enabled: historyModalOpen && historyCustomer != null,
  });

  const mergedActivity = useMemo<ActivityItem[]>(() => {
    const fromApproval: ActivityItem[] = approvalHistory.map((h) => ({
      type: 'audit',
      action: h.action,
      user: h.user,
      timestamp: h.created_at,
      details: {
        content: h.comments ?? undefined,
      },
    }));
    const all = [...activityStream, ...fromApproval];
    const unique = new Map<string, ActivityItem>();
    all.forEach((item) => {
      const key = getActivityDedupKey(item);
      if (!unique.has(key)) unique.set(key, item);
    });
    const normalized = Array.from(unique.values());
    const hasCreate = normalized.some((item) => getHistoryActionCode(item.action) === 'CREATE');

    if (historyCustomer && !hasCreate && historyCustomer.created_at) {
      normalized.push({
        type: 'audit',
        action: 'CREATE',
        user: historyCustomer.created_by_username ?? null,
        timestamp: historyCustomer.created_at,
        details: { content: 'Bản ghi được tạo.' },
      });
    }

    return normalized.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activityStream, approvalHistory, historyCustomer]);

  const filteredActivity = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return mergedActivity.filter((item) => {
      if (historyActionFilter && getHistoryActionCode(item.action) !== historyActionFilter) return false;
      if (!q) return true;
      const content = [
        getHistoryActionLabelVi(item.action),
        item.user ?? '',
        item.details?.content ?? '',
        JSON.stringify(item.details?.old_values ?? {}),
        JSON.stringify(item.details?.new_values ?? {}),
        (item.details?.changed_fields ?? []).join(','),
      ].join(' ').toLowerCase();
      return content.includes(q);
    });
  }, [mergedActivity, historyActionFilter, historySearch]);

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
    const params = customerListParamsToSearch(intentSearch, intentFilters, activeFilters, pagination.current, pagination.pageSize, exactSearch);
    setSearchParams(params, { replace: true });
  }, [intentSearch, intentFilters, activeFilters, pagination, exactSearch, setSearchParams]);

  useEffect(() => {
    syncUrl();
  }, [intentSearch, intentFilters, activeFilters, pagination.current, pagination.pageSize, exactSearch]);

  const handleAdd = () => {
    setFormMode('create');
    setEditingCustomer(null);
    setFormVisible(true);
  };

  const handleEdit = (record: Customer) => {
    setFormMode('edit');
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

  const handleSubmitForApproval = async (record: Customer) => {
    try {
      await customersApi.submitForApproval(record.id);
      message.success('Đã gửi duyệt.');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch (err: unknown) {
      message.error((err as Error)?.message ?? 'Gửi duyệt thất bại');
    }
  };

  const handleApprove = async (record: Customer) => {
    try {
      await customersApi.approve(record.id);
      message.success('Đã duyệt khách hàng.');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch (err: unknown) {
      message.error((err as Error)?.message ?? 'Duyệt thất bại');
    }
  };

  const openRejectModal = (record: Customer) => {
    setRejectCustomer(record);
    setRejectReason('');
    setRejectModalOpen(true);
  };

  const handleRejectConfirm = async () => {
    if (!rejectCustomer) return;
    if (!rejectReason.trim()) {
      message.warning('Vui lòng nhập lý do từ chối.');
      return;
    }
    try {
      await customersApi.reject(rejectCustomer.id, rejectReason.trim());
      message.success('Đã từ chối yêu cầu duyệt.');
      setRejectModalOpen(false);
      setRejectCustomer(null);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch (err: unknown) {
      message.error((err as Error)?.message ?? 'Từ chối thất bại');
    }
  };

  const openHistoryModal = (record: Customer) => {
    setHistoryCustomer(record);
    setHistorySearch('');
    setHistoryActionFilter(undefined);
    setHistoryModalOpen(true);
  };

  const handleClone = (record: Customer) => {
    const cloned = { ...record };
    delete (cloned as Record<string, unknown>).id;
    delete (cloned as Record<string, unknown>).code;
    (cloned as Record<string, unknown>).name = `${record.name} (Copy)`;
    setFormMode('create');
    setEditingCustomer(cloned);
    setFormVisible(true);
  };

  const handleRowAction = (action: string, record: Customer) => {
    if (action === 'copy') {
      handleClone(record);
      return;
    }
    if (action === 'history') {
      openHistoryModal(record);
      return;
    }
    if (action === 'submit') {
      void handleSubmitForApproval(record);
      return;
    }
    if (action === 'approve') {
      void handleApprove(record);
      return;
    }
    if (action === 'reject') {
      openRejectModal(record);
      return;
    }
    if (action === 'delete') {
      confirmDeleteOne(record.name || record.code || String(record.id), () => handleDelete(record.id));
    }
  };

  const renderRowActions = (record: Customer) => (
    <div className="table-row-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            ...(record.status === 'DRAFT' ? [{ key: 'submit', icon: <SendOutlined />, label: 'Trình duyệt' }] : []),
            ...(record.status === 'PENDING_APPROVAL'
              ? [
                { key: 'approve', icon: <CheckOutlined />, label: 'Duyệt' },
                { key: 'reject', icon: <CloseOutlined />, label: 'Từ chối', danger: true },
              ]
              : []),
            { key: 'history', icon: <HistoryOutlined />, label: 'Lịch sử hoạt động' },
            { key: 'copy', icon: <CopyOutlined />, label: 'Nhân bản' },
            { type: 'divider' as const },
            { key: 'delete', icon: <DeleteOutlined />, label: 'Xóa', danger: true },
          ] as MenuProps['items'],
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            handleRowAction(String(key), record);
          },
        }}
      >
        <Button className="table-row-action-btn action-more" type="text" size="small" icon={<MoreOutlined style={{ fontSize: 18 }} />} onClick={(e) => e.stopPropagation()} title="Thao tác" />
      </Dropdown>
    </div>
  );

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

  const handleViewModeChange = useCallback((mode: ListViewMode) => {
    setViewMode(mode);
    void savePreferences({ mobileListViewMode: mode });
  }, [savePreferences]);

  const handleCardDensityChange = useCallback((density: CardDensity) => {
    setCardDensity(density);
    void savePreferences({ mobileCardDensity: density });
  }, [savePreferences]);

  const handleDesktopTableDensityChange = useCallback((density: DesktopTableDensity) => {
    setDesktopTableDensity(density);
    void savePreferences({ desktopTableDensity: density });
  }, [savePreferences]);

  const handleSort = useCallback(
    async (orderingParam: string) => {
      let newOrder: 'asc' | 'desc' | null = null;
      if (sortField === orderingParam) {
        if (sortOrder === 'asc') newOrder = 'desc';
        else if (sortOrder === 'desc') newOrder = null;
      } else {
        newOrder = 'asc';
      }
      if (newOrder === null) {
        setSortField(null);
        setSortOrder(null);
        await savePreferences({ sort: undefined });
      } else {
        setSortField(orderingParam);
        setSortOrder(newOrder);
        await savePreferences({ sort: { field: orderingParam, order: newOrder } });
      }
      setPagination((p) => ({ ...p, current: 1 }));
    },
    [sortField, sortOrder, savePreferences]
  );

  const handleFormClose = useCallback(() => {
    setFormVisible(false);
    setFormMode('create');
    setEditingCustomer(null);
    queryClient.invalidateQueries({ queryKey: ['customers'] });
  }, [queryClient]);

  const SortIcon = ({ orderingParam }: { orderingParam: string }) => {
    if (sortField !== orderingParam) {
      return <span style={{ color: '#bfbfbf', fontSize: 10, marginLeft: 2 }}>⇅</span>;
    }
    return (
      <span style={{ color: '#1890ff', fontSize: 10, fontWeight: 'bold', marginLeft: 2 }}>
        {sortOrder === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  const addSortToColumn = <T extends Record<string, unknown>>(col: T & { key?: string; title?: React.ReactNode; sortField?: string }): T => {
    if (col.key === 'actions' || !col.sortField) return col;
    const label = typeof col.title === 'string' ? col.title : col.title;
    const orderingParam = col.sortField;
    return {
      ...col,
      title: (
        <div
          onClick={(e) => { e.stopPropagation(); void handleSort(orderingParam); }}
          style={{ cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}
        >
          {label}
          <SortIcon orderingParam={orderingParam} />
        </div>
      ),
    } as T;
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
    { title: 'Tên KH', dataIndex: 'name', key: 'name', sortField: 'name', width: 180, ellipsis: true, render: (n: string) => <span className="cell-text-primary">{n ?? '-'}</span> },
    { title: 'Công ty', dataIndex: 'company_name', key: 'company_name', sortField: 'company_name', width: 160, ellipsis: true, render: (t: string) => <span className="cell-text-secondary">{t ?? '-'}</span> },
    { title: 'Điện thoại', dataIndex: 'phone', key: 'phone', sortField: 'phone', width: 110, render: (t: string) => t ?? '-' },
    { title: 'Email', dataIndex: 'email', key: 'email', sortField: 'email', width: 160, ellipsis: true, render: (t: string) => t ?? '-' },
    { title: 'Mã số thuế', dataIndex: 'tax_code', key: 'tax_code', sortField: 'tax_code', width: 100, render: (t: string) => t ?? '-' },
    { title: 'Người liên hệ', dataIndex: 'contact_person', key: 'contact_person', sortField: 'contact_person', width: 120, ellipsis: true, render: (t: string) => t ?? '-' },
    { title: 'SĐT liên hệ', dataIndex: 'contact_phone', key: 'contact_phone', sortField: 'contact_phone', width: 110, render: (t: string) => t ?? '-' },
    {
      title: 'Hạn TT (ngày)',
      dataIndex: 'payment_terms',
      key: 'payment_terms',
      sortField: 'payment_terms',
      width: 90,
      align: 'right' as const,
      render: (v: number) => {
        if (v == null) return '-';
        return <span className={v >= 45 ? 'cell-warning-soft' : undefined}>{v}</span>;
      },
    },
    { title: 'Hạn mức', dataIndex: 'credit_limit', key: 'credit_limit', sortField: 'credit_limit', width: 100, align: 'right' as const, render: (v: number) => v != null ? v.toLocaleString('vi-VN') : '-' },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      sortField: 'status',
      width: 110,
      align: 'center' as const,
      render: (v: string) => {
        const label = (CUSTOMER_STATUS_LABELS as Record<string, string>)[v] ?? v ?? '-';
        return (
          <span className={`status-pill status-pill-${getCustomerStatusTone(v)}`}>
            {label}
          </span>
        );
      },
    },
    {
      title: 'Hoạt động',
      dataIndex: 'is_active',
      key: 'is_active',
      sortField: 'is_active',
      width: 80,
      align: 'center' as const,
      render: (v: boolean) => (
        <span className={`status-pill ${v ? 'status-pill-ok' : 'status-pill-warn'}`}>
          {v ? 'Có' : 'Không'}
        </span>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      fixed: 'right' as const,
      width: 72,
      align: 'center' as const,
      render: (_: unknown, record: Customer) => renderRowActions(record),
    },
  ];

  const allColumns: ColumnsType<Customer> = allColumnsBase.map((col) => addSortToColumn(col as Record<string, unknown> & { key?: string; title?: React.ReactNode; sortField?: string }));

  const columnKeyToTitle: Record<string, string> = {};
  allColumnsBase.forEach((col) => {
    if (typeof col.title === 'string') columnKeyToTitle[col.key as string] = col.title;
  });
  const columnChooserList = allColumnsBase.map((col) => ({
    key: col.key as string,
    title: columnKeyToTitle[col.key as string] ?? (col.key as string),
    required: col.key === 'code' || col.key === 'name',
  }));

  const displayColumns = allColumns.filter((col) => (visibleColumns ?? []).includes(col.key as string));
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

  const showCards = isMobile && viewMode === 'cards';
  const showTable = !isMobile || viewMode === 'table';
  const isCompactCards = cardDensity === 'compact';

  return (
    <>
      <Card className="list-page-card" variant="borderless" style={{ margin: 0, background: 'transparent', padding: 0 }}>
        <div className="list-page-head" style={{ background: 'white', padding: isMobile ? '12px' : '16px 24px', borderRadius: '8px 8px 0 0', marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>👥 Quản lý khách hàng</h2>
            </div>
            <div className="list-page-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flex: '1 1 420px', justifyContent: isMobile ? 'flex-start' : 'flex-end', position: isMobile ? 'sticky' : 'static', top: isMobile ? 64 : 'auto', zIndex: isMobile ? 3 : 'auto', background: isMobile ? '#fff' : 'transparent', paddingBottom: isMobile ? 4 : 0 }}>
              <Checkbox
                checked={exactSearch}
                onChange={(e) => setExactSearch(e.target.checked)}
                style={{ whiteSpace: 'nowrap' }}
              >
                Tìm chính xác
              </Checkbox>
              <ListSearchInput
                placeholder="Tìm theo mã, tên, công ty, SĐT, email..."
                value={searchInput}
                onChange={(v) => setSearchInput(v)}
                onClear={() => { setSearchInput(''); setPagination((p) => ({ ...p, current: 1 })); }}
                size={isMobile ? 'small' : 'middle'}
                className={isMobile ? 'mobile-list-search-compact' : undefined}
                style={isMobile ? { width: '100%' } : undefined}
              />
              {!isMobile && (
                <Segmented
                  size="small"
                  value={desktopTableDensity}
                  onChange={(value) => handleDesktopTableDensityChange(value as DesktopTableDensity)}
                  options={[
                    { label: 'Thoáng', value: 'comfortable' },
                    { label: 'Gọn', value: 'compact' },
                  ]}
                />
              )}
              {!isMobile && (
                <Button icon={<FilterOutlined />} onClick={() => setFilterModalOpen(true)} title="Lọc">
                  {`Lọc ${activeFilters.length > 0 ? `(${activeFilters.length})` : ''}`}
              </Button>
              )}
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
              {!isMobile && (
              <ColumnChooser
                columns={columnChooserList}
                visibleColumns={visibleColumns ?? []}
                onChange={handleVisibleColumnsChange}
              />
              )}
              {!isMobile && <Button icon={<UploadOutlined />} onClick={() => setImportModalVisible(true)} title="Nhập Excel">Nhập Excel</Button>}
              {!isMobile && <Button icon={<ExportOutlined />} onClick={() => handleExport('excel')} title="Xuất Excel">Xuất Excel</Button>}
              {!isMobile && <Button icon={<ExportOutlined />} onClick={() => handleExport('pdf')} title="Xuất PDF">Xuất PDF</Button>}
              {!isMobile && <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} title="Thêm mới">Thêm mới</Button>}
              {(!isMobile || viewMode === 'table') && selectedCount > 0 && (
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

        <div className="list-page-table-wrap" style={{ background: 'white', padding: isMobile ? '0 12px 76px' : '0 24px 24px', borderRadius: '0 0 8px 8px' }}>
          {showTable && (
          <Table
            className={`enterprise-data-table ${desktopTableDensity === 'compact' ? 'table-density-compact' : 'table-density-comfortable'}`}
            rowKey="id"
            columns={columns}
            dataSource={results}
            loading={isLoading}
            pagination={false}
            rowSelection={rowSelection}
            scroll={{ x: 'max-content' }}
            size="middle"
            bordered
            locale={{ emptyText: <EmptyState description="Chưa có khách hàng. Nhấn Thêm mới để tạo." /> }}
          />
          )}
          {showCards && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.length === 0 && !isLoading && (
                <EmptyState description="Chưa có khách hàng. Nhấn Thêm mới để tạo." />
              )}
              {results.map((record) => (
                <Card key={record.id} size="small" style={{ borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: theme.colors.primary, fontSize: isCompactCards ? 13 : 14 }}>{record.code || '-'}</div>
                      <div style={{ fontWeight: 500, fontSize: isCompactCards ? 13 : 14 }}>{record.name || '-'}</div>
                      <div style={{ color: '#595959', fontSize: isCompactCards ? 12 : 13 }}>{record.company_name || 'Không có công ty'}</div>
                    </div>
                    {renderRowActions(record)}
                  </div>
                  <div style={{ marginTop: isCompactCards ? 6 : 8, fontSize: isCompactCards ? 12 : 13, color: '#595959' }}>
                    <div>Điện thoại: {record.phone || '-'}</div>
                    <div>Email: {record.email || '-'}</div>
                    <div>Trạng thái: {(CUSTOMER_STATUS_LABELS as Record<string, string>)[record.status] ?? record.status ?? '-'}</div>
        </div>
      </Card>
              ))}
            </div>
          )}
        </div>

        {!isMobile && (
          <div
            className="customers-list-bottom-bar"
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
                  Tổng {total} khách hàng
                </span>
                <Pagination
                  current={pagination.current}
                  pageSize={pagination.pageSize}
                  total={total}
                  showSizeChanger={false}
                  onChange={(page) => setPagination((p) => ({ ...p, current: page }))}
                  size="small"
                />
                <Select
                  size="small"
                  value={pagination.pageSize}
                  style={{ width: 96 }}
                  onChange={(size) => setPagination((p) => ({ ...p, current: 1, pageSize: size }))}
                  options={[
                    { value: 10, label: '10 / trang' },
                    { value: 20, label: '20 / trang' },
                    { value: 50, label: '50 / trang' },
                    { value: 100, label: '100 / trang' },
                  ]}
                />
              </Space>
            </div>
          </div>
        )}
      </Card>

      {isMobile && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            zIndex: 8,
            background: 'rgba(255, 255, 255, 0.96)',
            backdropFilter: 'blur(6px)',
            borderTop: '1px solid #f0f0f0',
            padding: '8px 12px calc(8px + env(safe-area-inset-bottom))',
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            flexWrap: 'nowrap',
          }}
        >
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void refetch()} title="Làm mới" />
          <div className="mobile-sticky-pagination" style={{ minWidth: 132 }}>
            <Pagination
              className="mobile-sticky-pagination-control"
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={total}
              showSizeChanger={false}
              simple
              onChange={(page) => setPagination((p) => ({ ...p, current: page }))}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button size="small" icon={<MoreOutlined />} onClick={() => setMobileActionsOpen(true)} title="Tác vụ" />
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleAdd} title="Thêm mới" />
          </div>
        </div>
      )}

      <Drawer
        title="Tác vụ nhanh"
        placement="bottom"
        height={320}
        onClose={() => setMobileActionsOpen(false)}
        open={mobileActionsOpen}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Segmented
            value={viewMode}
            onChange={(value) => handleViewModeChange(value as ListViewMode)}
            options={[
              { label: 'Thẻ', value: 'cards' },
              { label: 'Bảng', value: 'table' },
            ]}
          />
          {viewMode === 'cards' && (
            <Segmented
              value={cardDensity}
              onChange={(value) => handleCardDensityChange(value as CardDensity)}
              options={[
                { label: 'Thoáng', value: 'comfortable' },
                { label: 'Gọn', value: 'compact' },
              ]}
            />
          )}
          <Button icon={<FilterOutlined />} onClick={() => { setFilterModalOpen(true); setMobileActionsOpen(false); }}>
            Lọc {activeFilters.length > 0 ? `(${activeFilters.length})` : ''}
          </Button>
          <ColumnChooser
            columns={columnChooserList}
            visibleColumns={visibleColumns ?? []}
            onChange={handleVisibleColumnsChange}
          />
          <Button icon={<UploadOutlined />} onClick={() => { setImportModalVisible(true); setMobileActionsOpen(false); }}>
            Nhập Excel
          </Button>
          <Button icon={<ExportOutlined />} onClick={() => { void handleExport('excel'); setMobileActionsOpen(false); }}>
            Xuất Excel
          </Button>
          <Button icon={<ExportOutlined />} onClick={() => { void handleExport('pdf'); setMobileActionsOpen(false); }}>
            Xuất PDF
          </Button>
          <Button danger onClick={() => { handleClearAllFilters(); setMobileActionsOpen(false); }}>
            Xóa toàn bộ bộ lọc
          </Button>
        </div>
      </Drawer>

      <CustomerForm visible={formVisible} onClose={handleFormClose} editingCustomer={editingCustomer} mode={formMode} />

      <Modal
        title={`Lịch sử hoạt động${historyCustomer ? ` - ${historyCustomer.code}` : ''}`}
        open={historyModalOpen}
        onCancel={() => {
          setHistoryModalOpen(false);
          setHistoryCustomer(null);
        }}
        footer={<Button size="middle" onClick={() => { setHistoryModalOpen(false); setHistoryCustomer(null); }}>Đóng</Button>}
        width={920}
      >
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <Input
            placeholder="Tìm theo hành động, người thao tác, nội dung..."
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
            style={{ flex: '1 1 360px' }}
            size="large"
          />
          <Select
            allowClear
            placeholder="Lọc hành động"
            value={historyActionFilter}
            onChange={(v) => setHistoryActionFilter(v)}
            style={{ width: 220 }}
            size="large"
            options={[
              { value: 'CREATE', label: 'Tạo mới' },
              { value: 'UPDATE', label: 'Cập nhật' },
              { value: 'SUBMIT', label: 'Trình duyệt' },
              { value: 'APPROVE', label: 'Duyệt' },
              { value: 'REJECT', label: 'Từ chối' },
              { value: 'COMMENT', label: 'Bình luận' },
              { value: 'IMPORT', label: 'Nhập dữ liệu' },
              { value: 'EXPORT', label: 'Xuất dữ liệu' },
              { value: 'DELETE', label: 'Xóa' },
            ]}
          />
        </div>
        {(isHistoryLoading || isApprovalHistoryLoading) && <div style={{ fontSize: 14 }}>Đang tải lịch sử...</div>}
        {!isHistoryLoading && !isApprovalHistoryLoading && filteredActivity.length === 0 && (
          <div style={{ color: '#6b7280', fontSize: 14 }}>Chưa có dữ liệu phù hợp.</div>
        )}
        {!isHistoryLoading && !isApprovalHistoryLoading && filteredActivity.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '62vh', overflowY: 'auto' }}>
            {filteredActivity.map((item, idx) => (
              <div key={`${item.timestamp}-${idx}`} style={{ border: '1px solid #e6ebf2', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: '#1f2937' }}>{getHistoryActionLabelVi(item.action)}</div>
                  <div style={{ fontSize: 13, color: '#667085' }}>
                    {item.user || 'Hệ thống'} - {new Date(item.timestamp).toLocaleString('vi-VN')}
                  </div>
                </div>
                  <div style={{ marginTop: 4, fontSize: 13, color: '#667085' }}>
                    Loại bản ghi: {item.type === 'comment' ? 'Bình luận' : 'Nhật ký hệ thống'}
                  </div>
                {item.details?.content && <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.45 }}>{item.details.content}</div>}
                  {(() => {
                    const oldVals = (item.details?.old_values as Record<string, unknown> | undefined) ?? {};
                    const newVals = (item.details?.new_values as Record<string, unknown> | undefined) ?? {};
                    const fields = Array.from(new Set([...Object.keys(oldVals), ...Object.keys(newVals)]));
                    const fallbackRows = buildFallbackDiffRows(item.action, historyCustomer);
                    const hasRealDiff = fields.length > 0;
                    const hasFallbackDiff = fallbackRows.length > 0;
                    if (!hasRealDiff && !hasFallbackDiff) {
                      return (
                        <div style={{ marginTop: 8, fontSize: 13, color: '#98a2b3' }}>
                          Chưa có dữ liệu Trước/Sau chi tiết cho bản ghi này.
                        </div>
                      );
                    }
                    return (
                    <div style={{ marginTop: 8, fontSize: 14, color: '#334155', display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.45 }}>
                      {fields.map((field) => (
                        <div key={field} style={{ display: 'grid', gridTemplateColumns: '190px 1fr 1fr', gap: 10 }}>
                          <div style={{ color: '#1f2937', fontWeight: 700 }}>{getHistoryFieldLabelVi(field)}</div>
                          <div>Trước: {formatHistoryValueVi(oldVals[field])}</div>
                          <div>Sau: {formatHistoryValueVi(newVals[field])}</div>
                        </div>
                      ))}
                      {!hasRealDiff && hasFallbackDiff && fallbackRows.map((row) => (
                        <div key={`fb-${row.field}`} style={{ display: 'grid', gridTemplateColumns: '190px 1fr 1fr', gap: 10 }}>
                          <div style={{ color: '#1f2937', fontWeight: 700 }}>{getHistoryFieldLabelVi(row.field)}</div>
                          <div>Trước: {row.before}</div>
                          <div>Sau: {row.after}</div>
                        </div>
                      ))}
                  </div>
                    );
                  })()}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        title={`Từ chối duyệt${rejectCustomer ? ` - ${rejectCustomer.code}` : ''}`}
        open={rejectModalOpen}
        onCancel={() => {
          setRejectModalOpen(false);
          setRejectCustomer(null);
          setRejectReason('');
        }}
        onOk={() => void handleRejectConfirm()}
        okText="Xác nhận từ chối"
        okButtonProps={{ danger: true }}
        cancelText="Hủy"
      >
        <Input.TextArea
          rows={4}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Nhập lý do từ chối..."
        />
      </Modal>

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
