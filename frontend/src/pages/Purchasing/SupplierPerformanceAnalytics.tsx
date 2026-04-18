import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Input, Modal, Rate, Row, Select, Skeleton, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import { useUserPreferences } from '../../hooks/useUserPreferences';
import { purchasingApi } from '../../api/purchasing';
import type { SupplierAnalyticsRow } from '../../types/purchasing';
import { PAGES } from '../../utils/constants';
import { downloadCSV } from '../../utils/csvExport';

const { Text, Title } = Typography;

type SupplierAnalyticsDisplayRow = SupplierAnalyticsRow & {
  id: number;
  supplier: string;
  on_time_rate: number;
  quality_score: number;
  price_variance: number;
  lead_time: number;
};

type SupplierFocusMode = 'all' | 'risky' | 'excellent';
type SupplierSortMode = 'score' | 'on_time' | 'quality' | 'lead_time' | 'price_variance';

type SupplierAnalyticsViewSnapshot = {
  focusMode: SupplierFocusMode;
  sortMode: SupplierSortMode;
};

type SupplierAnalyticsNamedPreset = {
  id: string;
  name: string;
  snapshot: SupplierAnalyticsViewSnapshot;
  updatedAt: string;
};

const SUMMARY_TILE_STYLE: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function SupplierPerformanceAnalytics() {
  const [messageApi, contextHolder] = message.useMessage();
  const [focusMode, setFocusMode] = useState<SupplierFocusMode>('all');
  const [sortMode, setSortMode] = useState<SupplierSortMode>('score');
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const { config, saveConfig } = useUserPreferences(PAGES.PURCHASING_SUPPLIER_ANALYTICS);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const namedPresets = useMemo<SupplierAnalyticsNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<SupplierAnalyticsNamedPreset>;
        if (
          typeof preset.id !== 'string' ||
          typeof preset.name !== 'string' ||
          !preset.snapshot ||
          typeof preset.snapshot.focusMode !== 'string' ||
          typeof preset.snapshot.sortMode !== 'string'
        ) {
          return null;
        }
        return {
          id: preset.id,
          name: preset.name,
          snapshot: {
            focusMode: preset.snapshot.focusMode as SupplierFocusMode,
            sortMode: preset.snapshot.sortMode as SupplierSortMode,
          },
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is SupplierAnalyticsNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );
  const { data: list = [], isLoading } = useQuery({
    queryKey: ['supplier-analytics'],
    queryFn: () => purchasingApi.getSupplierAnalytics(),
  });

  const displayData = useMemo<SupplierAnalyticsDisplayRow[]>(
    () =>
      list.map((row, idx) => ({
        ...row,
        id: Number(row.id ?? row.supplier_id ?? idx + 1),
        supplier: row.supplier ?? row.supplier_name ?? '-',
        on_time_rate: toNumber(row.on_time_rate ?? row.on_time_delivery_rate),
        quality_score: toNumber(row.quality_score),
        price_variance: toNumber(row.price_variance),
        lead_time: toNumber(row.lead_time),
      })),
    [list],
  );

  const filteredData = useMemo(() => {
    if (focusMode === 'risky') {
      return displayData.filter(
        (row) => row.on_time_rate < 85 || row.quality_score < 4 || row.price_variance > 5 || row.lead_time > 14,
      );
    }
    if (focusMode === 'excellent') {
      return displayData.filter(
        (row) => row.on_time_rate >= 95 && row.quality_score >= 4.5 && row.lead_time <= 7,
      );
    }
    return displayData;
  }, [displayData, focusMode]);

  const tableData = useMemo(() => {
    const rows = [...filteredData];
    rows.sort((left, right) => {
      if (sortMode === 'on_time') return right.on_time_rate - left.on_time_rate;
      if (sortMode === 'quality') return right.quality_score - left.quality_score;
      if (sortMode === 'lead_time') return left.lead_time - right.lead_time;
      if (sortMode === 'price_variance') return Math.abs(right.price_variance) - Math.abs(left.price_variance);
      const rightScore = right.on_time_rate + right.quality_score * 10 - right.lead_time;
      const leftScore = left.on_time_rate + left.quality_score * 10 - left.lead_time;
      return rightScore - leftScore;
    });
    return rows;
  }, [filteredData, sortMode]);

  const commandSummary = useMemo(() => {
    const riskySuppliers = tableData.filter(
      (row) => row.on_time_rate < 85 || row.quality_score < 4 || row.price_variance > 5 || row.lead_time > 14,
    );
    const excellentSuppliers = tableData.filter(
      (row) => row.on_time_rate >= 95 && row.quality_score >= 4.5 && row.lead_time <= 7,
    );
    const averageOnTime = tableData.length
      ? tableData.reduce((sum, row) => sum + row.on_time_rate, 0) / tableData.length
      : 0;
    const averageQuality = tableData.length
      ? tableData.reduce((sum, row) => sum + row.quality_score, 0) / tableData.length
      : 0;
    const longLeadSuppliers = tableData.filter((row) => row.lead_time > 14).length;
    const priceVolatilitySuppliers = tableData.filter((row) => Math.abs(row.price_variance) >= 5).length;
    const topSupplier = [...tableData].sort((left, right) => {
      const rightScore = right.on_time_rate + right.quality_score * 10 - right.lead_time;
      const leftScore = left.on_time_rate + left.quality_score * 10 - left.lead_time;
      return rightScore - leftScore;
    })[0];
    return {
      riskySuppliers,
      excellentSuppliers,
      averageOnTime,
      averageQuality,
      longLeadSuppliers,
      priceVolatilitySuppliers,
      topSupplier,
    };
  }, [tableData]);

  const statusAlert = useMemo(() => {
    if (commandSummary.riskySuppliers.length > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${commandSummary.riskySuppliers.length} nhà cung cấp cần rà soát trong ca mua hàng hiện tại.`,
        description:
          'Ưu tiên xem các nhà cung cấp có tỷ lệ giao đúng hạn thấp, lead time kéo dài hoặc biến động giá lớn trước khi chốt đơn mới.',
      };
    }
    if (commandSummary.longLeadSuppliers > 0 || commandSummary.priceVolatilitySuppliers > 0) {
      return {
        type: 'info' as const,
        message: 'Hiệu suất nhà cung cấp đang ổn định nhưng vẫn có tín hiệu vận hành cần theo dõi.',
        description: `Hiện có ${commandSummary.longLeadSuppliers} nhà cung cấp lead time dài và ${commandSummary.priceVolatilitySuppliers} nhà cung cấp biến động giá mạnh.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Danh mục nhà cung cấp đang ở trạng thái khỏe.',
      description:
        'Bạn có thể dùng màn này như bảng điều phối nhanh để đối chiếu chất lượng giao hàng, lead time và mức ổn định giá trước khi phân bổ đơn mua.',
    };
  }, [commandSummary.longLeadSuppliers, commandSummary.priceVolatilitySuppliers, commandSummary.riskySuppliers.length]);

  const activeContextTags = useMemo(() => {
    const tags = [
      focusMode === 'all' ? 'Lane: Toàn bộ' : focusMode === 'risky' ? 'Lane: Cần rà soát' : 'Lane: Đối tác ưu tiên',
      sortMode === 'score'
        ? 'Ưu tiên: Điểm tổng hợp'
        : sortMode === 'on_time'
          ? 'Ưu tiên: Đúng hạn'
          : sortMode === 'quality'
            ? 'Ưu tiên: Chất lượng'
            : sortMode === 'lead_time'
              ? 'Ưu tiên: Lead time'
              : 'Ưu tiên: Biến động giá',
      `Hiển thị: ${tableData.length} nhà cung cấp`,
    ];
    if (selectedViewPreset) {
      tags.push(`Mẫu lọc: ${selectedViewPreset.name}`);
    }
    return tags;
  }, [focusMode, selectedViewPreset, sortMode, tableData.length]);

  const buildCurrentSnapshot = (): SupplierAnalyticsViewSnapshot => ({
    focusMode,
    sortMode,
  });

  const applySnapshot = (snapshot: SupplierAnalyticsViewSnapshot) => {
    setFocusMode(snapshot.focusMode);
    setSortMode(snapshot.sortMode);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem hiệu suất nhà cung cấp.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem hiệu suất nhà cung cấp.');
    }
  };

  const applySavedView = () => {
    const raw = configRecord.saved_view as Partial<SupplierAnalyticsViewSnapshot> | undefined;
    if (!raw || typeof raw.focusMode !== 'string' || typeof raw.sortMode !== 'string') {
      messageApi.warning('Chưa có chế độ xem hiệu suất nhà cung cấp đã lưu.');
      return;
    }
    applySnapshot({
      focusMode: raw.focusMode as SupplierFocusMode,
      sortMode: raw.sortMode as SupplierSortMode,
    });
    messageApi.success('Đã khôi phục chế độ xem hiệu suất nhà cung cấp.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: SupplierAnalyticsNamedPreset = {
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
        saved_view: configRecord.saved_view,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(nextPreset.id);
      setIsViewPresetModalOpen(false);
      setViewPresetName('');
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc hiệu suất nhà cung cấp.' : 'Đã lưu mẫu lọc hiệu suất nhà cung cấp mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc hiệu suất nhà cung cấp.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc hiệu suất nhà cung cấp.');
      return;
    }
    applySnapshot(preset.snapshot);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc hiệu suất nhà cung cấp để xóa.');
      return;
    }
    try {
      await saveConfig({
        ...configRecord,
        saved_view: configRecord.saved_view,
        saved_views: namedPresets.filter((item) => item.id !== preset.id),
      });
      setSelectedViewPresetId(undefined);
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc hiệu suất nhà cung cấp.');
    }
  };

  const columns: ColumnsType<SupplierAnalyticsDisplayRow> = [
    {
      title: 'Nhà cung cấp',
      dataIndex: 'supplier',
      width: 220,
      render: (_: string, row) => (
        <Space direction="vertical" size={2}>
          <span>{row.supplier}</span>
          {(row.on_time_rate < 85 || row.quality_score < 4 || row.lead_time > 14) && (
            <Tag color="warning">Cần rà soát</Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Đúng hạn',
      dataIndex: 'on_time_rate',
      width: 130,
      align: 'center',
      render: (value: number) => (
        <span style={{ color: value >= 95 ? '#389e0d' : value >= 85 ? '#1677ff' : '#cf1322', fontWeight: 600 }}>
          {value.toFixed(1)}%
        </span>
      ),
    },
    {
      title: 'Chất lượng',
      dataIndex: 'quality_score',
      width: 140,
      align: 'center',
      render: (value: number) => <Rate disabled value={value || 0} allowHalf />,
    },
    {
      title: 'Biến động giá',
      dataIndex: 'price_variance',
      width: 140,
      align: 'center',
      render: (value: number) => (
        <span style={{ color: value > 0 ? '#cf1322' : value < 0 ? '#389e0d' : '#595959', fontWeight: 600 }}>
          {value > 0 ? '+' : ''}
          {value.toFixed(1)}%
        </span>
      ),
    },
    {
      title: 'Lead time',
      dataIndex: 'lead_time',
      width: 140,
      align: 'center',
      render: (value: number) => `${value.toFixed(1)} ngày`,
    },
    {
      title: 'Nhận định',
      key: 'assessment',
      width: 220,
      render: (_: unknown, row) => {
        if (row.on_time_rate < 85) return <Tag color="error">Rủi ro giao trễ</Tag>;
        if (row.lead_time > 14) return <Tag color="warning">Lead time dài</Tag>;
        if (Math.abs(row.price_variance) >= 5) return <Tag color="processing">Giá biến động mạnh</Tag>;
        if (row.quality_score >= 4.5 && row.on_time_rate >= 95) return <Tag color="success">Đối tác ưu tiên</Tag>;
        return <Tag>Ổn định</Tag>;
      },
    },
  ];

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={[16, 16]} justify="space-between" align="middle">
            <Col xs={24} lg={16}>
              <Space direction="vertical" size={6}>
                <Space wrap>
                  <Tag color="blue">Mua hàng</Tag>
                  <Tag color="gold">Đánh giá nhà cung cấp</Tag>
                  <Tag color="geekblue">Theo dõi trực tiếp</Tag>
                </Space>
                <Title level={3} style={{ margin: 0 }}>
                  Trung tâm hiệu suất nhà cung cấp
                </Title>
                <Text type="secondary">
                  Theo dõi nhanh tỷ lệ giao đúng hạn, chất lượng, lead time và độ ổn định giá để ưu tiên nhà cung cấp cho các đợt mua mới.
                </Text>
              </Space>
            </Col>
            <Col>
              <Button icon={<DownloadOutlined />} onClick={() => downloadCSV(tableData, 'supplier-analytics')}>
                Xuất báo cáo CSV
              </Button>
            </Col>
          </Row>

          <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }} data-testid="supplier-analytics-command-strip">
            <div data-testid="supplier-analytics-focus-select">
              <Select
                style={{ width: 220 }}
                value={focusMode}
                onChange={(value) => setFocusMode(value)}
                options={[
                  { value: 'all', label: 'Toàn bộ nhà cung cấp' },
                  { value: 'risky', label: 'Cần rà soát' },
                  { value: 'excellent', label: 'Đối tác ưu tiên' },
                ]}
              />
            </div>
            <div data-testid="supplier-analytics-sort-select">
              <Select
                style={{ width: 220 }}
                value={sortMode}
                onChange={(value) => setSortMode(value)}
                options={[
                  { value: 'score', label: 'Điểm tổng hợp' },
                  { value: 'on_time', label: 'Đúng hạn' },
                  { value: 'quality', label: 'Chất lượng' },
                  { value: 'lead_time', label: 'Lead time' },
                  { value: 'price_variance', label: 'Biến động giá' },
                ]}
              />
            </div>
            <Button data-testid="supplier-analytics-save-view" onClick={() => void saveCurrentView()}>
              Lưu chế độ xem
            </Button>
            <Button data-testid="supplier-analytics-restore-view" onClick={applySavedView}>
              Khôi phục
            </Button>
            <Button
              data-testid="supplier-analytics-open-preset-modal"
              onClick={() => {
                setViewPresetName(selectedViewPreset?.name ?? '');
                setIsViewPresetModalOpen(true);
              }}
            >
              Tạo mẫu lọc
            </Button>
            <div data-testid="supplier-analytics-preset-select">
              <Select
                style={{ width: 240 }}
                placeholder="Chọn mẫu lọc nhà cung cấp"
                value={selectedViewPresetId}
                onChange={(value) => setSelectedViewPresetId(value)}
                options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
              />
            </div>
            <Button data-testid="supplier-analytics-apply-preset" onClick={applyNamedPreset}>
              Áp dụng mẫu
            </Button>
            <Button danger data-testid="supplier-analytics-delete-preset" onClick={() => void deleteNamedPreset()}>
              Xóa mẫu
            </Button>
          </div>

          <Row gutter={[16, 16]}>
            <Col xs={24} md={12} xl={6}>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Nhà cung cấp đang theo dõi" value={displayData.length} suffix="đơn vị" />
              </div>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Tỷ lệ đúng hạn bình quân" value={commandSummary.averageOnTime} precision={1} suffix="%" />
              </div>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Điểm chất lượng bình quân" value={commandSummary.averageQuality} precision={1} suffix="/5" />
              </div>
            </Col>
            <Col xs={24} md={12} xl={6}>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic
                  title="Nhà cung cấp cần rà soát"
                  value={commandSummary.riskySuppliers.length}
                  valueStyle={{ color: commandSummary.riskySuppliers.length > 0 ? '#cf1322' : '#389e0d' }}
                  suffix="đơn vị"
                />
              </div>
            </Col>
          </Row>

          <Space wrap>
            {activeContextTags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
            <Tag color="default">{`Đối tác ưu tiên: ${commandSummary.excellentSuppliers.length}`}</Tag>
            <Tag color="warning">{`Lead time trên 14 ngày: ${commandSummary.longLeadSuppliers}`}</Tag>
            <Tag color="processing">{`Biến động giá mạnh: ${commandSummary.priceVolatilitySuppliers}`}</Tag>
            {commandSummary.topSupplier ? (
              <Tag color="success">{`Top hiện tại: ${commandSummary.topSupplier.supplier}`}</Tag>
            ) : null}
          </Space>
        </Space>
      </Card>

      <Card title="Bảng đánh giá theo nhà cung cấp">
        {isLoading ? (
          <Skeleton active />
        ) : (
          <Table columns={columns} dataSource={tableData} pagination={false} rowKey="id" scroll={{ x: 980 }} />
        )}
      </Card>

      <Modal
        title="Lưu mẫu lọc hiệu suất nhà cung cấp"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Đóng"
      >
        <Input
          data-testid="supplier-analytics-preset-name"
          value={viewPresetName}
          onChange={(event) => setViewPresetName(event.target.value)}
          placeholder="Ví dụ: Lane rủi ro - ưu tiên giao hàng"
        />
      </Modal>
    </div>
  );
}
