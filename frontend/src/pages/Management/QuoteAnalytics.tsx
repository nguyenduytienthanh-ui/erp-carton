import React, { useState } from 'react';
import {
  Card, Row, Col, Statistic, Table, Tag, Button, DatePicker, Space, Skeleton, message,
} from 'antd';
import { ArrowUpOutlined, DownloadOutlined, PercentageOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

import { downloadCSV } from '../../utils/csvExport';

const QuoteAnalytics: React.FC = () => {
  const [startDate, setStartDate] = useState<Dayjs>(dayjs().startOf('month'));
  const [endDate, setEndDate] = useState<Dayjs>(dayjs());

  // Mock data - replace with actual API
  const metrics = {
    total_quotes: 45,
    total_value: 5000000000,
    converted_quotes: 30,
    conversion_rate: 66.67,
    rejected_quotes: 8,
    expired_quotes: 7,
    average_conversion_time: 12,
    average_deal_size: 111111111,
  };

  const conversions = [
    {
      id: 1,
      quote_code: 'Q001',
      order_code: 'ĐB001',
      customer_name: 'Công ty A',
      quote_value: 100000000,
      order_value: 100000000,
      conversion_date: '2026-03-05',
      conversion_rate: 100,
    },
    {
      id: 2,
      quote_code: 'Q002',
      order_code: 'ĐB002',
      customer_name: 'Công ty B',
      quote_value: 150000000,
      order_value: 140000000,
      conversion_date: '2026-03-07',
      conversion_rate: 93.33,
    },
    {
      id: 3,
      quote_code: 'Q003',
      order_code: 'ĐB003',
      customer_name: 'Công ty C',
      quote_value: 80000000,
      order_value: 85000000,
      conversion_date: '2026-03-10',
      conversion_rate: 106.25,
    },
  ];

  const handleExportCSV = () => {
    const csvData = conversions.map((c: any) => ({
      'Mã báo giá': c.quote_code,
      'Mã đơn bán': c.order_code,
      'Khách hàng': c.customer_name,
      'Giá báo giá': c.quote_value?.toLocaleString('vi-VN'),
      'Giá đơn bán': c.order_value?.toLocaleString('vi-VN'),
      'Tỷ lệ chuyển đổi %': c.conversion_rate?.toFixed(2),
      'Ngày chuyển': dayjs(c.conversion_date).format('DD/MM/YYYY'),
    }));
    downloadCSV(csvData, 'quote-analytics');
  };

  const conversionColumns = [
    {
      title: 'Báo giá',
      dataIndex: 'quote_code',
      key: 'quote_code',
      width: 100,
    },
    {
      title: 'Khách hàng',
      dataIndex: 'customer_name',
      key: 'customer_name',
      width: 120,
    },
    {
      title: 'Đơn bán',
      dataIndex: 'order_code',
      key: 'order_code',
      width: 100,
    },
    {
      title: 'Giá báo giá',
      dataIndex: 'quote_value',
      key: 'quote_value',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Giá đơn bán',
      dataIndex: 'order_value',
      key: 'order_value',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Tỷ lệ chuyển %',
      dataIndex: 'conversion_rate',
      key: 'conversion_rate',
      width: 120,
      align: 'right' as const,
      render: (val: number) => (
        <span style={{ color: val >= 100 ? '#52c41a' : val >= 90 ? '#faad14' : '#ff4d4f' }}>
          {val?.toFixed(2)}%
        </span>
      ),
    },
    {
      title: 'Ngày chuyển',
      dataIndex: 'conversion_date',
      key: 'conversion_date',
      width: 100,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      {/* Bộ lọc */}
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
            <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
              Xuất CSV
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Thống kê chính */}
      <Card title="Tổng quan" style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={6}>
            <Card>
              <Statistic
                title="Tổng báo giá"
                value={metrics.total_quotes}
                valueStyle={{ color: '#1677ff' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="Tổng giá trị"
                value={metrics.total_value}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="Đã chuyển thành đơn"
                value={metrics.converted_quotes}
                valueStyle={{ color: '#52c41a' }}
                suffix={<ArrowUpOutlined style={{ color: '#52c41a' }} />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="Tỷ lệ chuyển đổi"
                value={metrics.conversion_rate}
                precision={1}
                suffix="%"
                prefix={<PercentageOutlined />}
                valueStyle={{ color: '#faad14' }}
              />
            </Card>
          </Col>
        </Row>
      </Card>

      {/* Phân tích chi tiết */}
      <Card title="Phân tích chi tiết" style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={8}>
            <Card>
              <Statistic
                title="Trung bình thời gian chuyển đổi"
                value={metrics.average_conversion_time}
                suffix="ngày"
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic
                title="Trung bình giá trị đơn hàng"
                value={metrics.average_deal_size}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="Từ chối" value={metrics.rejected_quotes} valueStyle={{ color: '#ff4d4f' }} />
              <Statistic title="Hết hạn" value={metrics.expired_quotes} valueStyle={{ color: '#d9d9d9' }} />
            </Card>
          </Col>
        </Row>
      </Card>

      {/* Bảng chuyển đổi */}
      <Card title="Báo giá chuyển thành đơn bán">
        <Table
          columns={conversionColumns}
          dataSource={conversions}
          pagination={false}
          rowKey="id"
          scroll={{ x: 900 }}
        />
      </Card>
    </div>
  );
};

export default QuoteAnalytics;
