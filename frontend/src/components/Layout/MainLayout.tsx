import { useState, useCallback, useEffect } from 'react';
import { Layout, Menu, Button, Popover, Space, message, Divider, Drawer } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DashboardOutlined,
  AppstoreOutlined,
  TagsOutlined,
  ToolOutlined,
  DollarOutlined,
  ProjectOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  BarChartOutlined,
  InboxOutlined,
  UserOutlined,
  TeamOutlined,
  LogoutOutlined,
  BellOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { storage } from '../../utils/storage';
import TaskQuickLauncher from '../TaskQuickLauncher/TaskQuickLauncher';
import { notificationsApi } from '../../api/notifications';

const { Header, Sider, Content } = Layout;

const MainLayout = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const navigate = useNavigate();
  const location = useLocation();
  const user = storage.getUser();
  const desktopControlSize = 40;
  const queryClient = useQueryClient();
  const unreadQuery = useQuery({
    queryKey: ['header-notifications-unread'],
    queryFn: () => notificationsApi.unread(),
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });
  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['header-notifications-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    },
  });
  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['header-notifications-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    },
  });

  // Detect mobile screen size
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (mobile) {
        setCollapsed(true); // Auto-collapse on mobile
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const menuItems = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: 'Tổng quan',
    },
    {
      key: '/products',
      icon: <AppstoreOutlined />,
      label: 'Sản phẩm',
    },
    {
      key: '/categories',
      icon: <TagsOutlined />,
      label: 'Danh mục',
    },
    {
      key: '/units',
      icon: <ToolOutlined />,
      label: 'Đơn vị tính',
    },
    {
      key: '/customers',
      icon: <TeamOutlined />,
      label: 'Khách hàng',
    },
    {
      key: '/pricings',
      icon: <DollarOutlined />,
      label: 'Bảng giá',
    },
    {
      key: '/task-inbox',
      icon: <InboxOutlined />,
      label: 'Nhiệm vụ của tôi',
    },
    {
      key: '/task-operations',
      icon: <ProjectOutlined />,
      label: 'Điều hành nhiệm vụ',
    },
    {
      key: '/workflow-task-templates',
      icon: <ThunderboltOutlined />,
      label: 'Mẫu nhiệm vụ',
    },
    {
      key: '/workflow-pipeline',
      icon: <ApartmentOutlined />,
      label: 'Luồng công việc',
    },
    {
      key: '/workflow-analytics',
      icon: <BarChartOutlined />,
      label: 'Phân tích quy trình',
    },
    {
      key: '/notifications',
      icon: <BellOutlined />,
      label: 'Thông báo',
    },
    {
      key: '/operations-log',
      icon: <FileSearchOutlined />,
      label: 'Nhật ký vận hành',
    },
  ];

  const handleLogout = useCallback(() => {
    storage.clear();
    navigate('/login');
  }, [navigate]);

  const accountMenuContent = (
    <div style={{ minWidth: 180 }}>
      <div
        role="button"
        tabIndex={0}
        style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        onClick={() => message.info('Chức năng đang phát triển')}
        onKeyDown={(e) => e.key === 'Enter' && message.info('Chức năng đang phát triển')}
      >
        <UserOutlined />
        Thông tin cá nhân
      </div>
      <Divider style={{ margin: '4px 0' }} />
      <div
        role="button"
        tabIndex={0}
        style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}
        onClick={handleLogout}
        onKeyDown={(e) => e.key === 'Enter' && handleLogout()}
      >
        <LogoutOutlined />
        Đăng xuất
      </div>
    </div>
  );

  const unreadItems = unreadQuery.data ?? [];
  const notificationPopoverContent = (
    <div style={{ width: 360 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Thông báo chưa đọc</strong>
        <Button
          type="link"
          size="small"
          loading={markAllReadMutation.isPending}
          onClick={() => markAllReadMutation.mutate()}
          style={{ paddingInline: 0 }}
        >
          Đánh dấu tất cả đã đọc
        </Button>
      </div>
      {unreadQuery.isLoading ? (
        <div style={{ padding: '10px 0' }}>Đang tải...</div>
      ) : unreadItems.length === 0 ? (
        <div style={{ color: '#8c8c8c' }}>Không có thông báo mới.</div>
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {unreadItems.slice(0, 8).map((item) => (
            <div key={item.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
              <div style={{ fontWeight: 600 }}>{item.title}</div>
              <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 2 }}>{item.message}</div>
              <div style={{ color: '#8c8c8c', fontSize: 11, marginTop: 4 }}>
                {dayjs(item.created_at).format('DD/MM HH:mm:ss')}
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                <Button
                  size="small"
                  loading={markReadMutation.isPending}
                  onClick={() => markReadMutation.mutate(item.id)}
                >
                  Đã đọc
                </Button>
                <Button
                  size="small"
                  type="link"
                  onClick={() => navigate('/notifications')}
                  style={{ paddingInline: 0 }}
                >
                  Mở trung tâm
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Divider style={{ margin: '10px 0' }} />
      <Button type="primary" block onClick={() => navigate('/notifications')}>
        Xem tất cả thông báo
      </Button>
    </div>
  );

  const handleMenuClick = useCallback(({ key }: { key: string }) => {
    navigate(key);
    if (isMobile) {
      setMobileMenuVisible(false);
    }
  }, [navigate, isMobile]);

  const menuContent = (
    <Menu
      theme={isMobile ? 'light' : 'dark'}
      mode="inline"
      selectedKeys={[location.pathname]}
      items={menuItems}
      onClick={handleMenuClick}
    />
  );

  return (
    <Layout className="app-main-layout" style={{ minHeight: '100vh' }}>
      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sider
          className="app-desktop-sider"
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={200}
          style={{
            borderRight: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <div
            style={{
              height: '64px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '18px',
              fontWeight: 'bold',
            }}
          >
            {collapsed ? '🏭' : '🏭 ERP Carton'}
          </div>
          {menuContent}
        </Sider>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <Drawer
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '20px' }}>🏭</span>
              <span style={{ fontSize: '18px', fontWeight: 'bold' }}>ERP Carton</span>
            </div>
          }
          placement="left"
          onClose={() => setMobileMenuVisible(false)}
          open={mobileMenuVisible}
          bodyStyle={{ padding: 0 }}
          width={250}
        >
          {menuContent}
        </Drawer>
      )}

      <Layout style={{ minWidth: 0 }}>
        <Header
          className="app-top-header"
          style={{
            padding: isMobile ? '0 12px' : '0 16px',
            background: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            height: isMobile ? '56px' : '64px',
            boxShadow: isMobile ? '0 1px 6px rgba(15, 23, 42, 0.08)' : 'none',
            borderBottom: '1px solid #eef2f7',
            position: 'sticky',
            top: 0,
            zIndex: 999,
          }}
        >
          <Button
            type="text"
            icon={isMobile ? (mobileMenuVisible ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />) : (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />)}
            onClick={() => {
              if (isMobile) {
                setMobileMenuVisible(!mobileMenuVisible);
              } else {
                setCollapsed(!collapsed);
              }
            }}
            style={{
              fontSize: '18px',
              width: isMobile ? 44 : desktopControlSize,
              height: isMobile ? 44 : desktopControlSize,
            }}
          />

          <Space size={10}>
            {!isMobile && <TaskQuickLauncher />}
            <Popover content={notificationPopoverContent} placement="bottomRight" trigger="click">
              <Button
                type="text"
                icon={<BellOutlined />}
                style={{ fontSize: isMobile ? '14px' : '15px', height: isMobile ? 40 : desktopControlSize }}
              >
                <span style={{ marginRight: 6 }}>Thông báo</span>
                <span style={{ color: unreadItems.length > 0 ? '#1677ff' : '#8c8c8c', fontWeight: 600 }}>
                  {unreadItems.length}
                </span>
              </Button>
            </Popover>
            <Popover content={accountMenuContent} placement="bottomRight" trigger="click">
              <Button type="text" icon={<UserOutlined />} style={{ fontSize: isMobile ? '14px' : '15px', height: isMobile ? 40 : desktopControlSize }}>
                {isMobile ? (user?.username || 'Tài khoản') : `Tài khoản ${user?.username ? `(${user.username})` : ''}`}
              </Button>
            </Popover>
          </Space>
        </Header>
        <Content
          className="app-main-content"
          style={{
            margin: isMobile ? '12px 8px' : '14px auto 18px',
            width: isMobile ? 'auto' : 'min(100% - 20px, 1760px)',
            padding: isMobile ? 16 : 18,
            minHeight: 280,
            background: '#fff',
            borderRadius: isMobile ? '8px' : '12px',
            border: isMobile ? 'none' : '1px solid #eef2f7',
            boxShadow: isMobile ? 'none' : '0 1px 2px rgba(15, 23, 42, 0.04)',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
