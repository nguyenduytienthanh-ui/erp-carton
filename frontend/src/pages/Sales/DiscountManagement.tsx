import React, { useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Skeleton, message, Tag, Row, Col, Card, Statistic, Form, InputNumber, DatePicker, Checkbox,
} from 'antd';
import { EyeOutlined, DeleteOutlined, PlusOutlined, EditOutlined, CheckOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { downloadCSV } from '../../utils/csvExport';
import { getToastMessage } from '../../utils/authz';

const DiscountManagement: React.FC = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formOpen, setFormOpen] = useState(false);
  const [editDiscount, setEditDiscount] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedDiscount, setSelectedDiscount] = useState<any>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // Mock data
  const mockData = {
    results: [
      {
        id: 1,
        code: 'DISC001',
        name: 'Khuyến mãi Tết',
        type: 'PERCENTAGE',
        value: 15,
        applicable_to: 'ALL_PRODUCTS',
        min_order_value: 5000000,
        max_discount_amount: 1000000,
        start_date: '2026-01-20',
        end_date: '2026-02-15',
        status: 'ACTIVE',
        usage_count: 45,
        total_discount_value: 45000000,
        created_by_name: 'Nguyễn Văn A',
      },
      {
        id: 2,
        code: 'DISC002',
        name: 'Chiết khấu khách hàng VIP',
        type: 'PERCENTAGE',
        value: 10,
        applicable_to: 'SPECIFIC_CUSTOMERS',
        min_order_value: 0,
        status: 'ACTIVE',
        usage_count: 120,
        total_discount_value: 85000000,
        created_by_name: 'Trần Văn B',
      },
      {
        id: 3,
        code: 'DISC003',
        name: 'Giảm giá số lượng',
        type: 'FIXED',
        value: 500000,
        applicable_to: 'VOLUME_BASED',
        min_quantity: 100,
        status: 'ACTIVE',
        usage_count: 30,
        total_discount_value: 15000000,
        created_by_name: 'Lê Văn C',
      },
      {
        id: 4,
        code: 'DISC004',
        name: 'Flash sale',
        type: 'PERCENTAGE',
        value: 25,
        applicable_to: 'SPECIFIC_PRODUCTS',
        min_order_value: 2000000,
        status: 'INACTIVE',
        usage_count: 0,
        total_discount_value: 0,
        created_by_name: 'Phạm Văn D',
      },
    ],
    count: 4,
  };

  const typeLabel: Record<string, string> = {
    PERCENTAGE: 'Phần trăm',
    FIXED: 'Cố định',
  };

  const typeColor: Record<string, string> = {
    PERCENTAGE: 'blue',
    FIXED: 'green',
  };

  const applicableToLabel: Record<string, string> = {
    ALL_PRODUCTS: 'Tất cả sản phẩm',
    SPECIFIC_PRODUCTS: 'Sản phẩm chọn',
    SPECIFIC_CUSTOMERS: 'Khách hàng chọn',
    VOLUME_BASED: 'Dựa trên số lượng',
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => Promise.resolve(data),
    onSuccess: () => {
      message.success('Tạo khuyến mãi thành công');
      form.resetFields();
      setFormOpen(false);
      setEditDiscount(null);
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Tạo khuyến mãi thất bại'));
    },
  });

  const handleExportCSV = () => {
    if (mockData?.results) {
      const csvData = mockData.results.map((d: any) => ({
        'Mã': d.code,
        'Tên': d.name,
        'Loại': typeLabel[d.type],
        'Giá trị': d.value,
        'Lần sử dụng': d.usage_count,
        'Tổng chiết khấu': d.total_discount_value?.toLocaleString('vi-VN'),
        'Trạng thái': d.status === 'ACTIVE' ? 'Hoạt động' : 'Không hoạt động',
      }));
      downloadCSV(csvData, 'khuyen-mai');
    }
  };

  const handleSubmitForm = async () => {
    try {
      const values = await form.validateFields();
      createMutation.mutate(values);
    } catch {
      message.error('Vui lòng kiểm tra lại form');
    }
  };

  const activeCount = mockData?.results?.filter((d: any) => d.status === 'ACTIVE').length || 0;
  const totalUsage = mockData?.results?.reduce((sum: number, d: any) => sum + (d.usage_count || 0), 0) || 0;
  const totalValue = mockData?.results?.reduce((sum: number, d: any) => sum + (d.total_discount_value || 0), 0) || 0;

  const columns = [
    {
      title: 'Mã',
      dataIndex: 'code',
      key: 'code',
      width: 100,
    },
    {
      title: 'Tên khuyến mãi',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: 'Loại',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => (
        <Tag color={typeColor[type]}>
          {typeLabel[type]} {/* Value shown in detail */}
        </Tag>
      ),
    },
    {
      title: 'Áp dụng cho',
      dataIndex: 'applicable_to',
      key: 'applicable_to',
      width: 130,
      render: (val: string) => applicableToLabel[val] || val,
    },
    {
      title: 'Lần sử dụng',
      dataIndex: 'usage_count',
      key: 'usage_count',
      width: 100,
      align: 'center' as const,
    },
    {
      title: 'Tổng chiết khấu',
      dataIndex: 'total_discount_value',
      key: 'total_discount_value',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={status === 'ACTIVE' ? 'success' : 'default'}>
          {status === 'ACTIVE' ? 'Hoạt động' : 'Không hoạt động'}
        </Tag>
      ),
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 150,
      render: (_: unknown, row: any) => (
        <Space wrap size="small">
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => { setSelectedDiscount(row); setDetailOpen(true); }}
          >
            Xem
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => { setEditDiscount(row); form.setFieldsValue(row); setFormOpen(true); }}
          >
            Sửa
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />}>
            Xóa
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      {/* Statistics */}
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={8}>
            <Statistic title="Khuyến mãi hoạt động" value={activeCount} valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col span={8}>
            <Statistic title="Tổng lần sử dụng" value={totalUsage} valueStyle={{ color: '#1677ff' }} />
          </Col>
          <Col span={8}>
            <Statistic
              title="Tổng chiết khấu"
              value={totalValue}
              prefix="₫"
              formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
            />
          </Col>
        </Row>
      </Card>

      {/* Filters */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Input
          placeholder="Tìm mã hoặc tên khuyến mãi..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ width: '220px' }}
        />
        <Select
          placeholder="Trạng thái"
          value={status}
          onChange={(val) => { setStatus(val); setPage(1); }}
          allowClear
          style={{ width: '150px' }}
          options={[
            { label: 'Hoạt động', value: 'ACTIVE' },
            { label: 'Không hoạt động', value: 'INACTIVE' },
          ]}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditDiscount(null); form.resetFields(); setFormOpen(true); }}>
          Tạo mới
        </Button>
        <Button onClick={handleExportCSV}>
          Xuất CSV
        </Button>
      </div>

      {/* Table */}
      <Table
        columns={columns}
        dataSource={mockData?.results || []}
        pagination={{
          current: page,
          pageSize,
          total: mockData?.count,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
        }}
        rowKey="id"
        scroll={{ x: 1200 }}
      />

      {/* Modal Tạo/Sửa */}
      <Modal
        title={editDiscount ? 'Sửa khuyến mãi' : 'Tạo khuyến mãi mới'}
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditDiscount(null); form.resetFields(); }}
        onOk={handleSubmitForm}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Tên khuyến mãi" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Loại" name="type" rules={[{ required: true }]}>
            <Select options={[
              { label: 'Phần trăm', value: 'PERCENTAGE' },
              { label: 'Cố định', value: 'FIXED' },
            ]} />
          </Form.Item>
          <Form.Item label="Giá trị" name="value" rules={[{ required: true }]}>
            <InputNumber min={0} max={100} />
          </Form.Item>
          <Form.Item label="Ngày bắt đầu" name="start_date" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="Ngày kết thúc" name="end_date" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="Hoạt động" name="is_active" valuePropName="checked">
            <Checkbox>Kích hoạt ngay</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Chi tiết */}
      <Modal title="Chi tiết khuyến mãi" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={600}>
        {selectedDiscount && (
          <div>
            <p><strong>Mã:</strong> {selectedDiscount.code}</p>
            <p><strong>Tên:</strong> {selectedDiscount.name}</p>
            <p><strong>Loại:</strong> {typeLabel[selectedDiscount.type]} ({selectedDiscount.value}{selectedDiscount.type === 'PERCENTAGE' ? '%' : ' đ'})</p>
            <p><strong>Áp dụng cho:</strong> {applicableToLabel[selectedDiscount.applicable_to]}</p>
            <p><strong>Từ:</strong> {dayjs(selectedDiscount.start_date).format('DD/MM/YYYY')}</p>
            <p><strong>Đến:</strong> {dayjs(selectedDiscount.end_date).format('DD/MM/YYYY')}</p>
            <p><strong>Lần sử dụng:</strong> {selectedDiscount.usage_count}</p>
            <p><strong>Tổng chiết khấu:</strong> {selectedDiscount.total_discount_value?.toLocaleString('vi-VN')} đ</p>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default DiscountManagement;
