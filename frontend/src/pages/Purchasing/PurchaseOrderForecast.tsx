import React, { useState } from 'react';
import { Card, Row, Col, Table, Button, Space, Input, DatePicker, Select, message, Tag, Modal, Form, InputNumber } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { downloadCSV } from '../../utils/csvExport';

const PurchaseOrderForecast: React.FC = () => {
  const [formOpen, setFormOpen] = useState(false);
  const [form] = Form.useForm();

  const mockData = [
    {
      id: 1,
      product_code: 'SP001',
      product_name: 'Sản phẩm A',
      current_stock: 500,
      avg_monthly_demand: 150,
      lead_time: 7,
      eoq: 425,
      reorder_point: 225,
      suggested_qty: 425,
      estimated_cost: 127500000,
      urgency: 'LOW',
    },
    {
      id: 2,
      product_code: 'SP002',
      product_name: 'Sản phẩm B',
      current_stock: 80,
      avg_monthly_demand: 50,
      lead_time: 14,
      eoq: 300,
      reorder_point: 100,
      suggested_qty: 300,
      estimated_cost: 60000000,
      urgency: 'HIGH',
    },
  ];

  const columns = [
    { title: 'Mã', dataIndex: 'product_code', width: 100 },
    { title: 'Sản phẩm', dataIndex: 'product_name', width: 150 },
    { title: 'Tồn kho', dataIndex: 'current_stock', width: 100, align: 'center' as const },
    { title: 'Nhu cầu/tháng', dataIndex: 'avg_monthly_demand', width: 120, align: 'center' as const },
    { title: 'Đề xuất mua', dataIndex: 'suggested_qty', width: 120, align: 'center' as const },
    { title: 'Chi phí dự tính', dataIndex: 'estimated_cost', width: 140, align: 'right' as const, render: (v: number) => v?.toLocaleString('vi-VN') },
    {
      title: 'Mức độ',
      dataIndex: 'urgency',
      width: 100,
      render: (v: string) => <Tag color={v === 'HIGH' ? 'red' : v === 'MEDIUM' ? 'orange' : 'green'}>{v}</Tag>,
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 120,
      render: () => <Space size="small"><Button size="small" icon={<EyeOutlined />} /><Button size="small" icon={<PlusOutlined />} /></Space>,
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      <Card title="📊 Dự báo Đơn mua" style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={8}><div><strong>Tổng dự tính:</strong> 187.5M đ</div></Col>
          <Col span={8}><div><strong>Cần mua gấp:</strong> 2 sản phẩm</div></Col>
          <Col span={8}><div><strong>Thời gian dẫn TB:</strong> 10.5 ngày</div></Col>
        </Row>
      </Card>
      <Table columns={columns} dataSource={mockData} pagination={false} rowKey="id" scroll={{ x: 1000 }} />
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormOpen(true)} style={{ marginTop: '20px' }}>
        Tạo PO từ dự báo
      </Button>
    </div>
  );
};

export default PurchaseOrderForecast;
