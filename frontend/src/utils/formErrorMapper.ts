/**
 * Shared: Map lỗi API -> field errors cho form.
 * Hỗ trợ: viền đỏ + message dưới field, auto focus/scroll đến field lỗi đầu tiên.
 */
import { parseApiError, type ApiErrorMap } from '../shared/apiError';

export type { ApiErrorMap };

/**
 * Parse lỗi API và trả về fieldErrors + generalMessage.
 * Form có thể dùng để setFormError(field, message) hoặc setFieldError.
 */
export function mapApiErrorsToFields(err: unknown): ApiErrorMap {
  return parseApiError(err);
}

/**
 * Scroll đến element đầu tiên có lỗi (data-error-field="code" | "name" | ...).
 * Gọi sau khi set field errors.
 */
export function scrollToFirstError(fieldKeys: string[]): void {
  for (const key of fieldKeys) {
    const el = document.querySelector(`[data-error-field="${key}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el as HTMLElement).focus?.();
      break;
    }
  }
}
