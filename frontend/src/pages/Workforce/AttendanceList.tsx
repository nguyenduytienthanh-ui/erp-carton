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
  AttendanceDayType,
  AttendanceRecord,
  AttendanceRecordPayload,
  AttendanceShift,
  Employee,
} from '../../types/workforce';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageWorkforceData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

type AttendanceFilters = {
  month: string;
};

const OVERTIME_DAY_OPTIONS: Array<{ value: AttendanceDayType; label: string }> = [
  { value: 'WEEKDAY', label: 'Ngày thường' },
  { value: 'SUNDAY', label: 'Chủ nhật' },
  { value: 'HOLIDAY', label: 'Ngày lễ' },
];

const OVERTIME_SHIFT_OPTIONS: Array<{ value: AttendanceShift; label: string }> = [
  { value: 'MORNING', label: 'Sáng' },
  { value: 'AFTERNOON', label: 'Chiều' },
  { value: 'EVENING', label: 'Tối' },
  { value: 'NIGHT', label: 'Đêm' },
  { value: 'FULLDAY', label: 'Cả ngày' },
];

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const defaultOvertimeDate = `${currentMonth}-01`;

function serializeFilters(filters: AttendanceFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): AttendanceFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<AttendanceFilters>;
    return { month: typeof parsed.month === 'string' && parsed.month ? parsed.month : currentMonth };
  } catch {
    return { month: currentMonth };
  }
}

type AttendanceForm = {
  employee: number;
  month: string;
  standard_days: number;
  actual_days: number;
  paid_leave: number;
  unpaid_leave: number;
  note: string;
  is_active: boolean;
  overtime_items: Array<{
    overtime_date: string;
    day_type: AttendanceDayType;
    shift: AttendanceShift;
    hours: number;
    rate: number;
    note: string;
  }>;
};

const emptyForm: AttendanceForm = {
  employee: 0,
  month: currentMonth,
  standard_days: 26,
  actual_days: 0,
  paid_leave: 0,
  unpaid_leave: 0,
  note: '',
  is_active: true,
  overtime_items: [],
};

export default function AttendanceList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<AttendanceFilters>({ month: currentMonth });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<AttendanceForm>();
  const { config, saveConfig } = useUserPreferences('workforce-attendance-list');
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
    const p: Record<string, unknown> = { page, page_size: pageSize, ordering: '-month' };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.month) p.month = intentFilters.month;
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['workforce-attendance', params],
    queryFn: () => workforceApi.getAttendanceRecords(params),
  });

  const createMutation = useMutation({
    mutationFn: workforceApi.createAttendanceRecord,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-attendance'] });
      messageApi.success('Đã thêm chấm công');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<AttendanceRecordPayload> }) =>
      workforceApi.updateAttendanceRecord(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-attendance'] });
      messageApi.success('Đã cập nhật chấm công');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: workforceApi.deleteAttendanceRecord,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-attendance'] });
      messageApi.success('Đã xóa chấm công');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const employees = (employeesQuery.data?.results ?? []).filter(
    (item) => item.is_active && item.status !== 'RESIGNED'
  );
  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;

  const columns: ColumnsType<AttendanceRecord> = [
    { title: 'Tháng', dataIndex: 'month', width: 100 },
    { title: 'Mã NV', dataIndex: 'employee_code', width: 120 },
    { title: 'Tên NV', dataIndex: 'employee_name', width: 220 },
    {
      title: 'Công chuẩn',
      dataIndex: 'standard_days',
      width: 100,
      align: 'center',
    },
    {
      title: 'Công thực tế',
      dataIndex: 'actual_days',
      width: 110,
      align: 'center',
    },
    {
      title: 'Nghỉ phép',
      dataIndex: 'paid_leave',
      width: 90,
      align: 'center',
    },
    {
      title: 'Nghỉ KP',
      dataIndex: 'unpaid_leave',
      width: 90,
      align: 'center',
    },
    {
      title: 'Tăng ca',
      dataIndex: 'total_overtime_hours',
      width: 100,
      align: 'center',
      render: (value: string) => `${Number(value || 0)} h`,
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
                    month: row.month,
                    standard_days: Number(row.standard_days),
                    actual_days: Number(row.actual_days),
                    paid_leave: Number(row.paid_leave),
                    unpaid_leave: Number(row.unpaid_leave),
                    note: row.note || '',
                    is_active: row.is_active,
                    overtime_items: (row.overtime_items || []).map((item) => ({
                      overtime_date: item.overtime_date,
                      day_type: item.day_type,
                      shift: item.shift,
                      hours: Number(item.hours),
                      rate: Number(item.rate),
                      note: item.note || '',
                    })),
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
                    title: `Xóa chấm công ${row.employee_code} tháng ${row.month}?`,
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

  const toPayload = (values: AttendanceForm): AttendanceRecordPayload => ({
    employee: values.employee,
    month: values.month,
    standard_days: values.standard_days,
    actual_days: values.actual_days,
    paid_leave: values.paid_leave,
    unpaid_leave: values.unpaid_leave,
    note: values.note || '',
    is_active: values.is_active,
    overtime_items: (values.overtime_items || []).map((item) => ({
      overtime_date: item.overtime_date,
      day_type: item.day_type,
      shift: item.shift,
      hours: Number(item.hours || 0),
      rate: Number(item.rate || 0),
      note: item.note || '',
    })),
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
          <h2 style={{ margin: 0 }}>Chấm công</h2>
          <div style={{ color: '#8c8c8c' }}>Chấm công theo tháng và tăng ca</div>
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
          Thêm chấm công
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
            setFilters({ month: e.target.value || currentMonth });
            setPage(1);
          }}
          style={{ width: 180 }}
        />
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ month: currentMonth });
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
        scroll={{ x: 1200 }}
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
        title={editing ? 'Sửa chấm công' : 'Thêm chấm công'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={submitForm}
        width={980}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="month" label="Tháng" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input type="month" />
            </Form.Item>
            <Form.Item name="employee" label="Nhân viên" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Select
                options={employees.map((item: Employee) => ({
                  value: item.id,
                  label: `${item.code} - ${item.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="standard_days" label="Ngày công chuẩn">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="actual_days" label="Ngày công thực tế">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="paid_leave" label="Nghỉ phép">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="unpaid_leave" label="Nghỉ không phép">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="overtime_items" label="Tăng ca">
            <Form.List name="overtime_items">
              {(fields, { add, remove }) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Button
                    onClick={() =>
                      add({
                        overtime_date: defaultOvertimeDate,
                        day_type: 'WEEKDAY',
                        shift: 'EVENING',
                        hours: 1,
                        rate: 1.5,
                        note: '',
                      })
                    }
                  >
                    + Thêm tăng ca
                  </Button>
                  {fields.map((field) => (
                    <div
                      key={field.key}
                      style={{
                        border: '1px solid #f0f0f0',
                        borderRadius: 8,
                        padding: 8,
                        display: 'grid',
                        gridTemplateColumns: '180px 160px 140px 100px 100px 1fr auto',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      <Form.Item name={[field.name, 'overtime_date']} style={{ margin: 0 }} rules={[{ required: true }]}>
                        <Input type="date" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'day_type']} style={{ margin: 0 }} rules={[{ required: true }]}>
                        <Select options={OVERTIME_DAY_OPTIONS} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'shift']} style={{ margin: 0 }} rules={[{ required: true }]}>
                        <Select options={OVERTIME_SHIFT_OPTIONS} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'hours']} style={{ margin: 0 }} rules={[{ required: true }]}>
                        <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'rate']} style={{ margin: 0 }} rules={[{ required: true }]}>
                        <InputNumber min={1} step={0.1} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'note']} style={{ margin: 0 }}>
                        <Input placeholder="Ghi chú tăng ca" />
                      </Form.Item>
                      <Button danger onClick={() => remove(field.name)}>
                        Xóa
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Form.List>
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

