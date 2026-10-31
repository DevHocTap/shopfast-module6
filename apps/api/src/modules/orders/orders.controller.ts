import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { Role } from '../../common/auth/role.enum';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { Paginated, PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ChangeOrderStatusDto, PlaceOrderDto, StaffOrderQueryDto } from './dto/orders.dto';
import { OrderDetail, OrderSummary } from './orders.repository';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** 201 for a new order; 200 + `Idempotent-Replayed: true` when the key was already used. */
  @Post()
  @RateLimit('promoOrder')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–64 ký tự, ví dụ UUID' })
  async place(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PlaceOrderDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDetail> {
    const { order, replayed } = await this.orders.placeOrder(user, idempotencyKey, dto.voucherCode);
    if (replayed) {
      res.status(HttpStatus.OK).setHeader('Idempotent-Replayed', 'true');
    }
    return order;
  }

  @Get()
  mine(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<OrderSummary>> {
    return this.orders.listMine(user, query.page, query.limit);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OrderDetail> {
    return this.orders.getForUser(user, id);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OrderDetail> {
    return this.orders.pay(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDetail> {
    return this.orders.cancelByCustomer(user, id);
  }
}

@ApiTags('warehouse')
@ApiBearerAuth()
@Roles(Role.WAREHOUSE, Role.ADMIN)
@Controller('warehouse/orders')
export class WarehouseOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: StaffOrderQueryDto): Promise<Paginated<OrderSummary>> {
    return this.orders.listForStaff(query.status, query.page, query.limit);
  }

  @Patch(':id/status')
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeOrderStatusDto,
  ): Promise<OrderDetail> {
    return this.orders.changeStatusByStaff(user, id, dto.status, dto.version);
  }
}
