import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { DownloadOutlined, PlusOutlined, ShoppingOutlined, ThunderboltOutlined, WalletOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';

import { inventoryApi } from '../../api/inventory';
import { purchasingApi } from '../../api/purchasing';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getToastMessage } from '../../shared/apiError';
import type { PurchaseForecastRow } from '../../types/purchasing';
import { PAGES } from '../../utils/constants';
import { downloadCSV } from '../../utils/csvExport';

type ForecastFormValues = {
  supplier: number;
  warehouse?: number;
  location?: number;
  order_date: Dayjs;
  expected_receipt_date: Dayjs;
  reference?: string;
  notes?: string;
  payment_terms_days?: number;
  items: Array<{
    product_id: number;
    product_code: string;
    product_name: string;
    qty: number;
    unit_price?: number;
    note?: string;
    urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
};

type DisplayForecastRow = PurchaseForecastRow & {
  key: number;
  estimated_unit_price: number;
  stock_gap: number;
};

type PurchaseOrderForecastViewSnapshot = {
  months: number;
  leadTime: number;
};

type PurchaseOrderForecastNamedPreset = {
  id: string;
  name: string;
  snapshot: PurchaseOrderForecastViewSnapshot;
  updatedAt: string;
};

const monthOptions = [
  { label: '1 thang', value: 1 },
  { label: '3 thang', value: 3 },
  { label: '6 thang', value: 6 },
];

const leadTimeOptions = [
  { label: '7 ngay', value: 7 },
  { label: '14 ngay', value: 14 },
  { label: '21 ngay', value: 21 },
];

const urgencyColorMap: Record<string, string> = {
  HIGH: 'red',
  MEDIUM: 'orange',
  LOW: 'green',
};

const urgencyLabelMap: Record<string, string> = {
  HIGH: 'Cao',
  MEDIUM: 'Trung binh',
  LOW: 'Thap',
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
}

function formatQty(value: number): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
}

function urgencyWeight(value: DisplayForecastRow['urgency']): number {
  if (value === 'HIGH') {
    return 3;
  }
  if (value === 'MEDIUM') {
    return 2;
  }
  return 1;
}

export default function PurchaseOrderForecast() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<ForecastFormValues>();
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [months, setMonths] = useState(3);
  const [leadTime, setLeadTime] = useState(7);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const { config, saveConfig } = useUserPreferences(PAGES.PURCHASING_ORDER_FORECAST);

  const selectedWarehouseId = Form.useWatch('warehouse', form) as number | undefined;
  const formItems = (Form.useWatch('items', form) ?? []) as ForecastFormValues['items'];
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const namedPresets = useMemo<PurchaseOrderForecastNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<PurchaseOrderForecastNamedPreset>;
        if (
          typeof preset.id !== 'string' ||
          typeof preset.name !== 'string' ||
          !preset.snapshot ||
          typeof preset.snapshot.months !== 'number' ||
          typeof preset.snapshot.leadTime !== 'number'
        ) {
          return null;
        }
        return {
          id: preset.id,
          name: preset.name,
          snapshot: {
            months: preset.snapshot.months,
            leadTime: preset.snapshot.leadTime,
          },
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is PurchaseOrderForecastNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );

  const forecastQuery = useQuery({
    queryKey: ['purchase-order-forecast', months, leadTime],
    queryFn: () => purchasingApi.getPurchaseOrderForecast({ months, lead_time: leadTime }),
  });
  const supplierQuery = useQuery({
    queryKey: ['purchase-order-forecast-suppliers'],
    queryFn: () => purchasingApi.getSuppliers({ page_size: 200, ordering: 'code' }),
  });
  const warehouseQuery = useQuery({
    queryKey: ['purchase-order-forecast-warehouses'],
    queryFn: () => inventoryApi.getWarehouses({ page_size: 200, ordering: 'code' }),
  });
  const locationQuery = useQuery({
    queryKey: ['purchase-order-forecast-locations'],
    queryFn: () => inventoryApi.getLocations({ page_size: 500, ordering: 'warehouse__code,code' }),
  });

  const displayData = useMemo<DisplayForecastRow[]>(
    () =>
      (forecastQuery.data ?? []).map((row, index) => ({
        ...row,
        key: row.product_id ?? index + 1,
        estimated_unit_price:
          toNumber(row.suggested_qty) > 0 ? toNumber(row.estimated_cost) / toNumber(row.suggested_qty) : 0,
        stock_gap: Math.max(0, toNumber(row.reorder_point) - toNumber(row.current_stock)),
      })),
    [forecastQuery.data],
  );

  const selectedRows = useMemo(
    () => displayData.filter((row) => selectedRowKeys.includes(row.key)),
    [displayData, selectedRowKeys],
  );

  const summary = useMemo(() => {
    const totalEstimate = displayData.reduce((sum, row) => sum + toNumber(row.estimated_cost), 0);
    const totalSuggestedQty = displayData.reduce((sum, row) => sum + toNumber(row.suggested_qty), 0);
    const highUrgencyCount = displayData.filter((row) => row.urgency === 'HIGH').length;
    const mediumUrgencyCount = displayData.filter((row) => row.urgency === 'MEDIUM').length;
    const belowReorderCount = displayData.filter((row) => toNumber(row.current_stock) <= toNumber(row.reorder_point)).length;
    const selectedEstimate = selectedRows.reduce((sum, row) => sum + toNumber(row.estimated_cost), 0);
    const selectedUrgentCount = selectedRows.filter((row) => row.urgency === 'HIGH').length;
    return {
      totalEstimate,
      totalSuggestedQty,
      highUrgencyCount,
      mediumUrgencyCount,
      belowReorderCount,
      selectedEstimate,
      selectedUrgentCount,
    };
  }, [displayData, selectedRows]);

  const priorityRows = useMemo(
    () =>
      [...displayData]
        .sort((left, right) => {
          const urgencyGap = urgencyWeight(right.urgency) - urgencyWeight(left.urgency);
          if (urgencyGap !== 0) {
            return urgencyGap;
          }
          return right.stock_gap - left.stock_gap;
        })
        .slice(0, 5),
    [displayData],
  );

  const supplierOptions = useMemo(
    () =>
      (supplierQuery.data?.results ?? []).map((item) => ({
        label: `${item.code} - ${item.name}`,
        value: item.id,
      })),
    [supplierQuery.data?.results],
  );

  const warehouseOptions = useMemo(
    () =>
      (warehouseQuery.data?.results ?? []).map((item) => ({
        label: `${item.code} - ${item.name}`,
        value: item.id,
      })),
    [warehouseQuery.data?.results],
  );

  const filteredLocationOptions = useMemo(
    () =>
      (locationQuery.data?.results ?? [])
        .filter((item) => !selectedWarehouseId || item.warehouse === selectedWarehouseId)
        .map((item) => ({
          label: `${item.code} - ${item.name}`,
          value: item.id,
        })),
    [locationQuery.data?.results, selectedWarehouseId],
  );

  const activeContextTags = useMemo(() => {
    const tags = [`Chu ky: ${months} thang`, `Lead time: ${leadTime} ngay`];
    if (selectedRows.length > 0) {
      tags.push(`Da chon: ${selectedRows.length} dong`);
    }
    if (summary.selectedUrgentCount > 0) {
      tags.push(`Dong gap: ${summary.selectedUrgentCount}`);
    }
    if (selectedViewPreset) {
      tags.push(`Mau loc: ${selectedViewPreset.name}`);
    }
    return tags;
  }, [leadTime, months, selectedRows.length, selectedViewPreset, summary.selectedUrgentCount]);

  const workspaceAlert = useMemo(() => {
    if (summary.highUrgencyCount > 0) {
      return {
        type: 'warning' as const,
        title: `Co ${summary.highUrgencyCount} dong can mua gap trong ky forecast nay`,
        description:
          'Nen khoa nha cung cap, ngay nhan du kien va muc gia tam tinh cho nhom nguy co cao truoc khi gom PO.',
      };
    }
    if (summary.belowReorderCount > 0) {
      return {
        type: 'info' as const,
        title: 'Da co nhieu dong cham diem dat hang',
        description:
          'Ban co the chon nhieu dong mot luc de tao PO nhanh va giu cho forecast luon gan thuc te van hanh.',
      };
    }
    return {
      type: 'success' as const,
      title: 'Forecast mua hang dang o trang thai on dinh',
      description: 'Khong co diem nong lon trong ky dang xem. Day la luc tot de toi uu chi phi va gom don theo nha cung cap.',
    };
  }, [summary.belowReorderCount, summary.highUrgencyCount]);

  const createMutation = useMutation({
    mutationFn: purchasingApi.createPurchaseOrderFromForecast,
    onSuccess: async (order) => {
      await queryClient.invalidateQueries({ queryKey: ['purchase-order-forecast'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-orders'] });
      messageApi.success(`Da tao PO ${order.code}`);
      setCreateModalOpen(false);
      setSelectedRowKeys([]);
      form.resetFields();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error));
    },
  });

  const openCreateModal = (rows: DisplayForecastRow[]) => {
    const preferredSupplier =
      (supplierQuery.data?.results ?? []).find((item) => item.is_preferred) ?? supplierQuery.data?.results?.[0];

    setSelectedRowKeys(rows.map((row) => row.key));
    form.setFieldsValue({
      supplier: preferredSupplier?.id,
      order_date: dayjs(),
      expected_receipt_date: dayjs().add(leadTime, 'day'),
      reference: `FC-${dayjs().format('YYYYMMDD')}`,
      notes: 'Don mua tao tu forecast nhu cau',
      payment_terms_days: preferredSupplier?.payment_terms_days,
      items: rows.map((row) => ({
        product_id: row.product_id,
        product_code: row.product_code,
        product_name: row.product_name,
        qty: toNumber(row.suggested_qty),
        unit_price: row.estimated_unit_price,
        note: `Muc do: ${urgencyLabelMap[row.urgency] || row.urgency}`,
        urgency: row.urgency,
      })),
    });
    setCreateModalOpen(true);
  };

  const buildCurrentSnapshot = (): PurchaseOrderForecastViewSnapshot => ({
    months,
    leadTime,
  });

  const applySnapshot = (snapshot: PurchaseOrderForecastViewSnapshot) => {
    setMonths(snapshot.months);
    setLeadTime(snapshot.leadTime);
    setSelectedRowKeys([]);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem forecast mua hàng.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem forecast mua hàng.');
    }
  };

  const applySavedView = () => {
    const raw = configRecord.saved_view as Partial<PurchaseOrderForecastViewSnapshot> | undefined;
    if (!raw || typeof raw.months !== 'number' || typeof raw.leadTime !== 'number') {
      messageApi.warning('Chưa có chế độ xem forecast đã lưu.');
      return;
    }
    applySnapshot({ months: raw.months, leadTime: raw.leadTime });
    messageApi.success('Đã khôi phục chế độ xem forecast mua hàng.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: PurchaseOrderForecastNamedPreset = {
      id:
        existing?.id ??
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}`),
      name,
      snapshot: buildCurrentSnapshot(),
      updatedAt: new Date().toISOString(),
    };
    const nextPresets = existing
      ? namedPresets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...configRecord,
        saved_view: configRecord.saved_view,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(nextPreset.id);
      setIsViewPresetModalOpen(false);
      setViewPresetName('');
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc forecast mua hàng.' : 'Đã lưu mẫu lọc forecast mua hàng mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc forecast mua hàng.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc forecast mua hàng.');
      return;
    }
    applySnapshot(preset.snapshot);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc forecast mua hàng để xóa.');
      return;
    }
    try {
      await saveConfig({
        ...configRecord,
        saved_view: configRecord.saved_view,
        saved_views: namedPresets.filter((item) => item.id !== preset.id),
      });
      setSelectedViewPresetId(undefined);
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc forecast mua hàng.');
    }
  };

  const onSubmitCreate = async () => {
    const values = await form.validateFields();
    await createMutation.mutateAsync({
      supplier: values.supplier,
      warehouse: values.warehouse ?? null,
      location: values.location ?? null,
      order_date: values.order_date.format('YYYY-MM-DD'),
      expected_receipt_date: values.expected_receipt_date.format('YYYY-MM-DD'),
      reference: values.reference?.trim() || '',
      notes: values.notes?.trim() || '',
      payment_terms_days: values.payment_terms_days,
      items: values.items.map((item) => ({
        product_id: item.product_id,
        qty: toNumber(item.qty),
        unit_price: item.unit_price ? toNumber(item.unit_price) : undefined,
        note: item.note?.trim() || '',
        urgency: item.urgency,
      })),
    });
  };

  const columns: ColumnsType<DisplayForecastRow> = [
    { title: 'Ma', dataIndex: 'product_code', width: 110 },
    { title: 'San pham', dataIndex: 'product_name', width: 220 },
    {
      title: 'Ton hien tai',
      dataIndex: 'current_stock',
      width: 120,
      align: 'right',
      render: (value, row) => {
        const numericValue = toNumber(value);
        const isRisky = numericValue <= toNumber(row.reorder_point);
        return (
          <span style={{ color: isRisky ? '#cf1322' : undefined, fontWeight: isRisky ? 700 : undefined }}>
            {formatQty(numericValue)}
          </span>
        );
      },
    },
    {
      title: 'Nhu cau/thang',
      dataIndex: 'avg_monthly_demand',
      width: 140,
      align: 'right',
      render: (value) => formatQty(toNumber(value)),
    },
    {
      title: 'Diem dat hang',
      dataIndex: 'reorder_point',
      width: 140,
      align: 'right',
      render: (value) => formatQty(toNumber(value)),
    },
    {
      title: 'De xuat mua',
      dataIndex: 'suggested_qty',
      width: 130,
      align: 'right',
      render: (value) => <strong>{formatQty(toNumber(value))}</strong>,
    },
    {
      title: 'Chi phi du kien',
      dataIndex: 'estimated_cost',
      width: 160,
      align: 'right',
      render: (value) => formatMoney(toNumber(value)),
    },
    {
      title: 'Muc do',
      dataIndex: 'urgency',
      width: 120,
      render: (value) => <Tag color={urgencyColorMap[value] || 'default'}>{urgencyLabelMap[value] || value}</Tag>,
    },
    {
      title: 'Tac vu',
      key: 'actions',
      width: 130,
      render: (_, row) => (
        <Button size="small" type="link" onClick={() => openCreateModal([row])}>
          Tao nhanh
        </Button>
      ),
    },
  ];

  return (
    <div className="command-center">
      {contextHolder}

      <section className="command-center-hero">
        <div className="command-center-hero-grid">
          <div>
            <div className="command-center-eyebrow">Purchasing command center · Forecast · Replenishment</div>
            <div className="command-center-title">Trung tam du bao don mua</div>
            <div className="command-center-description">
              Gom du lieu forecast, muc ton thuc te va muc do gap vao mot workspace duy nhat de doi mua hang chot PO nhanh va co can cu hon.
            </div>

            <div className="command-center-hero-badges">
              <div className="command-center-hero-badge">
                <ThunderboltOutlined />
                <span>Dong gap</span>
                <span className="command-center-hero-badge-value">{summary.highUrgencyCount}</span>
              </div>
              <div className="command-center-hero-badge">
                <ShoppingOutlined />
                <span>Khoi luong de xuat</span>
                <span className="command-center-hero-badge-value">{formatQty(summary.totalSuggestedQty)}</span>
              </div>
              <div className="command-center-hero-badge">
                <WalletOutlined />
                <span>Gia tri forecast</span>
                <span className="command-center-hero-badge-value">{formatMoney(summary.totalEstimate)}</span>
              </div>
            </div>

            <div className="command-center-hero-actions">
              <div data-testid="purchase-order-forecast-months">
                <Select value={months} onChange={setMonths} options={monthOptions} style={{ width: 140 }} />
              </div>
              <div data-testid="purchase-order-forecast-lead-time">
                <Select value={leadTime} onChange={setLeadTime} options={leadTimeOptions} style={{ width: 140 }} />
              </div>
              <Button
                icon={<DownloadOutlined />}
                onClick={() => downloadCSV(displayData, `purchase-forecast-${dayjs().format('YYYYMMDD')}`)}
              >
                Xuat du bao CSV
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={selectedRows.length === 0}
                onClick={() => openCreateModal(selectedRows)}
              >
                Tao PO tu {selectedRows.length} dong da chon
              </Button>
            </div>
          </div>

          <div className="command-center-hero-meta">
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Gia tri dang chon de tao PO</div>
              <div className="command-center-hero-card-value">{formatMoney(summary.selectedEstimate)}</div>
              <div className="command-center-hero-card-caption">
                {selectedRows.length > 0
                  ? `${selectedRows.length} dong dang duoc gom cho lan tao PO tiep theo.`
                  : 'Chon mot hoac nhieu dong trong bang duoi de mo lane tao PO nhanh.'}
              </div>
            </div>
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Dong can theo doi sat</div>
              <div className="command-center-hero-card-value">{summary.mediumUrgencyCount}</div>
              <div className="command-center-hero-card-caption">
                So dong medium urgency nen duoc xep lich mua trong ky dang xem.
              </div>
            </div>
          </div>
        </div>
      </section>

      <div
        className={`command-center-finance-alert ${
          workspaceAlert.type === 'success' ? 'command-center-finance-alert--steady' : 'command-center-finance-alert--warning'
        }`}
      >
        <div>
          <div className="command-center-finance-alert-title">{workspaceAlert.title}</div>
          <div className="command-center-finance-alert-description">{workspaceAlert.description}</div>
        </div>
        <Space wrap>
          {activeContextTags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
          <Tag color="warning">{`Duoi reorder point: ${summary.belowReorderCount}`}</Tag>
        </Space>
      </div>

      <div className="workspace-toolbar" data-testid="purchase-order-forecast-command-strip">
        <div className="workspace-toolbar-group">
          <Button data-testid="purchase-order-forecast-save-view" onClick={() => void saveCurrentView()}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="purchase-order-forecast-restore-view" onClick={applySavedView}>
            Khôi phục
          </Button>
          <Button
            data-testid="purchase-order-forecast-open-preset-modal"
            onClick={() => {
              setViewPresetName(selectedViewPreset?.name ?? '');
              setIsViewPresetModalOpen(true);
            }}
          >
            Tạo mẫu lọc
          </Button>
          <div data-testid="purchase-order-forecast-preset-select">
            <Select
              style={{ width: 260 }}
              placeholder="Chọn mẫu lọc forecast"
              value={selectedViewPresetId}
              onChange={(value) => setSelectedViewPresetId(value)}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button data-testid="purchase-order-forecast-apply-preset" onClick={applyNamedPreset}>
            Áp dụng mẫu
          </Button>
          <Button danger data-testid="purchase-order-forecast-delete-preset" onClick={() => void deleteNamedPreset()}>
            Xóa mẫu
          </Button>
        </div>
        <div className="workspace-toolbar-group">
          <span className="workspace-inline-note">Lưu nhanh cấu hình chu kỳ và lead time để tái sử dụng trong các phiên rà forecast tiếp theo.</span>
        </div>
      </div>

      {forecastQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : (
        <>
          <div className="workspace-metric-grid">
            <div className="workspace-metric-card">
              <div className="workspace-metric-eyebrow">Tong gia tri forecast</div>
              <div className="workspace-metric-value">{formatMoney(summary.totalEstimate)}</div>
              <div className="workspace-metric-caption">Tong gia tri mua hang du kien cua toan bo bo forecast.</div>
            </div>
            <div className="workspace-metric-card workspace-metric-card--critical">
              <div className="workspace-metric-eyebrow">Dong can mua gap</div>
              <div className="workspace-metric-value">{summary.highUrgencyCount}</div>
              <div className="workspace-metric-caption">Nhom san pham can khoa nha cung cap va lich nhan som nhat.</div>
            </div>
            <div className="workspace-metric-card workspace-metric-card--warning">
              <div className="workspace-metric-eyebrow">Khoi luong de xuat</div>
              <div className="workspace-metric-value">{formatQty(summary.totalSuggestedQty)}</div>
              <div className="workspace-metric-caption">So luong duoc goi y gom mua trong ky dang xem.</div>
            </div>
            <div className="workspace-metric-card workspace-metric-card--steady">
              <div className="workspace-metric-eyebrow">Gia tri dang chon</div>
              <div className="workspace-metric-value">{formatMoney(summary.selectedEstimate)}</div>
              <div className="workspace-metric-caption">Gia tri tam tinh cua basket sap tao PO.</div>
            </div>
          </div>

          <div className="command-center-grid">
            <section className="command-center-panel">
              <div className="command-center-panel-header">
                <div>
                  <div className="command-center-panel-kicker">Priority lane</div>
                  <div className="command-center-panel-title">Danh muc uu tien mua</div>
                  <div className="command-center-panel-subtitle">
                    Tap hop cac dong co urgency cao nhat de chot nha cung cap va gia tam tinh truoc.
                  </div>
                </div>
              </div>

              <div className="command-center-watchlist">
                {priorityRows.length > 0 ? (
                  priorityRows.map((row) => (
                    <div
                      key={row.key}
                      className={`command-center-watch-item command-center-watch-item--${
                        row.urgency === 'HIGH' ? 'critical' : row.urgency === 'MEDIUM' ? 'warning' : 'steady'
                      }`}
                    >
                      <div className="command-center-watch-title">{`${row.product_code} · ${row.product_name}`}</div>
                      <div className="command-center-watch-detail">
                        Ton {formatQty(toNumber(row.current_stock))} / reorder {formatQty(toNumber(row.reorder_point))} / de xuat {formatQty(toNumber(row.suggested_qty))}
                      </div>
                      <div className="workspace-inline-note">
                        Chi phi du kien {formatMoney(toNumber(row.estimated_cost))} VND · muc do {urgencyLabelMap[row.urgency] || row.urgency}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="command-center-empty">Chua co dong forecast nao de dua vao lane uu tien.</div>
                )}
              </div>
            </section>

            <section className="command-center-panel">
              <div className="command-center-panel-header">
                <div>
                  <div className="command-center-panel-kicker">Execution lane</div>
                  <div className="command-center-panel-title">Basket tao PO</div>
                  <div className="command-center-panel-subtitle">
                    Vung nay cho biet basket dang chon da du lon de mo mot PO hop ly hay chua.
                  </div>
                </div>
              </div>

              {selectedRows.length > 0 ? (
                <div className="command-center-shortcuts">
                  <button className="command-center-shortcut" type="button" onClick={() => openCreateModal(selectedRows)}>
                    <div className="command-center-shortcut-meta">
                      <div className="command-center-shortcut-title">Mo lane tao PO tu basket hien tai</div>
                      <div className="command-center-shortcut-badge">{selectedRows.length}</div>
                    </div>
                    <div className="command-center-shortcut-description">
                      Gia tri tam tinh {formatMoney(summary.selectedEstimate)} VND, trong do co {summary.selectedUrgentCount} dong gap.
                    </div>
                  </button>
                  {selectedRows.slice(0, 3).map((row) => (
                    <div key={row.key} className="command-center-watch-item">
                      <div className="command-center-watch-title">{`${row.product_code} · ${formatQty(toNumber(row.suggested_qty))}`}</div>
                      <div className="command-center-watch-detail">{row.product_name}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="command-center-playbook">
                  <div className="command-center-playbook-item">
                    <div className="command-center-playbook-title">1. Chon nhom gap truoc</div>
                    <div className="command-center-playbook-detail">
                      Bat dau voi dong HIGH urgency de khoa lead time va tran nguy co dut nguon.
                    </div>
                  </div>
                  <div className="command-center-playbook-item">
                    <div className="command-center-playbook-title">2. Gom theo nha cung cap</div>
                    <div className="command-center-playbook-detail">
                      Sau khi co basket hop ly, mo modal tao PO va chot kho nhap, vi tri, dieu khoan thanh toan.
                    </div>
                  </div>
                  <div className="command-center-playbook-item">
                    <div className="command-center-playbook-title">3. Xuat forecast neu can doi chieu</div>
                    <div className="command-center-playbook-detail">
                      Dung CSV de doi soat voi nha cung cap hoac planning truoc khi tao lo PO lon.
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          <section className="command-center-panel">
            <div className="command-center-panel-header">
              <div>
                <div className="command-center-panel-kicker">Forecast table</div>
                <div className="command-center-panel-title">Danh sach goi y mua</div>
                <div className="command-center-panel-subtitle">
                  Chon nhieu dong de tao PO nhanh, hoac tao tung dong ngay tu bang nay.
                </div>
              </div>
            </div>

            <Table
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as number[]),
              }}
              columns={columns}
              dataSource={displayData}
              pagination={false}
              rowKey="key"
              scroll={{ x: 1200 }}
              locale={{ emptyText: 'Khong co du lieu forecast mua hang.' }}
            />
          </section>
        </>
      )}

      <Modal
        title="Lưu mẫu lọc forecast mua hàng"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Đóng"
      >
        <Form layout="vertical">
          <Form.Item label="Tên mẫu lọc">
            <Input
              data-testid="purchase-order-forecast-preset-name"
              value={viewPresetName}
              onChange={(event) => setViewPresetName(event.target.value)}
              placeholder="Ví dụ: Forecast 6 tháng - lead time 21 ngày"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Tao don mua tu forecast"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={onSubmitCreate}
        width={980}
        confirmLoading={createMutation.isPending}
        okText="Tao don mua"
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            showIcon
            type="info"
            message={`Dang chuan bi ${formItems.length} dong cho don mua moi`}
            description={`Ngay nhan du kien dang duoc de xuat theo lead time ${leadTime} ngay. Ban co the tinh chinh kho nhap, vi tri va dieu khoan thanh toan truoc khi xac nhan.`}
          />

          <Form form={form} layout="vertical">
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="supplier"
                  label="Nha cung cap"
                  rules={[{ required: true, message: 'Vui long chon nha cung cap' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={supplierOptions}
                    onChange={(value) => {
                      const supplier = supplierQuery.data?.results?.find((item) => item.id === value);
                      if (supplier) {
                        form.setFieldValue('payment_terms_days', supplier.payment_terms_days);
                      }
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name="order_date"
                  label="Ngay don"
                  rules={[{ required: true, message: 'Vui long chon ngay don' }]}
                >
                  <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name="expected_receipt_date"
                  label="Ngay du kien nhap"
                  rules={[{ required: true, message: 'Vui long chon ngay nhap' }]}
                >
                  <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="warehouse" label="Kho mac dinh">
                  <Select allowClear options={warehouseOptions} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="location" label="Vi tri nhap">
                  <Select allowClear options={filteredLocationOptions} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="payment_terms_days" label="Han thanh toan (ngay)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={12}>
              <Col span={10}>
                <Form.Item name="reference" label="Tham chieu">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={14}>
                <Form.Item name="notes" label="Ghi chu">
                  <Input />
                </Form.Item>
              </Col>
            </Row>

            <div style={{ marginBottom: 12, fontWeight: 700 }}>Dong hang duoc tao</div>
            <Form.List name="items">
              {(fields) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {fields.map((field) => {
                    const urgency = form.getFieldValue(['items', field.name, 'urgency']) as
                      | ForecastFormValues['items'][number]['urgency']
                      | undefined;
                    return (
                      <Card key={field.key} size="small">
                        <Row gutter={12} align="middle">
                          <Col span={7}>
                            <Form.Item name={[field.name, 'product_code']} label="Ma SP" style={{ marginBottom: 8 }}>
                              <Input disabled />
                            </Form.Item>
                            <Form.Item name={[field.name, 'product_name']} label="Ten SP" style={{ marginBottom: 0 }}>
                              <Input disabled />
                            </Form.Item>
                            <Form.Item name={[field.name, 'product_id']} hidden>
                              <InputNumber />
                            </Form.Item>
                            <Form.Item name={[field.name, 'urgency']} hidden>
                              <Input />
                            </Form.Item>
                          </Col>
                          <Col span={4}>
                            <Form.Item
                              name={[field.name, 'qty']}
                              label="So luong"
                              rules={[{ required: true, message: 'Nhap so luong' }]}
                              style={{ marginBottom: 0 }}
                            >
                              <InputNumber min={0.0001} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={4}>
                            <Form.Item name={[field.name, 'unit_price']} label="Don gia" style={{ marginBottom: 0 }}>
                              <InputNumber min={0} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={6}>
                            <Form.Item name={[field.name, 'note']} label="Ghi chu dong" style={{ marginBottom: 0 }}>
                              <Input />
                            </Form.Item>
                          </Col>
                          <Col span={3}>
                            <div style={{ paddingTop: 30 }}>
                              <Tag color={urgencyColorMap[urgency || 'LOW'] || 'default'}>
                                {urgencyLabelMap[urgency || 'LOW']}
                              </Tag>
                            </div>
                          </Col>
                        </Row>
                      </Card>
                    );
                  })}
                </div>
              )}
            </Form.List>
          </Form>
        </Space>
      </Modal>
    </div>
  );
}
