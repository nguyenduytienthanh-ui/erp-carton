/**
 * Shared: Chuẩn hoá parse lỗi API để hiển thị toast/field errors.
 * Hỗ trợ format: { "code": ["..."] }, { "detail": "..." }, { "errors": { "code": ["..."] } }
 */

export interface ApiErrorMap {
  fieldErrors: Record<string, string>;
  generalMessage: string;
}

const UNIQUE_CODE_PATTERNS = [
  /already exists/i,
  /mã hàng.*đã tồn tại/i,
  /mã khách hàng.*đã tồn tại/i,
  /đã tồn tại/i,
];

/** Kiểm tra lỗi có phải lỗi trùng mã không */
export function isUniqueCodeError(message: string): boolean {
  return UNIQUE_CODE_PATTERNS.some((p) => p.test(message));
}

/** Message chuẩn cho lỗi trùng mã (Product/Customer) */
export const UNIQUE_CODE_MESSAGE = 'Mã đã tồn tại, hãy đổi lại.';

/** Parse lỗi từ response API (axios error.response.data) */
export function parseApiError(err: unknown): ApiErrorMap {
  const result: ApiErrorMap = { fieldErrors: {}, generalMessage: '' };

  if (!err || typeof err !== 'object' || !('response' in err)) {
    result.generalMessage = err instanceof Error ? err.message : 'Có lỗi xảy ra.';
    return result;
  }

  const data = (err as { response?: { data?: unknown } }).response?.data;
  if (!data || typeof data !== 'object') {
    result.generalMessage = err instanceof Error ? err.message : 'Có lỗi xảy ra.';
    return result;
  }

  const d = data as Record<string, unknown>;
  const fieldOrder = ['code', 'unit', 'wave', 'box_type', 'sale_price', 'cost_price', 'name'];

  for (const key of fieldOrder) {
    const v = d[key];
    if (v && Array.isArray(v) && v.length > 0) {
      const first = v[0];
      const msg = typeof first === 'string' ? first : String(first);
      result.fieldErrors[key] = isUniqueCodeError(msg) ? UNIQUE_CODE_MESSAGE : msg;
    }
  }

  if (Object.keys(result.fieldErrors).length > 0) {
    result.generalMessage = Object.values(result.fieldErrors)[0] ?? '';
  }
  if (!result.generalMessage && typeof d.detail === 'string') result.generalMessage = d.detail;
  if (!result.generalMessage && typeof d.message === 'string') result.generalMessage = d.message;
  if (!result.generalMessage && Object.keys(d).length > 0) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(d)) {
      if (Array.isArray(v) && v.length > 0) parts.push((v[0] as string) || `${k}: ${v.join(', ')}`);
      else if (typeof v === 'string') parts.push(`${k}: ${v}`);
    }
    result.generalMessage = parts.length > 0 ? parts.join('; ') : 'Có lỗi xảy ra.';
  }

  return result;
}

/** Lấy message tổng hợp để hiển thị toast từ lỗi API */
export function getToastMessage(err: unknown): string {
  const { generalMessage } = parseApiError(err);
  return generalMessage || 'Có lỗi xảy ra.';
}
