import { useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Select, message, Space, Switch, Table, Tag, Typography } from 'antd';
import { ReloadOutlined, SaveOutlined, SafetyOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../api/admin';
import type { RoleModulePermissionItem, RoleModulePermissionUpdatePayload } from '../../types/admin';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { QuickClearIcon } from '../../components';
import { PAGES } from '../../utils/constants';

type ModulePermissionConfig = {
  showInactive?: boolean;
};
type ModulePermissionFilters = {
  status: 'all' | 'active' | 'inactive' | 'draft' | 'sensitive';
};
type PermissionFieldKey =
  | 'workforce_manage'
  | 'finance_manage'
  | 'purchasing_manage'
  | 'purchasing_view'
  | 'inventory_view'
  | 'inventory_manage'
  | 'inventory_adjust'
  | 'inventory_stocktake'
  | 'inventory_transfer'
  | 'inventory_reserve'
  | 'production_manage'
  | 'ops_view'
  | 'reports_view'
  | 'customer_view'
  | 'customer_create'
  | 'customer_edit'
  | 'customer_submit'
  | 'customer_approve'
  | 'customer_reject'
  | 'customer_import'
  | 'customer_export'
  | 'customer_assign'
  | 'customer_delete'
  | 'workflow_view'
  | 'workflow_manage'
  | 'operations_log_view'
  | 'rbac_audit_view'
  | 'rbac_manage';

const DEFAULT_PERMISSION_FIELDS: Array<{ field: PermissionFieldKey; label: string }> = [
  { field: 'workforce_manage', label: 'Nhân sự' },
  { field: 'finance_manage', label: 'Tài chính' },
  { field: 'purchasing_manage', label: 'Mua hàng' },
  { field: 'purchasing_view', label: 'Mua hàng - xem' },
  { field: 'inventory_view', label: 'Kho - xem' },
  { field: 'inventory_manage', label: 'Kho - master data' },
  { field: 'inventory_adjust', label: 'Kho - điều chỉnh' },
  { field: 'inventory_stocktake', label: 'Kho - kiểm tồn' },
  { field: 'inventory_transfer', label: 'Kho - chuyển kho' },
  { field: 'inventory_reserve', label: 'Kho - giữ chỗ' },
  { field: 'production_manage', label: 'Sản xuất' },
  { field: 'ops_view', label: 'Điều hành' },
  { field: 'reports_view', label: 'Trung tâm báo cáo' },
  { field: 'customer_view', label: 'Khách hàng - xem' },
  { field: 'customer_create', label: 'Khách hàng - thêm mới' },
  { field: 'customer_edit', label: 'Khách hàng - sửa/trạng thái' },
  { field: 'customer_submit', label: 'Khách hàng - trình duyệt' },
  { field: 'customer_approve', label: 'Khách hàng - duyệt' },
  { field: 'customer_reject', label: 'Khách hàng - từ chối' },
  { field: 'customer_import', label: 'Khách hàng - nhập Excel' },
  { field: 'customer_export', label: 'Khách hàng - xuất dữ liệu' },
  { field: 'customer_assign', label: 'Khách hàng - phân công owner/team' },
  { field: 'customer_delete', label: 'Khách hàng - xóa cứng' },
  { field: 'workflow_view', label: 'Quy trình xem' },
  { field: 'workflow_manage', label: 'Quy trình quản lý' },
  { field: 'operations_log_view', label: 'Nhật ký vận hành' },
  { field: 'rbac_audit_view', label: 'Kiểm tra phân quyền' },
  { field: 'rbac_manage', label: 'Quản trị phân quyền' },
];

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
};

function serializeFilters(filters: ModulePermissionFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): ModulePermissionFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<ModulePermissionFilters>;
    if (parsed.status === 'active' || parsed.status === 'inactive' || parsed.status === 'draft' || parsed.status === 'sensitive') {
      return { status: parsed.status };
    }
  } catch {
    // ignore
  }
  return { status: 'all' };
}

export default function ModulePermissionSettings() {
  const queryClient = useQueryClient();
  const { config, saveConfig } = useUserPreferences(PAGES.ADMIN_MODULE_PERMISSIONS);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<ModulePermissionFilters>({ status: 'all' });
  const [showInactiveOverride, setShowInactiveOverride] = useState<boolean | null>(null);
  const [draftByRole, setDraftByRole] = useState<Record<number, Partial<Record<PermissionFieldKey, boolean>>>>({});

  const listQuery = useQuery({
    queryKey: ['admin-module-permissions'],
    queryFn: adminApi.getRoleModulePermissions,
  });

  const sourceItems = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const fieldMeta = listQuery.data?.field_meta;
  const permissionFields = useMemo(
    () => (fieldMeta?.length
      ? fieldMeta.map((item) => ({
          field: item.field as PermissionFieldKey,
          label: item.label,
        }))
      : DEFAULT_PERMISSION_FIELDS),
    [fieldMeta]
  );
  const configShowInactive = Boolean(((config ?? {}) as ModulePermissionConfig).showInactive);
  const showInactive = showInactiveOverride ?? configShowInactive;
  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });
  const sourceMap = useMemo(
    () => new Map(sourceItems.map((item) => [item.role_id, item])),
    [sourceItems]
  );
  const mergedItems = useMemo(
    () =>
      sourceItems.map((item) => ({
        ...item,
        ...(draftByRole[item.role_id] ?? {}),
      })),
    [sourceItems, draftByRole]
  );

  const saveMutation = useMutation({
    mutationFn: adminApi.updateRoleModulePermissions,
    onSuccess: (res) => {
      message.success(`Đã cập nhật ${res.updated} vai trò.`);
      setDraftByRole({});
      void queryClient.invalidateQueries({ queryKey: ['admin-module-permissions'] });
    },
    onError: () => {
      message.error('Không thể lưu cấu hình quyền phân hệ.');
    },
  });

  const hasChanges = useMemo(() => {
    return mergedItems.some((item) => {
      const original = sourceMap.get(item.role_id);
      if (!original) return true;
      return (
        permissionFields.some((field) => item[field.field] !== original[field.field])
      );
    });
  }, [mergedItems, sourceMap, permissionFields]);
  const draftRoleCount = useMemo(() => Object.keys(draftByRole).length, [draftByRole]);
  const activeRoleCount = useMemo(() => sourceItems.filter((item) => item.is_active).length, [sourceItems]);
  const inactiveRoleCount = useMemo(() => sourceItems.filter((item) => !item.is_active).length, [sourceItems]);
  const rbacManagerCount = useMemo(
    () => mergedItems.filter((item) => Boolean(item.rbac_manage)).length,
    [mergedItems]
  );
  const workflowManagerCount = useMemo(
    () => mergedItems.filter((item) => Boolean(item.workflow_manage)).length,
    [mergedItems]
  );
  const accessCoverage = useMemo(
    () => permissionFields
      .map((field) => ({
        label: field.label,
        enabled: mergedItems.filter((item) => Boolean(item[field.field])).length,
      }))
      .sort((a, b) => b.enabled - a.enabled)
      .slice(0, 6),
    [mergedItems, permissionFields]
  );

  const visibleItems = useMemo(
    () =>
      mergedItems.filter((item) => {
        if (!showInactive && !item.is_active) return false;
        if (intentFilters.status === 'active' && !item.is_active) return false;
        if (intentFilters.status === 'inactive' && item.is_active) return false;
        if (intentFilters.status === 'draft' && !draftByRole[item.role_id]) return false;
        if (intentFilters.status === 'sensitive' && !(item.rbac_manage || item.rbac_audit_view || item.workflow_manage)) return false;
        const keyword = intentSearch.trim().toLowerCase();
        if (!keyword) return true;
        return (
          item.role_name.toLowerCase().includes(keyword)
          || item.role_code.toLowerCase().includes(keyword)
        );
      }),
    [draftByRole, mergedItems, showInactive, intentFilters.status, intentSearch]
  );
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.status === 'active') tags.push('Chỉ hiển thị vai trò đang dùng');
    if (intentFilters.status === 'inactive') tags.push('Chỉ hiển thị vai trò ngừng dùng');
    if (intentFilters.status === 'draft') tags.push('Chỉ hiển thị vai trò đang chỉnh chưa lưu');
    if (intentFilters.status === 'sensitive') tags.push('Chỉ hiển thị vai trò nhạy cảm');
    if (showInactive) tags.push('Đang bật hiển thị vai trò ngừng dùng');
    return tags;
  }, [intentFilters.status, intentSearch, showInactive]);
  const visibleInactiveCount = useMemo(
    () => visibleItems.filter((item) => !item.is_active).length,
    [visibleItems]
  );
  const sensitiveRoleItems = useMemo(
    () => mergedItems.filter((item) => Boolean(item.rbac_manage || item.rbac_audit_view || item.workflow_manage)),
    [mergedItems]
  );
  const sensitiveRoleCount = sensitiveRoleItems.length;
  const highCoverageRoleCount = useMemo(
    () => mergedItems.filter((item) => permissionFields.filter((field) => Boolean(item[field.field])).length >= Math.max(4, Math.ceil(permissionFields.length * 0.6))).length,
    [mergedItems, permissionFields]
  );
  const reviewRoleItems = useMemo(() => {
    const priority = new Map<number, { item: RoleModulePermissionItem; reason: string; severity: 'warning' | 'error' | 'info' }>();
    mergedItems.forEach((item) => {
      const enabledCount = permissionFields.filter((field) => Boolean(item[field.field])).length;
      if (draftByRole[item.role_id]) {
        priority.set(item.role_id, { item, reason: 'Đang có bản nháp quyền chưa lưu', severity: 'warning' });
        return;
      }
      if (item.rbac_manage) {
        priority.set(item.role_id, { item, reason: 'Đang có quyền quản trị phân quyền', severity: 'error' });
        return;
      }
      if (item.rbac_audit_view || item.workflow_manage) {
        priority.set(item.role_id, { item, reason: 'Đang có quyền kiểm soát nhạy cảm', severity: 'info' });
        return;
      }
      if (enabledCount >= Math.max(4, Math.ceil(permissionFields.length * 0.6))) {
        priority.set(item.role_id, { item, reason: `Bật ${enabledCount} quyền trên nhiều phân hệ`, severity: 'info' });
      }
    });
    return Array.from(priority.values()).slice(0, 6);
  }, [draftByRole, mergedItems, permissionFields]);
  const settingsStatusAlert = useMemo(() => {
    if (draftRoleCount > 0) {
      return {
        type: 'warning' as const,
        message: 'Có thay đổi quyền chưa được lưu.',
        description: `${draftRoleCount} vai trò đang có bản nháp. Nên rà soát vai trò nhạy cảm trước khi áp dụng hàng loạt.`,
      };
    }
    if (sensitiveRoleCount > 0) {
      return {
        type: 'info' as const,
        message: 'Hệ thống đang có vai trò nhạy cảm cần theo dõi.',
        description: `${sensitiveRoleCount} vai trò đang giữ quyền RBAC hoặc quyền quản lý quy trình. Nên kiểm tra lịch sử thay đổi định kỳ.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Bộ quyền phân hệ đang ổn định.',
      description: 'Không có bản nháp chờ lưu và không có tín hiệu bất thường trong danh sách vai trò đang hiển thị.',
    };
  }, [draftRoleCount, sensitiveRoleCount]);

  const updateDraft = (roleId: number, key: PermissionFieldKey, value: boolean) => {
    const sourceItem = sourceMap.get(roleId);
    if (!sourceItem) return;
    setDraftByRole((prev) => {
      const current = prev[roleId] ?? Object.fromEntries(
        permissionFields.map((field) => [field.field, sourceItem[field.field]])
      ) as Partial<Record<PermissionFieldKey, boolean>>;
      const nextRoleState = { ...current, [key]: value };
      const isSameAsSource = permissionFields.every((field) => nextRoleState[field.field] === sourceItem[field.field]);
      if (isSameAsSource) {
        const rest = { ...prev };
        delete rest[roleId];
        return rest;
      }
      return {
        ...prev,
        [roleId]: nextRoleState,
      };
    });
  };

  const handleSave = async () => {
    const payload: RoleModulePermissionUpdatePayload = {
      items: mergedItems.map((item) => ({
        role_id: item.role_id,
        workforce_manage: Boolean(item.workforce_manage),
        finance_manage: Boolean(item.finance_manage),
        purchasing_manage: Boolean(item.purchasing_manage),
        purchasing_view: Boolean(item.purchasing_view),
        inventory_view: Boolean(item.inventory_view),
        inventory_manage: Boolean(item.inventory_manage),
        inventory_adjust: Boolean(item.inventory_adjust),
        inventory_stocktake: Boolean(item.inventory_stocktake),
        inventory_transfer: Boolean(item.inventory_transfer),
        inventory_reserve: Boolean(item.inventory_reserve),
        production_manage: Boolean(item.production_manage),
        ops_view: Boolean(item.ops_view),
        reports_view: Boolean(item.reports_view),
        customer_view: Boolean(item.customer_view),
        customer_create: Boolean(item.customer_create),
        customer_edit: Boolean(item.customer_edit),
        customer_submit: Boolean(item.customer_submit),
        customer_approve: Boolean(item.customer_approve),
        customer_reject: Boolean(item.customer_reject),
        customer_import: Boolean(item.customer_import),
        customer_export: Boolean(item.customer_export),
        customer_assign: Boolean(item.customer_assign),
        customer_delete: Boolean(item.customer_delete),
        workflow_view: Boolean(item.workflow_view),
        workflow_manage: Boolean(item.workflow_manage),
        operations_log_view: Boolean(item.operations_log_view),
        rbac_audit_view: Boolean(item.rbac_audit_view),
        rbac_manage: Boolean(item.rbac_manage),
      })),
    };
    await saveMutation.mutateAsync(payload);
  };

  const handleToggleShowInactive = async (checked: boolean) => {
    setShowInactiveOverride(checked);
    await saveConfig({ showInactive: checked });
  };

  return (
    <Card
      title={(
        <Space>
          <SafetyOutlined />
          <span>Trung tâm phân quyền phân hệ</span>
        </Space>
      )}
      extra={(
        <Space>
          <span>Hiện vai trò ngừng dùng</span>
          <Switch checked={showInactive} onChange={(checked) => void handleToggleShowInactive(checked)} />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['admin-module-permissions'] })}
          >
            Làm mới
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saveMutation.isPending}
            disabled={!hasChanges}
            onClick={() => void handleSave()}
          >
            Lưu thay đổi
          </Button>
        </Space>
      )}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Điều phối quyền truy cập theo vai trò cho các phân hệ lõi, khu vực quản trị và lớp kiểm soát vận hành. Thay đổi có hiệu lực ngay sau khi lưu.
      </Typography.Paragraph>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Tag color={hasChanges ? 'gold' : 'green'}>
          {hasChanges ? `Đang có ${draftRoleCount} vai trò chờ lưu` : 'Không có thay đổi chờ lưu'}
        </Tag>
        <Tag color={showInactive ? 'blue' : 'default'}>
          {showInactive ? 'Đang hiển thị cả vai trò ngừng dùng' : 'Đang ẩn vai trò ngừng dùng'}
        </Tag>
        <Tag color={sensitiveRoleCount > 0 ? 'volcano' : 'blue'}>
          {`Vai trò nhạy cảm: ${sensitiveRoleCount}`}
        </Tag>
        <Tag>{`Vai trò phủ rộng: ${highCoverageRoleCount}`}</Tag>
      </div>
      <div
        style={{
          marginBottom: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 10,
        }}
      >
        {[  
          { label: 'Tổng vai trò', value: sourceItems.length, tone: '#1d4ed8' },
          { label: 'Vai trò đang dùng', value: activeRoleCount, tone: '#0f766e' },
          { label: 'Vai trò ngừng dùng', value: inactiveRoleCount, tone: '#d97706' },
          { label: 'Vai trò quản trị RBAC', value: rbacManagerCount, tone: '#be123c' },
          { label: 'Vai trò nhạy cảm', value: sensitiveRoleCount, tone: '#7c2d12' },
          { label: 'Vai trò đang chỉnh chưa lưu', value: draftRoleCount, tone: '#b45309' },
        ].map((item) => (
          <div key={item.label} style={SUMMARY_TILE_STYLE}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.label}</Typography.Text>
            <div style={{ fontSize: 28, fontWeight: 700, color: item.tone, lineHeight: 1.15, marginTop: 6 }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
      <Alert
        style={{ marginBottom: 12 }}
        showIcon
        type={settingsStatusAlert.type}
        message={settingsStatusAlert.message}
        description={[
          settingsStatusAlert.description,
          visibleInactiveCount > 0 ? `${visibleInactiveCount} vai trò ngừng dùng đang hiện để rà soát.` : null,
          workflowManagerCount > 0 ? `${workflowManagerCount} vai trò có quyền quản lý quy trình.` : null,
        ].filter(Boolean).join(' ')}
      />
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {accessCoverage.map((item) => (
          <Tag key={item.label} color="blue">
            {item.label}: {item.enabled}/{mergedItems.length || 0} vai trò bật quyền
          </Tag>
        ))}
      </div>
      {reviewRoleItems.length > 0 && (
        <div
          style={{
            border: '1px solid #f0f0f0',
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
            background: 'linear-gradient(180deg, #ffffff 0%, #fafafa 100%)',
          }}
        >
          <Typography.Text strong>Vai trò cần rà soát ưu tiên</Typography.Text>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {reviewRoleItems.map(({ item, reason, severity }) => {
              const enabledCount = permissionFields.filter((field) => Boolean(item[field.field])).length;
              return (
                <div
                  key={item.role_id}
                  style={{
                    minWidth: 240,
                    flex: '1 1 240px',
                    border: '1px solid #e5e7eb',
                    borderRadius: 10,
                    padding: '10px 12px',
                    background: '#fff',
                  }}
                >
                  <Space size={[6, 6]} wrap>
                    <strong>{item.role_name}</strong>
                    <Tag>{item.role_code}</Tag>
                    <Tag color={severity === 'error' ? 'red' : severity === 'warning' ? 'gold' : 'blue'}>
                      {severity === 'error' ? 'Nhạy cảm cao' : severity === 'warning' ? 'Chờ lưu' : 'Cần rà soát'}
                    </Tag>
                  </Space>
                  <div style={{ marginTop: 6 }}>
                    <Typography.Text type="secondary">{reason}</Typography.Text>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Tag color="blue">{`Đang bật ${enabledCount} quyền`}</Tag>
                    {!item.is_active ? <Tag>Ngừng dùng</Tag> : null}
                    {item.workflow_manage ? <Tag color="purple">Quản lý quy trình</Tag> : null}
                    {item.rbac_manage ? <Tag color="volcano">Quản trị RBAC</Tag> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div
        style={{
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Tìm vai trò theo tên/mã..."
          style={{ width: 320 }}
          suffix={searchInput.trim() ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" /> : undefined}
        />
        <Select
          value={filters.status}
          onChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
          style={{ width: 180 }}
          options={[
            { value: 'all', label: 'Tất cả trạng thái' },
            { value: 'active', label: 'Đang dùng' },
            { value: 'inactive', label: 'Ngừng dùng' },
            { value: 'draft', label: 'Chưa lưu' },
            { value: 'sensitive', label: 'Nhạy cảm' },
          ]}
        />
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ status: 'all' });
          }}
          disabled={!searchInput.trim() && filters.status === 'all'}
        >
          Xóa bộ lọc
        </Button>
      </div>
      {activeFilterTags.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {activeFilterTags.map((item) => (
            <Tag key={item}>{item}</Tag>
          ))}
          <Tag color="processing">Hiển thị {visibleItems.length} vai trò</Tag>
        </div>
      )}
      <Table<RoleModulePermissionItem>
        rowKey="role_id"
        loading={listQuery.isLoading}
        dataSource={visibleItems}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        columns={[
          {
            title: 'Vai trò',
            dataIndex: 'role_name',
            key: 'role_name',
            render: (_value, record) => (
              <Space>
                <strong>{record.role_name}</strong>
                <Tag>{record.role_code}</Tag>
                <Tag color="blue">
                  {permissionFields.filter((field) => Boolean(record[field.field])).length} quyền bật
                </Tag>
                {record.rbac_manage ? <Tag color="volcano">Quản trị RBAC</Tag> : null}
                {record.rbac_audit_view ? <Tag color="gold">Kiểm tra RBAC</Tag> : null}
                {record.workflow_manage ? <Tag color="purple">Quản lý quy trình</Tag> : null}
                {!record.is_active ? <Tag color="default">Ngừng dùng</Tag> : null}
                {draftByRole[record.role_id] ? <Tag color="orange">Chưa lưu</Tag> : null}
              </Space>
            ),
          },
          ...permissionFields.map((field) => ({
            title: field.label,
            dataIndex: field.field,
            key: field.field,
            width: 170,
            render: (value: boolean, record: RoleModulePermissionItem) => (
              <Switch
                checked={Boolean(value)}
                onChange={(checked) => updateDraft(record.role_id, field.field, checked)}
              />
            ),
          })),
        ]}
        scroll={{ x: 1400 }}
      />
    </Card>
  );
}
