import { ArrowRight, LayoutGrid, PackageSearch, ShoppingCart, SlidersHorizontal, Sparkles } from 'lucide-react';
import { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { categoryIcon, ProductTile, StockBadge } from '../../components/ProductTile';
import { ValueProps } from '../../components/ValueProps';
import { Button } from '../../components/ui/Button';
import { InputField, SelectField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
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
/** Filters set from the sidebar form (category and sort have their own controls). */
const FORM_KEYS = ['q', 'brandId', 'minPrice', 'maxPrice'] as const;

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
    update(Object.fromEntries(FORM_KEYS.map((key) => [key, String(form.get(key) ?? '').trim()])));
  }

  const [categories, brands] = facets.state.status === 'success' ? facets.state.data : [[], []];
  const total = products.state.status === 'success' ? products.state.data.total : undefined;
  const showHero = !hasFilters && page === 1;
  const activeCategory = categories.find((c) => c.id === filters.categoryId);
  const Heading = showHero ? 'h2' : 'h1';

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
    <div className="flex flex-col gap-8">
      {showHero && (
        <section className="relative isolate overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-10 text-white shadow-raised sm:px-12 sm:py-16">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_10%,rgb(79_70_229_/_0.65),transparent_31rem),radial-gradient(circle_at_95%_100%,rgb(14_165_233_/_0.3),transparent_26rem)]" />
          <div className="absolute -right-20 top-8 -z-10 size-72 rounded-full border border-white/10" />
          <div className="absolute -right-4 top-24 -z-10 size-44 rounded-full border border-white/10" />
          <div className="absolute bottom-0 left-[48%] -z-10 h-32 w-64 rotate-[-18deg] rounded-full bg-brand-600/30 blur-3xl" />
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-brand-100 backdrop-blur">
              <Sparkles className="size-3.5" aria-hidden /> Shop công nghệ tuyển chọn
            </p>
            <h1 className="mt-6 max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-5xl">
              Công nghệ tốt hơn cho nhịp sống mỗi ngày.
            </h1>
          </div>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
            {total === undefined
              ? 'Điện thoại, laptop, âm thanh và phụ kiện từ các thương hiệu hàng đầu.'
              : `${total.toLocaleString('vi-VN')} sản phẩm${
                  brands.length ? ` từ ${brands.length} thương hiệu` : ''
                }: điện thoại, laptop, âm thanh và phụ kiện.`}
          </p>
          <a
            href="#catalog"
            className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-slate-950 shadow-lg transition-transform hover:-translate-y-px"
          >
            Khám phá sản phẩm <ArrowRight className="size-4" aria-hidden />
          </a>
          {/* On phones the products matter more than the pitch. */}
          <div className="mt-12 max-w-3xl border-t border-white/10 pt-7 sm:block">
            <ValueProps tone="dark" />
          </div>
        </section>
      )}

      <nav
        aria-label="Danh mục"
        className="no-scrollbar -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0"
      >
        <ul className="flex gap-2 pb-1 lg:flex-wrap">
          <li>
            <CategoryChip
              label="Tất cả"
              icon={LayoutGrid}
              active={!filters.categoryId}
              onClick={() => update({ categoryId: '' })}
            />
          </li>
          {categories.map((category) => (
            <li key={category.id}>
              <CategoryChip
                label={category.name}
                icon={categoryIcon(category.name)}
                active={filters.categoryId === category.id}
                onClick={() => update({ categoryId: category.id })}
              />
            </li>
          ))}
        </ul>
      </nav>

      <div id="catalog" className="scroll-mt-32 grid gap-8 lg:grid-cols-[256px_1fr]">
        <aside>
          <details className="group lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm border border-border bg-surface px-4 font-medium">
              <SlidersHorizontal className="size-4" aria-hidden />
              Bộ lọc{hasFilters ? ' (đang áp dụng)' : ''}
            </summary>
            <Card className="mt-3 p-4">{filterForm}</Card>
          </details>
          <Card className="hidden border border-white/80 p-6 lg:block">
            <h2 className="mb-4 flex items-center gap-2 font-semibold">
              <SlidersHorizontal className="size-4 text-muted" aria-hidden />
              Bộ lọc
            </h2>
            {filterForm}
          </Card>
        </aside>

        <section aria-label="Danh sách sản phẩm" aria-busy={products.state.status === 'loading'}>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <Heading className="text-2xl font-semibold">
                {activeCategory?.name ?? (filters.q ? `Kết quả cho “${filters.q}”` : 'Sản phẩm')}
              </Heading>
              <p className="mt-1 text-sm text-muted">
                {total === undefined ? 'Đang tải…' : `${total.toLocaleString('vi-VN')} sản phẩm`}
              </p>
            </div>
            <div className="w-48">
              <SelectField
                label="Sắp xếp"
                value={filters.sort || 'newest'}
                onChange={(event) => update({ sort: event.target.value })}
                options={SORTS}
              />
            </div>
          </div>

          {products.state.status === 'loading' && (
            <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i}>
                  <Card className="overflow-hidden">
                    <Skeleton className="aspect-[4/3] w-full rounded-none" />
                    <div className="p-4">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="mt-2 h-5 w-3/4" />
                      <Skeleton className="mt-6 h-6 w-1/2" />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
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
                    <ProductCard
                      product={product}
                      adding={pendingId === product.id}
                      onAdd={() => void add(product.id, product.name)}
                    />
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
    </div>
  );
}

function CategoryChip({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReturnType<typeof categoryIcon>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-all duration-200 ${
        active
          ? 'bg-brand-600 text-white shadow-card'
          : 'border border-transparent bg-surface text-ink shadow-card hover:-translate-y-px hover:border-brand-100 hover:bg-brand-50 hover:text-brand-700'
      }`}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

function ProductCard({
  product,
  adding,
  onAdd,
}: {
  product: Product;
  adding: boolean;
  onAdd: () => void;
}) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-transparent bg-surface shadow-card transition duration-300 hover:-translate-y-1 hover:border-brand-100 hover:shadow-raised">
      <Link to={`/products/${product.id}`} className="flex flex-1 flex-col rounded-lg">
        <div className="relative">
          <ProductTile
            category={product.category.name}
            brand={product.brand.name}
            className="aspect-[4/3] w-full"
          />
          <div className="absolute left-3 top-3">
            <StockBadge stock={product.stock} />
          </div>
        </div>
        <div className="flex flex-1 flex-col p-5">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand-700">{product.category.name}</p>
          <h2 className="mt-2 line-clamp-2 font-semibold leading-6 transition-colors duration-150 group-hover:text-brand-700">
            {product.name}
          </h2>
          <p className="mt-auto pr-16 pt-5 text-xl font-bold tabular-nums">
            {formatVND(product.price)}
          </p>
        </div>
      </Link>
      <Button
        variant="soft"
        size="icon"
        className="absolute bottom-4 right-4"
        disabled={!product.inStock}
        loading={adding}
        onClick={onAdd}
        aria-label={
          product.inStock ? `Thêm ${product.name} vào giỏ` : `${product.name} tạm hết hàng`
        }
        title={product.inStock ? 'Thêm vào giỏ' : 'Tạm hết hàng'}
      >
        {!adding && <ShoppingCart className="size-5" aria-hidden />}
      </Button>
    </article>
  );
}
