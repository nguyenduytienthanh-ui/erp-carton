import React, { useState } from 'react';
import {
  Alert, Table, Button, Space, Input, Select, Modal, Skeleton, message, Tag, Row, Col, Card, Statistic, Form, DatePicker,
} from 'antd';
import { EyeOutlined, DeleteOutlined, DownloadOutlined, PlusOutlined, FileTextOutlined, SwapOutlined, StopOutlined, CheckOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import { salesApi } from '../../api/sales';
import { customersApi } from '../../api/customers';
import type { Quote, QuoteStatus } from '../../types/sales';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import { canSubmitSalesOrders } from '../../utils/authz';

const statusColor: Record<QuoteStatus, string> = {
  DRAFT: 'default',
  SENT: 'processing',
  ACCEPTED: 'success',
  REJECTED: 'error',
  EXPIRED: 'default',
};

const statusLabel: Record<QuoteStatus, string> = {
  DRAFT: 'Nháp',
  SENT: 'Đã gửi',
  ACCEPTED: 'Đã chấp nhận',
  REJECTED: 'Từ chối',
  EXPIRED: 'Hết hạn',
};

const quoteNextSteps: Record<QuoteStatus, string> = {
  DRAFT: 'Kiểm tra thông tin khách hàng rồi gửi báo giá cho khách.',
  SENT: 'Theo dõi phản hồi khách hàng: chấp nhận hoặc từ chối báo giá.',
  ACCEPTED: 'Chuyển báo giá thành đơn hàng xuất để tiếp tục xử lý.',
  REJECTED: 'Báo giá đã bị từ chối; tạo báo giá mới nếu khách đổi yêu cầu.',
  EXPIRED: 'Báo giá đã hết hạn; tạo báo giá mới trước khi chuyển đơn.',
};

function getQuoteNextStep(quote?: Pick<Quote, 'status' | 'is_converted' | 'converted_order_code'> | null): string {
  if (!quote) return 'Chọn một báo giá để xem bước xử lý tiếp theo.';
  if (quote.is_converted) {
    return `Đã chuyển thành đơn hàng ${quote.converted_order_code || ''}. Tiếp tục xử lý ở màn Đơn hàng xuất.`;
  }
  return quoteNextSteps[quote.status] ?? 'Kiểm tra trạng thái báo giá trước khi thao tác tiếp.';
}

function getQuoteActionDisabledReason(quote: Quote, action: 'edit' | 'send' | 'accept' | 'reject' | 'convert' | 'delete'): string {
  if (action === 'edit') return quote.status === 'DRAFT' ? '' : 'Chỉ sửa được báo giá Nháp.';
  if (action === 'send') return quote.status === 'DRAFT' ? '' : 'Chỉ báo giá Nháp mới gửi được.';
  if (action === 'accept') return quote.status === 'SENT' ? '' : 'Chỉ báo giá Đã gửi mới chấp nhận được.';
  if (action === 'reject') return quote.status === 'SENT' ? '' : 'Chỉ báo giá Đã gửi mới từ chối được.';
  if (action === 'convert') {
    if (quote.is_converted) return 'Báo giá đã chuyển thành đơn hàng; mở đơn đã tạo thay vì chuyển lại.';
    return quote.status === 'ACCEPTED' ? '' : 'Chỉ báo giá Đã chấp nhận mới chuyển thành đơn hàng.';
  }
  if (action === 'delete') return quote.status === 'DRAFT' ? '' : 'Chỉ xóa được báo giá Nháp.';
  return '';
}

const QuoteList: React.FC = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<QuoteStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formOpen, setFormOpen] = useState(false);
  const [editQuote, setEditQuote] = useState<Quote | null>(null);
  const [detailQuote, setDetailQuote] = useState<Quote | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canManageQuotes = canSubmitSalesOrders();

  const params = {
    search: search || undefined,
    status: status || undefined,
    page,
    page_size: pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['quotes', params],
    queryFn: () => salesApi.getQuotes(params),
  });

  const customersQuery = useQuery({
    queryKey: ['quote-customers'],
    queryFn: () => customersApi.getCustomers({ page_size: 1000 }),
  });

  const refreshQuotes = () => {
    queryClient.invalidateQueries({ queryKey: ['quotes'] });
    queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: Partial<Quote> & { quote_date: string }) => salesApi.createQuote(payload),
    onSuccess: () => {
      message.success('Tạo báo giá thành công');
      form.resetFields();
      setFormOpen(false);
      setEditQuote(null);
      refreshQuotes();
    },
    onError: (error) => message.error(getToastMessage(error, 'Tạo báo giá thất bại')),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<Quote>) => salesApi.updateQuote(editQuote!.id, payload),
    onSuccess: () => {
      message.success('Cập nhật báo giá thành công');
      form.resetFields();
      setFormOpen(false);
      setEditQuote(null);
      refreshQuotes();
    },
    onError: (error) => message.error(getToastMessage(error, 'Cập nhật báo giá thất bại')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => salesApi.deleteQuote(id),
    onSuccess: () => {
      message.success('Xóa báo giá thành công');
      refreshQuotes();
    },
    onError: (error) => message.error(getToastMessage(error, 'Xóa báo giá thất bại')),
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => salesApi.sendQuote(id),
    onSuccess: () => {
      message.success('Đã gửi báo giá');
      refreshQuotes();
    },
    onError: (error) => message.error(getToastMessage(error, 'Gửi báo giá thất bại')),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: number) => salesApi.acceptQuote(id),
    onSuccess: () => {
      message.success('Đã chấp nhận báo giá');
      refreshQuotes();
    },
    onError: (error) => message.error(getToastMessage(error, 'Chấp nhận báo giá thất bại')),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => salesApi.rejectQuote(id, reason),
    onSuccess: () => {
      message.success('Đã từ chối báo giá');
      refreshQuotes();
    },
    onError: (error) => message.error(getToastMessage(error, 'Từ chối báo giá thất bại')),
  });

  const convertMutation = useMutation({
    mutationFn: (id: number) => salesApi.convertQuoteToOrder(id),
    onSuccess: (result) => {
      message.success(`Đã chuyển báo giá thành đơn bán ${result.order_code}`);
      refreshQuotes();
      navigate(`/sales-orders?focus_id=${result.order_id}`);
    },
    onError: (error) => message.error(getToastMessage(error, 'Chuyển báo giá thất bại')),
  });

  const handleExportCSV = () => {
    if (!data?.results) return;
    const csvData = data.results.map((quote) => ({
      'Mã báo giá': quote.code,
      'Khách hàng': quote.customer_name ?? '',
      'Ngày báo giá': dayjs(quote.quote_date).format('DD/MM/YYYY'),
      'Hiệu lực đến': quote.valid_until ? dayjs(quote.valid_until).format('DD/MM/YYYY') : '',
      'Trạng thái': statusLabel[quote.status],
      'Tổng tiền': Number(quote.total || 0).toLocaleString('vi-VN'),
      'Ghi chú': quote.notes ?? '',
    }));
    downloadCSV(csvData, 'bao-gia');
  };

  const handlePdfDownload = async (id: number, code: string) => {
    try {
      const pdfBlob = await salesApi.downloadQuotePdf(id);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(pdfBlob);
      link.download = `BaoGia_${code}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      message.success('Tải PDF thành công');
    } catch (error) {
      message.error(getToastMessage(error, 'Tải PDF thất bại'));
    }
  };

  const handleSubmitForm = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        customer: values.customer,
        quote_date: values.quote_date.format('YYYY-MM-DD'),
        valid_until: values.valid_until ? values.valid_until.format('YYYY-MM-DD') : null,
        reference: values.reference || '',
        notes: values.notes || '',
      };
      if (editQuote) {
        updateMutation.mutate(payload);
      } else {
        createMutation.mutate(payload);
      }
    } catch {
      message.error('Vui lòng kiểm tra lại form');
    }
  };

  const rows = data?.results ?? [];
  const totalAmount = rows.reduce((sum, q) => sum + Number(q.total || 0), 0);
  const draftCount = rows.filter((q) => q.status === 'DRAFT').length;
  const sentCount = rows.filter((q) => q.status === 'SENT').length;
  const acceptedCount = rows.filter((q) => q.status === 'ACCEPTED').length;
  const convertedCount = rows.filter((q) => q.is_converted).length;

  const columns = [
    {
      title: 'Mã báo giá',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      sorter: (a: Quote, b: Quote) => a.code.localeCompare(b.code),
    },
    {
      title: 'Khách hàng',
      dataIndex: 'customer_name',
      key: 'customer_name',
      width: 180,
    },
    {
      title: 'Ngày',
      dataIndex: 'quote_date',
      key: 'quote_date',
      width: 110,
      render: (value: string) => dayjs(value).format('DD/MM/YYYY'),
    },
    {
      title: 'Hiệu lực đến',
      dataIndex: 'valid_until',
      key: 'valid_until',
      width: 120,
      render: (value: string | null) => value ? dayjs(value).format('DD/MM/YYYY') : '-',
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 260,
      render: (value: QuoteStatus, row: Quote) => (
        <div>
          <Tag color={statusColor[value]}>{statusLabel[value]}</Tag>
          <div
            data-testid={`quote-next-step-${row.id}`}
            style={{ marginTop: 4, color: '#595959', fontSize: 12, lineHeight: 1.45 }}
          >
            {getQuoteNextStep(row)}
          </div>
        </div>
      ),
    },
    {
      title: 'Tổng tiền',
      dataIndex: 'total',
      key: 'total',
      width: 140,
      align: 'right' as const,
      render: (value: string) => Number(value || 0).toLocaleString('vi-VN'),
    },
    {
      title: 'Chuyển SO',
      key: 'converted',
      width: 190,
      render: (_: unknown, row: Quote) => (
        <div data-testid={`quote-converted-status-${row.id}`}>
          {row.is_converted ? (
            <>
              <Tag color="green">Đã chuyển</Tag>
              <Button
                size="small"
                type="link"
                style={{ paddingInline: 0 }}
                onClick={() => row.converted_order_id && navigate(`/sales-orders?focus_id=${row.converted_order_id}`)}
              >
                {row.converted_order_code || 'Mở SO'}
              </Button>
            </>
          ) : row.status === 'ACCEPTED' ? (
            <Tag color="orange">Sẵn sàng chuyển</Tag>
          ) : (
            <Tag>Chưa chuyển</Tag>
          )}
        </div>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 360,
      render: (_: unknown, row: Quote) => {
        const editReason = getQuoteActionDisabledReason(row, 'edit');
        const sendReason = getQuoteActionDisabledReason(row, 'send');
        const acceptReason = getQuoteActionDisabledReason(row, 'accept');
        const rejectReason = getQuoteActionDisabledReason(row, 'reject');
        const convertReason = getQuoteActionDisabledReason(row, 'convert');
        const deleteReason = getQuoteActionDisabledReason(row, 'delete');

        return (
        <Space wrap size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailQuote(row)}>
            Xem
          </Button>
          {canManageQuotes ? (
            <Button
              size="small"
              disabled={Boolean(editReason)}
              title={editReason || 'Sửa báo giá nháp'}
              onClick={() => {
                setEditQuote(row);
                form.setFieldsValue({
                  customer: row.customer,
                  quote_date: dayjs(row.quote_date),
                  valid_until: row.valid_until ? dayjs(row.valid_until) : null,
                  reference: row.reference,
                  notes: row.notes,
                });
                setFormOpen(true);
              }}
            >
              Sửa
            </Button>
          ) : null}
          {canManageQuotes && row.status === 'DRAFT' && (
            <>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={Boolean(deleteReason)}
                title={deleteReason || 'Xóa báo giá nháp'}
                onClick={() => {
                  Modal.confirm({
                    title: 'Xóa báo giá',
                    content: `Xóa báo giá ${row.code}?`,
                    onOk: () => deleteMutation.mutate(row.id),
                  });
                }}
              >
                Xóa
              </Button>
              <Button
                size="small"
                type="primary"
                disabled={Boolean(sendReason)}
                title={sendReason || 'Gửi báo giá cho khách hàng'}
                onClick={() => sendMutation.mutate(row.id)}
              >
                Gửi
              </Button>
            </>
          )}
          {canManageQuotes && row.status === 'SENT' && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                disabled={Boolean(acceptReason)}
                title={acceptReason || 'Đánh dấu khách đã chấp nhận báo giá'}
                onClick={() => acceptMutation.mutate(row.id)}
              >
                Chấp nhận
              </Button>
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                disabled={Boolean(rejectReason)}
                title={rejectReason || 'Từ chối báo giá với lý do rõ ràng'}
                onClick={() => {
                  Modal.confirm({
                    title: 'Từ chối báo giá',
                    content: `Từ chối báo giá ${row.code}?`,
                    onOk: () => rejectMutation.mutate({ id: row.id, reason: 'Khách hàng từ chối' }),
                  });
                }}
              >
                Từ chối
              </Button>
            </>
          )}
          {row.status === 'ACCEPTED' && (
            row.is_converted ? (
              <Button
                size="small"
                type="primary"
                icon={<EyeOutlined />}
                data-testid={`quote-open-converted-order-${row.id}`}
                disabled={!row.converted_order_id}
                title="Mở đơn hàng đã chuyển từ báo giá này"
                onClick={() => row.converted_order_id && navigate(`/sales-orders?focus_id=${row.converted_order_id}`)}
              >
                Mở SO
              </Button>
            ) : canManageQuotes ? (
              <Button
                size="small"
                type="primary"
                icon={<SwapOutlined />}
                disabled={Boolean(convertReason)}
                title={convertReason || 'Tạo đơn hàng xuất từ báo giá đã chấp nhận'}
                onClick={() => convertMutation.mutate(row.id)}
              >
                Chuyển đơn
              </Button>
            ) : null
          )}
          {canManageQuotes ? (
            <Button size="small" icon={<FileTextOutlined />} onClick={() => handlePdfDownload(row.id, row.code)}>
              PDF
            </Button>
          ) : null}
        </Space>
        );
      },
    },
  ];

  if (isLoading && !data) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <div style={{ padding: '20px' }}>
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col xs={24} sm={12} lg={5}>
            <Statistic title="Tổng tiền" value={totalAmount} prefix="₫" formatter={(value) => (Number(value) || 0).toLocaleString('vi-VN')} />
          </Col>
          <Col xs={24} sm={12} lg={4}>
            <Statistic title="Nháp" value={draftCount} valueStyle={{ color: '#faad14' }} />
          </Col>
          <Col xs={24} sm={12} lg={4}>
            <Statistic title="Đã gửi" value={sentCount} valueStyle={{ color: '#1677ff' }} />
          </Col>
          <Col xs={24} sm={12} lg={5}>
            <Statistic title="Đã chấp nhận" value={acceptedCount} valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Statistic title="Đã chuyển SO" value={convertedCount} valueStyle={{ color: '#13c2c2' }} />
          </Col>
        </Row>
      </Card>

      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Input
          placeholder="Tìm mã báo giá..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ width: '220px' }}
        />
        <Select
          placeholder="Trạng thái"
          value={status || undefined}
          onChange={(value) => {
            setStatus(value || '');
            setPage(1);
          }}
          allowClear
          style={{ width: '180px' }}
          options={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))}
        />
        {canManageQuotes ? (
          <>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditQuote(null);
                form.resetFields();
                setFormOpen(true);
              }}
            >
              Tạo mới
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
              Xuất CSV
            </Button>
          </>
        ) : null}
      </div>

      <Table
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        locale={{ emptyText: 'Chưa có báo giá phù hợp. Kiểm tra bộ lọc hoặc tạo báo giá mới cho khách hàng.' }}
        pagination={{
          current: page,
          pageSize,
          total: data?.count,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
        }}
        rowKey="id"
        scroll={{ x: 1400 }}
      />

      <Modal
        title={editQuote ? 'Sửa báo giá' : 'Tạo báo giá mới'}
        open={formOpen}
        onCancel={() => {
          setFormOpen(false);
          setEditQuote(null);
          form.resetFields();
        }}
        onOk={handleSubmitForm}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Khách hàng" name="customer" rules={[{ required: true, message: 'Vui lòng chọn khách hàng' }]}>
            <Select
              placeholder="Chọn khách hàng"
              loading={customersQuery.isLoading}
              options={(customersQuery.data?.results ?? []).map((customer) => ({
                value: customer.id,
                label: `${customer.code} - ${customer.name}`,
              }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item label="Ngày báo giá" name="quote_date" rules={[{ required: true, message: 'Vui lòng chọn ngày báo giá' }]}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="Hiệu lực đến" name="valid_until">
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="Tham chiếu" name="reference">
            <Input />
          </Form.Item>
          <Form.Item label="Ghi chú" name="notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Chi tiết báo giá" open={!!detailQuote} onCancel={() => setDetailQuote(null)} footer={null} width={700}>
        {detailQuote && (
          <div>
            <Alert
              showIcon
              type={detailQuote.status === 'ACCEPTED' ? 'success' : detailQuote.status === 'REJECTED' ? 'warning' : 'info'}
              style={{ marginBottom: 12 }}
              message="Việc cần làm tiếp"
              description={<span data-testid="quote-detail-next-step">{getQuoteNextStep(detailQuote)}</span>}
            />
            {detailQuote.is_converted ? (
              <Alert
                showIcon
                type="success"
                style={{ marginBottom: 12 }}
                message="Đã chuyển đơn hàng"
                description={
                  <Space wrap>
                    <span data-testid="quote-detail-converted-order">
                      {detailQuote.converted_order_code || 'Đơn hàng đã tạo'}
                    </span>
                    <Button
                      size="small"
                      type="link"
                      disabled={!detailQuote.converted_order_id}
                      onClick={() => detailQuote.converted_order_id && navigate(`/sales-orders?focus_id=${detailQuote.converted_order_id}`)}
                    >
                      Mở đơn hàng
                    </Button>
                  </Space>
                }
              />
            ) : null}
            <p><strong>Mã:</strong> {detailQuote.code}</p>
            <p><strong>Khách hàng:</strong> {detailQuote.customer_name ?? '-'}</p>
            <p><strong>Ngày báo giá:</strong> {dayjs(detailQuote.quote_date).format('DD/MM/YYYY')}</p>
            <p><strong>Hiệu lực đến:</strong> {detailQuote.valid_until ? dayjs(detailQuote.valid_until).format('DD/MM/YYYY') : '-'}</p>
            <p><strong>Tổng tiền:</strong> {Number(detailQuote.total || 0).toLocaleString('vi-VN')} đ</p>
            <p><strong>Trạng thái:</strong> <Tag color={statusColor[detailQuote.status]}>{statusLabel[detailQuote.status]}</Tag></p>
            {detailQuote.reference ? <p><strong>Tham chiếu:</strong> {detailQuote.reference}</p> : null}
            {detailQuote.notes ? <p><strong>Ghi chú:</strong> {detailQuote.notes}</p> : null}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default QuoteList;
