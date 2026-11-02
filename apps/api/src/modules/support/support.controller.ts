import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { Role } from '../../common/auth/role.enum';
import { Paginated, PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  CreateTicketDto,
  StaffTicketQueryDto,
  TicketMessageDto,
  UpdateTicketDto,
} from './dto/support.dto';
import { SupportService } from './support.service';
import { TicketDetail, TicketSummary } from './support.types';

/** Customers: open a request, follow it, reply. Staff may read and reply here too. */
@ApiTags('support')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Roles(Role.CUSTOMER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto): Promise<TicketDetail> {
    return this.support.create(user, dto);
  }

  @Get()
  mine(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<TicketSummary>> {
    return this.support.listMine(user, query.page, query.limit);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketDetail> {
    return this.support.get(user, id);
  }

  @Post(':id/messages')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TicketMessageDto,
  ): Promise<TicketDetail> {
    return this.support.reply(user, id, dto.body);
  }
}

/** Support queue: filter by AI category and status, override the category, close. */
@ApiTags('support')
@ApiBearerAuth()
@Roles(Role.SUPPORT, Role.ADMIN)
@Controller('support/tickets')
export class StaffTicketsController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Query() query: StaffTicketQueryDto): Promise<Paginated<TicketSummary>> {
    return this.support.listForStaff(
      { category: query.category, status: query.status },
      query.page,
      query.limit,
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ): Promise<TicketDetail> {
    return this.support.updateByStaff(user, id, dto);
  }
}
