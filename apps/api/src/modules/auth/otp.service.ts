import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import { CounterStore } from '../../common/rate-limit/counter-store';
import { Env } from '../../infra/config/env.schema';
import { Queue } from 'bullmq';
import { jobId, QUEUES } from '../../infra/queue/queue.constants';
import { ResilientRedis, UNAVAILABLE } from '../../infra/redis/resilient-redis';

const OTP_TTL_SECONDS = 300;
const MAX_VERIFY_ATTEMPTS = 5;

/**
 * One-time codes for verifying an email (later: password reset).
 * The code is stored hashed, expires after 5 minutes and allows 5 guesses.
 * Sending is rate-limited by the `otp*` policies on the controller.
 * The code is emailed by the worker (email queue); development also logs it.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly isProduction: boolean;

  constructor(
    private readonly redis: ResilientRedis,
    private readonly counters: CounterStore,
    @InjectQueue(QUEUES.email) private readonly emailQueue: Queue,
    config: ConfigService<Env, true>,
  ) {
    this.isProduction = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  async send(email: string): Promise<void> {
    const target = email.trim().toLowerCase();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const stored = await this.redis.run((r) =>
      r
        .multi()
        .set(otpKey(target), hash(code), 'EX', OTP_TTL_SECONDS)
        .del(attemptsKey(target))
        .exec(),
    );
    if (stored === UNAVAILABLE) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'OTP_UNAVAILABLE',
        'Chưa gửi được mã xác thực lúc này. Vui lòng thử lại sau ít phút.',
      );
    }
    const issuedAt = Date.now();
    try {
      await this.emailQueue.add(
        'otp',
        { email: target, code, issuedAt },
        { jobId: jobId('otp', target, issuedAt) },
      );
    } catch {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'OTP_UNAVAILABLE',
        'Chưa gửi được mã xác thực lúc này. Vui lòng thử lại sau ít phút.',
      );
    }
    if (!this.isProduction) this.logger.debug(`OTP for ${target}: ${code} (development only)`);
  }

  async verify(email: string, code: string): Promise<void> {
    const target = email.trim().toLowerCase();
    const { count } = await this.counters.hit(attemptsKey(target), OTP_TTL_SECONDS * 1000);
    if (count > MAX_VERIFY_ATTEMPTS) {
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'OTP_TOO_MANY_ATTEMPTS',
        'Bạn đã nhập sai quá nhiều lần. Vui lòng yêu cầu mã mới.',
      );
    }
    const expected = await this.redis.run((r) => r.get(otpKey(target)));
    const actual = Buffer.from(hash(code));
    const valid =
      typeof expected === 'string' &&
      expected.length === actual.length &&
      timingSafeEqual(Buffer.from(expected), actual);
    if (!valid) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID',
        'Mã xác thực không đúng hoặc đã hết hạn.',
      );
    }
    await this.redis.run((r) => r.del(otpKey(target), attemptsKey(target)));
  }
}

const otpKey = (email: string) => `otp:${email}`;
const attemptsKey = (email: string) => `otp:attempts:${email}`;
const hash = (code: string) => createHash('sha256').update(code).digest('hex');
