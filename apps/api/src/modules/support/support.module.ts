import { Module } from '@nestjs/common';
import { StaffTicketsController, TicketsController } from './support.controller';
import { SupportRepository } from './support.repository';
import { SupportService } from './support.service';

@Module({
  controllers: [TicketsController, StaffTicketsController],
  providers: [SupportService, SupportRepository],
  exports: [SupportRepository],
})
export class SupportModule {}
