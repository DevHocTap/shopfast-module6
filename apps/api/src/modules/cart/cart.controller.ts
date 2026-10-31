import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { CartService, CartView, MAX_QUANTITY_PER_LINE } from './cart.service';

export class SetCartItemDto {
  @IsInt()
  @Min(1, { message: 'Số lượng tối thiểu là 1.' })
  @Max(MAX_QUANTITY_PER_LINE, { message: `Số lượng tối đa là ${MAX_QUANTITY_PER_LINE}.` })
  quantity: number;
}

@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<CartView> {
    return this.cart.get(user.id);
  }

  @Put('items/:productId')
  setItem(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetCartItemDto,
  ): Promise<CartView> {
    return this.cart.setItem(user.id, productId, dto.quantity);
  }

  @Delete('items/:productId')
  removeItem(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<CartView> {
    return this.cart.removeItem(user.id, productId);
  }
}
