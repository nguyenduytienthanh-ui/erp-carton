import { Suspense, lazy } from 'react';
import { Spin } from 'antd';

const AppRouter = lazy(() => import('./AppRouter'));

export default function App() {
  return (
    <Suspense fallback={<div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>}>
      <AppRouter />
    </Suspense>
  );
}
