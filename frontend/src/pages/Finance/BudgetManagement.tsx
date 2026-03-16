import React, { useState } from 'react';
import {
  Card, Row, Col, Form, Input, Button, Table, Modal, Space, message, InputNumber, Select, Checkbox,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import { downloadCSV } from '../../utils/csvExport';

const BudgetManagement: React.FC = () => {
  const [budgets, setBudgets] = useState([
    {
      id: 1,
      department: 'Bán hàng',
      category: 'Marketing',
      budgeted_amount: 500000000,
      actual_amount: 380000000,
      committed_amount: 50000000,
      available: 70000000,
      status: 'ON_TRACK',
    },
    {
      id: 2,
      department: 'Sản xuất',
      category: 'Chi phí lao động',
      budgeted_amount: 2000000000,
      actual_amount: 1800000000,
      committed_amount: 150000000,
      available: 50000000,
      status: 'OVER_BUDGET',
    },
    {
      id: 3,
      department: 'Hành chính',
      category: 'Văn phòng',
      budgeted_amount: 200000000,
      actual_amount: 120000000,
      committed_amount: 20000000,
      available: 60000000,
      status: 'ON_TRACK',
    },
  ]);

  const [formOpen, setFormOpen] = useState(false);
  const [form] = Form.useForm();

  const columns = [
    {
      title: 'Phòng ban',
      dataIndex: 'department',
      key: 'department',
      width: 120,
    },
    {
      title: 'Hạng mục',
      dataIndex: 'category',
      key: 'category',
      width: 130,
    },
    {
      title: 'Ngân sách',
      dataIndex: 'budgeted_amount',
      key: 'budgeted_amount',
      width: 130,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Đã sử dụng',
      dataIndex: 'actual_amount',
      key: 'actual_amount',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: '% Sử dụng',
      key: 'percentage',
      width: 100,
      align: 'center' as const,
      render: (_, row: any) => {
        const pct = (row.actual_amount / row.budgeted_amount * 100).toFixed(0);
        return <span style={{ color: pct > '100' ? '#ff4d4f' : '#52c41a' }}>{pct}%</span>;
      },
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (val: string) => {
        const color = val === 'ON_TRACK' ? 'success' : 'error';
        const label = val === 'ON_TRACK' ? 'Trong kế hoạch' : 'Vượt ngân sách';
        return <span style={{ color: color === 'success' ? '#52c41a' : '#ff4d4f' }}>{label}</span>;
      },
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 100,
      render: () => (
        <Space>
          <Button size="small" icon={<EditOutlined />} />
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Space>
      ),
    },
  ];

  const handleAddBudget = async () => {
    try {
      const values = await form.validateFields();
      message.success('Thêm ngân sách thành công');
      setFormOpen(false);
      form.resetFields();
    } catch {
      message.error('Vui lòng kiểm tra lại');
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <Card title="💰 Quản lý Ngân sách" style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={6}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold' }}>2.7 Tỷ</div>
              <div>Tổng ngân sách</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#1677ff' }}>2.3 Tỷ</div>
              <div>Đã sử dụng</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#faad14' }}>220 Tỷ</div>
              <div>Cam kết</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#52c41a' }}>180 Tỷ</div>
              <div>Còn lại</div>
            </div>
          </Col>
        </Row>
      </Card>

      <div style={{ marginBottom: '20px' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormOpen(true)}>
          Tạo ngân sách mới
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={budgets}
        pagination={false}
        rowKey="id"
        scroll={{ x: 900 }}
      />

      <Modal
        title="Tạo ngân sách"
        open={formOpen}
        onOk={handleAddBudget}
        onCancel={() => setFormOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Phòng ban" name="department" rules={[{ required: true }]}>
            <Select options={[
              { label: 'Bán hàng', value: 'sales' },
              { label: 'Sản xuất', value: 'production' },
              { label: 'Hành chính', value: 'admin' },
            ]} />
          </Form.Item>
          <Form.Item label="Hạng mục" name="category" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Ngân sách" name="amount" rules={[{ required: true }]}>
            <InputNumber min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default BudgetManagement;
