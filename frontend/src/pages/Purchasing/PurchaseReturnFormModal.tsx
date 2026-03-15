import { Button, Form, Input, InputNumber, Modal, Select, Table, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PurchaseReturn, PurchaseReturnLine } from '../../types/purchasing';
import { purchasingApi } from '../../api/purchasing';
import { productsApi } from '../../api/products';
import { suppliersApi } from '../../api/purchasing';
import { getToastMessage } from '../../shared/apiError';

interface PurchaseReturnFormModalProps {
  open: boolean;
  data?: PurchaseReturn | null;
  onClose: () => void;
  onSuccess: () => void;
}

type FormData = {
  return_date: string;
  supplier: number;
  return_reason: string;
  return_notes: string;
  lines: Omit<PurchaseReturnLine, 'id'>[];
};

export default function PurchaseReturnFormModal({ open, data, onClose, onSuccess }: PurchaseReturnFormModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormData>();

  const suppliersQuery = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => suppliersApi.getSuppliers({ is_active: 'true', page_size: 1000 }),
  });

  const productsQuery = useQuery({
    queryKey: ['products-active'],
    queryFn: () => productsApi.getProducts({ is_active: 'true', page_size: 10000 }),
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => purchasingApi.createPurchaseReturn(payload),
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
    mutationFn: (payload: Record<string, unknown>) => purchasingApi.updatePurchaseReturn(data!.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      messageApi.success('Đã cập nhật phiếu trả');
      form.resetFields();
      onClose();
      onSuccess();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        return_date: values.return_date,
        supplier: values.supplier,
        return_reason: values.return_reason,
        return_notes: values.return_notes,
        lines: values.lines || [],
      };

      if (data?.id) {
        updateMutation.mutate(payload);
      } else {
        createMutation.mutate(payload);
      }
    } catch {
      // validation error
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title={data ? `Chỉnh sửa phiếu trả - ${data.code}` : 'Tạo phiếu trả mới'}
        open={open}
        onCancel={onClose}
        width={1000}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        onOk={handleSubmit}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={
            data
              ? {
                  return_date: data.return_date,
                  supplier: data.supplier,
                  return_reason: data.return_reason,
                  return_notes: data.return_notes,
                  lines: data.lines || [],
                }
              : { lines: [] }
          }
        >
          <Form.Item label="Ngày trả" name="return_date" rules={[{ required: true, message: 'Vui lòng chọn ngày trả' }]}>
            <Input type="date" />
          </Form.Item>

          <Form.Item label="Nhà cung cấp" name="supplier" rules={[{ required: true, message: 'Vui lòng chọn NCC' }]}>
            <Select
              placeholder="Chọn NCC"
              options={suppliersQuery.data?.results?.map((s) => ({ value: s.id, label: s.name })) ?? []}
              loading={suppliersQuery.isLoading}
            />
          </Form.Item>

          <Form.Item label="Lý do trả" name="return_reason" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="Nhập lý do trả hàng" />
          </Form.Item>

          <Form.Item label="Ghi chú" name="return_notes">
            <Input.TextArea rows={2} placeholder="Ghi chú thêm" />
          </Form.Item>

          <Form.Item label="Dòng trả" name="lines">
            <NestedLinesTable products={productsQuery.data?.results ?? []} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function NestedLinesTable({ products }: { products: any[] }) {
  const [lines, setLines] = Form.useWatch(['lines'], Form.useFormInstance()) || [];

  const addLine = () => {
    setLines([
      ...lines,
      {
        line_number: (lines?.length ?? 0) + 1,
        product: undefined,
        qty: 1,
        unit_price: 0,
        tax_pct: 0,
        note: '',
      },
    ]);
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_: any, i: number) => i !== index));
  };

  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setLines(newLines);
  };

  const columns = [
    {
      title: 'Sản phẩm',
      dataIndex: 'product',
      width: 200,
      render: (_: any, __: any, index: number) => (
        <Select
          value={lines[index]?.product}
          onChange={(val) => updateLine(index, 'product', val)}
          placeholder="Chọn SP"
          options={products.map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }))}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Số lượng',
      dataIndex: 'qty',
      width: 100,
      render: (_: any, __: any, index: number) => (
        <InputNumber
          value={lines[index]?.qty}
          onChange={(val) => updateLine(index, 'qty', val)}
          min={0}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Đơn giá',
      dataIndex: 'unit_price',
      width: 120,
      render: (_: any, __: any, index: number) => (
        <InputNumber
          value={lines[index]?.unit_price}
          onChange={(val) => updateLine(index, 'unit_price', val)}
          min={0}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Thuế %',
      dataIndex: 'tax_pct',
      width: 80,
      render: (_: any, __: any, index: number) => (
        <InputNumber
          value={lines[index]?.tax_pct}
          onChange={(val) => updateLine(index, 'tax_pct', val)}
          min={0}
          max={100}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Ghi chú',
      dataIndex: 'note',
      width: 150,
      render: (_: any, __: any, index: number) => (
        <Input
          value={lines[index]?.note}
          onChange={(e) => updateLine(index, 'note', e.target.value)}
          placeholder="Ghi chú"
        />
      ),
    },
    {
      title: 'Thao tác',
      width: 80,
      render: (_: any, __: any, index: number) => (
        <Button danger size="small" icon={<DeleteOutlined />} onClick={() => removeLine(index)} />
      ),
    },
  ];

  return (
    <div>
      <Table
        dataSource={lines || []}
        columns={columns}
        rowKey={(_, index) => index}
        pagination={false}
        size="small"
      />
      <Button icon={<PlusOutlined />} onClick={addLine} style={{ marginTop: 8 }}>
        Thêm dòng
      </Button>
    </div>
  );
}
