import { Controller, Delete, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth/decorators';
import { Role } from '../../common/auth/role.enum';
import { CacheService, CacheStats } from '../../infra/cache/cache.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly cache: CacheService) {}

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
}
