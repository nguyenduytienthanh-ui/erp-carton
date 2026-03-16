import React, { useState } from 'react';
import {
  Card, Row, Col, Table, Button, Space, Input, Select, DatePicker, Tooltip, Progress, Tag, message,
} from 'antd';
import {
  DownloadOutlined, FilterOutlined, UnlockOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

import { downloadCSV } from '../../utils/csvExport';

const InventoryForecast: React.FC = () => {
  const [sortBy, setSortBy] = useState<'abc' | 'eoq' | 'reorder'>('abc');

  // Mock data
  const forecastData = [
    {
      id: 1,
      product_code: 'SP001',
      product_name: 'Sản phẩm A',
      current_stock: 500,
      abc_class: 'A',
      avg_monthly_usage: 150,
      lead_time_days: 7,
      eoq: 425,
      reorder_point: 225,
      safety_stock: 75,
      status: 'OK',
      stockout_risk: 'LOW',
    },
    {
      id: 2,
      product_code: 'SP002',
      product_name: 'Sản phẩm B',
      current_stock: 80,
      abc_class: 'B',
      avg_monthly_usage: 50,
      lead_time_days: 14,
      eoq: 300,
      reorder_point: 100,
      safety_stock: 35,
      status: 'WARNING',
      stockout_risk: 'MEDIUM',
    },
    {
      id: 3,
      product_code: 'SP003',
      product_name: 'Sản phẩm C',
      current_stock: 15,
      abc_class: 'C',
      avg_monthly_usage: 20,
      lead_time_days: 21,
      eoq: 180,
      reorder_point: 60,
      safety_stock: 25,
      status: 'ALERT',
      stockout_risk: 'HIGH',
    },
  ];

  const columns = [
    {
      title: 'Mã sản phẩm',
      dataIndex: 'product_code',
      key: 'product_code',
      width: 100,
    },
    {
      title: 'Tên',
      dataIndex: 'product_name',
      key: 'product_name',
      width: 150,
    },
    {
      title: 'Tồn kho',
      dataIndex: 'current_stock',
      key: 'current_stock',
      width: 80,
      align: 'center' as const,
    },
    {
      title: 'Phân loại ABC',
      dataIndex: 'abc_class',
      key: 'abc_class',
      width: 100,
      render: (val: string) => (
        <Tag color={val === 'A' ? 'red' : val === 'B' ? 'orange' : 'green'}>
          {val}
        </Tag>
      ),
    },
    {
      title: 'Điểm đặt hàng',
      dataIndex: 'reorder_point',
      key: 'reorder_point',
      width: 100,
      align: 'center' as const,
    },
    {
      title: 'EOQ',
      dataIndex: 'eoq',
      key: 'eoq',
      width: 80,
      align: 'center' as const,
    },
    {
      title: 'Tồn kho an toàn',
      dataIndex: 'safety_stock',
      key: 'safety_stock',
      width: 100,
      align: 'center' as const,
    },
    {
      title: 'Rủi ro',
      dataIndex: 'stockout_risk',
      key: 'stockout_risk',
      width: 100,
      render: (val: string) => {
        const color = val === 'LOW' ? 'success' : val === 'MEDIUM' ? 'warning' : 'error';
        const label = val === 'LOW' ? 'Thấp' : val === 'MEDIUM' ? 'Trung bình' : 'Cao';
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 120,
      render: (_, row: any) => (
        <Button size="small" type={row.status === 'ALERT' ? 'primary' : 'default'}>
          {row.status === 'ALERT' ? 'Đặt hàng' : 'Chi tiết'}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      <Card title="📊 Dự báo Tồn kho" style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={12}>
            <div>
              <strong>Công thức EOQ (Economic Order Quantity):</strong>
              <p>EOQ = √(2 × D × S / H)</p>
              <p style={{ fontSize: '12px', color: '#999' }}>
                D = Nhu cầu hàng năm, S = Chi phí đặt hàng, H = Chi phí lưu kho
              </p>
            </div>
          </Col>
          <Col span={12}>
            <div>
              <strong>Điểm đặt hàng (Reorder Point):</strong>
              <p>ROP = (Nhu cầu trung bình × Thời gian dẫn) + Tồn kho an toàn</p>
              <p style={{ fontSize: '12px', color: '#999' }}>
                Đảm bảo không bị thiếu hàng
              </p>
            </div>
          </Col>
        </Row>
      </Card>

      {/* Filters */}
      <Card style={{ marginBottom: '20px' }}>
        <Space>
          <Select
            value={sortBy}
            onChange={setSortBy}
            options={[
              { label: 'Phân loại ABC', value: 'abc' },
              { label: 'EOQ', value: 'eoq' },
              { label: 'Điểm đặt hàng', value: 'reorder' },
            ]}
            style={{ width: '150px' }}
          />
          <Button icon={<DownloadOutlined />} onClick={() => downloadCSV(forecastData, 'inventory-forecast')}>
            Xuất CSV
          </Button>
        </Space>
      </Card>

      {/* Table */}
      <Table
        columns={columns}
        dataSource={forecastData}
        pagination={false}
        rowKey="id"
        scroll={{ x: 1100 }}
      />

      {/* Summary */}
      <Card title="Tóm tắt" style={{ marginTop: '20px' }}>
        <Row gutter={24}>
          <Col span={6}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ff4d4f' }}>2</div>
              <div style={{ color: '#666' }}>Cảnh báo cần hành động</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#faad14' }}>1</div>
              <div style={{ color: '#666' }}>Rủi ro trung bình</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#52c41a' }}>1</div>
              <div style={{ color: '#666' }}>Tình trạng OK</div>
            </div>
          </Col>
          <Col span={6}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1677ff' }}>1,105</div>
              <div style={{ color: '#666' }}>Tổng EOQ</div>
            </div>
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default InventoryForecast;
