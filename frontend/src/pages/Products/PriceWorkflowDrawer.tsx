import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Input, InputNumber, Modal, Segmented, Space, Table, Tag, message } from 'antd';
import { CheckOutlined, CloseOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import FormattedPrice from '../../components/FormattedPrice';
import { parseApiError } from '../../shared/apiError';
import type { Product } from '../../types/product';
import { productsApi, type BundlePriceChangeRecord, type PriceChangeRecord } from '../../api/products';

interface PriceWorkflowDrawerProps {
  open: boolean;
  productId: number | null;
  initialProduct?: Product | null;
  onClose: () => void;
  onRefresh?: () => void;
}

const PRICE_STATUS_META: Record<string, { label: string; color: string }> = {
  PENDING_APPROVAL: { label: 'Chờ duyệt', color: 'gold' },
  APPROVED_SCHEDULED: { label: 'Đã duyệt, chờ hiệu lực', color: 'blue' },
  ACTIVE_APPLIED: { label: 'Đang hiệu lực', color: 'green' },
  REJECTED: { label: 'Từ chối', color: 'red' },
  SUPERSEDED: { label: 'Đã bị thay thế', color: 'default' },
};

type WorkflowScope = 'PRODUCT' | 'BUNDLE_FIXED';
type WorkflowRecord = PriceChangeRecord | BundlePriceChangeRecord;

const normalizeDateTimeLocal = (value: string): string | undefined => {
  const raw = value.trim();
  if (!raw) return undefined;
  if (raw.length === 16) return `${raw}:00`;
  return raw;
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('vi-VN');
};

const toNumber = (value?: string | number | null): number => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const renderMoneyText = (value?: string | null) => <FormattedPrice value={value ?? '0'} />;

const renderPercentText = (value?: string | null) => `${toNumber(value).toLocaleString('vi-VN')}%`;

const getScopeTitle = (scope: WorkflowScope): string => (
  scope === 'PRODUCT' ? 'Giá mã hàng' : 'Giá bộ cố định'
);

export default function PriceWorkflowDrawer({
  open,
  productId,
  initialProduct,
  onClose,
  onRefresh,
}: PriceWorkflowDrawerProps) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<WorkflowScope>('PRODUCT');
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [targetRejectChange, setTargetRejectChange] = useState<WorkflowRecord | null>(null);
  const [priceNewCost, setPriceNewCost] = useState<number | null>(null);
  const [priceNewSale, setPriceNewSale] = useState<number | null>(null);
  const [priceNewCommissionPerUnit, setPriceNewCommissionPerUnit] = useState<number | null>(null);
  const [priceNewCommissionPercent, setPriceNewCommissionPercent] = useState<number | null>(null);
  const [priceReason, setPriceReason] = useState('');
  const [priceEffectiveAt, setPriceEffectiveAt] = useState('');
  const [priceRejectReason, setPriceRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: product, isLoading: productLoading, refetch: refetchProduct } = useQuery({
    queryKey: ['products', 'price-workflow', productId],
    queryFn: () => productsApi.getProduct(productId!),
    enabled: open && !!productId,
  });

  const { data: priceChanges = [], isLoading: changesLoading, refetch: refetchChanges } = useQuery({
    queryKey: ['products', 'price-changes', productId],
    queryFn: () => productsApi.getPriceChanges(productId!),
    enabled: open && !!productId,
  });

  const activeProduct = product ?? initialProduct ?? null;
  const hasBundle = Boolean(activeProduct?.bundle_id && activeProduct?.bundle_definition);
  const bundleFixedEnabled = activeProduct?.bundle_pricing_mode === 'FIXED_BUNDLE';

  const { data: bundlePriceChanges = [], isLoading: bundleChangesLoading, refetch: refetchBundleChanges } = useQuery({
    queryKey: ['products', 'bundle-price-changes', productId, activeProduct?.bundle_id ?? null],
    queryFn: () => productsApi.getBundlePriceChanges(productId!),
    enabled: open && !!productId && hasBundle,
  });

  useEffect(() => {
    if (!open || !activeProduct) return;
    setScope(activeProduct.bundle_pricing_mode === 'FIXED_BUNDLE' ? 'BUNDLE_FIXED' : 'PRODUCT');
  }, [open, activeProduct]);

  const currentValues = useMemo(() => {
    if (!activeProduct) {
      return {
        cost: 0,
        sale: 0,
        commissionPerUnit: 0,
        commissionPercent: 0,
      };
    }
    if (scope === 'BUNDLE_FIXED') {
      const bundle = activeProduct.bundle_definition;
      return {
        cost: toNumber(bundle?.fixed_cost_price),
        sale: toNumber(bundle?.fixed_sale_price),
        commissionPerUnit: toNumber(bundle?.fixed_commission_per_unit),
        commissionPercent: toNumber(bundle?.fixed_commission_percent),
      };
    }
    return {
      cost: toNumber(activeProduct.cost_price),
      sale: toNumber(activeProduct.sale_price),
      commissionPerUnit: toNumber(activeProduct.commission_per_unit),
      commissionPercent: toNumber(activeProduct.commission_percent),
    };
  }, [activeProduct, scope]);

  const scheduledBundleChange = useMemo(
    () => bundlePriceChanges.find((item) => item.status === 'APPROVED_SCHEDULED') ?? null,
    [bundlePriceChanges]
  );

  const scheduledValues = useMemo(() => {
    if (scope === 'PRODUCT') {
      return activeProduct?.has_scheduled_price_change
        ? {
            effectiveAt: activeProduct.next_price_effective_at,
            cost: activeProduct.next_price_cost,
            sale: activeProduct.next_price_sale,
            commissionPerUnit: activeProduct.next_price_commission_per_unit,
            commissionPercent: activeProduct.next_price_commission_percent,
          }
        : null;
    }
    return scheduledBundleChange
      ? {
          effectiveAt: scheduledBundleChange.effective_at,
          cost: scheduledBundleChange.new_cost_price,
          sale: scheduledBundleChange.new_sale_price,
          commissionPerUnit: scheduledBundleChange.new_commission_per_unit,
          commissionPercent: scheduledBundleChange.new_commission_percent,
        }
      : null;
  }, [activeProduct, scheduledBundleChange, scope]);

  const currentRecords = useMemo<WorkflowRecord[]>(
    () => (scope === 'PRODUCT' ? priceChanges : bundlePriceChanges),
    [bundlePriceChanges, priceChanges, scope]
  );

  const pendingChanges = useMemo(
    () => currentRecords.filter((item) => item.status === 'PENDING_APPROVAL'),
    [currentRecords]
  );

  const currentLoading = productLoading || (scope === 'PRODUCT' ? changesLoading : bundleChangesLoading);

  const refreshAll = async () => {
    await Promise.all([
      refetchProduct(),
      refetchChanges(),
      refetchBundleChanges(),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['products', 'activity'] }),
    ]);
    onRefresh?.();
  };

  useEffect(() => {
    if (!open || !activeProduct) return;
    setPriceNewCost(currentValues.cost);
    setPriceNewSale(currentValues.sale);
    setPriceNewCommissionPerUnit(currentValues.commissionPerUnit);
    setPriceNewCommissionPercent(currentValues.commissionPercent);
  }, [open, activeProduct, currentValues]);

  const openSubmitModal = () => {
    if (!activeProduct) return;
    if (scope === 'BUNDLE_FIXED' && !bundleFixedEnabled) {
      message.warning('Bộ này chưa dùng chế độ Giá bộ cố định.');
      return;
    }
    setPriceNewCost(currentValues.cost);
    setPriceNewSale(currentValues.sale);
    setPriceNewCommissionPerUnit(currentValues.commissionPerUnit);
    setPriceNewCommissionPercent(currentValues.commissionPercent);
    setPriceReason('');
    setPriceEffectiveAt('');
    setSubmitModalOpen(true);
  };

  const handleSubmitPriceChange = async () => {
    if (!activeProduct) return;
    if (scope === 'BUNDLE_FIXED' && !bundleFixedEnabled) {
      message.warning('Bộ này chưa dùng chế độ Giá bộ cố định.');
      return;
    }
    const reason = priceReason.trim();
    if (!reason) {
      message.warning('Vui lòng nhập lý do đề xuất thay đổi giá.');
      return;
    }

    const currentCost = currentValues.cost;
    const currentSale = currentValues.sale;
    const currentCommissionPerUnit = currentValues.commissionPerUnit;
    const currentCommissionPercent = currentValues.commissionPercent;
    const nextCost = priceNewCost ?? currentCost;
    const nextSale = priceNewSale ?? currentSale;
    const nextCommissionPerUnit = priceNewCommissionPerUnit ?? currentCommissionPerUnit;
    const nextCommissionPercent = priceNewCommissionPercent ?? currentCommissionPercent;

    if (
      nextCost === currentCost
      && nextSale === currentSale
      && nextCommissionPerUnit === currentCommissionPerUnit
      && nextCommissionPercent === currentCommissionPercent
    ) {
      message.warning('Bạn chưa thay đổi giá hoặc hoa hồng.');
      return;
    }
    if (nextSale < nextCost) {
      message.warning('Đơn giá mới phải lớn hơn hoặc bằng giá vốn mới.');
      return;
    }

    setSubmitting(true);
    try {
      if (scope === 'PRODUCT') {
        await productsApi.submitPriceChange(activeProduct.id, {
          new_cost_price: nextCost,
          new_sale_price: nextSale,
          new_commission_per_unit: nextCommissionPerUnit,
          new_commission_percent: nextCommissionPercent,
          reason,
          effective_at: normalizeDateTimeLocal(priceEffectiveAt),
        });
      } else {
        await productsApi.submitBundlePriceChange(activeProduct.id, {
          new_cost_price: nextCost,
          new_sale_price: nextSale,
          new_commission_per_unit: nextCommissionPerUnit,
          new_commission_percent: nextCommissionPercent,
          reason,
          effective_at: normalizeDateTimeLocal(priceEffectiveAt),
        });
      }
      message.success(`Đã gửi đề xuất thay đổi ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ'}.`);
      setSubmitModalOpen(false);
      await refreshAll();
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || `Gửi đề xuất thay đổi ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ'} thất bại.`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (change: WorkflowRecord) => {
    if (!activeProduct) return;
    setSubmitting(true);
    try {
      if (scope === 'PRODUCT') {
        await productsApi.approvePriceChange(activeProduct.id, change.id);
      } else {
        await productsApi.approveBundlePriceChange(activeProduct.id, change.id);
      }
      message.success(`Đã duyệt đề xuất ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ'}.`);
      await refreshAll();
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || `Duyệt đề xuất ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ'} thất bại.`);
    } finally {
      setSubmitting(false);
    }
  };

  const openRejectModal = (change: WorkflowRecord) => {
    setTargetRejectChange(change);
    setPriceRejectReason('');
    setRejectModalOpen(true);
  };

  const handleReject = async () => {
    if (!activeProduct || !targetRejectChange) return;
    const rejectReason = priceRejectReason.trim();
    if (!rejectReason) {
      message.warning('Vui lòng nhập lý do từ chối.');
      return;
    }
    setSubmitting(true);
    try {
      if (scope === 'PRODUCT') {
        await productsApi.rejectPriceChange(activeProduct.id, targetRejectChange.id, rejectReason);
      } else {
        await productsApi.rejectBundlePriceChange(activeProduct.id, targetRejectChange.id, rejectReason);
      }
      message.success(`Đã từ chối đề xuất ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ'}.`);
      setRejectModalOpen(false);
      setTargetRejectChange(null);
      await refreshAll();
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || `Từ chối đề xuất ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ'} thất bại.`);
    } finally {
      setSubmitting(false);
    }
  };

  const priceColumns = [
    {
      title: 'Trạng thái',
      key: 'status',
      width: 160,
      render: (_: unknown, row: WorkflowRecord) => {
        const meta = PRICE_STATUS_META[row.status] ?? { label: row.status, color: 'default' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: 'Giá / hoa hồng mới',
      key: 'next_values',
      width: 260,
      render: (_: unknown, row: WorkflowRecord) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Giá vốn: {renderMoneyText(row.new_cost_price)}</span>
          <span>Đơn giá: {renderMoneyText(row.new_sale_price)}</span>
          <span>HHCĐ: {renderMoneyText(row.new_commission_per_unit)}</span>
          <span>HH%: {renderPercentText(row.new_commission_percent)}</span>
        </div>
      ),
    },
    {
      title: 'Hiệu lực',
      key: 'effective_at',
      width: 170,
      render: (_: unknown, row: WorkflowRecord) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>{formatDateTime(row.effective_at)}</span>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>Tạo: {formatDateTime(row.created_at)}</span>
        </div>
      ),
    },
    {
      title: 'Lý do',
      dataIndex: 'reason',
      key: 'reason',
      render: (text: string) => <div className="ant-table-cell-ellipsis">{text ?? '-'}</div>,
    },
    {
      title: 'Batch',
      dataIndex: 'batch_code',
      key: 'batch_code',
      width: 150,
      render: (value: string | undefined) => value || '-',
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 150,
      render: (_: unknown, row: WorkflowRecord) => {
        if (row.status !== 'PENDING_APPROVAL') return null;
        return (
          <Space>
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              loading={submitting}
              onClick={() => void handleApprove(row)}
            >
              Duyệt
            </Button>
            <Button
              size="small"
              danger
              icon={<CloseOutlined />}
              loading={submitting}
              onClick={() => openRejectModal(row)}
            >
              Từ chối
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <Modal
        title={activeProduct ? `Quản trị giá — ${activeProduct.code} - ${activeProduct.name}` : 'Quản trị giá'}
        open={open}
        onCancel={onClose}
        width="90vw"
        style={{ top: 32, maxWidth: 1400 }}
        styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto', padding: '16px 24px' } }}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {pendingChanges.length > 0 && <Tag color="gold" style={{ fontSize: 13 }}>{pendingChanges.length} đề xuất chờ duyệt</Tag>}
            </div>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => void refreshAll()} loading={currentLoading}>
                Làm mới
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openSubmitModal}
                disabled={!activeProduct || (scope === 'BUNDLE_FIXED' && !bundleFixedEnabled)}
              >
                Tạo đề xuất mới
              </Button>
              <Button onClick={onClose}>Đóng</Button>
            </Space>
          </div>
        )}
        destroyOnClose
      >
        {!activeProduct && !productLoading ? (
          <Empty description="Không tìm thấy mã hàng." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Segmented<WorkflowScope>
                value={scope}
                onChange={(value) => setScope(value)}
                options={[
                  { value: 'PRODUCT', label: 'Giá mã hàng' },
                  { value: 'BUNDLE_FIXED', label: 'Giá bộ cố định', disabled: !hasBundle },
                ]}
              />
              {scope === 'BUNDLE_FIXED' && hasBundle && (
                <Tag color={bundleFixedEnabled ? 'cyan' : 'default'}>
                  Kiểu tính giá bộ: {bundleFixedEnabled ? 'FIXED_BUNDLE' : (activeProduct?.bundle_pricing_mode ?? '-')}
                </Tag>
              )}
            </div>

            {scope === 'BUNDLE_FIXED' && !hasBundle && (
              <Alert type="info" showIcon message="Mã này chưa có cấu hình bộ nên chưa có luồng giá bộ cố định." />
            )}

            {scope === 'BUNDLE_FIXED' && hasBundle && !bundleFixedEnabled && (
              <Alert
                type="warning"
                showIcon
                message="Bộ này chưa dùng chế độ Giá bộ cố định."
                description="Hãy chuyển cấu hình bộ sang FIXED_BUNDLE nếu muốn dùng luồng duyệt giá bộ riêng."
              />
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card size="small" title={`${getScopeTitle(scope)} đang hiệu lực`} styles={{ header: { background: '#f6ffed', borderBottom: '1px solid #b7eb8f' } }}>
                <Descriptions column={2} size="small" colon={false}>
                  <Descriptions.Item label="Giá vốn">{renderMoneyText(String(currentValues.cost))}</Descriptions.Item>
                  <Descriptions.Item label="Đơn giá">{renderMoneyText(String(currentValues.sale))}</Descriptions.Item>
                  <Descriptions.Item label="HHCĐ">{renderMoneyText(String(currentValues.commissionPerUnit))}</Descriptions.Item>
                  <Descriptions.Item label="HH%">{renderPercentText(String(currentValues.commissionPercent))}</Descriptions.Item>
                </Descriptions>
              </Card>

              <Card
                size="small"
                title={`${getScopeTitle(scope)} sắp hiệu lực`}
                styles={{ header: { background: scheduledValues ? '#e6f4ff' : '#fafafa', borderBottom: scheduledValues ? '1px solid #91caff' : '1px solid #f0f0f0' } }}
              >
                {scheduledValues ? (
                  <Descriptions column={2} size="small" colon={false}>
                    <Descriptions.Item label="Hiệu lực từ" span={2}>
                      <Tag color="blue">{formatDateTime(scheduledValues.effectiveAt)}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Giá vốn">{renderMoneyText(scheduledValues.cost)}</Descriptions.Item>
                    <Descriptions.Item label="Đơn giá">{renderMoneyText(scheduledValues.sale)}</Descriptions.Item>
                    <Descriptions.Item label="HHCĐ">{renderMoneyText(scheduledValues.commissionPerUnit)}</Descriptions.Item>
                    <Descriptions.Item label="HH%">{renderPercentText(scheduledValues.commissionPercent)}</Descriptions.Item>
                  </Descriptions>
                ) : (
                  <div style={{ color: '#8c8c8c', padding: '8px 0' }}>Chưa có lịch áp giá tương lai.</div>
                )}
              </Card>
            </div>

            <Card
              size="small"
              title={`Danh sách đề xuất và lịch sử ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ cố định'}`}
              extra={pendingChanges.length > 0 ? <Tag color="gold">{pendingChanges.length} chờ duyệt</Tag> : null}
            >
              <Table<WorkflowRecord>
                rowKey="id"
                size="small"
                loading={currentLoading}
                columns={priceColumns}
                dataSource={currentRecords}
                pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['5', '10', '20', '50'] }}
                locale={{ emptyText: `Chưa có lịch sử ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ'}.` }}
                scroll={{ x: 900 }}
              />
            </Card>
          </div>
        )}
      </Modal>

      <Modal
        title={`Tạo đề xuất ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ'}${activeProduct ? ` - ${activeProduct.code}` : ''}`}
        open={submitModalOpen}
        onCancel={() => setSubmitModalOpen(false)}
        onOk={() => void handleSubmitPriceChange()}
        okText="Gửi đề xuất"
        cancelText="Hủy"
        confirmLoading={submitting}
        width={760}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Giá vốn mới</div>
            <InputNumber style={{ width: '100%' }} min={0} value={priceNewCost} onChange={(value) => setPriceNewCost(value as number | null)} />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Đơn giá mới</div>
            <InputNumber style={{ width: '100%' }} min={0} value={priceNewSale} onChange={(value) => setPriceNewSale(value as number | null)} />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>HHCĐ mới</div>
            <InputNumber style={{ width: '100%' }} min={0} value={priceNewCommissionPerUnit} onChange={(value) => setPriceNewCommissionPerUnit(value as number | null)} />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>HH% mới</div>
            <InputNumber style={{ width: '100%' }} min={0} value={priceNewCommissionPercent} onChange={(value) => setPriceNewCommissionPercent(value as number | null)} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Hiệu lực từ</div>
          <input
            type="datetime-local"
            className="pf-input"
            value={priceEffectiveAt}
            onChange={(event) => setPriceEffectiveAt(event.target.value)}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Lý do thay đổi</div>
          <Input.TextArea
            rows={4}
            value={priceReason}
            onChange={(event) => setPriceReason(event.target.value)}
            placeholder={`Nhập lý do đề xuất thay đổi ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ cố định'}...`}
          />
        </div>
      </Modal>

      <Modal
        title={`Từ chối đề xuất ${scope === 'PRODUCT' ? 'giá mã hàng' : 'giá bộ'}${activeProduct ? ` - ${activeProduct.code}` : ''}`}
        open={rejectModalOpen}
        onCancel={() => {
          setRejectModalOpen(false);
          setTargetRejectChange(null);
        }}
        onOk={() => void handleReject()}
        okText="Xác nhận từ chối"
        okButtonProps={{ danger: true }}
        cancelText="Hủy"
        confirmLoading={submitting}
      >
        <Input.TextArea
          rows={4}
          value={priceRejectReason}
          onChange={(event) => setPriceRejectReason(event.target.value)}
          placeholder="Nhập lý do từ chối đề xuất giá..."
        />
      </Modal>
    </>
  );
}
