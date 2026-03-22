import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

test('admin can inspect sales analytics workspace', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/sales-analytics');
  await expect(page.locator('main').getByText('Trung tam phan tich ban hang', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuat CSV' })).toBeVisible();
  await expect(page.getByText('Bo tin hieu doanh thu', { exact: true })).toBeVisible();
  await expect(page.getByText('Top khach hang', { exact: true })).toBeVisible();
  await expect(page.getByText('Top san pham', { exact: true })).toBeVisible();
  await expect(page.getByText('Doanh thu theo trang thai don hang', { exact: true })).toBeVisible();
});

test('admin can inspect operations log workspace', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/operations-log');
  await expect(page.locator('main').getByText('Trung tam nhat ky van hanh', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Tim noi dung, nguon, hanh dong...')).toBeVisible();
  await expect(page.getByPlaceholder('Loc theo actor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tai lai' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuat CSV' })).toBeVisible();
  await expect(page.getByText('Ban ghi uu tien xu ly', { exact: true })).toBeVisible();
  await expect(page.getByText('Bo tin hieu van hanh', { exact: true })).toBeVisible();
  await expect(page.getByText('Bang nhat ky van hanh', { exact: true })).toBeVisible();
});
