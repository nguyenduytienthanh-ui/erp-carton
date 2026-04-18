import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

test('admin can inspect purchase order forecast workspace', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/purchase-order-forecast');
  await expect(page.locator('main').getByText('Trung tam du bao don mua', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuat du bao CSV' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Tao PO tu .* dong da chon/ })).toBeVisible();
  await expect(page.getByText('Danh muc uu tien mua', { exact: true })).toBeVisible();
  await expect(page.getByText('Danh sach goi y mua', { exact: true })).toBeVisible();
});

test('admin can inspect inventory stock workspace', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/inventory-stock');
  await expect(page.locator('main').getByText('Trung tam dieu phoi ton kho', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Tim san pham, kho, vi tri...')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuat CSV' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xoa bo loc' })).toBeVisible();
  await expect(page.getByText('Danh muc uu tien xu ly', { exact: true })).toBeVisible();
  await expect(page.getByText('Bang ton kho thuc thi', { exact: true })).toBeVisible();
});
