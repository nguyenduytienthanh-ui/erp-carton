/**
 * Xóa dấu tiếng Việt và chuyển về chữ thường.
 * Ví dụ: "Tạo mới" → "tao moi", "Cập nhật" → "cap nhat"
 */
export function removeViDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

/**
 * Kiểm tra content có khớp với query không.
 *
 * - Tìm kiếm chính xác: bọc query trong dấu nháy kép  "..."
 *   Ví dụ: "tạo mới" → tìm chính xác chuỗi "tạo mới"
 *
 * - Tìm kiếm xáo nhánh (mặc định): bỏ dấu rồi so sánh
 *   Ví dụ: "tao moi" khớp với "Tạo mới"
 *   Ví dụ: "cap nhat" khớp với "Cập nhật"
 */
export function matchHistory(content: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;

  // Tìm kiếm chính xác khi bọc trong dấu nháy kép
  if (q.startsWith('"') && q.endsWith('"') && q.length > 2) {
    const exact = q.slice(1, -1).toLowerCase();
    return content.toLowerCase().includes(exact);
  }

  // Tìm xáo nhánh: bỏ dấu
  const normalizedContent = removeViDiacritics(content);
  const normalizedQ = removeViDiacritics(q);

  // Khớp khi có dấu (chính xác) HOẶC không dấu (xáo nhánh)
  return content.toLowerCase().includes(q.toLowerCase()) || normalizedContent.includes(normalizedQ);
}
