import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Bắt lỗi trong cây component để tránh màn hình trống; hiển thị thông báo lỗi.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            padding: 24,
            margin: 24,
            background: '#fff2f0',
            border: '1px solid #ffccc7',
            borderRadius: 8,
          }}
        >
          <h3 style={{ color: '#cf1322', marginTop: 0 }}>Đã xảy ra lỗi</h3>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
            {this.state.error.message}
          </pre>
          <p style={{ marginTop: 12, fontSize: 13, color: '#666' }}>
            Mở DevTools (F12) → Console để xem chi tiết.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
