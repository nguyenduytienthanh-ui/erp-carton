import React, { useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Skeleton, Empty, message, Tag, Row, Col, Card, Statistic, Form, InputNumber, DatePicker,
} from 'antd';
import { EyeOutlined, DeleteOutlined, DownloadOutlined, PlusOutlined, FileTextOutlined, ConvertOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { quotesApi } from '../../api/quotes';
import { Quote, QuoteStatus } from '../../types/quotes';
import { getToastMessage } from '../../utils/authz';
import { downloadCSV } from '../../utils/csvExport';

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

  const params = {
    search: search || undefined,
    status: status || undefined,
    page,
    page_size: pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['quotes', params],
    queryFn: () => quotesApi.getQuotes(params),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => quotesApi.createQuote(data),
    onSuccess: () => {
      message.success('Tạo báo giá thành công');
      form.resetFields();
      setFormOpen(false);
      setEditQuote(null);
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Tạo báo giá thất bại'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => quotesApi.updateQuote(editQuote!.id!, data),
    onSuccess: () => {
      message.success('Cập nhật báo giá thành công');
      form.resetFields();
      setFormOpen(false);
      setEditQuote(null);
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Cập nhật báo giá thất bại'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => quotesApi.deleteQuote(id),
    onSuccess: () => {
      message.success('Xóa báo giá thành công');
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Xóa báo giá thất bại'));
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => quotesApi.submitQuote(id),
    onSuccess: () => {
      message.success('Gửi báo giá thành công');
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Gửi báo giá thất bại'));
    },
  });

  const convertMutation = useMutation({
    mutationFn: (id: number) => quotesApi.convertToOrder(id),
    onSuccess: () => {
      message.success('Chuyển báo giá thành đơn bán thành công');
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Chuyển báo giá thất bại'));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => quotesApi.rejectQuote(id, reason),
    onSuccess: () => {
      message.success('Từ chối báo giá thành công');
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Từ chối báo giá thất bại'));
    },
  });

  const statusColor: Record<QuoteStatus, string> = {
    DRAFT: 'default',
    SUBMITTED: 'processing',
    APPROVED: 'success',
    REJECTED: 'error',
    CONVERTED: 'blue',
    EXPIRED: 'default',
    CANCELLED: 'default',
  };

  const statusLabel: Record<QuoteStatus, string> = {
    DRAFT: 'Nháp',
    SUBMITTED: 'Chờ xét duyệt',
    APPROVED: 'Đã phê duyệt',
    REJECTED: 'Từ chối',
    CONVERTED: 'Đã chuyển đơn',
    EXPIRED: 'Hết hạn',
    CANCELLED: 'Đã hủy',
  };

  const handleExportCSV = () => {
    if (data?.results) {
      const csvData = data.results.map((quote: Quote) => ({
        'Mã báo giá': quote.code,
        'Khách hàng': quote.customer_name,
        'Ngày': dayjs(quote.quote_date).format('DD/MM/YYYY'),
        'Hết hạn': dayjs(quote.expiry_date).format('DD/MM/YYYY'),
        'Trạng thái': statusLabel[quote.status],
        'Tổng tiền': quote.total,
        'Ghi chú': quote.notes,
      }));
      downloadCSV(csvData, 'bao-gia');
    }
  };

  const handlePdfDownload = async (id: number, code: string) => {
    try {
      const pdfBlob = await quotesApi.getPdf(id);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(pdfBlob);
      link.download = `BaoGia_${code}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      message.success('Tải PDF thành công');
    } catch (error) {
      message.error('Tải PDF thất bại');
    }
  };

  const handleSubmitForm = async () => {
    try {
      const values = await form.validateFields();
      if (editQuote) {
        updateMutation.mutate(values);
      } else {
        createMutation.mutate(values);
      }
    } catch {
      message.error('Vui lòng kiểm tra lại form');
    }
  };

  const totalAmount = data?.results?.reduce((sum: number, q: Quote) => sum + (q.total || 0), 0) || 0;
  const draftCount = data?.results?.filter((q: Quote) => q.status === 'DRAFT').length || 0;
  const submittedCount = data?.results?.filter((q: Quote) => q.status === 'SUBMITTED').length || 0;
  const convertedCount = data?.results?.filter((q: Quote) => q.status === 'CONVERTED').length || 0;

  const columns = [
    {
      title: 'Mã báo giá',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      sorter: (a: Quote, b: Quote) => (a.code || '').localeCompare(b.code || ''),
    },
    {
      title: 'Khách hàng',
      dataIndex: 'customer_name',
      key: 'customer_name',
      width: 150,
    },
    {
      title: 'Ngày',
      dataIndex: 'quote_date',
      key: 'quote_date',
      width: 100,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Hết hạn',
      dataIndex: 'expiry_date',
      key: 'expiry_date',
      width: 100,
      render: (date: string) => {
        const isExpired = dayjs(date).isBefore(dayjs());
        return (
          <span style={{ color: isExpired ? '#ff4d4f' : undefined }}>
            {dayjs(date).format('DD/MM/YYYY')}
          </span>
        );
      },
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: QuoteStatus) => (
        <Tag color={statusColor[s]}>{statusLabel[s]}</Tag>
      ),
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
      title: 'Hành động',
      key: 'actions',
      width: 250,
      render: (_, row: Quote) => (
        <Space wrap size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailQuote(row)}>
            Xem
          </Button>
          <Button
            size="small"
            disabled={row.status !== 'DRAFT'}
            onClick={() => {
              setEditQuote(row);
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
                  title: 'Xóa báo giá',
                  content: `Xóa báo giá ${row.code}?`,
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
          {row.status === 'APPROVED' && (
            <Button
              size="small"
              type="primary"
              icon={<ConvertOutlined />}
              onClick={() => convertMutation.mutate(row.id!)}
            >
              Chuyển đơn
            </Button>
          )}
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => handlePdfDownload(row.id!, row.code)}
          >
            PDF
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
      {/* Thống kê */}
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={6}>
            <Statistic title="Tổng tiền" value={totalAmount} prefix="₫" formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')} />
          </Col>
          <Col span={6}>
            <Statistic title="Nháp" value={draftCount} valueStyle={{ color: '#faad14' }} />
          </Col>
          <Col span={6}>
            <Statistic title="Chờ xét duyệt" value={submittedCount} valueStyle={{ color: '#1677ff' }} />
          </Col>
          <Col span={6}>
            <Statistic title="Đã chuyển đơn" value={convertedCount} valueStyle={{ color: '#52c41a' }} />
          </Col>
        </Row>
      </Card>

      {/* Bộ lọc */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Input
          placeholder="Tìm mã báo giá, khách hàng..."
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
            { label: 'Chờ xét duyệt', value: 'SUBMITTED' },
            { label: 'Đã phê duyệt', value: 'APPROVED' },
            { label: 'Từ chối', value: 'REJECTED' },
            { label: 'Đã chuyển đơn', value: 'CONVERTED' },
          ]}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditQuote(null); form.resetFields(); setFormOpen(true); }}>
          Tạo mới
        </Button>
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
          pageSizeOptions: ['10', '20', '50'],
        }}
        rowKey="id"
        scroll={{ x: 1400 }}
      />

      {/* Modal Tạo/Sửa */}
      <Modal
        title={editQuote ? 'Sửa báo giá' : 'Tạo báo giá mới'}
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditQuote(null); form.resetFields(); }}
        onOk={handleSubmitForm}
        loading={createMutation.isPending || updateMutation.isPending}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Khách hàng" name="customer_id" rules={[{ required: true }]}>
            <Select placeholder="Chọn khách hàng" />
          </Form.Item>
          <Form.Item label="Ngày báo giá" name="quote_date" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="Hết hạn" name="expiry_date" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="Ghi chú" name="notes">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Chi tiết */}
      <Modal title="Chi tiết báo giá" open={!!detailQuote} onCancel={() => setDetailQuote(null)} footer={null} width={700}>
        {detailQuote && (
          <div>
            <p><strong>Mã:</strong> {detailQuote.code}</p>
            <p><strong>Khách hàng:</strong> {detailQuote.customer_name}</p>
            <p><strong>Tổng tiền:</strong> {detailQuote.total?.toLocaleString('vi-VN')} đ</p>
            <p><strong>Trạng thái:</strong> <Tag color={statusColor[detailQuote.status]}>{statusLabel[detailQuote.status]}</Tag></p>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default QuoteList;
