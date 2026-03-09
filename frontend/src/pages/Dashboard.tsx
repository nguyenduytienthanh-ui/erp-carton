import { useMemo } from 'react';
import { Button, Card, Col, Row, Statistic, Progress, Tag, Space, Spin, message } from 'antd';
import {
  AppstoreOutlined,
  TagsOutlined,
  ToolOutlined,
  DollarOutlined,
  RiseOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { financeApi } from '../api/finance';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { canManageFinanceData } from '../utils/authz';
import { PAGES } from '../utils/constants';
import { theme } from '../styles/theme';

const Dashboard = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const canManageFinance = canManageFinanceData();
  const { config, saveConfig } = useUserPreferences(PAGES.DASHBOARD);
  const overdueOverviewQuery = useQuery({
    queryKey: ['dashboard-overdue-overview'],
    queryFn: () => financeApi.getAdvanceOverdueOverview(),
    enabled: canManageFinance,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const remindMutation = useMutation({
    mutationFn: () => financeApi.remindOverdueAdvances({ threshold_days: 90 }),
    onSuccess: (data) => {
      messageApi.success(`Đã gửi nhắc quá hạn: ${data.sent_count} người nhận`);
    },
    onError: () => {
      messageApi.error('Gửi nhắc quá hạn thất bại');
    },
  });
  const bucket90 = useMemo(
    () => overdueOverviewQuery.data?.buckets?.find((bucket) => bucket.threshold_days === 90),
    [overdueOverviewQuery.data?.buckets]
  );
  const overdue90Count = bucket90?.count ?? 0;
  const overdue90Amount = bucket90?.total_remaining ?? '0';
  const overdue90Signature = `${overdueOverviewQuery.data?.as_of || ''}|${overdue90Count}|${overdue90Amount}`;
  const ackData = (config as Record<string, unknown>)?.financeOverdueAck as
    | { signature?: string; ackedAt?: string }
    | undefined;
  const isAcked = overdue90Count > 0 && ackData?.signature === overdue90Signature;

  return (
    <div>
      {contextHolder}
      {/* Welcome Header */}
      <Card
        bordered={false}
        style={{
          marginBottom: theme.spacing.lg,
          borderRadius: theme.borderRadius.lg,
          background: `linear-gradient(135deg, ${theme.colors.primary} 0%, ${theme.colors.primaryActive} 100%)`,
          color: 'white',
        }}
      >
        <div style={{ padding: theme.spacing.md }}>
          <h1
            style={{
              color: 'white',
              marginBottom: theme.spacing.sm,
              fontSize: theme.typography.fontSize.xxl,
              fontWeight: theme.typography.fontWeight.bold,
            }}
          >
            🏭 Chào mừng đến với ERP Thùng Carton!
          </h1>
          <p
            style={{
              color: 'rgba(255, 255, 255, 0.9)',
              fontSize: theme.typography.fontSize.md,
              margin: 0,
            }}
          >
            Hệ thống quản lý sản xuất và kinh doanh thùng carton chuyên nghiệp
          </p>
        </div>
      </Card>

      {canManageFinance && (
        <Card
          bordered={false}
          style={{
            marginBottom: theme.spacing.lg,
            borderRadius: theme.borderRadius.lg,
            boxShadow: theme.shadows.sm,
            border: `1px solid ${overdue90Count > 0 ? '#ffccc7' : '#d9f7be'}`,
          }}
        >
          {overdueOverviewQuery.isLoading ? (
            <div style={{ textAlign: 'center', padding: theme.spacing.md }}>
              <Spin />
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.semibold }}>
                  {'Cảnh báo tạm ứng quá hạn >= 90 ngày'}
                </div>
                <div style={{ color: theme.colors.textSecondary }}>
                  {`Số phiếu: ${overdue90Count} | Tổng còn phải quyết toán: ${Number(overdue90Amount).toLocaleString('vi-VN')} đ`}
                </div>
                <div style={{ marginTop: 6 }}>
                  {overdue90Count <= 0 ? (
                    <Tag color="success">Không có rủi ro mức 90 ngày</Tag>
                  ) : isAcked ? (
                    <Tag color="blue">Đã xác nhận xử lý hôm nay</Tag>
                  ) : (
                    <Tag color="red">Chưa xác nhận xử lý</Tag>
                  )}
                </div>
              </div>
              <Space>
                <Button
                  disabled={overdue90Count <= 0}
                  onClick={async () => {
                    await saveConfig({
                      ...(config as Record<string, unknown>),
                      financeOverdueAck: {
                        signature: overdue90Signature,
                        ackedAt: new Date().toISOString(),
                      },
                    });
                    messageApi.success('Đã xác nhận đã xử lý cảnh báo quá hạn');
                  }}
                >
                  Đã xử lý
                </Button>
                <Button
                  type="primary"
                  danger={overdue90Count > 0}
                  loading={remindMutation.isPending}
                  disabled={overdue90Count <= 0}
                  onClick={() => remindMutation.mutate()}
                >
                  Gửi nhắc ngay
                </Button>
              </Space>
            </div>
          )}
        </Card>
      )}

      {/* Statistics Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: theme.spacing.lg }}>
        <Col xs={24} sm={12} md={6}>
          <Card
            bordered={false}
            style={{
              borderRadius: theme.borderRadius.lg,
              boxShadow: theme.shadows.sm,
            }}
          >
            <Statistic
              title={
                <span
                  style={{
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.textSecondary,
                  }}
                >
                  Tổng sản phẩm
                </span>
              }
              value={3}
              prefix={
                <AppstoreOutlined
                  style={{
                    color: theme.colors.success,
                    fontSize: theme.typography.fontSize.xl,
                  }}
                />
              }
              valueStyle={{
                color: theme.colors.success,
                fontSize: theme.typography.fontSize.xxl,
                fontWeight: theme.typography.fontWeight.bold,
              }}
              suffix={
                <Tag color="success" style={{ marginLeft: theme.spacing.sm }}>
                  <RiseOutlined /> +2
                </Tag>
              }
            />
            <Progress
              percent={75}
              showInfo={false}
              strokeColor={theme.colors.success}
              style={{ marginTop: theme.spacing.sm }}
            />
            <div
              style={{
                marginTop: theme.spacing.xs,
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.textSecondary,
              }}
            >
              <CheckCircleOutlined /> 3 đang bán
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card
            bordered={false}
            style={{
              borderRadius: theme.borderRadius.lg,
              boxShadow: theme.shadows.sm,
            }}
          >
            <Statistic
              title={
                <span
                  style={{
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.textSecondary,
                  }}
                >
                  Danh mục
                </span>
              }
              value={3}
              prefix={
                <TagsOutlined
                  style={{
                    color: theme.colors.info,
                    fontSize: theme.typography.fontSize.xl,
                  }}
                />
              }
              valueStyle={{
                color: theme.colors.info,
                fontSize: theme.typography.fontSize.xxl,
                fontWeight: theme.typography.fontWeight.bold,
              }}
            />
            <Progress
              percent={100}
              showInfo={false}
              strokeColor={theme.colors.info}
              style={{ marginTop: theme.spacing.sm }}
            />
            <div
              style={{
                marginTop: theme.spacing.xs,
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.textSecondary,
              }}
            >
              <CheckCircleOutlined /> Đầy đủ
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card
            bordered={false}
            style={{
              borderRadius: theme.borderRadius.lg,
              boxShadow: theme.shadows.sm,
            }}
          >
            <Statistic
              title={
                <span
                  style={{
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.textSecondary,
                  }}
                >
                  Đơn vị tính
                </span>
              }
              value={3}
              prefix={
                <ToolOutlined
                  style={{
                    color: theme.colors.warning,
                    fontSize: theme.typography.fontSize.xl,
                  }}
                />
              }
              valueStyle={{
                color: theme.colors.warning,
                fontSize: theme.typography.fontSize.xxl,
                fontWeight: theme.typography.fontWeight.bold,
              }}
            />
            <Progress
              percent={100}
              showInfo={false}
              strokeColor={theme.colors.warning}
              style={{ marginTop: theme.spacing.sm }}
            />
            <div
              style={{
                marginTop: theme.spacing.xs,
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.textSecondary,
              }}
            >
              <CheckCircleOutlined /> Cái, Hộp, Kiện
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card
            bordered={false}
            style={{
              borderRadius: theme.borderRadius.lg,
              boxShadow: theme.shadows.sm,
            }}
          >
            <Statistic
              title={
                <span
                  style={{
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.textSecondary,
                  }}
                >
                  Bảng giá
                </span>
              }
              value={0}
              prefix={
                <DollarOutlined
                  style={{
                    color: theme.colors.primary,
                    fontSize: theme.typography.fontSize.xl,
                  }}
                />
              }
              valueStyle={{
                color: theme.colors.primary,
                fontSize: theme.typography.fontSize.xxl,
                fontWeight: theme.typography.fontWeight.bold,
              }}
            />
            <Progress
              percent={0}
              showInfo={false}
              strokeColor={theme.colors.primary}
              style={{ marginTop: theme.spacing.sm }}
            />
            <div
              style={{
                marginTop: theme.spacing.xs,
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.textSecondary,
              }}
            >
              <ClockCircleOutlined /> Chưa có dữ liệu
            </div>
          </Card>
        </Col>
      </Row>

      {/* Features Section */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card
            title={
              <span
                style={{
                  fontSize: theme.typography.fontSize.lg,
                  fontWeight: theme.typography.fontWeight.semibold,
                }}
              >
                🎯 Tính năng hệ thống
              </span>
            }
            bordered={false}
            style={{
              borderRadius: theme.borderRadius.lg,
              boxShadow: theme.shadows.sm,
              height: '100%',
            }}
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <FeatureItem
                icon="✅"
                title="Quản lý sản phẩm"
                desc="CRUD, Search, Filter, Export/Import"
                status="done"
              />
              <FeatureItem
                icon="✅"
                title="Quản lý danh mục"
                desc="Phân loại sản phẩm theo cây"
                status="done"
              />
              <FeatureItem
                icon="✅"
                title="Quản lý đơn vị tính"
                desc="Cái, Hộp, Kiện, Tấn..."
                status="done"
              />
              <FeatureItem
                icon="✅"
                title="Quản lý bảng giá"
                desc="Giá theo khách hàng, số lượng"
                status="done"
              />
              <FeatureItem
                icon="✅"
                title="Export/Import Excel"
                desc="Xuất nhập dữ liệu hàng loạt"
                status="done"
              />
              <FeatureItem
                icon="✅"
                title="Phân quyền Data Scope"
                desc="Owner, Team, Global"
                status="done"
              />
              <FeatureItem
                icon="🚧"
                title="Module đơn hàng"
                desc="Đang phát triển..."
                status="progress"
              />
              <FeatureItem
                icon="🚧"
                title="Module kho"
                desc="Đang phát triển..."
                status="progress"
              />
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title={
              <span
                style={{
                  fontSize: theme.typography.fontSize.lg,
                  fontWeight: theme.typography.fontWeight.semibold,
                }}
              >
                📊 Thống kê nhanh
              </span>
            }
            bordered={false}
            style={{
              borderRadius: theme.borderRadius.lg,
              boxShadow: theme.shadows.sm,
              height: '100%',
            }}
          >
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <StatItem
                label="Hoàn thành"
                value="51/54"
                percent={94}
                color={theme.colors.success}
              />
              <StatItem
                label="Backend APIs"
                value="100%"
                percent={100}
                color={theme.colors.info}
              />
              <StatItem
                label="Frontend UI"
                value="30%"
                percent={30}
                color={theme.colors.warning}
              />
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

// Helper Components
interface FeatureItemProps {
  icon: string;
  title: string;
  desc: string;
  status: 'done' | 'progress';
}

const FeatureItem = ({ icon, title, desc, status }: FeatureItemProps) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      padding: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
      background:
        status === 'done' ? theme.colors.backgroundLight : 'transparent',
    }}
  >
    <span style={{ fontSize: '24px', marginRight: theme.spacing.md }}>
      {icon}
    </span>
    <div style={{ flex: 1 }}>
      <div
        style={{
          fontWeight: theme.typography.fontWeight.medium,
          marginBottom: '4px',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: theme.typography.fontSize.sm,
          color: theme.colors.textSecondary,
        }}
      >
        {desc}
      </div>
    </div>
    {status === 'done' && (
      <Tag color="success" style={{ marginLeft: theme.spacing.sm }}>
        <CheckCircleOutlined /> Xong
      </Tag>
    )}
    {status === 'progress' && (
      <Tag color="processing" style={{ marginLeft: theme.spacing.sm }}>
        <ClockCircleOutlined /> Đang làm
      </Tag>
    )}
  </div>
);

interface StatItemProps {
  label: string;
  value: string;
  percent: number;
  color: string;
}

const StatItem = ({ label, value, percent, color }: StatItemProps) => (
  <div>
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.xs,
      }}
    >
      <span style={{ color: theme.colors.textSecondary }}>{label}</span>
      <span
        style={{
          fontWeight: theme.typography.fontWeight.semibold,
          color: color,
        }}
      >
        {value}
      </span>
    </div>
    <Progress percent={percent} strokeColor={color} showInfo={false} />
  </div>
);

export default Dashboard;
