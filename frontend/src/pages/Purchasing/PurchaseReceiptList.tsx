import { useMemo, useState } from 'react';
import {
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { purchasingApi } from '../../api/purchasing';
import type { PurchaseReceipt, Supplier } from '../../types/purchasing';
import { PAGES } from '../../utils/constants';
import { canCancelPurchaseOrders, canManagePurchasingData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';


type Filters = {
  status?: string;
  supplier?: number;
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


function formatMoney(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0';
}


export default function PurchaseReceiptList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManagePurchasingData();
  const canCancel = canCancelPurchaseOrders();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [drawerReceipt, setDrawerReceipt] = useState<PurchaseReceipt | null>(null);
  const [cancelReceipt, setCancelReceipt] = useState<PurchaseReceipt | null>(null);
  const [reasonForm] = Form.useForm<{ reason: string }>();
  const { config, saveConfig } = useUserPreferences(PAGES.PURCHASING_RECEIPTS);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-receipt_date' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.supplier) next.supplier = intentFilters.supplier;
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const receiptsQuery = useQuery({
    queryKey: ['purchasing-receipts', params],
    queryFn: () => purchasingApi.getReceipts(params),
  });
  const suppliersQuery = useQuery({
    queryKey: ['purchasing-receipt-suppliers'],
    queryFn: () => purchasingApi.getSuppliers({ page_size: 200, ordering: 'code', is_active: 'true' }),
  });
  const receiptDetailQuery = useQuery({
    queryKey: ['purchasing-receipt-detail', drawerReceipt?.id],
    queryFn: () => purchasingApi.getReceipt(drawerReceipt!.id),
    enabled: !!drawerReceipt,
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => purchasingApi.cancelReceipt(id, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchasing-receipts'] }),
        queryClient.invalidateQueries({ queryKey: ['purchasing-orders'] }),
      ]);
      messageApi.success('Đã hủy phiếu nhập');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = receiptsQuery.data?.results ?? [];
  const supplierOptions: Supplier[] = suppliersQuery.data?.results ?? [];
  const detail = receiptDetailQuery.data ?? drawerReceipt;

  const columns: ColumnsType<PurchaseReceipt> = [
    { title: 'Phiếu nhập', dataIndex: 'code', width: 140 },
    { title: 'Đơn mua', dataIndex: 'purchase_order_code', width: 140, render: (value) => value || '-' },
    { title: 'Nhà cung cấp', dataIndex: 'supplier_name', width: 220, render: (value) => value || '-' },
    { title: 'Ngày nhận', dataIndex: 'receipt_date', width: 110, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 160, render: (value) => value || '-' },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (value) => <Tag color={value === 'POSTED' ? 'success' : 'error'}>{value === 'POSTED' ? 'Đã ghi sổ' : 'Đã hủy'}</Tag>,
    },
    { title: 'SL', dataIndex: 'total_qty', width: 100 },
    { title: 'Giá trị', dataIndex: 'total_amount', width: 140, render: (value) => formatMoney(value) },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 180,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setDrawerReceipt(row)}>
            Xem
          </Button>
          <Button
            size="small"
            danger
            disabled={!canManage || !canCancel || row.status !== 'POSTED'}
            onClick={() => {
              setCancelReceipt(row);
              reasonForm.setFieldValue('reason', '');
            }}
          >
            Hủy phiếu
          </Button>
        </Space>
      ),
    },
  ];

  const handleCancelReceipt = async () => {
    const values = await reasonForm.validateFields();
    if (!cancelReceipt) return;
    await cancelMutation.mutateAsync({ id: cancelReceipt.id, reason: values.reason.trim() });
    setCancelReceipt(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div>
        <h2 style={{ margin: 0 }}>Phiếu nhập mua</h2>
        <div style={{ color: '#8c8c8c' }}>Theo dõi nhận hàng từ đơn mua và đối chiếu nhập kho</div>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm kiếm tất cả cột..."
          style={{ width: 320 }}
          suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
        />
        <Select
          value={filters.status ?? ''}
          style={{ width: 220 }}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, status: value || undefined }));
            setPage(1);
          }}
          options={[
            { value: '', label: 'Tất cả trạng thái' },
            { value: 'POSTED', label: 'Đã ghi sổ' },
            { value: 'CANCELLED', label: 'Đã hủy' },
          ]}
        />
        <Select
          showSearch
          optionFilterProp="label"
          value={filters.supplier ?? ''}
          style={{ width: 260 }}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, supplier: typeof value === 'number' ? value : undefined }));
            setPage(1);
          }}
          options={[
            { value: '', label: 'Tất cả nhà cung cấp' },
            ...supplierOptions.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` })),
          ]}
        />
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({});
            setPage(1);
          }}
        >
          Xóa bộ lọc
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={receiptsQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1400 }}
        pagination={{
          current: page,
          pageSize,
          total: receiptsQuery.data?.count ?? 0,
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
        title={cancelReceipt ? `Hủy phiếu nhập ${cancelReceipt.code}` : 'Hủy phiếu nhập'}
        open={!!cancelReceipt}
        onCancel={() => setCancelReceipt(null)}
        onOk={() => void handleCancelReceipt()}
        confirmLoading={cancelMutation.isPending}
      >
        <Form form={reasonForm} layout="vertical">
          <Form.Item name="reason" label="Lý do hủy" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `Chi tiết ${detail.code}` : 'Chi tiết phiếu nhập'}
        width={920}
        open={!!drawerReceipt}
        onClose={() => setDrawerReceipt(null)}
      >
        {detail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Đơn mua">{detail.purchase_order_code || '-'}</Descriptions.Item>
              <Descriptions.Item label="Nhà cung cấp">{detail.supplier_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Ngày nhận">{dayjs(detail.receipt_date).format('DD/MM/YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Kho">{detail.warehouse_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Vị trí">{detail.location_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <Tag color={detail.status === 'POSTED' ? 'success' : 'error'}>
                  {detail.status === 'POSTED' ? 'Đã ghi sổ' : 'Đã hủy'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Tổng số lượng">{detail.total_qty}</Descriptions.Item>
              <Descriptions.Item label="Tổng giá trị">{formatMoney(detail.total_amount)}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú" span={2}>{detail.note || '-'}</Descriptions.Item>
              {detail.cancel_reason ? <Descriptions.Item label="Lý do hủy" span={2}>{detail.cancel_reason}</Descriptions.Item> : null}
            </Descriptions>

            <Table
              rowKey="id"
              columns={[
                { title: '#', dataIndex: 'line_number', width: 60 },
                { title: 'Mã SP', dataIndex: 'product_code', width: 120, render: (value) => value || '-' },
                { title: 'Tên SP', dataIndex: 'product_name', width: 220, render: (value) => value || '-' },
                { title: 'SL nhận', dataIndex: 'quantity', width: 120 },
                { title: 'Đơn giá', dataIndex: 'unit_cost', width: 120, render: (value) => formatMoney(value) },
                { title: 'Thành tiền', dataIndex: 'line_total', width: 140, render: (value) => formatMoney(value) },
                { title: 'Mã sổ kho', dataIndex: 'inventory_transaction_code', width: 140, render: (value) => value || '-' },
              ]}
              dataSource={detail.lines}
              pagination={false}
              scroll={{ x: 900 }}
            />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
