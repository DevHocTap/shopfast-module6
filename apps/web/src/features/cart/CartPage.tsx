import { ShoppingCart, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { InputField } from '../../components/ui/Field';
import { QuantityStepper } from '../../components/ui/QuantityStepper';
import { Card, EmptyState, InlineAlert, PageHeader, Skeleton } from '../../components/ui/States';
import { api, errorMessage } from '../../lib/api-client';
import { useCart } from '../../lib/cart';
import { formatVND } from '../../lib/format';
import { useToast } from '../../lib/toast';
import type { CartItem, OrderDetail } from '../../lib/types';

export function CartPage() {
  const { cart, setQuantity, remove, reload } = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string>();
  const [voucherCode, setVoucherCode] = useState('');
  // One key per checkout attempt: a double click or a network retry cannot create a second order.
  const idempotencyKey = useRef(crypto.randomUUID());

  if (!cart) {
    return (
      <>
        <PageHeader title="Giỏ hàng" />
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]" aria-busy="true">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </>
    );
  }

  if (cart.items.length === 0) {
    return (
      <>
        <PageHeader title="Giỏ hàng" />
        <EmptyState
          icon={ShoppingCart}
          title="Giỏ hàng đang trống"
          description="Hãy chọn vài sản phẩm, chúng sẽ được giữ ở đây cho tới khi bạn đặt hàng."
          action={<ButtonLink to="/">Xem sản phẩm</ButtonLink>}
        />
      </>
    );
  }

  async function change(item: CartItem, action: () => Promise<unknown>) {
    setBusyId(item.productId);
    setCheckoutError(undefined);
    try {
      await action();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function placeOrder() {
    setPlacing(true);
    setCheckoutError(undefined);
    try {
      const order = await api<OrderDetail>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: voucherCode.trim() ? { voucherCode: voucherCode.trim() } : {},
      });
      idempotencyKey.current = crypto.randomUUID();
      await reload();
      toast.success(`Đã đặt đơn ${order.code}.`);
      navigate(`/orders/${order.id}`);
    } catch (error) {
      setCheckoutError(errorMessage(error));
      await reload(); // stock may have changed: show the up-to-date availability
      setPlacing(false);
    }
  }

  return (
    <>
      <PageHeader title="Giỏ hàng" description={`${cart.itemCount} sản phẩm`} />
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_320px]">
        <Card>
          <ul className="divide-y divide-border">
            {cart.items.map((item) => (
              <li key={item.productId} className="flex flex-wrap items-center gap-4 p-4 sm:p-6">
                <div className="min-w-0 flex-1 basis-48">
                  <Link
                    to={`/products/${item.productId}`}
                    className="font-medium hover:text-brand-700"
                  >
                    {item.name}
                  </Link>
                  <p className="mt-1 text-sm text-muted">
                    {item.sku} · {formatVND(item.unitPrice)}
                  </p>
                  {!item.available && (
                    <p className="mt-1 text-sm font-medium text-danger-700">
                      {!item.isActive
                        ? 'Sản phẩm đã ngừng bán, vui lòng xoá khỏi giỏ.'
                        : item.stock === 0
                          ? 'Sản phẩm vừa hết hàng.'
                          : `Chỉ còn ${item.stock} sản phẩm, vui lòng giảm số lượng.`}
                    </p>
                  )}
                </div>
                <QuantityStepper
                  value={item.quantity}
                  max={Math.max(Math.min(item.stock, 99), 1)}
                  disabled={busyId === item.productId || placing}
                  onChange={(quantity) =>
                    void change(item, () => setQuantity(item.productId, quantity))
                  }
                  label={`Số lượng ${item.name}`}
                />
                <span className="w-28 text-right font-semibold tabular-nums">
                  {formatVND(item.lineTotal)}
                </span>
                <button
                  type="button"
                  onClick={() => void change(item, () => remove(item.productId))}
                  disabled={busyId === item.productId || placing}
                  className="flex size-11 items-center justify-center rounded-sm text-muted transition-colors duration-150 hover:bg-danger-50 hover:text-danger-700 disabled:opacity-40"
                  aria-label={`Xoá ${item.name} khỏi giỏ`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-6 lg:sticky lg:top-24">
          <h2 className="text-lg font-semibold">Tóm tắt đơn hàng</h2>
          <dl className="mt-4 flex flex-col gap-2">
            <div className="flex justify-between text-muted">
              <dt>Tạm tính</dt>
              <dd className="tabular-nums">{formatVND(cart.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-muted">
              <dt>Phí vận chuyển</dt>
              <dd>Miễn phí</dd>
            </div>
            <div className="mt-2 flex justify-between border-t border-border pt-4 text-lg font-semibold">
              <dt>Tổng cộng</dt>
              <dd className="tabular-nums">{formatVND(cart.subtotal)}</dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-col gap-4">
            <InputField
              label="Mã giảm giá (nếu có)"
              value={voucherCode}
              onChange={(event) => {
                setVoucherCode(event.target.value.toUpperCase());
                setCheckoutError(undefined);
              }}
              placeholder="Ví dụ: SALE10"
              autoComplete="off"
              maxLength={32}
              hint="Giảm giá được trừ khi đặt hàng."
            />
            {checkoutError && <InlineAlert tone="danger">{checkoutError}</InlineAlert>}
            {cart.hasUnavailableItems && !checkoutError && (
              <InlineAlert tone="warning">
                Một số sản phẩm không đủ hàng. Hãy điều chỉnh trước khi đặt.
              </InlineAlert>
            )}
            <Button
              className="w-full"
              loading={placing}
              disabled={cart.hasUnavailableItems || busyId !== null}
              onClick={() => void placeOrder()}
            >
              Đặt hàng
            </Button>
            <p className="text-sm text-muted">Bạn sẽ thanh toán ở bước tiếp theo.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
