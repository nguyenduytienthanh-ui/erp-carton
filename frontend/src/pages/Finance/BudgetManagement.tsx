import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { financeApi } from '../../api/finance';
import { getToastMessage } from '../../shared/apiError';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { downloadCSV } from '../../utils/csvExport';
import { canManageFinanceData } from '../../utils/authz';
import type { BudgetPlan, BudgetPlanStatus } from '../../types/finance';

type BudgetFilters = {
  fiscal_year: number | null;
  status: '' | BudgetPlanStatus;
  is_active: '' | 'true' | 'false';
};

type BudgetFormValues = {
  department: string;
  category: string;
  fiscal_year: number;
  budgeted_amount: number;
  actual_amount: number;
  committed_amount: number;
  is_active: boolean;
  note?: string;
};

const currentYear = dayjs().year();

const emptyForm: BudgetFormValues = {
  department: '',
  category: '',
  fiscal_year: currentYear,
  budgeted_amount: 0,
  actual_amount: 0,
  committed_amount: 0,
  is_active: true,
  note: '',
};

const statusOptions: Array<{ value: BudgetPlanStatus; label: string }> = [
  { value: 'ON_TRACK', label: 'Trong kế hoạch' },
  { value: 'OVER_BUDGET', label: 'Vượt ngân sách' },
];

const activeOptions = [
  { value: '', label: 'Tất cả trạng thái sử dụng' },
  { value: 'true', label: 'Đang sử dụng' },
  { value: 'false', label: 'Đã khóa' },
];

const yearOptions = Array.from({ length: 6 }, (_, index) => currentYear - 2 + index).map((year) => ({
  label: String(year),
  value: year,
}));

function serializeFilters(filters: BudgetFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): BudgetFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<BudgetFilters>;
    return {
      fiscal_year: typeof parsed.fiscal_year === 'number' ? parsed.fiscal_year : null,
      status: parsed.status === 'ON_TRACK' || parsed.status === 'OVER_BUDGET' ? parsed.status : '',
      is_active:
        parsed.is_active === 'true' || parsed.is_active === 'false'
          ? parsed.is_active
          : '',
    };
  } catch {
    return { fiscal_year: null, status: '', is_active: '' };
  }
}

const formatMoney = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 0 });

export default function BudgetManagement() {
  const canManage = canManageFinanceData();
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<BudgetFilters>({
    fiscal_year: currentYear,
    status: '',
    is_active: 'true',
  });
  const [openModal, setOpenModal] = useState(false);
  const [editing, setEditing] = useState<BudgetPlan | null>(null);
  const [form] = Form.useForm<BudgetFormValues>();

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 500,
    filterDebounceMs: 250,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, ordering: '-fiscal_year,department,category' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.fiscal_year) next.fiscal_year = intentFilters.fiscal_year;
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.is_active) next.is_active = intentFilters.is_active;
    return next;
  }, [intentSearch, intentFilters, page]);

  const summaryParams = useMemo(() => {
    const next: Record<string, unknown> = {};
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.fiscal_year) next.fiscal_year = intentFilters.fiscal_year;
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.is_active) next.is_active = intentFilters.is_active;
    return next;
  }, [intentSearch, intentFilters]);

  const listQuery = useQuery({
    queryKey: ['finance-budgets', params],
    queryFn: () => financeApi.getBudgets(params),
  });
  const summaryQuery = useQuery({
    queryKey: ['finance-budgets-summary', summaryParams],
    queryFn: () => financeApi.getBudgetVarianceAnalysis(summaryParams),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['finance-budgets'] });
    await queryClient.invalidateQueries({ queryKey: ['finance-budgets-summary'] });
  };

  const createMutation = useMutation({
    mutationFn: financeApi.createBudget,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã tạo ngân sách');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof financeApi.updateBudget>[1] }) =>
      financeApi.updateBudget(id, payload),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã cập nhật ngân sách');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: financeApi.deleteBudget,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã xóa ngân sách');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;
  const summary = summaryQuery.data;

  const openCreateModal = () => {
    setEditing(null);
    form.setFieldsValue(emptyForm);
    setOpenModal(true);
  };

  const openEditModal = (row: BudgetPlan) => {
    setEditing(row);
    form.setFieldsValue({
      department: row.department,
      category: row.category,
      fiscal_year: row.fiscal_year,
      budgeted_amount: Number(row.budgeted_amount || 0),
      actual_amount: Number(row.actual_amount || 0),
      committed_amount: Number(row.committed_amount || 0),
      is_active: row.is_active,
      note: row.note || '',
    });
    setOpenModal(true);
  };

  const submitForm = async () => {
    const values = await form.validateFields();
    const payload = {
      department: values.department.trim(),
      category: values.category.trim(),
      fiscal_year: Number(values.fiscal_year),
      budgeted_amount: Number(values.budgeted_amount || 0),
      actual_amount: Number(values.actual_amount || 0),
      committed_amount: Number(values.committed_amount || 0),
      is_active: Boolean(values.is_active),
      note: values.note?.trim() || '',
    };
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setOpenModal(false);
  };

  const columns: ColumnsType<BudgetPlan> = [
    { title: 'Phòng ban', dataIndex: 'department', width: 160 },
    { title: 'Hạng mục', dataIndex: 'category', width: 180 },
    { title: 'Năm', dataIndex: 'fiscal_year', width: 90, align: 'center' },
    {
      title: 'Ngân sách',
      dataIndex: 'budgeted_amount',
      width: 140,
      align: 'right',
      render: (value: string) => formatMoney(Number(value || 0)),
    },
    {
      title: 'Đã dùng',
      dataIndex: 'actual_amount',
      width: 140,
      align: 'right',
      render: (value: string) => formatMoney(Number(value || 0)),
    },
    {
      title: 'Cam kết',
      dataIndex: 'committed_amount',
      width: 140,
      align: 'right',
      render: (value: string) => formatMoney(Number(value || 0)),
    },
    {
      title: 'Còn lại',
      dataIndex: 'available',
      width: 140,
      align: 'right',
      render: (value: string) => (
        <span style={{ color: Number(value || 0) < 0 ? '#cf1322' : '#1677ff' }}>
          {formatMoney(Number(value || 0))}
        </span>
      ),
    },
    {
      title: 'Tỷ lệ sử dụng',
      dataIndex: 'variance_percentage',
      width: 120,
      align: 'right',
      render: (value: number) => `${Number(value || 0).toFixed(1)}%`,
    },
    {
      title: 'Tình trạng',
      key: 'status',
      width: 150,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Tag color={row.status === 'OVER_BUDGET' ? 'error' : 'success'}>
            {row.status === 'OVER_BUDGET' ? 'Vượt ngân sách' : 'Trong kế hoạch'}
          </Tag>
          <Tag color={row.is_active ? 'processing' : 'default'}>
            {row.is_active ? 'Đang sử dụng' : 'Đã khóa'}
          </Tag>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap size="small">
          <Button size="small" icon={<EditOutlined />} disabled={!canManage} onClick={() => openEditModal(row)}>
            Sửa
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!canManage}
            onClick={() =>
              Modal.confirm({
                title: `Xóa ngân sách ${row.department} / ${row.category}?`,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
      {contextHolder}

      <Card>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={6}>
            <Statistic
              title="Tổng ngân sách"
              value={Number(summary?.total_budgeted ?? 0)}
              formatter={(value) => formatMoney(Number(value || 0))}
            />
          </Col>
          <Col xs={24} md={6}>
            <Statistic
              title="Đã sử dụng"
              value={Number(summary?.total_actual ?? 0)}
              formatter={(value) => formatMoney(Number(value || 0))}
              valueStyle={{ color: '#1677ff' }}
            />
          </Col>
          <Col xs={24} md={6}>
            <Statistic
              title="Cam kết"
              value={Number(summary?.total_committed ?? 0)}
              formatter={(value) => formatMoney(Number(value || 0))}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Col>
          <Col xs={24} md={6}>
            <Statistic
              title="Còn khả dụng"
              value={Number(summary?.total_available ?? 0)}
              formatter={(value) => formatMoney(Number(value || 0))}
              valueStyle={{ color: Number(summary?.total_available ?? 0) < 0 ? '#cf1322' : '#52c41a' }}
            />
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card size="small">
            <Typography.Text type="secondary">Số mục vượt ngân sách</Typography.Text>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#cf1322', marginTop: 8 }}>
              {summary?.over_budget_count ?? 0}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Typography.Text type="secondary">Số mục trong kế hoạch</Typography.Text>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#52c41a', marginTop: 8 }}>
              {summary?.on_track_count ?? 0}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small">
            <Typography.Text type="secondary">Tỷ lệ tiêu hao toàn bộ</Typography.Text>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#1677ff', marginTop: 8 }}>
              {Number(summary?.utilization_percentage ?? 0).toFixed(1)}%
            </div>
          </Card>
        </Col>
      </Row>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Space wrap>
            <Input
              allowClear
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              placeholder="Tìm phòng ban, hạng mục hoặc ghi chú"
              style={{ width: 260 }}
            />
            <Select
              allowClear
              placeholder="Năm ngân sách"
              value={filters.fiscal_year ?? undefined}
              options={yearOptions}
              style={{ width: 140 }}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, fiscal_year: value ?? null }));
                setPage(1);
              }}
            />
            <Select
              allowClear
              placeholder="Tình trạng"
              value={filters.status || undefined}
              options={statusOptions}
              style={{ width: 170 }}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, status: (value ?? '') as BudgetFilters['status'] }));
                setPage(1);
              }}
            />
            <Select
              value={filters.is_active}
              options={activeOptions}
              style={{ width: 170 }}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, is_active: value }));
                setPage(1);
              }}
            />
            <Button
              onClick={() => {
                setSearchInput('');
                setFilters({ fiscal_year: currentYear, status: '', is_active: 'true' });
                setPage(1);
              }}
            >
              Xóa bộ lọc
            </Button>
          </Space>

          <Space wrap>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => {
                const exportRows = rows.map((row) => ({
                  Phong_ban: row.department,
                  Hang_muc: row.category,
                  Nam: row.fiscal_year,
                  Ngan_sach: row.budgeted_amount,
                  Da_su_dung: row.actual_amount,
                  Cam_ket: row.committed_amount,
                  Con_lai: row.available,
                  Ty_le: row.variance_percentage,
                  Trang_thai: row.status,
                  Dang_su_dung: row.is_active ? 'Có' : 'Không',
                }));
                downloadCSV(exportRows, `budget-management-${dayjs().format('YYYYMMDD')}`);
              }}
            >
              Xuất CSV
            </Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={openCreateModal}>
              Tạo ngân sách
            </Button>
          </Space>
        </div>
      </Card>

      <Card
        title="Danh sách ngân sách"
        extra={(
          <Typography.Text type="secondary">
            {total.toLocaleString('vi-VN')} dòng ngân sách
          </Typography.Text>
        )}
      >
        <Table
          rowKey="id"
          loading={listQuery.isLoading || summaryQuery.isLoading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1500 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: (nextPage) => setPage(nextPage),
          }}
          locale={{
            emptyText: 'Chưa có ngân sách nào phù hợp bộ lọc.',
          }}
        />
      </Card>

      <Card title="Tổng hợp theo phòng ban">
        <Row gutter={[16, 16]}>
          {(summary?.departments ?? []).map((department) => (
            <Col xs={24} md={8} key={department.department}>
              <Card size="small">
                <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
                  {department.department}
                </Typography.Title>
                <p><strong>Ngân sách:</strong> {formatMoney(Number(department.budgeted_amount || 0))}</p>
                <p><strong>Đã dùng:</strong> {formatMoney(Number(department.actual_amount || 0))}</p>
                <p><strong>Cam kết:</strong> {formatMoney(Number(department.committed_amount || 0))}</p>
                <p><strong>Còn lại:</strong> {formatMoney(Number(department.available_amount || 0))}</p>
              </Card>
            </Col>
          ))}
          {(summary?.departments ?? []).length === 0 ? (
            <Col span={24}>
              <Typography.Text type="secondary">Chưa có dữ liệu tổng hợp theo phòng ban.</Typography.Text>
            </Col>
          ) : null}
        </Row>
      </Card>

      <Modal
        title={editing ? `Cập nhật ngân sách ${editing.department}` : 'Tạo ngân sách'}
        open={openModal}
        onOk={submitForm}
        onCancel={() => setOpenModal(false)}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnClose
        width={760}
      >
        <Form form={form} layout="vertical" initialValues={emptyForm}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="Phòng ban" name="department" rules={[{ required: true, message: 'Nhập phòng ban' }]}>
                <Input maxLength={100} placeholder="Ví dụ: Kinh doanh, Sản xuất, Hành chính" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Hạng mục" name="category" rules={[{ required: true, message: 'Nhập hạng mục' }]}>
                <Input maxLength={200} placeholder="Ví dụ: Marketing, Nhân công, Văn phòng" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Năm ngân sách" name="fiscal_year" rules={[{ required: true, message: 'Nhập năm ngân sách' }]}>
                <InputNumber min={2020} max={2100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Ngân sách kế hoạch" name="budgeted_amount" rules={[{ required: true, message: 'Nhập ngân sách kế hoạch' }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Đang sử dụng" name="is_active" valuePropName="checked">
                <Switch checkedChildren="Có" unCheckedChildren="Không" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="Đã sử dụng" name="actual_amount">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Cam kết chi" name="committed_amount">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={4} placeholder="Phục vụ đối soát với forecast hoặc luồng phê duyệt" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
