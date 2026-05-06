import { expect, test, type Locator, type Page } from '@playwright/test';

import { adminUser, login } from './helpers/auth';
import { apiGet, apiPost, getAccessToken } from './helpers/adminApi';
import { createExecutionSeedData, createShipmentSeed, createWarehouseTransferSeed } from './helpers/operationsApi';

const executionAdminUser = {
  username: process.env.E2E_EXECUTION_ADMIN_USERNAME || adminUser.username,
  password: process.env.E2E_EXECUTION_ADMIN_PASSWORD || adminUser.password,
};

type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

type ShipmentRecord = {
  id: number;
  code: string;
  reference?: string;
  notes?: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PACKED' | 'IN_TRANSIT' | 'DELIVERED' | 'RETURNED' | 'CANCELLED';
};

type WarehouseTransferRecord = {
  id: number;
  code: string;
  reference: string;
  note: string;
  status: 'DRAFT' | 'SUBMITTED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
};

type StocktakeRecord = {
  id: number;
  code: string;
  note: string;
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
};

async function chooseAntSelectOption(page: Page, scope: Locator, testId: string, optionText: string) {
  const control = scope.getByTestId(testId);
  await control.click();
  const dropdown = page.locator('.ant-select-dropdown:visible').last();
  await expect(dropdown).toBeVisible();

  let option = dropdown.locator('.ant-select-item-option').filter({ hasText: optionText }).first();
  if ((await option.count()) === 0) {
    const controlInput = control.locator('input').last();
    if ((await controlInput.count()) > 0 && (await controlInput.isVisible().catch(() => false))) {
      await controlInput.fill('');
      await controlInput.fill(optionText);
    } else {
      const dropdownInput = dropdown.locator('input').last();
      if ((await dropdownInput.count()) > 0 && (await dropdownInput.isVisible().catch(() => false))) {
        await dropdownInput.fill('');
        await dropdownInput.fill(optionText);
      }
    }
    option = dropdown.locator('.ant-select-item-option').filter({ hasText: optionText }).first();
  }
  await expect(option).toBeVisible();
  await option.click();
}

async function fillControl(scope: Locator, testId: string, value: string) {
  const control = scope.getByTestId(testId);
  const innerInput = control.locator('input, textarea').first();
  if (await innerInput.count()) {
    await innerInput.fill(value);
    return;
  }
  await control.fill(value);
}

function visibleDialog(page: Page, title: string): Locator {
  return page.getByRole('dialog').filter({ hasText: title }).last();
}

async function getShipment(page: Page, token: string, id: number): Promise<ShipmentRecord> {
  return apiGet<ShipmentRecord>(page, token, `/sales/shipments/${id}/`);
}

async function getWarehouseTransfer(page: Page, token: string, id: number): Promise<WarehouseTransferRecord> {
  return apiGet<WarehouseTransferRecord>(page, token, `/inventory/warehouse-transfers/${id}/`);
}

async function findStocktakeByNote(page: Page, token: string, note: string): Promise<StocktakeRecord | null> {
  const payload = await apiGet<PaginatedResponse<StocktakeRecord>>(page, token, '/inventory/stocktakes/', {
    page_size: 50,
  });
  return payload.results.find((item) => item.note === note) ?? null;
}

async function getStocktake(page: Page, token: string, id: number): Promise<StocktakeRecord> {
  return apiGet<StocktakeRecord>(page, token, `/inventory/stocktakes/${id}/`);
}

test('admin can progress the shipment workflow with authenticated execution access', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, executionAdminUser.username, executionAdminUser.password);
  const token = await getAccessToken(page);
  const seed = await createExecutionSeedData(page, token, `${Date.now()}s`);
  const reference = `PW-SHIP-${Date.now()}`;
  const firstNote = `Phiếu giao Playwright ${reference}`;
  const shipmentRecord = await createShipmentSeed(page, token, {
    customerId: seed.customer.id,
    productId: seed.product.id,
    reference,
    notes: firstNote,
    quantity: '4',
    unitPrice: '17500',
  });

  await page.goto('/shipments');
  await expect(page.getByTestId('shipments-command-strip')).toBeVisible();

  await apiPost(page, token, `/sales/shipments/${shipmentRecord.id}/submit_shipment/`);
  await expect.poll(async () => (await getShipment(page, token, shipmentRecord.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('SUBMITTED');

  await apiPost(page, token, `/sales/shipments/${shipmentRecord.id}/approve_shipment/`);
  await expect.poll(async () => (await getShipment(page, token, shipmentRecord.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('APPROVED');

  await apiPost(page, token, `/sales/shipments/${shipmentRecord.id}/pack_shipment/`);
  await expect.poll(async () => (await getShipment(page, token, shipmentRecord.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('PACKED');

  await apiPost(page, token, `/sales/shipments/${shipmentRecord.id}/send_shipment/`);
  await expect.poll(async () => (await getShipment(page, token, shipmentRecord.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('IN_TRANSIT');

  await apiPost(page, token, `/sales/shipments/${shipmentRecord.id}/confirm_delivery/`, {
    actual_delivery_date: new Date().toISOString().slice(0, 10),
  });
  await expect.poll(async () => (await getShipment(page, token, shipmentRecord.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('DELIVERED');
});

test('admin can progress warehouse transfers with authenticated execution access', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, executionAdminUser.username, executionAdminUser.password);
  const token = await getAccessToken(page);
  const seed = await createExecutionSeedData(page, token, `${Date.now()}t`);
  const reference = `PW-TRN-${Date.now()}`;
  const firstNote = `Phiếu chuyển ${reference}`;
  const transferRecord = await createWarehouseTransferSeed(page, token, {
    fromWarehouseId: seed.sourceWarehouse.id,
    toWarehouseId: seed.destinationWarehouse.id,
    productId: seed.product.id,
    quantity: '6',
    reference,
    note: firstNote,
  });

  await page.goto('/warehouse-transfers');
  await expect(page.getByTestId('warehouse-transfers-command-strip')).toBeVisible();

  await apiPost(page, token, `/inventory/warehouse-transfers/${transferRecord.id}/submit_transfer/`);
  await expect.poll(async () => (await getWarehouseTransfer(page, token, transferRecord.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('SUBMITTED');

  await apiPost(page, token, `/inventory/warehouse-transfers/${transferRecord.id}/post_transfer/`);
  await expect.poll(async () => (await getWarehouseTransfer(page, token, transferRecord.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('IN_TRANSIT');

  await apiPost(page, token, `/inventory/warehouse-transfers/${transferRecord.id}/receive_transfer/`);
  await expect.poll(async () => (await getWarehouseTransfer(page, token, transferRecord.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('RECEIVED');
});

test('admin can create, complete, and delete stocktakes from the command center', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, executionAdminUser.username, executionAdminUser.password);
  const token = await getAccessToken(page);
  const seed = await createExecutionSeedData(page, token, `${Date.now()}k`);
  const firstNote = `Kiểm tồn hoàn tất ${Date.now()}`;
  const secondNote = `Kiểm tồn xóa ${Date.now()}`;

  await page.goto('/stocktakes');
  await expect(page.getByTestId('stocktakes-command-strip')).toBeVisible();

  await page.getByTestId('stocktakes-open-create').click();
  let dialog = visibleDialog(page, 'Tạo phiếu kiểm tồn');
  await chooseAntSelectOption(page, dialog, 'stocktake-warehouse', seed.sourceWarehouse.code);
  await fillControl(dialog, 'stocktake-note', firstNote);
  await chooseAntSelectOption(page, dialog, 'stocktake-line-product-0', seed.product.code);
  await fillControl(dialog, 'stocktake-line-qty-0', '9');
  await dialog.getByRole('button', { name: 'Tạo phiếu' }).click();

  await expect.poll(async () => Boolean(await findStocktakeByNote(page, token, firstNote)), {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe(true);

  const completedStocktake = (await findStocktakeByNote(page, token, firstNote)) as StocktakeRecord;
  let row = page.locator('.ant-table-tbody tr').filter({ hasText: completedStocktake.code }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByTestId(`stocktake-complete-${completedStocktake.id}`)).toBeVisible();
  await page.getByTestId(`stocktake-complete-${completedStocktake.id}`).click();

  await expect.poll(async () => (await getStocktake(page, token, completedStocktake.id)).status, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe('COMPLETED');

  await page.keyboard.press('Escape');

  await page.getByTestId('stocktakes-open-create').click();
  dialog = visibleDialog(page, 'Tạo phiếu kiểm tồn');
  await chooseAntSelectOption(page, dialog, 'stocktake-warehouse', seed.sourceWarehouse.code);
  await fillControl(dialog, 'stocktake-note', secondNote);
  await chooseAntSelectOption(page, dialog, 'stocktake-line-product-0', seed.product.code);
  await fillControl(dialog, 'stocktake-line-qty-0', '3');
  await dialog.getByRole('button', { name: 'Tạo phiếu' }).click();

  await expect.poll(async () => Boolean(await findStocktakeByNote(page, token, secondNote)), {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe(true);

  const deletedStocktake = (await findStocktakeByNote(page, token, secondNote)) as StocktakeRecord;
  row = page.locator('.ant-table-tbody tr').filter({ hasText: deletedStocktake.code }).first();
  await expect(row).toBeVisible();
  await row.click();
  page.once('dialog', (dialogEvent) => void dialogEvent.accept());
  await page.getByTestId(`stocktake-delete-${deletedStocktake.id}`).click();

  await expect.poll(async () => {
    const payload = await apiGet<PaginatedResponse<StocktakeRecord>>(page, token, '/inventory/stocktakes/', {
      page_size: 50,
    });
    return payload.results.some((item) => item.id === deletedStocktake.id);
  }, {
    timeout: 20_000,
    intervals: [500, 1000, 2000],
  }).toBe(false);
});
