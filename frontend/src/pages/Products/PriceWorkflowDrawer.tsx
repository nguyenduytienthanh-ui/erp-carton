import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Drawer, Empty, Input, InputNumber, Modal, Space, Table, Tag, message } from 'antd';
import { CheckOutlined, CloseOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import FormattedPrice from '../../components/FormattedPrice';
import { parseApiError } from '../../shared/apiError';
import type { Product } from '../../types/product';
import { productsApi, type PriceChangeRecord } from '../../api/products';

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

export default function PriceWorkflowDrawer({
  open,
  productId,
  initialProduct,
  onClose,
  onRefresh,
}: PriceWorkflowDrawerProps) {
  const queryClient = useQueryClient();
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [targetRejectChange, setTargetRejectChange] = useState<PriceChangeRecord | null>(null);
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
  const pendingChanges = useMemo(
    () => priceChanges.filter((item) => item.status === 'PENDING_APPROVAL'),
    [priceChanges],
  );

  const refreshAll = async () => {
    await Promise.all([
      refetchProduct(),
      refetchChanges(),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['products', 'activity'] }),
    ]);
    onRefresh?.();
  };

  useEffect(() => {
    if (!open || !activeProduct) return;
    setPriceNewCost(toNumber(activeProduct.cost_price));
    setPriceNewSale(toNumber(activeProduct.sale_price));
    setPriceNewCommissionPerUnit(toNumber(activeProduct.commission_per_unit));
    setPriceNewCommissionPercent(toNumber(activeProduct.commission_percent));
  }, [open, activeProduct]);

  const openSubmitModal = () => {
    if (!activeProduct) return;
    setPriceNewCost(toNumber(activeProduct.cost_price));
    setPriceNewSale(toNumber(activeProduct.sale_price));
    setPriceNewCommissionPerUnit(toNumber(activeProduct.commission_per_unit));
    setPriceNewCommissionPercent(toNumber(activeProduct.commission_percent));
    setPriceReason('');
    setPriceEffectiveAt('');
    setSubmitModalOpen(true);
  };

  const handleSubmitPriceChange = async () => {
    if (!activeProduct) return;
    const reason = priceReason.trim();
    if (!reason) {
      message.warning('Vui lòng nhập lý do đề xuất thay đổi giá.');
      return;
    }
    const currentCost = toNumber(activeProduct.cost_price);
    const currentSale = toNumber(activeProduct.sale_price);
    const currentCommissionPerUnit = toNumber(activeProduct.commission_per_unit);
    const currentCommissionPercent = toNumber(activeProduct.commission_percent);
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
      await productsApi.submitPriceChange(activeProduct.id, {
        new_cost_price: nextCost,
        new_sale_price: nextSale,
        new_commission_per_unit: nextCommissionPerUnit,
        new_commission_percent: nextCommissionPercent,
        reason,
        effective_at: normalizeDateTimeLocal(priceEffectiveAt),
      });
      message.success('Đã gửi đề xuất thay đổi giá.');
      setSubmitModalOpen(false);
      await refreshAll();
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || 'Gửi đề xuất thay đổi giá thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (change: PriceChangeRecord) => {
    if (!activeProduct) return;
    setSubmitting(true);
    try {
      await productsApi.approvePriceChange(activeProduct.id, change.id);
      message.success('Đã duyệt đề xuất giá.');
      await refreshAll();
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || 'Duyệt đề xuất giá thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const openRejectModal = (change: PriceChangeRecord) => {
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
      await productsApi.rejectPriceChange(activeProduct.id, targetRejectChange.id, rejectReason);
      message.success('Đã từ chối đề xuất giá.');
      setRejectModalOpen(false);
      setTargetRejectChange(null);
      await refreshAll();
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || 'Từ chối đề xuất giá thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const priceColumns = [
    {
      title: 'Trạng thái',
      key: 'status',
      width: 160,
      render: (_: unknown, row: PriceChangeRecord) => {
        const meta = PRICE_STATUS_META[row.status] ?? { label: row.status, color: 'default' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: 'Giá / hoa hồng mới',
      key: 'next_values',
      width: 260,
      render: (_: unknown, row: PriceChangeRecord) => (
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
      render: (_: unknown, row: PriceChangeRecord) => (
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
      ellipsis: true,
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
      render: (_: unknown, row: PriceChangeRecord) => {
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
      <Drawer
        title={activeProduct ? `Quản trị giá - ${activeProduct.code}` : 'Quản trị giá'}
        placement="right"
        width={980}
        open={open}
        onClose={onClose}
        extra={(
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void refreshAll()} loading={productLoading || changesLoading}>
              Làm mới
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openSubmitModal} disabled={!activeProduct}>
              Tạo đề xuất
            </Button>
          </Space>
        )}
      >
        {!activeProduct && !productLoading ? (
          <Empty description="Không tìm thấy mã hàng." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card size="small">
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>Mã hàng / tên hàng</div>
                  <div style={{ fontWeight: 600 }}>{activeProduct?.code} - {activeProduct?.name}</div>
                  <div style={{ color: '#595959', marginTop: 6 }}>
                    Bảng tổng hợp luôn hiển thị giá đang có hiệu lực tại thời điểm hiện tại. Lịch giá đã duyệt nhưng chưa tới ngày áp sẽ nằm riêng ở phần "Giá sắp hiệu lực".
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>Giá đang hiệu lực</div>
                  <div>Giá vốn: {renderMoneyText(activeProduct?.cost_price)}</div>
                  <div>Đơn giá: {renderMoneyText(activeProduct?.sale_price)}</div>
                  <div>HHCĐ: {renderMoneyText(activeProduct?.commission_per_unit)}</div>
                  <div>HH%: {renderPercentText(activeProduct?.commission_percent)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>Giá sắp hiệu lực</div>
                  {activeProduct?.has_scheduled_price_change ? (
                    <>
                      <div>Hiệu lực: {formatDateTime(activeProduct.next_price_effective_at)}</div>
                      <div>Giá vốn: {renderMoneyText(activeProduct.next_price_cost)}</div>
                      <div>Đơn giá: {renderMoneyText(activeProduct.next_price_sale)}</div>
                      <div>HHCĐ: {renderMoneyText(activeProduct.next_price_commission_per_unit)}</div>
                      <div>HH%: {renderPercentText(activeProduct.next_price_commission_percent)}</div>
                    </>
                  ) : (
                    <div style={{ color: '#8c8c8c' }}>Chưa có lịch áp giá tương lai.</div>
                  )}
                </div>
              </div>
            </Card>

            <Card
              size="small"
              title="Danh sách đề xuất và lịch sử giá"
              extra={pendingChanges.length > 0 ? <Tag color="gold">{pendingChanges.length} đề xuất chờ duyệt</Tag> : null}
            >
              <Table<PriceChangeRecord>
                rowKey="id"
                size="small"
                loading={changesLoading}
                columns={priceColumns}
                dataSource={priceChanges}
                pagination={{ pageSize: 8, showSizeChanger: false }}
                locale={{ emptyText: 'Chưa có lịch sử giá.' }}
              />
            </Card>
          </div>
        )}
      </Drawer>

      <Modal
        title={`Tạo đề xuất giá${activeProduct ? ` - ${activeProduct.code}` : ''}`}
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
          <div style={{ marginBottom: 6, fontWeight: 600 }}>Lý do thay đổi giá</div>
          <Input.TextArea
            rows={4}
            value={priceReason}
            onChange={(event) => setPriceReason(event.target.value)}
            placeholder="Nhập lý do đề xuất thay đổi giá hoặc hoa hồng..."
          />
        </div>
      </Modal>

      <Modal
        title={`Từ chối đề xuất giá${activeProduct ? ` - ${activeProduct.code}` : ''}`}
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
