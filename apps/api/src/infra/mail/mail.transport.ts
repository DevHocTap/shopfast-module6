import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<{ messageId?: string }>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Default: nothing leaves the server; the message is logged (and kept in memory for tests). */
export class LogMailTransport implements MailTransport {
  readonly name = 'log';
  readonly sent: MailMessage[] = [];
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<{ messageId?: string }> {
    this.sent.push(message);
    this.logger.log(`[mail:log] to=${message.to} subject="${message.subject}"`);
    return Promise.resolve({ messageId: `log-${this.sent.length}` });
  }
}

/** Mailpit in development (http://localhost:8025), or any SMTP provider in production. */
export class SmtpMailTransport implements MailTransport {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(
    private readonly from: string,
    options: { host: string; port: number; secure: boolean; user?: string; password?: string },
  ) {
    this.transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.user ? { user: options.user, pass: options.password } : undefined,
    });
  }

  async send(message: MailMessage): Promise<{ messageId?: string }> {
    const info = (await this.transporter.sendMail({ from: this.from, ...message })) as {
      messageId?: string;
    };
    return { messageId: info.messageId };
  }
}

/** AWS SES with the instance role: no SMTP password to store. */
export class SesMailTransport implements MailTransport {
  readonly name = 'ses';
  private readonly client: SESv2Client;

  constructor(
    private readonly from: string,
    region: string,
  ) {
    this.client = new SESv2Client({ region });
  }

  async send(message: MailMessage): Promise<{ messageId?: string }> {
    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
    return { messageId: result.MessageId };
  }
}
