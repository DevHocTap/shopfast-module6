import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Env } from '../../infra/config/env.schema';
import { resilientFake } from '../../infra/redis/testing/fake-redis';
import { CounterStore } from './counter-store';
import { lockDurationFor, LoginAttempts } from './login-attempts.service';
import { POLICIES } from './policies';
import { RATE_LIMIT_KEY, SKIP_RATE_LIMIT_KEY } from './rate-limit.decorator';
import { formatWait, RateLimitGuard } from './rate-limit.guard';

function context(request: Record<string, unknown>, response: Record<string, unknown>) {
  return {
    getType: () => 'http',
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

function setup(metadata: Record<string, unknown> = {}, enabled = true) {
  const { fake, resilient, control } = resilientFake();
  const counters = new CounterStore(resilient);
  const reflector = { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
  const config = { get: () => enabled } as unknown as ConfigService<Env, true>;
  const guard = new RateLimitGuard(counters, reflector, config);
  const headers: Record<string, unknown> = {};
  const response = { setHeader: (k: string, v: unknown) => (headers[k] = v) };
  return { guard, counters, fake, control, headers, response };
}

async function hitTimes(guard: RateLimitGuard, ctx: ExecutionContext, times: number) {
  for (let i = 0; i < times; i++) await guard.canActivate(ctx);
}

describe('RateLimitGuard', () => {
  it('counts guests per IP and answers 429 with Retry-After and a Vietnamese message', async () => {
    const { guard, headers, response } = setup();
    const ctx = context({ ip: '1.2.3.4', body: {} }, response);
    await hitTimes(guard, ctx, POLICIES.default.limit);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 429,
      response: {
        code: 'TOO_MANY_REQUESTS',
        message: expect.stringContaining('Vui lòng thử lại sau'),
      },
    });
    expect(headers['Retry-After']).toBe(60);
    expect(headers['RateLimit-Remaining']).toBe(0);
  });

  it('counts signed-in users per account, not per shared IP', async () => {
    const { guard, response } = setup();
    const alice = context({ ip: '10.0.0.1', user: { id: 'alice' }, body: {} }, response);
    const bob = context({ ip: '10.0.0.1', user: { id: 'bob' }, body: {} }, response);
    await hitTimes(guard, alice, POLICIES.default.limit);

    await expect(guard.canActivate(bob)).resolves.toBe(true);
    await expect(guard.canActivate(alice)).rejects.toMatchObject({ status: 429 });
  });

  it('applies a stricter endpoint policy before the default one', async () => {
    const { guard, response } = setup({ [RATE_LIMIT_KEY]: ['login'] });
    const ctx = context({ ip: '5.5.5.5', body: {} }, response);
    await hitTimes(guard, ctx, POLICIES.login.limit);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { details: { policy: 'login' } },
    });
  });

  it('limits OTP per target email even when the sender changes IP', async () => {
    const { guard, response } = setup({ [RATE_LIMIT_KEY]: ['otpPerTarget'] });
    await guard.canActivate(context({ ip: '1.1.1.1', body: { email: 'Victim@x.vn' } }, response));

    await expect(
      guard.canActivate(context({ ip: '2.2.2.2', body: { email: 'victim@x.vn' } }, response)),
    ).rejects.toMatchObject({ response: { details: { policy: 'otpPerTarget' } } });
  });

  it('counts promo orders only when a voucher is used', async () => {
    const { guard, response } = setup({ [RATE_LIMIT_KEY]: ['promoOrder'] });
    const plain = context({ ip: 'x', user: { id: 'u' }, body: {} }, response);
    const promo = context(
      { ip: 'x', user: { id: 'u' }, body: { voucherCode: 'FLASH50' } },
      response,
    );
    await hitTimes(guard, plain, 10);
    await hitTimes(guard, promo, POLICIES.promoOrder.limit);

    await expect(guard.canActivate(promo)).rejects.toMatchObject({
      response: { details: { policy: 'promoOrder' } },
    });
  });

  it('keeps limiting with in-process counters when Redis is down', async () => {
    const { guard, control, response } = setup({ [RATE_LIMIT_KEY]: ['login'] });
    control.down = true;
    const ctx = context({ ip: '9.9.9.9', body: {} }, response);
    await hitTimes(guard, ctx, POLICIES.login.limit);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 429 });
  });

  it('can be skipped (health checks) or disabled (load tests)', async () => {
    const skipped = setup({ [SKIP_RATE_LIMIT_KEY]: true });
    const disabled = setup({}, false);
    const ctx = context({ ip: 'h', body: {} }, skipped.response);
    await hitTimes(skipped.guard, ctx, 500);
    await hitTimes(disabled.guard, ctx, 500);

    expect(skipped.fake.eval).not.toHaveBeenCalled();
    expect(disabled.fake.eval).not.toHaveBeenCalled();
  });
});

describe('LoginAttempts', () => {
  it('locks for longer after every 5 failures', () => {
    expect([1, 4, 6].map(lockDurationFor)).toEqual([null, null, null]);
    expect(lockDurationFor(5)).toBe(60_000);
    expect(lockDurationFor(10)).toBe(5 * 60_000);
    expect(lockDurationFor(15)).toBe(30 * 60_000);
    expect(lockDurationFor(20)).toBe(24 * 60 * 60_000);
    expect(lockDurationFor(25)).toBe(24 * 60 * 60_000);
  });

  it('locks the target account after 5 failures and clears the count on success', async () => {
    const { counters } = setup();
    const attempts = new LoginAttempts(counters);
    for (let i = 0; i < 4; i++) await attempts.recordFailure('An@Example.com');
    await expect(attempts.assertNotLocked('an@example.com')).resolves.toBeUndefined();

    await attempts.recordFailure('an@example.com');
    await expect(attempts.assertNotLocked('AN@example.com')).rejects.toMatchObject({
      status: 429,
      response: { code: 'ACCOUNT_TEMPORARILY_LOCKED', details: { retryAfter: 60 } },
    });

    const other = new LoginAttempts(counters);
    await other.recordSuccess('someone@else.vn');
    await expect(other.assertNotLocked('someone@else.vn')).resolves.toBeUndefined();
  });

  it('still locks with Redis down (memory fallback)', async () => {
    const { counters, control } = setup();
    control.down = true;
    const attempts = new LoginAttempts(counters);
    for (let i = 0; i < 5; i++) await attempts.recordFailure('x@y.vn');

    await expect(attempts.assertNotLocked('x@y.vn')).rejects.toMatchObject({ status: 429 });
  });
});

describe('formatWait', () => {
  it('speaks in seconds, minutes or hours', () => {
    expect(formatWait(42)).toBe('42 giây');
    expect(formatWait(61)).toBe('2 phút');
    expect(formatWait(7200)).toBe('2 giờ');
  });
});
