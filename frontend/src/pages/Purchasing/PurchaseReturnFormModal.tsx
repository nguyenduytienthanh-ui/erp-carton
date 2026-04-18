import { useEffect } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { productsApi } from '../../api/products';
import { purchasingApi, suppliersApi } from '../../api/purchasing';
import { getToastMessage } from '../../shared/apiError';
import type { Product } from '../../types/product';
import type { PurchaseReturn, Supplier } from '../../types/purchasing';

interface PurchaseReturnFormModalProps {
  open: boolean;
  data?: PurchaseReturn | null;
  onClose: () => void;
  onSuccess: () => void;
}

type PurchaseReturnLineFormValue = {
  line_number: number;
  product?: number;
  qty: number;
  unit_price: number;
  tax_pct: number;
  note?: string;
};

type PurchaseReturnFormValues = {
  return_date: string;
  supplier?: number;
  return_reason: string;
  return_notes: string;
  lines: PurchaseReturnLineFormValue[];
};

type PurchaseReturnPayload = {
  return_date: string;
  supplier: number;
  return_reason: string;
  return_notes: string;
  lines: Array<{
    line_number: number;
    product?: number;
    qty: string;
    unit_price: string;
    tax_pct: string;
    note?: string;
  }>;
};

function createEmptyLine(index: number): PurchaseReturnLineFormValue {
  return {
    line_number: index + 1,
    product: undefined,
    qty: 1,
    unit_price: 0,
    tax_pct: 0,
    note: '',
  };
}

function buildInitialValues(data?: PurchaseReturn | null): PurchaseReturnFormValues {
  return data
    ? {
        return_date: data.return_date,
        supplier: data.supplier,
        return_reason: data.return_reason,
        return_notes: data.return_notes,
        lines: (data.lines ?? []).map((line, index) => ({
          line_number: line.line_number ?? index + 1,
          product: line.product,
          qty: Number(line.qty ?? 0),
          unit_price: Number(line.unit_price ?? 0),
          tax_pct: Number(line.tax_pct ?? 0),
          note: line.note || '',
        })),
      }
    : {
        return_date: '',
        supplier: undefined,
        return_reason: '',
        return_notes: '',
        lines: [],
      };
}

export default function PurchaseReturnFormModal({
  open,
  data,
  onClose,
  onSuccess,
}: PurchaseReturnFormModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<PurchaseReturnFormValues>();
  const lines = Form.useWatch('lines', form) ?? [];

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(buildInitialValues(data));
  }, [data, form, open]);

  const suppliersQuery = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => suppliersApi.getSuppliers({ is_active: 'true', page_size: 1000 }),
  });

  const productsQuery = useQuery({
    queryKey: ['products-active'],
    queryFn: () => productsApi.getProducts({ is_active: 'true', page_size: 10000 }),
  });

  const createMutation = useMutation({
    mutationFn: (payload: PurchaseReturnPayload) => purchasingApi.createPurchaseReturn(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      messageApi.success('Đã tạo phiếu trả');
      form.resetFields();
      onClose();
      onSuccess();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: PurchaseReturnPayload) => purchasingApi.updatePurchaseReturn(data!.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      messageApi.success('Đã cập nhật phiếu trả');
      form.resetFields();
      onClose();
      onSuccess();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const setLines = (nextLines: PurchaseReturnLineFormValue[]) => {
    form.setFieldValue(
      'lines',
      nextLines.map((line, index) => ({
        ...line,
        line_number: index + 1,
      })),
    );
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      if (!values.supplier) {
        messageApi.error('Vui lòng chọn nhà cung cấp');
        return;
      }

      const payload: PurchaseReturnPayload = {
        return_date: values.return_date,
        supplier: values.supplier,
        return_reason: values.return_reason,
        return_notes: values.return_notes,
        lines: (values.lines || [])
          .filter((line) => line.product && Number(line.qty) > 0)
          .map((line, index) => ({
            line_number: index + 1,
            product: line.product,
            qty: String(line.qty),
            unit_price: String(line.unit_price),
            tax_pct: String(line.tax_pct),
            note: line.note || '',
          })),
      };

      if (payload.lines.length === 0) {
        messageApi.error('Vui lòng thêm ít nhất một dòng trả hàng hợp lệ');
        return;
      }

      if (data?.id) {
        updateMutation.mutate(payload);
      } else {
        createMutation.mutate(payload);
      }
    } catch {
      messageApi.error('Vui lòng kiểm tra lại thông tin phiếu trả');
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        data-testid="purchase-return-form-modal"
        title={data ? `Chỉnh sửa phiếu trả - ${data.code}` : 'Tạo phiếu trả mới'}
        open={open}
        onCancel={onClose}
        width={1000}
        okText={data ? 'Lưu thay đổi' : 'Tạo phiếu trả'}
        cancelText="Hủy"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        onOk={() => void handleSubmit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={buildInitialValues(data)}>
          <Form.Item
            label="Ngày trả"
            name="return_date"
            rules={[{ required: true, message: 'Vui lòng chọn ngày trả' }]}
          >
            <Input data-testid="purchase-return-form-date" type="date" />
          </Form.Item>

          <Form.Item
            label="Nhà cung cấp"
            name="supplier"
            rules={[{ required: true, message: 'Vui lòng chọn NCC' }]}
          >
            <Select
              placeholder="Chọn NCC"
              options={(suppliersQuery.data?.results ?? []).map((supplier: Supplier) => ({
                value: supplier.id,
                label: `${supplier.code} - ${supplier.name}`,
              }))}
              loading={suppliersQuery.isLoading}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>

          <Form.Item
            label="Lý do trả"
            name="return_reason"
            rules={[{ required: true, message: 'Vui lòng nhập lý do trả hàng' }]}
          >
            <Input.TextArea data-testid="purchase-return-form-reason" rows={2} placeholder="Nhập lý do trả hàng" />
          </Form.Item>

          <Form.Item label="Ghi chú" name="return_notes">
            <Input.TextArea data-testid="purchase-return-form-notes" rows={2} placeholder="Ghi chú thêm" />
          </Form.Item>

          <Form.Item label="Dòng trả" name="lines">
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
  lines: PurchaseReturnLineFormValue[];
  onChange: (lines: PurchaseReturnLineFormValue[]) => void;
  products: Product[];
}) {
  const addLine = () => {
    onChange([...(lines ?? []), createEmptyLine(lines.length)]);
  };

  const removeLine = (index: number) => {
    onChange(lines.filter((_, itemIndex) => itemIndex !== index));
  };

  const updateLine = <K extends keyof PurchaseReturnLineFormValue>(
    index: number,
    field: K,
    value: PurchaseReturnLineFormValue[K],
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

  const columns: ColumnsType<PurchaseReturnLineFormValue> = [
    {
      title: 'Sản phẩm',
      dataIndex: 'product',
      width: 260,
      render: (_, __, index) => (
        <Select
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
      title: 'Số lượng',
      dataIndex: 'qty',
      width: 110,
      render: (_, __, index) => (
        <InputNumber
          value={lines[index]?.qty}
          onChange={(value) => updateLine(index, 'qty', Number(value ?? 0))}
          min={0}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Đơn giá',
      dataIndex: 'unit_price',
      width: 130,
      render: (_, __, index) => (
        <InputNumber
          value={lines[index]?.unit_price}
          onChange={(value) => updateLine(index, 'unit_price', Number(value ?? 0))}
          min={0}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Thuế %',
      dataIndex: 'tax_pct',
      width: 110,
      render: (_, __, index) => (
        <InputNumber
          value={lines[index]?.tax_pct}
          onChange={(value) => updateLine(index, 'tax_pct', Number(value ?? 0))}
          min={0}
          max={100}
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
        locale={{ emptyText: 'Chưa có dòng trả hàng nào.' }}
      />
      <Button icon={<PlusOutlined />} onClick={addLine} style={{ marginTop: 8 }}>
        Thêm dòng
      </Button>
    </div>
  );
}
