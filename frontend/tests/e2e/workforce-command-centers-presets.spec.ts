import { expect, test, type Locator, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

async function chooseVisibleAntdOptionByLabel(page: Page, trigger: Locator, label: string) {
  await trigger.click({ force: true });
  const option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: label }).last();
  await expect(option).toBeVisible();
  await option.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
  const box = await option.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

test('admin can save and re-apply preset in attendance center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `attendance-${seed}`;
  const presetName = `Attendance ${seed}`;

  await page.goto('/attendance');
  await expect(page.getByTestId('attendance-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('attendance-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('attendance-save-view').click();

  await page.reload();
  await expect(page.getByTestId('attendance-command-strip')).toBeVisible();
  searchInput = page.getByTestId('attendance-search').locator('input');
  await searchInput.fill('tam-thoi-attendance');
  await page.getByTestId('attendance-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('attendance-open-preset-modal').click();
  await page.getByTestId('attendance-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('attendance-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-attendance');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('attendance-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('attendance-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in bonus penalty center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `bonus-penalty-${seed}`;
  const presetName = `Bonus penalty ${seed}`;

  await page.goto('/bonus-penalty');
  await expect(page.getByTestId('bonus-penalty-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('bonus-penalty-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('bonus-penalty-save-view').click();

  await page.reload();
  await expect(page.getByTestId('bonus-penalty-command-strip')).toBeVisible();
  searchInput = page.getByTestId('bonus-penalty-search').locator('input');
  await searchInput.fill('tam-thoi-bonus-penalty');
  await page.getByTestId('bonus-penalty-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('bonus-penalty-open-preset-modal').click();
  await page.getByTestId('bonus-penalty-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('bonus-penalty-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-bonus-penalty');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('bonus-penalty-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('bonus-penalty-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in payroll center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `payroll-${seed}`;
  const presetName = `Payroll ${seed}`;

  await page.goto('/payroll');
  await expect(page.getByTestId('payroll-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('payroll-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('payroll-save-view').click();

  await page.reload();
  await expect(page.getByTestId('payroll-command-strip')).toBeVisible();
  searchInput = page.getByTestId('payroll-search').locator('input');
  await searchInput.fill('tam-thoi-payroll');
  await page.getByTestId('payroll-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('payroll-open-preset-modal').click();
  await page.getByTestId('payroll-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('payroll-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-payroll');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('payroll-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('payroll-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});
