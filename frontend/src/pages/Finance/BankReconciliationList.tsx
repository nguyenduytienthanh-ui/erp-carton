import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
  Skeleton,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { bankAccountsApi, financeApi } from '../../api/finance';
import { PAGES } from '../../utils/constants';
import { canManageFinanceData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';
import type { BankReconciliationPayload } from '../../types/finance';
import { downloadCSV } from '../../utils/csvExport';

const { Text, Title } = Typography;

type Filters = {
  status?: string;
};

type BankReconciliationViewSnapshot = {
  search: string;
  status?: string;
};

type BankReconciliationNamedPreset = {
  id: string;
  name: string;
  filters: BankReconciliationViewSnapshot;
};

type BankReconciliationRecord = {
  id: number;
  code: string;
  statement_date: string;
  statement_balance: string;
  bank_account: number;
  bank_account_code?: string;
  bank_account_name?: string;
  book_balance: string;
  delta: string;
  status: string;
  reference: string;
  note: string;
  created_at: string;
  updated_at: string;
};

type BankReconciliationFormValues = {
  statement_date: dayjs.Dayjs;
  bank_account: number;
  statement_balance: number;
  book_balance: number;
  reference?: string;
  note?: string;
};

const STATUS_META: Record<string, { color: string; label: string }> = {
  DRAFT: { color: 'default', label: 'Nháp' },
  SUBMITTED: { color: 'processing', label: 'Chờ duyệt' },
  APPROVED: { color: 'success', label: 'Đã duyệt' },
  POSTED: { color: 'cyan', label: 'Đã ghi sổ' },
};

const SUMMARY_TILE_STYLE: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};

function serializeFilters(filters: Filters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): Filters {
  try {
    return JSON.parse(raw) as Filters;
  } catch {
    return {};
  }
}

function formatMoney(value: number | string | null | undefined): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0';
}

function parseViewSnapshot(value: unknown): BankReconciliationViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const statusValue = obj.status;
  return {
    search: typeof obj.search === 'string' ? obj.search : '',
    status:
      statusValue === 'DRAFT'
      || statusValue === 'SUBMITTED'
      || statusValue === 'APPROVED'
      || statusValue === 'POSTED'
        ? statusValue
        : undefined,
  };
}

export default function BankReconciliationList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManageFinanceData();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);
  const [detailRecon, setDetailRecon] = useState<BankReconciliationRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editRecon, setEditRecon] = useState<BankReconciliationRecord | null>(null);
  const {
    config,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.FINANCE_BANK_RECONCILIATION);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord.pageSize ?? 20);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = {
      page,
      page_size: pageSize,
      ordering: '-statement_date',
    };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.status) next.status = intentFilters.status;
    return next;
  }, [intentFilters.status, intentSearch, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['finance-bank-reconciliations', params],
    queryFn: () => financeApi.getBankReconciliations(params),
  });

  const detailQuery = useQuery({
    queryKey: ['finance-bank-reconciliation-detail', detailRecon?.id],
    queryFn: () => financeApi.getBankReconciliation(detailRecon!.id),
    enabled: !!detailRecon?.id,
  });

  const bankAccountsQuery = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => bankAccountsApi.getBankAccounts({ is_active: 'true', page_size: 1000 }),
  });

  const deleteMutation = useMutation({
    mutationFn: financeApi.deleteBankReconciliation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliations'] });
      messageApi.success('Đã xóa phiếu đối soát ngân hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: financeApi.approveBankReconciliation,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliations'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliation-detail'] }),
      ]);
      messageApi.success('Đã duyệt phiếu đối soát');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const postMutation = useMutation({
    mutationFn: financeApi.postBankReconciliation,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliations'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliation-detail'] }),
      ]);
      messageApi.success('Đã ghi sổ phiếu đối soát');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const detail = detailQuery.data ?? detailRecon;

  const summary = useMemo(() => {
    const draftCount = rows.filter((row) => row.status === 'DRAFT').length;
    const approvedCount = rows.filter((row) => row.status === 'APPROVED').length;
    const postedCount = rows.filter((row) => row.status === 'POSTED').length;
    const submittedCount = rows.filter((row) => row.status === 'SUBMITTED').length;
    const deltaCount = rows.filter((row) => Number(row.delta || 0) !== 0).length;
    const absoluteDelta = rows.reduce((sum, row) => sum + Math.abs(Number(row.delta || 0)), 0);
    return { draftCount, approvedCount, postedCount, submittedCount, deltaCount, absoluteDelta };
  }, [rows]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.status) tags.push(`Trạng thái: ${STATUS_META[intentFilters.status]?.label ?? intentFilters.status}`);
    return tags;
  }, [intentFilters.status, intentSearch]);

  const namedPresets = useMemo(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) return [] as BankReconciliationNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === 'string' ? obj.id : '';
        const name = typeof obj.name === 'string' ? obj.name : '';
        const filtersValue = parseViewSnapshot(obj.filters);
        if (!id || !name || !filtersValue) return null;
        return { id, name, filters: filtersValue };
      })
      .filter((value): value is BankReconciliationNamedPreset => value !== null);
  }, [configRecord.saved_views]);

  const selectedPreset = useMemo(
    () => namedPresets.find((preset) => preset.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );

  const savedViewSnapshot = useMemo(() => {
    const directSnapshot = parseViewSnapshot(configRecord.saved_view_snapshot);
    if (directSnapshot) return directSnapshot;
    return parseViewSnapshot({
      search: configRecord.search,
      status: configRecord.status,
    });
  }, [configRecord.saved_view_snapshot, configRecord.search, configRecord.status]);

  const commandContextTags = useMemo(() => {
    if (!selectedPreset) return activeFilterTags;
    return [...activeFilterTags, `Mẫu đang dùng: ${selectedPreset.name}`];
  }, [activeFilterTags, selectedPreset]);

  const buildCurrentSnapshot = (): BankReconciliationViewSnapshot => ({
    search: searchInput,
    status: filters.status,
  });

  const applySnapshot = (snapshot: BankReconciliationViewSnapshot) => {
    setSearchInput(snapshot.search);
    setFilters({
      status: snapshot.status,
    });
    setPage(1);
  };

  const saveCurrentView = async () => {
    const currentSnapshot = buildCurrentSnapshot();
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem đối soát ngân hàng.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem đối soát ngân hàng.');
    }
  };

  const applySavedView = () => {
    if (!savedViewSnapshot) {
      messageApi.warning('Chưa có chế độ xem đã lưu.');
      return;
    }
    applySnapshot(savedViewSnapshot);
    messageApi.success('Đã áp dụng chế độ xem đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const nextPreset: BankReconciliationNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((preset) => (preset.id === existing.id ? nextPreset : preset))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedPresetId(nextPreset.id);
      setPresetName('');
      setIsPresetModalOpen(false);
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc.' : 'Đã lưu mẫu lọc mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc.');
    }
  };

  const applyNamedPreset = () => {
    if (!selectedPreset) {
      messageApi.warning('Vui lòng chọn mẫu lọc.');
      return;
    }
    applySnapshot(selectedPreset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${selectedPreset.name}".`);
  };

  const deleteNamedPreset = async () => {
    if (!selectedPreset) {
      messageApi.warning('Vui lòng chọn mẫu lọc để xóa.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const nextPresets = namedPresets.filter((preset) => preset.id !== selectedPreset.id);
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedPresetId(undefined);
      messageApi.success(`Đã xóa mẫu lọc "${selectedPreset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc.');
    }
  };

  const statusAlert = useMemo(() => {
    if (summary.deltaCount > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${summary.deltaCount} phiếu đang chênh lệch số liệu giữa sao kê và sổ kế toán.`,
        description: 'Nên ưu tiên rà nhóm phiếu lệch để tránh ghi sổ sai và kéo dài thời gian khóa sổ ngân hàng.',
      };
    }
    if (summary.approvedCount > 0) {
      return {
        type: 'info' as const,
        message: `Có ${summary.approvedCount} phiếu đã duyệt và sẵn sàng ghi sổ.`,
        description: 'Bạn có thể ghi sổ ngay sau khi xác nhận số dư đã khớp hoàn toàn.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Đối soát ngân hàng đang vận hành ổn định trên bộ lọc hiện tại.',
      description: 'Chưa có phiếu chênh lệch nổi bật hoặc tồn đọng cần xử lý gấp.',
    };
  }, [summary.approvedCount, summary.deltaCount]);

  const columns: ColumnsType<BankReconciliationRecord> = [
    { title: 'Mã phiếu', dataIndex: 'code', width: 140, fixed: 'left' },
    {
      title: 'Ngày sao kê',
      dataIndex: 'statement_date',
      width: 120,
      render: (value: string) => dayjs(value).format('DD/MM/YYYY'),
    },
    {
      title: 'Tài khoản ngân hàng',
      width: 220,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.bank_account_name || '-'}</Text>
          <Text type="secondary">{row.bank_account_code || 'Chưa có mã tài khoản'}</Text>
        </Space>
      ),
    },
    {
      title: 'Số dư sao kê',
      dataIndex: 'statement_balance',
      width: 150,
      align: 'right',
      render: (value: string) => formatMoney(value),
    },
    {
      title: 'Số dư sổ',
      dataIndex: 'book_balance',
      width: 150,
      align: 'right',
      render: (value: string) => formatMoney(value),
    },
    {
      title: 'Chênh lệch',
      dataIndex: 'delta',
      width: 150,
      align: 'right',
      render: (value: string) => {
        const numeric = Number(value || 0);
        return <Text strong style={{ color: numeric === 0 ? '#389e0d' : '#cf1322' }}>{formatMoney(numeric)}</Text>;
      },
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 140,
      render: (value: string) => <Tag color={STATUS_META[value]?.color ?? 'default'}>{STATUS_META[value]?.label ?? value}</Tag>,
    },
    {
      title: 'Tham chiếu',
      dataIndex: 'reference',
      width: 200,
      render: (value: string) => value || '-',
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 300,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailRecon(row)}>
            Xem
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            disabled={!canManage || row.status !== 'DRAFT'}
            onClick={() => {
              setEditRecon(row);
              setFormOpen(true);
            }}
          >
            Sửa
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!canManage || row.status !== 'DRAFT'}
            onClick={() =>
              Modal.confirm({
                title: `Xóa phiếu đối soát ${row.code}`,
                content: 'Phiếu nháp sẽ bị xóa khỏi danh sách. Hãy chắc chắn rằng bạn không còn cần dùng hồ sơ này.',
                okText: 'Xóa phiếu',
                cancelText: 'Đóng',
                okButtonProps: { danger: true },
                onOk: () => deleteMutation.mutate(row.id),
              })
            }
          >
            Xóa
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={!canManage || row.status !== 'DRAFT'}
            onClick={() => approveMutation.mutate(row.id)}
          >
            Duyệt
          </Button>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'APPROVED'}
            onClick={() => postMutation.mutate(row.id)}
          >
            Ghi sổ
          </Button>
        </Space>
      ),
    },
  ];

  const handleExport = () => {
    if (!rows.length) return;
    downloadCSV(
      rows.map((row) => ({
        'Mã phiếu': row.code,
        'Ngày sao kê': dayjs(row.statement_date).format('DD/MM/YYYY'),
        'Tài khoản ngân hàng': row.bank_account_name || '',
        'Mã tài khoản': row.bank_account_code || '',
        'Số dư sao kê': Number(row.statement_balance || 0),
        'Số dư sổ': Number(row.book_balance || 0),
        'Chênh lệch': Number(row.delta || 0),
        'Trạng thái': STATUS_META[row.status]?.label ?? row.status,
        'Tham chiếu': row.reference || '',
      })),
      'doi-soat-ngan-hang',
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}

      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">Tài chính</Tag>
                <Tag color="cyan">Ngân hàng</Tag>
                <Tag color="processing">Đối soát</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>
                Trung tâm đối soát ngân hàng
              </Title>
              <Text type="secondary">
                Theo dõi số dư sao kê, chênh lệch đối chiếu và luồng duyệt ghi sổ trong một dashboard dành riêng cho đội tài chính.
              </Text>
            </div>
            <Space wrap>
              <Button icon={<DownloadOutlined />} disabled={!rows.length} onClick={handleExport}>
                Xuất CSV
              </Button>
              {selectedPreset ? (
                <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                  Mẫu đang dùng: {selectedPreset.name}
                </Tag>
              ) : null}
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canManage}
                onClick={() => {
                  setEditRecon(null);
                  setFormOpen(true);
                }}
              >
                Tạo phiếu đối soát
              </Button>
            </Space>
          </div>

          <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Phiếu nháp" value={summary.draftCount} suffix="phiếu" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Chờ duyệt" value={summary.submittedCount} suffix="phiếu" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đã duyệt" value={summary.approvedCount} suffix="phiếu" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đã ghi sổ" value={summary.postedCount} suffix="phiếu" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Phiếu lệch số" value={summary.deltaCount} suffix="phiếu" valueStyle={{ color: summary.deltaCount > 0 ? '#cf1322' : undefined }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tổng lệch tuyệt đối" value={summary.absoluteDelta} formatter={(value) => `${formatMoney(value)} đ`} />
            </div>
          </div>
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-testid="bank-reconciliation-search" style={{ display: 'inline-block' }}>
              <Input
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setPage(1);
                }}
                placeholder="Tìm mã phiếu, tài khoản, tham chiếu..."
                style={{ width: 320 }}
                suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
              />
            </div>
            <Select
              allowClear
              placeholder="Trạng thái"
              style={{ width: 190 }}
              value={filters.status}
              options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))}
              onChange={(value) => {
                setFilters({ status: value });
                setPage(1);
              }}
            />
            <Button
              onClick={() => {
                setSearchInput('');
                setFilters({});
                setPage(1);
                setSelectedPresetId(undefined);
              }}
            >
              Đặt lại bộ lọc
            </Button>
          </div>

          <div
            data-testid="bank-reconciliation-command-strip"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Button
              data-testid="bank-reconciliation-save-view"
              onClick={() => void saveCurrentView()}
              disabled={isPreferencesLoading}
            >
              Lưu chế độ xem
            </Button>
            <Button
              data-testid="bank-reconciliation-restore-view"
              onClick={applySavedView}
              disabled={isPreferencesLoading}
            >
              Áp dụng chế độ đã lưu
            </Button>
            <Button
              data-testid="bank-reconciliation-open-preset-modal"
              onClick={() => {
                setPresetName(selectedPreset?.name ?? '');
                setIsPresetModalOpen(true);
              }}
              disabled={isPreferencesLoading}
            >
              Lưu mẫu mới
            </Button>
            <div data-testid="bank-reconciliation-preset-select" style={{ display: 'inline-block' }}>
              <Select<string>
                allowClear
                placeholder="Chọn mẫu lọc đối soát"
                value={selectedPresetId}
                onChange={(value) => setSelectedPresetId(value)}
                disabled={isPreferencesLoading}
                style={{ width: 220 }}
                options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
              />
            </div>
            <Button
              data-testid="bank-reconciliation-apply-preset"
              onClick={applyNamedPreset}
              disabled={isPreferencesLoading}
            >
              Áp dụng mẫu lọc
            </Button>
            <Button
              danger
              data-testid="bank-reconciliation-delete-preset"
              onClick={() => void deleteNamedPreset()}
              disabled={isPreferencesLoading}
            >
              Xóa mẫu lọc
            </Button>
            {savedViewSnapshot ? <Tag color="default">Có chế độ xem đã lưu</Tag> : null}
          </div>

          <Space wrap>
            {commandContextTags.length > 0 ? (
              commandContextTags.map((tag) => <Tag key={tag}>{tag}</Tag>)
            ) : (
              <Text type="secondary">Đang hiển thị toàn bộ phiếu đối soát ngân hàng.</Text>
            )}
            <Tag color="default">{`Độ lệch cần rà: ${summary.deltaCount}`}</Tag>
            <Tag color="success">{`Sẵn sàng ghi sổ: ${summary.approvedCount}`}</Tag>
          </Space>
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1760 }}
        pagination={{
          current: page,
          pageSize,
          total: listQuery.data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              void saveConfig({ ...config, pageSize: nextPageSize });
            }
          },
        }}
        locale={{
          emptyText:
            rows.length === 0 && !listQuery.isLoading ? (
              <div style={{ padding: 32 }}>
                {activeFilterTags.length > 0 ? (
                  <>
                    <Empty description="Không tìm thấy phiếu đối soát phù hợp." />
                    <Button
                      type="link"
                      onClick={() => {
                        setSearchInput('');
                        setFilters({});
                        setPage(1);
                      }}
                    >
                      Xóa bộ lọc
                    </Button>
                  </>
                ) : (
                  <Empty description="Chưa có phiếu đối soát ngân hàng nào." />
                )}
              </div>
            ) : undefined,
        }}
      />

      <Drawer
        title={detail ? `Chi tiết đối soát · ${detail.code}` : 'Chi tiết đối soát'}
        open={!!detailRecon}
        onClose={() => setDetailRecon(null)}
        width={860}
        extra={
          detail ? (
            <Space wrap>
              <Button
                icon={<EditOutlined />}
                disabled={!canManage || detail.status !== 'DRAFT'}
                onClick={() => {
                  setEditRecon(detail);
                  setFormOpen(true);
                }}
              >
                Sửa nháp
              </Button>
              <Button
                type="primary"
                disabled={!canManage || detail.status !== 'DRAFT'}
                onClick={() => approveMutation.mutate(detail.id)}
              >
                Duyệt
              </Button>
              <Button disabled={!canManage || detail.status !== 'APPROVED'} onClick={() => postMutation.mutate(detail.id)}>
                Ghi sổ
              </Button>
            </Space>
          ) : null
        }
      >
        {detailQuery.isLoading && !detailQuery.data ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small">
              <Descriptions column={2} size="small">
                <Descriptions.Item label="Mã phiếu">{detail.code}</Descriptions.Item>
                <Descriptions.Item label="Trạng thái">
                  <Tag color={STATUS_META[detail.status]?.color ?? 'default'}>{STATUS_META[detail.status]?.label ?? detail.status}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Ngày sao kê">{dayjs(detail.statement_date).format('DD/MM/YYYY')}</Descriptions.Item>
                <Descriptions.Item label="Tài khoản">{detail.bank_account_name || '-'}</Descriptions.Item>
                <Descriptions.Item label="Tham chiếu">{detail.reference || '-'}</Descriptions.Item>
                <Descriptions.Item label="Ghi chú">{detail.note || '-'}</Descriptions.Item>
              </Descriptions>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Số dư sao kê" value={detail.statement_balance} formatter={(value) => `${formatMoney(value)} đ`} />
              </div>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Số dư sổ" value={detail.book_balance} formatter={(value) => `${formatMoney(value)} đ`} />
              </div>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic
                  title="Chênh lệch"
                  value={detail.delta}
                  valueStyle={{ color: Number(detail.delta || 0) === 0 ? '#389e0d' : '#cf1322' }}
                  formatter={(value) => `${formatMoney(value)} đ`}
                />
              </div>
            </div>

            <Alert
              showIcon
              type={Number(detail.delta || 0) === 0 ? 'success' : 'warning'}
              message={Number(detail.delta || 0) === 0 ? 'Phiếu đang cân bằng số liệu' : 'Phiếu vẫn còn chênh lệch cần xử lý'}
              description={
                Number(detail.delta || 0) === 0
                  ? 'Bạn có thể tiếp tục duyệt hoặc ghi sổ khi quy trình nội bộ đã sẵn sàng.'
                  : 'Hãy kiểm tra lại chứng từ tiền gửi, bút toán sổ và các khoản đang treo trước khi duyệt.'
              }
            />
          </Space>
        ) : (
          <Empty description="Không có dữ liệu chi tiết để hiển thị." />
        )}
      </Drawer>

      <Modal
        title="Lưu mẫu lọc đối soát ngân hàng"
        open={isPresetModalOpen}
        onCancel={() => {
          setIsPresetModalOpen(false);
          setPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Hủy"
      >
        <Input
          data-testid="bank-reconciliation-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Chờ duyệt / Có chênh lệch / Chuẩn bị ghi sổ"
          maxLength={80}
          autoFocus
        />
      </Modal>

      <BankReconciliationFormModal
        open={formOpen}
        record={editRecon}
        bankAccounts={bankAccountsQuery.data?.results ?? []}
        onClose={() => {
          setFormOpen(false);
          setEditRecon(null);
        }}
        onSuccess={() => {
          setPage(1);
        }}
      />
    </div>
  );
}

function BankReconciliationFormModal({
  open,
  record,
  bankAccounts,
  onClose,
  onSuccess,
}: {
  open: boolean;
  record: BankReconciliationRecord | null;
  bankAccounts: Array<{ id: number; code?: string; account_number?: string; bank_name?: string }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<BankReconciliationFormValues>();

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        statement_date: record?.statement_date ? dayjs(record.statement_date) : dayjs(),
        bank_account: record?.bank_account,
        statement_balance: Number(record?.statement_balance ?? 0),
        book_balance: Number(record?.book_balance ?? 0),
        reference: record?.reference || undefined,
        note: record?.note || undefined,
      });
    } else {
      form.resetFields();
    }
  }, [form, open, record]);

  const createMutation = useMutation({
    mutationFn: (payload: BankReconciliationPayload) => financeApi.createBankReconciliation(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliations'] });
      messageApi.success('Đã tạo phiếu đối soát mới');
      form.resetFields();
      onClose();
      onSuccess();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => financeApi.updateBankReconciliation(record!.id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliations'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliation-detail'] }),
      ]);
      messageApi.success('Đã cập nhật phiếu đối soát');
      form.resetFields();
      onClose();
      onSuccess();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload = {
      statement_date: values.statement_date.format('YYYY-MM-DD'),
      bank_account: values.bank_account,
      statement_balance: Number(values.statement_balance),
      book_balance: Number(values.book_balance),
      reference: values.reference?.trim() || undefined,
      note: values.note?.trim() || undefined,
    };
    if (record?.id) {
      await updateMutation.mutateAsync(payload);
    } else {
      await createMutation.mutateAsync(payload);
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title={record ? `Cập nhật đối soát · ${record.code}` : 'Tạo phiếu đối soát ngân hàng'}
        open={open}
        onCancel={onClose}
        onOk={handleSubmit}
        okText={record ? 'Lưu thay đổi' : 'Tạo phiếu'}
        cancelText="Đóng"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Ngày sao kê" name="statement_date" rules={[{ required: true, message: 'Chọn ngày sao kê' }]}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="Tài khoản ngân hàng" name="bank_account" rules={[{ required: true, message: 'Chọn tài khoản ngân hàng' }]}>
            <Select
              placeholder="Chọn tài khoản ngân hàng"
              options={bankAccounts.map((item) => ({
                value: item.id,
                label: `${item.code || 'TK'} - ${item.account_number || item.bank_name || 'Chưa có số tài khoản'}`,
              }))}
            />
          </Form.Item>
          <Form.Item label="Số dư sao kê" name="statement_balance" rules={[{ required: true, message: 'Nhập số dư sao kê' }]}>
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="Số dư sổ kế toán" name="book_balance" rules={[{ required: true, message: 'Nhập số dư sổ kế toán' }]}>
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="Tham chiếu" name="reference">
            <Input placeholder="Ví dụ: Mã sao kê ngân hàng hoặc kỳ đối soát" />
          </Form.Item>
          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={3} placeholder="Bổ sung diễn giải nếu có điểm cần lưu ý." />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
