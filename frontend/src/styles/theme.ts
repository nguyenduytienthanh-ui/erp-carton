export const theme = {
  colors: {
    // Primary colors (Xanh dương chuyên nghiệp)
    primary: '#2563eb',
    primaryHover: '#3b82f6',
    primaryActive: '#1d4ed8',

    // Success (Xanh lá)
    success: '#12b76a',
    successLight: '#dcfae6',

    // Warning (Vàng cam)
    warning: '#f59e0b',
    warningLight: '#fef3c7',

    // Error (Đỏ)
    error: '#ef4444',
    errorLight: '#fee2e2',

    // Info (Xanh nhạt)
    info: '#0f766e',
    infoLight: '#ccfbf1',

    // Neutral colors
    text: '#0f172a',
    textSecondary: '#475569',
    textDisabled: '#94a3b8',

    background: '#ffffff',
    backgroundGray: '#f8fafc',
    backgroundLight: '#eef4ff',

    border: '#dbe4f0',
    borderLight: '#e9eef5',

    // Sidebar
    sidebarBg: '#0b1b34',
    sidebarText: '#f8fafc',
    sidebarHover: '#38bdf8',
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
    sm: '6px',
    md: '10px',
    lg: '18px',
    xl: '24px',
  },

  shadows: {
    sm: '0 10px 24px rgba(15, 23, 42, 0.08)',
    md: '0 18px 36px rgba(15, 23, 42, 0.1)',
    lg: '0 32px 72px rgba(15, 23, 42, 0.16)',
  },

  typography: {
    fontFamily:
      '"Manrope", "Segoe UI", "Helvetica Neue", Arial, sans-serif',

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
