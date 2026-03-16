import React from 'react';
import { Card, Row, Col, Table, Button, Space, Tag, Rate } from 'antd';
import { downloadCSV } from '../../utils/csvExport';

const SupplierPerformanceAnalytics: React.FC = () => {
  const mockData = [
    { id: 1, supplier: 'NCC A', on_time_rate: 95, quality_score: 4.5, price_variance: -5, lead_time: 7 },
    { id: 2, supplier: 'NCC B', on_time_rate: 87, quality_score: 3.8, price_variance: 2, lead_time: 14 },
    { id: 3, supplier: 'NCC C', on_time_rate: 92, quality_score: 4.2, price_variance: -2, lead_time: 10 },
  ];

  const columns = [
    { title: 'Nhà cung cấp', dataIndex: 'supplier', width: 150 },
    { title: 'Đúng hạn %', dataIndex: 'on_time_rate', width: 120, align: 'center' as const, render: (v: number) => `${v}%` },
    { title: 'Chất lượng', dataIndex: 'quality_score', width: 120, align: 'center' as const, render: (v: number) => <Rate disabled value={v} /> },
    { title: 'Giá variance', dataIndex: 'price_variance', width: 120, align: 'center' as const, render: (v: number) => <span style={{ color: v > 0 ? 'red' : 'green' }}>{v > 0 ? '+' : ''}{v}%</span> },
    { title: 'Lead time (ngày)', dataIndex: 'lead_time', width: 120, align: 'center' as const },
  ];

  return (
    <div style={{ padding: '20px' }}>
      <Card title="⭐ Phân tích hiệu suất NCC">
        <Table columns={columns} dataSource={mockData} pagination={false} rowKey="id" />
        <Button onClick={() => downloadCSV(mockData, 'supplier-analytics')} style={{ marginTop: '20px' }}>Xuất CSV</Button>
      </Card>
    </div>
  );
};

export default SupplierPerformanceAnalytics;
