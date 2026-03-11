import { useMemo, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import type { InventoryReservation } from '../../types/inventory';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageInventoryData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

type Filters = { warehouse?: number; status?: string };
type ReservationActionForm = { qty?: number; reason?: string };
type ActionModalState =
  | { type: 'release'; rows: InventoryReservation[] }
  | { type: 'cancel'; rows: InventoryReservation[] }
  | null;

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

const STATUS_OPTIONS = [
  { label: 'Đang giữ', value: 'OPEN' },
  { label: 'Đã nhả', value: 'RELEASED' },
  { label: 'Đã xuất đủ', value: 'FULFILLED' },
  { label: 'Đã hủy', value: 'CANCELLED' },
];

const statusColor: Record<string, string> = {
  OPEN: 'blue',
  RELEASED: 'default',
  FULFILLED: 'green',
  CANCELLED: 'red',
};

export default function InventoryReservationList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [actionModal, setActionModal] = useState<ActionModalState>(null);
  const [actionForm] = Form.useForm<ReservationActionForm>();
  const canManage = canManageInventoryData();
  const { config, saveConfig } = useUserPreferences(PAGES.INVENTORY_RESERVATIONS);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const warehouseQuery = useQuery({
    queryKey: ['inventory-warehouse-options'],
    queryFn: () => inventoryApi.getWarehouses({ page_size: 200, ordering: 'code' }),
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-reservation_date' };
    if (intentSearch.trim()) next.search = intentSearch.trim();
    if (intentFilters.warehouse) next.warehouse = intentFilters.warehouse;
    if (intentFilters.status) next.status = intentFilters.status;
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['inventory-reservations', params],
    queryFn: () => inventoryApi.getReservations(params),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory-reservations'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock-summary'] });
  };

  const releaseMutation = useMutation({
    mutationFn: async ({ rows, qty }: { rows: InventoryReservation[]; qty?: string }) =>
      Promise.all(
        rows.map((row) => inventoryApi.releaseReservation(row.id, rows.length === 1 ? qty : undefined))
      ),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã release reservation');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const cancelMutation = useMutation({
    mutationFn: async ({ rows, reason }: { rows: InventoryReservation[]; reason: string }) =>
      Promise.all(rows.map((row) => inventoryApi.cancelReservation(row.id, reason))),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã hủy reservation');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const selectedOpenRows = useMemo(
    () => (listQuery.data?.results ?? []).filter((row) => selectedRowKeys.includes(row.id) && row.status === 'OPEN'),
    [listQuery.data?.results, selectedRowKeys]
  );

  const openActionModal = (type: 'release' | 'cancel', rows: InventoryReservation[]) => {
    if (rows.length === 0) return;
    setActionModal({ type, rows });
    actionForm.resetFields();
  };

  const onSubmitAction = async () => {
    if (!actionModal) return;
    const values = await actionForm.validateFields();
    if (actionModal.type === 'release') {
      await releaseMutation.mutateAsync({
        rows: actionModal.rows,
        qty: actionModal.rows.length === 1 && values.qty ? String(values.qty) : undefined,
      });
    } else {
      await cancelMutation.mutateAsync({
        rows: actionModal.rows,
        reason: values.reason?.trim() || '',
      });
    }
    setActionModal(null);
    setSelectedRowKeys([]);
    actionForm.resetFields();
  };

  const columns: ColumnsType<InventoryReservation> = [
    { title: 'Mã reserve', dataIndex: 'code', width: 150 },
    { title: 'Ngày', dataIndex: 'reservation_date', width: 110 },
    { title: 'SO', dataIndex: 'sales_order_code', width: 150, render: (value) => value || '-' },
    { title: 'Sản phẩm', width: 240, render: (_, row) => `${row.product_code || ''} - ${row.product_name || ''}` },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 160 },
    { title: 'Vị trí', dataIndex: 'location_name', width: 140, render: (value) => value || '-' },
    { title: 'Đặt giữ', dataIndex: 'reserved_qty', width: 100 },
    { title: 'Đã nhả', dataIndex: 'released_qty', width: 100 },
    { title: 'Đã xuất', dataIndex: 'fulfilled_qty', width: 100 },
    { title: 'Còn active', dataIndex: 'active_qty', width: 100 },
    { title: 'Trạng thái', width: 110, render: (_, row) => <Tag color={statusColor[row.status] || 'default'}>{row.status}</Tag> },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'OPEN'}
            onClick={() => openActionModal('release', [row])}
          >
            Release
          </Button>
          <Button
            size="small"
            danger
            disabled={!canManage || row.status !== 'OPEN'}
            onClick={() => openActionModal('cancel', [row])}
          >
            Hủy
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div>
        <h2 style={{ margin: 0 }}>Reservation tồn kho</h2>
        <div style={{ color: '#8c8c8c' }}>Theo dõi hàng đã giữ cho đơn bán và xử lý release khi cần</div>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm reserve code, SO, sản phẩm..."
          style={{ width: 320 }}
          suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
        />
        <Select
          allowClear
          placeholder="Lọc theo kho"
          style={{ width: 220 }}
          value={filters.warehouse}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, warehouse: value }));
            setPage(1);
          }}
          options={(warehouseQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
        />
        <Select
          allowClear
          placeholder="Lọc theo trạng thái"
          style={{ width: 220 }}
          value={filters.status}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, status: value }));
            setPage(1);
          }}
          options={STATUS_OPTIONS}
        />
        <Button disabled={!canManage || selectedOpenRows.length === 0} onClick={() => openActionModal('release', selectedOpenRows)}>
          Release đã chọn
        </Button>
        <Button danger disabled={!canManage || selectedOpenRows.length === 0} onClick={() => openActionModal('cancel', selectedOpenRows)}>
          Hủy đã chọn
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
          getCheckboxProps: (row) => ({ disabled: row.status !== 'OPEN' || !canManage }),
        }}
        columns={columns}
        dataSource={listQuery.data?.results ?? []}
        scroll={{ x: 1600 }}
        pagination={{
          current: page,
          pageSize,
          total: listQuery.data?.count ?? 0,
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
        title={
          actionModal?.type === 'release'
            ? `Release reservation${actionModal.rows.length > 1 ? ` (${actionModal.rows.length} dòng)` : ''}`
            : actionModal
              ? `Hủy reservation${actionModal.rows.length > 1 ? ` (${actionModal.rows.length} dòng)` : ''}`
              : ''
        }
        open={Boolean(actionModal)}
        onCancel={() => {
          setActionModal(null);
          actionForm.resetFields();
        }}
        onOk={onSubmitAction}
        confirmLoading={releaseMutation.isPending || cancelMutation.isPending}
      >
        <Form form={actionForm} layout="vertical">
          {actionModal?.type === 'release' ? (
            <>
              <div style={{ marginBottom: 12, color: '#595959' }}>
                {actionModal.rows.length === 1
                  ? `Để trống để release toàn bộ ${actionModal.rows[0]?.active_qty || '0'} đang active.`
                  : `Bulk release sẽ release toàn bộ active của ${actionModal.rows.length} reservation đã chọn.`}
              </div>
              {actionModal.rows.length === 1 ? (
                <Form.Item name="qty" label="Số lượng release">
                  <InputNumber style={{ width: '100%' }} min={0.0001} max={Number(actionModal.rows[0]?.active_qty || 0)} />
                </Form.Item>
              ) : null}
            </>
          ) : (
            <Form.Item name="reason" label="Lý do hủy" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input.TextArea rows={4} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
