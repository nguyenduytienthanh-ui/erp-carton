/**
 * Dùng chung cho TẤT CẢ màn hình có lịch sử hoạt động (ProductList, CustomerList, ...)
 */
import { matchHistory } from './textUtils';

// ──────────────────────────────────────────────
// Shared ActivityItem type
// ──────────────────────────────────────────────
export interface ActivityItem {
  type: 'audit' | 'comment';
  action: string;
  user: string | null;
  timestamp: string;
  details?: {
    old_values?: Record<string, unknown> | null;
    new_values?: Record<string, unknown> | null;
    changed_fields?: string[] | null;
    content?: string;
    mentions?: string[];
    entity_scope?: string;
    related_entity_id?: number | null;
    related_entity_code?: string | null;
    related_entity_name?: string | null;
  };
}

// ──────────────────────────────────────────────
// Action helpers — dùng chung, KHÔNG code riêng
// ──────────────────────────────────────────────
const ACTION_PRIORITY = ['SUBMIT', 'APPROVE', 'REJECT', 'CREATE', 'UPDATE', 'DELETE', 'IMPORT', 'EXPORT', 'COMMENT'];

export function getHistoryActionCode(action: string | null | undefined): string {
  const raw = String(action ?? '').trim().toUpperCase();
  for (const key of ACTION_PRIORITY) {
    if (raw.includes(key)) return key;
  }
  return raw || 'UNKNOWN';
}

const ACTION_LABEL_MAP: Record<string, string> = {
  SUBMIT: 'Trình duyệt',
  APPROVE: 'Duyệt',
  REJECT: 'Từ chối',
  CREATE: 'Tạo mới',
  UPDATE: 'Cập nhật',
  DELETE: 'Xóa',
  IMPORT: 'Nhập dữ liệu',
  EXPORT: 'Xuất dữ liệu',
  COMMENT: 'Bình luận',
};

export function getHistoryActionLabelVi(action: string | null | undefined): string {
  const code = getHistoryActionCode(action);
  return ACTION_LABEL_MAP[code] ?? String(action ?? 'Không xác định');
}

// ──────────────────────────────────────────────
// Search content builder — dùng chung
// ──────────────────────────────────────────────

/**
 * Build chuỗi nội dung tìm kiếm từ một activity item.
 * getFieldLabel: hàm chuyển field key → tên tiếng Việt (khác nhau theo module)
 */
export function buildHistorySearchContent(
  item: ActivityItem,
  getFieldLabel: (field: string) => string,
): string {
  const d = item.details ?? {};
  const oldVals = (d.old_values ?? {}) as Record<string, unknown>;
  const newVals = (d.new_values ?? {}) as Record<string, unknown>;

  // Chỉ lấy field keys từ old_values/new_values có dữ liệu thực tế.
  // KHÔNG dùng changed_fields khi old/new values rỗng — tránh false positive
  // với các record cũ chưa lưu giá trị Trước/Sau.
  const allFieldKeys = Array.from(new Set([...Object.keys(oldVals), ...Object.keys(newVals)]));

  return [
    getHistoryActionLabelVi(item.action),
    item.user ?? '',
    d.content ?? '',
    d.entity_scope ?? '',
    d.related_entity_code ?? '',
    d.related_entity_name ?? '',
    ...allFieldKeys.map((f) => getFieldLabel(f)),
    ...Object.values(oldVals).map(String),
    ...Object.values(newVals).map(String),
  ]
    .filter(Boolean)
    .join(' ');
}

// ──────────────────────────────────────────────
// Filter function — dùng chung
// ──────────────────────────────────────────────

/**
 * Lọc danh sách lịch sử theo query và action filter.
 * - Tìm xáo nhánh (bỏ dấu): "don gia" → "Đơn giá"
 * - Tìm chính xác: "Đơn giá" (có dấu)
 * - Tìm chính xác tuyệt đối: bọc trong dấu nháy kép "..."
 */
export function filterHistoryItems(
  items: ActivityItem[],
  query: string,
  actionFilter: string | undefined,
  getFieldLabel: (field: string) => string,
): ActivityItem[] {
  const q = query.trim();
  return items.filter((item) => {
    if (actionFilter && getHistoryActionCode(item.action) !== actionFilter) return false;
    if (!q) return true;
    return matchHistory(buildHistorySearchContent(item, getFieldLabel), q);
  });
}
