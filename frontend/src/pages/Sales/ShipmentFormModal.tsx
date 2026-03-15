import React, { useState, useEffect } from 'react';
import {
  Modal, Form, Input, InputNumber, Select, DatePicker, Table, Button, Space, Popconfirm, message,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { shipmentsApi } from '../../api/shipments';
import { customersApi } from '../../api/customers';
import { productsApi } from '../../api/products';
import { OutboundShipment, ShipmentLine } from '../../types/shipments';
import { getToastMessage } from '../../utils/authz';

interface ShipmentFormModalProps {
  open: boolean;
  onClose: () => void;
  shipment?: OutboundShipment | null;
  onSuccess?: () => void;
}

const ShipmentFormModal: React.FC<ShipmentFormModalProps> = ({
  open, onClose, shipment, onSuccess,
}) => {
  const [form] = Form.useForm();
  const [lines, setLines] = useState<ShipmentLine[]>([]);

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.getCustomers({ page_size: 1000 }),
    enabled: open,
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.getProducts({ page_size: 1000 }),
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => shipmentsApi.createShipment(data),
    onSuccess: () => {
      message.success('Tạo phiếu giao hàng thành công');
      form.resetFields();
      setLines([]);
      onSuccess?.();
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Tạo phiếu giao hàng thất bại'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => shipmentsApi.updateShipment(shipment!.id!, data),
    onSuccess: () => {
      message.success('Cập nhật phiếu giao hàng thành công');
      form.resetFields();
      setLines([]);
      onSuccess?.();
    },
    onError: (error) => {
      message.error(getToastMessage(error, 'Cập nhật phiếu giao hàng thất bại'));
    },
  });

  useEffect(() => {
    if (open) {
      if (shipment) {
        form.setFieldsValue({
          customer: shipment.customer,
          shipment_date: shipment.shipment_date ? dayjs(shipment.shipment_date) : null,
          reference: shipment.reference || '',
          carrier: shipment.carrier || '',
          tracking_number: shipment.tracking_number || '',
          shipping_address: shipment.shipping_address || '',
          expected_delivery_date: shipment.expected_delivery_date ? dayjs(shipment.expected_delivery_date) : null,
          notes: shipment.notes || '',
        });
        setLines(shipment.lines || []);
      } else {
        form.resetFields();
        setLines([]);
      }
    }
  }, [open, shipment, form]);

  const handleAddLine = () => {
    setLines([
      ...lines,
      {
        line_number: (lines.length || 0) + 1,
        product: 0,
        qty_ordered: 1,
        qty_shipped: 1,
        qty_received: 0,
        unit_price: 0,
        discount_pct: 0,
        tax_pct: 0,
      },
    ]);
  };

  const handleDeleteLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleLineChange = (index: number, key: keyof ShipmentLine, value: any) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [key]: value };
    setLines(newLines);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const data = {
        ...values,
        shipment_date: values.shipment_date ? values.shipment_date.format('YYYY-MM-DD') : null,
        expected_delivery_date: values.expected_delivery_date ? values.expected_delivery_date.format('YYYY-MM-DD') : null,
        lines: lines.map((l, i) => ({
          ...l,
          line_number: i + 1,
        })),
      };

      if (shipment) {
        updateMutation.mutate(data);
      } else {
        createMutation.mutate(data);
      }
    } catch (error) {
      message.error('Vui lòng kiểm tra lại form');
    }
  };

  const columns = [
    {
      title: 'Sản phẩm',
      width: 200,
      render: (_, __, index: number) => (
        <Select
          placeholder="Chọn sản phẩm"
          value={lines[index]?.product || undefined}
          onChange={(val) => handleLineChange(index, 'product', val)}
          options={products?.results?.map((p: any) => ({
            value: p.id,
            label: `${p.code} - ${p.name}`,
          })) || []}
        />
      ),
    },
    {
      title: 'SL gửi',
      width: 100,
      render: (_, __, index: number) => (
        <InputNumber
          value={lines[index]?.qty_shipped}
          onChange={(val) => handleLineChange(index, 'qty_shipped', val)}
          min={0}
        />
      ),
    },
    {
      title: 'Giá',
      width: 100,
      render: (_, __, index: number) => (
        <InputNumber
          value={lines[index]?.unit_price}
          onChange={(val) => handleLineChange(index, 'unit_price', val)}
          min={0}
        />
      ),
    },
    {
      title: 'Ghi chú',
      width: 150,
      render: (_, __, index: number) => (
        <Input.TextArea
          value={lines[index]?.notes || ''}
          onChange={(e) => handleLineChange(index, 'notes', e.target.value)}
          rows={1}
        />
      ),
    },
    {
      title: '',
      width: 50,
      render: (_, __, index: number) => (
        <Popconfirm
          title="Xóa dòng"
          description="Xóa dòng này?"
          onConfirm={() => handleDeleteLine(index)}
        >
          <Button danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <Modal
      title={shipment ? 'Sửa phiếu giao hàng' : 'Thêm phiếu giao hàng'}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      width={1000}
      loading={createMutation.isPending || updateMutation.isPending}
    >
      <Form form={form} layout="vertical">
        <Form.Item label="Khách hàng" name="customer" rules={[{ required: true, message: 'Vui lòng chọn khách hàng' }]}>
          <Select
            placeholder="Chọn khách hàng"
            options={customers?.results?.map((c: any) => ({
              value: c.id,
              label: c.name,
            })) || []}
          />
        </Form.Item>
        <Form.Item label="Ngày giao" name="shipment_date" rules={[{ required: true, message: 'Vui lòng chọn ngày giao' }]}>
          <DatePicker format="DD/MM/YYYY" />
        </Form.Item>
        <Form.Item label="Địa chỉ giao" name="shipping_address">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item label="Mã vận chuyển" name="tracking_number">
          <Input />
        </Form.Item>
        <Form.Item label="Nhà vận chuyển" name="carrier">
          <Input />
        </Form.Item>
        <Form.Item label="Ngày dự kiến giao" name="expected_delivery_date">
          <DatePicker format="DD/MM/YYYY" />
        </Form.Item>
        <Form.Item label="Ghi chú" name="notes">
          <Input.TextArea rows={2} />
        </Form.Item>

        <h4 style={{ marginTop: '20px' }}>Hàng hoá</h4>
        <Table
          columns={columns}
          dataSource={lines}
          pagination={false}
          rowKey={(_, index) => index}
        />
        <Button icon={<PlusOutlined />} onClick={handleAddLine} style={{ marginTop: '10px' }}>
          Thêm dòng
        </Button>
      </Form>
    </Modal>
  );
};

export default ShipmentFormModal;
