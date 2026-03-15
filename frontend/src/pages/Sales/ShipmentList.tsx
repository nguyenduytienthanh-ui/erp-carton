import React, { useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Skeleton, Empty, message, Tag, DatePicker,
} from 'antd';
import { EyeOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { shipmentsApi } from '../../api/shipments';
import { OutboundShipment, OutboundShipmentStatus } from '../../types/shipments';
import { getToastMessage } from '../../utils/authz';
import { downloadCSV } from '../../utils/csvExport';
import ShipmentFormModal from './ShipmentFormModal';

const ShipmentList: React.FC = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OutboundShipmentStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formOpen, setFormOpen] = useState(false);
  const [editShipment, setEditShipment] = useState<OutboundShipment | null>(null);
  const [detailShipment, setDetailShipment] = useState<OutboundShipment | null>(null);
  const queryClient = useQueryClient();

  const params = {
    search: search || undefined,
    status: status || undefined,
    page,
    page_size: pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', params],
    queryFn: () => shipmentsApi.getShipments(params),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => shipmentsApi.deleteShipment(id),
    onSuccess: () => {
      message.success('Xóa phiếu giao hàng thành công');
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Xóa phiếu giao hàng thất bại'));
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => shipmentsApi.submitShipment(id),
    onSuccess: () => {
      message.success('Gửi duyệt phiếu giao hàng thành công');
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Gửi duyệt thất bại'));
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => shipmentsApi.approveShipment(id),
    onSuccess: () => {
      message.success('Duyệt phiếu giao hàng thành công');
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Duyệt thất bại'));
    },
  });

  const packMutation = useMutation({
    mutationFn: (id: number) => shipmentsApi.packShipment(id),
    onSuccess: () => {
      message.success('Đóng gói phiếu giao hàng thành công');
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Đóng gói thất bại'));
    },
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => shipmentsApi.sendShipment(id),
    onSuccess: () => {
      message.success('Gửi phiếu giao hàng thành công');
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Gửi thất bại'));
    },
  });

  const deliverMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => shipmentsApi.confirmDelivery(id, data),
    onSuccess: () => {
      message.success('Xác nhận giao hàng thành công');
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Xác nhận giao hàng thất bại'));
    },
  });

  const statusColor: Record<OutboundShipmentStatus, string> = {
    DRAFT: 'default',
    SUBMITTED: 'processing',
    APPROVED: 'processing',
    PACKED: 'processing',
    IN_TRANSIT: 'warning',
    DELIVERED: 'success',
    RETURNED: 'error',
    CANCELLED: 'default',
  };

  const statusLabel: Record<OutboundShipmentStatus, string> = {
    DRAFT: 'Nháp',
    SUBMITTED: 'Chờ duyệt',
    APPROVED: 'Đã duyệt',
    PACKED: 'Đã đóng gói',
    IN_TRANSIT: 'Đang vận chuyển',
    DELIVERED: 'Đã giao',
    RETURNED: 'Đã trả',
    CANCELLED: 'Đã hủy',
  };

  const handleExportCSV = () => {
    if (data?.results) {
      const csvData = data.results.map((s: OutboundShipment) => ({
        'Mã phiếu': s.code,
        'Khách hàng': s.customer_name,
        'Ngày giao': dayjs(s.shipment_date).format('DD/MM/YYYY'),
        'Trạng thái': statusLabel[s.status],
        'SL': s.total_qty,
        'Ghi chú': s.notes,
      }));
      downloadCSV(csvData, 'phieu-giao-hang');
    }
  };

  const columns = [
    {
      title: 'Mã phiếu',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      sorter: (a: OutboundShipment, b: OutboundShipment) => (a.code || '').localeCompare(b.code || ''),
    },
    {
      title: 'Khách hàng',
      dataIndex: 'customer_name',
      key: 'customer_name',
      width: 150,
    },
    {
      title: 'Ngày giao',
      dataIndex: 'shipment_date',
      key: 'shipment_date',
      width: 120,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: OutboundShipmentStatus) => (
        <Tag color={statusColor[s]}>{statusLabel[s]}</Tag>
      ),
    },
    {
      title: 'SL',
      dataIndex: 'total_qty',
      key: 'total_qty',
      width: 80,
      align: 'right' as const,
    },
    {
      title: 'Ghi chú',
      dataIndex: 'notes',
      key: 'notes',
      width: 150,
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 400,
      render: (_, row: OutboundShipment) => (
        <Space wrap size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailShipment(row)}>
            Xem
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'DRAFT'}
            onClick={() => {
              setEditShipment(row);
              setFormOpen(true);
            }}
          >
            Sửa
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'DRAFT'}
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: 'Xóa phiếu giao hàng',
                content: `Bạn chắc chắn muốn xóa phiếu ${row.code}?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                okButtonProps: { danger: true },
                onOk: () => deleteMutation.mutate(row.id!),
              });
            }}
          >
            Xóa
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'DRAFT'}
            onClick={() => submitMutation.mutate(row.id!)}
          >
            Gửi duyệt
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'SUBMITTED'}
            type="primary"
            onClick={() => approveMutation.mutate(row.id!)}
          >
            Duyệt
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'APPROVED'}
            onClick={() => packMutation.mutate(row.id!)}
          >
            Đóng gói
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'PACKED'}
            onClick={() => sendMutation.mutate(row.id!)}
          >
            Gửi
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'IN_TRANSIT'}
            type="primary"
            onClick={() => {
              Modal.confirm({
                title: 'Xác nhận giao hàng',
                content: `Xác nhận đã giao phiếu ${row.code}?`,
                okText: 'Xác nhận',
                cancelText: 'Hủy',
                onOk: () => deliverMutation.mutate({
                  id: row.id!,
                  data: { actual_delivery_date: dayjs().format('YYYY-MM-DD') },
                }),
              });
            }}
          >
            Giao
          </Button>
        </Space>
      ),
    },
  ];

  if (isLoading && !data) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Input
          placeholder="Tìm kiếm mã phiếu, khách hàng..."
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
            { label: 'Đã đóng gói', value: 'PACKED' },
            { label: 'Đang vận chuyển', value: 'IN_TRANSIT' },
            { label: 'Đã giao', value: 'DELIVERED' },
          ]}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditShipment(null); setFormOpen(true); }}>
          Thêm mới
        </Button>
        <Button onClick={handleExportCSV}>
          Xuất CSV
        </Button>
      </div>

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
        scroll={{ x: 1200 }}
        locale={{
          emptyText: <Empty description="Không có phiếu giao hàng nào" />,
        }}
      />

      <ShipmentFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditShipment(null); }}
        shipment={editShipment}
        onSuccess={() => {
          setFormOpen(false);
          setEditShipment(null);
          queryClient.invalidateQueries({ queryKey: ['shipments'] });
        }}
      />

      <Modal
        title="Chi tiết phiếu giao hàng"
        open={!!detailShipment}
        onCancel={() => setDetailShipment(null)}
        footer={null}
        width={800}
      >
        {detailShipment && (
          <div>
            <p><strong>Mã phiếu:</strong> {detailShipment.code}</p>
            <p><strong>Khách hàng:</strong> {detailShipment.customer_name}</p>
            <p><strong>Ngày giao:</strong> {dayjs(detailShipment.shipment_date).format('DD/MM/YYYY')}</p>
            <p><strong>Trạng thái:</strong> <Tag color={statusColor[detailShipment.status]}>{statusLabel[detailShipment.status]}</Tag></p>
            <p><strong>Địa chỉ giao:</strong> {detailShipment.shipping_address}</p>
            {detailShipment.tracking_number && (
              <p><strong>Tracking #:</strong> {detailShipment.tracking_number}</p>
            )}
            {detailShipment.lines && (
              <>
                <h4 style={{ marginTop: '20px' }}>Hàng hoá</h4>
                <Table
                  columns={[
                    { title: 'Sản phẩm', dataIndex: 'product_name', key: 'product_name' },
                    { title: 'SL gửi', dataIndex: 'qty_shipped', key: 'qty_shipped', align: 'right' as const },
                    { title: 'SL nhận', dataIndex: 'qty_received', key: 'qty_received', align: 'right' as const },
                  ]}
                  dataSource={detailShipment.lines}
                  pagination={false}
                  rowKey="id"
                />
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ShipmentList;
