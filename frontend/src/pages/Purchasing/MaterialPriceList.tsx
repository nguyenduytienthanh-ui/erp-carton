import { useMemo, useState } from 'react';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DownloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { purchasingApi } from '../../api/purchasing';
import { productsApi } from '../../api/products';
import type { MaterialPurchasePrice } from '../../types/purchasing';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import { canManagePurchasingData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';
import FormattedPrice from '../../components/FormattedPrice/FormattedPrice';
import PageHeader from '../../components/PageHeader/PageHeader';

type FormValues = Omit<MaterialPurchasePrice, 'id' | 'created_at' | 'updated_at'>;

const emptyForm: Partial<FormValues> = {
  product: undefined,
  supplier: undefined,
  unit_price: '0',
  currency: 'VND',
  uom: '',
  effective_from: dayjs().format('YYYY-MM-DD'),
  effective_to: undefined,
  min_quantity: undefined,
  note: '',
};

export default function MaterialPriceList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManagePurchasingData();
  const [searchInput, setSearchInput] = useState('');
  const [filterProduct, setFilterProduct] = useState<number | undefined>(undefined);
  const [filterSupplier, setFilterSupplier] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MaterialPurchasePrice | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm();
  const { config, saveConfig } = useUserPreferences(PAGES.PURCHASING_MATERIAL_PRICES);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-effective_from' };
    if (searchInput.trim()) next.search = searchInput.trim();
    if (filterProduct != null) next.product = filterProduct;
    if (filterSupplier != null) next.supplier = filterSupplier;
    return next;
  }, [searchInput, filterProduct, filterSupplier, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['purchasing-material-prices', params],
    queryFn: () => purchasingApi.getMaterialPrices(params),
  });
  const productsQuery = useQuery({
    queryKey: ['products-for-material-price'],
    queryFn: () => productsApi.getProducts({ page_size: 500, ordering: 'code', status: 'ACTIVE' }),
  });
  const suppliersQuery = useQuery({
    queryKey: ['suppliers-for-material-price'],
    queryFn: () => purchasingApi.getSuppliers({ page_size: 500, ordering: 'code', is_active: 'true' }),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['purchasing-material-prices'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: FormValues) => purchasingApi.createMaterialPrice(payload),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã thêm bảng giá');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<FormValues> }) =>
      purchasingApi.updateMaterialPrice(id, payload),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã cập nhật bảng giá');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: purchasingApi.deleteMaterialPrice,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã xóa bảng giá');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const columns: ColumnsType<MaterialPurchasePrice> = [
    { title: 'Mã SP', dataIndex: 'product_code', width: 120 },
    { title: 'Tên SP', dataIndex: 'product_name', width: 200 },
    { title: 'NCC', dataIndex: 'supplier_name', width: 160, render: (v) => v || 'Giá chuẩn' },
    { title: 'Đơn giá', dataIndex: 'unit_price', width: 120, render: (v) => <FormattedPrice value={v} /> },
    { title: 'Tiền tệ', dataIndex: 'currency', width: 80 },
    { title: 'Đơn vị', dataIndex: 'uom', width: 80, render: (v) => v || '-' },
    { title: 'SL tối thiểu', dataIndex: 'min_quantity', width: 110, render: (v) => (v != null && v !== '' ? Number(v).toLocaleString('vi-VN') : '-') },
    { title: 'Từ ngày', dataIndex: 'effective_from', width: 110 },
    { title: 'Đến ngày', dataIndex: 'effective_to', width: 110, render: (v) => v || '-' },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            disabled={!canManage}
            onClick={() => {
              setEditing(row);
              form.setFieldsValue({
                ...row,
                effective_from: row.effective_from ? dayjs(row.effective_from) : null,
                effective_to: row.effective_to ? dayjs(row.effective_to) : null,
              });
              setOpenModal(true);
            }}
          >
            Sửa
          </Button>
          <Button
            size="small"
            danger
            disabled={!canManage}
            onClick={() =>
              Modal.confirm({
                title: `Xóa bảng giá ${row.product_code} - ${row.supplier_name || 'Chung'}?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutateAsync(row.id),
              })
            }
          >
            Xóa
          </Button>
        </Space>
      ),
    },
  ];

  const toPayload = (values: FormValues & { effective_from?: dayjs.Dayjs; effective_to?: dayjs.Dayjs }) => {
    return {
      product: values.product!,
      supplier: values.supplier ?? null,
      unit_price: String(values.unit_price ?? 0),
      currency: values.currency ?? 'VND',
      uom: values.uom?.trim() ?? '',
      effective_from: values.effective_from?.format('YYYY-MM-DD') ?? dayjs().format('YYYY-MM-DD'),
      effective_to: values.effective_to?.format('YYYY-MM-DD') ?? null,
      min_quantity: values.min_quantity != null ? String(values.min_quantity) : null,
      note: values.note?.trim() ?? '',
    };
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    const payload = toPayload(values);
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setOpenModal(false);
  };

  const exportCsv = () => {
    const rows = listQuery.data?.results ?? [];
    if (rows.length === 0) {
      messageApi.warning('Không có dữ liệu để xuất.');
      return;
    }
    const headers = ['Mã SP', 'Tên SP', 'NCC', 'Đơn giá', 'Tiền tệ', 'Đơn vị', 'SL tối thiểu', 'Từ ngày', 'Đến ngày', 'Ghi chú'];
    const escape = (x: string | number | null | undefined) =>
      `"${String(x ?? '').replace(/"/g, '""')}"`;
    const dataRows = rows.map((r) => [
      r.product_code,
      r.product_name,
      r.supplier_name ?? 'Giá chuẩn',
      r.unit_price,
      r.currency,
      r.uom ?? '',
      r.min_quantity ?? '',
      r.effective_from,
      r.effective_to ?? '',
      r.note ?? '',
    ]);
    const csv = [
      headers.map(escape).join(','),
      ...dataRows.map((row) => row.map(escape).join(',')),
    ].join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bang_gia_nvl_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    messageApi.success('Đã xuất CSV.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <PageHeader
        title="Bảng giá nguyên vật liệu"
        subtitle="Giá mua NVL và hàng mua theo nhà cung cấp"
        extra={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!listQuery.data?.results?.length}>
              Xuất CSV
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={() => {
                setEditing(null);
                form.setFieldsValue({ ...emptyForm, effective_from: dayjs(), effective_to: null });
                setOpenModal(true);
              }}
            >
              Thêm bảng giá
            </Button>
          </Space>
        }
      />

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm theo mã SP, tên SP, ghi chú..."
          style={{ width: 280 }}
          allowClear
        />
        <Select
          placeholder="Lọc theo sản phẩm"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 260 }}
          value={filterProduct ?? undefined}
          onChange={(v) => {
            setFilterProduct(v ?? undefined);
            setPage(1);
          }}
          options={productsQuery.data?.results?.map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` })) ?? []}
          loading={productsQuery.isLoading}
        />
        <Select
          placeholder="Lọc theo nhà cung cấp"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 260 }}
          value={filterSupplier ?? undefined}
          onChange={(v) => {
            setFilterSupplier(v ?? undefined);
            setPage(1);
          }}
          options={suppliersQuery.data?.results?.map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })) ?? []}
          loading={suppliersQuery.isLoading}
        />
        <Button
          onClick={() => {
            setSearchInput('');
            setFilterProduct(undefined);
            setFilterSupplier(undefined);
            setPage(1);
          }}
        >
          Xóa bộ lọc
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={listQuery.data?.results ?? []}
        scroll={{ x: 1150 }}
        pagination={{
          current: page,
          pageSize,
          total: listQuery.data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: async (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize });
            }
          },
        }}
      />

      <Modal
        title={editing ? 'Sửa bảng giá' : 'Thêm bảng giá NVL'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={onSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="product" label="Sản phẩm / NVL" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select
              placeholder="Chọn sản phẩm"
              showSearch
              optionFilterProp="label"
              options={productsQuery.data?.results?.map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` })) ?? []}
              loading={productsQuery.isLoading}
              disabled={!!editing}
            />
          </Form.Item>
          <Form.Item name="supplier" label="Nhà cung cấp">
            <Select
              placeholder="Để trống = giá chuẩn chung"
              allowClear
              showSearch
              optionFilterProp="label"
              options={suppliersQuery.data?.results?.map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })) ?? []}
              loading={suppliersQuery.isLoading}
            />
          </Form.Item>
          <Form.Item name="unit_price" label="Đơn giá" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="đ" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="currency" label="Tiền tệ">
              <Select
                options={[
                  { value: 'VND', label: 'VND' },
                  { value: 'USD', label: 'USD' },
                ]}
              />
            </Form.Item>
            <Form.Item name="uom" label="Đơn vị">
              <Input placeholder="Vd: kg, thùng" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="effective_from" label="Từ ngày" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
            </Form.Item>
            <Form.Item name="effective_to" label="Đến ngày">
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
            </Form.Item>
          </div>
          <Form.Item name="min_quantity" label="SL tối thiểu">
            <InputNumber min={0} precision={4} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
