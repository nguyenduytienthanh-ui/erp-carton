import { useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Rate, Space, Statistic, Switch, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { purchasingApi } from '../../api/purchasing';
import type { Supplier } from '../../types/purchasing';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManagePurchasingData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

const { Text, Title } = Typography;

type SupplierFilters = { activeOnly: boolean };
type SupplierFormValues = Omit<Supplier, 'id' | 'created_at' | 'updated_at'>;

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};

const emptyForm: SupplierFormValues = {
  code: '',
  name: '',
  company_name: '',
  tax_code: '',
  phone: '',
  email: '',
  address: '',
  contact_person: '',
  contact_phone: '',
  payment_terms_days: 30,
  is_preferred: false,
  rating: 3,
  note: '',
  is_active: true,
};

function serializeFilters(filters: SupplierFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): SupplierFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<SupplierFilters>;
    return { activeOnly: parsed.activeOnly !== false };
  } catch {
    return { activeOnly: true };
  }
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function SupplierList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManagePurchasingData();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<SupplierFilters>({ activeOnly: true });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<SupplierFormValues>();
  const { config, saveConfig } = useUserPreferences(PAGES.PURCHASING_SUPPLIERS);
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
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: 'code' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.activeOnly) next.is_active = 'true';
    return next;
  }, [intentFilters, intentSearch, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['purchasing-suppliers', params],
    queryFn: () => purchasingApi.getSuppliers(params),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['purchasing-suppliers'] });
  };

  const createMutation = useMutation({
    mutationFn: purchasingApi.createSupplier,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã thêm nhà cung cấp');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SupplierFormValues> }) =>
      purchasingApi.updateSupplier(id, payload),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã cập nhật nhà cung cấp');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: purchasingApi.deleteSupplier,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã xóa nhà cung cấp');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);

  const summary = useMemo(() => {
    const activeCount = rows.filter((row) => row.is_active).length;
    const preferredCount = rows.filter((row) => row.is_preferred).length;
    const avgRating = rows.length ? rows.reduce((acc, row) => acc + toNumber(row.rating), 0) / rows.length : 0;
    const missingContactCount = rows.filter((row) => !row.contact_person && !row.phone && !row.email).length;
    return { activeCount, preferredCount, avgRating, missingContactCount };
  }, [rows]);

  const statusAlert = useMemo(() => {
    if (summary.missingContactCount > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${summary.missingContactCount} nhà cung cấp thiếu thông tin liên hệ rõ ràng.`,
        description: 'Nên bổ sung người liên hệ, điện thoại hoặc email trước khi dùng các đối tác này cho luồng mua hàng khẩn.',
      };
    }
    if (summary.preferredCount > 0) {
      return {
        type: 'info' as const,
        message: `Hiện có ${summary.preferredCount} nhà cung cấp được đánh dấu ưu tiên.`,
        description: 'Bạn có thể dùng màn này để rà lại hạn thanh toán và chất lượng đối tác trước khi phân bổ forecast mua hàng.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Danh mục nhà cung cấp đang gọn và sẵn sàng vận hành.',
      description: 'Không có cảnh báo nổi bật trên bộ lọc hiện tại.',
    };
  }, [summary.missingContactCount, summary.preferredCount]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    tags.push(intentFilters.activeOnly ? 'Chỉ hiển thị nhà cung cấp đang dùng' : 'Hiển thị cả nhà cung cấp ngưng dùng');
    return tags;
  }, [intentFilters.activeOnly, intentSearch]);

  const columns: ColumnsType<Supplier> = [
    { title: 'Mã NCC', dataIndex: 'code', width: 120 },
    {
      title: 'Tên NCC',
      dataIndex: 'name',
      width: 220,
      render: (value, row) => (
        <Space direction="vertical" size={2}>
          <span>{value}</span>
          <Space wrap size={4}>
            {row.is_preferred ? <Tag color="success">Ưu tiên</Tag> : null}
            {!row.is_active ? <Tag color="default">Ngưng dùng</Tag> : null}
          </Space>
        </Space>
      ),
    },
    { title: 'Công ty', dataIndex: 'company_name', width: 220, render: (value) => value || '-' },
    { title: 'Người liên hệ', dataIndex: 'contact_person', width: 160, render: (value) => value || '-' },
    { title: 'Điện thoại', dataIndex: 'phone', width: 140, render: (value) => value || '-' },
    { title: 'Email', dataIndex: 'email', width: 200, render: (value) => value || '-' },
    { title: 'Hạn TT', dataIndex: 'payment_terms_days', width: 100, render: (value) => `${value} ngày` },
    {
      title: 'Đánh giá',
      dataIndex: 'rating',
      width: 150,
      render: (value) => <Rate disabled allowHalf value={toNumber(value)} />,
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            disabled={!canManage}
            onClick={() => {
              setEditing(row);
              form.setFieldsValue({ ...row });
              setOpenModal(true);
            }}
          >
            Sửa
          </Button>
          <Button
            size="small"
            danger
            disabled={!canManage}
            onClick={() =>
              Modal.confirm({
                title: `Xóa nhà cung cấp ${row.code}?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutateAsync(row.id),
              })
            }
          >
            Xóa
          </Button>
        </Space>
      ),
    },
  ];

  const onSubmit = async () => {
    const values = await form.validateFields();
    const payload: SupplierFormValues = {
      ...values,
      code: values.code.trim().toUpperCase(),
      name: values.name.trim(),
      company_name: values.company_name?.trim() || '',
      tax_code: values.tax_code?.trim() || '',
      phone: values.phone?.trim() || '',
      email: values.email?.trim() || '',
      address: values.address?.trim() || '',
      contact_person: values.contact_person?.trim() || '',
      contact_phone: values.contact_phone?.trim() || '',
      note: values.note?.trim() || '',
      payment_terms_days: toNumber(values.payment_terms_days ?? 30),
      rating: toNumber(values.rating ?? 3),
    };
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setOpenModal(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}

      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">Mua hàng</Tag>
                <Tag color="gold">Nhà cung cấp</Tag>
                <Tag color={canManage ? 'processing' : 'default'}>{canManage ? 'Danh mục vận hành' : 'Theo quyền hiện tại'}</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>Trung tâm nhà cung cấp</Title>
              <Text type="secondary">Quản lý đối tác mua hàng, hạn thanh toán, mức ưu tiên và độ sẵn sàng vận hành của danh mục cung ứng.</Text>
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={() => {
                setEditing(null);
                form.setFieldsValue(emptyForm);
                setOpenModal(true);
              }}
            >
              Thêm NCC
            </Button>
          </div>

          <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đối tác trên trang" value={rows.length} suffix="NCC" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đang hoạt động" value={summary.activeCount} suffix="NCC" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="NCC ưu tiên" value={summary.preferredCount} suffix="NCC" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Điểm đánh giá TB" value={summary.avgRating} precision={1} suffix="/5" />
            </div>
          </div>
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
            <Space>
              <span style={{ color: '#595959' }}>Chỉ hiển thị đang dùng</span>
              <Switch
                checked={filters.activeOnly}
                onChange={(checked) => {
                  setFilters({ activeOnly: checked });
                  setPage(1);
                }}
              />
            </Space>
            <Button
              onClick={() => {
                setSearchInput('');
                setFilters({ activeOnly: true });
                setPage(1);
              }}
            >
              Xóa bộ lọc
            </Button>
          </div>

          <Space wrap>
            {activeFilterTags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1500 }}
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
        title={editing ? `Sửa nhà cung cấp ${editing.code}` : 'Thêm nhà cung cấp'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={onSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={720}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="code" label="Mã NCC" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="name" label="Tên NCC" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="company_name" label="Công ty">
              <Input />
            </Form.Item>
            <Form.Item name="tax_code" label="Mã số thuế">
              <Input />
            </Form.Item>
            <Form.Item name="phone" label="Điện thoại">
              <Input />
            </Form.Item>
            <Form.Item name="email" label="Email">
              <Input />
            </Form.Item>
            <Form.Item name="contact_person" label="Người liên hệ">
              <Input />
            </Form.Item>
            <Form.Item name="contact_phone" label="SĐT liên hệ">
              <Input />
            </Form.Item>
            <Form.Item name="payment_terms_days" label="Hạn thanh toán (ngày)">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="rating" label="Đánh giá (1-5)">
              <InputNumber min={1} max={5} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="address" label="Địa chỉ">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'flex', gap: 24 }}>
            <Form.Item name="is_preferred" label="NCC ưu tiên" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
