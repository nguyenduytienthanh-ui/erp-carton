import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Form, Grid, Input, InputNumber, Modal, Select, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Product } from '../../types/product';
import type { Warehouse, WarehouseLocation } from '../../types/inventory';
import type { MaterialPurchasePrice, PurchaseOrder, PurchaseOrderFormValues, Supplier } from '../../types/purchasing';


type Props = {
  open: boolean;
  editing: PurchaseOrder | null;
  suppliers: Supplier[];
  products: Product[];
  warehouses: Warehouse[];
  locations: WarehouseLocation[];
  submitting: boolean;
  loadMaterialPrice?: (params: { product: number; supplier?: number | null; qty?: number }) => Promise<MaterialPurchasePrice | null>;
  onCancel: () => void;
  onSubmit: (payload: PurchaseOrderFormValues) => Promise<void>;
};


type PurchaseOrderFormState = {
  order_date: dayjs.Dayjs;
  expected_receipt_date?: dayjs.Dayjs | null;
  supplier: number | null;
  warehouse?: number | null;
  location?: number | null;
  reference?: string;
  currency?: string;
  exchange_rate?: number;
  payment_terms_days?: number;
  notes?: string;
  version?: number;
  lines: Array<{
    line_number?: number;
    product?: number;
    qty: number;
    unit_price: number;
    discount_pct?: number;
    tax_pct?: number;
    note?: string;
  }>;
};


const defaultLine = {
  product: undefined,
  qty: 1,
  unit_price: 0,
  discount_pct: 0,
  tax_pct: 8,
  note: '',
};


export default function PurchaseOrderForm({
  open,
  editing,
  suppliers,
  products,
  warehouses,
  locations,
  submitting,
  loadMaterialPrice,
  onCancel,
  onSubmit,
}: Props) {
  const [form] = Form.useForm<PurchaseOrderFormState>();
  const [priceHints, setPriceHints] = useState<Record<number, string>>({});
  const [loadingPriceLine, setLoadingPriceLine] = useState<number | null>(null);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const selectedWarehouse = Form.useWatch('warehouse', form);
  const selectedSupplier = Form.useWatch('supplier', form);
  const watchedLines = Form.useWatch('lines', form);

  useEffect(() => {
    if (!open) return;
    setPriceHints({});
    if (editing) {
      form.setFieldsValue({
        order_date: dayjs(editing.order_date),
        expected_receipt_date: editing.expected_receipt_date ? dayjs(editing.expected_receipt_date) : null,
        supplier: editing.supplier,
        warehouse: editing.warehouse ?? null,
        location: editing.location ?? null,
        reference: editing.reference || '',
        currency: editing.currency || 'VND',
        exchange_rate: Number(editing.exchange_rate || 1),
        payment_terms_days: editing.payment_terms_days ?? 30,
        notes: editing.notes || '',
        version: editing.version ?? 0,
        lines: (editing.lines || []).map((line, index) => ({
          line_number: line.line_number ?? index + 1,
          product: line.product,
          qty: Number(line.qty || 0),
          unit_price: Number(line.unit_price || 0),
          discount_pct: Number(line.discount_pct || 0),
          tax_pct: Number(line.tax_pct || 0),
          note: line.note || '',
        })),
      });
      return;
    }
    form.setFieldsValue({
      order_date: dayjs(),
      expected_receipt_date: dayjs().add(3, 'day'),
      supplier: null,
      warehouse: null,
      location: null,
      reference: '',
      currency: 'VND',
      exchange_rate: 1,
      payment_terms_days: 30,
      notes: '',
      version: 0,
      lines: [{ ...defaultLine, line_number: 1 }],
    });
  }, [editing, form, open]);

  const filteredLocations = useMemo(() => {
    if (!selectedWarehouse) return locations;
    return locations.filter((location) => location.warehouse === selectedWarehouse);
  }, [locations, selectedWarehouse]);
  const totals = useMemo(() => {
    return (watchedLines || []).reduce(
      (acc, line) => {
        const qty = Number(line?.qty ?? 0);
        const unitPrice = Number(line?.unit_price ?? 0);
        const discountPct = Number(line?.discount_pct ?? 0);
        const taxPct = Number(line?.tax_pct ?? 0);
        const subtotal = qty * unitPrice;
        const discount = subtotal * (discountPct / 100);
        const taxable = Math.max(0, subtotal - discount);
        const tax = taxable * (taxPct / 100);
        acc.subtotal += subtotal;
        acc.discount += discount;
        acc.tax += tax;
        acc.total += taxable + tax;
        return acc;
      },
      { subtotal: 0, discount: 0, tax: 0, total: 0 },
    );
  }, [watchedLines]);

  const handleSupplierChange = (supplierId: number) => {
    const supplier = suppliers.find((item) => item.id === supplierId);
    if (!supplier) return;
    form.setFieldValue('payment_terms_days', supplier.payment_terms_days);
    setPriceHints({});
  };

  const handleProductChange = async (lineIndex: number, productId: number) => {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    const currentLines = form.getFieldValue('lines') || [];
    const nextLines = [...currentLines];
    const fallbackPrice = Number(product.cost_price || 0);
    nextLines[lineIndex] = {
      ...nextLines[lineIndex],
      unit_price: fallbackPrice,
    };
    form.setFieldValue('lines', nextLines);
    setPriceHints((prev) => ({ ...prev, [lineIndex]: fallbackPrice > 0 ? 'Theo giá vốn sản phẩm' : '' }));
    if (!loadMaterialPrice) return;
    setLoadingPriceLine(lineIndex);
    try {
      const materialPrice = await loadMaterialPrice({
        product: productId,
        supplier: selectedSupplier,
        qty: Number(nextLines[lineIndex]?.qty ?? 1),
      });
      if (!materialPrice) return;
      const latestLines = form.getFieldValue('lines') || [];
      const latestNextLines = [...latestLines];
      latestNextLines[lineIndex] = {
        ...latestNextLines[lineIndex],
        unit_price: Number(materialPrice.unit_price || fallbackPrice),
      };
      form.setFieldValue('lines', latestNextLines);
      if (materialPrice.currency) form.setFieldValue('currency', materialPrice.currency);
      setPriceHints((prev) => ({ ...prev, [lineIndex]: materialPrice.supplier ? 'Theo bảng giá NCC' : 'Theo bảng giá vật tư' }));
    } finally {
      setLoadingPriceLine((current) => (current === lineIndex ? null : current));
    }
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    const payload: PurchaseOrderFormValues = {
      order_date: values.order_date.format('YYYY-MM-DD'),
      expected_receipt_date: values.expected_receipt_date ? values.expected_receipt_date.format('YYYY-MM-DD') : null,
      supplier: values.supplier,
      warehouse: values.warehouse ?? null,
      location: values.location ?? null,
      reference: values.reference?.trim() || '',
      currency: values.currency?.trim() || 'VND',
      exchange_rate: Number(values.exchange_rate ?? 1),
      payment_terms_days: Number(values.payment_terms_days ?? 30),
      notes: values.notes?.trim() || '',
      version: values.version ?? editing?.version ?? 0,
      lines: (values.lines || [])
        .filter((line) => Number(line.product ?? 0) > 0)
        .map((line, index) => ({
          line_number: line.line_number ?? index + 1,
          product: Number(line.product),
          qty: Number(line.qty ?? 0),
          unit_price: Number(line.unit_price ?? 0),
          discount_pct: Number(line.discount_pct ?? 0),
          tax_pct: Number(line.tax_pct ?? 0),
          note: line.note?.trim() || '',
        })),
    };
    if (payload.lines.length === 0) {
      form.setFields([{ name: ['lines', 0, 'product'], errors: ['Chọn ít nhất một sản phẩm'] }]);
      return;
    }
    await onSubmit(payload);
  };

  return (
    <Modal
      title={editing ? `Sửa đơn mua ${editing.code}` : 'Tạo đơn mua'}
      open={open}
      onCancel={onCancel}
      onOk={() => void handleOk()}
      confirmLoading={submitting}
      width={isMobile ? 'calc(100vw - 24px)' : 1120}
      destroyOnHidden
      styles={{ body: { maxHeight: isMobile ? 'calc(100vh - 180px)' : 'calc(100vh - 220px)', overflowY: 'auto' } }}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="version" hidden>
          <InputNumber />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <Form.Item name="order_date" label="Ngày đơn" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="expected_receipt_date" label="Ngày dự kiến nhận">
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="supplier" label="Nhà cung cấp" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn nhà cung cấp"
              options={suppliers.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
              onChange={handleSupplierChange}
            />
          </Form.Item>
          <Form.Item name="warehouse" label="Kho nhập mặc định">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn kho"
              options={warehouses.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
            />
          </Form.Item>
          <Form.Item name="location" label="Vị trí nhập mặc định">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn vị trí"
              options={filteredLocations.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
            />
          </Form.Item>
          <Form.Item name="payment_terms_days" label="Hạn thanh toán (ngày)">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reference" label="Tham chiếu">
            <Input />
          </Form.Item>
          <Form.Item name="currency" label="Tiền tệ">
            <Input />
          </Form.Item>
          <Form.Item name="exchange_rate" label="Tỷ giá">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <Form.Item name="notes" label="Ghi chú">
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  Dòng hàng mua
                </Typography.Title>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => add({ ...defaultLine, line_number: fields.length + 1 })}
                >
                  Thêm dòng
                </Button>
              </div>
              {fields.map(({ key, ...field }, index) => (
                <div
                  key={key}
                  data-testid="purchase-order-line-card"
                  style={{
                    border: '1px solid #f0f0f0',
                    borderRadius: 10,
                    padding: 12,
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : '2.2fr repeat(4, 1fr) auto',
                    gap: 12,
                    alignItems: 'end',
                  }}
                >
                  <Form.Item
                    {...field}
                    label={`Sản phẩm #${index + 1}`}
                    name={[field.name, 'product']}
                    rules={[{ required: true, message: 'Bắt buộc' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="Chọn sản phẩm"
                      options={products.map((item) => ({
                        value: item.id,
                        label: `${item.code} - ${item.name}`,
                      }))}
                      onChange={(value) => void handleProductChange(index, Number(value))}
                    />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    label="Số lượng"
                    name={[field.name, 'qty']}
                    rules={[{ required: true, message: 'Bắt buộc' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={0.0001} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    label="Đơn giá"
                    name={[field.name, 'unit_price']}
                    rules={[{ required: true, message: 'Bắt buộc' }]}
                    extra={loadingPriceLine === index ? 'Đang dò bảng giá...' : (priceHints[index] ? <Tag color="blue">{priceHints[index]}</Tag> : undefined)}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={0} style={{ width: '100%' }} data-testid={`purchase-order-line-unit-price-${index}`} />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    label="CK %"
                    name={[field.name, 'discount_pct']}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={0} max={100} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    label="VAT %"
                    name={[field.name, 'tax_pct']}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={0} max={100} style={{ width: '100%' }} />
                  </Form.Item>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => remove(field.name)}
                    disabled={fields.length <= 1}
                    aria-label={`Xóa dòng ${index + 1}`}
                  />
                  <Form.Item
                    {...field}
                    label="Ghi chú dòng"
                    name={[field.name, 'note']}
                    style={{ marginBottom: 0, gridColumn: isMobile ? '1' : '1 / span 5' }}
                  >
                    <Input />
                  </Form.Item>
                </div>
              ))}
            </div>
          )}
        </Form.List>
        <div
          style={{
            marginTop: 16,
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 12,
            background: '#f8fafc',
          }}
        >
          <Space wrap size={12}>
            <Tag>{`Tạm tính: ${totals.subtotal.toLocaleString('vi-VN')}`}</Tag>
            <Tag>{`Chiết khấu: ${totals.discount.toLocaleString('vi-VN')}`}</Tag>
            <Tag>{`VAT: ${totals.tax.toLocaleString('vi-VN')}`}</Tag>
            <Tag color="green">{`Tổng: ${totals.total.toLocaleString('vi-VN')}`}</Tag>
          </Space>
        </div>
      </Form>
    </Modal>
  );
}
