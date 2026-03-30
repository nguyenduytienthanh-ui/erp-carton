import { expect, test, type Page } from '@playwright/test';
import {
  PLAYWRIGHT_API_BASE_URL,
  adminUser,
  financeUser,
  hrUser,
  login,
  salesUser,
} from './helpers/auth';

type ListResponse<T> = {
  results: T[];
};

type SalesOrderRow = {
  id: number;
};

type ShipmentRow = {
  id: number;
  sales_order?: number | null;
};

async function fetchAuthenticatedJson<T>(page: Page, path: string): Promise<T> {
  const accessToken = await page.evaluate(() => window.localStorage.getItem('access_token'));
  expect(accessToken).toBeTruthy();

  const response = await page.request.get(`${PLAYWRIGHT_API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(response.ok(), `Yêu cầu ${path} phải thành công`).toBeTruthy();
  return (await response.json()) as T;
}

test('mobile header keeps QR nhanh and giao nhiệm vụ nhanh visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, adminUser.username, adminUser.password);

  await expect(page.getByTestId('header-qr-quick-button')).toBeVisible();
  await expect(page.getByTestId('header-task-quick-button')).toBeVisible();
});

test('malformed stored user does not crash the shell', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.evaluate(() => {
    window.localStorage.setItem('user', 'undefined');
  });

  await page.goto('/');
  await expect(page.getByTestId('command-palette-open-button')).toBeVisible();
});

test('sales discoverability keeps QR, kế hoạch giao hàng, and phiếu xuất easy to find', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  await page.getByTestId('command-palette-open-button').click();
  const searchInput = page.getByTestId('command-palette-search-input');

  await searchInput.fill('quet qr');
  await expect(page.getByTestId('command-palette-result-shipments-scan')).toBeVisible();

  await searchInput.clear();
  await searchInput.fill('ke hoach giao hang');
  await expect(page.getByTestId('command-palette-result-sales-delivery-planning')).toBeVisible();

  await searchInput.clear();
  await searchInput.fill('phieu xuat');
  await expect(page.getByTestId('command-palette-result-shipments')).toBeVisible();

  await searchInput.clear();
  await searchInput.fill('trien khai cong viec');
  await expect(page.getByTestId('command-palette-result-onboarding-studio')).toHaveCount(0);
});

test('finance palette keeps tạm ứng - quyết toán and ứng lương as separate entries', async ({ page }) => {
  await login(page, financeUser.username, financeUser.password);

  await page.getByTestId('command-palette-open-button').click();
  const searchInput = page.getByTestId('command-palette-search-input');

  await searchInput.fill('tam ung');
  await expect(page.getByTestId('command-palette-result-advance-transactions')).toBeVisible();

  await searchInput.clear();
  await searchInput.fill('ung luong');
  await expect(page.getByTestId('command-palette-result-salary-advance')).toBeVisible();
});

test('hr palette keeps ứng lương separate from tạm ứng - quyết toán', async ({ page }) => {
  await login(page, hrUser.username, hrUser.password);

  await page.getByTestId('command-palette-open-button').click();
  const searchInput = page.getByTestId('command-palette-search-input');

  await searchInput.fill('ung luong');
  await expect(page.getByTestId('command-palette-result-salary-advance')).toBeVisible();

  await searchInput.clear();
  await searchInput.fill('tam ung');
  await expect(page.getByTestId('command-palette-result-advance-transactions')).toHaveCount(0);
});

test('admin can find trợ lý triển khai công việc and lệnh sản xuất from command palette', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.getByTestId('command-palette-open-button').click();
  const searchInput = page.getByTestId('command-palette-search-input');

  await searchInput.fill('trien khai cong viec');
  await expect(page.getByTestId('command-palette-result-onboarding-studio')).toBeVisible();

  await searchInput.clear();
  await searchInput.fill('lenh san xuat');
  await expect(page.getByTestId('command-palette-result-production-orders')).toBeVisible();
});

test('delivery-planning deep link opens đúng ngữ cảnh trong đơn hàng xuất', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  const orders = await fetchAuthenticatedJson<ListResponse<SalesOrderRow>>(page, '/sales/orders/?page_size=5');
  test.skip(orders.results.length === 0, 'Không có dữ liệu đơn hàng xuất để kiểm tra deep-link.');

  await page.goto(`/sales-orders?focus_id=${orders.results[0].id}&section=delivery-planning`);
  await expect(page.locator('main')).toContainText('Đơn hàng xuất');
  await expect(page.getByText('Kế hoạch giao hàng', { exact: true }).last()).toBeVisible();
});

test('shipment detail keeps CTA quay về đơn hàng xuất và QR nhanh', async ({ page }) => {
  await login(page, salesUser.username, salesUser.password);

  const shipments = await fetchAuthenticatedJson<ListResponse<ShipmentRow>>(page, '/sales/shipments/?page_size=20');
  const shipmentWithOrder = shipments.results.find((item) => Boolean(item.sales_order));
  test.skip(!shipmentWithOrder, 'Không có phiếu xuất gắn đơn hàng để kiểm tra CTA điều hướng.');

  await page.goto(`/shipments?focus_id=${shipmentWithOrder!.id}&order_id=${shipmentWithOrder!.sales_order}`);
  await expect(page.getByRole('button', { name: 'Về Đơn hàng xuất' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mở QR nhanh' })).toBeVisible();
});

test('production center keeps original lệnh sản xuất identity', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/production-orders');
  await expect(page.locator('main').getByText('Trung tâm lệnh sản xuất', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText('Điều độ sản xuất', { exact: true })).toHaveCount(0);
});
