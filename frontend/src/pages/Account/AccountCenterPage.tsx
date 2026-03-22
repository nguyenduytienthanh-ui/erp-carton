import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowRightOutlined, BellOutlined, CheckCircleOutlined, ClockCircleOutlined, LockOutlined, LogoutOutlined, MailOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';

import PageHeader from '../../components/PageHeader/PageHeader';
import { sessionsApi, usersApi } from '../../api/users';
import type { AccountActivityItem, AccountHubModuleAccess, ChangePasswordPayload, CurrentUserProfile, UpdateCurrentUserPayload, UserSessionRecord } from '../../api/users';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getToastMessage } from '../../shared/apiError';
import { theme } from '../../styles/theme';
import { PAGES } from '../../utils/constants';
import { storage } from '../../utils/storage';

const { Paragraph, Text, Title } = Typography;

const DEFAULT_EMAIL_NOTIFICATION_TYPES = ['mention', 'approval_request', 'approval_approved', 'approval_rejected'] as const;
const EMAIL_NOTIFICATION_OPTIONS = [
  { label: 'Nhắc đến trong bình luận', value: 'mention' },
  { label: 'Yêu cầu phê duyệt', value: 'approval_request' },
  { label: 'Phê duyệt thành công', value: 'approval_approved' },
  { label: 'Phê duyệt bị từ chối', value: 'approval_rejected' },
  { label: 'Phân công công việc', value: 'assignment' },
  { label: 'Nhắc hạn xử lý', value: 'due_date' },
  { label: 'Thông báo hệ thống', value: 'system' },
] as const;
const ACTIVITY_KIND_OPTIONS = [
  { label: 'Tất cả', value: 'all' },
  { label: 'Thông báo', value: 'notification' },
  { label: 'Hoạt động', value: 'audit' },
  { label: 'Bảo mật', value: 'session' },
] as const;

type AccountCenterPreferences = {
  activeTab?: string;
  email_notifications_enabled?: boolean;
  email_notification_types?: string[];
  activity_kind?: string;
};

function normalizePreferences(config: Record<string, unknown>): Required<AccountCenterPreferences> {
  const emailTypes = Array.isArray(config.email_notification_types)
    ? config.email_notification_types.map((value) => String(value).trim()).filter(Boolean)
    : [...DEFAULT_EMAIL_NOTIFICATION_TYPES];
  const activityKind = typeof config.activity_kind === 'string' ? config.activity_kind : 'all';
  return {
    activeTab: typeof config.activeTab === 'string' && config.activeTab ? config.activeTab : 'overview',
    email_notifications_enabled: typeof config.email_notifications_enabled === 'boolean' ? config.email_notifications_enabled : true,
    email_notification_types: emailTypes,
    activity_kind: ['all', 'notification', 'audit', 'session'].includes(activityKind) ? activityKind : 'all',
  };
}

function getInitials(profile?: CurrentUserProfile) {
  const source = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || profile?.username || 'U';
  return source.split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');
}

function tagColorFromTone(tone?: string) {
  if (tone === 'success') return 'green';
  if (tone === 'warning') return 'orange';
  if (tone === 'processing') return 'blue';
  if (tone === 'error') return 'red';
  if (tone === 'info') return 'cyan';
  return 'default';
}

function securityProgressStatus(level?: string): 'success' | 'active' | 'exception' {
  if (level === 'good') return 'success';
  if (level === 'critical') return 'exception';
  return 'active';
}

function priorityTagColor(priority?: string) {
  if (priority === 'URGENT') return 'red';
  if (priority === 'HIGH') return 'orange';
  if (priority === 'MEDIUM') return 'blue';
  return 'default';
}

function ActivityFeedList({ items, onOpen, emptyText }: { items: AccountActivityItem[]; onOpen: (route: string) => void; emptyText: string }) {
  if (items.length === 0) return <Empty description={emptyText} />;
  return (
    <List
      dataSource={items}
      renderItem={(item) => (
        <List.Item style={{ paddingInline: 0 }}>
          <Card size="small" style={{ width: '100%', borderRadius: 16, border: '1px solid #edf2f7' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <Space direction="vertical" size={6}>
                <Space wrap>
                  <Tag color={tagColorFromTone(item.tone)}>{item.kind_label}</Tag>
                  <Tag>{dayjs(item.timestamp).format('DD/MM HH:mm')}</Tag>
                </Space>
                <Text strong>{item.title}</Text>
                <Text type="secondary">{item.summary}</Text>
              </Space>
              <Button type="link" icon={<ArrowRightOutlined />} onClick={() => onOpen(item.route)}>
                Mở
              </Button>
            </div>
          </Card>
        </List.Item>
      )}
    />
  );
}

function AccessModuleCard({ item, onOpen }: { item: AccountHubModuleAccess; onOpen: (route: string) => void }) {
  return (
    <Card size="small" bodyStyle={{ padding: 18 }} style={{ height: '100%', borderRadius: 18, border: item.enabled ? '1px solid #bfdbfe' : '1px solid #edf2f7' }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <Space direction="vertical" size={4}>
            <Text strong>{item.label}</Text>
            <Text type="secondary">{item.description}</Text>
          </Space>
          <Tag color={item.enabled ? 'green' : 'default'}>{item.enabled ? 'Đang bật' : 'Chưa cấp'}</Tag>
        </div>
        <Space size={[8, 8]} wrap>
          {item.source_roles.length > 0 ? item.source_roles.map((role) => <Tag key={`${item.key}-${role}`}>{role}</Tag>) : <Tag>Chưa thấy vai trò nguồn</Tag>}
        </Space>
        <Button type={item.enabled ? 'primary' : 'default'} onClick={() => onOpen(item.primary_route)}>
          Đi tới phân hệ
        </Button>
      </Space>
    </Card>
  );
}

export default function AccountCenterPage() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [profileForm] = Form.useForm<UpdateCurrentUserPayload>();
  const [passwordForm] = Form.useForm<ChangePasswordPayload>();
  const [localPreferences, setLocalPreferences] = useState<Required<AccountCenterPreferences> | null>(null);
  const [activitySearch, setActivitySearch] = useState('');
  const deferredActivitySearch = useDeferredValue(activitySearch);

  const profileQuery = useQuery({ queryKey: ['current-user-profile'], queryFn: usersApi.me });
  const hubQuery = useQuery({ queryKey: ['account-hub'], queryFn: usersApi.getAccountHub });
  const sessionsQuery = useQuery({ queryKey: ['user-sessions'], queryFn: () => sessionsApi.list({ page_size: 50 }) });
  const { config, saveConfig } = useUserPreferences(PAGES.ACCOUNT_CENTER);
  const normalizedPreferences = useMemo(() => normalizePreferences(config), [config]);
  const preferenceState = localPreferences ?? normalizedPreferences;
  const activeTab = preferenceState.activeTab;
  const emailNotificationsEnabled = preferenceState.email_notifications_enabled;
  const emailNotificationTypes = preferenceState.email_notification_types;
  const activityKind = preferenceState.activity_kind;
  const activityFeedQuery = useQuery({
    queryKey: ['account-activity-feed', activityKind],
    queryFn: () => usersApi.getActivityFeed({ kind: activityKind, limit: 40 }),
    enabled: activeTab === 'overview',
  });

  useEffect(() => {
    if (!profileQuery.data) return;
    profileForm.setFieldsValue({
      first_name: profileQuery.data.first_name || '',
      last_name: profileQuery.data.last_name || '',
      email: profileQuery.data.email || '',
      phone: profileQuery.data.phone || '',
    });
  }, [profileForm, profileQuery.data]);

  const profile = profileQuery.data;
  const hub = hubQuery.data;
  const sessionResults = sessionsQuery.data?.results;
  const sessions = useMemo(() => sessionResults ?? [], [sessionResults]);
  const currentSession = useMemo(() => sessions.find((session) => session.is_current) ?? null, [sessions]);
  const activeSessions = useMemo(() => sessions.filter((session) => session.is_active), [sessions]);
  const filteredActivity = useMemo(() => {
    const keyword = deferredActivitySearch.trim().toLowerCase();
    return (activityFeedQuery.data?.items ?? []).filter((item) => (
      !keyword
      || item.title.toLowerCase().includes(keyword)
      || item.summary.toLowerCase().includes(keyword)
      || item.kind_label.toLowerCase().includes(keyword)
    ));
  }, [activityFeedQuery.data?.items, deferredActivitySearch]);

  function updatePreferences(overrides: Partial<Required<AccountCenterPreferences>>) {
    setLocalPreferences((current) => ({
      ...(current ?? normalizedPreferences),
      ...overrides,
    }));
  }

  async function persistPreferences(overrides: Partial<AccountCenterPreferences>, options?: { silent?: boolean; successMessage?: string }) {
    const payload = {
      ...preferenceState,
      ...overrides,
    };
    try {
      await saveConfig(payload);
      setLocalPreferences(payload);
      if (!options?.silent) messageApi.success(options?.successMessage || 'Đã cập nhật tùy chọn tài khoản');
    } catch (error) {
      if (!options?.silent) messageApi.error(getToastMessage(error));
      throw error;
    }
  }

  const profileMutation = useMutation({
    mutationFn: usersApi.updateMe,
    onSuccess: async (updatedProfile) => {
      queryClient.setQueryData(['current-user-profile'], updatedProfile);
      storage.setUser({ ...(storage.getUser() ?? { username: updatedProfile.username }), ...updatedProfile });
      await queryClient.invalidateQueries({ queryKey: ['account-hub'] });
      messageApi.success('Đã cập nhật thông tin cá nhân');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const changePasswordMutation = useMutation({
    mutationFn: usersApi.changePassword,
    onSuccess: async (result) => {
      passwordForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['account-hub'] });
      await queryClient.invalidateQueries({ queryKey: ['account-activity-feed'] });
      messageApi.success(result.revoked_sessions > 0 ? `Đã đổi mật khẩu và thu hồi ${result.revoked_sessions} phiên khác` : 'Đã đổi mật khẩu thành công');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const revokeSessionMutation = useMutation({
    mutationFn: sessionsApi.revoke,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['account-hub'] });
      await queryClient.invalidateQueries({ queryKey: ['account-activity-feed'] });
      messageApi.success('Đã thu hồi phiên đăng nhập');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const revokeAllMutation = useMutation({
    mutationFn: sessionsApi.revokeAll,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['account-hub'] });
      await queryClient.invalidateQueries({ queryKey: ['account-activity-feed'] });
      messageApi.success(result.count > 0 ? `Đã thu hồi ${result.count} phiên đăng nhập khác` : 'Không có phiên nào cần thu hồi');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const sessionColumns: ColumnsType<UserSessionRecord> = [
    { title: 'Thiết bị', key: 'device', width: 260, render: (_, row) => <Space direction="vertical" size={4}><Space wrap>{row.is_current ? <Tag color="blue">Phiên hiện tại</Tag> : null}{!row.is_active ? <Tag>Đã thu hồi</Tag> : null}</Space><Text strong>{row.device_summary}</Text><Text type="secondary">{row.ip_address}</Text></Space> },
    { title: 'Đăng nhập', dataIndex: 'login_at', key: 'login_at', width: 150, render: (value: string) => dayjs(value).format('DD/MM/YYYY HH:mm') },
    { title: 'Hoạt động cuối', dataIndex: 'last_active', key: 'last_active', width: 150, render: (value: string) => dayjs(value).format('DD/MM/YYYY HH:mm') },
    { title: 'Trạng thái', key: 'status', width: 120, render: (_, row) => <Tag color={row.is_active ? 'green' : 'default'}>{row.is_active ? 'Đang hoạt động' : 'Đã đóng'}</Tag> },
    {
      title: 'Hành động', key: 'actions', align: 'right', width: 120, render: (_, row) => (row.is_current || !row.is_active ? null : (
        <Popconfirm title="Thu hồi phiên đăng nhập?" okText="Thu hồi" cancelText="Hủy" onConfirm={() => revokeSessionMutation.mutate(row.id)}>
          <Button danger type="link" icon={<LogoutOutlined />} loading={revokeSessionMutation.isPending}>Thu hồi</Button>
        </Popconfirm>
      )),
    },
  ];

  const joinedAtLabel = profile?.date_joined ? dayjs(profile.date_joined).format('DD/MM/YYYY') : '-';
  const roleNames = profile?.roles?.map((role) => role.name).filter(Boolean) ?? [];
  const teamNames = profile?.teams?.map((team) => team.name).filter(Boolean) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
      {contextHolder}
      <PageHeader
        title="Trung tâm tài khoản"
        subtitle="Hồ sơ, bảo mật, quyền truy cập và tín hiệu vận hành cá nhân trong một nơi."
        icon={<SafetyCertificateOutlined />}
        extra={<><Button icon={<ThunderboltOutlined />} onClick={() => navigate('/task-inbox')}>Nhiệm vụ của tôi</Button><Button type="primary" icon={<BellOutlined />} onClick={() => navigate('/notifications')}>Mở thông báo</Button></>}
      />

      <Card bordered={false} bodyStyle={{ padding: 0 }} style={{ overflow: 'hidden', borderRadius: 28, background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 52%, #0f766e 100%)' }}>
        <div style={{ padding: 28, color: '#ffffff', background: 'radial-gradient(circle at top right, rgba(255,255,255,0.22), transparent 36%)' }}>
          <Row gutter={[24, 24]} align="middle">
            <Col xs={24} lg={14}>
              <Space size={18} align="start">
                <Avatar size={78} src={profile?.avatar_url || undefined} style={{ background: 'rgba(255,255,255,0.16)', color: '#ffffff', fontSize: 28, fontWeight: 700 }}>{getInitials(profile)}</Avatar>
                <div>
                  <Title level={2} style={{ color: '#ffffff', margin: 0 }}>{profile?.full_name?.trim() || profile?.username || 'Tài khoản'}</Title>
                  <Paragraph style={{ color: 'rgba(255,255,255,0.86)', margin: '8px 0 16px' }}>{profile?.email || 'Chưa cập nhật email'} · Tham gia từ {joinedAtLabel}</Paragraph>
                  <Space size={[8, 8]} wrap>
                    <Tag color="cyan">{profile?.is_staff ? 'Khối vận hành' : 'Người dùng hệ thống'}</Tag>
                    {roleNames.length > 0 ? roleNames.map((role) => <Tag key={role}>{role}</Tag>) : <Tag>Chưa gán vai trò</Tag>}
                    {teamNames.slice(0, 2).map((team) => <Tag key={team} color="geekblue">{team}</Tag>)}
                  </Space>
                </div>
              </Space>
            </Col>
            <Col xs={24} lg={10}>
              <Row gutter={[12, 12]}>
                <Col span={12}><Card bordered={false} bodyStyle={{ padding: 18 }} style={{ background: 'rgba(255,255,255,0.12)' }}><Statistic title={<span style={{ color: 'rgba(255,255,255,0.76)' }}>Hồ sơ</span>} value={hub?.profile_completion.score ?? 0} suffix="%" valueStyle={{ color: '#ffffff' }} /></Card></Col>
                <Col span={12}><Card bordered={false} bodyStyle={{ padding: 18 }} style={{ background: 'rgba(255,255,255,0.12)' }}><Statistic title={<span style={{ color: 'rgba(255,255,255,0.76)' }}>Bảo mật</span>} value={hub?.security.score ?? 0} suffix="/100" valueStyle={{ color: '#ffffff' }} /></Card></Col>
                <Col span={12}><Card bordered={false} bodyStyle={{ padding: 18 }} style={{ background: 'rgba(255,255,255,0.12)' }}><Statistic title={<span style={{ color: 'rgba(255,255,255,0.76)' }}>Việc mở</span>} value={hub?.work_summary.open_tasks ?? 0} valueStyle={{ color: '#ffffff' }} /></Card></Col>
                <Col span={12}><Card bordered={false} bodyStyle={{ padding: 18 }} style={{ background: 'rgba(255,255,255,0.12)' }}><Statistic title={<span style={{ color: 'rgba(255,255,255,0.76)' }}>Chưa đọc</span>} value={hub?.notification_summary.unread_count ?? 0} valueStyle={{ color: '#ffffff' }} /></Card></Col>
              </Row>
            </Col>
          </Row>
        </div>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          updatePreferences({ activeTab: key });
          void persistPreferences({ activeTab: key }, { silent: true });
        }}
        items={[
          {
            key: 'overview',
            label: 'Tổng quan',
            children: (
              <Space direction="vertical" size={24} style={{ width: '100%' }}>
                <Row gutter={[24, 24]}>
                  <Col xs={24} xl={16}>
                    <Card title="Sức khỏe tài khoản" loading={hubQuery.isLoading}>
                      <Row gutter={[18, 18]}>
                        <Col xs={24} md={12}>
                          <Card size="small" style={{ borderRadius: 16, border: '1px solid #edf2f7' }}>
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                              <Text strong>Độ hoàn thiện hồ sơ</Text>
                              <Progress percent={hub?.profile_completion.score ?? 0} status="active" />
                              {hub?.profile_completion.missing_fields.length
                                ? <Space size={[8, 8]} wrap>{hub.profile_completion.missing_fields.map((item) => <Tag key={item} color="gold">{item}</Tag>)}</Space>
                                : <Tag color="green">Hồ sơ đã đủ thông tin trọng yếu</Tag>}
                            </Space>
                          </Card>
                        </Col>
                        <Col xs={24} md={12}>
                          <Card size="small" style={{ borderRadius: 16, border: '1px solid #edf2f7' }}>
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                              <Text strong>Tư thế bảo mật</Text>
                              <Progress percent={hub?.security.score ?? 0} status={securityProgressStatus(hub?.security.level)} />
                              <Space wrap>
                                <Tag color={hub?.security.level === 'good' ? 'green' : hub?.security.level === 'critical' ? 'red' : 'orange'}>
                                  {hub?.security.level === 'good' ? 'Ổn định' : hub?.security.level === 'critical' ? 'Cần xử lý' : 'Cần rà soát'}
                                </Tag>
                                <Tag>{hub?.security.active_sessions ?? 0} phiên</Tag>
                              </Space>
                            </Space>
                          </Card>
                        </Col>
                        <Col xs={24}>
                          <Row gutter={[16, 16]}>
                            <Col xs={24} md={8}><Card size="small"><Statistic title="Quá hạn" value={hub?.work_summary.overdue_tasks ?? 0} /></Card></Col>
                            <Col xs={24} md={8}><Card size="small"><Statistic title="Cần hỗ trợ" value={hub?.work_summary.needs_help_tasks ?? 0} /></Card></Col>
                            <Col xs={24} md={8}><Card size="small"><Statistic title="Quan trọng chưa đọc" value={hub?.notification_summary.important_unread_count ?? 0} /></Card></Col>
                          </Row>
                        </Col>
                      </Row>
                    </Card>

                    <Card title="Nhiệm vụ ưu tiên" style={{ marginTop: 24 }} loading={hubQuery.isLoading}>
                      {(hub?.work_summary.preview.length ?? 0) === 0
                        ? <Empty description="Không có nhiệm vụ mở nào cần ưu tiên." />
                        : <List dataSource={hub?.work_summary.preview ?? []} renderItem={(item) => (
                          <List.Item style={{ paddingInline: 0 }}>
                            <Card size="small" style={{ width: '100%', borderRadius: 16, border: '1px solid #edf2f7' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                                <Space direction="vertical" size={6}>
                                  <Space wrap>
                                    <Tag color={priorityTagColor(item.priority)}>{item.priority_display}</Tag>
                                    <Tag>{item.status_display}</Tag>
                                    {item.needs_help ? <Tag color="red">Cần hỗ trợ</Tag> : null}
                                  </Space>
                                  <Text strong>{item.title}</Text>
                                  <Text type="secondary">{item.entity_code ? `${item.entity_type} · ${item.entity_code}` : item.entity_type}</Text>
                                </Space>
                                <Button type="link" icon={<ArrowRightOutlined />} onClick={() => navigate(item.route)}>Mở</Button>
                              </div>
                            </Card>
                          </List.Item>
                        )} />}
                    </Card>
                  </Col>

                  <Col xs={24} xl={8}>
                    <Card title="Hành động nhanh" loading={hubQuery.isLoading}>
                      <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Button block type="primary" icon={<ThunderboltOutlined />} onClick={() => navigate('/task-inbox')}>Xử lý nhiệm vụ của tôi</Button>
                        <Button block icon={<BellOutlined />} onClick={() => navigate('/notifications')}>Rà soát thông báo</Button>
                        {(hub?.access_summary.modules ?? []).filter((item) => item.enabled).slice(0, 4).map((item) => (
                          <Button key={item.key} block onClick={() => navigate(item.primary_route)}>{item.label}</Button>
                        ))}
                      </Space>
                    </Card>

                    <Card title="Phân hệ đang bật" style={{ marginTop: 24 }} loading={hubQuery.isLoading}>
                      <List
                        dataSource={(hub?.access_summary.modules ?? []).filter((item) => item.enabled)}
                        locale={{ emptyText: 'Chưa ghi nhận quyền truy cập nào.' }}
                        renderItem={(item) => (
                          <List.Item style={{ paddingInline: 0 }}>
                            <Space direction="vertical" size={4}>
                              <Text strong>{item.label}</Text>
                              <Text type="secondary">{item.description}</Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    </Card>
                  </Col>
                </Row>

                <Card title="Dòng hoạt động" extra={<Tag>{activityFeedQuery.data?.total ?? 0} mục</Tag>} loading={activityFeedQuery.isLoading && activeTab === 'overview'}>
                  <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                    <Col xs={24} lg={14}>
                      <Segmented
                        block
                        options={ACTIVITY_KIND_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
                        value={activityKind}
                        onChange={(value) => {
                          const next = String(value);
                          updatePreferences({ activity_kind: next });
                          void persistPreferences({ activity_kind: next }, { silent: true });
                        }}
                      />
                    </Col>
                    <Col xs={24} lg={10}>
                      <Input.Search allowClear placeholder="Tìm tiêu đề hoặc mô tả hoạt động" value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} />
                    </Col>
                  </Row>
                  <ActivityFeedList items={filteredActivity} onOpen={(route) => navigate(route)} emptyText="Chưa có hoạt động phù hợp với bộ lọc hiện tại." />
                </Card>
              </Space>
            ),
          },
          {
            key: 'profile',
            label: 'Hồ sơ',
            children: (
              <Row gutter={[24, 24]}>
                <Col xs={24} xl={16}>
                  <Card title="Thông tin cá nhân" loading={profileQuery.isLoading}>
                    <Form form={profileForm} layout="vertical">
                      <Row gutter={16}>
                        <Col xs={24} md={12}><Form.Item name="first_name" label="Họ"><Input placeholder="Nhập họ" /></Form.Item></Col>
                        <Col xs={24} md={12}><Form.Item name="last_name" label="Tên"><Input placeholder="Nhập tên" /></Form.Item></Col>
                      </Row>
                      <Row gutter={16}>
                        <Col xs={24} md={12}><Form.Item name="email" label="Email công việc" rules={[{ type: 'email', message: 'Email không hợp lệ' }]}><Input prefix={<MailOutlined />} placeholder="name@company.com" /></Form.Item></Col>
                        <Col xs={24} md={12}><Form.Item name="phone" label="Số điện thoại"><Input placeholder="Nhập số điện thoại" /></Form.Item></Col>
                      </Row>
                      <Space>
                        <Button type="primary" loading={profileMutation.isPending} onClick={async () => {
                          const values = await profileForm.validateFields();
                          profileMutation.mutate({ first_name: values.first_name?.trim() || '', last_name: values.last_name?.trim() || '', email: values.email?.trim() || '', phone: values.phone?.trim() || '' });
                        }}>Lưu thông tin</Button>
                        <Button onClick={() => profileForm.resetFields()}>Đặt lại</Button>
                      </Space>
                    </Form>
                  </Card>
                </Col>
                <Col xs={24} xl={8}>
                  <Card title="Tổng quan tài khoản" loading={profileQuery.isLoading || hubQuery.isLoading}>
                    <Descriptions column={1} size="small">
                      <Descriptions.Item label="Tên đăng nhập">{profile?.username || '-'}</Descriptions.Item>
                      <Descriptions.Item label="Ngày tham gia">{joinedAtLabel}</Descriptions.Item>
                      <Descriptions.Item label="Hồ sơ hoàn thiện"><Tag color="blue">{hub?.profile_completion.score ?? 0}%</Tag></Descriptions.Item>
                      <Descriptions.Item label="Phòng/nhóm">{teamNames.length > 0 ? teamNames.join(', ') : 'Chưa gán'}</Descriptions.Item>
                    </Descriptions>
                  </Card>
                  <Card title="Vai trò và nhóm" style={{ marginTop: 24 }} loading={profileQuery.isLoading}>
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div><Text strong>Vai trò</Text><div style={{ marginTop: 8 }}><Space size={[8, 8]} wrap>{roleNames.length > 0 ? roleNames.map((role) => <Tag key={role}>{role}</Tag>) : <Tag>Chưa gán vai trò</Tag>}</Space></div></div>
                      <div><Text strong>Nhóm</Text><div style={{ marginTop: 8 }}><Space size={[8, 8]} wrap>{teamNames.length > 0 ? teamNames.map((team) => <Tag key={team} color="geekblue">{team}</Tag>) : <Tag>Chưa gán nhóm</Tag>}</Space></div></div>
                    </Space>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'security',
            label: 'Bảo mật',
            children: (
              <Row gutter={[24, 24]}>
                <Col xs={24} xl={10}>
                  <Card title="Đổi mật khẩu">
                    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Sau khi đổi mật khẩu, các phiên đăng nhập khác sẽ bị thu hồi để giảm rủi ro." />
                    <Form form={passwordForm} layout="vertical">
                      <Form.Item name="current_password" label="Mật khẩu hiện tại" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu hiện tại' }]}>
                        <Input.Password prefix={<LockOutlined />} placeholder="Nhập mật khẩu hiện tại" />
                      </Form.Item>
                      <Form.Item name="new_password" label="Mật khẩu mới" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu mới' }]}>
                        <Input.Password prefix={<SafetyCertificateOutlined />} placeholder="Nhập mật khẩu mới" />
                      </Form.Item>
                      <Form.Item
                        name="confirm_password"
                        label="Xác nhận mật khẩu mới"
                        dependencies={['new_password']}
                        rules={[
                          { required: true, message: 'Vui lòng xác nhận mật khẩu mới' },
                          ({ getFieldValue }) => ({
                            validator(_, value) {
                              if (!value || value === getFieldValue('new_password')) return Promise.resolve();
                              return Promise.reject(new Error('Xác nhận mật khẩu không khớp'));
                            },
                          }),
                        ]}
                      >
                        <Input.Password prefix={<LockOutlined />} placeholder="Nhập lại mật khẩu mới" />
                      </Form.Item>
                      <Button type="primary" loading={changePasswordMutation.isPending} onClick={async () => {
                        const values = await passwordForm.validateFields();
                        changePasswordMutation.mutate(values);
                      }}>Cập nhật mật khẩu</Button>
                    </Form>
                  </Card>
                  <Card title="Khuyến nghị an toàn" style={{ marginTop: 24 }} loading={hubQuery.isLoading}>
                    <List
                      dataSource={hub?.security.recommendations ?? []}
                      renderItem={(item) => (
                        <List.Item style={{ paddingInline: 0 }}>
                          <Space align="start">
                            <CheckCircleOutlined style={{ color: theme.colors.success, marginTop: 3 }} />
                            <Text>{item}</Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Card>
                </Col>
                <Col xs={24} xl={14}>
                  <Card title="Quản lý phiên đăng nhập" extra={<Button danger loading={revokeAllMutation.isPending} onClick={() => revokeAllMutation.mutate()}>Thu hồi phiên khác</Button>}>
                    <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
                      <Col xs={24} md={8}><Card size="small"><Statistic title="Tổng phiên" value={sessions.length} prefix={<ClockCircleOutlined />} /></Card></Col>
                      <Col xs={24} md={8}><Card size="small"><Statistic title="Phiên hoạt động" value={activeSessions.length} prefix={<CheckCircleOutlined />} /></Card></Col>
                      <Col xs={24} md={8}><Card size="small"><Statistic title="Phiên hiện tại" value={currentSession?.browser || 'Trình duyệt web'} /></Card></Col>
                    </Row>
                    {sessions.length === 0
                      ? <Empty description="Chưa ghi nhận phiên đăng nhập nào." />
                      : <Table<UserSessionRecord> rowKey="id" columns={sessionColumns} dataSource={sessions} pagination={false} loading={sessionsQuery.isLoading} scroll={{ x: 760 }} />}
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'access',
            label: 'Quyền truy cập',
            children: (
              <Space direction="vertical" size={24} style={{ width: '100%' }}>
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={8}><Card><Statistic title="Phân hệ đang bật" value={hub?.access_summary.enabled_module_count ?? 0} /></Card></Col>
                  <Col xs={24} md={8}><Card><Statistic title="Vai trò đang gán" value={hub?.access_summary.roles.length ?? 0} /></Card></Col>
                  <Col xs={24} md={8}><Card><Statistic title="Permission đang có" value={hub?.access_summary.permission_count ?? 0} /></Card></Col>
                </Row>
                <Card title="Bản đồ quyền truy cập" loading={hubQuery.isLoading}>
                  <Row gutter={[16, 16]}>
                    {(hub?.access_summary.modules ?? []).map((item) => (
                      <Col xs={24} md={12} xl={8} key={item.key}>
                        <AccessModuleCard item={item} onOpen={(route) => navigate(route)} />
                      </Col>
                    ))}
                  </Row>
                </Card>
                <Card title="Permission nổi bật" loading={hubQuery.isLoading}>
                  <Space size={[8, 8]} wrap>
                    {(hub?.access_summary.top_permissions ?? []).length > 0
                      ? hub?.access_summary.top_permissions.map((item) => <Tag key={item.key} color="cyan">{item.key}</Tag>)
                      : <Tag>Chưa có permission nào được trả về</Tag>}
                  </Space>
                </Card>
              </Space>
            ),
          },
          {
            key: 'notifications',
            label: 'Thông báo',
            children: (
              <Row gutter={[24, 24]}>
                <Col xs={24} xl={16}>
                  <Card title="Chính sách email thông báo">
                    <Space direction="vertical" size={20} style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: 16, borderRadius: 16, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                        <div>
                          <Text strong>Bật email cho thông báo quan trọng</Text>
                          <div style={{ color: theme.colors.textSecondary, marginTop: 4 }}>Chỉ gửi email khi bạn cần theo dõi tác vụ khẩn hoặc các luồng phê duyệt.</div>
                        </div>
                        <Switch checked={emailNotificationsEnabled} onChange={(checked) => updatePreferences({ email_notifications_enabled: checked })} />
                      </div>
                      <Checkbox.Group
                        style={{ width: '100%' }}
                        value={emailNotificationTypes}
                        onChange={(values) => updatePreferences({ email_notification_types: values.map((value) => String(value)) })}
                        disabled={!emailNotificationsEnabled}
                      >
                        <Row gutter={[12, 12]}>
                          {EMAIL_NOTIFICATION_OPTIONS.map((option) => (
                            <Col xs={24} md={12} key={option.value}>
                              <Card size="small" style={{ borderRadius: 14, background: emailNotificationsEnabled ? '#ffffff' : '#fafafa' }}>
                                <Checkbox value={option.value}>{option.label}</Checkbox>
                              </Card>
                            </Col>
                          ))}
                        </Row>
                      </Checkbox.Group>
                      <Space>
                        <Button type="primary" icon={<BellOutlined />} onClick={() => void persistPreferences({ email_notifications_enabled: emailNotificationsEnabled, email_notification_types: emailNotificationsEnabled ? emailNotificationTypes : [] }, { successMessage: 'Đã lưu tùy chọn email' })}>Lưu tùy chọn email</Button>
                        <Button onClick={() => updatePreferences({ email_notifications_enabled: true, email_notification_types: [...DEFAULT_EMAIL_NOTIFICATION_TYPES] })}>Khôi phục mặc định</Button>
                      </Space>
                    </Space>
                  </Card>
                </Col>
                <Col xs={24} xl={8}>
                  <Card title="Hiện trạng thông báo" loading={hubQuery.isLoading}>
                    <List
                      dataSource={[
                        { title: 'Trạng thái email', value: emailNotificationsEnabled ? 'Đang bật' : 'Đang tắt', color: emailNotificationsEnabled ? 'green' : 'default' },
                        { title: 'Loại đang theo dõi', value: emailNotificationsEnabled ? `${emailNotificationTypes.length} loại` : '0 loại', color: 'blue' },
                        { title: 'Chưa đọc', value: `${hub?.notification_summary.unread_count ?? 0} thông báo`, color: (hub?.notification_summary.unread_count ?? 0) > 0 ? 'orange' : 'green' },
                        { title: 'Quan trọng chưa đọc', value: `${hub?.notification_summary.important_unread_count ?? 0} tín hiệu`, color: (hub?.notification_summary.important_unread_count ?? 0) > 0 ? 'red' : 'green' },
                      ]}
                      renderItem={(item) => (
                        <List.Item style={{ paddingInline: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
                            <Text>{item.title}</Text>
                            <Tag color={item.color}>{item.value}</Tag>
                          </div>
                        </List.Item>
                      )}
                    />
                  </Card>
                </Col>
              </Row>
            ),
          },
        ]}
      />
    </div>
  );
}
