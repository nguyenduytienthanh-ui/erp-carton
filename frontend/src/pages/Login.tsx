import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { authApi } from '../api/auth';
import { usersApi } from '../api/users';
import { storage } from '../utils/storage';

const Login = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const response = await authApi.login(values);

      // Lưu tokens
      storage.setAccessToken(response.access);
      storage.setRefreshToken(response.refresh);

      // Lưu profile người dùng thật (bao gồm roles) để authz hoạt động chính xác.
      try {
        const profile = await usersApi.me();
        storage.setUser(profile);
      } catch {
        storage.setUser({ username: values.username });
      }

      message.success('Đăng nhập thành công!');
      navigate('/');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      console.error('Login error:', error);
      message.error(err.response?.data?.detail || 'Đăng nhập thất bại!');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Card
        title={
          <div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 'bold' }}>
            🏭 ERP Thùng Carton
          </div>
        }
        style={{ width: 400, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
      >
        <Form
          form={form}
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
          initialValues={{ username: 'admin', password: 'admin123' }}
        >
          <Form.Item
            name="username"
            label="Tên đăng nhập"
            rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập!' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="admin" allowClear />
          </Form.Item>

          <Form.Item
            name="password"
            label="Mật khẩu"
            rules={[{ required: true, message: 'Vui lòng nhập mật khẩu!' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="admin123" allowClear />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              Đăng nhập
            </Button>
          </Form.Item>
        </Form>

        <div
          style={{
            textAlign: 'center',
            color: '#888',
            fontSize: '12px',
            marginTop: '16px',
          }}
        >
          Demo: admin / admin123
        </div>
      </Card>
    </div>
  );
};

export default Login;
