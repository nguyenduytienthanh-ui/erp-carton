import { useMemo, useState } from 'react';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Table,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';

import { customersApi } from '../../api/customers';
import { productsApi } from '../../api/products';
import { shipmentsApi } from '../../api/shipments';
import DeliveryCarrierField from '../../components/DeliveryCarrier/DeliveryCarrierField';
import type { Customer } from '../../types/customer';
import type { Product } from '../../types/product';
import type { OutboundShipment, ShipmentLine } from '../../types/shipments';
import { getToastMessage } from '../../shared/apiError';

interface ShipmentFormModalProps {
  open: boolean;
  onClose: () => void;
  shipment?: OutboundShipment | null;
  onSuccess?: () => void;
}

type ShipmentFormValues = {
  customer?: number;
  shipment_date: Dayjs;
  reference?: string;
  shipping_address?: string;
  tracking_number?: string;
  carrier_master?: number | null;
  carrier?: string;
  expected_delivery_date?: Dayjs | null;
  notes?: string;
};

type EditableShipmentLine = {
  id?: number;
  line_number: number;
  product?: number;
  qty_ordered: number;
  qty_shipped: number;
  qty_received: number;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
  notes?: string;
};

type ShipmentSubmitPayload = {
  customer: number;
  shipment_date: string;
  reference?: string;
  shipping_address?: string;
  tracking_number?: string;
  carrier_master?: number | null;
  carrier?: string;
  expected_delivery_date?: string | null;
  notes?: string;
  lines: EditableShipmentLine[];
};

function createEmptyLine(index: number): EditableShipmentLine {
  return {
    line_number: index + 1,
    product: undefined,
    qty_ordered: 1,
    qty_shipped: 1,
    qty_received: 0,
    unit_price: 0,
    discount_pct: 0,
    tax_pct: 0,
    notes: '',
  };
}

function normalizeLine(line: ShipmentLine, index: number): EditableShipmentLine {
  return {
    id: line.id,
    line_number: line.line_number ?? index + 1,
    product: line.product || undefined,
    qty_ordered: Number(line.qty_ordered ?? line.qty_shipped ?? 1),
    qty_shipped: Number(line.qty_shipped ?? 1),
    qty_received: Number(line.qty_received ?? 0),
    unit_price: Number(line.unit_price ?? 0),
    discount_pct: Number(line.discount_pct ?? 0),
    tax_pct: Number(line.tax_pct ?? 0),
    notes: line.notes || '',
  };
}

function buildInitialValues(shipment?: OutboundShipment | null): ShipmentFormValues {
  return {
    customer: shipment?.customer,
    shipment_date: shipment?.shipment_date ? dayjs(shipment.shipment_date) : dayjs(),
    reference: shipment?.reference || '',
    shipping_address: shipment?.shipping_address || '',
    tracking_number: shipment?.tracking_number || '',
    carrier_master: shipment?.carrier_master ?? null,
    carrier: shipment?.carrier || '',
    expected_delivery_date: shipment?.expected_delivery_date ? dayjs(shipment.expected_delivery_date) : null,
    notes: shipment?.notes || '',
  };
}

function buildInitialLines(shipment?: OutboundShipment | null): EditableShipmentLine[] {
  return (shipment?.lines ?? []).map(normalizeLine);
}

export default function ShipmentFormModal({
  open,
  onClose,
  shipment,
  onSuccess,
}: ShipmentFormModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<ShipmentFormValues>();
  const initialValues = useMemo(() => buildInitialValues(shipment), [shipment]);
  const [lines, setLines] = useState<EditableShipmentLine[]>(() => buildInitialLines(shipment));

  const customersQuery = useQuery({
    queryKey: ['customers', 'shipment-form'],
    queryFn: () => customersApi.getCustomers({ page_size: 10000, ordering: '-id' }),
    enabled: open,
  });

  const productsQuery = useQuery({
    queryKey: ['products', 'shipment-form'],
    queryFn: () => productsApi.getProducts({ page_size: 10000, ordering: '-id' }),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (data: ShipmentSubmitPayload) => shipmentsApi.createShipment(data),
    onSuccess: () => {
      messageApi.success('Tạo phiếu giao hàng thành công');
      onSuccess?.();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Tạo phiếu giao hàng thất bại'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: ShipmentSubmitPayload) => shipmentsApi.updateShipment(shipment!.id!, data),
    onSuccess: () => {
      messageApi.success('Cập nhật phiếu giao hàng thành công');
      onSuccess?.();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Cập nhật phiếu giao hàng thất bại'));
    },
  });

  const customerOptions = useMemo(
    () =>
      (customersQuery.data?.results ?? []).map((customer: Customer) => ({
        value: customer.id,
        label: `${customer.code} - ${customer.name}`,
      })),
    [customersQuery.data?.results],
  );

  const productOptions = useMemo(
    () =>
      (productsQuery.data?.results ?? []).map((product: Product) => ({
        value: product.id,
        label: `${product.code} - ${product.name}`,
      })),
    [productsQuery.data?.results],
  );

  const addLine = () => {
    setLines((current) => [...current, createEmptyLine(current.length)]);
  };

  const removeLine = (index: number) => {
    setLines((current) =>
      current
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({ ...item, line_number: itemIndex + 1 })),
    );
  };

  const updateLine = <K extends keyof EditableShipmentLine>(
    index: number,
    field: K,
    value: EditableShipmentLine[K],
  ) => {
    setLines((current) =>
      current.map((line, itemIndex) =>
        itemIndex === index
          ? {
              ...line,
              [field]: value,
            }
          : line,
      ),
    );
  };

  const lineColumns: ColumnsType<EditableShipmentLine> = [
    {
      title: 'Sản phẩm',
      width: 260,
      render: (_, __, index) => (
        <Select
          data-testid={`shipment-line-product-${index}`}
          showSearch
          optionFilterProp="label"
          placeholder="Chọn sản phẩm"
          value={lines[index]?.product}
          onChange={(value) => updateLine(index, 'product', value)}
          options={productOptions}
        />
      ),
    },
    {
      title: 'SL gửi',
      width: 120,
      render: (_, __, index) => (
        <InputNumber
          data-testid={`shipment-line-qty-${index}`}
          min={0}
          value={lines[index]?.qty_shipped}
          onChange={(value) => updateLine(index, 'qty_shipped', Number(value ?? 0))}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Đơn giá',
      width: 140,
      render: (_, __, index) => (
        <InputNumber
          data-testid={`shipment-line-price-${index}`}
          min={0}
          value={lines[index]?.unit_price}
          onChange={(value) => updateLine(index, 'unit_price', Number(value ?? 0))}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Ghi chú',
      width: 220,
      render: (_, __, index) => (
        <Input.TextArea
          data-testid={`shipment-line-note-${index}`}
          rows={1}
          value={lines[index]?.notes || ''}
          onChange={(event) => updateLine(index, 'notes', event.target.value)}
        />
      ),
    },
    {
      title: '',
      width: 70,
      render: (_, __, index) => (
        <Popconfirm
          title="Xóa dòng"
          description="Xóa dòng hàng này?"
          onConfirm={() => removeLine(index)}
        >
          <Button danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const normalizedLines = lines
        .map((line, index) => ({
          ...line,
          line_number: index + 1,
          product: line.product,
          qty_shipped: Number(line.qty_shipped ?? 0),
          unit_price: Number(line.unit_price ?? 0),
        }))
        .filter((line) => line.product && line.qty_shipped > 0);

      if (!values.customer) {
        messageApi.error('Vui lòng chọn khách hàng');
        return;
      }

      if (normalizedLines.length === 0) {
        messageApi.error('Vui lòng thêm ít nhất một dòng hàng hợp lệ');
        return;
      }

      const payload: ShipmentSubmitPayload = {
        customer: values.customer,
        shipment_date: values.shipment_date.format('YYYY-MM-DD'),
        reference: values.reference?.trim() || undefined,
        shipping_address: values.shipping_address?.trim() || undefined,
        tracking_number: values.tracking_number?.trim() || undefined,
        carrier_master: values.carrier_master ?? null,
        carrier: values.carrier?.trim() || undefined,
        expected_delivery_date: values.expected_delivery_date
          ? values.expected_delivery_date.format('YYYY-MM-DD')
          : null,
        notes: values.notes?.trim() || undefined,
        lines: normalizedLines,
      };

      if (shipment) {
        await updateMutation.mutateAsync(payload);
        return;
      }
      await createMutation.mutateAsync(payload);
    } catch {
      messageApi.error('Vui lòng kiểm tra lại thông tin phiếu giao');
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title={shipment ? 'Sửa phiếu giao hàng' : 'Tạo phiếu giao hàng'}
        open={open}
        onCancel={onClose}
        onOk={() => void handleSubmit()}
        width={1040}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        okText={shipment ? 'Lưu thay đổi' : 'Tạo phiếu'}
        cancelText="Đóng"
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={initialValues}
        >
          <Form.Item
            label="Khách hàng"
            name="customer"
            rules={[{ required: true, message: 'Vui lòng chọn khách hàng' }]}
          >
            <Select
              data-testid="shipment-customer-select"
              showSearch
              optionFilterProp="label"
              placeholder="Chọn khách hàng"
              options={customerOptions}
              loading={customersQuery.isLoading}
            />
          </Form.Item>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            <Form.Item
              label="Ngày giao"
              name="shipment_date"
              rules={[{ required: true, message: 'Vui lòng chọn ngày giao' }]}
            >
              <DatePicker data-testid="shipment-date" format="DD/MM/YYYY" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Tham chiếu" name="reference">
              <Input data-testid="shipment-reference" placeholder="Ví dụ: kế hoạch giao cuối ca chiều" />
            </Form.Item>
            <Form.Item label="Mã vận chuyển" name="tracking_number">
              <Input data-testid="shipment-tracking-number" placeholder="Tracking number" />
            </Form.Item>
            <div>
              <DeliveryCarrierField
                label="Nhà vận chuyển"
                carrierIdName="carrier_master"
                carrierNameName="carrier"
                selectTestId="shipment-carrier-select"
                freeTextTestId="shipment-carrier-free-text"
                warningTestId="shipment-carrier-warning"
              />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(280px, 2fr) minmax(220px, 1fr)',
              gap: 12,
            }}
          >
            <Form.Item label="Địa chỉ giao" name="shipping_address">
              <Input.TextArea
                data-testid="shipment-shipping-address"
                rows={3}
                placeholder="Địa chỉ giao hàng hoặc ghi chú bàn giao"
              />
            </Form.Item>
            <Form.Item label="Ngày dự kiến giao" name="expected_delivery_date">
              <DatePicker data-testid="shipment-expected-delivery-date" format="DD/MM/YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <Form.Item label="Ghi chú" name="notes">
            <Input.TextArea
              data-testid="shipment-notes"
              rows={2}
              placeholder="Thông tin thêm cho điều phối giao hàng"
            />
          </Form.Item>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Hàng hóa giao</strong>
              <Button data-testid="shipment-add-line" icon={<PlusOutlined />} onClick={addLine}>
                Thêm dòng
              </Button>
            </div>
            <Table
              columns={lineColumns}
              dataSource={lines}
              pagination={false}
              rowKey={(record, index) => record.id ?? `${record.line_number}-${index ?? 0}`}
              locale={{
                emptyText: 'Chưa có dòng hàng nào. Hãy thêm ít nhất một sản phẩm để tạo phiếu giao.',
              }}
              scroll={{ x: 820 }}
            />
          </div>
        </Form>
      </Modal>
    </>
  );
}
