export const SCAN_CENTER_ORIGIN_PARAM = 'from_scan_center';
export const SCAN_CENTER_RETURN_TO_PARAM = 'return_to';
export const SCAN_CENTER_PATH = '/scan-center';

export type ScanCenterOriginState = {
  active: boolean;
  returnTo: string | null;
};

export function appendScanCenterContext(routePath: string, returnTo: string): string {
  if (!routePath) {
    return routePath;
  }
  const target = new URL(routePath, 'http://local');
  target.searchParams.set(SCAN_CENTER_ORIGIN_PARAM, '1');
  target.searchParams.set(SCAN_CENTER_RETURN_TO_PARAM, returnTo || SCAN_CENTER_PATH);
  return `${target.pathname}${target.search}${target.hash}`;
}

type ScanCenterRouteParams = {
  orderId?: number | null;
  shipmentId?: number | null;
};

export function buildScanCenterPath(params?: ScanCenterRouteParams): string {
  const searchParams = new URLSearchParams();
  if (params?.orderId) searchParams.set('order_id', String(params.orderId));
  if (params?.shipmentId) searchParams.set('shipment_id', String(params.shipmentId));
  const search = searchParams.toString();
  return search ? `${SCAN_CENTER_PATH}?${search}` : SCAN_CENTER_PATH;
}

export function readScanCenterOrigin(searchParams: URLSearchParams): ScanCenterOriginState {
  const active = searchParams.get(SCAN_CENTER_ORIGIN_PARAM) === '1';
  return {
    active,
    returnTo: active ? searchParams.get(SCAN_CENTER_RETURN_TO_PARAM) || SCAN_CENTER_PATH : null,
  };
}
