import { useState } from 'react';
import { Card, Row, Col, Statistic, Table, DatePicker, Button, Space, Skeleton } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';

import { reportsApi } from '../../api/reports';
import type { CustomReportGeneratedResult } from '../../types/reports';

type ProfitRow = {
  order_code: string;
  order_date: string;
  customer_name: string;
  revenue: number;
  cost_of_goods_sold: number;
  gross_profit: number;
  gross_margin_pct: number;
};

type ProfitSummary = {
  orders: number;
  total_revenue: number;
  total_cost_of_goods_sold: number;
  gross_margin_pct: number;
};

export default function ProfitReport() {
  const [startDate, setStartDate] = useState<Dayjs>(dayjs().startOf('month'));
  const [endDate, setEndDate] = useState<Dayjs>(dayjs());

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['profit-report', startDate.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD')],
    queryFn: () => reportsApi.generateCustomReport({
      report_code: 'PROFIT_REPORT',
      period_start: startDate.format('YYYY-MM-DD'),
      period_end: endDate.format('YYYY-MM-DD'),
    }),
  });

  const report = data as CustomReportGeneratedResult | undefined;
  const rows = Array.isArray(report?.rows) ? (report.rows as ProfitRow[]) : [];
  const summary = (report?.summary ?? {}) as Partial<ProfitSummary>;

  const columns = [
    { title: 'Đơn bán', dataIndex: 'order_code', key: 'order_code', width: 140 },
    { title: 'Ngày', dataIndex: 'order_date', key: 'order_date', width: 120 },
    { title: 'Khách hàng', dataIndex: 'customer_name', key: 'customer_name', width: 180 },
    { title: 'Doanh thu', dataIndex: 'revenue', key: 'revenue', align: 'right' as const },
    { title: 'Giá vốn', dataIndex: 'cost_of_goods_sold', key: 'cost_of_goods_sold', align: 'right' as const },
    { title: 'LN gộp', dataIndex: 'gross_profit', key: 'gross_profit', align: 'right' as const },
    { title: 'Biên LN %', dataIndex: 'gross_margin_pct', key: 'gross_margin_pct', align: 'right' as const },
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
            <Col span={6}><Card><Statistic title="Số đơn" value={summary.orders || 0} /></Card></Col>
            <Col span={6}><Card><Statistic title="Doanh thu" value={summary.total_revenue || 0} formatter={(v) => Number(v || 0).toLocaleString('vi-VN')} /></Card></Col>
            <Col span={6}><Card><Statistic title="Giá vốn" value={summary.total_cost_of_goods_sold || 0} formatter={(v) => Number(v || 0).toLocaleString('vi-VN')} /></Card></Col>
            <Col span={6}><Card><Statistic title="LN gộp %" value={summary.gross_margin_pct || 0} suffix="%" /></Card></Col>
          </Row>
          <Table columns={columns} dataSource={rows} rowKey="order_code" scroll={{ x: 1000 }} />
        </>
      )}
    </div>
  );
}
