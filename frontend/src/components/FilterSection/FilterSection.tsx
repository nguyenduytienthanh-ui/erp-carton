import type { ReactNode } from 'react';
import { Card } from 'antd';
import { theme } from '../../styles/theme';

interface FilterSectionProps {
  children: ReactNode;
}

const FilterSection = ({ children }: FilterSectionProps) => {
  return (
    <Card
      size="small"
      style={{
        background: theme.colors.backgroundLight,
        marginBottom: theme.spacing.lg,
        borderRadius: theme.borderRadius.md,
        border: `1px solid ${theme.colors.borderLight}`,
      }}
    >
      {children}
    </Card>
  );
};

export default FilterSection;
