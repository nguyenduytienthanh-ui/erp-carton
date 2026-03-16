import React from 'react';
import { Card, Table, Button, Rate, Skeleton } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { downloadCSV } from '../../utils/csvExport';
import { purchasingApi } from '../../api/purchasing';

const SupplierPerformanceAnalytics: React.FC = () => {
  const { data: list = [], isLoading } = useQuery({
    queryKey: ['supplier-analytics'],
    queryFn: () => purchasingApi.getSupplierAnalytics(),
  });

  const displayData = list.map((row: any, idx: number) => ({
    ...row,
    id: row.id ?? row.supplier_id ?? idx + 1,
    supplier: row.supplier ?? row.supplier_name ?? '—',
    on_time_rate: row.on_time_rate ?? row.on_time_delivery_rate ?? 0,
  }));

  const columns = [
    { title: 'Nhà cung cấp', dataIndex: 'supplier', width: 150 },
    { title: 'Đúng hạn %', dataIndex: 'on_time_rate', width: 120, align: 'center' as const, render: (v: number) => `${v}%` },
    { title: 'Chất lượng', dataIndex: 'quality_score', width: 120, align: 'center' as const, render: (v: number) => <Rate disabled value={Number(v) || 0} allowHalf /> },
    { title: 'Giá variance', dataIndex: 'price_variance', width: 120, align: 'center' as const, render: (v: number) => <span style={{ color: v > 0 ? 'red' : 'green' }}>{v > 0 ? '+' : ''}{v}%</span> },
    { title: 'Lead time (ngày)', dataIndex: 'lead_time', width: 120, align: 'center' as const },
  ];

  return (
    <div style={{ padding: '20px' }}>
      <Card title="Phân tích hiệu suất nhà cung cấp">
        {isLoading ? (
          <Skeleton active />
        ) : (
          <>
            <Table columns={columns} dataSource={displayData} pagination={false} rowKey="id" />
            <Button onClick={() => downloadCSV(displayData, 'supplier-analytics')} style={{ marginTop: '20px' }}>Xuất CSV</Button>
          </>
        )}
      </Card>
    </div>
  );
};

export default SupplierPerformanceAnalytics;
