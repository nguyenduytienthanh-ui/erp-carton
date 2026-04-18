import { expect, type Page } from '@playwright/test';

const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:8000/api';

export async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => window.localStorage.getItem('access_token'));
  expect(token).toBeTruthy();
  return token as string;
}

export async function apiGet<T = unknown>(
  page: Page,
  token: string,
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const response = await page.request.get(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<T>;
}

export async function apiPost<T = unknown>(
  page: Page,
  token: string,
  path: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const response = await page.request.post(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<T>;
}

export async function provisionDisposableUser(page: Page, token: string, key: string) {
  const username = `pw_${key}_${Date.now()}`;
  const payload = await apiPost<{
    user: { id: number; username: string; full_name: string };
  }>(page, token, '/users/provision_user/', {
    username,
    email: `${username}@example.com`,
    first_name: 'Playwright',
    last_name: key,
    is_active: true,
    is_staff: false,
    create_tasks: false,
    include_security_task: false,
    password_mode: 'generated',
  });
  return payload.user;
}

export async function findFirstRoleAndTeam(page: Page, token: string) {
  const workspace = await apiGet<{
    role_catalog?: Array<{ id: number; name: string }>;
    team_catalog?: Array<{ id: number; name: string }>;
  }>(page, token, '/users/directory_summary/');
  return workspace;
}
