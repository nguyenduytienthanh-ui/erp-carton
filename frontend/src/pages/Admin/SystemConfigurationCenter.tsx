import { useCallback, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axiosInstance from '../../api/axios';
import PageHeader from '../../components/PageHeader/PageHeader';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DocumentType {
  id: number; code: string; name: string; entity_type: string;
  prefix: string; description: string; sort_order: number;
  is_active: boolean; created_at: string; updated_at: string;
  [key: string]: unknown;
}

interface TaxRate {
  id: number; code: string; name: string; rate_pct: string;
  applies_to: 'SALES' | 'PURCHASE' | 'BOTH'; description: string;
  sort_order: number; is_default: boolean; is_active: boolean;
  created_at: string; updated_at: string;
  [key: string]: unknown;
}

interface Shift {
  id: number; code: string; name: string; short_label: string;
  start_time: string | null; end_time: string | null;
  capacity_hours: string; description: string;
  sort_order: number; is_active: boolean; created_at: string; updated_at: string;
  [key: string]: unknown;
}

interface ExpenseCategory {
  id: number; code: string; name: string; description: string;
  color: string; sort_order: number; is_active: boolean;
  created_at: string; updated_at: string;
  [key: string]: unknown;
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function listConfig<T>(path: string): Promise<T[]> {
  const response = await axiosInstance.get<T[] | { results: T[] }>(path, { params: { page_size: 200 } });
  const data = response.data;
  return (Array.isArray(data) ? data : (data as { results: T[] }).results) ?? [];
}

async function saveConfig<T>(path: string, id: number | null, payload: Partial<T>): Promise<T> {
  if (id) {
    const response = await axiosInstance.patch<T>(`${path}${id}/`, payload);
    return response.data;
  }
  const response = await axiosInstance.post<T>(path, payload);
  return response.data;
}

// ── Generic Config Table ───────────────────────────────────────────────────────

type GenericRecord = { id?: number; [key: string]: unknown };

interface ConfigTableProps<T extends GenericRecord> {
  queryKey: string;
  apiPath: string;
  columns: TableColumnsType<T>;
  formFields: React.ReactNode;
  title: string;
  defaultValues?: Partial<T>;
}

function ConfigTable<T extends GenericRecord>({
  queryKey,
  apiPath,
  columns,
  formFields,
  title,
  defaultValues = {},
}: ConfigTableProps<T>) {
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [queryKey],
    queryFn: () => listConfig<T>(apiPath),
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Partial<T>) => saveConfig<T>(apiPath, editingId, payload),
    onSuccess: () => {
      messageApi.success(editingId ? 'Đã cập nhật.' : 'Đã tạo mới.');
      setModalOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: () => messageApi.error('Lưu thất bại.'),
  });

  const handleEdit = useCallback((record: T) => {
    setEditingId(record.id ?? null);
    form.setFieldsValue(record);
    setModalOpen(true);
  }, [form]);

  const handleAdd = useCallback(() => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue(defaultValues);
    setModalOpen(true);
  }, [form, defaultValues]);

  const allColumns: TableColumnsType<T> = [
    ...columns,
    {
      title: '',
      width: 60,
      fixed: 'right',
      render: (_, record) => (
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => handleEdit(record)}
        />
      ),
    },
  ];

  return (
    <div>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ color: '#64748b', fontSize: 13 }}>{query.data?.length ?? 0} mục</span>
        <Space>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: [queryKey] })}
            loading={query.isFetching}
          />
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={handleAdd}
          >
            Thêm
          </Button>
        </Space>
      </div>

      <Table
        columns={allColumns}
        dataSource={query.data ?? []}
        rowKey="id"
        size="small"
        loading={query.isLoading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={editingId ? `Sửa ${title}` : `Thêm ${title}`}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values: Partial<T>) => saveMutation.mutate(values)}
        >
          {formFields}
        </Form>
      </Modal>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function SystemConfigurationCenter() {
  return (
    <div>
      <PageHeader
        title="Cấu hình hệ thống"
        subtitle="Quản lý các danh mục cấu hình nền tảng: loại chứng từ, thuế suất, ca làm việc và danh mục chi phí."
        icon={<SettingOutlined />}
      />

      <Tabs
        size="small"
        items={[
          {
            key: 'document-types',
            label: 'Loại chứng từ',
            children: (
              <ConfigTable<DocumentType>
                title="loại chứng từ"
                queryKey="config-document-types"
                apiPath="/config/document-types/"
                defaultValues={{ is_active: true, sort_order: 0 }}
                columns={[
                  { title: 'Mã', dataIndex: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'Tên', dataIndex: 'name', width: 160 },
                  { title: 'Entity type', dataIndex: 'entity_type', width: 140, render: (v: string) => <code style={{ fontSize: 11 }}>{v}</code> },
                  { title: 'Prefix', dataIndex: 'prefix', width: 80 },
                  { title: 'Thứ tự', dataIndex: 'sort_order', width: 70, align: 'right' },
                  { title: 'Kích hoạt', dataIndex: 'is_active', width: 80, render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? 'Có' : 'Tắt'}</Tag> },
                ] as TableColumnsType<DocumentType>}
                formFields={
                  <>
                    <Form.Item name="code" label="Mã" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="name" label="Tên" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="entity_type" label="Entity type" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="prefix" label="Prefix">
                      <Input />
                    </Form.Item>
                    <Form.Item name="description" label="Mô tả">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="sort_order" label="Thứ tự">
                      <InputNumber style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </>
                }
              />
            ),
          },
          {
            key: 'tax-rates',
            label: 'Thuế suất',
            children: (
              <ConfigTable<TaxRate>
                title="thuế suất"
                queryKey="config-tax-rates"
                apiPath="/config/tax-rates/"
                defaultValues={{ is_active: true, is_default: false, sort_order: 0, applies_to: 'BOTH' }}
                columns={[
                  { title: 'Mã', dataIndex: 'code', width: 80, render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'Tên', dataIndex: 'name', width: 120 },
                  { title: 'Mức (%)', dataIndex: 'rate_pct', width: 90, align: 'right', render: (v: string) => `${v}%` },
                  { title: 'Áp dụng', dataIndex: 'applies_to', width: 100, render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'Mặc định', dataIndex: 'is_default', width: 80, render: (v: boolean) => v ? <Tag color="blue">Mặc định</Tag> : null },
                  { title: 'Kích hoạt', dataIndex: 'is_active', width: 80, render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? 'Có' : 'Tắt'}</Tag> },
                ] as TableColumnsType<TaxRate>}
                formFields={
                  <>
                    <Form.Item name="code" label="Mã" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="name" label="Tên" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="rate_pct" label="Mức thuế (%)" rules={[{ required: true }]}>
                      <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.01} />
                    </Form.Item>
                    <Form.Item name="applies_to" label="Áp dụng cho">
                      <Select options={[{ value: 'BOTH', label: 'Cả hai' }, { value: 'SALES', label: 'Bán hàng' }, { value: 'PURCHASE', label: 'Mua hàng' }]} />
                    </Form.Item>
                    <Form.Item name="is_default" label="Mặc định" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </>
                }
              />
            ),
          },
          {
            key: 'shifts',
            label: 'Ca làm việc',
            children: (
              <ConfigTable<Shift>
                title="ca làm việc"
                queryKey="config-shifts"
                apiPath="/config/shifts/"
                defaultValues={{ is_active: true, sort_order: 0 }}
                columns={[
                  { title: 'Mã', dataIndex: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'Tên', dataIndex: 'name', width: 140 },
                  { title: 'Nhãn ngắn', dataIndex: 'short_label', width: 80 },
                  { title: 'Bắt đầu', dataIndex: 'start_time', width: 80 },
                  { title: 'Kết thúc', dataIndex: 'end_time', width: 80 },
                  { title: 'Giờ/ca', dataIndex: 'capacity_hours', width: 80, align: 'right' },
                  { title: 'Kích hoạt', dataIndex: 'is_active', width: 80, render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? 'Có' : 'Tắt'}</Tag> },
                ] as TableColumnsType<Shift>}
                formFields={
                  <>
                    <Form.Item name="code" label="Mã" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="name" label="Tên ca" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="short_label" label="Nhãn ngắn">
                      <Input />
                    </Form.Item>
                    <Form.Item name="start_time" label="Giờ bắt đầu">
                      <Input placeholder="HH:MM:SS" />
                    </Form.Item>
                    <Form.Item name="end_time" label="Giờ kết thúc">
                      <Input placeholder="HH:MM:SS" />
                    </Form.Item>
                    <Form.Item name="capacity_hours" label="Số giờ ca">
                      <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
                    </Form.Item>
                    <Form.Item name="description" label="Mô tả">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="sort_order" label="Thứ tự">
                      <InputNumber style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </>
                }
              />
            ),
          },
          {
            key: 'expense-categories',
            label: 'Danh mục chi phí',
            children: (
              <ConfigTable<ExpenseCategory>
                title="danh mục chi phí"
                queryKey="config-expense-categories"
                apiPath="/config/expense-categories/"
                defaultValues={{ is_active: true, sort_order: 0 }}
                columns={[
                  { title: 'Mã', dataIndex: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'Tên', dataIndex: 'name', width: 160 },
                  { title: 'Màu', dataIndex: 'color', width: 80, render: (v: string) => v ? <span style={{ display: 'inline-block', width: 20, height: 20, borderRadius: 4, background: v, border: '1px solid #e2e8f0' }} /> : null },
                  { title: 'Thứ tự', dataIndex: 'sort_order', width: 70, align: 'right' },
                  { title: 'Kích hoạt', dataIndex: 'is_active', width: 80, render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? 'Có' : 'Tắt'}</Tag> },
                ] as TableColumnsType<ExpenseCategory>}
                formFields={
                  <>
                    <Form.Item name="code" label="Mã" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="name" label="Tên" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="description" label="Mô tả">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="color" label="Màu (hex)">
                      <Input placeholder="#2563eb" />
                    </Form.Item>
                    <Form.Item name="sort_order" label="Thứ tự">
                      <InputNumber style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </>
                }
              />
            ),
          },
        ]}
      />
    </div>
  );
}
