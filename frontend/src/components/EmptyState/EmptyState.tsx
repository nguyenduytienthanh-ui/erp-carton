import type { ReactNode } from 'react';
import { Empty, Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { theme } from '../../styles/theme';

interface EmptyStateProps {
  description?: string;
  actionText?: string;
  onAction?: () => void;
  icon?: ReactNode;
}

const EmptyState = ({
  description = 'Chưa có dữ liệu',
  actionText,
  onAction,
  icon,
}: EmptyStateProps) => {
  return (
    <div
      style={{
        padding: theme.spacing.xxl,
        textAlign: 'center',
      }}
    >
      <Empty
        image={icon ?? Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.typography.fontSize.md,
            }}
          >
            {description}
          </span>
        }
      >
        {actionText && onAction && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={onAction}
            style={{ borderRadius: theme.borderRadius.md }}
          >
            {actionText}
          </Button>
        )}
      </Empty>
    </div>
  );
};

export default EmptyState;
