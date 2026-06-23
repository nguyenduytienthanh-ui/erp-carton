import { expect, test, type Page, type Route } from '@playwright/test';

type SupplierAction = 'VIEW' | 'CREATE' | 'EDIT' | 'IMPORT' | 'EXPORT' | 'DELETE';

const securitySuppliers = [
  {
    id: 31,
    code: 'SSEC-001',
    name: 'Nhà cung cấp bảo mật',
    company_name: 'Công ty bảo mật',
    tax_code: '0311111111',
    phone: '0901111111',
    email: 'supplier-security@example.test',
    address: 'Khu thử nghiệm',
    contact_person: 'Chị An',
    contact_phone: '0901111112',
    payment_terms_days: 30,
    is_preferred: true,
    rating: 4,
    note: '',
    is_active: true,
    created_at: '2026-06-01T08:00:00Z',
    updated_at: '2026-06-02T08:00:00Z',
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

function buildUser(actions: SupplierAction[]) {
  return {
    id: 89,
    username: `supplier_security_${actions.length || 'none'}`,
    is_staff: false,
    is_superuser: false,
    is_active: true,
    is_locked: false,
    roles: [
      {
        code: 'SUPPLIER_SECURITY_TEST',
        name: 'Supplier Security Test',
        permissions: actions.map((action) => ({ resource: 'SUPPLIER', action })),
      },
    ],
  };
}

async function setupSupplierSecurityMockApi(page: Page, actions: SupplierAction[], writes: string[] = []) {
  const user = buildUser(actions);

  await page.addInitScript((storedUser) => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem('refresh_token', 'mock-refresh-token');
    window.localStorage.setItem('user', JSON.stringify(storedUser));
  }, user);

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/api\//, '/api/');
    const method = request.method();

    if (path === '/api/users/me/' && method === 'GET') {
      return json(route, user);
    }

    if (path.startsWith('/api/preferences/')) {
      if (method === 'GET') return json(route, { config: {} });
      return json(route, { config: request.postDataJSON()?.config ?? {} });
    }

    if (path === '/api/notifications/unread/' && method === 'GET') return json(route, []);
    if (path === '/api/notifications/unread_count/' && method === 'GET') return json(route, { count: 0 });
    if (path === '/api/tasks/my_summary/' && method === 'GET') {
      return json(route, { assigned_to_me: 0, created_by_me: 0, watching: 0, team_members: 0, overdue: 0 });
    }

    if (path === '/api/purchasing/suppliers/' && method === 'GET') {
      return json(route, {
        count: securitySuppliers.length,
        next: null,
        previous: null,
        results: securitySuppliers,
      });
    }

    if (path.startsWith('/api/purchasing/suppliers/') && method !== 'GET') {
      writes.push(`${method} ${path}`);
      return json(route, { error: 'Write blocked in supplier security E2E' }, 405);
    }

    if (method === 'GET') return json(route, emptyPage);

    writes.push(`${method} ${path}`);
    return json(route, {});
  });
}

test('Supplier route, menu and command palette require SUPPLIER:VIEW', async ({ page }) => {
  await setupSupplierSecurityMockApi(page, []);

  await page.goto('/suppliers');

  await expect(page).not.toHaveURL(/\/suppliers$/);
  await expect(page.locator('.ant-layout-sider').getByText('Nhà cung cấp', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: /Tìm nhanh/ }).click();
  const palette = page.getByTestId('command-palette-modal');
  await palette.getByTestId('command-palette-search-input').fill('nhà cung cấp');
  await expect(palette.getByText('Không tìm thấy màn hình phù hợp với phạm vi hoặc từ khóa này.')).toBeVisible();
  await expect(palette.getByText('Nhà cung cấp', { exact: true })).toHaveCount(0);
});

test('View-only supplier user can read but sees no write controls', async ({ page }) => {
  const writes: string[] = [];
  await setupSupplierSecurityMockApi(page, ['VIEW'], writes);

  await page.goto('/suppliers');

  await expect(page.getByRole('heading', { name: 'Nhà cung cấp' })).toBeVisible();
  await expect(page.getByText('SSEC-001')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thêm mới' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Sửa SSEC-001/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Ngừng sử dụng SSEC-001/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Nhập/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Xuất/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Xem SSEC-001' }).click();
  const drawer = page.getByTestId('supplier-form-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Lưu' })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('Supplier create and edit permissions expose write controls without delete/import/export controls', async ({ page }) => {
  const writes: string[] = [];
  await setupSupplierSecurityMockApi(page, ['VIEW', 'CREATE', 'EDIT'], writes);

  await page.goto('/suppliers');

  await expect(page.getByRole('button', { name: 'Thêm mới' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Sửa SSEC-001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ngừng sử dụng SSEC-001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Nhập/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Xuất/ })).toHaveCount(0);
  await expect(page.getByText('Xóa vĩnh viễn')).toHaveCount(0);
  await expect(page.getByText('Xóa khỏi hệ thống')).toHaveCount(0);
  expect(writes).toEqual([]);
});
