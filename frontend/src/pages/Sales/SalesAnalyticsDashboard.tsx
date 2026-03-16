import React, { useState } from 'react';
import {
  Card, Row, Col, Statistic, LineChart, BarChart, PieChart, Select, DatePicker, Space, Skeleton, Table, Tag,
} from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

import { downloadCSV } from '../../utils/csvExport';

const SalesAnalyticsDashboard: React.FC = () => {
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month');
  const [startDate, setStartDate] = useState<Dayjs>(dayjs().subtract(12, 'months'));
  const [endDate, setEndDate] = useState<Dayjs>(dayjs());

  // Mock data - replace with actual API
  const metrics = {
    total_revenue: 5000000000,
    total_orders: 150,
    avg_order_value: 33333333,
    revenue_growth: 15.5,
    order_growth: 8.2,
    top_customers: [
      { id: 1, name: 'Công ty A', revenue: 800000000, orders: 25, growth: 12 },
      { id: 2, name: 'Công ty B', revenue: 650000000, orders: 18, growth: 8 },
      { id: 3, name: 'Công ty C', revenue: 580000000, orders: 15, growth: -5 },
      { id: 4, name: 'Công ty D', revenue: 450000000, orders: 12, growth: 20 },
      { id: 5, name: 'Công ty E', revenue: 390000000, orders: 10, growth: 3 },
    ],
    top_products: [
      { id: 1, name: 'Sản phẩm A', revenue: 600000000, units: 5000, growth: 18 },
      { id: 2, name: 'Sản phẩm B', revenue: 550000000, units: 4500, growth: 12 },
      { id: 3, name: 'Sản phẩm C', revenue: 480000000, units: 4000, growth: 8 },
      { id: 4, name: 'Sản phẩm D', revenue: 420000000, units: 3500, growth: -3 },
      { id: 5, name: 'Sản phẩm E', revenue: 380000000, units: 3200, growth: 5 },
    ],
    conversion_rate: 68.5,
    avg_deal_size: 33333333,
    sales_by_region: [
      { region: 'HCM', revenue: 1500000000, orders: 50 },
      { region: 'Hà Nội', revenue: 1200000000, orders: 40 },
      { region: 'Đà Nẵng', revenue: 800000000, orders: 25 },
      { region: 'Cần Thơ', revenue: 500000000, orders: 20 },
      { region: 'Khác', revenue: 1000000000, orders: 15 },
    ],
  };

  const handleExportCSV = () => {
    const csvData = [
      {
        'Metric': 'Tổng doanh thu',
        'Value': metrics.total_revenue?.toLocaleString('vi-VN'),
      },
      {
        'Metric': 'Tổng đơn hàng',
        'Value': metrics.total_orders,
      },
      {
        'Metric': 'Giá trị trung bình',
        'Value': metrics.avg_order_value?.toLocaleString('vi-VN'),
      },
      {
        'Metric': 'Tăng trưởng doanh thu',
        'Value': `${metrics.revenue_growth}%`,
      },
    ];
    downloadCSV(csvData, 'sales-analytics');
  };

  const topCustomersColumns = [
    {
      title: 'Khách hàng',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: 'Doanh thu',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Đơn hàng',
      dataIndex: 'orders',
      key: 'orders',
      width: 80,
      align: 'center' as const,
    },
    {
      title: 'Tăng trưởng',
      dataIndex: 'growth',
      key: 'growth',
      width: 100,
      align: 'right' as const,
      render: (val: number) => (
        <span style={{ color: val >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {val >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(val)}%
        </span>
      ),
    },
  ];

  const topProductsColumns = [
    {
      title: 'Sản phẩm',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: 'Doanh thu',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Số lượng',
      dataIndex: 'units',
      key: 'units',
      width: 100,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN'),
    },
    {
      title: 'Tăng trưởng',
      dataIndex: 'growth',
      key: 'growth',
      width: 100,
      align: 'right' as const,
      render: (val: number) => (
        <span style={{ color: val >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {val >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(val)}%
        </span>
      ),
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      {/* Header */}
      <Card style={{ marginBottom: '20px' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <span>Từ:</span>
              <DatePicker
                value={startDate}
                onChange={(date) => setStartDate(date!)}
                format="DD/MM/YYYY"
              />
              <span>Đến:</span>
              <DatePicker
                value={endDate}
                onChange={(date) => setEndDate(date!)}
                format="DD/MM/YYYY"
              />
            </Space>
          </Col>
          <Col>
            <button onClick={handleExportCSV} style={{ padding: '8px 16px', cursor: 'pointer' }}>
              📥 Xuất CSV
            </button>
          </Col>
        </Row>
      </Card>

      {/* Main Metrics */}
      <Card title="Chỉ số chính" style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={6}>
            <Card>
              <Statistic
                title="Tổng doanh thu"
                value={metrics.total_revenue}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                suffix={<ArrowUpOutlined style={{ color: '#52c41a' }} />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="Tổng đơn hàng"
                value={metrics.total_orders}
                valueStyle={{ color: '#1677ff' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="Giá trị trung bình"
                value={metrics.avg_order_value}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="Tăng trưởng"
                value={metrics.revenue_growth}
                suffix="%"
                valueStyle={{ color: '#52c41a' }}
                suffix={<ArrowUpOutlined style={{ color: '#52c41a' }} />}
              />
            </Card>
          </Col>
        </Row>
      </Card>

      {/* Top Customers & Products */}
      <Row gutter={24} style={{ marginBottom: '20px' }}>
        <Col span={12}>
          <Card title="Top 5 Khách hàng">
            <Table
              columns={topCustomersColumns}
              dataSource={metrics.top_customers}
              pagination={false}
              rowKey="id"
              size="small"
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="Top 5 Sản phẩm">
            <Table
              columns={topProductsColumns}
              dataSource={metrics.top_products}
              pagination={false}
              rowKey="id"
              size="small"
            />
          </Card>
        </Col>
      </Row>

      {/* Sales by Region */}
      <Card title="Doanh số theo vùng">
        <Table
          columns={[
            {
              title: 'Vùng',
              dataIndex: 'region',
              key: 'region',
              width: 150,
            },
            {
              title: 'Doanh thu',
              dataIndex: 'revenue',
              key: 'revenue',
              align: 'right' as const,
              render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
            },
            {
              title: 'Đơn hàng',
              dataIndex: 'orders',
              key: 'orders',
              align: 'center' as const,
            },
            {
              title: 'Trung bình/đơn',
              key: 'avg',
              render: (_, row: any) => (row.revenue / row.orders).toLocaleString('vi-VN', { minimumFractionDigits: 0 }),
            },
          ]}
          dataSource={metrics.sales_by_region}
          pagination={false}
          rowKey="region"
        />
      </Card>
    </div>
  );
};

export default SalesAnalyticsDashboard;
