import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/auth/auth-user';
import { AppError } from '../../common/errors/app-error';
import { OrderStatus } from '../orders/order-state-machine';
import { OrdersService } from '../orders/orders.service';
import { AssistantRepository } from './assistant.repository';
import { AgentActionStatus, AgentActionView } from './assistant.types';

export const AgentActionErrors = {
  notFound: () =>
    new AppError(HttpStatus.NOT_FOUND, 'ACTION_NOT_FOUND', 'Không tìm thấy đề xuất này.'),
  alreadyReviewed: () =>
    new AppError(
      HttpStatus.CONFLICT,
      'ACTION_ALREADY_REVIEWED',
      'Đề xuất này đã được người khác duyệt hoặc từ chối.',
    ),
};

/**
 * Human-in-the-loop for AI proposals (F01.4). The action runs only here, under the identity of
 * the staff member who approved it, through the same OrdersService rules as a manual change,
 * and every decision lands in audit_logs.
 */
@Injectable()
export class AgentActionsService {
  constructor(
    private readonly repository: AssistantRepository,
    private readonly orders: OrdersService,
  ) {}

  list(status?: AgentActionStatus): Promise<AgentActionView[]> {
    return this.repository.actions({ status });
  }

  async approve(staff: AuthUser, id: string): Promise<AgentActionView> {
    await this.claim(staff, id, AgentActionStatus.APPROVED);
    const action = (await this.repository.action(id))!;

    try {
      const current = await this.orders.getForUser(staff, action.order.id);
      const cancelled = await this.orders.changeStatusByStaff(
        staff,
        action.order.id,
        OrderStatus.CANCELLED,
        current.version,
      );
      const result = `Đã huỷ đơn ${action.order.code} theo đề xuất của trợ lý AI.`;
      await this.repository.finish(id, AgentActionStatus.EXECUTED, result);
      await this.repository.audit({
        actorId: staff.id,
        action: 'ORDER_CANCELLED_VIA_AI_PROPOSAL',
        entity: 'order',
        entityId: action.order.id,
        before: { status: current.status, version: current.version },
        after: { status: cancelled.status, version: cancelled.version, agentActionId: id },
      });
    } catch (error) {
      // The order moved on meanwhile (shipped, already cancelled…): record why, do not retry.
      const reason = error instanceof AppError ? error.message : 'Lỗi không xác định';
      await this.repository.finish(id, AgentActionStatus.FAILED, reason);
      await this.repository.audit({
        actorId: staff.id,
        action: 'AI_PROPOSAL_FAILED',
        entity: 'agent_action',
        entityId: id,
        after: { reason },
      });
    }
    return (await this.repository.action(id))!;
  }

  async reject(staff: AuthUser, id: string): Promise<AgentActionView> {
    await this.claim(staff, id, AgentActionStatus.REJECTED);
    return (await this.repository.action(id))!;
  }

  private async claim(
    staff: AuthUser,
    id: string,
    to: AgentActionStatus.APPROVED | AgentActionStatus.REJECTED,
  ): Promise<void> {
    if (!(await this.repository.claim(id, to, staff.id))) {
      throw (await this.repository.action(id))
        ? AgentActionErrors.alreadyReviewed()
        : AgentActionErrors.notFound();
    }
    await this.repository.audit({
      actorId: staff.id,
      action: to === AgentActionStatus.APPROVED ? 'AI_PROPOSAL_APPROVED' : 'AI_PROPOSAL_REJECTED',
      entity: 'agent_action',
      entityId: id,
      before: { status: AgentActionStatus.PROPOSED },
      after: { status: to },
    });
  }
}
