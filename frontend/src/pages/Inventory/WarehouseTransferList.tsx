import { useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EyeOutlined, PlusOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import type { WarehouseTransfer, WarehouseTransferStatus } from '../../types/inventory';
import { PAGES } from '../../utils/constants';
import { canManageInventoryData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import WarehouseTransferFormModal from './WarehouseTransferFormModal';

type Filters = {
  status?: string;
};

const STATUS_LABELS: Record<WarehouseTransferStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ xác nhận',
  IN_TRANSIT: 'Đang vận chuyển',
  RECEIVED: 'Đã nhận',
  CANCELLED: 'Đã hủy',
};

const STATUS_COLORS: Record<WarehouseTransferStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  IN_TRANSIT: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'magenta',
};

export default function WarehouseTransferList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [detailTransfer, setDetailTransfer] = useState<WarehouseTransfer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTransfer, setEditTransfer] = useState<WarehouseTransfer | null>(null);
  const { config, saveConfig } = useUserPreferences(PAGES.INVENTORY_WAREHOUSE_TRANSFERS);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);
  const canManage = canManageInventoryData();

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (f) => JSON.stringify(f),
    parseFilters: (s) => {
      try {
        return JSON.parse(s);
      } catch {
        return {};
      }
    },
  });

  const params = {
    page,
    page_size: pageSize,
    q: intentSearch.trim() || undefined,
    status: intentFilters?.status || undefined,
  };

  const transfersQuery = useQuery({
    queryKey: ['inventory-warehouse-transfers', params],
    queryFn: () => inventoryApi.getWarehouseTransfers(params),
  });

  const detailQuery = useQuery({
    queryKey: ['inventory-warehouse-transfer', detailTransfer?.id],
    queryFn: () => inventoryApi.getWarehouseTransfer(detailTransfer!.id),
    enabled: !!detailTransfer?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: inventoryApi.deleteWarehouseTransfer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      messageApi.success('Đã xóa phiếu chuyển kho');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: inventoryApi.submitTransfer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfer'] });
      messageApi.success('Đã gửi phiếu chuyển');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const postMutation = useMutation({
    mutationFn: inventoryApi.postTransfer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfer'] });
      messageApi.success('Đã post phiếu chuyển');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const receiveMutation = useMutation({
    mutationFn: inventoryApi.receiveTransfer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfer'] });
      messageApi.success('Đã nhận phiếu chuyển');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = transfersQuery.data?.results ?? [];

  const columns: ColumnsType<WarehouseTransfer> = [
    { title: 'Mã chuyển', dataIndex: 'code', width: 150, key: 'code' },
    { title: 'Ngày chuyển', dataIndex: 'transfer_date', width: 120, key: 'transfer_date' },
    {
      title: 'Từ kho',
      dataIndex: 'from_warehouse_code',
      width: 120,
      key: 'from_warehouse',
    },
    {
      title: 'Đến kho',
      dataIndex: 'to_warehouse_code',
      width: 120,
      key: 'to_warehouse',
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (status: WarehouseTransferStatus) => (
        <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>
      ),
    },
    {
      title: 'Thao tác',
      width: 350,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailTransfer(row)}>
            Xem
          </Button>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            onClick={() => {
              setEditTransfer(row);
              setFormOpen(true);
            }}
          >
            Sửa
          </Button>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            danger
            icon={<DeleteOutlined />}
            onClick={() =>
              Modal.confirm({
                title: 'Xóa phiếu chuyển',
                content: `Xóa ${row.code}?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutate(row.id),
              })
            }
          />
          <Button
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            onClick={() => submitMutation.mutate(row.id)}
          >
            Gửi xác nhận
          </Button>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'SUBMITTED'}
            onClick={() => postMutation.mutate(row.id)}
          >
            Post
          </Button>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'IN_TRANSIT'}
            type="primary"
            onClick={() => receiveMutation.mutate(row.id)}
          >
            Nhận hàng
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Chuyển kho</h2>
        <Space>
          <Button
            icon={<DownloadOutlined />}
            disabled={rows.length === 0}
            onClick={() => {
              const exportData = rows.map((r) => ({
                'Mã chuyển': r.code,
                'Ngày': r.transfer_date,
                'Từ kho': r.from_warehouse_code,
                'Đến kho': r.to_warehouse_code,
                'Trạng thái': STATUS_LABELS[r.status],
              }));
              downloadCSV(exportData, 'phieu-chuyen-kho');
            }}
          >
            Xuất CSV
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canManage}
            onClick={() => {
              setEditTransfer(null);
              setFormOpen(true);
            }}
          >
            Tạo phiếu chuyển
          </Button>
        </Space>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm mã chuyển..."
          style={{ width: 250 }}
          suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
        />
        <Select
          style={{ width: 200 }}
          placeholder="Trạng thái"
          allowClear
          value={filters.status || undefined}
          onChange={(value) => {
            setFilters({ ...filters, status: value });
            setPage(1);
          }}
          options={Object.entries(STATUS_LABELS).map(([key, label]) => ({ value: key, label }))}
        />
      </div>

      <Table
        rowKey="id"
        loading={transfersQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1500 }}
        pagination={{
          current: page,
          pageSize,
          total: transfersQuery.data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              saveConfig({ ...config, pageSize: nextPageSize });
            }
          },
        }}
        locale={{
          emptyText: rows.length === 0 && !transfersQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {(intentSearch || filters.status) ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy phiếu chuyển phù hợp.</div>
                  <Button
                    type="link"
                    onClick={() => {
                      setSearchInput('');
                      setFilters({});
                      setPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : 'Chưa có phiếu chuyển kho.'}
            </div>
          ) : undefined,
        }}
      />

      {detailTransfer && (
        <Modal
          title={`Chi tiết chuyển kho - ${detailTransfer.code}`}
          open={!!detailTransfer}
          onCancel={() => setDetailTransfer(null)}
          width={900}
          footer={null}
        >
          {detailQuery.data && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <strong>Ngày chuyển:</strong> {detailQuery.data.transfer_date}
              </div>
              <div>
                <strong>Từ kho:</strong> {detailQuery.data.from_warehouse_code}
              </div>
              <div>
                <strong>Đến kho:</strong> {detailQuery.data.to_warehouse_code}
              </div>
              <div>
                <strong>Trạng thái:</strong>{' '}
                <Tag color={STATUS_COLORS[detailQuery.data.status]}>
                  {STATUS_LABELS[detailQuery.data.status]}
                </Tag>
              </div>
              {detailQuery.data.reference && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <strong>Tham chiếu:</strong> {detailQuery.data.reference}
                </div>
              )}
              {detailQuery.data.note && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <strong>Ghi chú:</strong> {detailQuery.data.note}
                </div>
              )}
            </div>
          )}
          {detailQuery.data?.lines && (
            <Table
              style={{ marginTop: 16 }}
              rowKey="id"
              columns={[
                { title: 'Sản phẩm', dataIndex: 'product_name', width: 200 },
                { title: 'Mã', dataIndex: 'product_code', width: 100 },
                { title: 'Số lượng', dataIndex: 'qty', width: 100 },
                { title: 'Đã nhận', dataIndex: 'received_qty', width: 100 },
              ]}
              dataSource={detailQuery.data.lines}
              pagination={false}
            />
          )}
        </Modal>
      )}

      <WarehouseTransferFormModal
        open={formOpen}
        data={editTransfer}
        onClose={() => {
          setFormOpen(false);
          setEditTransfer(null);
        }}
        onSuccess={() => setPage(1)}
      />
    </>
  );
}
