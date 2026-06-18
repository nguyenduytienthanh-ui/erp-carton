import { expect, test, type Page, type Route } from '@playwright/test';

const emptyPage = { count: 0, next: null, previous: null, results: [] };

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

async function setupCustomerListMockApi(page: Page, customerWriteRequests: string[]) {
  await page.addInitScript(() => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem('refresh_token', 'mock-refresh-token');
    window.localStorage.setItem(
      'user',
      JSON.stringify({ id: 1, username: 'uat_admin', is_staff: true, is_superuser: true, roles: [] }),
    );
  });

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path.startsWith('/api/customers/') && method !== 'GET') {
      customerWriteRequests.push(`${method} ${path}`);
      return json(route, { error: 'Customer write blocked in read-only baseline test' }, 405);
    }

    if (path === '/api/users/me/' && method === 'GET') {
      return json(route, {
        id: 1,
        username: 'uat_admin',
        is_staff: true,
        is_superuser: true,
        is_active: true,
        is_locked: false,
        roles: [],
      });
    }

    if (path.startsWith('/api/preferences/')) {
      if (method === 'GET') return json(route, { config: {} });
      return json(route, { config: request.postDataJSON()?.config ?? {} });
    }

    if (path === '/api/notifications/unread/' && method === 'GET') {
      return json(route, []);
    }

    if (path === '/api/customers/' && method === 'GET') {
      return json(route, emptyPage);
    }

    if (method === 'GET') {
      return json(route, emptyPage);
    }

    return json(route, {});
  });
}

test('Customer list renders empty baseline without render loop or write requests', async ({ page }) => {
  const customerWriteRequests: string[] = [];
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    consoleMessages.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await setupCustomerListMockApi(page, customerWriteRequests);

  await page.goto('/customers');

  await expect(page.getByRole('heading', { name: 'Khách hàng' })).toBeVisible();
  await expect(page.getByText(/Chưa có khách hàng/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Lọc/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Thêm mới/i })).toBeVisible();
  await expect(page.getByText('Đã xảy ra lỗi giao diện')).toHaveCount(0);

  await page.getByRole('button', { name: /Lọc/i }).click();
  await expect(page.getByText('Bộ lọc khách hàng')).toBeVisible();
  await page.getByRole('button', { name: 'Xong' }).click();

  await page.getByRole('button', { name: /Thêm mới/i }).click();
  await expect(page.getByText('Thêm khách hàng')).toBeVisible();
  await page.getByRole('button', { name: /Huỷ|Hủy/i }).click();
  await expect(page.getByRole('dialog', { name: /Thêm khách hàng/i })).toBeHidden();
  await expect(page.getByText(/Chưa có khách hàng/i)).toBeVisible();

  expect(customerWriteRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleMessages.some((text) => text.includes('Maximum update depth exceeded'))).toBe(false);
});
