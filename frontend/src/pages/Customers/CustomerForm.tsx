/**
 * Form thêm/sửa khách hàng (Modal) - dùng chung FormErrorMapper, FormInputWithClear, FormTextAreaWithClear, useQuickEntryKeys.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Alert, App, Button, InputNumber, Modal, Segmented, Switch } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../api/customers';
import FormInputWithClear from '../../components/FormInputWithClear';
import FormTextAreaWithClear from '../../components/FormTextAreaWithClear';
import { useQuickEntryKeys } from '../../hooks/useQuickEntryKeys';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import type { Customer, CustomerFormData } from '../../types/customer';
import { CUSTOMER_PAYMENT_TERM_PRESETS } from './customerConfig';
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

const normalizeText = (value: unknown) => String(value ?? '').trim();

const normalizePhoneForCompare = (value: unknown) =>
  normalizeText(value).replace(/\s+/g, '').toLowerCase();

const normalizeTextForCompare = (value: unknown) =>
  normalizeText(value).replace(/\s+/g, ' ').toLowerCase();

const toNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const modalSectionStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
  background: '#fff',
};

const sectionTitleStyle: CSSProperties = {
  margin: '0 0 10px',
  fontSize: 14,
  fontWeight: 700,
  color: '#1f2937',
};

const fieldGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontWeight: 600,
  fontSize: 13,
};

const helperStyle: CSSProperties = {
  marginTop: 4,
  color: '#6b7280',
  fontSize: 12,
  lineHeight: 1.4,
};

function FieldBlock(props: {
  label: string;
  required?: boolean;
  error?: string;
  helper?: ReactNode;
  children: ReactNode;
}) {
  const { label, required, error, helper, children } = props;
  return (
    <div data-quick-entry>
      <label style={labelStyle}>
        {label} {required && <span style={{ color: '#ff4d4f' }}>*</span>}
      </label>
      {children}
      {helper && <div style={helperStyle}>{helper}</div>}
      {error && <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

const CustomerForm = ({ visible, onClose, editingCustomer, mode = 'create' }: CustomerFormProps) => {
  const queryClient = useQueryClient();
  const isViewMode = mode === 'view';
  const isEditMode = mode === 'edit';
  const editingCustomerId = editingCustomer && 'id' in editingCustomer ? editingCustomer.id : undefined;
  const { data: customerDetail } = useQuery({
    queryKey: ['customer', editingCustomerId],
    queryFn: () => customersApi.getCustomer(editingCustomerId!),
    enabled: visible && !!editingCustomerId,
  });

  const [form, setForm] = useState<CustomerFormData>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { message } = App.useApp();
  const formContainerRef = useRef<HTMLDivElement>(null);

  const [debouncedName] = useDebouncedValue(form.name ?? '', 450);
  const [debouncedPhone] = useDebouncedValue(form.phone ?? '', 450);

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
        credit_limit: toNumber(customerDetail.credit_limit, 0),
        is_active: customerDetail.is_active ?? true,
        owner: customerDetail.owner ?? undefined,
        team: customerDetail.team ?? undefined,
      });
    } else if (editingCustomer && !customerDetail && (!('id' in editingCustomer) || !(editingCustomer as Customer).id)) {
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
        credit_limit: toNumber(c.credit_limit, 0),
        is_active: c.is_active ?? true,
        owner: c.owner ?? undefined,
        team: c.team ?? undefined,
      });
    } else if (!editingCustomer) {
      setForm(defaultForm);
    }
    setFieldErrors({});
  }, [visible, editingCustomer, customerDetail]);

  const duplicateNameQuery = useQuery({
    queryKey: ['customers', 'duplicate-name-warning', debouncedName, editingCustomerId ?? null],
    queryFn: () => customersApi.getCustomers({ name: debouncedName.trim(), page_size: 10 }),
    enabled: visible && !isViewMode && debouncedName.trim().length >= 3,
  });

  const duplicatePhoneQuery = useQuery({
    queryKey: ['customers', 'duplicate-phone-warning', debouncedPhone, editingCustomerId ?? null],
    queryFn: () => customersApi.getCustomers({ phone: debouncedPhone.trim(), page_size: 10 }),
    enabled: visible && !isViewMode && debouncedPhone.trim().length >= 5,
  });

  const duplicateName = useMemo(() => {
    const target = normalizeTextForCompare(debouncedName);
    if (!target) return null;
    return (duplicateNameQuery.data?.results ?? []).find(
      (item) => item.id !== editingCustomerId && normalizeTextForCompare(item.name) === target,
    ) ?? null;
  }, [debouncedName, duplicateNameQuery.data?.results, editingCustomerId]);

  const duplicatePhone = useMemo(() => {
    const target = normalizePhoneForCompare(debouncedPhone);
    if (!target) return null;
    return (duplicatePhoneQuery.data?.results ?? []).find(
      (item) => item.id !== editingCustomerId && normalizePhoneForCompare(item.phone) === target,
    ) ?? null;
  }, [debouncedPhone, duplicatePhoneQuery.data?.results, editingCustomerId]);

  const duplicateWarnings = [
    duplicateName ? `Tên khách hàng giống ${duplicateName.code || duplicateName.name}.` : '',
    duplicatePhone ? `Điện thoại giống ${duplicatePhone.code || duplicatePhone.name}.` : '',
  ].filter(Boolean);

  const setField = <K extends keyof CustomerFormData>(key: K, value: CustomerFormData[K]) => {
    setForm((p) => ({ ...p, [key]: value }));
    if (fieldErrors[key as string]) setFieldErrors((e) => ({ ...e, [key]: '' }));
  };

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    const name = normalizeText(form.name);
    const code = normalizeText(form.code);
    const email = normalizeText(form.email);
    const paymentTerms = toNumber(form.payment_terms, -1);
    const creditLimit = toNumber(form.credit_limit, -1);

    if (!name) errors.name = 'Vui lòng nhập tên khách hàng.';
    if (isEditMode && !code) errors.code = 'Mã khách hàng không được để trống khi chỉnh sửa.';
    if (email && !isValidEmail(email)) errors.email = 'Email không hợp lệ.';
    if (!Number.isInteger(paymentTerms) || paymentTerms < 0) errors.payment_terms = 'Số ngày thanh toán phải là số nguyên không âm.';
    if (creditLimit < 0) errors.credit_limit = 'Hạn mức công nợ không được âm.';
    return errors;
  };

  const handleSubmit = async () => {
    if (isViewMode) return;
    setFieldErrors({});
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      scrollToFirstError(Object.keys(errors));
      message.error(Object.values(errors)[0]);
      return;
    }
    setSubmitting(true);
    try {
      const code = normalizeText(form.code);
      const payload: CustomerFormData = {
        name: normalizeText(form.name),
        code: code || undefined,
        company_name: normalizeText(form.company_name),
        tax_code: normalizeText(form.tax_code),
        phone: normalizeText(form.phone),
        email: normalizeText(form.email),
        address: normalizeText(form.address),
        contact_person: normalizeText(form.contact_person),
        contact_phone: normalizeText(form.contact_phone),
        payment_terms: Math.max(0, Math.trunc(toNumber(form.payment_terms, 30))),
        credit_limit: Math.max(0, toNumber(form.credit_limit, 0)),
        is_active: Boolean(form.is_active),
      };
      if (editingCustomerId) {
        await customersApi.updateCustomer(editingCustomerId, payload);
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
  const selectedPreset = CUSTOMER_PAYMENT_TERM_PRESETS.some((days) => days === Number(form.payment_terms))
    ? Number(form.payment_terms)
    : undefined;
  const hasAssignmentInfo = Boolean(customerDetail?.owner_name || customerDetail?.team_name);

  return (
    <Modal
      title={isViewMode ? 'Chi tiết khách hàng' : isEditMode ? 'Chỉnh sửa khách hàng' : 'Thêm khách hàng'}
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
      width={760}
    >
      <div
        ref={formContainerRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          maxHeight: '72vh',
          overflowY: 'auto',
          paddingRight: 4,
          pointerEvents: isViewMode ? 'none' : 'auto',
          userSelect: isViewMode ? 'none' : 'auto',
        }}
      >
        {Object.keys(fieldErrors).length > 0 && (
          <Alert type="error" showIcon message="Vui lòng kiểm tra lại các trường đang báo lỗi." />
        )}
        {duplicateWarnings.length > 0 && (
          <Alert type="warning" showIcon message={duplicateWarnings.join(' ')} />
        )}

        <section style={modalSectionStyle}>
          <h3 style={sectionTitleStyle}>Thông tin cơ bản</h3>
          <div style={fieldGridStyle}>
            <FieldBlock
              label="Mã khách hàng"
              error={fieldErrors.code}
              helper="Có thể để trống để hệ thống tự sinh hoặc nhập mã theo quy tắc công ty."
            >
              <FormInputWithClear
                className="pf-input"
                value={form.code ?? ''}
                onChange={(e) => setField('code', e.target.value)}
                onClear={() => setField('code', '')}
                placeholder="Tự động nếu để trống"
                data-error-field="code"
                disabled={isViewMode}
                style={errorBorder('code')}
              />
            </FieldBlock>
            <FieldBlock label="Tên khách hàng" required error={fieldErrors.name}>
              <FormInputWithClear
                className="pf-input"
                value={form.name ?? ''}
                onChange={(e) => setField('name', e.target.value)}
                onClear={() => setField('name', '')}
                placeholder="Nhập tên khách hàng"
                data-error-field="name"
                disabled={isViewMode}
                style={errorBorder('name')}
              />
            </FieldBlock>
            <FieldBlock label="Tên pháp lý / công ty" error={fieldErrors.company_name}>
              <FormInputWithClear
                className="pf-input"
                value={form.company_name ?? ''}
                onChange={(e) => setField('company_name', e.target.value)}
                onClear={() => setField('company_name', '')}
                placeholder="Tên công ty trên chứng từ"
                data-error-field="company_name"
                disabled={isViewMode}
                style={errorBorder('company_name')}
              />
            </FieldBlock>
          </div>
        </section>

        <section style={modalSectionStyle}>
          <h3 style={sectionTitleStyle}>Thông tin pháp lý</h3>
          <div style={fieldGridStyle}>
            <FieldBlock label="Mã số thuế" error={fieldErrors.tax_code} helper="Không bắt buộc; nếu nhập thì mã số thuế không được trùng.">
              <FormInputWithClear
                className="pf-input"
                value={form.tax_code ?? ''}
                onChange={(e) => setField('tax_code', e.target.value)}
                onClear={() => setField('tax_code', '')}
                placeholder="Mã số thuế"
                data-error-field="tax_code"
                disabled={isViewMode}
                style={errorBorder('tax_code')}
              />
            </FieldBlock>
          </div>
        </section>

        <section style={modalSectionStyle}>
          <h3 style={sectionTitleStyle}>Liên hệ chính</h3>
          <div style={fieldGridStyle}>
            <FieldBlock label="Người liên hệ" error={fieldErrors.contact_person}>
              <FormInputWithClear
                className="pf-input"
                value={form.contact_person ?? ''}
                onChange={(e) => setField('contact_person', e.target.value)}
                onClear={() => setField('contact_person', '')}
                placeholder="Tên người liên hệ"
                data-error-field="contact_person"
                disabled={isViewMode}
                style={errorBorder('contact_person')}
              />
            </FieldBlock>
            <FieldBlock label="Điện thoại" error={fieldErrors.phone}>
              <FormInputWithClear
                className="pf-input"
                value={form.phone ?? ''}
                onChange={(e) => setField('phone', e.target.value)}
                onClear={() => setField('phone', '')}
                placeholder="Số điện thoại"
                data-error-field="phone"
                disabled={isViewMode}
                style={errorBorder('phone')}
              />
            </FieldBlock>
            <FieldBlock label="SĐT người liên hệ" error={fieldErrors.contact_phone}>
              <FormInputWithClear
                className="pf-input"
                value={form.contact_phone ?? ''}
                onChange={(e) => setField('contact_phone', e.target.value)}
                onClear={() => setField('contact_phone', '')}
                placeholder="Số điện thoại liên hệ"
                data-error-field="contact_phone"
                disabled={isViewMode}
                style={errorBorder('contact_phone')}
              />
            </FieldBlock>
            <FieldBlock label="Email" error={fieldErrors.email}>
              <FormInputWithClear
                className="pf-input"
                type="email"
                value={form.email ?? ''}
                onChange={(e) => setField('email', e.target.value)}
                onClear={() => setField('email', '')}
                placeholder="email@congty.vn"
                data-error-field="email"
                disabled={isViewMode}
                style={errorBorder('email')}
              />
            </FieldBlock>
          </div>
        </section>

        <section style={modalSectionStyle}>
          <h3 style={sectionTitleStyle}>Địa chỉ</h3>
          <FieldBlock label="Địa chỉ chính" error={fieldErrors.address}>
            <FormTextAreaWithClear
              className="pf-input pf-textarea"
              value={form.address ?? ''}
              onChange={(e) => setField('address', e.target.value)}
              onClear={() => setField('address', '')}
              placeholder="Địa chỉ giao dịch chính"
              rows={2}
              data-error-field="address"
              disabled={isViewMode}
              style={{ minHeight: 64, ...errorBorder('address') }}
            />
          </FieldBlock>
        </section>

        <section style={modalSectionStyle}>
          <h3 style={sectionTitleStyle}>Điều khoản thương mại</h3>
          <div style={fieldGridStyle}>
            <FieldBlock label="Số ngày thanh toán" error={fieldErrors.payment_terms} helper="Chọn nhanh bằng preset hoặc nhập số ngày tùy chỉnh.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Segmented
                  value={selectedPreset}
                  onChange={(value) => setField('payment_terms', Number(value))}
                  options={CUSTOMER_PAYMENT_TERM_PRESETS.map((days) => ({ label: `${days} ngày`, value: days }))}
                  disabled={isViewMode}
                />
                <InputNumber
                  aria-label="Số ngày thanh toán"
                  min={0}
                  precision={0}
                  value={form.payment_terms}
                  onChange={(value) => setField('payment_terms', value ?? 0)}
                  style={{ width: '100%', ...errorBorder('payment_terms') }}
                  data-error-field="payment_terms"
                  disabled={isViewMode}
                />
              </div>
            </FieldBlock>
            <FieldBlock
              label="Hạn mức công nợ"
              error={fieldErrors.credit_limit}
              helper="Hạn mức tham chiếu/cảnh báo v1; chưa tự chặn báo giá hoặc đơn bán hàng."
            >
              <InputNumber
                aria-label="Hạn mức công nợ"
                min={0}
                precision={0}
                value={form.credit_limit}
                onChange={(value) => setField('credit_limit', value ?? 0)}
                formatter={(value) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                parser={(value) => Number(String(value ?? '').replace(/\./g, ''))}
                style={{ width: '100%', ...errorBorder('credit_limit') }}
                data-error-field="credit_limit"
                disabled={isViewMode}
              />
            </FieldBlock>
          </div>
        </section>

        {hasAssignmentInfo && (
          <section style={modalSectionStyle}>
            <h3 style={sectionTitleStyle}>Phân công</h3>
            <div style={fieldGridStyle}>
              <FieldBlock label="Owner">
                <div style={helperStyle}>{customerDetail?.owner_name || '-'}</div>
              </FieldBlock>
              <FieldBlock label="Team">
                <div style={helperStyle}>{customerDetail?.team_name || '-'}</div>
              </FieldBlock>
            </div>
          </section>
        )}

        <section style={modalSectionStyle}>
          <h3 style={sectionTitleStyle}>Trạng thái</h3>
          <FieldBlock label="Đang sử dụng" error={fieldErrors.is_active}>
            <Switch
              checked={form.is_active}
              onChange={(v) => setField('is_active', v)}
              checkedChildren="Đang dùng"
              unCheckedChildren="Ngưng dùng"
              disabled={isViewMode}
            />
          </FieldBlock>
        </section>
      </div>
    </Modal>
  );
};

export default CustomerForm;
