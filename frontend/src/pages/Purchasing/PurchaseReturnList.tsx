import { useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { purchasingApi } from '../../api/purchasing';
import { suppliersApi } from '../../api/purchasing';
import type { PurchaseReturn, PurchaseReturnStatus } from '../../types/purchasing';
import { PAGES } from '../../utils/constants';
import { canManagePurchasingData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';
import PurchaseReturnFormModal from './PurchaseReturnFormModal';

type Filters = {
  status?: string;
};

const STATUS_LABELS: Record<PurchaseReturnStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  POSTED: 'Đã vào sổ',
  CANCELLED: 'Đã hủy',
};

const STATUS_COLORS: Record<PurchaseReturnStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'success',
  POSTED: 'cyan',
  CANCELLED: 'magenta',
};

export default function PurchaseReturnList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [detailReturn, setDetailReturn] = useState<PurchaseReturn | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editReturn, setEditReturn] = useState<PurchaseReturn | null>(null);
  const { config, saveConfig } = useUserPreferences(PAGES.PURCHASING_RETURNS);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);
  const canManage = canManagePurchasingData();

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

  const returnsQuery = useQuery({
    queryKey: ['purchasing-returns', params],
    queryFn: () => purchasingApi.getPurchaseReturns(params),
  });

  const detailQuery = useQuery({
    queryKey: ['purchasing-return', detailReturn?.id],
    queryFn: () => purchasingApi.getPurchaseReturn(detailReturn!.id),
    enabled: !!detailReturn?.id,
  });

  const suppliersQuery = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => suppliersApi.getSuppliers({ is_active: 'true', page_size: 1000 }),
  });

  const deleteMutation = useMutation({
    mutationFn: purchasingApi.deletePurchaseReturn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      messageApi.success('Đã xóa phiếu trả');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: purchasingApi.submitPurchaseReturn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return'] });
      messageApi.success('Đã gửi duyệt phiếu trả');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: purchasingApi.approvePurchaseReturn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return'] });
      messageApi.success('Đã duyệt phiếu trả');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const postMutation = useMutation({
    mutationFn: purchasingApi.postPurchaseReturn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return'] });
      messageApi.success('Đã post phiếu trả');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = returnsQuery.data?.results ?? [];

  const columns: ColumnsType<PurchaseReturn> = [
    { title: 'Mã trả', dataIndex: 'code', width: 150, key: 'code' },
    { title: 'Ngày trả', dataIndex: 'return_date', width: 120, key: 'return_date' },
    { title: 'NCC', dataIndex: 'supplier_name', width: 200, key: 'supplier' },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (status: PurchaseReturnStatus) => (
        <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>
      ),
    },
    {
      title: 'Tổng tiền',
      dataIndex: 'total',
      width: 150,
      render: (val) => Number(val).toLocaleString('vi-VN'),
    },
    {
      title: 'Thao tác',
      width: 300,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailReturn(row)}>
            Xem
          </Button>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            onClick={() => {
              setEditReturn(row);
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
                title: 'Xóa phiếu trả',
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
            Gửi duyệt
          </Button>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'SUBMITTED'}
            type="primary"
            onClick={() => approveMutation.mutate(row.id)}
          >
            Duyệt
          </Button>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'APPROVED'}
            onClick={() => postMutation.mutate(row.id)}
          >
            Post
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Phiếu Trả Hàng</h2>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => {
            setEditReturn(null);
            setFormOpen(true);
          }}
        >
          Tạo phiếu trả
        </Button>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm mã, NCC..."
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
        loading={returnsQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1400 }}
        pagination={{
          current: page,
          pageSize,
          total: returnsQuery.data?.count ?? 0,
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
          emptyText: rows.length === 0 && !returnsQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {(intentSearch || filters.status) ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy phiếu trả phù hợp.</div>
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
              ) : 'Chưa có phiếu trả hàng.'}
            </div>
          ) : undefined,
        }}
      />

      {detailReturn && (
        <Modal
          title={`Chi tiết trả hàng - ${detailReturn.code}`}
          open={!!detailReturn}
          onCancel={() => setDetailReturn(null)}
          width={900}
          footer={null}
        >
          {detailQuery.data && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <strong>Ngày trả:</strong> {detailQuery.data.return_date}
              </div>
              <div>
                <strong>NCC:</strong> {detailQuery.data.supplier_name}
              </div>
              <div>
                <strong>Lý do:</strong> {detailQuery.data.return_reason}
              </div>
              <div>
                <strong>Trạng thái:</strong>{' '}
                <Tag color={STATUS_COLORS[detailQuery.data.status]}>
                  {STATUS_LABELS[detailQuery.data.status]}
                </Tag>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <strong>Ghi chú:</strong> {detailQuery.data.return_notes}
              </div>
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
                { title: 'Đơn giá', dataIndex: 'unit_price', width: 120, render: (v) => Number(v).toLocaleString() },
              ]}
              dataSource={detailQuery.data.lines}
              pagination={false}
            />
          )}
        </Modal>
      )}

      <PurchaseReturnFormModal
        open={formOpen}
        data={editReturn}
        onClose={() => {
          setFormOpen(false);
          setEditReturn(null);
        }}
        onSuccess={() => setPage(1)}
      />
    </>
  );
}
