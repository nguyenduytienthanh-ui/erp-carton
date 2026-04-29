import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { salesApi } from '../../api/sales';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { useDesktopTableSticky } from '../../hooks/useDesktopTableSticky';
import { getToastMessage } from '../../shared/apiError';
import type { DeliveryCarrier } from '../../types/sales';
import { canManageDeliveryCarriers } from '../../utils/authz';
import { PAGES } from '../../utils/constants';

const { Text } = Typography;

type CarrierFilters = {
  active: 'ALL' | 'ACTIVE' | 'INACTIVE';
  internal: 'ALL' | 'INTERNAL' | 'EXTERNAL';
};

type CarrierFormValues = {
  code: string;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  note?: string;
  is_internal: boolean;
  is_active: boolean;
  sort_order: number;
};

type DeliveryCarrierSnapshot = {
  search: string;
  active: CarrierFilters['active'];
  internal: CarrierFilters['internal'];
  pageSize: number;
};

const emptyForm: CarrierFormValues = {
  code: '',
  name: '',
  contact_person: '',
  phone: '',
  email: '',
  note: '',
  is_internal: false,
  is_active: true,
  sort_order: 0,
};

function serializeFilters(filters: CarrierFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): CarrierFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<CarrierFilters>;
    return {
      active: parsed.active ?? 'ACTIVE',
      internal: parsed.internal ?? 'ALL',
    };
  } catch {
    return { active: 'ACTIVE', internal: 'ALL' };
  }
}

function parseSnapshot(value: unknown): DeliveryCarrierSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const active =
    record.active === 'ALL' || record.active === 'INACTIVE' ? (record.active as CarrierFilters['active']) : 'ACTIVE';
  const internal =
    record.internal === 'INTERNAL' || record.internal === 'EXTERNAL'
      ? (record.internal as CarrierFilters['internal'])
      : 'ALL';
  const pageSize = Number(record.pageSize ?? 20);
  return {
    search: typeof record.search === 'string' ? record.search : '',
    active,
    internal,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20,
  };
}

export default function DeliveryCarrierList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManageDeliveryCarriers();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<CarrierFilters>({ active: 'ACTIVE', internal: 'ALL' });
  const [openModal, setOpenModal] = useState(false);
  const [editing, setEditing] = useState<DeliveryCarrier | null>(null);
  const [form] = Form.useForm<CarrierFormValues>();
  const { config, saveConfig, isLoading: isPreferencesLoading } = useUserPreferences(PAGES.SALES_DELIVERY_CARRIERS);
  const desktopTableSticky = useDesktopTableSticky();
  const hydratedRef = useRef(false);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 500,
    filterDebounceMs: 250,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = {
      page_size: pageSize,
      ordering: 'sort_order,name',
    };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.active === 'ACTIVE') next.is_active = 'true';
    if (intentFilters.active === 'INACTIVE') next.is_active = 'false';
    if (intentFilters.internal === 'INTERNAL') next.is_internal = 'true';
    if (intentFilters.internal === 'EXTERNAL') next.is_internal = 'false';
    return next;
  }, [intentFilters, intentSearch, pageSize]);

  const carriersQuery = useQuery({
    queryKey: ['sales-delivery-carriers', params],
    queryFn: () => salesApi.getDeliveryCarriers(params),
  });

  useEffect(() => {
    if (isPreferencesLoading || hydratedRef.current) return;
    const snapshot = parseSnapshot(config);
    if (snapshot) {
      queueMicrotask(() => {
        setSearchInput(snapshot.search);
        setFilters({
          active: snapshot.active,
          internal: snapshot.internal,
        });
      });
    }
    hydratedRef.current = true;
  }, [config, isPreferencesLoading]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const snapshot = parseSnapshot(config);
    if (
      snapshot
      && snapshot.search === searchInput
      && snapshot.active === filters.active
      && snapshot.internal === filters.internal
      && snapshot.pageSize === pageSize
    ) {
      return;
    }
    void saveConfig({
      ...(config as Record<string, unknown>),
      search: searchInput,
      active: filters.active,
      internal: filters.internal,
      pageSize,
    });
  }, [config, filters.active, filters.internal, pageSize, saveConfig, searchInput]);

  const rows = useMemo(() => carriersQuery.data?.results ?? [], [carriersQuery.data?.results]);

  const summary = useMemo(() => ({
    total: rows.length,
    internal: rows.filter((item) => item.is_internal).length,
    inactive: rows.filter((item) => !item.is_active).length,
    inUse: rows.filter((item) => Number(item.total_usage_count ?? 0) > 0).length,
  }), [rows]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['sales-delivery-carriers'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: CarrierFormValues) => salesApi.createDeliveryCarrier(payload),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã thêm đơn vị vận chuyển.');
      setOpenModal(false);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CarrierFormValues }) => salesApi.updateDeliveryCarrier(id, payload),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã cập nhật đơn vị vận chuyển.');
      setOpenModal(false);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => salesApi.deleteDeliveryCarrier(id),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã xóa đơn vị vận chuyển.');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const columns: ColumnsType<DeliveryCarrier> = [
    { title: 'Mã', dataIndex: 'code', width: 120 },
    {
      title: 'Đơn vị vận chuyển',
      dataIndex: 'name',
      width: 240,
      render: (value, row) => (
        <Space direction="vertical" size={2}>
          <span>{value}</span>
          <Space wrap size={4}>
            <Tag color={row.is_internal ? 'blue' : 'green'}>
              {row.is_internal ? 'Nội bộ' : 'Bên ngoài'}
            </Tag>
            {!row.is_active ? <Tag>Ngưng dùng</Tag> : null}
          </Space>
        </Space>
      ),
    },
    { title: 'Người liên hệ', dataIndex: 'contact_person', width: 160, render: (value) => value || '-' },
    { title: 'Điện thoại', dataIndex: 'phone', width: 140, render: (value) => value || '-' },
    { title: 'Email', dataIndex: 'email', width: 200, render: (value) => value || '-' },
    {
      title: 'Đang dùng',
      key: 'usage',
      width: 140,
      render: (_, row) => Number(row.total_usage_count ?? 0).toLocaleString('vi-VN'),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 180,
      fixed: 'right',
      render: (_, row) => {
        const usageCount = Number(row.total_usage_count ?? 0);
        return (
          <Space>
            <Button
              size="small"
              disabled={!canManage}
              onClick={() => {
                setEditing(row);
                form.setFieldsValue({
                  code: row.code,
                  name: row.name,
                  contact_person: row.contact_person || '',
                  phone: row.phone || '',
                  email: row.email || '',
                  note: row.note || '',
                  is_internal: row.is_internal,
                  is_active: row.is_active,
                  sort_order: Number(row.sort_order ?? 0),
                });
                setOpenModal(true);
              }}
            >
              Sửa
            </Button>
            <Button
              size="small"
              danger
              disabled={!canManage || usageCount > 0}
              onClick={() =>
                Modal.confirm({
                  title: `Xóa ${row.name}?`,
                  content: usageCount > 0
                    ? 'Đơn vị này đã phát sinh dữ liệu. Hãy chuyển sang ngưng dùng.'
                    : 'Thao tác này sẽ xóa đơn vị vận chuyển chưa phát sinh dữ liệu.',
                  okText: 'Xóa',
                  cancelText: 'Hủy',
                  okButtonProps: { danger: true, disabled: usageCount > 0 },
                  onOk: () => deleteMutation.mutateAsync(row.id),
                })
              }
            >
              Xóa
            </Button>
          </Space>
        );
      },
    },
  ];

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload: CarrierFormValues = {
      code: values.code.trim().toUpperCase(),
      name: values.name.trim(),
      contact_person: values.contact_person?.trim() || '',
      phone: values.phone?.trim() || '',
      email: values.email?.trim() || '',
      note: values.note?.trim() || '',
      is_internal: Boolean(values.is_internal),
      is_active: Boolean(values.is_active),
      sort_order: Number(values.sort_order ?? 0),
    };
    if (editing?.id) {
      await updateMutation.mutateAsync({ id: editing.id, payload });
      return;
    }
    await createMutation.mutateAsync(payload);
  };

  return (
    <div className="master-list-shell" data-testid="delivery-carriers-root" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <div className="compact-page-header">
        <div className="compact-page-title-stack">
          <div className="compact-page-eyebrow">Bán hàng</div>
          <Text type="secondary" className="compact-page-description">
            Chuẩn hóa đơn vị vận chuyển cho kế hoạch giao hàng và phiếu xuất, nhưng vẫn cho phép nhập ngoài danh mục khi cần.
          </Text>
        </div>
        {canManage ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            data-testid="delivery-carriers-create-button"
            onClick={() => {
              setEditing(null);
              form.setFieldsValue(emptyForm);
              setOpenModal(true);
            }}
          >
            Thêm đơn vị vận chuyển
          </Button>
        ) : null}
      </div>

      <div className="compact-summary-grid compact-summary-grid--dense">
        <div className="compact-kpi-card"><div className="compact-kpi-label">Hiển thị</div><div className="compact-kpi-value">{summary.total}</div></div>
        <div className="compact-kpi-card"><div className="compact-kpi-label">Nội bộ</div><div className="compact-kpi-value">{summary.internal}</div></div>
        <div className="compact-kpi-card"><div className="compact-kpi-label">Ngưng dùng</div><div className="compact-kpi-value">{summary.inactive}</div></div>
        <div className="compact-kpi-card"><div className="compact-kpi-label">Đã phát sinh</div><div className="compact-kpi-value">{summary.inUse}</div></div>
      </div>

      <Alert
        type={summary.inactive > 0 ? 'warning' : 'info'}
        showIcon
        message={summary.inactive > 0 ? 'Có đơn vị vận chuyển đã ngưng dùng trong bộ lọc hiện tại.' : 'Danh mục đơn vị vận chuyển đang sẵn sàng cho planner giao hàng.'}
        description="Nếu đơn vị đã phát sinh ở kế hoạch giao hoặc phiếu xuất, hãy chuyển sang ngưng dùng thay vì xóa để giữ lịch sử snapshot."
      />

      <Card className="compact-section-card">
        <div className="compact-filter-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 12 }}>
          <Input
            data-testid="delivery-carriers-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Tìm mã, tên, liên hệ, điện thoại, email"
            suffix={searchInput ? <QuickClearIcon onClear={() => setSearchInput('')} /> : null}
          />
          <Select
            data-testid="delivery-carriers-active-filter"
            value={filters.active}
            onChange={(value) => setFilters((current) => ({ ...current, active: value }))}
            options={[
              { value: 'ACTIVE', label: 'Đang dùng' },
              { value: 'INACTIVE', label: 'Ngưng dùng' },
              { value: 'ALL', label: 'Tất cả trạng thái' },
            ]}
          />
          <Select
            data-testid="delivery-carriers-internal-filter"
            value={filters.internal}
            onChange={(value) => setFilters((current) => ({ ...current, internal: value }))}
            options={[
              { value: 'ALL', label: 'Tất cả loại' },
              { value: 'INTERNAL', label: 'Nội bộ' },
              { value: 'EXTERNAL', label: 'Bên ngoài' },
            ]}
          />
        </div>

        <Table className="enterprise-data-table table-density-compact"
          rowKey="id"
          loading={carriersQuery.isLoading}
          columns={columns}
          dataSource={rows}
          sticky={desktopTableSticky}
          scroll={{ x: 1100 }}
          size="middle"
          pagination={{
            pageSize,
            hideOnSinglePage: true,
            showSizeChanger: true,
            onShowSizeChange: (_, nextPageSize) => {
              void saveConfig({
                ...(config as Record<string, unknown>),
                pageSize: nextPageSize,
              });
            },
          }}
          locale={{
            emptyText: carriersQuery.isError
              ? 'Không tải được danh mục đơn vị vận chuyển.'
              : 'Chưa có đơn vị vận chuyển nào trong bộ lọc hiện tại.',
          }}
        />
      </Card>

      <Modal
        title={editing ? `Sửa đơn vị vận chuyển ${editing.code}` : 'Thêm đơn vị vận chuyển'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={() => void handleSubmit()}
        okText={editing ? 'Lưu thay đổi' : 'Tạo đơn vị'}
        cancelText="Đóng"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" initialValues={emptyForm}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <Form.Item name="code" label="Mã" rules={[{ required: true, message: 'Vui lòng nhập mã.' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="name" label="Tên đơn vị vận chuyển" rules={[{ required: true, message: 'Vui lòng nhập tên.' }]}>
              <Input />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="contact_person" label="Người liên hệ">
              <Input />
            </Form.Item>
            <Form.Item name="phone" label="Điện thoại">
              <Input />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="email" label="Email">
              <Input />
            </Form.Item>
            <Form.Item name="sort_order" label="Thứ tự hiển thị">
              <Select
                options={[
                  { value: 0, label: '0' },
                  { value: 10, label: '10' },
                  { value: 20, label: '20' },
                  { value: 30, label: '30' },
                ]}
              />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="is_internal" label="Vận chuyển nội bộ" valuePropName="checked">
              <Switch checkedChildren="Nội bộ" unCheckedChildren="Bên ngoài" />
            </Form.Item>
            <Form.Item name="is_active" label="Đang dùng" valuePropName="checked">
              <Switch checkedChildren="Đang dùng" unCheckedChildren="Ngưng dùng" />
            </Form.Item>
          </div>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

