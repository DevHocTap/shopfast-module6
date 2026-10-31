import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BrandEntity, CategoryEntity, ProductEntity } from './catalog.entities';
import { ProductSort } from './dto/catalog.dto';

export interface ProductFilter {
  categoryId?: string;
  brandId?: string;
  minPrice?: number;
  maxPrice?: number;
  q?: string;
  sort: ProductSort;
  offset: number;
  limit: number;
}

/**
 * Catalog data that changes rarely (name, price, classification). Cached for minutes.
 * Stock is deliberately NOT part of it: it changes on every order and is cached separately.
 */
export interface ProductInfo {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  isActive: boolean;
  version: number;
  category: { id: string; name: string };
  brand: { id: string; name: string };
}

interface RawProductRow {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: string;
  is_active: boolean;
  version: number;
  category_id: string;
  category_name: string;
  brand_id: string;
  brand_name: string;
  total_count?: string;
}

const ORDER_BY: Record<ProductSort, string> = {
  newest: 'p.created_at DESC, p.id',
  price_asc: 'p.price ASC, p.id',
  price_desc: 'p.price DESC, p.id',
  name: 'p.name ASC, p.id',
};

const SELECT_PRODUCT = `
  SELECT p.id, p.sku, p.name, p.description, p.price, p.is_active, p.version,
         c.id AS category_id, c.name AS category_name,
         b.id AS brand_id, b.name AS brand_name`;

const FROM_PRODUCT = `
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN brands b ON b.id = p.brand_id`;

@Injectable()
export class CatalogRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** One round-trip: rows plus total count via a window function. */
  async search(filter: ProductFilter): Promise<{ rows: ProductInfo[]; total: number }> {
    const where = ['p.is_active'];
    const params: unknown[] = [];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filter.categoryId) where.push(`p.category_id = ${bind(filter.categoryId)}`);
    if (filter.brandId) where.push(`p.brand_id = ${bind(filter.brandId)}`);
    if (filter.minPrice !== undefined) where.push(`p.price >= ${bind(filter.minPrice)}`);
    if (filter.maxPrice !== undefined) where.push(`p.price <= ${bind(filter.maxPrice)}`);
    if (filter.q) where.push(`p.name ILIKE ${bind(`%${escapeLike(filter.q)}%`)}`);

    const sql = `${SELECT_PRODUCT}, count(*) OVER () AS total_count ${FROM_PRODUCT}
      WHERE ${where.join(' AND ')}
      ORDER BY ${ORDER_BY[filter.sort]}
      LIMIT ${bind(filter.limit)} OFFSET ${bind(filter.offset)}`;

    const raw: RawProductRow[] = await this.dataSource.query(sql, params);
    return { rows: raw.map(toProductInfo), total: raw.length ? Number(raw[0].total_count) : 0 };
  }

  async findById(id: string): Promise<ProductInfo | null> {
    const raw: RawProductRow[] = await this.dataSource.query(
      `${SELECT_PRODUCT} ${FROM_PRODUCT} WHERE p.id = $1`,
      [id],
    );
    return raw.length ? toProductInfo(raw[0]) : null;
  }

  /** Current stock for many products in one primary-key lookup. Unknown ids are absent. */
  async stocks(productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows: { product_id: string; quantity: number }[] = await this.dataSource.query(
      'SELECT product_id, quantity FROM inventories WHERE product_id = ANY($1::uuid[])',
      [productIds],
    );
    return new Map(rows.map((row) => [row.product_id, row.quantity]));
  }

  categories(): Promise<CategoryEntity[]> {
    return this.dataSource.getRepository(CategoryEntity).find({ order: { name: 'ASC' } });
  }

  brands(): Promise<BrandEntity[]> {
    return this.dataSource.getRepository(BrandEntity).find({ order: { name: 'ASC' } });
  }

  async update(id: string, changes: Partial<Pick<ProductEntity, 'name' | 'price' | 'isActive'>>) {
    const repo = this.dataSource.getRepository(ProductEntity);
    const product = await repo.findOne({ where: { id } });
    if (!product) return null;
    return repo.save(Object.assign(product, changes));
  }
}

function toProductInfo(r: RawProductRow): ProductInfo {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description,
    price: Number(r.price),
    isActive: r.is_active,
    version: r.version,
    category: { id: r.category_id, name: r.category_name },
    brand: { id: r.brand_id, name: r.brand_name },
  };
}

/** `%` and `_` typed by the user are literal characters, not wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
