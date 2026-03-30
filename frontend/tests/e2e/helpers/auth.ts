import { expect, type APIResponse, type Page } from '@playwright/test';

export const adminUser = {
  username: process.env.E2E_ADMIN_USERNAME || 'uat_admin',
  password: process.env.E2E_ADMIN_PASSWORD || 'Demo123!',
};

export const salesUser = {
  username: process.env.E2E_SALES_USERNAME || 'uat_sales',
  password: process.env.E2E_SALES_PASSWORD || 'Demo123!',
};

type LoginApiResponse = {
  access: string;
  refresh: string;
};

type StoredUserProfile = {
  username: string;
  [key: string]: unknown;
};

const PLAYWRIGHT_API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:8000/api';

async function readJson<T>(response: APIResponse, context: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${context} thất bại với mã ${response.status()}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function login(page: Page, username: string, password: string) {
  await page.goto('/login');

  await page.context().clearCookies();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  const loginPayload = await readJson<LoginApiResponse>(
    await page.request.post(`${PLAYWRIGHT_API_BASE_URL}/auth/login/`, {
      data: { username, password },
    }),
    `Đăng nhập API cho ${username}`,
  );

  const profile = await readJson<StoredUserProfile>(
    await page.request.get(`${PLAYWRIGHT_API_BASE_URL}/users/me/`, {
      headers: {
        Authorization: `Bearer ${loginPayload.access}`,
      },
    }),
    `Tải hồ sơ người dùng ${username}`,
  );

  await page.evaluate(
    ({ access, refresh, user }) => {
      window.localStorage.setItem('access_token', access);
      window.localStorage.setItem('refresh_token', refresh);
      window.localStorage.setItem('user', JSON.stringify(user));
    },
    {
      access: loginPayload.access,
      refresh: loginPayload.refresh,
      user: profile,
    },
  );

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/$/);
}
