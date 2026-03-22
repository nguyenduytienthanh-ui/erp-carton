import { expect, test, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

async function chooseSelectOptionByTestId(page: Page, testId: string, optionLabel: string) {
  await page.getByTestId(testId).locator('.ant-select').click({ force: true });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(testId)).toContainText(optionLabel);
}

test('admin can save and re-apply preset in user provisioning desk', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `provisioning-preset-${seed}`;
  const presetName = `Provisioning ${seed}`;

  await page.goto('/admin/user-provisioning');
  await expect(page.getByTestId('user-provisioning-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('user-provisioning-command-watchlist-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('user-provisioning-save-view').click();
  await page.reload();
  await expect(page.getByTestId('user-provisioning-command-strip')).toBeVisible();
  searchInput = page.getByTestId('user-provisioning-command-watchlist-search').locator('input');
  await searchInput.fill('tam-thoi-provisioning');
  await page.getByTestId('user-provisioning-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('user-provisioning-open-preset-modal').click();
  await page.getByTestId('user-provisioning-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('user-provisioning-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-provisioning');
  await chooseSelectOptionByTestId(page, 'user-provisioning-preset-select', presetName);
  await page.getByTestId('user-provisioning-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in user offboarding desk', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `offboarding-preset-${seed}`;
  const presetName = `Offboarding ${seed}`;

  await page.goto('/admin/user-lifecycle');
  await expect(page.getByTestId('user-offboarding-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('user-offboarding-command-watchlist-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('user-offboarding-save-view').click();
  await page.reload();
  await expect(page.getByTestId('user-offboarding-command-strip')).toBeVisible();
  searchInput = page.getByTestId('user-offboarding-command-watchlist-search').locator('input');
  await searchInput.fill('tam-thoi-offboarding');
  await page.getByTestId('user-offboarding-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('user-offboarding-open-preset-modal').click();
  await page.getByTestId('user-offboarding-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('user-offboarding-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-offboarding');
  await chooseSelectOptionByTestId(page, 'user-offboarding-preset-select', presetName);
  await page.getByTestId('user-offboarding-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in onboarding studio', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `onboarding-preset-${seed}`;
  const presetName = `Onboarding ${seed}`;

  await page.goto('/admin/onboarding-studio');
  await expect(page.getByTestId('onboarding-studio-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('onboarding-studio-command-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('onboarding-studio-save-view').click();
  await page.reload();
  await expect(page.getByTestId('onboarding-studio-command-strip')).toBeVisible();
  searchInput = page.getByTestId('onboarding-studio-command-search').locator('input');
  await searchInput.fill('tam-thoi-onboarding');
  await page.getByTestId('onboarding-studio-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('onboarding-studio-open-preset-modal').click();
  await page.getByTestId('onboarding-studio-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('onboarding-studio-preset-name')).toBeHidden();
  await searchInput.fill('sau-khi-luu-onboarding');
  await chooseSelectOptionByTestId(page, 'onboarding-studio-preset-select', presetName);
  await page.getByTestId('onboarding-studio-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});
