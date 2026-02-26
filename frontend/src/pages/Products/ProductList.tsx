import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, startTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Table,
  Button,
  Dropdown,
  message,
  Modal,
  Pagination,
  Space,
  Input,
  InputNumber,
  Select,
  Card,
  Checkbox,
  Tag,
  Segmented,
  Drawer,
  Tooltip,
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
  SendOutlined,
  CheckOutlined,
  CloseOutlined,
  LockOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi, type ActivityItem, type PriceChangeRecord } from '../../api/products';
import type { Product } from '../../types/product';
import { theme } from '../../styles/theme';
import {
  FormattedPrice,
  EmptyState,
  ImportModal,
  ColumnChooser,
  QuickClearIcon,
  FilterSelect,
  ListSearchInput,
  CommentBox,
  TaskPanel,
} from '../../components';
import ProductForm from './ProductForm';
import {
  useProductsListFilter,
  type FilterKey,
  type FilterValues,
  type ProductStatus,
  EMPTY_FILTER_VALUES,
} from '../../contexts/ProductsListFilterContext';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { parseApiError } from '../../shared/apiError';
import { useColumnPermissions } from '../../hooks/useColumnPermissions';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useQuickEntryKeys } from '../../hooks/useQuickEntryKeys';
import {
  normalizeSearchParamsToOrderedString,
  normalizeParamsToOrderedString,
} from '../../utils/urlSearchParamsSync';
import type { PreferencesConfig } from '../../types/preferences';
import { useRowSelection } from '../../hooks/useRowSelection';
import { useConfirmDelete } from '../../hooks/useConfirmDelete';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  getHistoryActionCode,
  getHistoryActionLabelVi,
  filterHistoryItems,
} from '../../utils/historyUtils';
import { useBulkDelete } from '../../hooks/useBulkDelete';
import { TOAST } from '../../shared/toast';
import { PRODUCT_STATUS_LABELS } from '../../utils/constants';

const PRODUCT_LIST_SIZE_SEPARATED = ['size_po_dai', 'size_po_rong', 'size_po_cao', 'size_sx_dai', 'size_sx_rong', 'size_sx_cao'];
const PRODUCT_LIST_SIZE_MERGED = ['size_po_merged', 'size_sx_merged'];
const DEFAULT_PRODUCT_VISIBLE_COLUMNS: string[] = [
  'code', 'name', 'category_name', 'cost_price', 'sale_price', 'commission_per_unit', 'commission_percent',
  ...PRODUCT_LIST_SIZE_SEPARATED,
  'wave_code', 'box_type_code', 'unit_name', 'delivery_tolerance',
  'process_xa', 'process_in', 'film_code', 'color_count', 'waterproof', 'co_cm', 'process_can_mang',
  'process_boi', 'process_be', 'mold_code', 'process_chap', 'process_dong', 'process_dan', 'process_khac',
  'note_other', 'note', 'status', 'actions',
];

/** Ô lọc số: input HTML thuần + QuickClearIcon khi có giá trị. Key cố định → tránh remount/focus mất khi re-render. */
function FilterNumberInput(
  props: {
    'data-field': string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    inputMode?: 'numeric' | 'decimal';
    style?: React.CSSProperties;
    className?: string;
    onClear?: () => void;
    showClear?: boolean;
  }
) {
  const { 'data-field': dataField, value, onChange, placeholder, inputMode = 'numeric', style, className, onClear, showClear: showClearProp } = props;
  const showClear = showClearProp ?? ((value ?? '') !== '');
  return (
    <div style={{ position: 'relative', width: '100%', display: 'inline-block' }}>
      <input
        key={dataField}
        data-field={dataField}
        type="text"
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        style={{
          width: '100%',
          height: 22,
          boxSizing: 'border-box',
          padding: '0 8px',
          paddingRight: showClear && onClear ? 22 : 8,
          fontSize: 14,
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          outline: 'none',
          ...style,
        }}
        className={className}
      />
      {showClear && onClear && (
        <QuickClearIcon
          onClear={onClear}
          title="Xóa nhanh"
          style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}
        />
      )}
    </div>
  );
}

/** Ô lọc text (Ghi chú chung): input HTML thuần + QuickClearIcon, key cố định → tránh remount/focus mất khi re-render. */
function FilterTextInput(
  props: {
    'data-field': string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    style?: React.CSSProperties;
    className?: string;
    onClear?: () => void;
    showClear?: boolean;
  }
) {
  const { 'data-field': dataField, value, onChange, placeholder, style, className, onClear, showClear } = props;
  const showClearIcon = showClear ?? ((value ?? '').trim() !== '');
  const wrapperWidth = style?.width ?? '100%';
  return (
    <div style={{ position: 'relative', width: wrapperWidth, display: 'inline-block', minWidth: 0 }}>
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
        className={className}
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

const FILTER_OPTIONS = [
  { key: 'code' as const, label: 'Mã hàng' },
  { key: 'name' as const, label: 'Tên hàng' },
  { key: 'category' as const, label: 'Danh mục' },
  { key: 'unit' as const, label: 'Đơn vị' },
  { key: 'status' as const, label: 'Trạng thái' },
  { key: 'wave' as const, label: 'Sóng' },
  { key: 'box_type' as const, label: 'Kiểu' },
  { key: 'cost_price' as const, label: 'Giá vốn (từ – đến)' },
  { key: 'sale_price' as const, label: 'Đơn giá (từ – đến)' },
  { key: 'size_po_dai' as const, label: 'Dài PO' },
  { key: 'size_po_rong' as const, label: 'Rộng PO' },
  { key: 'size_po_cao' as const, label: 'Cao PO' },
  { key: 'size_sx_dai' as const, label: 'Dài SX' },
  { key: 'size_sx_rong' as const, label: 'Rộng SX' },
  { key: 'size_sx_cao' as const, label: 'Cao SX' },
  { key: 'waterproof' as const, label: 'C. thấm' },
  { key: 'co_cm' as const, label: 'Có CM' },
  { key: 'note' as const, label: 'Ghi chú chung' },
];

/** Input → Intent: debounce tìm kiếm 650ms (chỉ intent mới gọi API). */
const SEARCH_INTENT_DEBOUNCE_MS = 650;
/** Input → Intent: debounce bộ lọc 300ms (số Dài/Rộng/Cao nhập mượt, intent tách riêng). */
const FILTER_INTENT_DEBOUNCE_MS = 300;
/** Debounce ghi URL sau khi intent ổn định. */
const URL_WRITE_DEBOUNCE_MS = 500;
const DEFAULT_PAGE_SIZE = 20;
const PRODUCTS_LIST_STORAGE_KEY = 'erp_products_list_state';
type ListViewMode = 'table' | 'cards';
type CardDensity = 'comfortable' | 'compact';
type DesktopTableDensity = 'comfortable' | 'compact';
type ProductFormMode = 'create' | 'edit' | 'view';

const getProductStatusTone = (status: string | null | undefined): 'ok' | 'warn' | 'neutral' => {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'DISCONTINUED') return 'warn';
  return 'neutral';
};

// getHistoryActionCode & getHistoryActionLabelVi → dùng từ ../../utils/historyUtils (shared)

const PRODUCT_HISTORY_FIELD_LABELS: Record<string, string> = {
  code: 'Mã hàng',
  name: 'Tên hàng',
  category: 'Danh mục',
  category_name: 'Danh mục',
  unit: 'Đơn vị',
  unit_name: 'Đơn vị',
  cost_price: 'Giá vốn',
  sale_price: 'Đơn giá',
  status: 'Trạng thái',
  is_active: 'Hoạt động',
  size_order: 'Kích thước PO',
  size_production: 'Kích thước SX',
  wave: 'Sóng',
  box_type: 'Kiểu',
  note: 'Ghi chú',
  note_other: 'Ghi chú công đoạn khác',
  min_stock: 'Tồn tối thiểu',
  commission_per_unit: 'HHCĐ',
  commission_percent: 'HH%',
  price_change_reason: 'Lý do thay đổi giá',
  price_effective_at: 'Hiệu lực từ',
  effective_at: 'Hiệu lực từ',
  reason: 'Lý do',
  reject_reason: 'Lý do từ chối',
  delta_cost_percent: '% thay đổi giá vốn',
  delta_sale_percent: '% thay đổi đơn giá',
};

const getHistoryFieldLabelVi = (field: string): string => PRODUCT_HISTORY_FIELD_LABELS[field] ?? field;

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

const formatHistoryFieldValueVi = (field: string, value: unknown): string => {
  if (value === null || value === undefined || value === '') return '-';
  if (field.includes('effective_at') || field.includes('price_effective_at')) {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('vi-VN');
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (field.includes('percent')) return `${numeric.toLocaleString('vi-VN')}%`;
    if (field.includes('price') || field.includes('delta_cost') || field.includes('delta_sale')) {
      return `${numeric.toLocaleString('vi-VN')} đ`;
    }
  }
  return formatHistoryValueVi(value);
};

const normalizeDateTimeLocal = (value: string): string | undefined => {
  const raw = value.trim();
  if (!raw) return undefined;
  if (raw.length === 16) return `${raw}:00`;
  return raw;
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

/** Ô lọc số (Dài/Rộng/Cao, giá): input layer lưu string thuần, không parse sớm → nhập liên tục. */
const NUMERIC_FILTER_KEYS = [
  'min_cost_price', 'max_cost_price', 'min_sale_price', 'max_sale_price',
  'size_po_dai', 'size_po_rong', 'size_po_cao', 'size_sx_dai', 'size_sx_rong', 'size_sx_cao',
] as const;
type NumericFilterKey = (typeof NUMERIC_FILTER_KEYS)[number];

/** Input state: số nhập tay là string | null; chỉ parse khi build intent. */
type LocalFilterInput = Omit<FilterValues, NumericFilterKey> & {
  [K in NumericFilterKey]: string | null;
};

const EMPTY_LOCAL_FILTER_INPUT: LocalFilterInput = {
  ...EMPTY_FILTER_VALUES,
  min_cost_price: null,
  max_cost_price: null,
  min_sale_price: null,
  max_sale_price: null,
  size_po_dai: null,
  size_po_rong: null,
  size_po_cao: null,
  size_sx_dai: null,
  size_sx_rong: null,
  size_sx_cao: null,
};

/** Text filter keys: trim chỉ khi build intent (API/URL), không trim trong onChange → nhập liên tục. */
const TEXT_FILTER_KEYS: (keyof FilterValues)[] = ['code', 'name', 'note'];

function localInputToFilterValues(local: LocalFilterInput): FilterValues {
  const fv = { ...EMPTY_FILTER_VALUES } as Record<string, any>;
  for (const k of Object.keys(EMPTY_FILTER_VALUES) as (keyof FilterValues)[]) {
    const v = local[k as keyof LocalFilterInput];
    if (NUMERIC_FILTER_KEYS.includes(k as NumericFilterKey)) {
      const s = v == null ? '' : String(v).trim();
      fv[k] = s === '' ? null : (k.includes('price') ? parseFloat(s) : parseInt(s, 10));
      if (Number.isNaN(fv[k])) fv[k] = null;
    } else if (TEXT_FILTER_KEYS.includes(k)) {
      const s = v != null && typeof v === 'string' ? v.trim() : '';
      fv[k] = s === '' ? null : s;
    } else {
      fv[k] = v ?? null;
    }
  }
  return fv as FilterValues;
}

function filterValuesToLocalInput(fv: FilterValues): LocalFilterInput {
  const local = { ...EMPTY_LOCAL_FILTER_INPUT } as Record<string, any>;
  for (const k of Object.keys(EMPTY_FILTER_VALUES) as (keyof FilterValues)[]) {
    const v = fv[k];
    if (NUMERIC_FILTER_KEYS.includes(k as NumericFilterKey)) {
      local[k] = v == null ? null : String(v);
    } else {
      local[k] = v ?? null;
    }
  }
  return local as LocalFilterInput;
}

const FILTER_KEYS_ORDER = Object.keys(EMPTY_FILTER_VALUES).sort() as (keyof FilterValues)[];
function filterValuesToStableString(fv: FilterValues): string {
  const o: Record<string, unknown> = {};
  for (const k of FILTER_KEYS_ORDER) o[k] = fv[k];
  return JSON.stringify(o);
}
function parseStableFilterString(s: string | undefined): FilterValues {
  if (!s || typeof s !== 'string') return { ...EMPTY_FILTER_VALUES };
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    const out = { ...EMPTY_FILTER_VALUES } as Record<string, any>;
    for (const k of FILTER_KEYS_ORDER) {
      if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
    }
    return out as FilterValues;
  } catch {
    return { ...EMPTY_FILTER_VALUES };
  }
}

/** Parse "DàixRộngxCao" (vd: 50x40x30) thành [dài, rộng, cao] */
function parseSizeDRC(s: string | undefined): [string, string, string] {
  if (!s || typeof s !== 'string') return ['', '', ''];
  const parts = s.trim().split(/[xX*×]/).map((p) => p.trim());
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
}

function toNumberOrNull(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStatusOrNull(v: string | number | null): ProductStatus | null {
  if (v === null) return null;
  const s = String(v) as ProductStatus;
  return s === 'DRAFT' || s === 'ACTIVE' || s === 'DISCONTINUED' ? s : null;
}

function toStringOrNull(v: string | number | null): string | null {
  if (v === null) return null;
  const s = String(v);
  return s;
}

const WATERPROOF_LABELS: Record<string, string> = {
  '': 'Không',
  INSIDE: 'Trong',
  OUTSIDE: 'Ngoài',
  BOTH: '2 mặt',
};

const FILTER_KEYS: FilterKey[] = [
  'code', 'name', 'category', 'unit', 'status', 'wave', 'box_type', 'cost_price', 'sale_price',
  'size_po_dai', 'size_po_rong', 'size_po_cao', 'size_sx_dai', 'size_sx_rong', 'size_sx_cao',
  'waterproof', 'co_cm', 'note',
];

/** Persist localFilterInput qua remount (StrictMode mount→unmount→remount) để không mất chữ khi gõ ký tự đầu. */
let persistedLocalFilterInput: LocalFilterInput = { ...EMPTY_LOCAL_FILTER_INPUT };

/** Đọc bộ lọc + tìm kiếm + phân trang từ URL */
function parseProductListParams(searchParams: URLSearchParams): {
  searchInput: string;
  search: string;
  filterValues: FilterValues;
  activeFilters: FilterKey[];
  page: number;
  pageSize: number;
  exactSearch: boolean;
} {
  const q = searchParams.get('q') ?? '';
  const category = searchParams.get('category');
  const unit = searchParams.get('unit');
  const status = searchParams.get('status') as ProductStatus | null;
  const wave = searchParams.get('wave');
  const box_type = searchParams.get('box_type');
  const code = searchParams.get('code') ?? '';
  const name = searchParams.get('name') ?? '';
  const min_cost_price = searchParams.get('min_cost_price');
  const max_cost_price = searchParams.get('max_cost_price');
  const min_sale_price = searchParams.get('min_sale_price');
  const max_sale_price = searchParams.get('max_sale_price');
  const size_po_dai = searchParams.get('size_po_dai');
  const size_po_rong = searchParams.get('size_po_rong');
  const size_po_cao = searchParams.get('size_po_cao');
  const size_sx_dai = searchParams.get('size_sx_dai');
  const size_sx_rong = searchParams.get('size_sx_rong');
  const size_sx_cao = searchParams.get('size_sx_cao');
  const waterproof = searchParams.get('waterproof') ?? '';
  const co_cm = searchParams.get('co_cm');
  const note = searchParams.get('note') ?? '';
  const activeFiltersRaw = searchParams.get('activeFilters') ?? '';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.max(1, Math.min(500, parseInt(searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10)));
  const exactSearch = searchParams.get('exact_search') === '1' || searchParams.get('exact_search') === 'true';

  const filterValues: FilterValues = {
    category: category ? parseInt(category, 10) : null,
    unit: unit ? parseInt(unit, 10) : null,
    status: status && ['DRAFT', 'ACTIVE', 'DISCONTINUED'].includes(status) ? status : null,
    wave: wave ? parseInt(wave, 10) : null,
    box_type: box_type ? parseInt(box_type, 10) : null,
    code: code.trim() || null,
    name: name.trim() || null,
    min_cost_price: min_cost_price != null && min_cost_price !== '' ? parseFloat(min_cost_price) : null,
    max_cost_price: max_cost_price != null && max_cost_price !== '' ? parseFloat(max_cost_price) : null,
    min_sale_price: min_sale_price != null && min_sale_price !== '' ? parseFloat(min_sale_price) : null,
    max_sale_price: max_sale_price != null && max_sale_price !== '' ? parseFloat(max_sale_price) : null,
    size_po_dai: size_po_dai != null && size_po_dai !== '' ? parseInt(size_po_dai, 10) : null,
    size_po_rong: size_po_rong != null && size_po_rong !== '' ? parseInt(size_po_rong, 10) : null,
    size_po_cao: size_po_cao != null && size_po_cao !== '' ? parseInt(size_po_cao, 10) : null,
    size_sx_dai: size_sx_dai != null && size_sx_dai !== '' ? parseInt(size_sx_dai, 10) : null,
    size_sx_rong: size_sx_rong != null && size_sx_rong !== '' ? parseInt(size_sx_rong, 10) : null,
    size_sx_cao: size_sx_cao != null && size_sx_cao !== '' ? parseInt(size_sx_cao, 10) : null,
    waterproof: waterproof.trim() || null,
    co_cm: co_cm === 'true' ? true : co_cm === 'false' ? false : null,
    note: note.trim() || null,
  };
  const activeFromUrl = activeFiltersRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((k): k is FilterKey => (FILTER_KEYS as string[]).includes(k));
  const activeFromValues = FILTER_KEYS.filter((k) => {
    if (k === 'cost_price') return filterValues.min_cost_price != null || filterValues.max_cost_price != null;
    if (k === 'sale_price') return filterValues.min_sale_price != null || filterValues.max_sale_price != null;
    return filterValues[k as keyof FilterValues] != null && filterValues[k as keyof FilterValues] !== '';
  });
  const activeFilters = activeFromUrl.length > 0 ? activeFromUrl : activeFromValues;

  return {
    searchInput: q,
    search: q,
    filterValues,
    activeFilters,
    page,
    pageSize,
    exactSearch,
  };
}

/** Ghi state hiện tại ra URL (chỉ params có giá trị) */
function productListParamsToSearch(
  search: string,
  filterValues: FilterValues,
  activeFilters: FilterKey[],
  current: number,
  pageSize: number,
  exactSearch?: boolean
): Record<string, string> {
  const params: Record<string, string> = {};
  if (search.trim()) params.q = search.trim();
  if (filterValues.code?.trim()) params.code = filterValues.code.trim();
  if (filterValues.name?.trim()) params.name = filterValues.name.trim();
  if (filterValues.category != null) params.category = String(filterValues.category);
  if (filterValues.unit != null) params.unit = String(filterValues.unit);
  if (filterValues.status != null) params.status = filterValues.status;
  if (filterValues.wave != null) params.wave = String(filterValues.wave);
  if (filterValues.box_type != null) params.box_type = String(filterValues.box_type);
  if (filterValues.min_cost_price != null) params.min_cost_price = String(filterValues.min_cost_price);
  if (filterValues.max_cost_price != null) params.max_cost_price = String(filterValues.max_cost_price);
  if (filterValues.min_sale_price != null) params.min_sale_price = String(filterValues.min_sale_price);
  if (filterValues.max_sale_price != null) params.max_sale_price = String(filterValues.max_sale_price);
  if (filterValues.size_po_dai != null) params.size_po_dai = String(filterValues.size_po_dai);
  if (filterValues.size_po_rong != null) params.size_po_rong = String(filterValues.size_po_rong);
  if (filterValues.size_po_cao != null) params.size_po_cao = String(filterValues.size_po_cao);
  if (filterValues.size_sx_dai != null) params.size_sx_dai = String(filterValues.size_sx_dai);
  if (filterValues.size_sx_rong != null) params.size_sx_rong = String(filterValues.size_sx_rong);
  if (filterValues.size_sx_cao != null) params.size_sx_cao = String(filterValues.size_sx_cao);
  if (filterValues.waterproof != null) params.waterproof = String(filterValues.waterproof);
  if (filterValues.co_cm === true) params.co_cm = 'true';
  if (filterValues.co_cm === false) params.co_cm = 'false';
  if (filterValues.note?.trim()) params.note = filterValues.note.trim();
  if (activeFilters.length > 0) params.activeFilters = activeFilters.join(',');
  if (current > 1) params.page = String(current);
  if (pageSize !== DEFAULT_PAGE_SIZE) params.pageSize = String(pageSize);
  if (exactSearch) params.exact_search = '1';
  return params;
}

/** Ghi state ra localStorage */
function saveProductListStateToStorage(
  search: string,
  filterValues: FilterValues,
  current: number,
  pageSize: number
) {
  try {
    localStorage.setItem(
      PRODUCTS_LIST_STORAGE_KEY,
      JSON.stringify({
        search: search.trim() || undefined,
        filterValues:
          filterValues.category != null ||
          filterValues.unit != null ||
          filterValues.status != null ||
          filterValues.wave != null ||
          filterValues.box_type != null ||
          (filterValues.code?.trim()?.length ?? 0) > 0 ||
          (filterValues.name?.trim()?.length ?? 0) > 0 ||
          filterValues.min_cost_price != null ||
          filterValues.max_cost_price != null ||
          filterValues.min_sale_price != null ||
          filterValues.max_sale_price != null ||
          filterValues.size_po_dai != null ||
          filterValues.size_po_rong != null ||
          filterValues.size_po_cao != null ||
          filterValues.size_sx_dai != null ||
          filterValues.size_sx_rong != null ||
          filterValues.size_sx_cao != null ||
          (filterValues.waterproof?.trim()?.length ?? 0) > 0 ||
          filterValues.co_cm != null ||
          (filterValues.note?.trim()?.length ?? 0) > 0
            ? filterValues
            : undefined,
        page: current > 1 ? current : undefined,
        pageSize: pageSize !== DEFAULT_PAGE_SIZE ? pageSize : undefined,
      })
    );
  } catch {
    // ignore
  }
}

const ProductList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const isFirstMount = useRef(true);
  const {
    state: { searchInput, activeFilters, filterValues, pagination },
    setSearchInput,
    setSearch,
    setActiveFilters,
    setFilterValues,
    setPagination,
  } = useProductsListFilter();

  const {
    visibleColumns,
    sizeDisplayMode,
    handleVisibleColumnsChange,
    handleSizeDisplayModeChange,
  } = useColumnSettings('products-list', {
    defaultVisibleColumns: DEFAULT_PRODUCT_VISIBLE_COLUMNS,
    sizeColumns: { separated: PRODUCT_LIST_SIZE_SEPARATED, merged: PRODUCT_LIST_SIZE_MERGED },
  });

  // Ô lọc: state cục bộ (số = string thuần). Khởi tạo từ persisted để sống qua StrictMode remount.
  const [localFilterInput, setLocalFilterInput] = useState<LocalFilterInput>(() => ({ ...persistedLocalFilterInput }));

  // Persist sau mỗi thay đổi → remount (StrictMode) vẫn giữ được giá trị đang gõ.
  useEffect(() => {
    persistedLocalFilterInput = { ...localFilterInput };
  }, [localFilterInput]);

  // ——— Input → Intent → Query ———
  // Search & Filter Guideline: Input (searchInput, localFilterInput) chỉ nhập, KHÔNG debounce.
  // Intent (useSearchFilterIntent) debounce → API/URL/export chỉ đọc intent. Query không đọc input.
  const parsedForIntent = useMemo(() => localInputToFilterValues(localFilterInput), [localFilterInput]);
  const {
    intentSearch,
    intentFilters,
    intentFilterStableString,
    setIntentImmediate,
  } = useSearchFilterIntent({
    searchInput: searchInput ?? '',
    filterValues: parsedForIntent,
    searchDebounceMs: SEARCH_INTENT_DEBOUNCE_MS,
    filterDebounceMs: FILTER_INTENT_DEBOUNCE_MS,
    serializeFilters: filterValuesToStableString,
    parseFilters: parseStableFilterString,
  });

  // Ref để đọc localFilterInput mới nhất trong blur handler (tránh closure cũ).
  const localFilterInputRef = useRef<LocalFilterInput>(localFilterInput);
  useEffect(() => {
    localFilterInputRef.current = localFilterInput;
  }, [localFilterInput]);

  /** Đẩy local → context + intent; gọi khi blur khỏi filter hoặc sau debounce khi không focus trong filter. */
  const syncLocalToContext = useCallback(() => {
    const local = localFilterInputRef.current;
    const fv = localInputToFilterValues(local);
    setFilterValues(fv);
    setIntentImmediate(searchInput ?? '', fv);
  }, [searchInput, setFilterValues, setIntentImmediate]);

  // Sync effect: bỏ qua lần đầu; sau đó chỉ sync khi user KHÔNG đang focus trong ô lọc → tránh re-render gây mất focus/đơ.
  const isFirstSyncRunRef = useRef(true);
  useEffect(() => {
    if (isFirstSyncRunRef.current) {
      isFirstSyncRunRef.current = false;
      return;
    }
    if (!userHasInteractedWithFiltersRef.current) return;
    const t = setTimeout(() => {
      // Đang focus trong vùng filter thì không sync (chỉ sync khi blur hoặc lần sau).
      if (document.activeElement?.closest('[data-filter-panel]')) return;
      startTransition(() => syncLocalToContext());
    }, FILTER_INTENT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [localFilterInput, searchInput, syncLocalToContext]);

  const {
    rowSelection,
    clearSelection,
    removeFromSelection,
    selectedIds,
    selectedCount,
  } = useRowSelection<Product>();
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formMode, setFormMode] = useState<ProductFormMode>('create');
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [viewMode, setViewMode] = useState<ListViewMode>(() => (window.innerWidth <= 768 ? 'cards' : 'table'));
  const [cardDensity, setCardDensity] = useState<CardDensity>('comfortable');
  const [desktopTableDensity, setDesktopTableDensity] = useState<DesktopTableDensity>('comfortable');
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [pageSizeDraft, setPageSizeDraft] = useState<number | null>(null);
  const [isEditingPageSize, setIsEditingPageSize] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historySearchInput, setHistorySearchInput] = useState('');
  const [historySearch] = useDebouncedValue(historySearchInput, 300);
  const [historyActionFilter, setHistoryActionFilter] = useState<string | undefined>(undefined);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskProduct, setTaskProduct] = useState<Product | null>(null);
  const [priceWorkflowProduct, setPriceWorkflowProduct] = useState<Product | null>(null);
  const [priceSubmitModalOpen, setPriceSubmitModalOpen] = useState(false);
  const [priceRejectModalOpen, setPriceRejectModalOpen] = useState(false);
  const [pendingPriceChangeId, setPendingPriceChangeId] = useState<number | null>(null);
  const [priceNewCost, setPriceNewCost] = useState<number | null>(null);
  const [priceNewSale, setPriceNewSale] = useState<number | null>(null);
  const [priceReason, setPriceReason] = useState('');
  const [priceEffectiveAt, setPriceEffectiveAt] = useState('');
  const [priceRejectReason, setPriceRejectReason] = useState('');
  const [priceWorkflowLoading, setPriceWorkflowLoading] = useState(false);
  const pageSizeInputRef = useRef<any>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const inlineFilterPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /* Bộ nhập nhanh trong modal Lọc: Enter chuyển ô, ô cuối → áp dụng lọc và đóng modal */
  useQuickEntryKeys(filterPanelRef, {
    onLastFieldEnter: () => {
      startTransition(() => syncLocalToContext());
      setFilterModalOpen(false);
    },
    enabled: filterModalOpen,
  });

  /* Bộ nhập nhanh hàng lọc inline (trên trang): Enter chuyển ô, ô cuối → áp dụng lọc */
  useQuickEntryKeys(inlineFilterPanelRef, {
    onLastFieldEnter: () => startTransition(() => syncLocalToContext()),
    enabled: activeFilters.length > 0,
  });

  const queryClient = useQueryClient();

  const setPage = useCallback((page: number) => {
    setPagination((p) => ({ ...p, current: page }));
  }, [setPagination]);

  const setPageSize = useCallback((pageSize: number) => {
    setPagination((p) => ({ ...p, pageSize }));
  }, [setPagination]);

  // User preferences: columns, filters, pageSize
  const { config, saveConfig } = useUserPreferences('products-list');
  const configRef = useRef<PreferencesConfig>({});

  // Keep latest config in a ref to avoid debounce starvation
  useEffect(() => {
    configRef.current = (config || {}) as PreferencesConfig;
  }, [config]);

  const savePreferences = useCallback(
    async (partial: PreferencesConfig) => {
      const merged = { ...(configRef.current || {}), ...(partial || {}) } as PreferencesConfig;
      configRef.current = merged; // optimistic to prevent overwriting other keys
      await saveConfig(merged);
    },
    [saveConfig]
  );

  const applyPageSize = useCallback(
    async (size: number) => {
      if (!Number.isFinite(size) || size < 1 || size > 500) {
        message.error('Nhập số từ 1-500');
        return;
      }
      setPageSize(size);
      setPage(1);
      await savePreferences({ pageSize: size });
      setPageSizeDraft(null);
      setIsEditingPageSize(false);
      message.success(`Đã đổi: ${size} dòng/trang`);
    },
    [savePreferences, setPage, setPageSize]
  );

  // Ref set đồng bộ trong onChange — tránh config load đúng lúc gõ ghi đè (ô lọc nhập liên tục).
  const userHasInteractedWithFiltersRef = useRef(false);
  const mountTimeRef = useRef(Date.now());
  /** Chỉ áp dụng filters từ config trong 800ms đầu; sau đó không ghi đè (tránh config load trễ). */
  const INITIAL_APPLY_WINDOW_MS = 800;

  // Áp dụng filters từ preferences: chỉ một lần, khi user chưa tương tác và config load sớm (trong 800ms).
  const appliedInitialPreferencesRef = useRef(false);
  useEffect(() => {
    if (!config || Object.keys(config).length === 0) return;
    if (config.filters && typeof config.filters === 'object') {
      appliedInitialPreferencesRef.current = true;
      const withinWindow = Date.now() - mountTimeRef.current <= INITIAL_APPLY_WINDOW_MS;
      if (withinWindow && !userHasInteractedWithFiltersRef.current) {
        const f = config.filters as { filterValues?: FilterValues; activeFilters?: FilterKey[] };
        if (f.filterValues && typeof f.filterValues === 'object') {
          setFilterValues(f.filterValues);
          setLocalFilterInput(filterValuesToLocalInput(f.filterValues));
          setIntentImmediate(searchInput ?? '', f.filterValues);
        }
        if (Array.isArray(f.activeFilters)) {
          setActiveFilters(f.activeFilters);
        }
      }
    }
    if (config.pageSize != null) {
      const n = Number(config.pageSize);
      if (n >= 1 && n <= 1000) {
        setPagination((p) => ({ ...p, pageSize: n }));
      }
    }
    if (config.sort && typeof config.sort === 'object' && config.sort.field && config.sort.order) {
      const s = config.sort as { field: string; order: 'asc' | 'desc' };
      setSortField(s.field);
      setSortOrder(s.order);
    }
    const savedMode = config.mobileListViewMode as ListViewMode | undefined;
    if (savedMode === 'table' || savedMode === 'cards') {
      setViewMode(savedMode);
    }
    const savedDensity = config.mobileCardDensity as CardDensity | undefined;
    if (savedDensity === 'comfortable' || savedDensity === 'compact') {
      setCardDensity(savedDensity);
    }
    const savedDesktopDensity = config.desktopTableDensity as DesktopTableDensity | undefined;
    if (savedDesktopDensity === 'comfortable' || savedDesktopDensity === 'compact') {
      setDesktopTableDensity(savedDesktopDensity);
    }
  }, [config, searchInput, setIntentImmediate]);

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

  /** Cập nhật ô lọc: chỉ đổi local (merge prev), không parse/validate trong onChange. */
  const applyFilterChange = useCallback((update: (prev: LocalFilterInput) => LocalFilterInput) => {
    userHasInteractedWithFiltersRef.current = true;
    setLocalFilterInput(update);
  }, []);

  // Persist filter changes to preferences (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      void savePreferences({
        filters: { filterValues, activeFilters } as any,
      });
    }, 600);
    return () => clearTimeout(t);
  }, [filterValues, activeFilters, savePreferences]);

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

  // Column permissions: chỉ hiện cột user được phép xem
  const { canViewColumn } = useColumnPermissions('products-list');

  const lastWrittenParams = useRef<string>('');
  const hasWrittenUrlOnce = useRef(false);
  /** Tránh effect ghi URL chạy với giá trị cũ khi vừa áp từ URL. */
  const skipNextUrlWrite = useRef(false);
  /** Thứ tự key cố định để chuẩn hóa URL khi so sánh — tránh nhảy chữ khi gõ nhanh (phải trùng với params ghi ra). */
  const ORDERED_URL_KEYS = [
    'q', 'code', 'name', 'category', 'unit', 'status', 'wave', 'box_type',
    'min_cost_price', 'max_cost_price', 'min_sale_price', 'max_sale_price',
    'size_po_dai', 'size_po_rong', 'size_po_cao', 'size_sx_dai', 'size_sx_rong', 'size_sx_cao',
    'waterproof', 'co_cm', 'note',
    'activeFilters', 'page', 'pageSize', 'exact_search',
  ];
  const [exactSearch, setExactSearch] = useState(false);

  // Nếu URL có params thì ưu tiên URL (vd: bookmark, chia sẻ link) — trừ khi URL vừa do mình ghi (tránh nhảy chữ khi gõ nhanh)
  useLayoutEffect(() => {
    const currentUrlStr = normalizeSearchParamsToOrderedString(searchParams, ORDERED_URL_KEYS);
    if (currentUrlStr === lastWrittenParams.current) return;

    const hasUrlParams = ORDERED_URL_KEYS.some((key) => searchParams.get(key) != null);
    if (!hasUrlParams) return;
    isFirstMount.current = false;
    const parsed = parseProductListParams(searchParams);
    const writtenParams = productListParamsToSearch(parsed.search, parsed.filterValues, parsed.activeFilters, parsed.page, parsed.pageSize, parsed.exactSearch);
    lastWrittenParams.current = normalizeParamsToOrderedString(writtenParams, ORDERED_URL_KEYS);
    setSearchInput(parsed.searchInput);
    setSearch(parsed.search);
    setExactSearch(parsed.exactSearch);
    setFilterValues(parsed.filterValues);
    setLocalFilterInput(filterValuesToLocalInput(parsed.filterValues));
    setIntentImmediate(parsed.search, parsed.filterValues);
    setActiveFilters(parsed.activeFilters);
    skipNextUrlWrite.current = true;
    setPagination((p) => ({
      ...p,
      current: parsed.page,
      pageSize: parsed.pageSize,
    }));
  }, [searchParams]);

  // Query layer: chỉ intent (đã debounce) ghi ra URL + localStorage; không đụng input.
  useEffect(() => {
    if (skipNextUrlWrite.current) {
      skipNextUrlWrite.current = false;
      return;
    }
    const params = productListParamsToSearch(
      intentSearch,
      intentFilters,
      activeFilters,
      pagination.current,
      pagination.pageSize,
      exactSearch
    );
    const str = normalizeParamsToOrderedString(params, ORDERED_URL_KEYS);
    if (str === lastWrittenParams.current) return;

    const doWrite = () => {
      lastWrittenParams.current = str;
      saveProductListStateToStorage(intentSearch, intentFilters, pagination.current, pagination.pageSize);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          ORDERED_URL_KEYS.forEach((k) => next.delete(k));
          Object.entries(params).forEach(([k, v]) => next.set(k, v));
          return next;
        },
        { replace: true }
      );
    };

    if (!hasWrittenUrlOnce.current) {
      hasWrittenUrlOnce.current = true;
      doWrite();
      return;
    }
    const timer = setTimeout(doWrite, URL_WRITE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [intentSearch, intentFilterStableString, activeFilters, pagination.current, pagination.pageSize, exactSearch, setSearchParams]);

  // Reset về trang 1 khi intent (tìm kiếm / lọc) thay đổi — bỏ qua lần đầu.
  const isFirstIntentRun = useRef(true);
  useEffect(() => {
    if (isFirstIntentRun.current) {
      isFirstIntentRun.current = false;
      return;
    }
    setPagination((p) => ({ ...p, current: 1 }));
  }, [intentSearch, intentFilterStableString]);

  // Query layer: queryKey chỉ phụ thuộc intent → API không gọi dư, không race với input.
  const productsQueryParamsKey = useMemo(() => {
    const params = productListParamsToSearch(
      intentSearch,
      intentFilters,
      activeFilters,
      pagination.current,
      pagination.pageSize,
      exactSearch
    );
    return normalizeParamsToOrderedString(params, ORDERED_URL_KEYS);
  }, [intentSearch, intentFilterStableString, activeFilters, pagination.current, pagination.pageSize, exactSearch]);

  const { data: productsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['products', productsQueryParamsKey, sortField, sortOrder],
    queryFn: () => {
      const params: Record<string, unknown> = {
        search: intentSearch?.trim() || undefined,
        q: intentSearch?.trim() || undefined,
        exact_search: exactSearch ? '1' : undefined,
        code: intentFilters.code?.trim() || undefined,
        name: intentFilters.name?.trim() || undefined,
        category: intentFilters.category ?? undefined,
        unit: intentFilters.unit ?? undefined,
        status: intentFilters.status ?? undefined,
        wave: intentFilters.wave ?? undefined,
        box_type: intentFilters.box_type ?? undefined,
        min_cost_price: intentFilters.min_cost_price ?? undefined,
        max_cost_price: intentFilters.max_cost_price ?? undefined,
        min_sale_price: intentFilters.min_sale_price ?? undefined,
        max_sale_price: intentFilters.max_sale_price ?? undefined,
        size_po_dai: intentFilters.size_po_dai ?? undefined,
        size_po_rong: intentFilters.size_po_rong ?? undefined,
        size_po_cao: intentFilters.size_po_cao ?? undefined,
        size_sx_dai: intentFilters.size_sx_dai ?? undefined,
        size_sx_rong: intentFilters.size_sx_rong ?? undefined,
        size_sx_cao: intentFilters.size_sx_cao ?? undefined,
        waterproof: intentFilters.waterproof != null ? String(intentFilters.waterproof) : undefined,
        co_cm: intentFilters.co_cm === true ? 'true' : intentFilters.co_cm === false ? 'false' : undefined,
        note: intentFilters.note?.trim() || undefined,
        page: pagination.current,
        page_size: pagination.pageSize,
      };
      if (sortField && sortOrder) {
        params.ordering = sortOrder === 'desc' ? `-${sortField}` : sortField;
      }
      return productsApi.getProducts(params);
    },
  });

  const { data: activityStream = [], isLoading: isHistoryLoading } = useQuery<ActivityItem[]>({
    queryKey: ['products', 'activity', historyProduct?.id ?? null],
    queryFn: () => productsApi.getActivityByEntity('Product', historyProduct!.id),
    enabled: historyModalOpen && historyProduct != null,
  });

  useEffect(() => {
    if (productsData?.count !== undefined) {
      setPagination((p) => ({ ...p, total: productsData.count }));
    }
  }, [productsData?.count]);

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', 'list'],
    queryFn: () => productsApi.getCategories({ page_size: 100 }),
  });

  const { data: unitsData } = useQuery({
    queryKey: ['units', 'list'],
    queryFn: () => productsApi.getUnits({ page_size: 100 }),
  });

  const { data: wavesData } = useQuery({
    queryKey: ['waves', 'list'],
    queryFn: () => productsApi.getWaves({ page_size: 100 }),
  });

  const { data: boxTypesData } = useQuery({
    queryKey: ['boxTypes', 'list'],
    queryFn: () => productsApi.getBoxTypes({ page_size: 100 }),
  });

  const { confirmDeleteOne, confirmBulkDelete } = useConfirmDelete();
  const { deleteOneMutation, bulkDeleteMutation } = useBulkDelete({
    queryKey: ['products'],
    deleteFn: (id) => productsApi.deleteProduct(id),
    onClearSelection: clearSelection,
    onRemoveFromSelection: removeFromSelection,
  });

  const categories = categoriesData?.results ?? [];
  const units = unitsData?.results ?? [];
  const waves = wavesData?.results ?? [];
  const boxTypes = boxTypesData?.results ?? [];
  const products = productsData?.results ?? [];

  const mergedActivity = useMemo<ActivityItem[]>(() => {
    const unique = new Map<string, ActivityItem>();
    activityStream.forEach((item) => {
      const key = getActivityDedupKey(item);
      if (!unique.has(key)) unique.set(key, item);
    });
    const base = Array.from(unique.values());
    const hasCreate = base.some((item) => getHistoryActionCode(item.action) === 'CREATE');

    if (historyProduct && !hasCreate && historyProduct.created_at) {
      base.push({
        type: 'audit',
        action: 'CREATE',
        user: historyProduct.created_by_name ?? null,
        timestamp: historyProduct.created_at,
        details: { content: 'Bản ghi được tạo.' },
      });
    }

    return base.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activityStream, historyProduct]);

  const filteredActivity = useMemo(
    () => filterHistoryItems(mergedActivity, historySearch, historyActionFilter, getHistoryFieldLabelVi),
    [mergedActivity, historyActionFilter, historySearch],
  );

  const refetchProducts = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['products'] });
  }, [queryClient]);

  const handleClearAllFilters = useCallback(() => {
    setActiveFilters([]);
    userHasInteractedWithFiltersRef.current = true;
    setLocalFilterInput({ ...EMPTY_LOCAL_FILTER_INPUT });
    setFilterValues(EMPTY_FILTER_VALUES);
    setIntentImmediate(searchInput ?? '', EMPTY_FILTER_VALUES);
    setPagination((p) => ({ ...p, current: 1 }));
  }, [searchInput, setFilterValues, setIntentImmediate]);

  const handleToggleFilter = useCallback((key: FilterKey) => {
    if (activeFilters.includes(key)) {
      setActiveFilters((prev) => prev.filter((k) => k !== key));
      userHasInteractedWithFiltersRef.current = true;
      if (key === 'cost_price') {
        setLocalFilterInput((v) => ({ ...v, min_cost_price: null, max_cost_price: null }));
      } else if (key === 'sale_price') {
        setLocalFilterInput((v) => ({ ...v, min_sale_price: null, max_sale_price: null }));
      } else {
        setLocalFilterInput((v) => ({ ...v, [key]: null } as LocalFilterInput));
      }
    } else {
      setActiveFilters((prev) => [...prev, key]);
    }
  }, [activeFilters]);

  const handleDelete = useCallback(
    (id: number) => deleteOneMutation.mutateAsync(id),
    [deleteOneMutation]
  );

  const handleDownloadTemplate = useCallback(async () => {
    try {
      message.loading({ content: 'Đang tải template...', key: 'template' });
      const blob = await productsApi.downloadTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `template_san_pham_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      message.success({ content: 'Đã tải template thành công!', key: 'template' });
    } catch (err: any) {
      message.error({
        content: err?.message || 'Tải template thất bại!',
        key: 'template',
      });
    }
  }, []);

  const handleImport = useCallback(async (file: File, options?: { updateIfExists?: boolean }) => {
    return await productsApi.importProducts(file, options);
  }, []);

  const handleExport = useCallback(async (format: 'excel' | 'pdf' = 'excel') => {
    try {
      message.loading({ content: format === 'pdf' ? 'Đang xuất PDF...' : 'Đang xuất dữ liệu...', key: 'export' });

      const params: Record<string, unknown> = {};
      if (intentSearch) params.search = intentSearch;
      if (intentFilters.code?.trim()) params.code = intentFilters.code.trim();
      if (intentFilters.name?.trim()) params.name = intentFilters.name.trim();
      if (intentFilters.category != null) params.category = intentFilters.category;
      if (intentFilters.unit != null) params.unit = intentFilters.unit;
      if (intentFilters.status != null) params.status = intentFilters.status;
      if (intentFilters.wave != null) params.wave = intentFilters.wave;
      if (intentFilters.box_type != null) params.box_type = intentFilters.box_type;
      if (intentFilters.min_cost_price != null) params.min_cost_price = intentFilters.min_cost_price;
      if (intentFilters.max_cost_price != null) params.max_cost_price = intentFilters.max_cost_price;
      if (intentFilters.min_sale_price != null) params.min_sale_price = intentFilters.min_sale_price;
      if (intentFilters.max_sale_price != null) params.max_sale_price = intentFilters.max_sale_price;
      if (intentFilters.size_po_dai != null) params.size_po_dai = intentFilters.size_po_dai;
      if (intentFilters.size_po_rong != null) params.size_po_rong = intentFilters.size_po_rong;
      if (intentFilters.size_po_cao != null) params.size_po_cao = intentFilters.size_po_cao;
      if (intentFilters.size_sx_dai != null) params.size_sx_dai = intentFilters.size_sx_dai;
      if (intentFilters.size_sx_rong != null) params.size_sx_rong = intentFilters.size_sx_rong;
      if (intentFilters.size_sx_cao != null) params.size_sx_cao = intentFilters.size_sx_cao;
      if (intentFilters.waterproof != null) params.waterproof = String(intentFilters.waterproof);
      if (intentFilters.co_cm === true) params.co_cm = true;
      if (intentFilters.co_cm === false) params.co_cm = false;
      if (intentFilters.note?.trim()) params.note = intentFilters.note.trim();

      const blob = await productsApi.exportProducts(format, params);

      if (!(blob instanceof Blob) || blob.size === 0) {
        message.error({ content: 'Dữ liệu xuất rỗng hoặc không hợp lệ.', key: 'export' });
        return;
      }
      const isExcel =
        blob.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        blob.type === 'application/vnd.ms-excel' ||
        blob.type.includes('spreadsheet') ||
        (blob.type === '' && blob.size > 0 && format === 'excel'); // CORS đôi khi làm blob.type rỗng
      const isPdf = blob.type === 'application/pdf' || (blob.type === '' && format === 'pdf');
      if (!isExcel && !isPdf) {
        message.error({
          content: 'Phản hồi không phải file Excel/PDF. Kiểm tra API export và khởi động lại Django nếu cần.',
          key: 'export',
        });
        return;
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'pdf'
        ? `san_pham_${new Date().toISOString().slice(0, 10)}.pdf`
        : `san_pham_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 200);

      message.success({ content: format === 'pdf' ? 'Xuất PDF thành công!' : 'Xuất Excel thành công!', key: 'export' });
    } catch (err: any) {
      console.error('Export error:', err);
      const msg =
        err?.message ||
        (typeof err.response?.data?.detail === 'string' ? err.response.data.detail : null) ||
        (typeof err.response?.data?.error === 'string' ? err.response.data.error : null) ||
        'Xuất Excel thất bại!';
      message.error({ content: msg, key: 'export' });
    }
  }, [intentSearch, intentFilterStableString]);

  const handleAdd = useCallback(() => {
    setFormMode('create');
    setEditingProduct(null);
    setFormVisible(true);
  }, []);

  const handleEdit = useCallback((product: Product) => {
    setFormMode('edit');
    setEditingProduct(product);
    setFormVisible(true);
  }, []);

  const handleClone = useCallback((record: Product) => {
    const cloned = { ...record };
    delete (cloned as Record<string, unknown>).id;
    delete (cloned as Record<string, unknown>).code;
    cloned.name = `${record.name} (Copy)`;
    setFormMode('create');
    setEditingProduct(cloned);
    setFormVisible(true);
  }, []);

  const openHistoryModal = useCallback((record: Product) => {
    setHistoryProduct(record);
    setHistorySearchInput('');
    setHistoryActionFilter(undefined);
    setHistoryModalOpen(true);
  }, []);

  const refreshAfterPriceWorkflow = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['products', 'activity'] });
  }, [queryClient]);

  const getLatestPendingPriceChange = useCallback(async (productId: number): Promise<PriceChangeRecord | null> => {
    const changes = await productsApi.getPriceChanges(productId);
    return changes.find((item) => item.status === 'PENDING') ?? null;
  }, []);

  const openSubmitPriceModal = useCallback((record: Product) => {
    setPriceWorkflowProduct(record);
    setPriceNewCost(Number(record.cost_price ?? 0));
    setPriceNewSale(Number(record.sale_price ?? 0));
    setPriceReason('');
    setPriceEffectiveAt('');
    setPriceSubmitModalOpen(true);
  }, []);

  const handleSubmitPriceChange = useCallback(async () => {
    if (!priceWorkflowProduct) return;
    const reason = priceReason.trim();
    if (!reason) {
      message.warning('Vui lòng nhập lý do đề xuất thay đổi giá.');
      return;
    }
    const currentCost = Number(priceWorkflowProduct.cost_price ?? 0);
    const currentSale = Number(priceWorkflowProduct.sale_price ?? 0);
    const nextCost = priceNewCost ?? currentCost;
    const nextSale = priceNewSale ?? currentSale;
    if (nextCost === currentCost && nextSale === currentSale) {
      message.warning('Bạn chưa thay đổi giá vốn hoặc đơn giá.');
      return;
    }
    if (nextSale < nextCost) {
      message.warning('Đơn giá mới phải lớn hơn hoặc bằng giá vốn mới.');
      return;
    }
    setPriceWorkflowLoading(true);
    try {
      await productsApi.submitPriceChange(priceWorkflowProduct.id, {
        new_cost_price: nextCost,
        new_sale_price: nextSale,
        reason,
        effective_at: normalizeDateTimeLocal(priceEffectiveAt),
      });
      message.success('Đã gửi đề xuất thay đổi giá.');
      setPriceSubmitModalOpen(false);
      setPriceWorkflowProduct(null);
      refreshAfterPriceWorkflow();
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || 'Gửi đề xuất thay đổi giá thất bại.');
    } finally {
      setPriceWorkflowLoading(false);
    }
  }, [priceWorkflowProduct, priceReason, priceNewCost, priceNewSale, priceEffectiveAt, refreshAfterPriceWorkflow]);

  const handleApproveLatestPriceChange = useCallback(async (record: Product) => {
    setPriceWorkflowLoading(true);
    try {
      const pending = await getLatestPendingPriceChange(record.id);
      if (!pending) {
        message.info('Không có đề xuất giá nào đang chờ duyệt.');
        return;
      }
      await productsApi.approvePriceChange(record.id, pending.id);
      message.success('Đã duyệt đề xuất thay đổi giá.');
      refreshAfterPriceWorkflow();
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || 'Duyệt đề xuất giá thất bại.');
    } finally {
      setPriceWorkflowLoading(false);
    }
  }, [getLatestPendingPriceChange, refreshAfterPriceWorkflow]);

  const openRejectLatestPriceChangeModal = useCallback(async (record: Product) => {
    setPriceWorkflowLoading(true);
    try {
      const pending = await getLatestPendingPriceChange(record.id);
      if (!pending) {
        message.info('Không có đề xuất giá nào đang chờ duyệt.');
        return;
      }
      setPriceWorkflowProduct(record);
      setPendingPriceChangeId(pending.id);
      setPriceRejectReason('');
      setPriceRejectModalOpen(true);
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || 'Không lấy được đề xuất giá chờ duyệt.');
    } finally {
      setPriceWorkflowLoading(false);
    }
  }, [getLatestPendingPriceChange]);

  const handleRejectLatestPriceChange = useCallback(async () => {
    if (!priceWorkflowProduct || !pendingPriceChangeId) return;
    const rejectReason = priceRejectReason.trim();
    if (!rejectReason) {
      message.warning('Vui lòng nhập lý do từ chối.');
      return;
    }
    setPriceWorkflowLoading(true);
    try {
      await productsApi.rejectPriceChange(priceWorkflowProduct.id, pendingPriceChangeId, rejectReason);
      message.success('Đã từ chối đề xuất thay đổi giá.');
      setPriceRejectModalOpen(false);
      setPriceWorkflowProduct(null);
      setPendingPriceChangeId(null);
      setPriceRejectReason('');
      refreshAfterPriceWorkflow();
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || 'Từ chối đề xuất giá thất bại.');
    } finally {
      setPriceWorkflowLoading(false);
    }
  }, [priceWorkflowProduct, pendingPriceChangeId, priceRejectReason, refreshAfterPriceWorkflow]);

  const openTaskModal = useCallback((record: Product) => {
    setTaskProduct(record);
    setTaskModalOpen(true);
  }, []);

  const handleRowAction = useCallback((action: string, record: Product) => {
    if (action === 'history') {
      openHistoryModal(record);
      return;
    }
    if (action === 'tasks') {
      openTaskModal(record);
      return;
    }
    if (action === 'copy') {
      handleClone(record);
      return;
    }
    if (action === 'submit_price_change') {
      openSubmitPriceModal(record);
      return;
    }
    if (action === 'approve_price_change') {
      void handleApproveLatestPriceChange(record);
      return;
    }
    if (action === 'reject_price_change') {
      void openRejectLatestPriceChangeModal(record);
      return;
    }
    if (action === 'delete') {
      confirmDeleteOne(record.name || record.code || String(record.id), () => handleDelete(record.id));
    }
  }, [
    confirmDeleteOne,
    handleClone,
    handleDelete,
    openHistoryModal,
    openTaskModal,
    openSubmitPriceModal,
    handleApproveLatestPriceChange,
    openRejectLatestPriceChangeModal,
  ]);

  const renderRowActions = useCallback((record: Product) => (
    <div className="table-row-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'submit_price_change', icon: <SendOutlined />, label: 'Trình duyệt thay đổi giá' },
            { key: 'approve_price_change', icon: <CheckOutlined />, label: 'Duyệt đề xuất giá gần nhất' },
            { key: 'reject_price_change', icon: <CloseOutlined />, label: 'Từ chối đề xuất giá gần nhất', danger: true },
            { type: 'divider' },
            {
              key: 'tasks',
              icon: <ProjectOutlined />,
              label: (
                <span>
                  Giao nhiệm vụ
                  {(record.blocking_tasks_count ?? 0) > 0 && (
                    <Tooltip title="Có blocking task đang chặn sản xuất">
                      <LockOutlined style={{ color: '#ff4d4f', marginLeft: 6 }} />
                    </Tooltip>
                  )}
                </span>
              ),
            },
            { key: 'history', icon: <HistoryOutlined />, label: 'Lịch sử hoạt động' },
            { key: 'copy', icon: <CopyOutlined />, label: 'Nhân bản' },
            { type: 'divider' },
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
  ), [handleRowAction]);

  const handleFormClose = useCallback(() => {
    setFormVisible(false);
    setFormMode('create');
    setEditingProduct(null);
  }, []);

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

  const addSortToColumn = (
    col: (ColumnsType<Product>[number] & { sortField?: string })
  ): ColumnsType<Product>[number] => {
    if (col.key === 'actions' || !col.sortField) return col;
    const label = typeof col.title === 'function'
      ? (typeof col.key === 'string' ? col.key : '')
      : col.title;
    const orderingParam = col.sortField;
    return {
      ...col,
      title: (
        <div
          onClick={(e) => { e.stopPropagation(); handleSort(orderingParam); }}
          style={{ cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}
        >
          {label}
          <SortIcon orderingParam={orderingParam} />
        </div>
      ),
    };
  };

  const allColumnsBase: (ColumnsType<Product>[number] & { sortField?: string })[] = [
    {
      title: 'Mã hàng',
      dataIndex: 'code',
      key: 'code',
      sortField: 'code',
      width: 100,
      fixed: 'left' as const,
      render: (code: string, record: Product) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span
            role="button"
            tabIndex={0}
            onClick={() => handleEdit(record)}
            onKeyDown={(e) => e.key === 'Enter' && handleEdit(record)}
            style={{ fontWeight: 500, color: theme.colors.primary, cursor: 'pointer' }}
          >
            {code ?? '-'}
          </span>
          {(record.blocking_tasks_count ?? 0) > 0 && (
            <Tooltip title={`${record.blocking_tasks_count} nhiệm vụ blocking đang chặn sản xuất`}>
              <LockOutlined
                style={{ color: '#ff4d4f', fontSize: 12, cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); openTaskModal(record); }}
              />
            </Tooltip>
          )}
        </span>
      ),
    },
    { title: 'Tên hàng', dataIndex: 'name', key: 'name', sortField: 'name', width: 200, ellipsis: true, render: (n: string) => <span className="cell-text-primary">{n ?? '-'}</span> },
    { title: 'Danh mục', dataIndex: 'category_name', key: 'category_name', sortField: 'category__name', width: 140, ellipsis: true, render: (t: string) => <span className="cell-text-secondary">{t ?? '-'}</span> },
    {
      title: 'Giá vốn',
      dataIndex: 'cost_price',
      key: 'cost_price',
      sortField: 'cost_price',
      width: 95,
      align: 'right' as const,
      render: (p: string) => <FormattedPrice value={p} color="#6b7280" bold={false} />,
    },
    {
      title: 'Đơn giá',
      dataIndex: 'sale_price',
      key: 'sale_price',
      sortField: 'sale_price',
      width: 95,
      align: 'right' as const,
      render: (p: string, record: Product) => {
        const sale = Number(p);
        const cost = Number(record.cost_price ?? 0);
        const isMarginRisk = Number.isFinite(sale) && Number.isFinite(cost) && cost > 0 && sale < cost;
        return (
          <span className={isMarginRisk ? 'cell-warning-soft' : undefined}>
            <FormattedPrice value={p} />
          </span>
        );
      },
    },
    { title: 'HHCĐ', dataIndex: 'commission_per_unit', key: 'commission_per_unit', sortField: 'commission_per_unit', width: 75, align: 'right' as const, render: (v: string) => parseFloat(v || '0').toLocaleString('vi-VN') },
    { title: 'HH%', dataIndex: 'commission_percent', key: 'commission_percent', sortField: 'commission_percent', width: 60, align: 'right' as const, render: (v: string) => parseFloat(v || '0').toLocaleString('vi-VN') },
    ...(sizeDisplayMode === 'separated'
      ? [
          { title: 'Dài PO', key: 'size_po_dai', sortField: 'size_order', width: 72, align: 'center' as const, render: (_: unknown, r: Product) => parseSizeDRC(r.size_order)[0] || '-' },
          { title: 'Rộng PO', key: 'size_po_rong', sortField: 'size_order', width: 72, align: 'center' as const, render: (_: unknown, r: Product) => parseSizeDRC(r.size_order)[1] || '-' },
          { title: 'Cao PO', key: 'size_po_cao', sortField: 'size_order', width: 72, align: 'center' as const, render: (_: unknown, r: Product) => parseSizeDRC(r.size_order)[2] || '-' },
          { title: 'Dài SX', key: 'size_sx_dai', sortField: 'size_production', width: 72, align: 'center' as const, render: (_: unknown, r: Product) => parseSizeDRC(r.size_production)[0] || '-' },
          { title: 'Rộng SX', key: 'size_sx_rong', sortField: 'size_production', width: 72, align: 'center' as const, render: (_: unknown, r: Product) => parseSizeDRC(r.size_production)[1] || '-' },
          { title: 'Cao SX', key: 'size_sx_cao', sortField: 'size_production', width: 72, align: 'center' as const, render: (_: unknown, r: Product) => parseSizeDRC(r.size_production)[2] || '-' },
        ]
      : [
          {
            title: 'Kích thước ĐH',
            key: 'size_po_merged',
            width: 140,
            align: 'center' as const,
            render: (_: unknown, r: Product) => {
              const [d, w, h] = parseSizeDRC(r.size_order);
              if (!d && !w && !h) return '-';
              return `${d || 0} x ${w || 0} x ${h || 0}`;
            },
          },
          {
            title: 'KTSX',
            key: 'size_sx_merged',
            width: 140,
            align: 'center' as const,
            render: (_: unknown, r: Product) => {
              const [d, w, h] = parseSizeDRC(r.size_production);
              if (!d && !w && !h) return '-';
              return `${d || 0} x ${w || 0} x ${h || 0}`;
            },
          },
        ]),
    { title: 'Sóng', dataIndex: 'wave_code', key: 'wave_code', sortField: 'wave__code', width: 56, align: 'center' as const, render: (t: string) => t ?? '-' },
    { title: 'Kiểu', dataIndex: 'box_type_code', key: 'box_type_code', sortField: 'box_type__code', width: 56, align: 'center' as const, render: (t: string) => t ?? '-' },
    { title: 'ĐVT', dataIndex: 'unit_name', key: 'unit_name', sortField: 'unit__code', width: 56, align: 'center' as const, render: (n: string) => (n && n.split(' - ')[0]) || '-' },
    { title: '+/-', dataIndex: 'delivery_tolerance', key: 'delivery_tolerance', sortField: 'delivery_tolerance', width: 80, ellipsis: true, render: (t: string) => t ?? '-' },
    { title: 'Xả', dataIndex: 'process_xa', key: 'process_xa', sortField: 'process_xa', width: 56, align: 'right' as const, render: (v: number | null) => v != null ? v : '-' },
    { title: 'In', dataIndex: 'process_in', key: 'process_in', sortField: 'process_in', width: 56, align: 'right' as const, render: (v: number | null) => v != null ? v : '-' },
    { title: 'Mã phim', dataIndex: 'film_code', key: 'film_code', sortField: 'film_code', width: 90, ellipsis: true, render: (t: string) => (t && t.replace(/\.pdf$/i, '')) || '-' },
    { title: 'Số màu', dataIndex: 'color_count', key: 'color_count', sortField: 'color_count', width: 68, align: 'center' as const, render: (v: number) => v != null ? v : '-' },
    { title: 'C. thấm', dataIndex: 'waterproof', key: 'waterproof', sortField: 'waterproof', width: 72, align: 'center' as const, render: (v: string) => WATERPROOF_LABELS[v as string] ?? (v || '-') },
    { title: 'Có CM', key: 'co_cm', sortField: 'process_can_mang', width: 60, align: 'center' as const, render: (_: unknown, r: Product) => (r.process_can_mang != null && Number(r.process_can_mang) > 0 ? 'Có' : '—') },
    { title: 'C. Màng', dataIndex: 'process_can_mang', key: 'process_can_mang', sortField: 'process_can_mang', width: 72, align: 'right' as const, render: (v: number | null) => v != null ? v : '-' },
    { title: 'Bồi', dataIndex: 'process_boi', key: 'process_boi', sortField: 'process_boi', width: 56, align: 'right' as const, render: (v: number | null) => v != null ? v : '-' },
    { title: 'Bế', dataIndex: 'process_be', key: 'process_be', sortField: 'process_be', width: 56, align: 'right' as const, render: (v: number | null) => v != null ? v : '-' },
    { title: 'Mã khuôn', dataIndex: 'mold_code', key: 'mold_code', sortField: 'mold_code', width: 90, ellipsis: true, render: (t: string) => (t && t.replace(/\.pdf$/i, '')) || '-' },
    { title: 'Chạp', dataIndex: 'process_chap', key: 'process_chap', sortField: 'process_chap', width: 56, align: 'right' as const, render: (v: number | null) => v != null ? v : '-' },
    { title: 'Đóng', dataIndex: 'process_dong', key: 'process_dong', sortField: 'process_dong', width: 56, align: 'right' as const, render: (v: number | null) => v != null ? v : '-' },
    { title: 'Dán', dataIndex: 'process_dan', key: 'process_dan', sortField: 'process_dan', width: 56, align: 'right' as const, render: (v: number | null) => v != null ? v : '-' },
    { title: 'Khác', dataIndex: 'process_khac', key: 'process_khac', sortField: 'process_khac', width: 56, align: 'right' as const, render: (v: number | null) => v != null ? v : '-' },
    { title: 'Ghi chú công đoạn khác', dataIndex: 'note_other', key: 'note_other', sortField: 'note_other', width: 140, ellipsis: true, render: (t: string) => t ?? '-' },
    { title: 'Ghi chú chung', dataIndex: 'note', key: 'note', sortField: 'note', width: 140, ellipsis: true, render: (t: string) => t ?? '-' },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      sortField: 'status',
      width: 100,
      align: 'center' as const,
      render: (v: string, record: Product) => {
        const label = (PRODUCT_STATUS_LABELS as Record<string, string>)[v] ?? v ?? '-';
        return (
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span className={`status-pill status-pill-${getProductStatusTone(v)}`}>
              {label}
            </span>
            {record.has_pending_price_change && (
              <Tag color="gold" style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', paddingInline: 6 }}>
                Chờ duyệt giá
              </Tag>
            )}
          </div>
        );
      },
    },
    {
      title: 'Thao tác',
      key: 'actions',
      fixed: 'right' as const,
      width: 72,
      align: 'center' as const,
      render: (_: unknown, record: Product) => renderRowActions(record),
    },
  ];

  const allColumns: ColumnsType<Product> = allColumnsBase.map((col) => addSortToColumn(col));

  // Chỉ giữ cột user được phép xem (column permissions)
  const allowedColumnDefs = allColumns.filter(
    (col) => col.key === 'actions' || canViewColumn(col.key as string)
  );

  // Filter columns: theo visibleColumns (bao gồm cột Thao tác)
  const displayColumns = allowedColumnDefs.filter((col) =>
    (visibleColumns ?? []).includes(col.key as string)
  );
  const columns = displayColumns;

  // Bản đồ key → tên cột tiếng Việt (đúng với tiêu đề bảng)
  const columnKeyToTitle: Record<string, string> = {};
  allColumnsBase.forEach((col) => {
    if (typeof col.title === 'string') columnKeyToTitle[col.key as string] = col.title;
  });
  // Danh sách cột cho modal "Hiển thị cột" — hiển thị tiếng Việt đúng tên cột (bao gồm Thao tác)
  const columnChooserList = allowedColumnDefs.map((col) => ({
      key: col.key as string,
      title: columnKeyToTitle[col.key as string] ?? (col.key as string),
      required: col.key === 'code' || col.key === 'name',
    }));

  const allFiltersSelected = FILTER_KEYS.length > 0 && activeFilters.length === FILTER_KEYS.length;
  const someFiltersSelected = activeFilters.length > 0;

  const handleSelectAllFilters = useCallback((checked: boolean) => {
    if (checked) {
      setActiveFilters([...FILTER_KEYS]);
    } else {
      handleClearAllFilters();
    }
  }, [handleClearAllFilters]);

  const filterModalContent = (
    <div
      ref={filterPanelRef}
      data-filter-panel
      style={{ padding: '4px 0' }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) startTransition(() => syncLocalToContext());
      }}
    >
      <div style={{ marginBottom: 6, fontWeight: 600, fontSize: 14 }}>
        Chọn bộ lọc — tick để bật và chọn giá trị bên dưới
      </div>
      <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #f0f0f0' }}>
        <Checkbox
          checked={allFiltersSelected}
          indeterminate={someFiltersSelected && !allFiltersSelected}
          onChange={(e) => handleSelectAllFilters(e.target.checked)}
          style={{ fontWeight: 600 }}
        >
          Chọn tất cả / Bỏ chọn tất cả
        </Checkbox>
      </div>
      {FILTER_OPTIONS.map((opt) => (
        <div key={opt.key} style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Checkbox
            checked={activeFilters.includes(opt.key)}
            onChange={() => handleToggleFilter(opt.key)}
          >
            {opt.label}
          </Checkbox>
          {activeFilters.includes(opt.key) && (
            <>
              {opt.key === 'code' && (
                <div data-quick-entry>
                <FilterTextInput
                  data-field="code_filter_modal"
                  value={localFilterInput.code ?? ''}
                  onChange={(v) => applyFilterChange((prev) => ({ ...prev, code: v === '' ? null : v }))}
                  placeholder="Mã hàng chứa..."
                  style={{ width: 220 }}
                  showClear={((localFilterInput.code ?? '').trim()) !== ''}
                  onClear={() => applyFilterChange((prev) => ({ ...prev, code: null }))}
                />
                </div>
              )}
              {opt.key === 'name' && (
                <div data-quick-entry>
                <FilterTextInput
                  data-field="name_filter_modal"
                  value={localFilterInput.name ?? ''}
                  onChange={(v) => applyFilterChange((prev) => ({ ...prev, name: v === '' ? null : v }))}
                  placeholder="Tên hàng chứa..."
                  style={{ width: 220 }}
                  showClear={((localFilterInput.name ?? '').trim()) !== ''}
                  onClear={() => applyFilterChange((prev) => ({ ...prev, name: null }))}
                />
                </div>
              )}
              {opt.key === 'category' && (
                <div data-quick-entry style={{ width: 220 }}>
                  <FilterSelect
                    placeholder="Chọn danh mục"
                    style={{ width: 220 }}
                    value={localFilterInput.category}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, category: toNumberOrNull(v) }))}
                    options={categories.map((c) => ({ label: c.name, value: c.id }))}
                    showClear
                    hasValue={localFilterInput.category != null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, category: null }))}
                  />
                </div>
              )}
              {opt.key === 'unit' && (
                <div data-quick-entry style={{ width: 220 }}>
                  <FilterSelect
                    placeholder="Chọn đơn vị"
                    style={{ width: 220 }}
                    value={localFilterInput.unit}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, unit: toNumberOrNull(v) }))}
                    options={units.map((u) => ({ label: u.name, value: u.id }))}
                    showClear
                    hasValue={localFilterInput.unit != null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, unit: null }))}
                  />
                </div>
              )}
              {opt.key === 'status' && (
                <div data-quick-entry style={{ width: 220 }}>
                  <FilterSelect
                    placeholder="Chọn trạng thái"
                    style={{ width: 220 }}
                    value={localFilterInput.status}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, status: toStatusOrNull(v) }))}
                    options={[
                      { label: 'Nháp', value: 'DRAFT' },
                      { label: 'Đang bán', value: 'ACTIVE' },
                      { label: 'Ngừng SX', value: 'DISCONTINUED' },
                    ]}
                    showClear
                    hasValue={localFilterInput.status != null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, status: null }))}
                  />
                </div>
              )}
              {opt.key === 'wave' && (
                <div data-quick-entry style={{ width: 220 }}>
                  <FilterSelect
                    placeholder="Chọn sóng"
                    style={{ width: 220 }}
                    value={localFilterInput.wave}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, wave: toNumberOrNull(v) }))}
                    options={waves.map((w: { id: number; code: string }) => ({ label: w.code, value: w.id }))}
                    showClear
                    hasValue={localFilterInput.wave != null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, wave: null }))}
                  />
                </div>
              )}
              {opt.key === 'box_type' && (
                <div data-quick-entry style={{ width: 220 }}>
                  <FilterSelect
                    placeholder="Chọn kiểu"
                    style={{ width: 220 }}
                    value={localFilterInput.box_type}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, box_type: toNumberOrNull(v) }))}
                    options={boxTypes.map((b: { id: number; code: string }) => ({ label: b.code, value: b.id }))}
                    showClear
                    hasValue={localFilterInput.box_type != null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, box_type: null }))}
                  />
                </div>
              )}
              {opt.key === 'cost_price' && (
                <Space size={8}>
                  <div data-quick-entry style={{ width: 100 }}>
                    <FilterNumberInput data-field="min_cost_price" value={localFilterInput.min_cost_price ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, min_cost_price: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, min_cost_price: null }))} placeholder="Từ" inputMode="decimal" />
                  </div>
                  <span>–</span>
                  <div data-quick-entry style={{ width: 100 }}>
                    <FilterNumberInput data-field="max_cost_price" value={localFilterInput.max_cost_price ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, max_cost_price: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, max_cost_price: null }))} placeholder="Đến" inputMode="decimal" />
                  </div>
                </Space>
              )}
              {opt.key === 'sale_price' && (
                <Space size={8}>
                  <div data-quick-entry style={{ width: 100 }}>
                    <FilterNumberInput data-field="min_sale_price" value={localFilterInput.min_sale_price ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, min_sale_price: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, min_sale_price: null }))} placeholder="Từ" inputMode="decimal" />
                  </div>
                  <span>–</span>
                  <div data-quick-entry style={{ width: 100 }}>
                    <FilterNumberInput data-field="max_sale_price" value={localFilterInput.max_sale_price ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, max_sale_price: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, max_sale_price: null }))} placeholder="Đến" inputMode="decimal" />
                  </div>
                </Space>
              )}
              {opt.key === 'size_po_dai' && (
                <div data-quick-entry style={{ width: 120 }}>
                  <FilterNumberInput data-field="size_po_dai" value={localFilterInput.size_po_dai ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_po_dai: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_po_dai: null }))} placeholder="Dài PO (mm)" inputMode="numeric" />
                </div>
              )}
              {opt.key === 'size_po_rong' && (
                <div data-quick-entry style={{ width: 120 }}>
                  <FilterNumberInput data-field="size_po_rong" value={localFilterInput.size_po_rong ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_po_rong: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_po_rong: null }))} placeholder="Rộng PO (mm)" inputMode="numeric" />
                </div>
              )}
              {opt.key === 'size_po_cao' && (
                <div data-quick-entry style={{ width: 120 }}>
                  <FilterNumberInput data-field="size_po_cao" value={localFilterInput.size_po_cao ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_po_cao: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_po_cao: null }))} placeholder="Cao PO (mm)" inputMode="numeric" />
                </div>
              )}
              {opt.key === 'size_sx_dai' && (
                <div data-quick-entry style={{ width: 120 }}>
                  <FilterNumberInput data-field="size_sx_dai" value={localFilterInput.size_sx_dai ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_sx_dai: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_sx_dai: null }))} placeholder="Dài SX (mm)" inputMode="numeric" />
                </div>
              )}
              {opt.key === 'size_sx_rong' && (
                <div data-quick-entry style={{ width: 120 }}>
                  <FilterNumberInput data-field="size_sx_rong" value={localFilterInput.size_sx_rong ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_sx_rong: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_sx_rong: null }))} placeholder="Rộng SX (mm)" inputMode="numeric" />
                </div>
              )}
              {opt.key === 'size_sx_cao' && (
                <div data-quick-entry style={{ width: 120 }}>
                  <FilterNumberInput data-field="size_sx_cao" value={localFilterInput.size_sx_cao ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_sx_cao: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_sx_cao: null }))} placeholder="Cao SX (mm)" inputMode="numeric" />
                </div>
              )}
              {opt.key === 'waterproof' && (
                <div data-quick-entry style={{ width: 140 }}>
                  <FilterSelect
                    placeholder="C. thấm"
                    style={{ width: 140 }}
                    value={localFilterInput.waterproof ?? undefined}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, waterproof: toStringOrNull(v) }))}
                    options={Object.entries(WATERPROOF_LABELS).map(([val, label]) => ({ label, value: val }))}
                    showClear
                    hasValue={(localFilterInput.waterproof ?? '') !== ''}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, waterproof: null }))}
                  />
                </div>
              )}
              {opt.key === 'co_cm' && (
                <div data-quick-entry style={{ width: 120 }}>
                  <FilterSelect
                    placeholder="Có CM"
                    style={{ width: 120 }}
                    value={localFilterInput.co_cm === null ? undefined : localFilterInput.co_cm ? 'true' : 'false'}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, co_cm: v === undefined ? null : v === 'true' }))}
                    options={[
                      { label: 'Có', value: 'true' },
                      { label: 'Không', value: 'false' },
                    ]}
                    showClear
                    hasValue={localFilterInput.co_cm !== null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, co_cm: null }))}
                  />
                </div>
              )}
              {opt.key === 'note' && (
                <div data-quick-entry>
                <FilterTextInput
                  data-field="note_filter_modal"
                  value={localFilterInput.note ?? ''}
                  onChange={(v) => applyFilterChange((prev) => ({ ...prev, note: v === '' ? null : v }))}
                  placeholder="Ghi chú chung chứa..."
                  style={{ width: 220 }}
                  showClear={((localFilterInput.note ?? '').trim()) !== ''}
                  onClear={() => applyFilterChange((prev) => ({ ...prev, note: null }))}
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
        {/* HEADER: Row 1 = Title (trái) + Nút chính (phải); Row 2 = Bộ lọc đang bật (trái) */}
        <div
          className="list-page-head"
          style={{
            background: 'white',
            padding: isMobile ? '12px' : '16px 24px',
            borderRadius: '8px 8px 0 0',
            marginBottom: 0,
          }}
        >
          {/* Row 1: Title bên trái, Tìm kiếm + Lọc + Cột + Nhập/Xuất + Thêm mới bên phải */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                📦 Quản lý sản phẩm
              </h2>
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
                placeholder="Tìm theo mã, tên hàng..."
                value={searchInput}
                onChange={(v) => {
                  setSearchInput(v);
                  if (v.trim() === '') setSearch('');
                }}
                onClear={() => {
                  setSearch('');
                  setPagination((p) => ({ ...p, current: 1 }));
                }}
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
              <Button
                icon={<FilterOutlined />}
                onClick={() => setFilterModalOpen(true)}
                  title="Lọc"
              >
                  {`Lọc ${activeFilters.length > 0 ? `(${activeFilters.length})` : ''}`}
              </Button>
              )}
              <Modal
                title="Bộ lọc sản phẩm"
                open={filterModalOpen}
                onCancel={() => setFilterModalOpen(false)}
                footer={[
                  <Button key="clear" size="small" onClick={handleClearAllFilters}>
                    Xóa hết bộ lọc
                  </Button>,
                  <Button key="close" type="primary" onClick={() => setFilterModalOpen(false)}>
                    Xong
                  </Button>,
                ]}
                width={400}
                destroyOnHidden={false}
                forceRender
              >
                {filterModalContent}
              </Modal>
              {!isMobile && (
              <ColumnChooser
                columns={columnChooserList}
                visibleColumns={visibleColumns}
                onChange={handleVisibleColumnsChange}
                sizeDisplayMode={sizeDisplayMode}
                onSizeDisplayModeChange={handleSizeDisplayModeChange}
              />
              )}
              {!isMobile && (
                <Button icon={<UploadOutlined />} onClick={() => setImportModalVisible(true)} title="Nhập Excel">
              Nhập Excel
            </Button>
              )}
              {!isMobile && (
                <Button icon={<ExportOutlined />} onClick={() => handleExport('excel')} title="Xuất Excel">
              Xuất Excel
            </Button>
              )}
              {!isMobile && (
                <Button icon={<ExportOutlined />} onClick={() => handleExport('pdf')} title="Xuất PDF">
              Xuất PDF
            </Button>
              )}
              {!isMobile && (
                <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} title="Thêm mới">
              Thêm mới
            </Button>
              )}
            {!isMobile && selectedCount > 0 && (
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  if (selectedIds.length === 0) {
                    message.warning(TOAST.SELECT_AT_LEAST_ONE);
                    return;
                  }
                  confirmBulkDelete(selectedIds.length, () => bulkDeleteMutation.mutateAsync(selectedIds));
                }}
              >
                Xóa ({selectedCount})
              </Button>
            )}
            </div>
          </div>

          {/* Row 2: Bộ lọc đang bật — nhãn trên phải, ô dưới (gọn) */}
          {activeFilters.length > 0 && (
            <div
              ref={inlineFilterPanelRef}
              data-filter-panel
              style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) startTransition(() => syncLocalToContext());
              }}
            >
              {/* Nhãn nhỏ trên-phải: style chung cho mỗi ô lọc */}
              {activeFilters.includes('code') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 120 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Mã hàng</span>
                  <FilterTextInput
                    data-field="code_filter_inline"
                    value={localFilterInput.code ?? ''}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, code: v === '' ? null : v }))}
                    placeholder=""
                    style={{ width: '100%' }}
                    showClear={((localFilterInput.code ?? '').trim()) !== ''}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, code: null }))}
                  />
                </div>
              )}
              {activeFilters.includes('name') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 140 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Tên hàng</span>
                  <FilterTextInput
                    data-field="name_filter_inline"
                    value={localFilterInput.name ?? ''}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, name: v === '' ? null : v }))}
                    placeholder=""
                    style={{ width: '100%' }}
                    showClear={((localFilterInput.name ?? '').trim()) !== ''}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, name: null }))}
                  />
                </div>
              )}
              {activeFilters.includes('category') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 150 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Danh mục</span>
                  <FilterSelect
                    value={localFilterInput.category}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, category: toNumberOrNull(v) }))}
                    options={categories.map((c) => ({ label: c.name, value: c.id }))}
                    showClear
                    hasValue={localFilterInput.category != null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, category: null }))}
                  />
                </div>
              )}
              {activeFilters.includes('unit') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 120 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Đơn vị</span>
                  <FilterSelect
                    value={localFilterInput.unit}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, unit: toNumberOrNull(v) }))}
                    options={units.map((u) => ({ label: u.name, value: u.id }))}
                    showClear
                    hasValue={localFilterInput.unit != null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, unit: null }))}
                  />
                </div>
              )}
              {activeFilters.includes('wave') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 120 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Sóng</span>
                  <FilterSelect
                    value={localFilterInput.wave}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, wave: toNumberOrNull(v) }))}
                    options={waves.map((w: { id: number; code: string }) => ({ label: w.code, value: w.id }))}
                    showClear
                    hasValue={localFilterInput.wave != null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, wave: null }))}
                  />
                </div>
              )}
              {activeFilters.includes('box_type') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 120 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Kiểu</span>
                  <FilterSelect
                    value={localFilterInput.box_type}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, box_type: toNumberOrNull(v) }))}
                    options={boxTypes.map((b: { id: number; code: string }) => ({ label: b.code, value: b.id }))}
                    showClear
                    hasValue={localFilterInput.box_type != null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, box_type: null }))}
                  />
                </div>
              )}
              {activeFilters.includes('status') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 150 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Trạng thái</span>
                  <FilterSelect
                    value={localFilterInput.status}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, status: toStatusOrNull(v) }))}
                    options={[
                      { label: 'Nháp', value: 'DRAFT' },
                      { label: 'Đang bán', value: 'ACTIVE' },
                      { label: 'Ngừng SX', value: 'DISCONTINUED' },
                    ]}
                    showClear
                    hasValue={localFilterInput.status != null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, status: null }))}
                  />
                </div>
              )}
              {activeFilters.includes('cost_price') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Giá vốn</span>
                  <Space size={4} style={{ alignItems: 'center' }}>
                    <div data-quick-entry style={{ width: 90 }}>
                      <FilterNumberInput data-field="min_cost_price_inline" value={localFilterInput.min_cost_price ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, min_cost_price: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, min_cost_price: null }))} placeholder="Từ" inputMode="decimal" />
                    </div>
                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>–</span>
                    <div data-quick-entry style={{ width: 90 }}>
                      <FilterNumberInput data-field="max_cost_price_inline" value={localFilterInput.max_cost_price ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, max_cost_price: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, max_cost_price: null }))} placeholder="Đến" inputMode="decimal" />
                    </div>
                  </Space>
                </div>
              )}
              {activeFilters.includes('sale_price') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Đơn giá</span>
                  <Space size={4} style={{ alignItems: 'center' }}>
                    <div data-quick-entry style={{ width: 90 }}>
                      <FilterNumberInput data-field="min_sale_price_inline" value={localFilterInput.min_sale_price ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, min_sale_price: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, min_sale_price: null }))} placeholder="Từ" inputMode="decimal" />
                    </div>
                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>–</span>
                    <div data-quick-entry style={{ width: 90 }}>
                      <FilterNumberInput data-field="max_sale_price_inline" value={localFilterInput.max_sale_price ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, max_sale_price: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, max_sale_price: null }))} placeholder="Đến" inputMode="decimal" />
                    </div>
                  </Space>
                </div>
              )}
              {activeFilters.includes('size_po_dai') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 80 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Dài PO</span>
                  <FilterNumberInput data-field="size_po_dai_inline" value={localFilterInput.size_po_dai ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_po_dai: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_po_dai: null }))} placeholder="" inputMode="numeric" />
                </div>
              )}
              {activeFilters.includes('size_po_rong') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 80 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Rộng PO</span>
                  <FilterNumberInput data-field="size_po_rong_inline" value={localFilterInput.size_po_rong ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_po_rong: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_po_rong: null }))} placeholder="" inputMode="numeric" />
                </div>
              )}
              {activeFilters.includes('size_po_cao') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 80 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Cao PO</span>
                  <FilterNumberInput data-field="size_po_cao_inline" value={localFilterInput.size_po_cao ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_po_cao: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_po_cao: null }))} placeholder="" inputMode="numeric" />
                </div>
              )}
              {activeFilters.includes('size_sx_dai') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 80 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Dài SX</span>
                  <FilterNumberInput data-field="size_sx_dai_inline" value={localFilterInput.size_sx_dai ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_sx_dai: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_sx_dai: null }))} placeholder="" inputMode="numeric" />
                </div>
              )}
              {activeFilters.includes('size_sx_rong') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 80 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Rộng SX</span>
                  <FilterNumberInput data-field="size_sx_rong_inline" value={localFilterInput.size_sx_rong ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_sx_rong: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_sx_rong: null }))} placeholder="" inputMode="numeric" />
                </div>
              )}
              {activeFilters.includes('size_sx_cao') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 80 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Cao SX</span>
                  <FilterNumberInput data-field="size_sx_cao_inline" value={localFilterInput.size_sx_cao ?? ''} onChange={(v) => applyFilterChange((prev) => ({ ...prev, size_sx_cao: v === '' ? null : v }))} onClear={() => applyFilterChange((prev) => ({ ...prev, size_sx_cao: null }))} placeholder="" inputMode="numeric" />
                </div>
              )}
              {activeFilters.includes('waterproof') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 100 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>C. thấm</span>
                  <FilterSelect
                    value={localFilterInput.waterproof ?? undefined}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, waterproof: toStringOrNull(v) }))}
                    options={Object.entries(WATERPROOF_LABELS).map(([val, label]) => ({ label, value: val }))}
                    showClear
                    hasValue={(localFilterInput.waterproof ?? '') !== ''}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, waterproof: null }))}
                  />
                </div>
              )}
              {activeFilters.includes('co_cm') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 90 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Có CM</span>
                  <FilterSelect
                    value={localFilterInput.co_cm === null ? undefined : localFilterInput.co_cm ? 'true' : 'false'}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, co_cm: v === undefined ? null : v === 'true' }))}
                    options={[{ label: 'Có', value: 'true' }, { label: 'Không', value: 'false' }]}
                    showClear
                    hasValue={localFilterInput.co_cm !== null}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, co_cm: null }))}
                  />
                </div>
              )}
              {activeFilters.includes('note') && (
                <div data-quick-entry style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 140 }}>
                  <span style={{ fontSize: 13, color: '#8c8c8c', textAlign: 'left' }}>Ghi chú</span>
                  <FilterTextInput
                    data-field="note_filter_inline"
                    value={localFilterInput.note ?? ''}
                    onChange={(v) => applyFilterChange((prev) => ({ ...prev, note: v === '' ? null : v }))}
                    placeholder=""
                    style={{ width: '100%' }}
                    showClear={((localFilterInput.note ?? '').trim()) !== ''}
                    onClear={() => applyFilterChange((prev) => ({ ...prev, note: null }))}
                  />
                </div>
              )}
              <div data-quick-entry>
                <Button size="small" danger onClick={handleClearAllFilters} style={{ height: 22 }}>
                  Xóa bộ lọc
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Khi API lỗi: hiển thị rõ thay vì bảng trống */}
        {isError && (
          <div
            style={{
              padding: 16,
              marginTop: 0,
              background: '#fff2f0',
              border: '1px solid #ffccc7',
              borderRadius: '0 0 8px 8px',
            }}
          >
            <div style={{ color: '#cf1322', marginBottom: 8 }}>
              Không tải được danh sách sản phẩm.
            </div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
              {(error as any)?.message || (error as any)?.response?.data?.detail || 'Kiểm tra backend đã chạy chưa (Django tại http://127.0.0.1:8000).'}
            </div>
            <Button type="primary" onClick={refetchProducts}>
              Thử lại
            </Button>
          </div>
        )}

        {/* TABLE - liền kề (ẩn khi đang lỗi để tránh nhầm "0 sản phẩm") */}
        {!isError && showTable && (
        <Table<Product>
          className={`enterprise-data-table ${desktopTableDensity === 'compact' ? 'table-density-compact' : 'table-density-comfortable'}`}
          rowKey="id"
          columns={columns}
          dataSource={products}
          loading={isLoading}
          size="middle"
          bordered
          rowSelection={rowSelection}
          scroll={{ x: 'max-content' }}
          style={{
            background: 'white',
            marginTop: 0,
            borderRadius: '0 0 8px 8px',
            overflow: 'hidden',
          }}
          locale={{
            emptyText: (
              <EmptyState
                description="Chưa có sản phẩm nào"
                actionText="Thêm sản phẩm đầu tiên"
                onAction={handleAdd}
              />
            ),
          }}
          pagination={false}
        />
        )}

        {!isError && showCards && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {products.length === 0 && !isLoading && (
              <EmptyState
                description="Chưa có sản phẩm nào"
                actionText="Thêm sản phẩm đầu tiên"
                onAction={handleAdd}
              />
            )}
            {products.map((record) => (
              <Card key={record.id} size="small" style={{ borderRadius: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, color: theme.colors.primary, fontSize: isCompactCards ? 13 : 14 }}>{record.code || '-'}</div>
                    <div style={{ fontWeight: 500, fontSize: isCompactCards ? 13 : 14 }}>{record.name || '-'}</div>
                    <div style={{ color: '#595959', fontSize: isCompactCards ? 12 : 13 }}>
                      {(record.category_name as string) || '-'} • {(record.unit_name as string) || '-'}
                    </div>
                  </div>
                  {renderRowActions(record)}
                </div>
                <div style={{ marginTop: isCompactCards ? 6 : 8, fontSize: isCompactCards ? 12 : 13, color: '#595959' }}>
                  <div>Giá vốn: {record.cost_price != null ? `${Number(record.cost_price).toLocaleString('vi-VN')} đ` : '-'}</div>
                  <div>Đơn giá: {record.sale_price != null ? `${Number(record.sale_price).toLocaleString('vi-VN')} đ` : '-'}</div>
                  <div>Trạng thái: {(PRODUCT_STATUS_LABELS as Record<string, string>)[record.status as string] ?? record.status ?? '-'}</div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Bottom bar: Page size + Pagination */}
        {!isMobile && (
        <div
          className="products-list-bottom-bar"
          style={{
            display: 'flex',
            justifyContent: isMobile ? 'stretch' : 'flex-end',
            alignItems: 'center',
            marginTop: 16,
            padding: isMobile ? '10px 12px' : '8px 16px',
            background: '#fafafa',
            borderRadius: 6,
          }}
        >
          {/* Wrapper: dịch như ảnh (1 hàng, sát nhau) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', marginLeft: isMobile ? 0 : 'auto', width: isMobile ? '100%' : 'auto' }}>
            {/* RIGHT SIDE: Total + Pagination + PageSize selector */}
            <Space size={16} align="center" wrap direction={isMobile ? 'vertical' : 'horizontal'} style={{ width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : undefined }}>
              <span style={{ fontSize: 13, color: '#595959' }}>
                Tổng {productsData?.count ?? 0} sản phẩm
              </span>
              <Pagination
                current={pagination.current}
                pageSize={pagination.pageSize}
                total={productsData?.count ?? 0}
                showSizeChanger={false}
                onChange={(newPage) => setPage(newPage)}
                size="small"
                simple={false}
              />
            <div className="input-number-with-clear-wrapper" style={{ width: 110, display: 'inline-block', position: 'relative' }}>
              <InputNumber
                ref={pageSizeInputRef}
                size="small"
                min={1}
                max={500}
                controls={false}
                style={{ width: '100%' }}
                className="input-number-with-clear"
                value={isEditingPageSize ? pageSizeDraft : pagination.pageSize}
                formatter={(v) => {
                  // Khi đang nhập và đã xoá trắng, hiển thị trống hoàn toàn
                  if (isEditingPageSize && v == null) return '';
                  return `${v ?? ''} / trang`;
                }}
                parser={(v) => {
                  const digits = String(v ?? '').replace(/[^\d]/g, '');
                  if (!digits) return Number.NaN;
                  const n = parseInt(digits, 10);
                  return Number.isNaN(n) ? Number.NaN : n;
                }}
                // Click vào để nhập: xoá hết dữ liệu (trống)
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
                  // Nếu user chưa nhập thì bỏ qua và revert về giá trị hiện tại
                  if (v == null) {
                    setPageSizeDraft(null);
                    setIsEditingPageSize(false);
                    return;
                  }
                  if (v !== pagination.pageSize) void applyPageSize(v);
                  else {
                    setPageSizeDraft(null);
                    setIsEditingPageSize(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const v = pageSizeDraft;
                if (v == null) return;
                void applyPageSize(v).finally(() => {
                  pageSizeInputRef.current?.blur?.();
                });
              }}
              />
              {(isEditingPageSize ? pageSizeDraft : pagination.pageSize) != null && (
                <QuickClearIcon onClear={() => { setPageSizeDraft(null); setIsEditingPageSize(true); }} title="Xóa nhanh" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />
              )}
            </div>
            </Space>
          </div>
        </div>
        )}

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
                total={productsData?.count ?? 0}
                showSizeChanger={false}
                onChange={(newPage) => setPage(newPage)}
                size="small"
                simple
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
          height={340}
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
              visibleColumns={visibleColumns}
              onChange={handleVisibleColumnsChange}
              sizeDisplayMode={sizeDisplayMode}
              onSizeDisplayModeChange={handleSizeDisplayModeChange}
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

        <Modal
          title={`Lịch sử hoạt động${historyProduct ? ` - ${historyProduct.code}` : ''}`}
          open={historyModalOpen}
          onCancel={() => {
            setHistoryModalOpen(false);
            setHistoryProduct(null);
          }}
          footer={<Button size="middle" onClick={() => { setHistoryModalOpen(false); setHistoryProduct(null); }}>Đóng</Button>}
          width={920}
        >
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <ListSearchInput
              placeholder="Tìm theo hành động, người thao tác, tên trường, giá trị..."
              value={historySearchInput}
              onChange={setHistorySearchInput}
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
                { value: 'DELETE', label: 'Xóa' },
                { value: 'IMPORT', label: 'Nhập dữ liệu' },
                { value: 'EXPORT', label: 'Xuất dữ liệu' },
              ]}
            />
          </div>
          {isHistoryLoading && <div style={{ fontSize: 14, color: '#6b7280' }}>Đang tải lịch sử...</div>}
          {!isHistoryLoading && filteredActivity.length === 0 && (
            <div style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
              Chưa có dữ liệu phù hợp.
            </div>
          )}
          {!isHistoryLoading && filteredActivity.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '52vh', overflowY: 'auto', paddingRight: 2 }}>
              {filteredActivity.map((item, idx) => {
                const isComment = item.type === 'comment';
                if (isComment) {
                  // ── Comment: chat bubble style ──
                  return (
                    <div
                      key={`${item.timestamp}-${idx}`}
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: '#667eea', color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 12, flexShrink: 0, marginTop: 2,
                        }}
                      >
                        {(item.user ?? 'U').slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: '#1f2937' }}>
                            {item.user || 'Ẩn danh'}
                          </span>
                          <span style={{ fontSize: 12, color: '#9ca3af' }}>
                            {new Date(item.timestamp).toLocaleString('vi-VN')}
                          </span>
                        </div>
                        <div
                          style={{
                            background: '#f0f4ff',
                            border: '1px solid #e0e7ff',
                            borderRadius: '0 10px 10px 10px',
                            padding: '8px 12px',
                            fontSize: 14,
                            color: '#1f2937',
                            lineHeight: 1.55,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {item.details?.content}
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── Audit log: system event style ──
                const oldVals = (item.details?.old_values as Record<string, unknown> | undefined) ?? {};
                const newVals = (item.details?.new_values as Record<string, unknown> | undefined) ?? {};
                const fields = Array.from(new Set([...Object.keys(oldVals), ...Object.keys(newVals)]));
                return (
                  <div
                    key={`${item.timestamp}-${idx}`}
                    style={{ border: '1px solid #e6ebf2', borderRadius: 10, padding: '10px 14px', background: '#fafafa' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#1f2937' }}>
                        {getHistoryActionLabelVi(item.action)}
                      </div>
                      <div style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                        {item.user || 'Hệ thống'} · {new Date(item.timestamp).toLocaleString('vi-VN')}
                      </div>
                    </div>
                    {item.details?.content && (
                      <div style={{ marginTop: 4, fontSize: 13, color: '#6b7280' }}>{item.details.content}</div>
                    )}
                    {fields.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 13, color: '#334155', display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {fields.map((field) => (
                          <div key={field} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 1fr', gap: 8 }}>
                            <div style={{ color: '#374151', fontWeight: 600 }}>{getHistoryFieldLabelVi(field)}</div>
                            <div style={{ color: '#6b7280' }}>Trước: {formatHistoryFieldValueVi(field, oldVals[field])}</div>
                            <div style={{ color: '#059669', fontWeight: 500 }}>Sau: {formatHistoryFieldValueVi(field, newVals[field])}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Ô nhập bình luận ── */}
          {historyProduct && (
            <CommentBox
              entityType="Product"
              entityId={historyProduct.id}
              onSuccess={() => {
                void queryClient.invalidateQueries({
                  queryKey: ['products', 'activity', historyProduct.id],
                });
              }}
            />
          )}
        </Modal>

        {/* ── Modal Giao nhiệm vụ ── */}
        <Modal
          title={
            <Space>
              <ProjectOutlined style={{ color: '#1677ff' }} />
              {`Nhiệm vụ${taskProduct ? ` - ${taskProduct.code}` : ''}`}
              {(taskProduct?.blocking_tasks_count ?? 0) > 0 && (
                <Tooltip title="Có blocking task đang chặn sản xuất">
                  <LockOutlined style={{ color: '#ff4d4f' }} />
                </Tooltip>
              )}
            </Space>
          }
          open={taskModalOpen}
          onCancel={() => { setTaskModalOpen(false); setTaskProduct(null); }}
          footer={<Button onClick={() => { setTaskModalOpen(false); setTaskProduct(null); }}>Đóng</Button>}
          width={680}
          destroyOnClose
        >
          {taskProduct && (
            <TaskPanel
              entityType="Product"
              entityId={taskProduct.id}
              entityCode={taskProduct.code}
              onTasksChange={() => {
                void queryClient.invalidateQueries({ queryKey: ['products'], refetchType: 'all' });
              }}
            />
          )}
        </Modal>

        <Modal
          title={`Trình duyệt thay đổi giá${priceWorkflowProduct ? ` - ${priceWorkflowProduct.code}` : ''}`}
          open={priceSubmitModalOpen}
          onCancel={() => {
            setPriceSubmitModalOpen(false);
            setPriceWorkflowProduct(null);
            setPriceReason('');
            setPriceEffectiveAt('');
          }}
          onOk={() => void handleSubmitPriceChange()}
          okText="Gửi đề xuất"
          confirmLoading={priceWorkflowLoading}
          cancelText="Hủy"
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>Giá vốn mới</div>
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                value={priceNewCost}
                onChange={(v) => setPriceNewCost(v as number | null)}
              />
            </div>
            <div>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>Đơn giá mới</div>
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                value={priceNewSale}
                onChange={(v) => setPriceNewSale(v as number | null)}
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Hiệu lực từ (tuỳ chọn)</div>
            <input
              type="datetime-local"
              className="pf-input"
              value={priceEffectiveAt}
              onChange={(e) => setPriceEffectiveAt(e.target.value)}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Lý do thay đổi giá</div>
            <Input.TextArea
              rows={4}
              value={priceReason}
              onChange={(e) => setPriceReason(e.target.value)}
              placeholder="Nhập lý do thay đổi giá..."
            />
          </div>
        </Modal>

        <Modal
          title={`Từ chối đề xuất giá${priceWorkflowProduct ? ` - ${priceWorkflowProduct.code}` : ''}`}
          open={priceRejectModalOpen}
          onCancel={() => {
            setPriceRejectModalOpen(false);
            setPriceWorkflowProduct(null);
            setPendingPriceChangeId(null);
            setPriceRejectReason('');
          }}
          onOk={() => void handleRejectLatestPriceChange()}
          okText="Xác nhận từ chối"
          okButtonProps={{ danger: true }}
          confirmLoading={priceWorkflowLoading}
          cancelText="Hủy"
        >
          <Input.TextArea
            rows={4}
            value={priceRejectReason}
            onChange={(e) => setPriceRejectReason(e.target.value)}
            placeholder="Nhập lý do từ chối đề xuất giá..."
          />
        </Modal>

        <ImportModal
          visible={importModalVisible}
          onClose={() => setImportModalVisible(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
          onDownloadTemplate={handleDownloadTemplate}
          onImport={handleImport}
          entityName="sản phẩm"
        />

        {/* Form thêm/sửa sản phẩm – giao diện mới (Mẹ + Con), duy nhất dùng cho Thêm mới & Chỉnh sửa */}
        <ProductForm
          visible={formVisible}
          onClose={handleFormClose}
          editingProduct={editingProduct}
          mode={formMode}
        />
      </Card>
    </>
  );
};

export default ProductList;
