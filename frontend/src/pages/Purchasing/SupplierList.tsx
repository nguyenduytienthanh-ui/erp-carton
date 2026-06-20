import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Rate,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import {
  CheckCircleOutlined,
  EditOutlined,
  EyeOutlined,
  FilterOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { purchasingApi } from '../../api/purchasing';
import ColumnChooser from '../../components/ColumnChooser';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { parseApiError } from '../../shared/apiError';
import type { PreferencesConfig } from '../../types/preferences';
import type { Supplier } from '../../types/purchasing';
import { canManagePurchasingData } from '../../utils/authz';
import { PAGES } from '../../utils/constants';
import './SupplierList.css';

const { Text, Title } = Typography;

type SupplierStatusFilter = 'active' | 'inactive' | 'all';
type SupplierPreferredFilter = 'all' | 'preferred' | 'normal';
type SupplierProfileFilter = 'all' | 'missing' | 'has_contact';
type SupplierDrawerMode = 'create' | 'edit' | 'view';
type SupplierDensity = 'comfortable' | 'compact';
type SupplierFormValues = Omit<Supplier, 'id' | 'created_at' | 'updated_at'>;

type SupplierFilters = {
  status: SupplierStatusFilter;
  preferred: SupplierPreferredFilter;
  profile: SupplierProfileFilter;
  tax_code: string;
  tax_code_exact: boolean;
  phone: string;
  email: string;
  payment_terms_days: number | null;
  rating_min: number | null;
};

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SORT = { field: 'code', order: 'asc' as const };
const PAYMENT_PRESETS = [0, 7, 15, 30, 45, 60];
const DEFAULT_VISIBLE_COLUMNS = [
  'code',
  'name',
  'company_name',
  'tax_code',
  'contact_person',
  'phone',
  'payment_terms_days',
  'quality',
  'status',
  'actions',
];

const EMPTY_FILTERS: SupplierFilters = {
  status: 'active',
  preferred: 'all',
  profile: 'all',
  tax_code: '',
  tax_code_exact: false,
  phone: '',
  email: '',
  payment_terms_days: null,
  rating_min: null,
};

const emptyForm: SupplierFormValues = {
  code: '',
  name: '',
  company_name: '',
  tax_code: '',
  phone: '',
  email: '',
  address: '',
  contact_person: '',
  contact_phone: '',
  payment_terms_days: 30,
  is_preferred: false,
  rating: 3,
  note: '',
  is_active: true,
};

function serializeFilters(filters: SupplierFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string | undefined): SupplierFilters {
  if (!raw) return { ...EMPTY_FILTERS };
  try {
    const parsed = JSON.parse(raw) as Partial<SupplierFilters>;
    return normalizeFilters(parsed);
  } catch {
    return { ...EMPTY_FILTERS };
  }
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFilters(raw: unknown): SupplierFilters {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Partial<SupplierFilters>;
  const status: SupplierStatusFilter = parsed.status === 'inactive' || parsed.status === 'all' ? parsed.status : 'active';
  const preferred: SupplierPreferredFilter =
    parsed.preferred === 'preferred' || parsed.preferred === 'normal' ? parsed.preferred : 'all';
  const profile: SupplierProfileFilter =
    parsed.profile === 'missing' || parsed.profile === 'has_contact' ? parsed.profile : 'all';
  return {
    status,
    preferred,
    profile,
    tax_code: String(parsed.tax_code ?? ''),
    tax_code_exact: parsed.tax_code_exact === true,
    phone: String(parsed.phone ?? ''),
    email: String(parsed.email ?? ''),
    payment_terms_days: toOptionalNumber(parsed.payment_terms_days),
    rating_min: toOptionalNumber(parsed.rating_min),
  };
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('vi-VN');
}

function hasAnyContact(row: Supplier): boolean {
  return Boolean(row.contact_person || row.phone || row.email || row.contact_phone);
}

function hasMissingProfile(row: Supplier): boolean {
  return !row.tax_code || !hasAnyContact(row);
}

function getProfileTone(row: Supplier): 'success' | 'warning' {
  return hasMissingProfile(row) ? 'warning' : 'success';
}

function getProfileText(row: Supplier): string {
  if (!row.tax_code && !hasAnyContact(row)) return 'Thiếu MST & liên hệ';
  if (!row.tax_code) return 'Thiếu MST';
  if (!hasAnyContact(row)) return 'Thiếu liên hệ';
  return 'Đủ hồ sơ';
}

function toFormValues(row?: Supplier | null): SupplierFormValues {
  if (!row) return { ...emptyForm };
  return {
    code: row.code ?? '',
    name: row.name ?? '',
    company_name: row.company_name ?? '',
    tax_code: row.tax_code ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    contact_person: row.contact_person ?? '',
    contact_phone: row.contact_phone ?? '',
    payment_terms_days: toNumber(row.payment_terms_days, 30),
    is_preferred: Boolean(row.is_preferred),
    rating: toNumber(row.rating, 3),
    note: row.note ?? '',
    is_active: Boolean(row.is_active),
  };
}

function trimPayload(values: SupplierFormValues): SupplierFormValues {
  return {
    ...values,
    code: String(values.code || '').trim().toUpperCase(),
    name: String(values.name || '').trim(),
    company_name: String(values.company_name || '').trim(),
    tax_code: String(values.tax_code || '').trim(),
    phone: String(values.phone || '').trim(),
    email: String(values.email || '').trim().toLowerCase(),
    address: String(values.address || '').trim(),
    contact_person: String(values.contact_person || '').trim(),
    contact_phone: String(values.contact_phone || '').trim(),
    note: String(values.note || '').trim(),
    payment_terms_days: Math.max(0, toNumber(values.payment_terms_days, 30)),
    rating: Math.min(5, Math.max(1, toNumber(values.rating, 3))),
    is_preferred: Boolean(values.is_preferred),
    is_active: values.is_active !== false,
  };
}

function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="supplier-form-section">
      <div className="supplier-form-section-head">
        <div className="supplier-form-section-title">{title}</div>
        {description ? <div className="supplier-form-section-desc">{description}</div> : null}
      </div>
      {children}
    </section>
  );
}

export default function SupplierList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManagePurchasingData();
  const [searchInput, setSearchInput] = useState('');
  const [filtersOverride, setFiltersOverride] = useState<SupplierFilters | null>(null);
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<SupplierDrawerMode>('create');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [densityOverride, setDensityOverride] = useState<SupplierDensity | null>(null);
  const [sortFieldOverride, setSortFieldOverride] = useState<string | null | undefined>(undefined);
  const [sortOrderOverride, setSortOrderOverride] = useState<'asc' | 'desc' | null | undefined>(undefined);
  const [form] = Form.useForm<SupplierFormValues>();
  const { config, saveConfig } = useUserPreferences(PAGES.PURCHASING_SUPPLIERS);
  const configRef = useRef<PreferencesConfig>({});

  const { visibleColumns, handleVisibleColumnsChange } = useColumnSettings(PAGES.PURCHASING_SUPPLIERS, {
    defaultVisibleColumns: DEFAULT_VISIBLE_COLUMNS,
  });

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    configRef.current = (config || {}) as PreferencesConfig;
  }, [config]);

  const savePreferences = useCallback(
    async (partial: PreferencesConfig) => {
      const merged = { ...(configRef.current || {}), ...partial };
      configRef.current = merged;
      await saveConfig(merged);
    },
    [saveConfig],
  );

  const savedPageSize = Number((config as PreferencesConfig)?.pageSize ?? DEFAULT_PAGE_SIZE);
  const pageSize = Number.isFinite(savedPageSize) && savedPageSize > 0 ? savedPageSize : DEFAULT_PAGE_SIZE;
  const savedSort = (config as PreferencesConfig)?.sort;
  const sortField = sortFieldOverride === undefined ? (savedSort?.field || DEFAULT_SORT.field) : (sortFieldOverride || DEFAULT_SORT.field);
  const sortOrder = sortOrderOverride === undefined ? (savedSort?.order || DEFAULT_SORT.order) : (sortOrderOverride || DEFAULT_SORT.order);
  const savedDensity = (config as PreferencesConfig)?.density;
  const density: SupplierDensity =
    densityOverride ?? (savedDensity === 'compact' || savedDensity === 'comfortable' ? savedDensity : 'comfortable');
  const savedFilters = useMemo(() => normalizeFilters((config as PreferencesConfig)?.filters), [config]);
  const filters = filtersOverride ?? savedFilters;

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = {
      page,
      page_size: pageSize,
      ordering: `${sortOrder === 'desc' ? '-' : ''}${sortField}`,
    };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.status === 'active') next.is_active = 'true';
    if (intentFilters.status === 'inactive') next.is_active = 'false';
    if (intentFilters.preferred === 'preferred') next.is_preferred = 'true';
    if (intentFilters.preferred === 'normal') next.is_preferred = 'false';
    if (intentFilters.profile === 'missing') next.missing_profile = 'true';
    if (intentFilters.profile === 'has_contact') next.has_contact = 'true';
    if (intentFilters.tax_code.trim()) {
      next.tax_code = intentFilters.tax_code.trim();
      if (intentFilters.tax_code_exact) next.tax_code_exact = 'true';
    }
    if (intentFilters.phone.trim()) next.phone = intentFilters.phone.trim();
    if (intentFilters.email.trim()) next.email = intentFilters.email.trim();
    if (intentFilters.payment_terms_days != null) next.payment_terms_days = intentFilters.payment_terms_days;
    if (intentFilters.rating_min != null) next.rating_min = intentFilters.rating_min;
    return next;
  }, [intentFilters, intentSearch, page, pageSize, sortField, sortOrder]);

  const listQuery = useQuery({
    queryKey: ['purchasing-suppliers', params],
    queryFn: () => purchasingApi.getSuppliers(params),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['purchasing-suppliers'] });
  };

  const createMutation = useMutation({
    mutationFn: purchasingApi.createSupplier,
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SupplierFormValues> }) =>
      purchasingApi.updateSupplier(id, payload),
    onSuccess: invalidate,
  });

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const total = listQuery.data?.count ?? rows.length;

  const summary = useMemo(() => {
    const activeCount = rows.filter((row) => row.is_active).length;
    const preferredCount = rows.filter((row) => row.is_preferred).length;
    const missingProfileCount = rows.filter(hasMissingProfile).length;
    const avgRating = rows.length ? rows.reduce((acc, row) => acc + toNumber(row.rating), 0) / rows.length : 0;
    return { activeCount, preferredCount, missingProfileCount, avgRating };
  }, [rows]);

  const statusAlert = useMemo(() => {
    if (summary.missingProfileCount > 0) {
      return {
        type: 'warning' as const,
        message: `${summary.missingProfileCount} nhà cung cấp trên trang đang thiếu MST hoặc liên hệ.`,
        description: 'Nên bổ sung hồ sơ trước khi dùng cho đơn mua, bảng giá hoặc công nợ phải trả.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Danh mục nhà cung cấp đã đủ thông tin vận hành trên bộ lọc hiện tại.',
      description: 'Có thể tiếp tục dùng danh mục này cho bảng giá, đơn mua và phân tích nhà cung cấp.',
    };
  }, [summary.missingProfileCount]);

  const updateFilters = useCallback(
    (patch: Partial<SupplierFilters>) => {
      const next = normalizeFilters({ ...filters, ...patch });
      setFiltersOverride(next);
      void savePreferences({ filters: next });
      setPage(1);
    },
    [filters, savePreferences],
  );

  const clearFilters = useCallback(() => {
    setSearchInput('');
    setFiltersOverride({ ...EMPTY_FILTERS });
    setPage(1);
    void savePreferences({ filters: { ...EMPTY_FILTERS } });
  }, [savePreferences]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.status === 'active') tags.push('Đang dùng');
    if (intentFilters.status === 'inactive') tags.push('Ngưng dùng');
    if (intentFilters.status === 'all') tags.push('Tất cả trạng thái');
    if (intentFilters.preferred === 'preferred') tags.push('NCC ưu tiên');
    if (intentFilters.preferred === 'normal') tags.push('NCC thường');
    if (intentFilters.profile === 'missing') tags.push('Thiếu hồ sơ');
    if (intentFilters.profile === 'has_contact') tags.push('Có liên hệ');
    if (intentFilters.tax_code.trim()) tags.push(`MST: ${intentFilters.tax_code.trim()}`);
    if (intentFilters.phone.trim()) tags.push(`ĐT: ${intentFilters.phone.trim()}`);
    if (intentFilters.email.trim()) tags.push(`Email: ${intentFilters.email.trim()}`);
    if (intentFilters.payment_terms_days != null) tags.push(`Hạn TT: ${intentFilters.payment_terms_days} ngày`);
    if (intentFilters.rating_min != null) tags.push(`Rating từ ${intentFilters.rating_min}`);
    return tags;
  }, [intentFilters, intentSearch]);

  const activeFilterCount = activeFilterTags.filter((tag) => tag !== 'Đang dùng').length;

  const openDrawer = useCallback((mode: SupplierDrawerMode, row?: Supplier) => {
    setDrawerMode(mode);
    setSelectedSupplier(row ?? null);
    form.setFieldsValue(toFormValues(row));
    setDrawerOpen(true);
  }, [form]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedSupplier(null);
    setDrawerMode('create');
    form.resetFields();
  }, [form]);

  const applyApiFieldErrors = useCallback((error: unknown) => {
    const parsed = parseApiError(error);
    const fieldEntries = Object.entries(parsed.fieldErrors);
    if (fieldEntries.length > 0) {
      form.setFields(fieldEntries.map(([name, errorText]) => ({ name: [name as keyof SupplierFormValues], errors: [errorText] })));
    }
    messageApi.error(parsed.generalMessage || 'Không thể lưu nhà cung cấp.');
  }, [form, messageApi]);

  const onSubmit = async () => {
    if (drawerMode === 'view') return;
    try {
      const values = await form.validateFields();
      const payload = trimPayload(values);
      if (drawerMode === 'edit' && selectedSupplier) {
        await updateMutation.mutateAsync({ id: selectedSupplier.id, payload });
        messageApi.success('Đã cập nhật nhà cung cấp');
      } else {
        await createMutation.mutateAsync(payload);
        messageApi.success('Đã thêm nhà cung cấp');
      }
      closeDrawer();
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      applyApiFieldErrors(error);
    }
  };

  const handleSetActive = useCallback((row: Supplier, isActive: boolean) => {
    const actionText = isActive ? 'kích hoạt lại' : 'ngừng sử dụng';
    Modal.confirm({
      title: `${isActive ? 'Kích hoạt lại' : 'Ngừng sử dụng'} nhà cung cấp ${row.code}?`,
      content: isActive
        ? 'Nhà cung cấp sẽ xuất hiện lại trong danh sách đang dùng.'
        : 'Nhà cung cấp không bị xóa dữ liệu; các chứng từ cũ vẫn được giữ nguyên.',
      okText: isActive ? 'Kích hoạt lại' : 'Ngừng sử dụng',
      cancelText: 'Hủy',
      okButtonProps: { danger: !isActive },
      onOk: async () => {
        await updateMutation.mutateAsync({ id: row.id, payload: { is_active: isActive } });
        messageApi.success(`Đã ${actionText} nhà cung cấp`);
      },
    });
  }, [messageApi, updateMutation]);

  const handleDensityChange = useCallback((value: SupplierDensity) => {
    setDensityOverride(value);
    void savePreferences({ density: value });
  }, [savePreferences]);

  const handleTableChange = useCallback((
    _pagination: TablePaginationConfig,
    _filters: Record<string, unknown>,
    sorter: SorterResult<Supplier> | SorterResult<Supplier>[],
  ) => {
    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    const nextField = String(activeSorter.field || activeSorter.columnKey || '');
    if (!nextField || !activeSorter.order) {
      setSortFieldOverride(DEFAULT_SORT.field);
      setSortOrderOverride(DEFAULT_SORT.order);
      void savePreferences({ sort: DEFAULT_SORT });
      return;
    }
    const nextOrder = activeSorter.order === 'descend' ? 'desc' : 'asc';
    setSortFieldOverride(nextField);
    setSortOrderOverride(nextOrder);
    void savePreferences({ sort: { field: nextField, order: nextOrder } });
    setPage(1);
  }, [savePreferences]);

  const columnChooserList = useMemo(() => [
    { key: 'code', title: 'Mã NCC', required: true },
    { key: 'name', title: 'Tên NCC', required: true },
    { key: 'company_name', title: 'Công ty / pháp lý' },
    { key: 'tax_code', title: 'MST' },
    { key: 'contact_person', title: 'Người liên hệ' },
    { key: 'phone', title: 'Điện thoại' },
    { key: 'email', title: 'Email' },
    { key: 'contact_phone', title: 'SĐT liên hệ' },
    { key: 'payment_terms_days', title: 'Ngày hạn TT' },
    { key: 'quality', title: 'Ưu tiên / rating' },
    { key: 'status', title: 'Trạng thái' },
    { key: 'address', title: 'Địa chỉ' },
    { key: 'note', title: 'Ghi chú' },
    { key: 'created_at', title: 'Ngày tạo' },
    { key: 'updated_at', title: 'Ngày cập nhật' },
    { key: 'actions', title: 'Thao tác', required: true },
  ], []);

  const allColumns: ColumnsType<Supplier> = useMemo(() => [
    {
      key: 'code',
      title: 'Mã NCC',
      dataIndex: 'code',
      width: 130,
      sorter: true,
      sortOrder: sortField === 'code' ? (sortOrder === 'desc' ? 'descend' : 'ascend') : null,
      render: (value: string) => <Text strong>{value || '-'}</Text>,
    },
    {
      key: 'name',
      title: 'Tên NCC',
      dataIndex: 'name',
      width: 260,
      sorter: true,
      sortOrder: sortField === 'name' ? (sortOrder === 'desc' ? 'descend' : 'ascend') : null,
      render: (value: string, row) => (
        <div className="supplier-name-cell">
          <button className="supplier-link-button" type="button" onClick={() => openDrawer('view', row)}>
            {value || '-'}
          </button>
          <div className="supplier-name-meta">
            {row.company_name || 'Chưa khai báo công ty'}
          </div>
        </div>
      ),
    },
    { key: 'company_name', title: 'Công ty', dataIndex: 'company_name', width: 220, sorter: true, render: (value) => value || '-' },
    { key: 'tax_code', title: 'MST', dataIndex: 'tax_code', width: 150, render: (value) => value || <Text type="secondary">Thiếu MST</Text> },
    { key: 'contact_person', title: 'Người liên hệ', dataIndex: 'contact_person', width: 170, render: (value) => value || '-' },
    { key: 'phone', title: 'Điện thoại', dataIndex: 'phone', width: 145, render: (value) => value || '-' },
    { key: 'email', title: 'Email', dataIndex: 'email', width: 220, render: (value) => value || '-' },
    { key: 'contact_phone', title: 'SĐT liên hệ', dataIndex: 'contact_phone', width: 145, render: (value) => value || '-' },
    {
      key: 'payment_terms_days',
      title: 'Hạn TT',
      dataIndex: 'payment_terms_days',
      width: 110,
      sorter: true,
      sortOrder: sortField === 'payment_terms_days' ? (sortOrder === 'desc' ? 'descend' : 'ascend') : null,
      render: (value) => `${toNumber(value, 0)} ngày`,
    },
    {
      key: 'quality',
      title: 'Ưu tiên / Rating',
      width: 170,
      sorter: false,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          {row.is_preferred ? <Tag color="green">Ưu tiên</Tag> : <Tag>Thông thường</Tag>}
          <Rate disabled allowHalf value={toNumber(row.rating, 0)} />
        </Space>
      ),
    },
    {
      key: 'status',
      title: 'Trạng thái',
      dataIndex: 'is_active',
      width: 160,
      render: (_value, row) => (
        <Space direction="vertical" size={4}>
          <Tag color={row.is_active ? 'success' : 'default'}>{row.is_active ? 'Đang dùng' : 'Ngưng dùng'}</Tag>
          <Tag color={getProfileTone(row)}>{getProfileText(row)}</Tag>
        </Space>
      ),
    },
    { key: 'address', title: 'Địa chỉ', dataIndex: 'address', width: 260, render: (value) => value || '-' },
    { key: 'note', title: 'Ghi chú', dataIndex: 'note', width: 260, render: (value) => value || '-' },
    { key: 'created_at', title: 'Ngày tạo', dataIndex: 'created_at', width: 120, sorter: true, render: formatDate },
    { key: 'updated_at', title: 'Ngày cập nhật', dataIndex: 'updated_at', width: 130, sorter: true, render: formatDate },
    {
      key: 'actions',
      title: 'Thao tác',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space size={6}>
          <Tooltip title="Xem">
            <Button size="small" aria-label={`Xem ${row.code}`} icon={<EyeOutlined />} onClick={() => openDrawer('view', row)} />
          </Tooltip>
          <Tooltip title="Sửa">
            <Button size="small" aria-label={`Sửa ${row.code}`} icon={<EditOutlined />} disabled={!canManage} onClick={() => openDrawer('edit', row)} />
          </Tooltip>
          <Tooltip title={row.is_active ? 'Ngừng sử dụng' : 'Kích hoạt lại'}>
            <Button
              size="small"
              aria-label={`${row.is_active ? 'Ngừng sử dụng' : 'Kích hoạt lại'} ${row.code}`}
              icon={row.is_active ? <PauseCircleOutlined /> : <CheckCircleOutlined />}
              disabled={!canManage}
              danger={row.is_active}
              onClick={() => handleSetActive(row, !row.is_active)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ], [canManage, handleSetActive, openDrawer, sortField, sortOrder]);

  const displayColumns = useMemo(
    () => allColumns.filter((column) => visibleColumns.includes(column.key as string)),
    [allColumns, visibleColumns],
  );

  const filterContent = (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <div>
        <Text strong>Trạng thái</Text>
        <Segmented
          block
          value={filters.status}
          onChange={(value) => updateFilters({ status: value as SupplierStatusFilter })}
          options={[
            { label: 'Đang dùng', value: 'active' },
            { label: 'Ngưng', value: 'inactive' },
            { label: 'Tất cả', value: 'all' },
          ]}
          style={{ marginTop: 8 }}
        />
      </div>
      <div>
        <Text strong>Ưu tiên</Text>
        <Select
          value={filters.preferred}
          onChange={(value) => updateFilters({ preferred: value })}
          style={{ width: '100%', marginTop: 8 }}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'preferred', label: 'NCC ưu tiên' },
            { value: 'normal', label: 'NCC thường' },
          ]}
        />
      </div>
      <div>
        <Text strong>Hồ sơ</Text>
        <Select
          value={filters.profile}
          onChange={(value) => updateFilters({ profile: value })}
          style={{ width: '100%', marginTop: 8 }}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'missing', label: 'Thiếu MST hoặc liên hệ' },
            { value: 'has_contact', label: 'Có thông tin liên hệ' },
          ]}
        />
      </div>
      <div className="supplier-filter-grid">
        <Input
          value={filters.tax_code}
          onChange={(event) => updateFilters({ tax_code: event.target.value })}
          placeholder="Mã số thuế"
          suffix={filters.tax_code ? <QuickClearIcon title="Xóa MST" onClear={() => updateFilters({ tax_code: '', tax_code_exact: false })} /> : undefined}
        />
        <Space>
          <Switch checked={filters.tax_code_exact} onChange={(checked) => updateFilters({ tax_code_exact: checked })} />
          <Text>Tìm MST chính xác</Text>
        </Space>
        <Input
          value={filters.phone}
          onChange={(event) => updateFilters({ phone: event.target.value })}
          placeholder="Điện thoại"
          suffix={filters.phone ? <QuickClearIcon title="Xóa điện thoại" onClear={() => updateFilters({ phone: '' })} /> : undefined}
        />
        <Input
          value={filters.email}
          onChange={(event) => updateFilters({ email: event.target.value })}
          placeholder="Email"
          suffix={filters.email ? <QuickClearIcon title="Xóa email" onClear={() => updateFilters({ email: '' })} /> : undefined}
        />
      </div>
      <div className="supplier-filter-grid">
        <Select
          value={filters.payment_terms_days ?? 'all'}
          onChange={(value) => updateFilters({ payment_terms_days: value === 'all' ? null : Number(value) })}
          options={[
            { value: 'all', label: 'Tất cả hạn TT' },
            ...PAYMENT_PRESETS.map((value) => ({ value, label: `${value} ngày` })),
          ]}
        />
        <Select
          value={filters.rating_min ?? 'all'}
          onChange={(value) => updateFilters({ rating_min: value === 'all' ? null : Number(value) })}
          options={[
            { value: 'all', label: 'Tất cả rating' },
            { value: 5, label: 'Từ 5 sao' },
            { value: 4, label: 'Từ 4 sao' },
            { value: 3, label: 'Từ 3 sao' },
          ]}
        />
      </div>
    </Space>
  );

  return (
    <div className="supplier-page">
      {contextHolder}

      <header className="supplier-page-header">
        <div className="supplier-title-block">
          <Space wrap size={6}>
            <Tag color="blue">Mua hàng</Tag>
            <Tag color="gold">Nhà cung cấp</Tag>
            <Tag color={canManage ? 'processing' : 'default'}>{canManage ? 'Danh mục vận hành' : 'Theo quyền hiện tại'}</Tag>
          </Space>
          <Title level={2}>Nhà cung cấp</Title>
          <Text type="secondary">Quản lý đối tác mua hàng, hạn thanh toán, ưu tiên và trạng thái sử dụng trong cùng một màn hình.</Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => openDrawer('create')}
        >
          Thêm mới
        </Button>
      </header>

      <div className="supplier-summary-grid">
        <Card size="small">
          <Statistic title="Tổng NCC" value={total} suffix="NCC" />
        </Card>
        <Card size="small">
          <Statistic title="Đang dùng trên trang" value={summary.activeCount} suffix="NCC" />
        </Card>
        <Card size="small">
          <Statistic title="Ưu tiên" value={summary.preferredCount} suffix="NCC" />
        </Card>
        <Card size="small">
          <Statistic title="Thiếu hồ sơ" value={summary.missingProfileCount} suffix="NCC" />
        </Card>
        <Card size="small">
          <Statistic title="Rating TB" value={summary.avgRating} precision={1} suffix="/5" />
        </Card>
      </div>

      <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />

      <section className="supplier-workspace">
        <div className="supplier-toolbar" data-testid="supplier-command-strip">
          <div className="supplier-toolbar-left">
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              placeholder="Tìm mã, tên, MST, điện thoại, email..."
              className="supplier-search"
              suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
            />
            <Segmented
              value={filters.status}
              onChange={(value) => updateFilters({ status: value as SupplierStatusFilter })}
              options={[
                { label: 'Đang dùng', value: 'active' },
                { label: 'Ngưng', value: 'inactive' },
                { label: 'Tất cả', value: 'all' },
              ]}
            />
          </div>
          <div className="supplier-toolbar-actions">
            <Segmented
              value={density}
              onChange={(value) => handleDensityChange(value as SupplierDensity)}
              options={[
                { label: 'Thoáng', value: 'comfortable' },
                { label: 'Gọn', value: 'compact' },
              ]}
            />
            <Button icon={<FilterOutlined />} onClick={() => setFilterOpen(true)}>
              Lọc{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Button>
            {!isMobile && (
              <ColumnChooser
                columns={columnChooserList}
                visibleColumns={visibleColumns}
                onChange={(columns) => void handleVisibleColumnsChange(columns)}
              />
            )}
            <Tooltip title="Tải lại">
              <Button icon={<ReloadOutlined />} onClick={() => void listQuery.refetch()} />
            </Tooltip>
          </div>
        </div>

        {activeFilterTags.length > 0 && (
          <div className="supplier-active-filters">
            {activeFilterTags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
            <Button type="link" size="small" onClick={clearFilters}>Xóa bộ lọc</Button>
          </div>
        )}

        {!isMobile ? (
          <Table
            className={`enterprise-data-table supplier-table supplier-table-${density}`}
            rowKey="id"
            loading={listQuery.isLoading}
            columns={displayColumns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 'max-content' }}
            size={density === 'compact' ? 'small' : 'middle'}
            onChange={handleTableChange}
            locale={{ emptyText: canManage ? 'Chưa có nhà cung cấp phù hợp. Nhấn Thêm mới để tạo.' : 'Chưa có nhà cung cấp phù hợp.' }}
          />
        ) : (
          <div className="supplier-mobile-list" data-testid="supplier-mobile-card-list">
            {rows.length === 0 && !listQuery.isLoading ? (
              <Card size="small">Chưa có nhà cung cấp phù hợp.</Card>
            ) : null}
            {rows.map((row) => (
              <Card key={row.id} size="small" className="supplier-mobile-card">
                <div className="supplier-mobile-card-head">
                  <div>
                    <div className="supplier-mobile-title">{row.name || '-'}</div>
                    <div className="supplier-mobile-code">{row.code || '-'}</div>
                  </div>
                  <Space size={4}>
                    <Button size="small" aria-label={`Xem ${row.code}`} icon={<EyeOutlined />} onClick={() => openDrawer('view', row)} />
                    <Button size="small" aria-label={`Sửa ${row.code}`} icon={<EditOutlined />} disabled={!canManage} onClick={() => openDrawer('edit', row)} />
                    <Button
                      size="small"
                      aria-label={`${row.is_active ? 'Ngừng sử dụng' : 'Kích hoạt lại'} ${row.code}`}
                      icon={row.is_active ? <PauseCircleOutlined /> : <CheckCircleOutlined />}
                      disabled={!canManage}
                      danger={row.is_active}
                      onClick={() => handleSetActive(row, !row.is_active)}
                    />
                  </Space>
                </div>
                <div className="supplier-mobile-badges">
                  <Tag color={row.is_active ? 'success' : 'default'}>{row.is_active ? 'Đang dùng' : 'Ngưng dùng'}</Tag>
                  {row.is_preferred ? <Tag color="green">Ưu tiên</Tag> : null}
                  <Tag color={getProfileTone(row)}>{getProfileText(row)}</Tag>
                </div>
                <div className="supplier-mobile-grid">
                  <div><span>MST</span><strong>{row.tax_code || '-'}</strong></div>
                  <div><span>Liên hệ</span><strong>{row.contact_person || '-'}</strong></div>
                  <div><span>Điện thoại</span><strong>{row.phone || row.contact_phone || '-'}</strong></div>
                  <div><span>Hạn TT</span><strong>{toNumber(row.payment_terms_days, 0)} ngày</strong></div>
                </div>
                <Rate disabled allowHalf value={toNumber(row.rating, 0)} />
              </Card>
            ))}
          </div>
        )}

        <div className="supplier-pagination-bar">
          <Text type="secondary">Tổng {total} nhà cung cấp</Text>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger={!isMobile}
            pageSizeOptions={[10, 20, 50, 100]}
            onChange={(nextPage, nextPageSize) => {
              setPage(nextPage);
              if (nextPageSize !== pageSize) void savePreferences({ pageSize: nextPageSize });
            }}
            simple={isMobile}
          />
        </div>
      </section>

      <Modal
        title="Bộ lọc nhà cung cấp"
        open={filterOpen}
        onCancel={() => setFilterOpen(false)}
        footer={[
          <Button key="clear" onClick={clearFilters}>Xóa hết bộ lọc</Button>,
          <Button key="close" type="primary" onClick={() => setFilterOpen(false)}>Xong</Button>,
        ]}
        width={460}
      >
        {filterContent}
      </Modal>

      <Drawer
        title={drawerMode === 'create' ? 'Thêm nhà cung cấp' : drawerMode === 'edit' ? `Sửa ${selectedSupplier?.code ?? ''}` : `Chi tiết ${selectedSupplier?.code ?? ''}`}
        open={drawerOpen}
        onClose={closeDrawer}
        width={isMobile ? '100vw' : 820}
        destroyOnHidden={false}
        rootClassName="supplier-form-drawer-root"
        className="supplier-form-drawer"
        data-testid="supplier-form-drawer"
        footer={
          <div className="supplier-drawer-footer">
            <Button onClick={closeDrawer}>Hủy</Button>
            {drawerMode !== 'view' ? (
              <Button
                type="primary"
                onClick={() => void onSubmit()}
                loading={createMutation.isPending || updateMutation.isPending}
              >
                Lưu
              </Button>
            ) : null}
          </div>
        }
      >
        <Form form={form} layout="vertical" disabled={drawerMode === 'view'} initialValues={emptyForm}>
          <FormSection title="Thông tin cơ bản" description="Mã NCC đang nhập thủ công trong v1; hệ thống chưa có auto-generate cho Supplier.">
            <div className="supplier-form-grid">
              <Form.Item name="code" label="Mã NCC" rules={[{ required: true, message: 'Vui lòng nhập mã NCC' }]}>
                <Input placeholder="VD: NCC-001" autoComplete="off" />
              </Form.Item>
              <Form.Item name="name" label="Tên NCC" rules={[{ required: true, message: 'Vui lòng nhập tên NCC' }]}>
                <Input placeholder="Tên nhà cung cấp" autoComplete="off" />
              </Form.Item>
              <Form.Item name="company_name" label="Tên công ty / pháp lý">
                <Input placeholder="Tên pháp lý nếu khác tên giao dịch" autoComplete="off" />
              </Form.Item>
              <div className="supplier-switch-row">
                <Form.Item name="is_preferred" label="NCC ưu tiên" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item name="is_active" label="Đang dùng" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </div>
            </div>
          </FormSection>

          <FormSection title="Pháp lý">
            <Form.Item name="tax_code" label="Mã số thuế" tooltip="Không bắt buộc trong v1, nhưng nếu nhập thì không được trùng nhà cung cấp khác.">
              <Input placeholder="MST nhà cung cấp" autoComplete="off" />
            </Form.Item>
          </FormSection>

          <FormSection title="Liên hệ">
            <div className="supplier-form-grid">
              <Form.Item name="contact_person" label="Người liên hệ">
                <Input placeholder="Tên người phụ trách" autoComplete="off" />
              </Form.Item>
              <Form.Item name="phone" label="Điện thoại chính">
                <Input placeholder="Số điện thoại công ty" autoComplete="off" />
              </Form.Item>
              <Form.Item name="contact_phone" label="SĐT người liên hệ">
                <Input placeholder="Số trực tiếp nếu có" autoComplete="off" />
              </Form.Item>
              <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Email không hợp lệ' }]}>
                <Input placeholder="email@ncc.vn" autoComplete="off" />
              </Form.Item>
            </div>
          </FormSection>

          <FormSection title="Địa chỉ">
            <Form.Item name="address" label="Địa chỉ chính">
              <Input.TextArea rows={3} placeholder="Địa chỉ giao dịch chính" />
            </Form.Item>
          </FormSection>

          <FormSection title="Thanh toán" description="Chọn nhanh hoặc nhập số ngày tùy chỉnh, giá trị phải từ 0 trở lên.">
            <Form.Item shouldUpdate noStyle>
              {({ getFieldValue, setFieldValue }) => {
                const current = toNumber(getFieldValue('payment_terms_days'), 30);
                return (
                  <Segmented
                    value={PAYMENT_PRESETS.includes(current) ? current : undefined}
                    onChange={(value) => setFieldValue('payment_terms_days', Number(value))}
                    options={PAYMENT_PRESETS.map((value) => ({ value, label: `${value} ngày` }))}
                    className="supplier-payment-presets"
                  />
                );
              }}
            </Form.Item>
            <Form.Item
              name="payment_terms_days"
              label="Hạn thanh toán (ngày)"
              rules={[
                { required: true, message: 'Vui lòng nhập hạn thanh toán' },
                {
                  validator: (_, value) => (toNumber(value, -1) >= 0 ? Promise.resolve() : Promise.reject(new Error('Hạn thanh toán không được âm'))),
                },
              ]}
            >
              <InputNumber min={0} precision={0} style={{ width: 220 }} />
            </Form.Item>
          </FormSection>

          <FormSection title="Đánh giá & ghi chú">
            <Form.Item
              name="rating"
              label="Đánh giá thủ công"
              rules={[
                {
                  validator: (_, value) => {
                    const rating = toNumber(value, 0);
                    return rating >= 1 && rating <= 5 ? Promise.resolve() : Promise.reject(new Error('Đánh giá phải từ 1 đến 5'));
                  },
                },
              ]}
            >
              <Rate allowClear={false} />
            </Form.Item>
            <Form.Item name="note" label="Ghi chú">
              <Input.TextArea rows={3} placeholder="Điều kiện giao dịch, lưu ý vận hành..." />
            </Form.Item>
          </FormSection>
        </Form>
      </Drawer>
    </div>
  );
}
