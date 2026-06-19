export const CUSTOMER_PAYMENT_TERM_PRESETS = [0, 7, 15, 30, 45, 60] as const;

export const DEFAULT_CUSTOMER_VISIBLE_COLUMNS: string[] = [
  'code',
  'name',
  'tax_code',
  'contact_person',
  'phone',
  'payment_terms',
  'credit_limit',
  'is_active',
  'actions',
];

export const CUSTOMER_COLUMN_LABELS: Record<string, string> = {
  code: 'Mã KH',
  name: 'Tên KH',
  company_name: 'Tên pháp lý',
  tax_code: 'Mã số thuế',
  phone: 'Điện thoại',
  email: 'Email',
  address: 'Địa chỉ',
  contact_person: 'Người liên hệ',
  contact_phone: 'SĐT liên hệ',
  payment_terms: 'Hạn TT',
  credit_limit: 'Hạn mức',
  is_active: 'Trạng thái',
  status: 'Duyệt',
  owner_name: 'Owner',
  team_name: 'Team',
  created_at: 'Ngày tạo',
  updated_at: 'Ngày cập nhật',
  actions: 'Thao tác',
};

export const CUSTOMER_FORM_SECTION_CONFIG = {
  basic: 'Thông tin cơ bản',
  legal: 'Pháp lý',
  contact: 'Liên hệ',
  address: 'Địa chỉ',
  commercial: 'Điều khoản thương mại',
  assignment: 'Phân công',
  status: 'Trạng thái',
} as const;

export const CUSTOMER_MOBILE_CARD_FIELDS = [
  'tax_code',
  'contact',
  'payment_terms',
  'credit_limit',
] as const;
