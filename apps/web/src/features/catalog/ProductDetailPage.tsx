import { ArrowLeft, PackageX } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProductTile, StockBadgeText } from '../../components/ProductTile';
import { VALUE_PROPS } from '../../components/ValueProps';
import { Button, ButtonLink } from '../../components/ui/Button';
import { QuantityStepper } from '../../components/ui/QuantityStepper';
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { api, ApiError, errorMessage } from '../../lib/api-client';
import { formatVND } from '../../lib/format';
import type { Product } from '../../lib/types';
import { useAsync } from '../../lib/use-async';
import { useAddToCart } from './use-add-to-cart';

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { state, reload } = useAsync(() => api<Product>(`/products/${id}`), [id]);
  const { add, pendingId } = useAddToCart();
  const [quantity, setQuantity] = useState(1);

  const back = (
    <Link
      to="/"
      className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Tất cả sản phẩm
    </Link>
  );

  if (state.status === 'loading') {
    return (
      <>
        {back}
        <div className="grid gap-8 md:grid-cols-2" aria-busy="true">
          <Skeleton className="aspect-square w-full rounded-lg" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </>
    );
  }

  if (state.status === 'error') {
    const notFound = state.error instanceof ApiError && state.error.statusCode === 404;
    return (
      <>
        {back}
        {notFound ? (
          <EmptyState
            icon={PackageX}
            title="Sản phẩm không tồn tại"
            description="Sản phẩm có thể đã ngừng bán hoặc đường dẫn không đúng."
            action={<ButtonLink to="/">Xem sản phẩm khác</ButtonLink>}
          />
        ) : (
          <ErrorState message={errorMessage(state.error)} onRetry={() => void reload()} />
        )}
      </>
    );
  }

  const product = state.data;
  const maxQuantity = Math.min(product.stock, 99);

  return (
    <>
      {back}
      <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
        <ProductTile
          category={product.category.name}
          brand={product.brand.name}
          size="lg"
          className="aspect-square w-full rounded-[2rem] shadow-card"
        />
        <div className="pt-2">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">
            {product.brand.name}
          </p>
          <h1 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            {product.name}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {product.category.name} · Mã {product.sku}
          </p>
          <p className="mt-7 text-3xl font-bold tracking-tight tabular-nums">
            {formatVND(product.price)}
          </p>
          <div className="mt-2">
            <StockBadgeText stock={product.stock} />
            {product.stock > 0 && (
              <span className="text-sm text-muted"> · {product.stock} sản phẩm trong kho</span>
            )}
          </div>
          <p className="mt-6 max-w-prose text-muted">{product.description}</p>

          <Card className="mt-8 border border-white/80 p-6 shadow-raised">
            {product.inStock ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium">Số lượng</span>
                  <QuantityStepper value={quantity} max={maxQuantity} onChange={setQuantity} />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1"
                    loading={pendingId === product.id}
                    onClick={async () => {
                      if (await add(product.id, product.name, quantity)) navigate('/cart');
                    }}
                  >
                    Mua ngay
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1"
                    disabled={pendingId === product.id}
                    onClick={() => void add(product.id, product.name, quantity)}
                  >
                    Thêm vào giỏ
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-muted">Sản phẩm tạm hết hàng. Vui lòng quay lại sau.</p>
            )}
          </Card>

          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {VALUE_PROPS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-xl border border-border bg-surface p-4">
                <Icon className="size-5 text-brand-600" aria-hidden />
                <p className="mt-3 text-sm font-semibold">{title}</p>
                <p className="mt-1 text-sm leading-5 text-muted">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
