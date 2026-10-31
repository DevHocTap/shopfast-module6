import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../config/config.module';
import {
  LogMailTransport,
  MAIL_TRANSPORT,
  MailTransport,
  SesMailTransport,
  SmtpMailTransport,
} from './mail.transport';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: AppConfigService): MailTransport => {
        const from = config.get('MAIL_FROM', { infer: true });
        switch (config.get('MAIL_TRANSPORT', { infer: true })) {
          case 'smtp':
            return new SmtpMailTransport(from, {
              host: config.get('SMTP_HOST', { infer: true }),
              port: config.get('SMTP_PORT', { infer: true }),
              secure: config.get('SMTP_SECURE', { infer: true }),
              user: config.get('SMTP_USER', { infer: true }),
              password: config.get('SMTP_PASSWORD', { infer: true }),
            });
          case 'ses':
            return new SesMailTransport(from, config.get('AWS_REGION', { infer: true }));
          default:
            return new LogMailTransport();
        }
      },
    },
  ],
  exports: [MAIL_TRANSPORT],
})
export class MailModule {}
