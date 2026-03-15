import { useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Table, Tag, message, Skeleton } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckOutlined, PlusOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import type { StockAlert } from '../../types/inventory';
import { PAGES } from '../../utils/constants';
import { canManageInventoryData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';

type AlertType = 'LOW_STOCK' | 'OUT_OF_STOCK';
type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';

type Filters = {
  alert_type?: string;
  status?: string;
};

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  LOW_STOCK: 'Tồn kho thấp',
  OUT_OF_STOCK: 'Hết hàng',
};

const ALERT_TYPE_COLORS: Record<AlertType, string> = {
  LOW_STOCK: 'warning',
  OUT_OF_STOCK: 'red',
};

const STATUS_LABELS: Record<AlertStatus, string> = {
  ACTIVE: 'Đang hoạt động',
  ACKNOWLEDGED: 'Đã xác nhận',
  RESOLVED: 'Đã giải quyết',
};

const STATUS_COLORS: Record<AlertStatus, string> = {
  ACTIVE: 'error',
  ACKNOWLEDGED: 'processing',
  RESOLVED: 'success',
};

export default function StockAlertList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const { config, saveConfig } = useUserPreferences(PAGES.INVENTORY_STOCK_ALERTS);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);
  const canManage = canManageInventoryData();

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (f) => JSON.stringify(f),
    parseFilters: (s) => {
      try {
        return JSON.parse(s);
      } catch {
        return {};
      }
    },
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

  const rows = alertsQuery.data?.results ?? [];

  const columns: ColumnsType<StockAlert> = [
    {
      title: 'Sản phẩm',
      dataIndex: 'product_name',
      width: 200,
      key: 'product',
    },
    {
      title: 'Mã SP',
      dataIndex: 'product_code',
      width: 120,
      key: 'code',
    },
    {
      title: 'Loại cảnh báo',
      dataIndex: 'alert_type',
      width: 150,
      render: (type: AlertType) => (
        <Tag color={ALERT_TYPE_COLORS[type]}>{ALERT_TYPE_LABELS[type]}</Tag>
      ),
    },
    {
      title: 'Tồn kho hiện tại',
      dataIndex: 'current_qty',
      width: 120,
      render: (val) => Number(val).toLocaleString('vi-VN'),
    },
    {
      title: 'Tồn kho tối thiểu',
      dataIndex: 'min_stock',
      width: 120,
      render: (val) => Number(val).toLocaleString('vi-VN'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 140,
      render: (status: AlertStatus) => (
        <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>
      ),
    },
    {
      title: 'Ngày phát sinh',
      dataIndex: 'triggered_at',
      width: 160,
      render: (val) => dayjs(val).format('DD/MM/YYYY HH:mm'),
    },
    {
      title: 'Thao tác',
      width: 200,
      render: (_, row) => (
        <Space wrap>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'ACTIVE'}
            type="primary"
            icon={<CheckOutlined />}
            onClick={() => acknowledgeMutation.mutate(row.id)}
            loading={acknowledgeMutation.isPending}
          >
            Xác nhận
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Cảnh báo tồn kho</h2>
        <Button
          icon={<DownloadOutlined />}
          disabled={rows.length === 0}
          onClick={() => {
            const exportData = rows.map((r) => ({
              'Sản phẩm': r.product_name,
              'Mã SP': r.product_code,
              'Loại': ALERT_TYPE_LABELS[r.alert_type],
              'Tồn hiện tại': r.current_qty,
              'Tồn tối thiểu': r.min_stock,
              'Trạng thái': STATUS_LABELS[r.status],
              'Ngày phát sinh': dayjs(r.triggered_at).format('DD/MM/YYYY HH:mm'),
            }));
            downloadCSV(exportData, 'canh-bao-ton-kho');
          }}
        >
          Xuất CSV
        </Button>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm mã sản phẩm, tên..."
          style={{ width: 250 }}
          suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
        />
        <Select
          style={{ width: 200 }}
          placeholder="Loại cảnh báo"
          allowClear
          value={filters.alert_type || undefined}
          onChange={(value) => {
            setFilters({ ...filters, alert_type: value });
            setPage(1);
          }}
          options={Object.entries(ALERT_TYPE_LABELS).map(([key, label]) => ({ value: key, label }))}
        />
        <Select
          style={{ width: 200 }}
          placeholder="Trạng thái"
          allowClear
          value={filters.status || undefined}
          onChange={(value) => {
            setFilters({ ...filters, status: value });
            setPage(1);
          }}
          options={Object.entries(STATUS_LABELS).map(([key, label]) => ({ value: key, label }))}
        />
      </div>

      <Table
        rowKey="id"
        loading={alertsQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1600 }}
        pagination={{
          current: page,
          pageSize,
          total: alertsQuery.data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              saveConfig({ ...config, pageSize: nextPageSize });
            }
          },
        }}
        locale={{
          emptyText: rows.length === 0 && !alertsQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {(intentSearch || filters.alert_type || filters.status) ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy cảnh báo phù hợp.</div>
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
                </div>
              ) : 'Không có cảnh báo tồn kho.'}
            </div>
          ) : undefined,
        }}
      />
    </>
  );
}
