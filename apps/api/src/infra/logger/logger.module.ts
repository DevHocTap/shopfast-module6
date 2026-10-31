import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../config/config.module';

const REQUEST_ID_HEADER = 'x-request-id';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) => {
        const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';
        const version: string = config.get('APP_VERSION', { infer: true });
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            base: { version },
            genReqId: (req: IncomingMessage) => {
              const incoming = req.headers[REQUEST_ID_HEADER];
              return typeof incoming === 'string' && incoming.length <= 64
                ? incoming
                : randomUUID();
            },
            // Never log credentials or session material.
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            autoLogging: {
              ignore: (req: IncomingMessage) => req.url?.startsWith('/api/health') ?? false,
            },
            transport: isProduction
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
                },
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
