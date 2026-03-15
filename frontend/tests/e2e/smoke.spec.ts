import { expect, test, type Page } from '@playwright/test';

const adminUser = {
  username: process.env.E2E_ADMIN_USERNAME || 'uat_admin',
  password: process.env.E2E_ADMIN_PASSWORD || 'Demo123!',
};

const salesUser = {
  username: process.env.E2E_SALES_USERNAME || 'uat_sales',
  password: process.env.E2E_SALES_PASSWORD || 'Demo123!',
};

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}

test('redirects anonymous governance access to login', async ({ page }) => {
  await page.goto('/admin/module-permissions');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
});

test('admin user can access governance pages', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/operations-log');
  await expect(page.getByText('Nhật ký vận hành')).toBeVisible();

  await page.goto('/admin/module-permissions');
  await expect(page.getByText('Phân quyền module')).toBeVisible();

  await page.goto('/admin/module-permissions-history');
  await expect(page.getByText('Lịch sử phân quyền')).toBeVisible();
});

test('sales user is redirected away from admin permission settings', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/operations-log');
  await expect(page).not.toHaveURL(/\/operations-log$/);

  await page.goto('/admin/module-permissions');
  await expect(page).not.toHaveURL(/\/admin\/module-permissions$/);
});

test('admin user can access new business modules and reports center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);
  await expect(page).toHaveURL(/\/$/);

  const pagesToCheck = [
    { path: '/reports', text: 'Trung tâm báo cáo' },
    { path: '/suppliers', text: 'Nhà cung cấp' },
    { path: '/purchase-orders', text: 'Đơn mua' },
    { path: '/purchase-receipts', text: 'Phiếu nhập mua' },
    { path: '/production-orders', text: 'Sản xuất' },
    { path: '/receivables', text: 'Công nợ phải thu' },
    { path: '/payables', text: 'Công nợ phải trả' },
  ];

  for (const item of pagesToCheck) {
    await page.goto(item.path);
    await expect(page.locator('main').getByText(item.text).first()).toBeVisible();
  }
});

test('admin workflow pages expose new entity options', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/workflow-task-templates');
  await expect(page.getByText('Mẫu nhiệm vụ quy trình')).toBeVisible();

  await page.getByRole('button', { name: 'Áp dụng bộ mẫu' }).click();
  const playbookEntitySelect = page.locator('.ant-modal .ant-select').first();
  await playbookEntitySelect.click();
  await expect(page.getByText('Đơn mua')).toBeVisible();
  await expect(page.getByText('Lệnh sản xuất')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.goto('/workflow-pipeline');
  await expect(page.getByText('Bảng luồng công việc')).toBeVisible();

  await page.goto('/workflow-analytics');
  await expect(page.getByText('Phân tích quy trình')).toBeVisible();
});
