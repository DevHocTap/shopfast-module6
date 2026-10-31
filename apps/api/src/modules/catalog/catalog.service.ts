import { HttpStatus, Injectable } from '@nestjs/common';
import { Paginated, paginated } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { CacheService, CacheStatus } from '../../infra/cache/cache.service';
import { BrandEntity, CategoryEntity } from './catalog.entities';
import { CatalogRepository, ProductInfo } from './catalog.repository';
import { ProductQueryDto, UpdateProductDto } from './dto/catalog.dto';
import {
  CATALOG_NAMESPACE,
  FACETS_TTL_SECONDS,
  LIST_TTL_SECONDS,
  listKey,
  PRODUCT_TTL_SECONDS,
  ProductCache,
  productKey,
} from './product-cache';

export type ProductView = ProductInfo & { stock: number; inStock: boolean };

/** A response plus how it was served, exposed to clients as the `X-Cache` header. */
export interface WithCacheStatus<T> {
  data: T;
  cache: CacheStatus;
}

const productNotFound = () =>
  new AppError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm.');

@Injectable()
export class CatalogService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly cache: CacheService,
    private readonly productCache: ProductCache,
  ) {}

  async listCategories(): Promise<CategoryEntity[]> {
    const { value } = await this.cache.getOrLoad('catalog:categories', FACETS_TTL_SECONDS, () =>
      this.repo.categories(),
    );
    return value ?? [];
  }

  async listBrands(): Promise<BrandEntity[]> {
    const { value } = await this.cache.getOrLoad('catalog:brands', FACETS_TTL_SECONDS, () =>
      this.repo.brands(),
    );
    return value ?? [];
  }

  async listProducts(query: ProductQueryDto): Promise<WithCacheStatus<Paginated<ProductView>>> {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PRICE_RANGE',
        'Giá tối thiểu không được lớn hơn giá tối đa.',
      );
    }
    const filter = {
      categoryId: query.categoryId,
      brandId: query.brandId,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      q: query.q?.toLowerCase() || undefined,
      sort: query.sort,
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    };
    const version = await this.cache.version(CATALOG_NAMESPACE);
    const { value, status } = await this.cache.getOrLoad(
      listKey(version, filter),
      LIST_TTL_SECONDS,
      () => this.repo.search(filter),
    );
    const { rows, total } = value ?? { rows: [], total: 0 };
    const items = await this.withStock(rows);
    return { data: paginated(items, total, query.page, query.limit), cache: status };
  }

  async getProduct(id: string): Promise<WithCacheStatus<ProductView>> {
    // Unknown and discontinued ids are cached as null: probing random ids cannot reach the DB.
    const { value, status } = await this.cache.getOrLoad(
      productKey(id),
      PRODUCT_TTL_SECONDS,
      async () => {
        const row = await this.repo.findById(id);
        return row && row.isActive ? row : null;
      },
    );
    if (!value) throw productNotFound();
    const [view] = await this.withStock([value]);
    return { data: view, cache: status };
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<ProductView> {
    const updated = await this.repo.update(id, dto);
    if (!updated) throw productNotFound();
    // After the commit: the new price must be visible to the very next request.
    await this.productCache.productChanged(id);
    const row = await this.repo.findById(id);
    if (!row) throw productNotFound();
    const [view] = await this.withStock([row]);
    return view;
  }

  private async withStock(rows: ProductInfo[]): Promise<ProductView[]> {
    const stocks = await this.productCache.stocks(rows.map((row) => row.id));
    return rows.map((row) => {
      const stock = stocks.get(row.id) ?? 0;
      return { ...row, stock, inStock: stock > 0 };
    });
  }
}
