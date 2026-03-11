import { useMemo, useState } from 'react';
import { Button, Checkbox, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd';
import type { Product } from '../../types/product';
import { productsApi, type BulkPriceChangeItemInput, type BulkPriceChangePreviewItem } from '../../api/products';
import { parseApiError } from '../../shared/apiError';
import FormattedPrice from '../../components/FormattedPrice';

type BulkAdjustMode = 'SET' | 'DELTA' | 'PERCENT';

interface BulkPriceAdjustModalProps {
  open: boolean;
  selectedProducts: Product[];
  onClose: () => void;
  onSubmitted?: () => void;
}

const normalizeDateTimeLocal = (value: string): string | undefined => {
  const raw = value.trim();
  if (!raw) return undefined;
  if (raw.length === 16) return `${raw}:00`;
  return raw;
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const asNumber = (value?: string | number | null): number => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const applyAdjustment = (currentValue: number, inputValue: number | null, mode: BulkAdjustMode): number => {
  if (inputValue == null) return currentValue;
  if (mode === 'SET') return round2(inputValue);
  if (mode === 'DELTA') return round2(currentValue + inputValue);
  return round2(currentValue * (1 + inputValue / 100));
};

export default function BulkPriceAdjustModal({
  open,
  selectedProducts,
  onClose,
  onSubmitted,
}: BulkPriceAdjustModalProps) {
  const [mode, setMode] = useState<BulkAdjustMode>('DELTA');
  const [costInput, setCostInput] = useState<number | null>(null);
  const [saleInput, setSaleInput] = useState<number | null>(null);
  const [commissionPerUnitInput, setCommissionPerUnitInput] = useState<number | null>(null);
  const [commissionPercentInput, setCommissionPercentInput] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewItems, setPreviewItems] = useState<BulkPriceChangePreviewItem[]>([]);

  const draftItems = useMemo<BulkPriceChangeItemInput[]>(() => (
    selectedProducts.map((product) => ({
      product_id: product.id,
      new_cost_price: costInput == null ? undefined : applyAdjustment(asNumber(product.cost_price), costInput, mode),
      new_sale_price: saleInput == null ? undefined : applyAdjustment(asNumber(product.sale_price), saleInput, mode),
      new_commission_per_unit: commissionPerUnitInput == null ? undefined : applyAdjustment(asNumber(product.commission_per_unit), commissionPerUnitInput, mode),
      new_commission_percent: commissionPercentInput == null ? undefined : applyAdjustment(asNumber(product.commission_percent), commissionPercentInput, mode),
    }))
  ), [commissionPerUnitInput, commissionPercentInput, costInput, mode, saleInput, selectedProducts]);

  const hasAnyAdjustment = useMemo(
    () => [costInput, saleInput, commissionPerUnitInput, commissionPercentInput].some((value) => value != null),
    [commissionPerUnitInput, commissionPercentInput, costInput, saleInput],
  );

  const resetLocalState = () => {
    setMode('DELTA');
    setCostInput(null);
    setSaleInput(null);
    setCommissionPerUnitInput(null);
    setCommissionPercentInput(null);
    setReason('');
    setEffectiveAt('');
    setAutoApprove(false);
    setPreviewItems([]);
  };

  const handleClose = () => {
    resetLocalState();
    onClose();
  };

  const handlePreview = async () => {
    if (!selectedProducts.length) {
      message.warning('Vui lòng chọn mã hàng cần điều chỉnh.');
      return;
    }
    if (!hasAnyAdjustment) {
      message.warning('Bạn chưa nhập giá trị điều chỉnh nào.');
      return;
    }
    setPreviewLoading(true);
    try {
      const response = await productsApi.bulkPricePreview(draftItems);
      setPreviewItems(response.items);
      message.success(`Đã tạo preview cho ${response.total} mã hàng.`);
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || 'Không tạo được preview điều chỉnh giá.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSubmit = async () => {
    const trimmedReason = reason.trim();
    if (!selectedProducts.length) {
      message.warning('Vui lòng chọn mã hàng cần điều chỉnh.');
      return;
    }
    if (!hasAnyAdjustment) {
      message.warning('Bạn chưa nhập giá trị điều chỉnh nào.');
      return;
    }
    if (!trimmedReason) {
      message.warning('Vui lòng nhập lý do điều chỉnh giá hàng loạt.');
      return;
    }
    setPreviewLoading(true);
    try {
      const result = await productsApi.bulkPriceSubmit({
        items: draftItems,
        reason: trimmedReason,
        effective_at: normalizeDateTimeLocal(effectiveAt),
        auto_approve: autoApprove,
      });
      message.success(
        autoApprove
          ? `Đã duyệt áp dụng hàng loạt ${result.total} mã hàng. Batch ${result.batch_code}.`
          : `Đã gửi trình duyệt hàng loạt ${result.total} mã hàng. Batch ${result.batch_code}.`,
      );
      resetLocalState();
      onClose();
      onSubmitted?.();
    } catch (err: unknown) {
      const { generalMessage } = parseApiError(err);
      message.error(generalMessage || 'Điều chỉnh giá hàng loạt thất bại.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewColumns = [
    {
      title: 'Mã hàng',
      key: 'product',
      width: 220,
      render: (_: unknown, row: BulkPriceChangePreviewItem) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{row.product_code}</span>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{row.product_name}</span>
        </div>
      ),
    },
    {
      title: 'Giá vốn',
      key: 'cost',
      width: 180,
      render: (_: unknown, row: BulkPriceChangePreviewItem) => (
        <div>
          <div><FormattedPrice value={row.old_cost_price} />{' -> '}<FormattedPrice value={row.new_cost_price} /></div>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>{Number(row.delta_cost).toLocaleString('vi-VN')} đ</div>
        </div>
      ),
    },
    {
      title: 'Đơn giá',
      key: 'sale',
      width: 180,
      render: (_: unknown, row: BulkPriceChangePreviewItem) => (
        <div>
          <div><FormattedPrice value={row.old_sale_price} />{' -> '}<FormattedPrice value={row.new_sale_price} /></div>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>{Number(row.delta_sale).toLocaleString('vi-VN')} đ</div>
        </div>
      ),
    },
    {
      title: 'Hoa hồng',
      key: 'commission',
      width: 220,
      render: (_: unknown, row: BulkPriceChangePreviewItem) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>HHCĐ: <FormattedPrice value={row.old_commission_per_unit} />{' -> '}<FormattedPrice value={row.new_commission_per_unit} /></span>
          <span>HH%: {asNumber(row.old_commission_percent).toLocaleString('vi-VN')}%{' -> '}{asNumber(row.new_commission_percent).toLocaleString('vi-VN')}%</span>
        </div>
      ),
    },
  ];

  return (
    <Modal
      title="Điều chỉnh giá hàng loạt"
      open={open}
      onCancel={handleClose}
      onOk={() => void handleSubmit()}
      okText={autoApprove ? 'Duyệt áp dụng hàng loạt' : 'Gửi trình duyệt hàng loạt'}
      cancelText="Hủy"
      confirmLoading={previewLoading}
      width={980}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Space wrap>
          <Tag color="blue">{selectedProducts.length} mã hàng đã chọn</Tag>
          <Tag color="default">
            Chế độ: {mode === 'SET' ? 'Thiết lập giá trị mới' : mode === 'DELTA' ? 'Cộng/trừ số tiền' : 'Tăng/giảm theo %'}
          </Tag>
        </Space>

        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Kiểu điều chỉnh</div>
            <Select
              style={{ width: '100%' }}
              value={mode}
              onChange={(value) => setMode(value)}
              options={[
                { value: 'SET', label: 'Ghi đè giá trị mới' },
                { value: 'DELTA', label: 'Cộng / trừ' },
                { value: 'PERCENT', label: 'Tăng / giảm theo %' },
              ]}
            />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Giá vốn</div>
            <InputNumber style={{ width: '100%' }} value={costInput} onChange={(value) => setCostInput(value as number | null)} />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Đơn giá</div>
            <InputNumber style={{ width: '100%' }} value={saleInput} onChange={(value) => setSaleInput(value as number | null)} />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>HHCĐ</div>
            <InputNumber style={{ width: '100%' }} value={commissionPerUnitInput} onChange={(value) => setCommissionPerUnitInput(value as number | null)} />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>HH%</div>
            <InputNumber style={{ width: '100%' }} value={commissionPercentInput} onChange={(value) => setCommissionPercentInput(value as number | null)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12 }}>
          <div>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Lý do điều chỉnh</div>
            <Input.TextArea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ví dụ: cập nhật giá giấy đầu tháng 04, điều chỉnh commission nhóm khách A..."
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>Hiệu lực từ</div>
              <input
                type="datetime-local"
                className="pf-input"
                value={effectiveAt}
                onChange={(event) => setEffectiveAt(event.target.value)}
              />
            </div>
            <Checkbox checked={autoApprove} onChange={(event) => setAutoApprove(event.target.checked)}>
              Duyệt áp dụng ngay sau khi tạo batch
            </Checkbox>
            <Button onClick={() => void handlePreview()} loading={previewLoading}>
              Xem preview
            </Button>
          </div>
        </div>

        <Table<BulkPriceChangePreviewItem>
          rowKey="product_id"
          size="small"
          columns={previewColumns}
          dataSource={previewItems}
          pagination={{ pageSize: 6, showSizeChanger: false }}
          locale={{ emptyText: 'Bấm "Xem preview" để kiểm tra batch trước khi gửi.' }}
        />
      </div>
    </Modal>
  );
}
