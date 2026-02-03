import { Tag } from 'antd';
import { theme } from '../../styles/theme';

interface StatusTagProps {
  status: 'ACTIVE' | 'DRAFT' | 'DISCONTINUED' | string;
  labels?: Record<string, { text: string; color: string; icon: string }>;
}

const defaultLabels: Record<string, { text: string; color: string; icon: string }> = {
  ACTIVE: { text: 'Đang bán', color: 'success', icon: '✅' },
  DRAFT: { text: 'Nháp', color: 'default', icon: '📝' },
  DISCONTINUED: { text: 'Ngừng SX', color: 'error', icon: '🚫' },
};

const StatusTag = ({ status, labels = defaultLabels }: StatusTagProps) => {
  const config = labels[status] ?? defaultLabels.DRAFT;

  return (
    <Tag
      color={config.color}
      style={{ borderRadius: theme.borderRadius.sm }}
    >
      {config.icon} {config.text}
    </Tag>
  );
};

export default StatusTag;
