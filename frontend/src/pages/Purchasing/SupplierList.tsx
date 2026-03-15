import { useMemo, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Space, Switch, Table, message } from 'antd';
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


type SupplierFilters = { activeOnly: boolean };
type SupplierFormValues = Omit<Supplier, 'id' | 'created_at' | 'updated_at'>;


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
  }, [intentSearch, intentFilters, page, pageSize]);

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

  const columns: ColumnsType<Supplier> = [
    { title: 'Mã NCC', dataIndex: 'code', width: 120 },
    { title: 'Tên NCC', dataIndex: 'name', width: 220 },
    { title: 'Công ty', dataIndex: 'company_name', width: 220, render: (value) => value || '-' },
    { title: 'Người liên hệ', dataIndex: 'contact_person', width: 160, render: (value) => value || '-' },
    { title: 'Điện thoại', dataIndex: 'phone', width: 140, render: (value) => value || '-' },
    { title: 'Email', dataIndex: 'email', width: 200, render: (value) => value || '-' },
    { title: 'Hạn TT', dataIndex: 'payment_terms_days', width: 100, render: (value) => `${value} ngày` },
    { title: 'Ưu tiên', dataIndex: 'is_preferred', width: 90, render: (value) => (value ? 'Có' : 'Không') },
    { title: 'Đánh giá', dataIndex: 'rating', width: 90 },
    { title: 'Kích hoạt', dataIndex: 'is_active', width: 90, render: (value) => (value ? 'Có' : 'Không') },
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
      payment_terms_days: Number(values.payment_terms_days ?? 30),
      rating: Number(values.rating ?? 3),
    };
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setOpenModal(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Nhà cung cấp</h2>
          <div style={{ color: '#8c8c8c' }}>Danh mục đối tác mua hàng và cung ứng</div>
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

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={listQuery.data?.results ?? []}
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
        locale={{
          emptyText: (listQuery.data?.results?.length ?? 0) === 0 && !listQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {(intentSearch || (filters.activeOnly === false)) ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy nhà cung cấp phù hợp.</div>
                  <Button
                    type="link"
                    onClick={() => {
                      setSearchInput('');
                      setFilters({ activeOnly: true });
                      setPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : 'Chưa có nhà cung cấp.'}
            </div>
          ) : undefined,
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
