import { useMemo, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workforceApi } from '../../api/workforce';
import type {
  Employee,
  SalaryAdvanceRecord,
  SalaryAdvanceRecordPayload,
  SalaryAdvanceStatus,
} from '../../types/workforce';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { canManageWorkforceData } from '../../utils/authz';

type SalaryAdvanceFilters = {
  month: string;
  status: '' | SalaryAdvanceStatus;
};

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const currentDate = today.toISOString().slice(0, 10);

const STATUS_OPTIONS: Array<{ value: SalaryAdvanceStatus; label: string }> = [
  { value: 'UNDEDUCTED', label: 'Chưa trừ' },
  { value: 'DEDUCTED', label: 'Đã trừ' },
];

function serializeFilters(filters: SalaryAdvanceFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): SalaryAdvanceFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<SalaryAdvanceFilters>;
    return {
      month: typeof parsed.month === 'string' && parsed.month ? parsed.month : currentMonth,
      status: parsed.status === 'UNDEDUCTED' || parsed.status === 'DEDUCTED' ? parsed.status : '',
    };
  } catch {
    return { month: currentMonth, status: '' };
  }
}

type SalaryAdvanceForm = {
  employee: number;
  advance_date: string;
  month: string;
  amount: number;
  reason: string;
  approved_by_name: string;
  note: string;
  status: SalaryAdvanceStatus;
  is_active: boolean;
};

const emptyForm: SalaryAdvanceForm = {
  employee: 0,
  advance_date: currentDate,
  month: currentMonth,
  amount: 0,
  reason: 'Ứng lương',
  approved_by_name: '',
  note: '',
  status: 'UNDEDUCTED',
  is_active: true,
};

export default function SalaryAdvanceList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<SalaryAdvanceFilters>({ month: currentMonth, status: '' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SalaryAdvanceRecord | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<SalaryAdvanceForm>();
  const { config, saveConfig } = useUserPreferences('workforce-salary-advance-list');
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

  const employeesQuery = useQuery({
    queryKey: ['workforce-employees-select'],
    queryFn: () => workforceApi.getEmployees({ page: 1, page_size: 500, ordering: 'code', is_active: 'true' }),
  });

  const params = useMemo(() => {
    const p: Record<string, unknown> = { page, page_size: pageSize, ordering: '-advance_date' };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.month) p.month = intentFilters.month;
    if (intentFilters.status) p.status = intentFilters.status;
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['workforce-salary-advances', params],
    queryFn: () => workforceApi.getSalaryAdvances(params),
  });

  const createMutation = useMutation({
    mutationFn: workforceApi.createSalaryAdvance,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      messageApi.success('Đã thêm ứng lương');
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SalaryAdvanceRecordPayload> }) =>
      workforceApi.updateSalaryAdvance(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      messageApi.success('Đã cập nhật ứng lương');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: workforceApi.deleteSalaryAdvance,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      messageApi.success('Đã xóa ứng lương');
    },
  });

  const employees = employeesQuery.data?.results ?? [];
  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const total = listQuery.data?.count ?? 0;

  const summary = useMemo(() => {
    const totalAmount = rows.reduce((acc, item) => acc + Number(item.amount), 0);
    const undeducted = rows
      .filter((item) => item.status === 'UNDEDUCTED')
      .reduce((acc, item) => acc + Number(item.amount), 0);
    const deducted = rows
      .filter((item) => item.status === 'DEDUCTED')
      .reduce((acc, item) => acc + Number(item.amount), 0);
    return { totalAmount, undeducted, deducted };
  }, [rows]);

  const columns: ColumnsType<SalaryAdvanceRecord> = [
    { title: 'Ngày', dataIndex: 'advance_date', width: 110 },
    { title: 'Tháng trừ', dataIndex: 'month', width: 90 },
    { title: 'Mã NV', dataIndex: 'employee_code', width: 110 },
    { title: 'Tên NV', dataIndex: 'employee_name', width: 220 },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      width: 150,
      align: 'right',
      render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
    },
    { title: 'Lý do', dataIndex: 'reason', width: 220 },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (status: SalaryAdvanceStatus) => STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status,
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
              <Button
                size="small"
                onClick={() => {
                  setEditing(row);
                  form.setFieldsValue({
                    employee: row.employee,
                    advance_date: row.advance_date,
                    month: row.month,
                    amount: Number(row.amount),
                    reason: row.reason,
                    approved_by_name: row.approved_by_name,
                    note: row.note,
                    status: row.status,
                    is_active: row.is_active,
                  });
                  setOpenModal(true);
                }}
              >
                Sửa
              </Button>
              <Button
                size="small"
                danger
                onClick={() =>
                  Modal.confirm({
                    title: 'Xóa ứng lương này?',
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

  const toPayload = (values: SalaryAdvanceForm): SalaryAdvanceRecordPayload => ({
    employee: values.employee,
    advance_date: values.advance_date,
    month: values.month,
    amount: Number(values.amount || 0),
    reason: values.reason || 'Ứng lương',
    approved_by_name: values.approved_by_name || '',
    note: values.note || '',
    status: values.status,
    is_active: values.is_active,
  });

  const submitForm = async () => {
    const values = await form.validateFields();
    const payload = toPayload(values);
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
          <h2 style={{ margin: 0 }}>Ứng lương</h2>
          <div style={{ color: '#8c8c8c' }}>Quản lý ứng lương và trạng thái đã trừ/chưa trừ</div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => {
            setEditing(null);
            form.setFieldsValue({ ...emptyForm, month: filters.month || currentMonth });
            setOpenModal(true);
          }}
        >
          Thêm ứng lương
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
        <Input
          type="month"
          value={filters.month}
          onChange={(e) => {
            setFilters((prev) => ({ ...prev, month: e.target.value || currentMonth }));
            setPage(1);
          }}
          style={{ width: 180 }}
        />
        <Select
          value={filters.status || undefined}
          options={STATUS_OPTIONS}
          placeholder="Trạng thái"
          style={{ width: 160 }}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, status: (value ?? '') as '' | SalaryAdvanceStatus }));
            setPage(1);
          }}
        />
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ month: currentMonth, status: '' });
            setPage(1);
          }}
        >
          Xóa bộ lọc
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Tổng ứng</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{summary.totalAmount.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Chưa trừ</div>
          <div style={{ fontWeight: 700, color: '#d48806', fontSize: 20 }}>{summary.undeducted.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Đã trừ</div>
          <div style={{ fontWeight: 700, color: '#389e0d', fontSize: 20 }}>{summary.deducted.toLocaleString('vi-VN')} đ</div>
        </div>
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
              await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize });
            }
          },
        }}
      />

      <Modal
        title={editing ? 'Sửa ứng lương' : 'Thêm ứng lương'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={submitForm}
        width={760}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="employee" label="Nhân viên" rules={[{ required: true }]}>
              <Select
                options={employees.map((item: Employee) => ({
                  value: item.id,
                  label: `${item.code} - ${item.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="advance_date" label="Ngày ứng" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="month" label="Tháng trừ lương" rules={[{ required: true }]}>
              <Input type="month" />
            </Form.Item>
            <Form.Item name="amount" label="Số tiền" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="status" label="Trạng thái" rules={[{ required: true }]}>
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item name="approved_by_name" label="Người duyệt">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="reason" label="Lý do">
            <Input />
          </Form.Item>
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

