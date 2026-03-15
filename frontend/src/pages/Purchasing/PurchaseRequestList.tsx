import React, { useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Skeleton, Empty, message, Tag, Row, Col, Card, Statistic, Form, DatePicker,
} from 'antd';
import { EyeOutlined, DeleteOutlined, PlusOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { purchaseRequestApi } from '../../api/purchaseRequest';
import { PurchaseRequest, PurchaseRequestStatus } from '../../types/purchaseRequest';
import { getToastMessage } from '../../utils/authz';
import { downloadCSV } from '../../utils/csvExport';

const PurchaseRequestList: React.FC = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PurchaseRequestStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formOpen, setFormOpen] = useState(false);
  const [editRequest, setEditRequest] = useState<PurchaseRequest | null>(null);
  const [detailRequest, setDetailRequest] = useState<PurchaseRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const params = {
    search: search || undefined,
    status: status || undefined,
    page,
    page_size: pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-requests', params],
    queryFn: () => purchaseRequestApi.getRequests(params),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => purchaseRequestApi.createRequest(data),
    onSuccess: () => {
      message.success('Tạo yêu cầu mua thành công');
      form.resetFields();
      setFormOpen(false);
      setEditRequest(null);
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Tạo yêu cầu mua thất bại'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => purchaseRequestApi.updateRequest(editRequest!.id!, data),
    onSuccess: () => {
      message.success('Cập nhật yêu cầu mua thành công');
      form.resetFields();
      setFormOpen(false);
      setEditRequest(null);
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Cập nhật yêu cầu mua thất bại'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => purchaseRequestApi.deleteRequest(id),
    onSuccess: () => {
      message.success('Xóa yêu cầu mua thành công');
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Xóa yêu cầu mua thất bại'));
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => purchaseRequestApi.submitRequest(id),
    onSuccess: () => {
      message.success('Gửi yêu cầu mua thành công');
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Gửi yêu cầu mua thất bại'));
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => purchaseRequestApi.approveRequest(id),
    onSuccess: () => {
      message.success('Phê duyệt yêu cầu mua thành công');
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Phê duyệt yêu cầu mua thất bại'));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => purchaseRequestApi.rejectRequest(id, rejectReason),
    onSuccess: () => {
      message.success('Từ chối yêu cầu mua thành công');
      setShowRejectModal(false);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Từ chối yêu cầu mua thất bại'));
    },
  });

  const statusColor: Record<PurchaseRequestStatus, string> = {
    DRAFT: 'default',
    SUBMITTED: 'processing',
    APPROVED: 'success',
    REJECTED: 'error',
  };

  const statusLabel: Record<PurchaseRequestStatus, string> = {
    DRAFT: 'Nháp',
    SUBMITTED: 'Chờ duyệt',
    APPROVED: 'Đã duyệt',
    REJECTED: 'Từ chối',
  };

  const handleExportCSV = () => {
    if (data?.results) {
      const csvData = data.results.map((req: PurchaseRequest) => ({
        'Mã YCM': req.code,
        'Ngày': dayjs(req.request_date).format('DD/MM/YYYY'),
        'Trạng thái': statusLabel[req.status],
        'Người yêu cầu': req.requested_by_name,
        'Ghi chú': req.notes,
      }));
      downloadCSV(csvData, 'yeu-cau-mua');
    }
  };

  const handleSubmitForm = async () => {
    try {
      const values = await form.validateFields();
      if (editRequest) {
        updateMutation.mutate(values);
      } else {
        createMutation.mutate(values);
      }
    } catch {
      message.error('Vui lòng kiểm tra lại form');
    }
  };

  const draftCount = data?.results?.filter((r: PurchaseRequest) => r.status === 'DRAFT').length || 0;
  const submittedCount = data?.results?.filter((r: PurchaseRequest) => r.status === 'SUBMITTED').length || 0;
  const approvedCount = data?.results?.filter((r: PurchaseRequest) => r.status === 'APPROVED').length || 0;

  const columns = [
    {
      title: 'Mã YCM',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      sorter: (a: PurchaseRequest, b: PurchaseRequest) => (a.code || '').localeCompare(b.code || ''),
    },
    {
      title: 'Ngày yêu cầu',
      dataIndex: 'request_date',
      key: 'request_date',
      width: 100,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Người yêu cầu',
      dataIndex: 'requested_by_name',
      key: 'requested_by_name',
      width: 120,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: PurchaseRequestStatus) => (
        <Tag color={statusColor[s]}>{statusLabel[s]}</Tag>
      ),
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 280,
      render: (_, row: PurchaseRequest) => (
        <Space wrap size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailRequest(row)}>
            Xem
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'DRAFT'}
            onClick={() => {
              setEditRequest(row);
              form.setFieldsValue(row);
              setFormOpen(true);
            }}
          >
            Sửa
          </Button>
          {row.status === 'DRAFT' && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                Modal.confirm({
                  title: 'Xóa yêu cầu mua',
                  content: `Xóa yêu cầu mua ${row.code}?`,
                  onOk: () => deleteMutation.mutate(row.id!),
                });
              }}
            >
              Xóa
            </Button>
          )}
          {row.status === 'DRAFT' && (
            <Button size="small" type="primary" onClick={() => submitMutation.mutate(row.id!)}>
              Gửi
            </Button>
          )}
          {row.status === 'SUBMITTED' && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => approveMutation.mutate(row.id!)}
              >
                Duyệt
              </Button>
              <Button
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={() => setShowRejectModal(true)}
              >
                Từ chối
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
          <Col span={8}>
            <Statistic title="Nháp" value={draftCount} valueStyle={{ color: '#faad14' }} />
          </Col>
          <Col span={8}>
            <Statistic title="Chờ duyệt" value={submittedCount} valueStyle={{ color: '#1677ff' }} />
          </Col>
          <Col span={8}>
            <Statistic title="Đã duyệt" value={approvedCount} valueStyle={{ color: '#52c41a' }} />
          </Col>
        </Row>
      </Card>

      {/* Bộ lọc */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Input
          placeholder="Tìm mã yêu cầu..."
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
            { label: 'Từ chối', value: 'REJECTED' },
          ]}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditRequest(null); form.resetFields(); setFormOpen(true); }}>
          Tạo mới
        </Button>
        <Button onClick={handleExportCSV}>
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
          pageSizeOptions: ['10', '20', '50'],
        }}
        rowKey="id"
        scroll={{ x: 1200 }}
      />

      {/* Modal Tạo/Sửa */}
      <Modal
        title={editRequest ? 'Sửa yêu cầu mua' : 'Tạo yêu cầu mua mới'}
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditRequest(null); form.resetFields(); }}
        onOk={handleSubmitForm}
        loading={createMutation.isPending || updateMutation.isPending}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Ngày yêu cầu" name="request_date" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="Ghi chú" name="notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Chi tiết */}
      <Modal title="Chi tiết yêu cầu mua" open={!!detailRequest} onCancel={() => setDetailRequest(null)} footer={null} width={700}>
        {detailRequest && (
          <div>
            <p><strong>Mã:</strong> {detailRequest.code}</p>
            <p><strong>Ngày:</strong> {dayjs(detailRequest.request_date).format('DD/MM/YYYY')}</p>
            <p><strong>Trạng thái:</strong> <Tag color={statusColor[detailRequest.status]}>{statusLabel[detailRequest.status]}</Tag></p>
            {detailRequest.notes && <p><strong>Ghi chú:</strong> {detailRequest.notes}</p>}
          </div>
        )}
      </Modal>

      {/* Modal Từ chối */}
      <Modal
        title="Từ chối yêu cầu mua"
        open={showRejectModal}
        onOk={() => rejectMutation.mutate(detailRequest?.id!)}
        onCancel={() => { setShowRejectModal(false); setRejectReason(''); }}
        loading={rejectMutation.isPending}
      >
        <Form layout="vertical">
          <Form.Item label="Lý do từ chối" required>
            <Input.TextArea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PurchaseRequestList;
