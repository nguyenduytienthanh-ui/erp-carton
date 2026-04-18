import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

test('admin can inspect customer portal workspace', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/customer-portal');
  await expect(page.locator('main').getByText('Ban dieu phoi khach hang', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByRole('combobox').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuat don' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuat hoa don' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuat thu tien' })).toBeVisible();
  await expect(page.locator('main').getByText('Khach hang dang theo doi', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText('Bo tin hieu uu tien', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText('Luong giao dich', { exact: true })).toBeVisible();
});

test('admin can inspect inventory forecast workspace', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/inventory-forecast');
  await expect(page.locator('main').getByText('Bang dieu khien du bao ton kho', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuat CSV' })).toBeVisible();
  await expect(page.locator('main').getByText('Danh muc uu tien tai bo sung', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText('Khung quyet dinh', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText('Bang du bao ton kho', { exact: true })).toBeVisible();
});
