import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { CartLine, CartRepository } from './cart.repository';

export const MAX_QUANTITY_PER_LINE = 99;

export interface CartView {
  items: (CartLine & { lineTotal: number; available: boolean })[];
  itemCount: number;
  subtotal: number;
  /** True when at least one line cannot be fulfilled right now (soft check; checkout re-checks). */
  hasUnavailableItems: boolean;
}

@Injectable()
export class CartService {
  constructor(private readonly repo: CartRepository) {}

  async get(userId: string): Promise<CartView> {
    return toView(await this.repo.lines(userId));
  }

  async setItem(userId: string, productId: string, quantity: number): Promise<CartView> {
    if (!(await this.repo.productIsActive(productId))) {
      throw new AppError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm.');
    }
    await this.repo.upsert(userId, productId, quantity);
    return this.get(userId);
  }

  async removeItem(userId: string, productId: string): Promise<CartView> {
    await this.repo.remove(userId, productId);
    return this.get(userId);
  }
}

export function toView(lines: CartLine[]): CartView {
  const items = lines.map((line) => ({
    ...line,
    lineTotal: line.unitPrice * line.quantity,
    available: line.isActive && line.stock >= line.quantity,
  }));
  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
    hasUnavailableItems: items.some((item) => !item.available),
  };
}
