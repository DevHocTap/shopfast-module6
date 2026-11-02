import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { TicketCategory, TicketStatus } from '../support.types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTicketDto {
  @Transform(trim)
  @IsString()
  @Length(3, 200, { message: 'Tiêu đề cần từ 3 đến 200 ký tự.' })
  subject: string;

  @Transform(trim)
  @IsString()
  @Length(1, 4000, { message: 'Nội dung cần từ 1 đến 4.000 ký tự.' })
  message: string;

  /** Optional: the order this request is about (must belong to the customer). */
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class TicketMessageDto {
  @Transform(trim)
  @IsString()
  @Length(1, 4000, { message: 'Nội dung cần từ 1 đến 4.000 ký tự.' })
  body: string;
}

export class StaffTicketQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;
}

export class UpdateTicketDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  /** Manual override of the AI classification. */
  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;
}
