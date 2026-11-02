import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { AgentActionStatus } from '../assistant.types';

export class ChatDto {
  @IsUUID()
  ticketId: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 2000, { message: 'Câu hỏi cần từ 1 đến 2.000 ký tự.' })
  message: string;
}

export class ActionQueryDto {
  @IsOptional()
  @IsEnum(AgentActionStatus)
  status?: AgentActionStatus;
}
