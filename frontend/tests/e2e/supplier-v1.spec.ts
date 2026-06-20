import { expect, test, type Page, type Route } from '@playwright/test';

const supplierA = {
  id: 1,
  code: 'SUP-V1-001',
  name: 'Nhà cung cấp giấy An Phú',
  company_name: 'Công ty TNHH An Phú',
  tax_code: '0311111111',
  phone: '0901000001',
  email: 'mua-hang@anphu.vn',
  address: 'KCN Sóng Thần, Bình Dương',
  contact_person: 'Chị Lan',
  contact_phone: '0901000002',
  payment_terms_days: 30,
  is_preferred: true,
  rating: 5,
  note: 'Nguồn giấy ưu tiên',
  is_active: true,
  created_at: '2026-06-01T08:00:00Z',
  updated_at: '2026-06-02T08:00:00Z',
};

const supplierB = {
  id: 2,
  code: 'SUP-V1-002',
  name: 'Nhà cung cấp mực Bình Minh',
  company_name: '',
  tax_code: '',
  phone: '',
  email: '',
  address: '',
  contact_person: '',
  contact_phone: '',
  payment_terms_days: 45,
  is_preferred: false,
  rating: 3,
  note: '',
  is_active: false,
  created_at: '2026-06-03T08:00:00Z',
  updated_at: '2026-06-03T08:00:00Z',
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function paginated(results: typeof supplierA[]) {
  return { count: results.length, next: null, previous: null, results };
}

async function setupSupplierMockApi(page: Page) {
  const suppliers = [supplierA, supplierB];
  let lastCreatePayload: Record<string, unknown> | null = null;
  let lastPatchPayload: Record<string, unknown> | null = null;

  await page.addInitScript(() => {
    window.localStorage.setItem('access_token', 'mock-access-token');
    window.localStorage.setItem('user', JSON.stringify({ username: 'uat_admin', is_staff: true, is_superuser: true, roles: [] }));
  });

  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^\/api\/api\//, '/api/');

    if (path === '/api/users/me/' && method === 'GET') {
      return json(route, { id: 1, username: 'uat_admin', is_staff: true, is_superuser: true, roles: [] });
    }

    if (path.startsWith('/api/preferences/')) {
      if (method === 'GET') return json(route, { config: {} });
      return json(route, { config: request.postDataJSON()?.config ?? {} });
    }

    if (path === '/api/notifications/unread_count/' && method === 'GET') return json(route, { count: 0 });
    if (path === '/api/notifications/unread/' && method === 'GET') return json(route, []);
    if (path === '/api/notifications/live_updates/' && method === 'GET') {
      return json(route, { has_changes: false, latest_at: null, server_time: '2026-06-20T00:00:00Z', changed_count: 0, unread_count: 0 });
    }
    if (path === '/api/tasks/my_summary/' && method === 'GET') {
      return json(route, { assigned_to_me: 0, created_by_me: 0, watching: 0, team_members: 0, overdue: 0 });
    }
    if (path === '/api/tasks/live_updates/' && method === 'GET') {
      return json(route, { has_changes: false, latest_at: null, server_time: '2026-06-20T00:00:00Z', task_changed_count: 0, bulk_changed_count: 0, audit_changed_count: 0 });
    }

    if (path === '/api/purchasing/suppliers/' && method === 'GET') {
      const isActive = url.searchParams.get('is_active');
      const isPreferred = url.searchParams.get('is_preferred');
      const missingProfile = url.searchParams.get('missing_profile');
      let results = [...suppliers];
      if (isActive === 'true') results = results.filter((supplier) => supplier.is_active);
      if (isActive === 'false') results = results.filter((supplier) => !supplier.is_active);
      if (isPreferred === 'true') results = results.filter((supplier) => supplier.is_preferred);
      if (isPreferred === 'false') results = results.filter((supplier) => !supplier.is_preferred);
      if (missingProfile === 'true') results = results.filter((supplier) => !supplier.tax_code || (!supplier.phone && !supplier.email && !supplier.contact_person && !supplier.contact_phone));
      return json(route, paginated(results));
    }

    if (path === '/api/purchasing/suppliers/' && method === 'POST') {
      lastCreatePayload = request.postDataJSON();
      const taxCode = String(lastCreatePayload?.tax_code ?? '').trim();
      if (taxCode === 'MST-DUP') {
        return json(route, { tax_code: ['Mã số thuế đã tồn tại trên nhà cung cấp khác.'] }, 400);
      }
      return json(route, {
        ...supplierA,
        id: 99,
        ...lastCreatePayload,
        created_at: '2026-06-20T08:00:00Z',
        updated_at: '2026-06-20T08:00:00Z',
      }, 201);
    }

    const supplierPatchMatch = path.match(/^\/api\/purchasing\/suppliers\/(\d+)\/$/);
    if (supplierPatchMatch && method === 'PATCH') {
      lastPatchPayload = request.postDataJSON();
      const id = Number(supplierPatchMatch[1]);
      const supplier = suppliers.find((item) => item.id === id) ?? supplierA;
      return json(route, { ...supplier, ...lastPatchPayload });
    }

    if (method === 'GET') return json(route, { count: 0, next: null, previous: null, results: [] });
    return json(route, {});
  });

  return {
    getLastCreatePayload: () => lastCreatePayload,
    getLastPatchPayload: () => lastPatchPayload,
  };
}

test('Supplier v1 desktop list exposes filters, columns and sectioned create form', async ({ page }) => {
  const api = await setupSupplierMockApi(page);

  await page.goto('/suppliers');
  await expect(page.getByRole('heading', { name: 'Nhà cung cấp' })).toBeVisible();
  await expect(page.getByTestId('supplier-command-strip')).toBeVisible();
  await expect(page.getByText('Hạn TT: 0 ngày')).toHaveCount(0);
  await expect(page.getByText('Rating từ 0')).toHaveCount(0);
  await expect(page.getByText('SUP-V1-001')).toBeVisible();

  await page.getByRole('button', { name: 'Cột' }).click();
  const columnDialog = page.getByRole('dialog', { name: 'Hiển thị cột' });
  await expect(columnDialog).toBeVisible();
  await expect(columnDialog.getByText('MST')).toBeVisible();
  await columnDialog.getByRole('button', { name: 'Xong' }).click();

  await page.getByRole('button', { name: /Lọc/ }).click();
  await expect(page.getByText('Bộ lọc nhà cung cấp')).toBeVisible();
  await expect(page.getByPlaceholder('Mã số thuế')).toBeVisible();
  await page.getByRole('button', { name: 'Xong' }).click();

  await page.getByRole('button', { name: 'Thêm mới' }).click();
  const supplierDrawer = page.getByTestId('supplier-form-drawer');
  await expect(supplierDrawer).toBeVisible();
  await expect(supplierDrawer.getByText('Thông tin cơ bản')).toBeVisible();
  await expect(supplierDrawer.getByText('Thanh toán', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByText('Vui lòng nhập mã NCC')).toBeVisible();
  await expect(page.getByText('Vui lòng nhập tên NCC')).toBeVisible();

  await supplierDrawer.getByRole('textbox', { name: /Mã NCC/ }).fill(' sup-new-001 ');
  await supplierDrawer.getByRole('textbox', { name: /Tên NCC/ }).fill('Nhà cung cấp mới');
  await supplierDrawer.getByRole('textbox', { name: /Mã số thuế/ }).fill('MST-NEW');
  await supplierDrawer.getByRole('textbox', { name: /Email/ }).fill('NEW@SUPPLIER.VN');
  await supplierDrawer.locator('.supplier-payment-presets').getByText('45 ngày').click();
  await page.getByRole('button', { name: 'Lưu' }).click();

  await expect.poll(() => api.getLastCreatePayload()?.code).toBe('SUP-NEW-001');
  expect(api.getLastCreatePayload()?.email).toBe('new@supplier.vn');
  expect(api.getLastCreatePayload()?.payment_terms_days).toBe(45);
});

test('Supplier v1 mobile uses cards and primary deactivate action instead of hard delete', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await setupSupplierMockApi(page);

  await page.goto('/suppliers');
  await expect(page.getByTestId('supplier-mobile-card-list')).toBeVisible();
  await expect(page.getByText('Nhà cung cấp giấy An Phú')).toBeVisible();
  await expect(page.getByText('SUP-V1-001')).toBeVisible();

  await page.getByRole('button', { name: 'Ngừng sử dụng SUP-V1-001' }).click();
  const confirmDialog = page.getByRole('dialog', { name: /Ngừng sử dụng nhà cung cấp SUP-V1-001/ }).last();
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: 'Ngừng sử dụng' }).click();

  await expect.poll(() => api.getLastPatchPayload()?.is_active).toBe(false);
  await expect(page.getByText('Xóa vĩnh viễn')).toHaveCount(0);
});
