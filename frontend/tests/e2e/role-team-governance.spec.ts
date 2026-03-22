import { expect, test } from '@playwright/test';

import { adminUser, login, salesUser } from './helpers/auth';

test('admin can access role team governance command center', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/roles-teams');

  await expect(page.getByRole('heading', { name: /Trung tâm quản trị vai trò và nhóm/i })).toBeVisible();
  await expect(page.getByText('Watchlist quản trị')).toBeVisible();
  await expect(page.getByText('Xưởng vai trò')).toBeVisible();
  await expect(page.getByText('Xưởng nhóm')).toBeVisible();
  await expect(page.getByRole('button', { name: /Mở phân quyền phân hệ/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Xuất CSV/i }).first()).toBeVisible();
});

test('admin can open role and team studios with templates and presets', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/admin/roles-teams');

  await page.getByRole('button', { name: /Tạo vai trò/i }).click();
  const roleDrawer = page.getByRole('dialog', { name: /Xưởng vai trò/i });
  await expect(roleDrawer.getByLabel('Mã vai trò')).toBeVisible();
  await expect(roleDrawer.getByText('Mẫu áp dụng nhanh')).toBeVisible();
  await expect(roleDrawer.getByRole('button', { name: /Governance|Finance|Operations|Audit/i }).first()).toBeVisible();
  await roleDrawer.getByRole('button', { name: /^Hủy$/ }).click();
  await expect(roleDrawer).toBeHidden();

  await page.getByRole('button', { name: /Tạo nhóm/i }).click();
  const teamDrawer = page.getByRole('dialog', { name: /Xưởng nhóm/i });
  await expect(teamDrawer).toBeVisible();
  await expect(teamDrawer.getByPlaceholder(/Ví dụ: OPS_CELL/i)).toBeVisible();
  await expect(teamDrawer.getByText('Mẫu nhóm')).toBeVisible();
  await expect(teamDrawer.getByRole('button', { name: /Back Office|Sales Hub|Finance Pod|Ops Cell/i }).first()).toBeVisible();
});

test('sales user is redirected away from role team governance', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.goto('/admin/roles-teams');

  await expect(page).not.toHaveURL(/\/admin\/roles-teams$/);
});
