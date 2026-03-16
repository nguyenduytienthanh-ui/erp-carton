import React, { useState } from 'react';
import {
  Card, Row, Col, Statistic, Skeleton, Button, DatePicker, Space, Tabs,
} from 'antd';
import { ArrowUpOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';

import { financeApi } from '../../api/finance';
import { downloadCSV } from '../../utils/csvExport';

const FinanceSummary: React.FC = () => {
  const [startDate, setStartDate] = useState<Dayjs>(dayjs().startOf('month'));
  const [endDate, setEndDate] = useState<Dayjs>(dayjs());

  const dateFromStr = startDate.format('YYYY-MM-DD');
  const dateToStr = endDate.format('YYYY-MM-DD');

  const { data: cashFlow, isLoading } = useQuery({
    queryKey: ['finance-summary-cashflow', dateFromStr, dateToStr],
    queryFn: () => financeApi.getCashFlowSummary({ date_from: dateFromStr, date_to: dateToStr }),
    enabled: !!dateFromStr && !!dateToStr,
  });

  const summary = {
    total_income: cashFlow?.total_income ?? '0',
    total_expense: cashFlow?.total_expense ?? '0',
    cash_delta: cashFlow?.cash_delta ?? '0',
    transactions_count: cashFlow?.transactions_count ?? 0,
  };

  const handleExportCSV = () => {
    const csvData = [{
      'Kỳ': `${dateFromStr} - ${dateToStr}`,
      'Tổng thu': summary.total_income,
      'Tổng chi': summary.total_expense,
      'Chênh lệch': summary.cash_delta,
      'Số giao dịch': summary.transactions_count,
    }];
    downloadCSV(csvData, 'bao-cao-tai-chinh');
  };

  const items = [
    {
      key: '1',
      label: 'Thu chi theo kỳ',
      children: isLoading ? (
        <Skeleton active />
      ) : (
        <div>
          <Row gutter={24} style={{ marginBottom: '20px' }}>
            <Col span={6}>
              <Card>
                <Statistic
                  title="Tổng thu"
                  value={summary.total_income}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{ color: '#52c41a', fontSize: '18px' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="Tổng chi"
                  value={summary.total_expense}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{ color: '#ff4d4f', fontSize: '18px' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="Chênh lệch thu chi"
                  value={summary.cash_delta}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{
                    color: Number(summary.cash_delta) >= 0 ? '#1677ff' : '#ff4d4f',
                    fontSize: '18px',
                  }}
                  suffix={Number(summary.cash_delta) >= 0 ? <ArrowUpOutlined style={{ color: '#52c41a' }} /> : undefined}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="Số giao dịch"
                  value={summary.transactions_count}
                  valueStyle={{ fontSize: '18px' }}
                />
              </Card>
            </Col>
          </Row>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      <Card style={{ marginBottom: '20px' }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <DatePicker.RangePicker
                value={[startDate, endDate]}
                onChange={(dates) => {
                  if (dates) {
                    setStartDate(dates[0]!);
                    setEndDate(dates[1]!);
                  }
                }}
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

      <Tabs items={items} />
    </div>
  );
};

export default FinanceSummary;
