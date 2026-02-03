import { theme } from '../../styles/theme';

interface FormattedPriceProps {
  value: string | number;
  currency?: string;
  color?: string;
  bold?: boolean;
}

const FormattedPrice = ({
  value,
  currency = 'VND',
  color = theme.colors.primary,
  bold = true,
}: FormattedPriceProps) => {
  const formatted = new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currency,
  }).format(typeof value === 'string' ? parseFloat(value) : value);

  return (
    <span
      style={{
        fontWeight: bold
          ? theme.typography.fontWeight.semibold
          : theme.typography.fontWeight.normal,
        color: color,
      }}
    >
      {formatted}
    </span>
  );
};

export default FormattedPrice;
