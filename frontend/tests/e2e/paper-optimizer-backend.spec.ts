import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

type PaperOptimizerBootstrapPayload = {
  route: string;
  preview_fixture_path?: string;
};

function parseBootstrapPayload(raw: string): PaperOptimizerBootstrapPayload {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith('{'));
  if (!jsonLine) {
    throw new Error(`Bootstrap command did not return a JSON payload.\n${raw}`);
  }
  return JSON.parse(jsonLine) as PaperOptimizerBootstrapPayload;
}

function bootstrapPaperOptimizerDemo(
  scenario:
    | 'canonical'
    | 'fresh-optimize'
    | 'preview-warning'
    | 'failed'
    | 'legacy-fallback'
    | 'no-feasible'
    | 'legacy-no-feasible',
) {
  const backendRoot = path.resolve(process.cwd(), '..', 'backend');
  const raw = execFileSync(
    'python',
    [
      'manage.py',
      'bootstrap_paper_optimizer_demo',
      '--json',
      '--reset',
      '--scenario',
      scenario,
      '--username',
      adminUser.username,
      '--password',
      adminUser.password,
    ],
    {
      cwd: backendRoot,
      encoding: 'utf-8',
    },
  );
  return parseBootstrapPayload(raw);
}

test('canonical run opens as a single current workspace with purchase-spec table', async ({ page }) => {
  const payload = bootstrapPaperOptimizerDemo('canonical');
  await login(page, adminUser.username, adminUser.password);

  await page.goto(payload.route);
  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-raw-width-summary')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-purchase-spec-table')).toBeVisible();
});

test('preview warning renders row-level issues with real backend', async ({ page }) => {
  const payload = bootstrapPaperOptimizerDemo('preview-warning');
  await login(page, adminUser.username, adminUser.password);

  await page.goto(payload.route);
  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(payload.preview_fixture_path as string);

  const previewAlert = page.getByTestId('paper-optimizer-preview-alert');
  await expect(previewAlert).toBeVisible();
  await expect.poll(async () => (await previewAlert.textContent()) ?? '').not.toEqual('');
  const previewText = (await previewAlert.textContent()) ?? '';
  expect(previewText).toMatch(/D.ng 3/i);
  expect(previewText).toMatch(/D.ng 4/i);
  expect(previewText).toMatch(/D.ng 6/i);
});

test('fresh optimize from the main workspace shows the new result immediately', async ({ page }) => {
  const payload = bootstrapPaperOptimizerDemo('fresh-optimize');
  await login(page, adminUser.username, adminUser.password);

  await page.goto(payload.route);
  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-result-loading')).toHaveCount(0);

  await page.getByTestId('paper-optimizer-generate').click();
  await expect(page.getByTestId('paper-optimizer-result-loading')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-result-ready')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-purchase-spec-table')).toBeVisible({ timeout: 30000 });
  await expect
    .poll(async () => page.getByTestId('paper-optimizer-purchase-spec-table').locator('tbody tr').count())
    .toBeGreaterThan(0);
  await expect(page.getByTestId('paper-optimizer-result-section')).toBeInViewport();
  await expect(page.getByText(/^POPT-/)).toBeVisible();
});

test('no-feasible run shows a warning state instead of zero tables and blocks export', async ({ page }) => {
  const payload = bootstrapPaperOptimizerDemo('no-feasible');
  await login(page, adminUser.username, adminUser.password);

  await page.goto(payload.route);
  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-result-no-feasible')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-purchase-spec-table')).toHaveCount(0);
  await expect(page.getByTestId('paper-optimizer-result-ready')).toHaveCount(0);
  await expect(page.getByTestId('paper-optimizer-export')).toBeDisabled();

  await page.getByRole('button', { name: /Xem debug/i }).click();
  await expect(page.getByTestId('paper-optimizer-no-feasible-debug')).toBeVisible();
});

test('legacy no-feasible run is normalized into the same warning workspace', async ({ page }) => {
  const payload = bootstrapPaperOptimizerDemo('legacy-no-feasible');
  await login(page, adminUser.username, adminUser.password);

  await page.goto(payload.route);
  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-result-no-feasible')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-purchase-spec-table')).toHaveCount(0);
  await expect(page.getByTestId('paper-optimizer-export')).toBeDisabled();
});

test('failed run keeps actions inside the same workspace and can rerun', async ({ page }) => {
  const payload = bootstrapPaperOptimizerDemo('failed');
  await login(page, adminUser.username, adminUser.password);

  await page.goto(payload.route);
  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();
  await expect(page.getByTestId('paper-optimizer-failed-actions')).toBeVisible();
  const failedActions = page.getByTestId('paper-optimizer-failed-actions');
  await expect(failedActions.locator('button')).toHaveCount(3);

  await failedActions.locator('button').nth(2).click();
  await expect(page).not.toHaveURL(/run_id=/);
  await expect(page.getByTestId('paper-optimizer-purchase-spec-table')).toBeVisible();
});

test('legacy fallback run shows fallback metadata in debug tab', async ({ page }) => {
  const payload = bootstrapPaperOptimizerDemo('legacy-fallback');
  await login(page, adminUser.username, adminUser.password);

  await page.goto(payload.route);
  await expect(page.getByTestId('paper-optimizer-root')).toBeVisible();

  await page.locator('.ant-tabs-tab').filter({ hasText: 'Debug' }).click();
  await expect(page.getByText(/legacy/i).first()).toBeVisible();
  await expect(page.getByText('no_viable_public_alternatives')).toBeVisible();
});
