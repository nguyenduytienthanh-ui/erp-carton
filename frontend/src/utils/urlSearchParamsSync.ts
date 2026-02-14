/**
 * Chuẩn hóa URL params theo thứ tự key cố định để so sánh ổn định.
 * Dùng khi đồng bộ URL ↔ state (tìm kiếm, lọc) để tránh nhảy chữ / nhảy màn hình khi gõ nhanh:
 * - Khi ghi state ra URL, lưu chuỗi đã chuẩn hóa vào ref.
 * - Khi đọc URL vào state, chỉ áp dụng nếu chuỗi URL (chuẩn hóa) khác chuỗi đã ghi.
 * Các trang danh sách có lọc/tìm kiếm nên dùng chung logic này.
 */

/**
 * Tạo chuỗi query từ URLSearchParams theo đúng thứ tự keys (chỉ lấy keys có trong danh sách).
 */
export function normalizeSearchParamsToOrderedString(
  searchParams: URLSearchParams,
  orderedKeys: string[]
): string {
  const p = new URLSearchParams();
  for (const k of orderedKeys) {
    const v = searchParams.get(k);
    if (v != null) p.set(k, v);
  }
  return p.toString();
}

/**
 * Tạo chuỗi query từ object params theo đúng thứ tự keys (chỉ lấy keys có trong danh sách và có giá trị).
 */
export function normalizeParamsToOrderedString(
  params: Record<string, string>,
  orderedKeys: string[]
): string {
  const p = new URLSearchParams();
  for (const k of orderedKeys) {
    const v = params[k];
    if (v != null && v !== '') p.set(k, v);
  }
  return p.toString();
}
