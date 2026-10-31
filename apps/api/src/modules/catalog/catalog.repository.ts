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

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  isActive: boolean;
  version: number;
  stock: number;
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
  stock: number | null;
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
         COALESCE(i.quantity, 0) AS stock,
         c.id AS category_id, c.name AS category_name,
         b.id AS brand_id, b.name AS brand_name`;

const FROM_PRODUCT = `
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN brands b ON b.id = p.brand_id
  LEFT JOIN inventories i ON i.product_id = p.id`;

@Injectable()
export class CatalogRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** One round-trip: rows plus total count via a window function. */
  async search(filter: ProductFilter): Promise<{ rows: ProductRow[]; total: number }> {
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
    return { rows: raw.map(toProductRow), total: raw.length ? Number(raw[0].total_count) : 0 };
  }

  async findById(id: string): Promise<ProductRow | null> {
    const raw: RawProductRow[] = await this.dataSource.query(
      `${SELECT_PRODUCT} ${FROM_PRODUCT} WHERE p.id = $1`,
      [id],
    );
    return raw.length ? toProductRow(raw[0]) : null;
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

function toProductRow(r: RawProductRow): ProductRow {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description,
    price: Number(r.price),
    isActive: r.is_active,
    version: r.version,
    stock: Number(r.stock ?? 0),
    category: { id: r.category_id, name: r.category_name },
    brand: { id: r.brand_id, name: r.brand_name },
  };
}

/** `%` and `_` typed by the user are literal characters, not wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
