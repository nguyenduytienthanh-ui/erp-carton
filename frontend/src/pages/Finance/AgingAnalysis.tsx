import React, { useState } from 'react';
import {
  Table, Button, Card, Row, Col, Statistic, DatePicker, Empty, Skeleton, message, Tabs,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { accountsReceivableApi } from '../../api/accountsReceivable';
import type { ReceivableDocument } from '../../types/accountsReceivable';
import { downloadCSV } from '../../utils/csvExport';

const AgingAnalysis: React.FC = () => {
  const [dateAs, setDateAs] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['receivables-aging', { dateAs }],
    queryFn: () => accountsReceivableApi.getReceivables({
      page_size: 10000,
      date_as: dateAs,
    }),
    enabled: !!dateAs,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    message.success('Cập nhật dữ liệu phân tích thành công');
  };

  const receivables = data?.results || [];

  const bucket0_30 = receivables.filter((doc) => {
    const daysOverdue = doc.days_overdue || 0;
    return daysOverdue >= 0 && daysOverdue <= 30;
  });

  const bucket30_60 = receivables.filter((doc) => {
    const daysOverdue = doc.days_overdue || 0;
    return daysOverdue > 30 && daysOverdue <= 60;
  });

  const bucket60_90 = receivables.filter((doc) => {
    const daysOverdue = doc.days_overdue || 0;
    return daysOverdue > 60 && daysOverdue <= 90;
  });

  const bucket90Plus = receivables.filter((doc) => {
    const daysOverdue = doc.days_overdue || 0;
    return daysOverdue > 90;
  });

  const calculateBucketStats = (docs: ReceivableDocument[]) => {
    return {
      count: docs.length,
      total: docs.reduce((sum, doc) => sum + doc.outstanding_amount, 0),
      percentage: docs.length > 0 ? ((docs.length / receivables.length) * 100).toFixed(1) : '0',
    };
  };

  const stats0_30 = calculateBucketStats(bucket0_30);
  const stats30_60 = calculateBucketStats(bucket30_60);
  const stats60_90 = calculateBucketStats(bucket60_90);
  const stats90Plus = calculateBucketStats(bucket90Plus);

  const totalOutstanding = receivables.reduce((sum, doc) => sum + doc.outstanding_amount, 0);

  const handleExportCSV = () => {
    const csvData = [
      {
        'Khoảng': '0-30 ngày',
        'Số HĐ': stats0_30.count,
        'Tổng còn nợ': stats0_30.total,
        'Tỷ lệ': `${stats0_30.percentage}%`,
      },
      {
        'Khoảng': '30-60 ngày',
        'Số HĐ': stats30_60.count,
        'Tổng còn nợ': stats30_60.total,
        'Tỷ lệ': `${stats30_60.percentage}%`,
      },
      {
        'Khoảng': '60-90 ngày',
        'Số HĐ': stats60_90.count,
        'Tổng còn nợ': stats60_90.total,
        'Tỷ lệ': `${stats60_90.percentage}%`,
      },
      {
        'Khoảng': '>90 ngày',
        'Số HĐ': stats90Plus.count,
        'Tổng còn nợ': stats90Plus.total,
        'Tỷ lệ': `${stats90Plus.percentage}%`,
      },
    ];
    downloadCSV(csvData, 'phan-tich-qua-han');
  };

  const columnsBucket = [
    {
      title: 'Mã CN',
      dataIndex: 'code',
      key: 'code',
      width: 100,
    },
    {
      title: 'Khách hàng',
      dataIndex: 'customer_name',
      key: 'customer_name',
      width: 150,
    },
    {
      title: 'Số HĐ',
      dataIndex: 'invoice_number',
      key: 'invoice_number',
      width: 100,
    },
    {
      title: 'Ngày đáo hạn',
      dataIndex: 'due_date',
      key: 'due_date',
      width: 120,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Quá hạn',
      dataIndex: 'days_overdue',
      key: 'days_overdue',
      width: 80,
      render: (days: number) => (
        <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>{days || 0} ngày</span>
      ),
    },
    {
      title: 'Còn nợ',
      dataIndex: 'outstanding_amount',
      key: 'outstanding_amount',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val.toLocaleString('vi-VN', { minimumFractionDigits: 0 }),
    },
  ];

  if (isLoading && !data) {
    return <Skeleton active paragraph={{ rows: 15 }} />;
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Ngày phân tích */}
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={16} style={{ marginBottom: '15px' }}>
          <Col span={12}>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ fontWeight: 'bold' }}>Tính đến ngày:</label>
            </div>
            <DatePicker
              format="DD/MM/YYYY"
              value={dateAs ? dayjs(dateAs) : null}
              onChange={(date) => setDateAs(date ? date.format('YYYY-MM-DD') : '')}
              style={{ width: '100%' }}
            />
          </Col>
          <Col span={12} style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
            <Button type="primary" icon={<ReloadOutlined />} onClick={handleRefresh} loading={refreshing}>
              Cập nhật
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
              Xuất CSV
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Thống kê tổng quan */}
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={24} style={{ marginBottom: '20px' }}>
          <Col span={6}>
            <Card size="small" style={{ backgroundColor: '#e6f7ff', border: 'none' }}>
              <Statistic
                title="0-30 ngày"
                value={stats0_30.total}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
              <p style={{ marginTop: '8px', color: '#666' }}>
                {stats0_30.count} hóa đơn ({stats0_30.percentage}%)
              </p>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ backgroundColor: '#fff7e6', border: 'none' }}>
              <Statistic
                title="30-60 ngày"
                value={stats30_60.total}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
              <p style={{ marginTop: '8px', color: '#666' }}>
                {stats30_60.count} hóa đơn ({stats30_60.percentage}%)
              </p>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ backgroundColor: '#fff1f0', border: 'none' }}>
              <Statistic
                title="60-90 ngày"
                value={stats60_90.total}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
              <p style={{ marginTop: '8px', color: '#666' }}>
                {stats60_90.count} hóa đơn ({stats60_90.percentage}%)
              </p>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ backgroundColor: '#ffeded', border: 'none' }}>
              <Statistic
                title=">90 ngày"
                value={stats90Plus.total}
                prefix="₫"
                valueStyle={{ color: '#ff4d4f' }}
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
              <p style={{ marginTop: '8px', color: '#666' }}>
                {stats90Plus.count} hóa đơn ({stats90Plus.percentage}%)
              </p>
            </Card>
          </Col>
        </Row>

        <Row gutter={24}>
          <Col span={12}>
            <Statistic
              title="Tổng còn nợ"
              value={totalOutstanding}
              prefix="₫"
              valueStyle={{ color: '#ff4d4f' }}
              formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
            />
          </Col>
          <Col span={12}>
            <Statistic
              title="Tỷ lệ quá hạn"
              value={
                totalOutstanding > 0
                  ? (((stats30_60.total + stats60_90.total + stats90Plus.total) / totalOutstanding) * 100).toFixed(1)
                  : '0'
              }
              suffix="%"
              valueStyle={{ color: '#faad14' }}
            />
          </Col>
        </Row>
      </Card>

      {/* Chi tiết từng bucket */}
      <Tabs
        items={[
          {
            key: '0_30',
            label: `0-30 ngày (${stats0_30.count})`,
            children: (
              <Table
                columns={columnsBucket}
                dataSource={bucket0_30}
                pagination={false}
                rowKey="id"
                locale={{ emptyText: <Empty description="Không có hóa đơn" /> }}
              />
            ),
          },
          {
            key: '30_60',
            label: `30-60 ngày (${stats30_60.count})`,
            children: (
              <Table
                columns={columnsBucket}
                dataSource={bucket30_60}
                pagination={false}
                rowKey="id"
                locale={{ emptyText: <Empty description="Không có hóa đơn" /> }}
              />
            ),
          },
          {
            key: '60_90',
            label: `60-90 ngày (${stats60_90.count})`,
            children: (
              <Table
                columns={columnsBucket}
                dataSource={bucket60_90}
                pagination={false}
                rowKey="id"
                locale={{ emptyText: <Empty description="Không có hóa đơn" /> }}
              />
            ),
          },
          {
            key: '90_plus',
            label: `>90 ngày (${stats90Plus.count})`,
            children: (
              <Table
                columns={columnsBucket}
                dataSource={bucket90Plus}
                pagination={false}
                rowKey="id"
                locale={{ emptyText: <Empty description="Không có hóa đơn" /> }}
                rowClassName={() => 'ant-table-row-red'}
                style={{ color: '#ff4d4f' }}
              />
            ),
          },
        ]}
      />
    </div>
  );
};

export default AgingAnalysis;
