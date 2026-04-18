/**
 * Form thêm/sửa khách hàng (Modal) - dùng chung FormErrorMapper, FormInputWithClear, FormTextAreaWithClear, useQuickEntryKeys.
 */
import { useState, useEffect, useRef } from 'react';
import { App, Modal, Button, Switch } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../api/customers';
import FormInputWithClear from '../../components/FormInputWithClear';
import FormTextAreaWithClear from '../../components/FormTextAreaWithClear';
import { useQuickEntryKeys } from '../../hooks/useQuickEntryKeys';
import type { Customer, CustomerFormData } from '../../types/customer';
import { mapApiErrorsToFields, scrollToFirstError } from '../../utils/formErrorMapper';

const defaultForm: CustomerFormData = {
  name: '',
  code: '',
  company_name: '',
  tax_code: '',
  phone: '',
  email: '',
  address: '',
  contact_person: '',
  contact_phone: '',
  payment_terms: 30,
  credit_limit: 0,
  is_active: true,
};

interface CustomerFormProps {
  visible: boolean;
  onClose: () => void;
  editingCustomer?: Customer | { id: number } | null;
  mode?: 'create' | 'edit' | 'view';
}

const CustomerForm = ({ visible, onClose, editingCustomer, mode = 'create' }: CustomerFormProps) => {
  const queryClient = useQueryClient();
  const isViewMode = mode === 'view';
  const isEditMode = mode === 'edit';
  const { data: customerDetail } = useQuery({
    queryKey: ['customer', (editingCustomer as Customer)?.id],
    queryFn: () => customersApi.getCustomer((editingCustomer as Customer).id),
    enabled: visible && !!(editingCustomer as Customer)?.id,
  });

  const [form, setForm] = useState<CustomerFormData>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { message } = App.useApp();
  const formContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    if (editingCustomer && customerDetail) {
      setForm({
        name: customerDetail.name ?? '',
        code: customerDetail.code ?? '',
        company_name: customerDetail.company_name ?? '',
        tax_code: customerDetail.tax_code ?? '',
        phone: customerDetail.phone ?? '',
        email: customerDetail.email ?? '',
        address: customerDetail.address ?? '',
        contact_person: customerDetail.contact_person ?? '',
        contact_phone: customerDetail.contact_phone ?? '',
        payment_terms: customerDetail.payment_terms ?? 30,
        credit_limit: customerDetail.credit_limit ?? 0,
        is_active: customerDetail.is_active ?? true,
        owner: customerDetail.owner ?? undefined,
        team: customerDetail.team ?? undefined,
      });
    } else if (editingCustomer && !customerDetail && (!('id' in editingCustomer) || !(editingCustomer as Customer).id)) {
      // Clone mode: editingCustomer có dữ liệu nhưng không fetch (không có id)
      const c = editingCustomer as Customer;
      setForm({
        name: c.name ?? '',
        code: '',
        company_name: c.company_name ?? '',
        tax_code: c.tax_code ?? '',
        phone: c.phone ?? '',
        email: c.email ?? '',
        address: c.address ?? '',
        contact_person: c.contact_person ?? '',
        contact_phone: c.contact_phone ?? '',
        payment_terms: c.payment_terms ?? 30,
        credit_limit: c.credit_limit ?? 0,
        is_active: c.is_active ?? true,
        owner: c.owner ?? undefined,
        team: c.team ?? undefined,
      });
    } else if (!editingCustomer) {
      setForm(defaultForm);
    }
    setFieldErrors({});
  }, [visible, editingCustomer, customerDetail]);

  const setField = <K extends keyof CustomerFormData>(key: K, value: CustomerFormData[K]) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (fieldErrors[key as string]) setFieldErrors((e) => ({ ...e, [key]: '' }));
  };

  const validate = (): string | null => {
    if (!(form.name ?? '').trim()) return 'Vui lòng nhập Tên khách hàng.';
    return null;
  };

  const handleSubmit = async () => {
    if (isViewMode) return;
    setFieldErrors({});
    const err = validate();
    if (err) {
      message.error(err);
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        name: (form.name ?? '').trim(),
        code: (form.code ?? '').trim() || undefined,
      };
      if (editingCustomer && 'id' in editingCustomer) {
        await customersApi.updateCustomer(editingCustomer.id, payload);
        message.success('Đã cập nhật khách hàng.');
      } else {
        await customersApi.createCustomer(payload);
        message.success('Đã thêm khách hàng.');
      }
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    } catch (e: unknown) {
      const { fieldErrors: fe, generalMessage } = mapApiErrorsToFields(e);
      setFieldErrors(fe);
      if (Object.keys(fe).length > 0) scrollToFirstError(Object.keys(fe));
      message.error(generalMessage || 'Có lỗi khi lưu.');
    } finally {
      setSubmitting(false);
    }
  };

  useQuickEntryKeys(formContainerRef, {
    onLastFieldEnter: () => void handleSubmit(),
    enabled: visible && !isViewMode,
  });

  const errorBorder = (key: string) => (fieldErrors[key] ? { borderColor: '#ff4d4f' } : undefined);
  const isDetailLikeMode = !!editingCustomer;

  return (
    <Modal
      title={isViewMode ? 'Chi tiết Khách hàng' : isEditMode ? 'Chỉnh sửa Khách hàng' : 'Thêm khách hàng'}
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>{isViewMode ? 'Đóng' : 'Huỷ'}</Button>,
        ...(!isViewMode ? [
        <Button key="submit" type="primary" loading={submitting} onClick={() => void handleSubmit()}>
            {isEditMode ? 'Cập nhật' : 'Thêm mới'}
        </Button>,
        ] : []),
      ]}
      width={560}
    >
      <div
        ref={formContainerRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: isDetailLikeMode ? 6 : 10,
          pointerEvents: isViewMode ? 'none' : 'auto',
          userSelect: isViewMode ? 'none' : 'auto',
        }}
      >
        <div data-quick-entry>
          <label style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>Mã khách hàng</label>
          <FormInputWithClear
            className="pf-input"
            value={form.code ?? ''}
            onChange={(e) => setField('code', e.target.value)}
            onClear={() => setField('code', '')}
            placeholder="Tự động nếu để trống"
            data-error-field="code"
            style={errorBorder('code')}
          />
          {fieldErrors.code && <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>{fieldErrors.code}</div>}
        </div>
        <div data-quick-entry>
          <label style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>Tên khách hàng <span style={{ color: '#ff4d4f' }}>*</span></label>
          <FormInputWithClear
            className="pf-input"
            value={form.name ?? ''}
            onChange={(e) => setField('name', e.target.value)}
            onClear={() => setField('name', '')}
            placeholder="Nhập tên"
            data-error-field="name"
            style={errorBorder('name')}
          />
          {fieldErrors.name && <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>{fieldErrors.name}</div>}
        </div>
        <div data-quick-entry>
          <label style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>Tên công ty</label>
          <FormInputWithClear
            className="pf-input"
            value={form.company_name ?? ''}
            onChange={(e) => setField('company_name', e.target.value)}
            onClear={() => setField('company_name', '')}
            placeholder="Tên công ty"
          />
        </div>
        <div data-quick-entry>
          <label style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>Mã số thuế</label>
          <FormInputWithClear
            className="pf-input"
            value={form.tax_code ?? ''}
            onChange={(e) => setField('tax_code', e.target.value)}
            onClear={() => setField('tax_code', '')}
            placeholder="MST"
          />
        </div>
        <div data-quick-entry>
          <label style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>Điện thoại</label>
          <FormInputWithClear
            className="pf-input"
            value={form.phone ?? ''}
            onChange={(e) => setField('phone', e.target.value)}
            onClear={() => setField('phone', '')}
            placeholder="Số điện thoại"
          />
        </div>
        <div data-quick-entry>
          <label style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>Email</label>
          <FormInputWithClear
            className="pf-input"
            type="email"
            value={form.email ?? ''}
            onChange={(e) => setField('email', e.target.value)}
            onClear={() => setField('email', '')}
            placeholder="Email"
          />
        </div>
        <div data-quick-entry>
          <label style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>Địa chỉ</label>
          <FormTextAreaWithClear
            className="pf-input pf-textarea"
            value={form.address ?? ''}
            onChange={(e) => setField('address', e.target.value)}
            onClear={() => setField('address', '')}
            placeholder="Địa chỉ"
            rows={2}
            style={{ minHeight: 56, ...errorBorder('address') }}
          />
        </div>
        <div data-quick-entry>
          <label style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>Người liên hệ</label>
          <FormInputWithClear
            className="pf-input"
            value={form.contact_person ?? ''}
            onChange={(e) => setField('contact_person', e.target.value)}
            onClear={() => setField('contact_person', '')}
            placeholder="Tên người liên hệ"
          />
        </div>
        <div data-quick-entry>
          <label style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>SĐT liên hệ</label>
          <FormInputWithClear
            className="pf-input"
            value={form.contact_phone ?? ''}
            onChange={(e) => setField('contact_phone', e.target.value)}
            onClear={() => setField('contact_phone', '')}
            placeholder="SĐT người liên hệ"
          />
        </div>
        <div data-quick-entry>
          <label style={{ display: 'block', marginBottom: 2, fontWeight: 500 }}>Hoạt động</label>
          <Switch
            checked={form.is_active}
            onChange={(v) => setField('is_active', v)}
            checkedChildren="Đang dùng"
            unCheckedChildren="Ngưng dùng"
          />
        </div>
      </div>
    </Modal>
  );
};

export default CustomerForm;
