import { useMemo, useState } from 'react';
import { Button, Card, Col, DatePicker, Input, Modal, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
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

type HistoryFilters = {
  roleCodeInput: string;
  days: '7' | '30' | '90' | 'all';
  userId: number | null;
  changedType: 'all' | 'workforce' | 'finance' | 'rbac';
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
      changedType: parsed.changedType === 'workforce' || parsed.changedType === 'finance' || parsed.changedType === 'rbac'
        ? parsed.changedType
        : 'all',
    };
  } catch {
    return { roleCodeInput: '', days: '30', userId: null, changedType: 'all' };
  }
}

type HistoryPrefConfig = {
  pageSize?: number;
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
    messageApi.success('Đã đóng băng user khỏi quyền chỉnh phân quyền trong 24h.');
    await queryClient.invalidateQueries({ queryKey: ['admin-module-permissions-history'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-module-permissions-freeze-history'] });
  };
  const unfreezeAction = async (userId: number) => {
    await adminApi.unfreezeModulePermissionActor({
      user_id: userId,
      confirm_text: 'UNFREEZE',
    });
    messageApi.success('Đã gỡ đóng băng user.');
    await queryClient.invalidateQueries({ queryKey: ['admin-module-permissions-history'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-module-permissions-freeze-history'] });
  };

  const userOptions = useMemo(() => {
    const map = new Map<number, string>();
    (listQuery.data?.results ?? []).forEach((item) => {
      const userId = item.user?.id;
      if (typeof userId === 'number' && userId > 0) {
        const label = item.user.full_name?.trim() || item.user.username || `User #${userId}`;
        map.set(userId, label);
      }
    });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [listQuery.data?.results]);

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;
  const summary = listQuery.data?.summary;
  const trendItems = useMemo(() => summary?.trend_12m ?? [], [summary?.trend_12m]);
  const anomalies24h = useMemo(() => summary?.anomalies_24h ?? [], [summary?.anomalies_24h]);
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
                  <strong>{roleName || roleCode || `Role #${roleId}`}</strong>{' '}
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
      title: 'User mục tiêu',
      dataIndex: 'target_user',
      render: (target: RoleModulePermissionFreezeHistoryItem['target_user']) => (
        <Space size={4} wrap>
          <strong>{target.full_name?.trim() || target.username || '-'}</strong>
          {target.username ? <Tag>{target.username}</Tag> : null}
          {target.is_active_freeze ? <Tag color="blue">Đang freeze đến {target.frozen_until || '-'}</Tag> : null}
        </Space>
      ),
    },
  ];

  const selectedDaysLabel = useMemo(() => {
    if (filters.days === 'all') return 'Toàn thời gian';
    return `${filters.days} ngày gần nhất`;
  }, [filters.days]);

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
      a.download = 'module_permission_history.xlsx';
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
          <span>Lịch sử thay đổi phân quyền module</span>
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
        Tra cứu lịch sử bật/tắt quyền Nhân sự, Tài chính và quản trị phân quyền theo vai trò.
      </Typography.Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Tổng sự kiện" value={summary?.total_events ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Lượt đổi theo role" value={summary?.total_role_changes ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Đổi quyền Nhân sự" value={summary?.by_changed_type?.workforce ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="Đổi quyền Tài chính" value={summary?.by_changed_type?.finance ?? 0} />
          </Card>
        </Col>
      </Row>
      <div style={{ marginBottom: 12 }}>
        <Space size={[8, 8]} wrap>
          <Tag color="gold">Đổi quyền RBAC: {summary?.by_changed_type?.rbac ?? 0}</Tag>
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
                    {item.events} sự kiện / {item.role_changes} lượt role
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
              const displayName = (item.full_name || item.username || 'system').trim();
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
                    <Tag color={dangerColor}>{item.severity.toUpperCase()}</Tag>
                    <strong>{displayName}</strong>
                    <Tag>{item.events_24h} sự kiện/24h</Tag>
                    <Tag>{item.role_changes_24h} lượt role/24h</Tag>
                    {item.is_frozen ? <Tag color="blue">Đang đóng băng đến {item.frozen_until || '-'}</Tag> : null}
                  </Space>
                  {canAct ? (
                    item.is_frozen ? (
                      <Button
                        size="small"
                        onClick={() => {
                          Modal.confirm({
                            title: `Gỡ đóng băng ${displayName}?`,
                            content: 'Hành động này khôi phục quyền chỉnh phân quyền module cho user.',
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
                              `Anomaly 24h: ${item.events_24h} events, ${item.role_changes_24h} role changes`,
                            );
                          } catch {
                            messageApi.error('Không thể chuẩn bị đóng băng user.');
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
          placeholder="Lọc theo mã role..."
          style={{ width: 220 }}
          suffix={filters.roleCodeInput.trim() ? <QuickClearIcon onClear={() => setFilters((prev) => ({ ...prev, roleCodeInput: '' }))} title="Xóa mã role" /> : undefined}
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
          options={[
            { value: 'all', label: 'Mọi thay đổi quyền' },
            { value: 'workforce', label: 'Đổi quyền Nhân sự' },
            { value: 'finance', label: 'Đổi quyền Tài chính' },
            { value: 'rbac', label: 'Đổi quyền RBAC' },
          ]}
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
          Hành động này sẽ chặn user thay đổi phân quyền module trong 24 giờ.
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
