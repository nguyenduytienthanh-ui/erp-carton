export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type CustomReportType =
  | 'SALES'
  | 'PURCHASE'
  | 'INVENTORY'
  | 'PRODUCTION'
  | 'FINANCIAL'
  | 'SHIPPING'
  | 'WORKFORCE';

export type CustomReportStatus = 'DRAFT' | 'GENERATED' | 'FINALIZED' | 'ARCHIVED';
export type CustomReportScheduleFrequency = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type CustomReportRunStatus = 'SUCCESS' | 'FAILED';
export type CustomReportRunTrigger = 'MANUAL' | 'SCHEDULED';
export type BooleanFilterValue = '' | 'true' | 'false';

export interface CustomReportRun {
  id: number;
  report: number;
  report_code: string;
  report_name: string;
  trigger_type: CustomReportRunTrigger;
  status: CustomReportRunStatus;
  period_start?: string | null;
  period_end?: string | null;
  summary: Record<string, unknown>;
  row_count: number;
  duration_ms: number;
  error_message: string;
  generated_by?: number | null;
  generated_by_name?: string | null;
  generated_at: string;
}

export interface CustomReportDefinition {
  id: number;
  code: string;
  name: string;
  report_type: CustomReportType;
  description: string;
  status: CustomReportStatus;
  is_system: boolean;
  period_start?: string | null;
  period_end?: string | null;
  config: Record<string, unknown>;
  schedule_frequency: CustomReportScheduleFrequency;
  schedule_enabled: boolean;
  schedule_time?: string | null;
  schedule_day_of_week?: number | null;
  schedule_day_of_month?: number | null;
  schedule_recipients: string[];
  schedule_name?: string | null;
  next_run_at?: string | null;
  last_generated_at?: string | null;
  last_generated_by?: number | null;
  generated_by_name?: string | null;
  last_run_status?: CustomReportRunStatus | '';
  last_run_error?: string;
  last_run_summary: Record<string, unknown>;
  run_count: number;
  created_by?: number | null;
  updated_by?: number | null;
  created_at: string;
  updated_at: string;
}

export interface CustomReportDetail extends CustomReportDefinition {
  recent_runs: CustomReportRun[];
}

export interface CustomReportSummary {
  total_count: number;
  draft_count: number;
  generated_count: number;
  finalized_count: number;
  archived_count: number;
  scheduled_count: number;
  system_count: number;
  run_count: number;
}

export interface CustomReportGeneratedResult extends Record<string, unknown> {
  id: number;
  code: string;
  name: string;
  report_type: CustomReportType;
  status: CustomReportStatus;
  report_code?: string;
  report_name?: string;
  period_start?: string;
  period_end?: string;
  month?: string;
  generated_by_name?: string | null;
  generated_at: string;
  run_id: number;
  row_count: number;
  summary: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
}

export interface CustomReportListParams {
  page?: number;
  page_size?: number;
  ordering?: string;
  q?: string;
  report_type?: CustomReportType;
  status?: CustomReportStatus;
  schedule_enabled?: boolean | BooleanFilterValue;
  is_system?: boolean | BooleanFilterValue;
}

export interface CustomReportHistoryParams {
  page?: number;
  page_size?: number;
  report_id?: number;
  report_code?: string;
}

export interface CustomReportUpsertPayload {
  code: string;
  name: string;
  report_type: CustomReportType;
  description?: string;
  status?: CustomReportStatus;
  period_start?: string | null;
  period_end?: string | null;
  config?: Record<string, unknown>;
  schedule_frequency?: CustomReportScheduleFrequency;
  schedule_enabled?: boolean;
  schedule_time?: string | null;
  schedule_day_of_week?: number | null;
  schedule_day_of_month?: number | null;
  schedule_recipients?: string[];
}

export interface GenerateCustomReportPayload {
  report_id?: number;
  report_code?: string;
  report_name?: string;
  name?: string;
  report_type?: CustomReportType;
  description?: string;
  period_start?: string;
  period_end?: string;
}

export interface ScheduleCustomReportPayload {
  report_id?: number;
  report_code?: string;
  schedule_enabled?: boolean;
  enabled?: boolean;
  schedule_frequency?: CustomReportScheduleFrequency;
  frequency?: CustomReportScheduleFrequency;
  schedule_time?: string | null;
  schedule_day_of_week?: number | null;
  schedule_day_of_month?: number | null;
  schedule_recipients?: string[];
  email_recipients?: string[];
}

export interface ScheduleCustomReportResponse {
  success: boolean;
  scheduled: boolean;
  schedule_id: number | null;
  next_run: string | null;
  report: CustomReportDefinition;
}
