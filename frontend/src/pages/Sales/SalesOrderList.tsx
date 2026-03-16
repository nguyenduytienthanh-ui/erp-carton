import { useMemo, useState, useEffect } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popover,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EyeOutlined, PaperClipOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachmentsApi, type AttachmentItem } from '../../api/attachments';
import { customersApi } from '../../api/customers';
import { inventoryApi } from '../../api/inventory';
import { productsApi } from '../../api/products';
import { salesApi } from '../../api/sales';
import type {
  SalesOrder,
  SalesOrderDeliveryPlan,
  SalesOrderFormValues,
  SalesOrderLine,
  SalesOrderLineProductSnapshot,
  SalesOrderShipmentDetailItem,
  SalesOrderShipmentPackageItem,
  SalesOrderShipmentOverviewItem,
} from '../../types/sales';
import { PAGES } from '../../utils/constants';
import {
  canAccessSalesOrders,
  canApproveSalesOrders,
  canPostSalesOrders,
  canSubmitSalesOrders,
  canVoidSalesOrders,
} from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import FormattedPrice from '../../components/FormattedPrice';
import { getToastMessage } from '../../shared/apiError';
import { storage } from '../../utils/storage';

type Filters = {
  status?: string;
  customer?: number;
};

type ReasonModalState =
  | { type: 'reject'; order: SalesOrder }
  | { type: 'void'; order: SalesOrder }
  | null;
type ShipmentCancelModalState = { shipment: SalesOrderShipmentOverviewItem } | null;
type ShipmentPackModalState = { shipment: SalesOrderShipmentOverviewItem } | null;
type ShipmentScanModalState = { shipment: SalesOrderShipmentOverviewItem } | null;
type ShipmentLoadingProofModalState = { shipment: SalesOrderShipmentOverviewItem } | null;
type ShipmentDeliveryProofModalState = { shipment: SalesOrderShipmentOverviewItem } | null;
type ShipmentAttachmentProofType = 'LOAD' | 'DELIVERY';
type ShipmentAttachmentModalState = {
  shipment: SalesOrderShipmentOverviewItem;
  proofType: ShipmentAttachmentProofType;
} | null;

type SalesOrderLineFormValue = NonNullable<SalesOrderFormValues['lines']>[number];
type ShipmentFormValues = {
  items: Array<{
    reservation_id?: number;
    quantity: number;
  }>;
  transaction_date: string;
  reference?: string;
  reason?: string;
  note?: string;
  carrier_name?: string;
  tracking_number?: string;
  vehicle_no?: string;
  driver_name?: string;
  driver_phone?: string;
};
type ShipmentPackFormValues = {
  items: Array<{
    transaction_id: number;
    package_count: number;
    package_type?: string;
    gross_weight_kg?: number;
    length_cm?: number;
    width_cm?: number;
    height_cm?: number;
    note?: string;
  }>;
};
type ShipmentLoadingProofFormValues = {
  loading_reference?: string;
  handover_receiver_name: string;
  handover_receiver_phone?: string;
  handover_proof_url?: string;
  loading_confirmation_note?: string;
};
type ShipmentDeliveryProofFormValues = {
  delivery_reference?: string;
  customer_receiver_name: string;
  customer_receiver_phone?: string;
  delivery_proof_url?: string;
  delivery_confirmation_note?: string;
  delivered_at_actual?: string;
};

const SHIPMENT_ATTACHMENT_PREFIX: Record<ShipmentAttachmentProofType, string> = {
  LOAD: '[LOAD_PROOF]',
  DELIVERY: '[DELIVERY_PROOF]',
};

const SHIPMENT_ATTACHMENT_LABEL: Record<ShipmentAttachmentProofType, string> = {
  LOAD: 'chứng từ bàn giao xe',
  DELIVERY: 'chứng từ giao hàng',
};
type ReserveFromOrderFormValues = {
  reservation_date: string;
  stock_key?: string;
  reserved_qty: number;
  reference?: string;
  note?: string;
};
type BatchReserveAllocationFormValue = {
  stock_key?: string;
  reserved_qty: number;
};
type BatchReserveItemFormValue = {
  line_id?: number;
  sales_order_line?: number | null;
  product: number;
  requested_qty: number;
  allocations: BatchReserveAllocationFormValue[];
};
type BatchReserveFormValues = {
  reservation_date: string;
  reference?: string;
  note?: string;
  items: BatchReserveItemFormValue[];
};
type TraceLabelPrintFormValues = {
  label_mode: 'copies' | 'cartons';
  copies_per_line: number;
  packages_per_line: number;
  line_ids?: number[];
};
type BatchReserveSuggestionStock = {
  key: string;
  product_id: number;
  warehouse_id: number;
  warehouse_name: string;
  warehouse_sort_order?: number;
  location_id?: number | null;
  location_name?: string | null;
  location_type?: string | null;
  location_sort_order?: number | null;
  available: number;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'success',
  REJECTED: 'error',
  POSTED: 'cyan',
  VOID: 'magenta',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  POSTED: 'Đã vào sổ',
  VOID: 'Đã hủy',
};

const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  POSTED: 'Đã xuất',
  CANCELLED: 'Đã hủy',
};

const BUNDLE_PRICING_MODE_LABELS: Record<string, string> = {
  PRIMARY_PRODUCT: 'Lấy theo mẹ/đại diện',
  FIXED_BUNDLE: 'Giá bộ cố định',
  SUM_COMPONENTS: 'Cộng từ thành phần',
};

const BUNDLE_DELIVERY_RULE_LABELS: Record<string, string> = {
  STRICT_FULL_SET: 'Giao đồng bộ đủ bộ',
  NON_SYNC: 'Giao không đồng bộ',
};

const emptyFormValues: SalesOrderFormValues = {
  order_date: dayjs().format('YYYY-MM-DD'),
  version: 0,
  delivery_date: dayjs().add(3, 'day').format('YYYY-MM-DD'),
  reference: '',
  customer: null,
  currency: 'VND',
  exchange_rate: 1,
  notes: '',
  lines: [
    {
      line_number: 1,
      product: 0,
      uom: '',
      product_snapshot: {},
      qty: 1,
      unit_price: 0,
      discount_pct: 0,
      tax_pct: 0,
      note: '',
      delivery_plans: [],
    },
  ],
};

function serializeFilters(filters: Filters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): Filters {
  try {
    return JSON.parse(raw) as Filters;
  } catch {
    return {};
  }
}

function toNumber(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function buildLineSnapshotFromProduct(product?: {
  code?: string;
  name?: string;
  category?: number;
  category_name?: string;
  unit?: number;
  unit_name?: string;
  description?: string;
  size_order?: string;
  size_production?: string;
  wave?: number;
  wave_code?: string;
  wave_name?: string;
  box_type?: number;
  box_type_code?: string;
  box_type_name?: string;
  standalone_cost_price?: string;
  standalone_sale_price?: string;
  standalone_commission_per_unit?: string;
  standalone_commission_percent?: string;
  cost_price?: string;
  sale_price?: string;
  resolved_bundle_cost_price?: string;
  resolved_bundle_sale_price?: string;
  resolved_bundle_commission_per_unit?: string;
  resolved_bundle_commission_percent?: string;
  min_stock?: string;
  delivery_tolerance?: string;
  commission_per_unit?: string;
  commission_percent?: string;
  process_xa?: number | null;
  process_in?: number | null;
  process_boi?: number | null;
  process_can_mang?: number | null;
  process_be?: number | null;
  process_chap?: number | null;
  process_dong?: number | null;
  process_dan?: number | null;
  process_khac?: number | null;
  film_code?: string;
  film_file_url?: string;
  color_count?: number;
  mold_code?: string;
  mold_file_url?: string;
  waterproof?: string;
  note_other?: string;
  note?: string;
  parent?: number | null;
  parent_name?: string;
  component_quantity?: number;
  is_set?: boolean;
  bundle_id?: number | null;
  bundle_pricing_mode?: string | null;
  bundle_commission_mode?: string | null;
  bundle_delivery_rule?: string | null;
  bundle_primary_product_id?: number | null;
  bundle_primary_product_name?: string | null;
  bundle_components?: Array<{
    component_product?: number;
    component_product_id?: number;
    component_product_code?: string;
    component_product_name?: string;
    qty_per_bundle?: string;
    unit_name?: string | null;
    component_product_unit_name?: string | null;
    is_required?: boolean;
  }>;
  status?: string;
  owner?: number;
  owner_name?: string;
  team?: number;
  team_name?: string;
  is_active?: boolean;
}): SalesOrderLineProductSnapshot {
  if (!product) return {};
  return {
    product_id: undefined,
    code: product.code,
    name: product.name,
    category_id: product.category ?? null,
    category_name: product.category_name,
    unit_id: product.unit ?? null,
    unit_name: product.unit_name,
    description: product.description ?? '',
    size_order: product.size_order ?? '',
    size_production: product.size_production ?? '',
    wave_id: product.wave ?? null,
    wave_code: product.wave_code,
    wave_name: product.wave_name,
    box_type_id: product.box_type ?? null,
    box_type_code: product.box_type_code,
    box_type_name: product.box_type_name,
    standalone_cost_price: product.standalone_cost_price ?? product.cost_price ?? '0',
    standalone_sale_price: product.standalone_sale_price ?? product.sale_price ?? '0',
    standalone_commission_per_unit: product.standalone_commission_per_unit ?? product.commission_per_unit ?? '0',
    standalone_commission_percent: product.standalone_commission_percent ?? product.commission_percent ?? '0',
    cost_price: product.resolved_bundle_cost_price ?? product.cost_price ?? '0',
    sale_price: product.resolved_bundle_sale_price ?? product.sale_price ?? '0',
    min_stock: product.min_stock ?? '0',
    delivery_tolerance: product.delivery_tolerance ?? '',
    commission_per_unit: product.resolved_bundle_commission_per_unit ?? product.commission_per_unit ?? '0',
    commission_percent: product.resolved_bundle_commission_percent ?? product.commission_percent ?? '0',
    process_xa: product.process_xa ?? null,
    process_in: product.process_in ?? null,
    process_boi: product.process_boi ?? null,
    process_can_mang: product.process_can_mang ?? null,
    process_be: product.process_be ?? null,
    process_chap: product.process_chap ?? null,
    process_dong: product.process_dong ?? null,
    process_dan: product.process_dan ?? null,
    process_khac: product.process_khac ?? null,
    film_code: product.film_code ?? '',
    film_file_url: product.film_file_url ?? '',
    color_count: product.color_count ?? 0,
    mold_code: product.mold_code ?? '',
    mold_file_url: product.mold_file_url ?? '',
    waterproof: product.waterproof ?? '',
    note_other: product.note_other ?? '',
    note: product.note ?? '',
    parent_id: product.parent ?? null,
    parent_name: product.parent_name ?? null,
    component_quantity: product.component_quantity ?? null,
    is_set: product.is_set ?? false,
    bundle_id: product.bundle_id ?? null,
    bundle_pricing_mode: product.bundle_pricing_mode ?? null,
    bundle_commission_mode: product.bundle_commission_mode ?? null,
    bundle_delivery_rule: product.bundle_delivery_rule ?? null,
    bundle_primary_product_id: product.bundle_primary_product_id ?? null,
    bundle_primary_product_name: product.bundle_primary_product_name ?? null,
    bundle_components: (product.bundle_components ?? []).map((item) => ({
      component_product_id: item.component_product_id ?? item.component_product ?? 0,
      component_product_code: item.component_product_code,
      component_product_name: item.component_product_name,
      qty_per_bundle: item.qty_per_bundle,
      unit_name: item.unit_name ?? item.component_product_unit_name ?? null,
      is_required: item.is_required,
    })),
    status: product.status,
    owner_id: product.owner ?? null,
    owner_name: product.owner_name ?? null,
    team_id: product.team ?? null,
    team_name: product.team_name ?? null,
    is_active: product.is_active ?? true,
  };
}

function formatTraceCode(value?: string | null): string {
  return value?.trim() || '-';
}

function getLineSnapshotSummary(line: SalesOrderLine): string[] {
  const snapshot = line.product_snapshot;
  if (!snapshot) return [];
  return [
    snapshot.size_order ? `KTDH: ${snapshot.size_order}` : '',
    snapshot.size_production ? `KTSX: ${snapshot.size_production}` : '',
    snapshot.wave_code ? `Sóng: ${snapshot.wave_code}` : '',
    snapshot.box_type_name ? `Kiểu: ${snapshot.box_type_name}` : '',
    snapshot.film_code ? `Phim: ${snapshot.film_code}` : '',
    snapshot.mold_code ? `Khuôn: ${snapshot.mold_code}` : '',
    snapshot.delivery_tolerance ? `+/-: ${snapshot.delivery_tolerance}` : '',
    snapshot.waterproof ? `Chống thấm: ${snapshot.waterproof}` : '',
  ].filter(Boolean);
}

function renderSnapshotPopover(line: SalesOrderLine) {
  const snapshot = line.product_snapshot;
  if (!snapshot) return '-';
  const processItems = [
    ['Xả', snapshot.process_xa],
    ['In', snapshot.process_in],
    ['Bồi', snapshot.process_boi],
    ['Cán', snapshot.process_can_mang],
    ['Bế', snapshot.process_be],
    ['Chạp', snapshot.process_chap],
    ['Đóng', snapshot.process_dong],
    ['Dán', snapshot.process_dan],
    ['Khác', snapshot.process_khac],
  ].filter(([, value]) => value !== null && value !== undefined && value !== 0);
  const summary = getLineSnapshotSummary(line);
  return (
    <Popover
      trigger="click"
      content={
        <div style={{ maxWidth: 420 }}>
          <div><strong>{snapshot.code || line.product_code || '-'}</strong> - {snapshot.name || line.product_name || '-'}</div>
          <div>ĐVT: {snapshot.unit_name || line.uom || '-'}</div>
          <div>Danh mục: {snapshot.category_name || '-'}</div>
          <div>Giá bán snapshot: <FormattedPrice value={Number(snapshot.sale_price || 0)} /></div>
          <div>HHCĐ: {snapshot.commission_per_unit || '0'} | HH%: {snapshot.commission_percent || '0'}</div>
          <div>Kiểu giá bộ: {snapshot.bundle_pricing_mode ? (BUNDLE_PRICING_MODE_LABELS[snapshot.bundle_pricing_mode] || snapshot.bundle_pricing_mode) : '-'}</div>
          <div>Hoa hồng bộ: Đi theo cách tính giá bộ{snapshot.bundle_pricing_mode ? ` (${BUNDLE_PRICING_MODE_LABELS[snapshot.bundle_pricing_mode] || snapshot.bundle_pricing_mode})` : ''}</div>
          <div>Giao hàng: {snapshot.bundle_delivery_rule ? (BUNDLE_DELIVERY_RULE_LABELS[snapshot.bundle_delivery_rule] || snapshot.bundle_delivery_rule) : '-'}</div>
          <div>Màu: {snapshot.color_count ?? 0}</div>
          <div>Chi tiết: {summary.length ? summary.join(' | ') : '-'}</div>
          <div>
            Thành phần bộ:{' '}
            {snapshot.bundle_components?.length
              ? snapshot.bundle_components.map((item) => `${item.component_product_code || item.component_product_name}: ${item.qty_per_bundle}`).join(' | ')
              : '-'}
          </div>
          <div>Công đoạn: {processItems.length ? processItems.map(([label, value]) => `${label}:${value}`).join(' | ') : '-'}</div>
        </div>
      }
    >
      <Button size="small">Thông số SP</Button>
    </Popover>
  );
}

function toOrderFormValues(order: SalesOrder): SalesOrderFormValues {
  return {
    order_date: order.order_date,
    version: order.version ?? 0,
    delivery_date: order.delivery_date ?? undefined,
    reference: order.reference ?? '',
    customer: order.customer ?? null,
    currency: order.currency || 'VND',
    exchange_rate: toNumber(order.exchange_rate),
    notes: order.notes ?? '',
    lines: (order.lines ?? []).map((line) => ({
      line_number: line.line_number,
      product: line.product,
      uom: line.uom ?? '',
        product_snapshot: line.product_snapshot ?? {},
      qty: toNumber(line.qty),
      unit_price: toNumber(line.unit_price),
      discount_pct: toNumber(line.discount_pct),
      tax_pct: toNumber(line.tax_pct),
      note: line.note ?? '',
      delivery_plans: (line.delivery_plans ?? []).map((plan: SalesOrderDeliveryPlan) => ({
        delivery_date: plan.delivery_date,
        qty: toNumber(plan.qty),
        shipped_qty: toNumber(plan.shipped_qty),
        delivered_qty: toNumber(plan.delivered_qty),
        note: plan.note ?? '',
      })),
    })),
  };
}

function buildPayload(values: SalesOrderFormValues): SalesOrderFormValues {
  return {
    order_date: values.order_date,
    version: values.version ?? 0,
    delivery_date: values.delivery_date || undefined,
    reference: values.reference?.trim() || '',
    customer: values.customer ?? null,
    currency: values.currency || 'VND',
    exchange_rate: Number(values.exchange_rate ?? 1),
    notes: values.notes?.trim() || '',
    lines: (values.lines ?? []).map((line, index) => ({
      line_number: index + 1,
      product: Number(line.product),
      uom: line.uom?.trim() || '',
      product_snapshot: {
        ...(line.product_snapshot ?? {}),
        sale_price: String(Number(line.unit_price ?? 0)),
        unit_name: line.uom?.trim() || line.product_snapshot?.unit_name || '',
      },
      qty: Number(line.qty ?? 0),
      unit_price: Number(line.unit_price ?? 0),
      discount_pct: Number(line.discount_pct ?? 0),
      tax_pct: Number(line.tax_pct ?? 0),
      note: line.note?.trim() || '',
      delivery_plans: (line.delivery_plans ?? [])
        .filter((plan) => plan.delivery_date && Number(plan.qty ?? 0) > 0)
        .map((plan) => ({
          delivery_date: plan.delivery_date,
          qty: Number(plan.qty ?? 0),
          shipped_qty: Number(plan.shipped_qty ?? 0),
          delivered_qty: Number(plan.delivered_qty ?? 0),
          note: plan.note?.trim() || '',
        })),
    })),
  };
}

function getLinePreviewTotal(line: SalesOrderLineFormValue | undefined): number {
  if (!line) return 0;
  const qty = Number(line.qty ?? 0);
  const price = Number(line.unit_price ?? 0);
  const discount = Number(line.discount_pct ?? 0);
  const tax = Number(line.tax_pct ?? 0);
  const subtotal = qty * price;
  const discountAmount = subtotal * (discount / 100);
  const taxBase = subtotal - discountAmount;
  const taxAmount = taxBase * (tax / 100);
  return taxBase + taxAmount;
}

function getStatusStats(rows: SalesOrder[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
}

function getOrderFulfillmentMetrics(order: SalesOrder) {
  const today = dayjs().startOf('day');
  let orderedQty = 0;
  let shippedQty = 0;
  let remainingReserveQty = 0;
  let overduePlans = 0;
  let dueSoonPlans = 0;

  for (const line of order.lines ?? []) {
    orderedQty += toNumber(line.qty);
    shippedQty += toNumber(line.shipped_qty_total);
    remainingReserveQty += toNumber(line.remaining_reservation_qty);

    for (const plan of line.delivery_plans ?? []) {
      const remainingQty = toNumber(plan.remaining_qty ?? (toNumber(plan.qty) - toNumber(plan.delivered_qty)));
      if (remainingQty <= 0 || !plan.delivery_date) continue;
      const deliveryDate = dayjs(plan.delivery_date).startOf('day');
      if (deliveryDate.isBefore(today, 'day')) {
        overduePlans += 1;
      } else if (deliveryDate.diff(today, 'day') <= 2) {
        dueSoonPlans += 1;
      }
    }
  }

  return {
    orderedQty,
    shippedQty,
    remainingReserveQty,
    overduePlans,
    dueSoonPlans,
  };
}

function getCurrentUser() {
  return storage.getUser() as {
    id?: number;
    username?: string;
    is_staff?: boolean;
    is_superuser?: boolean;
  } | null;
}

function isShipmentProofAttachment(att: AttachmentItem, proofType: ShipmentAttachmentProofType): boolean {
  return (att.description || '').startsWith(SHIPMENT_ATTACHMENT_PREFIX[proofType]);
}

function downloadBlobFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildBatchReserveDraft(
  lines: SalesOrderLine[],
  stockRows: BatchReserveSuggestionStock[]
): BatchReserveItemFormValue[] {
  const availableByKey = new Map(stockRows.map((row) => [row.key, toNumber(row.available)]));
  const rowsByProduct = stockRows.reduce<Map<number, BatchReserveSuggestionStock[]>>((acc, row) => {
    const current = acc.get(row.product_id) ?? [];
    current.push(row);
    acc.set(row.product_id, current);
    return acc;
  }, new Map());

  return lines.map((line) => {
    let needed = toNumber(line.remaining_reservation_qty);
    const locationPriority = (value?: string | null) => {
      switch (value) {
        case 'SHIPPING':
          return 1;
        case 'STAGING':
          return 2;
        case 'STORAGE':
          return 3;
        case 'PRODUCTION':
          return 4;
        case 'RETURN':
          return 5;
        default:
          return 9;
      }
    };
    const candidates = [...(rowsByProduct.get(line.product) ?? [])].sort((a, b) => {
      const locationCompare = locationPriority(a.location_type) - locationPriority(b.location_type);
      if (locationCompare !== 0) return locationCompare;
      const warehouseCompare = Number(a.warehouse_sort_order ?? 0) - Number(b.warehouse_sort_order ?? 0);
      if (warehouseCompare !== 0) return warehouseCompare;
      const sortOrderCompare = Number(a.location_sort_order ?? 0) - Number(b.location_sort_order ?? 0);
      if (sortOrderCompare !== 0) return sortOrderCompare;
      return toNumber(b.available) - toNumber(a.available);
    });
    const allocations: BatchReserveAllocationFormValue[] = [];

    for (const candidate of candidates) {
      if (needed <= 0) break;
      const available = toNumber(availableByKey.get(candidate.key));
      if (available <= 0) continue;
      const reservedQty = Math.min(available, needed);
      allocations.push({
        stock_key: candidate.key,
        reserved_qty: reservedQty,
      });
      availableByKey.set(candidate.key, available - reservedQty);
      needed -= reservedQty;
    }

    return {
      line_id: line.id,
      sales_order_line: line.id ?? null,
      product: line.product,
      requested_qty: toNumber(line.remaining_reservation_qty),
      allocations,
    };
  });
}

export default function SalesOrderList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null);
  const [openEditModal, setOpenEditModal] = useState(false);
  const [reasonModal, setReasonModal] = useState<ReasonModalState>(null);
  const [reasonText, setReasonText] = useState('');
  const [shipmentCancelModal, setShipmentCancelModal] = useState<ShipmentCancelModalState>(null);
  const [shipmentCancelReason, setShipmentCancelReason] = useState('');
  const [shipmentPackModal, setShipmentPackModal] = useState<ShipmentPackModalState>(null);
  const [shipmentPackItems, setShipmentPackItems] = useState<SalesOrderShipmentDetailItem[]>([]);
  const [shipmentScanModal, setShipmentScanModal] = useState<ShipmentScanModalState>(null);
  const [shipmentLoadingProofModal, setShipmentLoadingProofModal] = useState<ShipmentLoadingProofModalState>(null);
  const [shipmentDeliveryProofModal, setShipmentDeliveryProofModal] = useState<ShipmentDeliveryProofModalState>(null);
  const [shipmentAttachmentModal, setShipmentAttachmentModal] = useState<ShipmentAttachmentModalState>(null);
  const [shipmentScanCode, setShipmentScanCode] = useState('');
  const [shipmentPackages, setShipmentPackages] = useState<SalesOrderShipmentPackageItem[]>([]);
  const [selectedPackageIds, setSelectedPackageIds] = useState<number[]>([]);
  const [detailOrder, setDetailOrder] = useState<SalesOrder | null>(null);

  // Cleanup on unmount to prevent hanging queries
  useEffect(() => {
    return () => {
      setDetailOrder(null);
    };
  }, []);
  const [form] = Form.useForm<SalesOrderFormValues>();
  const [shipmentForm] = Form.useForm<ShipmentFormValues>();
  const [shipmentPackForm] = Form.useForm<ShipmentPackFormValues>();
  const [shipmentLoadingProofForm] = Form.useForm<ShipmentLoadingProofFormValues>();
  const [shipmentDeliveryProofForm] = Form.useForm<ShipmentDeliveryProofFormValues>();
  const [reserveForm] = Form.useForm<ReserveFromOrderFormValues>();
  const [batchReserveForm] = Form.useForm<BatchReserveFormValues>();
  const [traceLabelForm] = Form.useForm<TraceLabelPrintFormValues>();
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false);
  const [reserveLine, setReserveLine] = useState<SalesOrderLine | null>(null);
  const [batchReserveOpen, setBatchReserveOpen] = useState(false);
  const [traceLabelModalOpen, setTraceLabelModalOpen] = useState(false);
  const canView = canAccessSalesOrders();
  const canSubmit = canSubmitSalesOrders();
  const canApprove = canApproveSalesOrders();
  const canPost = canPostSalesOrders();
  const canVoid = canVoidSalesOrders();
  const { config, saveConfig } = useUserPreferences(PAGES.SALES_ORDERS);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);
  const liveLines = Form.useWatch('lines', form);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-order_date' };
    if (intentSearch.trim()) next.search = intentSearch.trim();
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.customer) next.customer = intentFilters.customer;
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const orderQuery = useQuery({
    queryKey: ['sales-orders', params],
    queryFn: () => salesApi.getOrders(params),
    enabled: canView,
    gcTime: 0,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
  const customerQuery = useQuery({
    queryKey: ['sales-order-customers'],
    queryFn: () => customersApi.getCustomers({ page_size: 200, is_active: true }),
    enabled: canView,
    gcTime: 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const productQuery = useQuery({
    queryKey: ['sales-order-products'],
    queryFn: () => productsApi.getProducts({ page_size: 200, is_active: true, ordering: 'code' }),
    enabled: canView,
    gcTime: 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const detailQuery = useQuery({
    queryKey: ['sales-order-detail', detailOrder?.id],
    queryFn: () => salesApi.getOrder(detailOrder?.id as number),
    enabled: Boolean(detailOrder?.id),
    gcTime: 0,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
  const deliveryOverviewQuery = useQuery({
    queryKey: ['sales-order-delivery-overview', detailOrder?.id],
    queryFn: () => salesApi.getDeliveryOverview(detailOrder?.id as number),
    enabled: Boolean(detailOrder?.id),
    gcTime: 0,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
  const reservationOverviewQuery = useQuery({
    queryKey: ['sales-order-reservation-overview', detailOrder?.id],
    queryFn: () => salesApi.getReservationOverview(detailOrder?.id as number),
    enabled: Boolean(detailOrder?.id),
    gcTime: 0,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
  const shipmentOverviewQuery = useQuery({
    queryKey: ['sales-order-shipment-overview', detailOrder?.id],
    queryFn: () => salesApi.getShipmentOverview(detailOrder?.id as number),
    enabled: Boolean(detailOrder?.id),
    gcTime: 0,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
  const detailLines = useMemo(() => {
    const lines = detailQuery.data?.lines ?? detailOrder?.lines ?? [];
    const parents: SalesOrderLine[] = [];
    const childrenByParent = new Map<number, SalesOrderLine[]>();
    const orphans: SalesOrderLine[] = [];
    for (const line of lines) {
      const parentId = line.product_snapshot?.parent_id;
      if (parentId == null) {
        parents.push(line);
      } else {
        const siblings = childrenByParent.get(parentId) ?? [];
        siblings.push(line);
        childrenByParent.set(parentId, siblings);
      }
    }
    const parentProductIds = new Set(parents.map((p) => p.product));
    for (const line of lines) {
      const parentId = line.product_snapshot?.parent_id;
      if (parentId != null && !parentProductIds.has(parentId)) {
        orphans.push(line);
      }
    }
    const result: SalesOrderLine[] = [];
    for (const parent of parents) {
      result.push(parent);
      const children = childrenByParent.get(parent.product);
      if (children) {
        children.sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0));
        result.push(...children);
      }
    }
    for (const orphan of orphans) {
      if (!result.includes(orphan)) result.push(orphan);
    }
    return result;
  }, [detailQuery.data?.lines, detailOrder?.lines]);
  const reserveCandidateLines = useMemo(
    () => detailLines.filter((line) => Number(line.remaining_reservation_qty || 0) > 0),
    [detailLines]
  );
  const reserveStockQuery = useQuery({
    queryKey: ['sales-order-reserve-stock', reserveLine?.product],
    queryFn: () => inventoryApi.getStock({ product: reserveLine?.product, page_size: 200 }),
    enabled: Boolean(reserveLine?.product),
    gcTime: 0,
  });
  const batchReserveStockQuery = useQuery({
    queryKey: ['sales-order-batch-reserve-stock', detailOrder?.id, reserveCandidateLines.map((line) => line.product).join(',')],
    queryFn: async () => {
      const seen = new Set<number>();
      const rows = [];
      for (const line of reserveCandidateLines) {
        if (seen.has(line.product)) continue;
        seen.add(line.product);
        const response = await inventoryApi.getStock({ product: line.product, page_size: 200 });
        rows.push(...response.results);
      }
      return rows;
    },
    enabled: false,
    gcTime: 0,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    await queryClient.invalidateQueries({ queryKey: ['sales-order-detail'] });
    await queryClient.invalidateQueries({ queryKey: ['sales-order-delivery-overview'] });
    await queryClient.invalidateQueries({ queryKey: ['sales-order-reservation-overview'] });
    await queryClient.invalidateQueries({ queryKey: ['sales-order-shipment-overview'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-reservations'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
  };
  const currentUser = getCurrentUser();
  const shipmentAttachmentQuery = useQuery({
    queryKey: ['shipment-attachments', shipmentAttachmentModal?.shipment.shipment_id],
    queryFn: () => attachmentsApi.list('OutboundShipment', shipmentAttachmentModal?.shipment.shipment_id as number),
    enabled: Boolean(shipmentAttachmentModal?.shipment.shipment_id),
    staleTime: 0,
    gcTime: 0,
  });
  const shipmentProofAttachments = useMemo(
    () =>
      (shipmentAttachmentQuery.data ?? []).filter((att) =>
        shipmentAttachmentModal ? isShipmentProofAttachment(att, shipmentAttachmentModal.proofType) : false
      ),
    [shipmentAttachmentModal, shipmentAttachmentQuery.data]
  );

  const createMutation = useMutation({
    mutationFn: salesApi.createOrder,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã tạo đơn hàng xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SalesOrderFormValues> }) => salesApi.updateOrder(id, payload),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã cập nhật đơn hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: salesApi.deleteOrder,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã xóa đơn hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const submitMutation = useMutation({
    mutationFn: salesApi.submitOrder,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã gửi duyệt đơn hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveMutation = useMutation({
    mutationFn: salesApi.approveOrder,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã duyệt đơn hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => salesApi.rejectOrder(id, reason),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã từ chối đơn hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const confirmMutation = useMutation({
    mutationFn: salesApi.confirmOrder,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã xác nhận đơn hàng với khách hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const postMutation = useMutation({
    mutationFn: salesApi.postOrder,
    onSuccess: async (data) => {
      await invalidate();
      messageApi.success(data.message || 'Đã post đơn hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const voidMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => salesApi.voidOrder(id, reason),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã hủy đơn hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const shipMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ShipmentFormValues }) =>
      salesApi.shipOrder(id, {
        items: (payload.items ?? [])
          .filter((item) => item.reservation_id && Number(item.quantity ?? 0) > 0)
          .map((item) => ({
            reservation_id: Number(item.reservation_id),
            quantity: String(item.quantity),
          })),
        transaction_date: payload.transaction_date,
        reference: payload.reference?.trim() || '',
        reason: payload.reason?.trim() || '',
        note: payload.note?.trim() || '',
        carrier_name: payload.carrier_name?.trim() || '',
        tracking_number: payload.tracking_number?.trim() || '',
        vehicle_no: payload.vehicle_no?.trim() || '',
        driver_name: payload.driver_name?.trim() || '',
        driver_phone: payload.driver_phone?.trim() || '',
      }),
    onSuccess: async (data) => {
      await invalidate();
      messageApi.success(`Đã tạo shipment ${data.shipment_code}`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const cancelShipmentMutation = useMutation({
    mutationFn: ({ orderId, shipmentId, reason }: { orderId: number; shipmentId: number; reason: string }) =>
      salesApi.cancelShipment(orderId, { shipment_id: shipmentId, reason }),
    onSuccess: async (data) => {
      await invalidate();
      messageApi.success(`Đã hủy shipment ${data.shipment_code}`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const createReservationMutation = useMutation({
    mutationFn: inventoryApi.createReservation,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã tạo reservation từ đơn hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const batchReserveMutation = useMutation({
    mutationFn: async ({ orderId, payload }: { orderId: number; payload: BatchReserveFormValues }) => {
      const requests = (payload.items ?? []).flatMap((item) =>
        (item.allocations ?? [])
          .filter((allocation) => allocation.stock_key && Number(allocation.reserved_qty ?? 0) > 0)
          .map((allocation) => {
            const stock = batchReserveStockMap.get(allocation.stock_key as string);
            if (!stock) return null;
            return inventoryApi.createReservation({
              reservation_date: payload.reservation_date,
              sales_order: orderId,
              sales_order_line: item.sales_order_line ?? null,
              product: item.product,
              warehouse: stock.warehouse_id,
              location: stock.location_id ?? null,
              reserved_qty: String(allocation.reserved_qty),
              reference: payload.reference?.trim() || detailOrder?.code || '',
              note: payload.note?.trim() || '',
            });
          })
          .filter(Boolean)
      );
      return Promise.all(requests);
    },
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã tạo batch reservation');
      setBatchReserveOpen(false);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const invoicePdfMutation = useMutation({
    mutationFn: salesApi.downloadInvoicePdf,
    onSuccess: (blob, id) => {
      downloadBlobFile(blob, `hoa_don_${detailOrder?.code || id}.pdf`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const packingSlipMutation = useMutation({
    mutationFn: salesApi.downloadPackingSlipPdf,
    onSuccess: (blob, id) => {
      downloadBlobFile(blob, `packing_slip_${detailOrder?.code || id}.pdf`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const shipmentPackingSlipMutation = useMutation({
    mutationFn: ({ orderId, shipmentId }: { orderId: number; shipmentId: number }) =>
      salesApi.downloadShipmentPackingSlipPdf(orderId, shipmentId),
    onSuccess: (blob, variables) => {
      downloadBlobFile(blob, `shipment_packing_slip_${variables.shipmentId}.pdf`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const shipmentPackageLabelsMutation = useMutation({
    mutationFn: ({ orderId, shipmentId }: { orderId: number; shipmentId: number }) =>
      salesApi.downloadShipmentPackageLabelsPdf(orderId, shipmentId),
    onSuccess: (blob, variables) => {
      downloadBlobFile(blob, `shipment_package_labels_${variables.shipmentId}.pdf`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const shipmentManifestMutation = useMutation({
    mutationFn: ({ orderId, shipmentId }: { orderId: number; shipmentId: number }) =>
      salesApi.downloadShipmentPackingManifestPdf(orderId, shipmentId),
    onSuccess: (blob, variables) => {
      downloadBlobFile(blob, `shipment_manifest_${variables.shipmentId}.pdf`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const shipmentLoadingHandoverPdfMutation = useMutation({
    mutationFn: ({ orderId, shipmentId }: { orderId: number; shipmentId: number }) =>
      salesApi.downloadShipmentLoadingHandoverPdf(orderId, shipmentId),
    onSuccess: (blob, variables) => {
      downloadBlobFile(blob, `shipment_loading_handover_${variables.shipmentId}.pdf`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const shipmentDeliveryProofPdfMutation = useMutation({
    mutationFn: ({ orderId, shipmentId }: { orderId: number; shipmentId: number }) =>
      salesApi.downloadShipmentDeliveryProofPdf(orderId, shipmentId),
    onSuccess: (blob, variables) => {
      downloadBlobFile(blob, `shipment_delivery_proof_${variables.shipmentId}.pdf`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const confirmShipmentLoadingMutation = useMutation({
    mutationFn: ({
      orderId,
      shipmentId,
      payload,
    }: {
      orderId: number;
      shipmentId: number;
      payload: ShipmentLoadingProofFormValues;
    }) =>
      salesApi.confirmShipmentLoading(orderId, {
        shipment_id: shipmentId,
        loading_reference: payload.loading_reference?.trim() || '',
        handover_receiver_name: payload.handover_receiver_name.trim(),
        handover_receiver_phone: payload.handover_receiver_phone?.trim() || '',
        handover_proof_url: payload.handover_proof_url?.trim() || '',
        loading_confirmation_note: payload.loading_confirmation_note?.trim() || '',
      }),
    onSuccess: async (data) => {
      await invalidate();
      setShipmentLoadingProofModal(null);
      shipmentLoadingProofForm.resetFields();
      messageApi.success(`Đã xác nhận bàn giao xe cho shipment ${data.shipment_code}`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const confirmShipmentDeliveryMutation = useMutation({
    mutationFn: ({
      orderId,
      shipmentId,
      payload,
    }: {
      orderId: number;
      shipmentId: number;
      payload: ShipmentDeliveryProofFormValues;
    }) =>
      salesApi.confirmShipmentDelivery(orderId, {
        shipment_id: shipmentId,
        delivery_reference: payload.delivery_reference?.trim() || '',
        customer_receiver_name: payload.customer_receiver_name.trim(),
        customer_receiver_phone: payload.customer_receiver_phone?.trim() || '',
        delivery_proof_url: payload.delivery_proof_url?.trim() || '',
        delivery_confirmation_note: payload.delivery_confirmation_note?.trim() || '',
        delivered_at_actual: payload.delivered_at_actual || '',
      }),
    onSuccess: async (data) => {
      await invalidate();
      setShipmentDeliveryProofModal(null);
      shipmentDeliveryProofForm.resetFields();
      messageApi.success(`Đã xác nhận giao xong cho shipment ${data.shipment_code}`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const uploadShipmentAttachmentMutation = useMutation({
    mutationFn: ({
      shipmentId,
      proofType,
      file,
    }: {
      shipmentId: number;
      proofType: ShipmentAttachmentProofType;
      file: File;
    }) =>
      attachmentsApi.upload(
        'OutboundShipment',
        shipmentId,
        file,
        `${SHIPMENT_ATTACHMENT_PREFIX[proofType]} ${SHIPMENT_ATTACHMENT_LABEL[proofType]}`
      ),
    onSuccess: async (attachment, variables) => {
      await shipmentAttachmentQuery.refetch();
      if (variables.proofType === 'LOAD' && !shipmentLoadingProofForm.getFieldValue('handover_proof_url')) {
        shipmentLoadingProofForm.setFieldValue('handover_proof_url', attachment.file_url || '');
      }
      if (variables.proofType === 'DELIVERY' && !shipmentDeliveryProofForm.getFieldValue('delivery_proof_url')) {
        shipmentDeliveryProofForm.setFieldValue('delivery_proof_url', attachment.file_url || '');
      }
      messageApi.success(`Đã tải lên ${variables.file.name}`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteShipmentAttachmentMutation = useMutation({
    mutationFn: (id: number) => attachmentsApi.delete(id),
    onSuccess: async () => {
      await shipmentAttachmentQuery.refetch();
      messageApi.success('Đã xóa file chứng từ');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const scanShipmentPackageMutation = useMutation({
    mutationFn: ({ orderId, shipmentId, scanValue }: { orderId: number; shipmentId: number; scanValue: string }) =>
      salesApi.scanShipmentPackage(orderId, { shipment_id: shipmentId, scan_value: scanValue }),
    onSuccess: async (data) => {
      await invalidate();
      if (detailOrder) {
        const overview = await salesApi.getShipmentPackageOverview(detailOrder.id, data.shipment_id);
        setShipmentPackages(overview.results ?? []);
      }
      setShipmentScanCode('');
      setSelectedPackageIds([]);
      messageApi.success(
        data.scan_status === 'ALREADY_VERIFIED'
          ? `Kiện ${data.package.package_code} đã verify trước đó`
          : `Đã verify kiện ${data.package.package_code}`
      );
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const loadShipmentPackagesMutation = useMutation({
    mutationFn: ({ orderId, shipmentId, packageIds }: { orderId: number; shipmentId: number; packageIds?: number[] }) =>
      salesApi.markShipmentPackagesLoaded(orderId, { shipment_id: shipmentId, package_ids: packageIds }),
    onSuccess: async (data) => {
      await invalidate();
      if (detailOrder) {
        const overview = await salesApi.getShipmentPackageOverview(detailOrder.id, data.shipment_id);
        setShipmentPackages(overview.results ?? []);
      }
      setSelectedPackageIds([]);
      messageApi.success(`Đã xác nhận bốc xếp ${data.loaded_count} kiện cho shipment ${data.shipment_code}`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const packShipmentMutation = useMutation({
    mutationFn: ({
      orderId,
      shipmentId,
      payload,
    }: {
      orderId: number;
      shipmentId: number;
      payload: ShipmentPackFormValues;
    }) =>
      salesApi.packShipment(orderId, {
        shipment_id: shipmentId,
        replace_existing: true,
        items: (payload.items ?? [])
          .filter((item) => item.transaction_id && Number(item.package_count ?? 0) > 0)
          .map((item) => ({
            transaction_id: Number(item.transaction_id),
            package_count: Number(item.package_count),
            package_type: item.package_type?.trim() || '',
            gross_weight_kg: Number(item.gross_weight_kg ?? 0),
            length_cm: Number(item.length_cm ?? 0),
            width_cm: Number(item.width_cm ?? 0),
            height_cm: Number(item.height_cm ?? 0),
            note: item.note?.trim() || '',
          })),
      }),
    onSuccess: async (data) => {
      await invalidate();
      messageApi.success(`Đã lưu ${data.package_count} kiện cho shipment ${data.shipment_code}`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const traceLabelsMutation = useMutation({
    mutationFn: ({
      id,
      params,
    }: {
      id: number;
      params?: { copies_per_line?: number; packages_per_line?: number; label_mode?: 'copies' | 'cartons'; line_ids?: number[] };
    }) =>
      salesApi.downloadTraceLabelsPdf(id, params),
    onSuccess: (blob, variables) => {
      downloadBlobFile(blob, `trace_labels_${detailOrder?.code || variables.id}.pdf`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const productMap = useMemo(
    () => new Map((productQuery.data?.results ?? []).map((item) => [item.id, item])),
    [productQuery.data?.results]
  );
  const previewTotal = useMemo(
    () => (liveLines ?? []).reduce((sum, line) => sum + getLinePreviewTotal(line), 0),
    [liveLines]
  );

  const rows = useMemo(() => orderQuery.data?.results ?? [], [orderQuery.data?.results]);
  const stats = useMemo(() => getStatusStats(rows), [rows]);
  const fulfillmentStats = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          const metrics = getOrderFulfillmentMetrics(row);
          if (metrics.remainingReserveQty > 0) acc.needReserve += 1;
          if (metrics.overduePlans > 0) acc.overdue += 1;
          if (metrics.shippedQty > 0 && metrics.shippedQty < metrics.orderedQty) acc.partialShipment += 1;
          return acc;
        },
        { needReserve: 0, overdue: 0, partialShipment: 0 }
      ),
    [rows]
  );

  const openReservations = useMemo(
    () => (reservationOverviewQuery.data?.results ?? []).filter((item) => item.status === 'OPEN' && Number(item.active_qty || 0) > 0),
    [reservationOverviewQuery.data?.results]
  );
  const reserveStockRows = useMemo(
    () => (reserveStockQuery.data?.results ?? []).filter((row) => Number(row.available || 0) > 0),
    [reserveStockQuery.data?.results]
  );
  const reserveStockMap = useMemo(
    () =>
      new Map(
        reserveStockRows.map((row) => [
          `${row.warehouse_id}:${row.location_id ?? 0}`,
          row,
        ])
      ),
    [reserveStockRows]
  );
  const batchReserveRows = useMemo<BatchReserveSuggestionStock[]>(
    () =>
      (batchReserveStockQuery.data ?? [])
        .filter((row) => Number(row.available || 0) > 0)
        .map((row) => ({
          key: `${row.product_id}:${row.warehouse_id}:${row.location_id ?? 0}`,
          product_id: row.product_id,
          warehouse_id: row.warehouse_id,
          warehouse_name: row.warehouse_name,
          warehouse_sort_order: row.warehouse_sort_order,
          location_id: row.location_id ?? null,
          location_name: row.location_name ?? null,
          location_type: row.location_type ?? null,
          location_sort_order: row.location_sort_order ?? null,
          available: toNumber(row.available),
        })),
    [batchReserveStockQuery.data]
  );
  const batchReserveStockMap = new Map(batchReserveRows.map((row) => [row.key, row]));
  const batchReserveStockOptionsByProduct = (() => {
    const grouped = new Map<number, BatchReserveSuggestionStock[]>();
    for (const row of batchReserveRows) {
      const current = grouped.get(row.product_id) ?? [];
      current.push(row);
      grouped.set(row.product_id, current);
    }
    return grouped;
  })();
  const batchReserveItemsWatch = Form.useWatch('items', batchReserveForm);
  const shipmentPackageSummary = useMemo(
    () => ({
      packageCount: shipmentPackages.filter((item) => item.status === 'ACTIVE').length,
      verifiedCount: shipmentPackages.filter((item) => item.status === 'ACTIVE' && item.verified_at).length,
      loadedCount: shipmentPackages.filter((item) => item.status === 'ACTIVE' && item.loaded_at).length,
      pendingLoadCount: shipmentPackages.filter((item) => item.status === 'ACTIVE' && item.verified_at && !item.loaded_at).length,
    }),
    [shipmentPackages]
  );

  const columns: ColumnsType<SalesOrder> = [
    { title: 'Mã đơn', dataIndex: 'code', width: 150 },
    { title: 'Ngày đơn', dataIndex: 'order_date', width: 110 },
    { title: 'KH', dataIndex: 'customer_name', width: 220, render: (value) => value || '-' },
    { title: 'Tham chiếu', dataIndex: 'reference', width: 180, render: (value) => value || '-' },
    {
      title: 'Fulfillment',
      width: 250,
      render: (_, row) => {
        const metrics = getOrderFulfillmentMetrics(row);
        return (
          <div>
            <div>Thiếu reserve: <strong>{metrics.remainingReserveQty}</strong></div>
            <div>Đã xuất: <strong>{metrics.shippedQty}</strong> / {metrics.orderedQty}</div>
            <Space wrap size={4}>
              {metrics.remainingReserveQty > 0 ? <Tag color="orange">Cần reserve</Tag> : <Tag color="green">Reserve ổn</Tag>}
              {metrics.overduePlans > 0 ? <Tag color="red">Quá hạn giao</Tag> : null}
              {metrics.dueSoonPlans > 0 ? <Tag color="gold">Sắp đến hạn</Tag> : null}
              {metrics.shippedQty > 0 && metrics.shippedQty < metrics.orderedQty ? <Tag color="blue">Xuất một phần</Tag> : null}
            </Space>
          </div>
        );
      },
    },
    { title: 'Tổng tiền', width: 140, render: (_, row) => <FormattedPrice value={Number(row.total || 0)} /> },
    { title: 'Dòng hàng', width: 90, render: (_, row) => row.lines?.length ?? 0 },
    {
      title: 'Trạng thái',
      width: 110,
      render: (_, row) => <Tag color={STATUS_COLORS[row.status] || 'default'}>{STATUS_LABELS[row.status] || row.status}</Tag>,
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 420,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setDetailOrder(row)}
          >
            Xem
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'DRAFT'}
            onClick={() => {
              setEditingOrder(row);
              form.setFieldsValue(toOrderFormValues(row));
              setOpenEditModal(true);
            }}
          >
            Sửa
          </Button>
          <Button
            size="small"
            disabled={!canSubmit || row.status !== 'DRAFT'}
            onClick={() => void submitMutation.mutateAsync(row.id)}
          >
            Gửi duyệt
          </Button>
          <Button
            size="small"
            disabled={!canApprove || row.status !== 'SUBMITTED'}
            onClick={() => void approveMutation.mutateAsync(row.id)}
          >
            Duyệt
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={!canSubmit || !['DRAFT', 'SUBMITTED'].includes(row.status) || !!row.confirmed_at}
            onClick={() => void confirmMutation.mutateAsync(row.id)}
          >
            {row.confirmed_at ? 'Đã xác nhận' : 'Xác nhận'}
          </Button>
          <Button
            size="small"
            danger
            disabled={!canApprove || row.status !== 'SUBMITTED'}
            onClick={() => {
              setReasonModal({ type: 'reject', order: row });
              setReasonText('');
            }}
          >
            Từ chối
          </Button>
          <Button
            size="small"
            disabled={!canPost || row.status !== 'APPROVED'}
            onClick={() => void postMutation.mutateAsync(row.id)}
          >
            Post
          </Button>
          <Button
            size="small"
            danger
            disabled={!canVoid || !['APPROVED', 'POSTED'].includes(row.status)}
            onClick={() => {
              setReasonModal({ type: 'void', order: row });
              setReasonText('');
            }}
          >
            Void
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={row.status !== 'DRAFT'}
            onClick={() =>
              Modal.confirm({
                title: `Xóa đơn ${row.code}?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutateAsync(row.id),
              })
            }
          />
        </Space>
      ),
    },
  ];

  const onSubmitOrder = async () => {
    const values = await form.validateFields();
    if (!values.lines || values.lines.length === 0) {
      messageApi.error('Đơn hàng phải có ít nhất 1 dòng hàng.');
      return;
    }
    const payload = buildPayload(values);
    if (editingOrder) {
      await updateMutation.mutateAsync({ id: editingOrder.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setOpenEditModal(false);
  };

  const onSubmitReasonAction = async () => {
    if (!reasonModal || !reasonText.trim()) {
      messageApi.error('Bạn cần nhập lý do.');
      return;
    }
    if (reasonModal.type === 'reject') {
      await rejectMutation.mutateAsync({ id: reasonModal.order.id, reason: reasonText.trim() });
    } else {
      await voidMutation.mutateAsync({ id: reasonModal.order.id, reason: reasonText.trim() });
    }
    setReasonModal(null);
    setReasonText('');
  };

  const onSubmitShipment = async () => {
    if (!detailOrder) return;
    const values = await shipmentForm.validateFields();
    if (!(values.items ?? []).some((item) => item.reservation_id && Number(item.quantity ?? 0) > 0)) {
      messageApi.error('Cần ít nhất 1 reservation hợp lệ để xuất kho.');
      return;
    }
    await shipMutation.mutateAsync({ id: detailOrder.id, payload: values });
    setShipmentModalOpen(false);
  };

  const onSubmitReserve = async () => {
    if (!detailOrder || !reserveLine) return;
    const values = await reserveForm.validateFields();
    const selectedStock = values.stock_key ? reserveStockMap.get(values.stock_key) : undefined;
    if (!selectedStock) {
      messageApi.error('Cần chọn kho/vị trí để reserve.');
      return;
    }
    await createReservationMutation.mutateAsync({
      reservation_date: values.reservation_date,
      sales_order: detailOrder.id,
      sales_order_line: reserveLine.id ?? null,
      product: reserveLine.product,
      warehouse: selectedStock.warehouse_id,
      location: selectedStock.location_id ?? null,
      reserved_qty: String(values.reserved_qty),
      reference: values.reference?.trim() || detailOrder.code || '',
      note: values.note?.trim() || '',
    });
    setReserveLine(null);
  };

  const onSubmitBatchReserve = async () => {
    if (!detailOrder) return;
    const values = await batchReserveForm.validateFields();
    const hasAnyAllocation = (values.items ?? []).some((item) =>
      (item.allocations ?? []).some((allocation) => allocation.stock_key && Number(allocation.reserved_qty ?? 0) > 0)
    );
    if (!hasAnyAllocation) {
      messageApi.error('Cần ít nhất 1 phân bổ reservation hợp lệ.');
      return;
    }
    await batchReserveMutation.mutateAsync({ orderId: detailOrder.id, payload: values });
  };

  const onSubmitTraceLabels = async () => {
    if (!detailOrder) return;
    const values = await traceLabelForm.validateFields();
    await traceLabelsMutation.mutateAsync({
      id: detailOrder.id,
      params: {
        label_mode: values.label_mode,
        copies_per_line: Number(values.copies_per_line ?? 1),
        packages_per_line: Number(values.packages_per_line ?? 1),
        line_ids: values.line_ids,
      },
    });
    setTraceLabelModalOpen(false);
  };

  const onSubmitCancelShipment = async () => {
    if (!detailOrder || !shipmentCancelModal || !shipmentCancelReason.trim()) {
      messageApi.error('Bạn cần nhập lý do hủy shipment.');
      return;
    }
    await cancelShipmentMutation.mutateAsync({
      orderId: detailOrder.id,
      shipmentId: shipmentCancelModal.shipment.shipment_id,
      reason: shipmentCancelReason.trim(),
    });
    setShipmentCancelModal(null);
    setShipmentCancelReason('');
  };

  const openPackShipmentModal = async (shipment: SalesOrderShipmentOverviewItem) => {
    if (!detailOrder) return;
    try {
      const detail = await salesApi.getShipmentDetail(detailOrder.id, shipment.shipment_id);
      setShipmentPackItems(detail.items ?? []);
      shipmentPackForm.setFieldsValue({
        items: (detail.items ?? []).map((item) => ({
          transaction_id: item.transaction_id,
          package_count: item.existing_package_count && item.existing_package_count > 0 ? item.existing_package_count : 1,
          package_type: item.package_type || '',
          gross_weight_kg: Number(item.gross_weight_kg || 0),
          length_cm: Number(item.length_cm || 0),
          width_cm: Number(item.width_cm || 0),
          height_cm: Number(item.height_cm || 0),
          note: item.package_note || '',
        })),
      });
      setShipmentPackModal({ shipment });
    } catch (error) {
      messageApi.error(getToastMessage(error));
    }
  };

  const onSubmitPackShipment = async () => {
    if (!detailOrder || !shipmentPackModal) return;
    const values = await shipmentPackForm.validateFields();
    if (!(values.items ?? []).some((item) => item.transaction_id && Number(item.package_count ?? 0) > 0)) {
      messageApi.error('Cần ít nhất 1 dòng đóng gói hợp lệ.');
      return;
    }
    await packShipmentMutation.mutateAsync({
      orderId: detailOrder.id,
      shipmentId: shipmentPackModal.shipment.shipment_id,
      payload: values,
    });
    setShipmentPackItems([]);
    setShipmentPackModal(null);
  };

  const openShipmentScanModal = async (shipment: SalesOrderShipmentOverviewItem) => {
    if (!detailOrder) return;
    try {
      const overview = await salesApi.getShipmentPackageOverview(detailOrder.id, shipment.shipment_id);
      setShipmentPackages(overview.results ?? []);
      setSelectedPackageIds([]);
      setShipmentScanCode('');
      setShipmentScanModal({ shipment });
    } catch (error) {
      messageApi.error(getToastMessage(error));
    }
  };

  const onSubmitScanShipmentPackage = async () => {
    if (!detailOrder || !shipmentScanModal || !shipmentScanCode.trim()) {
      messageApi.error('Nhập mã kiện hoặc QR để scan.');
      return;
    }
    await scanShipmentPackageMutation.mutateAsync({
      orderId: detailOrder.id,
      shipmentId: shipmentScanModal.shipment.shipment_id,
      scanValue: shipmentScanCode.trim(),
    });
  };

  const onSubmitMarkLoadedPackages = async () => {
    if (!detailOrder || !shipmentScanModal) return;
    await loadShipmentPackagesMutation.mutateAsync({
      orderId: detailOrder.id,
      shipmentId: shipmentScanModal.shipment.shipment_id,
      packageIds: selectedPackageIds.length ? selectedPackageIds : undefined,
    });
  };

  const openShipmentLoadingProofModal = (shipment: SalesOrderShipmentOverviewItem) => {
    shipmentLoadingProofForm.setFieldsValue({
      loading_reference: shipment.loading_reference || `LOAD-${shipment.shipment_code}`,
      handover_receiver_name: shipment.handover_receiver_name || shipment.driver_name || '',
      handover_receiver_phone: shipment.handover_receiver_phone || shipment.driver_phone || '',
      handover_proof_url: shipment.handover_proof_url || '',
      loading_confirmation_note: shipment.loading_confirmation_note || '',
    });
    setShipmentLoadingProofModal({ shipment });
  };

  const onSubmitConfirmShipmentLoading = async () => {
    if (!detailOrder || !shipmentLoadingProofModal) return;
    const values = await shipmentLoadingProofForm.validateFields();
    await confirmShipmentLoadingMutation.mutateAsync({
      orderId: detailOrder.id,
      shipmentId: shipmentLoadingProofModal.shipment.shipment_id,
      payload: values,
    });
  };

  const openShipmentDeliveryProofModal = (shipment: SalesOrderShipmentOverviewItem) => {
    shipmentDeliveryProofForm.setFieldsValue({
      delivery_reference: shipment.delivery_reference || `DEL-${shipment.shipment_code}`,
      customer_receiver_name: shipment.customer_receiver_name || shipment.handover_receiver_name || '',
      customer_receiver_phone: shipment.customer_receiver_phone || shipment.handover_receiver_phone || '',
      delivery_proof_url: shipment.delivery_proof_url || shipment.handover_proof_url || '',
      delivery_confirmation_note: shipment.delivery_confirmation_note || '',
      delivered_at_actual: dayjs(shipment.delivered_at_actual || new Date()).format('YYYY-MM-DDTHH:mm'),
    });
    setShipmentDeliveryProofModal({ shipment });
  };

  const openShipmentAttachmentModal = (shipment: SalesOrderShipmentOverviewItem, proofType: ShipmentAttachmentProofType) => {
    setShipmentAttachmentModal({ shipment, proofType });
  };

  const onSubmitConfirmShipmentDelivery = async () => {
    if (!detailOrder || !shipmentDeliveryProofModal) return;
    const values = await shipmentDeliveryProofForm.validateFields();
    await confirmShipmentDeliveryMutation.mutateAsync({
      orderId: detailOrder.id,
      shipmentId: shipmentDeliveryProofModal.shipment.shipment_id,
      payload: values,
    });
  };

  if (!canView) {
    return <div>Bạn không có quyền truy cập Đơn hàng xuất.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Đơn hàng xuất</h2>
          <div style={{ color: '#8c8c8c' }}>Quản lý đơn khách hàng, duyệt, post và theo dõi reservation theo đơn</div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditingOrder(null);
            form.setFieldsValue(emptyFormValues);
            setOpenEditModal(true);
          }}
        >
          Tạo đơn hàng
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <Card><Statistic title="Tổng đơn" value={orderQuery.data?.count ?? 0} /></Card>
        <Card><Statistic title="Nháp" value={stats.DRAFT ?? 0} /></Card>
        <Card><Statistic title="Chờ duyệt" value={stats.SUBMITTED ?? 0} /></Card>
        <Card><Statistic title="Đã duyệt" value={stats.APPROVED ?? 0} /></Card>
        <Card><Statistic title="Đã post" value={stats.POSTED ?? 0} /></Card>
        <Card><Statistic title="Cần reserve" value={fulfillmentStats.needReserve} /></Card>
        <Card><Statistic title="Quá hạn giao" value={fulfillmentStats.overdue} /></Card>
        <Card><Statistic title="Xuất một phần" value={fulfillmentStats.partialShipment} /></Card>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm mã đơn, tham chiếu, ghi chú..."
          style={{ width: 320 }}
          suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
        />
        <Select
          allowClear
          placeholder="Lọc theo trạng thái"
          style={{ width: 180 }}
          value={filters.status}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, status: value }));
            setPage(1);
          }}
          options={[
            { label: 'Nháp', value: 'DRAFT' },
            { label: 'Chờ duyệt', value: 'SUBMITTED' },
            { label: 'Đã duyệt', value: 'APPROVED' },
            { label: 'Từ chối', value: 'REJECTED' },
            { label: 'Đã vào sổ', value: 'POSTED' },
            { label: 'Đã hủy', value: 'VOID' },
          ]}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Lọc theo khách hàng"
          style={{ width: 260 }}
          value={filters.customer}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, customer: value }));
            setPage(1);
          }}
          options={(customerQuery.data?.results ?? []).map((item) => ({
            label: `${item.code} - ${item.name}`,
            value: item.id,
          }))}
        />
      </div>

      <Table
        rowKey="id"
        loading={orderQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1900 }}
        pagination={{
          current: page,
          pageSize,
          total: orderQuery.data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: async (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize });
            }
          },
        }}
      />

      <Modal
        title={editingOrder ? `Sửa đơn ${editingOrder.code}` : 'Tạo đơn hàng xuất'}
        open={openEditModal}
        onCancel={() => setOpenEditModal(false)}
        onOk={onSubmitOrder}
        width={1100}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" initialValues={emptyFormValues}>
          <Form.Item name="version" hidden>
            <InputNumber />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="order_date" label="Ngày đơn" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="delivery_date" label="Ngày giao header">
              <Input type="date" />
            </Form.Item>
            <Form.Item name="customer" label="Khách hàng">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                options={(customerQuery.data?.results ?? []).map((item) => ({
                  label: `${item.code} - ${item.name}`,
                  value: item.id,
                }))}
              />
            </Form.Item>
            <Form.Item name="reference" label="Tham chiếu">
              <Input />
            </Form.Item>
            <Form.Item name="currency" label="Tiền tệ">
              <Input />
            </Form.Item>
            <Form.Item name="exchange_rate" label="Tỷ giá">
              <InputNumber style={{ width: '100%' }} min={0.000001} />
            </Form.Item>
          </div>
          <Form.Item name="notes" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>Dòng hàng</strong>
                  <Button
                    onClick={() =>
                      add({
                        line_number: fields.length + 1,
                        product: 0,
                        uom: '',
                        product_snapshot: {},
                        qty: 1,
                        unit_price: 0,
                        discount_pct: 0,
                        tax_pct: 0,
                        note: '',
                        delivery_plans: [],
                      })
                    }
                  >
                    Thêm dòng
                  </Button>
                </div>

                {fields.map((field, index) => {
                  const currentLine = liveLines?.[index];
                  return (
                    <Card
                      key={field.key}
                      size="small"
                      title={`Dòng ${index + 1}`}
                      extra={fields.length > 1 ? <Button danger size="small" onClick={() => remove(field.name)}>Xóa</Button> : null}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 12 }}>
                        <Form.Item
                          name={[field.name, 'product']}
                          label="Sản phẩm"
                          rules={[{ required: true, message: 'Bắt buộc' }]}
                        >
                          <Select
                            showSearch
                            optionFilterProp="label"
                            options={(productQuery.data?.results ?? []).map((item) => ({
                              label: `${item.code} - ${item.name}`,
                              value: item.id,
                            }))}
                            onChange={(value) => {
                              const product = productMap.get(Number(value));
                              form.setFieldValue(['lines', index, 'uom'], product?.unit_name || '');
                              form.setFieldValue(
                                ['lines', index, 'unit_price'],
                                Number(product?.resolved_bundle_sale_price ?? product?.sale_price ?? 0),
                              );
                              form.setFieldValue(['lines', index, 'product_snapshot'], buildLineSnapshotFromProduct(product));
                            }}
                          />
                        </Form.Item>
                        <Form.Item name={[field.name, 'uom']} label="ĐVT">
                          <Input />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, 'qty']}
                          label="SL"
                          rules={[{ required: true, message: 'Bắt buộc' }]}
                        >
                          <InputNumber style={{ width: '100%' }} min={0.0001} />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, 'unit_price']}
                          label="Đơn giá"
                          rules={[{ required: true, message: 'Bắt buộc' }]}
                        >
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'discount_pct']} label="CK %">
                          <InputNumber style={{ width: '100%' }} min={0} max={100} />
                        </Form.Item>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr 1fr', gap: 12 }}>
                        <Form.Item name={[field.name, 'tax_pct']} label="VAT %">
                          <InputNumber style={{ width: '100%' }} min={0} max={100} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'note']} label="Ghi chú dòng">
                          <Input />
                        </Form.Item>
                        <div style={{ alignSelf: 'end', paddingBottom: 8 }}>
                          <strong>Tạm tính: </strong>
                          <FormattedPrice value={getLinePreviewTotal(currentLine)} />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                        <Form.Item name={[field.name, 'product_snapshot', 'size_order']} label="Kích thước ĐH">
                          <Input placeholder="Dài x Rộng x Cao" />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'size_production']} label="KTSX">
                          <Input />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'delivery_tolerance']} label="+/- giao hàng">
                          <Input />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'color_count']} label="Số màu">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                        <Form.Item name={[field.name, 'product_snapshot', 'process_xa']} label="Xả">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'process_in']} label="In">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'process_be']} label="Bế">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'process_chap']} label="Chạp">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                        <Form.Item name={[field.name, 'product_snapshot', 'film_code']} label="Mã phim">
                          <Input />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'mold_code']} label="Mã khuôn">
                          <Input />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'commission_per_unit']} label="HHCĐ">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'commission_percent']} label="HH %">
                          <InputNumber style={{ width: '100%' }} min={0} max={100} />
                        </Form.Item>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                        <Form.Item name={[field.name, 'product_snapshot', 'process_boi']} label="Bồi">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'process_can_mang']} label="Cán màng">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'process_dong']} label="Đóng">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'product_snapshot', 'process_dan']} label="Dán">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </div>

                      <Form.List name={[field.name, 'delivery_plans']}>
                        {(planFields, { add: addPlan, remove: removePlan }) => (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: '#595959' }}>Kế hoạch giao</span>
                              <Button
                                size="small"
                                onClick={() =>
                                  addPlan({
                                    delivery_date: form.getFieldValue('delivery_date') || dayjs().add(3, 'day').format('YYYY-MM-DD'),
                                    qty: currentLine?.qty || 1,
                                    shipped_qty: 0,
                                    delivered_qty: 0,
                                    note: '',
                                  })
                                }
                              >
                                Thêm kế hoạch
                              </Button>
                            </div>
                            {planFields.map((planField) => (
                              <div
                                key={planField.key}
                                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 2fr auto', gap: 12, alignItems: 'center' }}
                              >
                                <Form.Item
                                  name={[planField.name, 'delivery_date']}
                                  label="Ngày giao"
                                  rules={[{ required: true, message: 'Bắt buộc' }]}
                                >
                                  <Input type="date" />
                                </Form.Item>
                                <Form.Item
                                  name={[planField.name, 'qty']}
                                  label="SL KH"
                                  rules={[{ required: true, message: 'Bắt buộc' }]}
                                >
                                  <InputNumber style={{ width: '100%' }} min={0.0001} />
                                </Form.Item>
                                <Form.Item name={[planField.name, 'shipped_qty']} label="Đã xuất">
                                  <InputNumber style={{ width: '100%' }} min={0} disabled />
                                </Form.Item>
                                <Form.Item name={[planField.name, 'delivered_qty']} label="Đã giao">
                                  <InputNumber style={{ width: '100%' }} min={0} disabled />
                                </Form.Item>
                                <Form.Item name={[planField.name, 'note']} label="Ghi chú KH">
                                  <Input />
                                </Form.Item>
                                <Button danger size="small" onClick={() => removePlan(planField.name)}>
                                  Xóa
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </Form.List>
                    </Card>
                  );
                })}
              </div>
            )}
          </Form.List>

          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <strong>Tổng preview: </strong>
            <FormattedPrice value={previewTotal} />
          </div>
        </Form>
      </Modal>

      <Modal
        title={reasonModal?.type === 'reject' ? `Từ chối đơn ${reasonModal.order.code}` : reasonModal ? `Void đơn ${reasonModal.order.code}` : ''}
        open={Boolean(reasonModal)}
        onCancel={() => setReasonModal(null)}
        onOk={onSubmitReasonAction}
        confirmLoading={rejectMutation.isPending || voidMutation.isPending}
      >
        <Input.TextArea
          rows={4}
          value={reasonText}
          onChange={(event) => setReasonText(event.target.value)}
          placeholder="Nhập lý do"
        />
      </Modal>

      <Modal
        title={shipmentCancelModal ? `Hủy shipment ${shipmentCancelModal.shipment.shipment_code}` : 'Hủy shipment'}
        open={Boolean(shipmentCancelModal)}
        onCancel={() => {
          setShipmentCancelModal(null);
          setShipmentCancelReason('');
        }}
        onOk={onSubmitCancelShipment}
        confirmLoading={cancelShipmentMutation.isPending}
      >
        <Input.TextArea
          rows={4}
          value={shipmentCancelReason}
          onChange={(event) => setShipmentCancelReason(event.target.value)}
          placeholder="Nhập lý do hủy shipment"
        />
      </Modal>

      <Modal
        title={shipmentPackModal ? `Đóng gói shipment ${shipmentPackModal.shipment.shipment_code}` : 'Đóng gói shipment'}
        open={Boolean(shipmentPackModal)}
        onCancel={() => {
          setShipmentPackModal(null);
          setShipmentPackItems([]);
          shipmentPackForm.resetFields();
        }}
        onOk={onSubmitPackShipment}
        confirmLoading={packShipmentMutation.isPending}
        width={900}
      >
        <div style={{ marginBottom: 12, color: '#595959' }}>
          Nhập số kiện cho từng dòng đã xuất. Hệ thống sẽ lưu package records để tái in đúng tem kiện theo shipment.
        </div>
        <Form form={shipmentPackForm} layout="vertical">
          <Form.List name="items">
            {(fields) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {fields.map((field, index) => {
                  const item = shipmentPackItems[index];
                  return (
                    <Card
                      key={field.key}
                      size="small"
                      title={
                        item
                          ? `Dòng ${item.line_number ?? '-'} - ${item.product_code || ''} - ${item.product_name || ''}`
                          : `Dòng ${index + 1}`
                      }
                    >
                      <div style={{ marginBottom: 8, color: '#595959' }}>
                        {item ? `SL xuất: ${item.quantity} | Trace: ${item.trace_code || '-'} | Kiện hiện có: ${item.existing_package_count || 0}` : '-'}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        <Form.Item name={[field.name, 'transaction_id']} hidden>
                          <InputNumber />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, 'package_count']}
                          label="Số kiện"
                          rules={[{ required: true, message: 'Bắt buộc' }]}
                        >
                          <InputNumber style={{ width: '100%' }} min={1} max={200} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'package_type']} label="Loại kiện">
                          <Input placeholder="Carton / Pallet / Bao..." />
                        </Form.Item>
                        <Form.Item name={[field.name, 'gross_weight_kg']} label="Khối lượng / kiện (kg)">
                          <InputNumber style={{ width: '100%' }} min={0} precision={3} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'length_cm']} label="Dài (cm)">
                          <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'width_cm']} label="Rộng (cm)">
                          <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'height_cm']} label="Cao (cm)">
                          <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'note']} label="Ghi chú đóng gói">
                          <Input />
                        </Form.Item>
                      </div>
                    </Card>
                  );
                })}
                {!fields.length ? <div>Shipment này chưa có item POSTED để đóng gói.</div> : null}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        title={shipmentScanModal ? `Scan / Verify kiện ${shipmentScanModal.shipment.shipment_code}` : 'Scan / Verify kiện'}
        open={Boolean(shipmentScanModal)}
        onCancel={() => {
          setShipmentScanModal(null);
          setShipmentScanCode('');
          setShipmentPackages([]);
          setSelectedPackageIds([]);
        }}
        width={1100}
        footer={[
          <Button
            key="load"
            type="primary"
            disabled={!shipmentScanModal || shipmentPackageSummary.pendingLoadCount <= 0}
            loading={loadShipmentPackagesMutation.isPending}
            onClick={() => void onSubmitMarkLoadedPackages()}
          >
            Xác nhận đã bốc xếp
          </Button>,
          <Button
            key="close"
            onClick={() => {
              setShipmentScanModal(null);
              setShipmentScanCode('');
              setShipmentPackages([]);
              setSelectedPackageIds([]);
            }}
          >
            Đóng
          </Button>,
        ]}
      >
        <div style={{ marginBottom: 12, color: '#595959' }}>
          Quét `QR/package code` để verify từng kiện trước khi lên xe. Có thể chọn một phần hoặc để trống lựa chọn để xác nhận toàn bộ kiện đã verify.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
          <Card size="small"><Statistic title="Tổng kiện active" value={shipmentPackageSummary.packageCount} /></Card>
          <Card size="small"><Statistic title="Đã verify" value={shipmentPackageSummary.verifiedCount} /></Card>
          <Card size="small"><Statistic title="Đã bốc xếp" value={shipmentPackageSummary.loadedCount} /></Card>
          <Card size="small"><Statistic title="Chờ bốc xếp" value={shipmentPackageSummary.pendingLoadCount} /></Card>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input
            value={shipmentScanCode}
            onChange={(event) => setShipmentScanCode(event.target.value)}
            onPressEnter={() => void onSubmitScanShipmentPackage()}
            placeholder="Quét QR hoặc nhập package code"
          />
          <Button type="primary" loading={scanShipmentPackageMutation.isPending} onClick={() => void onSubmitScanShipmentPackage()}>
            Scan verify
          </Button>
        </div>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          rowSelection={{
            selectedRowKeys: selectedPackageIds,
            onChange: (keys) => setSelectedPackageIds(keys.map((key) => Number(key))),
            getCheckboxProps: (row) => ({
              disabled: row.status !== 'ACTIVE' || Boolean(row.loaded_at),
            }),
          }}
          columns={[
            { title: 'Kiện', dataIndex: 'package_code', width: 190 },
            { title: 'Line', dataIndex: 'line_number', width: 70, render: (value) => value ?? '-' },
            { title: 'Sản phẩm', width: 220, render: (_, row) => `${row.product_code || ''} - ${row.product_name || ''}` },
            { title: 'SL', dataIndex: 'quantity', width: 90, render: (value) => value || '0' },
            { title: 'Loại kiện', dataIndex: 'package_type', width: 120, render: (value) => value || '-' },
            { title: 'Kg', dataIndex: 'gross_weight_kg', width: 80, render: (value) => value || '0' },
            {
              title: 'Trạng thái',
              width: 180,
              render: (_, row) => (
                <Space wrap size={4}>
                  {row.status === 'CANCELLED' ? <Tag color="red">Đã hủy</Tag> : <Tag color="blue">Hoạt động</Tag>}
                  {row.verified_at ? <Tag color="green">Đã verify</Tag> : <Tag color="orange">Chưa verify</Tag>}
                  {row.loaded_at ? <Tag color="cyan">Đã bốc xếp</Tag> : null}
                </Space>
              ),
            },
            {
              title: 'Thời điểm',
              width: 220,
              render: (_, row) => (
                <div style={{ fontSize: 12 }}>
                  <div>Verify: {row.verified_at ? `${row.verified_at}${row.verified_by_name ? ` / ${row.verified_by_name}` : ''}` : '-'}</div>
                  <div>Load: {row.loaded_at ? `${row.loaded_at}${row.loaded_by_name ? ` / ${row.loaded_by_name}` : ''}` : '-'}</div>
                </div>
              ),
            },
            { title: 'QR value', dataIndex: 'label_qr_value', width: 260, render: (value) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{value}</span> },
          ]}
          dataSource={shipmentPackages}
          locale={{ emptyText: 'Shipment chưa có kiện để scan.' }}
          scroll={{ x: 1500, y: 420 }}
        />
      </Modal>

      <Modal
        title={shipmentLoadingProofModal ? `Bàn giao xe ${shipmentLoadingProofModal.shipment.shipment_code}` : 'Bàn giao xe'}
        open={Boolean(shipmentLoadingProofModal)}
        onCancel={() => {
          setShipmentLoadingProofModal(null);
          shipmentLoadingProofForm.resetFields();
        }}
        onOk={onSubmitConfirmShipmentLoading}
        confirmLoading={confirmShipmentLoadingMutation.isPending}
      >
        <div style={{ marginBottom: 12, color: '#595959' }}>
          Xác nhận này dùng để khóa bàn giao xe sau khi toàn bộ kiện đã được `loaded`. Có thể nhập link ngoài vào `Proof URL`, hoặc tải file ở nút `Tệp xe` và để trống ô này để hệ thống tự gắn link nội bộ.
        </div>
        <Form form={shipmentLoadingProofForm} layout="vertical">
          <Form.Item name="loading_reference" label="Mã bàn giao">
            <Input />
          </Form.Item>
          <Form.Item
            name="handover_receiver_name"
            label="Người nhận / tài xế nhận hàng"
            rules={[{ required: true, message: 'Bắt buộc' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="handover_receiver_phone" label="SĐT người nhận">
            <Input />
          </Form.Item>
          <Form.Item name="handover_proof_url" label="Proof URL">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="loading_confirmation_note" label="Ghi chú bàn giao">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={shipmentDeliveryProofModal ? `Xác nhận giao xong ${shipmentDeliveryProofModal.shipment.shipment_code}` : 'Xác nhận giao xong'}
        open={Boolean(shipmentDeliveryProofModal)}
        onCancel={() => {
          setShipmentDeliveryProofModal(null);
          shipmentDeliveryProofForm.resetFields();
        }}
        onOk={onSubmitConfirmShipmentDelivery}
        confirmLoading={confirmShipmentDeliveryMutation.isPending}
      >
        <div style={{ marginBottom: 12, color: '#595959' }}>
          Ghi nhận `proof of delivery` sau khi khách đã nhận hàng xong. Có thể lưu người nhận cuối, thời điểm giao xong và link ảnh/chứng từ ký nhận; nếu đã tải file ở `Tệp POD` thì có thể để trống `Proof URL`.
        </div>
        <Form form={shipmentDeliveryProofForm} layout="vertical">
          <Form.Item name="delivery_reference" label="Mã POD">
            <Input />
          </Form.Item>
          <Form.Item
            name="customer_receiver_name"
            label="Người nhận cuối"
            rules={[{ required: true, message: 'Bắt buộc' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="customer_receiver_phone" label="SĐT người nhận">
            <Input />
          </Form.Item>
          <Form.Item
            name="delivered_at_actual"
            label="Thời điểm giao xong"
            rules={[{ required: true, message: 'Bắt buộc' }]}
          >
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item name="delivery_proof_url" label="Proof URL">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="delivery_confirmation_note" label="Ghi chú giao hàng">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          shipmentAttachmentModal
            ? `${shipmentAttachmentModal.proofType === 'LOAD' ? 'Tệp bàn giao xe' : 'Tệp POD'} ${shipmentAttachmentModal.shipment.shipment_code}`
            : 'Tệp chứng từ'
        }
        open={Boolean(shipmentAttachmentModal)}
        onCancel={() => setShipmentAttachmentModal(null)}
        footer={null}
      >
        {shipmentAttachmentModal ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ color: '#595959' }}>
              Tải file nội bộ cho {SHIPMENT_ATTACHMENT_LABEL[shipmentAttachmentModal.proofType]}. Nếu ô `Proof URL` để trống khi xác nhận, hệ thống sẽ tự lấy file mới nhất ở đây.
            </div>
            <Upload
              showUploadList={false}
              multiple={false}
              beforeUpload={(file) => {
                void uploadShipmentAttachmentMutation.mutateAsync({
                  shipmentId: shipmentAttachmentModal.shipment.shipment_id,
                  proofType: shipmentAttachmentModal.proofType,
                  file,
                });
                return false;
              }}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt"
            >
              <Button icon={<PaperClipOutlined />} loading={uploadShipmentAttachmentMutation.isPending}>
                Tải file chứng từ
              </Button>
            </Upload>
            {shipmentAttachmentQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: 8 }}>
                <Spin size="small" />
              </div>
            ) : shipmentProofAttachments.length === 0 ? (
              <div style={{ color: '#bfbfbf', fontSize: 12 }}>Chưa có file chứng từ.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {shipmentProofAttachments.map((att) => {
                  const canDelete = Boolean(
                    currentUser && (currentUser.id === att.uploaded_by || currentUser.is_staff || currentUser.is_superuser)
                  );
                  return (
                    <div
                      key={att.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 12,
                        border: '1px solid #f0f0f0',
                        borderRadius: 8,
                        padding: 10,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500, wordBreak: 'break-word' }}>{att.filename}</div>
                        <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                          {att.file_size_display} | {att.uploaded_by_username || '-'} | {att.uploaded_at}
                        </div>
                      </div>
                      <Space>
                        <Button
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => window.open(att.file_url || `/api/attachments/${att.id}/download/`, '_blank', 'noopener,noreferrer')}
                        >
                          Mở
                        </Button>
                        {canDelete ? (
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            loading={deleteShipmentAttachmentMutation.isPending}
                            onClick={() => deleteShipmentAttachmentMutation.mutate(att.id)}
                          >
                            Xóa
                          </Button>
                        ) : null}
                      </Space>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        title={detailOrder ? `Xuất kho theo đơn ${detailOrder.code}` : 'Xuất kho'}
        open={shipmentModalOpen}
        onCancel={() => setShipmentModalOpen(false)}
        onOk={onSubmitShipment}
        confirmLoading={shipMutation.isPending}
      >
        <Form form={shipmentForm} layout="vertical">
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>Reservation cần xuất</strong>
                  <Button
                    size="small"
                    onClick={() =>
                      add({
                        reservation_id: undefined,
                        quantity: 0,
                      })
                    }
                  >
                    Thêm reservation
                  </Button>
                </div>
                {fields.map((field, idx) => (
                  <div
                    key={field.key}
                    style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 12, alignItems: 'end' }}
                  >
                    <Form.Item
                      name={[field.name, 'reservation_id']}
                      label={idx === 0 ? 'Reservation' : ' '}
                      rules={[{ required: true, message: 'Bắt buộc' }]}
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        options={openReservations.map((item) => ({
                          label: `${item.code} - Dòng ${item.line_number ?? '-'} - ${item.product_code || ''} / active ${item.active_qty}`,
                          value: item.id,
                        }))}
                        onChange={(value) => {
                          const selected = openReservations.find((item) => item.id === value);
                          shipmentForm.setFieldValue(['items', field.name, 'quantity'], Number(selected?.active_qty || 0));
                          shipmentForm.setFieldValue('reference', detailOrder?.code || '');
                          shipmentForm.setFieldValue('reason', 'Xuất kho theo đơn hàng');
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'quantity']}
                      label={idx === 0 ? 'Số lượng xuất' : ' '}
                      rules={[{ required: true, message: 'Bắt buộc' }]}
                    >
                      <InputNumber style={{ width: '100%' }} min={0.0001} />
                    </Form.Item>
                    <Button danger disabled={fields.length <= 1} onClick={() => remove(field.name)}>
                      Xóa
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Form.List>
          <Form.Item name="transaction_date" label="Ngày xuất kho" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="reference" label="Tham chiếu">
            <Input />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="carrier_name" label="Nhà vận chuyển">
              <Input />
            </Form.Item>
            <Form.Item name="tracking_number" label="Mã tracking / vận đơn">
              <Input />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="vehicle_no" label="Biển số xe">
              <Input />
            </Form.Item>
            <Form.Item name="driver_name" label="Tài xế">
              <Input />
            </Form.Item>
            <Form.Item name="driver_phone" label="SĐT tài xế">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="reason" label="Lý do">
            <Input />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={reserveLine && detailOrder ? `Reserve cho dòng ${reserveLine.line_number} - ${detailOrder.code}` : 'Reserve từ đơn hàng'}
        open={Boolean(reserveLine)}
        onCancel={() => setReserveLine(null)}
        onOk={onSubmitReserve}
        confirmLoading={createReservationMutation.isPending}
      >
        <Form form={reserveForm} layout="vertical">
          <Form.Item label="Dòng đơn">
            <div style={{ padding: 8, borderRadius: 8, background: '#fafafa' }}>
              {reserveLine
                ? `${reserveLine.product_code || reserveLine.internal_product_code || ''} - ${reserveLine.product_name_snapshot || reserveLine.product_name || ''} | Đặt ${reserveLine.qty || 0} | Đã reserve ${reserveLine.reserved_qty_total || 0} | Đã xuất ${reserveLine.shipped_qty_total || 0}`
                : '-'}
            </div>
          </Form.Item>
          <Form.Item name="reservation_date" label="Ngày reserve" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="stock_key" label="Kho / vị trí còn hàng" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={reserveStockQuery.isLoading}
              options={reserveStockRows.map((row) => ({
                label: `${row.warehouse_name}${row.location_name ? ` / ${row.location_name}` : ''} | available ${row.available}`,
                value: `${row.warehouse_id}:${row.location_id ?? 0}`,
              }))}
              onChange={(value) => {
                const stock = reserveStockMap.get(value);
                const targetQty = Math.min(
                  Number(stock?.available || 0),
                  Number(reserveLine?.remaining_reservation_qty || 0)
                );
                reserveForm.setFieldValue('reserved_qty', targetQty > 0 ? targetQty : 1);
              }}
            />
          </Form.Item>
          <Form.Item name="reserved_qty" label="Số lượng reserve" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <InputNumber style={{ width: '100%' }} min={0.0001} />
          </Form.Item>
          <Form.Item name="reference" label="Tham chiếu">
            <Input />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={detailOrder ? `Batch reserve - ${detailOrder.code}` : 'Batch reserve'}
        open={batchReserveOpen}
        onCancel={() => {
          setBatchReserveOpen(false);
        }}
        onOk={onSubmitBatchReserve}
        confirmLoading={batchReserveMutation.isPending}
        width={1100}
      >
        <div style={{ marginBottom: 12, color: '#595959' }}>
          Gợi ý phân bổ được lấy từ tồn `available` hiện tại theo từng sản phẩm. Bạn có thể sửa lại kho/vị trí và số lượng trước khi tạo reservation.
        </div>
        <Form form={batchReserveForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
            <Form.Item name="reservation_date" label="Ngày reserve" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="reference" label="Tham chiếu">
              <Input />
            </Form.Item>
            <Form.Item name="note" label="Ghi chú">
              <Input />
            </Form.Item>
          </div>

          <Form.List name="items">
            {(fields) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {fields.map((field, index) => {
                  const line = reserveCandidateLines[index];
                  const currentItem = batchReserveItemsWatch?.[index];
                  const allocatedQty = (currentItem?.allocations ?? []).reduce((sum, allocation) => sum + Number(allocation?.reserved_qty ?? 0), 0);
                  const requestedQty = Number(currentItem?.requested_qty ?? line?.remaining_reservation_qty ?? 0);
                  const remainingQty = Math.max(0, requestedQty - allocatedQty);
                  const productOptions = batchReserveStockOptionsByProduct.get(Number(currentItem?.product ?? line?.product ?? 0)) ?? [];

                  return (
                    <Card
                      key={field.key}
                      size="small"
                      title={
                        line
                          ? `Dòng ${line.line_number} - ${line.product_code || line.internal_product_code || ''} - ${line.product_name_snapshot || line.product_name || ''}`
                          : `Dòng batch ${index + 1}`
                      }
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 8 }}>
                        <div>Đặt: <strong>{line?.qty || '0'}</strong></div>
                        <div>Đã reserve: <strong>{line?.reserved_qty_total || '0'}</strong></div>
                        <div>Đã xuất: <strong>{line?.shipped_qty_total || '0'}</strong></div>
                        <div>Cần reserve thêm: <strong>{requestedQty}</strong></div>
                      </div>
                      <div style={{ marginBottom: 8, color: remainingQty > 0 ? '#d46b08' : '#389e0d' }}>
                        Đã phân bổ: {allocatedQty} | Còn thiếu: {remainingQty}
                      </div>
                      <Form.Item name={[field.name, 'line_id']} hidden>
                        <InputNumber />
                      </Form.Item>
                      <Form.Item name={[field.name, 'sales_order_line']} hidden>
                        <InputNumber />
                      </Form.Item>
                      <Form.Item name={[field.name, 'product']} hidden>
                        <InputNumber />
                      </Form.Item>
                      <Form.Item name={[field.name, 'requested_qty']} hidden>
                        <InputNumber />
                      </Form.Item>
                      <Form.List name={[field.name, 'allocations']}>
                        {(allocationFields, allocationOps) => (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: '#595959' }}>Phân bổ kho / vị trí</span>
                              <Button
                                size="small"
                                onClick={() =>
                                  allocationOps.add({
                                    stock_key: productOptions[0]?.key,
                                    reserved_qty: Math.min(
                                      Number(productOptions[0]?.available ?? 0),
                                      Math.max(remainingQty, 1)
                                    ),
                                  })
                                }
                              >
                                Thêm phân bổ
                              </Button>
                            </div>
                            {allocationFields.map((allocationField, allocationIndex) => (
                              <div
                                key={allocationField.key}
                                style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 12, alignItems: 'end' }}
                              >
                                <Form.Item
                                  name={[allocationField.name, 'stock_key']}
                                  label={allocationIndex === 0 ? 'Kho / vị trí' : ' '}
                                  rules={[{ required: true, message: 'Bắt buộc' }]}
                                >
                                  <Select
                                    showSearch
                                    optionFilterProp="label"
                                    options={productOptions.map((option) => ({
                                      label: `${option.warehouse_name}${option.location_name ? ` / ${option.location_name}` : ''} | available ${option.available}`,
                                      value: option.key,
                                    }))}
                                  />
                                </Form.Item>
                                <Form.Item
                                  name={[allocationField.name, 'reserved_qty']}
                                  label={allocationIndex === 0 ? 'SL reserve' : ' '}
                                  rules={[{ required: true, message: 'Bắt buộc' }]}
                                >
                                  <InputNumber style={{ width: '100%' }} min={0.0001} />
                                </Form.Item>
                                <Button danger onClick={() => allocationOps.remove(allocationField.name)}>
                                  Xóa
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </Form.List>
                    </Card>
                  );
                })}
                {!fields.length ? <div>Không còn dòng nào cần reserve thêm.</div> : null}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        title={detailOrder ? `Tùy chọn in tem QR - ${detailOrder.code}` : 'Tùy chọn in tem QR'}
        open={traceLabelModalOpen}
        onCancel={() => setTraceLabelModalOpen(false)}
        onOk={onSubmitTraceLabels}
        confirmLoading={traceLabelsMutation.isPending}
      >
        <Form form={traceLabelForm} layout="vertical">
          <Form.Item name="label_mode" label="Chế độ in tem" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select
              options={[
                { label: 'Theo bản copy', value: 'copies' },
                { label: 'Theo kiện / thùng duy nhất', value: 'cartons' },
              ]}
            />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() => {
              const labelMode = traceLabelForm.getFieldValue('label_mode') || 'copies';
              return labelMode === 'cartons' ? (
                <Form.Item name="packages_per_line" label="Số kiện mỗi dòng" rules={[{ required: true, message: 'Bắt buộc' }]}>
                  <InputNumber style={{ width: '100%' }} min={1} max={200} />
                </Form.Item>
              ) : (
                <Form.Item name="copies_per_line" label="Số tem mỗi dòng" rules={[{ required: true, message: 'Bắt buộc' }]}>
                  <InputNumber style={{ width: '100%' }} min={1} max={50} />
                </Form.Item>
              );
            }}
          </Form.Item>
          <div style={{ marginBottom: 12, color: '#595959' }}>
            `Theo kiện / thùng duy nhất` sẽ sinh QR riêng cho từng kiện theo dạng `trace_code|C001`, `C002`...
          </div>
          <Form.Item name="line_ids" label="Chọn dòng cần in">
            <Select
              mode="multiple"
              optionFilterProp="label"
              options={detailLines
                .filter((line) => line.id)
                .map((line) => ({
                  label: `Dòng ${line.line_number} - ${line.product_code || line.internal_product_code || ''} - ${line.product_name_snapshot || line.product_name || ''}`,
                  value: line.id as number,
                }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detailOrder ? `Chi tiết đơn hàng ${detailOrder.code}` : 'Chi tiết đơn hàng'}
        open={Boolean(detailOrder)}
        onClose={() => setDetailOrder(null)}
        width={1100}
      >
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="Mã đơn">{detailQuery.data?.code || detailOrder?.code}</Descriptions.Item>
          <Descriptions.Item label="Trạng thái">
            <Tag color={STATUS_COLORS[detailQuery.data?.status || detailOrder?.status || ''] || 'default'}>
              {STATUS_LABELS[detailQuery.data?.status || detailOrder?.status || ''] || detailQuery.data?.status || detailOrder?.status}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Khách hàng">{detailQuery.data?.customer_name || detailOrder?.customer_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="Ngày đơn">{detailQuery.data?.order_date || detailOrder?.order_date}</Descriptions.Item>
          <Descriptions.Item label="Ngày giao">{detailQuery.data?.delivery_date || detailOrder?.delivery_date || '-'}</Descriptions.Item>
          <Descriptions.Item label="Tham chiếu">{detailQuery.data?.reference || detailOrder?.reference || '-'}</Descriptions.Item>
          <Descriptions.Item label="Tổng tiền">
            <FormattedPrice value={Number(detailQuery.data?.total || detailOrder?.total || 0)} />
          </Descriptions.Item>
          <Descriptions.Item label="Post #">{detailQuery.data?.post_number || detailOrder?.post_number || '-'}</Descriptions.Item>
          <Descriptions.Item label="Xác nhận">{detailQuery.data?.confirmed_at ? dayjs(detailQuery.data.confirmed_at).format('DD/MM/YYYY HH:mm') : detailOrder?.confirmed_at ? dayjs(detailOrder.confirmed_at).format('DD/MM/YYYY HH:mm') : '-'}</Descriptions.Item>
        </Descriptions>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            onClick={() => detailOrder && invoicePdfMutation.mutate(detailOrder.id)}
            loading={invoicePdfMutation.isPending}
          >
            In hóa đơn
          </Button>
          <Button
            onClick={() => detailOrder && packingSlipMutation.mutate(detailOrder.id)}
            loading={packingSlipMutation.isPending}
          >
            Tải packing slip tổng hợp
          </Button>
          <Button
            onClick={() => {
              traceLabelForm.setFieldsValue({
                label_mode: 'copies',
                copies_per_line: 1,
                packages_per_line: 1,
                line_ids: detailLines.map((line) => line.id).filter(Boolean) as number[],
              });
              setTraceLabelModalOpen(true);
            }}
            loading={traceLabelsMutation.isPending}
          >
            Tải tem QR PDF
          </Button>
        </div>
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: '#fafafa', color: '#595959' }}>
          `Post` chỉ chốt chứng từ bán hàng. Bước trừ tồn thực tế là `Xuất kho` từ reservation bên dưới.
        </div>

        <Divider style={{ marginTop: 24 }}>Dòng hàng</Divider>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button
            disabled={!detailOrder || !['APPROVED', 'POSTED'].includes(detailOrder.status) || reserveCandidateLines.length === 0}
            onClick={async () => {
              batchReserveForm.resetFields();
              const result = await batchReserveStockQuery.refetch();
              const rows = (result.data ?? [])
                .filter((row) => Number(row.available || 0) > 0)
                .map((row) => ({
                  key: `${row.product_id}:${row.warehouse_id}:${row.location_id ?? 0}`,
                  product_id: row.product_id,
                  warehouse_id: row.warehouse_id,
                  warehouse_name: row.warehouse_name,
                  location_id: row.location_id ?? null,
                  location_name: row.location_name ?? null,
                  available: toNumber(row.available),
                }));
              batchReserveForm.setFieldsValue({
                reservation_date: dayjs().format('YYYY-MM-DD'),
                reference: detailOrder?.code || '',
                note: '',
                items: buildBatchReserveDraft(reserveCandidateLines, rows),
              });
              setBatchReserveOpen(true);
            }}
          >
            Batch reserve gợi ý
          </Button>
        </div>
        <Table
          rowKey={(row) => row.id ?? row.line_number}
          size="small"
          pagination={false}
          columns={[
            { title: '#', dataIndex: 'line_number', width: 60 },
            {
              title: 'Sản phẩm',
              width: 220,
              render: (_, row) => {
                const isChild = row.product_snapshot?.parent_id != null;
                return (
                  <div>
                    <div style={isChild ? { color: '#cf1322' } : undefined}>{`${row.product_code || row.internal_product_code || ''} - ${row.product_name_snapshot || row.product_name || ''}`}</div>
                    <div style={{ color: '#8c8c8c', fontSize: 12 }}>{row.uom || row.product_snapshot?.unit_name || '-'}</div>
                  </div>
                );
              },
            },
            {
              title: 'Trace / QR value',
              dataIndex: 'trace_code',
              width: 230,
              render: (value) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{formatTraceCode(value)}</span>,
            },
            {
              title: 'Lịch giao',
              dataIndex: 'delivery_schedule_summary',
              width: 180,
              render: (value) => value || '-',
            },
            { title: 'SL', dataIndex: 'qty', width: 100 },
            { title: 'Đơn giá', dataIndex: 'unit_price', width: 120, render: (value) => <FormattedPrice value={Number(value || 0)} /> },
            { title: 'Reserved', dataIndex: 'reserved_qty_total', width: 100, render: (value) => value || '0' },
            { title: 'Shipped', dataIndex: 'shipped_qty_total', width: 100, render: (value) => value || '0' },
            {
              title: 'Delivered',
              width: 100,
              render: (_, row) =>
                (row.delivery_plans ?? []).reduce((sum, plan) => sum + toNumber(plan.delivered_qty), 0).toString(),
            },
            { title: 'Còn reserve', dataIndex: 'remaining_reservation_qty', width: 100, render: (value) => value || '0' },
            { title: 'Planned', dataIndex: 'planned_qty_total', width: 100, render: (value) => value || '0' },
            { title: 'Unplanned', dataIndex: 'unplanned_qty', width: 100, render: (value) => value || '0' },
            {
              title: 'HH',
              width: 120,
              render: (_, row) => `${row.commission_per_unit_snapshot || '0'} / ${row.commission_percent_snapshot || '0'}%`,
            },
            {
              title: 'Snapshot',
              width: 110,
              render: (_, row) => renderSnapshotPopover(row),
            },
            {
              title: 'Reserve',
              width: 110,
              render: (_, row) => (
                <Button
                  size="small"
                  disabled={!detailOrder || !['APPROVED', 'POSTED'].includes(detailOrder.status) || Number(row.remaining_reservation_qty || 0) <= 0}
                  onClick={() => {
                    setReserveLine(row);
                    reserveForm.setFieldsValue({
                      reservation_date: dayjs().format('YYYY-MM-DD'),
                      stock_key: undefined,
                      reserved_qty: Number(row.remaining_reservation_qty || 0) > 0 ? Number(row.remaining_reservation_qty || 0) : 1,
                      reference: detailOrder?.code || '',
                      note: '',
                    });
                  }}
                >
                  Reserve
                </Button>
              ),
            },
            { title: 'Tổng dòng', dataIndex: 'line_total', width: 140, render: (value) => <FormattedPrice value={Number(value || 0)} /> },
          ]}
          dataSource={detailLines}
          scroll={{ x: 1950 }}
        />

        <Divider style={{ marginTop: 24 }}>Kế hoạch giao hàng</Divider>
        <Table
          rowKey="delivery_plan_id"
          size="small"
          loading={deliveryOverviewQuery.isLoading}
          pagination={false}
          columns={[
            { title: 'Dòng', dataIndex: 'line_number', width: 60 },
            { title: 'Sản phẩm', render: (_, row) => `${row.product_code || ''} - ${row.product_name || ''}` },
            { title: 'Ngày giao', dataIndex: 'delivery_date', width: 110 },
            { title: 'SL KH', dataIndex: 'qty', width: 90 },
            { title: 'Đã xuất', dataIndex: 'shipped_qty', width: 90 },
            { title: 'Đã giao', dataIndex: 'delivered_qty', width: 90 },
            { title: 'Còn xuất', dataIndex: 'remaining_shipment_qty', width: 90 },
            { title: 'Còn giao', dataIndex: 'remaining_qty', width: 90 },
            {
              title: 'Cờ',
              width: 140,
              render: (_, row) => (
                <Space wrap>
                  {row.is_overdue ? <Tag color="red">Quá hạn</Tag> : null}
                  {row.is_due_soon ? <Tag color="orange">Sắp đến hạn</Tag> : null}
                  {row.is_completed ? <Tag color="green">Xong</Tag> : null}
                </Space>
              ),
            },
          ]}
          dataSource={deliveryOverviewQuery.data?.results ?? []}
          locale={{ emptyText: 'Chưa có kế hoạch giao theo dòng.' }}
          scroll={{ x: 1180 }}
        />

        <Divider style={{ marginTop: 24 }}>Đặt trữ (Reservation)</Divider>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button
            type="primary"
            disabled={!detailOrder || !['APPROVED', 'POSTED'].includes(detailOrder.status) || openReservations.length === 0}
            onClick={() => {
              shipmentForm.setFieldsValue({
                items: openReservations.map((item) => ({
                  reservation_id: item.id,
                  quantity: Number(item.active_qty || 0),
                })),
                transaction_date: dayjs().format('YYYY-MM-DD'),
                reference: detailOrder?.code || '',
                reason: 'Xuất kho theo đơn hàng',
                note: '',
                carrier_name: '',
                tracking_number: '',
                vehicle_no: '',
                driver_name: '',
                driver_phone: '',
              });
              setShipmentModalOpen(true);
            }}
          >
            Xuất kho từ reservation
          </Button>
        </div>
        <Table
          rowKey="id"
          size="small"
          loading={reservationOverviewQuery.isLoading}
          pagination={false}
          columns={[
            { title: 'Reserve #', dataIndex: 'code', width: 150 },
            { title: 'Dòng', dataIndex: 'line_number', width: 60, render: (value) => value || '-' },
            { title: 'Sản phẩm', render: (_, row) => `${row.product_code || ''} - ${row.product_name || ''}` },
            { title: 'Kho/Vị trí', render: (_, row) => [row.warehouse_name, row.location_name].filter(Boolean).join(' / ') || '-' },
            { title: 'Đặt giữ', dataIndex: 'reserved_qty', width: 90 },
            { title: 'Active', dataIndex: 'active_qty', width: 90 },
            {
              title: 'Trạng thái',
              dataIndex: 'status',
              width: 110,
              render: (value) => {
                const map: Record<string, { color: string; label: string }> = {
                  OPEN: { color: 'blue', label: 'Mở' },
                  FULFILLED: { color: 'green', label: 'Đã cấp' },
                  CANCELLED: { color: 'red', label: 'Đã hủy' },
                  PARTIAL: { color: 'orange', label: 'Một phần' },
                };
                const info = map[value] || { color: 'default', label: value };
                return <Tag color={info.color}>{info.label}</Tag>;
              },
            },
          ]}
          dataSource={reservationOverviewQuery.data?.results ?? []}
          locale={{ emptyText: 'Chưa có reservation cho đơn này.' }}
          scroll={{ x: 1000 }}
        />

        <Divider style={{ marginTop: 24 }}>Phiếu xuất kho (Shipment)</Divider>
        <Table
          rowKey="id"
          size="small"
          loading={shipmentOverviewQuery.isLoading}
          pagination={false}
          columns={[
            { title: 'Shipment', dataIndex: 'shipment_code', width: 150 },
            { title: 'Ngày xuất', dataIndex: 'shipment_date', width: 110 },
            { title: 'Số dòng', dataIndex: 'line_count', width: 80, render: (value) => value ?? 0 },
            { title: 'Số item', dataIndex: 'item_count', width: 80, render: (value) => value ?? 0 },
            { title: 'Số kiện', dataIndex: 'package_count', width: 90, render: (value) => value ?? 0 },
            { title: 'Đã verify', dataIndex: 'verified_package_count', width: 90, render: (value) => value ?? 0 },
            { title: 'Đã bốc xếp', dataIndex: 'loaded_package_count', width: 100, render: (value) => value ?? 0 },
            { title: 'Tổng SL', dataIndex: 'total_qty', width: 90, render: (value) => value || '0' },
            { title: 'Tổng kg', dataIndex: 'total_gross_weight_kg', width: 90, render: (value) => value || '0' },
            { title: 'Tracking', dataIndex: 'tracking_number', width: 140, render: (value) => value || '-' },
            { title: 'Nhà VC', dataIndex: 'carrier_name', width: 140, render: (value) => value || '-' },
            { title: 'Xe / tài xế', width: 220, render: (_, row) => [row.vehicle_no, row.driver_name, row.driver_phone].filter(Boolean).join(' / ') || '-' },
            { title: 'Ref', dataIndex: 'reference', width: 140, render: (value) => value || '-' },
            {
              title: 'Trạng thái',
              dataIndex: 'status',
              width: 240,
              render: (value, row) => (
                <div>
                  <Tag color={value === 'CANCELLED' ? 'red' : 'blue'}>{SHIPMENT_STATUS_LABELS[value] || value}</Tag>
                  {row.loading_confirmed_at ? <Tag color="green">Đã bàn giao</Tag> : null}
                  {row.delivery_confirmed_at ? <Tag color="purple">Đã giao xong</Tag> : null}
                  {Number(row.package_count || 0) > 0 ? (
                    <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                      Verify {row.verified_package_count || 0}/{row.package_count || 0} | Load {row.loaded_package_count || 0}/{row.package_count || 0}
                    </div>
                  ) : null}
                  {row.loading_confirmed_at ? (
                    <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                      {row.loading_reference || '-'} | {row.handover_receiver_name || '-'}
                    </div>
                  ) : null}
                  {row.delivery_confirmed_at ? (
                    <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                      {row.delivery_reference || '-'} | {row.customer_receiver_name || '-'}
                    </div>
                  ) : null}
                  {row.cancel_reason ? <div style={{ color: '#8c8c8c', fontSize: 12 }}>{row.cancel_reason}</div> : null}
                </div>
              ),
            },
            {
              title: 'Chứng từ',
              width: 650,
              render: (_, row) => (
                <Space wrap>
                  <Button
                    size="small"
                    onClick={() => detailOrder && shipmentPackingSlipMutation.mutate({ orderId: detailOrder.id, shipmentId: row.shipment_id })}
                    loading={shipmentPackingSlipMutation.isPending}
                  >
                    Packing slip
                  </Button>
                  <Button
                    size="small"
                    disabled={!detailOrder || Number(row.package_count || 0) <= 0}
                    onClick={() => detailOrder && shipmentManifestMutation.mutate({ orderId: detailOrder.id, shipmentId: row.shipment_id })}
                    loading={shipmentManifestMutation.isPending}
                  >
                    Manifest
                  </Button>
                  <Button
                    size="small"
                    disabled={!detailOrder || Number(row.package_count || 0) <= 0}
                    onClick={() => detailOrder && shipmentPackageLabelsMutation.mutate({ orderId: detailOrder.id, shipmentId: row.shipment_id })}
                    loading={shipmentPackageLabelsMutation.isPending}
                  >
                    Tem kiện
                  </Button>
                  <Button
                    size="small"
                    disabled={!detailOrder || !row.loading_confirmed_at}
                    onClick={() => detailOrder && shipmentLoadingHandoverPdfMutation.mutate({ orderId: detailOrder.id, shipmentId: row.shipment_id })}
                    loading={shipmentLoadingHandoverPdfMutation.isPending}
                  >
                    BB giao xe
                  </Button>
                  <Button
                    size="small"
                    disabled={!detailOrder}
                    onClick={() => openShipmentAttachmentModal(row, 'LOAD')}
                  >
                    Tệp xe
                  </Button>
                  <Button
                    size="small"
                    disabled={!detailOrder}
                    onClick={() => openShipmentAttachmentModal(row, 'DELIVERY')}
                  >
                    Tệp POD
                  </Button>
                  <Button
                    size="small"
                    disabled={!detailOrder || !row.delivery_confirmed_at}
                    onClick={() => detailOrder && shipmentDeliveryProofPdfMutation.mutate({ orderId: detailOrder.id, shipmentId: row.shipment_id })}
                    loading={shipmentDeliveryProofPdfMutation.isPending}
                  >
                    POD
                  </Button>
                </Space>
              ),
            },
            {
              title: 'Thao tác',
              width: 540,
              render: (_, row) => (
                <Space wrap>
                  <Button
                    size="small"
                    disabled={!detailOrder || Number(row.package_count || 0) <= 0 || row.status !== 'POSTED' || Boolean(row.loading_confirmed_at)}
                    loading={
                      (scanShipmentPackageMutation.isPending || loadShipmentPackagesMutation.isPending) &&
                      shipmentScanModal?.shipment.shipment_id === row.shipment_id
                    }
                    onClick={() => void openShipmentScanModal(row)}
                  >
                    Scan kiện
                  </Button>
                  <Button
                    size="small"
                    disabled={
                      !detailOrder ||
                      row.status !== 'POSTED' ||
                      Number(row.package_count || 0) <= 0 ||
                      Number(row.pending_load_count || 0) > 0 ||
                      Boolean(row.loading_confirmed_at)
                    }
                    loading={confirmShipmentLoadingMutation.isPending && shipmentLoadingProofModal?.shipment.shipment_id === row.shipment_id}
                    onClick={() => openShipmentLoadingProofModal(row)}
                  >
                    Bàn giao xe
                  </Button>
                  <Button
                    size="small"
                    disabled={
                      !detailOrder ||
                      row.status !== 'POSTED' ||
                      !row.loading_confirmed_at ||
                      Boolean(row.delivery_confirmed_at)
                    }
                    loading={confirmShipmentDeliveryMutation.isPending && shipmentDeliveryProofModal?.shipment.shipment_id === row.shipment_id}
                    onClick={() => openShipmentDeliveryProofModal(row)}
                  >
                    Xác nhận giao xong
                  </Button>
                  <Button
                    size="small"
                    disabled={!detailOrder || row.status !== 'POSTED' || Boolean(row.loading_confirmed_at)}
                    loading={packShipmentMutation.isPending && shipmentPackModal?.shipment.shipment_id === row.shipment_id}
                    onClick={() => void openPackShipmentModal(row)}
                  >
                    Đóng gói
                  </Button>
                  <Button
                    size="small"
                    danger
                    disabled={!detailOrder || row.status !== 'POSTED' || Boolean(row.loading_confirmed_at)}
                    loading={cancelShipmentMutation.isPending && shipmentCancelModal?.shipment.shipment_id === row.shipment_id}
                    onClick={() => {
                      setShipmentCancelModal({ shipment: row });
                      setShipmentCancelReason('');
                    }}
                  >
                    Hủy shipment
                  </Button>
                </Space>
              ),
            },
          ]}
          dataSource={shipmentOverviewQuery.data?.results ?? []}
          locale={{ emptyText: 'Chưa có phiếu xuất kho cho đơn này.' }}
          scroll={{ x: 3000 }}
        />
      </Drawer>
    </div>
  );
}
