import { Role } from '../../common/auth/role.enum';
import { TransactionRunner } from '../../infra/database/transaction-runner';
import { CartLine, CartRepository } from '../cart/cart.repository';
import { ProductCache } from '../catalog/product-cache';
import { InventoryRepository } from '../inventory/inventory.repository';
import { OrderStatus } from './order-state-machine';
import { OrderDetail, OrderHead, OrdersRepository } from './orders.repository';
import { generateOrderCode, OrdersService, voucherDiscount } from './orders.service';

const customer = { id: 'u1', email: 'an@example.com', role: Role.CUSTOMER };
const warehouse = { id: 'w1', email: 'kho@example.com', role: Role.WAREHOUSE };
const ATTEMPT = 'attempt-0001';
const TX = { tx: true };

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  productId: 'p1',
  sku: 'SKU-1',
  name: 'Tai nghe',
  unitPrice: 100_000,
  quantity: 2,
  isActive: true,
  stock: 10,
  ...overrides,
});

const head = (overrides: Partial<OrderHead> = {}): OrderHead => ({
  id: 'o1',
  userId: 'u1',
  status: OrderStatus.PENDING_PAYMENT,
  version: 1,
  total: 200_000,
  ...overrides,
});

function setup() {
  const detail = { id: 'o1', customer: { id: 'u1' } } as OrderDetail;
  const orders = {
    findIdByIdempotencyKey: jest.fn().mockResolvedValue(null),
    insertOrder: jest.fn().mockResolvedValue('o1'),
    insertItems: jest.fn(),
    insertHistory: jest.fn(),
    lock: jest.fn(),
    items: jest.fn().mockResolvedValue([{ productId: 'p1', quantity: 2 }]),
    updateStatus: jest.fn(),
    insertPayment: jest.fn(),
    detail: jest.fn().mockResolvedValue(detail),
    list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    claimVoucher: jest.fn(),
    insertRedemption: jest.fn(),
  };
  const inventory = {
    reserve: jest.fn().mockResolvedValue(true),
    release: jest.fn(),
    recordMovements: jest.fn(),
  };
  const cart = { lines: jest.fn().mockResolvedValue([line()]), clear: jest.fn() };
  const tx = { run: jest.fn((work: (t: unknown) => Promise<unknown>) => work(TX)) };
  const productCache = { stockChanged: jest.fn() };
  const outbox = { add: jest.fn() };
  const service = new OrdersService(
    orders as unknown as OrdersRepository,
    inventory as unknown as InventoryRepository,
    cart as unknown as CartRepository,
    tx as unknown as TransactionRunner,
    productCache as unknown as ProductCache,
    outbox,
  );
  return { service, orders, inventory, cart, tx, detail, productCache, outbox };
}

describe('OrdersService.placeOrder', () => {
  it('requires a well-formed Idempotency-Key', async () => {
    const { service } = setup();

    await expect(service.placeOrder(customer, undefined)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
    await expect(service.placeOrder(customer, 'short')).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
  });

  it('reserves stock, writes the order at DB prices and empties the cart in one transaction', async () => {
    const { service, orders, inventory, cart, tx } = setup();

    const result = await service.placeOrder(customer, ATTEMPT);

    expect(result.replayed).toBe(false);
    expect(tx.run).toHaveBeenCalledTimes(1);
    expect(inventory.reserve).toHaveBeenCalledWith(TX, 'p1', 2);
    expect(orders.insertOrder).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        subtotal: 200_000,
        total: 200_000,
        idempotencyKey: ATTEMPT,
        userId: 'u1',
      }),
    );
    expect(orders.insertHistory).toHaveBeenCalledWith(
      TX,
      'o1',
      null,
      OrderStatus.PENDING_PAYMENT,
      'u1',
    );
    expect(inventory.recordMovements).toHaveBeenCalledWith(TX, [
      expect.objectContaining({ productId: 'p1', delta: -2, reason: 'ORDER', refId: 'o1' }),
    ]);
    expect(cart.clear).toHaveBeenCalledWith(TX, 'u1');
  });

  it('stops at the first product without enough stock (the transaction rolls back)', async () => {
    const { service, orders, inventory, cart } = setup();
    cart.lines.mockResolvedValue([line(), line({ productId: 'p2', name: 'Loa' })]);
    inventory.reserve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(service.placeOrder(customer, ATTEMPT)).rejects.toMatchObject({
      response: { code: 'OUT_OF_STOCK', details: { productId: 'p2' } },
    });
    expect(orders.insertOrder).not.toHaveBeenCalled();
    expect(cart.clear).not.toHaveBeenCalled();
  });

  it('refuses an empty cart and inactive products', async () => {
    const { service, cart } = setup();
    cart.lines.mockResolvedValueOnce([]);
    await expect(service.placeOrder(customer, ATTEMPT)).rejects.toMatchObject({
      response: { code: 'CART_EMPTY' },
    });

    cart.lines.mockResolvedValueOnce([line({ isActive: false })]);
    await expect(service.placeOrder(customer, ATTEMPT)).rejects.toMatchObject({
      response: { code: 'PRODUCT_UNAVAILABLE' },
    });
  });

  it('returns the existing order when the key was already used', async () => {
    const { service, orders, tx } = setup();
    orders.findIdByIdempotencyKey.mockResolvedValue('o1');

    const result = await service.placeOrder(customer, ATTEMPT);

    expect(result.replayed).toBe(true);
    expect(tx.run).not.toHaveBeenCalled();
  });

  it('resolves a concurrent duplicate key (unique violation) to the winning order', async () => {
    const { service, orders, tx } = setup();
    orders.findIdByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce('o-winner');
    tx.run.mockRejectedValue({
      driverError: { code: '23505', constraint: 'orders_user_idempotency_key' },
    });

    const result = await service.placeOrder(customer, ATTEMPT);

    expect(result.replayed).toBe(true);
    expect(orders.detail).toHaveBeenCalledWith('o-winner');
  });
});

describe('OrdersService vouchers and cache', () => {
  it('applies a voucher: claims one use, discounts the total, records the redemption', async () => {
    const { service, orders } = setup();
    orders.claimVoucher.mockResolvedValue(10);

    await service.placeOrder(customer, ATTEMPT, 'SALE10');

    expect(orders.claimVoucher).toHaveBeenCalledWith(TX, 'SALE10');
    expect(orders.insertOrder).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        subtotal: 200_000,
        discount: 20_000,
        total: 180_000,
        voucherCode: 'SALE10',
      }),
    );
    expect(orders.insertRedemption).toHaveBeenCalledWith(TX, 'SALE10', 'u1', 'o1');
  });

  it('rejects an invalid or exhausted voucher', async () => {
    const { service, orders } = setup();
    orders.claimVoucher.mockResolvedValue(null);

    await expect(service.placeOrder(customer, ATTEMPT, 'NOPE')).rejects.toMatchObject({
      response: { code: 'VOUCHER_INVALID' },
    });
    expect(orders.insertOrder).not.toHaveBeenCalled();
  });

  it('maps a second use of the same voucher to VOUCHER_ALREADY_USED', async () => {
    const { service, tx } = setup();
    tx.run.mockRejectedValue({
      driverError: { code: '23505', constraint: 'voucher_redemptions_one_per_user' },
    });

    await expect(service.placeOrder(customer, ATTEMPT, 'SALE10')).rejects.toMatchObject({
      response: { code: 'VOUCHER_ALREADY_USED' },
    });
  });

  it('records OrderPlaced and InventoryChanged in the outbox inside the order transaction', async () => {
    const { service, outbox } = setup();

    await service.placeOrder(customer, ATTEMPT);

    expect(outbox.add).toHaveBeenCalledWith(TX, [
      { type: 'OrderPlaced', aggregateId: 'o1', payload: { orderId: 'o1' } },
      {
        type: 'InventoryChanged',
        aggregateId: 'o1',
        payload: { productIds: ['p1'], reason: 'ORDER' },
      },
    ]);
  });

  it('drops the stock cache of ordered products only after the commit', async () => {
    const { service, productCache, tx } = setup();

    await service.placeOrder(customer, ATTEMPT);

    expect(productCache.stockChanged).toHaveBeenCalledWith(['p1']);
    expect(productCache.stockChanged.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.run.mock.invocationCallOrder[0],
    );
  });

  it('does not touch the cache when the order fails', async () => {
    const { service, inventory, productCache } = setup();
    inventory.reserve.mockResolvedValue(false);

    await expect(service.placeOrder(customer, ATTEMPT)).rejects.toBeDefined();
    expect(productCache.stockChanged).not.toHaveBeenCalled();
  });

  it('rounds the discount down to 1,000 VND', () => {
    expect(voucherDiscount(1_234_567, 10)).toBe(123_000);
    expect(voucherDiscount(999, 50)).toBe(0);
  });
});

describe('OrdersService status changes', () => {
  it('pays a pending order once', async () => {
    const { service, orders } = setup();
    orders.lock.mockResolvedValue(head());

    await service.pay(customer, 'o1');

    expect(orders.insertPayment).toHaveBeenCalledWith(TX, 'o1', 200_000, 'SIMULATED');
    expect(orders.updateStatus).toHaveBeenCalledWith(TX, 'o1', OrderStatus.PAID);
  });

  it('refuses to pay an order that is not pending', async () => {
    const { service, orders } = setup();
    orders.lock.mockResolvedValue(head({ status: OrderStatus.PAID }));

    await expect(service.pay(customer, 'o1')).rejects.toMatchObject({
      response: { code: 'INVALID_TRANSITION' },
    });
    expect(orders.insertPayment).not.toHaveBeenCalled();
  });

  it("hides other customers' orders as not found", async () => {
    const { service, orders } = setup();
    orders.lock.mockResolvedValue(head({ userId: 'someone-else' }));

    await expect(service.pay(customer, 'o1')).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_FOUND' },
    });
  });

  it('returns stock to inventory when an order is cancelled', async () => {
    const { service, orders, inventory, productCache, outbox } = setup();
    orders.lock.mockResolvedValue(head({ status: OrderStatus.PAID }));

    await service.cancelByCustomer(customer, 'o1');

    expect(inventory.release).toHaveBeenCalledWith(TX, 'p1', 2);
    expect(inventory.recordMovements).toHaveBeenCalledWith(TX, [
      expect.objectContaining({ delta: 2, reason: 'CANCEL' }),
    ]);
    expect(orders.insertHistory).toHaveBeenCalledWith(
      TX,
      'o1',
      OrderStatus.PAID,
      OrderStatus.CANCELLED,
      'u1',
    );
    expect(productCache.stockChanged).toHaveBeenCalledWith(['p1']);
    expect(outbox.add).toHaveBeenCalledWith(TX, [
      expect.objectContaining({
        type: 'InventoryChanged',
        payload: { productIds: ['p1'], reason: 'CANCEL' },
      }),
    ]);
  });

  it('does not let a customer cancel once packing started', async () => {
    const { service, orders, inventory } = setup();
    orders.lock.mockResolvedValue(head({ status: OrderStatus.PACKING }));

    await expect(service.cancelByCustomer(customer, 'o1')).rejects.toMatchObject({
      response: { code: 'INVALID_TRANSITION' },
    });
    expect(inventory.release).not.toHaveBeenCalled();
  });

  it('applies a warehouse change when the version matches', async () => {
    const { service, orders } = setup();
    orders.lock.mockResolvedValue(head({ status: OrderStatus.PAID, version: 3 }));

    await service.changeStatusByStaff(warehouse, 'o1', OrderStatus.PACKING, 3);

    expect(orders.updateStatus).toHaveBeenCalledWith(TX, 'o1', OrderStatus.PACKING);
  });

  it('rejects a warehouse change based on a stale version', async () => {
    const { service, orders } = setup();
    orders.lock.mockResolvedValue(head({ status: OrderStatus.PAID, version: 4 }));

    await expect(
      service.changeStatusByStaff(warehouse, 'o1', OrderStatus.PACKING, 3),
    ).rejects.toMatchObject({
      response: { code: 'STALE_ORDER' },
    });
  });

  it('rejects skipping steps and non-warehouse targets', async () => {
    const { service, orders } = setup();
    orders.lock.mockResolvedValue(head({ status: OrderStatus.PAID }));

    await expect(
      service.changeStatusByStaff(warehouse, 'o1', OrderStatus.DELIVERED, 1),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_TRANSITION' },
    });
    await expect(
      service.changeStatusByStaff(warehouse, 'o1', OrderStatus.PAID, 1),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_TRANSITION' },
    });
  });
});

describe('OrdersService reads', () => {
  it('lets staff read any order but customers only their own', async () => {
    const { service, orders, detail } = setup();
    orders.detail.mockResolvedValue({ ...detail, customer: { id: 'other' } });

    await expect(service.getForUser(customer, 'o1')).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_FOUND' },
    });
    await expect(service.getForUser(warehouse, 'o1')).resolves.toBeDefined();
  });

  it('paginates the customer history and the staff list', async () => {
    const { service, orders } = setup();
    orders.list.mockResolvedValue({ rows: [], total: 45 });

    await expect(service.listMine(customer, 2, 20)).resolves.toMatchObject({
      page: 2,
      totalPages: 3,
    });
    expect(orders.list).toHaveBeenCalledWith({ userId: 'u1' }, 20, 20);

    await service.listForStaff(OrderStatus.PAID, 1, 10);
    expect(orders.list).toHaveBeenLastCalledWith({ status: OrderStatus.PAID }, 0, 10);
  });
});

describe('generateOrderCode', () => {
  it('produces readable codes without ambiguous characters', () => {
    for (let i = 0; i < 200; i++) expect(generateOrderCode()).toMatch(/^SF-[A-HJ-NP-Z2-9]{8}$/);
  });
});
