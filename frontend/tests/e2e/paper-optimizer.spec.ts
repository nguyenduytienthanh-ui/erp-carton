import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

const previewFixturePath = `${process.cwd()}/tests/e2e/fixtures/paper-optimizer-preview.csv`;
const previewInvalidFixturePath = `${process.cwd()}/tests/e2e/fixtures/paper-optimizer-preview-invalid.csv`;

const defaultsResponse = {
  input_lines: [
    { id: 'L1', note: 'Hop duplex A', quantity: 120, width_cm: 52, length_cm: 112, source_row_number: 1 },
    { id: 'L2', note: 'Hop duplex B', quantity: 90, width_cm: 84, length_cm: 143.5, source_row_number: 2 },
  ],
  supplier_config: {
    trim_edge_cm: 2,
    min_purchase_length_cm: 5000,
    available_raw_widths_cm: Array.from({ length: 35 }, (_, index) => 110 + index * 5),
    max_combination_width_cm: 250,
    max_combined_length_cm: null,
    allow_reuse_self_sufficient_patterns: true,
  },
  optimization_config: {
    production_reserve_rate_percent: 1.5,
    production_reserve_rounding_mode: 'ceil',
    production_reserve_scope: 'whole_order',
    allow_economic_overproduction: true,
    allow_exceed_target_demand: true,
    top_candidates_keep: 2000,
    max_length_delta_cm: null,
    max_waste_rate_percent: 20,
    technical_waste_cost_weight: 1,
    economic_overproduction_cost_weight: 1,
    new_raw_width_cost_weight: 1,
    new_purchase_spec_cost_weight: 0.2,
    fragmentation_cost_weight: 0.12,
    acceptable_cost_increase_for_fewer_raw_widths_percent: 1,
    acceptable_cost_increase_for_fewer_specs_percent: 0.5,
    acceptable_waste_increase_for_fewer_specs_percent: 0.3,
    max_multiplier_per_component: 4,
    max_components_per_combination: 6,
    deep_optimization_mode: true,
    max_economic_overproduction_rate_percent_total: 2,
    max_economic_overproduction_quantity_total: 24,
    max_economic_overproduction_rate_percent_per_line: 2,
    max_economic_overproduction_quantity_per_line: 6,
  },
  baseline_reference: {
    reference_code: 'baseline-canonical-v5000-v1',
    reference_source: 'internal_canonical_snapshot',
  },
  benchmark_reference: {
    reference_code: 'benchmark-manual-v1',
    reference_name: 'Benchmark tham chieu',
    reference_source: 'internal_benchmark_snapshot',
    total_converted_cost: 2.67223922,
    total_purchase_area: 8537140,
    unique_raw_width_count: 1,
    unique_purchase_spec_count: 4,
    final_group_count: 6,
    technical_waste_rate: 0.15223922,
  },
};

function buildMockRun(): Record<string, unknown> {
  return {
    id: 9999,
    code: 'POPT-E2E-TEST',
    status: 'SUCCESS',
    source_filename: 'e2e-preview.csv',
    note: 'e2e test mock run',
    input_lines: defaultsResponse.input_lines,
    supplier_config: defaultsResponse.supplier_config,
    optimization_config: defaultsResponse.optimization_config,
    preview_rows: [],
    recovery_mode: false,
    canonical_match: false,
    failed_reason: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    result_payload: {
      source_filename: 'e2e-preview.csv',
      note: 'e2e test mock run',
      input_lines: defaultsResponse.input_lines,
      target_lines: [
        { ...defaultsResponse.input_lines[0], base_quantity: 120, reserve_quantity: 2, target_quantity: 122 },
        { ...defaultsResponse.input_lines[1], base_quantity: 90, reserve_quantity: 2, target_quantity: 92 },
      ],
      supplier_config: defaultsResponse.supplier_config,
      optimization_config: defaultsResponse.optimization_config,
      canonical_match: false,
      recovery_mode: false,
      result_state: 'success',
      selected_plan_code: 'LOWEST_TOTAL_COST',
      selected_scenario_code: 'TARGET',
      selected_source_internal_plan_code: 'MIN_SPECS',
      selected_plan: {
        plan_code: 'LOWEST_TOTAL_COST',
        plan_name: 'Phuong an chi phi thap nhat',
        base_requested_quantity_total: 210,
        production_reserve_quantity_total: 4,
        target_requested_quantity_total: 214,
        economic_overproduction_quantity_total: 0,
        allocated_quantity_total: 214,
        technical_waste_rate: 0.12,
        total_purchase_area: 3241800,
        total_converted_cost: 12.5,
        unique_raw_width_count: 2,
        raw_widths_used: [115, 145],
        unique_purchase_spec_count: 2,
        final_group_count: 2,
        raw_width_usage_summary: [
          { raw_width_cm: 115, group_count: 1, purchase_spec_count: 1, total_length_cm: 13664, used_once: true },
          { raw_width_cm: 145, group_count: 1, purchase_spec_count: 1, total_length_cm: 13202, used_once: true },
        ],
        final_plan: [
          { description: '1x L1 (112 x 52)', raw_width_cm: 115, run_length_cm: 112, sets: 122, total_length_cm: 13664, waste_rate: 0.087, status_label: 'Dat NCC', source_line_ids: ['L1'] },
          { description: '1x L2 (143.5 x 84)', raw_width_cm: 145, run_length_cm: 143.5, sets: 92, total_length_cm: 13202, waste_rate: 0.103, status_label: 'Dat NCC', source_line_ids: ['L2'] },
        ],
        allocation_details: [
          { line_id: 'L1', base_quantity: 120, reserve_quantity: 2, target_quantity: 122, line_allocated_sets: 122, economic_overproduction_quantity: 0, missing_quantity: 0, raw_width_cm: 115, run_length_cm: 112 },
          { line_id: 'L2', base_quantity: 90, reserve_quantity: 2, target_quantity: 92, line_allocated_sets: 92, economic_overproduction_quantity: 0, missing_quantity: 0, raw_width_cm: 145, run_length_cm: 143.5 },
        ],
        reverse_check_rows: [
          { raw_width_cm: 115, run_length_cm: 112, sum_line_allocated_sets: 122, total_sets_purchase_spec: 122, reverse_total_length_cm: 13664, spec_total_length_cm: 13664, line_count: 1, line_ids: ['L1'], ncc_passed: true, consistent: true },
          { raw_width_cm: 145, run_length_cm: 143.5, sum_line_allocated_sets: 92, total_sets_purchase_spec: 92, reverse_total_length_cm: 13202, spec_total_length_cm: 13202, line_count: 1, line_ids: ['L2'], ncc_passed: true, consistent: true },
        ],
        leftovers: [],
        purchase_spec_rows: [
          { group_id: '115x112', raw_width_cm: 115, run_length_cm: 112, useful_width_cm: 113, total_sets_purchase_spec: 122, total_length_cm_purchase_spec: 13664, waste_rate: 0.087, source_line_ids: ['L1'], supplier_min_length_required_cm: 5000, supplier_min_length_actual_cm: 13664, supplier_min_length_passed: true },
          { group_id: '145x143.5', raw_width_cm: 145, run_length_cm: 143.5, useful_width_cm: 143, total_sets_purchase_spec: 92, total_length_cm_purchase_spec: 13202, waste_rate: 0.103, source_line_ids: ['L2'], supplier_min_length_required_cm: 5000, supplier_min_length_actual_cm: 13202, supplier_min_length_passed: true },
        ],
        public_plan_convergence_reason_code: 'objective_selected_distinct_solution',
        public_plan_selection_note: 'Chi phi thap nhat duoc chon.',
      },
      final_plan_alternatives: [
        {
          plan_code: 'EXACT_ORDER',
          plan_name: 'Phuong an dung don hang',
          scenario_code: 'TARGET',
          total_converted_cost: 13.2,
          unique_raw_width_count: 2,
          unique_purchase_spec_count: 2,
          final_group_count: 2,
          economic_overproduction_quantity_total: 0,
          technical_waste_rate: 0.115,
          total_purchase_area: 3200000,
          public_plan_convergence_reason_code: 'objective_selected_distinct_solution',
          public_plan_selection_note: 'Bam dung nhu cau muc tieu.',
        },
        {
          plan_code: 'LOWEST_TOTAL_COST',
          plan_name: 'Phuong an chi phi thap nhat',
          scenario_code: 'TARGET',
          total_converted_cost: 12.5,
          unique_raw_width_count: 2,
          unique_purchase_spec_count: 2,
          final_group_count: 2,
          economic_overproduction_quantity_total: 0,
          technical_waste_rate: 0.12,
          total_purchase_area: 3241800,
          public_plan_convergence_reason_code: 'objective_selected_distinct_solution',
          public_plan_selection_note: 'Chi phi thap nhat.',
        },
        {
          plan_code: 'MIN_RAW_WIDTHS',
          plan_name: 'Phuong an it kho giay nhat',
          scenario_code: 'TARGET',
          total_converted_cost: 12.8,
          unique_raw_width_count: 1,
          unique_purchase_spec_count: 2,
          final_group_count: 2,
          economic_overproduction_quantity_total: 0,
          technical_waste_rate: 0.13,
          total_purchase_area: 3300000,
          public_plan_convergence_reason_code: 'objective_selected_distinct_solution',
          public_plan_selection_note: 'Uu tien it kho giay hon.',
        },
        {
          plan_code: 'MIN_SPECS',
          plan_name: 'Phuong an it quy cach mua nhat',
          scenario_code: 'TARGET',
          total_converted_cost: 13,
          unique_raw_width_count: 2,
          unique_purchase_spec_count: 1,
          final_group_count: 2,
          economic_overproduction_quantity_total: 0,
          technical_waste_rate: 0.14,
          total_purchase_area: 3350000,
          public_plan_convergence_reason_code: 'objective_selected_distinct_solution',
          public_plan_selection_note: 'Uu tien it quy cach hon.',
        },
      ],
      allocation_details: [],
      reverse_check_rows: [],
      leftovers: [],
      baseline_reference: defaultsResponse.baseline_reference,
      benchmark_reference: defaultsResponse.benchmark_reference,
      baseline_guardrail_passed: true,
      promote_allowed: true,
      fallback_reason: '',
      stats: {
        optimizer_mode: 'full_optimizer',
        candidate_count: 4,
        feasible_alternative_count: 4,
        no_feasible_candidate: false,
        displayable_result: true,
        purchase_spec_ncc_failed_count: 0,
        engine_primary: 'v2',
        engine_fallback_used: false,
        engine_fallback_source: 'none',
      },
    },
  };
}

async function mockDefaults(page: Parameters<typeof test>[0]['page']) {
  await page.route('**/api/production/paper-optimizer/runs/defaults/', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(defaultsResponse) });
  });
}

test('admin can upload preview, generate one current result, compare plans, and export workbook', async ({ page }) => {
  const mockRun = buildMockRun();

  await mockDefaults(page);

  await page.route('**/api/production/paper-optimizer/runs/upload_preview/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source_filename: 'e2e-preview.csv',
        rows: defaultsResponse.input_lines,
        issues: [],
        summary: {
          line_count: 2,
          accepted_row_count: 2,
          total_quantity: 210,
          issue_count: 0,
          invalid_row_count: 0,
          skipped_empty_row_count: 0,
          header_detected: true,
        },
      }),
    });
  });

  await page.route('**/api/production/paper-optimizer/runs/optimize/', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(mockRun) });
  });

  await page.route('**/api/production/paper-optimizer/runs/9999/export_excel/', async (route) => {
    const minimalXlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="popt-e2e-test.xlsx"',
      },
      body: minimalXlsx,
    });
  });

  await login(page, adminUser.username, adminUser.password);
  await page.goto('/paper-optimization');

  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();
  await expect(page.getByText(/run gần đây/i)).toHaveCount(0);
  await expect(page.getByText(/lịch sử run/i)).toHaveCount(0);
  await expect(page.getByTestId('paper-optimizer-raw-width-summary')).toContainText(/\/35/);
  await expect(page.getByTestId('paper-optimizer-raw-width-toggle')).toContainText(/m.*r.*ng/i);
  await page.getByTestId('paper-optimizer-raw-width-toggle').click();
  await expect(page.getByTestId('paper-optimizer-raw-width-toggle')).toContainText(/thu.*g.*n/i);
  await expect(page.getByTestId('paper-optimizer-min-purchase-length')).toHaveValue('5000');

  await page.locator('input[type="file"]').setInputFiles(previewFixturePath);
  await expect(page.getByTestId('paper-optimizer-preview-alert')).toContainText(/2 d.ng h.p l./i);
  await expect(page.locator('input[value="e2e-preview.csv"]')).toBeVisible();

  await page.getByTestId('paper-optimizer-generate').click();
  await expect(page.getByTestId('paper-optimizer-result-ready')).toBeVisible();
  await expect(page.getByText(/^POPT-E2E-TEST$/)).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-purchase-spec-table')).toContainText('13.664');

  await page.getByTestId('paper-optimizer-result-tabs').getByRole('tab').nth(1).click();
  await expect(page.getByRole('cell', { name: /phuong an it kho giay nhat/i })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: /t.i excel/i }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
});

test('no-feasible success hides zero tables and keeps one clear warning workspace', async ({ page }) => {
  const mockRun = buildMockRun();
  mockRun.result_payload = {
    ...(mockRun.result_payload as Record<string, unknown>),
    result_state: 'no_feasible_candidate',
    purchase_spec_rows: [],
    selected_plan: {
      plan_code: 'LOWEST_TOTAL_COST',
      plan_name: 'Phuong an chi phi thap nhat',
      scenario_code: 'TARGET',
      total_converted_cost: 0,
      unique_raw_width_count: 0,
      unique_purchase_spec_count: 0,
      final_group_count: 0,
      technical_waste_rate: 0,
      all_ncc_passed: false,
      meets_target_and_cap: false,
      is_placeholder_no_feasible: true,
      public_plan_convergence_reason_code: 'no_feasible_candidate',
      public_plan_selection_note: 'Chua tim duoc candidate dat NCC.',
    },
    final_plan_alternatives: [
      {
        plan_code: 'LOWEST_TOTAL_COST',
        plan_name: 'Phuong an chi phi thap nhat',
        scenario_code: 'TARGET',
        total_converted_cost: 0,
        unique_raw_width_count: 0,
        unique_purchase_spec_count: 0,
        final_group_count: 0,
        technical_waste_rate: 0,
        all_ncc_passed: false,
        meets_target_and_cap: false,
        is_placeholder_no_feasible: true,
        public_plan_convergence_reason_code: 'no_feasible_candidate',
      },
    ],
    allocation_details: [],
    reverse_check_rows: [],
    leftovers: [],
    stats: {
      optimizer_mode: 'full_optimizer',
      candidate_count: 0,
      feasible_alternative_count: 0,
      no_feasible_candidate: true,
      displayable_result: false,
      purchase_spec_ncc_failed_count: 0,
      engine_primary: 'v2',
      engine_fallback_used: false,
      engine_fallback_source: 'none',
      engine_fallback_reason_code: 'no_viable_public_alternatives',
    },
  };

  await mockDefaults(page);

  await page.route('**/api/production/paper-optimizer/runs/optimize/', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(mockRun) });
  });

  await login(page, adminUser.username, adminUser.password);
  await page.goto('/paper-optimization');

  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();
  await page.getByTestId('paper-optimizer-generate').click();

  await expect(page.getByTestId('paper-optimizer-result-no-feasible')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-purchase-spec-table')).toHaveCount(0);
  await expect(page.getByTestId('paper-optimizer-result-ready')).toHaveCount(0);
  await expect(page.getByTestId('paper-optimizer-export')).toBeDisabled();
});

test('preview warning keeps only one workspace and does not show history or template controls', async ({ page }) => {
  await mockDefaults(page);

  await page.route('**/api/production/paper-optimizer/runs/upload_preview/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source_filename: 'preview-invalid.csv',
        rows: [defaultsResponse.input_lines[0]],
        issues: [
          { row_number: 3, severity: 'error', code: 'missing_required_fields', message: 'Thieu truong bat buoc.' },
          { row_number: 4, severity: 'error', code: 'invalid_quantity', message: 'So luong khong hop le.' },
        ],
        summary: {
          line_count: 1,
          accepted_row_count: 1,
          total_quantity: 120,
          issue_count: 2,
          invalid_row_count: 2,
          skipped_empty_row_count: 0,
          header_detected: true,
        },
      }),
    });
  });

  await login(page, adminUser.username, adminUser.password);
  await page.goto('/paper-optimization');

  await expect(page.getByText(/run gần đây/i)).toHaveCount(0);
  await expect(page.getByText(/lịch sử run/i)).toHaveCount(0);
  await expect(page.getByText(/template NCC/i)).toHaveCount(0);
  await expect(page.getByTestId('paper-optimizer-raw-width-summary')).toContainText(/\/35/);

  await page.locator('input[type="file"]').setInputFiles(previewInvalidFixturePath);
  const previewAlert = page.getByTestId('paper-optimizer-preview-alert');
  await expect(previewAlert).toBeVisible();
  await expect.poll(async () => (await previewAlert.textContent()) ?? '').not.toEqual('');
  await expect(previewAlert).toContainText(/2 d.ng c.n xem l.i/i);
  await expect(previewAlert).toContainText(/d.ng 3/i);
  await expect(previewAlert).toContainText(/d.ng 4/i);
});

test('success without purchase rows shows a visible explanation instead of a blank result area', async ({ page }) => {
  const mockRun = buildMockRun();
  mockRun.result_payload = {
    ...(mockRun.result_payload as Record<string, unknown>),
    result_state: 'success',
    selected_plan: null,
    final_plan_alternatives: [],
    allocation_details: [],
    reverse_check_rows: [],
    leftovers: [],
    stats: {
      optimizer_mode: 'full_optimizer',
      candidate_count: 1,
      feasible_alternative_count: 1,
      no_feasible_candidate: false,
      displayable_result: false,
      purchase_spec_ncc_failed_count: 0,
      engine_primary: 'v2',
      engine_fallback_used: false,
      engine_fallback_source: 'none',
    },
  };

  await mockDefaults(page);

  await page.route('**/api/production/paper-optimizer/runs/optimize/', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(mockRun) });
  });

  await login(page, adminUser.username, adminUser.password);
  await page.goto('/paper-optimization');

  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();
  await page.getByTestId('paper-optimizer-generate').click();

  await expect(page.getByTestId('paper-optimizer-result-empty')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-result-empty')).toContainText(/mua cu.*i.*hi.n th./i);
  await expect(page.getByTestId('paper-optimizer-result-empty')).toContainText('Xem debug');
});
