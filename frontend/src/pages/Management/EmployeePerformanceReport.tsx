import { useState } from 'react';
import { Card, Row, Col, Statistic, Table, DatePicker, Button, Space, Skeleton } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';

import { reportsApi } from '../../api/reports';

export default function EmployeePerformanceReport() {
  const [monthValue, setMonthValue] = useState<Dayjs>(dayjs());

  const periodStart = monthValue.startOf('month').format('YYYY-MM-DD');
  const periodEnd = monthValue.endOf('month').format('YYYY-MM-DD');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['employee-performance-report', monthValue.format('YYYY-MM')],
    queryFn: () => reportsApi.generateCustomReport({
      report_code: 'EMPLOYEE_PERFORMANCE',
      period_start: periodStart,
      period_end: periodEnd,
    }),
  });

  const rows = Array.isArray((data as any)?.rows) ? (data as any).rows : [];
  const summary = ((data as any)?.summary || {}) as Record<string, number>;

  const columns = [
    { title: 'Mã NV', dataIndex: 'employee_code', key: 'employee_code', width: 120 },
    { title: 'Tên NV', dataIndex: 'employee_name', key: 'employee_name', width: 180 },
    { title: 'Phòng ban', dataIndex: 'department', key: 'department', width: 150 },
    { title: 'Chức vụ', dataIndex: 'position', key: 'position', width: 150 },
    { title: 'Ngày công chuẩn', dataIndex: 'standard_days', key: 'standard_days', align: 'right' as const },
    { title: 'Ngày công TT', dataIndex: 'actual_days', key: 'actual_days', align: 'right' as const },
    { title: '% ngày công', dataIndex: 'attendance_rate_pct', key: 'attendance_rate_pct', align: 'right' as const },
    { title: 'Tăng ca', dataIndex: 'overtime_hours', key: 'overtime_hours', align: 'right' as const },
    { title: 'Thưởng', dataIndex: 'bonus_amount', key: 'bonus_amount', align: 'right' as const },
    { title: 'Phạt', dataIndex: 'penalty_amount', key: 'penalty_amount', align: 'right' as const },
    { title: 'Điểm hiệu suất', dataIndex: 'performance_score', key: 'performance_score', align: 'right' as const },
  ];

  return (
    <div style={{ padding: 20 }}>
      <Card style={{ marginBottom: 20 }}>
        <Space wrap>
          <DatePicker picker="month" value={monthValue} onChange={(v) => v && setMonthValue(v)} format="MM/YYYY" />
          <Button icon={<ReloadOutlined />} onClick={() => void refetch()} loading={isFetching}>
            Chạy báo cáo
          </Button>
        </Space>
      </Card>

      {isLoading ? <Skeleton active /> : (
        <>
          <Row gutter={16} style={{ marginBottom: 20 }}>
            <Col span={8}><Card><Statistic title="Số nhân viên" value={summary.employees || 0} /></Card></Col>
            <Col span={8}><Card><Statistic title="Điểm hiệu suất TB" value={summary.avg_performance_score || 0} /></Card></Col>
            <Col span={8}><Card><Statistic title="% ngày công TB" value={summary.avg_attendance_rate_pct || 0} suffix="%" /></Card></Col>
          </Row>
          <Table columns={columns} dataSource={rows} rowKey="employee_code" scroll={{ x: 1400 }} />
        </>
      )}
    </div>
  );
}
