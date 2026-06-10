import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { inventoryApi } from '../../api/inventory';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';
import type { StockAlert, StockAlertStatus, StockAlertType } from '../../types/inventory';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';
import { canManageInventoryData } from '../../utils/authz';

const { Text, Title } = Typography;

type Filters = {
  alert_type?: StockAlertType;
  status?: StockAlertStatus;
};

type StockAlertViewSnapshot = {
  searchInput: string;
  filters: Filters;
};

type StockAlertNamedPreset = {
  id: string;
  name: string;
  snapshot: StockAlertViewSnapshot;
  updatedAt: string;
};

const ALERT_TYPE_LABELS: Record<StockAlertType, string> = {
  LOW_STOCK: 'Tồn kho thấp',
  OUT_OF_STOCK: 'Hết hàng',
};

const ALERT_TYPE_COLORS: Record<StockAlertType, string> = {
  LOW_STOCK: 'warning',
  OUT_OF_STOCK: 'red',
};

const STATUS_LABELS: Record<StockAlertStatus, string> = {
  ACTIVE: 'Đang hoạt động',
  ACKNOWLEDGED: 'Đã xác nhận',
  RESOLVED: 'Đã giải quyết',
};

const STATUS_COLORS: Record<StockAlertStatus, string> = {
  ACTIVE: 'error',
  ACKNOWLEDGED: 'processing',
  RESOLVED: 'success',
};

const STATUS_NEXT_STEPS: Record<StockAlertStatus, string> = {
  ACTIVE: 'Cần xác nhận và mở hướng bổ sung: mua thêm, sản xuất thêm hoặc chuyển kho.',
  ACKNOWLEDGED: 'Đã ghi nhận cảnh báo, tiếp tục theo dõi tới khi tồn quay về mức an toàn.',
  RESOLVED: 'Tồn đã về trạng thái an toàn, giữ lại để tra cứu lịch sử.',
};

function getAlertNextStep(alert: StockAlert): string {
  if (alert.status === 'ACTIVE' && alert.alert_type === 'OUT_OF_STOCK') {
    return 'Hết hàng, cần ưu tiên bổ sung hoặc điều chuyển trước khi nhận thêm nhu cầu xuất.';
  }
  return STATUS_NEXT_STEPS[alert.status] ?? 'Kiểm tra trạng thái cảnh báo trước khi thao tác tiếp.';
}

function getAcknowledgeDisabledReason(alert: StockAlert, canManage: boolean): string {
  if (!canManage) return 'Bạn chưa có quyền xác nhận cảnh báo tồn kho.';
  if (alert.status !== 'ACTIVE') return 'Chỉ xác nhận được cảnh báo đang hoạt động.';
  return '';
}

const SUMMARY_TILE_STYLE = {
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

export default function StockAlertList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const { config, saveConfig } = useUserPreferences(PAGES.INVENTORY_STOCK_ALERTS);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const pageSize = Number(configRecord.pageSize ?? 20);
  const namedPresets = useMemo<StockAlertNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<StockAlertNamedPreset>;
        if (
          typeof preset.id !== 'string' ||
          typeof preset.name !== 'string' ||
          !preset.snapshot ||
          typeof preset.snapshot.searchInput !== 'string' ||
          !preset.snapshot.filters ||
          typeof preset.snapshot.filters !== 'object'
        ) {
          return null;
        }
        return {
          id: preset.id,
          name: preset.name,
          snapshot: {
            searchInput: preset.snapshot.searchInput,
            filters: parseFilters(JSON.stringify(preset.snapshot.filters)),
          },
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is StockAlertNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );
  const canManage = canManageInventoryData();

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const params = {
    page,
    page_size: pageSize,
    q: intentSearch.trim() || undefined,
    alert_type: intentFilters?.alert_type || undefined,
    status: intentFilters?.status || undefined,
  };

  const alertsQuery = useQuery({
    queryKey: ['inventory-stock-alerts', params],
    queryFn: () => inventoryApi.getStockAlerts(params),
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => inventoryApi.acknowledgeAlert(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-stock-alerts'] });
      messageApi.success('Đã xác nhận cảnh báo');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = useMemo(() => alertsQuery.data?.results ?? [], [alertsQuery.data?.results]);

  const summary = useMemo(() => {
    const activeCount = rows.filter((item) => item.status === 'ACTIVE').length;
    const acknowledgedCount = rows.filter((item) => item.status === 'ACKNOWLEDGED').length;
    const resolvedCount = rows.filter((item) => item.status === 'RESOLVED').length;
    const outOfStockCount = rows.filter((item) => item.alert_type === 'OUT_OF_STOCK').length;
    const triggeredTodayCount = rows.filter((item) => dayjs(item.triggered_at).isSame(dayjs(), 'day')).length;
    return {
      activeCount,
      acknowledgedCount,
      resolvedCount,
      outOfStockCount,
      triggeredTodayCount,
    };
  }, [rows]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) {
      tags.push(`Từ khóa: ${intentSearch.trim()}`);
    }
    if (filters.alert_type) {
      tags.push(`Loại: ${ALERT_TYPE_LABELS[filters.alert_type]}`);
    }
    if (filters.status) {
      tags.push(`Trạng thái: ${STATUS_LABELS[filters.status]}`);
    }
    if (selectedViewPreset) {
      tags.push(`Mẫu lọc: ${selectedViewPreset.name}`);
    }
    return tags;
  }, [filters.alert_type, filters.status, intentSearch, selectedViewPreset]);

  const statusAlert = useMemo(() => {
    if (summary.outOfStockCount > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${summary.outOfStockCount} SKU đã rơi vào trạng thái hết hàng trong tập dữ liệu hiện tại. Nên ưu tiên phối hợp mua hàng hoặc điều chuyển kho ngay.`,
      };
    }
    if (summary.activeCount > 0) {
      return {
        type: 'info' as const,
        message: `Hiện còn ${summary.activeCount} cảnh báo active cần đội vận hành xác nhận hoặc giao trách nhiệm xử lý.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Bảng cảnh báo đang ổn định, chưa có điểm nghẽn tồn kho nổi bật trên bộ lọc hiện tại.',
    };
  }, [summary.activeCount, summary.outOfStockCount]);

  const buildCurrentSnapshot = (): StockAlertViewSnapshot => ({
    searchInput,
    filters,
  });

  const applySnapshot = (snapshot: StockAlertViewSnapshot) => {
    setSearchInput(snapshot.searchInput);
    setFilters(snapshot.filters);
    setPage(1);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem cảnh báo tồn kho.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem cảnh báo tồn kho.');
    }
  };

  const applySavedView = () => {
    const raw = configRecord.saved_view as Partial<StockAlertViewSnapshot> | undefined;
    if (!raw || typeof raw.searchInput !== 'string' || !raw.filters || typeof raw.filters !== 'object') {
      messageApi.warning('Chưa có chế độ xem cảnh báo tồn kho đã lưu.');
      return;
    }
    applySnapshot({
      searchInput: raw.searchInput,
      filters: parseFilters(JSON.stringify(raw.filters)),
    });
    messageApi.success('Đã khôi phục chế độ xem cảnh báo tồn kho.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: StockAlertNamedPreset = {
      id:
        existing?.id ??
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}`),
      name,
      snapshot: buildCurrentSnapshot(),
      updatedAt: new Date().toISOString(),
    };
    const nextPresets = existing
      ? namedPresets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        saved_view: configRecord.saved_view,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(nextPreset.id);
      setIsViewPresetModalOpen(false);
      setViewPresetName('');
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc cảnh báo tồn kho.' : 'Đã lưu mẫu lọc cảnh báo tồn kho mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc cảnh báo tồn kho.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc cảnh báo tồn kho.');
      return;
    }
    applySnapshot(preset.snapshot);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc cảnh báo tồn kho để xóa.');
      return;
    }
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        saved_view: configRecord.saved_view,
        saved_views: namedPresets.filter((item) => item.id !== preset.id),
      });
      setSelectedViewPresetId(undefined);
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc cảnh báo tồn kho.');
    }
  };

  const columns: ColumnsType<StockAlert> = [
    {
      title: 'Sản phẩm',
      dataIndex: 'product_name',
      width: 240,
      render: (value: string | undefined) => value || '-',
    },
    {
      title: 'Mã SP',
      dataIndex: 'product_code',
      width: 130,
      render: (value: string | undefined) => value || '-',
    },
    {
      title: 'Loại cảnh báo',
      dataIndex: 'alert_type',
      width: 150,
      render: (value: StockAlertType) => (
        <Tag color={ALERT_TYPE_COLORS[value]}>{ALERT_TYPE_LABELS[value]}</Tag>
      ),
    },
    {
      title: 'Tồn hiện tại',
      dataIndex: 'current_qty',
      width: 120,
      align: 'right',
      render: (value: string) => Number(value || 0).toLocaleString('vi-VN'),
    },
    {
      title: 'Min',
      dataIndex: 'min_stock',
      width: 120,
      align: 'right',
      render: (value: string) => Number(value || 0).toLocaleString('vi-VN'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 300,
      render: (_: StockAlertStatus, row) => (
        <Space direction="vertical" size={4}>
          <Tag color={STATUS_COLORS[row.status]}>{STATUS_LABELS[row.status]}</Tag>
          <Text data-testid={`stock-alert-next-step-${row.id}`} type="secondary" style={{ fontSize: 12 }}>
            {getAlertNextStep(row)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Phát sinh',
      dataIndex: 'triggered_at',
      width: 170,
      render: (value: string) => dayjs(value).format('DD/MM/YYYY HH:mm'),
    },
    {
      title: 'Thao tác',
      width: 190,
      render: (_, row) => {
        const disabledReason = getAcknowledgeDisabledReason(row, canManage);
        return (
          <Button
            size="small"
            type="primary"
            icon={<CheckOutlined />}
            disabled={Boolean(disabledReason)}
            title={disabledReason || 'Xác nhận đã thấy cảnh báo và đang xử lý bổ sung tồn'}
            onClick={() => acknowledgeMutation.mutate(row.id)}
            loading={acknowledgeMutation.isPending}
          >
            Xác nhận
          </Button>
        );
      },
    },
  ];

  const handleResetFilters = () => {
    setSearchInput('');
    setFilters({});
    setPage(1);
  };

  const handleExportCSV = () => {
    if (rows.length === 0) return;
    const exportRows = rows.map((row) => ({
      'Sản phẩm': row.product_name || '',
      'Mã SP': row.product_code || '',
      'Loại': ALERT_TYPE_LABELS[row.alert_type],
      'Tồn hiện tại': Number(row.current_qty || 0).toLocaleString('vi-VN'),
      'Tồn tối thiểu': Number(row.min_stock || 0).toLocaleString('vi-VN'),
      'Trạng thái': STATUS_LABELS[row.status],
      'Ngày phát sinh': dayjs(row.triggered_at).format('DD/MM/YYYY HH:mm'),
    }));
    downloadCSV(exportRows, 'canh-bao-ton-kho');
  };

  if (alertsQuery.isLoading && !alertsQuery.data) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}

      <Card bordered={false} style={{ borderRadius: 20 }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 16 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <Space wrap>
              <Tag color="blue">Inventory</Tag>
              <Tag color="volcano">Watchlist</Tag>
              <Tag color="processing">Replenishment</Tag>
            </Space>
            <Title level={3} style={{ margin: '8px 0 4px' }}>
              Trung tâm cảnh báo tồn kho
            </Title>
            <Text type="secondary">
              Theo dõi cảnh báo tồn thấp và hết hàng, gom nhanh các SKU cần phản hồi,
              rồi khóa thao tác xác nhận để điều phối mua hàng hoặc điều chuyển kho.
            </Text>
          </div>
          <Button icon={<DownloadOutlined />} disabled={rows.length === 0} onClick={handleExportCSV}>
            Xuất CSV
          </Button>
        </div>

        <Alert showIcon type={statusAlert.type} message={statusAlert.message} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Cảnh báo active" value={summary.activeCount} suffix="mục" valueStyle={{ color: summary.activeCount > 0 ? '#cf1322' : undefined }} />
          </div>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Hết hàng" value={summary.outOfStockCount} suffix="SKU" valueStyle={{ color: summary.outOfStockCount > 0 ? '#d4380d' : undefined }} />
          </div>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đã xác nhận" value={summary.acknowledgedCount} suffix="mục" />
          </div>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đã giải quyết" value={summary.resolvedCount} suffix="mục" />
          </div>
        </div>
      </Card>

      <Card bordered={false} style={{ borderRadius: 18 }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }} data-testid="stock-alerts-command-strip">
          <div data-testid="stock-alerts-command-search">
          <Input
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setPage(1);
            }}
            placeholder="Tìm mã sản phẩm, tên..."
            style={{ width: 280 }}
            suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
          />
          </div>
          <Select
            style={{ width: 220 }}
            placeholder="Loại cảnh báo"
            allowClear
            value={filters.alert_type}
            onChange={(value) => {
              setFilters((current) => ({ ...current, alert_type: value }));
              setPage(1);
            }}
            options={Object.entries(ALERT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Select
            style={{ width: 220 }}
            placeholder="Trạng thái"
            allowClear
            value={filters.status}
            onChange={(value) => {
              setFilters((current) => ({ ...current, status: value }));
              setPage(1);
            }}
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Button onClick={handleResetFilters}>Xóa bộ lọc</Button>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button data-testid="stock-alerts-save-view" onClick={() => void saveCurrentView()}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="stock-alerts-restore-view" onClick={applySavedView}>
            Khôi phục
          </Button>
          <Button
            data-testid="stock-alerts-open-preset-modal"
            onClick={() => {
              setViewPresetName(selectedViewPreset?.name ?? '');
              setIsViewPresetModalOpen(true);
            }}
          >
            Tạo mẫu lọc
          </Button>
          <div data-testid="stock-alerts-preset-select">
            <Select
              style={{ width: 240 }}
              placeholder="Chọn mẫu lọc cảnh báo"
              value={selectedViewPresetId}
              onChange={(value) => setSelectedViewPresetId(value)}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button data-testid="stock-alerts-apply-preset" onClick={applyNamedPreset}>
            Áp dụng mẫu
          </Button>
          <Button danger data-testid="stock-alerts-delete-preset" onClick={() => void deleteNamedPreset()}>
            Xóa mẫu
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {activeFilterTags.length > 0 ? activeFilterTags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Text type="secondary">Đang hiển thị toàn bộ cảnh báo tồn kho.</Text>}
          <Tag color="blue">{`Phát sinh hôm nay: ${summary.triggeredTodayCount}`}</Tag>
        </div>
      </Card>

      <Modal
        title="Lưu mẫu lọc cảnh báo tồn kho"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Đóng"
      >
        <Form layout="vertical">
          <Form.Item label="Tên mẫu lọc">
            <Input
              data-testid="stock-alerts-preset-name"
              value={viewPresetName}
              onChange={(event) => setViewPresetName(event.target.value)}
              placeholder="Ví dụ: Hết hàng cần xử lý trong ngày"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Table
        rowKey="id"
        loading={alertsQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1500 }}
        pagination={{
          current: page,
          pageSize,
          total: alertsQuery.data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: async (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              await saveConfig({ ...configRecord, pageSize: nextPageSize });
            }
          },
        }}
        locale={{
          emptyText:
            rows.length === 0 && !alertsQuery.isLoading ? (
              <div style={{ padding: 40 }}>
                {activeFilterTags.length > 0 ? (
                  <>
                    <Empty description="Không tìm thấy cảnh báo phù hợp." />
                    <Button type="link" onClick={handleResetFilters}>
                      Xóa bộ lọc
                    </Button>
                  </>
                ) : (
                  <Empty description="Không có cảnh báo tồn kho." />
                )}
              </div>
            ) : undefined,
        }}
      />
    </div>
  );
}
