export const SCAN_CENTER_ORIGIN_PARAM = 'from_scan_center';
export const SCAN_CENTER_RETURN_TO_PARAM = 'return_to';

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
  target.searchParams.set(SCAN_CENTER_RETURN_TO_PARAM, returnTo || '/scan-center');
  return `${target.pathname}${target.search}${target.hash}`;
}

export function readScanCenterOrigin(searchParams: URLSearchParams): ScanCenterOriginState {
  const active = searchParams.get(SCAN_CENTER_ORIGIN_PARAM) === '1';
  return {
    active,
    returnTo: active ? searchParams.get(SCAN_CENTER_RETURN_TO_PARAM) || '/scan-center' : null,
  };
}
