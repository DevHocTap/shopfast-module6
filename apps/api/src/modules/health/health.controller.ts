import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { Response } from 'express';
import { HealthService, LivenessReport, ReadinessReport } from './health.service';

/** Public: probed by Docker healthchecks, the deploy pipeline and external uptime monitors. */
@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({
    summary: 'Process is running (container healthcheck). Returns the deployed version.',
  })
  live(): LivenessReport {
    return this.healthService.liveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Dependency status. 200 when ok/degraded, 503 when the database is unreachable.',
  })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const report = await this.healthService.readiness();
    res.setHeader('Cache-Control', 'no-store');
    if (report.status === 'down') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
