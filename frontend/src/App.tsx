import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { theme as customTheme } from './styles/theme';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MainLayout from './components/Layout/MainLayout';
import PrivateRoute from './components/PrivateRoute';

import ProductList from './pages/Products/ProductList';
import CategoryList from './pages/Categories/CategoryList';
import UnitList from './pages/Units/UnitList';

function App() {
  return (
    <ConfigProvider
      locale={viVN}
      theme={{
        token: {
          colorPrimary: customTheme.colors.primary,
          colorSuccess: customTheme.colors.success,
          colorWarning: customTheme.colors.warning,
          colorError: customTheme.colors.error,
          colorInfo: customTheme.colors.info,
          borderRadius: 8,
          fontFamily: customTheme.typography.fontFamily,
        },
        components: {
          Button: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Input: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Select: {
            borderRadius: 8,
            controlHeight: 36,
            zIndexPopup: 9999,
          },
          Card: {
            borderRadiusLG: 12,
          },
          Table: {
            borderRadius: 8,
          },
        },
      }}
    >
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/"
            element={
              <PrivateRoute>
                <MainLayout />
              </PrivateRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="products" element={<ProductList />} />
            <Route path="categories" element={<CategoryList />} />
            <Route path="units" element={<UnitList />} />
            <Route path="pricings" element={<div>Product Pricings (Đang phát triển)</div>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
