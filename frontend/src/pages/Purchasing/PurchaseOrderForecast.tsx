import React, { useState } from 'react';
import { Card, Row, Col, Table, Button, Space, Tag, Modal, Form, Skeleton } from 'antd';
import { PlusOutlined, EyeOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { downloadCSV } from '../../utils/csvExport';
import { purchasingApi } from '../../api/purchasing';

const PurchaseOrderForecast: React.FC = () => {
  const [formOpen, setFormOpen] = useState(false);
  const [form] = Form.useForm();

  const { data: forecastList = [], isLoading } = useQuery({
    queryKey: ['purchase-order-forecast'],
    queryFn: () => purchasingApi.getPurchaseOrderForecast(),
  });

  const displayData = forecastList.map((row: any, idx: number) => ({
    ...row,
    id: row.id ?? row.product_id ?? idx + 1,
    product_name: row.product_name ?? row.product_code ?? '—',
    estimated_cost: row.estimated_cost ?? 0,
  }));

  const columns = [
    { title: 'Mã', dataIndex: 'product_code', width: 100 },
    { title: 'Sản phẩm', dataIndex: 'product_name', width: 150 },
    { title: 'Tồn kho', dataIndex: 'current_stock', width: 100, align: 'center' as const },
    { title: 'Nhu cầu/tháng', dataIndex: 'avg_monthly_demand', width: 120, align: 'center' as const },
    { title: 'Đề xuất mua', dataIndex: 'suggested_qty', width: 120, align: 'center' as const },
    { title: 'Chi phí dự tính', dataIndex: 'estimated_cost', width: 140, align: 'right' as const, render: (v: number) => v?.toLocaleString('vi-VN') },
    {
      title: 'Mức độ',
      dataIndex: 'urgency',
      width: 100,
      render: (v: string) => <Tag color={v === 'HIGH' ? 'red' : v === 'MEDIUM' ? 'orange' : 'green'}>{v}</Tag>,
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 120,
      render: () => <Space size="small"><Button size="small" icon={<EyeOutlined />} /><Button size="small" icon={<PlusOutlined />} /></Space>,
    },
  ];

  const totalEstimate = displayData.reduce((sum: number, r: any) => sum + Number(r.estimated_cost || 0), 0);
  const highUrgencyCount = displayData.filter((r: any) => r.urgency === 'HIGH').length;

  return (
    <div style={{ padding: '20px' }}>
      <Card title="Dự báo đơn mua" style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={8}><div><strong>Tổng dự tính:</strong> {(totalEstimate / 1e6).toFixed(1)}M đ</div></Col>
          <Col span={8}><div><strong>Cần mua gấp (HIGH):</strong> {highUrgencyCount} sản phẩm</div></Col>
          <Col span={8}><div><strong>Số dòng dự báo:</strong> {displayData.length}</div></Col>
        </Row>
      </Card>
      {isLoading ? (
        <Skeleton active />
      ) : (
        <>
          <Table columns={columns} dataSource={displayData} pagination={false} rowKey="id" scroll={{ x: 1000 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormOpen(true)} style={{ marginTop: '20px' }}>
            Tạo PO từ dự báo
          </Button>
        </>
      )}
    </div>
  );
};

export default PurchaseOrderForecast;
