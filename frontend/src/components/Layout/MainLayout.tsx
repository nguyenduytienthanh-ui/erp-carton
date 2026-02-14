import { useState, useCallback } from 'react';
import { Layout, Menu, Button, Popover, message, Divider } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DashboardOutlined,
  AppstoreOutlined,
  TagsOutlined,
  ToolOutlined,
  DollarOutlined,
  UserOutlined,
  TeamOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { storage } from '../../utils/storage';

const { Header, Sider, Content } = Layout;

const MainLayout = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const user = storage.getUser();

  const menuItems = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: 'Dashboard',
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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider trigger={null} collapsible collapsed={collapsed}>
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
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: '0 16px',
            background: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: '16px', width: 64, height: 64 }}
          />

          <Popover content={accountMenuContent} placement="bottomRight" trigger="click">
            <Button type="text" icon={<UserOutlined />}>
              Tài khoản {user?.username ? `(${user.username})` : ''}
            </Button>
          </Popover>
        </Header>
        <Content
          style={{
            margin: '24px 16px',
            padding: 24,
            minHeight: 280,
            background: '#fff',
            borderRadius: '8px',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
