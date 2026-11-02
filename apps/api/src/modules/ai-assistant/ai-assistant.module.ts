import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { SupportModule } from '../support/support.module';
import { AgentActionsService } from './agent-actions.service';
import { AssistantController } from './assistant.controller';
import { AssistantRepository } from './assistant.repository';
import { AssistantService } from './assistant.service';

@Module({
  imports: [SupportModule, OrdersModule],
  controllers: [AssistantController],
  providers: [AssistantService, AgentActionsService, AssistantRepository],
})
export class AiAssistantModule {}
