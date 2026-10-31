import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrandEntity, CategoryEntity, ProductEntity } from './catalog.entities';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';
import { ProductCache } from './product-cache';

@Module({
  imports: [TypeOrmModule.forFeature([CategoryEntity, BrandEntity, ProductEntity])],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogRepository, ProductCache],
  exports: [CatalogService, ProductCache],
})
export class CatalogModule {}
