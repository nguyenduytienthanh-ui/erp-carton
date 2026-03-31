import type { AttachmentItem } from '../api/attachments';
import type { CommentItem } from '../api/comments';
import { TASK_PRIORITY_LABELS, type TaskItem, type TaskPriority } from '../api/tasks';

export type AiSourceKind = 'MEETING' | 'MESSAGE' | 'EMAIL' | 'IMAGE' | 'ADHOC';
export type AiSignalSeverity = 'critical' | 'warning' | 'info' | 'success';
export type WorkspaceRecordKind = 'DECISION' | 'STAKEHOLDER' | 'HANDOVER';

export interface AiStructuredSource {
  kind: AiSourceKind;
  label: string;
  content: string;
  commentId: number;
  createdAt: string;
  createdByName: string;
}

export interface WorkspaceStructuredRecord {
  kind: WorkspaceRecordKind;
  kindLabel: string;
  title: string;
  details: string;
  commentId: number;
  createdAt: string;
  createdByName: string;
}

export interface AiSignal {
  key: string;
  severity: AiSignalSeverity;
  title: string;
  detail: string;
}

export interface AiSuggestedTask {
  key: string;
  title: string;
  description: string;
  priority: TaskPriority;
  reason: string;
  sourceKinds: AiSourceKind[];
}

export interface AiExecutionBrief {
  headline: string;
  summary: string[];
  sourceCounts: Record<AiSourceKind, number>;
  imageAttachmentCount: number;
  documentAttachmentCount: number;
  signals: AiSignal[];
  suggestedTasks: AiSuggestedTask[];
}

export interface ExecutionReadiness {
  score: number;
  label: string;
  tone: 'success' | 'warning' | 'error' | 'processing';
  description: string;
}

export interface ExecutionDigestPack {
  operations: string;
  handover: string;
  executive: string;
}

export interface ExecutionChecklistItem {
  key: string;
  label: string;
  done: boolean;
  detail: string;
}

export interface ExecutionTimelineEntry {
  key: string;
  kind: 'SOURCE' | 'RECORD' | 'ATTACHMENT';
  label: string;
  title: string;
  detail: string;
  createdAt: string;
  actor: string;
}

export interface EntityExecutionPlaybook {
  title: string;
  subtitle: string;
  focusAreas: string[];
  prompts: string[];
}

const SOURCE_PREFIXES: Record<AiSourceKind, string> = {
  MEETING: '[MEETING]',
  MESSAGE: '[MESSAGE]',
  EMAIL: '[EMAIL]',
  IMAGE: '[IMAGE]',
  ADHOC: '[ADHOC]',
};

const SOURCE_LABELS: Record<AiSourceKind, string> = {
  MEETING: 'Biên bản họp',
  MESSAGE: 'Tin nhắn',
  EMAIL: 'Email',
  IMAGE: 'Ghi chú hình ảnh',
  ADHOC: 'Công việc ngoài luồng',
};

const RECORD_PREFIX = '[OPS_RECORD]';

const RECORD_LABELS: Record<WorkspaceRecordKind, string> = {
  DECISION: 'Quyết định',
  STAKEHOLDER: 'Stakeholder',
  HANDOVER: 'Bàn giao',
};

const ACTION_KEYWORDS = [
  'xu ly', 'thao go', 'chot', 'xac nhan', 'kiem tra', 'cap nhat',
  'theo doi', 'trien khai', 'phoi hop', 'doi soat', 'giai quyet',
  'phan hoi', 'gui', 'review', 'approve', 'duyet', 'fix',
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function normalizeTaskKey(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function truncate(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function cleanupSourceLine(line: string): string {
  return line
    .replace(/^(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[;:.,]+$/, '');
}

function isActionLike(line: string): boolean {
  const normalized = normalizeText(line);
  return ACTION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function inferPriority(text: string, kind: AiSourceKind, tasks: TaskItem[]): TaskPriority {
  const normalized = normalizeText(text);
  if (/(gap|khan|urgent|asap|ngay hom nay|truc tiep|critical)/.test(normalized)) return 'URGENT';
  if (/(khach|customer|complain|tre|delay|loi|qc|approval|duyet|block|cham)/.test(normalized)) return 'HIGH';
  if (kind === 'EMAIL' || kind === 'MEETING') return 'HIGH';
  if (tasks.some((task) => task.is_blocking || task.needs_help)) return 'HIGH';
  return 'MEDIUM';
}

function getTaskPriorityLabel(priority: TaskPriority): string {
  return TASK_PRIORITY_LABELS[priority];
}

function buildFallbackSuggestions(params: {
  entityCode?: string;
  tasks: TaskItem[];
  sourceCounts: Record<AiSourceKind, number>;
  imageAttachmentCount: number;
}): AiSuggestedTask[] {
  const { entityCode, tasks, sourceCounts, imageAttachmentCount } = params;
  const openTasks = tasks.filter((task) => task.status === 'TODO' || task.status === 'IN_PROGRESS');
  const blockingCount = openTasks.filter((task) => task.is_blocking).length;
  const dueDateCount = openTasks.filter((task) => Boolean(task.due_date)).length;
  const suggestions: AiSuggestedTask[] = [];

  if (blockingCount > 0) {
    suggestions.push({
      key: 'fallback-blocking',
      title: 'Tháo gỡ đầu việc đang chặn tiến độ',
      description: `Tập trung xử lý ${blockingCount} nhiệm vụ blocking trước khi triển khai bước mới cho ${entityCode || 'đối tượng này'}.`,
      priority: 'URGENT',
      reason: 'Workspace đang có nhiệm vụ chặn luồng.',
      sourceKinds: [],
    });
  }

  if (sourceCounts.MEETING > 0) {
    suggestions.push({
      key: 'fallback-meeting',
      title: 'Chuyển kết luận họp thành checklist triển khai',
      description: 'Rà soát các kết luận họp, gán owner và hạn xử lý rõ ràng để không bị thất lạc đầu việc.',
      priority: 'HIGH',
      reason: 'Đã có dữ liệu họp nhưng chưa thấy đủ đầu việc triển khai tương ứng.',
      sourceKinds: ['MEETING'],
    });
  }

  if (sourceCounts.EMAIL > 0) {
    suggestions.push({
      key: 'fallback-email',
      title: 'Phản hồi email còn chờ quyết định',
      description: 'Tổng hợp email tồn đọng, chốt câu trả lời và cập nhật lại cho các bên liên quan.',
      priority: 'HIGH',
      reason: 'Nguồn email đang tạo áp lực điều phối.',
      sourceKinds: ['EMAIL'],
    });
  }

  if (sourceCounts.MESSAGE > 0) {
    suggestions.push({
      key: 'fallback-message',
      title: 'Chuẩn hóa tin nhắn thành đầu việc có người phụ trách',
      description: 'Biến các tin nhắn rời rạc thành checklist xử lý có owner, priority và trạng thái rõ ràng.',
      priority: 'MEDIUM',
      reason: 'Tin nhắn thường dễ bị bỏ sót nếu không chuyển thành task.',
      sourceKinds: ['MESSAGE'],
    });
  }

  if (sourceCounts.IMAGE > 0 || imageAttachmentCount > 0) {
    suggestions.push({
      key: 'fallback-image',
      title: 'Rà soát hình ảnh hiện trường và xác nhận lỗi',
      description: 'Kiểm tra ảnh đính kèm hoặc mô tả ảnh để xác nhận mức độ ảnh hưởng và bước xử lý tiếp theo.',
      priority: 'HIGH',
      reason: 'Đã có tín hiệu từ hình ảnh cần được đối chiếu lại với hiện trạng.',
      sourceKinds: sourceCounts.IMAGE > 0 ? ['IMAGE'] : [],
    });
  }

  if (sourceCounts.ADHOC > 0) {
    suggestions.push({
      key: 'fallback-adhoc',
      title: 'Kích hoạt checklist xử lý việc ngoài luồng',
      description: 'Chốt người phụ trách, mức độ ảnh hưởng, thông báo liên quan và mốc cập nhật tiếp theo cho việc phát sinh trong ngày.',
      priority: 'HIGH',
      reason: 'Workspace đã nhận nguồn việc ngoài luồng cần điều phối nhanh.',
      sourceKinds: ['ADHOC'],
    });
    suggestions.push({
      key: 'fallback-adhoc-comm',
      title: 'Thông báo các bên liên quan về việc phát sinh',
      description: 'Tạo một task điều phối để cập nhật thông tin, tránh sót việc khi sự cố hay yêu cầu đột xuất xảy ra.',
      priority: 'HIGH',
      reason: 'Công việc ngoài luồng thường cần thông báo nhanh và khóa đầu mối rõ ràng.',
      sourceKinds: ['ADHOC'],
    });
  }

  if (!suggestions.length) {
    suggestions.push({
      key: 'fallback-general',
      title: `Tạo checklist triển khai cho ${entityCode || 'workspace hiện tại'}`,
      description: 'Tổng hợp lại các đầu việc mở, người phụ trách và mốc thời gian để điều phối thuận tiện hơn.',
      priority: 'MEDIUM',
      reason: 'Chưa có đủ tín hiệu cụ thể nên AI đề xuất một checklist điều hành cơ bản.',
      sourceKinds: [],
    });
  }

  if (dueDateCount > 0) {
    suggestions.push({
      key: 'fallback-overdue',
      title: 'Cập nhật timeline cho các việc có rủi ro trễ hạn',
      description: `Workspace đang có ${dueDateCount} nhiệm vụ mở đã được gán hạn xử lý nên cần rà soát lại thứ tự ưu tiên.`,
      priority: 'HIGH',
      reason: 'Có nguy cơ dồn việc hoặc lệch timeline triển khai.',
      sourceKinds: [],
    });
  }

  return suggestions;
}

export function getWorkspaceRecordLabel(kind: WorkspaceRecordKind): string {
  return RECORD_LABELS[kind];
}

export function formatStructuredSourceComment(kind: AiSourceKind, content: string): string {
  return `${SOURCE_PREFIXES[kind]}\n${content.trim()}`;
}

export function formatWorkspaceRecordComment(
  kind: WorkspaceRecordKind,
  title: string,
  details: string,
): string {
  return `${RECORD_PREFIX}\n${JSON.stringify({
    kind,
    title: title.trim(),
    details: details.trim(),
  })}`;
}

export function parseStructuredSourceComment(comment: CommentItem): AiStructuredSource | null {
  const content = comment.content.trim();
  const matchedKind = (Object.keys(SOURCE_PREFIXES) as AiSourceKind[]).find(
    (kind) => content.startsWith(SOURCE_PREFIXES[kind]),
  );
  if (!matchedKind) return null;
  const stripped = content.slice(SOURCE_PREFIXES[matchedKind].length).trim();
  if (!stripped) return null;
  return {
    kind: matchedKind,
    label: SOURCE_LABELS[matchedKind],
    content: stripped,
    commentId: comment.id,
    createdAt: comment.created_at,
    createdByName: comment.created_by_name || comment.created_by_username,
  };
}

export function parseWorkspaceRecordComment(comment: CommentItem): WorkspaceStructuredRecord | null {
  const content = comment.content.trim();
  if (!content.startsWith(RECORD_PREFIX)) return null;
  const jsonPart = content.slice(RECORD_PREFIX.length).trim();
  try {
    const parsed = JSON.parse(jsonPart) as { kind?: string; title?: string; details?: string };
    const kind = parsed.kind as WorkspaceRecordKind;
    if (!RECORD_LABELS[kind]) return null;
    return {
      kind,
      kindLabel: RECORD_LABELS[kind],
      title: String(parsed.title ?? '').trim(),
      details: String(parsed.details ?? '').trim(),
      commentId: comment.id,
      createdAt: comment.created_at,
      createdByName: comment.created_by_name || comment.created_by_username,
    };
  } catch {
    return null;
  }
}

export function buildAiExecutionBrief(params: {
  entityType: string;
  entityCode?: string;
  comments: CommentItem[];
  attachments: AttachmentItem[];
  tasks: TaskItem[];
}): AiExecutionBrief {
  const { entityType, entityCode, comments, attachments, tasks } = params;
  const sources = comments
    .map((comment) => parseStructuredSourceComment(comment))
    .filter((item): item is AiStructuredSource => Boolean(item));
  const records = comments
    .map((comment) => parseWorkspaceRecordComment(comment))
    .filter((item): item is WorkspaceStructuredRecord => Boolean(item));

  const sourceCounts: Record<AiSourceKind, number> = {
    MEETING: 0, MESSAGE: 0, EMAIL: 0, IMAGE: 0, ADHOC: 0,
  };
  sources.forEach((src) => { sourceCounts[src.kind] += 1; });

  const imageAttachmentCount = attachments.filter(
    (att) => /\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i.test(att.filename)
      || att.file_type?.startsWith('image/'),
  ).length;
  const documentAttachmentCount = attachments.length - imageAttachmentCount;

  const openTasks = tasks.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  const blockingCount = openTasks.filter((t) => t.is_blocking).length;
  const helpCount = openTasks.filter((t) => t.needs_help).length;
  const overdueCount = openTasks.filter(
    (t) => t.due_date && t.due_date < new Date().toISOString().slice(0, 10),
  ).length;

  const signals: AiSignal[] = [];
  if (blockingCount > 0) {
    signals.push({
      key: 'blocking',
      severity: 'critical',
      title: `${blockingCount} nhiệm vụ đang blocking`,
      detail: 'Cần tháo gỡ blocker trước khi đẩy tiến độ cho giai đoạn tiếp theo.',
    });
  }
  if (helpCount > 0) {
    signals.push({
      key: 'help',
      severity: 'warning',
      title: `${helpCount} việc cần hỗ trợ`,
      detail: 'Có đầu việc đang chờ người khác xử lý hoặc cần thêm nguồn lực.',
    });
  }
  if (overdueCount > 0) {
    signals.push({
      key: 'overdue',
      severity: 'warning',
      title: `${overdueCount} việc đã vượt hạn`,
      detail: 'Cần rà soát timeline và phân loại lại mức độ ưu tiên để giảm rủi ro.',
    });
  }
  if (sourceCounts.IMAGE > 0 || imageAttachmentCount > 0) {
    signals.push({
      key: 'image-evidence',
      severity: 'info',
      title: 'Có tài liệu hình ảnh',
      detail: 'Workspace có ảnh hiện trường hoặc ghi chú hình ảnh có thể cần đối chiếu.',
    });
  }
  if (records.some((r) => r.kind === 'DECISION')) {
    signals.push({
      key: 'decision-locked',
      severity: 'success',
      title: 'Quyết định đã được khóa',
      detail: 'Workspace đã ghi lại ít nhất một quyết định chính thức.',
    });
  }

  const summaryFragments: string[] = [];
  const totalSources = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
  if (totalSources > 0) {
    summaryFragments.push(`${totalSources} nguồn đầu vào đã gom (${Object.entries(sourceCounts).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${SOURCE_LABELS[k as AiSourceKind]}`).join(', ')})`);
  }
  if (openTasks.length > 0) {
    summaryFragments.push(`${openTasks.length} đầu việc mở, ${blockingCount} blocking, ${helpCount} cần hỗ trợ`);
  }
  if (attachments.length > 0) {
    summaryFragments.push(`${attachments.length} tài liệu đính kèm (${imageAttachmentCount} ảnh, ${documentAttachmentCount} file)`);
  }
  if (!summaryFragments.length) {
    summaryFragments.push(`Workspace ${entityCode || entityType} chưa có nguồn đầu vào hoặc đầu việc đáng kể.`);
  }

  const suggestedTasks: AiSuggestedTask[] = [];
  const seenKeys = new Set<string>();

  sources.forEach((src) => {
    const lines = src.content.split('\n').map(cleanupSourceLine).filter((l) => l.length > 10 && isActionLike(l));
    lines.slice(0, 2).forEach((line) => {
      const key = `src-${normalizeTaskKey(line).slice(0, 40)}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      suggestedTasks.push({
        key,
        title: truncate(line, 80),
        description: `Đầu việc rút từ nguồn: ${src.label} — ${truncate(src.content, 120)}`,
        priority: inferPriority(line, src.kind, tasks),
        reason: `Dựa trên tín hiệu từ ${src.label}.`,
        sourceKinds: [src.kind],
      });
    });
  });

  if (suggestedTasks.length < 2) {
    buildFallbackSuggestions({ entityCode, tasks, sourceCounts, imageAttachmentCount })
      .forEach((suggestion) => {
        if (!seenKeys.has(suggestion.key)) {
          seenKeys.add(suggestion.key);
          suggestedTasks.push(suggestion);
        }
      });
  }

  return {
    headline: `Tổng quan triển khai ${entityCode ? `— ${entityCode}` : entityType}`,
    summary: summaryFragments,
    sourceCounts,
    imageAttachmentCount,
    documentAttachmentCount,
    signals,
    suggestedTasks: suggestedTasks.slice(0, 6),
  };
}

export function buildExecutionReadiness(params: {
  sources: AiStructuredSource[];
  records: WorkspaceStructuredRecord[];
  tasks: TaskItem[];
  attachments: AttachmentItem[];
}): ExecutionReadiness {
  const { sources, records, tasks, attachments } = params;
  const openTasks = tasks.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  const blockingCount = openTasks.filter((t) => t.is_blocking).length;
  const unassignedCount = openTasks.filter((t) => !t.assigned_to).length;
  const decisions = records.filter((r) => r.kind === 'DECISION').length;
  const handovers = records.filter((r) => r.kind === 'HANDOVER').length;

  let score = 0;
  if (sources.length > 0) score += 20;
  if (openTasks.length > 0 && unassignedCount === 0) score += 20;
  if (decisions > 0) score += 20;
  if (handovers > 0) score += 20;
  if (attachments.length > 0) score += 10;
  if (blockingCount === 0) score += 10;
  score = clamp(score, 0, 100);

  if (score >= 80) {
    return { score, label: 'Sẵn sàng triển khai', tone: 'success', description: 'Workspace đã đủ cơ sở để bàn giao hoặc chuyển giai đoạn.' };
  }
  if (score >= 50) {
    return { score, label: 'Đang chuẩn bị', tone: 'warning', description: 'Có một số điểm cần bổ sung trước khi bàn giao hoặc đẩy tiến độ.' };
  }
  return { score, label: 'Chưa đủ điều kiện', tone: 'error', description: 'Workspace thiếu nguồn đầu vào, owner hoặc quyết định quan trọng.' };
}

export function buildExecutionDigests(params: {
  entityType: string;
  entityCode?: string;
  brief: AiExecutionBrief;
  tasks: TaskItem[];
  records: WorkspaceStructuredRecord[];
}): ExecutionDigestPack {
  const { entityType, entityCode, brief, tasks, records } = params;
  const openTasks = tasks.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  const blockingCount = openTasks.filter((t) => t.is_blocking).length;
  const helpCount = openTasks.filter((t) => t.needs_help).length;
  const overdueCount = openTasks.filter(
    (t) => t.due_date && t.due_date < new Date().toISOString().slice(0, 10),
  ).length;
  const decisions = records.filter((r) => r.kind === 'DECISION').slice(0, 3);
  const stakeholders = records.filter((r) => r.kind === 'STAKEHOLDER').slice(0, 3);
  const handovers = records.filter((r) => r.kind === 'HANDOVER').slice(0, 3);
  const topActions = brief.suggestedTasks.slice(0, 3);

  const operations = [
    `Tổng quan ${entityCode || entityType}`,
    `- Đầu việc mở: ${openTasks.length}`,
    `- Blocking: ${blockingCount}`,
    `- Cần hỗ trợ: ${helpCount}`,
    `- Rủi ro timeline: ${overdueCount}`,
    '',
    'Điểm nhấn điều hành',
    ...brief.summary.map((item) => `- ${item}`),
    '',
    'Ưu tiên tiếp theo',
    ...(topActions.length
      ? topActions.map((item) => `- ${item.title} (${getTaskPriorityLabel(item.priority)})`)
      : ['- Chưa có đề xuất nổi bật']),
  ].join('\n');

  const handoverDigest = [
    `Bàn giao ${entityCode || entityType}`,
    `- Tổng việc mở: ${openTasks.length}`,
    `- Việc cần chú ý ngay: ${Math.max(blockingCount, overdueCount, helpCount)}`,
    '',
    'Quyết định đã khóa',
    ...(decisions.length
      ? decisions.map((item) => `- ${item.title}: ${truncate(item.details, 120)}`)
      : ['- Chưa ghi nhận quyết định mới']),
    '',
    'Stakeholder cần theo dõi',
    ...(stakeholders.length
      ? stakeholders.map((item) => `- ${item.title}: ${truncate(item.details, 120)}`)
      : ['- Chưa ghi nhận stakeholder trọng điểm']),
    '',
    'Ghi chú bàn giao',
    ...(handovers.length
      ? handovers.map((item) => `- ${item.title}: ${truncate(item.details, 120)}`)
      : ['- Chưa có bản bàn giao nào được lưu']),
  ].join('\n');

  const executive = [
    `Tổng hợp lãnh đạo ${entityCode || entityType}`,
    `- Task đang mở: ${openTasks.length}`,
    `- Đang chặn: ${blockingCount}`,
    `- Cần hỗ trợ: ${helpCount}`,
    `- Quá hạn: ${overdueCount}`,
    '',
    'Điểm cần chú ý',
    ...brief.signals.slice(0, 3).map((signal) => `- ${signal.title}: ${signal.detail}`),
  ].join('\n');

  return { operations, handover: handoverDigest, executive };
}

export function getEntityExecutionPlaybook(entityType: string, entityCode?: string): EntityExecutionPlaybook {
  const normalized = entityType
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

  if (normalized.includes('production')) {
    return {
      title: `Khung điều hành sản xuất ${entityCode || ''}`.trim(),
      subtitle: 'Ưu tiên chốt vật tư, lịch chạy máy, QC và bàn giao giữa các ca.',
      focusAreas: [
        'Khóa lịch chạy và người phụ trách từng chặng',
        'Xác nhận vật tư, khuôn, mẫu và rủi ro chất lượng',
        'Chuẩn bị bàn giao giữa sản xuất, QC và kho',
      ],
      prompts: [
        'Ca nào đang giữ lệnh này và mốc bàn giao tiếp theo là gì?',
        'Điểm nghẽn hiện tại nằm ở vật tư, khuôn, phê duyệt hay năng lực máy?',
        'QC cần xác nhận gì trước khi cho chạy tiếp?',
      ],
    };
  }

  if (normalized.includes('purchase') || normalized.includes('purchasing')) {
    return {
      title: `Khung điều hành mua hàng ${entityCode || ''}`.trim(),
      subtitle: 'Ưu tiên nhà cung cấp, thời gian giao hàng, chứng từ và điểm cần phê duyệt.',
      focusAreas: [
        'Khóa ETA, số lượng và người xác nhận với nhà cung cấp',
        'Giữ email báo giá, phê duyệt và điều khoản trong cùng workspace',
        'Bàn giao rõ cho kho hoặc bộ phận nhận hàng',
      ],
      prompts: [
        'Nhà cung cấp đã xác nhận giao hàng chưa và ai đang theo dõi?',
        'Có điểm nào đang chờ duyệt giá, duyệt PO hoặc thay đổi điều khoản?',
        'Nếu giao chậm, phương án thay thế là gì?',
      ],
    };
  }

  if (normalized.includes('sales') || normalized.includes('shipment')) {
    return {
      title: `Khung điều hành bán hàng / giao vận ${entityCode || ''}`.trim(),
      subtitle: 'Ưu tiên cam kết với khách hàng, thời điểm giao hàng và xử lý phản hồi hiện trường.',
      focusAreas: [
        'Chốt ngày giao, người điều phối và đầu mối khách hàng',
        'Tập trung phản hồi email, chat và sự cố hiện trường',
        'Bàn giao giữa sales, kho và vận chuyển không bị đứt mạch',
      ],
      prompts: [
        'Khách hàng đang cần xác nhận điều gì ngay?',
        'Có rủi ro giao chậm, thiếu hàng hay khiếu nại chất lượng không?',
        'Thông tin bàn giao cho đội giao hàng đã đủ chưa?',
      ],
    };
  }

  if (normalized.includes('product')) {
    return {
      title: `Khung điều hành sản phẩm ${entityCode || ''}`.trim(),
      subtitle: 'Ưu tiên chốt mẫu, quy cách, stakeholder duyệt và đầu việc liên phòng ban.',
      focusAreas: [
        'Khóa thay đổi quy cách, mẫu và điểm cần phê duyệt',
        'Theo dõi các tin nhắn và email từ khách hàng hoặc sales',
        'Chuẩn hóa đầu việc giữa sales, thiết kế, sản xuất và QC',
      ],
      prompts: [
        'Mẫu hay quy cách nào đang chờ xác nhận cuối cùng?',
        'Ai là người có quyền chốt thay đổi và deadline là khi nào?',
        'Nhóm nào cần được cập nhật ngay nếu có thay đổi mới?',
      ],
    };
  }

  return {
    title: `Khung điều hành ${entityCode || entityType}`.trim(),
    subtitle: 'Ưu tiên gom nguồn, khóa ownership và giữ bàn giao rõ ràng trước khi đẩy việc.',
    focusAreas: [
      'Gom đủ nguồn điều phối trong cùng workspace',
      'Gắn rõ owner, mốc chốt và điểm phê duyệt',
      'Lưu bàn giao để nhóm tiếp theo không mất ngữ cảnh',
    ],
    prompts: [
      'Điểm nghẽn chính hiện tại là gì?',
      'Quyết định nào cần được khóa ngay hôm nay?',
      'Nếu bàn giao cho người khác, họ còn thiếu thông tin gì?',
    ],
  };
}

export function buildExecutionChecklist(params: {
  tasks: TaskItem[];
  comments: CommentItem[];
  attachments: AttachmentItem[];
}): ExecutionChecklistItem[] {
  const { tasks, comments, attachments } = params;
  const openTasks = tasks.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  const sources = comments.filter((c) => Boolean(parseStructuredSourceComment(c)));
  const decisions = comments
    .map((c) => parseWorkspaceRecordComment(c))
    .filter((item): item is WorkspaceStructuredRecord => Boolean(item))
    .filter((item) => item.kind === 'DECISION');
  const handovers = comments
    .map((c) => parseWorkspaceRecordComment(c))
    .filter((item): item is WorkspaceStructuredRecord => Boolean(item))
    .filter((item) => item.kind === 'HANDOVER');
  const blockers = openTasks.filter((t) => t.is_blocking).length;
  const unassigned = openTasks.filter((t) => !t.assigned_to).length;

  return [
    {
      key: 'sources',
      label: 'Đủ nguồn đầu vào',
      done: sources.length > 0,
      detail: sources.length > 0
        ? `Đã có ${sources.length} nguồn điều phối trong brief.`
        : 'Nên lưu ít nhất một nguồn họp, chat, email hoặc hình ảnh.',
    },
    {
      key: 'owner',
      label: 'Owner tương đối rõ',
      done: openTasks.length === 0 || unassigned === 0,
      detail: unassigned === 0
        ? 'Các đầu việc mở hiện đã có owner hoặc chưa phát sinh việc mở.'
        : `Còn ${unassigned} đầu việc mở chưa có owner rõ ràng.`,
    },
    {
      key: 'decision',
      label: 'Có quyết định đã khóa',
      done: decisions.length > 0,
      detail: decisions.length > 0
        ? `Đã có ${decisions.length} quyết định được ghi lại.`
        : 'Nên lưu ít nhất một quyết định hoặc phương án đã chốt.',
    },
    {
      key: 'handover',
      label: 'Bàn giao sẵn sàng',
      done: handovers.length > 0,
      detail: handovers.length > 0
        ? `Đã có ${handovers.length} ghi nhận bàn giao.`
        : 'Chưa có ghi nhận bàn giao cho ca sau hoặc nhóm tiếp nhận.',
    },
    {
      key: 'risk',
      label: 'Không còn blocker nổi bật',
      done: blockers === 0,
      detail: blockers === 0
        ? 'Chưa thấy nhiệm vụ blocking nổi bật trong workspace.'
        : `Còn ${blockers} nhiệm vụ blocking cần tháo gỡ.`,
    },
    {
      key: 'evidence',
      label: 'Có bằng chứng hoặc tài liệu',
      done: attachments.length > 0,
      detail: attachments.length > 0
        ? `Đã có ${attachments.length} tệp đính kèm để đối chiếu.`
        : 'Nên đính kèm ảnh, email hoặc tài liệu khi cần xác minh.',
    },
  ];
}

export function buildExecutionTimeline(params: {
  comments: CommentItem[];
  attachments: AttachmentItem[];
}): ExecutionTimelineEntry[] {
  const { comments, attachments } = params;
  const sourceEntries = comments
    .map((c) => parseStructuredSourceComment(c))
    .filter((item): item is AiStructuredSource => Boolean(item))
    .map((item) => ({
      key: `source-${item.commentId}`,
      kind: 'SOURCE' as const,
      label: item.label,
      title: item.label,
      detail: truncate(item.content, 180),
      createdAt: item.createdAt,
      actor: item.createdByName,
    }));

  const recordEntries = comments
    .map((c) => parseWorkspaceRecordComment(c))
    .filter((item): item is WorkspaceStructuredRecord => Boolean(item))
    .map((item) => ({
      key: `record-${item.commentId}`,
      kind: 'RECORD' as const,
      label: item.kindLabel,
      title: item.title,
      detail: truncate(item.details, 180),
      createdAt: item.createdAt,
      actor: item.createdByName,
    }));

  const attachmentEntries = attachments.map((item) => ({
    key: `attachment-${item.id}`,
    kind: 'ATTACHMENT' as const,
    label: 'Tệp đính kèm',
    title: item.filename,
    detail: item.description || 'Đã tải tệp vào workspace',
    createdAt: item.uploaded_at,
    actor: item.uploaded_by_username,
  }));

  return [
    ...sourceEntries,
    ...recordEntries,
    ...attachmentEntries,
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);
}
