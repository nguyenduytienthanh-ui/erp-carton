export type ReportType = 'SALES' | 'PURCHASE' | 'INVENTORY' | 'PRODUCTION' | 'FINANCIAL' | 'SHIPPING';

export interface Report {
  id?: number;
  code: string;
  name: string;
  description?: string;
  report_type: ReportType;
  period_start: string;
  period_end: string;
  status: 'DRAFT' | 'GENERATED' | 'FINALIZED' | 'ARCHIVED';
  data?: any;
  
  // Metadata
  generated_by_name?: string;
  generated_at?: string;
  finalized_by_name?: string;
  finalized_at?: string;
  created_at?: string;
}

export interface ReportTemplate {
  id?: number;
  code: string;
  name: string;
  description?: string;
  report_type: ReportType;
  template_config?: any;
  is_active: boolean;
  created_at?: string;
}
