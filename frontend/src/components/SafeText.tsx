import type React from 'react';

/**
 * Drop-in replacement for antd Typography.Text / Typography.Title.
 * antd v6 EllipsisMeasure triggers an infinite layout loop with React 19;
 * this lightweight component avoids that entirely.
 */

type TextType = 'secondary' | 'success' | 'warning' | 'danger';

const TYPE_COLORS: Record<TextType, string> = {
  secondary: '#8c8c8c',
  danger: '#ff4d4f',
  warning: '#faad14',
  success: '#52c41a',
};

export function SafeText({ strong, type, style, children, ...rest }: {
  strong?: boolean;
  type?: TextType;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  [key: string]: unknown;
}) {
  return (
    <span
      {...rest}
      style={{
        fontWeight: strong ? 600 : undefined,
        color: type ? TYPE_COLORS[type] : undefined,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function SafeTitle({ level = 4, style, children, ...rest }: {
  level?: 1 | 2 | 3 | 4 | 5;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  [key: string]: unknown;
}) {
  const tagNameMap: Record<1 | 2 | 3 | 4 | 5, 'h1' | 'h2' | 'h3' | 'h4' | 'h5'> = {
    1: 'h1',
    2: 'h2',
    3: 'h3',
    4: 'h4',
    5: 'h5',
  };
  const Tag = tagNameMap[level];
  return <Tag {...rest} style={style}>{children}</Tag>;
}
