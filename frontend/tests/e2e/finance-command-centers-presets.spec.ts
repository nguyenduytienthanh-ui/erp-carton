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

test('admin can save and re-apply preset in accounts receivable center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `receivable-${seed}`;
  const presetName = `Receivables ${seed}`;

  await page.goto('/receivables');
  await expect(page.getByTestId('receivables-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('receivables-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('receivables-save-view').click();

  await page.reload();
  await expect(page.getByTestId('receivables-command-strip')).toBeVisible();
  searchInput = page.getByTestId('receivables-search').locator('input');
  await searchInput.fill('tam-thoi-receivable');
  await page.getByTestId('receivables-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('receivables-open-preset-modal').click();
  await page.getByTestId('receivables-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('receivables-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-receivable');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('receivables-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('receivables-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in accounts payable center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `payable-${seed}`;
  const presetName = `Payables ${seed}`;

  await page.goto('/payables');
  await expect(page.getByTestId('payables-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('payables-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('payables-save-view').click();

  await page.reload();
  await expect(page.getByTestId('payables-command-strip')).toBeVisible();
  searchInput = page.getByTestId('payables-search').locator('input');
  await searchInput.fill('tam-thoi-payable');
  await page.getByTestId('payables-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('payables-open-preset-modal').click();
  await page.getByTestId('payables-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('payables-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-payable');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('payables-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('payables-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});

test('admin can save and re-apply preset in bank reconciliation center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const seed = Date.now();
  const searchValue = `bank-recon-${seed}`;
  const presetName = `Bank reconciliation ${seed}`;

  await page.goto('/bank-reconciliation');
  await expect(page.getByTestId('bank-reconciliation-command-strip')).toBeVisible();

  let searchInput = page.getByTestId('bank-reconciliation-search').locator('input');
  await searchInput.fill(searchValue);
  await page.getByTestId('bank-reconciliation-save-view').click();

  await page.reload();
  await expect(page.getByTestId('bank-reconciliation-command-strip')).toBeVisible();
  searchInput = page.getByTestId('bank-reconciliation-search').locator('input');
  await searchInput.fill('tam-thoi-bank-recon');
  await page.getByTestId('bank-reconciliation-restore-view').click();
  await expect(searchInput).toHaveValue(searchValue);

  await page.getByTestId('bank-reconciliation-open-preset-modal').click();
  await page.getByTestId('bank-reconciliation-preset-name').fill(presetName);
  await page.locator('.ant-modal-root').getByRole('button', { name: /Lưu mẫu|Luu mau/i }).click();
  await expect(page.getByTestId('bank-reconciliation-preset-name')).toBeHidden();

  await searchInput.fill('sau-khi-luu-bank-recon');
  await chooseVisibleAntdOptionByLabel(
    page,
    page.getByTestId('bank-reconciliation-preset-select').locator('.ant-select'),
    presetName,
  );
  await page.getByTestId('bank-reconciliation-apply-preset').click();
  await expect(searchInput).toHaveValue(searchValue);
});
