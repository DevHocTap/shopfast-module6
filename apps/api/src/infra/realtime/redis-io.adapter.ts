import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO server whose broadcasts travel through Redis pub/sub, so an event emitted by one api
 * instance reaches sockets held by the other one (both run side by side during blue/green).
 *
 * Redis stays optional: when it is down, publishing fails silently and every instance still
 * delivers to its own sockets (realtime keeps working on a single instance; REST is the truth).
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private readonly connections: Redis[] = [];
  private lastWarnAt = 0;

  constructor(
    app: INestApplicationContext,
    private readonly redis: Redis,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;

    // Publisher: fail fast like every other Redis use in the request path.
    const pub = this.redis.duplicate({ connectionName: 'shopfast-ws-pub' });
    // Subscriber: queue SUBSCRIBE until Redis is reachable and never reject it; ioredis
    // re-subscribes by itself after a reconnect.
    const sub = this.redis.duplicate({
      connectionName: 'shopfast-ws-sub',
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
    });
    for (const client of [pub, sub]) client.on('error', () => undefined); // logged by RedisModule
    this.connections.push(pub, sub);

    server.adapter(
      createAdapter(
        withSafePublish(pub, (error) => this.warn(error)),
        sub,
      ),
    );
    return server;
  }

  override async dispose(): Promise<void> {
    await super.dispose();
    await Promise.all(
      this.connections.map((client) => client.quit().catch(() => client.disconnect())),
    );
  }

  private warn(error: Error): void {
    if (Date.now() - this.lastWarnAt < 10_000) return;
    this.lastWarnAt = Date.now();
    this.logger.warn(`Realtime broadcast limited to this instance (Redis: ${error.message})`);
  }
}

/**
 * The adapter calls `publish()` without handling the returned promise; with Redis down that
 * would be an unhandled rejection, which terminates a Node 20 process.
 */
export function withSafePublish(client: Redis, onError: (error: Error) => void): Redis {
  return new Proxy(client, {
    get(target, property) {
      if (property === 'publish') {
        return (channel: string | Buffer, message: string | Buffer) =>
          target.publish(channel, message).catch((error: Error) => {
            onError(error);
            return 0;
          });
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  });
}
