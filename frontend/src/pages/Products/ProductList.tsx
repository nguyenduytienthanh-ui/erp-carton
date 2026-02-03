import { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Button,
  Select,
  message,
  Popconfirm,
  Modal,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  ExportOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products';
import type { Product } from '../../types/product';
import { theme } from '../../styles/theme';
import {
  PageHeader,
  CompactFilters,
  StatusTag,
  FormattedPrice,
  EmptyState,
  ImportModal,
  ColumnChooser,
} from '../../components';
import ProductForm from './ProductForm';

const DEBOUNCE_MS = 500;
const DEFAULT_PAGE_SIZE = 20;

type ProductStatus = 'DRAFT' | 'ACTIVE' | 'DISCONTINUED';

interface FiltersState {
  category?: number;
  unit?: number;
  status?: ProductStatus;
  min_price?: string;
  max_price?: string;
}

interface PaginationState {
  current: number;
  pageSize: number;
  total: number;
}

const ProductList = () => {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FiltersState>({});
  const [filtersApplied, setFiltersApplied] = useState<FiltersState>({});
  const [pagination, setPagination] = useState<PaginationState>({
    current: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState([
    'code',
    'name',
    'category_name',
    'unit_name',
    'cost_price',
    'sale_price',
    'min_stock',
    'status',
  ]);
  const [formVisible, setFormVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const queryClient = useQueryClient();

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPagination((p) => ({ ...p, current: 1 }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Debug: log filters
  useEffect(() => {
    console.log('Current filters:', filters);
  }, [filters]);

  const { data: productsData, isLoading, isError, error } = useQuery({
    queryKey: [
      'products',
      search,
      filtersApplied,
      pagination.current,
      pagination.pageSize,
    ],
    queryFn: () =>
      productsApi.getProducts({
        search: search || undefined,
        category: filtersApplied.category,
        unit: filtersApplied.unit,
        status: filtersApplied.status,
        min_price: filtersApplied.min_price,
        max_price: filtersApplied.max_price,
        page: pagination.current,
        page_size: pagination.pageSize,
      }),
  });

  useEffect(() => {
    if (productsData?.count !== undefined) {
      setPagination((p) => ({ ...p, total: productsData.count }));
    }
  }, [productsData?.count]);

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', 'list'],
    queryFn: () => productsApi.getCategories({ page_size: 100 }),
  });

  const { data: unitsData } = useQuery({
    queryKey: ['units', 'list'],
    queryFn: () => productsApi.getUnits({ page_size: 100 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => productsApi.deleteProduct(id),
    onSuccess: (_, id) => {
      message.success('Xóa sản phẩm thành công!');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSelectedRowKeys((keys) => keys.filter((k) => k !== id));
    },
    onError: (err: any) => {
      message.error(err.response?.data?.detail || 'Xóa thất bại!');
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id) => productsApi.deleteProduct(id)));
    },
    onSuccess: () => {
      message.success('Đã xóa các sản phẩm đã chọn!');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSelectedRowKeys([]);
    },
    onError: (err: any) => {
      message.error(err.response?.data?.detail || 'Xóa thất bại!');
    },
  });

  if (isError) {
    message.error((error as any)?.message || 'Tải danh sách thất bại!');
  }

  const categories = categoriesData?.results ?? [];
  const units = unitsData?.results ?? [];
  const products = productsData?.results ?? [];

  const handleApplyFilters = useCallback(() => {
    setFiltersApplied(filters);
    setPagination((p) => ({ ...p, current: 1 }));
  }, [filters]);

  const handleClearFilters = useCallback(() => {
    setFilters({});
    setFiltersApplied({});
    setPagination((p) => ({ ...p, current: 1 }));
  }, []);

  const handleDelete = useCallback(
    (id: number) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation]
  );

  const handleBulkDelete = useCallback(() => {
    const ids = selectedRowKeys.map(Number).filter(Boolean);
    if (ids.length === 0) {
      message.warning('Chọn ít nhất một sản phẩm để xóa.');
      return;
    }
    bulkDeleteMutation.mutate(ids);
  }, [selectedRowKeys, bulkDeleteMutation]);

  const handleDownloadTemplate = useCallback(async () => {
    try {
      message.loading({ content: 'Đang tải template...', key: 'template' });
      const blob = await productsApi.downloadTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `template_san_pham_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      message.success({ content: 'Đã tải template thành công!', key: 'template' });
    } catch (err: any) {
      message.error({
        content: err?.message || 'Tải template thất bại!',
        key: 'template',
      });
    }
  }, []);

  const handleImport = useCallback(async (file: File) => {
    return await productsApi.importProducts(file);
  }, []);

  const handleExport = useCallback(async () => {
    try {
      message.loading({ content: 'Đang xuất dữ liệu...', key: 'export' });

      const params: Record<string, unknown> = {};
      if (search) params.search = search;
      if (filtersApplied.category) params.category = filtersApplied.category;
      if (filtersApplied.unit) params.unit = filtersApplied.unit;
      if (filtersApplied.status) params.status = filtersApplied.status;

      const blob = await productsApi.exportProducts('excel', params);

      if (!(blob instanceof Blob) || blob.size === 0) {
        message.error({ content: 'Dữ liệu xuất rỗng hoặc không hợp lệ.', key: 'export' });
        return;
      }
      const isExcel =
        blob.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        blob.type === 'application/vnd.ms-excel' ||
        blob.type.includes('spreadsheet') ||
        (blob.type === '' && blob.size > 0); // CORS đôi khi làm blob.type rỗng
      if (!isExcel) {
        message.error({
          content: 'Phản hồi không phải file Excel. Kiểm tra API export và khởi động lại Django nếu cần.',
          key: 'export',
        });
        return;
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `san_pham_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 200);

      message.success({ content: 'Xuất Excel thành công!', key: 'export' });
    } catch (err: any) {
      console.error('Export error:', err);
      const msg =
        err?.message ||
        (typeof err.response?.data?.detail === 'string' ? err.response.data.detail : null) ||
        (typeof err.response?.data?.error === 'string' ? err.response.data.error : null) ||
        'Xuất Excel thất bại!';
      message.error({ content: msg, key: 'export' });
    }
  }, [search, filtersApplied]);

  const applyFilter = useCallback(
    (key: keyof FiltersState, value: number | ProductStatus | undefined) => {
      setFilters((f) => ({ ...f, [key]: value }));
      setFiltersApplied((f) => ({ ...f, [key]: value }));
      setPagination((p) => ({ ...p, current: 1 }));
    },
    []
  );

  const handleAdd = useCallback(() => {
    setEditingProduct(null);
    setFormVisible(true);
  }, []);

  const handleEdit = useCallback((product: Product) => {
    setEditingProduct(product);
    setFormVisible(true);
  }, []);

  const handleFormClose = useCallback(() => {
    setFormVisible(false);
    setEditingProduct(null);
  }, []);

  const allColumns: ColumnsType<Product> = [
    {
      title: 'Mã hàng',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      fixed: 'left' as const,
      render: (code: string, record: Product) => (
        <span
          role="button"
          tabIndex={0}
          onClick={() => handleEdit(record)}
          onKeyDown={(e) => e.key === 'Enter' && handleEdit(record)}
          style={{
            fontWeight: 500,
            color: theme.colors.primary,
            cursor: 'pointer',
          }}
        >
          {code}
        </span>
      ),
    },
    {
      title: 'Tên sản phẩm',
      dataIndex: 'name',
      key: 'name',
      width: 280,
      ellipsis: { showTitle: false },
      render: (name: string) => (
        <Tooltip title={name ?? '-'} placement="topLeft">
          <span style={{ fontWeight: 500 }}>{name ?? '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Danh mục',
      dataIndex: 'category_name',
      key: 'category_name',
      width: 180,
      ellipsis: { showTitle: false },
      render: (text: string) => (
        <Tooltip title={text ?? ''} placement="topLeft">
          <span>{text ?? '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'ĐV',
      dataIndex: 'unit_name',
      key: 'unit_name',
      width: 80,
      align: 'center' as const,
      render: (name: string) => name?.split(' - ')[0],
    },
    {
      title: 'Giá vốn',
      dataIndex: 'cost_price',
      key: 'cost_price',
      width: 110,
      align: 'right' as const,
      render: (price: string) => (
        <FormattedPrice value={price} color="#6b7280" bold={false} />
      ),
    },
    {
      title: 'Giá bán',
      dataIndex: 'sale_price',
      key: 'sale_price',
      width: 120,
      align: 'right' as const,
      render: (price: string) => <FormattedPrice value={price} />,
    },
    {
      title: 'Tồn TT',
      dataIndex: 'min_stock',
      key: 'min_stock',
      width: 90,
      align: 'right' as const,
      render: (stock: string) => (
        <span style={{ color: '#6b7280' }}>
          {parseFloat(stock || '0').toLocaleString('vi-VN')}
        </span>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      align: 'center' as const,
      render: (status: string) => <StatusTag status={status} />,
    },
    {
      title: 'Thao tác',
      key: 'actions',
      fixed: 'right' as const,
      width: 140,
      align: 'center' as const,
      render: (_: unknown, record: Product) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Tooltip title="Xem chi tiết" placement="top">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined style={{ fontSize: 18, color: '#722ed1' }} />}
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(record);
              }}
            />
          </Tooltip>
          <Tooltip title="Nhân bản" placement="top">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined style={{ fontSize: 18, color: '#52c41a' }} />}
              onClick={(e) => {
                e.stopPropagation();
                const cloned = { ...record };
                delete (cloned as Record<string, unknown>).id;
                delete (cloned as Record<string, unknown>).code;
                cloned.name = `${record.name} (Copy)`;
                setEditingProduct(cloned);
                setFormVisible(true);
              }}
            />
          </Tooltip>
          <Tooltip title="Chỉnh sửa" placement="top">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined style={{ fontSize: 18, color: '#1890ff' }} />}
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(record);
              }}
            />
          </Tooltip>
          <Tooltip title="Xóa" placement="top">
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined style={{ fontSize: 18 }} />}
              onClick={(e) => {
                e.stopPropagation();
                Modal.confirm({
                  title: 'Xác nhận xóa',
                  content: `Bạn có chắc muốn xóa sản phẩm "${record.name}"?`,
                  okText: 'Xóa',
                  okType: 'danger',
                  cancelText: 'Hủy',
                  onOk: () => handleDelete(record.id),
                });
              }}
            />
          </Tooltip>
        </div>
      ),
    },
  ];

  // Filter columns: luôn hiện cột thao tác; các cột khác theo visibleColumns
  const displayColumns = allColumns.filter((col) => {
    if (col.key === 'actions') return true;
    return visibleColumns.includes(col.key as string);
  });
  const columns = displayColumns;

  return (
    <PageHeader
      title="Quản lý sản phẩm"
      subtitle={`Tổng ${productsData?.count || 0} sản phẩm`}
      icon="📦"
      extra={
        <>
          <ColumnChooser
            columns={[
              { key: 'code', title: 'Mã SP', required: true },
              { key: 'name', title: 'Tên sản phẩm', required: true },
              { key: 'category_name', title: 'Danh mục' },
              { key: 'unit_name', title: 'Đơn vị' },
              { key: 'cost_price', title: 'Giá vốn' },
              { key: 'sale_price', title: 'Giá bán' },
              { key: 'min_stock', title: 'Tồn TT' },
              { key: 'status', title: 'Trạng thái' },
            ]}
            visibleColumns={visibleColumns}
            onChange={setVisibleColumns}
          />
          <Button
            icon={<UploadOutlined />}
            onClick={() => setImportModalVisible(true)}
          >
            Nhập Excel
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            Xuất Excel
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
          >
            Thêm mới
          </Button>
        </>
      }
    >
      <CompactFilters
        searchPlaceholder="Tìm theo mã, tên sản phẩm..."
        searchValue={searchInput}
        onSearchChange={(v) => setSearchInput(v)}
        onReset={() => {
          setSearchInput('');
          setSearch('');
          setFilters({});
          setFiltersApplied({});
          setPagination((p) => ({ ...p, current: 1 }));
        }}
        filters={
          <>
            <Select
              placeholder="Danh mục"
              allowClear
              style={{ width: 160, borderRadius: '8px' }}
              value={filters.category}
              onChange={(value) => applyFilter('category', value)}
              options={(categoriesData?.results ?? []).map((c) => ({
                label: c.name,
                value: c.id,
              }))}
            />
            <Select
              placeholder="Đơn vị"
              allowClear
              style={{ width: 120, borderRadius: '8px' }}
              value={filters.unit}
              onChange={(value) => applyFilter('unit', value)}
              options={(unitsData?.results ?? []).map((u) => ({
                label: u.name,
                value: u.id,
              }))}
            />
            <Select
              placeholder="Trạng thái"
              allowClear
              style={{ width: 140, borderRadius: '8px' }}
              value={filters.status}
              onChange={(value) => applyFilter('status', value)}
              options={[
                { label: 'Đang bán', value: 'ACTIVE' },
                { label: 'Nháp', value: 'DRAFT' },
                { label: 'Ngừng SX', value: 'DISCONTINUED' },
              ]}
            />
            {selectedRowKeys.length > 0 && (
              <Popconfirm
                title="Xóa các sản phẩm đã chọn?"
                description={`Bạn có chắc muốn xóa ${selectedRowKeys.length} sản phẩm?`}
                onConfirm={handleBulkDelete}
                okText="Xóa"
                cancelText="Hủy"
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<DeleteOutlined />}>
                  Xóa ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
          </>
        }
      />

      <Table<Product>
        rowKey="id"
        columns={columns}
        dataSource={products}
        loading={isLoading}
        size="middle"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        scroll={{ x: 1300 }}
        style={{
          background: '#ffffff',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
        locale={{
          emptyText: (
            <EmptyState
              description="Chưa có sản phẩm nào"
              actionText="Thêm sản phẩm đầu tiên"
              onAction={handleAdd}
            />
          ),
        }}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: productsData?.count ?? 0,
          showSizeChanger: true,
          showTotal: (total) => `Tổng ${total} sản phẩm`,
          pageSizeOptions: ['10', '20', '50', '100'],
          onChange: (page, pageSize) => {
            setPagination((p) => ({
              ...p,
              current: page,
              pageSize: pageSize || DEFAULT_PAGE_SIZE,
            }));
          },
        }}
      />

      <ImportModal
        visible={importModalVisible}
        onClose={() => setImportModalVisible(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['products'] });
        }}
        onDownloadTemplate={handleDownloadTemplate}
        onImport={handleImport}
        entityName="sản phẩm"
      />

      <ProductForm
        visible={formVisible}
        onClose={handleFormClose}
        editingProduct={editingProduct}
      />
    </PageHeader>
  );
};

export default ProductList;
