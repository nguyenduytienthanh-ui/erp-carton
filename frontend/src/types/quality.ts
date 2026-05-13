export type QualityInspectionStatus = 'DRAFT' | 'SUBMITTED' | 'REVIEWED' | 'CANCELLED';

export type QualityInspectionResult =
  | 'PENDING'
  | 'PASS'
  | 'CONDITIONAL_PASS'
  | 'FAIL'
  | 'HOLD'
  | 'REWORK'
  | 'NEED_REVIEW'
  | 'CANCELLED';

export type QualityInspectionLineResult = 'OK' | 'NG' | 'NA';

export type QualityDefectSeverity = 'MINOR' | 'MAJOR' | 'CRITICAL';

export type VisionInspectionJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export type QualityImageType =
  | 'raw_image'
  | 'normalized_image'
  | 'thumbnail'
  | 'roi_crop'
  | 'diff_image'
  | 'heatmap_image'
  | 'annotated_image'
  | 'temporary_image'
  | 'calibration_image'
  | 'template_reference_image';

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface QualityInspectionLine {
  id: number;
  line_no: number;
  check_key: string;
  label: string;
  expected_value: string;
  actual_value: string;
  result: QualityInspectionLineResult;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface QualityDefect {
  id: number;
  inspection: number;
  defect: number;
  defect_code: string;
  defect_name: string;
  severity: QualityDefectSeverity;
  quantity: number;
  sample_size: number;
  roi: Record<string, unknown>;
  location_note: string;
  disposition: string;
  note: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface VisionInspectionJob {
  id: number;
  job_id: string;
  inspection: number;
  status: VisionInspectionJobStatus;
  requested_by: number | null;
  queue_name: string;
  worker_id: string;
  retry_count: number;
  timeout_seconds: number;
  request_payload: Record<string, unknown>;
  result_json: Record<string, unknown>;
  error_message: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QualityImageArtifact {
  id: number;
  inspection: number;
  job: number | null;
  image_type: QualityImageType;
  result_status: QualityInspectionResult;
  storage_path: string;
  thumbnail_path: string;
  file_size: number;
  width: number | null;
  height: number | null;
  dpi: number | null;
  mm_per_pixel: string | null;
  checksum: string;
  metadata: Record<string, unknown>;
  retention_policy: number | null;
  retention_policy_code: string;
  expires_at: string | null;
  deleted_at: string | null;
  cleanup_status: string;
  is_pinned: boolean;
  legal_hold: boolean;
  pinned_by: number | null;
  pinned_at: string | null;
  pin_reason: string;
  created_at: string;
  updated_at: string;
}

export interface QualityImageRetentionPolicy {
  id: number;
  image_type: QualityImageType;
  result_status: QualityInspectionResult;
  scope_type: string;
  scope_key: string;
  retention_days: number | null;
  keep_thumbnail: boolean;
  keep_metadata: boolean;
  auto_delete: boolean;
  require_delete_approval: boolean;
  note: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface QualityStorageSettings {
  id: number;
  singleton_key: string;
  storage_root: string;
  quota_bytes: number;
  warning_threshold_percent: number;
  critical_threshold_percent: number;
  emergency_threshold_percent: number;
  cleanup_hour: number;
  cleanup_paused: boolean;
  dry_run_required: boolean;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface QualityInspection {
  id: number;
  code: string;
  inspection_type: string;
  status: QualityInspectionStatus;
  result: QualityInspectionResult;
  sample_size: number;
  notes: string;
  product: number | null;
  sales_order: number | null;
  sales_order_line: number | null;
  production_order: number | null;
  production_operation: number | null;
  operation_code: string;
  operation_name: string;
  work_center_code: string;
  work_center_name: string;
  machine_code: string;
  machine_name: string;
  expected_print_snapshot: Record<string, unknown>;
  production_context_snapshot: Record<string, unknown>;
  vision_result_snapshot: Record<string, unknown>;
  inspector: number | null;
  reviewed_by: number | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  line_count?: number;
  defect_count?: number;
  lines?: QualityInspectionLine[];
  defects?: QualityDefect[];
  vision_jobs?: VisionInspectionJob[];
  image_artifacts?: QualityImageArtifact[];
}

export interface QualityInspectionQueryParams {
  page?: number;
  page_size?: number;
  status?: QualityInspectionStatus;
  result?: QualityInspectionResult;
  product_code?: string;
  production_order_code?: string;
  machine_code?: string;
  operation_code?: string;
}
