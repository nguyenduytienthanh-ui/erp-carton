import { expect, test, type Page, type Route } from '@playwright/test';

const customers = [
  {
    id: 1,
    code: 'CUS-001',
    name: 'Công ty Bao bì Demo',
    company_name: 'Công ty TNHH Bao bì Demo',
    tax_code: '0312345678',
    phone: '0901000001',
    email: 'demo@example.test',
    address: 'Khu công nghiệp Demo',
    contact_person: 'Chị Lan',
    contact_phone: '0901000002',
    payment_terms: 30,
    credit_limit: 50000000,
    is_active: true,
    status: 'APPROVED',
    owner_name: 'uat_admin',
    team_name: 'Sales',
    created_at: '2026-06-01T08:00:00Z',
    updated_at: '2026-06-02T08:00:00Z',
  },
  {
    id: 2,
    code: 'CUS-002',
    name: 'Khách hàng ngưng dùng',
    company_name: '',
    tax_code: '',
    phone: '0902000001',
    email: '',
    address: '',
    contact_person: 'Anh Minh',
    contact_phone: '',
    payment_terms: 15,
    credit_limit: 0,
    is_active: false,
    status: 'DRAFT',
    owner_name: '',
    team_name: '',
    created_at: '2026-06-03T08:00:00Z',
    updated_at: '2026-06-03T08:00:00Z',
  },
];

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

async function setupCustomerV1MockApi(page: Page, writes: unknown[]) {
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

    if (path === '/api/customers/1/' && method === 'GET') {
      return json(route, customers[0]);
    }

    if (path === '/api/customers/' && method === 'GET') {
      const name = url.searchParams.get('name')?.trim().toLowerCase();
      const phone = url.searchParams.get('phone')?.trim();
      const taxCode = url.searchParams.get('tax_code')?.trim();
      let results = customers;
      if (name) results = results.filter((item) => item.name.toLowerCase().includes(name));
      if (phone) results = results.filter((item) => item.phone.includes(phone));
      if (taxCode) results = results.filter((item) => item.tax_code.includes(taxCode));
      return json(route, { count: results.length, next: null, previous: null, results });
    }

    if (path === '/api/customers/' && method === 'POST') {
      const payload = request.postDataJSON();
      writes.push(payload);
      return json(route, {
        id: 99,
        code: payload.code || 'KH-20260618-10001',
        status: 'DRAFT',
        ...payload,
      }, 201);
    }

    if (method === 'GET') {
      return json(route, { count: 0, next: null, previous: null, results: [] });
    }

    return json(route, {});
  });
}

test('Customer v1 list exposes approved default columns, optional columns and MST filter', async ({ page }) => {
  const writes: unknown[] = [];
  await setupCustomerV1MockApi(page, writes);

  await page.goto('/customers');

  await expect(page.getByRole('heading', { name: 'Khách hàng' })).toBeVisible();
  await expect(page.getByText('Quản lý thông tin pháp lý, liên hệ và điều khoản thương mại của khách hàng.')).toBeVisible();
  const tableHeader = page.locator('.ant-table-thead');
  await expect(tableHeader.getByText('Mã KH')).toBeVisible();
  await expect(tableHeader.getByText('Tên KH')).toBeVisible();
  await expect(tableHeader.getByText('Mã số thuế')).toBeVisible();
  await expect(tableHeader.getByText('Người liên hệ')).toBeVisible();
  await expect(tableHeader.getByText('Điện thoại')).toBeVisible();
  await expect(tableHeader.getByText('Hạn TT')).toBeVisible();
  await expect(tableHeader.getByText('Hạn mức')).toBeVisible();
  await expect(tableHeader.getByText('Trạng thái')).toBeVisible();
  await expect(tableHeader.getByText('Email')).toHaveCount(0);

  await page.getByRole('button', { name: 'Cột' }).click();
  const columnDialog = page.getByRole('dialog', { name: 'Hiển thị cột' });
  await expect(columnDialog.getByText('Email')).toBeVisible();
  await expect(columnDialog.getByText('Tên pháp lý')).toBeVisible();
  await expect(columnDialog.getByText('Owner')).toBeVisible();
  await expect(columnDialog.getByText('Ngày tạo')).toBeVisible();
  await columnDialog.getByRole('button', { name: 'Xong' }).click();

  await page.getByRole('button', { name: /Lọc/ }).click();
  const filterDialog = page.getByRole('dialog', { name: 'Bộ lọc khách hàng' });
  await expect(filterDialog.getByText('Mã số thuế')).toBeVisible();
  await filterDialog.getByText('Mã số thuế').click();
  await expect(filterDialog.getByText('Đúng MST')).toBeVisible();
  await expect(filterDialog.locator('[data-field="tax_code_filter"]')).toBeVisible();

  expect(writes).toEqual([]);
});

test('Customer v1 form validates and sends trimmed commercial fields', async ({ page }) => {
  const writes: unknown[] = [];
  await setupCustomerV1MockApi(page, writes);

  await page.goto('/customers');
  await page.getByRole('button', { name: /Thêm mới/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Thêm khách hàng' });
  await expect(dialog.getByText('Thông tin cơ bản')).toBeVisible();
  await expect(dialog.getByText('Thông tin pháp lý')).toBeVisible();
  await expect(dialog.getByText('Điều khoản thương mại')).toBeVisible();
  await expect(dialog.getByText('Có thể để trống để hệ thống tự sinh hoặc nhập mã theo quy tắc công ty.')).toBeVisible();
  await expect(dialog.getByText('Hạn mức tham chiếu/cảnh báo v1; chưa tự chặn báo giá hoặc đơn bán hàng.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Thêm mới' }).click();
  await expect(dialog.getByText('Vui lòng nhập tên khách hàng.')).toBeVisible();

  await dialog.getByPlaceholder('Nhập tên khách hàng').fill('  Khách UAT Form  ');
  await dialog.getByPlaceholder('Mã số thuế').fill('  MST-UAT-FORM  ');
  await dialog.locator('[data-error-field="phone"]').fill(' 0909000001 ');
  await dialog.getByPlaceholder('email@congty.vn').fill('bad-email');
  await dialog.getByRole('button', { name: 'Thêm mới' }).click();
  await expect(dialog.getByText('Email không hợp lệ.')).toBeVisible();

  await dialog.getByPlaceholder('email@congty.vn').fill('uat@example.test');
  await dialog.getByText('15 ngày').click();
  await dialog.getByRole('spinbutton', { name: 'Hạn mức công nợ' }).fill('10000000');
  await dialog.getByRole('button', { name: 'Thêm mới' }).click();

  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    name: 'Khách UAT Form',
    tax_code: 'MST-UAT-FORM',
    phone: '0909000001',
    email: 'uat@example.test',
    payment_terms: 15,
    credit_limit: 10000000,
    is_active: true,
  });
  expect((writes[0] as Record<string, unknown>).code).toBeUndefined();
});
