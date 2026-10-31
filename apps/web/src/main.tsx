import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { CartProvider } from './lib/cart';
import { ToastProvider } from './lib/toast';
import { router } from './router';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
