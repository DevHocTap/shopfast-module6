import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public, Roles } from '../../common/auth/decorators';
import { Role } from '../../common/auth/role.enum';
import { Paginated } from '../../common/dto/pagination.dto';
import { BrandEntity, CategoryEntity } from './catalog.entities';
import { CatalogService, ProductView } from './catalog.service';
import { ProductQueryDto, UpdateProductDto } from './dto/catalog.dto';

/** `X-Cache: HIT | MISS | BYPASS` makes the cache behaviour observable in DevTools and k6. */
const CACHE_HEADER = 'X-Cache';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('categories')
  categories(): Promise<CategoryEntity[]> {
    return this.catalog.listCategories();
  }

  @Public()
  @Get('brands')
  brands(): Promise<BrandEntity[]> {
    return this.catalog.listBrands();
  }

  @Public()
  @Get('products')
  async products(
    @Query() query: ProductQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Paginated<ProductView>> {
    const { data, cache } = await this.catalog.listProducts(query);
    res.setHeader(CACHE_HEADER, cache);
    return data;
  }

  @Public()
  @Get('products/:id')
  async product(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductView> {
    const { data, cache } = await this.catalog.getProduct(id);
    res.setHeader(CACHE_HEADER, cache);
    return data;
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch('admin/products/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductView> {
    return this.catalog.updateProduct(id, dto);
  }
}
