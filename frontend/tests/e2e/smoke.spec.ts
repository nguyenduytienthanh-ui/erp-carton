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
