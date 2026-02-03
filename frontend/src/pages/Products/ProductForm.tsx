import { useState, useEffect } from 'react';
import {
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Tabs,
  Row,
  Col,
  Upload,
  Button,
  message,
  Divider,
  Card,
} from 'antd';
import { UploadOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products';
import type { Product, ProductFormData } from '../../types/product';
import {
  WATERPROOF_OPTIONS,
  BOX_TYPES,
  WAVE_TYPES,
} from '../../types/product';
import { theme } from '../../styles/theme';

const selectStyle: React.CSSProperties = {
  width: '100%',
  height: 32,
  padding: '0 11px',
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  fontSize: 14,
  outline: 'none',
};

interface NativeSelectInputProps {
  value?: number | string;
  onChange?: (value: number | string | undefined) => void;
  placeholder?: string;
  parseNumber?: boolean;
  children: React.ReactNode;
}

const NativeSelectInput = ({
  value,
  onChange,
  placeholder,
  parseNumber,
  children,
}: NativeSelectInputProps) => (
  <select
    style={selectStyle}
    value={value ?? ''}
    onChange={(e) => {
      const v = e.target.value;
      if (onChange) {
        onChange(v === '' ? undefined : parseNumber ? Number(v) : v);
      }
    }}
  >
    <option value="">{placeholder}</option>
    {children}
  </select>
);

interface ProductFormProps {
  visible: boolean;
  onClose: () => void;
  editingProduct?: Product | null;
}

const ProductForm = ({
  visible,
  onClose,
  editingProduct,
}: ProductFormProps) => {
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('basic');
  const [filmFile, setFilmFile] = useState<File | null>(null);
  const [moldFile, setMoldFile] = useState<File | null>(null);

  const queryClient = useQueryClient();

  const { data: categoriesData, refetch: refetchCategories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => productsApi.getCategories({ page_size: 100 }),
    enabled: visible,
  });

  const { data: unitsData } = useQuery({
    queryKey: ['units'],
    queryFn: async () => {
      console.log('🔍 Fetching units...');
      const result = await productsApi.getUnits({ page_size: 100 });
      console.log('🔍 Units fetched:', result);
      return result;
    },
  });

  useEffect(() => {
    console.log('🔍 unitsData changed:', unitsData);
    console.log('🔍 unitsData.results:', unitsData?.results);
  }, [unitsData]);

  useEffect(() => {
    if (visible) {
      refetchCategories();
    }
  }, [visible, refetchCategories]);

  const saveMutation = useMutation({
    mutationFn: (data: ProductFormData) => {
      if (editingProduct?.id) {
        return productsApi.updateProduct(editingProduct.id, data);
      }
      return productsApi.createProduct(data);
    },
    onSuccess: () => {
      message.success(
        editingProduct?.id ? 'Cập nhật thành công!' : 'Thêm mới thành công!'
      );
      queryClient.invalidateQueries({ queryKey: ['products'] });
      handleClose();
    },
    onError: (error: any) => {
      message.error(
        error.response?.data?.detail || 'Có lỗi xảy ra!'
      );
    },
  });

  useEffect(() => {
    if (visible) {
      if (editingProduct) {
        form.setFieldsValue({
          ...editingProduct,
          cost_price: parseFloat(editingProduct.cost_price || '0'),
          sale_price: parseFloat(editingProduct.sale_price || '0'),
          min_stock: parseFloat(editingProduct.min_stock || '0'),
          commission_per_unit: parseFloat(
            editingProduct.commission_per_unit || '0'
          ),
          commission_percent: parseFloat(
            editingProduct.commission_percent || '0'
          ),
          color_count: editingProduct.color_count ?? 0,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          status: 'DRAFT',
          is_active: true,
          cost_price: 0,
          sale_price: 0,
          min_stock: 0,
          color_count: 0,
          commission_per_unit: 0,
          commission_percent: 0,
        });
      }
    }
  }, [visible, editingProduct, form]);

  const handleClose = () => {
    form.resetFields();
    setFilmFile(null);
    setMoldFile(null);
    setActiveTab('basic');
    onClose();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      if (filmFile) {
        const result = await productsApi.uploadFile(filmFile, 'film');
        values.film_file_url = result.url;
      }

      if (moldFile) {
        const result = await productsApi.uploadFile(moldFile, 'mold');
        values.mold_file_url = result.url;
      }

      if (!editingProduct) {
        values.is_active = form.getFieldValue('is_active') ?? true;
      }

      await saveMutation.mutateAsync(values);
    } catch (error) {
      console.error('Form validation failed:', error);
    }
  };

  return (
    <Drawer
      title={editingProduct?.id ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm mới'}
      open={visible}
      onClose={handleClose}
      width={Math.min(900, typeof window !== 'undefined' ? window.innerWidth * 0.9 : 900)}
      placement="right"
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Button onClick={handleClose} style={{ marginRight: 8 }}>
            Hủy
          </Button>
          <Button
            type="primary"
            loading={saveMutation.isPending}
            onClick={handleSubmit}
          >
            {editingProduct?.id ? 'Cập nhật' : 'Thêm mới'}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" style={{ padding: '0 8px' }}>
        <div style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'basic',
              label: '📦 Cơ bản',
              children: (
                <>
                  <Row gutter={16}>
              <Col span={24}>
                <Form.Item
                  label="Tên hàng"
                  name="name"
                  rules={[
                    { required: true, message: 'Vui lòng nhập tên hàng!' },
                  ]}
                >
                  <Input placeholder="VD: Thùng carton 50x40x30cm - 3 lớp" />
                </Form.Item>
              </Col>

              <Col span={12}>
                <Form.Item label="Danh mục" name="category">
                  <Select
                    placeholder="Chọn danh mục"
                    allowClear
                    showSearch
                    loading={!categoriesData}
                    optionFilterProp="label"
                    dropdownStyle={{ zIndex: 9999 }}
                  >
                    {categoriesData?.results?.map((cat) => (
                      <Select.Option key={cat.id} value={cat.id}>
                        {cat.name}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>

              <Col span={12}>
                <Form.Item
                  label="Đơn vị tính"
                  name="unit"
                  rules={[{ required: true, message: 'Vui lòng chọn đơn vị!' }]}
                >
                  <NativeSelectInput placeholder="Chọn đơn vị" parseNumber>
                    {unitsData?.results?.map((unit: any) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </NativeSelectInput>
                </Form.Item>
              </Col>
            </Row>

            <Divider orientation="left">Kích thước & Loại</Divider>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Kích thước ĐH" name="size_order">
                  <Input placeholder="VD: 50x40x30" />
                </Form.Item>
              </Col>

              <Col span={12}>
                <Form.Item label="KTSX" name="size_production">
                  <Input placeholder="Tự động = ĐH nếu để trống" />
                </Form.Item>
              </Col>

              <Col span={12}>
                <Form.Item label="Sóng" name="wave_type">
                  <NativeSelectInput placeholder="Chọn sóng">
                    {WAVE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </NativeSelectInput>
                </Form.Item>
              </Col>

              <Col span={12}>
                <Form.Item label="Kiểu" name="box_type">
                  <NativeSelectInput placeholder="Chọn kiểu">
                    {BOX_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </NativeSelectInput>
                </Form.Item>
              </Col>
            </Row>

            <Divider orientation="left">Giá & Số lượng</Divider>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item
                  label="Giá vốn (đ)"
                  name="cost_price"
                  rules={[
                    { required: true, message: 'Vui lòng nhập giá vốn!' },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    formatter={(value) =>
                      `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                    }
                  />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item
                  label="Đơn giá (đ)"
                  name="sale_price"
                  rules={[
                    { required: true, message: 'Vui lòng nhập đơn giá!' },
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    formatter={(value) =>
                      `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                    }
                  />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item label="Tồn TT" name="min_stock">
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
              </Col>
            </Row>

            <Divider orientation="left">Hoa hồng & Giao hàng</Divider>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item label="HHCĐ (đ/cái)" name="commission_per_unit">
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item label="HH%" name="commission_percent">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    max={100}
                  />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item label="+/-" name="delivery_tolerance">
                  <Input placeholder="VD: ±5% hoặc Dư 10 cái" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item label="Mô tả" name="description">
              <Input.TextArea rows={3} />
            </Form.Item>
                </>
              ),
            },
            {
              key: 'process',
              label: '⚙️ Công đoạn',
              children: (
                <>
                  <p
              style={{
                color: theme.colors.textSecondary,
                marginBottom: 16,
              }}
            >
              Nhập định mức (cái/giờ) cho các công đoạn. Để trống nếu không có
              công đoạn.
            </p>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item label="Xả (cái/giờ)" name="process_xa">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    placeholder="VD: 1000"
                  />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item label="In (cái/giờ)" name="process_in">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    placeholder="VD: 800"
                  />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item label="Bồi (cái/giờ)" name="process_boi">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    placeholder="VD: 1200"
                  />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item
                  label="Cán màng (cái/giờ)"
                  name="process_can_mang"
                >
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item label="Bế (cái/giờ)" name="process_be">
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item label="Chạp (cái/giờ)" name="process_chap">
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item label="Đóng (cái/giờ)" name="process_dong">
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item label="Dán (cái/giờ)" name="process_dan">
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
              </Col>

              <Col span={8}>
                <Form.Item label="Khác (cái/giờ)" name="process_khac">
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
              </Col>
            </Row>
                </>
              ),
            },
            {
              key: 'files',
              label: '📄 Files & In ấn',
              children: (
                <>
                  <Card size="small" title="Mã phim" style={{ marginBottom: 16 }}>
              <Form.Item label="Mã phim" name="film_code">
                <Input placeholder="VD: FILM-001" />
              </Form.Item>

              <Form.Item label="Link file phim (PDF)" name="film_file_url">
                <Input
                  prefix={<LinkOutlined />}
                  placeholder="https://..."
                  addonAfter={
                    <Upload
                      accept=".pdf"
                      beforeUpload={(file) => {
                        setFilmFile(file);
                        message.success(`Đã chọn file: ${file.name}`);
                        return false;
                      }}
                      showUploadList={false}
                    >
                      <Button icon={<UploadOutlined />}>Upload PDF</Button>
                    </Upload>
                  }
                />
              </Form.Item>
              {filmFile && (
                <p style={{ color: theme.colors.textSecondary }}>
                  📎 File đã chọn: {filmFile.name}
                </p>
              )}
            </Card>

            <Card size="small" title="Mã khuôn" style={{ marginBottom: 16 }}>
              <Form.Item label="Mã khuôn" name="mold_code">
                <Input placeholder="VD: MOLD-001" />
              </Form.Item>

              <Form.Item label="Link file khuôn (PDF)" name="mold_file_url">
                <Input
                  prefix={<LinkOutlined />}
                  placeholder="https://..."
                  addonAfter={
                    <Upload
                      accept=".pdf"
                      beforeUpload={(file) => {
                        setMoldFile(file);
                        message.success(`Đã chọn file: ${file.name}`);
                        return false;
                      }}
                      showUploadList={false}
                    >
                      <Button icon={<UploadOutlined />}>Upload PDF</Button>
                    </Upload>
                  }
                />
              </Form.Item>
              {moldFile && (
                <p style={{ color: theme.colors.textSecondary }}>
                  📎 File đã chọn: {moldFile.name}
                </p>
              )}
            </Card>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Số màu" name="color_count">
                  <InputNumber style={{ width: '100%' }} min={0} max={10} />
                </Form.Item>
              </Col>

              <Col span={12}>
                <Form.Item label="Chống thấm" name="waterproof">
                  <Select
                  dropdownStyle={{ zIndex: 9999 }}
                  options={WATERPROOF_OPTIONS}
                />
                </Form.Item>
              </Col>
            </Row>
                </>
              ),
            },
            {
              key: 'notes',
              label: '📝 Ghi chú',
              children: (
                <>
                  <Form.Item label="Ghi chú khác" name="note_other">
              <Input.TextArea
                rows={4}
                placeholder="Ghi chú về công đoạn đặc biệt..."
              />
            </Form.Item>

            <Form.Item label="Ghi chú" name="note">
              <Input.TextArea rows={4} placeholder="Ghi chú chung..." />
            </Form.Item>

            <Form.Item label="Trạng thái" name="status">
              <Select
                dropdownStyle={{ zIndex: 9999 }}
                options={[
                  { label: 'Nháp', value: 'DRAFT' },
                  { label: 'Đang bán', value: 'ACTIVE' },
                  { label: 'Ngừng SX', value: 'DISCONTINUED' },
                ]}
              />
            </Form.Item>
                </>
              ),
            },
          ]}
        />
        </div>
      </Form>
    </Drawer>
  );
};

export default ProductForm;
