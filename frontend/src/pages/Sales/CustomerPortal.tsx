import { type ReactNode, useMemo, useState } from 'react';
import {
  Button,
  Descriptions,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ClockCircleOutlined,
  CreditCardOutlined,
  DollarOutlined,
  DownloadOutlined,
  EyeOutlined,
  ShoppingCartOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { accountsReceivableApi } from '../../api/accountsReceivable';
import { customersApi } from '../../api/customers';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { salesApi } from '../../api/sales';
import { getToastMessage } from '../../shared/apiError';
import type { ReceivableDocument, ReceivablePayment } from '../../types/accountsReceivable';
import type { Customer } from '../../types/customer';
import type { SalesOrder, SalesOrderLine } from '../../types/sales';
import { PAGES } from '../../utils/constants';
import { downloadCSV } from '../../utils/csvExport';

type PaymentRow = ReceivablePayment & {
  invoice_code: string;
};

type Tone = 'critical' | 'warning' | 'steady';

type SignalCard = {
  key: string;
  title: string;
  value: string;
  detail: string;
  tone: Tone;
  icon: ReactNode;
};

type CustomerPortalViewSnapshot = {
  customerId: number | null;
};

type CustomerPortalNamedPreset = {
  id: string;
  name: string;
  snapshot: CustomerPortalViewSnapshot;
  updatedAt: string;
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Nhap',
  SUBMITTED: 'Cho duyet',
  APPROVED: 'Da duyet',
  REJECTED: 'Tu choi',
  POSTED: 'Da ghi so',
  VOID: 'Da huy',
};

const ORDER_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'blue',
  REJECTED: 'error',
  POSTED: 'success',
  VOID: 'warning',
};

const INVOICE_STATUS_LABELS: Record<string, string> = {
  POSTED: 'Dang theo doi',
  PARTIAL_PAID: 'Thanh toan mot phan',
  PAID: 'Da thanh toan',
  OVERDUE: 'Qua han',
  CANCELLED: 'Da huy',
  WRITTEN_OFF: 'Da xoa no',
};

const INVOICE_STATUS_COLORS: Record<string, string> = {
  POSTED: 'processing',
  PARTIAL_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'error',
  CANCELLED: 'default',
  WRITTEN_OFF: 'default',
};

function formatMoney(value?: number | string | null): string {
  return Number(value ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export default function CustomerPortal() {
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const { config, saveConfig } = useUserPreferences(PAGES.SALES_CUSTOMER_PORTAL);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const namedPresets = useMemo<CustomerPortalNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<CustomerPortalNamedPreset>;
        if (
          typeof preset.id !== 'string' ||
          typeof preset.name !== 'string' ||
          !preset.snapshot ||
          !('customerId' in preset.snapshot)
        ) {
          return null;
        }
        return {
          id: preset.id,
          name: preset.name,
          snapshot: {
            customerId:
              typeof preset.snapshot.customerId === 'number' || preset.snapshot.customerId === null
                ? preset.snapshot.customerId
                : null,
          },
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is CustomerPortalNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );

  const customersQuery = useQuery({
    queryKey: ['customer-portal-customers'],
    queryFn: () => customersApi.getCustomers({ page_size: 200, is_active: true }),
  });

  const customerOptions = useMemo(() => customersQuery.data?.results ?? [], [customersQuery.data?.results]);

  const activeCustomerId = useMemo(() => {
    if (customerOptions.length === 0) {
      return null;
    }
    if (selectedCustomerId && customerOptions.some((item) => item.id === selectedCustomerId)) {
      return selectedCustomerId;
    }
    return customerOptions[0].id;
  }, [customerOptions, selectedCustomerId]);

  const selectedCustomer = useMemo<Customer | null>(
    () => customerOptions.find((item) => item.id === activeCustomerId) ?? null,
    [activeCustomerId, customerOptions],
  );

  const ordersQuery = useQuery({
    queryKey: ['customer-portal-orders', activeCustomerId],
    queryFn: () => salesApi.getOrders({ customer: activeCustomerId, page_size: 100, ordering: '-order_date' }),
    enabled: activeCustomerId !== null,
  });

  const receivablesQuery = useQuery({
    queryKey: ['customer-portal-receivables', activeCustomerId],
    queryFn: () => accountsReceivableApi.getReceivables({ customer_id: activeCustomerId, page_size: 100 }),
    enabled: activeCustomerId !== null,
  });

  const orders = useMemo(() => ordersQuery.data?.results ?? [], [ordersQuery.data?.results]);
  const receivables = useMemo(() => receivablesQuery.data?.results ?? [], [receivablesQuery.data?.results]);
  const activeContextTags = useMemo(() => {
    const tags: string[] = [];
    if (selectedCustomer) {
      tags.push(`Khách hàng: ${selectedCustomer.code}`);
    }
    if (selectedViewPreset) {
      tags.push(`Mẫu lọc: ${selectedViewPreset.name}`);
    }
    tags.push(`Đơn hàng: ${orders.length}`);
    tags.push(`Hóa đơn: ${receivables.length}`);
    return tags;
  }, [orders.length, receivables.length, selectedCustomer, selectedViewPreset]);

  const payments = useMemo<PaymentRow[]>(
    () =>
      receivables
        .flatMap((invoice) =>
          (invoice.payments ?? []).map((payment) => ({
            ...payment,
            invoice_code: invoice.code,
          })),
        )
        .sort((left, right) => dayjs(right.settlement_date).valueOf() - dayjs(left.settlement_date).valueOf()),
    [receivables],
  );

  const summary = useMemo(() => {
    const totalOrderValue = orders.reduce((sum, order) => sum + Number(order.total ?? 0), 0);
    const totalOutstanding = receivables.reduce((sum, invoice) => sum + Number(invoice.outstanding_amount ?? 0), 0);
    const totalPaid = receivables.reduce((sum, invoice) => sum + Number(invoice.paid_amount ?? 0), 0);
    const overdue = receivables.filter(
      (invoice) => invoice.status === 'OVERDUE' || Number(invoice.days_overdue ?? 0) > 0,
    );
    const creditLimit = Number(selectedCustomer?.credit_limit ?? 0);
    const creditUsage = creditLimit > 0 ? (totalOutstanding / creditLimit) * 100 : 0;
    const collectionRate = totalPaid + totalOutstanding > 0 ? (totalPaid / (totalPaid + totalOutstanding)) * 100 : 0;
    return {
      totalOrderValue,
      totalOutstanding,
      totalPaid,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((sum, invoice) => sum + Number(invoice.outstanding_amount ?? 0), 0),
      creditLimit,
      creditUsage,
      collectionRate,
      openOrders: orders.filter((order) => ['SUBMITTED', 'APPROVED', 'POSTED'].includes(order.status)).length,
    };
  }, [orders, receivables, selectedCustomer?.credit_limit]);

  const signals = useMemo<SignalCard[]>(
    () => [
      {
        key: 'overdue',
        title: 'Hoa don can xu ly',
        value: `${summary.overdueCount}`,
        detail:
          summary.overdueCount > 0
            ? `${formatMoney(summary.overdueAmount)} VND dang qua han.`
            : 'Khong co hoa don qua han tren bo loc hien tai.',
        tone: summary.overdueCount > 0 ? 'critical' : 'steady',
        icon: <ClockCircleOutlined />,
      },
      {
        key: 'credit',
        title: 'Bien tin dung',
        value: formatPercent(summary.creditUsage),
        detail:
          summary.creditLimit > 0
            ? `${formatMoney(Math.max(summary.creditLimit - summary.totalOutstanding, 0))} VND con kha dung.`
            : 'Khach hang chua co han muc tin dung.',
        tone: summary.creditUsage >= 85 ? 'critical' : summary.creditUsage >= 60 ? 'warning' : 'steady',
        icon: <CreditCardOutlined />,
      },
      {
        key: 'cash',
        title: 'Nhip thu tien',
        value: formatPercent(summary.collectionRate),
        detail:
          payments.length > 0
            ? `Thanh toan gan nhat ngay ${dayjs(payments[0].settlement_date).format('DD/MM/YYYY')}.`
            : 'Chua co lich su thu tien tren bo du lieu hien tai.',
        tone: summary.collectionRate >= 75 ? 'steady' : summary.collectionRate >= 45 ? 'warning' : 'critical',
        icon: <WalletOutlined />,
      },
    ],
    [
      payments,
      summary.collectionRate,
      summary.creditLimit,
      summary.creditUsage,
      summary.overdueAmount,
      summary.overdueCount,
      summary.totalOutstanding,
    ],
  );

  const watchlist = useMemo(
    () =>
      [...receivables]
        .filter((invoice) => Number(invoice.outstanding_amount ?? 0) > 0)
        .sort((left, right) => Number(right.outstanding_amount ?? 0) - Number(left.outstanding_amount ?? 0))
        .slice(0, 4),
    [receivables],
  );

  async function handleDownloadInvoicePdf(salesOrderId?: number | null, code?: string) {
    if (!salesOrderId) {
      messageApi.warning('Hoa don nay khong co lien ket don ban de tai PDF');
      return;
    }
    try {
      const blob = await salesApi.downloadInvoicePdf(salesOrderId);
      downloadBlob(blob, `${code || `invoice-${salesOrderId}`}.pdf`);
    } catch (error) {
      messageApi.error(getToastMessage(error, 'Tai PDF that bai'));
    }
  }

  function exportOrders() {
    if (orders.length === 0) {
      messageApi.warning('Khong co don hang de xuat');
      return;
    }
    downloadCSV(orders, 'customer-portal-orders');
  }

  function exportInvoices() {
    if (receivables.length === 0) {
      messageApi.warning('Khong co hoa don de xuat');
      return;
    }
    downloadCSV(receivables, 'customer-portal-invoices');
  }

  function exportPayments() {
    if (payments.length === 0) {
      messageApi.warning('Khong co lich su thanh toan de xuat');
      return;
    }
    downloadCSV(payments, 'customer-portal-payments');
  }

  const buildCurrentSnapshot = (): CustomerPortalViewSnapshot => ({
    customerId: activeCustomerId,
  });

  const applySnapshot = (snapshot: CustomerPortalViewSnapshot) => {
    setSelectedCustomerId(snapshot.customerId);
  };

  async function saveCurrentView() {
    try {
      await saveConfig({
        ...configRecord,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem cổng khách hàng.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem cổng khách hàng.');
    }
  }

  function applySavedView() {
    const raw = configRecord.saved_view as Partial<CustomerPortalViewSnapshot> | undefined;
    if (!raw || (!('customerId' in raw))) {
      messageApi.warning('Chưa có chế độ xem cổng khách hàng đã lưu.');
      return;
    }
    applySnapshot({
      customerId: typeof raw.customerId === 'number' || raw.customerId === null ? raw.customerId : null,
    });
    messageApi.success('Đã khôi phục chế độ xem cổng khách hàng.');
  }

  async function saveNamedPreset() {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: CustomerPortalNamedPreset = {
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc cổng khách hàng.' : 'Đã lưu mẫu lọc cổng khách hàng mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc cổng khách hàng.');
    }
  }

  function applyNamedPreset() {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc cổng khách hàng.');
      return;
    }
    applySnapshot(preset.snapshot);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  }

  async function deleteNamedPreset() {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc cổng khách hàng để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc cổng khách hàng.');
    }
  }

  const orderColumns: ColumnsType<SalesOrder> = [
    { title: 'Ma don', dataIndex: 'code', key: 'code', width: 140 },
    { title: 'Ngay dat', dataIndex: 'order_date', key: 'order_date', width: 120, render: (value: string) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Tong tien', dataIndex: 'total', key: 'total', width: 140, align: 'right', render: (value: string) => formatMoney(value) },
    { title: 'Trang thai', dataIndex: 'status', key: 'status', width: 140, render: (value: string) => <Tag color={ORDER_STATUS_COLORS[value] || 'default'}>{ORDER_STATUS_LABELS[value] || value}</Tag> },
    { title: 'Xem', key: 'actions', width: 120, render: (_value, row) => <Button size="small" icon={<EyeOutlined />} onClick={() => setSelectedOrder(row)}>Chi tiet</Button> },
  ];

  const invoiceColumns: ColumnsType<ReceivableDocument> = [
    { title: 'Ma hoa don', dataIndex: 'code', key: 'code', width: 150 },
    { title: 'Han TT', dataIndex: 'due_date', key: 'due_date', width: 120, render: (value: string) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Con lai', dataIndex: 'outstanding_amount', key: 'outstanding_amount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    { title: 'Trang thai', dataIndex: 'status', key: 'status', width: 160, render: (value: ReceivableDocument['status']) => <Tag color={INVOICE_STATUS_COLORS[value] || 'default'}>{INVOICE_STATUS_LABELS[value] || value}</Tag> },
    { title: 'PDF', key: 'pdf', width: 110, render: (_value, row) => <Button size="small" icon={<DownloadOutlined />} onClick={() => void handleDownloadInvoicePdf(row.sales_order, row.code)}>Tai PDF</Button> },
  ];

  const paymentColumns: ColumnsType<PaymentRow> = [
    { title: 'Ngay', dataIndex: 'settlement_date', key: 'settlement_date', width: 120, render: (value: string) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Hoa don', dataIndex: 'invoice_code', key: 'invoice_code', width: 150 },
    { title: 'So tien', dataIndex: 'amount', key: 'amount', width: 130, align: 'right', render: (value: number) => formatMoney(value) },
    { title: 'Phuong thuc', dataIndex: 'payment_method', key: 'payment_method', width: 160 },
  ];

  const lineColumns: ColumnsType<SalesOrderLine> = [
    { title: 'Dong', dataIndex: 'line_number', key: 'line_number', width: 80, align: 'right' },
    { title: 'San pham', dataIndex: 'product_name', key: 'product_name', width: 220, render: (_value: string | undefined, row) => row.product_name || row.product_code || row.product_name_snapshot || '-' },
    { title: 'So luong', dataIndex: 'qty', key: 'qty', width: 120, align: 'right', render: (value: string) => formatMoney(value) },
    { title: 'Thanh tien', dataIndex: 'line_total', key: 'line_total', width: 140, align: 'right', render: (value: string | undefined) => formatMoney(value) },
  ];

  const loading = customersQuery.isLoading || (activeCustomerId !== null && (ordersQuery.isLoading || receivablesQuery.isLoading));

  return (
    <div className="command-center">
      {contextHolder}
      <section className="command-center-hero">
        <div className="command-center-hero-grid">
          <div>
            <div className="command-center-eyebrow">Sales desk · Receivables · Customer view</div>
            <div className="command-center-title">Ban dieu phoi khach hang</div>
            <div className="command-center-description">
              Mot workspace de doi sales va thu tien nhin chung duoc don hang, cong no, han muc va nhip thanh toan cua tung khach hang.
            </div>
            <div className="command-center-hero-badges">
              <div className="command-center-hero-badge"><UserOutlined /> Khach hang <span className="command-center-hero-badge-value">{selectedCustomer?.code ?? `${customerOptions.length}`}</span></div>
              <div className="command-center-hero-badge"><ShoppingCartOutlined /> Don dang mo <span className="command-center-hero-badge-value">{summary.openOrders}</span></div>
              <div className="command-center-hero-badge"><ClockCircleOutlined /> Qua han <span className="command-center-hero-badge-value">{summary.overdueCount}</span></div>
            </div>
            <div className="command-center-hero-actions" data-testid="customer-portal-command-strip">
              <div data-testid="customer-portal-customer-select">
                <Select
                  showSearch
                  style={{ minWidth: 280, flex: '1 1 320px' }}
                  placeholder="Chon khach hang dieu hanh"
                  value={activeCustomerId ?? undefined}
                  optionFilterProp="label"
                  options={customerOptions.map((customer) => ({ value: customer.id, label: `${customer.code} - ${customer.company_name || customer.name}` }))}
                  onChange={(value) => setSelectedCustomerId(value)}
                />
              </div>
              <Button icon={<DownloadOutlined />} onClick={exportOrders}>Xuat don</Button>
              <Button icon={<DownloadOutlined />} onClick={exportInvoices}>Xuat hoa don</Button>
              <Button type="primary" icon={<DownloadOutlined />} onClick={exportPayments}>Xuat thu tien</Button>
            </div>
          </div>
          <div className="command-center-hero-meta">
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Cong no con lai</div>
              <div className="command-center-hero-card-value">{formatMoney(summary.totalOutstanding)}</div>
              <div className="command-center-hero-card-caption">
                {selectedCustomer ? `${selectedCustomer.company_name || selectedCustomer.name} dang co ${receivables.length} hoa don can theo doi.` : 'Chon mot khach hang de xem toan bo luong giao dich.'}
              </div>
            </div>
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Nhip thu tien</div>
              <div className="command-center-hero-card-value">{formatPercent(summary.collectionRate)}</div>
              <div className="command-center-hero-card-caption">Ty le da thu tren tong phai thu cua khach hang dang xem.</div>
            </div>
          </div>
        </div>
      </section>

      <div className="workspace-toolbar">
        <div className="workspace-toolbar-group">
          <Button data-testid="customer-portal-save-view" onClick={() => void saveCurrentView()}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="customer-portal-restore-view" onClick={applySavedView}>
            Khôi phục
          </Button>
          <Button
            data-testid="customer-portal-open-preset-modal"
            onClick={() => {
              setViewPresetName(selectedViewPreset?.name ?? '');
              setIsViewPresetModalOpen(true);
            }}
          >
            Tạo mẫu lọc
          </Button>
          <div data-testid="customer-portal-preset-select">
            <Select
              style={{ width: 260 }}
              placeholder="Chọn mẫu lọc khách hàng"
              value={selectedViewPresetId}
              onChange={(value) => setSelectedViewPresetId(value)}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button data-testid="customer-portal-apply-preset" onClick={applyNamedPreset}>
            Áp dụng mẫu
          </Button>
          <Button danger data-testid="customer-portal-delete-preset" onClick={() => void deleteNamedPreset()}>
            Xóa mẫu
          </Button>
        </div>
        <div className="workspace-toolbar-group">
          {activeContextTags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 12 }} />
      ) : (
        <>
          <div className="workspace-metric-grid">
            <div className="workspace-metric-card"><div className="workspace-metric-eyebrow">Tong don</div><div className="workspace-metric-value">{orders.length}</div><div className="workspace-metric-caption">So don tren bo du lieu hien tai.</div></div>
            <div className="workspace-metric-card"><div className="workspace-metric-eyebrow">Gia tri don</div><div className="workspace-metric-value">{formatMoney(summary.totalOrderValue)}</div><div className="workspace-metric-caption">Tong gia tri don hang dang theo doi.</div></div>
            <div className="workspace-metric-card workspace-metric-card--warning"><div className="workspace-metric-eyebrow">Cong no</div><div className="workspace-metric-value">{formatMoney(summary.totalOutstanding)}</div><div className="workspace-metric-caption">So du can tiep tuc thu hoi.</div></div>
            <div className="workspace-metric-card workspace-metric-card--critical"><div className="workspace-metric-eyebrow">Qua han</div><div className="workspace-metric-value">{summary.overdueCount}</div><div className="workspace-metric-caption">Hoa don can uu tien follow-up.</div></div>
          </div>

          <div className="command-center-grid">
            <section className="command-center-panel">
              <div className="command-center-panel-header">
                <div>
                  <div className="command-center-panel-kicker">Customer profile</div>
                  <div className="command-center-panel-title">Khach hang dang theo doi</div>
                  <div className="command-center-panel-subtitle">Lien he, han muc va watchlist cong no duoc gom tai mot cho.</div>
                </div>
              </div>
              {selectedCustomer ? (
                <div className="command-center-stack">
                  <Descriptions bordered size="small" column={2} items={[
                    { key: 'customer', label: 'Khach hang', children: selectedCustomer.company_name || selectedCustomer.name },
                    { key: 'code', label: 'Ma', children: selectedCustomer.code },
                    { key: 'contact', label: 'Lien he', children: selectedCustomer.contact_person || selectedCustomer.name || '-' },
                    { key: 'phone', label: 'Dien thoai', children: selectedCustomer.phone || selectedCustomer.email || '-' },
                    { key: 'terms', label: 'Dieu khoan TT', children: `${selectedCustomer.payment_terms || 0} ngay` },
                    { key: 'credit', label: 'Han muc', children: `${formatMoney(selectedCustomer.credit_limit)} VND` },
                  ]} />
                  <div className="command-center-watchlist">
                    {watchlist.length > 0 ? watchlist.map((invoice) => (
                      <div key={invoice.code} className={`command-center-watch-item command-center-watch-item--${Number(invoice.days_overdue ?? 0) > 0 ? 'critical' : 'warning'}`}>
                        <div className="command-center-watch-title">{invoice.code} · {formatMoney(invoice.outstanding_amount)} VND</div>
                        <div className="command-center-watch-detail">Han {dayjs(invoice.due_date).format('DD/MM/YYYY')} · {INVOICE_STATUS_LABELS[invoice.status] || invoice.status}</div>
                      </div>
                    )) : <div className="command-center-empty">Chua co watchlist cong no.</div>}
                  </div>
                </div>
              ) : <div className="command-center-empty">Chua co khach hang de hien thi.</div>}
            </section>

            <section className="command-center-panel">
              <div className="command-center-panel-header">
                <div>
                  <div className="command-center-panel-kicker">Priority signals</div>
                  <div className="command-center-panel-title">Bo tin hieu uu tien</div>
                  <div className="command-center-panel-subtitle">Nhung diem nong can ra quyet dinh nhanh cho sales va ke toan.</div>
                </div>
              </div>
              <div className="command-center-signal-grid">
                {signals.map((signal) => (
                  <div key={signal.key} className={`command-center-signal-card command-center-signal-card--${signal.tone}`}>
                    <div className="command-center-card-head">
                      <div className="command-center-card-icon">{signal.icon}</div>
                      <div className={`command-center-card-tone command-center-card-tone--${signal.tone}`}>{signal.tone === 'critical' ? 'Uu tien cao' : signal.tone === 'warning' ? 'Theo doi' : 'On dinh'}</div>
                    </div>
                    <div className="command-center-card-value">{signal.value}</div>
                    <div className="command-center-card-title">{signal.title}</div>
                    <div className="command-center-card-detail">{signal.detail}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="command-center-panel">
            <div className="command-center-panel-header">
              <div>
                <div className="command-center-panel-kicker">Commercial ledger</div>
                <div className="command-center-panel-title">Luong giao dich</div>
                <div className="command-center-panel-subtitle">Truy cap nhanh don hang, hoa don va lich su thu tien ngay trong mot workspace.</div>
              </div>
            </div>
            <Tabs items={[
              { key: 'orders', label: `Don hang (${orders.length})`, children: <Table columns={orderColumns} dataSource={orders} rowKey="id" scroll={{ x: 780 }} pagination={{ pageSize: 8 }} locale={{ emptyText: <Empty description="Khong co don hang" /> }} /> },
              { key: 'invoices', label: `Hoa don (${receivables.length})`, children: <Table columns={invoiceColumns} dataSource={receivables} rowKey="code" scroll={{ x: 760 }} pagination={{ pageSize: 8 }} locale={{ emptyText: <Empty description="Khong co hoa don" /> }} /> },
              { key: 'payments', label: `Thu tien (${payments.length})`, children: <Table columns={paymentColumns} dataSource={payments} rowKey={(row) => `${row.invoice_code}-${row.settlement_date}-${row.amount}`} scroll={{ x: 700 }} pagination={{ pageSize: 8 }} locale={{ emptyText: <Empty description="Khong co lich su thanh toan" /> }} /> },
            ]} />
          </section>
        </>
      )}

      <Modal
        title="Lưu mẫu lọc cổng khách hàng"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Đóng"
      >
        <Descriptions
          bordered
          size="small"
          column={1}
          items={[
            {
              key: 'customer',
              label: 'Khách hàng hiện tại',
              children: selectedCustomer ? `${selectedCustomer.code} - ${selectedCustomer.company_name || selectedCustomer.name}` : 'Chưa chọn',
            },
          ]}
        />
        <div style={{ marginTop: 16 }}>
          <Input
            data-testid="customer-portal-preset-name"
            value={viewPresetName}
            onChange={(event) => setViewPresetName(event.target.value)}
            placeholder="Ví dụ: Khách VIP miền Nam"
          />
        </div>
      </Modal>

      <Modal title={selectedOrder ? `Chi tiet ${selectedOrder.code}` : 'Chi tiet don hang'} open={Boolean(selectedOrder)} onCancel={() => setSelectedOrder(null)} footer={null} width={920}>
        {selectedOrder ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="workspace-metric-grid">
              <CardMetric title="Ngay dat" value={dayjs(selectedOrder.order_date).format('DD/MM/YYYY')} icon={<ShoppingCartOutlined />} />
              <CardMetric title="Tong tien" value={`${formatMoney(selectedOrder.total)} VND`} icon={<DollarOutlined />} />
              <CardMetric title="Trang thai" value={ORDER_STATUS_LABELS[selectedOrder.status] || selectedOrder.status} icon={<ClockCircleOutlined />} />
            </div>
            <Table columns={lineColumns} dataSource={selectedOrder.lines || []} rowKey={(row) => String(row.id ?? row.line_number)} pagination={false} scroll={{ x: 680 }} locale={{ emptyText: <Empty description="Khong co dong hang" /> }} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function CardMetric({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return (
    <div className="workspace-metric-card">
      <Space size="small">
        {icon}
        <span className="workspace-metric-eyebrow">{title}</span>
      </Space>
      <div className="workspace-metric-value" style={{ fontSize: 24 }}>{value}</div>
    </div>
  );
}
