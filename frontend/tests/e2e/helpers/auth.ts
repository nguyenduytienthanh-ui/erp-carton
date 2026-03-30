import { expect, type Page } from '@playwright/test';

export const adminUser = {
  username: process.env.E2E_ADMIN_USERNAME || 'uat_admin',
  password: process.env.E2E_ADMIN_PASSWORD || 'Demo123!',
};

export const salesUser = {
  username: process.env.E2E_SALES_USERNAME || 'uat_sales',
  password: process.env.E2E_SALES_PASSWORD || 'Demo123!',
};

export const financeUser = {
  username: process.env.E2E_FINANCE_USERNAME || 'uat_finance',
  password: process.env.E2E_FINANCE_PASSWORD || 'Demo123!',
};

export const hrUser = {
  username: process.env.E2E_HR_USERNAME || 'uat_hr',
  password: process.env.E2E_HR_PASSWORD || 'Demo123!',
};

export const PLAYWRIGHT_API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:8000/api';

export async function login(page: Page, username: string, password: string) {
  await page.goto('/login');

  await page.context().clearCookies();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  await page.locator('#login_username').fill(username);
  await page.locator('#login_password').fill(password);
  await page.getByRole('button', { name: /Đăng nhập/i }).click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/$/);
}
