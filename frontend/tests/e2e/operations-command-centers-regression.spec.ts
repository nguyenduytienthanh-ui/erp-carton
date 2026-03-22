import { expect, test } from '@playwright/test';

import { adminUser, login } from './helpers/auth';

test('admin can inspect sales order and shipment workspaces', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/sales-orders');
  await expect(page.getByRole('button', { name: 'Tạo đơn hàng' })).toBeVisible();
  await expect(page.getByPlaceholder('Tìm mã đơn, tham chiếu, ghi chú...')).toBeVisible();
  await expect(page.locator('main').getByText('Cần giữ chỗ', { exact: true }).first()).toBeVisible();
  await expect(page.locator('main').getByText('Quá hạn giao', { exact: true }).first()).toBeVisible();

  await page.goto('/shipments');
  await expect(page.locator('main').getByText('Trung tâm điều phối giao hàng', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo phiếu giao hàng' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xóa bộ lọc' })).toBeVisible();
  await expect(page.getByPlaceholder('Tìm kiếm mã phiếu, khách hàng...')).toBeVisible();
  await expect(page.locator('main').getByText('Chờ xử lý', { exact: true }).first()).toBeVisible();
  await expect(page.locator('main').getByText('Đang vận chuyển', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('shipments-lane-ready-to-dispatch')).toBeVisible();
  await page.getByTestId('shipments-lane-ready-to-dispatch').click();
  await expect(page.locator('main').getByText('Làn điều phối: Sẵn sàng điều xe', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Tạo phiếu giao hàng' }).click();
  const shipmentDialog = page.getByRole('dialog').last();
  await expect(shipmentDialog.getByText('Tạo phiếu giao hàng', { exact: true })).toBeVisible();
  await expect(shipmentDialog.getByLabel('Khách hàng')).toBeVisible();
  await expect(shipmentDialog.getByLabel('Ngày giao')).toBeVisible();
  await expect(shipmentDialog.getByRole('button', { name: 'Thêm dòng' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('admin can inspect purchasing command centers and filter controls', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/purchase-orders');
  await expect(page.locator('main').getByText('Trung tâm đơn mua', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo đơn mua' })).toBeVisible();
  await expect(page.getByPlaceholder('Tìm kiếm tất cả cột...')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xóa bộ lọc' })).toBeVisible();
  await expect(page.locator('main').getByText('Chờ nhập kho', { exact: true }).first()).toBeVisible();

  await page.goto('/purchase-receipts');
  await expect(page.locator('main').getByText('Trung tâm phiếu nhập mua', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText('Đã ghi sổ', { exact: true }).first()).toBeVisible();
  await expect(page.locator('main').getByText('Đã hủy', { exact: true }).first()).toBeVisible();
  await expect(page.getByPlaceholder('Tìm kiếm tất cả cột...')).toBeVisible();
  await expect(page.locator('main').getByText('Tổng giá trị', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('purchase-receipts-lane-posted-today')).toBeVisible();
  await page.getByTestId('purchase-receipts-lane-posted-today').click();
  await expect(page.locator('main').getByText('Làn điều phối: Ghi sổ hôm nay', { exact: true })).toBeVisible();

  await page.goto('/purchase-returns');
  await expect(page.locator('main').getByText('Trung tâm trả hàng mua', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo phiếu trả' })).toBeVisible();
  await expect(page.getByTestId('purchase-returns-command-search').locator('input')).toBeVisible();
  await expect(page.getByTestId('purchase-returns-lane-pending-approval')).toBeVisible();
  await page.getByTestId('purchase-returns-lane-pending-approval').click();
  await expect(page.locator('main').getByText('Làn điều phối: Chờ duyệt', { exact: true })).toBeVisible();
});

test('admin can inspect inventory transfer and alert workspaces', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/warehouse-transfers');
  await expect(page.locator('main').getByText('Trung tâm chuyển kho', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo phiếu chuyển' })).toBeVisible();
  await expect(page.getByPlaceholder('Tìm mã chuyển...')).toBeVisible();
  await expect(page.locator('main').getByText('Đang vận chuyển', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('warehouse-transfers-lane-ready-to-post')).toBeVisible();
  await page.getByTestId('warehouse-transfers-lane-ready-to-post').click();
  await expect(page.locator('main').getByText('Làn điều phối: Chờ xuất kho', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Tạo phiếu chuyển' }).click();
  const transferDialog = page.getByRole('dialog').last();
  await expect(transferDialog.getByText('Tạo phiếu chuyển kho', { exact: true })).toBeVisible();
  await expect(transferDialog.getByLabel('Ngày chuyển')).toBeVisible();
  await expect(transferDialog.getByLabel('Từ kho')).toBeVisible();
  await expect(transferDialog.getByRole('button', { name: 'Thêm dòng' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/stock-alerts');
  await expect(page.locator('main').getByText('Trung tâm cảnh báo tồn kho', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xuất CSV' })).toBeVisible();
  await expect(page.getByPlaceholder('Tìm mã sản phẩm, tên...')).toBeVisible();
  await expect(page.locator('main').getByText('Cảnh báo active', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText('Hết hàng', { exact: true }).first()).toBeVisible();
});

test('admin can inspect production issue, order, and receipt command centers', async ({ page }) => {
  await login(page, adminUser.username, adminUser.password);

  await page.goto('/material-issues');
  await expect(page.locator('main').getByText('Trung tâm cấp phát vật tư', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Phát hành' })).toBeVisible();
  await expect(page.getByPlaceholder('Tìm mã chứng từ, mã lệnh, vật tư...')).toBeVisible();
  await expect(page.locator('main').getByText('Tổng SL cấp', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('material-issues-lane-posted-today')).toBeVisible();
  await page.getByTestId('material-issues-lane-posted-today').click();
  await expect(page.locator('main').getByText('Làn điều phối: Cấp hôm nay', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Phát hành' }).click();
  const issueDialog = page.getByRole('dialog').last();
  await expect(issueDialog.getByText('Phát hành vật tư', { exact: true })).toBeVisible();
  await expect(issueDialog.getByLabel('Lệnh sản xuất')).toBeVisible();
  await expect(issueDialog.getByRole('combobox').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/production-orders');
  await expect(page.locator('main').getByText('Trung tâm lệnh sản xuất', { exact: true })).toBeVisible();
  await expect(page.getByTestId('production-orders-command-strip')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo lệnh' })).toBeVisible();
  await expect(page.getByTestId('production-orders-lane-pending-approval')).toBeVisible();
  await page.getByTestId('production-orders-lane-pending-approval').click();
  await expect(page.locator('main').getByText('Làn điều phối: Chờ duyệt', { exact: true })).toBeVisible();

  await page.goto('/production-receipts');
  await expect(page.locator('main').getByText('Trung tâm nhập kho thành phẩm', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nhập thành phẩm' })).toBeVisible();
  await expect(page.getByPlaceholder('Tìm mã chứng từ, mã lệnh, thành phẩm...')).toBeVisible();
  await expect(page.locator('main').getByText('Tổng SL nhập', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('production-receipts-lane-posted-today')).toBeVisible();
  await page.getByTestId('production-receipts-lane-posted-today').click();
  await expect(page.locator('main').getByText('Làn điều phối: Nhập hôm nay', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Nhập thành phẩm' }).click();
  const receiptDialog = page.getByRole('dialog').last();
  await expect(receiptDialog.getByText('Nhập kho thành phẩm', { exact: true })).toBeVisible();
  await expect(receiptDialog.getByLabel('Kho đích')).toBeVisible();
  await expect(receiptDialog.getByLabel('Vị trí đích')).toBeVisible();
  await page.keyboard.press('Escape');
});
