import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommunicationService } from './communication.service';
import { CommunicationHistoryService } from './communication-history.service';
import { MessengerCoreService } from './messenger-core.service';
import { TelegramBotService } from './telegram-bot.service';
import { EmailChannelService } from './email-channel.service';
import type { MessagePurpose } from './message-purpose';
import { SaasAccessService } from '../saas-access/saas-access.service';

function text(value: unknown) { return String(value ?? '').trim(); }
function messengerChannel(value: unknown) {
  const requested = text(value).toUpperCase();
  if (requested === 'PUSH' || requested === 'IN_APP') return 'CHAT';
  return requested;
}

@Injectable()
export class CommunicationDispatchService {
  constructor(
    private readonly communications: CommunicationService,
    private readonly history: CommunicationHistoryService,
    private readonly messenger: MessengerCoreService,
    private readonly telegram: TelegramBotService,
    private readonly email: EmailChannelService,
    private readonly access: SaasAccessService,
  ) {}

  async availableChannels(tenantId: string, input: { phone?: unknown; uei?: unknown; externalThreadId?: unknown }) {
    const externalThreadId = text(input?.externalThreadId);
    if (externalThreadId) {
      return await this.telegram.isExternalThreadAvailable(tenantId, externalThreadId) ? ['TELEGRAM'] : [];
    }
    const channels: string[] = ['CHAT'];
    if (await this.email.isAvailable(tenantId) && await this.communications.emailIdentity(tenantId, input || {})) channels.push('EMAIL');
    return channels;
  }

  async resolveChannel(tenantId: string, input: { phone?: unknown; uei?: unknown; externalThreadId?: unknown; channel?: unknown }) {
    const requested = messengerChannel(input?.channel);
    const externalThreadId = text(input?.externalThreadId);
    const available = await this.availableChannels(tenantId, input || {});
    if (requested) {
      if (!available.includes(requested)) throw new NotFoundException(`Канал ${requested} у человека недоступен`);
      return requested;
    }
    if (externalThreadId) {
      if (!available.includes('TELEGRAM')) throw new NotFoundException('Telegram-диалог недоступен');
      return 'TELEGRAM';
    }
    const preferences = await this.history.getPreferences(tenantId, input || {});
    const preferred = preferences.preferredChannels
      .map((channel) => messengerChannel(channel))
      .find((channel) => available.includes(channel));
    return preferred || available[0];
  }

  async send(tenantId: string, input: { phone?: unknown; uei?: unknown; externalThreadId?: unknown; channel?: unknown; subject?: unknown; body?: unknown; attachments?: unknown; purpose: MessagePurpose }) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const body = text(input?.body);
    const attachments = Array.isArray(input?.attachments) ? input.attachments : [];
    if (!body && !attachments.length) throw new BadRequestException('Пустое сообщение');

    const channel = await this.resolveChannel(tenantId, input || {});
    if (attachments.length && channel !== 'CHAT') {
      throw new BadRequestException('Вложения можно отправить только через Чат');
    }
    if (channel === 'CHAT') {
      if (input.purpose === 'DIRECT') {
        return this.messenger.recordDirectMessage(tenantId, 'professional', { phone: input?.phone, uei: input?.uei }, { body, attachments });
      }
      return this.communications.recordMessage(tenantId, {
        phone: input?.phone,
        uei: input?.uei,
        direction: 'outbound',
        kind: attachments.length ? 'media' : 'message',
        purpose: input.purpose,
        channel: 'IN_APP',
        body,
        attachments,
        status: 'sent',
      });
    }
    if (channel === 'TELEGRAM') {
      const externalThreadId = text(input?.externalThreadId);
      if (!externalThreadId) throw new NotFoundException('Telegram-диалог недоступен');
      return this.telegram.sendExternalThreadMessage(tenantId, { externalThreadId, body, purpose: input.purpose });
    }
    if (channel === 'EMAIL') return this.email.sendMessage(tenantId, { phone: input?.phone, uei: input?.uei, subject: input?.subject, body, purpose: input.purpose });
    throw new BadRequestException('Канал пока не подключён');
  }
}
