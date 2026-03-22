import { useEffect } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Product } from '../../types/product';
import type { WarehouseTransfer } from '../../types/inventory';
import { inventoryApi, warehouseApi } from '../../api/inventory';
import { productsApi } from '../../api/products';
import { getToastMessage } from '../../shared/apiError';

interface WarehouseTransferFormModalProps {
  open: boolean;
  data?: WarehouseTransfer | null;
  onClose: () => void;
  onSuccess: () => void;
}

type TransferLineFormValue = {
  line_number: number;
  product?: number;
  qty: number;
  received_qty?: number;
  note?: string;
};

type WarehouseTransferFormValues = {
  transfer_date: string;
  from_warehouse: number;
  to_warehouse: number;
  reference: string;
  note: string;
  lines: TransferLineFormValue[];
};

type WarehouseTransferPayload = {
  transfer_date: string;
  from_warehouse: number;
  to_warehouse: number;
  reference: string;
  note: string;
  lines: Array<{
    line_number: number;
    product?: number;
    qty: string;
    received_qty?: string;
    note?: string;
  }>;
};

function createEmptyLine(index: number): TransferLineFormValue {
  return {
    line_number: index + 1,
    product: undefined,
    qty: 1,
    received_qty: 0,
    note: '',
  };
}

function buildInitialValues(data?: WarehouseTransfer | null): WarehouseTransferFormValues {
  return data
    ? {
        transfer_date: data.transfer_date,
        from_warehouse: data.from_warehouse,
        to_warehouse: data.to_warehouse,
        reference: data.reference,
        note: data.note,
        lines: (data.lines ?? []).map((line, index) => ({
          line_number: line.line_number ?? index + 1,
          product: line.product,
          qty: Number(line.qty ?? 0),
          received_qty: Number(line.received_qty ?? 0),
          note: line.note || '',
        })),
      }
    : {
        transfer_date: '',
        from_warehouse: 0,
        to_warehouse: 0,
        reference: '',
        note: '',
        lines: [],
      };
}

export default function WarehouseTransferFormModal({
  open,
  data,
  onClose,
  onSuccess,
}: WarehouseTransferFormModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<WarehouseTransferFormValues>();
  const lines = Form.useWatch('lines', form) ?? [];

  const warehousesQuery = useQuery({
    queryKey: ['warehouses-active'],
    queryFn: () => warehouseApi.getWarehouses({ is_active: 'true', page_size: 10000, ordering: '-created_at' }),
  });

  const productsQuery = useQuery({
    queryKey: ['products-active'],
    queryFn: () => productsApi.getProducts({ is_active: 'true', page_size: 10000, ordering: '-id' }),
  });

  const createMutation = useMutation({
    mutationFn: (payload: WarehouseTransferPayload) => inventoryApi.createWarehouseTransfer(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      messageApi.success('Đã tạo phiếu chuyển');
      form.resetFields();
      onClose();
      onSuccess();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: WarehouseTransferPayload) => inventoryApi.updateWarehouseTransfer(data!.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      messageApi.success('Đã cập nhật phiếu chuyển');
      form.resetFields();
      onClose();
      onSuccess();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const setLines = (nextLines: TransferLineFormValue[]) => {
    form.setFieldValue(
      'lines',
      nextLines.map((line, index) => ({
        ...line,
        line_number: index + 1,
      })),
    );
  };

  useEffect(() => {
    if (!open) {
      form.resetFields();
      return;
    }
    form.setFieldsValue(buildInitialValues(data));
  }, [data, form, open]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload: WarehouseTransferPayload = {
        transfer_date: values.transfer_date,
        from_warehouse: values.from_warehouse,
        to_warehouse: values.to_warehouse,
        reference: values.reference,
        note: values.note,
        lines: (values.lines || [])
          .filter((line) => line.product && Number(line.qty) > 0)
          .map((line, index) => ({
            line_number: index + 1,
            product: line.product,
            qty: String(line.qty),
            received_qty: String(line.received_qty ?? 0),
            note: line.note || '',
          })),
      };

      if (payload.lines.length === 0) {
        messageApi.error('Vui lòng thêm ít nhất một dòng chuyển kho hợp lệ');
        return;
      }

      if (data?.id) {
        updateMutation.mutate(payload);
      } else {
        createMutation.mutate(payload);
      }
    } catch {
      messageApi.error('Vui lòng kiểm tra lại thông tin phiếu chuyển');
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title={data ? `Chỉnh sửa chuyển kho - ${data.code}` : 'Tạo phiếu chuyển kho'}
        open={open}
        onCancel={onClose}
        width={1000}
        okText={data ? 'Lưu thay đổi' : 'Tạo phiếu'}
        cancelText="Hủy"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        onOk={() => void handleSubmit()}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={buildInitialValues(data)}
        >
          <Form.Item label="Ngày chuyển" name="transfer_date" rules={[{ required: true, message: 'Vui lòng chọn ngày chuyển' }]}>
            <Input data-testid="warehouse-transfer-date" type="date" />
          </Form.Item>

          <Form.Item
            label="Từ kho"
            name="from_warehouse"
            rules={[{ required: true, message: 'Vui lòng chọn kho nguồn' }]}
          >
            <Select
              data-testid="warehouse-transfer-from-warehouse"
              showSearch
              optionFilterProp="label"
              placeholder="Chọn kho nguồn"
              options={warehousesQuery.data?.results?.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })) ?? []}
              loading={warehousesQuery.isLoading}
            />
          </Form.Item>

          <Form.Item
            label="Đến kho"
            name="to_warehouse"
            rules={[{ required: true, message: 'Vui lòng chọn kho đích' }]}
          >
            <Select
              data-testid="warehouse-transfer-to-warehouse"
              showSearch
              optionFilterProp="label"
              placeholder="Chọn kho đích"
              options={warehousesQuery.data?.results?.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })) ?? []}
              loading={warehousesQuery.isLoading}
            />
          </Form.Item>

          <Form.Item label="Tham chiếu" name="reference">
            <Input data-testid="warehouse-transfer-reference" placeholder="Số đơn hàng hoặc tham chiếu khác" />
          </Form.Item>

          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea data-testid="warehouse-transfer-note" rows={2} placeholder="Ghi chú thêm" />
          </Form.Item>

          <Form.Item label="Dòng chuyển" name="lines">
            <NestedLinesTable
              lines={lines}
              onChange={setLines}
              products={productsQuery.data?.results ?? []}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function NestedLinesTable({
  lines,
  onChange,
  products,
}: {
  lines: TransferLineFormValue[];
  onChange: (lines: TransferLineFormValue[]) => void;
  products: Product[];
}) {
  const addLine = () => {
    onChange([...(lines ?? []), createEmptyLine(lines.length)]);
  };

  const removeLine = (index: number) => {
    onChange(lines.filter((_, itemIndex) => itemIndex !== index));
  };

  const updateLine = <K extends keyof TransferLineFormValue>(
    index: number,
    field: K,
    value: TransferLineFormValue[K],
  ) => {
    const nextLines = lines.map((line, itemIndex) =>
      itemIndex === index
        ? {
            ...line,
            [field]: value,
          }
        : line,
    );
    onChange(nextLines);
  };

  const columns: ColumnsType<TransferLineFormValue> = [
    {
      title: 'Sản phẩm',
      dataIndex: 'product',
      width: 260,
      render: (_, __, index) => (
        <Select
          data-testid={`warehouse-transfer-line-product-${index}`}
          value={lines[index]?.product}
          onChange={(value) => updateLine(index, 'product', value)}
          placeholder="Chọn SP"
          options={products.map((product) => ({ value: product.id, label: `${product.code} - ${product.name}` }))}
          style={{ width: '100%' }}
          showSearch
          optionFilterProp="label"
        />
      ),
    },
    {
      title: 'Số lượng chuyển',
      dataIndex: 'qty',
      width: 150,
      render: (_, __, index) => (
        <InputNumber
          data-testid={`warehouse-transfer-line-qty-${index}`}
          value={lines[index]?.qty}
          onChange={(value) => updateLine(index, 'qty', Number(value ?? 0))}
          min={0}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Ghi chú',
      dataIndex: 'note',
      width: 180,
      render: (_, __, index) => (
        <Input
          data-testid={`warehouse-transfer-line-note-${index}`}
          value={lines[index]?.note}
          onChange={(event) => updateLine(index, 'note', event.target.value)}
          placeholder="Ghi chú"
        />
      ),
    },
    {
      title: 'Thao tác',
      width: 80,
      render: (_, __, index) => (
        <Button danger size="small" icon={<DeleteOutlined />} onClick={() => removeLine(index)} />
      ),
    },
  ];

  return (
    <div>
      <Table
        dataSource={lines}
        columns={columns}
        rowKey={(record, index) => `${record.line_number}-${index ?? 0}`}
        pagination={false}
        size="small"
        locale={{ emptyText: 'Chưa có dòng chuyển kho nào.' }}
      />
      <Button data-testid="warehouse-transfer-add-line" icon={<PlusOutlined />} onClick={addLine} style={{ marginTop: 8 }}>
        Thêm dòng
      </Button>
    </div>
  );
}
