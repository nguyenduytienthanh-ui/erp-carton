import React, { useState, useMemo } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Skeleton, Empty, message, Tag, Row, Col, Card, Statistic, Form, DatePicker,
} from 'antd';
import { EyeOutlined, PlusOutlined, FileTextOutlined, DownloadOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';

import { reportsApi } from '../../api/reports';
import { downloadCSV } from '../../utils/csvExport';

const ReportsCenter: React.FC = () => {
  const [search, setSearch] = useState('');
  const [reportType, setReportType] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: reportsList = [], isLoading } = useQuery({
    queryKey: ['reports-custom'],
    queryFn: () => reportsApi.getCustomReports(),
  });

  const generateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => reportsApi.generateCustomReport(payload),
    onSuccess: (result) => {
      message.success('Đã chạy báo cáo');
      setFormOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['reports-custom'] });
      setSelectedReport(result);
      setDetailOpen(true);
    },
    onError: (error) => {
      message.error(String((error as Error)?.message || 'Tạo báo cáo thất bại'));
    },
  });

  const runQuickReport = async (reportCode: string) => {
    try {
      const result = await reportsApi.generateCustomReport({ report_code: reportCode });
      setSelectedReport(result);
      setDetailOpen(true);
    } catch (error) {
      message.error(String((error as Error)?.message || 'Chạy báo cáo thất bại'));
    }
  };

  const filteredResults = useMemo(() => {
    let list = [...reportsList];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((r: any) => (r.code || '').toLowerCase().includes(s) || (r.name || '').toLowerCase().includes(s));
    }
    if (reportType) list = list.filter((r: any) => r.report_type === reportType);
    if (status) list = list.filter((r: any) => r.status === status);
    return list;
  }, [reportsList, search, reportType, status]);

  const paginatedResults = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredResults.slice(start, start + pageSize);
  }, [filteredResults, page, pageSize]);

  const statusLabel: Record<string, string> = {
    DRAFT: 'Nháp',
    GENERATED: 'Đã tạo',
    FINALIZED: 'Hoàn tất',
    ARCHIVED: 'Lưu trữ',
  };

  const statusColor: Record<string, string> = {
    DRAFT: 'default',
    GENERATED: 'processing',
    FINALIZED: 'success',
    ARCHIVED: 'default',
  };

  const reportTypeLabel: Record<string, string> = {
    SALES: 'Bán hàng',
    PURCHASE: 'Mua hàng',
    INVENTORY: 'Tồn kho',
    PRODUCTION: 'Sản xuất',
    FINANCIAL: 'Tài chính',
    SHIPPING: 'Vận chuyển',
    WORKFORCE: 'Nhân sự',
  };

  const handleExportCSV = () => {
    if (filteredResults.length) {
      const csvData = filteredResults.map((report: any) => ({
        'Mã': report.code,
        'Tên báo cáo': report.name,
        'Loại': reportTypeLabel[report.report_type] || report.report_type,
        'Từ ngày': report.period_start ? dayjs(report.period_start).format('DD/MM/YYYY') : '',
        'Đến ngày': report.period_end ? dayjs(report.period_end).format('DD/MM/YYYY') : '',
        'Trạng thái': statusLabel[report.status] || report.status,
        'Tạo bởi': report.generated_by_name,
      }));
      downloadCSV(csvData, 'bao-cao');
    } else {
      message.warning('Không có dữ liệu để xuất');
    }
  };

  const columns = [
    {
      title: 'Mã',
      dataIndex: 'code',
      key: 'code',
      width: 100,
      sorter: (a: any, b: any) => (a.code || '').localeCompare(b.code || ''),
    },
    {
      title: 'Tên báo cáo',
      dataIndex: 'name',
      key: 'name',
      width: 200,
    },
    {
      title: 'Loại',
      dataIndex: 'report_type',
      key: 'report_type',
      width: 100,
      render: (type: string) => reportTypeLabel[type] || type,
    },
    {
      title: 'Thời kỳ',
      key: 'period',
      width: 150,
      render: (_: unknown, row: any) =>
        row.period_start && row.period_end
          ? `${dayjs(row.period_start).format('DD/MM')} - ${dayjs(row.period_end).format('DD/MM/YYYY')}`
          : '—',
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => (
        <Tag color={statusColor[s]}>{statusLabel[s]}</Tag>
      ),
    },
    {
      title: 'Tạo bởi',
      dataIndex: 'generated_by_name',
      key: 'generated_by_name',
      width: 120,
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 180,
      render: (_: unknown, row: any) => (
        <Space wrap size="small">
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => { setSelectedReport(row); setDetailOpen(true); }}
          >
            Xem
          </Button>
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => reportsApi.generateCustomReport({ report_code: row.code }).then((result) => {
              setSelectedReport(result);
              setDetailOpen(true);
            })}
          >
            PDF
          </Button>
        </Space>
        ),
      },
    ];

  const draftCount = filteredResults.filter((r: any) => r.status === 'DRAFT').length;
  const generatedCount = filteredResults.filter((r: any) => r.status === 'GENERATED').length;
  const finalizedCount = filteredResults.filter((r: any) => r.status === 'FINALIZED').length;

  return (
    <div style={{ padding: '20px' }}>
      {/* Báo cáo nhanh - liên kết tới các trang báo cáo có sẵn */}
      <Card title="Báo cáo nhanh" style={{ marginBottom: '20px' }}>
        <Row gutter={[16, 16]}>
          <Col>
            <Link to="/finance-summary">
              <Button icon={<LinkOutlined />}>Báo cáo tài chính (Thu chi)</Button>
            </Link>
          </Col>
          <Col>
            <Link to="/cash-book">
              <Button icon={<LinkOutlined />}>Sổ quỹ</Button>
            </Link>
          </Col>
          <Col>
            <Link to="/receivables">
              <Button icon={<LinkOutlined />}>Công nợ phải thu</Button>
            </Link>
          </Col>
          <Col>
            <Link to="/payables">
              <Button icon={<LinkOutlined />}>Công nợ phải trả</Button>
            </Link>
          </Col>
          <Col>
            <Link to="/aging-analysis">
              <Button icon={<LinkOutlined />}>Phân tích quá hạn</Button>
            </Link>
          </Col>
          <Col>
            <Button icon={<FileTextOutlined />} onClick={() => void runQuickReport('PRODUCTION_COSTING')}>
              Giá vốn sau sản xuất
            </Button>
          </Col>
          <Col>
            <Button icon={<FileTextOutlined />} onClick={() => void runQuickReport('PROFIT_REPORT')}>
              Báo cáo lợi nhuận
            </Button>
          </Col>
          <Col>
            <Button icon={<FileTextOutlined />} onClick={() => void runQuickReport('EMPLOYEE_PERFORMANCE')}>
              KPI / định mức nhân viên
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Thống kê báo cáo tùy chỉnh */}
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={8}>
            <Statistic title="Nháp" value={draftCount} valueStyle={{ color: '#faad14' }} />
          </Col>
          <Col span={8}>
            <Statistic title="Đã tạo" value={generatedCount} valueStyle={{ color: '#1677ff' }} />
          </Col>
          <Col span={8}>
            <Statistic title="Hoàn tất" value={finalizedCount} valueStyle={{ color: '#52c41a' }} />
          </Col>
        </Row>
      </Card>

      {/* Bộ lọc */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Input
          placeholder="Tìm mã hoặc tên báo cáo..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ width: '220px' }}
        />
        <Select
          placeholder="Loại báo cáo"
          value={reportType}
          onChange={(val) => { setReportType(val); setPage(1); }}
          allowClear
          style={{ width: '150px' }}
          options={[
            { label: 'Bán hàng', value: 'SALES' },
            { label: 'Mua hàng', value: 'PURCHASE' },
            { label: 'Tồn kho', value: 'INVENTORY' },
            { label: 'Sản xuất', value: 'PRODUCTION' },
            { label: 'Tài chính', value: 'FINANCIAL' },
            { label: 'Nhân sự', value: 'WORKFORCE' },
          ]}
        />
        <Select
          placeholder="Trạng thái"
          value={status}
          onChange={(val) => { setStatus(val); setPage(1); }}
          allowClear
          style={{ width: '150px' }}
          options={[
            { label: 'Nháp', value: 'DRAFT' },
            { label: 'Đã tạo', value: 'GENERATED' },
            { label: 'Hoàn tất', value: 'FINALIZED' },
          ]}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormOpen(true)}>
          Tạo mới
        </Button>
        <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
                  Xuất CSV
                </Button>
      </div>

      {/* Bảng danh sách báo cáo tùy chỉnh */}
      {isLoading ? (
        <Skeleton active />
      ) : (
        <Table
          columns={columns}
          dataSource={paginatedResults}
          pagination={{
            current: page,
            pageSize,
            total: filteredResults.length,
            onChange: (p, ps) => { setPage(p); setPageSize(ps ?? 20); },
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
          }}
          rowKey={(r) => r.id ?? r.code ?? String(Math.random())}
          scroll={{ x: 1200 }}
          locale={{ emptyText: <Empty description="Chưa có báo cáo tùy chỉnh" /> }}
        />
      )}

      {/* Modal Chi tiết */}
      <Modal
        title="Chi tiết báo cáo"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={700}
      >
        {selectedReport && (
          <div>
            <p><strong>Mã:</strong> {selectedReport.code || selectedReport.report_code || '-'}</p>
            <p><strong>Tên:</strong> {selectedReport.name || selectedReport.report_name || '-'}</p>
            <p><strong>Loại:</strong> {reportTypeLabel[selectedReport.report_type] || selectedReport.report_type || '-'}</p>
            {selectedReport.period_start ? <p><strong>Từ ngày:</strong> {dayjs(selectedReport.period_start).format('DD/MM/YYYY')}</p> : null}
            {selectedReport.period_end ? <p><strong>Đến ngày:</strong> {dayjs(selectedReport.period_end).format('DD/MM/YYYY')}</p> : null}
            {selectedReport.status ? <p><strong>Trạng thái:</strong> <Tag color={statusColor[selectedReport.status] || 'default'}>{statusLabel[selectedReport.status] || selectedReport.status}</Tag></p> : null}
            <p><strong>Tạo bởi:</strong> {selectedReport.generated_by_name}</p>
            {selectedReport.description && <p><strong>Mô tả:</strong> {selectedReport.description}</p>}
            {'summary' in selectedReport ? (
              <pre style={{ background: '#fafafa', padding: 12, borderRadius: 8, overflowX: 'auto' }}>
                {JSON.stringify(selectedReport, null, 2)}
              </pre>
            ) : null}
          </div>
        )}
      </Modal>

      {/* Modal Tạo báo cáo */}
      <Modal
        title="Tạo báo cáo mới"
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        confirmLoading={generateMutation.isPending}
        onOk={async () => {
          const values = await form.validateFields();
          await generateMutation.mutateAsync({
            report_code: String(values.name || values.report_type || 'CUSTOM').trim().toUpperCase().replace(/\s+/g, '_'),
            report_name: values.name,
            report_type: values.report_type,
            period_start: values.period?.[0]?.format('YYYY-MM-DD'),
            period_end: values.period?.[1]?.format('YYYY-MM-DD'),
          });
        }}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Loại báo cáo" name="report_type" rules={[{ required: true }]}>
            <Select
              options={[
                { label: 'Bán hàng', value: 'SALES' },
                { label: 'Mua hàng', value: 'PURCHASE' },
                { label: 'Tồn kho', value: 'INVENTORY' },
                { label: 'Sản xuất', value: 'PRODUCTION' },
                { label: 'Tài chính', value: 'FINANCIAL' },
                { label: 'Nhân sự', value: 'WORKFORCE' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Tên báo cáo" name="name" rules={[{ required: true }]}>
            <Input placeholder="Tên báo cáo" />
          </Form.Item>
          <Form.Item label="Thời kỳ" name="period" rules={[{ required: true, message: 'Chọn thời kỳ báo cáo' }]}>
            <DatePicker.RangePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ReportsCenter;
