import { useState } from 'react';
import { Card, Row, Col, Statistic, Table, DatePicker, Button, Space, Skeleton } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';

import { reportsApi } from '../../api/reports';
import type { CustomReportGeneratedResult } from '../../types/reports';

type ProductionCostingRow = {
  order_code: string;
  product_code: string;
  product_name: string;
  planned_qty: number;
  produced_qty: number;
  estimated_unit_cost: number;
  actual_material_cost: number;
  actual_unit_cost: number;
  variance_per_unit: number;
};

type ProductionCostingSummary = {
  orders: number;
  total_actual_material_cost: number;
  avg_actual_unit_cost: number;
};

export default function ProductionCostingReport() {
  const [startDate, setStartDate] = useState<Dayjs>(dayjs().startOf('month'));
  const [endDate, setEndDate] = useState<Dayjs>(dayjs());

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['production-costing-report', startDate.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD')],
    queryFn: () => reportsApi.generateCustomReport({
      report_code: 'PRODUCTION_COSTING',
      period_start: startDate.format('YYYY-MM-DD'),
      period_end: endDate.format('YYYY-MM-DD'),
    }),
  });

  const report = data as CustomReportGeneratedResult | undefined;
  const rows = Array.isArray(report?.rows) ? (report.rows as ProductionCostingRow[]) : [];
  const summary = (report?.summary ?? {}) as Partial<ProductionCostingSummary>;

  const columns = [
    { title: 'Lệnh SX', dataIndex: 'order_code', key: 'order_code', width: 140 },
    { title: 'Mã SP', dataIndex: 'product_code', key: 'product_code', width: 120 },
    { title: 'Tên SP', dataIndex: 'product_name', key: 'product_name', width: 180 },
    { title: 'SL kế hoạch', dataIndex: 'planned_qty', key: 'planned_qty', align: 'right' as const },
    { title: 'SL thực tế', dataIndex: 'produced_qty', key: 'produced_qty', align: 'right' as const },
    { title: 'Giá vốn KH', dataIndex: 'estimated_unit_cost', key: 'estimated_unit_cost', align: 'right' as const },
    { title: 'Chi phí NVL TT', dataIndex: 'actual_material_cost', key: 'actual_material_cost', align: 'right' as const },
    { title: 'Giá vốn TT', dataIndex: 'actual_unit_cost', key: 'actual_unit_cost', align: 'right' as const },
    { title: 'Chênh lệch', dataIndex: 'variance_per_unit', key: 'variance_per_unit', align: 'right' as const },
  ];

  return (
    <div style={{ padding: 20 }}>
      <Card style={{ marginBottom: 20 }}>
        <Space wrap>
          <DatePicker value={startDate} onChange={(v) => v && setStartDate(v)} format="DD/MM/YYYY" />
          <DatePicker value={endDate} onChange={(v) => v && setEndDate(v)} format="DD/MM/YYYY" />
          <Button icon={<ReloadOutlined />} onClick={() => void refetch()} loading={isFetching}>
            Chạy báo cáo
          </Button>
        </Space>
      </Card>

      {isLoading ? <Skeleton active /> : (
        <>
          <Row gutter={16} style={{ marginBottom: 20 }}>
            <Col span={8}><Card><Statistic title="Số lệnh" value={summary.orders || 0} /></Card></Col>
            <Col span={8}><Card><Statistic title="Tổng chi phí NVL TT" value={summary.total_actual_material_cost || 0} formatter={(v) => Number(v || 0).toLocaleString('vi-VN')} /></Card></Col>
            <Col span={8}><Card><Statistic title="Giá vốn TT bình quân" value={summary.avg_actual_unit_cost || 0} formatter={(v) => Number(v || 0).toLocaleString('vi-VN')} /></Card></Col>
          </Row>
          <Table columns={columns} dataSource={rows} rowKey="order_code" scroll={{ x: 1200 }} />
        </>
      )}
    </div>
  );
}
