import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { bigintTransformer } from '../../infra/database/column-transformers';

@Entity('categories')
export class CategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', unique: true })
  slug: string;
}

@Entity('brands')
export class BrandEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', unique: true })
  slug: string;
}

@Entity('products')
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  sku: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @Column({ name: 'brand_id', type: 'uuid' })
  brandId: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  price: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Bumped on every change; the cache layer (phase 2) keys on it. */
  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
