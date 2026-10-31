import { HttpStatus, Injectable } from '@nestjs/common';
import { Paginated, paginated } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { BrandEntity, CategoryEntity } from './catalog.entities';
import { CatalogRepository, ProductRow } from './catalog.repository';
import { ProductQueryDto, UpdateProductDto } from './dto/catalog.dto';

export type ProductView = ProductRow & { inStock: boolean };

const productNotFound = () =>
  new AppError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm.');

@Injectable()
export class CatalogService {
  constructor(private readonly repo: CatalogRepository) {}

  listCategories(): Promise<CategoryEntity[]> {
    return this.repo.categories();
  }

  listBrands(): Promise<BrandEntity[]> {
    return this.repo.brands();
  }

  async listProducts(query: ProductQueryDto): Promise<Paginated<ProductView>> {
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
    const { rows, total } = await this.repo.search({
      categoryId: query.categoryId,
      brandId: query.brandId,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      q: query.q || undefined,
      sort: query.sort,
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });
    return paginated(rows.map(toView), total, query.page, query.limit);
  }

  async getProduct(id: string): Promise<ProductView> {
    const row = await this.repo.findById(id);
    if (!row || !row.isActive) throw productNotFound();
    return toView(row);
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<ProductView> {
    const updated = await this.repo.update(id, dto);
    if (!updated) throw productNotFound();
    const row = await this.repo.findById(id);
    if (!row) throw productNotFound();
    return toView(row);
  }
}

function toView(row: ProductRow): ProductView {
  return { ...row, inStock: row.stock > 0 };
}
