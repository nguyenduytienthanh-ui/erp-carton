import type { SalesOrder } from '../types/sales';

type SalesGroup = {
  id: string;
  name: string;
  revenue: number;
  orders: number;
  growth: number;
};

type ProductGroup = {
  id: string;
  name: string;
  revenue: number;
  units: number;
  growth: number;
};

type StatusGroup = {
  status: string;
  revenue: number;
  orders: number;
  avg_order_value: number;
};

const orderStatusLabels: Record<string, string> = {
  DRAFT: 'Nhap',
  SUBMITTED: 'Cho duyet',
  APPROVED: 'Da duyet',
  POSTED: 'Da ghi so',
  VOID: 'Da huy',
};

export function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateGrowth(currentValue: number, previousValue: number): number {
  if (previousValue === 0) {
    return currentValue > 0 ? 100 : 0;
  }
  return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(1));
}

export function getPostedOrders(orders: SalesOrder[]): SalesOrder[] {
  return orders.filter((order) => order.status === 'POSTED');
}

export function buildTopCustomers(currentOrders: SalesOrder[], previousOrders: SalesOrder[]): SalesGroup[] {
  const currentMap = new Map<string, SalesGroup>();
  const previousMap = new Map<string, number>();

  previousOrders.forEach((order) => {
    const key = order.customer_name || 'Khach le';
    previousMap.set(key, (previousMap.get(key) || 0) + toNumber(order.total));
  });

  currentOrders.forEach((order) => {
    const key = order.customer_name || 'Khach le';
    const row = currentMap.get(key) || {
      id: key,
      name: key,
      revenue: 0,
      orders: 0,
      growth: 0,
    };
    row.revenue += toNumber(order.total);
    row.orders += 1;
    currentMap.set(key, row);
  });

  return Array.from(currentMap.values())
    .map((row) => ({
      ...row,
      growth: calculateGrowth(row.revenue, previousMap.get(row.name) || 0),
    }))
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 5);
}

export function buildTopProducts(currentOrders: SalesOrder[], previousOrders: SalesOrder[]): ProductGroup[] {
  const currentMap = new Map<string, ProductGroup>();
  const previousMap = new Map<string, number>();

  previousOrders.forEach((order) => {
    order.lines.forEach((line) => {
      const key = line.product_code || line.product_name || String(line.product);
      const lineRevenue = toNumber(line.line_total) || (toNumber(line.qty) * toNumber(line.unit_price));
      previousMap.set(key, (previousMap.get(key) || 0) + lineRevenue);
    });
  });

  currentOrders.forEach((order) => {
    order.lines.forEach((line) => {
      const key = line.product_code || line.product_name || String(line.product);
      const name = [line.product_code, line.product_name].filter(Boolean).join(' - ') || key;
      const row = currentMap.get(key) || {
        id: key,
        name,
        revenue: 0,
        units: 0,
        growth: 0,
      };
      row.revenue += toNumber(line.line_total) || (toNumber(line.qty) * toNumber(line.unit_price));
      row.units += toNumber(line.qty);
      currentMap.set(key, row);
    });
  });

  return Array.from(currentMap.values())
    .map((row) => ({
      ...row,
      growth: calculateGrowth(row.revenue, previousMap.get(row.id) || 0),
    }))
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 5);
}

export function buildStatusBreakdown(orders: SalesOrder[]): StatusGroup[] {
  const statusMap = new Map<string, StatusGroup>();

  orders.forEach((order) => {
    const status = order.status || 'UNKNOWN';
    const row = statusMap.get(status) || {
      status,
      revenue: 0,
      orders: 0,
      avg_order_value: 0,
    };
    row.orders += 1;
    row.revenue += toNumber(order.total);
    statusMap.set(status, row);
  });

  return Array.from(statusMap.values())
    .map((row) => ({
      ...row,
      status: orderStatusLabels[row.status] || row.status,
      avg_order_value: row.orders > 0 ? row.revenue / row.orders : 0,
    }))
    .sort((left, right) => right.revenue - left.revenue);
}
