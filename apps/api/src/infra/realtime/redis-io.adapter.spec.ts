import Redis from 'ioredis';
import { withSafePublish } from './redis-io.adapter';

describe('withSafePublish', () => {
  it('turns a failed publish into a reported, resolved call', async () => {
    const failure = new Error('Connection is closed.');
    const client = { publish: jest.fn().mockRejectedValue(failure) };
    const onError = jest.fn();

    await expect(
      withSafePublish(client as unknown as Redis, onError).publish('channel', 'message'),
    ).resolves.toBe(0);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('passes successful publishes and every other member through', async () => {
    const client = {
      status: 'ready',
      publish: jest.fn().mockResolvedValue(2),
      on: jest.fn(function (this: unknown) {
        return this;
      }),
    };
    const safe = withSafePublish(client as unknown as Redis, jest.fn());

    await expect(safe.publish('channel', 'message')).resolves.toBe(2);
    expect(safe.status).toBe('ready');
    expect(safe.on('error', () => undefined)).toBe(client); // bound to the real client
  });
});
