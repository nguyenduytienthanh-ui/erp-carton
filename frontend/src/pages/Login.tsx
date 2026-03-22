import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Space, Typography, message } from 'antd';
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';

import { authApi } from '../api/auth';
import { usersApi } from '../api/users';
import { storage } from '../utils/storage';

const { Paragraph, Title, Text } = Typography;

export default function Login() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const navigate = useNavigate();

  const handlePasswordKeyState = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(event.getModifierState('CapsLock'));
  };

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const response = await authApi.login(values);
      storage.setAccessToken(response.access);
      storage.setRefreshToken(response.refresh);

      try {
        const profile = await usersApi.me();
        storage.setUser(profile);
      } catch {
        storage.setUser({ username: values.username });
      }

      message.success('Đăng nhập thành công');
      navigate('/');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      console.error('Login error:', error);
      message.error(err.response?.data?.detail || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: `
          radial-gradient(circle at top left, rgba(16, 185, 129, 0.18), transparent 28%),
          radial-gradient(circle at bottom right, rgba(29, 78, 216, 0.20), transparent 34%),
          linear-gradient(135deg, #e0f2fe 0%, #f8fafc 45%, #ecfeff 100%)
        `,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 1080,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.05fr) minmax(360px, 0.95fr)',
          gap: 24,
          alignItems: 'stretch',
        }}
      >
        <Card
          bordered={false}
          bodyStyle={{ height: '100%', padding: 32 }}
          style={{
            borderRadius: 28,
            background: 'linear-gradient(160deg, #0f172a 0%, #1d4ed8 48%, #0f766e 100%)',
            color: '#ffffff',
            overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(15, 23, 42, 0.18)',
          }}
        >
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 28,
              background: 'radial-gradient(circle at top right, rgba(255,255,255,0.18), transparent 36%)',
            }}
          >
            <div>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'rgba(255,255,255,0.14)',
                  border: '1px solid rgba(255,255,255,0.24)',
                  marginBottom: 22,
                }}
              >
                <SafetyCertificateOutlined style={{ fontSize: 24, color: '#ffffff' }} />
              </div>

              <Title level={1} style={{ color: '#ffffff', margin: 0 }}>
                ERP Carton
              </Title>
              <Paragraph style={{ color: 'rgba(255,255,255,0.82)', fontSize: 16, marginTop: 14, marginBottom: 0 }}>
                Nền tảng vận hành hợp nhất cho bán hàng, mua hàng, kho, tài chính và báo cáo điều hành.
              </Paragraph>
            </div>

            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {[
                'Theo dõi dòng tiền, công nợ và ngân sách theo thời gian thực.',
                'Quản trị tồn kho, đối soát ngân hàng và báo cáo quản trị từ một nơi.',
                'Kiểm soát bảo mật đăng nhập với quản lý phiên và chính sách thông báo.',
              ].map((item) => (
                <div
                  key={item}
                  style={{
                    padding: '14px 16px',
                    borderRadius: 16,
                    background: 'rgba(255,255,255,0.10)',
                    border: '1px solid rgba(255,255,255,0.14)',
                  }}
                >
                  <Text style={{ color: '#ffffff' }}>{item}</Text>
                </div>
              ))}
            </Space>
          </div>
        </Card>

        <Card
          bordered={false}
          bodyStyle={{ padding: 32 }}
          style={{
            borderRadius: 28,
            background: 'rgba(255,255,255,0.84)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 20px 48px rgba(15, 23, 42, 0.10)',
          }}
        >
          <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 24 }}>
            <Text style={{ color: '#0f766e', fontWeight: 700, letterSpacing: 0.6 }}>
              ĐĂNG NHẬP HỆ THỐNG
            </Text>
            <Title level={2} style={{ margin: 0 }}>
              Chào mừng quay lại
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Đăng nhập để tiếp tục làm việc với dữ liệu doanh nghiệp và các bảng điều hành vận hành.
            </Paragraph>
          </Space>

          <Form
            form={form}
            name="login"
            layout="vertical"
            size="large"
            autoComplete="off"
            onFinish={onFinish}
            initialValues={{ username: 'admin', password: 'admin123' }}
          >
            <Form.Item
              name="username"
              label="Tên đăng nhập"
              rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="Nhập tên đăng nhập" allowClear />
            </Form.Item>

            <Form.Item
              name="password"
              label="Mật khẩu"
              rules={[{ required: true, message: 'Vui lòng nhập mật khẩu' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Nhập mật khẩu"
                allowClear
                onKeyDown={handlePasswordKeyState}
                onKeyUp={handlePasswordKeyState}
                onBlur={() => setCapsLockOn(false)}
              />
            </Form.Item>
            {capsLockOn && (
              <Alert
                style={{ marginBottom: 14 }}
                showIcon
                type="warning"
                message="Caps Lock đang bật"
                description="Kiểm tra lại phím chữ hoa để tránh nhập sai mật khẩu."
              />
            )}

            <Form.Item style={{ marginBottom: 14 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                style={{
                  height: 46,
                  borderRadius: 14,
                  fontWeight: 600,
                  background: 'linear-gradient(135deg, #1d4ed8 0%, #0f766e 100%)',
                }}
              >
                Đăng nhập
              </Button>
            </Form.Item>
          </Form>

          <div
            style={{
              padding: 16,
              borderRadius: 16,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
            }}
          >
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              Tài khoản mẫu
            </Text>
            <Text type="secondary">`admin / admin123`</Text>
          </div>
          <div
            style={{
              marginTop: 14,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
            }}
          >
            {[
              'Quản lý phiên đăng nhập tập trung',
              'Phân quyền theo vai trò và phân hệ',
              'Thông báo cá nhân hóa theo cấu hình tài khoản',
            ].map((item) => (
              <div
                key={item}
                style={{
                  borderRadius: 14,
                  padding: '12px 14px',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                }}
              >
                <Text style={{ color: '#0f172a' }}>{item}</Text>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
