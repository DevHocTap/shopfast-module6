import { Module } from '@nestjs/common';
import { ReportsRepository } from '../reports/reports.repository';
import { AdminJobsService } from './admin-jobs.service';
import { AdminController } from './admin.controller';

@Module({
  controllers: [AdminController],
  providers: [AdminJobsService, ReportsRepository],
})
export class AdminModule {}
