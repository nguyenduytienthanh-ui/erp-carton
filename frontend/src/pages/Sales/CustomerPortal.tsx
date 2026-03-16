import React, { useState } from 'react';
import {
  Card, Row, Col, Statistic, Table, Tag, Button, Tabs, Space, Empty, Modal, Timeline, Badge,
} from 'antd';
import { EyeOutlined, DownloadOutlined, ShoppingCartOutlined, TruckOutlined, DollarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import { downloadCSV } from '../../utils/csvExport';

const CustomerPortal: React.FC = () => {
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Mock customer data
  const customer = {
    name: 'Công ty ABC',
    code: 'CUST001',
    email: 'contact@abc.com',
    phone: '0123456789',
    address: '123 Đường ABC, TP.HCM',
    credit_limit: 5000000000,
    credit_used: 1800000000,
    credit_available: 3200000000,
    total_orders: 45,
    total_spent: 4500000000,
    loyalty_points: 45000,
  };

  const myOrders = [
    {
      id: 1,
      code: 'ĐB-2026-001',
      order_date: '2026-03-10',
      total: 150000000,
      status: 'DELIVERED',
      items: 5,
      shipment_date: '2026-03-12',
      delivery_date: '2026-03-15',
    },
    {
      id: 2,
      code: 'ĐB-2026-002',
      order_date: '2026-03-08',
      total: 120000000,
      status: 'IN_TRANSIT',
      items: 3,
      shipment_date: '2026-03-10',
    },
    {
      id: 3,
      code: 'ĐB-2026-003',
      order_date: '2026-03-05',
      total: 180000000,
      status: 'CONFIRMED',
      items: 4,
    },
  ];

  const myInvoices = [
    {
      id: 1,
      code: 'HĐ-2026-001',
      invoice_date: '2026-03-15',
      amount: 150000000,
      paid_amount: 150000000,
      status: 'PAID',
      due_date: '2026-04-15',
    },
    {
      id: 2,
      code: 'HĐ-2026-002',
      invoice_date: '2026-03-13',
      amount: 120000000,
      paid_amount: 0,
      status: 'PENDING',
      due_date: '2026-04-13',
    },
  ];

  const myPayments = [
    {
      id: 1,
      date: '2026-03-15',
      amount: 150000000,
      method: 'Bank Transfer',
      reference: 'REF-001',
      status: 'SUCCESS',
    },
    {
      id: 2,
      date: '2026-03-10',
      amount: 100000000,
      method: 'Cheque',
      reference: 'CHQ-001',
      status: 'SUCCESS',
    },
  ];

  const statusColor: Record<string, string> = {
    CONFIRMED: 'processing',
    IN_TRANSIT: 'warning',
    DELIVERED: 'success',
    PAID: 'success',
    PENDING: 'warning',
    OVERDUE: 'error',
    SUCCESS: 'success',
  };

  const statusLabel: Record<string, string> = {
    CONFIRMED: 'Đã xác nhận',
    IN_TRANSIT: 'Đang vận chuyển',
    DELIVERED: 'Đã giao',
    PAID: 'Đã thanh toán',
    PENDING: 'Chờ thanh toán',
    OVERDUE: 'Quá hạn',
    SUCCESS: 'Thành công',
  };

  const orderColumns = [
    {
      title: 'Mã đơn',
      dataIndex: 'code',
      key: 'code',
      width: 120,
    },
    {
      title: 'Ngày',
      dataIndex: 'order_date',
      key: 'order_date',
      width: 100,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Tổng tiền',
      dataIndex: 'total',
      key: 'total',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) => (
        <Tag color={statusColor[status]}>{statusLabel[status]}</Tag>
      ),
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 100,
      render: (_, row: any) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => { setSelectedOrder(row); setDetailOpen(true); }}>
          Xem
        </Button>
      ),
    },
  ];

  const invoiceColumns = [
    {
      title: 'Mã HĐ',
      dataIndex: 'code',
      key: 'code',
      width: 120,
    },
    {
      title: 'Ngày',
      dataIndex: 'invoice_date',
      key: 'invoice_date',
      width: 100,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Đã thanh toán',
      dataIndex: 'paid_amount',
      key: 'paid_amount',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={statusColor[status]}>{statusLabel[status]}</Tag>
      ),
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 120,
      render: () => (
        <Space size="small">
          <Button size="small" icon={<DownloadOutlined />}>
            PDF
          </Button>
        </Space>
      ),
    },
  ];

  const paymentColumns = [
    {
      title: 'Ngày',
      dataIndex: 'date',
      key: 'date',
      width: 100,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Phương thức',
      dataIndex: 'method',
      key: 'method',
      width: 130,
    },
    {
      title: 'Tham chiếu',
      dataIndex: 'reference',
      key: 'reference',
      width: 100,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={statusColor[status]}>{statusLabel[status]}</Tag>
      ),
    },
  ];

  const tabs = [
    {
      key: '1',
      label: '🏠 Tổng quan',
      children: (
        <div>
          <Card title="Thông tin tài khoản" style={{ marginBottom: '20px' }}>
            <Row gutter={24}>
              <Col span={6}>
                <Statistic
                  title="Tổng đơn hàng"
                  value={customer.total_orders}
                  icon={<ShoppingCartOutlined />}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Tổng chi tiêu"
                  value={customer.total_spent}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Điểm thưởng"
                  value={customer.loyalty_points}
                  valueStyle={{ color: '#faad14' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Hạn mức tín dụng"
                  value={(customer.credit_available / customer.credit_limit * 100).toFixed(0)}
                  suffix="%"
                  valueStyle={{ color: customer.credit_available > 0 ? '#52c41a' : '#ff4d4f' }}
                />
              </Col>
            </Row>
          </Card>

          <Card title="Hạn mức tín dụng">
            <div style={{ marginBottom: '10px' }}>
              <div>Đã sử dụng: {customer.credit_used?.toLocaleString('vi-VN')} đ / {customer.credit_limit?.toLocaleString('vi-VN')} đ</div>
              <div style={{ backgroundColor: '#f0f0f0', borderRadius: '4px', marginTop: '10px' }}>
                <div
                  style={{
                    backgroundColor: '#1677ff',
                    width: `${(customer.credit_used / customer.credit_limit * 100)}%`,
                    height: '24px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '12px',
                  }}
                >
                  {(customer.credit_used / customer.credit_limit * 100).toFixed(0)}%
                </div>
              </div>
              <div style={{ marginTop: '10px', color: '#52c41a' }}>
                Còn lại: {customer.credit_available?.toLocaleString('vi-VN')} đ
              </div>
            </div>
          </Card>
        </div>
      ),
    },
    {
      key: '2',
      label: '📦 Đơn hàng của tôi',
      children: (
        <Table
          columns={orderColumns}
          dataSource={myOrders}
          pagination={false}
          rowKey="id"
          scroll={{ x: 800 }}
        />
      ),
    },
    {
      key: '3',
      label: '📄 Hoá đơn',
      children: (
        <Table
          columns={invoiceColumns}
          dataSource={myInvoices}
          pagination={false}
          rowKey="id"
          scroll={{ x: 900 }}
        />
      ),
    },
    {
      key: '4',
      label: '💳 Lịch thanh toán',
      children: (
        <Table
          columns={paymentColumns}
          dataSource={myPayments}
          pagination={false}
          rowKey="id"
          scroll={{ x: 800 }}
        />
      ),
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      {/* Welcome Card */}
      <Card title={`Xin chào ${customer.name}`} style={{ marginBottom: '20px' }} extra={<Badge count={2} />}>
        <p><strong>Email:</strong> {customer.email}</p>
        <p><strong>Điện thoại:</strong> {customer.phone}</p>
        <p><strong>Địa chỉ:</strong> {customer.address}</p>
      </Card>

      {/* Tabs */}
      <Tabs items={tabs} />

      {/* Order Detail Modal */}
      <Modal title="Chi tiết đơn hàng" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={600}>
        {selectedOrder && (
          <div>
            <p><strong>Mã đơn:</strong> {selectedOrder.code}</p>
            <p><strong>Ngày:</strong> {dayjs(selectedOrder.order_date).format('DD/MM/YYYY')}</p>
            <p><strong>Tổng tiền:</strong> {selectedOrder.total?.toLocaleString('vi-VN')} đ</p>
            <p><strong>Số sản phẩm:</strong> {selectedOrder.items}</p>
            <p><strong>Trạng thái:</strong> <Tag color={statusColor[selectedOrder.status]}>{statusLabel[selectedOrder.status]}</Tag></p>
            {selectedOrder.shipment_date && (
              <p><strong>Ngày gửi:</strong> {dayjs(selectedOrder.shipment_date).format('DD/MM/YYYY')}</p>
            )}
            {selectedOrder.delivery_date && (
              <p><strong>Ngày giao:</strong> {dayjs(selectedOrder.delivery_date).format('DD/MM/YYYY')}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default CustomerPortal;
