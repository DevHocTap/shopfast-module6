import { Role } from '../../common/auth/role.enum';
import { OrderErrors } from '../orders/order.errors';
import { OrderStatus } from '../orders/order-state-machine';
import { OrdersService } from '../orders/orders.service';
import { AgentActionsService } from './agent-actions.service';
import { AssistantRepository } from './assistant.repository';
import { AgentActionStatus } from './assistant.types';

const staff = { id: 's1', email: 'cskh@shopfast.local', role: Role.SUPPORT };
const view = {
  id: 'a1',
  order: { id: 'o1', code: 'SF-7KQ2M9XA' },
  ticket: { id: 't1', code: 'TK-ABC123' },
};

function setup() {
  const repository = {
    claim: jest.fn().mockResolvedValue(true),
    action: jest.fn().mockResolvedValue(view),
    finish: jest.fn(),
    audit: jest.fn(),
    actions: jest.fn().mockResolvedValue([]),
  };
  const orders = {
    getForUser: jest.fn().mockResolvedValue({ status: OrderStatus.PAID, version: 3 }),
    changeStatusByStaff: jest.fn().mockResolvedValue({ status: OrderStatus.CANCELLED, version: 4 }),
  };
  const service = new AgentActionsService(
    repository as unknown as AssistantRepository,
    orders as unknown as OrdersService,
  );
  return { service, repository, orders };
}

describe('AgentActionsService.approve', () => {
  it('executes the cancellation as the approving staff member and audits it', async () => {
    const { service, repository, orders } = setup();

    await service.approve(staff, 'a1');

    expect(repository.claim).toHaveBeenCalledWith('a1', AgentActionStatus.APPROVED, 's1');
    expect(orders.changeStatusByStaff).toHaveBeenCalledWith(staff, 'o1', OrderStatus.CANCELLED, 3);
    expect(repository.finish).toHaveBeenCalledWith(
      'a1',
      AgentActionStatus.EXECUTED,
      expect.stringContaining('SF-7KQ2M9XA'),
    );
    expect(repository.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AI_PROPOSAL_APPROVED', actorId: 's1' }),
    );
    expect(repository.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_CANCELLED_VIA_AI_PROPOSAL',
        before: { status: OrderStatus.PAID, version: 3 },
      }),
    );
  });

  it('records FAILED with the reason when the order can no longer be cancelled', async () => {
    const { service, repository, orders } = setup();
    orders.changeStatusByStaff.mockRejectedValue(
      OrderErrors.invalidTransition(OrderStatus.SHIPPED, OrderStatus.CANCELLED),
    );

    await service.approve(staff, 'a1');

    expect(repository.finish).toHaveBeenCalledWith(
      'a1',
      AgentActionStatus.FAILED,
      expect.stringContaining('Không thể chuyển'),
    );
  });

  it('executes nothing when someone else already decided', async () => {
    const { service, repository, orders } = setup();
    repository.claim.mockResolvedValue(false);

    await expect(service.approve(staff, 'a1')).rejects.toMatchObject({
      response: { code: 'ACTION_ALREADY_REVIEWED' },
    });
    expect(orders.changeStatusByStaff).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown action', async () => {
    const { service, repository } = setup();
    repository.claim.mockResolvedValue(false);
    repository.action.mockResolvedValue(null);
    await expect(service.approve(staff, 'nope')).rejects.toMatchObject({
      response: { code: 'ACTION_NOT_FOUND' },
    });
  });
});

describe('AgentActionsService.reject', () => {
  it('closes the proposal without touching the order', async () => {
    const { service, repository, orders } = setup();

    await service.reject(staff, 'a1');

    expect(repository.claim).toHaveBeenCalledWith('a1', AgentActionStatus.REJECTED, 's1');
    expect(repository.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AI_PROPOSAL_REJECTED' }),
    );
    expect(orders.changeStatusByStaff).not.toHaveBeenCalled();
  });
});
