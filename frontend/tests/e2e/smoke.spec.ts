import { expect, test } from '@playwright/test';
import { adminUser, login, salesUser } from './helpers/auth';

test('redirects anonymous governance access to login', async ({ page }) => {
  await page.goto('/admin/module-permissions');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
});

test('admin user can access governance pages', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/operations-log');
  await expect(page.getByTestId('operations-log-command-strip')).toBeVisible();

  await page.goto('/admin/module-permissions');
  await expect(page.getByText('Trung tâm phân quyền phân hệ', { exact: true })).toBeVisible();

  await page.goto('/admin/module-permissions-history');
  await expect(page.getByText('Trung tâm lịch sử phân quyền phân hệ', { exact: true })).toBeVisible();
});

test('sales user is redirected away from admin permission settings', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/operations-log');
  await expect(page).not.toHaveURL(/\/operations-log$/);

  await page.goto('/admin/module-permissions');
  await expect(page).not.toHaveURL(/\/admin\/module-permissions$/);
});

test('admin user can access new business modules and reports center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const pagesToCheck = [
    { path: '/reports', kind: 'testid', value: 'reports-center-command-strip' },
    { path: '/suppliers', kind: 'text', value: 'Trung tâm nhà cung cấp' },
    { path: '/purchase-orders', kind: 'text', value: 'Trung tâm đơn mua' },
    { path: '/purchase-receipts', kind: 'text', value: 'Trung tâm phiếu nhập mua' },
    { path: '/production-orders', kind: 'text', value: 'Trung tâm lệnh sản xuất' },
    { path: '/receivables', kind: 'text', value: 'Trung tâm công nợ phải thu' },
    { path: '/payables', kind: 'text', value: 'Trung tâm công nợ phải trả' },
  ] as const;

  for (const item of pagesToCheck) {
    await page.goto(item.path);
    if (item.kind === 'testid') {
      await expect(page.getByTestId(item.value)).toBeVisible();
      continue;
    }
    await expect(page.locator('main').getByText(item.value, { exact: true }).first()).toBeVisible();
  }
});

test('admin workflow pages expose new entity options', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/workflow-task-templates');
  await expect(page.getByText('Mẫu nhiệm vụ quy trình', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Áp dụng bộ mẫu' }).click();
  const playbookEntitySelect = page.locator('.ant-modal .ant-select').first();
  await playbookEntitySelect.click();
  const playbookEntityOptions = page.locator('.ant-select-dropdown:visible').last();
  await expect(playbookEntityOptions.getByText('Đơn mua', { exact: true })).toBeVisible();
  await expect(playbookEntityOptions.getByText('Lệnh sản xuất', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.goto('/workflow-pipeline');
  await expect(page.getByText('Trung tâm điều phối quy trình', { exact: true })).toBeVisible();

  await page.goto('/workflow-analytics');
  await expect(page.getByText('Trung tâm phân tích quy trình', { exact: true })).toBeVisible();
});
