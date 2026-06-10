import { useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Select, Space, Statistic, Table, Tag, message } from 'antd';
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

const STATUS_LABELS: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((item) => [item.value, item.label]));

const STATUS_NEXT_STEPS: Record<string, string> = {
  OPEN: 'Phiếu còn giữ tồn, có thể nhả một phần/toàn bộ hoặc hủy nếu nhu cầu không còn đúng.',
  RELEASED: 'Tồn đã được giải phóng, kiểm tra lại đơn bán trước khi giữ chỗ lại.',
  FULFILLED: 'Phiếu đã xuất đủ, chỉ cần đối chiếu nếu có sai lệch giao hàng.',
  CANCELLED: 'Phiếu đã hủy, xem lý do hủy trước khi tạo giữ chỗ mới.',
};

function getReservationNextStep(row: InventoryReservation): string {
  return STATUS_NEXT_STEPS[row.status] ?? 'Kiểm tra trạng thái giữ chỗ trước khi thao tác tiếp.';
}

function getReservationActionDisabledReason(row: InventoryReservation, canManage: boolean): string {
  if (!canManage) return 'Bạn chưa có quyền thao tác giữ chỗ tồn kho.';
  if (row.status !== 'OPEN') return 'Chỉ thao tác được trên phiếu đang giữ.';
  return '';
}

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
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
      messageApi.success('Đã nhả giữ chỗ thành công');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const cancelMutation = useMutation({
    mutationFn: async ({ rows, reason }: { rows: InventoryReservation[]; reason: string }) =>
      Promise.all(rows.map((row) => inventoryApi.cancelReservation(row.id, reason))),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã hủy phiếu giữ chỗ');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const selectedOpenRows = useMemo(
    () => (listQuery.data?.results ?? []).filter((row) => selectedRowKeys.includes(row.id) && row.status === 'OPEN'),
    [listQuery.data?.results, selectedRowKeys]
  );
  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const selectedWarehouseLabel = useMemo(() => {
    if (!intentFilters.warehouse) return 'Tất cả kho';
    const warehouse = (warehouseQuery.data?.results ?? []).find((item) => item.id === intentFilters.warehouse);
    return warehouse ? `${warehouse.code} - ${warehouse.name}` : `Kho #${intentFilters.warehouse}`;
  }, [intentFilters.warehouse, warehouseQuery.data?.results]);
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.warehouse) tags.push(`Kho: ${selectedWarehouseLabel}`);
    if (intentFilters.status) {
      const label = STATUS_OPTIONS.find((item) => item.value === intentFilters.status)?.label ?? intentFilters.status;
      tags.push(`Trạng thái: ${label}`);
    }
    return tags;
  }, [intentFilters.status, intentFilters.warehouse, intentSearch, selectedWarehouseLabel]);
  const reservationSummary = useMemo(() => {
    const openCount = rows.filter((row) => row.status === 'OPEN').length;
    const releasedCount = rows.filter((row) => row.status === 'RELEASED').length;
    const fulfilledCount = rows.filter((row) => row.status === 'FULFILLED').length;
    const cancelledCount = rows.filter((row) => row.status === 'CANCELLED').length;
    const activeQtyTotal = rows.reduce((sum, row) => sum + Number(row.active_qty || 0), 0);
    const reservedQtyTotal = rows.reduce((sum, row) => sum + Number(row.reserved_qty || 0), 0);
    const selectedQtyTotal = selectedOpenRows.reduce((sum, row) => sum + Number(row.active_qty || 0), 0);
    return {
      openCount,
      releasedCount,
      fulfilledCount,
      cancelledCount,
      activeQtyTotal,
      reservedQtyTotal,
      selectedQtyTotal,
    };
  }, [rows, selectedOpenRows]);
  const reservationStatusAlert = useMemo(() => {
    if (reservationSummary.openCount > 0) {
      return {
        type: 'info' as const,
        message: `Có ${reservationSummary.openCount} phiếu giữ chỗ đang còn hiệu lực.`,
        description: 'Nên rà lại các phiếu mở trước khi nhả giữ chỗ hàng loạt để tránh giải phóng nhầm phần hàng đang chờ giao.',
      };
    }
    if (reservationSummary.cancelledCount > 0) {
      return {
        type: 'warning' as const,
        message: 'Có phiếu giữ chỗ đã hủy trong bộ lọc hiện tại.',
        description: 'Nên kiểm tra lý do hủy để tránh lặp lại các trường hợp giữ chỗ sai nhu cầu.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Luồng giữ chỗ đang ổn định.',
      description: 'Không có tín hiệu bất thường nổi bật trên bộ lọc hiện tại và bạn có thể xử lý nhả giữ chỗ trực tiếp từ màn này.',
    };
  }, [reservationSummary.cancelledCount, reservationSummary.openCount]);

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
    { title: 'Mã giữ chỗ', dataIndex: 'code', width: 150 },
    { title: 'Ngày', dataIndex: 'reservation_date', width: 110 },
    { title: 'SO', dataIndex: 'sales_order_code', width: 150, render: (value) => value || '-' },
    { title: 'Sản phẩm', width: 240, render: (_, row) => `${row.product_code || ''} - ${row.product_name || ''}` },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 160 },
    { title: 'Vị trí', dataIndex: 'location_name', width: 140, render: (value) => value || '-' },
    { title: 'Đặt giữ', dataIndex: 'reserved_qty', width: 100 },
    { title: 'Đã nhả', dataIndex: 'released_qty', width: 100 },
    { title: 'Đã xuất', dataIndex: 'fulfilled_qty', width: 100 },
    { title: 'Còn hiệu lực', dataIndex: 'active_qty', width: 100 },
    {
      title: 'Trạng thái',
      width: 300,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Tag color={statusColor[row.status] || 'default'}>{STATUS_LABELS[row.status] ?? row.status}</Tag>
          <span data-testid={`inventory-reservation-next-step-${row.id}`} style={{ color: '#595959', fontSize: 12, lineHeight: 1.45 }}>
            {getReservationNextStep(row)}
          </span>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_, row) => {
        const disabledReason = getReservationActionDisabledReason(row, canManage);
        return (
          <Space>
            <Button
              size="small"
              disabled={Boolean(disabledReason)}
              title={disabledReason || 'Nhả một phần hoặc toàn bộ tồn đang giữ'}
              onClick={() => openActionModal('release', [row])}
            >
              Nhả giữ chỗ
            </Button>
            <Button
              size="small"
              danger
              disabled={Boolean(disabledReason)}
              title={disabledReason || 'Hủy phiếu giữ chỗ với lý do rõ ràng'}
              onClick={() => openActionModal('cancel', [row])}
            >
              Hủy
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <Card size="small">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <h2 style={{ margin: 0 }}>Trung tâm giữ chỗ tồn kho</h2>
            <div style={{ color: '#8c8c8c' }}>
              Theo dõi phiếu giữ chỗ cho đơn bán, xử lý nhả giữ chỗ hoặc hủy phiếu ngay từ cùng một màn điều phối.
            </div>
          </div>
          <Alert
            showIcon
            type={reservationStatusAlert.type}
            message={reservationStatusAlert.message}
            description={reservationStatusAlert.description}
          />
          <Space wrap>
            <Tag color="blue">{selectedWarehouseLabel}</Tag>
            <Tag>{`Phiếu đang giữ: ${reservationSummary.openCount}`}</Tag>
            <Tag>{`Khối lượng còn hiệu lực: ${reservationSummary.activeQtyTotal}`}</Tag>
            <Tag color={selectedOpenRows.length > 0 ? 'gold' : 'default'}>
              {`Đang chọn: ${selectedOpenRows.length} phiếu`}
            </Tag>
          </Space>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Phiếu đang giữ" value={reservationSummary.openCount} />
              <div style={{ color: '#8c8c8c' }}>Các phiếu còn đang chiếm giữ tồn kho.</div>
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đã nhả" value={reservationSummary.releasedCount} />
              <div style={{ color: '#8c8c8c' }}>Phiếu đã được giải phóng tồn giữ chỗ.</div>
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đã xuất đủ" value={reservationSummary.fulfilledCount} />
              <div style={{ color: '#8c8c8c' }}>Phiếu đã hoàn tất theo giao hàng.</div>
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đã hủy" value={reservationSummary.cancelledCount} valueStyle={{ color: reservationSummary.cancelledCount > 0 ? '#cf1322' : undefined }} />
              <div style={{ color: '#8c8c8c' }}>Các trường hợp giữ chỗ không còn hiệu lực.</div>
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Khối lượng đã giữ" value={reservationSummary.reservedQtyTotal} />
              <div style={{ color: '#8c8c8c' }}>Tổng lượng từng được phân bổ cho các phiếu giữ.</div>
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Khối lượng đang chọn" value={reservationSummary.selectedQtyTotal} />
              <div style={{ color: '#8c8c8c' }}>Khối lượng sẽ bị tác động nếu thao tác hàng loạt.</div>
            </div>
          </div>
        </Space>
      </Card>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm mã giữ chỗ, đơn bán, sản phẩm..."
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
        <Button
          disabled={!canManage || selectedOpenRows.length === 0}
          title={!canManage ? 'Bạn chưa có quyền thao tác giữ chỗ tồn kho.' : selectedOpenRows.length === 0 ? 'Chọn ít nhất một phiếu đang giữ để nhả.' : 'Nhả tồn đang giữ trên các phiếu đã chọn'}
          onClick={() => openActionModal('release', selectedOpenRows)}
        >
          Nhả giữ chỗ đã chọn
        </Button>
        <Button
          danger
          disabled={!canManage || selectedOpenRows.length === 0}
          title={!canManage ? 'Bạn chưa có quyền thao tác giữ chỗ tồn kho.' : selectedOpenRows.length === 0 ? 'Chọn ít nhất một phiếu đang giữ để hủy.' : 'Hủy các phiếu giữ chỗ đã chọn với lý do bắt buộc'}
          onClick={() => openActionModal('cancel', selectedOpenRows)}
        >
          Hủy đã chọn
        </Button>
      </div>
      {activeFilterTags.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {activeFilterTags.map((item) => (
            <Tag key={item}>{item}</Tag>
          ))}
          <Tag color="processing">{`Đang hiển thị ${rows.length}/${listQuery.data?.count ?? 0} phiếu`}</Tag>
        </div>
      )}

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
        locale={{ emptyText: <Empty description="Không có phiếu giữ chỗ phù hợp với bộ lọc hiện tại." /> }}
      />

      <Modal
        title={
          actionModal?.type === 'release'
            ? `Nhả giữ chỗ${actionModal.rows.length > 1 ? ` (${actionModal.rows.length} dòng)` : ''}`
            : actionModal
              ? `Hủy phiếu giữ chỗ${actionModal.rows.length > 1 ? ` (${actionModal.rows.length} dòng)` : ''}`
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
                  ? `Để trống để nhả toàn bộ ${actionModal.rows[0]?.active_qty || '0'} đang còn hiệu lực.`
                  : `Nhả hàng loạt sẽ nhả toàn bộ số lượng còn hiệu lực của ${actionModal.rows.length} phiếu giữ chỗ đã chọn.`}
              </div>
              {actionModal.rows.length === 1 ? (
                <Form.Item name="qty" label="Số lượng nhả">
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
