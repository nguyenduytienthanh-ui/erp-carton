import { useEffect, useMemo } from 'react';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { salesApi } from '../../api/sales';
import type { Warehouse, WarehouseLocation } from '../../types/inventory';
import type { Product } from '../../types/product';
import type { ProductionOrder, ProductionOrderFormValues } from '../../types/production';
import type { SalesOrder } from '../../types/sales';

type Props = {
  open: boolean;
  editing: ProductionOrder | null;
  products: Product[];
  warehouses: Warehouse[];
  locations: WarehouseLocation[];
  salesOrders: SalesOrder[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: ProductionOrderFormValues) => Promise<void>;
};

type ProductionOrderFormState = {
  order_date: dayjs.Dayjs;
  planned_start_date?: dayjs.Dayjs | null;
  planned_end_date?: dayjs.Dayjs | null;
  reference?: string;
  sales_order?: number | null;
  sales_order_line?: number | null;
  product?: number;
  planned_qty: number;
  unit_cost_estimate?: number;
  target_warehouse?: number | null;
  target_location?: number | null;
  notes?: string;
  version?: number;
  material_requirements?: Array<{
    line_number?: number;
    material_product?: number;
    required_qty?: number;
    source_warehouse?: number | null;
    source_location?: number | null;
    note?: string;
  }>;
};

const { Title } = Typography;

export default function ProductionOrderForm({
  open,
  editing,
  products,
  warehouses,
  locations,
  salesOrders,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  const [form] = Form.useForm<ProductionOrderFormState>();
  const selectedSalesOrderId = Form.useWatch('sales_order', form);
  const selectedWarehouseId = Form.useWatch('target_warehouse', form);

  const salesOrderDetailQuery = useQuery({
    queryKey: ['production-form-sales-order', selectedSalesOrderId],
    queryFn: () => salesApi.getOrder(Number(selectedSalesOrderId)),
    enabled: Boolean(selectedSalesOrderId),
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        order_date: dayjs(editing.order_date),
        planned_start_date: editing.planned_start_date ? dayjs(editing.planned_start_date) : null,
        planned_end_date: editing.planned_end_date ? dayjs(editing.planned_end_date) : null,
        reference: editing.reference || '',
        sales_order: editing.sales_order ?? null,
        sales_order_line: editing.sales_order_line ?? null,
        product: editing.product,
        planned_qty: Number(editing.planned_qty || 0),
        unit_cost_estimate: Number(editing.unit_cost_estimate || 0),
        target_warehouse: editing.target_warehouse ?? null,
        target_location: editing.target_location ?? null,
        notes: editing.notes || '',
        version: editing.version ?? 0,
        material_requirements: (editing.material_requirements || []).map((item, index) => ({
          line_number: item.line_number ?? index + 1,
          material_product: item.material_product,
          required_qty: Number(item.required_qty || 0),
          source_warehouse: item.source_warehouse ?? null,
          source_location: item.source_location ?? null,
          note: item.note || '',
        })),
      });
      return;
    }
    form.setFieldsValue({
      order_date: dayjs(),
      planned_start_date: dayjs(),
      planned_end_date: dayjs().add(2, 'day'),
      reference: '',
      sales_order: null,
      sales_order_line: null,
      product: undefined,
      planned_qty: 1,
      unit_cost_estimate: 0,
      target_warehouse: null,
      target_location: null,
      notes: '',
      version: 0,
      material_requirements: [],
    });
  }, [editing, form, open]);

  const filteredLocations = useMemo(() => {
    if (!selectedWarehouseId) return locations;
    return locations.filter((location) => location.warehouse === selectedWarehouseId);
  }, [locations, selectedWarehouseId]);

  const salesOrderLineOptions = useMemo(() => salesOrderDetailQuery.data?.lines ?? [], [salesOrderDetailQuery.data?.lines]);

  const applyProductDefaults = (productId?: number | null, qty?: number) => {
    if (!productId) return;
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    const children = products.filter((item) => item.parent === productId);
    form.setFieldValue('unit_cost_estimate', Number(product.cost_price || 0));
    if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) {
      form.setFieldValue('planned_qty', qty);
    }
    if (!editing) {
      form.setFieldValue(
        'material_requirements',
        children.map((child, index) => ({
          line_number: index + 1,
          material_product: child.id,
          required_qty: (Number(child.component_quantity ?? 1) || 1) * Number(qty ?? form.getFieldValue('planned_qty') ?? 1),
          source_warehouse: null,
          source_location: null,
          note: `Tự động từ thành phần ${child.code}`,
        })),
      );
    }
  };

  const handleSalesOrderLineChange = (lineId: number) => {
    const line = salesOrderLineOptions.find((item) => item.id === lineId);
    if (!line) return;
    const snapshot = line.product_snapshot || {};
    const productId = line.product;
    form.setFieldValue('product', productId);
    form.setFieldValue('planned_qty', Number(line.qty || 0));
    form.setFieldValue('unit_cost_estimate', Number(snapshot.cost_price || 0));
    applyProductDefaults(productId, Number(line.qty || 0));
  };

  const handleProductChange = (productId: number) => {
    applyProductDefaults(productId);
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    const materialRequirements = (values.material_requirements || [])
      .filter((item) => Number(item.material_product ?? 0) > 0 && Number(item.required_qty ?? 0) > 0)
      .map((item, index) => ({
        line_number: item.line_number ?? index + 1,
        material_product: Number(item.material_product),
        required_qty: Number(item.required_qty ?? 0),
        source_warehouse: item.source_warehouse ?? null,
        source_location: item.source_location ?? null,
        note: item.note?.trim() || '',
      }));

    const payload: ProductionOrderFormValues = {
      order_date: values.order_date.format('YYYY-MM-DD'),
      planned_start_date: values.planned_start_date ? values.planned_start_date.format('YYYY-MM-DD') : null,
      planned_end_date: values.planned_end_date ? values.planned_end_date.format('YYYY-MM-DD') : null,
      reference: values.reference?.trim() || '',
      sales_order: values.sales_order ?? null,
      sales_order_line: values.sales_order_line ?? null,
      product: Number(values.product),
      planned_qty: Number(values.planned_qty ?? 0),
      unit_cost_estimate: Number(values.unit_cost_estimate ?? 0),
      target_warehouse: values.target_warehouse ?? null,
      target_location: values.target_location ?? null,
      notes: values.notes?.trim() || '',
      version: values.version ?? editing?.version ?? 0,
      ...(materialRequirements.length > 0 ? { material_requirements: materialRequirements } : {}),
    };
    await onSubmit(payload);
  };

  return (
    <Modal
      data-testid="production-order-form-modal"
      title={editing ? `Sửa lệnh sản xuất ${editing.code}` : 'Tạo lệnh sản xuất'}
      open={open}
      onCancel={onCancel}
      onOk={() => void handleOk()}
      okText={editing ? 'Lưu thay đổi' : 'Tạo lệnh'}
      cancelText="Đóng"
      confirmLoading={submitting}
      width={1120}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Alert
          showIcon
          type="info"
          style={{ marginBottom: 16 }}
          message="Có thể liên kết đơn bán, tự sinh nhu cầu vật tư từ cấu trúc thành phần và ghi trước kho nhập thành phẩm."
        />

        <Form.Item name="version" hidden>
          <InputNumber />
        </Form.Item>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <Form.Item name="order_date" label="Ngày lệnh" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="planned_start_date" label="Ngày bắt đầu">
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="planned_end_date" label="Ngày kết thúc">
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>

          <Form.Item name="sales_order" label="Đơn hàng bán liên kết">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn đơn bán"
              options={salesOrders.map((item) => ({ value: item.id, label: `${item.code} - ${item.customer_name || ''}` }))}
            />
          </Form.Item>
          <Form.Item name="sales_order_line" label="Dòng đơn bán">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn dòng đơn hàng"
              options={salesOrderLineOptions.map((item) => ({
                value: item.id,
                label: `Dòng ${item.line_number} - ${item.product_code || ''} ${item.product_name || ''}`,
              }))}
              onChange={handleSalesOrderLineChange}
            />
          </Form.Item>
          <Form.Item name="product" label="Thành phẩm" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn thành phẩm"
              options={products.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
              onChange={handleProductChange}
            />
          </Form.Item>

          <Form.Item name="planned_qty" label="Số lượng kế hoạch" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <InputNumber min={0.0001} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unit_cost_estimate" label="Giá vốn dự kiến">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reference" label="Tham chiếu">
            <Input data-testid="production-order-form-reference" placeholder="Ví dụ: theo forecast tuần hoặc đơn bán gấp" />
          </Form.Item>

          <Form.Item name="target_warehouse" label="Kho nhập thành phẩm">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn kho"
              options={warehouses.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
            />
          </Form.Item>
          <Form.Item name="target_location" label="Vị trí thành phẩm">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn vị trí"
              options={filteredLocations.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
            />
          </Form.Item>
        </div>

        <Form.Item name="notes" label="Ghi chú">
          <Input.TextArea data-testid="production-order-form-notes" rows={2} />
        </Form.Item>

        <Form.List name="material_requirements">
          {(fields, { add, remove }) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Title level={5} style={{ margin: 0 }}>
                  Nhu cầu vật tư
                </Title>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => add({ line_number: fields.length + 1, material_product: undefined, required_qty: 0 })}
                >
                  Thêm vật tư
                </Button>
              </div>

              {fields.map((field, index) => (
                <div
                  key={field.key}
                  style={{
                    border: '1px solid #f0f0f0',
                    borderRadius: 12,
                    padding: 12,
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1.2fr 1.2fr auto',
                    gap: 12,
                    alignItems: 'end',
                  }}
                >
                  <Form.Item
                    {...field}
                    label={`Vật tư #${index + 1}`}
                    name={[field.name, 'material_product']}
                    rules={[{ required: true, message: 'Bắt buộc' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="Chọn vật tư"
                      options={products.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
                    />
                  </Form.Item>
                  <Form.Item
                    {...field}
                    label="SL yêu cầu"
                    name={[field.name, 'required_qty']}
                    rules={[{ required: true, message: 'Bắt buộc' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber min={0.0001} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item {...field} label="Kho nguồn" name={[field.name, 'source_warehouse']} style={{ marginBottom: 0 }}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="Chọn kho nguồn"
                      options={warehouses.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
                    />
                  </Form.Item>
                  <Form.Item {...field} label="Vị trí nguồn" name={[field.name, 'source_location']} style={{ marginBottom: 0 }}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="Chọn vị trí"
                      options={locations.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
                    />
                  </Form.Item>
                  <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />

                  <Form.Item
                    {...field}
                    label="Ghi chú"
                    name={[field.name, 'note']}
                    style={{ marginBottom: 0, gridColumn: '1 / span 4' }}
                  >
                    <Input placeholder="Ghi rõ nguồn cấp hoặc lưu ý tách lô nếu cần" />
                  </Form.Item>
                </div>
              ))}
            </div>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
