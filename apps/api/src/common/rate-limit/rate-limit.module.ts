import { Global, Module } from '@nestjs/common';
import { CounterStore } from './counter-store';
import { LoginAttempts } from './login-attempts.service';
import { RateLimitGuard } from './rate-limit.guard';

/** The guard itself is registered as APP_GUARD in AuthModule, right after JwtAuthGuard. */
@Global()
@Module({
  providers: [CounterStore, LoginAttempts, RateLimitGuard],
  exports: [CounterStore, LoginAttempts, RateLimitGuard],
})
export class RateLimitModule {}
