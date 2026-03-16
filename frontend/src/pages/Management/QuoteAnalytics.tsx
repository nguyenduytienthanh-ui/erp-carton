import React, { useState, useMemo } from 'react';
import {
  Card, Row, Col, Statistic, Table, Button, DatePicker, Space, Skeleton,
} from 'antd';
import { ArrowUpOutlined, DownloadOutlined, PercentageOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';

import { salesApi } from '../../api/sales';
import { downloadCSV } from '../../utils/csvExport';

const QuoteAnalytics: React.FC = () => {
  const [startDate, setStartDate] = useState<Dayjs>(dayjs().startOf('month'));
  const [endDate, setEndDate] = useState<Dayjs>(dayjs());

  const { data: quotesResponse, isLoading } = useQuery({
    queryKey: ['quote-analytics', startDate.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD')],
    queryFn: () =>
      salesApi.getQuotes({
        quote_date__gte: startDate.format('YYYY-MM-DD'),
        quote_date__lte: endDate.format('YYYY-MM-DD'),
        page_size: 500,
      }),
  });

  const { metrics, conversions } = useMemo(() => {
    const results = quotesResponse?.results ?? [];
    const totalValue = results.reduce((sum: number, q: any) => sum + Number(q.total || 0), 0);
    const accepted = results.filter((q: any) => q.status === 'ACCEPTED');
    const convertedCount = accepted.length;
    const totalCount = results.length;
    const conversionRate = totalCount > 0 ? (convertedCount / totalCount) * 100 : 0;
    const rejectedCount = results.filter((q: any) => q.status === 'REJECTED').length;
    const expiredCount = results.filter(
      (q: any) => q.valid_until && dayjs(q.valid_until).isBefore(dayjs()) && q.status !== 'ACCEPTED' && q.status !== 'REJECTED'
    ).length;
    const avgDeal = convertedCount > 0 ? totalValue / convertedCount : 0;

    const conversionsList = accepted.map((q: any) => ({
      id: q.id,
      quote_code: q.code,
      order_code: q.sales_order_code ?? '—',
      customer_name: q.customer_name ?? '—',
      quote_value: Number(q.total || 0),
      order_value: Number(q.total || 0),
      conversion_date: q.quote_date || q.updated_at,
      conversion_rate: 100,
    }));

    return {
      metrics: {
        total_quotes: totalCount,
        total_value: totalValue,
        converted_quotes: convertedCount,
        conversion_rate: conversionRate,
        rejected_quotes: rejectedCount,
        expired_quotes: expiredCount,
        average_deal_size: avgDeal,
      },
      conversions: conversionsList,
    };
  }, [quotesResponse]);

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

  if (isLoading) {
    return (
      <div style={{ padding: '20px' }}>
        <Skeleton active />
      </div>
    );
  }

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
                title="Trung bình giá trị báo giá (đã chuyển)"
                value={metrics.average_deal_size}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="Từ chối" value={metrics.rejected_quotes} valueStyle={{ color: '#ff4d4f' }} />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="Hết hạn / Chưa quyết" value={metrics.expired_quotes} valueStyle={{ color: '#d9d9d9' }} />
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
