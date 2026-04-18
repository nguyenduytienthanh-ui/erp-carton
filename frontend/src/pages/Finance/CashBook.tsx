import React, { useState } from 'react';
import {
  Card, Row, Col, Statistic, Table, DatePicker, Button, Space, Skeleton, message,
} from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';

import { financeApi } from '../../api/finance';
import type { CashTransaction } from '../../types/finance';
import { downloadCSV } from '../../utils/csvExport';

const CashBook: React.FC = () => {
  const [dateFrom, setDateFrom] = useState<Dayjs>(dayjs().subtract(1, 'month'));
  const [dateTo, setDateTo] = useState<Dayjs>(dayjs());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const dateFromStr = dateFrom.format('YYYY-MM-DD');
  const dateToStr = dateTo.format('YYYY-MM-DD');

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['cash-flow-summary', dateFromStr, dateToStr],
    queryFn: () => financeApi.getCashFlowSummary({ date_from: dateFromStr, date_to: dateToStr }),
    enabled: !!dateFromStr && !!dateToStr,
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['cash-transactions', dateFromStr, dateToStr, page, pageSize],
    queryFn: () =>
      financeApi.getCashTransactions({
        transaction_date__gte: dateFromStr,
        transaction_date__lte: dateToStr,
        page,
        page_size: pageSize,
        ordering: '-transaction_date',
      }),
    enabled: !!dateFromStr && !!dateToStr,
  });

  const handleExportCSV = () => {
    if (!txData?.results?.length) {
      message.warning('Không có dữ liệu để xuất');
      return;
    }
    const csvData = txData.results.map((tx: CashTransaction) => ({
      'Ngày': tx.transaction_date,
      'Mã': tx.reference || '',
      'Loại': tx.transaction_type === 'INCOME' ? 'Thu' : 'Chi',
      'Số tiền': tx.amount,
      'Danh mục': tx.category_name || '',
      'Ghi chú': tx.reason || '',
    }));
    downloadCSV(csvData, `so-quy-${dateFromStr}-${dateToStr}`);
  };

  const columns = [
    {
      title: 'Ngày',
      dataIndex: 'transaction_date',
      key: 'transaction_date',
      width: 110,
      render: (d: string) => dayjs(d).format('DD/MM/YYYY'),
    },
    {
      title: 'Mã / Phiếu',
      dataIndex: 'reference',
      key: 'reference',
      width: 120,
    },
    {
      title: 'Loại',
      dataIndex: 'transaction_type',
      key: 'transaction_type',
      width: 80,
      render: (t: string) => (t === 'INCOME' ? 'Thu' : 'Chi'),
    },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      key: 'amount',
      width: 130,
      align: 'right' as const,
      render: (val: string | number, row: CashTransaction) => {
        const n = Number(val || 0);
        return (
          <span style={{ color: row.transaction_type === 'INCOME' ? '#52c41a' : '#ff4d4f' }}>
            {(row.transaction_type === 'INCOME' ? '' : '-')}
            {n.toLocaleString('vi-VN', { minimumFractionDigits: 0 })}
          </span>
        );
      },
    },
    {
      title: 'Danh mục',
      dataIndex: 'category_name',
      key: 'category_name',
      width: 140,
    },
    {
      title: 'Ghi chú',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
    },
  ];

  const loading = summaryLoading || txLoading;

  return (
    <div style={{ padding: '20px' }}>
      <Card style={{ marginBottom: '20px' }}>
        <Row gutter={24} align="middle">
          <Col>
            <Space>
              <span>Từ ngày:</span>
              <DatePicker
                value={dateFrom}
                onChange={(d) => setDateFrom(d!)}
                format="DD/MM/YYYY"
              />
              <span>Đến ngày:</span>
              <DatePicker
                value={dateTo}
                onChange={(d) => setDateTo(d!)}
                format="DD/MM/YYYY"
              />
            </Space>
          </Col>
          <Col>
            <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
              Xuất CSV
            </Button>
          </Col>
        </Row>
      </Card>

      {loading && !summary ? (
        <Skeleton active />
      ) : (
        <>
          <Row gutter={24} style={{ marginBottom: '20px' }}>
            <Col span={6}>
              <Card>
                <Statistic
                  title="Tổng thu"
                  value={summary?.total_income ?? 0}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="Tổng chi"
                  value={summary?.total_expense ?? 0}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{ color: '#ff4d4f' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="Chênh lệch thu chi"
                  value={summary?.cash_delta ?? 0}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{ color: Number(summary?.cash_delta || 0) >= 0 ? '#1677ff' : '#ff4d4f' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="Số giao dịch"
                  value={summary?.transactions_count ?? 0}
                />
              </Card>
            </Col>
          </Row>

          <Card title="Chi tiết giao dịch quỹ">
            <Table
              columns={columns}
              dataSource={txData?.results ?? []}
              rowKey="id"
              loading={txLoading}
              pagination={{
                current: page,
                pageSize,
                total: txData?.count ?? 0,
                showSizeChanger: true,
                pageSizeOptions: ['10', '20', '50'],
                onChange: (p, ps) => {
                  setPage(p);
                  setPageSize(ps ?? 20);
                },
              }}
              scroll={{ x: 800 }}
            />
          </Card>
        </>
      )}
    </div>
  );
};

export default CashBook;
