import React, { useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Skeleton, Empty, message, Tag, Row, Col, Card, Statistic, Progress,
} from 'antd';
import { EyeOutlined, DeleteOutlined, PlayCircleOutlined, CheckCircleOutlined, StopOutlined, DownloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { productionOrdersApi } from '../../api/productionOrders';
import { ProductionOrder, ProductionOrderStatus } from '../../types/productionOrders';
import { getToastMessage } from '../../utils/authz';
import { downloadCSV } from '../../utils/csvExport';

const ProductionOrderList: React.FC = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProductionOrderStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailModal, setDetailModal] = useState<ProductionOrder | null>(null);
  const queryClient = useQueryClient();

  const params = {
    search: search || undefined,
    status: status || undefined,
    page,
    page_size: pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['production-orders', params],
    queryFn: () => productionOrdersApi.getOrders(params),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => productionOrdersApi.deleteOrder(id),
    onSuccess: () => {
      message.success('Xóa lệnh sản xuất thành công');
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Xóa lệnh sản xuất thất bại'));
    },
  });

  const startMutation = useMutation({
    mutationFn: (id: number) => productionOrdersApi.startProduction(id),
    onSuccess: () => {
      message.success('Bắt đầu sản xuất thành công');
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Bắt đầu sản xuất thất bại'));
    },
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => productionOrdersApi.completeProduction(id, data),
    onSuccess: () => {
      message.success('Hoàn thành sản xuất thành công');
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Hoàn thành sản xuất thất bại'));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => 
      productionOrdersApi.cancelOrder(id, reason),
    onSuccess: () => {
      message.success('Hủy lệnh sản xuất thành công');
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Hủy lệnh sản xuất thất bại'));
    },
  });

  const statusColor: Record<ProductionOrderStatus, string> = {
    DRAFT: 'default',
    PLANNED: 'blue',
    IN_PROGRESS: 'processing',
    COMPLETED: 'success',
    CANCELLED: 'error',
  };

  const statusLabel: Record<ProductionOrderStatus, string> = {
    DRAFT: 'Nháp',
    PLANNED: 'Lên kế hoạch',
    IN_PROGRESS: 'Đang sản xuất',
    COMPLETED: 'Hoàn thành',
    CANCELLED: 'Đã hủy',
  };

  const handleExportCSV = () => {
    if (data?.results) {
      const csvData = data.results.map((order: ProductionOrder) => ({
        'Mã LSX': order.code,
        'Sản phẩm': order.product_name,
        'SL': order.quantity,
        'Trạng thái': statusLabel[order.status],
        'Tiến độ': `${order.progress_percentage || 0}%`,
        'Ngày kết thúc': dayjs(order.target_end_date).format('DD/MM/YYYY'),
      }));
      downloadCSV(csvData, 'lenh-san-xuat');
    }
  };

  // Tính thống kê
  const allOrders = data?.results || [];
  const inProgress = allOrders.filter((o: ProductionOrder) => o.status === 'IN_PROGRESS').length;
  const completed = allOrders.filter((o: ProductionOrder) => o.status === 'COMPLETED').length;
  const totalQty = allOrders.reduce((sum: number, o: ProductionOrder) => sum + o.quantity, 0);

  const columns = [
    {
      title: 'Mã LSX',
      dataIndex: 'code',
      key: 'code',
      width: 100,
      sorter: (a: ProductionOrder, b: ProductionOrder) => (a.code || '').localeCompare(b.code || ''),
    },
    {
      title: 'Sản phẩm',
      dataIndex: 'product_name',
      key: 'product_name',
      width: 150,
    },
    {
      title: 'SL',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'right' as const,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: ProductionOrderStatus) => (
        <Tag color={statusColor[s]}>{statusLabel[s]}</Tag>
      ),
    },
    {
      title: 'Tiến độ',
      dataIndex: 'progress_percentage',
      key: 'progress_percentage',
      width: 150,
      render: (percent: number) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Progress 
            type="circle" 
            percent={percent || 0} 
            width={40}
            format={(p) => `${p}%`}
          />
          <span>{percent || 0}%</span>
        </div>
      ),
    },
    {
      title: 'Ngày kết thúc',
      dataIndex: 'target_end_date',
      key: 'target_end_date',
      width: 120,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 200,
      render: (_, row: ProductionOrder) => (
        <Space wrap size="small">
          <Button 
            size="small" 
            icon={<EyeOutlined />} 
            onClick={() => setDetailModal(row)}
          >
            Xem
          </Button>
          {row.status === 'DRAFT' && (
            <>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  Modal.confirm({
                    title: 'Xóa lệnh sản xuất',
                    content: `Xóa lệnh sản xuất ${row.code}?`,
                    okText: 'Xóa',
                    cancelText: 'Không',
                    okButtonProps: { danger: true },
                    onOk: () => deleteMutation.mutate(row.id!),
                  });
                }}
              >
                Xóa
              </Button>
            </>
          )}
          {row.status === 'PLANNED' && (
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => startMutation.mutate(row.id!)}
            >
              Bắt đầu
            </Button>
          )}
          {row.status === 'IN_PROGRESS' && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => {
                  Modal.confirm({
                    title: 'Hoàn thành sản xuất',
                    content: `Hoàn thành lệnh ${row.code}?`,
                    okText: 'Hoàn thành',
                    cancelText: 'Không',
                    onOk: () => completeMutation.mutate({ 
                      id: row.id!, 
                      data: { completed_quantity: row.quantity } 
                    }),
                  });
                }}
              >
                Hoàn thành
              </Button>
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                onClick={() => {
                  Modal.confirm({
                    title: 'Hủy sản xuất',
                    content: `Hủy lệnh ${row.code}?`,
                    okText: 'Hủy',
                    cancelText: 'Không',
                    okButtonProps: { danger: true },
                    onOk: () => cancelMutation.mutate({ id: row.id!, reason: 'Người dùng hủy' }),
                  });
                }}
              >
                Hủy
              </Button>
            </>
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
      {/* Thống kê */}
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={6}>
            <Statistic
              title="Tổng lệnh"
              value={allOrders.length}
              valueStyle={{ color: '#1677ff' }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="Đang sản xuất"
              value={inProgress}
              valueStyle={{ color: '#faad14' }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="Hoàn thành"
              value={completed}
              valueStyle={{ color: '#52c41a' }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="Tổng SL"
              value={totalQty}
              valueStyle={{ color: '#1677ff' }}
            />
          </Col>
        </Row>
      </Card>

      {/* Bộ lọc */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Input
          placeholder="Tìm mã lệnh, sản phẩm..."
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
            { label: 'Nháp', value: 'DRAFT' },
            { label: 'Lên kế hoạch', value: 'PLANNED' },
            { label: 'Đang sản xuất', value: 'IN_PROGRESS' },
            { label: 'Hoàn thành', value: 'COMPLETED' },
            { label: 'Đã hủy', value: 'CANCELLED' },
          ]}
        />
        <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
          Xuất CSV
        </Button>
      </div>

      {/* Bảng danh sách */}
      <Table
        columns={columns}
        dataSource={allOrders}
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
          emptyText: <Empty description="Không có lệnh sản xuất nào" />,
        }}
      />

      {/* Modal chi tiết */}
      <Modal
        title="Chi tiết lệnh sản xuất"
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={null}
        width={700}
      >
        {detailModal && (
          <div>
            <Row gutter={24} style={{ marginBottom: '20px' }}>
              <Col span={12}>
                <p><strong>Mã lệnh:</strong> {detailModal.code}</p>
                <p><strong>Sản phẩm:</strong> {detailModal.product_name}</p>
                <p><strong>Số lượng:</strong> {detailModal.quantity} {detailModal.uom}</p>
              </Col>
              <Col span={12}>
                <p><strong>Trạng thái:</strong> <Tag color={statusColor[detailModal.status]}>{statusLabel[detailModal.status]}</Tag></p>
                <p><strong>Ngày kết thúc:</strong> {dayjs(detailModal.target_end_date).format('DD/MM/YYYY')}</p>
                <p><strong>Tiến độ:</strong> {detailModal.progress_percentage || 0}%</p>
              </Col>
            </Row>

            <Progress 
              percent={detailModal.progress_percentage || 0}
              status={detailModal.status === 'COMPLETED' ? 'success' : 'active'}
              style={{ marginBottom: '20px' }}
            />

            {detailModal.notes && (
              <p><strong>Ghi chú:</strong> {detailModal.notes}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ProductionOrderList;
