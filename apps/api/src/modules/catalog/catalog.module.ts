import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrandEntity, CategoryEntity, ProductEntity } from './catalog.entities';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

@Module({
  imports: [TypeOrmModule.forFeature([CategoryEntity, BrandEntity, ProductEntity])],
  controllers: [CatalogController],
  providers: [CatalogService, CatalogRepository],
  exports: [CatalogService],
})
export class CatalogModule {}
