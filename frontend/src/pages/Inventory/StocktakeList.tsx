import { useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import { productsApi } from '../../api/products';
import type { Stocktake, StocktakeLine, StocktakeStatus } from '../../types/inventory';
import { PAGES } from '../../utils/constants';
import { canManageStocktake } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

const STATUS_LABELS: Record<StocktakeStatus, string> = {
  DRAFT: 'Nháp',
  COMPLETED: 'Đã hoàn tất',
  CANCELLED: 'Đã hủy',
};
const STATUS_COLORS: Record<StocktakeStatus, string> = {
  DRAFT: 'default',
  COMPLETED: 'success',
  CANCELLED: 'default',
};

type CreateFormValues = {
  warehouse: number;
  count_date: string;
  note: string;
  lines: Array<{ product_id: number; count_qty: number; note?: string }>;
};

export default function StocktakeList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [createForm] = Form.useForm<CreateFormValues>();
  const canManage = canManageStocktake();
  const pageSize = 20;

  const detailQuery = useQuery({
    queryKey: ['inventory-stocktake-detail', detailId],
    queryFn: () => inventoryApi.getStocktake(detailId as number),
    enabled: detailId != null && canManage,
  });
  const detail = detailQuery.data ?? null;

  const listQuery = useQuery({
    queryKey: ['inventory-stocktakes', page, pageSize],
    queryFn: () => inventoryApi.getStocktakes({ page, page_size: pageSize, ordering: '-count_date' }),
    enabled: canManage,
  });

  const warehousesQuery = useQuery({
    queryKey: ['inventory-warehouses-list'],
    queryFn: () => inventoryApi.getWarehouses({ page_size: 100, is_active: 'true', ordering: 'code' }),
    enabled: createOpen && canManage,
  });

  const productsQuery = useQuery({
    queryKey: ['products-list-stocktake'],
    queryFn: () => productsApi.getProducts({ page_size: 500, ordering: 'code' }),
    enabled: createOpen && canManage,
  });

  const createMutation = useMutation({
    mutationFn: inventoryApi.createStocktake,
    onSuccess: () => {
      messageApi.success('Tạo phiếu kiểm tồn thành công.');
      setCreateOpen(false);
      createForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['inventory-stocktakes'] });
    },
    onError: (err) => messageApi.error(getToastMessage(err)),
  });

  const completeMutation = useMutation({
    mutationFn: inventoryApi.completeStocktake,
    onSuccess: () => {
      messageApi.success('Đã hoàn tất phiếu kiểm tồn.');
      setDetailId(null);
      void queryClient.invalidateQueries({ queryKey: ['inventory-stocktakes'] });
    },
    onError: (err) => messageApi.error(getToastMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: inventoryApi.deleteStocktake,
    onSuccess: () => {
      messageApi.success('Đã xóa phiếu.');
      setDetailId(null);
      void queryClient.invalidateQueries({ queryKey: ['inventory-stocktakes'] });
    },
    onError: (err) => messageApi.error(getToastMessage(err)),
  });

  const warehouses = useMemo(() => warehousesQuery.data?.results ?? [], [warehousesQuery.data]);
  const products = useMemo(() => productsQuery.data?.results ?? [], [productsQuery.data]);

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    const lines = (values.lines ?? []).filter((l: { product_id?: number }) => l.product_id);
    if (lines.length === 0) {
      messageApi.warning('Thêm ít nhất một dòng sản phẩm.');
      return;
    }
    await createMutation.mutateAsync({
      warehouse: values.warehouse,
      count_date: dayjs(values.count_date).format('YYYY-MM-DD'),
      note: values.note ?? '',
      lines_data: lines.map((l: { product_id: number; count_qty: number; note?: string }) => ({
        product_id: l.product_id,
        count_qty: Number(l.count_qty ?? 0),
        note: l.note,
      })),
    });
  };

  const columns: ColumnsType<Stocktake> = [
    { title: 'Mã', dataIndex: 'code', width: 140 },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 180 },
    { title: 'Ngày kiểm', dataIndex: 'count_date', width: 120, render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (s: StocktakeStatus) => <Tag color={STATUS_COLORS[s]}>{STATUS_LABELS[s]}</Tag>,
    },
    { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
  ];

  const lineColumns: ColumnsType<StocktakeLine> = [
    { title: '#', dataIndex: 'line_number', width: 50 },
    { title: 'Mã SP', dataIndex: 'product_code', width: 120 },
    { title: 'Tên SP', dataIndex: 'product_name', width: 200 },
    { title: 'Tồn hệ thống', dataIndex: 'system_qty', width: 110, align: 'right', render: (v) => Number(v).toLocaleString('vi-VN') },
    { title: 'Tồn đếm', dataIndex: 'count_qty', width: 110, align: 'right', render: (v) => Number(v).toLocaleString('vi-VN') },
    {
      title: 'Chênh lệch',
      dataIndex: 'variance_qty',
      width: 110,
      align: 'right',
      render: (v: string) => {
        const n = Number(v);
        return <span style={{ color: n !== 0 ? '#cf1322' : undefined }}>{n.toLocaleString('vi-VN')}</span>;
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {contextHolder}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Kiểm tồn</h2>
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Tạo phiếu kiểm tồn
          </Button>
        )}
      </div>
      <Table<Stocktake>
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={listQuery.data?.results ?? []}
        pagination={{
          current: page,
          pageSize,
          total: listQuery.data?.count ?? 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        onRow={(row) => ({ onClick: () => setDetailId(row.id), style: { cursor: 'pointer' } })}
        locale={{
          emptyText: (listQuery.data?.results?.length ?? 0) === 0 && !listQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              Chưa có phiếu kiểm tồn. Nhấn Tạo phiếu để thêm mới.
            </div>
          ) : undefined,
        }}
      />

      <Modal
        title="Tạo phiếu kiểm tồn"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        onOk={() => void handleCreate()}
        confirmLoading={createMutation.isPending}
        width={640}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" initialValues={{ count_date: dayjs(), lines: [{}] }}>
          <Form.Item name="warehouse" label="Kho" rules={[{ required: true }]}>
            <Select
              placeholder="Chọn kho"
              options={warehouses.map((w) => ({ label: `${w.code} - ${w.name}`, value: w.id }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="count_date" label="Ngày kiểm" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} placeholder="Ghi chú" />
          </Form.Item>
          <Form.Item label="Dòng kiểm" required>
            <Form.List name="lines">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item name={[field.name, 'product_id']} rules={[{ required: true }]} style={{ width: 280 }}>
                        <Select
                          placeholder="Chọn sản phẩm"
                          options={products.map((p) => ({ label: `${p.code} - ${p.name}`, value: p.id }))}
                          showSearch
                          optionFilterProp="label"
                        />
                      </Form.Item>
                      <Form.Item name={[field.name, 'count_qty']} initialValue={0} rules={[{ required: true }]} style={{ width: 100 }}>
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                      <Button type="link" danger onClick={() => remove(field.name)}>Xóa</Button>
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>Thêm dòng</Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `Phiếu kiểm tồn ${detail.code}` : 'Chi tiết'}
        open={detailId != null}
        onClose={() => setDetailId(null)}
        width={720}
      >
        {detailQuery.isLoading && detailId != null ? (
          <div style={{ padding: 24, textAlign: 'center' }}>Đang tải...</div>
        ) : detail ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <Space>
                <span>Kho: {detail.warehouse_name}</span>
                <span>Ngày: {dayjs(detail.count_date).format('DD/MM/YYYY')}</span>
                <Tag color={STATUS_COLORS[detail.status]}>{STATUS_LABELS[detail.status]}</Tag>
              </Space>
              {detail.note && <div style={{ marginTop: 8, color: '#666' }}>{detail.note}</div>}
            </div>
            <Table<StocktakeLine>
              rowKey="id"
              size="small"
              pagination={false}
              columns={lineColumns}
              dataSource={detail.lines ?? []}
            />
            {canManage && detail.status === 'DRAFT' && (
              <Space style={{ marginTop: 16 }}>
                <Button type="primary" onClick={() => completeMutation.mutate(detail.id)} loading={completeMutation.isPending}>
                  Hoàn tất
                </Button>
                <Button danger onClick={() => { if (window.confirm('Xóa phiếu này?')) deleteMutation.mutate(detail.id); }} loading={deleteMutation.isPending}>
                  Xóa phiếu
                </Button>
              </Space>
            )}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
