import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { OrderStatus, WAREHOUSE_TARGETS } from '../order-state-machine';

export class ChangeOrderStatusDto {
  @IsIn(WAREHOUSE_TARGETS, { message: 'Trạng thái không hợp lệ cho thao tác của kho.' })
  status: OrderStatus;

  /** Version the operator saw; protects against overwriting a concurrent change. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}

export class StaffOrderQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}
