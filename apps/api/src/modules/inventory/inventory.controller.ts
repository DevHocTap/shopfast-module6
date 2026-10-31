import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { Role } from '../../common/auth/role.enum';
import { StockLevel } from './inventory.repository';
import { InventoryService } from './inventory.service';

export class SetQuantityDto {
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quantity: number;
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Roles(Role.WAREHOUSE, Role.SUPPORT, Role.ADMIN)
  @Get(':sku')
  bySku(@Param('sku') sku: string): Promise<StockLevel> {
    return this.inventory.getBySku(sku);
  }

  @Roles(Role.WAREHOUSE, Role.ADMIN)
  @Put(':productId')
  setQuantity(
    @CurrentUser() user: AuthUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetQuantityDto,
  ): Promise<StockLevel> {
    return this.inventory.setQuantity(user, productId, dto.quantity);
  }
}
