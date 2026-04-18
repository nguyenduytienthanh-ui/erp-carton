import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { purchasingApi } from '../../api/purchasing';
import type { PurchaseApprovalHistoryItem, PurchaseRequest, PurchaseRequestStatus } from '../../types/purchasing';
import { getToastMessage } from '../../utils/authz';
import { downloadCSV } from '../../utils/csvExport';

const { Text, Title } = Typography;

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};

type RequestFormValues = {
  request_date: Dayjs;
  reference?: string;
  notes?: string;
};

const STATUS_COLOR: Record<PurchaseRequestStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'success',
  REJECTED: 'error',
};

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
};

const PurchaseRequestList: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('q') || searchParams.get('search') || '';
  const initialStatusParam = searchParams.get('status');
  const initialStatus: PurchaseRequestStatus | '' =
    initialStatusParam === 'DRAFT' || initialStatusParam === 'SUBMITTED' || initialStatusParam === 'APPROVED' || initialStatusParam === 'REJECTED'
      ? initialStatusParam
      : '';
  const focusCode = searchParams.get('focus');
  const focusId = Number(searchParams.get('focus_id') || 0) || null;
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState<PurchaseRequestStatus | ''>(initialStatus);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const focusKey = `${focusId ?? ''}:${focusCode ?? ''}`;
  const [detailRequestId, setDetailRequestId] = useState<number | null>(null);
  const [dismissedFocusKey, setDismissedFocusKey] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editRequest, setEditRequest] = useState<PurchaseRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PurchaseRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [form] = Form.useForm<RequestFormValues>();
  const queryClient = useQueryClient();

  const params = {
    search: search || undefined,
    status: status || undefined,
    page,
    page_size: pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-requests', params],
    queryFn: () => purchasingApi.getPurchaseRequests(params),
  });
  const rows = useMemo(() => data?.results ?? [], [data?.results]);
  const focusedRequest = useMemo(
    () => rows.find((row) => (focusId ? row.id === focusId : false) || (focusCode ? row.code === focusCode : false)) ?? null,
    [focusCode, focusId, rows],
  );
  const effectiveDetailRequestId = detailRequestId ?? (focusedRequest && dismissedFocusKey !== focusKey ? focusedRequest.id : null);
  const detailRequest = useMemo(
    () => rows.find((row) => row.id === effectiveDetailRequestId) ?? null,
    [effectiveDetailRequestId, rows],
  );
  const approvalHistoryQuery = useQuery({
    queryKey: ['purchase-request-approval-history', effectiveDetailRequestId],
    queryFn: () => purchasingApi.getPurchaseRequestApprovalHistory(effectiveDetailRequestId as number),
    enabled: effectiveDetailRequestId !== null,
  });

  const createMutation = useMutation({
    mutationFn: (payload: { request_date: string; reference?: string; notes?: string }) => purchasingApi.createPurchaseRequest(payload),
    onSuccess: () => {
      message.success('Tạo yêu cầu mua thành công');
      form.resetFields();
      setFormOpen(false);
      setEditRequest(null);
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-request-approval-history'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Tạo yêu cầu mua thất bại'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { request_date: string; reference?: string; notes?: string }) => purchasingApi.updatePurchaseRequest(editRequest!.id!, payload),
    onSuccess: () => {
      message.success('Cập nhật yêu cầu mua thành công');
      form.resetFields();
      setFormOpen(false);
      setEditRequest(null);
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-request-approval-history'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Cập nhật yêu cầu mua thất bại'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => purchasingApi.deletePurchaseRequest(id),
    onSuccess: () => {
      message.success('Xóa yêu cầu mua thành công');
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Xóa yêu cầu mua thất bại'));
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => purchasingApi.submitPurchaseRequest(id),
    onSuccess: () => {
      message.success('Gửi yêu cầu mua thành công');
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-request-approval-history'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Gửi yêu cầu mua thất bại'));
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => purchasingApi.approvePurchaseRequest(id),
    onSuccess: () => {
      message.success('Phê duyệt yêu cầu mua thành công');
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-request-approval-history'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Phê duyệt yêu cầu mua thất bại'));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => purchasingApi.rejectPurchaseRequest(id, reason),
    onSuccess: () => {
      message.success('Từ chối yêu cầu mua thành công');
      setRejectTarget(null);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-request-approval-history'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Từ chối yêu cầu mua thất bại'));
    },
  });
  const summary = useMemo(() => {
    const draftCount = rows.filter((row) => row.status === 'DRAFT').length;
    const submittedCount = rows.filter((row) => row.status === 'SUBMITTED').length;
    const approvedCount = rows.filter((row) => row.status === 'APPROVED').length;
    const rejectedCount = rows.filter((row) => row.status === 'REJECTED').length;
    return { draftCount, submittedCount, approvedCount, rejectedCount };
  }, [rows]);

  const statusAlert = useMemo(() => {
    if (summary.submittedCount > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${summary.submittedCount} yêu cầu mua đang chờ duyệt.`,
        description: 'Ưu tiên xử lý các phiếu chờ duyệt để tránh chậm nhịp tạo đơn mua và bổ sung vật tư.',
      };
    }
    if (summary.rejectedCount > 0) {
      return {
        type: 'info' as const,
        message: `Có ${summary.rejectedCount} yêu cầu mua bị từ chối trên tập dữ liệu hiện tại.`,
        description: 'Nên rà lại lý do từ chối và cập nhật lại các yêu cầu còn khả thi trước khi gửi vòng duyệt tiếp theo.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Luồng yêu cầu mua đang ổn định.',
      description: 'Không có hàng chờ duyệt nổi bật trong bộ lọc hiện tại.',
    };
  }, [summary.rejectedCount, summary.submittedCount]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (search.trim()) tags.push(`Từ khóa: ${search.trim()}`);
    if (status) tags.push(`Trạng thái: ${STATUS_LABEL[status]}`);
    return tags;
  }, [search, status]);

  const handleExportCSV = () => {
    if (rows.length > 0) {
      const csvData = rows.map((req) => ({
        'Mã YCM': req.code,
        'Ngày yêu cầu': dayjs(req.request_date).format('DD/MM/YYYY'),
        'Trạng thái': STATUS_LABEL[req.status],
        'Người yêu cầu': req.requested_by_name || '-',
        'Tham chiếu': req.reference || '-',
        'Ghi chú': req.notes || '-',
      }));
      downloadCSV(csvData, 'yeu-cau-mua');
    }
  };

  const handleSubmitForm = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        request_date: values.request_date.format('YYYY-MM-DD'),
        reference: values.reference?.trim() || '',
        notes: values.notes?.trim() || '',
      };
      if (editRequest) {
        updateMutation.mutate(payload);
      } else {
        createMutation.mutate(payload);
      }
    } catch {
      message.error('Vui lòng kiểm tra lại biểu mẫu');
    }
  };

  const columns = [
    {
      title: 'Mã YCM',
      dataIndex: 'code',
      key: 'code',
      width: 140,
      sorter: (a: PurchaseRequest, b: PurchaseRequest) => (a.code || '').localeCompare(b.code || ''),
    },
    {
      title: 'Ngày yêu cầu',
      dataIndex: 'request_date',
      key: 'request_date',
      width: 120,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Người yêu cầu',
      dataIndex: 'requested_by_name',
      key: 'requested_by_name',
      width: 180,
      render: (value: string | null) => value || '-',
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (requestStatus: PurchaseRequestStatus) => <Tag color={STATUS_COLOR[requestStatus]}>{STATUS_LABEL[requestStatus]}</Tag>,
    },
    {
      title: 'Ghi chú',
      dataIndex: 'notes',
      key: 'notes',
      width: 260,
      render: (value: string) => value || '-',
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 300,
      render: (_: unknown, row: PurchaseRequest) => (
        <Space wrap size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setDetailRequestId(row.id); setDismissedFocusKey(focusKey); }}>
            Xem
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'DRAFT'}
            onClick={() => {
              setEditRequest(row);
              form.setFieldsValue({
                request_date: dayjs(row.request_date),
                reference: row.reference || '',
                notes: row.notes || '',
              });
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
                  okText: 'Xóa',
                  cancelText: 'Hủy',
                  onOk: () => deleteMutation.mutate(row.id),
                });
              }}
            >
              Xóa
            </Button>
          )}
          {row.status === 'DRAFT' && (
            <Button size="small" type="primary" onClick={() => submitMutation.mutate(row.id)}>
              Gửi duyệt
            </Button>
          )}
          {row.status === 'SUBMITTED' && (
            <>
              <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => approveMutation.mutate(row.id)}>
                Duyệt
              </Button>
              <Button
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={() => {
                  setRejectTarget(row);
                  setRejectReason('');
                }}
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
    return <Card><Empty description="Đang tải yêu cầu mua..." /></Card>;
  }

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">Mua hàng</Tag>
                <Tag color="gold">Yêu cầu mua</Tag>
                <Tag color="processing">Luồng phê duyệt</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>Trung tâm yêu cầu mua</Title>
              <Text type="secondary">Theo dõi yêu cầu mua từ lúc tạo nháp, gửi duyệt tới khi chốt quyết định để đẩy sang bước mua hàng thực thi.</Text>
            </div>
            <Space wrap>
              <Button onClick={handleExportCSV}>Xuất CSV</Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditRequest(null);
                  form.resetFields();
                  form.setFieldValue('request_date', dayjs());
                  setFormOpen(true);
                }}
              >
                Tạo mới
              </Button>
            </Space>
          </div>

          <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Nháp" value={summary.draftCount} valueStyle={{ color: '#faad14' }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Chờ duyệt" value={summary.submittedCount} valueStyle={{ color: '#1677ff' }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đã duyệt" value={summary.approvedCount} valueStyle={{ color: '#52c41a' }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Từ chối" value={summary.rejectedCount} valueStyle={{ color: '#cf1322' }} />
            </div>
          </div>
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Input
              placeholder="Tìm mã yêu cầu..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              style={{ width: 220 }}
            />
            <Select
              placeholder="Trạng thái"
              value={status || undefined}
              onChange={(val) => { setStatus(val ?? ''); setPage(1); }}
              allowClear
              style={{ width: 180 }}
              options={[
                { label: 'Nháp', value: 'DRAFT' },
                { label: 'Chờ duyệt', value: 'SUBMITTED' },
                { label: 'Đã duyệt', value: 'APPROVED' },
                { label: 'Từ chối', value: 'REJECTED' },
              ]}
            />
            <Button
              onClick={() => {
                setSearch('');
                setStatus('');
                setPage(1);
              }}
            >
              Xóa bộ lọc
            </Button>
          </div>
          {activeFilterTags.length > 0 ? (
            <Space wrap>
              {activeFilterTags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>
          ) : (
            <Text type="secondary">Đang hiển thị toàn bộ yêu cầu mua.</Text>
          )}
        </Space>
      </Card>

      <Table
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        pagination={{
          current: page,
          pageSize,
          total: data?.count,
          onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); },
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
        }}
        rowKey="id"
        scroll={{ x: 1200 }}
        locale={{
          emptyText: <Empty description="Không có yêu cầu mua phù hợp" />,
        }}
      />

      <Modal
        title={editRequest ? 'Sửa yêu cầu mua' : 'Tạo yêu cầu mua mới'}
        open={formOpen}
        onCancel={() => {
          setFormOpen(false);
          setEditRequest(null);
          form.resetFields();
        }}
        onOk={handleSubmitForm}
        okText={editRequest ? 'Lưu thay đổi' : 'Tạo yêu cầu'}
        cancelText="Đóng"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={700}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Ngày yêu cầu" name="request_date" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Tham chiếu" name="reference">
            <Input />
          </Form.Item>
          <Form.Item label="Ghi chú" name="notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Chi tiết yêu cầu mua"
        open={!!detailRequest}
        onCancel={() => {
          setDetailRequestId(null);
          setDismissedFocusKey(focusKey);
        }}
        footer={null}
        width={760}
      >
        {detailRequest ? (
          <div data-testid="purchase-request-detail-panel">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Mã">{detailRequest.code}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <Tag color={STATUS_COLOR[detailRequest.status]}>{STATUS_LABEL[detailRequest.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Ngày">{dayjs(detailRequest.request_date).format('DD/MM/YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Người yêu cầu">{detailRequest.requested_by_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Tham chiếu">{detailRequest.reference || '-'}</Descriptions.Item>
              <Descriptions.Item label="Duyệt lúc">{detailRequest.approved_at ? dayjs(detailRequest.approved_at).format('DD/MM/YYYY HH:mm') : '-'}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú" span={2}>{detailRequest.notes || '-'}</Descriptions.Item>
              {detailRequest.reject_reason ? <Descriptions.Item label="Lý do từ chối" span={2}>{detailRequest.reject_reason}</Descriptions.Item> : null}
            </Descriptions>

            <div>
              <Title level={5}>Dòng hàng</Title>
              <Table
                rowKey={(row) => row.id}
                dataSource={detailRequest.lines ?? []}
                pagination={false}
                locale={{ emptyText: 'Yêu cầu mua này chưa có dòng hàng chi tiết.' }}
                columns={[
                  { title: '#', dataIndex: 'line_number', width: 60 },
                  { title: 'Mã SP', dataIndex: 'product_code', width: 120, render: (value) => value || '-' },
                  { title: 'Tên SP', dataIndex: 'product_name', width: 220, render: (value) => value || '-' },
                  { title: 'Số lượng', dataIndex: 'qty', width: 120 },
                  { title: 'Ghi chú', dataIndex: 'note', width: 220, render: (value) => value || '-' },
                ]}
                scroll={{ x: 720 }}
              />
            </div>

            <div>
              <Title level={5}>Lịch sử duyệt</Title>
              <Table<PurchaseApprovalHistoryItem>
                data-testid="purchase-request-approval-history"
                rowKey={(row) => `${row.action}-${row.created_at}`}
                loading={approvalHistoryQuery.isLoading}
                dataSource={approvalHistoryQuery.data ?? []}
                pagination={false}
                locale={{ emptyText: 'Yêu cầu mua này chưa có lịch sử duyệt.' }}
                columns={[
                  {
                    title: 'Hành động',
                    dataIndex: 'action',
                    width: 160,
                    render: (_, row) => row.action_label || row.action,
                  },
                  {
                    title: 'Người thực hiện',
                    dataIndex: 'user',
                    width: 180,
                    render: (value) => value || '-',
                  },
                  {
                    title: 'Ghi chú',
                    dataIndex: 'comments',
                    width: 260,
                    render: (value) => value || '-',
                  },
                  {
                    title: 'Thời gian',
                    dataIndex: 'created_at',
                    width: 180,
                    render: (value) => dayjs(value).format('DD/MM/YYYY HH:mm'),
                  },
                ]}
                scroll={{ x: 760 }}
              />
            </div>
          </Space>
          </div>
        ) : null}
      </Modal>

      <Modal
        title={rejectTarget ? `Từ chối ${rejectTarget.code}` : 'Từ chối yêu cầu mua'}
        open={!!rejectTarget}
        onOk={() => {
          if (rejectTarget) {
            rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason.trim() });
          }
        }}
        onCancel={() => { setRejectTarget(null); setRejectReason(''); }}
        confirmLoading={rejectMutation.isPending}
        okText="Xác nhận từ chối"
        cancelText="Đóng"
        okButtonProps={{ danger: true, disabled: rejectReason.trim().length === 0 }}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label="Lý do từ chối" required>
            <Input.TextArea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PurchaseRequestList;
