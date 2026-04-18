import { expect, test } from '@playwright/test';
import { adminUser, login, salesUser } from './helpers/auth';

test('admin can open provisioning desk and create a new user', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  const uniqueId = Date.now();
  const username = `ops_provision_${uniqueId}`;
  const email = `ops_provision_${uniqueId}@example.com`;

  await page.goto('/admin/user-provisioning');
  await expect(page.locator('main').getByText(/Bàn cấp tài khoản người dùng|Trung tâm cấp tài khoản|Provisioning desk/i)).toBeVisible();
  await expect(page.locator('main').getByText(/Thiết kế cấp tài khoản|Account blueprint/i)).toBeVisible();

  await page.getByLabel(/Tên đăng nhập|Username/i).fill(username);
  await page.getByLabel(/Email công việc|Email/i).fill(email);
  await page.getByLabel(/Họ|First name/i).fill('Ops');
  await page.getByRole('textbox', { name: /^Tên$/ }).fill('Provisioned');

  await expect(page.getByText(/Danh sách ưu tiên cấp tài khoản|Provisioning watchlist/i)).toBeVisible();
  await page.getByRole('button', { name: /Xem trước|Preview/i }).click();
  await expect(page.getByText(/Xem trước gói cấp tài khoản|Preflight checks/i)).toBeVisible();

  await page.getByRole('button', { name: /Cấp tài khoản|Provision user/i }).click();
  await expect(page.getByText(/Bàn giao thông tin đăng nhập|Credential handoff/i)).toBeVisible();
  await expect(page.getByText(/Mật khẩu tạm thời:|Temporary password:/i)).toBeVisible();
  await expect(page.getByText(/Bước tiếp theo|Next steps/i)).toBeVisible();
});

test('sales user is redirected away from provisioning desk', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/admin/user-provisioning');
  await expect(page).not.toHaveURL(/\/admin\/user-provisioning$/);
});
