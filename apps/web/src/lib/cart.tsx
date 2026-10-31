import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from './api-client';
import { useAuth } from './auth';
import type { Cart } from './types';

interface CartContextValue {
  cart: Cart | null;
  /** Total number of units, shown on the header badge. */
  count: number;
  setQuantity(productId: string, quantity: number): Promise<Cart>;
  remove(productId: string): Promise<Cart>;
  reload(): Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [cart, setCart] = useState<Cart | null>(null);

  const reload = useCallback(async () => {
    if (status !== 'authenticated') return setCart(null);
    setCart(await api<Cart>('/cart').catch(() => null));
  }, [status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      count: cart?.itemCount ?? 0,
      reload,
      setQuantity: async (productId, quantity) => {
        const next = await api<Cart>(`/cart/items/${productId}`, {
          method: 'PUT',
          body: { quantity },
        });
        setCart(next);
        return next;
      },
      remove: async (productId) => {
        const next = await api<Cart>(`/cart/items/${productId}`, { method: 'DELETE' });
        setCart(next);
        return next;
      },
    }),
    [cart, reload],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside <CartProvider>');
  return context;
}
