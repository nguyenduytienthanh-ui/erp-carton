import React, { useState } from 'react';
import {
  Card, Row, Col, Statistic, Chart, Skeleton, Button, DatePicker, Space, Tabs,
} from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

import { downloadCSV } from '../../utils/csvExport';

const FinanceSummary: React.FC = () => {
  const [startDate, setStartDate] = useState<Dayjs>(dayjs().startOf('year'));
  const [endDate, setEndDate] = useState<Dayjs>(dayjs());

  // Mock data - replace with actual API
  const summary = {
    total_assets: 2500000000,
    total_liabilities: 800000000,
    total_equity: 1700000000,
    total_revenue: 5000000000,
    total_cogs: 3000000000,
    total_operating_expenses: 1000000000,
    gross_profit: 2000000000,
    operating_profit: 1000000000,
    net_profit: 800000000,
    cash_balance: 500000000,
    accounts_receivable: 700000000,
    inventory_value: 900000000,
    accounts_payable: 600000000,
    profit_margin: 16,
    gross_margin: 40,
    current_ratio: 3.2,
    debt_to_equity: 0.47,
  };

  const handleExportCSV = () => {
    const csvData = [{
      'Chỉ số': 'Giá trị',
      'Tổng tài sản': summary.total_assets?.toLocaleString('vi-VN'),
      'Tổng nợ': summary.total_liabilities?.toLocaleString('vi-VN'),
      'Vốn chủ sở hữu': summary.total_equity?.toLocaleString('vi-VN'),
      'Doanh thu': summary.total_revenue?.toLocaleString('vi-VN'),
      'Lợi nhuận ròng': summary.net_profit?.toLocaleString('vi-VN'),
    }];
    downloadCSV(csvData, 'bao-cao-tai-chinh');
  };

  const items = [
    {
      key: '1',
      label: 'Tổng quan',
      children: (
        <div>
          <Row gutter={24} style={{ marginBottom: '20px' }}>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Tổng tài sản"
                  value={summary.total_assets}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{ color: '#1677ff', fontSize: '18px' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Tổng nợ"
                  value={summary.total_liabilities}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{ color: '#faad14', fontSize: '18px' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Vốn chủ sở hữu"
                  value={summary.total_equity}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{ color: '#52c41a', fontSize: '18px' }}
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={24}>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Doanh thu"
                  value={summary.total_revenue}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{ fontSize: '18px' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Lợi nhuận ròng"
                  value={summary.net_profit}
                  prefix="₫"
                  formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                  valueStyle={{ color: '#52c41a', fontSize: '18px' }}
                  suffix={<ArrowUpOutlined style={{ color: '#52c41a' }} />}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Biên lợi nhuận"
                  value={summary.profit_margin}
                  suffix="%"
                  valueStyle={{ fontSize: '18px' }}
                />
              </Card>
            </Col>
          </Row>
        </div>
      ),
    },
    {
      key: '2',
      label: 'Chi tiết',
      children: (
        <Row gutter={24}>
          <Col span={12}>
            <Card title="Thu nhập">
              <Statistic
                title="Doanh thu"
                value={summary.total_revenue}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
              <Statistic
                title="Giá vốn"
                value={summary.total_cogs}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
              <Statistic
                title="Lợi nhuận gộp"
                value={summary.gross_profit}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="Chi phí">
              <Statistic
                title="Chi phí vận hành"
                value={summary.total_operating_expenses}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
              />
              <Statistic
                title="Lợi nhuận vận hành"
                value={summary.operating_profit}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                valueStyle={{ color: '#52c41a' }}
              />
              <Statistic
                title="Lợi nhuận ròng"
                value={summary.net_profit}
                prefix="₫"
                formatter={(val) => (Number(val) || 0).toLocaleString('vi-VN')}
                valueStyle={{ color: '#1677ff', fontWeight: 'bold' }}
              />
            </Card>
          </Col>
        </Row>
      ),
    },
    {
      key: '3',
      label: 'Chỉ số tài chính',
      children: (
        <Row gutter={24}>
          <Col span={12}>
            <Card title="Chỉ số sinh lợi">
              <Statistic
                title="Biên lợi nhuận gộp"
                value={summary.gross_margin}
                suffix="%"
              />
              <Statistic
                title="Biên lợi nhuận ròng"
                value={summary.profit_margin}
                suffix="%"
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="Chỉ số thanh khoản">
              <Statistic
                title="Current Ratio"
                value={summary.current_ratio}
                precision={2}
              />
              <Statistic
                title="Debt to Equity"
                value={summary.debt_to_equity}
                precision={2}
              />
            </Card>
          </Col>
        </Row>
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
