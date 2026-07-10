import React, { useState } from 'react';
import {
  Alert, Table, Button, Space, DatePicker, Skeleton, Empty, message, Tag, Card, Statistic, Row, Col, Typography,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { generalLedgerApi } from '../../api/generalLedger';
import type { TrialBalanceRow } from '../../types/generalLedger';
import { downloadCSV } from '../../utils/csvExport';
import { canManageFinanceData } from '../../utils/authz';

const { Text, Title } = Typography;

const TrialBalance: React.FC = () => {
  const canManage = canManageFinanceData();
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['trial-balance', { dateFrom, dateTo }],
    queryFn: () => generalLedgerApi.getTrialBalance({
      date_from: dateFrom || undefined,
      date_to: dateTo,
    }),
    enabled: !!dateTo,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    message.success('Cập nhật bảng cân đối thành công');
  };

  const handleExportCSV = () => {
    if (data && Array.isArray(data)) {
      downloadCSV(data, 'bang-can-doi-tay');
    }
  };

  const accountTypeLabel: Record<string, string> = {
    ASSET: 'Tài sản',
    LIABILITY: 'Nợ',
    EQUITY: 'Vốn',
    REVENUE: 'Doanh thu',
    EXPENSE: 'Chi phí',
    '': 'TỔNG CỘNG',
  };

  const accountTypeColor: Record<string, string> = {
    ASSET: 'blue',
    LIABILITY: 'red',
    EQUITY: 'green',
    REVENUE: 'cyan',
    EXPENSE: 'orange',
  };

  // Calculate totals
  const entries = data && Array.isArray(data) ? data : [];
  const totalRow = entries.find((r: TrialBalanceRow) => r.account_code === 'TOTAL');
  const totalDebit = totalRow ? Number(totalRow.debit) : 0;
  const totalCredit = totalRow ? Number(totalRow.credit) : 0;
  const isBalanced = totalDebit === totalCredit;
  const balanceAlert = entries.length
    ? {
        type: isBalanced ? 'success' as const : 'error' as const,
        message: isBalanced ? 'Bảng cân đối đang khớp Nợ/Có.' : 'Bảng cân đối đang lệch Nợ/Có.',
        description: isBalanced
          ? 'Có thể dùng số liệu này để đối chiếu với sổ cái và báo cáo tài chính trong kỳ.'
          : 'Cần kiểm tra lại bút toán trong sổ cái, chứng từ chưa ghi sổ hoặc tài khoản bị hạch toán sai.',
      }
    : {
        type: 'info' as const,
        message: 'Chưa có dữ liệu bảng cân đối cho khoảng ngày đang chọn.',
        description: 'Chọn ngày kết thúc hoặc mở rộng khoảng ngày để xem phát sinh Nợ/Có.',
      };

  const columns = [
    {
      title: 'Mã TK',
      dataIndex: 'account_code',
      key: 'account_code',
      width: 100,
      render: (code: string) => code === 'TOTAL' ? <strong>{code}</strong> : code,
    },
    {
      title: 'Tên Tài Khoản',
      dataIndex: 'account_name',
      key: 'account_name',
      width: 200,
      render: (name: string, record: TrialBalanceRow) =>
        record.account_code === 'TOTAL' ? <strong>{name}</strong> : name,
    },
    {
      title: 'Loại',
      dataIndex: 'account_type',
      key: 'account_type',
      width: 100,
      render: (type: string) => type ? (
        <Tag color={accountTypeColor[type] || 'default'}>
          {accountTypeLabel[type]}
        </Tag>
      ) : null,
    },
    {
      title: 'Nợ',
      dataIndex: 'debit',
      key: 'debit',
      width: 150,
      align: 'right' as const,
      render: (val: string, record: TrialBalanceRow) => {
        const num = Number(val);
        const isBold = record.account_code === 'TOTAL';
        return isBold ? 
          <strong>{num.toLocaleString('vi-VN', { minimumFractionDigits: 2 })}</strong> :
          num.toLocaleString('vi-VN', { minimumFractionDigits: 2 });
      },
    },
    {
      title: 'Có',
      dataIndex: 'credit',
      key: 'credit',
      width: 150,
      align: 'right' as const,
      render: (val: string, record: TrialBalanceRow) => {
        const num = Number(val);
        const isBold = record.account_code === 'TOTAL';
        return isBold ?
          <strong>{num.toLocaleString('vi-VN', { minimumFractionDigits: 2 })}</strong> :
          num.toLocaleString('vi-VN', { minimumFractionDigits: 2 });
      },
    },
  ];

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 15 }} />;
  }

  return (
    <div style={{ padding: '20px' }}>
      <Card style={{ marginBottom: '20px' }}>
        <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 16 }}>
          <Space wrap>
            <Tag color="blue">Tài chính</Tag>
            <Tag color={isBalanced ? 'success' : 'error'}>{isBalanced ? 'Cân đối' : 'Cần rà lệch'}</Tag>
          </Space>
          <div>
            <Title level={3} style={{ margin: 0 }}>Bảng cân đối phát sinh</Title>
            <Text type="secondary">Kiểm tra tổng Nợ/Có theo kỳ để phát hiện lệch sổ trước khi chốt báo cáo.</Text>
          </div>
          <Alert showIcon type={balanceAlert.type} message={balanceAlert.message} description={balanceAlert.description} />
        </Space>
        <Row gutter={16} style={{ marginBottom: '20px' }}>
          <Col span={12}>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ fontWeight: 'bold' }}>Từ ngày:</label>
            </div>
            <DatePicker
              format="DD/MM/YYYY"
              value={dateFrom ? dayjs(dateFrom) : null}
              onChange={(date) => setDateFrom(date ? date.format('YYYY-MM-DD') : '')}
              style={{ width: '100%' }}
            />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ fontWeight: 'bold' }}>Đến ngày:</label>
            </div>
            <DatePicker
              format="DD/MM/YYYY"
              value={dateTo ? dayjs(dateTo) : null}
              onChange={(date) => setDateTo(date ? date.format('YYYY-MM-DD') : '')}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>

        <Space>
          <Button type="primary" icon={<ReloadOutlined />} onClick={handleRefresh} loading={refreshing}>
            Tính toán
          </Button>
          {canManage ? (
            <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>
              Xuất CSV
            </Button>
          ) : null}
        </Space>
      </Card>

      {entries.length > 0 && (
        <Card style={{ marginBottom: '20px' }}>
          <Row gutter={24}>
            <Col span={8}>
              <Statistic
                title="Tổng Nợ"
                value={totalDebit}
                precision={0}
                valueStyle={{ color: '#1677ff' }}
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="Tổng Có"
                value={totalCredit}
                precision={0}
                valueStyle={{ color: '#1677ff' }}
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="Cân Đối"
                value={isBalanced ? '✓ Cân đối' : '✗ Không cân đối'}
                valueStyle={{ color: isBalanced ? '#52c41a' : '#ff4d4f' }}
              />
            </Col>
          </Row>
        </Card>
      )}

      <Table
        columns={columns}
        dataSource={entries && Array.isArray(entries) ? entries.filter((r: TrialBalanceRow) => 
          r.account_code !== 'TOTAL'  // Hide total row in table body
        ) : []}
        loading={isLoading}
        pagination={false}
        rowKey={(record) => record.account_code}
        scroll={{ x: 600 }}
        locale={{
          emptyText: <Empty description="Chọn ngày để xem bảng cân đối" />,
        }}
        footer={() => (
          entries && Array.isArray(entries) && totalRow ? (
            <Table
              columns={columns}
              dataSource={[totalRow]}
              pagination={false}
              rowKey="account_code"
              showHeader={false}
              style={{ marginTop: '10px', borderTop: '2px solid #f0f0f0' }}
            />
          ) : null
        )}
      />
    </div>
  );
};

export default TrialBalance;
