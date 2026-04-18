import { expect, test, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

async function chooseSelectOptionByTestId(page: Page, testId: string, optionLabel: string) {
  await page.getByTestId(testId).locator('.ant-select').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(testId)).toContainText(optionLabel);
}

test('admin can save and re-apply preset in audit center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `audit-preset-${seed}`;
  const presetName = `Audit ${seed}`;

  await page.goto('/admin/audit-center');
  await expect(page.getByTestId('admin-audit-center-recent-activity')).toBeVisible();

  const searchInput = page.getByTestId('admin-audit-center-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('admin-audit-center-save-view').click();
  await searchInput.fill('tam-thoi-audit');
  await page.getByTestId('admin-audit-center-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('admin-audit-center-open-preset-modal').click();
  await page.getByTestId('admin-audit-center-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await searchInput.fill('sau-khi-luu-audit');
  await chooseSelectOptionByTestId(page, 'admin-audit-center-preset-select', presetName);
  await page.getByTestId('admin-audit-center-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in access governance center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `governance-preset-${seed}`;
  const presetName = `Governance ${seed}`;

  await page.goto('/admin/access-governance');
  await expect(page.getByTestId('access-governance-command-strip')).toBeVisible();

  const searchInput = page.getByTestId('access-governance-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('access-governance-save-view').click();
  await searchInput.fill('tam-thoi-governance');
  await page.getByTestId('access-governance-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('access-governance-open-preset-modal').click();
  await page.getByTestId('access-governance-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await searchInput.fill('sau-khi-luu-governance');
  await chooseSelectOptionByTestId(page, 'access-governance-preset-select', presetName);
  await page.getByTestId('access-governance-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in approval control tower', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `approval-preset-${seed}`;
  const presetName = `Approval ${seed}`;

  await page.goto('/admin/approval-control-tower');
  await expect(page.getByTestId('approval-control-tower-command-strip')).toBeVisible();

  const searchInput = page.getByTestId('approval-control-tower-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('approval-control-tower-save-view').click();
  await searchInput.fill('tam-thoi-approval');
  await page.getByTestId('approval-control-tower-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('approval-control-tower-open-preset-modal').click();
  await page.getByTestId('approval-control-tower-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await searchInput.fill('sau-khi-luu-approval');
  await chooseSelectOptionByTestId(page, 'approval-control-tower-preset-select', presetName);
  await page.getByTestId('approval-control-tower-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});
