import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { CounterStore } from './counter-store';
import { formatWait } from './rate-limit.guard';

const MINUTE = 60_000;
const FAILURE_WINDOW_MS = 24 * 60 * MINUTE;

/** Escalating lock, checked from the highest tier down: every 5 more failures lock longer. */
export const LOCK_TIERS: readonly { failures: number; lockMs: number }[] = [
  { failures: 20, lockMs: 24 * 60 * MINUTE },
  { failures: 15, lockMs: 30 * MINUTE },
  { failures: 10, lockMs: 5 * MINUTE },
  { failures: 5, lockMs: 1 * MINUTE },
];

export function lockDurationFor(failures: number): number | null {
  if (failures === 0 || failures % 5 !== 0) return null;
  return LOCK_TIERS.find((tier) => failures >= tier.failures)?.lockMs ?? null;
}

/**
 * Brute-force protection counted per TARGET ACCOUNT, not per IP: an attacker rotating IPs
 * (botnet, proxies) still hits the same counter. Unknown emails are counted too, so the lock
 * does not reveal which accounts exist.
 */
@Injectable()
export class LoginAttempts {
  constructor(private readonly counters: CounterStore) {}

  async assertNotLocked(email: string): Promise<void> {
    const remainingMs = await this.counters.ttl(lockKey(email));
    if (remainingMs > 0) {
      const retryAfter = Math.ceil(remainingMs / 1000);
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'ACCOUNT_TEMPORARILY_LOCKED',
        `Tài khoản tạm khoá do đăng nhập sai nhiều lần. Vui lòng thử lại sau ${formatWait(retryAfter)}.`,
        { retryAfter },
      );
    }
  }

  async recordFailure(email: string): Promise<void> {
    const { count } = await this.counters.hit(failureKey(email), FAILURE_WINDOW_MS);
    const lockMs = lockDurationFor(count);
    if (lockMs) await this.counters.setFlag(lockKey(email), lockMs);
  }

  async recordSuccess(email: string): Promise<void> {
    await this.counters.delete(failureKey(email));
  }
}

const normalize = (email: string) => email.trim().toLowerCase();
const failureKey = (email: string) => `login:fail:${normalize(email)}`;
const lockKey = (email: string) => `login:lock:${normalize(email)}`;
