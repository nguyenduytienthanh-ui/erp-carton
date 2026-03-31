import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';

import { salesFulfillmentApi } from '../../api/sales';
import PageHeader from '../../components/PageHeader/PageHeader';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import type {
  SalesMaterialCommandCenterRow,
  SalesLineMaterialPlanStatus,
} from '../../types/sales';

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<SalesLineMaterialPlanStatus, string> = {
  DRAFT: 'Nháp',
  CONFIRMED: 'Đã chốt vật tư',
  PARTIAL_ORDERED: 'Đặt mua một phần',
  PARTIAL_RECEIVED: 'Đã về một phần',
  READY: 'Sẵn sàng',
};

const STATUS_COLORS: Record<SalesLineMaterialPlanStatus, string> = {
  DRAFT: 'default',
  CONFIRMED: 'blue',
  PARTIAL_ORDERED: 'orange',
  PARTIAL_RECEIVED: 'processing',
  READY: 'success',
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function SalesFulfillmentCenter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();

  const [selectedRow, setSelectedRow] = useState<SalesMaterialCommandCenterRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SalesLineMaterialPlanStatus | ''>('');
  const [onlyShortage, setOnlyShortage] = useState(false);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [onlyReady, setOnlyReady] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [intentSearch] = useDebouncedValue(searchInput, 650);

  const queryParams: Record<string, unknown> = useMemo(() => {
    const params: Record<string, unknown> = {};
    if (intentSearch.trim()) params.search = intentSearch.trim();
    if (statusFilter) params.status = statusFilter;
    if (onlyShortage) params.only_shortage = '1';
    if (onlyOverdue) params.only_overdue_delivery = '1';
    if (onlyReady) params.only_ready = '1';
    return params;
  }, [intentSearch, statusFilter, onlyShortage, onlyOverdue, onlyReady]);

  const query = useQuery({
    queryKey: ['sales-fulfillment-center', queryParams],
    queryFn: () => salesFulfillmentApi.getCommandCenter(queryParams),
    staleTime: 30_000,
  });

  const refreshMutation = useMutation({
    mutationFn: (planId: number) => salesFulfillmentApi.refreshFromTemplate(planId),
    onSuccess: () => {
      messageApi.success('Đã làm mới kế hoạch vật tư từ template.');
      void queryClient.invalidateQueries({ queryKey: ['sales-fulfillment-center'] });
    },
    onError: () => messageApi.error('Không thể làm mới kế hoạch vật tư.'),
  });

  const rows = query.data?.results ?? [];
  const summary = query.data?.summary;

  const columns: ColumnsType<SalesMaterialCommandCenterRow> = [
    {
      title: 'Đơn hàng',
      dataIndex: 'sales_order_code',
      width: 140,
      render: (code: string, row) => (
        <Button
          type="link"
          size="small"
          style={{ padding: 0 }}
          onClick={() => navigate(`/sales-orders?focus_id=${row.sales_order_id}`)}
        >
          {code}
        </Button>
      ),
    },
    {
      title: 'Khách hàng',
      dataIndex: 'customer_name',
      width: 160,
      ellipsis: true,
    },
    {
      title: 'Sản phẩm',
      width: 200,
      ellipsis: true,
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 12 }}>{row.finished_product_code}</div>
          <div style={{ color: '#64748b', fontSize: 11 }}>{row.finished_product_name}</div>
        </div>
      ),
    },
    {
      title: 'SL',
      dataIndex: 'ordered_finished_qty',
      width: 80,
      align: 'right',
      render: (v: string) => Number(v || 0).toLocaleString('vi-VN'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'plan_status',
      width: 150,
      render: (status: SalesLineMaterialPlanStatus) => (
        <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>
      ),
    },
    {
      title: 'Giao hàng',
      width: 120,
      render: (_, row) => {
        const overduePlans = row.delivery_plans.filter((p) => p.is_overdue);
        const nextPlan = row.delivery_plans.find((p) => !p.is_overdue);
        if (overduePlans.length > 0) {
          return (
            <Tag color="error" icon={<ExclamationCircleOutlined />}>
              {overduePlans.length} quá hạn
            </Tag>
          );
        }
        if (nextPlan) {
          return (
            <Tag color={nextPlan.days_until_due !== null && nextPlan.days_until_due <= 3 ? 'warning' : 'default'}>
              {dayjs(nextPlan.delivery_date).format('DD/MM')}
            </Tag>
          );
        }
        return <span style={{ color: '#94a3b8' }}>—</span>;
      },
    },
    {
      title: 'Vật tư',
      width: 160,
      render: (_, row) => {
        if (row.has_shortage) {
          return <Tag color="error" icon={<WarningOutlined />}>Thiếu vật tư</Tag>;
        }
        if (row.plan_status === 'READY') {
          return <Tag color="success" icon={<CheckCircleOutlined />}>Đủ vật tư</Tag>;
        }
        return <Tag color="default">{row.material_groups.length} nhóm</Tag>;
      },
    },
    {
      title: 'Sản xuất',
      width: 130,
      render: (_, row) => {
        const prod = row.production_summary;
        if (!prod.has_production_order) {
          return <Tag color="default">Chưa có lệnh SX</Tag>;
        }
        return (
          <Space size={4} direction="vertical">
            <Tag color={prod.overdue_plan_count > 0 ? 'error' : prod.active_count > 0 ? 'processing' : 'success'}>
              {prod.active_count > 0 ? `${prod.active_count} đang chạy` : prod.completed_count > 0 ? 'Hoàn thành' : 'Sẵn sàng'}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: 'Thao tác',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button
            size="small"
            onClick={() => { setSelectedRow(row); setDrawerOpen(true); }}
          >
            Chi tiết
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={refreshMutation.isPending}
            onClick={() => refreshMutation.mutate(row.plan_id)}
            title="Làm mới từ template"
          />
        </Space>
      ),
    },
  ];

  const renderDrawer = () => {
    if (!selectedRow) return null;
    return (
      <Drawer
        title={`${selectedRow.sales_order_code} — Dòng ${selectedRow.sales_order_line_number}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={640}
        footer={
          <Space>
            <Button
              onClick={() => navigate(`/sales-orders?focus_id=${selectedRow.sales_order_id}`)}
            >
              Mở đơn hàng
            </Button>
            <Button onClick={() => setDrawerOpen(false)}>Đóng</Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="Sản phẩm">
              <div>
                <div style={{ fontWeight: 600 }}>{selectedRow.finished_product_code}</div>
                <div style={{ color: '#64748b', fontSize: 12 }}>{selectedRow.finished_product_name}</div>
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="Khách hàng">{selectedRow.customer_name}</Descriptions.Item>
            <Descriptions.Item label="SL đặt hàng">
              {Number(selectedRow.ordered_finished_qty || 0).toLocaleString('vi-VN')}
            </Descriptions.Item>
            <Descriptions.Item label="Trạng thái kế hoạch">
              <Tag color={STATUS_COLORS[selectedRow.plan_status]}>
                {STATUS_LABELS[selectedRow.plan_status]}
              </Tag>
            </Descriptions.Item>
          </Descriptions>

          {selectedRow.delivery_plans.length > 0 ? (
            <Card size="small" title="Kế hoạch giao hàng">
              {selectedRow.delivery_plans.map((plan, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span style={{ color: plan.is_overdue ? '#dc2626' : '#334155' }}>
                    {dayjs(plan.delivery_date).format('DD/MM/YYYY')}
                    {plan.is_overdue ? ' (Quá hạn)' : plan.days_until_due !== null ? ` (${plan.days_until_due} ngày)` : ''}
                  </span>
                  <span>{Number(plan.qty || 0).toLocaleString('vi-VN')}</span>
                </div>
              ))}
            </Card>
          ) : null}

          {selectedRow.material_groups.length > 0 ? (
            <Card size="small" title="Vật tư">
              {selectedRow.material_groups.map((group) => (
                <Card
                  key={group.group_code}
                  size="small"
                  style={{ marginBottom: 8, borderLeft: `3px solid ${group.is_shortage ? '#dc2626' : '#e2e8f0'}` }}
                  title={
                    <Space size={6}>
                      <Tag style={{ margin: 0, fontSize: 11 }}>{group.group_code}</Tag>
                      <span style={{ fontSize: 12 }}>{group.group_name}</span>
                      {group.is_shortage ? <Tag color="error" style={{ margin: 0 }}>Thiếu {Number(group.short_qty || 0).toLocaleString('vi-VN')}</Tag> : null}
                    </Space>
                  }
                >
                  {group.options.map((opt) => (
                    <div
                      key={opt.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '3px 0',
                        fontSize: 12,
                        fontWeight: opt.is_selected ? 600 : 400,
                        color: opt.is_selected ? '#0f172a' : '#64748b',
                      }}
                    >
                      <span>{opt.material_product_code} — {opt.material_product_name}</span>
                      <Space size={12}>
                        {opt.is_selected ? <Tag color="green" style={{ margin: 0, fontSize: 10 }}>Đã chọn</Tag> : null}
                        <span>{Number(opt.required_qty || 0).toLocaleString('vi-VN')} {opt.material_product_unit_name || ''}</span>
                        <span style={{ color: Number(opt.short_qty_cache || 0) > 0 ? '#dc2626' : '#16a34a' }}>
                          Thiếu: {Number(opt.short_qty_cache || 0).toLocaleString('vi-VN')}
                        </span>
                      </Space>
                    </div>
                  ))}
                </Card>
              ))}
            </Card>
          ) : null}
        </div>
      </Drawer>
    );
  };

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="Điều độ đơn hàng xuất"
        subtitle="Tổng quan kế hoạch vật tư, tình trạng thiếu hụt và sẵn sàng giao hàng theo từng dòng đơn."
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['sales-fulfillment-center'] })}
            loading={query.isFetching}
          >
            Làm mới
          </Button>
        }
      />

      {/* Summary cards */}
      {summary ? (
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          {[
            { label: 'Tổng kế hoạch', value: summary.total, color: '#1d4ed8' },
            { label: 'Thiếu vật tư', value: summary.has_shortage, color: '#dc2626' },
            { label: 'Quá hạn giao', value: summary.has_overdue_delivery, color: '#d97706' },
            { label: 'Sẵn sàng giao', value: summary.ready_for_delivery, color: '#16a34a' },
          ].map((item) => (
            <Col key={item.label} xs={12} sm={6}>
              <Card size="small">
                <Statistic
                  title={item.label}
                  value={item.value}
                  valueStyle={{ color: item.color, fontSize: 24, fontWeight: 700 }}
                />
              </Card>
            </Col>
          ))}
        </Row>
      ) : null}

      {/* Filters */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input
            placeholder="Tìm mã đơn, khách hàng, sản phẩm..."
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 280 }}
            allowClear
          />
          <Select
            placeholder="Trạng thái kế hoạch"
            allowClear
            style={{ width: 180 }}
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v ?? '')}
            options={Object.entries(STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))}
          />
          <Button
            type={onlyShortage ? 'primary' : 'default'}
            danger={onlyShortage}
            onClick={() => setOnlyShortage((prev) => !prev)}
          >
            Thiếu vật tư
          </Button>
          <Button
            type={onlyOverdue ? 'primary' : 'default'}
            danger={onlyOverdue}
            onClick={() => setOnlyOverdue((prev) => !prev)}
          >
            Quá hạn giao
          </Button>
          <Button
            type={onlyReady ? 'primary' : 'default'}
            onClick={() => setOnlyReady((prev) => !prev)}
          >
            Sẵn sàng
          </Button>
        </Space>
      </Card>

      {/* Table */}
      {query.isLoading ? (
        <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
      ) : query.isError ? (
        <Alert
          type="error"
          message="Không thể tải dữ liệu trung tâm điều độ."
          action={<Button size="small" onClick={() => void query.refetch()}>Thử lại</Button>}
        />
      ) : rows.length === 0 ? (
        <Empty description="Không có kế hoạch vật tư nào phù hợp với bộ lọc hiện tại." />
      ) : (
        <Table
          columns={columns}
          dataSource={rows}
          rowKey="plan_id"
          size="small"
          scroll={{ x: 1200 }}
          pagination={{ pageSize: 20, showSizeChanger: true, showQuickJumper: true }}
          rowClassName={(row) =>
            row.has_shortage ? 'ant-table-row-danger'
              : row.has_overdue_delivery ? 'ant-table-row-warning'
                : ''
          }
        />
      )}

      {renderDrawer()}
    </div>
  );
}
