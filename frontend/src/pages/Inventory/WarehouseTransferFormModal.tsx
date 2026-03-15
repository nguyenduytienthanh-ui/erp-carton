import { Button, Form, Input, InputNumber, Modal, Select, Table, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WarehouseTransfer, WarehouseTransferLine } from '../../types/inventory';
import { inventoryApi } from '../../api/inventory';
import { productsApi } from '../../api/products';
import { warehouseApi } from '../../api/inventory';
import { getToastMessage } from '../../shared/apiError';

interface WarehouseTransferFormModalProps {
  open: boolean;
  data?: WarehouseTransfer | null;
  onClose: () => void;
  onSuccess: () => void;
}

type FormData = {
  transfer_date: string;
  from_warehouse: number;
  to_warehouse: number;
  reference: string;
  note: string;
  lines: Omit<WarehouseTransferLine, 'id'>[];
};

export default function WarehouseTransferFormModal({ open, data, onClose, onSuccess }: WarehouseTransferFormModalProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormData>();

  const warehousesQuery = useQuery({
    queryKey: ['warehouses-active'],
    queryFn: () => warehouseApi.getWarehouses({ is_active: 'true', page_size: 1000 }),
  });

  const productsQuery = useQuery({
    queryKey: ['products-active'],
    queryFn: () => productsApi.getProducts({ is_active: 'true', page_size: 10000 }),
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => inventoryApi.createWarehouseTransfer(payload),
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
    mutationFn: (payload: Record<string, unknown>) => inventoryApi.updateWarehouseTransfer(data!.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      messageApi.success('Đã cập nhật phiếu chuyển');
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
        transfer_date: values.transfer_date,
        from_warehouse: values.from_warehouse,
        to_warehouse: values.to_warehouse,
        reference: values.reference,
        note: values.note,
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
        title={data ? `Chỉnh sửa chuyển kho - ${data.code}` : 'Tạo phiếu chuyển kho'}
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
                  transfer_date: data.transfer_date,
                  from_warehouse: data.from_warehouse,
                  to_warehouse: data.to_warehouse,
                  reference: data.reference,
                  note: data.note,
                  lines: data.lines || [],
                }
              : { lines: [] }
          }
        >
          <Form.Item label="Ngày chuyển" name="transfer_date" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>

          <Form.Item
            label="Từ kho"
            name="from_warehouse"
            rules={[{ required: true, message: 'Vui lòng chọn kho nguồn' }]}
          >
            <Select
              placeholder="Chọn kho nguồn"
              options={warehousesQuery.data?.results?.map((w) => ({ value: w.id, label: w.name })) ?? []}
              loading={warehousesQuery.isLoading}
            />
          </Form.Item>

          <Form.Item label="Đến kho" name="to_warehouse" rules={[{ required: true, message: 'Vui lòng chọn kho đích' }]}>
            <Select
              placeholder="Chọn kho đích"
              options={warehousesQuery.data?.results?.map((w) => ({ value: w.id, label: w.name })) ?? []}
              loading={warehousesQuery.isLoading}
            />
          </Form.Item>

          <Form.Item label="Tham chiếu" name="reference">
            <Input placeholder="Số đơn hàng hoặc tham chiếu khác" />
          </Form.Item>

          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={2} placeholder="Ghi chú thêm" />
          </Form.Item>

          <Form.Item label="Dòng chuyển" name="lines">
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
        received_qty: 0,
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
      title: 'Số lượng chuyển',
      dataIndex: 'qty',
      width: 120,
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
