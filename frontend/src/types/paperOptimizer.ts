export type PaperOptimizerLine = {
  id?: string;
  note?: string | null;
  quantity: number;
  width_cm: number;
  length_cm: number;
  source_row_number?: number | null;
};

export type PaperOptimizerSupplierConfig = {
  trim_edge_cm?: number;
  max_combined_length_cm?: number | null;
  min_purchase_length_cm?: number;
  available_raw_widths_cm?: number[];
  max_combination_width_cm?: number;
  allow_reuse_self_sufficient_patterns?: boolean;
};

export type PaperOptimizerOptimizationConfig = {
  max_length_delta_cm?: number | null;
  top_candidates_keep?: number;
  deep_optimization_mode?: boolean;
  max_waste_rate_percent?: number;
  production_reserve_scope?: 'per_line' | 'whole_order';
  fragmentation_cost_weight?: number;
  new_raw_width_cost_weight?: number;
  allow_exceed_target_demand?: boolean;
  technical_waste_cost_weight?: number;
  max_multiplier_per_component?: number;
  allow_economic_overproduction?: boolean;
  new_purchase_spec_cost_weight?: number;
  max_components_per_combination?: number;
  production_reserve_rate_percent?: number;
  production_reserve_rounding_mode?: 'ceil' | 'round' | 'floor';
  economic_overproduction_cost_weight?: number;
  max_economic_overproduction_quantity_total?: number | null;
  max_economic_overproduction_quantity_per_line?: number | null;
  max_economic_overproduction_rate_percent_total?: number | null;
  acceptable_cost_increase_for_fewer_specs_percent?: number;
  acceptable_waste_increase_for_fewer_specs_percent?: number;
  max_economic_overproduction_rate_percent_per_line?: number | null;
  acceptable_cost_increase_for_fewer_raw_widths_percent?: number;
};

export type PaperOptimizerBaselineReference = {
  baseline_guardrail_schema_version?: number | null;
  baseline_generated_from_run_code?: string | null;
  baseline_generated_at?: string | null;
  reference_code?: string | null;
  reference_source?: string | null;
  config_fingerprint?: string | null;
  selected_plan_code?: string | null;
  selected_scenario_code?: string | null;
  selected_source_internal_plan_code?: string | null;
  line_count?: number | null;
  base_requested_quantity_total?: number | null;
  production_reserve_quantity_total?: number | null;
  target_requested_quantity_total?: number | null;
};

export type PaperOptimizerBenchmarkReference = {
  benchmark_schema_version?: number | null;
  reference_code?: string | null;
  reference_name?: string | null;
  reference_source?: string | null;
  base_requested_quantity_total?: number | null;
  production_reserve_quantity_total?: number | null;
  target_requested_quantity_total?: number | null;
  economic_overproduction_quantity_total?: number | null;
  allocated_quantity_total?: number | null;
  technical_waste_area?: number | null;
  technical_waste_rate?: number | null;
  technical_waste_cost?: number | null;
  total_purchase_area?: number | null;
  total_used_area?: number | null;
  raw_width_cost?: number | null;
  purchase_spec_cost?: number | null;
  fragmentation_cost?: number | null;
  economic_overproduction_cost?: number | null;
  total_converted_cost?: number | null;
  unique_raw_width_count?: number | null;
  raw_widths_used?: number[];
  unique_purchase_spec_count?: number | null;
  final_group_count?: number | null;
  public_plan_selection_note?: string | null;
  public_plan_tradeoff_note?: string | null;
};

export type PaperOptimizerDefaultsResponse = {
  input_lines: PaperOptimizerLine[];
  supplier_config: PaperOptimizerSupplierConfig;
  optimization_config: PaperOptimizerOptimizationConfig;
  baseline_reference: PaperOptimizerBaselineReference;
  benchmark_reference: PaperOptimizerBenchmarkReference;
};

export type PaperOptimizerCanonicalSnapshot = PaperOptimizerDefaultsResponse;

export type PaperOptimizerPreviewResponse = {
  source_filename: string;
  rows: PaperOptimizerLine[];
  issues: PaperOptimizerPreviewIssue[];
  summary: {
    line_count: number;
    accepted_row_count: number;
    total_quantity: number;
    issue_count: number;
    invalid_row_count: number;
    skipped_empty_row_count: number;
    header_detected: boolean;
  };
};

export type PaperOptimizerPreviewIssue = {
  row_number: number;
  severity: 'warning' | 'error' | 'info';
  code: string;
  message: string;
};

export type PaperOptimizerManualPatternComponent = {
  width_cm: number;
  length_cm: number;
  multiplier: number;
};

export type PaperOptimizerManualPatternResponse = {
  raw_width_cm: number;
  trim_edge_cm: number;
  run_length_cm: number;
  sets: number;
  useful_width_cm: number;
  used_width_cm: number;
  purchase_area: number;
  used_area: number;
  waste_area: number;
  waste_rate: number;
  meets_supplier_rule: boolean;
};

export type PaperOptimizerPlanRow = {
  note?: string;
  sets?: number;
  description?: string;
  raw_width_cm?: number;
  run_length_cm?: number;
  total_length_cm?: number;
  waste_rate?: number;
  status_label?: string;
  source_line_ids?: string[];
  components?: Array<{
    line_id?: string;
    width_cm?: number;
    length_cm?: number;
    allocated_quantity?: number;
    multiplier?: number;
  }>;
};

export type PaperOptimizerAllocationDetail = {
  line_id?: string;
  base_quantity?: number;
  reserve_quantity?: number;
  target_quantity?: number;
  allocated_quantity?: number;
  line_allocated_sets?: number;
  economic_overproduction_quantity?: number;
  missing_quantity?: number;
  raw_width_cm?: number;
  run_length_cm?: number;
};

export type PaperOptimizerPurchaseSpecRow = {
  group_id?: string;
  description?: string;
  raw_width_cm?: number;
  run_length_cm?: number;
  useful_width_cm?: number;
  used_width_cm?: number;
  total_sets_purchase_spec?: number;
  reserve_sets?: number;
  economic_sets_purchase_spec?: number;
  total_length_cm_purchase_spec?: number;
  purchase_area_cm2?: number;
  used_area_cm2?: number;
  waste_area_cm2?: number;
  waste_rate?: number;
  width_utilization_rate?: number;
  area_utilization_rate?: number;
  source_line_ids?: string[];
  source_line_count?: number;
  supplier_min_length_required_cm?: number;
  supplier_min_length_actual_cm?: number;
  supplier_min_length_passed?: boolean;
  note?: string;
};

export type PaperOptimizerReverseCheckRow = {
  raw_width_cm?: number;
  run_length_cm?: number;
  sum_line_allocated_sets?: number;
  total_sets_purchase_spec?: number;
  reverse_total_length_cm?: number;
  spec_total_length_cm?: number;
  line_count?: number;
  line_ids?: string[];
  ncc_passed?: boolean;
  consistent?: boolean;
};

export type PaperOptimizerRawWidthUsageRow = {
  raw_width_cm?: number;
  group_count?: number;
  purchase_spec_count?: number;
  total_length_cm?: number;
  used_once?: boolean;
  single_use_purchase_spec_count?: number;
};

export type PaperOptimizerDelta = {
  total_converted_cost_delta?: number;
  unique_raw_width_count_delta?: number;
  unique_purchase_spec_count_delta?: number;
  final_group_count_delta?: number;
  technical_waste_rate_delta?: number;
  economic_overproduction_quantity_total_delta?: number;
};

export type PaperOptimizerBaselineSummary = {
  total_converted_cost?: number;
  unique_raw_width_count?: number;
  unique_purchase_spec_count?: number;
  final_group_count?: number;
  technical_waste_rate?: number;
};

export type PaperOptimizerSelectedVsBaselineDelta = {
  total_converted_cost_delta?: number;
  unique_raw_width_count_delta?: number;
  unique_purchase_spec_count_delta?: number;
  final_group_count_delta?: number;
  technical_waste_rate_delta?: number;
  economic_overproduction_quantity_total_delta?: number;
};

export type PaperOptimizerStats = {
  optimizer_mode?: string;
  config_fingerprint?: string | null;
  engine_primary?: string | null;
  engine_fallback_used?: boolean;
  engine_fallback_source?: string | null;
  engine_fallback_reason_code?: string | null;
  baseline_guardrail_reference_source?: string | null;
  baseline_guardrail_reference_code?: string | null;
  baseline_guardrail_schema_version?: number | null;
  baseline_generated_from_run_code?: string | null;
  baseline_generated_at?: string | null;
  benchmark_reference_code?: string | null;
  benchmark_reference_source?: string | null;
  selected_plan_code?: string | null;
  selected_scenario_code?: string | null;
  selected_source_internal_plan_code?: string | null;
  canonical_match?: boolean;
  recovery_mode?: boolean;
  guardrail_passed?: boolean;
  candidate_count?: number;
  feasible_alternative_count?: number;
  no_feasible_candidate?: boolean;
  displayable_result?: boolean;
  distinct_candidate_count?: number;
  purchase_spec_ncc_failed_count?: number;
};

export type PaperOptimizerPlan = {
  plan_code: 'EXACT_ORDER' | 'LOWEST_TOTAL_COST' | 'MIN_RAW_WIDTHS' | 'MIN_SPECS';
  plan_name?: string;
  public_plan_selection_note?: string;
  public_plan_tradeoff_note?: string;
  public_plan_objective_code?: string;
  public_plan_convergence_reason_code?: string;
  is_placeholder_no_feasible?: boolean;
  source_internal_plan_code?: string;
  source_internal_plan_name?: string;
  scenario_code?: string;
  allocated_quantity_total?: number;
  requested_quantity_total?: number;
  base_requested_quantity_total?: number;
  production_reserve_quantity_total?: number;
  target_requested_quantity_total?: number;
  economic_overproduction_quantity_total?: number;
  economic_overproduction_rate_total?: number;
  technical_waste_area?: number;
  technical_waste_rate?: number;
  technical_waste_cost?: number;
  economic_overproduction_cost?: number;
  raw_width_cost?: number;
  purchase_spec_cost?: number;
  fragmentation_cost?: number;
  total_converted_cost?: number;
  unique_raw_width_count?: number;
  raw_widths_used?: number[];
  single_use_raw_width_count?: number;
  reused_raw_width_count?: number;
  raw_width_usage_summary?: Array<{
    raw_width_cm?: number;
    group_count?: number;
    purchase_spec_count?: number;
    total_length_cm?: number;
    used_once?: boolean;
    single_use_purchase_spec_count?: number;
  }> | PaperOptimizerRawWidthUsageRow[];
  unique_purchase_spec_count?: number;
  single_use_purchase_spec_count?: number;
  reused_purchase_spec_count?: number;
  final_group_count?: number;
  total_purchase_area?: number;
  allocation_details?: PaperOptimizerAllocationDetail[];
  purchase_spec_rows?: PaperOptimizerPurchaseSpecRow[];
  reverse_check_rows?: PaperOptimizerReverseCheckRow[];
  leftovers?: Array<Record<string, unknown>>;
  final_plan?: PaperOptimizerPlanRow[];
  objective_candidate_count?: number;
  objective_distinct_candidate_count?: number;
  objective_best_signature_count?: number;
  objective_cost_allowance_percent?: number;
  compared_to_lowest_total_cost_delta?: PaperOptimizerDelta;
  compared_to_min_raw_widths_delta?: PaperOptimizerDelta;
  objective_selected_distinct_solution?: boolean;
  search_strategy?: string;
  [key: string]: unknown;
};

export type PaperOptimizerResultPayload = {
  source_filename?: string;
  note?: string;
  input_lines: PaperOptimizerLine[];
  target_lines?: PaperOptimizerLine[];
  supplier_config: PaperOptimizerSupplierConfig;
  optimization_config: PaperOptimizerOptimizationConfig;
  canonical_match: boolean;
  recovery_mode: boolean;
  result_state?: 'success' | 'no_feasible_candidate';
  selected_plan_code: PaperOptimizerPlan['plan_code'];
  selected_scenario_code?: string;
  selected_source_internal_plan_code?: string;
  selected_plan: PaperOptimizerPlan | null;
  final_plan_alternatives: PaperOptimizerPlan[];
  allocation_details: PaperOptimizerAllocationDetail[];
  leftovers: Array<Record<string, unknown>>;
  reverse_check_rows: PaperOptimizerReverseCheckRow[];
  preview_summary?: {
    line_count?: number;
    total_quantity?: number;
  };
  baseline_reference?: PaperOptimizerBaselineReference;
  benchmark_reference?: PaperOptimizerBenchmarkReference;
  baseline_summary?: PaperOptimizerBaselineSummary;
  selected_vs_baseline_delta?: PaperOptimizerSelectedVsBaselineDelta;
  baseline_guardrail_passed?: boolean;
  promote_allowed?: boolean;
  fallback_reason?: string;
  stats?: PaperOptimizerStats;
  [key: string]: unknown;
};

export type PaperOptimizerRun = {
  id: number;
  code: string;
  status: string;
  source_filename?: string;
  note?: string;
  input_lines: PaperOptimizerLine[];
  supplier_config: PaperOptimizerSupplierConfig;
  optimization_config: PaperOptimizerOptimizationConfig;
  preview_rows?: Record<string, unknown>[];
  result_payload: PaperOptimizerResultPayload;
  recovery_mode: boolean;
  canonical_match: boolean;
  failed_reason?: string | null;
  created_at: string;
  updated_at: string;
};

export type PaperOptimizerPreferences = {
  inputLines?: PaperOptimizerLine[];
  supplierConfig?: PaperOptimizerSupplierConfig;
  optimizationConfig?: PaperOptimizerOptimizationConfig;
  sourceFilename?: string;
  note?: string;
};
