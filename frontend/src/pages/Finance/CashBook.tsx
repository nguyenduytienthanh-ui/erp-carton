import React, { useState } from 'react';
import {
  Alert, Card, Row, Col, Statistic, Table, DatePicker, Button, Space, Skeleton, message, Empty, Tag, Typography,
} from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';

import { financeApi } from '../../api/finance';
import type { CashTransaction } from '../../types/finance';
import { downloadCSV } from '../../utils/csvExport';

const { Text, Title } = Typography;

function getCashTransactionTypeMeta(type: CashTransaction['transaction_type']): { color: string; label: string } {
  if (type === 'INCOME') return { color: 'green', label: 'Thu' };
  if (type === 'EXPENSE') return { color: 'red', label: 'Chi' };
  return { color: 'blue', label: 'Chuyển quỹ' };
}

function getCashTransactionOwnerStep(tx: CashTransaction): string {
  if (tx.transaction_type === 'INCOME') {
    return 'Đã ghi nhận thu: đối chiếu nguồn tiền và công nợ phải thu nếu đây là khoản thu khách hàng.';
  }
  if (tx.transaction_type === 'EXPENSE') {
    return 'Đã ghi nhận chi: đối chiếu nhà cung cấp, tạm ứng hoặc khoản phải trả liên quan.';
  }
  return 'Giao dịch chuyển quỹ: kiểm tra cả nguồn đi và nơi nhận để tránh lệch tồn quỹ.';
}

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
      width: 120,
      render: (t: CashTransaction['transaction_type']) => {
        const meta = getCashTransactionTypeMeta(t);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
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
    {
      title: 'Việc tiếp theo',
      key: 'owner_next_step',
      width: 320,
      render: (_: unknown, row: CashTransaction) => <Text type="secondary">{getCashTransactionOwnerStep(row)}</Text>,
    },
  ];

  const loading = summaryLoading || txLoading;
  const cashDelta = Number(summary?.cash_delta ?? 0);
  const cashFlowAlert = summary?.transactions_count
    ? {
        type: cashDelta >= 0 ? 'success' as const : 'warning' as const,
        message: cashDelta >= 0
          ? `Dòng tiền kỳ này đang dương ${cashDelta.toLocaleString('vi-VN')} đ.`
          : `Dòng tiền kỳ này đang âm ${Math.abs(cashDelta).toLocaleString('vi-VN')} đ.`,
        description: cashDelta >= 0
          ? 'Có thể tiếp tục đối chiếu các khoản phải thu/phải trả lớn để giữ nhịp thu chi ổn định.'
          : 'Nên rà các khoản chi lớn, công nợ phải thu sắp đến hạn và kế hoạch thanh toán trong kỳ.',
      }
    : {
        type: 'info' as const,
        message: 'Chưa có giao dịch thu chi trong khoảng ngày đang chọn.',
        description: 'Hãy mở rộng khoảng ngày hoặc kiểm tra lại bộ lọc nếu kỳ này đáng ra đã có phát sinh.',
      };

  return (
    <div style={{ padding: '20px' }}>
      <Card style={{ marginBottom: '20px' }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Space wrap>
              <Tag color="blue">Tài chính</Tag>
              <Tag color="green">Dòng tiền</Tag>
              <Tag color="processing">Sổ quỹ</Tag>
            </Space>
            <Title level={3} style={{ margin: '8px 0 4px' }}>Sổ quỹ & ngân hàng</Title>
            <Text type="secondary">Theo dõi tiền vào, tiền ra và chênh lệch dòng tiền theo khoảng ngày để ra quyết định thu chi nhanh hơn.</Text>
          </div>
          <Row gutter={[24, 12]} align="middle">
            <Col>
              <Space wrap>
                <span>Từ ngày:</span>
                <DatePicker
                  value={dateFrom}
                  onChange={(d) => d && setDateFrom(d)}
                  format="DD/MM/YYYY"
                />
                <span>Đến ngày:</span>
                <DatePicker
                  value={dateTo}
                  onChange={(d) => d && setDateTo(d)}
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
        </Space>
      </Card>

      {loading && !summary ? (
        <Skeleton active />
      ) : (
        <>
          <Alert showIcon type={cashFlowAlert.type} message={cashFlowAlert.message} description={cashFlowAlert.description} style={{ marginBottom: 20 }} />
          <Row gutter={[24, 16]} style={{ marginBottom: '20px' }}>
            <Col xs={24} md={12} xl={6}>
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
            <Col xs={24} md={12} xl={6}>
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
            <Col xs={24} md={12} xl={6}>
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
            <Col xs={24} md={12} xl={6}>
              <Card>
                <Statistic
                  title="Số giao dịch"
                  value={summary?.transactions_count ?? 0}
                />
              </Card>
            </Col>
          </Row>

          <Card title="Chi tiết giao dịch quỹ">
            <Space>
              <Tag color="green">Thu: {Number(summary?.total_income ?? 0).toLocaleString('vi-VN')} đ</Tag>
              <Tag color="red">Chi: {Number(summary?.total_expense ?? 0).toLocaleString('vi-VN')} đ</Tag>
              <Tag color={cashDelta >= 0 ? 'blue' : 'red'}>Chênh lệch: {cashDelta.toLocaleString('vi-VN')} đ</Tag>
            </Space>
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
              scroll={{ x: 1080 }}
              locale={{ emptyText: <Empty description="Chưa có giao dịch thu chi trong khoảng ngày này." /> }}
            />
          </Card>
        </>
      )}
    </div>
  );
};

export default CashBook;
