import React, { useState } from 'react';
import {
  Table, Button, Input, Select, Modal, Skeleton, Empty, Tag,
} from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { generalLedgerApi } from '../../api/generalLedger';
import type { GeneralLedgerAccount, GeneralLedgerEntry } from '../../types/generalLedger';
import { downloadCSV } from '../../utils/csvExport';

const GeneralLedgerList: React.FC = () => {
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState<number | ''>('');
  const [documentType, setDocumentType] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailEntry, setDetailEntry] = useState<GeneralLedgerEntry | null>(null);
  const params = {
    search: search || undefined,
    account: account || undefined,
    document_type: documentType || undefined,
    page,
    page_size: pageSize,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['gl-entries', params],
    queryFn: () => generalLedgerApi.getEntries(params),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn: () => generalLedgerApi.getAccounts({ page_size: 1000 }),
  });
  const accounts = accountsData?.results || [];

  const accountTypeColor: Record<string, string> = {
    ASSET: 'blue',
    LIABILITY: 'red',
    EQUITY: 'green',
    REVENUE: 'cyan',
    EXPENSE: 'orange',
  };

  const accountTypeLabel: Record<string, string> = {
    ASSET: 'Tài sản',
    LIABILITY: 'Nợ',
    EQUITY: 'Vốn',
    REVENUE: 'Doanh thu',
    EXPENSE: 'Chi phí',
  };

  const handleExportCSV = () => {
    if (data?.results) {
      const csvData = data.results.map((entry: GeneralLedgerEntry) => ({
        'Tài khoản': entry.account_code,
        'Tên TK': entry.account_name,
        'Loại': accountTypeLabel[entry.account_type || ''],
        'Ngày': dayjs(entry.posting_date).format('DD/MM/YYYY'),
        'Nợ': entry.debit_amount,
        'Có': entry.credit_amount,
        'Chứng từ': entry.document_code || '',
        'Ghi chú': entry.description || '',
      }));
      downloadCSV(csvData, 'so-cai-tong-hop');
    }
  };

  const columns = [
    {
      title: 'Mã TK',
      dataIndex: 'account_code',
      key: 'account_code',
      width: 100,
      sorter: (a: GeneralLedgerEntry, b: GeneralLedgerEntry) => 
        (a.account_code || '').localeCompare(b.account_code || ''),
    },
    {
      title: 'Tên Tài Khoản',
      dataIndex: 'account_name',
      key: 'account_name',
      width: 150,
    },
    {
      title: 'Loại',
      dataIndex: 'account_type',
      key: 'account_type',
      width: 100,
      render: (type: string) => (
        <Tag color={accountTypeColor[type] || 'default'}>
          {accountTypeLabel[type] || type}
        </Tag>
      ),
    },
    {
      title: 'Ngày',
      dataIndex: 'posting_date',
      key: 'posting_date',
      width: 100,
      render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: 'Nợ',
      dataIndex: 'debit_amount',
      key: 'debit_amount',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val.toLocaleString('vi-VN', { minimumFractionDigits: 2 }),
    },
    {
      title: 'Có',
      dataIndex: 'credit_amount',
      key: 'credit_amount',
      width: 120,
      align: 'right' as const,
      render: (val: number) => val.toLocaleString('vi-VN', { minimumFractionDigits: 2 }),
    },
    {
      title: 'Chứng từ',
      dataIndex: 'document_code',
      key: 'document_code',
      width: 100,
    },
    {
      title: 'Ghi chú',
      dataIndex: 'description',
      key: 'description',
      width: 150,
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 80,
      render: (_: unknown, row: GeneralLedgerEntry) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailEntry(row)}>
          Xem
        </Button>
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
          placeholder="Tìm kiếm ghi chú, tài khoản..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ width: '200px' }}
        />
        <Select
          placeholder="Tài khoản"
          value={account}
          onChange={(val) => { setAccount(val); setPage(1); }}
          allowClear
          style={{ width: '200px' }}
          options={accounts.map((a: GeneralLedgerAccount) => ({
            value: a.id,
            label: `${a.code} - ${a.name}`,
          }))}
        />
        <Select
          placeholder="Loại chứng từ"
          value={documentType}
          onChange={(val) => { setDocumentType(val); setPage(1); }}
          allowClear
          style={{ width: '150px' }}
          options={[
            { label: 'Hóa đơn bán', value: 'SalesOrder' },
            { label: 'Đơn mua', value: 'PurchaseOrder' },
            { label: 'Phiếu giao', value: 'Shipment' },
          ]}
        />
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
        scroll={{ x: 1400 }}
        locale={{
          emptyText: <Empty description="Không có chứng từ nào" />,
        }}
      />

      <Modal
        title="Chi tiết chứng từ"
        open={!!detailEntry}
        onCancel={() => setDetailEntry(null)}
        footer={null}
        width={600}
      >
        {detailEntry && (
          <div>
            <p><strong>Tài khoản:</strong> {detailEntry.account_code} - {detailEntry.account_name}</p>
            <p><strong>Loại:</strong> <Tag color={accountTypeColor[detailEntry.account_type || '']}>
              {accountTypeLabel[detailEntry.account_type || '']}
            </Tag></p>
            <p><strong>Ngày:</strong> {dayjs(detailEntry.posting_date).format('DD/MM/YYYY')}</p>
            <p><strong>Nợ:</strong> {Number(detailEntry.debit_amount).toLocaleString('vi-VN', { minimumFractionDigits: 2 })}</p>
            <p><strong>Có:</strong> {Number(detailEntry.credit_amount).toLocaleString('vi-VN', { minimumFractionDigits: 2 })}</p>
            {detailEntry.document_code && (
              <p><strong>Chứng từ:</strong> {detailEntry.document_code}</p>
            )}
            {detailEntry.description && (
              <p><strong>Ghi chú:</strong> {detailEntry.description}</p>
            )}
            {detailEntry.created_by_name && (
              <p><strong>Tạo bởi:</strong> {detailEntry.created_by_name}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default GeneralLedgerList;
