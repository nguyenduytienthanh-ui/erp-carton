import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';

import { salesApi } from '../../api/sales';
import { getToastMessage } from '../../shared/apiError';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { downloadCSV } from '../../utils/csvExport';
import { canAccessSalesOrders } from '../../utils/authz';
import type {
  SalesDiscountApplicability,
  SalesDiscountRule,
  SalesDiscountStatus,
  SalesDiscountType,
} from '../../types/sales';

type DiscountFilters = {
  status: '' | SalesDiscountStatus;
  type: '' | SalesDiscountType;
  applicable_to: '' | SalesDiscountApplicability;
  currently_active: '' | 'true' | 'false';
};

type DiscountFormValues = {
  code: string;
  name: string;
  type: SalesDiscountType;
  value: number;
  applicable_to: SalesDiscountApplicability;
  min_order_value?: number | null;
  min_quantity?: number | null;
  max_discount_amount?: number | null;
  start_date: Dayjs;
  end_date?: Dayjs | null;
  status: SalesDiscountStatus;
  note?: string;
};

const emptyForm: DiscountFormValues = {
  code: '',
  name: '',
  type: 'PERCENTAGE',
  value: 10,
  applicable_to: 'ALL_PRODUCTS',
  min_order_value: 0,
  min_quantity: null,
  max_discount_amount: null,
  start_date: dayjs(),
  end_date: dayjs().add(30, 'day'),
  status: 'ACTIVE',
  note: '',
};

const typeOptions: Array<{ value: SalesDiscountType; label: string }> = [
  { value: 'PERCENTAGE', label: 'Phần trăm' },
  { value: 'FIXED', label: 'Số tiền cố định' },
];

const statusOptions: Array<{ value: SalesDiscountStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Hoạt động' },
  { value: 'INACTIVE', label: 'Tạm dừng' },
];

const applicableOptions: Array<{ value: SalesDiscountApplicability; label: string }> = [
  { value: 'ALL_PRODUCTS', label: 'Tất cả sản phẩm' },
  { value: 'SPECIFIC_PRODUCTS', label: 'Sản phẩm chọn' },
  { value: 'SPECIFIC_CUSTOMERS', label: 'Khách hàng chọn' },
  { value: 'VOLUME_BASED', label: 'Theo số lượng' },
];

const currentStateOptions = [
  { value: '', label: 'Tất cả thời gian áp dụng' },
  { value: 'true', label: 'Đang áp dụng' },
  { value: 'false', label: 'Chưa hoặc hết áp dụng' },
];

function serializeFilters(filters: DiscountFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): DiscountFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<DiscountFilters>;
    return {
      status: parsed.status === 'ACTIVE' || parsed.status === 'INACTIVE' ? parsed.status : '',
      type: parsed.type === 'PERCENTAGE' || parsed.type === 'FIXED' ? parsed.type : '',
      applicable_to:
        parsed.applicable_to === 'ALL_PRODUCTS'
        || parsed.applicable_to === 'SPECIFIC_PRODUCTS'
        || parsed.applicable_to === 'SPECIFIC_CUSTOMERS'
        || parsed.applicable_to === 'VOLUME_BASED'
          ? parsed.applicable_to
          : '',
      currently_active:
        parsed.currently_active === 'true' || parsed.currently_active === 'false'
          ? parsed.currently_active
          : '',
    };
  } catch {
    return { status: '', type: '', applicable_to: '', currently_active: '' };
  }
}

const formatMoney = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 0 });

export default function DiscountManagement() {
  const canManage = canAccessSalesOrders();
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<DiscountFilters>({
    status: '',
    type: '',
    applicable_to: '',
    currently_active: '',
  });
  const [openModal, setOpenModal] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState<SalesDiscountRule | null>(null);
  const [selectedDiscount, setSelectedDiscount] = useState<SalesDiscountRule | null>(null);
  const [form] = Form.useForm<DiscountFormValues>();
  const selectedType = Form.useWatch('type', form) ?? 'PERCENTAGE';

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 500,
    filterDebounceMs: 250,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, ordering: '-created_at' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.type) next.type = intentFilters.type;
    if (intentFilters.applicable_to) next.applicable_to = intentFilters.applicable_to;
    if (intentFilters.currently_active) next.currently_active = intentFilters.currently_active;
    return next;
  }, [intentSearch, intentFilters, page]);

  const summaryParams = useMemo(() => {
    const next: Record<string, unknown> = {};
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.type) next.type = intentFilters.type;
    if (intentFilters.applicable_to) next.applicable_to = intentFilters.applicable_to;
    if (intentFilters.currently_active) next.currently_active = intentFilters.currently_active;
    return next;
  }, [intentSearch, intentFilters]);

  const listQuery = useQuery({
    queryKey: ['sales-discounts', params],
    queryFn: () => salesApi.getDiscounts(params),
  });
  const summaryQuery = useQuery({
    queryKey: ['sales-discounts-summary', summaryParams],
    queryFn: () => salesApi.getDiscountSummary(summaryParams),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['sales-discounts'] });
    await queryClient.invalidateQueries({ queryKey: ['sales-discounts-summary'] });
  };

  const createMutation = useMutation({
    mutationFn: salesApi.createDiscount,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã tạo chương trình chiết khấu');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof salesApi.updateDiscount>[1] }) =>
      salesApi.updateDiscount(id, payload),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã cập nhật chiết khấu');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: salesApi.deleteDiscount,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã xóa chiết khấu');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const toggleMutation = useMutation({
    mutationFn: (row: SalesDiscountRule) => (
      row.status === 'ACTIVE'
        ? salesApi.deactivateDiscount(row.id)
        : salesApi.activateDiscount(row.id)
    ),
    onSuccess: async (row) => {
      await invalidate();
      messageApi.success(
        row.status === 'ACTIVE'
          ? `Đã kích hoạt ${row.code}`
          : `Đã tạm dừng ${row.code}`,
      );
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

  const openEditModal = (row: SalesDiscountRule) => {
    setEditing(row);
    form.setFieldsValue({
      code: row.code,
      name: row.name,
      type: row.type,
      value: Number(row.value || 0),
      applicable_to: row.applicable_to,
      min_order_value: Number(row.min_order_value || 0),
      min_quantity: row.min_quantity == null ? null : Number(row.min_quantity),
      max_discount_amount: row.max_discount_amount == null ? null : Number(row.max_discount_amount),
      start_date: dayjs(row.start_date),
      end_date: row.end_date ? dayjs(row.end_date) : null,
      status: row.status,
      note: row.note || '',
    });
    setOpenModal(true);
  };

  const submitForm = async () => {
    const values = await form.validateFields();
    const payload = {
      code: values.code.trim().toUpperCase(),
      name: values.name.trim(),
      type: values.type,
      value: Number(values.value || 0),
      applicable_to: values.applicable_to,
      min_order_value: Number(values.min_order_value || 0),
      min_quantity: values.min_quantity == null ? null : Number(values.min_quantity),
      max_discount_amount: values.max_discount_amount == null ? null : Number(values.max_discount_amount),
      start_date: values.start_date.format('YYYY-MM-DD'),
      end_date: values.end_date ? values.end_date.format('YYYY-MM-DD') : null,
      status: values.status,
      note: values.note?.trim() || '',
    };
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setOpenModal(false);
  };

  const columns: ColumnsType<SalesDiscountRule> = [
    { title: 'Mã', dataIndex: 'code', width: 120 },
    { title: 'Tên chương trình', dataIndex: 'name', width: 220 },
    {
      title: 'Loại',
      dataIndex: 'type',
      width: 130,
      render: (value: SalesDiscountType) => (
        <Tag color={value === 'PERCENTAGE' ? 'blue' : 'green'}>
          {value === 'PERCENTAGE' ? 'Phần trăm' : 'Số tiền'}
        </Tag>
      ),
    },
    {
      title: 'Giá trị',
      dataIndex: 'value',
      width: 130,
      align: 'right',
      render: (value: string, row) => (
        row.type === 'PERCENTAGE'
          ? `${Number(value || 0).toLocaleString('vi-VN')}%`
          : `${formatMoney(Number(value || 0))} đ`
      ),
    },
    {
      title: 'Áp dụng cho',
      dataIndex: 'applicable_to',
      width: 160,
      render: (value: SalesDiscountApplicability) => (
        applicableOptions.find((item) => item.value === value)?.label ?? value
      ),
    },
    {
      title: 'Hiệu lực',
      key: 'period',
      width: 190,
      render: (_, row) => `${dayjs(row.start_date).format('DD/MM/YYYY')} - ${row.end_date ? dayjs(row.end_date).format('DD/MM/YYYY') : 'Không giới hạn'}`,
    },
    {
      title: 'Sử dụng',
      dataIndex: 'usage_count',
      width: 100,
      align: 'right',
      render: (value: number) => value.toLocaleString('vi-VN'),
    },
    {
      title: 'Tổng giảm',
      dataIndex: 'total_discount_value',
      width: 140,
      align: 'right',
      render: (value: string) => formatMoney(Number(value || 0)),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 150,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Tag color={row.status === 'ACTIVE' ? 'success' : 'default'}>
            {row.status === 'ACTIVE' ? 'Hoạt động' : 'Tạm dừng'}
          </Tag>
          <Tag color={row.is_currently_active ? 'processing' : 'default'}>
            {row.is_currently_active ? 'Đang áp dụng' : 'Ngoài khung'}
          </Tag>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 240,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap size="small">
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              setSelectedDiscount(row);
              setDetailOpen(true);
            }}
          >
            Xem
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            disabled={!canManage}
            onClick={() => openEditModal(row)}
          >
            Sửa
          </Button>
          <Button
            size="small"
            disabled={!canManage}
            onClick={() =>
              Modal.confirm({
                title: `${row.status === 'ACTIVE' ? 'Tạm dừng' : 'Kích hoạt'} ${row.code}?`,
                okText: row.status === 'ACTIVE' ? 'Tạm dừng' : 'Kích hoạt',
                cancelText: 'Hủy',
                onOk: () => toggleMutation.mutateAsync(row),
              })
            }
          >
            {row.status === 'ACTIVE' ? 'Tạm dừng' : 'Kích hoạt'}
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!canManage}
            onClick={() =>
              Modal.confirm({
                title: `Xóa chiết khấu ${row.code}?`,
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
            <Statistic title="Đang kích hoạt" value={summary?.active_count ?? 0} valueStyle={{ color: '#1677ff' }} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic title="Đang áp dụng" value={summary?.currently_active_count ?? 0} valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic title="Tổng lượt sử dụng" value={summary?.total_usage ?? 0} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic
              title="Tổng giá trị chiết khấu"
              value={Number(summary?.total_discount_value ?? 0)}
              formatter={(value) => `${formatMoney(Number(value || 0))} đ`}
            />
          </Col>
        </Row>
      </Card>

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
              placeholder="Tìm theo mã, tên hoặc ghi chú"
              style={{ width: 260 }}
            />
            <Select
              allowClear
              placeholder="Trạng thái"
              value={filters.status || undefined}
              options={statusOptions}
              style={{ width: 150 }}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, status: (value ?? '') as DiscountFilters['status'] }));
                setPage(1);
              }}
            />
            <Select
              allowClear
              placeholder="Loại chiết khấu"
              value={filters.type || undefined}
              options={typeOptions}
              style={{ width: 150 }}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, type: (value ?? '') as DiscountFilters['type'] }));
                setPage(1);
              }}
            />
            <Select
              allowClear
              placeholder="Phạm vi áp dụng"
              value={filters.applicable_to || undefined}
              options={applicableOptions}
              style={{ width: 180 }}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, applicable_to: (value ?? '') as DiscountFilters['applicable_to'] }));
                setPage(1);
              }}
            />
            <Select
              value={filters.currently_active}
              options={currentStateOptions}
              style={{ width: 190 }}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, currently_active: value }));
                setPage(1);
              }}
            />
            <Button
              onClick={() => {
                setSearchInput('');
                setFilters({ status: '', type: '', applicable_to: '', currently_active: '' });
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
                  Ma: row.code,
                  Ten: row.name,
                  Loai: row.type,
                  Gia_tri: row.value,
                  Ap_dung_cho: row.applicable_to,
                  Su_dung: row.usage_count,
                  Tong_giam: row.total_discount_value,
                  Trang_thai: row.status,
                  Dang_ap_dung: row.is_currently_active ? 'Có' : 'Không',
                }));
                downloadCSV(exportRows, `sales-discounts-${dayjs().format('YYYYMMDD')}`);
              }}
            >
              Xuất CSV
            </Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={openCreateModal}>
              Tạo chiết khấu
            </Button>
          </Space>
        </div>
      </Card>

      <Card
        title="Danh sách chiết khấu"
        extra={(
          <Typography.Text type="secondary">
            {total.toLocaleString('vi-VN')} chương trình
          </Typography.Text>
        )}
      >
        <Table
          rowKey="id"
          loading={listQuery.isLoading || summaryQuery.isLoading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1600 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: (nextPage) => setPage(nextPage),
          }}
          locale={{
            emptyText: 'Chưa có chương trình chiết khấu phù hợp bộ lọc.',
          }}
        />
      </Card>

      <Modal
        title={editing ? `Cập nhật ${editing.code}` : 'Tạo chương trình chiết khấu'}
        open={openModal}
        onOk={submitForm}
        onCancel={() => setOpenModal(false)}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnClose
        width={820}
      >
        <Form form={form} layout="vertical" initialValues={emptyForm}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Mã" name="code" rules={[{ required: true, message: 'Nhập mã chiết khấu' }]}>
                <Input maxLength={30} placeholder="VD: DISC-TET-2026" />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item label="Tên chương trình" name="name" rules={[{ required: true, message: 'Nhập tên chương trình' }]}>
                <Input maxLength={200} placeholder="Tên hiển thị cho kinh doanh" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Loại" name="type" rules={[{ required: true, message: 'Chọn loại chiết khấu' }]}>
                <Select options={typeOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label={selectedType === 'PERCENTAGE' ? 'Giá trị (%)' : 'Giá trị (VND)'} name="value" rules={[{ required: true, message: 'Nhập giá trị chiết khấu' }]}>
                <InputNumber min={0} max={selectedType === 'PERCENTAGE' ? 100 : undefined} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Trạng thái" name="status" rules={[{ required: true, message: 'Chọn trạng thái' }]}>
                <Select options={statusOptions} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Phạm vi áp dụng" name="applicable_to" rules={[{ required: true, message: 'Chọn phạm vi áp dụng' }]}>
                <Select options={applicableOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Đơn hàng tối thiểu" name="min_order_value">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Số lượng tối thiểu" name="min_quantity">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Trần giảm tối đa" name="max_discount_amount">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Ngày bắt đầu" name="start_date" rules={[{ required: true, message: 'Chọn ngày bắt đầu' }]}>
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                label="Ngày kết thúc"
                name="end_date"
                dependencies={['start_date']}
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const startDate = getFieldValue('start_date');
                      if (!value || !startDate || !dayjs(value).isBefore(dayjs(startDate), 'day')) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('Ngày kết thúc phải sau ngày bắt đầu'));
                    },
                  }),
                ]}
              >
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={4} placeholder="Điều kiện bổ sung cho kinh doanh hoặc chính sách giá backend" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={selectedDiscount ? `Chi tiết ${selectedDiscount.code}` : 'Chi tiết chiết khấu'}
        open={detailOpen}
        footer={null}
        onCancel={() => setDetailOpen(false)}
        width={720}
      >
        {selectedDiscount ? (
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card size="small" title="Thông tin chung">
                <p><strong>Tên:</strong> {selectedDiscount.name}</p>
                <p><strong>Loại:</strong> {typeOptions.find((item) => item.value === selectedDiscount.type)?.label ?? selectedDiscount.type}</p>
                <p><strong>Giá trị:</strong> {selectedDiscount.type === 'PERCENTAGE' ? `${selectedDiscount.value}%` : `${formatMoney(Number(selectedDiscount.value || 0))} đ`}</p>
                <p><strong>Áp dụng:</strong> {applicableOptions.find((item) => item.value === selectedDiscount.applicable_to)?.label ?? selectedDiscount.applicable_to}</p>
                <p><strong>Trạng thái:</strong> {statusOptions.find((item) => item.value === selectedDiscount.status)?.label ?? selectedDiscount.status}</p>
                <p><strong>Đang áp dụng:</strong> {selectedDiscount.is_currently_active ? 'Có' : 'Không'}</p>
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card size="small" title="Ngưỡng và hiệu lực">
                <p><strong>Đơn hàng tối thiểu:</strong> {formatMoney(Number(selectedDiscount.min_order_value || 0))} đ</p>
                <p><strong>Số lượng tối thiểu:</strong> {selectedDiscount.min_quantity ?? '-'}</p>
                <p><strong>Trần giảm:</strong> {selectedDiscount.max_discount_amount ? `${formatMoney(Number(selectedDiscount.max_discount_amount || 0))} đ` : '-'}</p>
                <p><strong>Bắt đầu:</strong> {dayjs(selectedDiscount.start_date).format('DD/MM/YYYY')}</p>
                <p><strong>Kết thúc:</strong> {selectedDiscount.end_date ? dayjs(selectedDiscount.end_date).format('DD/MM/YYYY') : 'Không giới hạn'}</p>
              </Card>
            </Col>
            <Col span={24}>
              <Card size="small" title="Hiệu quả">
                <p><strong>Số lần sử dụng:</strong> {selectedDiscount.usage_count.toLocaleString('vi-VN')}</p>
                <p><strong>Tổng giá trị giảm:</strong> {formatMoney(Number(selectedDiscount.total_discount_value || 0))} đ</p>
                <p><strong>Người tạo:</strong> {selectedDiscount.created_by_name || '-'}</p>
                <p><strong>Ghi chú:</strong> {selectedDiscount.note || '-'}</p>
              </Card>
            </Col>
          </Row>
        ) : null}
      </Modal>
    </div>
  );
}
