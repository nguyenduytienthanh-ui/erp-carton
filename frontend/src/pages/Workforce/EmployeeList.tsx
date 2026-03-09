import { useMemo, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusOutlined } from '@ant-design/icons';
import { workforceApi } from '../../api/workforce';
import type { Employee, EmployeePayload, EmployeeStatus } from '../../types/workforce';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageWorkforceData } from '../../utils/authz';

type EmployeeFilters = {
  status: '' | EmployeeStatus;
};

const DEFAULT_FILTERS: EmployeeFilters = {
  status: '',
};

const STATUS_OPTIONS: Array<{ value: EmployeeStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Đang làm' },
  { value: 'ON_LEAVE', label: 'Tạm nghỉ' },
  { value: 'RESIGNED', label: 'Nghỉ việc' },
];

function serializeFilters(filters: EmployeeFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): EmployeeFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<EmployeeFilters>;
    return {
      status: parsed.status === 'ACTIVE' || parsed.status === 'ON_LEAVE' || parsed.status === 'RESIGNED' ? parsed.status : '',
    };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

const emptyPayload: EmployeePayload = {
  code: '',
  name: '',
  cccd: '',
  birth_date: null,
  gender: '',
  address: '',
  phone: '',
  email: '',
  department: '',
  position: '',
  start_date: null,
  status: 'ACTIVE',
  salary_basic: 0,
  bank_account_number: '',
  bank_name: '',
  bank_branch: '',
  note: '',
  is_active: true,
};

export default function EmployeeList() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<EmployeeFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm<EmployeePayload>();
  const { config, saveConfig } = useUserPreferences(PAGES.WORKFORCE_EMPLOYEES);
  const canManage = canManageWorkforceData();

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
    const p: Record<string, unknown> = {
      page,
      page_size: pageSize,
      ordering: 'code',
    };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.status) p.status = intentFilters.status;
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['workforce-employees', params],
    queryFn: () => workforceApi.getEmployees(params),
  });

  const createMutation = useMutation({
    mutationFn: workforceApi.createEmployee,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-employees'] });
      messageApi.success('Đã thêm nhân viên');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<EmployeePayload> }) =>
      workforceApi.updateEmployee(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-employees'] });
      messageApi.success('Đã cập nhật nhân viên');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: workforceApi.deleteEmployee,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-employees'] });
      messageApi.success('Đã xóa nhân viên');
    },
  });

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ ...emptyPayload });
    setIsModalOpen(true);
  };

  const openEdit = (row: Employee) => {
    setEditing(row);
    form.setFieldsValue({
      ...emptyPayload,
      ...row,
      salary_basic: Number(row.salary_basic ?? 0),
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload: EmployeePayload = {
      ...values,
      code: values.code.trim().toUpperCase(),
      name: values.name.trim(),
    };
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setIsModalOpen(false);
  };

  const columns: ColumnsType<Employee> = [
    { title: 'Mã NV', dataIndex: 'code', width: 120 },
    { title: 'Họ tên', dataIndex: 'name', width: 220 },
    { title: 'Điện thoại', dataIndex: 'phone', width: 140 },
    { title: 'Phòng ban', dataIndex: 'department', width: 160 },
    { title: 'Chức vụ', dataIndex: 'position', width: 160 },
    {
      title: 'Lương cơ bản',
      dataIndex: 'salary_basic',
      width: 150,
      align: 'right',
      render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (status: EmployeeStatus) => STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status,
    },
    {
      title: 'Kích hoạt',
      dataIndex: 'is_active',
      width: 90,
      render: (active: boolean) => (active ? 'Có' : 'Không'),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          {canManage && (
            <>
              <Button size="small" onClick={() => openEdit(row)}>
                Sửa
              </Button>
              <Button
                size="small"
                danger
                onClick={() =>
                  Modal.confirm({
                    title: `Xóa nhân viên ${row.code}?`,
                    content: 'Hành động này không thể hoàn tác.',
                    okText: 'Xóa',
                    cancelText: 'Hủy',
                    onOk: () => deleteMutation.mutateAsync(row.id),
                  })
                }
              >
                Xóa
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Nhân viên</h2>
          <div style={{ color: '#8c8c8c' }}>Danh mục nhân sự nền tảng</div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!canManage}>
          Thêm nhân viên
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
        <Select
          value={filters.status || undefined}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, status: (value ?? '') as EmployeeStatus | '' }));
            setPage(1);
          }}
          placeholder="Trạng thái"
          style={{ width: 180 }}
          options={STATUS_OPTIONS}
        />
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters(DEFAULT_FILTERS);
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
        dataSource={rows}
        scroll={{ x: 1300 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: async (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              await saveConfig({
                ...(config as Record<string, unknown>),
                pageSize: nextPageSize,
              });
            }
          },
        }}
      />

      <Modal
        title={editing ? `Sửa nhân viên ${editing.code}` : 'Thêm nhân viên'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={920}
      >
        <Form layout="vertical" form={form}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="code" label="Mã NV" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="name" label="Họ tên" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="phone" label="Điện thoại">
              <Input />
            </Form.Item>
            <Form.Item name="department" label="Phòng ban">
              <Input />
            </Form.Item>
            <Form.Item name="position" label="Chức vụ">
              <Input />
            </Form.Item>
            <Form.Item name="status" label="Trạng thái">
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item name="salary_basic" label="Lương cơ bản">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="bank_name" label="Ngân hàng">
              <Input />
            </Form.Item>
            <Form.Item name="bank_account_number" label="Số tài khoản">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

