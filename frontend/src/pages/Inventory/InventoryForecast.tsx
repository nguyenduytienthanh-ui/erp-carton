import { useMemo, useState } from 'react';
import { Button, Empty, Form, Input, Modal, Select, Skeleton, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertOutlined, DownloadOutlined, FireOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { inventoryApi } from '../../api/inventory';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import type { InventoryForecastRow } from '../../types/inventory';
import { PAGES } from '../../utils/constants';
import { downloadCSV } from '../../utils/csvExport';

const monthOptions = [
  { label: '1 thang', value: 1 },
  { label: '3 thang', value: 3 },
  { label: '6 thang', value: 6 },
];

const leadTimeOptions = [
  { label: '7 ngay', value: 7 },
  { label: '14 ngay', value: 14 },
  { label: '21 ngay', value: 21 },
];

const riskOrder: Record<string, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

const riskLabelMap: Record<string, string> = {
  HIGH: 'Cao',
  MEDIUM: 'Trung binh',
  LOW: 'Thap',
};

function riskWeight(row: InventoryForecastRow): number {
  return (
    (row.stockout_risk === 'HIGH' ? 100 : row.stockout_risk === 'MEDIUM' ? 60 : 20) +
    (row.status === 'ALERT' ? 40 : row.status === 'WARNING' ? 20 : 0) +
    Math.max(0, 30 - Number(row.coverage_days ?? 0))
  );
}

function formatQty(value?: number | string | null): string {
  return Number(value ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
}

type InventoryForecastViewSnapshot = {
  months: number;
  leadTime: number;
  sortBy: 'risk' | 'abc' | 'eoq' | 'reorder';
};

type InventoryForecastNamedPreset = {
  id: string;
  name: string;
  snapshot: InventoryForecastViewSnapshot;
  updatedAt: string;
};

export default function InventoryForecast() {
  const [messageApi, contextHolder] = message.useMessage();
  const [sortBy, setSortBy] = useState<'risk' | 'abc' | 'eoq' | 'reorder'>('risk');
  const [months, setMonths] = useState(3);
  const [leadTime, setLeadTime] = useState(7);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const { config, saveConfig } = useUserPreferences(PAGES.INVENTORY_FORECAST_DASHBOARD);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const namedPresets = useMemo<InventoryForecastNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<InventoryForecastNamedPreset>;
        if (
          typeof preset.id !== 'string' ||
          typeof preset.name !== 'string' ||
          !preset.snapshot ||
          typeof preset.snapshot.months !== 'number' ||
          typeof preset.snapshot.leadTime !== 'number' ||
          typeof preset.snapshot.sortBy !== 'string'
        ) {
          return null;
        }
        return {
          id: preset.id,
          name: preset.name,
          snapshot: {
            months: preset.snapshot.months,
            leadTime: preset.snapshot.leadTime,
            sortBy: preset.snapshot.sortBy as InventoryForecastViewSnapshot['sortBy'],
          },
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is InventoryForecastNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );

  const { data = [], isLoading } = useQuery({
    queryKey: ['inventory-forecast', months, leadTime],
    queryFn: () => inventoryApi.getInventoryForecast({ months, lead_time: leadTime }),
  });

  const sortedData = useMemo(() => {
    const rows = [...data];
    rows.sort((left, right) => {
      if (sortBy === 'abc') {
        return left.abc_class.localeCompare(right.abc_class);
      }
      if (sortBy === 'eoq') {
        return right.eoq - left.eoq;
      }
      if (sortBy === 'reorder') {
        return right.reorder_point - left.reorder_point;
      }
      return riskOrder[left.stockout_risk] - riskOrder[right.stockout_risk];
    });
    return rows;
  }, [data, sortBy]);

  const summary = useMemo(() => {
    const alertCount = sortedData.filter((row) => row.status === 'ALERT').length;
    const warningCount = sortedData.filter((row) => row.status === 'WARNING').length;
    const okCount = sortedData.filter((row) => row.status === 'OK').length;
    const totalEoq = sortedData.reduce((sum, row) => sum + Number(row.eoq ?? 0), 0);
    const averageCoverage =
      sortedData.length > 0
        ? sortedData.reduce((sum, row) => sum + Number(row.coverage_days ?? 0), 0) / sortedData.length
        : 0;
    const aClassCount = sortedData.filter((row) => row.abc_class === 'A').length;
    return { alertCount, warningCount, okCount, totalEoq, averageCoverage, aClassCount };
  }, [sortedData]);

  const alertMessage = useMemo(() => {
    if (summary.alertCount > 0) {
      return {
        title: `Co ${summary.alertCount} mat hang can dat mua ngay`,
        description: 'Uu tien nhom co coverage thap, stockout risk cao hoac reorder point dang vuot ton hien tai.',
        tone: 'warning' as const,
      };
    }
    if (summary.warningCount > 0) {
      return {
        title: 'Ton kho dang can theo doi sat',
        description: 'Luong forecast dang on nhung van co nhom san pham nen chot ke hoach mua som trong ky toi.',
        tone: 'warning' as const,
      };
    }
    return {
      title: 'Forecast dang o trang thai on dinh',
      description: 'Chua co nhom san pham nao phat tin hieu stockout noi bat tren bo du lieu hien tai.',
      tone: 'steady' as const,
    };
  }, [summary.alertCount, summary.warningCount]);

  const priorityRows = useMemo(() => [...sortedData].sort((left, right) => riskWeight(right) - riskWeight(left)).slice(0, 5), [sortedData]);

  const activeContextTags = useMemo(() => {
    const tags = [`Chu kỳ: ${months} tháng`, `Lead time: ${leadTime} ngày`];
    const sortLabel =
      sortBy === 'risk' ? 'Rủi ro' : sortBy === 'abc' ? 'ABC' : sortBy === 'eoq' ? 'EOQ' : 'Điểm đặt hàng';
    tags.push(`Ưu tiên: ${sortLabel}`);
    if (selectedViewPreset) {
      tags.push(`Mẫu lọc: ${selectedViewPreset.name}`);
    }
    return tags;
  }, [leadTime, months, selectedViewPreset, sortBy]);

  const buildCurrentSnapshot = (): InventoryForecastViewSnapshot => ({
    months,
    leadTime,
    sortBy,
  });

  const applySnapshot = (snapshot: InventoryForecastViewSnapshot) => {
    setMonths(snapshot.months);
    setLeadTime(snapshot.leadTime);
    setSortBy(snapshot.sortBy);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem dự báo tồn kho.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem dự báo tồn kho.');
    }
  };

  const applySavedView = () => {
    const raw = configRecord.saved_view as Partial<InventoryForecastViewSnapshot> | undefined;
    if (
      !raw ||
      typeof raw.months !== 'number' ||
      typeof raw.leadTime !== 'number' ||
      typeof raw.sortBy !== 'string'
    ) {
      messageApi.warning('Chưa có chế độ xem dự báo tồn kho đã lưu.');
      return;
    }
    applySnapshot({
      months: raw.months,
      leadTime: raw.leadTime,
      sortBy: raw.sortBy as InventoryForecastViewSnapshot['sortBy'],
    });
    messageApi.success('Đã khôi phục chế độ xem dự báo tồn kho.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: InventoryForecastNamedPreset = {
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc dự báo tồn kho.' : 'Đã lưu mẫu lọc dự báo tồn kho mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc dự báo tồn kho.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc dự báo tồn kho.');
      return;
    }
    applySnapshot(preset.snapshot);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc dự báo tồn kho để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc dự báo tồn kho.');
    }
  };

  const columns: ColumnsType<InventoryForecastRow> = [
    { title: 'Ma SP', dataIndex: 'product_code', width: 120 },
    { title: 'Ten san pham', dataIndex: 'product_name', width: 220 },
    { title: 'Ton hien tai', dataIndex: 'current_stock', width: 120, align: 'right', render: (value) => formatQty(value) },
    { title: 'ABC', dataIndex: 'abc_class', width: 90, render: (value) => <Tag color={value === 'A' ? 'red' : value === 'B' ? 'orange' : 'green'}>{value}</Tag> },
    { title: 'Dung binh quan/thang', dataIndex: 'avg_monthly_usage', width: 150, align: 'right', render: (value) => formatQty(value) },
    { title: 'Ton an toan', dataIndex: 'safety_stock', width: 120, align: 'right', render: (value) => formatQty(value) },
    { title: 'Diem dat hang', dataIndex: 'reorder_point', width: 130, align: 'right', render: (value) => formatQty(value) },
    { title: 'EOQ', dataIndex: 'eoq', width: 110, align: 'right', render: (value) => formatQty(value) },
    { title: 'Coverage', dataIndex: 'coverage_days', width: 120, align: 'right', render: (value) => (value == null ? '-' : `${formatQty(value)} ngay`) },
    { title: 'Rui ro', dataIndex: 'stockout_risk', width: 120, render: (value) => <Tag color={value === 'HIGH' ? 'error' : value === 'MEDIUM' ? 'warning' : 'success'}>{riskLabelMap[value] || value}</Tag> },
  ];

  return (
    <div className="command-center">
      {contextHolder}
      <section className="command-center-hero">
        <div className="command-center-hero-grid">
          <div>
            <div className="command-center-eyebrow">Inventory analytics · Replenishment · Forecast</div>
            <div className="command-center-title">Bang dieu khien du bao ton kho</div>
            <div className="command-center-description">
              Gop nhu cau ban hang, ton hien tai va lead time vao mot workspace de doi kho va mua hang chot nhanh nhom san pham can tai bo sung.
            </div>
            <div className="command-center-hero-badges">
              <div className="command-center-hero-badge"><AlertOutlined /> Alert <span className="command-center-hero-badge-value">{summary.alertCount}</span></div>
              <div className="command-center-hero-badge"><FireOutlined /> ABC A <span className="command-center-hero-badge-value">{summary.aClassCount}</span></div>
              <div className="command-center-hero-badge"><SafetyCertificateOutlined /> Coverage <span className="command-center-hero-badge-value">{summary.averageCoverage.toFixed(1)} ngay</span></div>
            </div>
            <div className="command-center-hero-actions">
              <div data-testid="inventory-forecast-months">
                <Select value={months} onChange={setMonths} options={monthOptions} style={{ width: 140 }} />
              </div>
              <div data-testid="inventory-forecast-lead-time">
                <Select value={leadTime} onChange={setLeadTime} options={leadTimeOptions} style={{ width: 140 }} />
              </div>
              <div data-testid="inventory-forecast-sort-by">
                <Select value={sortBy} onChange={setSortBy} options={[{ label: 'Rui ro', value: 'risk' }, { label: 'ABC', value: 'abc' }, { label: 'EOQ', value: 'eoq' }, { label: 'Diem dat hang', value: 'reorder' }]} style={{ width: 160 }} />
              </div>
              <Button icon={<DownloadOutlined />} onClick={() => downloadCSV(sortedData, `inventory-forecast-${dayjs().format('YYYYMMDD')}`)}>
                Xuat CSV
              </Button>
            </div>
          </div>
          <div className="command-center-hero-meta">
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Tong EOQ de xuat</div>
              <div className="command-center-hero-card-value">{formatQty(summary.totalEoq)}</div>
              <div className="command-center-hero-card-caption">Tong luong dat hang toi uu de doi mua hang tham chieu trong ky forecast dang chon.</div>
            </div>
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Trang thai workspace</div>
              <div className="command-center-hero-card-value">{summary.okCount}</div>
              <div className="command-center-hero-card-caption">So dong forecast dang nam trong nguong on dinh.</div>
            </div>
          </div>
        </div>
      </section>

      <div className={`command-center-finance-alert ${alertMessage.tone === 'steady' ? 'command-center-finance-alert--steady' : 'command-center-finance-alert--warning'}`}>
        <div>
          <div className="command-center-finance-alert-title">{alertMessage.title}</div>
          <div className="command-center-finance-alert-description">{alertMessage.description}</div>
        </div>
        <Tag color="processing">{`${months} thang · lead time ${leadTime} ngay`}</Tag>
      </div>

      <div className="workspace-toolbar" data-testid="inventory-forecast-command-strip">
        <div className="workspace-toolbar-group">
          <Button data-testid="inventory-forecast-save-view" onClick={() => void saveCurrentView()}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="inventory-forecast-restore-view" onClick={applySavedView}>
            Khôi phục
          </Button>
          <Button
            data-testid="inventory-forecast-open-preset-modal"
            onClick={() => {
              setViewPresetName(selectedViewPreset?.name ?? '');
              setIsViewPresetModalOpen(true);
            }}
          >
            Tạo mẫu lọc
          </Button>
          <div data-testid="inventory-forecast-preset-select">
            <Select
              style={{ width: 260 }}
              placeholder="Chọn mẫu lọc dự báo"
              value={selectedViewPresetId}
              onChange={(value) => setSelectedViewPresetId(value)}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button data-testid="inventory-forecast-apply-preset" onClick={applyNamedPreset}>
            Áp dụng mẫu
          </Button>
          <Button danger data-testid="inventory-forecast-delete-preset" onClick={() => void deleteNamedPreset()}>
            Xóa mẫu
          </Button>
        </div>
        <div className="workspace-toolbar-group">
          {activeContextTags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : (
        <>
          <div className="workspace-metric-grid">
            <div className="workspace-metric-card workspace-metric-card--critical"><div className="workspace-metric-eyebrow">Can dat mua ngay</div><div className="workspace-metric-value">{summary.alertCount}</div><div className="workspace-metric-caption">Nhung dong co nguy co stockout cao nhat.</div></div>
            <div className="workspace-metric-card workspace-metric-card--warning"><div className="workspace-metric-eyebrow">Can theo doi sat</div><div className="workspace-metric-value">{summary.warningCount}</div><div className="workspace-metric-caption">Nhung dong sap cham nguong canh bao.</div></div>
            <div className="workspace-metric-card workspace-metric-card--steady"><div className="workspace-metric-eyebrow">Trang thai on dinh</div><div className="workspace-metric-value">{summary.okCount}</div><div className="workspace-metric-caption">Dong forecast dang duoc bao phu an toan.</div></div>
            <div className="workspace-metric-card"><div className="workspace-metric-eyebrow">Coverage trung binh</div><div className="workspace-metric-value">{summary.averageCoverage.toFixed(1)}</div><div className="workspace-metric-caption">So ngay bao phu ton kho tren toan danh muc.</div></div>
          </div>

          <div className="command-center-grid">
            <section className="command-center-panel">
              <div className="command-center-panel-header">
                <div>
                  <div className="command-center-panel-kicker">Priority list</div>
                  <div className="command-center-panel-title">Danh muc uu tien tai bo sung</div>
                  <div className="command-center-panel-subtitle">Top mat hang can dua vao cuoc hop mua hang hoac can doi ton kho ngay.</div>
                </div>
              </div>
              <div className="command-center-watchlist">
                {priorityRows.length > 0 ? priorityRows.map((row) => (
                  <div key={row.product_id} className={`command-center-watch-item command-center-watch-item--${row.stockout_risk === 'HIGH' ? 'critical' : row.stockout_risk === 'MEDIUM' ? 'warning' : 'steady'}`}>
                    <div className="command-center-watch-title">{row.product_code} · {row.product_name}</div>
                    <div className="command-center-watch-detail">
                      Ton {formatQty(row.current_stock)} · reorder {formatQty(row.reorder_point)} · coverage {row.coverage_days == null ? '-' : `${formatQty(row.coverage_days)} ngay`}
                    </div>
                  </div>
                )) : <div className="command-center-empty">Chua co dong forecast de lap watchlist.</div>}
              </div>
            </section>

            <section className="command-center-panel">
              <div className="command-center-panel-header">
                <div>
                  <div className="command-center-panel-kicker">Decision frame</div>
                  <div className="command-center-panel-title">Khung quyet dinh</div>
                  <div className="command-center-panel-subtitle">Ba quy tac nhanh de chot hanh dong tu bang forecast.</div>
                </div>
              </div>
              <div className="command-center-playbook">
                <div className="command-center-playbook-item"><div className="command-center-playbook-title">1. Chot nhom mua gap</div><div className="command-center-playbook-detail">Uu tien mat hang co risk HIGH, status ALERT va coverage duoi lead time hien tai.</div></div>
                <div className="command-center-playbook-item"><div className="command-center-playbook-title">2. Bao ve nhom ABC A</div><div className="command-center-playbook-detail">Neu la san pham ABC A, can dat muc ton an toan va reorder point chat hon nhom con lai.</div></div>
                <div className="command-center-playbook-item"><div className="command-center-playbook-title">3. Dung EOQ lam moc</div><div className="command-center-playbook-detail">Dung EOQ de can bang chi phi dat mua va chi phi ton kho, sau do chinh theo nang luc cung ung thuc te.</div></div>
              </div>
            </section>
          </div>

          <section className="command-center-panel">
            <div className="command-center-panel-header">
              <div>
                <div className="command-center-panel-kicker">Forecast table</div>
                <div className="command-center-panel-title">Bang du bao ton kho</div>
                <div className="command-center-panel-subtitle">Tap trung vao coverage, reorder point, EOQ va muc do rui ro de doi chieu toan danh muc.</div>
              </div>
            </div>
            <Table columns={columns} dataSource={sortedData} rowKey="product_id" pagination={false} scroll={{ x: 1400 }} locale={{ emptyText: <Empty description="Khong co du lieu du bao ton kho" /> }} />
          </section>
        </>
      )}

      <Modal
        title="Lưu mẫu lọc dự báo tồn kho"
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
              data-testid="inventory-forecast-preset-name"
              value={viewPresetName}
              onChange={(event) => setViewPresetName(event.target.value)}
              placeholder="Ví dụ: Ưu tiên rủi ro cao - 6 tháng"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
