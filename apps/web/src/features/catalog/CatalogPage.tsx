import { PackageSearch, SlidersHorizontal } from 'lucide-react';
import { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ProductTile, StockBadgeText } from '../../components/ProductTile';
import { Button } from '../../components/ui/Button';
import { InputField, SelectField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/States';
import { api, errorMessage } from '../../lib/api-client';
import { formatVND } from '../../lib/format';
import type { Named, Paginated, Product } from '../../lib/types';
import { useAsync } from '../../lib/use-async';
import { useAddToCart } from './use-add-to-cart';

const PAGE_SIZE = 12;
const SORTS = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'price_asc', label: 'Giá tăng dần' },
  { value: 'price_desc', label: 'Giá giảm dần' },
  { value: 'name', label: 'Tên A → Z' },
];
const FILTER_KEYS = ['q', 'categoryId', 'brandId', 'minPrice', 'maxPrice', 'sort'] as const;

export function CatalogPage() {
  // Filters live in the URL: shareable links, and the back button restores the previous search.
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const filters = Object.fromEntries(
    FILTER_KEYS.map((key) => [key, params.get(key) ?? '']),
  ) as Record<(typeof FILTER_KEYS)[number], string>;
  const hasFilters = FILTER_KEYS.some((key) => key !== 'sort' && filters[key]);

  const facets = useAsync(
    () => Promise.all([api<Named[]>('/categories'), api<Named[]>('/brands')]),
    [],
  );
  const products = useAsync(
    () =>
      api<Paginated<Product>>('/products', {
        query: { ...filters, sort: filters.sort || 'newest', page, limit: PAGE_SIZE },
      }),
    [params.toString()],
  );
  const { add, pendingId } = useAddToCart();

  function update(next: Partial<Record<string, string>>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    if (!('page' in next)) merged.delete('page');
    setParams(merged);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    update(Object.fromEntries(FILTER_KEYS.map((key) => [key, String(form.get(key) ?? '').trim()])));
  }

  const [categories, brands] = facets.state.status === 'success' ? facets.state.data : [[], []];
  const total = products.state.status === 'success' ? products.state.data.total : undefined;

  const filterForm = (
    <form key={params.toString()} onSubmit={onSubmit} className="flex flex-col gap-4">
      <InputField
        label="Tìm theo tên"
        name="q"
        type="search"
        defaultValue={filters.q}
        placeholder="Ví dụ: tai nghe"
      />
      <SelectField
        label="Danh mục"
        name="categoryId"
        defaultValue={filters.categoryId}
        onChange={(event) => update({ categoryId: event.target.value })}
        options={[
          { value: '', label: 'Tất cả danh mục' },
          ...categories.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <SelectField
        label="Thương hiệu"
        name="brandId"
        defaultValue={filters.brandId}
        onChange={(event) => update({ brandId: event.target.value })}
        options={[
          { value: '', label: 'Tất cả thương hiệu' },
          ...brands.map((b) => ({ value: b.id, label: b.name })),
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <InputField
          label="Giá từ (₫)"
          name="minPrice"
          type="number"
          min={0}
          step={10000}
          defaultValue={filters.minPrice}
          inputMode="numeric"
        />
        <InputField
          label="Đến (₫)"
          name="maxPrice"
          type="number"
          min={0}
          step={10000}
          defaultValue={filters.maxPrice}
          inputMode="numeric"
        />
      </div>
      <SelectField
        label="Sắp xếp"
        name="sort"
        defaultValue={filters.sort || 'newest'}
        onChange={(event) => update({ sort: event.target.value })}
        options={SORTS}
      />
      <div className="flex flex-col gap-2">
        <Button type="submit" variant="secondary">
          Áp dụng bộ lọc
        </Button>
        {hasFilters && (
          <Button variant="ghost" onClick={() => setParams(new URLSearchParams())}>
            Xoá bộ lọc
          </Button>
        )}
      </div>
    </form>
  );

  return (
    <>
      <PageHeader
        title="Sản phẩm"
        description={
          total === undefined ? 'Đang tải danh sách…' : `${total.toLocaleString('vi-VN')} sản phẩm`
        }
      />
      <div className="grid gap-8 lg:grid-cols-[256px_1fr]">
        <aside>
          <details className="group lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm border border-border bg-surface px-4 font-medium">
              <SlidersHorizontal className="size-4" aria-hidden />
              Bộ lọc{hasFilters ? ' (đang áp dụng)' : ''}
            </summary>
            <Card className="mt-3 p-4">{filterForm}</Card>
          </details>
          <div className="hidden lg:block">{filterForm}</div>
        </aside>

        <section aria-label="Danh sách sản phẩm" aria-busy={products.state.status === 'loading'}>
          {products.state.status === 'loading' && (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Card key={i} className="p-4">
                  <Skeleton className="aspect-[16/9] w-full" />
                  <Skeleton className="mt-4 h-5 w-3/4" />
                  <Skeleton className="mt-2 h-4 w-1/2" />
                  <Skeleton className="mt-4 h-11 w-full" />
                </Card>
              ))}
            </div>
          )}
          {products.state.status === 'error' && (
            <ErrorState
              message={errorMessage(products.state.error)}
              onRetry={() => void products.reload()}
            />
          )}
          {products.state.status === 'success' && products.state.data.items.length === 0 && (
            <EmptyState
              icon={PackageSearch}
              title="Không tìm thấy sản phẩm phù hợp"
              description="Thử bỏ bớt điều kiện lọc hoặc tìm bằng từ khoá khác."
              action={
                <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                  Xoá bộ lọc
                </Button>
              }
            />
          )}
          {products.state.status === 'success' && products.state.data.items.length > 0 && (
            <>
              <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {products.state.data.items.map((product) => (
                  <li key={product.id}>
                    <Card className="flex h-full flex-col p-4">
                      <Link to={`/products/${product.id}`} className="group flex flex-1 flex-col">
                        <ProductTile brand={product.brand.name} className="aspect-[16/9] w-full" />
                        <h2 className="mt-4 line-clamp-2 font-medium group-hover:text-brand-700">
                          {product.name}
                        </h2>
                        <p className="mt-1 text-sm text-muted">
                          {product.brand.name} · {product.category.name}
                        </p>
                        <div className="mt-auto flex items-end justify-between gap-2 pt-4">
                          <span className="text-lg font-semibold">{formatVND(product.price)}</span>
                          <StockBadgeText stock={product.stock} />
                        </div>
                      </Link>
                      <Button
                        variant="secondary"
                        className="mt-4 w-full"
                        disabled={!product.inStock}
                        loading={pendingId === product.id}
                        onClick={() => void add(product.id, product.name)}
                      >
                        {product.inStock ? 'Thêm vào giỏ' : 'Tạm hết hàng'}
                      </Button>
                    </Card>
                  </li>
                ))}
              </ul>
              <Pagination
                page={page}
                totalPages={products.state.data.totalPages}
                onChange={(next) => {
                  update({ page: String(next) });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}
