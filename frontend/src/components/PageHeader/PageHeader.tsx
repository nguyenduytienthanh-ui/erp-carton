import type { ReactNode } from 'react';
import { Space } from 'antd';
import { theme } from '../../styles/theme';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
}

const PageHeader = ({
  title,
  subtitle,
  icon,
  extra,
  children,
}: PageHeaderProps) => {
  return (
    <div style={{ marginBottom: theme.spacing.lg }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.md,
          paddingBottom: theme.spacing.md,
          borderBottom: `1px solid ${theme.colors.borderLight}`,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: theme.typography.fontSize.xxl,
              fontWeight: theme.typography.fontWeight.semibold,
              color: theme.colors.text,
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}
          >
            {icon} {title}
          </h2>
          {subtitle && (
            <p
              style={{
                margin: '4px 0 0 0',
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.textSecondary,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>

        {extra && (
          <Space size="middle">
            {extra}
          </Space>
        )}
      </div>

      {children}
    </div>
  );
};

export default PageHeader;
