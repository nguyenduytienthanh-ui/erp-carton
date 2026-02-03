export const theme = {
  colors: {
    // Primary colors (Xanh dương chuyên nghiệp)
    primary: '#1890ff',
    primaryHover: '#40a9ff',
    primaryActive: '#096dd9',

    // Success (Xanh lá)
    success: '#52c41a',
    successLight: '#95de64',

    // Warning (Vàng cam)
    warning: '#faad14',
    warningLight: '#ffc53d',

    // Error (Đỏ)
    error: '#ff4d4f',
    errorLight: '#ff7875',

    // Info (Xanh nhạt)
    info: '#13c2c2',
    infoLight: '#36cfc9',

    // Neutral colors
    text: '#262626',
    textSecondary: '#8c8c8c',
    textDisabled: '#bfbfbf',

    background: '#ffffff',
    backgroundGray: '#fafafa',
    backgroundLight: '#f5f5f5',

    border: '#d9d9d9',
    borderLight: '#f0f0f0',

    // Sidebar
    sidebarBg: '#001529',
    sidebarText: '#ffffff',
    sidebarHover: '#1890ff',
  },

  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },

  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
  },

  shadows: {
    sm: '0 2px 8px rgba(0, 0, 0, 0.06)',
    md: '0 4px 12px rgba(0, 0, 0, 0.08)',
    lg: '0 8px 16px rgba(0, 0, 0, 0.12)',
  },

  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',

    fontSize: {
      xs: '12px',
      sm: '14px',
      md: '16px',
      lg: '18px',
      xl: '20px',
      xxl: '24px',
    },

    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },
};

export type Theme = typeof theme;
