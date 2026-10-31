import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public, Roles } from '../../common/auth/decorators';
import { Role } from '../../common/auth/role.enum';
import { Paginated } from '../../common/dto/pagination.dto';
import { BrandEntity, CategoryEntity } from './catalog.entities';
import { CatalogService, ProductView } from './catalog.service';
import { ProductQueryDto, UpdateProductDto } from './dto/catalog.dto';

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
  products(@Query() query: ProductQueryDto): Promise<Paginated<ProductView>> {
    return this.catalog.listProducts(query);
  }

  @Public()
  @Get('products/:id')
  product(@Param('id', ParseUUIDPipe) id: string): Promise<ProductView> {
    return this.catalog.getProduct(id);
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
