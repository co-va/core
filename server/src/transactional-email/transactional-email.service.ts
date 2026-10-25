import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

type TransactionalEmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

type TransactionalEmailInput = {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  tag?: string;
  attachments?: TransactionalEmailAttachment[];
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message || '');
  return String(error || '');
}

@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger(TransactionalEmailService.name);

  configurationStatus() {
    const provider = String(process.env.TRANSACTIONAL_EMAIL_PROVIDER || 'yandex-postbox').trim().toLowerCase();
    const apiKeyIdConfigured = Boolean(String(process.env.POSTBOX_API_KEY_ID || '').trim());
    const apiKeySecretConfigured = Boolean(String(process.env.POSTBOX_API_KEY_SECRET || '').trim());
    const fromEmail = String(process.env.TRANSACTIONAL_EMAIL_FROM_EMAIL || '').trim().toLowerCase();
    const fromName = String(process.env.TRANSACTIONAL_EMAIL_FROM_NAME || '').trim();
    const providerSupported = provider === 'yandex-postbox';
    const missing: string[] = [];
    if (!apiKeyIdConfigured) missing.push('POSTBOX_API_KEY_ID');
    if (!apiKeySecretConfigured) missing.push('POSTBOX_API_KEY_SECRET');
    if (!fromEmail) missing.push('TRANSACTIONAL_EMAIL_FROM_EMAIL');
    if (!providerSupported) missing.push('TRANSACTIONAL_EMAIL_PROVIDER');
    return {
      channel: 'EMAIL',
      provider,
      providerSupported,
      apiKeyIdConfigured,
      apiKeySecretConfigured,
      fromEmailConfigured: Boolean(fromEmail),
      fromEmail,
      fromName,
      configured: providerSupported && missing.length === 0,
      missing,
    };
  }

  async getStatus() {
    const configuration = this.configurationStatus();
    if (!configuration.configured) {
      const reason = !configuration.providerSupported
        ? `Неподдерживаемый провайдер транзакционной почты: ${configuration.provider}`
        : `Не настроено: ${configuration.missing.join(', ')}`;
      return { ...configuration, status: 'not_configured', transportReachable: false, reason };
    }
    try {
      await this.transporter().verify();
      return { ...configuration, status: 'ready', transportReachable: true, reason: '' };
    } catch (error) {
      const reason = errorMessage(error) || 'Cloud Postbox недоступен';
      this.logger.error(`Postbox verify failed: ${reason}`);
      return { ...configuration, status: 'error', transportReachable: false, reason };
    }
  }

  private transporter() {
    const apiKeyId = String(process.env.POSTBOX_API_KEY_ID || '').trim();
    const apiKeySecret = String(process.env.POSTBOX_API_KEY_SECRET || '').trim();
    if (!apiKeyId || !apiKeySecret) {
      throw new ServiceUnavailableException('Почтовый канал ещё не настроен');
    }

    return nodemailer.createTransport({
      host: 'postbox.cloud.yandex.net',
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
      auth: {
        user: apiKeyId,
        pass: apiKeySecret,
      },
    });
  }

  async send(input: TransactionalEmailInput) {
    const configuration = this.configurationStatus();
    if (!configuration.providerSupported) {
      throw new ServiceUnavailableException(`Неподдерживаемый провайдер транзакционной почты: ${configuration.provider}`);
    }
    if (!configuration.fromEmailConfigured) throw new ServiceUnavailableException('Email отправителя ещё не настроен');

    try {
      const result = await this.transporter().sendMail({
        from: configuration.fromName ? { address: configuration.fromEmail, name: configuration.fromName } : configuration.fromEmail,
        to: input.toName
          ? { address: String(input.to || '').trim().toLowerCase(), name: input.toName }
          : String(input.to || '').trim().toLowerCase(),
        subject: input.subject,
        html: input.html,
        text: input.text,
        headers: input.tag ? { 'X-Message-Tag': input.tag } : undefined,
        attachments: input.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
        })),
      });

      if (!result.messageId) throw new BadGatewayException('Cloud Postbox не вернул идентификатор письма');
      return { provider: 'yandex-postbox', messageId: result.messageId };
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;

      const details = error && typeof error === 'object'
        ? {
            name: 'name' in error ? String(error.name || '') : '',
            code: 'code' in error ? String(error.code || '') : '',
            command: 'command' in error ? String(error.command || '') : '',
            responseCode: 'responseCode' in error ? String(error.responseCode || '') : '',
            response: 'response' in error ? String(error.response || '') : '',
            message: 'message' in error ? String(error.message || '') : '',
          }
        : { message: String(error || '') };

      this.logger.error(`Postbox send failed: ${JSON.stringify(details)}`);
      const message = details.message || details.response || 'Cloud Postbox не отправил письмо';
      throw new BadGatewayException(message);
    }
  }
}
