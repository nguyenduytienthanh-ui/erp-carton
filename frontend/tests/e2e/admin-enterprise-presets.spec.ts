import { expect, test, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

async function chooseSelectOptionByTestId(page: Page, testId: string, optionLabel: string) {
  await page.getByTestId(testId).locator('.ant-select').click({ force: true });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(testId)).toContainText(optionLabel);
}

test('admin can save and re-apply preset in admin observability center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `observability-preset-${seed}`;
  const presetName = `Observability ${seed}`;

  await page.goto('/admin/observability');
  await expect(page.getByTestId('admin-observability-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('admin-observability-activity-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('admin-observability-save-view').click();
  await page.reload();
  await expect(page.getByTestId('admin-observability-command-strip')).toBeVisible();
  searchInput = page.getByTestId('admin-observability-activity-search').locator('input');
  await searchInput.fill('tam-thoi-observability');
  await page.getByTestId('admin-observability-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('admin-observability-open-preset-modal').click();
  await page.getByTestId('admin-observability-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('admin-observability-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-observability');
  await chooseSelectOptionByTestId(page, 'admin-observability-preset-select', presetName);
  await page.getByTestId('admin-observability-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in access review center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `review-preset-${seed}`;
  const presetName = `Access Review ${seed}`;

  await page.goto('/admin/access-reviews');
  await expect(page.getByTestId('access-review-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('access-review-command-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('access-review-save-view').click();
  await page.reload();
  await expect(page.getByTestId('access-review-command-strip')).toBeVisible();
  searchInput = page.getByTestId('access-review-command-search').locator('input');
  await searchInput.fill('tam-thoi-review');
  await page.getByTestId('access-review-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('access-review-open-preset-modal').click();
  await page.getByTestId('access-review-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('access-review-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-review');
  await chooseSelectOptionByTestId(page, 'access-review-preset-select', presetName);
  await page.getByTestId('access-review-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in access exception center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `exception-preset-${seed}`;
  const presetName = `Access Exception ${seed}`;

  await page.goto('/admin/access-exceptions');
  await expect(page.getByTestId('access-exception-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('access-exception-command-policy-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('access-exception-save-view').click();
  await page.reload();
  await expect(page.getByTestId('access-exception-command-strip')).toBeVisible();
  searchInput = page.getByTestId('access-exception-command-policy-search').locator('input');
  await searchInput.fill('tam-thoi-exception');
  await page.getByTestId('access-exception-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('access-exception-open-preset-modal').click();
  await page.getByTestId('access-exception-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('access-exception-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-exception');
  await chooseSelectOptionByTestId(page, 'access-exception-preset-select', presetName);
  await page.getByTestId('access-exception-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});
