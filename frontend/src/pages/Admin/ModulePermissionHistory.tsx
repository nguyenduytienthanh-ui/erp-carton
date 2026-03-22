import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Input, Modal, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../api/admin';
import type { RoleModulePermissionFreezeHistoryItem, RoleModulePermissionHistoryItem } from '../../types/admin';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { PAGES } from '../../utils/constants';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { QuickClearIcon } from '../../components';
import { canManageModulePermissionSettings } from '../../utils/authz';

type HistoryFilters = {
  roleCodeInput: string;
  days: '7' | '30' | '90' | 'all';
  userId: number | null;
  changedType: string;
};

function serializeFilters(filters: HistoryFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): HistoryFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<HistoryFilters>;
    return {
      roleCodeInput: String(parsed.roleCodeInput ?? ''),
      days: parsed.days === '7' || parsed.days === '30' || parsed.days === '90' ? parsed.days : '30',
      userId: typeof parsed.userId === 'number' ? parsed.userId : null,
      changedType: typeof parsed.changedType === 'string' && parsed.changedType ? parsed.changedType : 'all',
    };
  } catch {
    return { roleCodeInput: '', days: '30', userId: null, changedType: 'all' };
  }
}

type HistoryPrefConfig = {
  pageSize?: number;
};

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};

export default function ModulePermissionHistory() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const { config, saveConfig } = useUserPreferences(PAGES.ADMIN_MODULE_PERMISSION_HISTORY);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<HistoryFilters>({
    roleCodeInput: '',
    days: '30',
    userId: null,
    changedType: 'all',
  });
  const [page, setPage] = useState(1);
  const [freezeContext, setFreezeContext] = useState<{
    userId: number;
    displayName: string;
    prepareToken: string;
  } | null>(null);
  const [freezeConfirmText, setFreezeConfirmText] = useState('');
  const pageSize = Number(((config ?? {}) as HistoryPrefConfig).pageSize ?? 20);
  const canManageRbac = canManageModulePermissionSettings();

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const dateRange = useMemo((): { from?: string; to?: string } => {
    if (intentFilters.days === 'all') return {};
    const from = dayjs().subtract(Number(intentFilters.days), 'day').startOf('day');
    const to = dayjs().endOf('day');
    return {
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }, [intentFilters.days]);

  const params = useMemo(
    () => ({
      q: intentSearch.trim() || undefined,
      user_id: intentFilters.userId ?? undefined,
      date_from: dateRange.from,
      date_to: dateRange.to,
      role_code: intentFilters.roleCodeInput?.trim() || undefined,
      changed_type: intentFilters.changedType === 'all' ? undefined : intentFilters.changedType,
      page,
      page_size: pageSize,
    }),
    [
      intentSearch,
      intentFilters.userId,
      intentFilters.changedType,
      intentFilters.roleCodeInput,
      dateRange.from,
      dateRange.to,
      page,
      pageSize,
    ]
  );

  const listQuery = useQuery({
    queryKey: ['admin-module-permissions-history', params],
    queryFn: () => adminApi.getRoleModulePermissionHistory(params),
  });
  const freezeHistoryQuery = useQuery({
    queryKey: ['admin-module-permissions-freeze-history'],
    queryFn: () =>
      adminApi.getRoleModulePermissionFreezeHistory({
        page: 1,
        page_size: 50,
      }),
  });
  const historyMetaQuery = useQuery({
    queryKey: ['admin-module-permissions-history-meta'],
    queryFn: adminApi.getRoleModulePermissionHistoryMeta,
  });
  const freezePrepareAction = async (userId: number, displayName: string, reason: string) => {
    const prepared = await adminApi.prepareFreezeModulePermissionActor({
      user_id: userId,
      hours: 24,
      reason,
    });
    setFreezeConfirmText('');
    setFreezeContext({
      userId: prepared.target_user.id,
      displayName: displayName || prepared.target_user.full_name || prepared.target_user.username,
      prepareToken: prepared.prepare_token,
    });
  };
  const applyFreezeAction = async () => {
    if (!freezeContext) return;
    await adminApi.applyFreezeModulePermissionActor({
      prepare_token: freezeContext.prepareToken,
      confirm_text: freezeConfirmText.trim().toUpperCase(),
    });
    setFreezeContext(null);
    setFreezeConfirmText('');
    messageApi.success('Đã đóng băng tài khoản khỏi quyền chỉnh phân quyền trong 24 giờ.');
    await queryClient.invalidateQueries({ queryKey: ['admin-module-permissions-history'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-module-permissions-freeze-history'] });
  };
  const unfreezeAction = async (userId: number) => {
    await adminApi.unfreezeModulePermissionActor({
      user_id: userId,
      confirm_text: 'UNFREEZE',
    });
    messageApi.success('Đã gỡ đóng băng tài khoản.');
    await queryClient.invalidateQueries({ queryKey: ['admin-module-permissions-history'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-module-permissions-freeze-history'] });
  };

  const userOptions = useMemo(
    () => (historyMetaQuery.data?.users ?? []).map((item) => ({
      value: item.id,
      label: item.full_name?.trim() || item.username || `Người dùng #${item.id}`,
    })),
    [historyMetaQuery.data?.users]
  );
  const changedTypeOptions = useMemo(
    () => [
      { value: 'all', label: 'Mọi thay đổi quyền' },
      ...((historyMetaQuery.data?.changed_types ?? []).map((item) => ({
        value: item.value,
        label: item.label,
      }))),
    ],
    [historyMetaQuery.data?.changed_types]
  );

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;
  const summary = listQuery.data?.summary;
  const trendItems = useMemo(() => summary?.trend_12m ?? [], [summary?.trend_12m]);
  const anomalies24h = useMemo(() => summary?.anomalies_24h ?? [], [summary?.anomalies_24h]);
  const frozenActorCount = useMemo(
    () => anomalies24h.filter((item) => Boolean(item.is_frozen)).length,
    [anomalies24h]
  );
  const maxTrendEvents = useMemo(() => {
    if (trendItems.length === 0) return 1;
    return Math.max(...trendItems.map((item) => Number(item.events || 0)), 1);
  }, [trendItems]);

  const columns: ColumnsType<RoleModulePermissionHistoryItem> = [
    {
      title: 'Thời gian',
      dataIndex: 'created_at',
      width: 170,
      render: (value: string | null) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm:ss') : '-'),
    },
    {
      title: 'Người thao tác',
      dataIndex: 'user',
      width: 220,
      render: (user: RoleModulePermissionHistoryItem['user']) => {
        const display = user?.full_name?.trim() || user?.username || 'Hệ thống';
        return (
          <Space size={4}>
            <span>{display}</span>
            {user?.username ? <Tag>{user.username}</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: 'Hành động',
      dataIndex: 'action',
      width: 110,
      render: (action: string) => <Tag color="blue">{action}</Tag>,
    },
    {
      title: 'Số mục thay đổi',
      key: 'changed_count',
      width: 140,
      render: (_, record) => {
        const nextItems = (record.new_values?.items as unknown[]) ?? [];
        return nextItems.length;
      },
    },
    {
      title: 'Chi tiết',
      key: 'detail',
      render: (_, record) => {
        const oldItems = ((record.old_values?.items as Array<Record<string, unknown>>) ?? []);
        const newItems = ((record.new_values?.items as Array<Record<string, unknown>>) ?? []);
        const oldByRole = new Map(oldItems.map((item) => [Number(item.role_id), item]));
        return (
          <Space direction="vertical" size={4}>
            {newItems.map((next) => {
              const roleId = Number(next.role_id);
              const prev = oldByRole.get(roleId) ?? {};
              const roleCode = String(next.role_code ?? '');
              const roleName = String(next.role_name ?? '');
              const wfPrev = Boolean(prev.workforce_manage);
              const wfNext = Boolean(next.workforce_manage);
              const fiPrev = Boolean(prev.finance_manage);
              const fiNext = Boolean(next.finance_manage);
              const rbPrev = Boolean(prev.rbac_manage);
              const rbNext = Boolean(next.rbac_manage);
              return (
                <div key={`${record.id}-${roleId}`}>
                  <strong>{roleName || roleCode || `Vai trò #${roleId}`}</strong>{' '}
                  <Tag color={wfNext ? 'green' : 'default'}>Nhân sự: {wfPrev ? 'Bật' : 'Tắt'} {"->"} {wfNext ? 'Bật' : 'Tắt'}</Tag>
                  <Tag color={fiNext ? 'green' : 'default'}>Tài chính: {fiPrev ? 'Bật' : 'Tắt'} {"->"} {fiNext ? 'Bật' : 'Tắt'}</Tag>
                  <Tag color={rbNext ? 'gold' : 'default'}>RBAC: {rbPrev ? 'Bật' : 'Tắt'} {"->"} {rbNext ? 'Bật' : 'Tắt'}</Tag>
                </div>
              );
            })}
          </Space>
        );
      },
    },
  ];
  const freezeColumns: ColumnsType<RoleModulePermissionFreezeHistoryItem> = [
    {
      title: 'Thời gian',
      dataIndex: 'created_at',
      width: 170,
      render: (value: string | null) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm:ss') : '-'),
    },
    {
      title: 'Hành động',
      dataIndex: 'action',
      width: 120,
      render: (action: string) => (
        <Tag color={action === 'LOCK' ? 'red' : action === 'ACTIVATE' ? 'green' : 'default'}>
          {action === 'LOCK' ? 'Đóng băng' : action === 'ACTIVATE' ? 'Gỡ đóng băng' : action}
        </Tag>
      ),
    },
    {
      title: 'Người thao tác',
      dataIndex: 'actor',
      width: 220,
      render: (actor: RoleModulePermissionFreezeHistoryItem['actor']) => (
        <Space size={4}>
          <span>{actor.full_name?.trim() || actor.username || 'Hệ thống'}</span>
          {actor.username ? <Tag>{actor.username}</Tag> : null}
        </Space>
      ),
    },
    {
      title: 'Tài khoản mục tiêu',
      dataIndex: 'target_user',
      render: (target: RoleModulePermissionFreezeHistoryItem['target_user']) => (
        <Space size={4} wrap>
          <strong>{target.full_name?.trim() || target.username || '-'}</strong>
          {target.username ? <Tag>{target.username}</Tag> : null}
          {target.is_active_freeze ? <Tag color="blue">Đang đóng băng đến {target.frozen_until || '-'}</Tag> : null}
        </Space>
      ),
    },
  ];

  const selectedDaysLabel = useMemo(() => {
    if (filters.days === 'all') return 'Toàn thời gian';
    return `${filters.days} ngày gần nhất`;
  }, [filters.days]);
  const historyFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.roleCodeInput.trim()) tags.push(`Mã vai trò: ${intentFilters.roleCodeInput.trim()}`);
    if (intentFilters.userId != null) {
      const userLabel = userOptions.find((item) => item.value === intentFilters.userId)?.label;
      if (userLabel) tags.push(`Người thao tác: ${userLabel}`);
    }
    if (intentFilters.changedType !== 'all') {
      const changedLabel = changedTypeOptions.find((item) => item.value === intentFilters.changedType)?.label;
      if (changedLabel) tags.push(`Loại thay đổi: ${changedLabel}`);
    }
    tags.push(`Khoảng thời gian: ${selectedDaysLabel}`);
    return tags;
  }, [
    changedTypeOptions,
    intentFilters.changedType,
    intentFilters.roleCodeInput,
    intentFilters.userId,
    intentSearch,
    selectedDaysLabel,
    userOptions,
  ]);
  const activeActorCount = useMemo(() => new Set(rows.map((item) => item.user?.username || item.user?.id || 'system')).size, [rows]);
  const lockedEntries24h = useMemo(
    () => (freezeHistoryQuery.data?.results ?? []).filter((item) => item.action === 'LOCK').length,
    [freezeHistoryQuery.data?.results]
  );
  const historyStatusAlert = useMemo(() => {
    if (anomalies24h.length > 0) {
      return {
        type: 'warning' as const,
        message: 'Có tín hiệu bất thường trong luồng thay đổi phân quyền.',
        description: `${anomalies24h.length} tài khoản đang vượt ngưỡng cảnh báo trong 24 giờ gần nhất. Nên kiểm tra lịch sử và cân nhắc đóng băng tạm thời nếu cần.`,
      };
    }
    if (frozenActorCount > 0) {
      return {
        type: 'info' as const,
        message: 'Đang có tài khoản bị đóng băng thao tác.',
        description: `${frozenActorCount} tài khoản đang bị khóa quyền chỉnh phân quyền. Cần rà lại để xác nhận đã xử lý xong nguyên nhân.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Lịch sử phân quyền đang ổn định.',
      description: 'Chưa ghi nhận bất thường nổi bật trong cửa sổ đang theo dõi và không có cảnh báo khẩn cần can thiệp ngay.',
    };
  }, [anomalies24h.length, frozenActorCount]);

  const datePickerValue = useMemo((): [Dayjs, Dayjs] | null => {
    if (filters.days === 'all') return null;
    return [dayjs().subtract(Number(filters.days), 'day').startOf('day'), dayjs().endOf('day')];
  }, [filters.days]);

  const handleExportExcel = async () => {
    try {
      const blob = await adminApi.exportRoleModulePermissionHistoryExcel({
        q: intentSearch.trim() || undefined,
        user_id: intentFilters.userId ?? undefined,
        date_from: dateRange.from,
        date_to: dateRange.to,
        role_code: (intentFilters.roleCodeInput || '').trim() || undefined,
        changed_type: intentFilters.changedType === 'all' ? undefined : intentFilters.changedType,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lich_su_phan_quyen_phan_he.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      messageApi.success('Đã xuất Excel lịch sử phân quyền.');
    } catch {
      messageApi.error('Không thể xuất Excel lịch sử phân quyền.');
    }
  };

  return (
    <>
      {contextHolder}
      <Card
      title={(
        <Space>
          <HistoryOutlined />
          <span>Trung tâm lịch sử phân quyền phân hệ</span>
        </Space>
      )}
      extra={(
        <Space>
          <Button icon={<DownloadOutlined />} onClick={() => void handleExportExcel()}>
            Xuất Excel
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['admin-module-permissions-history'] })}
          >
            Làm mới
          </Button>
        </Space>
      )}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Theo dõi toàn bộ lịch sử thay đổi quyền theo vai trò, tín hiệu bất thường và các quyết định đóng băng tài khoản thao tác trong cùng một màn điều phối.
      </Typography.Paragraph>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Tag color={anomalies24h.length > 0 ? 'volcano' : 'green'}>
          {anomalies24h.length > 0 ? `Bất thường 24h: ${anomalies24h.length}` : 'Không có bất thường 24h'}
        </Tag>
        <Tag color={frozenActorCount > 0 ? 'blue' : 'default'}>
          {`Đang đóng băng: ${frozenActorCount}`}
        </Tag>
        <Tag>{`Người thao tác trong bộ lọc: ${activeActorCount}`}</Tag>
        <Tag>{`Khoảng xem: ${selectedDaysLabel}`}</Tag>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Tổng sự kiện" value={summary?.total_events ?? 0} />
            <Typography.Text type="secondary">Số lượt thay đổi đã ghi nhận trong cửa sổ đang xem.</Typography.Text>
          </div>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Lượt đổi theo vai trò" value={summary?.total_role_changes ?? 0} />
            <Typography.Text type="secondary">Tổng số bản ghi thay đổi quyền ở cấp vai trò.</Typography.Text>
          </div>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Tài khoản bất thường 24h" value={historyMetaQuery.data?.anomalies_24h_count ?? anomalies24h.length} />
            <Typography.Text type="secondary">Tài khoản vượt ngưỡng cảnh báo trong 24 giờ gần nhất.</Typography.Text>
          </div>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Lượt khóa gần đây" value={lockedEntries24h} />
            <Typography.Text type="secondary">{`Tài khoản đang đóng băng hiện tại: ${frozenActorCount}.`}</Typography.Text>
          </div>
        </Col>
      </Row>
      <Alert
        style={{ marginBottom: 12 }}
        showIcon
        type={historyStatusAlert.type}
        message={historyStatusAlert.message}
        description={historyStatusAlert.description}
      />
      <div style={{ marginBottom: 12 }}>
        <Space size={[8, 8]} wrap>
          {Object.entries(summary?.by_changed_type ?? {}).map(([key, value]) => {
            const label = changedTypeOptions.find((item) => item.value === key)?.label ?? key;
            return <Tag key={key} color="gold">{`${label}: ${value}`}</Tag>;
          })}
          {(summary?.top_actors ?? []).map((actor) => (
            <Tag key={`${actor.user_id ?? 'system'}-${actor.username}`}>
              {actor.full_name?.trim() || actor.username}: {actor.events} sự kiện
            </Tag>
          ))}
        </Space>
      </div>
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Xu hướng 12 tháng (số sự kiện)</div>
        {trendItems.length === 0 ? (
          <div style={{ color: '#8c8c8c' }}>Chưa có dữ liệu.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {trendItems.map((item) => {
              const widthPercent = Math.max(2, Math.round((Number(item.events || 0) / maxTrendEvents) * 100));
              return (
                <div
                  key={item.month}
                  style={{ display: 'grid', gridTemplateColumns: '70px 1fr 180px', gap: 8, alignItems: 'center' }}
                >
                  <div style={{ color: '#8c8c8c' }}>{item.month}</div>
                  <div style={{ height: 10, background: '#f5f5f5', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ width: `${widthPercent}%`, height: '100%', background: '#1677ff' }} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {item.events} sự kiện / {item.role_changes} lượt vai trò
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Cảnh báo bất thường 24h</div>
        {anomalies24h.length === 0 ? (
          <div style={{ color: '#8c8c8c' }}>Không có cảnh báo bất thường.</div>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {anomalies24h.map((item) => {
              const displayName = (item.full_name || item.username || 'Hệ thống').trim();
              const canAct = typeof item.user_id === 'number' && item.user_id > 0;
              const dangerColor = item.severity === 'high' ? 'red' : 'orange';
              return (
                <div
                  key={`${item.user_id ?? 'system'}-${item.username}`}
                  style={{
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    padding: '8px 10px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <Space size={[6, 6]} wrap>
                    <Tag color={dangerColor}>
                      {item.severity === 'high' ? 'Mức cao' : item.severity === 'medium' ? 'Mức trung bình' : 'Mức theo dõi'}
                    </Tag>
                    <strong>{displayName}</strong>
                    <Tag>{item.events_24h} sự kiện/24h</Tag>
                    <Tag>{item.role_changes_24h} lượt vai trò/24h</Tag>
                    {item.is_frozen ? <Tag color="blue">Đang đóng băng đến {item.frozen_until || '-'}</Tag> : null}
                  </Space>
                    {canAct && canManageRbac ? (
                      item.is_frozen ? (
                      <Button
                        size="small"
                        onClick={() => {
                          Modal.confirm({
                            title: `Gỡ đóng băng ${displayName}?`,
                            content: 'Hành động này khôi phục quyền chỉnh phân quyền phân hệ cho tài khoản.',
                            okText: 'Gỡ đóng băng',
                            cancelText: 'Hủy',
                            onOk: async () => {
                              await unfreezeAction(item.user_id as number);
                            },
                          });
                        }}
                      >
                        Gỡ đóng băng
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        danger
                        onClick={async () => {
                          try {
                            await freezePrepareAction(
                              item.user_id as number,
                              displayName,
                              `Bất thường 24h: ${item.events_24h} sự kiện, ${item.role_changes_24h} lượt đổi vai trò`,
                            );
                          } catch {
                            messageApi.error('Không thể chuẩn bị đóng băng tài khoản.');
                          }
                        }}
                      >
                        Đóng băng 24h
                      </Button>
                    )
                  ) : null}
                </div>
              );
            })}
          </Space>
        )}
      </div>

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
          placeholder="Tìm theo người thao tác, vai trò, nội dung thay đổi..."
          style={{ width: 360 }}
          suffix={searchInput.trim() ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" /> : undefined}
        />
        <Input
          value={filters.roleCodeInput}
          onChange={(e) => setFilters((prev) => ({ ...prev, roleCodeInput: e.target.value }))}
          placeholder="Lọc theo mã vai trò..."
          style={{ width: 220 }}
          suffix={filters.roleCodeInput.trim() ? <QuickClearIcon onClear={() => setFilters((prev) => ({ ...prev, roleCodeInput: '' }))} title="Xóa mã vai trò" /> : undefined}
        />
        <Select
          value={filters.userId}
          onChange={(value) => setFilters((prev) => ({ ...prev, userId: value }))}
          style={{ width: 220 }}
          placeholder="Lọc theo người thao tác"
          options={userOptions}
        />
        <Select
          value={filters.days}
          onChange={(value) => setFilters((prev) => ({ ...prev, days: value }))}
          style={{ width: 190 }}
          options={[
            { value: '7', label: '7 ngày gần nhất' },
            { value: '30', label: '30 ngày gần nhất' },
            { value: '90', label: '90 ngày gần nhất' },
            { value: 'all', label: 'Toàn thời gian' },
          ]}
        />
        <Select
          value={filters.changedType}
          onChange={(value) => setFilters((prev) => ({ ...prev, changedType: value }))}
          style={{ width: 220 }}
          options={changedTypeOptions}
        />
        <DatePicker.RangePicker
          value={datePickerValue}
          disabled
          style={{ width: 290 }}
        />
        <Tag>{selectedDaysLabel}</Tag>
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ roleCodeInput: '', days: '30', userId: null, changedType: 'all' });
            setPage(1);
          }}
          disabled={!searchInput.trim() && !filters.roleCodeInput.trim() && filters.days === '30' && filters.userId == null && filters.changedType === 'all'}
        >
          Xóa bộ lọc
        </Button>
      </div>
      {historyFilterTags.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {historyFilterTags.map((item) => (
            <Tag key={item}>{item}</Tag>
          ))}
          <Tag color="processing">{`Đang hiển thị ${rows.length}/${total} bản ghi`}</Tag>
        </div>
      )}

      <Table<RoleModulePermissionHistoryItem>
        rowKey="id"
        loading={listQuery.isLoading}
        dataSource={rows}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100'],
          onChange: (nextPage, nextPageSize) => {
            if (nextPageSize && nextPageSize !== pageSize) {
              void saveConfig({ pageSize: nextPageSize });
            }
            setPage(nextPage);
          },
        }}
      />
      <div style={{ marginTop: 16, border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Lịch sử đóng băng / gỡ đóng băng</div>
        <Table<RoleModulePermissionFreezeHistoryItem>
          rowKey="id"
          loading={freezeHistoryQuery.isLoading}
          dataSource={freezeHistoryQuery.data?.results ?? []}
          columns={freezeColumns}
          pagination={false}
          scroll={{ x: 860 }}
        />
      </div>
      </Card>
      <Modal
        title={freezeContext ? `Xác nhận đóng băng: ${freezeContext.displayName}` : 'Xác nhận đóng băng'}
        open={Boolean(freezeContext)}
        okText="Áp dụng đóng băng"
        cancelText="Hủy"
        okButtonProps={{ danger: true, disabled: freezeConfirmText.trim().toUpperCase() !== 'FREEZE' }}
        onOk={async () => {
          try {
            await applyFreezeAction();
          } catch {
            messageApi.error('Áp dụng đóng băng thất bại.');
          }
        }}
        onCancel={() => {
          setFreezeContext(null);
          setFreezeConfirmText('');
        }}
      >
        <Typography.Paragraph>
          Hành động này sẽ chặn tài khoản thay đổi phân quyền phân hệ trong 24 giờ.
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          Nhập <strong>FREEZE</strong> để xác nhận bước 2.
        </Typography.Paragraph>
        <Input
          value={freezeConfirmText}
          onChange={(e) => setFreezeConfirmText(e.target.value)}
          placeholder="Nhập FREEZE để xác nhận"
        />
      </Modal>
    </>
  );
}
