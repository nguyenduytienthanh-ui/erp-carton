import { useState } from 'react';
import { Button, Card, DatePicker, message, Select, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { financeApi } from '../../api/finance';
import { canManageFinanceData } from '../../utils/authz';

type LedgerRow = {
  id: number;
  transaction_date: string;
  reference: string;
  category_code: string;
  category_name: string;
  description: string;
  transaction_type: string;
  debit: string;
  credit: string;
};

function formatMoney(value: string | number): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString('vi-VN') : '0';
}

export default function GeneralLedger() {
  const canView = canManageFinanceData();
  const [dateFrom, setDateFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(dayjs().format('YYYY-MM-DD'));
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);

  const categoriesQuery = useQuery({
    queryKey: ['finance-transaction-categories-ledger'],
    queryFn: () => financeApi.getTransactionCategories({ page_size: 200, ordering: 'code' }),
    enabled: canView,
  });
  const categories = categoriesQuery.data?.results ?? [];

  const ledgerQuery = useQuery({
    queryKey: ['finance-general-ledger', dateFrom, dateTo, categoryId],
    queryFn: () =>
      financeApi.getGeneralLedger({
        date_from: dateFrom,
        date_to: dateTo,
        ...(categoryId ? { category: categoryId } : {}),
      }),
    enabled: canView && !!dateFrom && !!dateTo && dayjs(dateFrom).isSameOrBefore(dayjs(dateTo)),
  });

  const columns: ColumnsType<LedgerRow> = [
    {
      title: 'Ngày',
      dataIndex: 'transaction_date',
      key: 'transaction_date',
      width: 110,
      render: (v: string) => (v ? dayjs(v).format('DD/MM/YYYY') : '—'),
    },
    { title: 'Chứng từ', dataIndex: 'reference', key: 'reference', width: 120, ellipsis: true },
    { title: 'Loại', dataIndex: 'category_name', key: 'category_name', width: 140, ellipsis: true },
    { title: 'Diễn giải', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: 'Nợ',
      dataIndex: 'debit',
      key: 'debit',
      width: 110,
      align: 'right',
      render: (v: string) => (Number(v) ? formatMoney(v) : ''),
    },
    {
      title: 'Có',
      dataIndex: 'credit',
      key: 'credit',
      width: 110,
      align: 'right',
      render: (v: string) => (Number(v) ? formatMoney(v) : ''),
    },
  ];

  const dataSource = ledgerQuery.data?.results ?? [];

  const dateError = dateFrom && dateTo && dayjs(dateFrom).isAfter(dayjs(dateTo));

  const totalDebit = dataSource.reduce((sum, r) => sum + Number(r.debit || 0), 0);
  const totalCredit = dataSource.reduce((sum, r) => sum + Number(r.credit || 0), 0);
  const balance = totalCredit - totalDebit;

  const handleExportCsv = () => {
    const headers = ['Ngày', 'Chứng từ', 'Loại', 'Diễn giải', 'Nợ', 'Có'];
    const rows = dataSource.map((r) => [
      r.transaction_date ? dayjs(r.transaction_date).format('DD/MM/YYYY') : '',
      r.reference ?? '',
      r.category_name ?? '',
      r.description ?? '',
      Number(r.debit) ? formatMoney(r.debit) : '',
      Number(r.credit) ? formatMoney(r.credit) : '',
    ]);
    rows.push(['', '', '', 'TỔNG CỘNG', formatMoney(totalDebit), formatMoney(totalCredit)]);
    const content = [
      '\uFEFF' + headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(','),
      ...rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `so-cai-${dateFrom}-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container">
      <Card
        title="Sổ cái"
        extra={
          <Space wrap>
            <DatePicker.RangePicker
              value={[dayjs(dateFrom), dayjs(dateTo)]}
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  const from = dates[0].format('YYYY-MM-DD');
                  const to = dates[1].format('YYYY-MM-DD');
                  if (dayjs(from).isAfter(dayjs(to))) {
                    message.warning('Ngày bắt đầu không được lớn hơn ngày kết thúc.');
                    return;
                  }
                  setDateFrom(from);
                  setDateTo(to);
                }
              }}
            />
            <Select
              placeholder="Tất cả loại thu chi"
              value={categoryId || undefined}
              onChange={(v) => setCategoryId(v || undefined)}
              style={{ width: 200 }}
              allowClear
              options={categories.map((c) => ({ value: c.id, label: `${c.code} - ${c.name}` }))}
            />
            <Button size="small" onClick={handleExportCsv} disabled={dataSource.length === 0}>
              Xuất CSV
            </Button>
          </Space>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
          <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 8 }}>
            <div style={{ color: '#8c8c8c', fontSize: 12 }}>Tổng Nợ (Debit)</div>
            <div style={{ fontWeight: 600, fontSize: 18, color: '#cf1322' }}>{formatMoney(totalDebit)}</div>
          </div>
          <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 8 }}>
            <div style={{ color: '#8c8c8c', fontSize: 12 }}>Tổng Có (Credit)</div>
            <div style={{ fontWeight: 600, fontSize: 18, color: '#389e0d' }}>{formatMoney(totalCredit)}</div>
          </div>
          <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 8 }}>
            <div style={{ color: '#8c8c8c', fontSize: 12 }}>Số dư (Có - Nợ)</div>
            <div style={{ fontWeight: 600, fontSize: 18, color: balance >= 0 ? '#389e0d' : '#cf1322' }}>{formatMoney(balance)}</div>
          </div>
        </div>
        {dateError ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#cf1322', backgroundColor: '#fff1f0', borderRadius: 8, marginBottom: 16 }}>
            Ngày bắt đầu không được lớn hơn ngày kết thúc. Vui lòng chọn lại khoảng ngày.
          </div>
        ) : dataSource.length === 0 && !ledgerQuery.isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#8c8c8c' }}>
            {categoryId ? 'Không tìm thấy dữ liệu sổ cái cho loại được chọn trong khoảng ngày này.' : 'Không có giao dịch trong khoảng ngày đã chọn.'}
          </div>
        ) : null}
        {!dateError && (
          <Table<LedgerRow>
            rowKey="id"
            loading={ledgerQuery.isLoading}
            columns={columns}
            dataSource={dataSource}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `Tổng ${t} dòng` }}
            scroll={{ x: 700 }}
            footer={() => (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, paddingTop: 12 }}>
                <div><strong>Tổng Nợ:</strong> {formatMoney(totalDebit)}</div>
                <div><strong>Tổng Có:</strong> {formatMoney(totalCredit)}</div>
                <div><strong>Số dư:</strong> <span style={{ color: balance >= 0 ? '#389e0d' : '#cf1322' }}>{formatMoney(balance)}</span></div>
              </div>
            )}
          />
        )}
      </Card>
    </div>
  );
}
