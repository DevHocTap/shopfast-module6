import { MapPinOff } from 'lucide-react';
import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { RequireAuth } from './components/layout/RequireAuth';
import { ButtonLink } from './components/ui/Button';
import { EmptyState } from './components/ui/States';
import { LoginPage, RegisterPage } from './features/auth/AuthPages';
import { BackgroundJobsPage } from './features/background-jobs/BackgroundJobsPage';
import { CartPage } from './features/cart/CartPage';
import { CatalogPage } from './features/catalog/CatalogPage';
import { ProductDetailPage } from './features/catalog/ProductDetailPage';
import { OrderDetailPage } from './features/orders/OrderDetailPage';
import { OrdersPage } from './features/orders/OrdersPage';
import { SystemStatusPage } from './features/system-status/SystemStatusPage';
import { InventoryPage } from './features/warehouse/InventoryPage';
import { WarehouseOrdersPage } from './features/warehouse/WarehouseOrdersPage';

function NotFoundPage() {
  return (
    <EmptyState
      icon={MapPinOff}
      title="Không tìm thấy trang"
      description="Đường dẫn không tồn tại hoặc đã được thay đổi."
      action={<ButtonLink to="/">Về trang sản phẩm</ButtonLink>}
    />
  );
}

export const router = createBrowserRouter(
  [
    {
      element: <AppLayout />,
      children: [
        { index: true, element: <CatalogPage /> },
        { path: 'products/:id', element: <ProductDetailPage /> },
        { path: 'login', element: <LoginPage /> },
        { path: 'register', element: <RegisterPage /> },
        {
          path: 'cart',
          element: (
            <RequireAuth>
              <CartPage />
            </RequireAuth>
          ),
        },
        {
          path: 'orders',
          element: (
            <RequireAuth>
              <OrdersPage />
            </RequireAuth>
          ),
        },
        {
          path: 'orders/:id',
          element: (
            <RequireAuth>
              <OrderDetailPage />
            </RequireAuth>
          ),
        },
        {
          path: 'warehouse',
          element: (
            <RequireAuth roles={['WAREHOUSE', 'ADMIN']}>
              <WarehouseOrdersPage />
            </RequireAuth>
          ),
        },
        {
          path: 'warehouse/inventory',
          element: (
            <RequireAuth roles={['WAREHOUSE', 'ADMIN']}>
              <InventoryPage />
            </RequireAuth>
          ),
        },
        {
          path: 'status',
          element: (
            <RequireAuth roles={['ADMIN']}>
              <SystemStatusPage />
            </RequireAuth>
          ),
        },
        {
          path: 'jobs',
          element: (
            <RequireAuth roles={['ADMIN']}>
              <BackgroundJobsPage />
            </RequireAuth>
          ),
        },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  },
);
