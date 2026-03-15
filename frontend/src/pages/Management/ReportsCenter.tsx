import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Col, DatePicker, Empty, Row, Space, Statistic, Table, Tabs, Tag } from 'antd';
import type { TabsProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { financeApi } from '../../api/finance';
import { inventoryApi } from '../../api/inventory';
import { productionApi } from '../../api/production';
import { purchasingApi } from '../../api/purchasing';
import { salesApi } from '../../api/sales';
import type { InventoryStockRow } from '../../types/inventory';
import type { PayableDocument, ReceivableDocument } from '../../types/finance';
import type { ProductionOrder } from '../../types/production';
import type { PurchaseOrder } from '../../types/purchasing';
import type { SalesOrder } from '../../types/sales';
import {
  canAccessSalesOrders,
  canManageFinanceData,
  canManageInventoryData,
  canManageProductionData,
  canManagePurchasingData,
} from '../../utils/authz';
import { PAGES } from '../../utils/constants';
import { useUserPreferences } from '../../hooks/useUserPreferences';


function formatMoney(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return `${Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0'} đ`;
}


function formatNumber(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0';
}


function statusTag(status: string): ReactNode {
  const palette: Record<string, { color: string; label: string }> = {
    DRAFT: { color: 'default', label: 'Nháp' },
    SUBMITTED: { color: 'processing', label: 'Chờ duyệt' },
    APPROVED: { color: 'success', label: 'Đã duyệt' },
    REJECTED: { color: 'error', label: 'Từ chối' },
    POSTED: { color: 'cyan', label: 'Đã post' },
    VOID: { color: 'default', label: 'Đã hủy' },
    PARTIAL_RECEIVED: { color: 'warning', label: 'Nhận một phần' },
    RECEIVED: { color: 'success', label: 'Nhận đủ' },
    RELEASED: { color: 'cyan', label: 'Đã phát lệnh' },
    IN_PROGRESS: { color: 'processing', label: 'Đang làm' },
    COMPLETED: { color: 'success', label: 'Hoàn thành' },
    OPEN: { color: 'warning', label: 'Đang mở' },
    PARTIAL: { color: 'processing', label: 'Một phần' },
    SETTLED: { color: 'success', label: 'Đã tất toán' },
    CANCELLED: { color: 'default', label: 'Đã hủy' },
  };
  const item = palette[status] || { color: 'default', label: status };
  return <Tag color={item.color}>{item.label}</Tag>;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const escapeCell = (value: string | number | null | undefined) => {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  };
  const content = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ].join('\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}


function SectionTable<T extends object>({
  title,
  loading,
  columns,
  dataSource,
  rowKey,
  extra,
}: {
  title: string;
  loading: boolean;
  columns: ColumnsType<T>;
  dataSource: T[];
  rowKey: string | ((record: T) => string);
  extra?: ReactNode;
}) {
  return (
    <Card
      title={title}
      extra={extra}
      bordered={false}
      style={{ borderRadius: 12, boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)' }}
    >
      <Table<T>
        rowKey={rowKey}
        loading={loading}
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        locale={{ emptyText: <Empty description="Không có dữ liệu" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        scroll={{ x: 720 }}
      />
    </Card>
  );
}


export default function ReportsCenter() {
  const navigate = useNavigate();
  const canViewSales = canAccessSalesOrders();
  const canManagePurchasing = canManagePurchasingData();
  const canManageProduction = canManageProductionData();
  const canManageInventory = canManageInventoryData();
  const canManageFinance = canManageFinanceData();
  const { config, saveConfig } = useUserPreferences(PAGES.REPORTS_CENTER);
  const defaultDateFrom = dayjs().startOf('month').format('YYYY-MM-DD');
  const defaultDateTo = dayjs().endOf('month').format('YYYY-MM-DD');
  const [activeTab, setActiveTab] = useState<string>(String((config as Record<string, unknown>)?.activeTab || 'overview'));
  const [dateFrom, setDateFrom] = useState<string>(String((config as Record<string, unknown>)?.dateFrom || defaultDateFrom));
  const [dateTo, setDateTo] = useState<string>(String((config as Record<string, unknown>)?.dateTo || defaultDateTo));

  const salesBaseParams = useMemo(
    () => ({
      page_size: 8,
      order_date__gte: dateFrom,
      order_date__lte: dateTo,
    }),
    [dateFrom, dateTo]
  );
  const purchasingBaseParams = useMemo(
    () => ({
      page_size: 8,
      order_date_from: dateFrom,
      order_date_to: dateTo,
    }),
    [dateFrom, dateTo]
  );
  const productionBaseParams = useMemo(
    () => ({
      page_size: 8,
      order_date_from: dateFrom,
      order_date_to: dateTo,
    }),
    [dateFrom, dateTo]
  );
  const financeBaseParams = useMemo(
    () => ({
      page_size: 8,
      document_date__gte: dateFrom,
      document_date__lte: dateTo,
    }),
    [dateFrom, dateTo]
  );

  const salesSummaryQuery = useQuery({
    queryKey: ['reports-sales-summary', salesBaseParams],
    queryFn: () => salesApi.getOrderSummary(salesBaseParams),
    enabled: canViewSales,
  });
  const salesListQuery = useQuery({
    queryKey: ['reports-sales-list', salesBaseParams],
    queryFn: () => salesApi.getOrders({ ...salesBaseParams, ordering: '-order_date' }),
    enabled: canViewSales,
  });
  const salesRiskQuery = useQuery({
    queryKey: ['reports-sales-risk-list', salesBaseParams],
    queryFn: () => salesApi.getOrders({ ...salesBaseParams, has_overdue_delivery: 'true', ordering: 'delivery_date' }),
    enabled: canViewSales,
  });
  const purchasingSummaryQuery = useQuery({
    queryKey: ['reports-purchasing-summary', purchasingBaseParams],
    queryFn: () => purchasingApi.getOrderSummary(purchasingBaseParams),
    enabled: canManagePurchasing,
  });
  const purchasingListQuery = useQuery({
    queryKey: ['reports-purchasing-list', purchasingBaseParams],
    queryFn: () => purchasingApi.getOrders({ ...purchasingBaseParams, ordering: 'expected_receipt_date' }),
    enabled: canManagePurchasing,
  });
  const purchasingOverdueQuery = useQuery({
    queryKey: ['reports-purchasing-overdue-list', purchasingBaseParams],
    queryFn: () => purchasingApi.getOrders({ ...purchasingBaseParams, has_overdue_receipt: 'true', ordering: 'expected_receipt_date' }),
    enabled: canManagePurchasing,
  });
  const productionSummaryQuery = useQuery({
    queryKey: ['reports-production-summary', productionBaseParams],
    queryFn: () => productionApi.getOrderSummary(productionBaseParams),
    enabled: canManageProduction,
  });
  const productionListQuery = useQuery({
    queryKey: ['reports-production-list', productionBaseParams],
    queryFn: () => productionApi.getOrders({ ...productionBaseParams, ordering: 'planned_end_date' }),
    enabled: canManageProduction,
  });
  const productionOverdueQuery = useQuery({
    queryKey: ['reports-production-overdue-list', productionBaseParams],
    queryFn: () => productionApi.getOrders({ ...productionBaseParams, has_overdue_plan: 'true', ordering: 'planned_end_date' }),
    enabled: canManageProduction,
  });
  const receivableSummaryQuery = useQuery({
    queryKey: ['reports-receivable-summary', financeBaseParams],
    queryFn: () => financeApi.getReceivableSummary(financeBaseParams),
    enabled: canManageFinance,
  });
  const receivableListQuery = useQuery({
    queryKey: ['reports-receivable-overdue-list', financeBaseParams],
    queryFn: () => financeApi.getReceivables({ ...financeBaseParams, overdue_only: 'true', ordering: 'due_date' }),
    enabled: canManageFinance,
  });
  const payableSummaryQuery = useQuery({
    queryKey: ['reports-payable-summary', financeBaseParams],
    queryFn: () => financeApi.getPayableSummary(financeBaseParams),
    enabled: canManageFinance,
  });
  const payableListQuery = useQuery({
    queryKey: ['reports-payable-overdue-list', financeBaseParams],
    queryFn: () => financeApi.getPayables({ ...financeBaseParams, overdue_only: 'true', ordering: 'due_date' }),
    enabled: canManageFinance,
  });
  const inventorySummaryQuery = useQuery({
    queryKey: ['reports-inventory-summary'],
    queryFn: () => inventoryApi.getStockSummary(),
    enabled: canManageInventory,
  });
  const lowStockQuery = useQuery({
    queryKey: ['reports-low-stock-list'],
    queryFn: () => inventoryApi.getStock({ below_min_only: 'true', page_size: 8 }),
    enabled: canManageInventory,
  });

  const cashFlowSummaryQuery = useQuery({
    queryKey: ['reports-cash-flow-summary', dateFrom, dateTo],
    queryFn: () => financeApi.getCashFlowSummary({ date_from: dateFrom, date_to: dateTo }),
    enabled: canManageFinance && Boolean(dateFrom && dateTo),
  });

  const nxtReportQuery = useQuery({
    queryKey: ['reports-nxt-report', dateFrom, dateTo],
    queryFn: () => inventoryApi.getNxtReport({ date_from: dateFrom, date_to: dateTo }),
    enabled: canManageInventory && Boolean(dateFrom && dateTo),
  });

  const overviewCards = useMemo(() => {
    const cards: Array<{ key: string; title: string; value: string; hint: string }> = [];
    if (canViewSales) {
      cards.push({
        key: 'sales',
        title: 'Doanh thu đơn đã post',
        value: formatMoney(salesSummaryQuery.data?.posted_total),
        hint: `Chờ duyệt: ${formatNumber(salesSummaryQuery.data?.pending_approval_count)}`,
      });
    }
    if (canManagePurchasing) {
      cards.push({
        key: 'purchasing',
        title: 'Giá trị mua chờ nhận',
        value: formatMoney(purchasingSummaryQuery.data?.open_value),
        hint: `Quá hạn nhận: ${formatNumber(purchasingSummaryQuery.data?.overdue_receipt_count)}`,
      });
    }
    if (canManageProduction) {
      cards.push({
        key: 'production',
        title: 'Khối lượng SX còn lại',
        value: formatNumber(productionSummaryQuery.data?.active_remaining_qty),
        hint: `Lệnh đang chạy: ${formatNumber(productionSummaryQuery.data?.active_count)}`,
      });
    }
    if (canManageFinance) {
      cards.push({
        key: 'ar',
        title: 'Phải thu còn lại',
        value: formatMoney(receivableSummaryQuery.data?.remaining_amount),
        hint: `Quá hạn: ${formatMoney(receivableSummaryQuery.data?.overdue_amount)}`,
      });
      cards.push({
        key: 'ap',
        title: 'Phải trả còn lại',
        value: formatMoney(payableSummaryQuery.data?.remaining_amount),
        hint: `Quá hạn: ${formatMoney(payableSummaryQuery.data?.overdue_amount)}`,
      });
    }
    if (canManageInventory) {
      cards.push({
        key: 'inventory',
        title: 'Dòng tồn dưới định mức',
        value: formatNumber(inventorySummaryQuery.data?.below_min_count),
        hint: `Tồn khả dụng: ${formatNumber(inventorySummaryQuery.data?.total_available_qty)}`,
      });
    }
    return cards;
  }, [
    canManageFinance,
    canManageInventory,
    canManageProduction,
    canManagePurchasing,
    canViewSales,
    inventorySummaryQuery.data?.below_min_count,
    inventorySummaryQuery.data?.total_available_qty,
    payableSummaryQuery.data?.overdue_amount,
    payableSummaryQuery.data?.remaining_amount,
    productionSummaryQuery.data?.active_count,
    productionSummaryQuery.data?.active_remaining_qty,
    purchasingSummaryQuery.data?.open_value,
    purchasingSummaryQuery.data?.overdue_receipt_count,
    receivableSummaryQuery.data?.overdue_amount,
    receivableSummaryQuery.data?.remaining_amount,
    salesSummaryQuery.data?.pending_approval_count,
    salesSummaryQuery.data?.posted_total,
  ]);

  const salesColumns: ColumnsType<SalesOrder> = [
    { title: 'Mã đơn', dataIndex: 'code', width: 130 },
    { title: 'Khách hàng', dataIndex: 'customer_name', width: 200, render: (value) => value || '-' },
    { title: 'Ngày đơn', dataIndex: 'order_date', width: 120, render: (value) => dayjs(String(value)).format('DD/MM/YYYY') },
    { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (value) => statusTag(String(value)) },
    { title: 'Tổng tiền', dataIndex: 'total', width: 140, render: (value) => formatMoney(value as string) },
  ];

  const purchasingColumns: ColumnsType<PurchaseOrder> = [
    { title: 'Mã đơn', dataIndex: 'code', width: 130 },
    { title: 'Nhà cung cấp', dataIndex: 'supplier_name', width: 200, render: (value) => value || '-' },
    { title: 'Dự kiến nhận', dataIndex: 'expected_receipt_date', width: 120, render: (value) => (value ? dayjs(String(value)).format('DD/MM/YYYY') : '-') },
    { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (value) => statusTag(String(value)) },
    { title: 'Tổng tiền', dataIndex: 'total', width: 140, render: (value) => formatMoney(value as string) },
  ];

  const productionColumns: ColumnsType<ProductionOrder> = [
    { title: 'Mã lệnh', dataIndex: 'code', width: 130 },
    { title: 'Thành phẩm', dataIndex: 'product_name', width: 220, render: (value) => value || '-' },
    { title: 'Kết thúc KH', dataIndex: 'planned_end_date', width: 120, render: (value) => (value ? dayjs(String(value)).format('DD/MM/YYYY') : '-') },
    { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (value) => statusTag(String(value)) },
    { title: 'SL còn lại', dataIndex: 'remaining_qty', width: 120, render: (value) => formatNumber(value as string) },
  ];

  const receivableColumns: ColumnsType<ReceivableDocument> = [
    { title: 'Mã PT', dataIndex: 'code', width: 120 },
    { title: 'Khách hàng', dataIndex: 'customer_name', width: 200, render: (value) => value || '-' },
    { title: 'Đến hạn', dataIndex: 'due_date', width: 120, render: (value) => dayjs(String(value)).format('DD/MM/YYYY') },
    { title: 'Còn lại', dataIndex: 'remaining_amount', width: 140, render: (value) => formatMoney(value as string) },
    { title: 'Quá hạn', dataIndex: 'days_overdue', width: 100, render: (value) => `${value ?? 0} ngày` },
  ];

  const payableColumns: ColumnsType<PayableDocument> = [
    { title: 'Mã PP', dataIndex: 'code', width: 120 },
    { title: 'Nhà cung cấp', dataIndex: 'supplier_name', width: 200, render: (value) => value || '-' },
    { title: 'Đến hạn', dataIndex: 'due_date', width: 120, render: (value) => dayjs(String(value)).format('DD/MM/YYYY') },
    { title: 'Còn lại', dataIndex: 'remaining_amount', width: 140, render: (value) => formatMoney(value as string) },
    { title: 'Quá hạn', dataIndex: 'days_overdue', width: 100, render: (value) => `${value ?? 0} ngày` },
  ];

  const inventoryColumns: ColumnsType<InventoryStockRow> = [
    { title: 'Mã SP', dataIndex: 'product_code', width: 120 },
    { title: 'Sản phẩm', dataIndex: 'product_name', width: 220 },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 160 },
    { title: 'Khả dụng', dataIndex: 'available', width: 120, render: (value) => formatNumber(value as string) },
    { title: 'Min', dataIndex: 'min_stock', width: 100, render: (value) => formatNumber(value as string) },
  ];

  const tabItems = useMemo<TabsProps['items']>(() => {
    const items: TabsProps['items'] = [
      {
        key: 'overview',
        label: 'Tổng hợp',
        children: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Row gutter={[16, 16]}>
              {overviewCards.map((card) => (
                <Col key={card.key} xs={24} sm={12} xl={8}>
                  <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)' }}>
                    <div style={{ color: '#8c8c8c', marginBottom: 6 }}>{card.title}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{card.value}</div>
                    <div style={{ marginTop: 6, color: '#8c8c8c', fontSize: 12 }}>{card.hint}</div>
                  </Card>
                </Col>
              ))}
            </Row>
            {canManageFinance ? (
              <SectionTable<ReceivableDocument>
                title="Khoản Phải Thu Quá Hạn"
                loading={receivableListQuery.isLoading}
                columns={receivableColumns}
                dataSource={receivableListQuery.data?.results ?? []}
                rowKey="id"
                extra={(
                  <Space>
                    <Button size="small" onClick={() => navigate('/receivables')}>Mở màn nguồn</Button>
                    <Button
                      size="small"
                      onClick={() =>
                        downloadCsv(
                          'phai-thu-qua-han.csv',
                          ['Mã PT', 'Khách hàng', 'Đến hạn', 'Còn lại', 'Quá hạn (ngày)'],
                          (receivableListQuery.data?.results ?? []).map((row) => [
                            row.code,
                            row.customer_name,
                            row.due_date,
                            row.remaining_amount,
                            row.days_overdue,
                          ])
                        )
                      }
                    >
                      Xuất CSV
                    </Button>
                  </Space>
                )}
              />
            ) : null}
            {canManageFinance ? (
              <SectionTable<PayableDocument>
                title="Khoản Phải Trả Quá Hạn"
                loading={payableListQuery.isLoading}
                columns={payableColumns}
                dataSource={payableListQuery.data?.results ?? []}
                rowKey="id"
                extra={(
                  <Space>
                    <Button size="small" onClick={() => navigate('/payables')}>Mở màn nguồn</Button>
                    <Button
                      size="small"
                      onClick={() =>
                        downloadCsv(
                          'phai-tra-qua-han.csv',
                          ['Mã PP', 'Nhà cung cấp', 'Đến hạn', 'Còn lại', 'Quá hạn (ngày)'],
                          (payableListQuery.data?.results ?? []).map((row) => [
                            row.code,
                            row.supplier_name,
                            row.due_date,
                            row.remaining_amount,
                            row.days_overdue,
                          ])
                        )
                      }
                    >
                      Xuất CSV
                    </Button>
                  </Space>
                )}
              />
            ) : null}
            {canManageInventory ? (
              <SectionTable<InventoryStockRow>
                title="Tồn Kho Dưới Định Mức"
                loading={lowStockQuery.isLoading}
                columns={inventoryColumns}
                dataSource={lowStockQuery.data?.results ?? []}
                rowKey={(row) => `${row.product_id}-${row.warehouse_id}-${row.location_id ?? 'root'}`}
                extra={(
                  <Space>
                    <Button size="small" onClick={() => navigate('/inventory-stock')}>Mở màn nguồn</Button>
                    <Button
                      size="small"
                      onClick={() =>
                        downloadCsv(
                          'ton-kho-duoi-dinh-muc.csv',
                          ['Mã SP', 'Sản phẩm', 'Kho', 'Khả dụng', 'Min'],
                          (lowStockQuery.data?.results ?? []).map((row) => [
                            row.product_code,
                            row.product_name,
                            row.warehouse_name,
                            row.available,
                            row.min_stock,
                          ])
                        )
                      }
                    >
                      Xuất CSV
                    </Button>
                  </Space>
                )}
              />
            ) : null}
          </div>
        ),
      },
    ];

    if (canViewSales) {
      items.push({
        key: 'sales',
        label: 'Bán hàng',
        children: (
          <SectionTable<SalesOrder>
            title={`Đơn bán gần đây | Chờ duyệt: ${formatNumber(salesSummaryQuery.data?.pending_approval_count)} | Giao quá hạn: ${formatNumber(salesSummaryQuery.data?.overdue_delivery_count)} | Đã post: ${formatMoney(salesSummaryQuery.data?.posted_total)}`}
            loading={salesListQuery.isLoading || salesSummaryQuery.isLoading}
            columns={salesColumns}
            dataSource={salesListQuery.data?.results ?? []}
            rowKey="id"
            extra={(
              <Space>
                <Button size="small" onClick={() => navigate('/sales-orders')}>Mở màn nguồn</Button>
                <Button
                  size="small"
                  onClick={() =>
                    downloadCsv(
                      'don-ban-gan-day.csv',
                      ['Mã đơn', 'Khách hàng', 'Ngày đơn', 'Trạng thái', 'Tổng tiền'],
                      (salesListQuery.data?.results ?? []).map((row) => [
                        row.code,
                        row.customer_name,
                        row.order_date,
                        row.status,
                        row.total,
                      ])
                    )
                  }
                >
                  Xuất CSV
                </Button>
              </Space>
            )}
          />
        ),
      });
      items.push({
        key: 'sales-risk',
        label: 'Bán hàng trễ hạn',
        children: (
          <SectionTable<SalesOrder>
            title="Các đơn bán đang có kế hoạch giao quá hạn"
            loading={salesRiskQuery.isLoading}
            columns={salesColumns}
            dataSource={salesRiskQuery.data?.results ?? []}
            rowKey="id"
            extra={<Button size="small" onClick={() => navigate('/sales-orders')}>Mở màn nguồn</Button>}
          />
        ),
      });
    }

    if (canManagePurchasing) {
      items.push({
        key: 'purchasing',
        label: 'Mua hàng',
        children: (
          <SectionTable<PurchaseOrder>
            title={`Đơn mua gần đây | Chờ duyệt: ${formatNumber(purchasingSummaryQuery.data?.pending_approval_count)} | Chờ nhận: ${formatNumber(purchasingSummaryQuery.data?.waiting_receipt_count)} | Giá trị mở: ${formatMoney(purchasingSummaryQuery.data?.open_value)}`}
            loading={purchasingListQuery.isLoading || purchasingSummaryQuery.isLoading}
            columns={purchasingColumns}
            dataSource={purchasingListQuery.data?.results ?? []}
            rowKey="id"
            extra={(
              <Space>
                <Button size="small" onClick={() => navigate('/purchase-orders')}>Mở màn nguồn</Button>
                <Button
                  size="small"
                  onClick={() =>
                    downloadCsv(
                      'don-mua-gan-day.csv',
                      ['Mã đơn', 'Nhà cung cấp', 'Dự kiến nhận', 'Trạng thái', 'Tổng tiền'],
                      (purchasingListQuery.data?.results ?? []).map((row) => [
                        row.code,
                        row.supplier_name,
                        row.expected_receipt_date,
                        row.status,
                        row.total,
                      ])
                    )
                  }
                >
                  Xuất CSV
                </Button>
              </Space>
            )}
          />
        ),
      });
      items.push({
        key: 'purchasing-risk',
        label: 'Mua hàng trễ nhận',
        children: (
          <SectionTable<PurchaseOrder>
            title="Các đơn mua quá hạn nhận hàng"
            loading={purchasingOverdueQuery.isLoading}
            columns={purchasingColumns}
            dataSource={purchasingOverdueQuery.data?.results ?? []}
            rowKey="id"
            extra={<Button size="small" onClick={() => navigate('/purchase-orders')}>Mở màn nguồn</Button>}
          />
        ),
      });
    }

    if (canManageProduction) {
      items.push({
        key: 'production',
        label: 'Sản xuất',
        children: (
          <SectionTable<ProductionOrder>
            title={`Lệnh sản xuất | Đang chạy: ${formatNumber(productionSummaryQuery.data?.active_count)} | Quá hạn: ${formatNumber(productionSummaryQuery.data?.overdue_plan_count)} | SL còn lại: ${formatNumber(productionSummaryQuery.data?.active_remaining_qty)}`}
            loading={productionListQuery.isLoading || productionSummaryQuery.isLoading}
            columns={productionColumns}
            dataSource={productionListQuery.data?.results ?? []}
            rowKey="id"
            extra={(
              <Space>
                <Button size="small" onClick={() => navigate('/production-orders')}>Mở màn nguồn</Button>
                <Button
                  size="small"
                  onClick={() =>
                    downloadCsv(
                      'lenh-san-xuat.csv',
                      ['Mã lệnh', 'Thành phẩm', 'Kết thúc KH', 'Trạng thái', 'SL còn lại'],
                      (productionListQuery.data?.results ?? []).map((row) => [
                        row.code,
                        row.product_name,
                        row.planned_end_date,
                        row.status,
                        row.remaining_qty,
                      ])
                    )
                  }
                >
                  Xuất CSV
                </Button>
              </Space>
            )}
          />
        ),
      });
      items.push({
        key: 'production-risk',
        label: 'Sản xuất trễ tiến độ',
        children: (
          <SectionTable<ProductionOrder>
            title="Các lệnh sản xuất quá hạn kế hoạch"
            loading={productionOverdueQuery.isLoading}
            columns={productionColumns}
            dataSource={productionOverdueQuery.data?.results ?? []}
            rowKey="id"
            extra={<Button size="small" onClick={() => navigate('/production-orders')}>Mở màn nguồn</Button>}
          />
        ),
      });
    }

    if (canManageFinance) {
      items.push({
        key: 'finance',
        label: 'Tài chính',
        children: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionTable<ReceivableDocument>
              title={`Phải thu | Còn lại: ${formatMoney(receivableSummaryQuery.data?.remaining_amount)} | Quá hạn: ${formatMoney(receivableSummaryQuery.data?.overdue_amount)}`}
              loading={receivableListQuery.isLoading || receivableSummaryQuery.isLoading}
              columns={receivableColumns}
              dataSource={receivableListQuery.data?.results ?? []}
              rowKey="id"
              extra={<Button size="small" onClick={() => navigate('/receivables')}>Mở màn nguồn</Button>}
            />
            <SectionTable<PayableDocument>
              title={`Phải trả | Còn lại: ${formatMoney(payableSummaryQuery.data?.remaining_amount)} | Quá hạn: ${formatMoney(payableSummaryQuery.data?.overdue_amount)}`}
              loading={payableListQuery.isLoading || payableSummaryQuery.isLoading}
              columns={payableColumns}
              dataSource={payableListQuery.data?.results ?? []}
              rowKey="id"
              extra={<Button size="small" onClick={() => navigate('/payables')}>Mở màn nguồn</Button>}
            />
          </div>
        ),
      });
      items.push({
        key: 'cash-flow',
        label: 'Thu chi',
        children: (
          <Card bordered={false} style={{ borderRadius: 12, boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)' }}>
            <div style={{ marginBottom: 16 }}>
              <span style={{ marginRight: 8 }}>Kỳ: {dateFrom} → {dateTo}</span>
            </div>
            {cashFlowSummaryQuery.isLoading ? (
              <div style={{ padding: 24, textAlign: 'center' }}>Đang tải...</div>
            ) : cashFlowSummaryQuery.data ? (
              <Row gutter={[16, 16]}>
                <Col span={8}>
                  <Statistic title="Tổng thu" value={Number(cashFlowSummaryQuery.data.total_income)} formatter={(v) => formatMoney(v)} />
                </Col>
                <Col span={8}>
                  <Statistic title="Tổng chi" value={Number(cashFlowSummaryQuery.data.total_expense)} formatter={(v) => formatMoney(v)} />
                </Col>
                <Col span={8}>
                  <Statistic title="Chênh lệch (thu - chi)" value={Number(cashFlowSummaryQuery.data.cash_delta)} formatter={(v) => formatMoney(v)} />
                </Col>
                <Col span={24}>
                  <span style={{ color: '#8c8c8c' }}>Số giao dịch trong kỳ: {cashFlowSummaryQuery.data.transactions_count}</span>
                </Col>
              </Row>
            ) : (
              <Empty description="Chọn khoảng ngày và xem báo cáo thu chi theo kỳ" />
            )}
          </Card>
        ),
      });
    }

    if (canManageInventory) {
      items.push({
        key: 'inventory',
        label: 'Tồn kho',
        children: (
          <SectionTable<InventoryStockRow>
            title={`Tồn kho thấp | Số dòng cảnh báo: ${formatNumber(inventorySummaryQuery.data?.below_min_count)} | Khả dụng toàn kho: ${formatNumber(inventorySummaryQuery.data?.total_available_qty)}`}
            loading={lowStockQuery.isLoading || inventorySummaryQuery.isLoading}
            columns={inventoryColumns}
            dataSource={lowStockQuery.data?.results ?? []}
            rowKey={(row) => `${row.product_id}-${row.warehouse_id}-${row.location_id ?? 'root'}`}
            extra={<Button size="small" onClick={() => navigate('/inventory-stock')}>Mở màn nguồn</Button>}
          />
        ),
      });
      type NxtRow = { product_id: number; product_code: string; product_name: string; warehouse_id: number | null; warehouse_code: string; warehouse_name: string; opening_qty: string; in_qty: string; out_qty: string; closing_qty: string };
      const nxtColumns: ColumnsType<NxtRow> = [
        { title: 'Mã SP', dataIndex: 'product_code', width: 120 },
        { title: 'Sản phẩm', dataIndex: 'product_name', width: 200 },
        { title: 'Kho', dataIndex: 'warehouse_code', width: 100, render: (_, row) => row.warehouse_name || row.warehouse_code || '-' },
        { title: 'Tồn đầu', dataIndex: 'opening_qty', width: 100, align: 'right', render: (v) => formatNumber(v) },
        { title: 'Nhập', dataIndex: 'in_qty', width: 100, align: 'right', render: (v) => formatNumber(v) },
        { title: 'Xuất', dataIndex: 'out_qty', width: 100, align: 'right', render: (v) => formatNumber(v) },
        { title: 'Tồn cuối', dataIndex: 'closing_qty', width: 100, align: 'right', render: (v) => formatNumber(v) },
      ];
      items.push({
        key: 'nxt',
        label: 'Nhập Xuất Tồn',
        children: (
          <SectionTable<NxtRow>
            title={`Báo cáo NXT | Kỳ: ${dateFrom} → ${dateTo}`}
            loading={nxtReportQuery.isLoading}
            columns={nxtColumns}
            dataSource={nxtReportQuery.data?.results ?? []}
            rowKey={(row) => `${row.product_id}-${row.warehouse_id ?? 0}`}
            extra={(
              <Button
                size="small"
                onClick={() =>
                  downloadCsv(
                    `nxt_${dateFrom}_${dateTo}.csv`,
                    ['Mã SP', 'Sản phẩm', 'Kho', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối'],
                    (nxtReportQuery.data?.results ?? []).map((row) => [
                      row.product_code,
                      row.product_name,
                      row.warehouse_name || row.warehouse_code,
                      row.opening_qty,
                      row.in_qty,
                      row.out_qty,
                      row.closing_qty,
                    ])
                  )
                }
              >
                Xuất CSV
              </Button>
            )}
          />
        ),
      });
    }

    return items;
  }, [
    canManageFinance,
    canManageInventory,
    canManageProduction,
    canManagePurchasing,
    canViewSales,
    dateFrom,
    dateTo,
    cashFlowSummaryQuery.data,
    cashFlowSummaryQuery.isLoading,
    nxtReportQuery.data?.results,
    nxtReportQuery.isLoading,
    inventorySummaryQuery.data?.below_min_count,
    inventorySummaryQuery.data?.total_available_qty,
    inventorySummaryQuery.isLoading,
    lowStockQuery.data?.results,
    lowStockQuery.isLoading,
    overviewCards,
    payableListQuery.data?.results,
    payableListQuery.isLoading,
    payableSummaryQuery.data?.overdue_amount,
    payableSummaryQuery.data?.remaining_amount,
    payableSummaryQuery.isLoading,
    productionOverdueQuery.data?.results,
    productionOverdueQuery.isLoading,
    productionListQuery.data?.results,
    productionListQuery.isLoading,
    productionSummaryQuery.data?.active_count,
    productionSummaryQuery.data?.active_remaining_qty,
    productionSummaryQuery.data?.overdue_plan_count,
    productionSummaryQuery.isLoading,
    purchasingListQuery.data?.results,
    purchasingListQuery.isLoading,
    purchasingSummaryQuery.data?.open_value,
    purchasingSummaryQuery.data?.pending_approval_count,
    purchasingSummaryQuery.data?.waiting_receipt_count,
    purchasingSummaryQuery.isLoading,
    purchasingOverdueQuery.data?.results,
    purchasingOverdueQuery.isLoading,
    receivableListQuery.data?.results,
    receivableListQuery.isLoading,
    receivableSummaryQuery.data?.overdue_amount,
    receivableSummaryQuery.data?.remaining_amount,
    receivableSummaryQuery.isLoading,
    salesRiskQuery.data?.results,
    salesRiskQuery.isLoading,
    salesListQuery.data?.results,
    salesListQuery.isLoading,
    salesSummaryQuery.data?.overdue_delivery_count,
    salesSummaryQuery.data?.pending_approval_count,
    salesSummaryQuery.data?.posted_total,
    salesSummaryQuery.isLoading,
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)' }}
      >
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Trung tâm báo cáo</div>
        <div style={{ color: '#8c8c8c' }}>
          Tổng hợp số liệu thật theo từng khối nghiệp vụ để theo dõi vận hành và đi sâu vào các điểm cần xử lý.
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Space>
            <span style={{ color: '#595959' }}>Từ ngày</span>
            <DatePicker
              value={dayjs(dateFrom)}
              format="DD/MM/YYYY"
              onChange={(value) => {
                const next = (value || dayjs(defaultDateFrom)).format('YYYY-MM-DD');
                setDateFrom(next);
                void saveConfig({ ...(config as Record<string, unknown>), activeTab, dateFrom: next, dateTo });
              }}
            />
          </Space>
          <Space>
            <span style={{ color: '#595959' }}>Đến ngày</span>
            <DatePicker
              value={dayjs(dateTo)}
              format="DD/MM/YYYY"
              onChange={(value) => {
                const next = (value || dayjs(defaultDateTo)).format('YYYY-MM-DD');
                setDateTo(next);
                void saveConfig({ ...(config as Record<string, unknown>), activeTab, dateFrom, dateTo: next });
              }}
            />
          </Space>
          <Button
            onClick={() => {
              setDateFrom(defaultDateFrom);
              setDateTo(defaultDateTo);
              void saveConfig({ ...(config as Record<string, unknown>), activeTab, dateFrom: defaultDateFrom, dateTo: defaultDateTo });
            }}
          >
            Tháng này
          </Button>
          <span style={{ color: '#8c8c8c' }}>
            Kỳ báo cáo: {dayjs(dateFrom).format('DD/MM/YYYY')} - {dayjs(dateTo).format('DD/MM/YYYY')}
          </span>
        </div>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          void saveConfig({ ...(config as Record<string, unknown>), activeTab: key });
        }}
        items={tabItems}
      />
    </div>
  );
}
