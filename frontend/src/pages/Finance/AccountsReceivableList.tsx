import React, { useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Skeleton, Empty, message, Tag, DatePicker, Row, Col, Card, Statistic, Tabs,
} from 'antd';
import { EyeOutlined, DeleteOutlined, DownloadOutlined, DollarOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { accountsReceivableApi } from '../../api/accountsReceivable';
import { ReceivableDocument, ReceivableDocumentStatus } from '../../types/accountsReceivable';
import { getToastMessage } from '../../utils/authz';
import { downloadCSV } from '../../utils/csvExport';

const AccountsReceivableList: React.FC = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ReceivableDocumentStatus | ''>('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [agingBucket, setAgingBucket] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailModal, setDetailModal] = useState<ReceivableDocument | null>(null);
  const queryClient = useQueryClient();

  const params = {
    search: search || undefined,
    status: status || undefined,
    customer_name: customerFilter || undefined,
    aging_bucket: agingBucket || undefined,
    page,
    page_size: pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['receivables', params],
    queryFn: () => accountsReceivableApi.getReceivables(params),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => accountsReceivableApi.deleteReceivable(id),
    onSuccess: () => {
      message.success('Xóa công nợ thành công');
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Xóa công nợ thất bại'));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => 
      accountsReceivableApi.cancelReceivable(id, reason),
    onSuccess: () => {
      message.success('Hủy công nợ thành công');
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Hủy công nợ thất bại'));
    },
  });

  const statusColor: Record<ReceivableDocumentStatus, string> = {
    POSTED: 'blue',
    PARTIAL_PAID: 'orange',
    PAID: 'green',
    OVERDUE: 'red',
    WRITTEN_OFF: 'default',
    CANCELLED: 'default',
  };

  const statusLabel: Record<ReceivableDocumentStatus, string> = {
    POSTED: 'Chưa thanh toán',
    PARTIAL_PAID: 'Thanh toán một phần',
    PAID: 'Đã thanh toán',
    OVERDUE: 'Quá hạn',
    WRITTEN_OFF: 'Xóa nợ',
    CANCELLED: 'Đã hủy',
  };

  const handleExportCSV = () => {
    if (data?.results) {
      const csvData = data.results.map((doc: ReceivableDocument) => ({
        'Mã công nợ': doc.code,
        'Khách hàng': doc.customer_name,
        'Số hóa đơn': doc.invoice_number,
        'Ngày hóa đơn': dayjs(doc.invoice_date).format('DD/MM/YYYY'),
        'Ngày đáo hạn': dayjs(doc.due_date).format('DD/MM/YYYY'),
        'Trạng thái': statusLabel[doc.status],
        'Tổng tiền': doc.amount,
        'Đã thanh toán': doc.paid_amount,
        'Còn nợ': doc.outstanding_amount,
        'Quá hạn (ngày)': doc.days_overdue || 0,
      }));
      downloadCSV(csvData, 'cong-no-phai-thu');
    }
  };

  // Tính tổng số liệu
  const totalAmount = data?.results?.reduce((sum: number, doc: ReceivableDocument) => sum + doc.amount, 0) || 0;
  const totalPaid = data?.results?.reduce((sum: number, doc: ReceivableDocument) => sum + doc.paid_amount, 0) || 0;
  const totalOutstanding = data?.results?.reduce((sum: number, doc: ReceivableDocument) => sum + doc.outstanding_amount, 0) || 0;

  const columns = [
    {
      title: 'Mã CN',
      dataIndex: 'code',
      key: 'code',
      width: 100,
      sorter: (a: ReceivableDocument, b: ReceivableDocument) => (a.code || '').localeCompare(b.code || ''),
    },
    {
      title: 'Khách hàng',
      dataIndex: 'customer_name',
      key: 'customer_name',
      width: 150,
    },
    {
      title: 'Ngày đáo hạn',
      dataIndex: 'due_date',
      key: 'due_date',
      width: 120,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: ReceivableDocumentStatus) => (
        <Tag color={statusColor[s]}>{statusLabel[s]}</Tag>
      ),
    },
    {
      title: 'Tổng tiền',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val.toLocaleString('vi-VN', { minimumFractionDigits: 0 }),
    },
    {
      title: 'Đã TT',
      dataIndex: 'paid_amount',
      key: 'paid_amount',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val.toLocaleString('vi-VN', { minimumFractionDigits: 0 }),
    },
    {
      title: 'Còn nợ',
      dataIndex: 'outstanding_amount',
      key: 'outstanding_amount',
      width: 120,
      align: 'right' as const,
      render: (val: number) => (
        <span style={{ color: val > 0 ? '#ff4d4f' : '#52c41a', fontWeight: 'bold' }}>
          {val.toLocaleString('vi-VN', { minimumFractionDigits: 0 })}
        </span>
      ),
    },
    {
      title: 'Quá hạn',
      dataIndex: 'days_overdue',
      key: 'days_overdue',
      width: 80,
      align: 'center' as const,
      render: (days: number) => {
        if (days === undefined || days === null || days === 0) return '-';
        return <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>{days} ngày</span>;
      },
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 150,
      render: (_, row: ReceivableDocument) => (
        <Space wrap size="small">
          <Button 
            size="small" 
            icon={<EyeOutlined />} 
            onClick={() => setDetailModal(row)}
          >
            Xem
          </Button>
          {row.status !== 'CANCELLED' && row.status !== 'PAID' && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                Modal.confirm({
                  title: 'Hủy công nợ',
                  content: `Hủy công nợ ${row.code}?`,
                  okText: 'Hủy',
                  cancelText: 'Không',
                  okButtonProps: { danger: true },
                  onOk: () => cancelMutation.mutate({ id: row.id!, reason: 'Người dùng hủy' }),
                });
              }}
            >
              Hủy
            </Button>
          )}
        </Space>
      ),
    },
  ];

  if (isLoading && !data) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Thống kê tóm tắt */}
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={6}>
            <Statistic
              title="Tổng tiền"
              value={totalAmount}
              prefix="₫"
              valueStyle={{ color: '#1677ff' }}
              formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="Đã thanh toán"
              value={totalPaid}
              prefix="₫"
              valueStyle={{ color: '#52c41a' }}
              formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="Còn nợ"
              value={totalOutstanding}
              prefix="₫"
              valueStyle={{ color: '#ff4d4f' }}
              formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="% Thanh toán"
              value={totalAmount > 0 ? ((totalPaid / totalAmount) * 100).toFixed(1) : 0}
              suffix="%"
              valueStyle={{ color: '#faad14' }}
            />
          </Col>
        </Row>
      </Card>

      {/* Bộ lọc */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Input
          placeholder="Tìm khách hàng, mã công nợ..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ width: '200px' }}
        />
        <Select
          placeholder="Trạng thái"
          value={status}
          onChange={(val) => { setStatus(val); setPage(1); }}
          allowClear
          style={{ width: '150px' }}
          options={[
            { label: 'Chưa thanh toán', value: 'POSTED' },
            { label: 'Thanh toán một phần', value: 'PARTIAL_PAID' },
            { label: 'Đã thanh toán', value: 'PAID' },
            { label: 'Quá hạn', value: 'OVERDUE' },
          ]}
        />
        <Select
          placeholder="Quá hạn"
          value={agingBucket}
          onChange={(val) => { setAgingBucket(val); setPage(1); }}
          allowClear
          style={{ width: '150px' }}
          options={[
            { label: '0-30 ngày', value: '0_30' },
            { label: '30-60 ngày', value: '30_60' },
            { label: '60-90 ngày', value: '60_90' },
            { label: '>90 ngày', value: '90_plus' },
          ]}
        />
        <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
          Xuất CSV
        </Button>
      </div>

      {/* Bảng danh sách */}
      <Table
        columns={columns}
        dataSource={data?.results || []}
        loading={isLoading}
        pagination={{
          current: page,
          pageSize,
          total: data?.count,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
        }}
        rowKey="id"
        scroll={{ x: 1400 }}
        locale={{
          emptyText: <Empty description="Không có công nợ phải thu nào" />,
        }}
      />

      {/* Modal chi tiết */}
      <Modal
        title="Chi tiết công nợ phải thu"
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={null}
        width={700}
      >
        {detailModal && (
          <Tabs
            items={[
              {
                key: 'info',
                label: 'Thông tin',
                children: (
                  <div>
                    <Row gutter={24} style={{ marginBottom: '20px' }}>
                      <Col span={12}>
                        <p><strong>Mã công nợ:</strong> {detailModal.code}</p>
                        <p><strong>Khách hàng:</strong> {detailModal.customer_name}</p>
                        <p><strong>Số HĐ:</strong> {detailModal.invoice_number}</p>
                      </Col>
                      <Col span={12}>
                        <p><strong>Ngày HĐ:</strong> {dayjs(detailModal.invoice_date).format('DD/MM/YYYY')}</p>
                        <p><strong>Ngày đáo hạn:</strong> {dayjs(detailModal.due_date).format('DD/MM/YYYY')}</p>
                        <p><strong>Trạng thái:</strong> <Tag color={statusColor[detailModal.status]}>{statusLabel[detailModal.status]}</Tag></p>
                      </Col>
                    </Row>
                    
                    <Card style={{ marginBottom: '20px' }}>
                      <Row gutter={24}>
                        <Col span={8}>
                          <Statistic title="Tổng tiền" value={detailModal.amount} prefix="₫" formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')} />
                        </Col>
                        <Col span={8}>
                          <Statistic title="Đã TT" value={detailModal.paid_amount} prefix="₫" valueStyle={{ color: '#52c41a' }} formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')} />
                        </Col>
                        <Col span={8}>
                          <Statistic title="Còn nợ" value={detailModal.outstanding_amount} prefix="₫" valueStyle={{ color: '#ff4d4f' }} formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')} />
                        </Col>
                      </Row>
                    </Card>
                  </div>
                ),
              },
              {
                key: 'payments',
                label: 'Thanh toán',
                children: (
                  <Table
                    columns={[
                      { title: 'Ngày', dataIndex: 'settlement_date', render: (date: string) => dayjs(date).format('DD/MM/YYYY') },
                      { title: 'Số tiền', dataIndex: 'amount', render: (val: number) => val.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) },
                      { title: 'Phương thức', dataIndex: 'payment_method' },
                    ]}
                    dataSource={detailModal.payments || []}
                    pagination={false}
                    rowKey="id"
                  />
                ),
              },
            ]}
          />
        )}
      </Modal>
    </div>
  );
};

export default AccountsReceivableList;
