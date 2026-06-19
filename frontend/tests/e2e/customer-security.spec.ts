import { expect, test, type Page, type Route } from '@playwright/test';

type CustomerAction =
  | 'VIEW'
  | 'CREATE'
  | 'EDIT'
  | 'SUBMIT'
  | 'APPROVE'
  | 'REJECT'
  | 'IMPORT'
  | 'EXPORT'
  | 'ASSIGN'
  | 'DELETE';

const securityCustomers = [
  {
    id: 11,
    code: 'CSEC-001',
    name: 'Khách bảo mật nháp',
    company_name: 'Công ty bảo mật',
    tax_code: '0311111111',
    phone: '0901111111',
    email: 'draft@example.test',
    address: 'Khu thử nghiệm',
    contact_person: 'Chị An',
    contact_phone: '0901111112',
    payment_terms: 30,
    credit_limit: 10000000,
    is_active: true,
    status: 'DRAFT',
    owner_name: 'owner',
    team_name: 'Sales',
    created_at: '2026-06-01T08:00:00Z',
    updated_at: '2026-06-02T08:00:00Z',
  },
  {
    id: 12,
    code: 'CSEC-002',
    name: 'Khách chờ duyệt',
    company_name: 'Công ty duyệt',
    tax_code: '0322222222',
    phone: '0902222222',
    email: 'pending@example.test',
    address: 'Khu thử nghiệm',
    contact_person: 'Anh Bình',
    contact_phone: '0902222223',
    payment_terms: 15,
    credit_limit: 5000000,
    is_active: true,
    status: 'PENDING_APPROVAL',
    owner_name: 'owner',
    team_name: 'Sales',
    created_at: '2026-06-03T08:00:00Z',
    updated_at: '2026-06-04T08:00:00Z',
  },
];

const emptyPage = { count: 0, next: null, previous: null, results: [] };

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

function buildUser(actions: CustomerAction[]) {
  return {
    id: 88,
    username: `customer_security_${actions.length || 'none'}`,
    is_staff: false,
    is_superuser: false,
    is_active: true,
    is_locked: false,
    roles: [
      {
        code: 'CUSTOMER_SECURITY_TEST',
        name: 'Customer Security Test',
        permissions: actions.map((action) => ({ resource: 'CUSTOMER', action })),
      },
    ],
  };
}

async function setupCustomerSecurityMockApi(page: Page, actions: CustomerAction[], writes: string[] = []) {
  const user = buildUser(actions);

  await page.addInitScript((storedUser) => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem('refresh_token', 'mock-refresh-token');
    window.localStorage.setItem('user', JSON.stringify(storedUser));
  }, user);

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/users/me/' && method === 'GET') {
      return json(route, user);
    }

    if (path.startsWith('/api/preferences/')) {
      if (method === 'GET') return json(route, { config: {} });
      return json(route, { config: request.postDataJSON()?.config ?? {} });
    }

    if (path === '/api/notifications/unread/' && method === 'GET') {
      return json(route, []);
    }

    if (path === '/api/customers/' && method === 'GET') {
      return json(route, {
        count: securityCustomers.length,
        next: null,
        previous: null,
        results: securityCustomers,
      });
    }

    const detailMatch = path.match(/^\/api\/customers\/(\d+)\/$/);
    if (detailMatch && method === 'GET') {
      const customer = securityCustomers.find((item) => item.id === Number(detailMatch[1]));
      return json(route, customer ?? { detail: 'Not found' }, customer ? 200 : 404);
    }

    if (/^\/api\/customers\/\d+\/approval_history\/$/.test(path) && method === 'GET') {
      return json(route, []);
    }

    if (path === '/api/activity/by_entity/' && method === 'GET') {
      return json(route, []);
    }

    if ((path === '/api/users/directory/' || path === '/api/teams/') && method === 'GET') {
      return json(route, emptyPage);
    }

    if (path.startsWith('/api/customers/') && method !== 'GET') {
      writes.push(`${method} ${path}`);
      return json(route, { error: 'Write blocked in customer security E2E' }, 405);
    }

    if (method === 'GET') {
      return json(route, emptyPage);
    }

    writes.push(`${method} ${path}`);
    return json(route, {});
  });
}

async function openFirstRowActionMenu(page: Page) {
  await page.locator('button[title="Thao tác"]').first().click();
  return page.getByRole('menu');
}

test('Customer route, menu and command palette require CUSTOMER:VIEW', async ({ page }) => {
  await setupCustomerSecurityMockApi(page, []);

  await page.goto('/customers');

  await expect(page).not.toHaveURL(/\/customers$/);
  await expect(page.locator('.ant-layout-sider').getByText('Khách hàng', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: /Tìm nhanh/ }).click();
  const palette = page.getByTestId('command-palette-modal');
  await palette.getByTestId('command-palette-search-input').fill('khách hàng');
  await expect(palette.getByText('Không tìm thấy màn hình phù hợp với phạm vi hoặc từ khóa này.')).toBeVisible();
  await expect(palette.getByText('Khách hàng', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Đã xảy ra lỗi giao diện')).toHaveCount(0);
});

test('View-only customer user can read but sees no write, import, export or comment controls', async ({ page }) => {
  const writes: string[] = [];
  await setupCustomerSecurityMockApi(page, ['VIEW'], writes);

  await page.goto('/customers');

  await expect(page.locator('.workspace-header-title')).toContainText('Khách hàng');
  await expect(page.getByRole('button', { name: /Thêm mới/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Nhập Excel/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Xuất Excel/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Xuất PDF/ })).toHaveCount(0);
  await expect(page.locator('.ant-table-selection-column')).toHaveCount(0);

  const menu = await openFirstRowActionMenu(page);
  await expect(menu.getByText('Lịch sử hoạt động')).toBeVisible();
  await expect(menu.getByText('Trình duyệt')).toHaveCount(0);
  await expect(menu.getByText('Nhân bản')).toHaveCount(0);
  await expect(menu.getByText('Ngừng sử dụng')).toHaveCount(0);
  await expect(menu.getByText('Xóa khỏi hệ thống')).toHaveCount(0);

  await menu.getByText('Lịch sử hoạt động').click();
  const historyDialog = page.getByRole('dialog', { name: /Lịch sử hoạt động/ });
  await expect(historyDialog).toBeVisible();
  await expect(historyDialog.getByPlaceholder(/Viết bình luận/)).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('Customer create and edit permissions expose create/edit controls only', async ({ page }) => {
  const writes: string[] = [];
  await setupCustomerSecurityMockApi(page, ['VIEW', 'CREATE', 'EDIT'], writes);

  await page.goto('/customers');

  await expect(page.getByRole('button', { name: /Thêm mới/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Nhập Excel/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Xuất Excel/ })).toHaveCount(0);

  const menu = await openFirstRowActionMenu(page);
  await expect(menu.getByText('Nhân bản')).toBeVisible();
  await expect(menu.getByText('Ngừng sử dụng')).toBeVisible();
  await expect(menu.getByText('Trình duyệt')).toHaveCount(0);
  await expect(menu.getByText('Xóa khỏi hệ thống')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('Customer workflow permissions expose submit, approve and reject controls only', async ({ page }) => {
  const writes: string[] = [];
  await setupCustomerSecurityMockApi(page, ['VIEW', 'SUBMIT', 'APPROVE', 'REJECT'], writes);

  await page.goto('/customers');

  const menu = await openFirstRowActionMenu(page);
  await expect(menu.getByText('Trình duyệt')).toBeVisible();
  await expect(menu.getByText('Nhân bản')).toHaveCount(0);
  await expect(menu.getByText('Ngừng sử dụng')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.locator('button[title="Thao tác"]').nth(1).click();
  const pendingMenu = page.getByRole('menu');
  await expect(pendingMenu.getByText('Duyệt', { exact: true })).toBeVisible();
  await expect(pendingMenu.getByText('Từ chối')).toBeVisible();
  await expect(pendingMenu.getByText('Xóa khỏi hệ thống')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('Customer import and export buttons are visible only with matching permissions and are not clicked', async ({ page }) => {
  const writes: string[] = [];
  await setupCustomerSecurityMockApi(page, ['VIEW', 'IMPORT', 'EXPORT'], writes);

  await page.goto('/customers');

  await expect(page.getByRole('button', { name: /Thêm mới/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Nhập Excel/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Xuất Excel/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Xuất PDF/ })).toBeVisible();
  expect(writes).toEqual([]);
});
