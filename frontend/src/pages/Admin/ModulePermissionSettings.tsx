import { useMemo, useState } from 'react';
import { Button, Card, Input, Select, message, Space, Switch, Table, Tag, Typography } from 'antd';
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
  status: 'all' | 'active' | 'inactive';
};
type PermissionFieldKey =
  | 'workforce_manage'
  | 'finance_manage'
  | 'ops_view'
  | 'workflow_view'
  | 'workflow_manage'
  | 'operations_log_view'
  | 'rbac_audit_view'
  | 'rbac_manage';

const DEFAULT_PERMISSION_FIELDS: Array<{ field: PermissionFieldKey; label: string }> = [
  { field: 'workforce_manage', label: 'Nhân sự' },
  { field: 'finance_manage', label: 'Tài chính' },
  { field: 'ops_view', label: 'Điều hành' },
  { field: 'workflow_view', label: 'Workflow xem' },
  { field: 'workflow_manage', label: 'Workflow quản lý' },
  { field: 'operations_log_view', label: 'Nhật ký vận hành' },
  { field: 'rbac_audit_view', label: 'Audit phân quyền' },
  { field: 'rbac_manage', label: 'Quản trị phân quyền' },
];

function serializeFilters(filters: ModulePermissionFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): ModulePermissionFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<ModulePermissionFilters>;
    if (parsed.status === 'active' || parsed.status === 'inactive') {
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
      message.error('Không thể lưu cấu hình quyền module.');
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

  const visibleItems = useMemo(
    () =>
      mergedItems.filter((item) => {
        if (!showInactive && !item.is_active) return false;
        if (intentFilters.status === 'active' && !item.is_active) return false;
        if (intentFilters.status === 'inactive' && item.is_active) return false;
        const keyword = intentSearch.trim().toLowerCase();
        if (!keyword) return true;
        return (
          item.role_name.toLowerCase().includes(keyword)
          || item.role_code.toLowerCase().includes(keyword)
        );
      }),
    [mergedItems, showInactive, intentFilters.status, intentSearch]
  );

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
        ops_view: Boolean(item.ops_view),
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
          <span>Phân quyền module theo vai trò</span>
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
        Bật/tắt quyền quản lý Nhân sự, Tài chính và màn phân quyền cho từng vai trò. Thay đổi có hiệu lực ngay sau khi lưu.
      </Typography.Paragraph>
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
                {!record.is_active ? <Tag color="default">Ngừng dùng</Tag> : null}
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
