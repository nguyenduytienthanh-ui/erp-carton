import React, { useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Skeleton, Empty, message, Tag, Row, Col, Card, Statistic, Progress,
} from 'antd';
import { EyeOutlined, DeleteOutlined, UploadOutlined, CheckCircleOutlined, StopOutlined, DownloadOutlined, InboxOutlined, ToolOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { productionApi } from '../../api/production';
import type { ProductionOrder, ProductionOrderStatus } from '../../types/production';
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
    queryFn: () => productionApi.getOrders(params),
  });

  const refreshOrders = () => {
    queryClient.invalidateQueries({ queryKey: ['production-orders'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => productionApi.deleteOrder(id),
    onSuccess: () => {
      message.success('Xóa lệnh sản xuất thành công');
      refreshOrders();
    },
    onError: (error) => message.error(getToastMessage(error, 'Xóa lệnh sản xuất thất bại')),
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => productionApi.submitOrder(id),
    onSuccess: () => {
      message.success('Đã gửi duyệt lệnh sản xuất');
      refreshOrders();
    },
    onError: (error) => message.error(getToastMessage(error, 'Gửi duyệt thất bại')),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => productionApi.approveOrder(id),
    onSuccess: () => {
      message.success('Đã duyệt lệnh sản xuất');
      refreshOrders();
    },
    onError: (error) => message.error(getToastMessage(error, 'Duyệt lệnh sản xuất thất bại')),
  });

  const releaseMutation = useMutation({
    mutationFn: (id: number) => productionApi.releaseOrder(id),
    onSuccess: () => {
      message.success('Đã phát lệnh sản xuất');
      refreshOrders();
    },
    onError: (error) => message.error(getToastMessage(error, 'Phát lệnh sản xuất thất bại')),
  });

  const issueMutation = useMutation({
    mutationFn: (id: number) => productionApi.issueMaterials(id, {}),
    onSuccess: () => {
      message.success('Đã cấp vật tư');
      refreshOrders();
    },
    onError: (error) => message.error(getToastMessage(error, 'Cấp vật tư thất bại')),
  });

  const receiveMutation = useMutation({
    mutationFn: (id: number) => productionApi.receiveOutput(id, {}),
    onSuccess: () => {
      message.success('Đã nhập kho thành phẩm');
      refreshOrders();
    },
    onError: (error) => message.error(getToastMessage(error, 'Nhập kho thành phẩm thất bại')),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => productionApi.cancelOrder(id, reason),
    onSuccess: () => {
      message.success('Hủy lệnh sản xuất thành công');
      refreshOrders();
    },
    onError: (error) => message.error(getToastMessage(error, 'Hủy lệnh sản xuất thất bại')),
  });

  const statusColor: Record<ProductionOrderStatus, string> = {
    DRAFT: 'default',
    SUBMITTED: 'processing',
    APPROVED: 'blue',
    REJECTED: 'error',
    RELEASED: 'cyan',
    IN_PROGRESS: 'gold',
    COMPLETED: 'success',
    CANCELLED: 'error',
  };

  const statusLabel: Record<ProductionOrderStatus, string> = {
    DRAFT: 'Nháp',
    SUBMITTED: 'Chờ duyệt',
    APPROVED: 'Đã duyệt',
    REJECTED: 'Từ chối',
    RELEASED: 'Đã phát lệnh',
    IN_PROGRESS: 'Đang sản xuất',
    COMPLETED: 'Hoàn thành',
    CANCELLED: 'Đã hủy',
  };

  const getProgressPercent = (order: ProductionOrder) => {
    const planned = Number(order.planned_qty || 0);
    const produced = Number(order.produced_qty || 0);
    if (!planned) return 0;
    return Math.min(100, Math.round((produced / planned) * 100));
  };

  const handleExportCSV = () => {
    if (data?.results) {
      const csvData = data.results.map((order: ProductionOrder) => ({
        'Mã LSX': order.code,
        'Sản phẩm': order.product_name,
        'SL kế hoạch': Number(order.planned_qty || 0).toLocaleString('vi-VN'),
        'SL hoàn thành': Number(order.produced_qty || 0).toLocaleString('vi-VN'),
        'Trạng thái': statusLabel[order.status],
        'Tiến độ': `${getProgressPercent(order)}%`,
        'Ngày kết thúc': order.planned_end_date ? dayjs(order.planned_end_date).format('DD/MM/YYYY') : '',
      }));
      downloadCSV(csvData, 'lenh-san-xuat');
    }
  };

  // Tính thống kê
  const allOrders = data?.results || [];
  const inProgress = allOrders.filter((o: ProductionOrder) => ['RELEASED', 'IN_PROGRESS'].includes(o.status)).length;
  const completed = allOrders.filter((o: ProductionOrder) => o.status === 'COMPLETED').length;
  const totalQty = allOrders.reduce((sum: number, o: ProductionOrder) => sum + Number(o.planned_qty || 0), 0);

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
      dataIndex: 'planned_qty',
      key: 'planned_qty',
      width: 100,
      align: 'right' as const,
      render: (value: string) => Number(value || 0).toLocaleString('vi-VN'),
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
      key: 'progress_percentage',
      width: 150,
      render: (_: unknown, row: ProductionOrder) => {
        const percent = getProgressPercent(row);
        return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Progress percent={percent} size="small" style={{ marginBottom: 0, minWidth: 100 }} />
          <span>{percent}%</span>
        </div>
      );
      },
    },
    {
      title: 'Ngày kết thúc',
      dataIndex: 'planned_end_date',
      key: 'planned_end_date',
      width: 120,
      render: (date: string | null) => date ? dayjs(date).format('DD/MM/YYYY') : '-',
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 200,
      render: (_: unknown, row: ProductionOrder) => (
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
          {row.status === 'DRAFT' && (
            <Button
              size="small"
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => submitMutation.mutate(row.id)}
            >
              Gửi duyệt
            </Button>
          )}
          {row.status === 'SUBMITTED' && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => approveMutation.mutate(row.id)}
              >
                Duyệt
              </Button>
            </>
          )}
          {row.status === 'APPROVED' && (
            <Button
              size="small"
              type="primary"
              icon={<ToolOutlined />}
              onClick={() => releaseMutation.mutate(row.id)}
            >
              Phát lệnh
            </Button>
          )}
          {['RELEASED', 'IN_PROGRESS'].includes(row.status) && (
            <>
              <Button
                size="small"
                onClick={() => issueMutation.mutate(row.id)}
              >
                Cấp NVL
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<InboxOutlined />}
                onClick={() => receiveMutation.mutate(row.id)}
              >
                Nhập TP
              </Button>
            </>
          )}
          {!['COMPLETED', 'CANCELLED'].includes(row.status) && (
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
                  onOk: () => cancelMutation.mutate({ id: row.id, reason: 'Người dùng hủy' }),
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
            { label: 'Chờ duyệt', value: 'SUBMITTED' },
            { label: 'Đã duyệt', value: 'APPROVED' },
            { label: 'Đã phát lệnh', value: 'RELEASED' },
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
                <p><strong>SL kế hoạch:</strong> {Number(detailModal.planned_qty || 0).toLocaleString('vi-VN')}</p>
                <p><strong>SL hoàn thành:</strong> {Number(detailModal.produced_qty || 0).toLocaleString('vi-VN')}</p>
              </Col>
              <Col span={12}>
                <p><strong>Trạng thái:</strong> <Tag color={statusColor[detailModal.status]}>{statusLabel[detailModal.status]}</Tag></p>
                <p><strong>Ngày kết thúc:</strong> {detailModal.planned_end_date ? dayjs(detailModal.planned_end_date).format('DD/MM/YYYY') : '-'}</p>
                <p><strong>Tiến độ:</strong> {getProgressPercent(detailModal)}%</p>
              </Col>
            </Row>

            <Progress 
              percent={getProgressPercent(detailModal)}
              status={detailModal.status === 'COMPLETED' ? 'success' : 'active'}
              style={{ marginBottom: '20px' }}
            />

            {detailModal.notes && (
              <p><strong>Ghi chú:</strong> {detailModal.notes}</p>
            )}
            {detailModal.cancel_reason && (
              <p><strong>Lý do hủy:</strong> {detailModal.cancel_reason}</p>
            )}
            {detailModal.reject_reason && (
              <p><strong>Lý do từ chối:</strong> {detailModal.reject_reason}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ProductionOrderList;
