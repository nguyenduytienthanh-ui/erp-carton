import { expect, test, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

async function chooseSelectOptionByTestId(page: Page, testId: string, optionLabel: string) {
  await page.getByTestId(testId).locator('.ant-select').click({ force: true });
  await page.locator('.ant-select-item-option-content').filter({ hasText: optionLabel }).last().click();
  await expect(page.getByTestId(testId)).toContainText(optionLabel);
}

async function chooseEdgeAntdOption(page: Page, testId: string, edge: 'first' | 'last') {
  const wrapper = page.getByTestId(testId);
  await wrapper.locator('.ant-select').click({ force: true });
  const options = page.locator('.ant-select-item-option-content');
  await expect(options.first()).toBeVisible();
  const target = edge === 'last' ? options.last() : options.first();
  const label = (await target.innerText()).trim();
  await target.click();
  await expect(wrapper).toContainText(label);
  return label;
}

test('admin can save and re-apply preset in customer portal command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const presetName = `Khách hàng ${seed}`;

  await page.goto('/customer-portal');
  await expect(page.getByTestId('customer-portal-command-strip')).toBeVisible();

  const savedLabel = await chooseEdgeAntdOption(page, 'customer-portal-customer-select', 'last');
  await page.getByTestId('customer-portal-save-view').click();
  await page.reload();
  await expect(page.getByTestId('customer-portal-command-strip')).toBeVisible();
  await chooseEdgeAntdOption(page, 'customer-portal-customer-select', 'first');
  await page.getByTestId('customer-portal-restore-view').click();
  await expect(page.getByTestId('customer-portal-customer-select')).toContainText(savedLabel);

  await page.getByTestId('customer-portal-open-preset-modal').click();
  await page.getByTestId('customer-portal-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('customer-portal-preset-name')).toBeHidden();
  await chooseEdgeAntdOption(page, 'customer-portal-customer-select', 'first');
  await chooseSelectOptionByTestId(page, 'customer-portal-preset-select', presetName);
  await page.getByTestId('customer-portal-apply-preset').click();
  await expect(page.getByTestId('customer-portal-customer-select')).toContainText(savedLabel);
});

test('admin can save and re-apply preset in sales analytics command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const presetName = `Doanh thu ${seed}`;

  await page.goto('/sales-analytics');
  await expect(page.getByTestId('sales-analytics-command-strip')).toBeVisible();

  const rangeSelect = page.getByTestId('sales-analytics-range-mode').locator('select');
  await rangeSelect.selectOption('rolling_6m');
  await expect(rangeSelect).toHaveValue('rolling_6m');
  await page.getByTestId('sales-analytics-save-view').click();
  await page.reload();
  await expect(page.getByTestId('sales-analytics-command-strip')).toBeVisible();
  await rangeSelect.selectOption('rolling_3m');
  await page.getByTestId('sales-analytics-restore-view').click();
  await expect(rangeSelect).toHaveValue('rolling_6m');

  await page.getByTestId('sales-analytics-open-preset-modal').click();
  await page.getByTestId('sales-analytics-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('sales-analytics-preset-name')).toBeHidden();
  await rangeSelect.selectOption('rolling_12m');
  await page.getByTestId('sales-analytics-preset-select').locator('select').selectOption({ label: presetName });
  await page.getByTestId('sales-analytics-apply-preset').click();
  await expect(rangeSelect).toHaveValue('rolling_6m');
});

test('admin can save and re-apply preset in supplier analytics command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const presetName = `Nhà cung cấp ${seed}`;

  await page.goto('/supplier-analytics');
  await expect(page.getByTestId('supplier-analytics-command-strip')).toBeVisible();

  await chooseSelectOptionByTestId(page, 'supplier-analytics-focus-select', 'Cần rà soát');
  await chooseSelectOptionByTestId(page, 'supplier-analytics-sort-select', 'Lead time');
  await page.getByTestId('supplier-analytics-save-view').click();
  await page.reload();
  await expect(page.getByTestId('supplier-analytics-command-strip')).toBeVisible();
  await chooseSelectOptionByTestId(page, 'supplier-analytics-focus-select', 'Toàn bộ nhà cung cấp');
  await chooseSelectOptionByTestId(page, 'supplier-analytics-sort-select', 'Điểm tổng hợp');
  await page.getByTestId('supplier-analytics-restore-view').click();
  await expect(page.getByTestId('supplier-analytics-focus-select')).toContainText('Cần rà soát');
  await expect(page.getByTestId('supplier-analytics-sort-select')).toContainText('Lead time');

  await page.getByTestId('supplier-analytics-open-preset-modal').click();
  await page.getByTestId('supplier-analytics-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu/i }).click();
  await expect(page.getByTestId('supplier-analytics-preset-name')).toBeHidden();
  await chooseSelectOptionByTestId(page, 'supplier-analytics-focus-select', 'Đối tác ưu tiên');
  await chooseSelectOptionByTestId(page, 'supplier-analytics-sort-select', 'Chất lượng');
  await chooseSelectOptionByTestId(page, 'supplier-analytics-preset-select', presetName);
  await page.getByTestId('supplier-analytics-apply-preset').click();
  await expect(page.getByTestId('supplier-analytics-focus-select')).toContainText('Cần rà soát');
  await expect(page.getByTestId('supplier-analytics-sort-select')).toContainText('Lead time');
});
