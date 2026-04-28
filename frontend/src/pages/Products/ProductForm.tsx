/**
 * Form thêm mới / chỉnh sửa sản phẩm – GIAO DIỆN MỚI (duy nhất).
 * Grid Mẹ + Con (thành phần con Lót, Khay…), mã Con tự sinh Mã Mẹ-1, Mã Mẹ-2…
 * Không còn giao diện cũ; toàn bộ thêm/sửa dùng form này.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { App, Modal, Button, Checkbox, Alert } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products';
import { FormInputWithClear } from '../../components';
import type {
  Product,
  ProductFormData,
  ProductChildFormData,
  ProductBundleDefinition,
  ProductBundleUpsertPayload,
  ProductBundlePricingMode,
  ProductBundleDeliveryRule,
  ProductOperationCode,
  ProductOperationInput,
  ProductOperationNotes,
} from '../../types/product';
import { WATERPROOF_OPTIONS } from '../../types/product';
import { useQuickEntryKeys } from '../../hooks/useQuickEntryKeys';
import { parseApiError } from '../../shared/apiError';

interface ProductFormProps {
  visible: boolean;
  onClose: () => void;
  editingProduct?: { id: number } | null;
  mode?: 'create' | 'edit' | 'view';
}

/** Spec lưới: span 1–10 cột (colW động theo contentRef), gap 8. data-quick-entry = bộ nhập nhanh (Enter chuyển ô). */
function Field({
  label,
  required,
  children,
  span,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  span: 1 | 2 | 3 | 4 | 5 | 9 | 10;
}) {
  return (
    <div className="pf-field" style={{ gridColumn: `span ${span}` }} data-quick-entry>
      <label className="pf-label">
        {label}
        {required && <span className="pf-required">*</span>}
      </label>
      {children}
    </div>
  );
}

const defaultMother = (firstUnitId: number | undefined): ProductFormData => ({
  code: '',
  name: '',
  category: undefined,
  unit: firstUnitId ?? (0 as number),
  cost_price: 0,
  sale_price: 0,
  min_stock: 0,
  status: 'ACTIVE',
  size_order: '',
  size_production: '',
  wave: undefined,
  box_type: undefined,
  delivery_tolerance: '',
  commission_per_unit: undefined,
  commission_percent: undefined,
  process_xa: undefined,
  process_in: undefined,
  process_boi: undefined,
  process_can_mang: undefined,
  process_be: undefined,
  process_chap: undefined,
  process_dong: undefined,
  process_dan: undefined,
  process_khac: undefined,
  operation_notes: {},
  film_code: '',
  color_count: undefined,
  mold_code: '',
  waterproof: '',
  note_other: '',
  note: '',
  is_active: true,
});

const defaultChild = (firstUnitId: number | undefined): ProductChildFormData => ({
  name: '',
  component_quantity: 1,
  unit: firstUnitId ?? (0 as number),
  category: undefined,
  cost_price: 0,
  sale_price: 0,
  commission_per_unit: undefined,
  commission_percent: undefined,
  size_order: '',
  size_production: '',
  wave: undefined,
  box_type: undefined,
  delivery_tolerance: '',
  process_xa: undefined,
  process_in: undefined,
  process_boi: undefined,
  process_can_mang: undefined,
  process_be: undefined,
  process_chap: undefined,
  process_dong: undefined,
  process_dan: undefined,
  process_khac: undefined,
  operation_notes: {},
  film_code: '',
  color_count: undefined,
  mold_code: '',
  waterproof: '',
  note_other: '',
  note: '',
  price_change_reason: '',
  is_active: true,
  status: 'ACTIVE',
});

interface BundleFormData {
  pricing_mode: ProductBundlePricingMode;
  fixed_cost_price: number;
  fixed_sale_price: number;
  fixed_commission_per_unit?: number;
  fixed_commission_percent?: number;
  delivery_rule: ProductBundleDeliveryRule;
  note: string;
}

const defaultBundleConfig = (): BundleFormData => ({
  pricing_mode: 'PRIMARY_PRODUCT',
  fixed_cost_price: 0,
  fixed_sale_price: 0,
  fixed_commission_per_unit: undefined,
  fixed_commission_percent: undefined,
  delivery_rule: 'STRICT_FULL_SET',
  note: '',
});

const BUNDLE_PRICING_MODE_OPTIONS: Array<{ value: ProductBundlePricingMode; label: string }> = [
  { value: 'PRIMARY_PRODUCT', label: 'Lấy theo mẹ/đại diện' },
  { value: 'FIXED_BUNDLE', label: 'Giá bộ cố định' },
  { value: 'SUM_COMPONENTS', label: 'Cộng từ thành phần' },
];

const BUNDLE_DELIVERY_RULE_OPTIONS: Array<{ value: ProductBundleDeliveryRule; label: string }> = [
  { value: 'STRICT_FULL_SET', label: 'Giao đồng bộ đủ bộ' },
  { value: 'NON_SYNC', label: 'Giao không đồng bộ' },
];

const PRICE_CHANGE_REASON_OPTIONS = ['Tăng giá', 'Giảm giá', 'Điều chỉnh giá'];

type ProcessField =
  | 'process_xa'
  | 'process_in'
  | 'process_can_mang'
  | 'process_boi'
  | 'process_be'
  | 'process_chap'
  | 'process_dong'
  | 'process_dan'
  | 'process_khac';

interface ProductOperationDefinition {
  code: ProductOperationCode;
  label: string;
  processField: ProcessField;
}

type OperationFormData = Pick<ProductFormData, ProcessField> & {
  operation_notes?: ProductOperationNotes;
};

const PRODUCT_OPERATIONS: ProductOperationDefinition[] = [
  { code: 'XA', label: 'Xả', processField: 'process_xa' },
  { code: 'IN', label: 'In', processField: 'process_in' },
  { code: 'CAN_MANG', label: 'Cán màng', processField: 'process_can_mang' },
  { code: 'BOI', label: 'Bồi', processField: 'process_boi' },
  { code: 'BE', label: 'Bế', processField: 'process_be' },
  { code: 'CHAP', label: 'Chạp', processField: 'process_chap' },
  { code: 'DONG', label: 'Đóng', processField: 'process_dong' },
  { code: 'DAN', label: 'Dán', processField: 'process_dan' },
  { code: 'KHAC', label: 'Khác', processField: 'process_khac' },
];

const PRODUCT_OPERATION_LEFT = PRODUCT_OPERATIONS.slice(0, 5);
const PRODUCT_OPERATION_RIGHT = PRODUCT_OPERATIONS.slice(5);

type ParsedOperationRate =
  | { kind: 'empty' | 'zero'; value: 0 }
  | { kind: 'positive'; value: number }
  | { kind: 'invalid'; reason: 'negative' | 'format' };

function parseOperationRate(value: unknown): ParsedOperationRate {
  const raw = String(value ?? '').trim();
  if (!raw) return { kind: 'empty', value: 0 };
  if (raw.includes('-')) return { kind: 'invalid', reason: 'negative' };
  if (!/^\d+(?:\.\d{3})*$/.test(raw)) return { kind: 'invalid', reason: 'format' };
  const numericValue = Number(raw.replace(/\./g, ''));
  if (!Number.isSafeInteger(numericValue)) return { kind: 'invalid', reason: 'format' };
  if (numericValue <= 0) return { kind: 'zero', value: 0 };
  return { kind: 'positive', value: numericValue };
}

function formatOperationRate(value: unknown): string {
  const parsed = parseOperationRate(value);
  if (parsed.kind === 'positive') return parsed.value.toLocaleString('vi-VN');
  if (parsed.kind === 'zero') return '0';
  if (parsed.kind === 'empty') return '';
  return String(value ?? '');
}

function hasPositiveOperationRate(value: unknown): boolean {
  return parseOperationRate(value).kind === 'positive';
}

function extractOperationFormState(product: Product): OperationFormData {
  const formState = PRODUCT_OPERATIONS.reduce((acc, operation) => {
    acc[operation.processField] = undefined;
    return acc;
  }, {} as OperationFormData);
  const operationNotes: ProductOperationNotes = {};
  const activeOperations = (product.operations ?? []).filter((operation) => operation.is_active !== false);

  if (activeOperations.length > 0) {
    for (const definition of PRODUCT_OPERATIONS) {
      const operation = activeOperations.find((item) => item.operation_code === definition.code);
      if (!operation) continue;
      const rate = Number(operation.standard_rate_per_hour || 0);
      if (rate <= 0) continue;
      formState[definition.processField] = formatOperationRate(rate);
      if ((operation.note ?? '').trim()) {
        operationNotes[definition.code] = operation.note ?? '';
      }
    }
  } else {
    for (const definition of PRODUCT_OPERATIONS) {
      const rate = Number(product[definition.processField] ?? 0);
      if (rate > 0) {
        formState[definition.processField] = formatOperationRate(rate);
      }
    }
  }

  formState.operation_notes = operationNotes;
  return formState;
}

function buildOperationInputs(data: OperationFormData): ProductOperationInput[] {
  return PRODUCT_OPERATIONS.flatMap((definition) => {
    const parsed = parseOperationRate(data[definition.processField]);
    if (parsed.kind !== 'positive') return [];
    const note = (data.operation_notes?.[definition.code] ?? '').trim();
    return [{
      operation_code: definition.code,
      standard_rate_per_hour: parsed.value,
      note,
    }];
  });
}

function buildLegacyProcessPayload(data: OperationFormData): Partial<Record<ProcessField, number | undefined>> {
  return PRODUCT_OPERATIONS.reduce((payload, definition) => {
    const parsed = parseOperationRate(data[definition.processField]);
    payload[definition.processField] = parsed.kind === 'positive' ? parsed.value : undefined;
    return payload;
  }, {} as Partial<Record<ProcessField, number | undefined>>);
}

function validateOperationRates(data: OperationFormData, labelPrefix: string): string | null {
  for (const definition of PRODUCT_OPERATIONS) {
    const parsed = parseOperationRate(data[definition.processField]);
    if (parsed.kind === 'invalid') {
      const reason = parsed.reason === 'negative'
        ? 'không được âm'
        : 'chỉ được nhập số nguyên hoặc dấu chấm hàng nghìn, ví dụ 20.000';
      return `${labelPrefix}: Định mức ${definition.label} ${reason}.`;
    }
  }
  return null;
}

/** Validate khi bấm Cập nhật; không validate khi đang gõ. */
function validateMother(m: ProductFormData): string | null {
  if (!(m.code ?? '').trim()) return 'Vui lòng nhập Mã hàng (Mẹ).';
  if (!(m.name ?? '').trim()) return 'Vui lòng nhập Tên hàng (Mẹ).';
  const cost = Number(m.cost_price);
  const sale = Number(m.sale_price);
  if (Number.isNaN(cost) || cost < 0) return 'Giá vốn không hợp lệ.';
  if (Number.isNaN(sale) || sale < 0) return 'Đơn giá không hợp lệ.';
  if (!m.unit) return 'Vui lòng chọn ĐVT (bắt buộc).';
  if (!m.wave) return 'Vui lòng chọn Sóng (bắt buộc).';
  if (!m.box_type) return 'Vui lòng chọn Kiểu (bắt buộc).';
  return null;
}

function validateChild(c: ProductChildFormData): string | null {
  if (!(c.name ?? '').trim()) return 'Vui lòng nhập Tên hàng (Con).';
  const q = Number(c.component_quantity);
  if (Number.isNaN(q) || q < 1) return 'Số lượng / bộ phải lớn hơn 0.';
  const cost = Number(c.cost_price ?? 0);
  const sale = Number(c.sale_price ?? 0);
  if (Number.isNaN(cost) || cost < 0) return 'Giá vốn hàng con không hợp lệ.';
  if (Number.isNaN(sale) || sale < 0) return 'Đơn giá hàng con không hợp lệ.';
  if (!c.unit) return 'Vui lòng chọn ĐVT (bắt buộc).';
  if (!c.wave) return 'Vui lòng chọn Sóng (bắt buộc).';
  if (!c.box_type) return 'Vui lòng chọn Kiểu (bắt buộc).';
  return null;
}

function normalizeDateTimeLocal(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  if (raw.length === 16) return `${raw}:00`;
  return raw;
}

function deriveCommissionModeFromPricingMode(pricingMode: ProductBundlePricingMode) {
  if (pricingMode === 'FIXED_BUNDLE') return 'FIXED_VALUES';
  if (pricingMode === 'SUM_COMPONENTS') return 'SUM_COMPONENTS';
  return 'PRIMARY_PRODUCT';
}

/** Build payload Mẹ để gửi API. */
function buildMotherPayload(m: ProductFormData, isSet: boolean): ProductFormData {
  const { operation_notes, operations_input, ...base } = m;
  void operation_notes;
  void operations_input;
  return {
    ...base,
    ...buildLegacyProcessPayload(m),
    operations_input: buildOperationInputs(m),
    code: (m.code ?? '').trim(),
    name: (m.name ?? '').trim(),
    cost_price: Number(m.cost_price) || 0,
    sale_price: Number(m.sale_price) || 0,
    min_stock: Number(m.min_stock) || 0,
    unit: m.unit,
    is_set: isSet,
    status: m.status || 'ACTIVE',
    is_active: m.is_active ?? true,
  };
}

/** Build payload Con (sau khi có mother.id). */
function buildChildPayload(
  c: ProductChildFormData,
  parentId: number,
  code: string,
  skipPriceFloorValidation = false,
): ProductFormData & { parent: number } {
  const { operation_notes, ...base } = c;
  void operation_notes;
  return {
    ...base,
    parent: parentId,
    ...buildLegacyProcessPayload(c),
    operations_input: buildOperationInputs(c),
    code,
    name: (c.name ?? '').trim(),
    component_quantity: Number(c.component_quantity) || 1,
    unit: c.unit,
    category: c.category,
    cost_price: Number(c.cost_price) || 0,
    sale_price: Number(c.sale_price) || 0,
    min_stock: 0,
    commission_per_unit: c.commission_per_unit,
    commission_percent: c.commission_percent,
    status: (c.status as 'DRAFT' | 'ACTIVE' | 'DISCONTINUED') ?? 'ACTIVE',
    size_order: c.size_order ?? '',
    size_production: c.size_production ?? '',
    wave: c.wave,
    box_type: c.box_type,
    delivery_tolerance: c.delivery_tolerance ?? '',
    film_code: c.film_code ?? '',
    color_count: c.color_count,
    mold_code: c.mold_code ?? '',
    waterproof: c.waterproof ?? '',
    note_other: c.note_other ?? '',
    note: c.note ?? '',
    price_change_reason: (c.price_change_reason ?? '').trim() || undefined,
    skip_price_floor_validation: skipPriceFloorValidation,
    is_active: c.is_active ?? true,
  };
}

function bundleToFormData(bundle?: ProductBundleDefinition | null): BundleFormData {
  if (!bundle) return defaultBundleConfig();
  return {
    pricing_mode: bundle.pricing_mode ?? 'PRIMARY_PRODUCT',
    fixed_cost_price: Number(bundle.fixed_cost_price ?? 0),
    fixed_sale_price: Number(bundle.fixed_sale_price ?? 0),
    fixed_commission_per_unit: bundle.fixed_commission_per_unit != null ? Number(bundle.fixed_commission_per_unit) : undefined,
    fixed_commission_percent: bundle.fixed_commission_percent != null ? Number(bundle.fixed_commission_percent) : undefined,
    delivery_rule: bundle.delivery_rule ?? 'STRICT_FULL_SET',
    note: bundle.note ?? '',
  };
}

interface OperationRatesEditorProps {
  value: OperationFormData;
  disabled?: boolean;
  onRateChange: (definition: ProductOperationDefinition, value: string) => void;
  onNoteChange: (operationCode: ProductOperationCode, value: string) => void;
}

function OperationRatesEditor({
  value,
  disabled = false,
  onRateChange,
  onNoteChange,
}: OperationRatesEditorProps) {
  const renderTable = (items: ProductOperationDefinition[]) => (
    <table className="pf-operation-table">
      <colgroup>
        <col className="pf-operation-col-name" />
        <col className="pf-operation-col-rate" />
        <col className="pf-operation-col-note" />
      </colgroup>
      <thead>
        <tr>
          <th>Công đoạn</th>
          <th>Định mức</th>
          <th>Ghi chú</th>
        </tr>
      </thead>
      <tbody>
        {items.map((operation) => {
          const rawRate = value[operation.processField] ?? '';
          const noteEnabled = !disabled && hasPositiveOperationRate(rawRate);
          const noteValue = value.operation_notes?.[operation.code] ?? '';
          const handleRateChange = (rawValue: string) => {
            onRateChange(operation, rawValue);
            if (!hasPositiveOperationRate(rawValue)) {
              onNoteChange(operation.code, '');
            }
          };

          return (
            <tr key={operation.code}>
              <td className="pf-operation-name">{operation.label}</td>
              <td data-quick-entry={!disabled ? '' : undefined}>
                <FormInputWithClear
                  type="text"
                  inputMode="numeric"
                  className="pf-input pf-operation-rate-input"
                  placeholder="20.000"
                  disabled={disabled}
                  value={rawRate}
                  onChange={(e) => handleRateChange(e.target.value)}
                  onBlur={(e) => onRateChange(operation, formatOperationRate(e.target.value))}
                  onClear={() => {
                    onRateChange(operation, '');
                    onNoteChange(operation.code, '');
                  }}
                  hasValue={String(rawRate ?? '').trim() !== ''}
                />
              </td>
              <td data-quick-entry={noteEnabled ? '' : undefined}>
                <FormInputWithClear
                  type="text"
                  className="pf-input"
                  disabled={!noteEnabled}
                  value={noteValue}
                  onChange={(e) => onNoteChange(operation.code, e.target.value)}
                  onClear={() => onNoteChange(operation.code, '')}
                  hasValue={noteValue.trim() !== ''}
                  style={!noteEnabled ? { background: 'var(--app-surface-accent)' } : undefined}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="pf-operation-editor">
      <div className="pf-operation-title">Công đoạn sản xuất</div>
      <div className="pf-operation-grid">
        {renderTable(PRODUCT_OPERATION_LEFT)}
        {renderTable(PRODUCT_OPERATION_RIGHT)}
      </div>
    </div>
  );
}

interface ChildBlockProps {
  index: number;
  motherCode: string;
  child: ProductChildFormData;
  canEditChildPrice: boolean;
  canEditChildCommission: boolean;
  onChange: (field: keyof ProductChildFormData, value: unknown) => void;
  onRemove: () => void;
  canRemove: boolean;
  categories: { id: number; name: string }[];
  units: { id: number; name: string; code: string }[];
  waves: { id: number; code: string; name: string }[];
  boxTypes: { id: number; code: string; name: string }[];
}

function ChildBlock({
  index,
  motherCode,
  child,
  canEditChildPrice,
  canEditChildCommission,
  onChange,
  onRemove,
  canRemove,
  categories,
  units,
  waves,
  boxTypes,
}: ChildBlockProps) {
  const childCode = motherCode.trim() ? `${motherCode.trim()}-${index + 1}` : '—';

  return (
    <div className="pf-child-card">
      <div className="pf-row pf-row-child1" style={{ alignItems: 'center' }}>
        <Field label="Mã hàng (Con)" required span={2}>
          <input type="text" className="pf-input" value={childCode} readOnly style={{ background: 'var(--app-surface-accent)' }} />
        </Field>
        <Field label="Tên hàng" required span={2}>
          <FormInputWithClear
            type="text"
            className="pf-input"
            value={child.name ?? ''}
            onChange={(e) => onChange('name', e.target.value)}
            onClear={() => onChange('name', '')}
          />
        </Field>
        <Field label="Danh mục" span={2}>
          <select
            className="pf-select"
            value={child.category ?? ''}
            onChange={(e) => onChange('category', e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">Chọn</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Số lượng / bộ" required span={3}>
          <FormInputWithClear
            type="number"
            className="pf-input"
            min={1}
            value={child.component_quantity ?? ''}
            onChange={(e) => onChange('component_quantity', e.target.value === '' ? '' : Number(e.target.value))}
            onClear={() => onChange('component_quantity', 1)}
            hasValue={child.component_quantity != null && child.component_quantity !== 1}
          />
        </Field>
        {canRemove && (
          <div style={{ gridColumn: 'span 1', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={onRemove}>Xóa</Button>
          </div>
        )}
      </div>
      <div className="pf-row">
        <Field label="Giá vốn" span={1}>
          <FormInputWithClear
            type="number"
            className="pf-input"
            min={0}
            value={child.cost_price === 0 ? '' : child.cost_price ?? ''}
            onChange={(e) => onChange('cost_price', e.target.value === '' ? 0 : Number(e.target.value))}
            onClear={() => onChange('cost_price', 0)}
            hasValue={Number(child.cost_price ?? 0) !== 0}
          />
        </Field>
        <Field label="Đơn giá" span={1}>
          <FormInputWithClear
            type="number"
            className="pf-input"
            min={0}
            disabled={!canEditChildPrice}
            value={child.sale_price === 0 ? '' : child.sale_price ?? ''}
            onChange={(e) => onChange('sale_price', e.target.value === '' ? 0 : Number(e.target.value))}
            onClear={() => onChange('sale_price', 0)}
            hasValue={Number(child.sale_price ?? 0) !== 0}
            style={!canEditChildPrice ? { background: 'var(--app-surface-accent)' } : undefined}
          />
        </Field>
        <Field label="HHCĐ" span={1}>
          <FormInputWithClear
            type="number"
            className="pf-input"
            min={0}
            disabled={!canEditChildCommission}
            value={child.commission_per_unit ?? ''}
            onChange={(e) => onChange('commission_per_unit', e.target.value === '' ? undefined : Number(e.target.value))}
            onClear={() => onChange('commission_per_unit', undefined)}
            hasValue={child.commission_per_unit != null}
            style={!canEditChildCommission ? { background: 'var(--app-surface-accent)' } : undefined}
          />
        </Field>
        <Field label="HH%" span={1}>
          <FormInputWithClear
            type="number"
            className="pf-input"
            min={0}
            disabled={!canEditChildCommission}
            value={child.commission_percent ?? ''}
            onChange={(e) => onChange('commission_percent', e.target.value === '' ? undefined : Number(e.target.value))}
            onClear={() => onChange('commission_percent', undefined)}
            hasValue={child.commission_percent != null}
            style={!canEditChildCommission ? { background: 'var(--app-surface-accent)' } : undefined}
          />
        </Field>
        <Field label="Lý do thay đổi giá (Con)" span={4}>
          <FormInputWithClear
            type="text"
            list="price-change-reason-options"
            placeholder="Nhập tay hoặc chọn gợi ý"
            className="pf-input"
            value={child.price_change_reason ?? ''}
            onChange={(e) => onChange('price_change_reason', e.target.value)}
            onClear={() => onChange('price_change_reason', '')}
          />
        </Field>
      </div>
      <div className="pf-row pf-row-size">
        <Field label="Dài PO" span={1}>
          <input type="text" placeholder="Khách" className="pf-input" value={(child.size_order ?? '').split(/x/)[0]?.trim() ?? ''} onChange={(e) => { const p = (child.size_order ?? '').split(/x/); p[0] = e.target.value; onChange('size_order', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
        </Field>
        <Field label="Rộng PO" span={1}>
          <input type="text" placeholder="Khách" className="pf-input" value={(child.size_order ?? '').split(/x/)[1]?.trim() ?? ''} onChange={(e) => { const p = (child.size_order ?? '').split(/x/); p[1] = e.target.value; onChange('size_order', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
        </Field>
        <Field label="Cao PO" span={1}>
          <input type="text" placeholder="Khách" className="pf-input" value={(child.size_order ?? '').split(/x/)[2]?.trim() ?? ''} onChange={(e) => { const p = (child.size_order ?? '').split(/x/); p[2] = e.target.value; onChange('size_order', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
        </Field>
        <Field label="Dài SX" span={1}>
          <input type="text" placeholder="Sản xuất" className="pf-input" value={(child.size_production ?? '').split(/x/)[0]?.trim() ?? ''} onChange={(e) => { const p = (child.size_production ?? '').split(/x/); p[0] = e.target.value; onChange('size_production', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
        </Field>
        <Field label="Rộng SX" span={1}>
          <input type="text" placeholder="Sản xuất" className="pf-input" value={(child.size_production ?? '').split(/x/)[1]?.trim() ?? ''} onChange={(e) => { const p = (child.size_production ?? '').split(/x/); p[1] = e.target.value; onChange('size_production', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
        </Field>
        <Field label="Cao SX" span={1}>
          <input type="text" placeholder="Sản xuất" className="pf-input" value={(child.size_production ?? '').split(/x/)[2]?.trim() ?? ''} onChange={(e) => { const p = (child.size_production ?? '').split(/x/); p[2] = e.target.value; onChange('size_production', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
        </Field>
        <Field label="Sóng" required span={1}>
          <select className="pf-select" value={child.wave ?? ''} onChange={(e) => onChange('wave', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Chọn</option>
            {waves.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
          </select>
        </Field>
        <Field label="Kiểu" required span={1}>
          <select className="pf-select" value={child.box_type ?? ''} onChange={(e) => onChange('box_type', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Chọn</option>
            {boxTypes.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
          </select>
        </Field>
        <Field label="ĐVT" required span={1}>
          <select className="pf-select" value={child.unit ?? ''} onChange={(e) => onChange('unit', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Chọn</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="+/-" span={1}>
          <FormInputWithClear type="text" className="pf-input" value={child.delivery_tolerance ?? ''} onChange={(e) => onChange('delivery_tolerance', e.target.value)} onClear={() => onChange('delivery_tolerance', '')} />
        </Field>
      </div>
      <div className="pf-row">
        <Field label="Mã phim" span={2}>
          <FormInputWithClear type="text" placeholder="Tải file" className="pf-input" value={child.film_code ?? ''} onChange={(e) => onChange('film_code', e.target.value)} onClear={() => onChange('film_code', '')} />
        </Field>
        <Field label="Số màu" span={1}>
          <FormInputWithClear type="number" className="pf-input" value={child.color_count ?? ''} onChange={(e) => onChange('color_count', e.target.value ? Number(e.target.value) : undefined)} onClear={() => onChange('color_count', undefined)} hasValue={child.color_count != null} />
        </Field>
        <Field label="C. thấm" span={1}>
          <select className="pf-select" value={child.waterproof ?? ''} onChange={(e) => onChange('waterproof', e.target.value)}>
            {WATERPROOF_OPTIONS.map((o) => <option key={o.value || 'x'} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Mã khuôn" span={2}>
          <FormInputWithClear type="text" placeholder="Tải file" className="pf-input" value={child.mold_code ?? ''} onChange={(e) => onChange('mold_code', e.target.value)} onClear={() => onChange('mold_code', '')} />
        </Field>
        <Field label="Ghi chú sản xuất" span={4}>
          <FormInputWithClear type="text" className="pf-input" value={child.note_other ?? ''} onChange={(e) => onChange('note_other', e.target.value)} onClear={() => onChange('note_other', '')} />
        </Field>
      </div>
      <OperationRatesEditor
        value={child}
        onRateChange={(operation, rawValue) => onChange(operation.processField, rawValue)}
        onNoteChange={(operationCode, note) => onChange('operation_notes', {
          ...(child.operation_notes ?? {}),
          [operationCode]: note,
        })}
      />
      <div className="pf-row pf-row-note">
        <Field label="Ghi chú mã hàng" span={9}>
          <FormInputWithClear type="text" className="pf-input" value={child.note ?? ''} onChange={(e) => onChange('note', e.target.value)} onClear={() => onChange('note', '')} />
        </Field>
        <Field label="Trạng thái" span={1}>
          <select
            className="pf-select"
            value={child.status ?? 'ACTIVE'}
            onChange={(e) => {
              const v = e.target.value as 'DRAFT' | 'ACTIVE' | 'DISCONTINUED';
              onChange('status', v);
              onChange('is_active', v !== 'DISCONTINUED');
            }}
            style={{
              backgroundColor:
                (child.status ?? 'ACTIVE') === 'ACTIVE'
                  ? 'color-mix(in srgb, var(--app-success-bg) 72%, var(--app-surface))'
                  : (child.status ?? 'ACTIVE') === 'DISCONTINUED'
                    ? 'color-mix(in srgb, var(--app-danger-bg) 72%, var(--app-surface))'
                    : 'color-mix(in srgb, var(--app-warning-bg) 72%, var(--app-surface))',
            }}
          >
            <option value="ACTIVE">Đang bán</option>
            <option value="DISCONTINUED">Ngừng SX</option>
            <option value="DRAFT">Nháp</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

/** Map Product (API) → ProductChildFormData — dùng khi load components khi sửa */
function componentToChildFormData(c: Product, firstUnitId: number | undefined): ProductChildFormData {
  const operationState = extractOperationFormState(c);
  return {
    id: c.id,
    name: c.name ?? '',
    component_quantity: Number(c.component_quantity) || 1,
    unit: c.unit ?? firstUnitId ?? (0 as number),
    category: c.category ?? undefined,
    cost_price: c.cost_price != null ? Number(c.cost_price) : 0,
    sale_price: c.sale_price != null ? Number(c.sale_price) : 0,
    commission_per_unit: c.commission_per_unit != null ? Number(c.commission_per_unit) : undefined,
    commission_percent: c.commission_percent != null ? Number(c.commission_percent) : undefined,
    size_order: c.size_order ?? '',
    size_production: c.size_production ?? '',
    wave: c.wave ?? undefined,
    box_type: c.box_type ?? undefined,
    delivery_tolerance: c.delivery_tolerance ?? '',
    ...operationState,
    film_code: c.film_code ?? '',
    color_count: c.color_count ?? undefined,
    mold_code: c.mold_code ?? '',
    waterproof: (c.waterproof as string) ?? '',
    note_other: c.note_other ?? '',
    note: c.note ?? '',
    price_change_reason: '',
    is_active: c.is_active ?? true,
    status: (c.status as 'DRAFT' | 'ACTIVE' | 'DISCONTINUED') ?? (c.is_active !== false ? 'ACTIVE' : 'DISCONTINUED'),
  };
}

/** Map Product (API) → ProductFormData */
function productToMother(p: Product): ProductFormData {
  const operationState = extractOperationFormState(p);
  return {
    code: p.code ?? '',
    name: p.name ?? '',
    category: p.category ?? undefined,
    description: p.description ?? '',
    unit: p.unit ?? 0,
    cost_price: parseFloat(String(p.cost_price ?? 0)) || 0,
    sale_price: parseFloat(String(p.sale_price ?? 0)) || 0,
    min_stock: parseFloat(String(p.min_stock ?? 0)) || 0,
    status: (p.status as ProductFormData['status']) ?? 'ACTIVE',
    size_order: p.size_order ?? '',
    size_production: p.size_production ?? '',
    wave: p.wave ?? undefined,
    box_type: p.box_type ?? undefined,
    delivery_tolerance: p.delivery_tolerance ?? '',
    commission_per_unit: p.commission_per_unit != null ? parseFloat(String(p.commission_per_unit)) : undefined,
    commission_percent: p.commission_percent != null ? parseFloat(String(p.commission_percent)) : undefined,
    ...operationState,
    film_code: p.film_code ?? '',
    color_count: p.color_count ?? undefined,
    mold_code: p.mold_code ?? '',
    waterproof: (p.waterproof as string) ?? '',
    note_other: p.note_other ?? '',
    note: p.note ?? '',
    is_active: p.is_active ?? true,
  };
}

const ProductForm = ({ visible, onClose, editingProduct, mode = 'create' }: ProductFormProps) => {
  const queryClient = useQueryClient();
  const isViewMode = mode === 'view';
  const isEditingMode = mode === 'edit';
  const { data: productDetail, isError: productFetchError } = useQuery({
    queryKey: ['product', editingProduct?.id],
    queryFn: () => productsApi.getProduct(editingProduct!.id),
    enabled: visible && !!editingProduct?.id,
    retry: false,
  });
  const isEditingChild = productDetail?.parent != null;
  const { data: parentDetail } = useQuery({
    queryKey: ['product', productDetail?.parent],
    queryFn: () => productsApi.getProduct(productDetail!.parent!),
    enabled: visible && !!productDetail?.parent,
  });
  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => productsApi.getCategories({ page_size: 200 }),
    enabled: visible,
  });
  const { data: unitsData } = useQuery({
    queryKey: ['units'],
    queryFn: () => productsApi.getUnits({ page_size: 200 }),
    enabled: visible,
  });
  const { data: wavesData } = useQuery({
    queryKey: ['waves'],
    queryFn: () => productsApi.getWaves({ page_size: 200 }),
    enabled: visible,
  });
  const { data: boxTypesData } = useQuery({
    queryKey: ['boxTypes'],
    queryFn: () => productsApi.getBoxTypes({ page_size: 200 }),
    enabled: visible,
  });

  const categories = useMemo(() => categoriesData?.results ?? [], [categoriesData]);
  const units = useMemo(() => unitsData?.results ?? [], [unitsData]);
  const waves = useMemo(() => wavesData?.results ?? [], [wavesData]);
  const boxTypes = useMemo(() => boxTypesData?.results ?? [], [boxTypesData]);
  const firstUnitId = units[0]?.id;

  const [mother, setMother] = useState<ProductFormData>(() => defaultMother(firstUnitId));
  const [bundleConfig, setBundleConfig] = useState<BundleFormData>(() => defaultBundleConfig());
  const [hasChildren, setHasChildren] = useState(false);
  const [children, setChildren] = useState<ProductChildFormData[]>([]);
  const [priceChangeReason, setPriceChangeReason] = useState('');
  const [priceEffectiveAt, setPriceEffectiveAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { message } = App.useApp();

  useEffect(() => {
    if (!visible) return;
    setSubmitError(null);
    if (editingProduct?.id && productDetail) {
      if (productDetail.parent != null) {
        if (parentDetail) {
          setMother(productToMother(parentDetail));
          setBundleConfig(bundleToFormData(parentDetail.bundle_definition));
          setHasChildren(true);
          setChildren([componentToChildFormData(productDetail, firstUnitId)]);
          originalComponentIdsRef.current = [productDetail.id].filter((id): id is number => id != null);
        }
      } else {
        setMother(productToMother(productDetail));
        setBundleConfig(bundleToFormData(productDetail.bundle_definition));
        const comps = productDetail.components ?? [];
        setHasChildren(comps.length > 0);
        setChildren(comps.map((c) => componentToChildFormData(c, firstUnitId)));
        originalComponentIdsRef.current = comps.map((c) => c.id).filter((id): id is number => id != null);
      }
    } else if (!editingProduct) {
      setMother(defaultMother(firstUnitId));
      setBundleConfig(defaultBundleConfig());
      setChildren([]);
      setHasChildren(false);
    }
    if (!editingProduct?.id && !productDetail) {
      setBundleConfig(defaultBundleConfig());
    }
    setPriceChangeReason('');
    setPriceEffectiveAt('');
  }, [visible, editingProduct, productDetail, parentDetail, firstUnitId]);

  const GAP = 8;
  const PADDING_X = 16;
  const COLS = 10;
  const contentRef = useRef<HTMLDivElement>(null);
  const quickEntryContainerRef = useRef<HTMLDivElement>(null);
  /** IDs components ban đầu khi load (để biết cần xóa khi user bỏ con) */
  const originalComponentIdsRef = useRef<number[]>([]);
  /* Chiều rộng grid cố định để colW không nhảy khi thêm con / scrollbar → tránh ô bị phóng to */
  const CONTENT_MAX_WIDTH = 1280;
  const colW = (CONTENT_MAX_WIDTH - GAP * (COLS - 1)) / COLS;
  /* Khối Thêm con + card CON + Huỷ/Cập nhật thẳng mép phải với ô Ghi chú chung (Mẹ) = 8 + 1280 */
  const CON_ALIGN_WIDTH = 1288;

  /* Bộ nhập nhanh: Enter chuyển ô, ô cuối → Cập nhật (handleSubmit) */
  useQuickEntryKeys(quickEntryContainerRef, {
    onLastFieldEnter: () => void handleSubmit(),
    enabled: visible,
  });

  const createMotherMutation = useMutation({
    mutationFn: (data: ProductFormData) => productsApi.createProduct(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });
  const updateMotherMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ProductFormData> }) => productsApi.updateProduct(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });
  const createChildMutation = useMutation({
    mutationFn: (data: ProductFormData & { parent: number }) => productsApi.createProduct(data as ProductFormData),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });
  const updateChildMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ProductFormData> }) => productsApi.updateProduct(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });
  const deleteChildMutation = useMutation({
    mutationFn: (id: number) => productsApi.deleteProduct(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  const setMotherField = <K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) => {
    setMother((prev) => ({ ...prev, [key]: value }));
  };

  const setBundleField = <K extends keyof BundleFormData>(key: K, value: BundleFormData[K]) => {
    setBundleConfig((prev) => ({ ...prev, [key]: value }));
  };

  const canEditMotherPrice = !hasChildren || bundleConfig.pricing_mode !== 'FIXED_BUNDLE';
  const canEditChildPrice = hasChildren && bundleConfig.pricing_mode === 'SUM_COMPONENTS';
  const requiresFixedBundlePrice = hasChildren && bundleConfig.pricing_mode === 'FIXED_BUNDLE';
  const canEditMotherCommission = !hasChildren || bundleConfig.pricing_mode !== 'FIXED_BUNDLE';
  const canEditChildCommission = hasChildren && bundleConfig.pricing_mode === 'SUM_COMPONENTS';
  const showFixedBundleCommissionFields = hasChildren && bundleConfig.pricing_mode === 'FIXED_BUNDLE';
  const skipMotherPriceFloorValidation = hasChildren && bundleConfig.pricing_mode === 'FIXED_BUNDLE';
  const skipChildPriceFloorValidation = hasChildren && bundleConfig.pricing_mode !== 'SUM_COMPONENTS';

  const setChild = (index: number, field: keyof ProductChildFormData, value: unknown) => {
    setChildren((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addChild = () => {
    setChildren((prev) => [...prev, defaultChild(firstUnitId)]);
    setHasChildren(true);
  };

  const removeChild = (index: number) => {
    setChildren((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setHasChildren(false);
      return next;
    });
  };

  const syncBundleForMother = async (
    motherId: number,
    componentRows: Array<{ id: number; component_quantity: number }>
  ) => {
    if (componentRows.length === 0) {
      try {
        await productsApi.deleteProductBundle(motherId);
      } catch {
        // Ignore when bundle does not exist yet.
      }
      return;
    }
    const payload: ProductBundleUpsertPayload = {
      sellable_product: motherId,
      primary_product: motherId,
      pricing_mode: bundleConfig.pricing_mode,
      fixed_cost_price: String(Number(bundleConfig.fixed_cost_price || 0)),
      fixed_sale_price: String(Number(bundleConfig.fixed_sale_price || 0)),
      commission_mode: deriveCommissionModeFromPricingMode(bundleConfig.pricing_mode),
      fixed_commission_per_unit: String(Number(bundleConfig.fixed_commission_per_unit || 0)),
      fixed_commission_percent: String(Number(bundleConfig.fixed_commission_percent || 0)),
      delivery_rule: bundleConfig.delivery_rule,
      note: bundleConfig.note || '',
      is_active: true,
      components: [
        {
          component_product: motherId,
          qty_per_bundle: '1',
          is_required: bundleConfig.delivery_rule === 'STRICT_FULL_SET',
          sort_order: 0,
          is_active: true,
        },
        ...componentRows.map((item, index) => ({
          component_product: item.id,
          qty_per_bundle: String(Number(item.component_quantity || 1)),
          is_required: bundleConfig.delivery_rule === 'STRICT_FULL_SET',
          sort_order: index + 1,
          is_active: true,
        })),
      ],
    };
    await productsApi.upsertProductBundle(motherId, payload);
  };

  const handleSubmit = async () => {
    if (isViewMode) return;
    setSubmitError(null);
    const errMother = validateMother(mother);
    if (errMother) {
      setSubmitError(errMother);
      message.error(errMother);
      return;
    }
    const motherOperationError = validateOperationRates(mother, 'Mã mẹ');
    if (motherOperationError) {
      setSubmitError(motherOperationError);
      message.error(motherOperationError);
      return;
    }
    if (requiresFixedBundlePrice && Number(bundleConfig.fixed_sale_price || 0) <= 0) {
      const err = 'Khi chọn Giá bộ cố định, bắt buộc nhập Đơn giá bộ lớn hơn 0.';
      setSubmitError(err);
      message.error(err);
      return;
    }
    if (hasChildren && bundleConfig.pricing_mode === 'PRIMARY_PRODUCT' && Number(mother.sale_price || 0) <= 0) {
      const err = 'Khi chọn Lấy theo mẹ/đại diện, mã mẹ phải có Đơn giá lớn hơn 0.';
      setSubmitError(err);
      message.error(err);
      return;
    }
    if (hasChildren && bundleConfig.pricing_mode === 'SUM_COMPONENTS' && Number(mother.sale_price || 0) <= 0) {
      const err = 'Khi chọn Giá từ thành phần, mã mẹ cũng phải có Đơn giá lớn hơn 0.';
      setSubmitError(err);
      message.error(err);
      return;
    }
    if (!hasChildren && Number(mother.sale_price || 0) > 0 && Number(mother.cost_price || 0) > Number(mother.sale_price || 0)) {
      const err = 'Đơn giá phải lớn hơn hoặc bằng giá vốn.';
      setSubmitError(err);
      message.error(err);
      return;
    }
    if (canEditMotherPrice && Number(mother.sale_price || 0) > 0 && Number(mother.cost_price || 0) > Number(mother.sale_price || 0)) {
      const err = 'Đơn giá của mã mẹ phải lớn hơn hoặc bằng giá vốn.';
      setSubmitError(err);
      message.error(err);
      return;
    }
    if (hasChildren && children.length > 0) {
      for (let i = 0; i < children.length; i++) {
        if (hasChildren && bundleConfig.pricing_mode === 'SUM_COMPONENTS' && Number(children[i].sale_price || 0) <= 0) {
          const errMsg = `Con ${i + 1}: Khi chọn Giá từ thành phần, bắt buộc nhập Đơn giá lớn hơn 0.`;
          setSubmitError(errMsg);
          message.error(errMsg);
          return;
        }
        if (canEditChildPrice &&
          Number(children[i].sale_price || 0) > 0 &&
          Number(children[i].cost_price || 0) > Number(children[i].sale_price || 0)) {
          const errMsg = `Con ${i + 1}: Đơn giá phải lớn hơn hoặc bằng giá vốn.`;
          setSubmitError(errMsg);
          message.error(errMsg);
          return;
        }
        const err = validateChild(children[i]);
        if (err) {
          const errMsg = `Con ${i + 1}: ${err}`;
          setSubmitError(errMsg);
          message.error(errMsg);
          return;
        }
        const operationError = validateOperationRates(children[i], `Con ${i + 1}`);
        if (operationError) {
          setSubmitError(operationError);
          message.error(operationError);
          return;
        }
      }
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const isSet = hasChildren && children.length > 0;
      const motherPayload = {
        ...buildMotherPayload(mother, isSet),
        skip_price_floor_validation: skipMotherPriceFloorValidation,
      };

      if (editingProduct?.id) {
        if (isEditingChild) {
          const child = children[0];
          if (child && productDetail?.parent != null) {
            const motherId = productDetail.parent;
            const childCode = (productDetail.code ?? '').trim() || `${(mother.code ?? '').trim()}-1`;
            const fullPayload = buildChildPayload(child, motherId, childCode, skipChildPriceFloorValidation);
            const updateData = Object.fromEntries(
              Object.entries(fullPayload).filter(([key]) => key !== 'parent' && key !== 'code'),
            );
            await updateChildMutation.mutateAsync({ id: editingProduct.id, data: updateData });
            const remainingChildren = (parentDetail?.components ?? [])
              .filter((item) => item.id !== editingProduct.id)
              .map((item) => ({
                id: item.id,
                component_quantity: Number(item.component_quantity) || 1,
              }));
            await syncBundleForMother(motherId, [
              ...remainingChildren,
              { id: editingProduct.id, component_quantity: Number(child.component_quantity) || 1 },
            ]);
            message.success('Đã cập nhật sản phẩm thành công.');
          } else if (children.length === 0 && productDetail?.parent != null) {
            await deleteChildMutation.mutateAsync(editingProduct.id);
            const motherId = productDetail.parent;
            const remainingChildren = (parentDetail?.components ?? [])
              .filter((item) => item.id !== editingProduct.id)
              .map((item) => ({
                id: item.id,
                component_quantity: Number(item.component_quantity) || 1,
              }));
            await syncBundleForMother(motherId, remainingChildren);
            message.success('Đã xóa mã hàng con.');
          }
          queryClient.invalidateQueries({ queryKey: ['product', editingProduct.id] });
          queryClient.invalidateQueries({ queryKey: ['product', productDetail?.parent] });
        } else {
          await updateMotherMutation.mutateAsync({
            id: editingProduct.id,
            data: {
              ...motherPayload,
              price_change_reason: priceChangeReason.trim() || undefined,
              price_effective_at: normalizeDateTimeLocal(priceEffectiveAt),
            },
          });
          const motherId = editingProduct.id;
          const motherCode = (mother.code ?? '').trim();
          const currentChildIds = isSet ? children.map((c) => c.id).filter((id): id is number => id != null) : [];
          const idsToDelete = originalComponentIdsRef.current.filter((id) => !currentChildIds.includes(id));
          for (const id of idsToDelete) {
            await deleteChildMutation.mutateAsync(id);
          }
          const bundleRows: Array<{ id: number; component_quantity: number }> = [];
          if (isSet && children.length > 0) {
            for (let i = 0; i < children.length; i++) {
              const child = children[i];
              const childCode = `${motherCode}-${i + 1}`;
              const fullPayload = buildChildPayload(child, motherId, childCode, skipChildPriceFloorValidation);
              const updateData = Object.fromEntries(
                Object.entries(fullPayload).filter(([key]) => key !== 'parent' && key !== 'code'),
              );
              if (child.id != null) {
                await updateChildMutation.mutateAsync({ id: child.id, data: updateData });
                bundleRows.push({ id: child.id, component_quantity: Number(child.component_quantity) || 1 });
              } else {
                const createdChild = await createChildMutation.mutateAsync(fullPayload);
                bundleRows.push({ id: createdChild.id, component_quantity: Number(child.component_quantity) || 1 });
              }
            }
          }
          await syncBundleForMother(motherId, bundleRows);
          queryClient.invalidateQueries({ queryKey: ['product', editingProduct.id] });
          message.success('Đã cập nhật sản phẩm thành công.');
        }
      } else {
        const created = await createMotherMutation.mutateAsync(motherPayload);
        const motherId = created.id;
        const motherCode = (mother.code ?? '').trim();
        const bundleRows: Array<{ id: number; component_quantity: number }> = [];

        if (isSet && children.length > 0) {
          for (let i = 0; i < children.length; i++) {
            const childPayload = buildChildPayload(
              children[i],
              motherId,
              `${motherCode}-${i + 1}`,
              skipChildPriceFloorValidation,
            );
            const createdChild = await createChildMutation.mutateAsync(childPayload);
            bundleRows.push({ id: createdChild.id, component_quantity: Number(children[i].component_quantity) || 1 });
          }
        }
        await syncBundleForMother(motherId, bundleRows);
        message.success('Đã thêm sản phẩm thành công.');
      }

      setSubmitError(null);
      onClose();
      setMother(defaultMother(firstUnitId));
      setBundleConfig(defaultBundleConfig());
      setChildren([]);
      setHasChildren(false);
    } catch (e: unknown) {
      const { generalMessage } = parseApiError(e);
      const msg = generalMessage || 'Có lỗi khi lưu.';
      setSubmitError(msg);
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <div style={{ fontSize: '1.2em', textAlign: 'left', marginLeft: 0 }}>
          {isViewMode ? 'Chi tiết Sản phẩm' : isEditingMode ? 'Chỉnh sửa Sản phẩm' : 'Thêm Mới Sản phẩm'}
        </div>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width="92vw"
      style={{ maxWidth: 1377 }}
      destroyOnHidden
      styles={{
        wrapper: { overflowX: 'hidden', overflowY: 'auto' },
        header: { paddingLeft: PADDING_X },
        body: { padding: 0, maxHeight: 'calc(100vh - 120px)', overflowX: 'hidden', overflowY: 'auto' },
      }}
    >
      <div
        ref={contentRef}
        style={{
          padding: `${PADDING_X}px`,
          overflowX: 'hidden',
          overflowY: 'auto',
          maxHeight: 'calc(100vh - 120px)',
        }}
      >
        <div style={{ overflow: 'visible', width: CON_ALIGN_WIDTH, maxWidth: '100%', ['--pf-col-w' as string]: `${colW}px` }}>
          <div className={`pf-container${isViewMode ? ' pf-view-mode' : ''}`} ref={quickEntryContainerRef}>
        {editingProduct && productFetchError && (
          <Alert type="error" message="Không thể tải thông tin sản phẩm. Vui lòng thử lại hoặc đóng form và mở lại." style={{ marginBottom: 16 }} />
        )}
        {submitError && (
          <Alert
            type="error"
            message={submitError}
            showIcon
            closable
            onClose={() => setSubmitError(null)}
            style={{ marginBottom: 16 }}
          />
        )}
        <div
          aria-disabled={isViewMode}
          style={{
            pointerEvents: isViewMode ? 'none' : 'auto',
            userSelect: isViewMode ? 'none' : 'auto',
          }}
        >
        <datalist id="price-change-reason-options">
          {PRICE_CHANGE_REASON_OPTIONS.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <section className="pf-section pf-section-mother">
          <div className="pf-row pf-row-price">
            <Field label="Mã hàng (Mẹ)" required span={2}>
              <FormInputWithClear
                type="text"
                className="pf-input"
                value={mother.code ?? ''}
                onChange={(e) => setMotherField('code', e.target.value)}
                onClear={() => setMotherField('code', '')}
              />
            </Field>
            <Field label="Tên hàng" required span={2}>
              <FormInputWithClear
                type="text"
                className="pf-input"
                value={mother.name ?? ''}
                onChange={(e) => setMotherField('name', e.target.value)}
                onClear={() => setMotherField('name', '')}
              />
            </Field>
            <Field label="Danh mục" span={2}>
              <select className="pf-select" value={mother.category ?? ''} onChange={(e) => setMotherField('category', e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">Chọn</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Giá vốn" required span={1}>
              <FormInputWithClear
                type="number"
                className="pf-input"
                min={0}
                value={mother.cost_price === 0 ? '' : mother.cost_price}
                onChange={(e) => setMotherField('cost_price', e.target.value === '' ? 0 : Number(e.target.value))}
                onClear={() => setMotherField('cost_price', 0)}
                hasValue={mother.cost_price !== 0}
              />
            </Field>
            <Field label="Đơn giá" required span={1}>
              <FormInputWithClear
                type="number"
                className="pf-input"
                min={0}
                disabled={!canEditMotherPrice}
                value={mother.sale_price === 0 ? '' : mother.sale_price}
                onChange={(e) => setMotherField('sale_price', e.target.value === '' ? 0 : Number(e.target.value))}
                onClear={() => setMotherField('sale_price', 0)}
                hasValue={mother.sale_price !== 0}
                style={!canEditMotherPrice ? { background: 'var(--app-surface-accent)' } : undefined}
              />
            </Field>
            <Field label="HHCĐ" span={1}>
              <FormInputWithClear
                type="number"
                className="pf-input"
                min={0}
                disabled={!canEditMotherCommission}
                value={mother.commission_per_unit ?? ''}
                onChange={(e) => setMotherField('commission_per_unit', e.target.value === '' ? undefined : Number(e.target.value))}
                onClear={() => setMotherField('commission_per_unit', undefined)}
                hasValue={mother.commission_per_unit != null}
                style={!canEditMotherCommission ? { background: 'var(--app-surface-accent)' } : undefined}
              />
            </Field>
            <Field label="HH%" span={1}>
              <FormInputWithClear
                type="number"
                className="pf-input"
                min={0}
                disabled={!canEditMotherCommission}
                value={mother.commission_percent ?? ''}
                onChange={(e) => setMotherField('commission_percent', e.target.value === '' ? undefined : Number(e.target.value))}
                onClear={() => setMotherField('commission_percent', undefined)}
                hasValue={mother.commission_percent != null}
                style={!canEditMotherCommission ? { background: 'var(--app-surface-accent)' } : undefined}
              />
            </Field>
          </div>
          {hasChildren && (
            <>
              <div className="pf-row">
                <Field label="Cách tính giá bộ" span={2}>
                  <select
                    className="pf-select"
                    value={bundleConfig.pricing_mode}
                    onChange={(e) => setBundleField('pricing_mode', e.target.value as ProductBundlePricingMode)}
                  >
                    {BUNDLE_PRICING_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
                {requiresFixedBundlePrice && (
                  <Field label="Đơn giá bộ" span={1} required>
                    <FormInputWithClear
                      type="number"
                      className="pf-input"
                      min={0}
                      value={bundleConfig.fixed_sale_price === 0 ? '' : bundleConfig.fixed_sale_price}
                      onChange={(e) => setBundleField('fixed_sale_price', e.target.value === '' ? 0 : Number(e.target.value))}
                      onClear={() => setBundleField('fixed_sale_price', 0)}
                      hasValue={bundleConfig.fixed_sale_price !== 0}
                    />
                  </Field>
                )}
                <Field label="Hoa hồng bộ" span={2}>
                  <div
                    className="pf-input"
                    style={{
                      background: 'var(--app-surface-subtle)',
                      color: 'var(--app-text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      minHeight: 34,
                    }}
                  >
                    Tự đi theo "Cách tính giá bộ"
                  </div>
                </Field>
                {showFixedBundleCommissionFields && (
                  <>
                    <Field label="HHCĐ bộ" span={1}>
                      <FormInputWithClear
                        type="number"
                        className="pf-input"
                        min={0}
                        value={bundleConfig.fixed_commission_per_unit ?? ''}
                        onChange={(e) => setBundleField('fixed_commission_per_unit', e.target.value === '' ? undefined : Number(e.target.value))}
                        onClear={() => setBundleField('fixed_commission_per_unit', undefined)}
                        hasValue={bundleConfig.fixed_commission_per_unit != null}
                      />
                    </Field>
                    <Field label="HH% bộ" span={1}>
                      <FormInputWithClear
                        type="number"
                        className="pf-input"
                        min={0}
                        value={bundleConfig.fixed_commission_percent ?? ''}
                        onChange={(e) => setBundleField('fixed_commission_percent', e.target.value === '' ? undefined : Number(e.target.value))}
                        onClear={() => setBundleField('fixed_commission_percent', undefined)}
                        hasValue={bundleConfig.fixed_commission_percent != null}
                      />
                    </Field>
                  </>
                )}
                <Field label="Giao hàng" span={2}>
                  <select
                    className="pf-select"
                    value={bundleConfig.delivery_rule}
                    onChange={(e) => setBundleField('delivery_rule', e.target.value as ProductBundleDeliveryRule)}
                  >
                    {BUNDLE_DELIVERY_RULE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="pf-row">
                <Field label="Ghi chú bán/giao bộ" span={5}>
                  <FormInputWithClear
                    type="text"
                    className="pf-input"
                    placeholder="Ví dụ: báo giá theo combo, giao đủ bộ hoặc cho phép giao rời theo thành phần"
                    value={bundleConfig.note}
                    onChange={(e) => setBundleField('note', e.target.value)}
                    onClear={() => setBundleField('note', '')}
                  />
                </Field>
              </div>
            </>
          )}
          <div className="pf-row">
            <Field label="Lý do thay đổi giá (Mẹ / mã chính)" span={4}>
              <FormInputWithClear
                type="text"
                list="price-change-reason-options"
                placeholder="Nhập tay hoặc chọn gợi ý"
                className="pf-input"
                value={priceChangeReason}
                onChange={(e) => setPriceChangeReason(e.target.value)}
                onClear={() => setPriceChangeReason('')}
              />
            </Field>
            <Field label="Thời điểm hiệu lực giá" span={2}>
              <input
                type="datetime-local"
                className="pf-input"
                value={priceEffectiveAt}
                onChange={(e) => setPriceEffectiveAt(e.target.value)}
              />
            </Field>
          </div>
          <div className="pf-row pf-row-size">
            <Field label="Dài PO" span={1}>
              <input type="text" placeholder="Khách" className="pf-input" value={(mother.size_order ?? '').split(/x/)[0]?.trim() ?? ''} onChange={(e) => { const p = (mother.size_order ?? '').split(/x/); p[0] = e.target.value; setMotherField('size_order', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
            </Field>
            <Field label="Rộng PO" span={1}>
              <input type="text" placeholder="Khách" className="pf-input" value={(mother.size_order ?? '').split(/x/)[1]?.trim() ?? ''} onChange={(e) => { const p = (mother.size_order ?? '').split(/x/); p[1] = e.target.value; setMotherField('size_order', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
            </Field>
            <Field label="Cao PO" span={1}>
              <input type="text" placeholder="Khách" className="pf-input" value={(mother.size_order ?? '').split(/x/)[2]?.trim() ?? ''} onChange={(e) => { const p = (mother.size_order ?? '').split(/x/); p[2] = e.target.value; setMotherField('size_order', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
            </Field>
            <Field label="Dài SX" span={1}>
              <input type="text" placeholder="Sản xuất" className="pf-input" value={(mother.size_production ?? '').split(/x/)[0]?.trim() ?? ''} onChange={(e) => { const p = (mother.size_production ?? '').split(/x/); p[0] = e.target.value; setMotherField('size_production', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
            </Field>
            <Field label="Rộng SX" span={1}>
              <input type="text" placeholder="Sản xuất" className="pf-input" value={(mother.size_production ?? '').split(/x/)[1]?.trim() ?? ''} onChange={(e) => { const p = (mother.size_production ?? '').split(/x/); p[1] = e.target.value; setMotherField('size_production', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
            </Field>
            <Field label="Cao SX" span={1}>
              <input type="text" placeholder="Sản xuất" className="pf-input" value={(mother.size_production ?? '').split(/x/)[2]?.trim() ?? ''} onChange={(e) => { const p = (mother.size_production ?? '').split(/x/); p[2] = e.target.value; setMotherField('size_production', (p[0] ?? '') + 'x' + (p[1] ?? '') + 'x' + (p[2] ?? '')); }} />
            </Field>
            <Field label="Sóng" required span={1}>
              <select className="pf-select" value={mother.wave ?? ''} onChange={(e) => setMotherField('wave', e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">Chọn</option>
                {waves.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
              </select>
            </Field>
            <Field label="Kiểu" required span={1}>
              <select className="pf-select" value={mother.box_type ?? ''} onChange={(e) => setMotherField('box_type', e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">Chọn</option>
                {boxTypes.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
              </select>
            </Field>
            <Field label="ĐVT" required span={1}>
              <select className="pf-select" value={mother.unit || ''} onChange={(e) => setMotherField('unit', e.target.value ? Number(e.target.value) : 0)}>
                <option value="">Chọn</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="+/-" span={1}>
              <FormInputWithClear type="text" className="pf-input" value={mother.delivery_tolerance ?? ''} onChange={(e) => setMotherField('delivery_tolerance', e.target.value)} onClear={() => setMotherField('delivery_tolerance', '')} />
            </Field>
          </div>
          <div className="pf-row">
            <Field label="Mã phim" span={2}>
              <FormInputWithClear type="text" placeholder="Tải file" className="pf-input" value={mother.film_code ?? ''} onChange={(e) => setMotherField('film_code', e.target.value)} onClear={() => setMotherField('film_code', '')} />
            </Field>
            <Field label="Số màu" span={1}>
              <FormInputWithClear type="number" className="pf-input" value={mother.color_count ?? ''} onChange={(e) => setMotherField('color_count', e.target.value ? Number(e.target.value) : undefined)} onClear={() => setMotherField('color_count', undefined)} hasValue={mother.color_count != null} />
            </Field>
            <Field label="C. thấm" span={1}>
              <select className="pf-select" value={mother.waterproof ?? ''} onChange={(e) => setMotherField('waterproof', e.target.value)}>
                {WATERPROOF_OPTIONS.map((o) => <option key={o.value || 'x'} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Mã khuôn" span={2}>
              <FormInputWithClear type="text" placeholder="Tải file" className="pf-input" value={mother.mold_code ?? ''} onChange={(e) => setMotherField('mold_code', e.target.value)} onClear={() => setMotherField('mold_code', '')} />
            </Field>
        <Field label="Ghi chú sản xuất" span={4}>
              <FormInputWithClear type="text" className="pf-input" value={mother.note_other ?? ''} onChange={(e) => setMotherField('note_other', e.target.value)} onClear={() => setMotherField('note_other', '')} />
            </Field>
          </div>
          <OperationRatesEditor
            value={mother}
            onRateChange={(operation, rawValue) => setMotherField(operation.processField, rawValue)}
            onNoteChange={(operationCode, note) => setMother((prev) => ({
              ...prev,
              operation_notes: {
                ...(prev.operation_notes ?? {}),
                [operationCode]: note,
              },
            }))}
          />
          <div className="pf-row pf-row-note">
        <Field label="Ghi chú mã hàng" span={9}>
              <FormInputWithClear type="text" className="pf-input" value={mother.note ?? ''} onChange={(e) => setMotherField('note', e.target.value)} onClear={() => setMotherField('note', '')} />
            </Field>
            <Field label="Trạng thái" span={1}>
              <select
                className="pf-select"
                value={mother.status ?? 'ACTIVE'}
                onChange={(e) => {
                  const v = e.target.value as 'DRAFT' | 'ACTIVE' | 'DISCONTINUED';
                  setMotherField('status', v);
                  setMotherField('is_active', v !== 'DISCONTINUED');
                }}
                style={{
                  backgroundColor:
                    mother.status === 'ACTIVE'
                      ? 'color-mix(in srgb, var(--app-success-bg) 72%, var(--app-surface))'
                      : mother.status === 'DISCONTINUED'
                        ? 'color-mix(in srgb, var(--app-danger-bg) 72%, var(--app-surface))'
                        : 'color-mix(in srgb, var(--app-warning-bg) 72%, var(--app-surface))',
                }}
              >
                <option value="ACTIVE">Đang bán</option>
                <option value="DISCONTINUED">Ngừng SX</option>
                <option value="DRAFT">Nháp</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="pf-section pf-section-children">
          <div className="pf-children-header">
            <div className="pf-children-header-inner">
              <Checkbox checked={hasChildren} onChange={(e) => setHasChildren(e.target.checked)}>
                Có thành phần con (Lót, Khay...)
              </Checkbox>
              <Button type="primary" ghost onClick={addChild}>Thêm con</Button>
            </div>
          </div>
          {hasChildren && children.map((child, i) => (
            <ChildBlock
              key={i}
              index={i}
              motherCode={(mother.code ?? '').trim()}
              child={child}
              canEditChildPrice={canEditChildPrice}
              canEditChildCommission={canEditChildCommission}
              onChange={(field, value) => setChild(i, field, value)}
              onRemove={() => removeChild(i)}
              canRemove={children.length >= 1}
              categories={categories}
              units={units}
              waves={waves}
              boxTypes={boxTypes}
            />
          ))}
        </section>
        </div>

        <div className="pf-footer">
          <div className="pf-footer-inner">
            <Button onClick={onClose}>{isViewMode ? 'Đóng' : 'Huỷ'}</Button>
            {!isViewMode && (
            <Button
              type="primary"
              htmlType="button"
              loading={submitting}
              disabled={!editingProduct && units.length === 0}
              onClick={() => void handleSubmit()}
            >
                {isEditingMode ? 'Cập nhật' : 'Thêm mới'}
            </Button>
            )}
          </div>
        </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ProductForm;
