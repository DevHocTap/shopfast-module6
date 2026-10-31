import { canTransition, nextStatuses, OrderStatus } from './order-state-machine';

const S = OrderStatus;

describe('order state machine', () => {
  it.each([
    [S.PENDING_PAYMENT, S.PAID],
    [S.PENDING_PAYMENT, S.CANCELLED],
    [S.PAID, S.PACKING],
    [S.PAID, S.CANCELLED],
    [S.PACKING, S.SHIPPED],
    [S.PACKING, S.CANCELLED],
    [S.SHIPPED, S.DELIVERED],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [S.PENDING_PAYMENT, S.SHIPPED], // cannot ship unpaid goods
    [S.PAID, S.DELIVERED], // cannot skip packing and shipping
    [S.SHIPPED, S.CANCELLED], // already left the warehouse
    [S.SHIPPED, S.PACKING], // no going back
    [S.DELIVERED, S.CANCELLED],
    [S.CANCELLED, S.PAID],
  ])('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('has terminal states with no way out', () => {
    expect(nextStatuses(S.DELIVERED)).toEqual([]);
    expect(nextStatuses(S.CANCELLED)).toEqual([]);
  });
});
