import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../lib/api-client';
import { useAuth } from '../../lib/auth';
import { useCart } from '../../lib/cart';
import { useToast } from '../../lib/toast';

/** Adds to the cart (summing with what is already there); guests are sent to login first. */
export function useAddToCart() {
  const { status } = useAuth();
  const { cart, setQuantity } = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function add(productId: string, name: string, quantity = 1): Promise<boolean> {
    if (status !== 'authenticated') {
      navigate('/login', { state: { from: location.pathname + location.search } });
      return false;
    }
    const current = cart?.items.find((item) => item.productId === productId)?.quantity ?? 0;
    setPendingId(productId);
    try {
      await setQuantity(productId, Math.min(current + quantity, 99));
      toast.success(`Đã thêm "${name}" vào giỏ hàng.`);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      setPendingId(null);
    }
  }

  return { add, pendingId };
}
