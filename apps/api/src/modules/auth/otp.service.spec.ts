import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { CounterStore } from '../../common/rate-limit/counter-store';
import { Env } from '../../infra/config/env.schema';
import { FakeRedis, resilientFake } from '../../infra/redis/testing/fake-redis';
import { OtpService } from './otp.service';

/** FakeRedis has no MULTI: emulate it with the same semantics as the pipeline used by send(). */
function withMulti(fake: FakeRedis) {
  const multi = () => {
    const ops: (() => Promise<unknown>)[] = [];
    const chain = {
      set: (...args: Parameters<FakeRedis['set']>) => (ops.push(() => fake.set(...args)), chain),
      del: (...keys: string[]) => (ops.push(() => fake.del(...keys)), chain),
      exec: () => Promise.all(ops.map((op) => op())),
    };
    return chain;
  };
  return Object.assign(fake, { multi });
}

function setup() {
  const { fake, resilient, control } = resilientFake(withMulti(new FakeRedis()));
  const config = { get: () => 'test' } as unknown as ConfigService<Env, true>;
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const service = new OtpService(
    resilient,
    new CounterStore(resilient),
    queue as unknown as Queue,
    config,
  );
  const storedCodeFor = (email: string) => fake.store.get(`otp:${email}`)?.value;
  return { service, fake, control, storedCodeFor, queue };
}

/** Recover the code from the debug log (development behaviour) to verify like a user would. */
function captureCode(service: OtpService): Promise<string> {
  return new Promise((resolve) => {
    const logger = (service as unknown as { logger: { debug: (m: string) => void } }).logger;
    logger.debug = (message: string) => resolve(/(\d{6})/.exec(message)![1]);
  });
}

describe('OtpService', () => {
  it('stores only a hash of the 6-digit code, with an expiry', async () => {
    const { service, fake, storedCodeFor } = setup();
    const code = captureCode(service);

    await service.send(' Me@Example.com ');

    expect(storedCodeFor('me@example.com')).toHaveLength(64);
    expect(storedCodeFor('me@example.com')).not.toContain(await code);
    expect(fake.store.get('otp:me@example.com')?.expiresAt).toBe(300_000);
  });

  it('hands the code to the email queue (the worker sends it)', async () => {
    const { service, queue } = setup();

    await service.send('me@example.com');

    expect(queue.add).toHaveBeenCalledWith(
      'otp',
      expect.objectContaining({ email: 'me@example.com', code: expect.stringMatching(/^\d{6}$/) }),
      expect.objectContaining({ jobId: expect.stringMatching(/^otp-me@example\.com-\d+$/) }),
    );
  });

  it('reports clearly when the queue cannot take the email', async () => {
    const { service, queue } = setup();
    queue.add.mockRejectedValue(new Error('Redis down'));

    await expect(service.send('me@example.com')).rejects.toMatchObject({
      response: { code: 'OTP_UNAVAILABLE' },
    });
  });

  it('accepts the right code once', async () => {
    const { service } = setup();
    const code = captureCode(service);
    await service.send('me@example.com');

    await expect(service.verify('me@example.com', await code)).resolves.toBeUndefined();
    await expect(service.verify('me@example.com', await code)).rejects.toMatchObject({
      response: { code: 'OTP_INVALID' },
    });
  });

  it('stops guessing after 5 wrong attempts', async () => {
    const { service } = setup();
    await service.send('me@example.com');
    for (let i = 0; i < 5; i++) {
      await expect(service.verify('me@example.com', '000000')).rejects.toMatchObject({
        response: { code: 'OTP_INVALID' },
      });
    }

    await expect(service.verify('me@example.com', '000000')).rejects.toMatchObject({
      response: { code: 'OTP_TOO_MANY_ATTEMPTS' },
    });
  });

  it('reports clearly when codes cannot be issued (Redis down)', async () => {
    const { service, control } = setup();
    control.down = true;

    await expect(service.send('me@example.com')).rejects.toMatchObject({
      status: 503,
      response: { code: 'OTP_UNAVAILABLE' },
    });
  });
});
