import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { config } from '../config.js';

export interface MailMessage {
  to: string | string[];
  /** Display name for the sender; the address is MAIL_FROM_ADDRESS. */
  fromName: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends email over SMTP (Mailpit locally; any SMTP service in production, open issue S15). */
@Injectable()
export class MailService implements OnApplicationShutdown {
  private readonly logger = new Logger(MailService.name);
  private readonly transport = nodemailer.createTransport({
    host: config.mail.smtpHost,
    port: config.mail.smtpPort,
    secure: config.mail.smtpSecure,
    ...(config.mail.smtpUser ? { auth: { user: config.mail.smtpUser, pass: config.mail.smtpPassword } } : {}),
  });

  async send(message: MailMessage): Promise<void> {
    const info = await this.transport.sendMail({
      from: { name: message.fromName, address: config.mail.fromAddress },
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    this.logger.log(`Sent "${message.subject}" (${info.messageId})`);
  }

  onApplicationShutdown() {
    this.transport.close();
  }
}
