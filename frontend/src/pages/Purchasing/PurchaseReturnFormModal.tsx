import { useEffect } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Table, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { purchasingApi, suppliersApi } from '../../api/purchasing';
import { getToastMessage } from '../../shared/apiError';
import type { PurchaseReceipt, PurchaseReceiptReturnableLine, PurchaseReturn, Supplier } from '../../types/purchasing';

const { Text } = Typography;

interface PurchaseReturnFormModalProps {
  open: boolean;
  data?: PurchaseReturn | null;
  onClose: () => void;
  onSuccess: () => void;
}

type PurchaseReturnLineFormValue = {
  line_number: number;
  source_receipt_line?: number;
  qty: number;
  note?: string;
};

type PurchaseReturnFormValues = {
  return_date: string;
  supplier?: number;
  source_receipt?: number;
  reference?: string;
  return_reason: string;
  return_notes: string;
  lines: PurchaseReturnLineFormValue[];
};

type PurchaseReturnPayload = {
  return_date: string;
  supplier?: number;
  source_receipt: number;
  reference?: string;
  return_reason: string;
  return_notes: string;
  lines: Array<{
    line_number: number;
    source_receipt_line: number;
    qty: string;
    note?: string;
  }>;
};

const RETURN_REASON_OPTIONS = [
  { value: 'DEFECT', label: 'Lỗi' },
  { value: 'WRONG_QTY', label: 'Sai số lượng' },
  { value: 'WRONG_ITEM', label: 'Sai hàng' },
  { value: 'DAMAGE', label: 'Hỏng hóc' },
  { value: 'OTHER', label: 'Khác' },
];

function createEmptyLine(index: number, sourceLine?: PurchaseReceiptReturnableLine): PurchaseReturnLineFormValue {
  return {
    line_number: index + 1,
    source_receipt_line: sourceLine?.id,
    qty: sourceLine ? Math.min(Number(sourceLine.remaining_returnable_qty || 0), 1) : 1,
    note: '',
  };
}

function buildInitialValues(data?: PurchaseReturn | null): PurchaseReturnFormValues {
  return data
    ? {
        return_date: data.return_date,
        supplier: data.supplier,
        source_receipt: data.source_receipt ?? undefined,
        reference: data.reference || '',
        return_reason: data.return_reason || 'OTHER',
        return_notes: data.return_notes,
        lines: (data.lines ?? []).map((line, index) => ({
          line_number: line.line_number ?? index + 1,
          source_receipt_line: line.source_receipt_line ?? undefined,
          qty: Number(line.qty ?? 0),
          note: line.note || '',
        })),
      }
    : {
        return_date: '',
        supplier: undefined,
        source_receipt: undefined,
        reference: '',
        return_reason: 'OTHER',
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
  const supplierId = Form.useWatch('supplier', form);
  const sourceReceiptId = Form.useWatch('source_receipt', form);
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

  const receiptsQuery = useQuery({
    queryKey: ['purchase-return-source-receipts', supplierId],
    queryFn: () => purchasingApi.getReceipts({
      status: 'POSTED',
      supplier: supplierId,
      page_size: 500,
    }),
    enabled: open && !!supplierId,
  });

  const returnableLinesQuery = useQuery({
    queryKey: ['purchase-return-returnable-lines', sourceReceiptId],
    queryFn: () => purchasingApi.getReceiptReturnableLines(sourceReceiptId!),
    enabled: open && !!sourceReceiptId,
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
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return', data?.id] });
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
      if (!values.source_receipt) {
        messageApi.error('Vui lòng chọn phiếu nhập nguồn');
        return;
      }

      const payload: PurchaseReturnPayload = {
        return_date: values.return_date,
        supplier: values.supplier,
        source_receipt: values.source_receipt,
        reference: values.reference || '',
        return_reason: values.return_reason,
        return_notes: values.return_notes || '',
        lines: (values.lines || [])
          .filter((line) => line.source_receipt_line && Number(line.qty) > 0)
          .map((line, index) => ({
            line_number: index + 1,
            source_receipt_line: line.source_receipt_line!,
            qty: String(line.qty),
            note: line.note || '',
          })),
      };

      if (payload.lines.length === 0) {
        messageApi.error('Vui lòng thêm ít nhất một dòng phiếu nhập để trả hàng');
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
        width={1100}
        okText={data ? 'Lưu thay đổi' : 'Tạo phiếu trả'}
        cancelText="Hủy"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        onOk={() => void handleSubmit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={buildInitialValues(data)}>
          {data?.legacy_source_warning ? (
            <Alert showIcon type="warning" message={data.legacy_source_warning} style={{ marginBottom: 16 }} />
          ) : null}

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
              onChange={() => {
                form.setFieldsValue({ source_receipt: undefined, lines: [] });
              }}
            />
          </Form.Item>

          <Form.Item
            label="Phiếu nhập nguồn"
            name="source_receipt"
            rules={[{ required: true, message: 'Vui lòng chọn phiếu nhập nguồn' }]}
          >
            <Select
              placeholder="Chọn phiếu nhập đã ghi sổ"
              loading={receiptsQuery.isLoading}
              disabled={!supplierId}
              showSearch
              optionFilterProp="label"
              onChange={() => {
                form.setFieldValue('lines', []);
              }}
              options={(receiptsQuery.data?.results ?? []).map((receipt: PurchaseReceipt) => ({
                value: receipt.id,
                label: `${receipt.code} - ${receipt.receipt_date} - ${Number(receipt.total_amount || 0).toLocaleString('vi-VN')} đ`,
              }))}
            />
          </Form.Item>

          <Form.Item label="Tham chiếu" name="reference">
            <Input placeholder="Số chứng từ NCC hoặc ghi chú tham chiếu" />
          </Form.Item>

          <Form.Item
            label="Lý do trả"
            name="return_reason"
            rules={[{ required: true, message: 'Vui lòng chọn lý do trả hàng' }]}
          >
            <Select options={RETURN_REASON_OPTIONS} />
          </Form.Item>

          <Form.Item label="Ghi chú" name="return_notes">
            <Input.TextArea data-testid="purchase-return-form-notes" rows={2} placeholder="Ghi chú thêm" />
          </Form.Item>

          <Form.Item label="Dòng trả" name="lines">
            <NestedLinesTable
              lines={lines}
              onChange={setLines}
              returnableLines={returnableLinesQuery.data ?? []}
              loading={returnableLinesQuery.isLoading}
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
  returnableLines,
  loading,
}: {
  lines: PurchaseReturnLineFormValue[];
  onChange: (lines: PurchaseReturnLineFormValue[]) => void;
  returnableLines: PurchaseReceiptReturnableLine[];
  loading: boolean;
}) {
  const usedSourceLineIds = new Set(lines.map((line) => line.source_receipt_line).filter(Boolean));

  const addLine = () => {
    const nextSourceLine = returnableLines.find(
      (line) => !usedSourceLineIds.has(line.id) && Number(line.remaining_returnable_qty || 0) > 0,
    );
    onChange([...(lines ?? []), createEmptyLine(lines.length, nextSourceLine)]);
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

  const findSourceLine = (id?: number) => returnableLines.find((line) => line.id === id);

  const columns: ColumnsType<PurchaseReturnLineFormValue> = [
    {
      title: 'Dòng phiếu nhập',
      dataIndex: 'source_receipt_line',
      width: 320,
      render: (_, record, index) => (
        <Select
          value={record.source_receipt_line}
          onChange={(value) => {
            const sourceLine = findSourceLine(value);
            updateLine(index, 'source_receipt_line', value);
            updateLine(index, 'qty', sourceLine ? Math.min(Number(sourceLine.remaining_returnable_qty || 0), 1) : 1);
          }}
          placeholder="Chọn dòng phiếu nhập"
          options={returnableLines.map((line) => ({
            value: line.id,
            disabled: usedSourceLineIds.has(line.id) && line.id !== record.source_receipt_line,
            label: `#${line.line_number} - ${line.product_code || ''} ${line.product_name || ''}`,
          }))}
          style={{ width: '100%' }}
          showSearch
          optionFilterProp="label"
        />
      ),
    },
    {
      title: 'Đã nhập',
      width: 110,
      render: (_, record) => <Text>{findSourceLine(record.source_receipt_line)?.quantity ?? '-'}</Text>,
    },
    {
      title: 'Đã trả',
      width: 110,
      render: (_, record) => <Text>{findSourceLine(record.source_receipt_line)?.posted_returned_qty ?? '-'}</Text>,
    },
    {
      title: 'Còn trả',
      width: 110,
      render: (_, record) => <Text strong>{findSourceLine(record.source_receipt_line)?.remaining_returnable_qty ?? '-'}</Text>,
    },
    {
      title: 'Số lượng trả',
      dataIndex: 'qty',
      width: 130,
      render: (_, record, index) => {
        const sourceLine = findSourceLine(record.source_receipt_line);
        return (
          <InputNumber
            value={record.qty}
            onChange={(value) => updateLine(index, 'qty', Number(value ?? 0))}
            min={0}
            max={sourceLine ? Number(sourceLine.remaining_returnable_qty || 0) : undefined}
            style={{ width: '100%' }}
          />
        );
      },
    },
    {
      title: 'Đơn giá nguồn',
      width: 130,
      render: (_, record) => {
        const sourceLine = findSourceLine(record.source_receipt_line);
        return sourceLine ? Number(sourceLine.unit_cost || 0).toLocaleString('vi-VN') : '-';
      },
    },
    {
      title: 'Ghi chú',
      dataIndex: 'note',
      width: 180,
      render: (_, record, index) => (
        <Input
          value={record.note}
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
        loading={loading}
        dataSource={lines}
        columns={columns}
        rowKey={(record, index) => `${record.line_number}-${index ?? 0}`}
        pagination={false}
        size="small"
        locale={{ emptyText: 'Chọn phiếu nhập nguồn rồi thêm dòng trả hàng.' }}
        scroll={{ x: 1100 }}
      />
      <Button
        icon={<PlusOutlined />}
        onClick={addLine}
        disabled={returnableLines.length === 0}
        style={{ marginTop: 8 }}
      >
        Thêm dòng
      </Button>
    </div>
  );
}
