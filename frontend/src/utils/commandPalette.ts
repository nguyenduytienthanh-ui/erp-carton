export type CommandPaletteCommand = {
  key: string;
  path: string;
  title: string;
  description: string;
  group: string;
  keywords: string[];
  badgeCount?: number;
  spotlight?: boolean;
};

type BuildCommandPaletteCatalogOptions = {
  canViewReports: boolean;
  canViewSalesOrders: boolean;
  canUseShipmentExecutionWorkspace: boolean;
  canManagePurchasing: boolean;
  canAccessProductionCenter: boolean;
  canAccessMaterialIssues: boolean;
  canAccessProductionReceipts: boolean;
  canManageProduction: boolean;
  canManageInventory: boolean;
  canManageStocktake: boolean;
  canManageFinance: boolean;
  canManageWorkforce: boolean;
  canViewOps: boolean;
  canViewWorkflow: boolean;
  canManageWorkflow: boolean;
  canViewOpsLog: boolean;
  canViewApprovalTower: boolean;
  canViewAdminAudit: boolean;
  canViewAdminObservability: boolean;
  canViewAccessGovernance: boolean;
  canManageAccessExceptions: boolean;
  canManageAccessReviews: boolean;
  canManageProvisioning: boolean;
  canManageLifecycle: boolean;
  canManageOnboarding: boolean;
  canManageRoleTeams: boolean;
  canManageUsers: boolean;
  canManageModulePermissions: boolean;
  canViewRbacAudit: boolean;
  unreadCount: number;
  overdue90Count: number;
  salaryAdvancePendingCount: number;
  operationsFailedCount: number;
  rbacAnomalyCount: number;
};

type CommandSeed = Omit<CommandPaletteCommand, 'description'> & {
  enabled: boolean;
  description: string | ((options: BuildCommandPaletteCatalogOptions) => string);
};

const RECENT_PATHS_STORAGE_KEY = 'erp-carton.command-palette-recents';
const FAVORITE_PATHS_STORAGE_KEY = 'erp-carton.command-palette-favorites';
const MAX_RECENT_PATHS = 8;
const MAX_FAVORITE_PATHS = 10;

function commandDescription(
  value: CommandSeed['description'],
  options: BuildCommandPaletteCatalogOptions,
): string {
  return typeof value === 'function' ? value(options) : value;
}

function normalizePaths(paths: string[], maxSize: number): string[] {
  return paths
    .filter((path) => typeof path === 'string' && path.startsWith('/') && path !== '/login')
    .filter((path, index, collection) => collection.indexOf(path) === index)
    .slice(0, maxSize);
}

function normalizeRecentPaths(paths: string[]): string[] {
  return normalizePaths(paths, MAX_RECENT_PATHS);
}

function normalizeFavoritePaths(paths: string[]): string[] {
  return normalizePaths(paths, MAX_FAVORITE_PATHS);
}

function mergeRecentPath(path: string, paths: string[]): string[] {
  if (!path || !path.startsWith('/') || path === '/login') {
    return normalizeRecentPaths(paths);
  }
  return normalizeRecentPaths([path, ...paths.filter((item) => item !== path)]);
}

export function getCommandPaletteRecentPaths(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_PATHS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? normalizeRecentPaths(parsed) : [];
  } catch {
    return [];
  }
}

export function pushCommandPaletteRecentPath(path: string): string[] {
  const next = mergeRecentPath(path, getCommandPaletteRecentPaths());
  try {
    window.localStorage.setItem(RECENT_PATHS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}

export function getNextCommandPaletteRecentPaths(path: string): string[] {
  return mergeRecentPath(path, getCommandPaletteRecentPaths());
}

export function persistCommandPaletteRecentPaths(paths: string[]): string[] {
  const next = normalizeRecentPaths(paths);
  try {
    window.localStorage.setItem(RECENT_PATHS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}

export function getCommandPaletteFavoritePaths(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITE_PATHS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? normalizeFavoritePaths(parsed) : [];
  } catch {
    return [];
  }
}

export function toggleCommandPaletteFavoritePath(path: string): string[] {
  if (!path || !path.startsWith('/') || path === '/login') {
    return getCommandPaletteFavoritePaths();
  }

  const current = getCommandPaletteFavoritePaths();
  const next = current.includes(path)
    ? current.filter((item) => item !== path)
    : normalizeFavoritePaths([path, ...current]);

  try {
    window.localStorage.setItem(FAVORITE_PATHS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}

export function buildCommandPaletteCatalog(
  options: BuildCommandPaletteCatalogOptions,
): CommandPaletteCommand[] {
  const seeds: CommandSeed[] = [
    {
      key: 'dashboard',
      path: '/',
      title: 'Tổng quan',
      group: 'Điều hướng chung',
      description: 'Theo dõi toàn cảnh ERP, doanh thu, tiến độ vận hành và tín hiệu nóng trong ngày.',
      keywords: ['dashboard', 'tong quan', 'overview', 'home'],
      enabled: true,
      spotlight: true,
    },
    {
      key: 'account',
      path: '/account',
      title: 'Trung tâm tài khoản',
      group: 'Điều hướng chung',
      description: 'Cập nhật hồ sơ cá nhân, phiên đăng nhập, mật khẩu và cấu hình thông báo.',
      keywords: ['tai khoan', 'ho so', 'account', 'profile'],
      enabled: true,
    },
    {
      key: 'task-inbox',
      path: '/task-inbox',
      title: 'Hộp nhiệm vụ',
      group: 'Điều hướng chung',
      description: 'Quay lại danh sách việc cần xử lý, việc đến hạn và tác vụ cần phối hợp.',
      keywords: ['nhiem vu', 'task', 'inbox', 'viec cua toi'],
      enabled: true,
      spotlight: true,
    },
    {
      key: 'notifications',
      path: '/notifications',
      title: 'Trung tâm thông báo',
      group: 'Điểm nóng',
      description: ({ unreadCount }) => unreadCount > 0
        ? `Có ${unreadCount} thông báo chưa đọc đang chờ xử lý.`
        : 'Mở trung tâm thông báo để xem cập nhật mới nhất và lịch sử nhắc việc.',
      keywords: ['thong bao', 'notification', 'alert', 'chuong'],
      enabled: true,
      badgeCount: options.unreadCount,
      spotlight: true,
    },
    {
      key: 'reports',
      path: '/reports',
      title: 'Trung tâm báo cáo',
      group: 'Điều hành',
      description: 'Tạo, lên lịch và theo dõi báo cáo nhanh cho điều hành và các bộ phận.',
      keywords: ['bao cao', 'report', 'dashboard', 'schedule'],
      enabled: options.canViewReports,
      spotlight: options.canViewReports,
    },
    {
      key: 'products',
      path: '/products',
      title: 'Sản phẩm',
      group: 'Dữ liệu nền',
      description: 'Quản lý danh mục sản phẩm, cấu hình kinh doanh và trạng thái biên lợi nhuận.',
      keywords: ['san pham', 'product', 'sku', 'hang hoa'],
      enabled: true,
    },
    {
      key: 'categories',
      path: '/categories',
      title: 'Danh mục',
      group: 'Dữ liệu nền',
      description: 'Chuẩn hóa phân loại sản phẩm và cấu trúc nhóm phục vụ bán hàng, kho và báo cáo.',
      keywords: ['danh muc', 'category', 'phan loai'],
      enabled: true,
    },
    {
      key: 'units',
      path: '/units',
      title: 'Đơn vị tính',
      group: 'Dữ liệu nền',
      description: 'Quản lý các đơn vị tính để đồng bộ dữ liệu giữa mua hàng, kho và sản xuất.',
      keywords: ['don vi tinh', 'unit', 'uom'],
      enabled: true,
    },
    {
      key: 'customers',
      path: '/customers',
      title: 'Khách hàng',
      group: 'Dữ liệu nền',
      description: 'Theo dõi hồ sơ khách hàng, công nợ và các chỉ số giao dịch liên quan.',
      keywords: ['khach hang', 'customer', 'crm'],
      enabled: true,
    },
    {
      key: 'customer-portal',
      path: '/customer-portal',
      title: 'Cổng khách hàng',
      group: 'Bán hàng',
      description: 'Tra cứu đơn hàng, hóa đơn, thanh toán và tài liệu khách hàng theo dữ liệu thực.',
      keywords: ['cong khach hang', 'portal', 'customer self service'],
      enabled: true,
    },
    {
      key: 'sales-orders',
      path: '/sales-orders',
      title: 'Đơn hàng xuất',
      group: 'Bán hàng',
      description: 'Lập kế hoạch giao hàng theo từng dòng, theo dõi tiến độ giao và xử lý các bước bán hàng chính.',
      keywords: ['don hang xuat', 'sales order', 'so', 'ban hang', 'ke hoach giao hang', 'lap ke hoach giao hang'],
      enabled: options.canViewSalesOrders,
      spotlight: options.canViewSalesOrders,
    },
    {
      key: 'sales-delivery-planning',
      path: '/sales-orders?section=delivery-planning',
      title: 'Kế hoạch giao hàng',
      group: 'Bán hàng',
      description: 'Đi thẳng tới Đơn hàng xuất để rà kế hoạch giao theo từng dòng hàng, đơn đến hạn và đơn quá hạn.',
      keywords: ['ke hoach giao hang', 'delivery planning', 'lich giao', 'giao hang theo dong'],
      enabled: options.canViewSalesOrders,
    },
    {
      key: 'shipments',
      path: '/shipments',
      title: 'Phiếu xuất',
      group: 'Bán hàng',
      description: 'Điều phối giao hàng, xe, tài xế, đóng gói, bàn giao xe và xác nhận giao xong.',
      keywords: ['phieu xuat', 'shipment', 'giao hang', 'dieu phoi giao hang', 'dieu phoi xe'],
      enabled: options.canViewSalesOrders,
    },
    {
      key: 'shipments-scan',
      path: '/shipments/scan',
      title: 'Quét QR kiện',
      group: 'Bán hàng',
      description: 'Quét nhanh mã kiện để tra cứu, xác minh, bốc xếp và chốt bàn giao giao hàng ngay trên điện thoại.',
      keywords: ['quet qr', 'qr', 'quet kien', 'ban giao xe', 'giao xong', 'boc xep'],
      enabled: true,
      spotlight: options.canUseShipmentExecutionWorkspace,
    },
    {
      key: 'quotes',
      path: '/quotes',
      title: 'Báo giá',
      group: 'Bán hàng',
      description: 'Quản lý báo giá, chính sách chiết khấu và chốt deal theo pipeline thương mại.',
      keywords: ['bao gia', 'quote', 'pricing'],
      enabled: options.canViewSalesOrders,
    },
    {
      key: 'quote-analytics',
      path: '/quote-analytics',
      title: 'Phân tích báo giá',
      group: 'Bán hàng',
      description: 'Phân tích tỷ lệ chốt, độ phủ báo giá và mức giá theo nhóm khách hàng.',
      keywords: ['phan tich bao gia', 'quote analytics', 'conversion'],
      enabled: options.canViewSalesOrders,
    },
    {
      key: 'sales-analytics',
      path: '/sales-analytics',
      title: 'Phân tích bán hàng',
      group: 'Bán hàng',
      description: 'Xem doanh thu, biến động đơn hàng và sức khỏe pipeline bán hàng.',
      keywords: ['phan tich ban hang', 'sales analytics', 'revenue'],
      enabled: options.canViewSalesOrders,
    },
    {
      key: 'discount-management',
      path: '/discount-management',
      title: 'Quản lý chiết khấu',
      group: 'Bán hàng',
      description: 'Theo dõi rule chiết khấu, phạm vi áp dụng và tín hiệu rủi ro giá bán.',
      keywords: ['chiet khau', 'discount', 'pricing rule'],
      enabled: options.canViewSalesOrders,
    },
    {
      key: 'suppliers',
      path: '/suppliers',
      title: 'Nhà cung cấp',
      group: 'Mua hàng',
      description: 'Quản lý hồ sơ nhà cung cấp, đánh giá hiệu quả và mức độ ưu tiên.',
      keywords: ['nha cung cap', 'supplier', 'vendor'],
      enabled: options.canManagePurchasing,
    },
    {
      key: 'purchase-orders',
      path: '/purchase-orders',
      title: 'Đơn mua',
      group: 'Mua hàng',
      description: 'Điều phối đơn mua, tiến độ nhận hàng và giá trị đơn theo nhà cung cấp.',
      keywords: ['don mua', 'purchase order', 'po'],
      enabled: options.canManagePurchasing,
      spotlight: options.canManagePurchasing,
    },
    {
      key: 'purchase-receipts',
      path: '/purchase-receipts',
      title: 'Phiếu nhập mua',
      group: 'Mua hàng',
      description: 'Theo dõi chứng từ nhập mua, chênh lệch số lượng và trạng thái ghi sổ.',
      keywords: ['phieu nhap mua', 'purchase receipt', 'grn'],
      enabled: options.canManagePurchasing,
    },
    {
      key: 'purchase-requests',
      path: '/purchase-requests',
      title: 'Yêu cầu mua',
      group: 'Mua hàng',
      description: 'Theo dõi yêu cầu mua, phê duyệt, từ chối và chuyển đổi sang đơn mua.',
      keywords: ['yeu cau mua', 'purchase request', 'pr'],
      enabled: options.canManagePurchasing,
    },
    {
      key: 'purchase-returns',
      path: '/purchase-returns',
      title: 'Phiếu trả hàng mua',
      group: 'Mua hàng',
      description: 'Kiểm soát hàng trả nhà cung cấp, lý do trả và bút toán liên quan.',
      keywords: ['tra hang mua', 'purchase return', 'return vendor'],
      enabled: options.canManagePurchasing,
    },
    {
      key: 'purchase-order-forecast',
      path: '/purchase-order-forecast',
      title: 'Dự báo đơn mua',
      group: 'Mua hàng',
      description: 'Biến forecast vật tư thành đề xuất mua và tạo đơn mua thật từ một nơi.',
      keywords: ['du bao don mua', 'forecast', 'replenishment'],
      enabled: options.canManagePurchasing,
      spotlight: options.canManagePurchasing,
    },
    {
      key: 'supplier-analytics',
      path: '/supplier-analytics',
      title: 'Phân tích nhà cung cấp',
      group: 'Mua hàng',
      description: 'Phân tích lead time, độ ổn định và chất lượng thực thi của từng nhà cung cấp.',
      keywords: ['phan tich nha cung cap', 'supplier analytics', 'lead time'],
      enabled: options.canManagePurchasing,
    },
    {
      key: 'material-prices',
      path: '/material-prices',
      title: 'Bảng giá nguyên vật liệu',
      group: 'Mua hàng',
      description: 'Quản lý bảng giá nguyên vật liệu và nguồn giá theo nhà cung cấp.',
      keywords: ['bang gia nvl', 'material price', 'gia nvl'],
      enabled: options.canManagePurchasing,
    },
    {
      key: 'production-orders',
      path: '/production-orders',
      title: 'Lệnh sản xuất',
      group: 'Sản xuất',
      description: 'Theo dõi lệnh sản xuất, phát lệnh, cấp vật tư và nhập thành phẩm trong cùng một command center.',
      keywords: ['lenh san xuat', 'trung tam lenh san xuat', 'production order', 'mo'],
      enabled: options.canAccessProductionCenter,
      spotlight: options.canAccessProductionCenter,
    },
    {
      key: 'material-issues',
      path: '/material-issues',
      title: 'Cấp vật tư',
      group: 'Sản xuất',
      description: 'Quản lý chứng từ cấp vật tư, số lượng cấp thực tế và hủy chứng từ an toàn.',
      keywords: ['cap vat tu', 'material issue', 'issue'],
      enabled: options.canAccessMaterialIssues,
    },
    {
      key: 'production-receipts',
      path: '/production-receipts',
      title: 'Nhập thành phẩm',
      group: 'Sản xuất',
      description: 'Theo dõi nhập kho thành phẩm, hủy chứng từ và liên kết với lệnh sản xuất.',
      keywords: ['nhap thanh pham', 'production receipt', 'finished goods'],
      enabled: options.canAccessProductionReceipts,
    },
    {
      key: 'production-costing',
      path: '/production-costing',
      title: 'Giá vốn sau sản xuất',
      group: 'Sản xuất',
      description: 'Phân tích chi phí sản xuất và giá vốn sau khi hoàn tất lệnh.',
      keywords: ['gia von sau san xuat', 'costing', 'production cost'],
      enabled: options.canManageProduction,
    },
    {
      key: 'inventory-stock',
      path: '/inventory-stock',
      title: 'Tồn kho',
      group: 'Kho',
      description: 'Xem tồn kho thời gian thực, cảnh báo rủi ro và phân bổ theo vị trí kho.',
      keywords: ['ton kho', 'inventory stock', 'stock overview'],
      enabled: options.canManageInventory,
      spotlight: options.canManageInventory,
    },
    {
      key: 'inventory-forecast',
      path: '/inventory-forecast',
      title: 'Dự báo tồn kho',
      group: 'Kho',
      description: 'Đánh giá mức bao phủ, nguy cơ stockout và tồn kho an toàn theo SKU.',
      keywords: ['du bao ton kho', 'inventory forecast', 'stockout'],
      enabled: options.canManageInventory,
    },
    {
      key: 'inventory-transactions',
      path: '/inventory-transactions',
      title: 'Sổ kho',
      group: 'Kho',
      description: 'Tra cứu chứng từ nhập xuất tồn, hủy chứng từ và audit biến động kho.',
      keywords: ['so kho', 'inventory transaction', 'ledger'],
      enabled: options.canManageInventory,
    },
    {
      key: 'inventory-reservations',
      path: '/inventory-reservations',
      title: 'Giữ chỗ tồn kho',
      group: 'Kho',
      description: 'Quản lý reservation, ưu tiên cấp hàng và cảnh báo khối lượng bị giữ chỗ.',
      keywords: ['giu cho ton kho', 'reservation', 'allocation'],
      enabled: options.canManageInventory,
    },
    {
      key: 'stock-alerts',
      path: '/stock-alerts',
      title: 'Cảnh báo tồn kho',
      group: 'Kho',
      description: 'Theo dõi cảnh báo tồn dưới ngưỡng, tồn ứ đọng và hành động khuyến nghị.',
      keywords: ['canh bao ton kho', 'stock alert', 'reorder'],
      enabled: options.canManageInventory,
    },
    {
      key: 'warehouse-transfers',
      path: '/warehouse-transfers',
      title: 'Chuyển kho',
      group: 'Kho',
      description: 'Điều phối phiếu chuyển kho, trạng thái ghi sổ và cân đối nguồn hàng nội bộ.',
      keywords: ['chuyen kho', 'warehouse transfer', 'internal transfer'],
      enabled: options.canManageInventory,
    },
    {
      key: 'warehouses',
      path: '/warehouses',
      title: 'Kho hàng',
      group: 'Kho',
      description: 'Quản lý kho, trạng thái kích hoạt và cấu hình vận hành ở từng điểm lưu trữ.',
      keywords: ['kho hang', 'warehouse', 'storage'],
      enabled: options.canManageInventory,
    },
    {
      key: 'warehouse-locations',
      path: '/warehouse-locations',
      title: 'Vị trí kho',
      group: 'Kho',
      description: 'Quản lý bin, zone và các vị trí kho phục vụ xuất nhập và kiểm đếm.',
      keywords: ['vi tri kho', 'warehouse location', 'bin location'],
      enabled: options.canManageInventory,
    },
    {
      key: 'stocktakes',
      path: '/stocktakes',
      title: 'Kiểm tồn',
      group: 'Kho',
      description: 'Tạo và vận hành đợt kiểm tồn với các bước kiểm kê, chốt số và ghi nhận lệch.',
      keywords: ['kiem ton', 'stocktake', 'cycle count'],
      enabled: options.canManageStocktake,
    },
    {
      key: 'employees',
      path: '/employees',
      title: 'Nhân viên',
      group: 'Nhân sự',
      description: 'Quản lý hồ sơ nhân viên, tổ chức và dữ liệu phục vụ chấm công, lương thưởng.',
      keywords: ['nhan vien', 'employee', 'hr'],
      enabled: options.canManageWorkforce,
    },
    {
      key: 'attendance',
      path: '/attendance',
      title: 'Chấm công',
      group: 'Nhân sự',
      description: 'Theo dõi công thực tế, tăng ca, nghỉ không phép và các điểm lệch ca làm việc.',
      keywords: ['cham cong', 'attendance', 'timesheet'],
      enabled: options.canManageWorkforce,
    },
    {
      key: 'bonus-penalty',
      path: '/bonus-penalty',
      title: 'Thưởng phạt',
      group: 'Nhân sự',
      description: 'Điều phối quyết định thưởng phạt và ảnh hưởng tới kỳ lương đang mở.',
      keywords: ['thuong phat', 'bonus', 'penalty'],
      enabled: options.canManageWorkforce,
    },
    {
      key: 'payroll',
      path: '/payroll',
      title: 'Bảng lương',
      group: 'Nhân sự',
      description: 'Khóa kỳ lương, kiểm tra thu nhập - khấu trừ và theo dõi trạng thái chi trả.',
      keywords: ['bang luong', 'payroll', 'salary'],
      enabled: options.canManageWorkforce,
      spotlight: options.canManageWorkforce,
    },
    {
      key: 'salary-advance',
      path: '/salary-advance',
      title: 'Ứng lương',
      group: 'Điểm nóng',
      description: ({ salaryAdvancePendingCount }) => salaryAdvancePendingCount > 0
        ? `Có ${salaryAdvancePendingCount} hồ sơ ứng lương đang chờ duyệt theo SLA.`
        : 'Theo dõi hồ sơ ứng lương, nhắc duyệt và lịch sử escalation theo SLA.',
      keywords: ['ung luong', 'salary advance', 'sla nhan su'],
      enabled: options.canManageWorkforce,
      badgeCount: options.salaryAdvancePendingCount,
      spotlight: options.canManageWorkforce,
    },
    {
      key: 'employee-performance',
      path: '/employee-performance',
      title: 'Đánh giá nhân viên',
      group: 'Nhân sự',
      description: 'Phân tích hiệu suất, điểm năng lực và tín hiệu lệch hiệu quả theo nhóm.',
      keywords: ['danh gia nhan vien', 'employee performance', 'okr'],
      enabled: options.canManageWorkforce,
    },
    {
      key: 'transaction-categories',
      path: '/transaction-categories',
      title: 'Loại thu chi',
      group: 'Tài chính',
      description: 'Chuẩn hóa nhóm thu chi để báo cáo, sổ quỹ và đối soát đi cùng một chuẩn.',
      keywords: ['loai thu chi', 'transaction category', 'cashflow'],
      enabled: options.canManageFinance,
    },
    {
      key: 'bank-accounts',
      path: '/bank-accounts',
      title: 'Ngân hàng',
      group: 'Tài chính',
      description: 'Quản lý tài khoản ngân hàng và kết nối với đối soát, thu chi và công nợ.',
      keywords: ['ngan hang', 'bank account', 'treasury'],
      enabled: options.canManageFinance,
    },
    {
      key: 'cash-book',
      path: '/cash-book',
      title: 'Sổ quỹ',
      group: 'Tài chính',
      description: 'Theo dõi chứng từ thu chi tiền mặt và tình trạng quỹ theo thời gian thực.',
      keywords: ['so quy', 'cash book', 'petty cash'],
      enabled: options.canManageFinance,
    },
    {
      key: 'advance-transactions',
      path: '/advance-transactions',
      title: 'Tạm ứng - quyết toán',
      group: 'Điểm nóng',
      description: ({ overdue90Count }) => overdue90Count > 0
        ? `Có ${overdue90Count} hồ sơ tạm ứng quá hạn trên 90 ngày cần ưu tiên xử lý.`
        : 'Theo dõi tạm ứng, quyết toán, SLA duyệt và lịch sử nhắc việc trên một command center.',
      keywords: ['tam ung', 'quyet toan', 'advance', 'settlement', 'sla tai chinh'],
      enabled: options.canManageFinance,
      badgeCount: options.overdue90Count,
      spotlight: options.canManageFinance,
    },
    {
      key: 'receivables',
      path: '/receivables',
      title: 'Công nợ phải thu',
      group: 'Tài chính',
      description: 'Theo dõi thu tiền, quá hạn và lịch sử xử lý công nợ khách hàng.',
      keywords: ['cong no phai thu', 'ar', 'receivable'],
      enabled: options.canManageFinance,
      spotlight: options.canManageFinance,
    },
    {
      key: 'aging-analysis',
      path: '/aging-analysis',
      title: 'Phân tích quá hạn',
      group: 'Tài chính',
      description: 'Phân tích tuổi nợ và theo dõi các bucket công nợ cần ưu tiên thu hồi.',
      keywords: ['phan tich qua han', 'aging', 'bucket cong no'],
      enabled: options.canManageFinance,
    },
    {
      key: 'payables',
      path: '/payables',
      title: 'Công nợ phải trả',
      group: 'Tài chính',
      description: 'Theo dõi lịch chi trả, trạng thái phê duyệt và đối tượng nhận thanh toán.',
      keywords: ['cong no phai tra', 'ap', 'payable'],
      enabled: options.canManageFinance,
      spotlight: options.canManageFinance,
    },
    {
      key: 'finance-summary',
      path: '/finance-summary',
      title: 'Tổng hợp tài chính',
      group: 'Tài chính',
      description: 'Theo dõi khóa kỳ, tổng hợp tháng, xu hướng 12 tháng và độ sẵn sàng đóng sổ.',
      keywords: ['tong hop tai chinh', 'finance summary', 'close period'],
      enabled: options.canManageFinance,
      spotlight: options.canManageFinance,
    },
    {
      key: 'profit-report',
      path: '/profit-report',
      title: 'Báo cáo lợi nhuận',
      group: 'Tài chính',
      description: 'Xem nhanh lợi nhuận theo kỳ, theo nhóm hàng và theo chiều điều hành.',
      keywords: ['loi nhuan', 'profit report', 'pnl'],
      enabled: options.canManageFinance,
    },
    {
      key: 'budget-management',
      path: '/budget-management',
      title: 'Quản lý ngân sách',
      group: 'Tài chính',
      description: 'Theo dõi ngân sách, variance và tình trạng sử dụng theo từng kế hoạch.',
      keywords: ['ngan sach', 'budget', 'variance'],
      enabled: options.canManageFinance,
    },
    {
      key: 'general-ledger',
      path: '/general-ledger',
      title: 'Sổ cái',
      group: 'Tài chính',
      description: 'Tra cứu bút toán phát sinh và đối chiếu dòng tiền theo tài khoản kế toán.',
      keywords: ['so cai', 'general ledger', 'gl'],
      enabled: options.canManageFinance,
    },
    {
      key: 'trial-balance',
      path: '/trial-balance',
      title: 'Bảng cân đối tài khoản',
      group: 'Tài chính',
      description: 'Kiểm tra số dư, cân bằng phát sinh và hỗ trợ khóa kỳ chính xác hơn.',
      keywords: ['bang can doi', 'trial balance', 'tb'],
      enabled: options.canManageFinance,
    },
    {
      key: 'bank-reconciliation',
      path: '/bank-reconciliation',
      title: 'Đối soát ngân hàng',
      group: 'Tài chính',
      description: 'Theo dõi đối soát, duyệt ghi sổ và xuất dữ liệu đối soát ngân hàng.',
      keywords: ['doi soat ngan hang', 'bank reconciliation', 'reconcile'],
      enabled: options.canManageFinance,
    },
    {
      key: 'executive-cockpit',
      path: '/executive-cockpit',
      title: 'Điều hành tổng hợp',
      group: 'Điều hành',
      description: 'Command center cho điều hành liên phòng ban, cảnh báo P0 và bàn giao ca.',
      keywords: ['dieu hanh tong hop', 'executive cockpit', 'p0'],
      enabled: options.canViewOps,
      spotlight: options.canViewOps,
    },
    {
      key: 'bi-dashboard',
      path: '/bi-dashboard',
      title: 'Điều hành BI',
      group: 'Điều hành',
      description: 'Theo dõi dashboard phân tích đa chiều phục vụ họp điều hành và forecast.',
      keywords: ['bi', 'dashboard', 'business intelligence'],
      enabled: options.canViewOps,
    },
    {
      key: 'task-operations',
      path: '/task-operations',
      title: 'Điều hành nhiệm vụ',
      group: 'Điều hành',
      description: 'Điều phối nhiệm vụ chặn luồng, workspace tác nghiệp và xử lý theo SLA.',
      keywords: ['dieu hanh nhiem vu', 'task operations', 'task board'],
      enabled: options.canViewOps,
      spotlight: options.canViewOps,
    },
    {
      key: 'workflow-task-templates',
      path: '/workflow-task-templates',
      title: 'Mẫu nhiệm vụ',
      group: 'Quy trình',
      description: 'Quản trị playbook, template và quy tắc gán người trong workflow.',
      keywords: ['mau nhiem vu', 'workflow template', 'playbook'],
      enabled: options.canManageWorkflow,
    },
    {
      key: 'workflow-pipeline',
      path: '/workflow-pipeline',
      title: 'Luồng công việc',
      group: 'Quy trình',
      description: 'Theo dõi pipeline công việc, trạng thái chặn, thẻ quá hạn và nhịp xử lý.',
      keywords: ['luong cong viec', 'workflow pipeline', 'kanban'],
      enabled: options.canViewWorkflow,
      spotlight: options.canViewWorkflow,
    },
    {
      key: 'workflow-analytics',
      path: '/workflow-analytics',
      title: 'Phân tích quy trình',
      group: 'Quy trình',
      description: 'Phân tích scheduler, độ trễ workflow, lịch sử chạy và cảnh báo vận hành.',
      keywords: ['phan tich quy trinh', 'workflow analytics', 'scheduler'],
      enabled: options.canViewWorkflow,
      spotlight: options.canViewWorkflow,
    },
    {
      key: 'approval-control-tower',
      path: '/admin/approval-control-tower',
      title: 'Trung tâm điều phối duyệt',
      group: 'Kiểm soát',
      description: 'Hợp nhất hàng chờ duyệt finance, workforce, purchasing và production trong một command center duy nhất.',
      keywords: ['dieu phoi duyet', 'approval control tower', 'hang cho duyet', 'approval queue'],
      enabled: options.canViewApprovalTower,
      spotlight: options.canViewApprovalTower,
    },
    {
      key: 'admin-audit-center',
      path: '/admin/audit-center',
      title: 'Trung tâm kiểm soát audit',
      group: 'Kiểm soát',
      description: 'Gom actor hotspot, biến động nhạy cảm và drilldown audit liên miền vào một command center chung.',
      keywords: ['kiem soat audit', 'audit center', 'audit hotspot', 'audit trail'],
      enabled: options.canViewAdminAudit,
      spotlight: options.canViewAdminAudit,
    },
    {
      key: 'admin-observability',
      path: '/admin/observability',
      title: 'Trung tâm sức khỏe hệ thống',
      group: 'Kiểm soát',
      description: 'Gom health check, scheduler, access governance và audit liên trung tâm trong một nơi.',
      keywords: ['suc khoe he thong', 'observability', 'health center', 'monitoring'],
      enabled: options.canViewAdminObservability,
      spotlight: options.canViewAdminObservability,
    },
    {
      key: 'operations-log',
      path: '/operations-log',
      title: 'Nhật ký vận hành',
      group: 'Điểm nóng',
      description: ({ operationsFailedCount }) => operationsFailedCount > 0
        ? `Có ${operationsFailedCount} sự kiện lỗi trong 24 giờ gần nhất cần rà soát.`
        : 'Theo dõi nhật ký vận hành, lỗi hệ thống và nhịp đồng bộ trực tiếp.',
      keywords: ['nhat ky van hanh', 'operations log', 'incident', 'error'],
      enabled: options.canViewOpsLog,
      badgeCount: options.operationsFailedCount,
      spotlight: options.canViewOpsLog,
    },
    {
      key: 'access-governance',
      path: '/admin/access-governance',
      title: 'Trung tâm giám sát truy cập',
      group: 'Kiểm soát',
      description: 'Theo dõi review truy cập, ngoại lệ, provisioning, offboarding và governance catalog.',
      keywords: ['giam sat truy cap', 'access governance', 'iam'],
      enabled: options.canViewAccessGovernance,
      spotlight: options.canViewAccessGovernance,
    },
    {
      key: 'access-exceptions',
      path: '/admin/access-exceptions',
      title: 'Ngoại lệ truy cập',
      group: 'Kiểm soát',
      description: 'Điều phối access exception, staged approval, automation và guided remediation.',
      keywords: ['ngoai le truy cap', 'access exception', 'exception policy'],
      enabled: options.canManageAccessExceptions,
    },
    {
      key: 'access-reviews',
      path: '/admin/access-reviews',
      title: 'Review truy cập',
      group: 'Kiểm soát',
      description: 'Tạo chiến dịch review, khóa tài khoản và theo dõi hoạt động rà soát truy cập.',
      keywords: ['review truy cap', 'access review', 'campaign'],
      enabled: options.canManageAccessReviews,
    },
    {
      key: 'user-provisioning',
      path: '/admin/user-provisioning',
      title: 'Bàn cấp tài khoản',
      group: 'Kiểm soát',
      description: 'Provision user, bàn giao credential và theo dõi watchlist cấp quyền.',
      keywords: ['cap tai khoan', 'provisioning', 'user onboarding access'],
      enabled: options.canManageProvisioning,
    },
    {
      key: 'user-lifecycle',
      path: '/admin/user-lifecycle',
      title: 'Bàn kết thúc vòng đời',
      group: 'Kiểm soát',
      description: 'Điều phối offboarding, thu hồi quyền và xác nhận hoàn tất xử lý vòng đời.',
      keywords: ['ket thuc vong doi', 'offboarding', 'lifecycle'],
      enabled: options.canManageLifecycle,
    },
    {
      key: 'onboarding-studio',
      path: '/admin/onboarding-studio',
      title: 'Trợ lý triển khai công việc',
      group: 'Quy trình',
      description: 'Tạo preset rollout, xem trước triển khai và theo dõi lịch sử áp dụng cho từng người dùng.',
      keywords: ['tro ly trien khai cong viec', 'onboarding studio', 'preset onboarding', 'rollout', 'ai ho tro trien khai'],
      enabled: options.canManageOnboarding,
    },
    {
      key: 'roles-teams',
      path: '/admin/roles-teams',
      title: 'Governance vai trò và nhóm',
      group: 'Kiểm soát',
      description: 'Theo dõi catalog vai trò, đội nhóm và lịch sử quản trị theo cụm kiểm soát.',
      keywords: ['role team governance', 'vai tro', 'team', 'governance'],
      enabled: options.canManageRoleTeams,
    },
    {
      key: 'admin-users',
      path: '/admin/users',
      title: 'Trung tâm người dùng',
      group: 'Kiểm soát',
      description: 'Điều phối tài khoản, trạng thái khóa, điểm nóng phiên đăng nhập và quick action.',
      keywords: ['nguoi dung', 'user control center', 'directory', 'tai khoan'],
      enabled: options.canManageUsers,
    },
    {
      key: 'module-permissions',
      path: '/admin/module-permissions',
      title: 'Phân quyền phân hệ',
      group: 'Kiểm soát',
      description: 'Quản trị quyền theo module, vai trò nhạy cảm và độ phủ RBAC toàn hệ thống.',
      keywords: ['phan quyen', 'module permission', 'rbac'],
      enabled: options.canManageModulePermissions,
    },
    {
      key: 'module-permissions-history',
      path: '/admin/module-permissions-history',
      title: 'Lịch sử phân quyền',
      group: 'Điểm nóng',
      description: ({ rbacAnomalyCount }) => rbacAnomalyCount > 0
        ? `Có ${rbacAnomalyCount} bất thường RBAC trong 24 giờ gần nhất cần rà soát.`
        : 'Theo dõi audit phân quyền, thay đổi vai trò và bất thường RBAC liên tục.',
      keywords: ['lich su phan quyen', 'rbac history', 'audit permission'],
      enabled: options.canViewRbacAudit,
      badgeCount: options.rbacAnomalyCount,
      spotlight: options.canViewRbacAudit,
    },
  ];

  return seeds
    .filter((seed) => seed.enabled)
    .map((seed) => ({
      key: seed.key,
      path: seed.path,
      title: seed.title,
      description: commandDescription(seed.description, options),
      group: seed.group,
      keywords: seed.keywords,
      badgeCount: seed.badgeCount,
      spotlight: seed.spotlight,
    }));
}
