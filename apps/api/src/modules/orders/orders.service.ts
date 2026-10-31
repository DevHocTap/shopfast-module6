import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { isStaff } from '../../common/auth/role.enum';
import { Paginated, paginated } from '../../common/dto/pagination.dto';
import { isUniqueViolation, TransactionRunner, Tx } from '../../infra/database/transaction-runner';
import { CartRepository } from '../cart/cart.repository';
import { ProductCache } from '../catalog/product-cache';
import { InventoryRepository } from '../inventory/inventory.repository';
import { OrderErrors } from './order.errors';
import {
  canTransition,
  CUSTOMER_CANCELLABLE,
  OrderStatus,
  WAREHOUSE_TARGETS,
} from './order-state-machine';
import {
  IDEMPOTENCY_CONSTRAINT,
  VOUCHER_ONCE_CONSTRAINT,
  OrderDetail,
  OrderHead,
  OrdersRepository,
  OrderSummary,
} from './orders.repository';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: easy to read over the phone

export interface PlacedOrder {
  order: OrderDetail;
  /** True when the same Idempotency-Key was seen before and the existing order is returned. */
  replayed: boolean;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly inventory: InventoryRepository,
    private readonly cart: CartRepository,
    private readonly tx: TransactionRunner,
    private readonly productCache: ProductCache,
  ) {}

  /**
   * Turns the cart into an order in ONE transaction:
   * read cart with current DB prices → reserve stock row by row (sorted, conditional UPDATE)
   * → claim the voucher (if any) → insert order, items, history, stock movements → empty the cart.
   * Any failure rolls everything back, so stock and vouchers are never lost or overspent.
   * Only after the commit is the stock cache invalidated.
   */
  async placeOrder(
    user: AuthUser,
    idempotencyKey: string | undefined,
    voucherCode?: string,
  ): Promise<PlacedOrder> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw OrderErrors.missingIdempotencyKey();
    }
    const existing = await this.orders.findIdByIdempotencyKey(user.id, idempotencyKey);
    if (existing) return { order: await this.detailOrThrow(existing), replayed: true };

    let orderId: string;
    let productIds: string[];
    try {
      ({ orderId, productIds } = await this.tx.run(async (tx) => {
        const lines = await this.cart.lines(user.id, tx);
        if (lines.length === 0) throw OrderErrors.cartEmpty();

        // Lines arrive sorted by product id: every transaction locks stock rows in the same order,
        // so two orders sharing products cannot deadlock.
        for (const line of lines) {
          if (!line.isActive) throw OrderErrors.productUnavailable(line.name);
          const reserved = await this.inventory.reserve(tx, line.productId, line.quantity);
          if (!reserved) throw OrderErrors.outOfStock(line.productId, line.name);
        }

        const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
        let discount = 0;
        if (voucherCode) {
          const percentOff = await this.orders.claimVoucher(tx, voucherCode);
          if (percentOff === null) throw OrderErrors.voucherInvalid(voucherCode);
          discount = voucherDiscount(subtotal, percentOff);
        }
        const id = await this.orders.insertOrder(tx, {
          code: generateOrderCode(),
          userId: user.id,
          subtotal,
          discount,
          total: subtotal - discount,
          idempotencyKey,
          voucherCode: voucherCode ?? null,
        });
        if (voucherCode) await this.orders.insertRedemption(tx, voucherCode, user.id, id);
        await this.orders.insertItems(
          tx,
          id,
          lines.map((line) => ({
            productId: line.productId,
            productName: line.name,
            sku: line.sku,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
          })),
        );
        await this.orders.insertHistory(tx, id, null, OrderStatus.PENDING_PAYMENT, user.id);
        await this.inventory.recordMovements(
          tx,
          lines.map((line) => ({
            productId: line.productId,
            delta: -line.quantity,
            reason: 'ORDER' as const,
            refId: id,
            actorId: user.id,
          })),
        );
        await this.cart.clear(tx, user.id);
        return { orderId: id, productIds: lines.map((line) => line.productId) };
      }));
    } catch (error) {
      // Same key sent twice at the same moment: the unique index lets exactly one through.
      if (isUniqueViolation(error, IDEMPOTENCY_CONSTRAINT)) {
        const winner = await this.orders.findIdByIdempotencyKey(user.id, idempotencyKey);
        if (winner) return { order: await this.detailOrThrow(winner), replayed: true };
      }
      if (isUniqueViolation(error, VOUCHER_ONCE_CONSTRAINT)) throw OrderErrors.voucherUsed();
      throw error;
    }

    await this.productCache.stockChanged(productIds);
    return { order: await this.detailOrThrow(orderId), replayed: false };
  }

  /** Simulated payment gateway: records the payment and moves the order to PAID. */
  async pay(user: AuthUser, orderId: string): Promise<OrderDetail> {
    await this.tx.run(async (tx) => {
      const order = await this.lockOwned(tx, user, orderId);
      if (order.status !== OrderStatus.PENDING_PAYMENT) {
        throw OrderErrors.invalidTransition(order.status, OrderStatus.PAID);
      }
      await this.orders.insertPayment(tx, order.id, order.total, 'SIMULATED');
      await this.apply(tx, order, OrderStatus.PAID, user.id);
    });
    return this.detailOrThrow(orderId);
  }

  async cancelByCustomer(user: AuthUser, orderId: string): Promise<OrderDetail> {
    const restocked = await this.tx.run(async (tx) => {
      const order = await this.lockOwned(tx, user, orderId);
      if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
        throw OrderErrors.invalidTransition(order.status, OrderStatus.CANCELLED);
      }
      return this.apply(tx, order, OrderStatus.CANCELLED, user.id);
    });
    await this.productCache.stockChanged(restocked);
    return this.detailOrThrow(orderId);
  }

  /**
   * Warehouse update with optimistic concurrency: the client sends the version it saw;
   * if someone changed the order meanwhile, the update is refused instead of silently overwriting.
   */
  async changeStatusByStaff(
    actor: AuthUser,
    orderId: string,
    to: OrderStatus,
    expectedVersion: number,
  ): Promise<OrderDetail> {
    if (!WAREHOUSE_TARGETS.includes(to)) {
      throw OrderErrors.invalidTransition(OrderStatus.PENDING_PAYMENT, to);
    }
    const restocked = await this.tx.run(async (tx) => {
      const order = await this.orders.lock(tx, orderId);
      if (!order) throw OrderErrors.notFound();
      if (order.version !== expectedVersion) throw OrderErrors.stale();
      return this.apply(tx, order, to, actor.id);
    });
    await this.productCache.stockChanged(restocked);
    return this.detailOrThrow(orderId);
  }

  async getForUser(user: AuthUser, orderId: string): Promise<OrderDetail> {
    const order = await this.detailOrThrow(orderId);
    // Another customer's order answers 404, not 403: existence is not revealed.
    if (!isStaff(user.role) && order.customer.id !== user.id) throw OrderErrors.notFound();
    return order;
  }

  async listMine(user: AuthUser, page: number, limit: number): Promise<Paginated<OrderSummary>> {
    const { rows, total } = await this.orders.list({ userId: user.id }, (page - 1) * limit, limit);
    return paginated(rows, total, page, limit);
  }

  async listForStaff(
    status: OrderStatus | undefined,
    page: number,
    limit: number,
  ): Promise<Paginated<OrderSummary>> {
    const { rows, total } = await this.orders.list({ status }, (page - 1) * limit, limit);
    return paginated(rows, total, page, limit);
  }

  private async lockOwned(tx: Tx, user: AuthUser, orderId: string): Promise<OrderHead> {
    const order = await this.orders.lock(tx, orderId);
    if (!order || order.userId !== user.id) throw OrderErrors.notFound();
    return order;
  }

  /**
   * Single place where a status changes: validates the transition, writes history, returns stock.
   * Returns the ids of products whose stock went back up (their cache entries must be dropped).
   */
  private async apply(
    tx: Tx,
    order: OrderHead,
    to: OrderStatus,
    actorId: string,
  ): Promise<string[]> {
    if (!canTransition(order.status, to)) throw OrderErrors.invalidTransition(order.status, to);

    let restocked: string[] = [];
    if (to === OrderStatus.CANCELLED) {
      const items = await this.orders.items(tx, order.id);
      restocked = items.map((item) => item.productId);
      for (const item of items) await this.inventory.release(tx, item.productId, item.quantity);
      await this.inventory.recordMovements(
        tx,
        items.map((item) => ({
          productId: item.productId,
          delta: item.quantity,
          reason: 'CANCEL' as const,
          refId: order.id,
          actorId,
        })),
      );
    }
    await this.orders.updateStatus(tx, order.id, to);
    await this.orders.insertHistory(tx, order.id, order.status, to, actorId);
    return restocked;
  }

  private async detailOrThrow(orderId: string): Promise<OrderDetail> {
    const detail = await this.orders.detail(orderId);
    if (!detail) throw OrderErrors.notFound();
    return detail;
  }
}

/** Percentage of the subtotal, rounded down to the nearest 1,000 VND. */
export function voucherDiscount(subtotal: number, percentOff: number): number {
  return Math.floor((subtotal * percentOff) / 100 / 1000) * 1000;
}

/** e.g. SF-7KQ2M9XA. 32^8 ≈ 10^12 combinations; the unique index catches the improbable collision. */
export function generateOrderCode(): string {
  let code = 'SF-';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}
