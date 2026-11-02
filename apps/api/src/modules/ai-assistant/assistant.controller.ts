import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { Role } from '../../common/auth/role.enum';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AgentActionsService } from './agent-actions.service';
import { AssistantService } from './assistant.service';
import { AgentActionView, ChatResult, Conversation } from './assistant.types';
import { ActionQueryDto, ChatDto } from './dto/assistant.dto';

/** Support staff only: customers never talk to the model directly. */
@ApiTags('assistant')
@ApiBearerAuth()
@Roles(Role.SUPPORT, Role.ADMIN)
@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly actions: AgentActionsService,
  ) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @RateLimit('ai')
  chat(@CurrentUser() user: AuthUser, @Body() dto: ChatDto): Promise<ChatResult> {
    return this.assistant.chat(user, dto.ticketId, dto.message);
  }

  @Get('tickets/:ticketId/conversation')
  conversation(
    @CurrentUser() user: AuthUser,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<Conversation> {
    return this.assistant.conversation(user, ticketId);
  }

  @Get('actions')
  list(@Query() query: ActionQueryDto): Promise<AgentActionView[]> {
    return this.actions.list(query.status);
  }

  @Post('actions/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentActionView> {
    return this.actions.approve(user, id);
  }

  @Post('actions/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentActionView> {
    return this.actions.reject(user, id);
  }
}
