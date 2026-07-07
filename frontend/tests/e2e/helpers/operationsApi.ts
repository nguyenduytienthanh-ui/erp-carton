import { type Page } from '@playwright/test';

import { apiGet, apiPost } from './adminApi';

type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

type ProductUnit = {
  id: number;
  code: string;
  name: string;
};

type Product = {
  id: number;
  code: string;
  name: string;
};

type Warehouse = {
  id: number;
  code: string;
  name: string;
};

type Customer = {
  id: number;
  code: string;
  name: string;
};

type Supplier = {
  id: number;
  code: string;
  name: string;
};

type WarehouseLocation = {
  id: number;
  warehouse: number;
  code: string;
  name: string;
};

type ProductionOrderSeed = {
  id: number;
  code: string;
  reference?: string;
  status: string;
};

type ProductionIssueSeed = {
  id: number;
  code: string;
  reference?: string;
  note?: string;
  status: string;
};

type PurchaseReturnSeed = {
  id: number;
  code: string;
  status: string;
  reference?: string;
  return_notes?: string;
};

type PurchaseReceiptSeed = {
  id: number;
  code: string;
  status: string;
  reference?: string;
  cancel_reason?: string;
  lines: Array<{
    id: number;
    line_number: number;
    quantity?: string;
  }>;
};

type PurchaseOrderSeed = {
  id: number;
  code: string;
  status: string;
  reference?: string;
  notes?: string;
  version?: number;
  reject_reason?: string;
  cancel_reason?: string;
  lines: Array<{
    id: number;
    line_number: number;
    product: number;
    qty: string;
    unit_price: string;
    note?: string;
  }>;
};

type ProductionReceiptSeed = {
  id: number;
  code: string;
  status: string;
  reference?: string;
  cancel_reason?: string;
};

type SalesOrderSeed = {
  id: number;
  code: string;
  status: string;
  reference?: string;
  notes?: string;
  version?: number;
  reject_reason?: string;
  void_reason?: string;
  lines: Array<{
    id: number;
    line_number: number;
    product: number;
    qty: string;
    unit_price: string;
    note?: string;
  }>;
};

type WarehouseTransferSeed = {
  id: number;
  code: string;
  reference: string;
  note: string;
  status: string;
};

type ShipmentSeed = {
  id: number;
  code: string;
  reference?: string;
  notes?: string;
  status: string;
};

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildSeedCode(prefix: string, key: string, maxLength: number): string {
  const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'SEED';
  const available = Math.max(1, maxLength - prefix.length);
  return `${prefix}${normalizedKey.slice(-available)}`;
}

async function ensureProductUnit(page: Page, token: string, key: string): Promise<ProductUnit> {
  const units = await apiGet<PaginatedResponse<ProductUnit>>(page, token, '/products/units/', {
    page_size: 1,
    ordering: '-id',
  });
  if (units.results[0]) {
    return units.results[0];
  }
  return apiPost<ProductUnit>(page, token, '/products/units/', {
    code: `PWU${key.slice(-4)}`,
    name: `Đơn vị E2E ${key}`,
  });
}

export async function createExecutionSeedData(page: Page, token: string, key: string): Promise<{
  product: Product;
  customer: Customer;
  sourceWarehouse: Warehouse;
  destinationWarehouse: Warehouse;
}> {
  const unit = await ensureProductUnit(page, token, key);
  const productCode = buildSeedCode('PWEX', key, 50);
  const sourceWarehouseCode = buildSeedCode('PWS', key, 20);
  const destinationWarehouseCode = buildSeedCode('PWD', key, 20);

  const [product, customer, sourceWarehouse, destinationWarehouse] = await Promise.all([
    apiPost<Product>(page, token, '/products/products/', {
      code: productCode,
      name: `Hàng vận hành Playwright ${key}`,
      unit: unit.id,
      cost_price: '11500',
      sale_price: '17600',
      min_stock: '1',
      status: 'ACTIVE',
      is_active: true,
      note: 'Sản phẩm seed cho regression shipment / transfer / stocktake.',
    }),
    apiPost<Customer>(page, token, '/customers/', {
      name: `Khách Playwright ${key}`,
      company_name: `Khách hàng E2E ${key}`,
      email: `playwright-${key}@example.com`,
      phone: '0900000000',
      address: `Địa chỉ seed ${key}`,
      contact_person: 'Playwright QA',
      contact_phone: '0900000001',
      payment_terms: 30,
      credit_limit: '0',
      is_active: true,
    }),
    apiPost<Warehouse>(page, token, '/inventory/warehouses/', {
      code: sourceWarehouseCode,
      name: `Kho nguồn Playwright ${key}`,
      address: '',
      note: 'Kho nguồn seed cho regression execution workflow.',
      is_active: true,
      sort_order: 0,
    }),
    apiPost<Warehouse>(page, token, '/inventory/warehouses/', {
      code: destinationWarehouseCode,
      name: `Kho đích Playwright ${key}`,
      address: '',
      note: 'Kho đích seed cho regression execution workflow.',
      is_active: true,
      sort_order: 0,
    }),
  ]);

  await apiPost(page, token, '/inventory/transactions/', {
    transaction_type: 'RECEIPT',
    transaction_date: formatDate(new Date()),
    product: product.id,
    warehouse: sourceWarehouse.id,
    quantity: '24',
    unit_cost: '11500',
    reference: `PW-SEED-STOCK-${key}`,
    note: `Seed tồn kho execution ${key}`,
  });

  return {
    product,
    customer,
    sourceWarehouse,
    destinationWarehouse,
  };
}

export async function createWarehouseTransferSeed(
  page: Page,
  token: string,
  payload: {
    transferDate?: string;
    fromWarehouseId: number;
    toWarehouseId: number;
    productId: number;
    quantity: string;
    reference: string;
    note?: string;
  },
): Promise<WarehouseTransferSeed> {
  return apiPost<WarehouseTransferSeed>(page, token, '/inventory/warehouse-transfers/', {
    transfer_date: payload.transferDate ?? formatDate(new Date()),
    from_warehouse: payload.fromWarehouseId,
    to_warehouse: payload.toWarehouseId,
    reference: payload.reference,
    note: payload.note ?? '',
    lines: [
      {
        line_number: 1,
        product: payload.productId,
        qty: payload.quantity,
        note: payload.note ?? '',
      },
    ],
  });
}

export async function createShipmentSeed(
  page: Page,
  token: string,
  payload: {
    customerId: number;
    productId: number;
    reference: string;
    notes?: string;
    shipmentDate?: string;
    shippingAddress?: string;
    carrier?: string;
    trackingNumber?: string;
    quantity: string;
    unitPrice: string;
  },
): Promise<ShipmentSeed> {
  return apiPost<ShipmentSeed>(page, token, '/sales/shipments/', {
    customer: payload.customerId,
    shipment_date: payload.shipmentDate ?? formatDate(new Date()),
    reference: payload.reference,
    shipping_address: payload.shippingAddress ?? `Địa chỉ giao hàng ${payload.reference}`,
    carrier: payload.carrier ?? 'Đội giao nhận nội bộ',
    tracking_number: payload.trackingNumber ?? `TRACK-${payload.reference}`,
    notes: payload.notes ?? '',
    lines: [
      {
        line_number: 1,
        product: payload.productId,
        qty_ordered: payload.quantity,
        qty_shipped: payload.quantity,
        qty_received: '0',
        unit_price: payload.unitPrice,
        discount_pct: '0',
        tax_pct: '0',
        notes: payload.notes ?? '',
      },
    ],
  });
}

export async function createProductionSeedData(page: Page, token: string, key: string): Promise<{
  product: Product;
  warehouse: Warehouse;
  location: WarehouseLocation;
}> {
  const warehouseCode = buildSeedCode('PWK', key, 20);
  const locationCode = buildSeedCode('PWL', key, 30);
  const productCode = buildSeedCode('PWFG', key, 50);
  const unit = await ensureProductUnit(page, token, key);
  const warehouse = await apiPost<Warehouse>(page, token, '/inventory/warehouses/', {
    code: warehouseCode,
    name: `Kho Playwright ${key}`,
    address: '',
    note: 'Kho seed cho regression production workflow.',
    is_active: true,
    sort_order: 0,
  });
  const location = await apiPost<WarehouseLocation>(page, token, '/inventory/locations/', {
    warehouse: warehouse.id,
    code: locationCode,
    name: `Vị trí Playwright ${key}`,
    location_type: 'STORAGE',
    allow_mixed_products: true,
    is_active: true,
    sort_order: 0,
    note: 'Vị trí seed cho regression production workflow.',
  });
  const product = await apiPost<Product>(page, token, '/products/products/', {
    code: productCode,
    name: `Thành phẩm Playwright ${key}`,
    unit: unit.id,
    cost_price: '12500',
    sale_price: '18500',
    min_stock: '1',
    process_xa: 120,
    status: 'ACTIVE',
    is_active: true,
    note: 'Sản phẩm seed cho regression production workflow.',
  });
  return { product, warehouse, location };
}

export async function createProductionOrderSeed(page: Page, token: string, key: string): Promise<{
  order: ProductionOrderSeed;
  product: Product;
  warehouse: Warehouse;
  location: WarehouseLocation;
}> {
  const seed = await createProductionSeedData(page, token, key);
  const orderDate = new Date();
  const plannedEndDate = new Date(orderDate);
  plannedEndDate.setDate(plannedEndDate.getDate() + 2);

  const order = await apiPost<ProductionOrderSeed>(page, token, '/production/orders/', {
    order_date: formatDate(orderDate),
    planned_start_date: formatDate(orderDate),
    planned_end_date: formatDate(plannedEndDate),
    product: seed.product.id,
    planned_qty: 6,
    unit_cost_estimate: 12500,
    target_warehouse: seed.warehouse.id,
    target_location: seed.location.id,
    reference: `PW-PO-${key}`,
    notes: `Lệnh sản xuất seed ${key}`,
  });

  return { order, ...seed };
}

export async function createPurchaseReturnSeed(page: Page, token: string, key: string): Promise<{
  purchaseReturn: PurchaseReturnSeed;
  product: Product;
  supplier: Supplier;
}> {
  const receiptSeed = await createPurchaseReceiptSeed(page, token, `${key}rt`);
  const receiptLine = receiptSeed.receipt.lines[0];
  if (!receiptLine) {
    throw new Error(`Purchase receipt seed ${receiptSeed.receipt.code} did not return receipt lines.`);
  }
  const purchaseReturn = await apiPost<PurchaseReturnSeed>(page, token, '/purchasing/returns/', {
    return_date: formatDate(new Date()),
    source_receipt: receiptSeed.receipt.id,
    reference: `PW-RET-${key}`,
    return_reason: 'OTHER',
    return_notes: `Phiếu trả hàng seed ${key}`,
    lines: [
      {
        line_number: 1,
        source_receipt_line: receiptLine.id,
        qty: '2',
        note: `Dòng trả hàng ${key}`,
      },
    ],
  });
  return {
    purchaseReturn,
    product: receiptSeed.product,
    supplier: receiptSeed.supplier,
  };
}

export async function createPurchaseReceiptSeed(page: Page, token: string, key: string): Promise<{
  receipt: PurchaseReceiptSeed;
  order: { id: number; code: string; status: string };
  product: Product;
  supplier: Supplier;
  warehouse: Warehouse;
  location: WarehouseLocation;
}> {
  const unit = await ensureProductUnit(page, token, key);
  const product = await apiPost<Product>(page, token, '/products/products/', {
    code: buildSeedCode('PWRCV', key, 50),
    name: `Hàng nhập Playwright ${key}`,
    unit: unit.id,
    cost_price: '11800',
    sale_price: '16900',
    min_stock: '1',
    status: 'ACTIVE',
    is_active: true,
    note: 'Sản phẩm seed cho purchase receipt lifecycle regression.',
  });
  const supplier = await apiPost<Supplier>(page, token, '/purchasing/suppliers/', {
    code: buildSeedCode('PWRCS', key, 20),
    name: `NCC nhập ${key}`,
    company_name: `Nhà cung cấp nhập ${key}`,
    payment_terms_days: 15,
  });
  const warehouse = await apiPost<Warehouse>(page, token, '/inventory/warehouses/', {
    code: buildSeedCode('PWRCW', key, 20),
    name: `Kho nhập mua ${key}`,
    address: '',
    note: 'Kho seed cho purchase receipt lifecycle regression.',
    is_active: true,
    sort_order: 0,
  });
  const location = await apiPost<WarehouseLocation>(page, token, '/inventory/locations/', {
    warehouse: warehouse.id,
    code: buildSeedCode('PWRCL', key, 30),
    name: `Vị trí nhập mua ${key}`,
    location_type: 'STORAGE',
    allow_mixed_products: true,
    is_active: true,
    sort_order: 0,
    note: 'Vị trí seed cho purchase receipt lifecycle regression.',
  });

  const order = await apiPost<{ id: number; code: string; status: string }>(page, token, '/purchasing/orders/', {
    order_date: formatDate(new Date()),
    expected_receipt_date: formatDate(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)),
    supplier: supplier.id,
    warehouse: warehouse.id,
    location: location.id,
    reference: `PW-PO-RCV-${key}`,
    notes: `Đơn mua seed ${key}`,
    lines: [
      {
        line_number: 1,
        product: product.id,
        qty: '5',
        unit_price: '11800',
        discount_pct: '0',
        tax_pct: '0',
        note: `Dòng nhập seed ${key}`,
      },
    ],
  });
  await apiPost(page, token, `/purchasing/orders/${order.id}/submit/`);
  await apiPost(page, token, `/purchasing/orders/${order.id}/approve/`);
  const orderDetail = await apiGet<{ lines: Array<{ id: number }> }>(page, token, `/purchasing/orders/${order.id}/`);
  const firstLine = orderDetail.lines[0];

  const receipt = await apiPost<PurchaseReceiptSeed>(page, token, `/purchasing/orders/${order.id}/receive/`, {
    receipt_date: formatDate(new Date()),
    warehouse: warehouse.id,
    location: location.id,
    reference: `PW-GRN-${key}`,
    items: [
      {
        purchase_order_line: firstLine.id,
        quantity: '5',
        unit_cost: '11800',
        note: `Nhập mua seed ${key}`,
      },
    ],
  });

  return { receipt, order, product, supplier, warehouse, location };
}

export async function createPurchaseOrderSeed(page: Page, token: string, key: string): Promise<{
  order: PurchaseOrderSeed;
  product: Product;
  supplier: Supplier;
  warehouse: Warehouse;
  location: WarehouseLocation;
}> {
  const unit = await ensureProductUnit(page, token, key);
  const product = await apiPost<Product>(page, token, '/products/products/', {
    code: buildSeedCode('PWPO', key, 50),
    name: `Hang mua Playwright ${key}`,
    unit: unit.id,
    cost_price: '12000',
    sale_price: '16800',
    min_stock: '1',
    status: 'ACTIVE',
    is_active: true,
    note: 'San pham seed cho purchase order lifecycle regression.',
  });
  const supplier = await apiPost<Supplier>(page, token, '/purchasing/suppliers/', {
    code: buildSeedCode('PWSUP', key, 20),
    name: `NCC Playwright ${key}`,
    company_name: `Nha cung cap Playwright ${key}`,
    payment_terms_days: 15,
  });
  const warehouse = await apiPost<Warehouse>(page, token, '/inventory/warehouses/', {
    code: buildSeedCode('PWPOW', key, 20),
    name: `Kho mua Playwright ${key}`,
    address: '',
    note: 'Kho seed cho purchase order lifecycle regression.',
    is_active: true,
    sort_order: 0,
  });
  const location = await apiPost<WarehouseLocation>(page, token, '/inventory/locations/', {
    warehouse: warehouse.id,
    code: buildSeedCode('PWPOL', key, 30),
    name: `Vi tri mua Playwright ${key}`,
    location_type: 'STORAGE',
    allow_mixed_products: true,
    is_active: true,
    sort_order: 0,
    note: 'Vi tri seed cho purchase order lifecycle regression.',
  });

  const created = await apiPost<{ id: number; code: string; status: string }>(page, token, '/purchasing/orders/', {
    order_date: formatDate(new Date()),
    expected_receipt_date: formatDate(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)),
    supplier: supplier.id,
    warehouse: warehouse.id,
    location: location.id,
    reference: `PW-PO-${key}`,
    notes: `Don mua seed ${key}`,
    lines: [
      {
        line_number: 1,
        product: product.id,
        qty: '6',
        unit_price: '12000',
        discount_pct: '0',
        tax_pct: '8',
        note: `Dong mua seed ${key}`,
      },
    ],
  });
  const order = await apiGet<PurchaseOrderSeed>(page, token, `/purchasing/orders/${created.id}/`);

  return { order, product, supplier, warehouse, location };
}

export async function createSalesOrderSeed(page: Page, token: string, key: string): Promise<{
  order: SalesOrderSeed;
  product: Product;
  customer: Customer;
  sourceWarehouse: Warehouse;
  destinationWarehouse: Warehouse;
}> {
  const seed = await createExecutionSeedData(page, token, key);
  const deliveryDate = formatDate(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
  const created = await apiPost<{ id: number; code: string; status: string }>(page, token, '/sales/orders/', {
    order_date: formatDate(new Date()),
    delivery_date: deliveryDate,
    customer: seed.customer.id,
    reference: `PW-SO-${key}`,
    currency: 'VND',
    exchange_rate: 1,
    notes: `Don hang ban seed ${key}`,
    lines: [
      {
        line_number: 1,
        product: seed.product.id,
        qty: '4',
        unit_price: '17600',
        discount_pct: '0',
        tax_pct: '0',
        note: `Dong ban hang seed ${key}`,
        delivery_plans: [
          {
            delivery_date: deliveryDate,
            qty: '4',
            shipped_qty: '0',
            delivered_qty: '0',
            note: `Ke hoach giao ${key}`,
          },
        ],
      },
    ],
  });
  const order = await apiGet<SalesOrderSeed>(page, token, `/sales/orders/${created.id}/`);

  return {
    order,
    product: seed.product,
    customer: seed.customer,
    sourceWarehouse: seed.sourceWarehouse,
    destinationWarehouse: seed.destinationWarehouse,
  };
}

export async function createProductionReceiptSeed(page: Page, token: string, key: string): Promise<{
  receipt: ProductionReceiptSeed;
  order: ProductionOrderSeed;
  product: Product;
  warehouse: Warehouse;
  location: WarehouseLocation;
}> {
  const seed = await createProductionOrderSeed(page, token, key);
  await apiPost(page, token, `/production/orders/${seed.order.id}/submit/`);
  await apiPost(page, token, `/production/orders/${seed.order.id}/approve/`);
  await apiPost(page, token, `/production/orders/${seed.order.id}/release/`);

  const receipt = await apiPost<ProductionReceiptSeed>(page, token, `/production/orders/${seed.order.id}/receive_output/`, {
    receipt_date: formatDate(new Date()),
    warehouse: seed.warehouse.id,
    location: seed.location.id,
    reference: `PW-PROD-RCPT-${key}`,
    items: [
      {
        quantity: '3',
        unit_cost: '13500',
        note: `Nhập thành phẩm seed ${key}`,
      },
    ],
  });

  return {
    receipt,
    order: seed.order,
    product: seed.product,
    warehouse: seed.warehouse,
    location: seed.location,
  };
}

export async function createProductionIssueSeed(page: Page, token: string, key: string): Promise<{
  issue: ProductionIssueSeed;
  order: ProductionOrderSeed;
  finishedProduct: Product;
  materialProduct: Product;
  materialWarehouse: Warehouse;
  materialLocation: WarehouseLocation;
  targetWarehouse: Warehouse;
  targetLocation: WarehouseLocation;
}> {
  const unit = await ensureProductUnit(page, token, key);
  const targetWarehouse = await apiPost<Warehouse>(page, token, '/inventory/warehouses/', {
    code: buildSeedCode('PWFGW', key, 20),
    name: `Kho thành phẩm ${key}`,
    address: '',
    note: 'Kho thành phẩm seed cho material issue regression.',
    is_active: true,
    sort_order: 0,
  });
  const targetLocation = await apiPost<WarehouseLocation>(page, token, '/inventory/locations/', {
    warehouse: targetWarehouse.id,
    code: buildSeedCode('PWFGL', key, 30),
    name: `Vị trí TP ${key}`,
    location_type: 'STORAGE',
    allow_mixed_products: true,
    is_active: true,
    sort_order: 0,
    note: 'Vị trí thành phẩm seed cho material issue regression.',
  });
  const materialWarehouse = await apiPost<Warehouse>(page, token, '/inventory/warehouses/', {
    code: buildSeedCode('PWRMW', key, 20),
    name: `Kho NVL ${key}`,
    address: '',
    note: 'Kho nguyên liệu seed cho material issue regression.',
    is_active: true,
    sort_order: 0,
  });
  const materialLocation = await apiPost<WarehouseLocation>(page, token, '/inventory/locations/', {
    warehouse: materialWarehouse.id,
    code: buildSeedCode('PWRML', key, 30),
    name: `Vị trí NVL ${key}`,
    location_type: 'STORAGE',
    allow_mixed_products: true,
    is_active: true,
    sort_order: 0,
    note: 'Vị trí nguyên liệu seed cho material issue regression.',
  });
  const finishedProduct = await apiPost<Product>(page, token, '/products/products/', {
    code: buildSeedCode('PWFG', key, 50),
    name: `Thành phẩm issue ${key}`,
    unit: unit.id,
    cost_price: '15000',
    sale_price: '22000',
    min_stock: '1',
    process_xa: 120,
    status: 'ACTIVE',
    is_active: true,
    note: 'Thành phẩm seed cho material issue regression.',
  });
  const materialProduct = await apiPost<Product>(page, token, '/products/products/', {
    code: buildSeedCode('PWRM', key, 50),
    name: `Nguyên liệu issue ${key}`,
    unit: unit.id,
    cost_price: '8500',
    sale_price: '9500',
    min_stock: '1',
    status: 'ACTIVE',
    is_active: true,
    note: 'Nguyên liệu seed cho material issue regression.',
  });
  await apiPost(page, token, '/inventory/transactions/', {
    transaction_type: 'RECEIPT',
    transaction_date: formatDate(new Date()),
    product: materialProduct.id,
    warehouse: materialWarehouse.id,
    location: materialLocation.id,
    quantity: '40',
    unit_cost: '8500',
    reference: `PW-ISS-STOCK-${key}`,
    note: `Seed tồn kho nguyên liệu ${key}`,
  });

  const order = await apiPost<ProductionOrderSeed>(page, token, '/production/orders/', {
    order_date: formatDate(new Date()),
    planned_start_date: formatDate(new Date()),
    planned_end_date: formatDate(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)),
    product: finishedProduct.id,
    planned_qty: 4,
    target_warehouse: targetWarehouse.id,
    target_location: targetLocation.id,
    reference: `PW-ISS-ORDER-${key}`,
    notes: `Lệnh cấp vật tư seed ${key}`,
    material_requirements: [
      {
        line_number: 1,
        material_product: materialProduct.id,
        required_qty: 8,
        source_warehouse: materialWarehouse.id,
        source_location: materialLocation.id,
        note: `Định mức NVL seed ${key}`,
      },
    ],
  });

  await apiPost(page, token, `/production/orders/${order.id}/submit/`);
  await apiPost(page, token, `/production/orders/${order.id}/approve/`);
  await apiPost(page, token, `/production/orders/${order.id}/release/`);

  const issue = await apiPost<ProductionIssueSeed>(page, token, `/production/orders/${order.id}/issue_materials/`, {
    issue_date: formatDate(new Date()),
    reference: `PW-ISS-${key}`,
    note: `Chứng từ cấp vật tư seed ${key}`,
  });

  return {
    issue,
    order,
    finishedProduct,
    materialProduct,
    materialWarehouse,
    materialLocation,
    targetWarehouse,
    targetLocation,
  };
}
