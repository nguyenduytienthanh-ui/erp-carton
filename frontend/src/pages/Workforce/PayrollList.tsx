import { useMemo, useState } from 'react';
import { Button, Input, Modal, Space, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CalculatorOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workforceApi } from '../../api/workforce';
import type { PayrollRecord, PayrollStatus } from '../../types/workforce';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { canManageWorkforceData } from '../../utils/authz';

type PayrollFilters = {
  month: string;
};

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

function serializeFilters(filters: PayrollFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): PayrollFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<PayrollFilters>;
    return { month: typeof parsed.month === 'string' && parsed.month ? parsed.month : currentMonth };
  } catch {
    return { month: currentMonth };
  }
}

function statusTag(status: PayrollStatus) {
  if (status === 'LOCKED') return <Tag color="green">Đã khóa</Tag>;
  return <Tag color="orange">Chưa khóa</Tag>;
}

export default function PayrollList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<PayrollFilters>({ month: currentMonth });
  const [page, setPage] = useState(1);
  const [viewingDetail, setViewingDetail] = useState<PayrollRecord | null>(null);
  const { config, saveConfig } = useUserPreferences('workforce-payroll-list');
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
    const p: Record<string, unknown> = { page, page_size: pageSize, ordering: 'employee__code' };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.month) p.month = intentFilters.month;
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['workforce-payroll', params],
    queryFn: () => workforceApi.getPayrollRecords(params),
  });

  const calculateMutation = useMutation({
    mutationFn: (month: string) => workforceApi.calculatePayrollMonth(month, true),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-payroll'] });
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      messageApi.success(`Đã tính lương tháng ${data.month} cho ${data.count} nhân viên`);
    },
  });

  const lockMutation = useMutation({
    mutationFn: (id: number) => workforceApi.lockPayroll(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-payroll'] });
      messageApi.success('Đã khóa bản ghi lương');
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (id: number) => workforceApi.unlockPayroll(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-payroll'] });
      messageApi.success('Đã mở khóa bản ghi lương');
    },
  });

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const total = listQuery.data?.count ?? 0;

  const summary = useMemo(() => {
    const totalIncome = rows.reduce((acc, item) => acc + Number(item.total_income), 0);
    const totalDeductions = rows.reduce((acc, item) => acc + Number(item.total_deductions), 0);
    const totalNetPay = rows.reduce((acc, item) => acc + Number(item.net_pay), 0);
    return { count: rows.length, totalIncome, totalDeductions, totalNetPay };
  }, [rows]);

  const columns: ColumnsType<PayrollRecord> = [
    { title: 'Mã NV', dataIndex: 'employee_code', width: 100 },
    { title: 'Tên NV', dataIndex: 'employee_name', width: 220 },
    {
      title: 'Ngày công',
      width: 110,
      align: 'center',
      render: (_, row) => `${Number(row.actual_days)}/${Number(row.standard_days)}`,
    },
    {
      title: 'Tổng thu',
      dataIndex: 'total_income',
      width: 140,
      align: 'right',
      render: (value: string) => `${Number(value).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Tổng trừ',
      dataIndex: 'total_deductions',
      width: 140,
      align: 'right',
      render: (value: string) => `${Number(value).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Thực lãnh',
      dataIndex: 'net_pay',
      width: 150,
      align: 'right',
      render: (value: string) => <span style={{ fontWeight: 700 }}>{Number(value).toLocaleString('vi-VN')} đ</span>,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 110,
      render: (status: PayrollStatus) => statusTag(status),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 230,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setViewingDetail(row)}>
            Chi tiết
          </Button>
          {canManage && (row.status === 'LOCKED' ? (
            <Button size="small" icon={<UnlockOutlined />} onClick={() => unlockMutation.mutate(row.id)}>
              Mở khóa
            </Button>
          ) : (
            <Button size="small" icon={<LockOutlined />} onClick={() => lockMutation.mutate(row.id)}>
              Khóa
            </Button>
          ))}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Bảng lương</h2>
          <div style={{ color: '#8c8c8c' }}>Tính lương theo tháng từ chấm công, thưởng/phạt và ứng lương</div>
        </div>
        <Button
          type="primary"
          icon={<CalculatorOutlined />}
          disabled={!canManage}
          loading={calculateMutation.isPending}
          onClick={() => {
            Modal.confirm({
              title: `Tính lại lương tháng ${filters.month}?`,
              content: 'Hệ thống sẽ ghi đè các bản ghi chưa khóa trong tháng.',
              okText: 'Tính lương',
              cancelText: 'Hủy',
              onOk: () => calculateMutation.mutate(filters.month),
            });
          }}
        >
          Tính lương
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Số nhân viên</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{summary.count}</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Tổng thu</div>
          <div style={{ fontWeight: 700, color: '#389e0d', fontSize: 20 }}>{summary.totalIncome.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Tổng trừ</div>
          <div style={{ fontWeight: 700, color: '#cf1322', fontSize: 20 }}>{summary.totalDeductions.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Thực lãnh</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{summary.totalNetPay.toLocaleString('vi-VN')} đ</div>
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
        title={viewingDetail ? `Chi tiết lương ${viewingDetail.employee_name}` : 'Chi tiết lương'}
        open={viewingDetail != null}
        onCancel={() => setViewingDetail(null)}
        footer={null}
      >
        {viewingDetail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><strong>Mã NV:</strong> {viewingDetail.employee_code}</div>
              <div><strong>Tháng:</strong> {viewingDetail.month}</div>
              <div><strong>Phòng ban:</strong> {viewingDetail.employee_department || '-'}</div>
              <div><strong>Chức vụ:</strong> {viewingDetail.employee_position || '-'}</div>
            </div>
            <div><strong>Lương cơ bản:</strong> {Number(viewingDetail.basic_salary).toLocaleString('vi-VN')} đ</div>
            <div><strong>Lương theo công:</strong> {Number(viewingDetail.salary_by_attendance).toLocaleString('vi-VN')} đ</div>
            <div><strong>Tăng ca:</strong> {Number(viewingDetail.overtime_pay).toLocaleString('vi-VN')} đ</div>
            <div><strong>Thưởng:</strong> {Number(viewingDetail.total_bonus).toLocaleString('vi-VN')} đ</div>
            <div><strong>Phạt:</strong> {Number(viewingDetail.total_penalty).toLocaleString('vi-VN')} đ</div>
            <div><strong>Tạm ứng:</strong> {Number(viewingDetail.advance_deduction).toLocaleString('vi-VN')} đ</div>
            <div><strong>Tổng thu:</strong> {Number(viewingDetail.total_income).toLocaleString('vi-VN')} đ</div>
            <div><strong>Tổng trừ:</strong> {Number(viewingDetail.total_deductions).toLocaleString('vi-VN')} đ</div>
            <div style={{ fontSize: 18 }}><strong>Thực lãnh:</strong> {Number(viewingDetail.net_pay).toLocaleString('vi-VN')} đ</div>
          </div>
        )}
      </Modal>
    </div>
  );
}

