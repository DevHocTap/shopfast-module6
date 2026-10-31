import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { Roles } from '../../common/auth/decorators';
import { Role } from '../../common/auth/role.enum';
import { CacheService, CacheStats } from '../../infra/cache/cache.service';
import { DailyRevenue } from '../reports/reports.repository';
import { AdminJobsService, FailedJob, QueueStats } from './admin-jobs.service';

export class RunReportDto {
  /** YYYY-MM-DD; defaults to yesterday (Vietnam time). */
  @IsOptional()
  @IsDateString({ strict: true })
  date?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly cache: CacheService,
    private readonly jobs: AdminJobsService,
  ) {}

  /** Hit ratio across all API instances (counters live in Redis). SRS target: ≥ 80%. */
  @Get('cache/stats')
  cacheStats(): Promise<CacheStats> {
    return this.cache.stats();
  }

  /** Start a fresh measurement window, e.g. right before a load test. */
  @Delete('cache/stats')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetCacheStats(): Promise<void> {
    await this.cache.resetStats();
  }

  /** F07: waiting / active / delayed / completed / failed per queue, plus unpublished outbox events. */
  @Get('queues')
  queues(): Promise<{ queues: QueueStats[]; pendingOutboxEvents: number }> {
    return this.jobs.queueStats();
  }

  @Get('failed-jobs')
  failedJobs(): Promise<FailedJob[]> {
    return this.jobs.failedJobs();
  }

  @Post('failed-jobs/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async retry(@Param('id') id: string): Promise<{ message: string }> {
    await this.jobs.retry(id);
    return { message: 'Đã đưa tác vụ vào hàng đợi để chạy lại.' };
  }

  @Get('reports/daily-revenue')
  reports(): Promise<DailyRevenue[]> {
    return this.jobs.recentReports();
  }

  @Post('reports/daily-revenue')
  @HttpCode(HttpStatus.ACCEPTED)
  async runReport(@Body() dto: RunReportDto): Promise<{ message: string }> {
    await this.jobs.runDailyReport(dto.date);
    return { message: 'Đã yêu cầu tạo báo cáo, kết quả sẽ có sau vài giây.' };
  }
}
