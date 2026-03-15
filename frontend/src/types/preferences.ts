export interface UserPreferences {
  id: number;
  page: string;
  config: PreferencesConfig;
  created_at: string;
  updated_at: string;
}

export interface PreferencesConfig {
  // Generic - có thể chứa bất kỳ field nào
  columns?: string[];
  filters?: Record<string, unknown>;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
  pageSize?: number;
  activeTab?: number | string;
  expandedSections?: string[];
  theme?: string;
  language?: string;
  sizeDisplayMode?: 'merged' | 'separated';
  [key: string]: unknown;  // Allow any field
}
