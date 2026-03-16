import React, { useState } from 'react';
import {
  Card, Row, Col, Statistic, Select, Button, Space, Empty, Skeleton, Progress, Tooltip,
} from 'antd';
import {
  ArrowUpOutlined, ArrowDownOutlined, ReloadOutlined, SettingOutlined,
} from '@ant-design/icons';

const BIDashboard: React.FC = () => {
  const [period, setPeriod] = useState('month');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  // Mock KPIs
  const kpis = {
    revenue: {
      value: 5000000000,
      target: 4500000000,
      change: 15.5,
      trend: 'up',
    },
    orders: {
      value: 150,
      target: 140,
      change: 7.2,
      trend: 'up',
    },
    profit: {
      value: 800000000,
      target: 750000000,
      change: 6.8,
      trend: 'up',
    },
    cost: {
      value: 3000000000,
      target: 3100000000,
      change: -3.2,
      trend: 'down',
    },
    inventory: {
      value: 900000000,
      target: 850000000,
      change: 5.9,
      trend: 'up',
    },
    receivables: {
      value: 1200000000,
      target: 1100000000,
      change: 9.1,
      trend: 'up',
    },
  };

  return (
    <div style={{ padding: '20px' }}>
      {/* Header */}
      <Card style={{ marginBottom: '20px' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <h2>📊 Executive BI Dashboard</h2>
            <p>Thời kỳ: {period === 'month' ? 'Tháng' : period === 'quarter' ? 'Quý' : 'Năm'}</p>
          </Col>
          <Col>
            <Space>
              <Select
                value={period}
                onChange={setPeriod}
                options={[
                  { label: 'Tháng', value: 'month' },
                  { label: 'Quý', value: 'quarter' },
                  { label: 'Năm', value: 'year' },
                ]}
                style={{ width: '120px' }}
              />
              <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={refreshing}>
                Làm mới
              </Button>
              <Button icon={<SettingOutlined />}>
                Cài đặt
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Main KPIs */}
      <div style={{ marginBottom: '30px' }}>
        <h3>Chỉ số chính</h3>
        <Row gutter={24}>
          {[
            { key: 'revenue', label: 'Doanh thu', icon: 'đ', color: '#1677ff' },
            { key: 'orders', label: 'Đơn hàng', icon: 'đơn', color: '#52c41a' },
            { key: 'profit', label: 'Lợi nhuận', icon: 'đ', color: '#faad14' },
            { key: 'cost', label: 'Chi phí', icon: 'đ', color: '#ff4d4f' },
            { key: 'inventory', label: 'Tồn kho', icon: 'đ', color: '#722ed1' },
            { key: 'receivables', label: 'Công nợ phải thu', icon: 'đ', color: '#eb2f96' },
          ].map((item) => {
            const kpi = kpis[item.key as keyof typeof kpis];
            return (
              <Col span={4} key={item.key}>
                <Card>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: item.color, fontSize: '20px', fontWeight: 'bold' }}>
                      {item.key === 'orders'
                        ? kpi.value
                        : `${(kpi.value / 1000000000).toFixed(1)}T`}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                      {item.label}
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <span style={{ color: kpi.trend === 'up' ? '#52c41a' : '#ff4d4f' }}>
                        {kpi.trend === 'up' ? '↑' : '↓'} {Math.abs(kpi.change)}%
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '5px' }}>
                      Target: {item.key === 'orders' ? kpi.target : `${(kpi.target / 1000000000).toFixed(1)}T`}
                    </div>
                    <Progress
                      percent={Math.round((kpi.value / kpi.target) * 100)}
                      strokeColor={kpi.trend === 'up' ? '#52c41a' : '#ff4d4f'}
                      size="small"
                      style={{ marginTop: '10px' }}
                    />
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      </div>

      {/* Performance Analysis */}
      <div style={{ marginBottom: '30px' }}>
        <h3>Phân tích hiệu suất</h3>
        <Row gutter={24}>
          <Col span={12}>
            <Card title="Top 5 Sản phẩm">
              <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p>📊 Biểu đồ sẽ hiển thị ở đây</p>
              </div>
            </Card>
          </Col>
          <Col span={12}>
            <Card title="Top 5 Khách hàng">
              <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p>📊 Biểu đồ sẽ hiển thị ở đây</p>
              </div>
            </Card>
          </Col>
        </Row>
      </div>

      {/* Alerts & Warnings */}
      <div>
        <h3>Cảnh báo</h3>
        <Row gutter={24}>
          <Col span={8}>
            <Card style={{ borderLeft: '4px solid #ff4d4f' }}>
              <p>⚠️ <strong>Hạn mức tín dụng</strong></p>
              <p>3 khách hàng vượt hạn mức</p>
            </Card>
          </Col>
          <Col span={8}>
            <Card style={{ borderLeft: '4px solid #faad14' }}>
              <p>⚠️ <strong>Tồn kho thấp</strong></p>
              <p>5 sản phẩm cảnh báo</p>
            </Card>
          </Col>
          <Col span={8}>
            <Card style={{ borderLeft: '4px solid #1677ff' }}>
              <p>ℹ️ <strong>Công nợ phải trả</strong></p>
              <p>Đến hạn thanh toán: 2 hoá đơn</p>
            </Card>
          </Col>
        </Row>
      </div>
    </div>
  );
};

export default BIDashboard;
