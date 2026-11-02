import { OrderStatus } from '../orders/order-state-machine';
import { OrderDetail } from '../orders/orders.repository';
import { runAssistantTool, ToolContext } from './assistant-tools';
import { AssistantRepository } from './assistant.repository';

const order = (overrides: Partial<OrderDetail> = {}) =>
  ({
    id: 'o1',
    code: 'SF-7KQ2M9XA',
    status: OrderStatus.PAID,
    customer: { id: 'c1', email: 'an@example.com', fullName: 'An' },
    createdAt: new Date('2026-11-01T02:00:00Z'),
    updatedAt: new Date('2026-11-01T03:00:00Z'),
    total: 500_000,
    payment: { amount: 500_000, method: 'SIMULATED', paidAt: new Date() },
    items: [{ productId: 'p1', productName: 'Loa', sku: 'SKU-00001', unitPrice: 1, quantity: 1 }],
    history: [{ from: null, to: OrderStatus.PENDING_PAYMENT, at: new Date() }],
    ...overrides,
  }) as OrderDetail;

function setup(found: OrderDetail | null = order()) {
  const repository = {
    productBySku: jest.fn().mockResolvedValue(null),
    propose: jest.fn().mockResolvedValue({ id: 'a1', created: true }),
  };
  const deps = {
    findOrder: jest.fn().mockResolvedValue(found),
    repository: repository as unknown as AssistantRepository,
  };
  const context: ToolContext = {
    ticketId: 't1',
    customerId: 'c1',
    staffId: 's1',
    lookedUpCodes: new Set(),
    proposals: 0,
  };
  const run = (name: string, input: Record<string, unknown>) =>
    runAssistantTool(deps, context, name, input);
  return { run, deps, repository, context };
}

const parse = (content: string) => JSON.parse(content) as Record<string, unknown>;

describe('get_order_status', () => {
  it('returns the order facts and remembers the code for the output guard', async () => {
    const { run, context } = setup();

    const outcome = await run('get_order_status', { order_code: 'sf-7kq2m9xa' });

    expect(parse(outcome.content)).toMatchObject({
      found: true,
      order_code: 'SF-7KQ2M9XA',
      status_label: 'Đã thanh toán',
      paid: true,
      belongs_to_ticket_customer: true,
    });
    expect(context.lookedUpCodes.has('SF-7KQ2M9XA')).toBe(true);
  });

  it('says found=false instead of inventing an order', async () => {
    const { run } = setup(null);
    expect(parse((await run('get_order_status', { order_code: 'SF-00000000' })).content)).toEqual({
      found: false,
      order_code: 'SF-00000000',
    });
  });

  it('rejects malformed input before touching the database', async () => {
    const { run, deps } = setup();
    const outcome = await run('get_order_status', { order_code: "x' OR 1=1" });
    expect(outcome.isError).toBe(true);
    expect(deps.findOrder).not.toHaveBeenCalled();
  });
});

describe('check_inventory', () => {
  it('reports stock for a known SKU', async () => {
    const { run, repository } = setup();
    repository.productBySku.mockResolvedValue({
      sku: 'SKU-00001',
      name: 'Loa',
      price: 500_000,
      isActive: true,
      quantity: 7,
    });
    expect(parse((await run('check_inventory', { sku: 'sku-00001' })).content)).toMatchObject({
      found: true,
      in_stock: 7,
    });
  });
});

describe('propose_action', () => {
  const cancel = { type: 'CANCEL_ORDER', order_code: 'SF-7KQ2M9XA', reason: 'Khách đổi ý' };

  it('only records a proposal and says it has not been executed', async () => {
    const { run, repository } = setup();

    const result = parse((await run('propose_action', cancel)).content);

    expect(result).toMatchObject({ proposed: true, executed: false, action_id: 'a1' });
    expect(repository.propose).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 't1', orderId: 'o1', type: 'CANCEL_ORDER' }),
    );
  });

  it("refuses orders that are not the ticket customer's (injection cannot target others)", async () => {
    const { run, repository } = setup(
      order({ customer: { id: 'someone-else', email: 'x@x', fullName: 'X' } }),
    );
    expect((await run('propose_action', cancel)).isError).toBe(true);
    expect(repository.propose).not.toHaveBeenCalled();
  });

  it('refuses orders that can no longer be cancelled', async () => {
    const { run } = setup(order({ status: OrderStatus.SHIPPED }));
    expect(parse((await run('propose_action', cancel)).content)).toMatchObject({
      error: 'NOT_CANCELLABLE',
    });
  });

  it('allows a single proposal per answer', async () => {
    const { run, repository } = setup();
    await run('propose_action', cancel);
    expect(parse((await run('propose_action', cancel)).content)).toMatchObject({
      error: 'TOO_MANY_PROPOSALS',
    });
    expect(repository.propose).toHaveBeenCalledTimes(1);
  });

  it('knows no other action type', async () => {
    const { run } = setup();
    expect((await run('propose_action', { ...cancel, type: 'REFUND' })).isError).toBe(true);
    expect((await run('delete_everything', {})).isError).toBe(true);
  });
});
