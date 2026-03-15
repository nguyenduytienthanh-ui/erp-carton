import React, { useState } from 'react';
import {
  Table, Button, Space, Select, DatePicker, Card, Row, Col, Statistic, Skeleton, Tag, Modal, Form, Input, InputNumber, message,
} from 'antd';
import { DownloadOutlined, PlusOutlined, EyeOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';

import { downloadCSV } from '../../utils/csvExport';
import { getToastMessage } from '../../utils/authz';

const CashBookList: React.FC = () => {
  const [bankAccount, setBankAccount] = useState<number | undefined>();
  const [asOfDate, setAsOfDate] = useState<Dayjs>(dayjs());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  // Mock data for now - replace with actual API calls
  const data = {
    results: [
      {
        id: 1,
        code: 'CB001',
        bank_account_id: 1,
        bank_account_name: 'Ngân hàng A - Chi nhánh HCM',
        opening_balance: 50000000,
        total_receipts: 120000000,
        total_payments: 80000000,
        closing_balance: 90000000,
        statement_balance: 90000000,
        reconciliation_status: 'RECONCILED',
        as_of_date: asOfDate.format('YYYY-MM-DD'),
      },
      {
        id: 2,
        code: 'CB002',
        bank_account_id: 2,
        bank_account_name: 'Ngân hàng B - Chi nhánh HCM',
        opening_balance: 30000000,
        total_receipts: 80000000,
        total_payments: 50000000,
        closing_balance: 60000000,
        statement_balance: 60000000,
        reconciliation_status: 'RECONCILED',
        as_of_date: asOfDate.format('YYYY-MM-DD'),
      },
    ],
    count: 2,
  };

  const reconcileMutation = useMutation({
    mutationFn: (data: any) => Promise.resolve(data),
    onSuccess: () => {
      message.success('Điều hòa sổ quỹ thành công');
      queryClient.invalidateQueries({ queryKey: ['cashbook'] });
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Điều hòa sổ quỹ thất bại'));
    },
  });

  const handleExportCSV = () => {
    if (data?.results) {
      const csvData = data.results.map((cb: any) => ({
        'Số tài khoản': cb.bank_account_name,
        'Số dư đầu': cb.opening_balance?.toLocaleString('vi-VN'),
        'Tiền vào': cb.total_receipts?.toLocaleString('vi-VN'),
        'Tiền ra': cb.total_payments?.toLocaleString('vi-VN'),
        'Số dư cuối': cb.closing_balance?.toLocaleString('vi-VN'),
        'Trạng thái': cb.reconciliation_status === 'RECONCILED' ? 'Đã điều hòa' : 'Chưa điều hòa',
      }));
      downloadCSV(csvData, 'so-quy');
    }
  };

  const columns = [
    {
      title: 'Tài khoản ngân hàng',
      dataIndex: 'bank_account_name',
      key: 'bank_account_name',
      width: 150,
    },
    {
      title: 'Số dư đầu',
      dataIndex: 'opening_balance',
      key: 'opening_balance',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Tiền vào',
      dataIndex: 'total_receipts',
      key: 'total_receipts',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Tiền ra',
      dataIndex: 'total_payments',
      key: 'total_payments',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0',
    },
    {
      title: 'Số dư cuối',
      dataIndex: 'closing_balance',
      key: 'closing_balance',
      width: 120,
      align: 'right' as const,
      render: (val: number) => <strong>{val?.toLocaleString('vi-VN', { minimumFractionDigits: 0 }) || '0'}</strong>,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'reconciliation_status',
      key: 'reconciliation_status',
      width: 120,
      render: (status: string) => (
        <Tag color={status === 'RECONCILED' ? 'success' : 'warning'}>
          {status === 'RECONCILED' ? 'Đã điều hòa' : 'Chưa điều hòa'}
        </Tag>
      ),
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 180,
      render: (_, row: any) => (
        <Space wrap size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setSelectedRecord(row); setDetailOpen(true); }}>
            Chi tiết
          </Button>
          <Button
            size="small"
            onClick={() => reconcileMutation.mutate(row.id)}
          >
            Điều hòa
          </Button>
        </Space>
      ),
    },
  ];

  const totalClosing = data?.results?.reduce((sum: number, cb: any) => sum + (cb.closing_balance || 0), 0) || 0;

  return (
    <div style={{ padding: '20px' }}>
      {/* Thống kê */}
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={24}>
          <Col span={12}>
            <Statistic
              title="Tổng số dư"
              value={totalClosing}
              prefix="₫"
              formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
            />
          </Col>
          <Col span={12}>
            <Statistic
              title="Tính đến"
              value={asOfDate.format('DD/MM/YYYY')}
            />
          </Col>
        </Row>
      </Card>

      {/* Bộ lọc */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Select
          placeholder="Tài khoản ngân hàng"
          allowClear
          style={{ width: '200px' }}
        />
        <DatePicker
          value={asOfDate}
          onChange={(date) => setAsOfDate(date!)}
          format="DD/MM/YYYY"
        />
        <Button type="primary" icon={<PlusOutlined />}>
          Ghi sổ
        </Button>
        <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
          Xuất CSV
        </Button>
      </div>

      {/* Bảng danh sách */}
      <Table
        columns={columns}
        dataSource={data?.results || []}
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

      {/* Modal Chi tiết */}
      <Modal
        title="Chi tiết sổ quỹ"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={600}
      >
        {selectedRecord && (
          <div>
            <p><strong>Tài khoản:</strong> {selectedRecord.bank_account_name}</p>
            <p><strong>Số dư đầu:</strong> {selectedRecord.opening_balance?.toLocaleString('vi-VN')} đ</p>
            <p><strong>Tiền vào:</strong> {selectedRecord.total_receipts?.toLocaleString('vi-VN')} đ</p>
            <p><strong>Tiền ra:</strong> {selectedRecord.total_payments?.toLocaleString('vi-VN')} đ</p>
            <p><strong>Số dư cuối:</strong> {selectedRecord.closing_balance?.toLocaleString('vi-VN')} đ</p>
            <p><strong>Số dư trên sao kê:</strong> {selectedRecord.statement_balance?.toLocaleString('vi-VN')} đ</p>
            <p><strong>Trạng thái:</strong> {selectedRecord.reconciliation_status === 'RECONCILED' ? 'Đã điều hòa' : 'Chưa điều hòa'}</p>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default CashBookList;
