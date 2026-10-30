import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';
import { CommunicationService } from './communication.service';
import { normalizeMessagePurpose, type MessagePurpose } from './message-purpose';

type TelegramBotRow = {
  id: string;
  tenantId: string;
  botId: string;
  botUsername: string;
  encryptedToken: string;
  tokenIv: string;
  tokenTag: string;
  status: string;
  inboundOffset: bigint | number | string;
  connectedAt: Date;
  updatedAt: Date;
};

const TELEGRAM_API_TIMEOUT_MS = 10_000;
const TELEGRAM_INBOUND_POLL_MS = 2_000;
const DEFAULT_PUBLIC_BOOKING_ORIGIN = 'https://user.va-tools.ru';

function text(value: unknown) { return String(value ?? '').trim(); }
function telegramUsername(value: unknown) { const clean = text(value).replace(/^@+/, ''); return clean ? `@${clean}` : ''; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error || ''); }

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private deliveryPollTimer: NodeJS.Timeout | null = null;
  private inboundPollTimer: NodeJS.Timeout | null = null;
  private readonly dispatching = new Set<string>();
  private readonly inboundPolling = new Set<string>();
  private readonly pollingActivated = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly communications: CommunicationService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit() {
    const deliveryInterval = Math.max(1000, Number(process.env.TELEGRAM_DELIVERY_POLL_MS || 3000));
    this.deliveryPollTimer = setInterval(() => this.dispatchAllTenantsInBackground(), deliveryInterval);
    this.deliveryPollTimer.unref?.();
    this.inboundPollTimer = setInterval(() => this.pollAllTenantsInBackground(), TELEGRAM_INBOUND_POLL_MS);
    this.inboundPollTimer.unref?.();
    this.pollAllTenantsInBackground();
  }

  onModuleDestroy() {
    if (this.deliveryPollTimer) clearInterval(this.deliveryPollTimer);
    if (this.inboundPollTimer) clearInterval(this.inboundPollTimer);
    this.deliveryPollTimer = null;
    this.inboundPollTimer = null;
    this.pollingActivated.clear();
  }

  private dispatchAllTenantsInBackground() {
    void this.dispatchAllTenants().catch((error) => {
      this.logger.error(`Telegram delivery polling failed: ${errorMessage(error)}`, error instanceof Error ? error.stack : undefined);
    });
  }

  private dispatchTenantInBackground(tenantId: string) {
    void this.dispatchTenant(tenantId).catch((error) => {
      this.logger.error(`Telegram delivery dispatch failed for tenant ${tenantId}: ${errorMessage(error)}`, error instanceof Error ? error.stack : undefined);
    });
  }

  private pollAllTenantsInBackground() {
    void this.pollAllTenants().catch((error) => {
      this.logger.error(`Telegram inbound polling failed: ${errorMessage(error)}`, error instanceof Error ? error.stack : undefined);
    });
  }

  private configurationStatus() {
    const credentialsKeyConfigured = Boolean(text(process.env.TELEGRAM_CREDENTIALS_KEY));
    return { credentialsKeyConfigured, ready: credentialsKeyConfigured };
  }

  private encryptionKey() {
    const secret = text(process.env.TELEGRAM_CREDENTIALS_KEY);
    if (!secret) throw new ServiceUnavailableException('Не настроен ключ шифрования Telegram');
    return createHash('sha256').update(secret).digest();
  }

  private encryptToken(token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return {
      encryptedToken: encrypted.toString('base64url'),
      tokenIv: iv.toString('base64url'),
      tokenTag: cipher.getAuthTag().toString('base64url'),
    };
  }

  private decryptToken(row: TelegramBotRow) {
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(row.tokenIv, 'base64url'));
    decipher.setAuthTag(Buffer.from(row.tokenTag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(row.encryptedToken, 'base64url')), decipher.final()]).toString('utf8');
  }

  private async telegramApi(token: string, method: string, payload: Record<string, any> = {}) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
      });
      const data = await response.json().catch(() => ({})) as Record<string, any>;
      if (!response.ok || !data.ok) throw new BadRequestException(text(data?.description) || 'Telegram отклонил запрос');
      this.logger.log(`[telegram-api] ${method} ok ${Date.now() - startedAt}ms`);
      return data.result;
    } catch (error) {
      this.logger.error(`[telegram-api] ${method} failed ${Date.now() - startedAt}ms: ${errorMessage(error)}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  private publicConnection(row: TelegramBotRow | null) {
    if (!row) return { connected: false };
    return {
      connected: true,
      botId: row.botId,
      botUsername: telegramUsername(row.botUsername),
      storedStatus: row.status,
      connectedAt: row.connectedAt,
      updatedAt: row.updatedAt,
    };
  }

  private async rowForTenant(tenantId: string) {
    const rows = await this.prisma.$queryRaw<TelegramBotRow[]>`
      SELECT "id", "tenantId", "botId", "botUsername", "encryptedToken", "tokenIv", "tokenTag", "status", "inboundOffset", "connectedAt", "updatedAt"
      FROM "TelegramBotConnection"
      WHERE "tenantId" = ${tenantId}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  private async publicBookingUrl(tenantId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ slug: string }>>`
      SELECT "slug" FROM "BookingPublicRoute"
      WHERE "tenantId" = ${tenantId} AND "entityType" = 'PROFILE'
      LIMIT 1
    `;
    const slug = text(rows[0]?.slug);
    if (!slug) return '';
    const origin = text(process.env.PUBLIC_BOOKING_URL || DEFAULT_PUBLIC_BOOKING_ORIGIN).replace(/\/$/, '');
    if (!/^https:\/\//i.test(origin)) return '';
    const url = new URL(origin);
    url.pathname = `/${encodeURIComponent(slug)}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  private async activatePolling(row: TelegramBotRow) {
    if (this.pollingActivated.has(row.tenantId)) return row;
    const token = this.decryptToken(row);
    await this.telegramApi(token, 'deleteWebhook', { drop_pending_updates: false });
    if (row.status !== 'polling') {
      await this.prisma.$executeRaw`
        UPDATE "TelegramBotConnection"
        SET "status" = 'polling', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "tenantId" = ${row.tenantId}
      `;
      row.status = 'polling';
    }
    this.pollingActivated.add(row.tenantId);
    return row;
  }

  async getConnection(tenantId: string) {
    const configuration = this.configurationStatus();
    const row = await this.rowForTenant(tenantId);
    if (!row) return { connected: false, status: 'disconnected', inboundActive: false, transport: 'polling', configuration };
    const base = this.publicConnection(row);
    if (!configuration.credentialsKeyConfigured) {
      return { ...base, status: 'error', inboundActive: false, transport: 'polling', error: 'Не настроен ключ шифрования Telegram', configuration };
    }
    try {
      await this.activatePolling(row);
      await this.telegramApi(this.decryptToken(row), 'getMe');
      return { ...this.publicConnection(row), status: 'active', inboundActive: true, transport: 'polling', error: '', configuration };
    } catch (error) {
      const message = errorMessage(error) || 'Не удалось проверить Telegram';
      this.logger.error(`[telegram-health] tenant=${tenantId} failed: ${message}`, error instanceof Error ? error.stack : undefined);
      return { ...base, status: 'error', inboundActive: false, transport: 'polling', error: message, configuration };
    }
  }

  async connect(tenantId: string, rawToken: unknown) {
    const configuration = this.configurationStatus();
    if (!configuration.credentialsKeyConfigured) throw new ServiceUnavailableException('Не настроен ключ шифрования Telegram');
    const token = text(rawToken);
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new BadRequestException('Некорректный токен Telegram-бота');
    if (await this.rowForTenant(tenantId)) throw new ConflictException('Telegram-бот уже подключён. Сначала отключите его.');

    const bot = await this.telegramApi(token, 'getMe');
    if (!bot?.id || !bot?.is_bot) throw new BadRequestException('Токен не принадлежит Telegram-боту');
    const botId = String(bot.id);
    const botUsername = telegramUsername(bot.username);
    const ownership = await this.prisma.$queryRaw<Array<{ tenantId: string }>>`
      SELECT "tenantId" FROM "TelegramBotConnection" WHERE "botId" = ${botId} LIMIT 1
    `;
    if (ownership[0] && ownership[0].tenantId !== tenantId) throw new ConflictException('Этот Telegram-бот уже подключён к другому аккаунту');

    const encrypted = this.encryptToken(token);
    await this.telegramApi(token, 'deleteWebhook', { drop_pending_updates: false });
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO "TelegramBotConnection" (
        "id", "tenantId", "botId", "botUsername", "encryptedToken", "tokenIv", "tokenTag", "status", "inboundOffset", "connectedAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${tenantId}, ${botId}, ${botUsername}, ${encrypted.encryptedToken}, ${encrypted.tokenIv}, ${encrypted.tokenTag}, 'polling', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId") DO NOTHING
    `;
    if (!inserted) throw new ConflictException('Telegram-бот уже подключён. Сначала отключите его.');
    this.pollingActivated.add(tenantId);
    this.dispatchTenantInBackground(tenantId);
    this.pollTenantInBackground(tenantId);
    return this.getConnection(tenantId);
  }

  async disconnect(tenantId: string) {
    const row = await this.rowForTenant(tenantId);
    if (!row) return { connected: false };
    try { await this.telegramApi(this.decryptToken(row), 'deleteWebhook', { drop_pending_updates: false }); } catch {}
    await this.prisma.$executeRaw`DELETE FROM "TelegramBotConnection" WHERE "tenantId" = ${tenantId}`;
    this.pollingActivated.delete(tenantId);
    return { connected: false, status: 'disconnected', inboundActive: false, transport: 'polling', configuration: this.configurationStatus() };
  }

  async sendMessage(tenantId: string, telegramUserId: string, body: string) {
    const row = await this.rowForTenant(tenantId);
    if (!row) throw new NotFoundException('Telegram-бот не подключён');
    return this.telegramApi(this.decryptToken(row), 'sendMessage', { chat_id: telegramUserId, text: body });
  }

  private async sendSystemMessage(connection: TelegramBotRow, chatId: string | number, body: string, replyMarkup: Record<string, any> | null = null) {
    const purpose: MessagePurpose = 'SYSTEM';
    if (!normalizeMessagePurpose(purpose)) throw new BadRequestException('Некорректный purpose системного сообщения');
    return this.telegramApi(this.decryptToken(connection), 'sendMessage', {
      chat_id: chatId,
      text: body,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async isExternalThreadAvailable(tenantId: string, externalThreadId: unknown) {
    const threadId = text(externalThreadId);
    if (!/^-?\d+$/.test(threadId) || !(await this.rowForTenant(tenantId))) return false;
    return Boolean(await this.communications.telegramThreadIdentity(tenantId, threadId));
  }

  async sendExternalThreadMessage(tenantId: string, input: { externalThreadId?: unknown; body?: unknown; purpose?: unknown }) {
    const externalThreadId = text(input?.externalThreadId);
    const body = text(input?.body);
    const purpose = normalizeMessagePurpose(input?.purpose);
    if (!purpose) throw new BadRequestException('Не указан purpose сообщения');
    if (purpose !== 'DIRECT') throw new BadRequestException('Внешний Telegram-диалог доступен только для прямых сообщений');
    if (!body) throw new BadRequestException('Пустое сообщение');
    const identity = await this.communications.telegramThreadIdentity(tenantId, externalThreadId);
    if (!identity || !(await this.rowForTenant(tenantId))) throw new NotFoundException('Telegram-диалог недоступен');
    try {
      const result = await this.sendMessage(tenantId, externalThreadId, body);
      return this.communications.recordMessage(tenantId, {
        phone: identity.personPhone,
        uei: identity.uei,
        direction: 'outbound',
        kind: 'message',
        purpose,
        channel: 'TELEGRAM',
        body,
        externalMessageId: String(result?.message_id || ''),
        externalThreadId,
        status: 'sent',
      });
    } catch (error) {
      await this.communications.recordMessage(tenantId, {
        phone: identity.personPhone,
        uei: identity.uei,
        direction: 'outbound',
        kind: 'message',
        purpose,
        channel: 'TELEGRAM',
        body,
        externalThreadId,
        status: 'failed',
        error: errorMessage(error),
      });
      throw error;
    }
  }

  private async dispatchAllTenants() {
    const rows = await this.prisma.$queryRaw<Array<{ tenantId: string }>>`
      SELECT "tenantId" FROM "TelegramBotConnection" WHERE "status" = 'polling'
    `;
    await Promise.allSettled(rows.map((row) => this.dispatchTenant(row.tenantId)));
  }

  async dispatchTenant(tenantId: string, limit = 100) {
    if (this.dispatching.has(tenantId)) return { busy: true, sent: 0, failed: 0 };
    this.dispatching.add(tenantId);
    let sent = 0;
    let failed = 0;
    try {
      const connection = await this.rowForTenant(tenantId);
      if (!connection) return { busy: false, sent, failed };
      const token = this.decryptToken(connection);
      const deliveries = await this.notifications.pendingTelegramDeliveries(tenantId, limit);
      for (const delivery of deliveries) {
        try {
          const allowed = await this.notifications.canSendTelegramDelivery(tenantId, delivery.notificationId);
          if (!allowed) {
            await this.notifications.markTelegramFailed(tenantId, delivery.deliveryId, 'Отправка запрещена для purpose/канала');
            failed += 1;
            continue;
          }
          await this.telegramApi(token, 'sendMessage', { chat_id: delivery.recipientKey, text: delivery.body || delivery.title });
          await this.notifications.markTelegramSent(tenantId, delivery.deliveryId);
          sent += 1;
        } catch (error) {
          await this.notifications.markTelegramFailed(tenantId, delivery.deliveryId, errorMessage(error));
          failed += 1;
        }
      }
      return { busy: false, sent, failed };
    } finally {
      this.dispatching.delete(tenantId);
    }
  }

  private pollTenantInBackground(tenantId: string) {
    void this.pollTenant(tenantId).catch((error) => {
      this.logger.error(`[telegram-polling] tenant=${tenantId} failed: ${errorMessage(error)}`, error instanceof Error ? error.stack : undefined);
    });
  }

  private async pollAllTenants() {
    const rows = await this.prisma.$queryRaw<Array<{ tenantId: string }>>`
      SELECT "tenantId" FROM "TelegramBotConnection" WHERE "status" = 'polling'
    `;
    await Promise.allSettled(rows.map((row) => this.pollTenant(row.tenantId)));
  }

  private async pollTenant(tenantId: string) {
    if (this.inboundPolling.has(tenantId)) return;
    this.inboundPolling.add(tenantId);
    try {
      const row = await this.rowForTenant(tenantId);
      if (!row) return;
      await this.activatePolling(row);
      const token = this.decryptToken(row);
      const storedOffset = Number(row.inboundOffset || 0);
      const offset = Number.isFinite(storedOffset) && storedOffset > 0 ? storedOffset : 0;
      const updates = await this.telegramApi(token, 'getUpdates', {
        offset,
        limit: 100,
        timeout: 0,
        allowed_updates: ['message'],
      }) as Array<Record<string, any>>;
      if (!Array.isArray(updates) || !updates.length) return;
      for (const update of updates) {
        const messageTimestampMs = Number(update?.message?.date || 0) * 1000;
        const predatesConnection = Number.isFinite(messageTimestampMs)
          && messageTimestampMs > 0
          && messageTimestampMs < row.connectedAt.getTime();
        if (!predatesConnection) await this.processUpdate(row, update);
        const updateId = Number(update?.update_id);
        if (!Number.isFinite(updateId)) continue;
        const nextOffset = Math.trunc(updateId) + 1;
        await this.prisma.$executeRaw`
          UPDATE "TelegramBotConnection"
          SET "inboundOffset" = ${BigInt(nextOffset)}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "tenantId" = ${tenantId}
        `;
        row.inboundOffset = BigInt(nextOffset);
      }
    } finally {
      this.inboundPolling.delete(tenantId);
    }
  }

  private async processUpdate(connection: TelegramBotRow, update: Record<string, any>) {
    const message = update?.message;
    if (!message?.from?.id || !message?.chat?.id || message.chat.type !== 'private' || message.from.is_bot) return { ok: true };

    const chatId = String(message.chat.id);
    const username = telegramUsername(message.from.username);
    const messageBody = text(message.text || message.caption);
    const isStart = /^\/start(?:@\w+)?(?:\s|$)/i.test(messageBody);
    const identity = await this.communications.ensureTelegramThreadIdentity(connection.tenantId, {
      telegramUserId: chatId,
      username,
    });

    if (isStart) {
      const bookingUrl = await this.publicBookingUrl(connection.tenantId);
      await this.sendSystemMessage(
        connection,
        message.chat.id,
        bookingUrl ? 'Здравствуйте. Здесь можно написать сообщение или перейти к записи.' : 'Здравствуйте. Здесь можно написать сообщение.',
        bookingUrl ? { inline_keyboard: [[{ text: 'Записаться', url: bookingUrl }]] } : null,
      );
      return { ok: true };
    }

    if (messageBody) {
      await this.communications.recordMessage(connection.tenantId, {
        phone: identity?.personPhone,
        uei: identity?.uei,
        direction: 'inbound',
        kind: 'message',
        purpose: 'DIRECT',
        channel: 'TELEGRAM',
        body: messageBody,
        externalMessageId: String(message.message_id || ''),
        externalThreadId: chatId,
        status: 'delivered',
      });
    }
    return { ok: true };
  }
}
