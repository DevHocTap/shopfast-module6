import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Env } from '../../infra/config/env.schema';
import { AuthUser } from '../auth/auth-user';
import { AppError } from '../errors/app-error';
import { CounterStore } from './counter-store';
import { PolicyName, POLICIES, RateLimitSubject } from './policies';
import { RATE_LIMIT_KEY, SKIP_RATE_LIMIT_KEY } from './rate-limit.decorator';

/**
 * Global guard, registered after JwtAuthGuard so it knows who the caller is.
 * Endpoint-specific policies are checked first (their message is the relevant one), then `default`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly enabled: boolean;

  constructor(
    private readonly counters: CounterStore,
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('RATE_LIMIT_ENABLED', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.enabled || context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, targets)) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AuthUser }>();
    const response = http.getResponse<Response>();
    const extra = this.reflector.getAllAndOverride<PolicyName[]>(RATE_LIMIT_KEY, targets) ?? [];
    const subject = subjectOf(request);

    for (const name of [...extra, 'default' as const]) {
      const policy = POLICIES[name];
      const identity = policy.key(subject);
      if (identity === null) continue;

      const { count, resetMs } = await this.counters.hit(`rl:${name}:${identity}`, policy.windowMs);
      const retryAfter = Math.max(1, Math.ceil(resetMs / 1000));
      if (name === 'default') {
        response.setHeader('RateLimit-Limit', policy.limit);
        response.setHeader('RateLimit-Remaining', Math.max(0, policy.limit - count));
        response.setHeader('RateLimit-Reset', retryAfter);
      }
      if (count > policy.limit) {
        response.setHeader('Retry-After', retryAfter);
        throw new AppError(
          HttpStatus.TOO_MANY_REQUESTS,
          'TOO_MANY_REQUESTS',
          `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${formatWait(retryAfter)}.`,
          { policy: name, retryAfter },
        );
      }
    }
    return true;
  }
}

function subjectOf(request: Request & { user?: AuthUser }): RateLimitSubject {
  const body = (request.body ?? {}) as { email?: unknown; voucherCode?: unknown };
  return {
    // `trust proxy` = 1: req.ip is the address Nginx saw, not a client-supplied header.
    ip: request.ip ?? 'unknown',
    userId: request.user?.id,
    email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined,
    voucherCode:
      typeof body.voucherCode === 'string' && body.voucherCode ? body.voucherCode : undefined,
  };
}

export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  return `${Math.ceil(minutes / 60)} giờ`;
}
