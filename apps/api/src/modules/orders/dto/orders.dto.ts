import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
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

export class PlaceOrderDto {
  /** Optional promotional code; a stricter rate limit applies when it is present. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || undefined : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9]{3,32}$/, { message: 'Mã giảm giá không hợp lệ.' })
  voucherCode?: string;
}
