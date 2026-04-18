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
import { canManageStocktake } from '../../utils/authz';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
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

type StocktakeFilters = {
  warehouse?: number;
  status?: StocktakeStatus;
};

type StocktakeViewSnapshot = {
  warehouse?: number;
  status?: StocktakeStatus;
};

type StocktakeNamedPreset = {
  id: string;
  name: string;
  filters: StocktakeViewSnapshot;
};

function parseViewSnapshot(value: unknown): StocktakeViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  return {
    warehouse: typeof obj.warehouse === 'number' ? obj.warehouse : undefined,
    status: typeof obj.status === 'string' ? (obj.status as StocktakeStatus) : undefined,
  };
}

export default function StocktakeList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<StocktakeFilters>({});
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [createForm] = Form.useForm<CreateFormValues>();
  const canManage = canManageStocktake();
  const {
    config,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.INVENTORY_STOCKTAKES);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord.pageSize ?? 20);

  const detailQuery = useQuery({
    queryKey: ['inventory-stocktake-detail', detailId],
    queryFn: () => inventoryApi.getStocktake(detailId as number),
    enabled: detailId != null && canManage,
  });
  const detail = detailQuery.data ?? null;

  const listQuery = useQuery({
    queryKey: ['inventory-stocktakes', page, pageSize, filters],
    queryFn: () =>
      inventoryApi.getStocktakes({
        page,
        page_size: pageSize,
        ordering: '-count_date',
        warehouse: filters.warehouse,
        status: filters.status,
      }),
    enabled: canManage,
  });

  const warehousesQuery = useQuery({
    queryKey: ['inventory-warehouses-list'],
    queryFn: () => inventoryApi.getWarehouses({ page_size: 10000, is_active: 'true', ordering: '-created_at' }),
    enabled: canManage,
  });

  const productsQuery = useQuery({
    queryKey: ['products-list-stocktake'],
    queryFn: () => productsApi.getProducts({ page_size: 10000, ordering: '-id' }),
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
  const warehouseLabelMap = useMemo(
    () => Object.fromEntries(warehouses.map((item) => [item.id, `${item.code} - ${item.name}`])) as Record<number, string>,
    [warehouses]
  );
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (filters.warehouse) {
      tags.push(`Kho: ${warehouseLabelMap[filters.warehouse] ?? `#${filters.warehouse}`}`);
    }
    if (filters.status) {
      tags.push(`Trạng thái: ${STATUS_LABELS[filters.status]}`);
    }
    return tags;
  }, [filters.status, filters.warehouse, warehouseLabelMap]);
  const namedPresets = useMemo<StocktakeNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const obj = value as Record<string, unknown>;
      if (typeof obj.id !== 'string' || typeof obj.name !== 'string') return [];
      const filtersValue = parseViewSnapshot(obj.filters);
      if (!filtersValue) return [];
      return [{ id: obj.id, name: obj.name, filters: filtersValue }];
    });
  }, [configRecord.saved_views]);
  const selectedPreset = useMemo(
    () => namedPresets.find((preset) => preset.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );
  const savedViewSnapshot = useMemo(() => {
    const directSnapshot = parseViewSnapshot(configRecord.saved_view_snapshot);
    if (directSnapshot) return directSnapshot;
    return parseViewSnapshot({
      warehouse: configRecord.warehouse,
      status: configRecord.status,
    });
  }, [configRecord.saved_view_snapshot, configRecord.warehouse, configRecord.status]);
  const commandContextTags = useMemo(() => {
    if (!selectedPreset) return activeFilterTags;
    return [...activeFilterTags, `Mẫu đang dùng: ${selectedPreset.name}`];
  }, [activeFilterTags, selectedPreset]);

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

  const buildCurrentSnapshot = (): StocktakeViewSnapshot => ({
    warehouse: filters.warehouse,
    status: filters.status,
  });

  const applySnapshot = (snapshot: StocktakeViewSnapshot) => {
    setFilters({
      warehouse: snapshot.warehouse,
      status: snapshot.status,
    });
    setPage(1);
  };

  const resetFilters = () => {
    setFilters({});
    setPage(1);
    setSelectedPresetId(undefined);
  };

  const saveCurrentView = async () => {
    const currentSnapshot = buildCurrentSnapshot();
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem kiểm tồn.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem kiểm tồn.');
    }
  };

  const applySavedView = () => {
    if (!savedViewSnapshot) {
      messageApi.warning('Chưa có chế độ xem đã lưu.');
      return;
    }
    applySnapshot(savedViewSnapshot);
    messageApi.success('Đã áp dụng chế độ xem đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const nextPreset: StocktakeNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((preset) => (preset.id === existing.id ? nextPreset : preset))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedPresetId(nextPreset.id);
      setPresetName('');
      setIsPresetModalOpen(false);
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc.' : 'Đã lưu mẫu lọc mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc.');
    }
  };

  const applyNamedPreset = () => {
    if (!selectedPreset) {
      messageApi.warning('Vui lòng chọn mẫu lọc.');
      return;
    }
    applySnapshot(selectedPreset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${selectedPreset.name}".`);
  };

  const deleteNamedPreset = async () => {
    if (!selectedPreset) {
      messageApi.warning('Vui lòng chọn mẫu lọc để xóa.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const nextPresets = namedPresets.filter((preset) => preset.id !== selectedPreset.id);
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedPresetId(undefined);
      messageApi.success(`Đã xóa mẫu lọc "${selectedPreset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc.');
    }
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
        <Space wrap>
          {canManage && (
            <Button data-testid="stocktakes-open-create" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              Tạo phiếu kiểm tồn
            </Button>
          )}
          {selectedPreset ? (
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>
              Mẫu đang dùng: {selectedPreset.name}
            </Tag>
          ) : null}
        </Space>
      </div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div data-testid="stocktakes-warehouse-filter" style={{ display: 'inline-block' }}>
          <Select
            allowClear
            placeholder="Lọc theo kho"
            style={{ width: 260 }}
            value={filters.warehouse}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, warehouse: value }));
              setPage(1);
            }}
            options={warehouses.map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
          />
        </div>
        <div data-testid="stocktakes-status-filter" style={{ display: 'inline-block' }}>
          <Select
            allowClear
            placeholder="Trạng thái"
            style={{ width: 220 }}
            value={filters.status}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, status: value }));
              setPage(1);
            }}
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <Button onClick={resetFilters}>Xóa bộ lọc</Button>
      </div>
      <div
        data-testid="stocktakes-command-strip"
        style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Button data-testid="stocktakes-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
          Lưu chế độ xem
        </Button>
        <Button data-testid="stocktakes-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
          Áp dụng chế độ đã lưu
        </Button>
        <Button
          data-testid="stocktakes-open-preset-modal"
          onClick={() => {
            setPresetName(selectedPreset?.name ?? '');
            setIsPresetModalOpen(true);
          }}
          disabled={isPreferencesLoading}
        >
          Lưu mẫu mới
        </Button>
        <div data-testid="stocktakes-preset-select" style={{ display: 'inline-block' }}>
          <Select<string>
            allowClear
            placeholder="Chọn mẫu kiểm tồn"
            value={selectedPresetId}
            onChange={(value) => setSelectedPresetId(value)}
            disabled={isPreferencesLoading}
            style={{ width: 220 }}
            options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
          />
        </div>
        <Button data-testid="stocktakes-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
          Áp dụng mẫu lọc
        </Button>
        <Button danger data-testid="stocktakes-delete-preset" onClick={() => void deleteNamedPreset()} disabled={isPreferencesLoading}>
          Xóa mẫu lọc
        </Button>
        {savedViewSnapshot ? <Tag color="default">Có chế độ xem đã lưu</Tag> : null}
      </div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {commandContextTags.length > 0 ? (
          commandContextTags.map((tag) => <Tag key={tag}>{tag}</Tag>)
        ) : (
          <Tag color="default">Đang xem toàn bộ phiếu kiểm tồn</Tag>
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
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: async (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize });
            }
          },
        }}
        onRow={(row) => ({ onClick: () => setDetailId(row.id), style: { cursor: 'pointer' } })}
        locale={{
          emptyText: (listQuery.data?.results?.length ?? 0) === 0 && !listQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {commandContextTags.length > 0 ? (
                <>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy phiếu kiểm tồn phù hợp với bộ lọc hiện tại.</div>
                  <Button type="link" onClick={resetFilters}>
                    Xóa bộ lọc
                  </Button>
                </>
              ) : (
                'Chưa có phiếu kiểm tồn. Nhấn Tạo phiếu để thêm mới.'
              )}
            </div>
          ) : undefined,
        }}
      />

      <Modal
        title="Lưu mẫu lọc kiểm tồn"
        open={isPresetModalOpen}
        onCancel={() => {
          setIsPresetModalOpen(false);
          setPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Hủy"
      >
        <Input
          data-testid="stocktakes-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Chờ hoàn tất / Theo kho nguyên liệu"
          maxLength={80}
          autoFocus
        />
      </Modal>

      <Modal
        title="Tạo phiếu kiểm tồn"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        onOk={() => void handleCreate()}
        confirmLoading={createMutation.isPending}
        okText="Tạo phiếu"
        cancelText="Đóng"
        width={640}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" initialValues={{ count_date: dayjs(), lines: [{}] }}>
          <Form.Item name="warehouse" label="Kho" rules={[{ required: true }]}>
            <Select
              data-testid="stocktake-warehouse"
              placeholder="Chọn kho"
              options={warehouses.map((w) => ({ label: `${w.code} - ${w.name}`, value: w.id }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="count_date" label="Ngày kiểm" rules={[{ required: true }]}>
            <DatePicker data-testid="stocktake-count-date" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea data-testid="stocktake-note" rows={2} placeholder="Ghi chú" />
          </Form.Item>
          <Form.Item label="Dòng kiểm" required>
            <Form.List name="lines">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item name={[field.name, 'product_id']} rules={[{ required: true }]} style={{ width: 280 }}>
                        <Select
                          data-testid={`stocktake-line-product-${field.name}`}
                          placeholder="Chọn sản phẩm"
                          options={products.map((p) => ({ label: `${p.code} - ${p.name}`, value: p.id }))}
                          showSearch
                          optionFilterProp="label"
                        />
                      </Form.Item>
                      <Form.Item name={[field.name, 'count_qty']} initialValue={0} rules={[{ required: true }]} style={{ width: 100 }}>
                        <InputNumber data-testid={`stocktake-line-qty-${field.name}`} min={0} style={{ width: '100%' }} />
                      </Form.Item>
                      <Button type="link" danger onClick={() => remove(field.name)}>Xóa</Button>
                    </Space>
                  ))}
                  <Button data-testid="stocktake-add-line" type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>Thêm dòng</Button>
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
                <Button
                  data-testid={`stocktake-complete-${detail.id}`}
                  type="primary"
                  onClick={() => completeMutation.mutate(detail.id)}
                  loading={completeMutation.isPending}
                >
                  Hoàn tất
                </Button>
                <Button
                  data-testid={`stocktake-delete-${detail.id}`}
                  danger
                  onClick={() => { if (window.confirm('Xóa phiếu này?')) deleteMutation.mutate(detail.id); }}
                  loading={deleteMutation.isPending}
                >
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
