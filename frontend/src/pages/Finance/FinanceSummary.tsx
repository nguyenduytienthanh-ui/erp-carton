import { useMemo, useState, type CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  List,
  Modal,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  Skeleton,
} from 'antd';
import { DownloadOutlined, LockOutlined, ReloadOutlined, UnlockOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { financeApi } from '../../api/finance';
import type { FinanceMonthCloseCheckItem } from '../../types/finance';
import { downloadCSV } from '../../utils/csvExport';
import { getToastMessage } from '../../shared/apiError';

const { Text, Title } = Typography;

const SUMMARY_TILE_STYLE: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};

function formatMoney(value: number | string | null | undefined): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0';
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ChecklistList({
  title,
  items,
  emptyDescription,
}: {
  title: string;
  items: FinanceMonthCloseCheckItem[];
  emptyDescription: string;
}) {
  return (
    <Card title={title} size="small">
      {items.length > 0 ? (
        <List
          dataSource={items}
          renderItem={(item) => (
            <List.Item key={item.code}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space wrap>
                  <Text strong>{item.title}</Text>
                  <Tag color={item.severity === 'blocker' ? 'red' : 'gold'}>
                    {item.severity === 'blocker' ? 'Chặn khóa kỳ' : 'Cảnh báo'}
                  </Tag>
                  {item.count > 0 ? <Tag>{`${item.count} mục`}</Tag> : null}
                </Space>
                <Text type="secondary">{item.message}</Text>
              </Space>
            </List.Item>
          )}
        />
      ) : (
        <Empty description={emptyDescription} />
      )}
    </Card>
  );
}

export default function FinanceSummary() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState<Dayjs>(dayjs().startOf('month'));
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [forceUnlock, setForceUnlock] = useState(false);

  const monthKey = selectedMonth.format('YYYY-MM');
  const dateFrom = range[0].format('YYYY-MM-DD');
  const dateTo = range[1].format('YYYY-MM-DD');

  const lockedMonthsQuery = useQuery({
    queryKey: ['finance-locked-months'],
    queryFn: () => financeApi.getFinanceLockedMonths(),
  });
  const precloseQuery = useQuery({
    queryKey: ['finance-month-close-check', monthKey],
    queryFn: () => financeApi.getFinanceMonthCloseCheck(monthKey),
  });
  const payrollReconciliationQuery = useQuery({
    queryKey: ['finance-payroll-reconciliation', monthKey],
    queryFn: () => financeApi.getPayrollReconciliation(monthKey),
  });
  const monthlySummaryQuery = useQuery({
    queryKey: ['finance-monthly-summary', monthKey],
    queryFn: () => financeApi.getFinanceMonthlySummary(monthKey),
  });
  const trendQuery = useQuery({
    queryKey: ['finance-trend-12m', monthKey],
    queryFn: () => financeApi.getFinanceTrend12m(monthKey),
  });
  const cashFlowQuery = useQuery({
    queryKey: ['finance-summary-cash-flow', dateFrom, dateTo],
    queryFn: () => financeApi.getCashFlowSummary({ date_from: dateFrom, date_to: dateTo }),
  });
  const receivableSummaryQuery = useQuery({
    queryKey: ['finance-receivable-summary-card'],
    queryFn: () => financeApi.getReceivableSummary(),
  });
  const payableSummaryQuery = useQuery({
    queryKey: ['finance-payable-summary-card'],
    queryFn: () => financeApi.getPayableSummary(),
  });

  const refreshFinanceMonth = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['finance-locked-months'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-month-close-check', monthKey] }),
      queryClient.invalidateQueries({ queryKey: ['finance-payroll-reconciliation', monthKey] }),
      queryClient.invalidateQueries({ queryKey: ['finance-monthly-summary', monthKey] }),
      queryClient.invalidateQueries({ queryKey: ['finance-trend-12m', monthKey] }),
      queryClient.invalidateQueries({ queryKey: ['finance-summary-cash-flow'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-receivable-summary-card'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-payable-summary-card'] }),
    ]);
  };

  const lockMonthMutation = useMutation({
    mutationFn: () => financeApi.lockFinanceMonth(monthKey),
    onSuccess: async () => {
      await refreshFinanceMonth();
      messageApi.success(`Đã khóa kỳ tài chính ${monthKey}`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const unlockMonthMutation = useMutation({
    mutationFn: () => financeApi.unlockFinanceMonth(monthKey, forceUnlock),
    onSuccess: async () => {
      await refreshFinanceMonth();
      messageApi.success(`Đã mở khóa kỳ tài chính ${monthKey}`);
      setUnlockOpen(false);
      setForceUnlock(false);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const exportMonthlyExcelMutation = useMutation({
    mutationFn: () => financeApi.exportFinanceMonthlySummaryExcel(monthKey),
    onSuccess: (blob) => {
      downloadBlob(blob, `bao-cao-tai-chinh-${monthKey}.xlsx`);
      messageApi.success(`Đã tải báo cáo tháng ${monthKey}`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const lockedMonths = lockedMonthsQuery.data?.months ?? [];
  const preclose = precloseQuery.data;
  const monthlySummary = monthlySummaryQuery.data;
  const payrollReconciliation = payrollReconciliationQuery.data;
  const receivableSummary = receivableSummaryQuery.data;
  const payableSummary = payableSummaryQuery.data;
  const trendRows = trendQuery.data?.items ?? [];
  const isMonthLocked = lockedMonths.includes(monthKey);

  const executiveStatusAlert = useMemo(() => {
    if (preclose?.blockers?.length) {
      return {
        type: 'warning' as const,
        message: `Kỳ ${monthKey} vẫn còn ${preclose.blockers.length} điều kiện chặn khóa sổ.`,
        description: 'Hãy xử lý hết các blocker trước khi khóa tháng để tránh lệch đối soát hoặc còn chứng từ treo.',
      };
    }
    if (isMonthLocked) {
      return {
        type: 'success' as const,
        message: `Kỳ ${monthKey} đã được khóa tài chính.`,
        description: 'Các bút toán trong kỳ này cần được mở khóa trước khi chỉnh sửa lại dữ liệu nền.',
      };
    }
    if (preclose?.warnings?.length) {
      return {
        type: 'info' as const,
        message: `Kỳ ${monthKey} đã đạt điều kiện khóa, nhưng còn ${preclose.warnings.length} cảnh báo cần rà.`,
        description: 'Bạn vẫn có thể khóa kỳ, nhưng nên kiểm tra các cảnh báo để tránh sót nghĩa vụ đối soát.',
      };
    }
    return {
      type: 'success' as const,
      message: `Kỳ ${monthKey} đang sẵn sàng cho bước chốt sổ.`,
      description: 'Hệ thống chưa ghi nhận blocker hoặc cảnh báo lớn trên kỳ bạn đang xem.',
    };
  }, [isMonthLocked, monthKey, preclose?.blockers.length, preclose?.warnings.length]);

  const summaryCards = useMemo(
    () => [
      {
        title: 'Chênh lệch thu chi tháng',
        value: monthlySummary?.cash_delta ?? '0',
        color: Number(monthlySummary?.cash_delta ?? 0) >= 0 ? undefined : '#cf1322',
      },
      {
        title: 'Dư tạm ứng còn treo',
        value: monthlySummary?.advance_net_delta ?? '0',
        color: Number(monthlySummary?.advance_net_delta ?? 0) > 0 ? '#d46b08' : undefined,
      },
      {
        title: 'Phải thu còn mở',
        value: receivableSummary?.remaining_amount ?? '0',
        color: Number(receivableSummary?.remaining_amount ?? 0) > 0 ? '#1677ff' : undefined,
      },
      {
        title: 'Phải trả còn mở',
        value: payableSummary?.remaining_amount ?? '0',
        color: Number(payableSummary?.remaining_amount ?? 0) > 0 ? '#cf1322' : undefined,
      },
      {
        title: 'Blocker đóng kỳ',
        value: preclose?.blockers.length ?? 0,
        suffix: 'mục',
        color: (preclose?.blockers.length ?? 0) > 0 ? '#cf1322' : undefined,
      },
      {
        title: 'Tháng đã khóa',
        value: lockedMonths.length,
        suffix: 'tháng',
      },
    ],
    [
      lockedMonths.length,
      monthlySummary?.advance_net_delta,
      monthlySummary?.cash_delta,
      payableSummary?.remaining_amount,
      preclose?.blockers.length,
      receivableSummary?.remaining_amount,
    ],
  );

  const handleExportCsv = () => {
    downloadCSV(
      trendRows.map((row) => ({
        Thang: row.month,
        Tong_thu: Number(row.total_income || 0),
        Tong_chi: Number(row.total_expense || 0),
        Chenh_lech_thu_chi: Number(row.cash_delta || 0),
        Tam_ung: Number(row.total_advance || 0),
        Chi_quyet_toan: Number(row.total_settlement_spent || 0),
        Hoan_ung: Number(row.total_settlement_refund || 0),
        Chenh_lech_tam_ung: Number(row.advance_net_delta || 0),
      })),
      `tong-hop-tai-chinh-${monthKey}`,
    );
  };

  const trendColumns = [
    { title: 'Tháng', dataIndex: 'month', key: 'month', width: 110 },
    {
      title: 'Tổng thu',
      dataIndex: 'total_income',
      key: 'total_income',
      align: 'right' as const,
      render: (value: string) => formatMoney(value),
    },
    {
      title: 'Tổng chi',
      dataIndex: 'total_expense',
      key: 'total_expense',
      align: 'right' as const,
      render: (value: string) => formatMoney(value),
    },
    {
      title: 'Chênh lệch thu chi',
      dataIndex: 'cash_delta',
      key: 'cash_delta',
      align: 'right' as const,
      render: (value: string) => (
        <Text strong style={{ color: Number(value || 0) >= 0 ? '#389e0d' : '#cf1322' }}>
          {formatMoney(value)}
        </Text>
      ),
    },
    {
      title: 'Tạm ứng',
      dataIndex: 'total_advance',
      key: 'total_advance',
      align: 'right' as const,
      render: (value: string) => formatMoney(value),
    },
    {
      title: 'Chi quyết toán',
      dataIndex: 'total_settlement_spent',
      key: 'total_settlement_spent',
      align: 'right' as const,
      render: (value: string) => formatMoney(value),
    },
    {
      title: 'Hoàn ứng',
      dataIndex: 'total_settlement_refund',
      key: 'total_settlement_refund',
      align: 'right' as const,
      render: (value: string) => formatMoney(value),
    },
    {
      title: 'Dư tạm ứng',
      dataIndex: 'advance_net_delta',
      key: 'advance_net_delta',
      align: 'right' as const,
      render: (value: string) => (
        <Text strong style={{ color: Number(value || 0) > 0 ? '#d46b08' : undefined }}>
          {formatMoney(value)}
        </Text>
      ),
    },
  ];

  const isLoadingExecutive =
    lockedMonthsQuery.isLoading ||
    precloseQuery.isLoading ||
    payrollReconciliationQuery.isLoading ||
    monthlySummaryQuery.isLoading ||
    trendQuery.isLoading ||
    cashFlowQuery.isLoading ||
    receivableSummaryQuery.isLoading ||
    payableSummaryQuery.isLoading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}

      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">Tài chính</Tag>
                <Tag color="purple">Khóa kỳ</Tag>
                <Tag color="processing">Điều hành sổ sách</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>
                Trung tâm khóa kỳ tài chính
              </Title>
              <Text type="secondary">
                Điều phối kiểm tra đóng kỳ, khóa tháng, đối soát bảng lương, tình trạng công nợ và xu hướng 12 tháng trong một không gian vận hành thống nhất.
              </Text>
            </div>
            <Space wrap>
              <DatePicker
                picker="month"
                value={selectedMonth}
                format="MM/YYYY"
                onChange={(value) => value && setSelectedMonth(value.startOf('month'))}
              />
              <Button icon={<ReloadOutlined />} onClick={() => void refreshFinanceMonth()}>
                Làm mới
              </Button>
              <Button icon={<DownloadOutlined />} onClick={handleExportCsv} disabled={!trendRows.length}>
                Xuất CSV xu hướng
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => exportMonthlyExcelMutation.mutate()} loading={exportMonthlyExcelMutation.isPending}>
                Xuất Excel tháng
              </Button>
              <Button
                type="primary"
                icon={<LockOutlined />}
                onClick={() => lockMonthMutation.mutate()}
                loading={lockMonthMutation.isPending}
                disabled={isMonthLocked}
              >
                Khóa tháng
              </Button>
              <Button
                icon={<UnlockOutlined />}
                onClick={() => setUnlockOpen(true)}
                disabled={!isMonthLocked}
              >
                Mở khóa
              </Button>
            </Space>
          </div>

          <Alert showIcon type={executiveStatusAlert.type} message={executiveStatusAlert.message} description={executiveStatusAlert.description} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {summaryCards.map((card) => (
              <div key={card.title} style={SUMMARY_TILE_STYLE}>
                <Statistic
                  title={card.title}
                  value={card.value}
                  suffix={card.suffix}
                  valueStyle={{ color: card.color }}
                  formatter={(value) => (typeof value === 'number' && card.suffix ? value : `${formatMoney(value)}${card.suffix ? '' : ' đ'}`)}
                />
              </div>
            ))}
          </div>

          <Space wrap>
            <Tag color={isMonthLocked ? 'success' : 'default'}>
              {isMonthLocked ? `Kỳ ${monthKey} đã khóa` : `Kỳ ${monthKey} đang mở`}
            </Tag>
            <Tag color="default">{`Cảnh báo đóng kỳ: ${preclose?.warnings.length ?? 0}`}</Tag>
            <Tag color="blue">{`Giao dịch trong kỳ: ${monthlySummary?.transactions_count ?? 0}`}</Tag>
            <Tag color="gold">{`Phiếu tạm ứng: ${monthlySummary?.advances_count ?? 0}`}</Tag>
          </Space>
        </Space>
      </Card>

      {isLoadingExecutive ? (
        <Skeleton active paragraph={{ rows: 12 }} />
      ) : (
        <Tabs
          items={[
            {
              key: 'close',
              label: 'Khóa kỳ',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={12}>
                      <Card title={`Tháng đã khóa (${lockedMonths.length})`}>
                        {lockedMonths.length > 0 ? (
                          <Space wrap>
                            {lockedMonths.map((month) => (
                              <Tag key={month} color={month === monthKey ? 'blue' : 'default'}>
                                {month}
                              </Tag>
                            ))}
                          </Space>
                        ) : (
                          <Empty description="Chưa có tháng nào được khóa." />
                        )}
                      </Card>
                    </Col>
                    <Col xs={24} xl={12}>
                      <Card title={`Đối soát bảng lương · ${monthKey}`}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(160px, 1fr))', gap: 12 }}>
                          <div style={SUMMARY_TILE_STYLE}>
                            <Statistic title="Lương đã khóa" value={payrollReconciliation?.payroll_total ?? '0'} formatter={(value) => `${formatMoney(value)} đ`} />
                          </div>
                          <div style={SUMMARY_TILE_STYLE}>
                            <Statistic title="Đã hạch toán" value={payrollReconciliation?.posted_total ?? '0'} formatter={(value) => `${formatMoney(value)} đ`} />
                          </div>
                        </div>
                        <Space wrap style={{ marginTop: 16 }}>
                          <Tag color={payrollReconciliation?.is_balanced ? 'success' : 'red'}>
                            {payrollReconciliation?.is_balanced ? 'Đã cân bằng' : 'Đang lệch đối soát'}
                          </Tag>
                          <Tag>{`Số bảng lương: ${payrollReconciliation?.payroll_count ?? 0}`}</Tag>
                          <Tag>{`Bút toán chi lương: ${payrollReconciliation?.posted_count ?? 0}`}</Tag>
                          <Tag color={Number(payrollReconciliation?.delta ?? 0) === 0 ? 'success' : 'red'}>
                            {`Độ lệch: ${formatMoney(payrollReconciliation?.delta ?? 0)} đ`}
                          </Tag>
                        </Space>
                      </Card>
                    </Col>
                  </Row>

                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={12}>
                      <ChecklistList
                        title={`Điều kiện chặn khóa kỳ (${preclose?.blockers.length ?? 0})`}
                        items={preclose?.blockers ?? []}
                        emptyDescription="Không còn blocker nào cho kỳ đang xem."
                      />
                    </Col>
                    <Col xs={24} xl={12}>
                      <ChecklistList
                        title={`Cảnh báo cần rà (${preclose?.warnings.length ?? 0})`}
                        items={preclose?.warnings ?? []}
                        emptyDescription="Không còn cảnh báo nổi bật cần rà soát."
                      />
                    </Col>
                  </Row>

                  <Card title={`Tổng hợp tài chính tháng · ${monthKey}`}>
                    <Descriptions column={2} size="small" bordered>
                      <Descriptions.Item label="Tổng thu">{formatMoney(monthlySummary?.total_income ?? 0)} đ</Descriptions.Item>
                      <Descriptions.Item label="Tổng chi">{formatMoney(monthlySummary?.total_expense ?? 0)} đ</Descriptions.Item>
                      <Descriptions.Item label="Tổng chuyển">{formatMoney(monthlySummary?.total_transfer ?? 0)} đ</Descriptions.Item>
                      <Descriptions.Item label="Chênh lệch thu chi">{formatMoney(monthlySummary?.cash_delta ?? 0)} đ</Descriptions.Item>
                      <Descriptions.Item label="Tổng tạm ứng">{formatMoney(monthlySummary?.total_advance ?? 0)} đ</Descriptions.Item>
                      <Descriptions.Item label="Chi quyết toán">{formatMoney(monthlySummary?.total_settlement_spent ?? 0)} đ</Descriptions.Item>
                      <Descriptions.Item label="Hoàn ứng">{formatMoney(monthlySummary?.total_settlement_refund ?? 0)} đ</Descriptions.Item>
                      <Descriptions.Item label="Dư tạm ứng">{formatMoney(monthlySummary?.advance_net_delta ?? 0)} đ</Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Space>
              ),
            },
            {
              key: 'cashflow',
              label: 'Thu chi & công nợ',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card>
                    <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                      <DatePicker.RangePicker
                        value={range}
                        format="DD/MM/YYYY"
                        onChange={(dates) => {
                          if (dates?.[0] && dates?.[1]) {
                            setRange([dates[0], dates[1]]);
                          }
                        }}
                      />
                      <Text type="secondary">Theo dõi chênh lệch dòng tiền và áp lực công nợ trong kỳ bạn chọn.</Text>
                    </Space>
                  </Card>

                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12} xl={6}>
                      <Card>
                        <Statistic title="Tổng thu theo kỳ" value={cashFlowQuery.data?.total_income ?? '0'} formatter={(value) => `${formatMoney(value)} đ`} valueStyle={{ color: '#389e0d' }} />
                      </Card>
                    </Col>
                    <Col xs={24} md={12} xl={6}>
                      <Card>
                        <Statistic title="Tổng chi theo kỳ" value={cashFlowQuery.data?.total_expense ?? '0'} formatter={(value) => `${formatMoney(value)} đ`} valueStyle={{ color: '#cf1322' }} />
                      </Card>
                    </Col>
                    <Col xs={24} md={12} xl={6}>
                      <Card>
                        <Statistic title="Chênh lệch thu chi" value={cashFlowQuery.data?.cash_delta ?? '0'} formatter={(value) => `${formatMoney(value)} đ`} valueStyle={{ color: Number(cashFlowQuery.data?.cash_delta ?? 0) >= 0 ? '#1677ff' : '#cf1322' }} />
                      </Card>
                    </Col>
                    <Col xs={24} md={12} xl={6}>
                      <Card>
                        <Statistic title="Số giao dịch" value={cashFlowQuery.data?.transactions_count ?? 0} />
                      </Card>
                    </Col>
                  </Row>

                  <Row gutter={[16, 16]}>
                    <Col xs={24} xl={12}>
                      <Card title="Công nợ phải thu">
                        <Descriptions column={2} size="small">
                          <Descriptions.Item label="Hồ sơ mở">{receivableSummary?.open_count ?? 0}</Descriptions.Item>
                          <Descriptions.Item label="Quá hạn">{receivableSummary?.overdue_count ?? 0}</Descriptions.Item>
                          <Descriptions.Item label="Tổng công nợ">{formatMoney(receivableSummary?.total_amount ?? 0)} đ</Descriptions.Item>
                          <Descriptions.Item label="Còn phải thu">{formatMoney(receivableSummary?.remaining_amount ?? 0)} đ</Descriptions.Item>
                        </Descriptions>
                      </Card>
                    </Col>
                    <Col xs={24} xl={12}>
                      <Card title="Công nợ phải trả">
                        <Descriptions column={2} size="small">
                          <Descriptions.Item label="Hồ sơ mở">{payableSummary?.open_count ?? 0}</Descriptions.Item>
                          <Descriptions.Item label="Quá hạn">{payableSummary?.overdue_count ?? 0}</Descriptions.Item>
                          <Descriptions.Item label="Tổng công nợ">{formatMoney(payableSummary?.total_amount ?? 0)} đ</Descriptions.Item>
                          <Descriptions.Item label="Còn phải trả">{formatMoney(payableSummary?.remaining_amount ?? 0)} đ</Descriptions.Item>
                        </Descriptions>
                      </Card>
                    </Col>
                  </Row>
                </Space>
              ),
            },
            {
              key: 'trend',
              label: 'Xu hướng 12 tháng',
              children: (
                <Card>
                  <Table
                    rowKey="month"
                    columns={trendColumns}
                    dataSource={trendRows}
                    pagination={false}
                    scroll={{ x: 1200 }}
                    locale={{
                      emptyText: <Empty description="Chưa có dữ liệu xu hướng 12 tháng." />,
                    }}
                  />
                </Card>
              ),
            },
          ]}
        />
      )}

      <Modal
        title={`Mở khóa kỳ tài chính ${monthKey}`}
        open={unlockOpen}
        onCancel={() => {
          setUnlockOpen(false);
          setForceUnlock(false);
        }}
        onOk={() => unlockMonthMutation.mutate()}
        confirmLoading={unlockMonthMutation.isPending}
        okText="Xác nhận mở khóa"
        cancelText="Đóng"
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            showIcon
            type="warning"
            message="Mở khóa sẽ cho phép thay đổi lại dữ liệu trong kỳ"
            description="Chỉ dùng khi bạn thực sự cần chỉnh sửa chứng từ hoặc điều chỉnh lại bút toán tài chính."
          />
          <Checkbox checked={forceUnlock} onChange={(event) => setForceUnlock(event.target.checked)}>
            Force mở khóa nếu kỳ đã có dữ liệu phát sinh
          </Checkbox>
          <Text type="secondary">
            Backend sẽ tự kiểm tra quyền. Nếu tài khoản không đủ quyền force mở khóa, hệ thống sẽ trả về lỗi an toàn.
          </Text>
        </Space>
      </Modal>
    </div>
  );
}
