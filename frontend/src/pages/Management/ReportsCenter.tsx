import React, { useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Skeleton, Empty, message, Tag, Row, Col, Card, Statistic, Form, DatePicker,
} from 'antd';
import { EyeOutlined, DeleteOutlined, PlusOutlined, FileTextOutlined, DownloadOutlined, CheckOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { downloadCSV } from '../../utils/csvExport';
import { getToastMessage } from '../../utils/authz';

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

  // Mock data - replace with actual API
  const mockData = {
    results: [
      {
        id: 1,
        code: 'BAN01',
        name: 'Báo cáo bán hàng tháng 3',
        description: 'Báo cáo bán hàng và doanh thu tháng 3/2026',
        report_type: 'SALES',
        period_start: '2026-03-01',
        period_end: '2026-03-31',
        status: 'FINALIZED',
        generated_at: '2026-03-10 10:30:00',
        finalized_at: '2026-03-10 11:00:00',
        generated_by_name: 'Nguyễn Văn A',
        finalized_by_name: 'Trần Văn B',
      },
      {
        id: 2,
        code: 'MUO01',
        name: 'Báo cáo mua hàng tháng 3',
        description: 'Báo cáo mua hàng và chi phí tháng 3/2026',
        report_type: 'PURCHASE',
        period_start: '2026-03-01',
        period_end: '2026-03-31',
        status: 'GENERATED',
        generated_at: '2026-03-10 10:35:00',
        generated_by_name: 'Nguyễn Văn A',
      },
      {
        id: 3,
        code: 'KHO01',
        name: 'Báo cáo tồn kho',
        description: 'Báo cáo tồn kho hiện tại',
        report_type: 'INVENTORY',
        period_start: '2026-03-10',
        period_end: '2026-03-10',
        status: 'DRAFT',
        generated_by_name: 'Nguyễn Văn A',
      },
    ],
    count: 3,
  };

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
  };

  const handleExportCSV = () => {
    if (mockData?.results) {
      const csvData = mockData.results.map((report: any) => ({
        'Mã': report.code,
        'Tên báo cáo': report.name,
        'Loại': reportTypeLabel[report.report_type],
        'Từ ngày': dayjs(report.period_start).format('DD/MM/YYYY'),
        'Đến ngày': dayjs(report.period_end).format('DD/MM/YYYY'),
        'Trạng thái': statusLabel[report.status],
        'Tạo bởi': report.generated_by_name,
      }));
      downloadCSV(csvData, 'bao-cao');
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
      render: (_, row: any) => (
        <span>
          {dayjs(row.period_start).format('DD/MM')} - {dayjs(row.period_end).format('DD/MM/YYYY')}
        </span>
      ),
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
      render: (_, row: any) => (
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
            onClick={() => message.info('PDF export for ' + row.code)}
          >
            PDF
          </Button>
        </Space>
      ),
    },
  ];

  const draftCount = mockData?.results?.filter((r: any) => r.status === 'DRAFT').length || 0;
  const generatedCount = mockData?.results?.filter((r: any) => r.status === 'GENERATED').length || 0;
  const finalizedCount = mockData?.results?.filter((r: any) => r.status === 'FINALIZED').length || 0;

  return (
    <div style={{ padding: '20px' }}>
      {/* Thống kê */}
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

      {/* Bảng danh sách */}
      <Table
        columns={columns}
        dataSource={mockData?.results || []}
        pagination={{
          current: page,
          pageSize,
          total: mockData?.count,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
        }}
        rowKey="id"
        scroll={{ x: 1200 }}
      />

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
            <p><strong>Mã:</strong> {selectedReport.code}</p>
            <p><strong>Tên:</strong> {selectedReport.name}</p>
            <p><strong>Loại:</strong> {reportTypeLabel[selectedReport.report_type]}</p>
            <p><strong>Từ ngày:</strong> {dayjs(selectedReport.period_start).format('DD/MM/YYYY')}</p>
            <p><strong>Đến ngày:</strong> {dayjs(selectedReport.period_end).format('DD/MM/YYYY')}</p>
            <p><strong>Trạng thái:</strong> <Tag color={statusColor[selectedReport.status]}>{statusLabel[selectedReport.status]}</Tag></p>
            <p><strong>Tạo bởi:</strong> {selectedReport.generated_by_name}</p>
            {selectedReport.description && <p><strong>Mô tả:</strong> {selectedReport.description}</p>}
          </div>
        )}
      </Modal>

      {/* Modal Tạo báo cáo */}
      <Modal
        title="Tạo báo cáo mới"
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={() => { message.success('Tạo báo cáo thành công'); setFormOpen(false); }}
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
              ]}
            />
          </Form.Item>
          <Form.Item label="Tên báo cáo" name="name" rules={[{ required: true }]}>
            <Input placeholder="Tên báo cáo" />
          </Form.Item>
          <Form.Item label="Thời kỳ" required>
            <DatePicker.RangePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ReportsCenter;
