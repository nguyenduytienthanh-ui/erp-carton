import { useMemo, useState } from 'react';
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
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workforceApi } from '../../api/workforce';
import type {
  BonusPenaltyCalculationType,
  BonusPenaltyRecord,
  BonusPenaltyRecordPayload,
  BonusPenaltyType,
  Employee,
} from '../../types/workforce';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { canManageWorkforceData } from '../../utils/authz';

type BonusPenaltyFilters = {
  month: string;
  record_type: '' | BonusPenaltyType;
};

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const currentDate = today.toISOString().slice(0, 10);

const TYPE_OPTIONS: Array<{ value: BonusPenaltyType; label: string }> = [
  { value: 'BONUS', label: 'Thưởng' },
  { value: 'PENALTY', label: 'Phạt' },
];

const CALC_OPTIONS: Array<{ value: BonusPenaltyCalculationType; label: string }> = [
  { value: 'FIXED', label: 'Cố định' },
  { value: 'DAILY_RATIO', label: 'Theo ngày công' },
];

function serializeFilters(filters: BonusPenaltyFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): BonusPenaltyFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<BonusPenaltyFilters>;
    return {
      month: typeof parsed.month === 'string' && parsed.month ? parsed.month : currentMonth,
      record_type: parsed.record_type === 'BONUS' || parsed.record_type === 'PENALTY' ? parsed.record_type : '',
    };
  } catch {
    return { month: currentMonth, record_type: '' };
  }
}

type BonusPenaltyForm = {
  employee: number;
  month: string;
  record_type: BonusPenaltyType;
  reason: string;
  amount: number;
  calculation_type: BonusPenaltyCalculationType;
  record_date: string;
  approved_by_name: string;
  note: string;
  is_active: boolean;
};

const emptyForm: BonusPenaltyForm = {
  employee: 0,
  month: currentMonth,
  record_type: 'BONUS',
  reason: '',
  amount: 0,
  calculation_type: 'FIXED',
  record_date: currentDate,
  approved_by_name: '',
  note: '',
  is_active: true,
};

export default function BonusPenaltyList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<BonusPenaltyFilters>({ month: currentMonth, record_type: '' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<BonusPenaltyRecord | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<BonusPenaltyForm>();
  const { config, saveConfig } = useUserPreferences('workforce-bonus-penalty-list');
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
    const p: Record<string, unknown> = { page, page_size: pageSize, ordering: '-record_date' };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.month) p.month = intentFilters.month;
    if (intentFilters.record_type) p.record_type = intentFilters.record_type;
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['workforce-bonus-penalty', params],
    queryFn: () => workforceApi.getBonusPenaltyRecords(params),
  });

  const createMutation = useMutation({
    mutationFn: workforceApi.createBonusPenaltyRecord,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-bonus-penalty'] });
      messageApi.success('Đã thêm thưởng/phạt');
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<BonusPenaltyRecordPayload> }) =>
      workforceApi.updateBonusPenaltyRecord(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-bonus-penalty'] });
      messageApi.success('Đã cập nhật thưởng/phạt');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: workforceApi.deleteBonusPenaltyRecord,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-bonus-penalty'] });
      messageApi.success('Đã xóa thưởng/phạt');
    },
  });

  const employees = (employeesQuery.data?.results ?? []).filter(
    (item) => item.is_active && item.status !== 'RESIGNED'
  );
  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const total = listQuery.data?.count ?? 0;

  const summary = useMemo(() => {
    const totalBonus = rows
      .filter((item) => item.record_type === 'BONUS')
      .reduce((acc, item) => acc + Number(item.amount), 0);
    const totalPenalty = rows
      .filter((item) => item.record_type === 'PENALTY')
      .reduce((acc, item) => acc + Number(item.amount), 0);
    return {
      totalBonus,
      totalPenalty,
      delta: totalBonus - totalPenalty,
    };
  }, [rows]);

  const columns: ColumnsType<BonusPenaltyRecord> = [
    { title: 'Ngày', dataIndex: 'record_date', width: 110 },
    { title: 'Tháng', dataIndex: 'month', width: 90 },
    { title: 'Mã NV', dataIndex: 'employee_code', width: 100 },
    { title: 'Tên NV', dataIndex: 'employee_name', width: 220 },
    {
      title: 'Loại',
      dataIndex: 'record_type',
      width: 100,
      render: (value: BonusPenaltyType) => (value === 'BONUS' ? 'Thưởng' : 'Phạt'),
    },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      width: 150,
      align: 'right',
      render: (value: string, row) => {
        const formatted = Number(value || 0).toLocaleString('vi-VN');
        if (row.record_type === 'BONUS') return <span style={{ color: '#389e0d', fontWeight: 600 }}>{formatted} đ</span>;
        return <span style={{ color: '#cf1322', fontWeight: 600 }}>-{formatted} đ</span>;
      },
    },
    { title: 'Lý do', dataIndex: 'reason', width: 260 },
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
                    month: row.month,
                    record_type: row.record_type,
                    reason: row.reason,
                    amount: Number(row.amount),
                    calculation_type: row.calculation_type,
                    record_date: row.record_date,
                    approved_by_name: row.approved_by_name || '',
                    note: row.note || '',
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
                    title: 'Xóa bản ghi thưởng/phạt?',
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

  const toPayload = (values: BonusPenaltyForm): BonusPenaltyRecordPayload => ({
    employee: values.employee,
    month: values.month,
    record_type: values.record_type,
    reason: values.reason.trim(),
    amount: Number(values.amount || 0),
    calculation_type: values.calculation_type,
    record_date: values.record_date,
    approved_by_name: values.approved_by_name || '',
    note: values.note || '',
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
          <h2 style={{ margin: 0 }}>Thưởng / phạt</h2>
          <div style={{ color: '#8c8c8c' }}>Quản lý thưởng phạt theo tháng</div>
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
          Thêm thưởng/phạt
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
          value={filters.record_type || undefined}
          placeholder="Loại"
          options={TYPE_OPTIONS}
          style={{ width: 140 }}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, record_type: (value ?? '') as '' | BonusPenaltyType }));
            setPage(1);
          }}
        />
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ month: currentMonth, record_type: '' });
            setPage(1);
          }}
        >
          Xóa bộ lọc
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Tổng thưởng</div>
          <div style={{ fontWeight: 700, color: '#389e0d', fontSize: 20 }}>{summary.totalBonus.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Tổng phạt</div>
          <div style={{ fontWeight: 700, color: '#cf1322', fontSize: 20 }}>{summary.totalPenalty.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Chênh lệch</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{summary.delta.toLocaleString('vi-VN')} đ</div>
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
              await saveConfig({
                ...(config as Record<string, unknown>),
                pageSize: nextPageSize,
              });
            }
          },
        }}
      />

      <Modal
        title={editing ? 'Sửa thưởng/phạt' : 'Thêm thưởng/phạt'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={submitForm}
        width={760}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="month" label="Tháng" rules={[{ required: true }]}>
              <Input type="month" />
            </Form.Item>
            <Form.Item name="employee" label="Nhân viên" rules={[{ required: true }]}>
              <Select
                options={employees.map((item: Employee) => ({
                  value: item.id,
                  label: `${item.code} - ${item.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="record_type" label="Loại" rules={[{ required: true }]}>
              <Select options={TYPE_OPTIONS} />
            </Form.Item>
            <Form.Item name="calculation_type" label="Cách tính" rules={[{ required: true }]}>
              <Select options={CALC_OPTIONS} />
            </Form.Item>
            <Form.Item name="record_date" label="Ngày ghi nhận" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="amount" label="Số tiền" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="reason" label="Lý do" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="approved_by_name" label="Người duyệt">
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

