import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { AccountContactType } from '@prisma/client';
import { ConsentPolicyService } from '../tenant-document-archive/consent-policy.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';
import { CommunicationService } from './communication.service';
import { normalizeMessagePurpose, type MessagePurpose } from './message-purpose';

type TelegramBotRow = {
  id: string; tenantId: string; botId: string; botUsername: string; encryptedToken: string; tokenIv: string; tokenTag: string;
  webhookKey: string; webhookSecretHash: string; status: string; inboundOffset: bigint | number | string; connectedAt: Date; updatedAt: Date;
};
type TelegramIdentityRow = { personPhone: string; uei: string };
const TELEGRAM_API_TIMEOUT_MS = 10_000;
const TELEGRAM_INBOUND_POLL_MS = 2_000;
const DEFAULT_PUBLIC_BOOKING_ORIGIN = 'https://user.va-tools.ru';
function text(value: unknown) { return String(value ?? '').trim(); }
function objectValue(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function canonicalPhone(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}
function personHasPhone(person: Record<string, any>, phone: string) {
  const phones = Array.isArray(person.phones) ? person.phones : [];
  return phones.some((value) => canonicalPhone(value) === phone);
}
function sha256(value: string) { return createHash('sha256').update(value).digest('hex'); }
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
    private readonly consentPolicy: ConsentPolicyService,
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
      const message = errorMessage(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Telegram delivery polling failed: ${message}`, stack);
    });
  }

  private dispatchTenantInBackground(tenantId: string) {
    void this.dispatchTenant(tenantId).catch((error) => {
      const message = errorMessage(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Telegram delivery dispatch failed for tenant ${tenantId}: ${message}`, stack);
    });
  }

  private pollAllTenantsInBackground() {
    void this.pollAllTenants().catch((error) => {
      const message = errorMessage(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Telegram inbound polling failed: ${message}`, stack);
    });
  }

  private configurationStatus() {
    const publicApiUrl = text(process.env.PUBLIC_API_URL).replace(/\/$/, '');
    const credentialsKeyConfigured = Boolean(text(process.env.TELEGRAM_CREDENTIALS_KEY));
    const publicApiUrlConfigured = /^https:\/\//i.test(publicApiUrl);
    return {
      credentialsKeyConfigured,
      publicApiUrlConfigured,
      ready: credentialsKeyConfigured,
    };
  }

  private encryptionKey() {
    const secret = text(process.env.TELEGRAM_CREDENTIALS_KEY);
    if (!secret) throw new ServiceUnavailableException('Не настроен ключ шифрования Telegram');
    return createHash('sha256').update(secret).digest();
  }
  private encryptToken(token: string) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return { encryptedToken: encrypted.toString('base64url'), tokenIv: iv.toString('base64url'), tokenTag: cipher.getAuthTag().toString('base64url') };
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
      const message = errorMessage(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`[telegram-api] ${method} failed ${Date.now() - startedAt}ms: ${message}`, stack);
      throw error;
    }
  }
  private publicConnection(row: TelegramBotRow | null) {
    if (!row) return { connected: false };
    return { connected: true, botId: row.botId, botUsername: telegramUsername(row.botUsername), storedStatus: row.status, connectedAt: row.connectedAt, updatedAt: row.updatedAt };
  }
  private expectedWebhookUrl(row: TelegramBotRow) {
    const publicApiUrl = text(process.env.PUBLIC_API_URL).replace(/\/$/, '');
    return publicApiUrl ? `${publicApiUrl}/communications/telegram/webhook/${row.webhookKey}` : '';
  }
  private async rowForTenant(tenantId: string) {
    const rows = await this.prisma.$queryRaw<TelegramBotRow[]>`
      SELECT "id", "tenantId", "botId", "botUsername", "encryptedToken", "tokenIv", "tokenTag", "webhookKey", "webhookSecretHash", "status", "inboundOffset", "connectedAt", "updatedAt"
      FROM "TelegramBotConnection" WHERE "tenantId" = ${tenantId} LIMIT 1
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

  private async bindVerifiedTelegramPhone(tenantId: string, input: { telegramUserId: string; username: string; phone: unknown }) {
    const telegramUserId = text(input.telegramUserId);
    const personPhone = canonicalPhone(input.phone);
    if (!/^\d+$/.test(telegramUserId)) throw new BadRequestException('Некорректный Telegram ID');
    if (!personPhone) throw new BadRequestException('Telegram не передал номер телефона');

    const [peopleRows, ueiRow, accounts, existingTelegramContact] = await Promise.all([
      this.prisma.person.findMany({ where: { tenantId }, select: { key: true, data: true } }),
      this.prisma.ueiState.findUnique({ where: { tenantId }, select: { data: true } }),
      this.prisma.account.findMany({ select: { id: true, phone: true } }),
      this.prisma.accountContact.findUnique({
        where: { type_value: { type: AccountContactType.TELEGRAM, value: telegramUserId } },
        select: { accountId: true },
      }),
    ]);

    const matchedPersonRow = peopleRows.find((row) => personHasPhone(objectValue(row.data), personPhone)) || null;
    const relations = objectValue(objectValue(ueiRow?.data).relations);
    const matchedUei = matchedPersonRow ? text(relations[`person:${matchedPersonRow.key}`]) : '';
    const matchedAccount = accounts.find((account) => canonicalPhone(account.phone) === personPhone) || null;

    if (existingTelegramContact && matchedAccount && existingTelegramContact.accountId !== matchedAccount.id) {
      throw new ConflictException('Этот Telegram уже связан с другим аккаунтом');
    }

    if (matchedAccount) {
      await this.prisma.$transaction(async (tx) => {
        await tx.accountContact.deleteMany({
          where: {
            accountId: matchedAccount.id,
            type: AccountContactType.TELEGRAM,
            value: { not: telegramUserId },
          },
        });
        await tx.accountContact.upsert({
          where: { type_value: { type: AccountContactType.TELEGRAM, value: telegramUserId } },
          create: { accountId: matchedAccount.id, type: AccountContactType.TELEGRAM, value: telegramUserId, isPrimary: true },
          update: { isPrimary: true },
        });
        await tx.account.update({ where: { id: matchedAccount.id }, data: { telegramId: telegramUserId } });
      });
    }

    const display = telegramUsername(input.username);
    const rows = await this.prisma.$queryRaw<TelegramIdentityRow[]>`
      INSERT INTO "CommunicationIdentity" (
        "id", "tenantId", "personPhone", "uei", "channel", "externalUserId", "display", "verifiedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${tenantId}, ${personPhone}, ${matchedUei}, 'TELEGRAM', ${telegramUserId}, ${display}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId", "channel", "externalUserId") DO UPDATE
      SET "personPhone" = EXCLUDED."personPhone",
          "uei" = CASE WHEN EXCLUDED."uei" <> '' THEN EXCLUDED."uei" ELSE "CommunicationIdentity"."uei" END,
          "display" = CASE WHEN EXCLUDED."display" <> '' THEN EXCLUDED."display" ELSE "CommunicationIdentity"."display" END,
          "verifiedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "personPhone", "uei"
    `;
    const identity = rows[0] || { personPhone, uei: matchedUei };
    await this.prisma.$executeRaw`
      UPDATE "CommunicationMessage"
      SET "personPhone" = ${personPhone}, "uei" = ${text(identity.uei)}
      WHERE "tenantId" = ${tenantId}
        AND "channel" = 'TELEGRAM'
        AND "externalThreadId" = ${telegramUserId}
        AND "personPhone" = ''
        AND "uei" = ''
    `;
    return identity;
  }

  private async activatePolling(row: TelegramBotRow) {
    if (this.pollingActivated.has(row.tenantId)) return row;
    const token = this.decryptToken(row);
    this.logger.log(`[telegram-polling] tenant=${row.tenantId} ensuring polling transport storedStatus=${row.status}`);
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
    if (!row) return { connected: false, status: 'disconnected', inboundActive: false, transport: 'polling', webhookActive: false, configuration };
    const base = this.publicConnection(row);
    if (!configuration.credentialsKeyConfigured) {
      return { ...base, status: 'error', inboundActive: false, transport: 'polling', webhookActive: false, webhookError: 'Не настроен ключ шифрования Telegram', webhookPendingUpdateCount: 0, configuration };
    }
    try {
      await this.activatePolling(row);
      this.logger.log(`[telegram-health] checking tenant=${tenantId} bot=${row.botUsername} transport=polling`);
      await this.telegramApi(this.decryptToken(row), 'getMe');
      return {
        ...this.publicConnection(row),
        status: 'active',
        inboundActive: true,
        transport: 'polling',
        webhookActive: false,
        webhookUrlMatches: false,
        webhookError: '',
        webhookPendingUpdateCount: 0,
        configuration,
      };
    } catch (error) {
      const message = errorMessage(error) || 'Не удалось проверить Telegram';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`[telegram-health] tenant=${tenantId} failed: ${message}`, stack);
      return { ...base, status: 'error', inboundActive: false, transport: 'polling', webhookActive: false, webhookError: message, webhookPendingUpdateCount: 0, configuration };
    }
  }

  async connect(tenantId: string, rawToken: unknown) {
    const configuration = this.configurationStatus();
    if (!configuration.credentialsKeyConfigured) throw new ServiceUnavailableException('Не настроен ключ шифрования Telegram');
    const token = text(rawToken);
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new BadRequestException('Некорректный токен Telegram-бота');
    if (await this.rowForTenant(tenantId)) {
      throw new ConflictException('Telegram-бот уже подключён. Сначала отключите его.');
    }
    const bot = await this.telegramApi(token, 'getMe');
    if (!bot?.id || !bot?.is_bot) throw new BadRequestException('Токен не принадлежит Telegram-боту');
    const botId = String(bot.id); const botUsername = telegramUsername(bot.username);
    const ownership = await this.prisma.$queryRaw<Array<{ tenantId: string }>>`SELECT "tenantId" FROM "TelegramBotConnection" WHERE "botId" = ${botId} LIMIT 1`;
    if (ownership[0] && ownership[0].tenantId !== tenantId) throw new ConflictException('Этот Telegram-бот уже подключён к другому аккаунту');
    const encrypted = this.encryptToken(token); const webhookKey = randomBytes(24).toString('base64url'); const webhookSecret = randomBytes(24).toString('base64url');
    await this.telegramApi(token, 'deleteWebhook', { drop_pending_updates: false });
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO "TelegramBotConnection" ("id", "tenantId", "botId", "botUsername", "encryptedToken", "tokenIv", "tokenTag", "webhookKey", "webhookSecretHash", "status", "inboundOffset", "connectedAt", "updatedAt")
      VALUES (${randomUUID()}, ${tenantId}, ${botId}, ${botUsername}, ${encrypted.encryptedToken}, ${encrypted.tokenIv}, ${encrypted.tokenTag}, ${webhookKey}, ${sha256(webhookSecret)}, 'polling', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("tenantId") DO NOTHING
    `;
    if (!inserted) throw new ConflictException('Telegram-бот уже подключён. Сначала отключите его.');
    this.pollingActivated.add(tenantId);
    this.dispatchTenantInBackground(tenantId);
    this.pollTenantInBackground(tenantId);
    return this.getConnection(tenantId);
  }

  async repairConnection(tenantId: string) {
    const configuration = this.configurationStatus();
    if (!configuration.credentialsKeyConfigured) throw new ServiceUnavailableException('Не настроен ключ шифрования Telegram');
    const row = await this.rowForTenant(tenantId);
    if (!row) throw new NotFoundException('Telegram-бот не подключён');
    this.pollingActivated.delete(tenantId);
    await this.activatePolling(row);
    this.pollTenantInBackground(tenantId);
    return this.getConnection(tenantId);
  }

  async disconnect(tenantId: string) {
    const row = await this.rowForTenant(tenantId); if (!row) return { connected: false };
    try { await this.telegramApi(this.decryptToken(row), 'deleteWebhook', { drop_pending_updates: false }); } catch {}
    await this.prisma.$executeRaw`DELETE FROM "TelegramBotConnection" WHERE "tenantId" = ${tenantId}`;
    this.pollingActivated.delete(tenantId);
    return { connected: false, status: 'disconnected', inboundActive: false, transport: 'polling', webhookActive: false, configuration: this.configurationStatus() };
  }

  async sendMessage(tenantId: string, telegramUserId: string, body: string) {
    const row = await this.rowForTenant(tenantId); if (!row) throw new NotFoundException('Telegram-бот не подключён');
    return this.telegramApi(this.decryptToken(row), 'sendMessage', { chat_id: telegramUserId, text: body });
  }

  private async sendSystemMessage(
    connection: TelegramBotRow,
    chatId: string | number,
    body: string,
    replyMarkup: Record<string, any> | null = null,
  ) {
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
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CommunicationIdentity"
      WHERE "tenantId" = ${tenantId}
        AND "channel" = 'TELEGRAM'
        AND "externalUserId" = ${threadId}
        AND "personPhone" = ''
        AND "uei" = ''
      LIMIT 1
    `;
    return Boolean(rows[0]);
  }

  async sendExternalThreadMessage(tenantId: string, input: { externalThreadId?: unknown; body?: unknown; purpose?: unknown }) {
    const externalThreadId = text(input?.externalThreadId);
    const body = text(input?.body);
    const purpose = normalizeMessagePurpose(input?.purpose);
    if (!purpose) throw new BadRequestException('Не указан purpose сообщения');
    if (purpose !== 'DIRECT') throw new BadRequestException('Внешний Telegram-диалог доступен только для прямых сообщений');
    if (!body) throw new BadRequestException('Пустое сообщение');
    if (!(await this.isExternalThreadAvailable(tenantId, externalThreadId))) {
      throw new NotFoundException('Telegram-диалог недоступен');
    }
    try {
      const result = await this.sendMessage(tenantId, externalThreadId, body);
      return this.communications.recordMessage(tenantId, {
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

  async sendChatMessage(tenantId: string, input: { phone?: unknown; uei?: unknown; body?: unknown; purpose?: unknown }) {
    const body = text(input?.body); if (!body) throw new BadRequestException('Пустое сообщение');
    const purpose = normalizeMessagePurpose(input?.purpose); if (!purpose) throw new BadRequestException('Не указан purpose сообщения');
    const identity = await this.communications.telegramIdentity(tenantId, input || {}); if (!identity) throw new NotFoundException('Telegram у человека не подключён');
    if (purpose === 'MARKETING' && !(await this.consentPolicy.canSendMarketing(tenantId, 'TELEGRAM', identity.externalUserId))) {
      throw new BadRequestException('Нет действующего рекламного согласия для Telegram');
    }
    try {
      const result = await this.sendMessage(tenantId, identity.externalUserId, body);
      return this.communications.recordMessage(tenantId, { phone: identity.personPhone, uei: identity.uei, direction: 'outbound', kind: 'message', purpose, channel: 'TELEGRAM', body, externalMessageId: String(result?.message_id || ''), externalThreadId: String(result?.chat?.id || identity.externalUserId), status: 'sent' });
    } catch (error) {
      await this.communications.recordMessage(tenantId, { phone: identity.personPhone, uei: identity.uei, direction: 'outbound', kind: 'message', purpose, channel: 'TELEGRAM', body, status: 'failed', error: errorMessage(error) });
      throw error;
    }
  }

  private async dispatchAllTenants() {
    const rows = await this.prisma.$queryRaw<Array<{ tenantId: string }>>`SELECT "tenantId" FROM "TelegramBotConnection" WHERE "status" IN ('connected', 'active', 'polling')`;
    await Promise.allSettled(rows.map((row) => this.dispatchTenant(row.tenantId)));
  }
  async dispatchTenant(tenantId: string, limit = 100) {
    if (this.dispatching.has(tenantId)) return { busy: true, sent: 0, failed: 0 };
    this.dispatching.add(tenantId); let sent = 0; let failed = 0;
    try {
      const connection = await this.rowForTenant(tenantId); if (!connection) return { busy: false, sent, failed };
      const token = this.decryptToken(connection); const deliveries = await this.notifications.pendingTelegramDeliveries(tenantId, limit);
      for (const delivery of deliveries) {
        try {
          const allowed = await this.notifications.canSendTelegramDelivery(tenantId, delivery.notificationId);
          if (!allowed) { await this.notifications.markTelegramFailed(tenantId, delivery.deliveryId, 'Отправка запрещена для purpose/канала'); failed += 1; continue; }
          await this.telegramApi(token, 'sendMessage', { chat_id: delivery.recipientKey, text: delivery.body || delivery.title });
          await this.notifications.markTelegramSent(tenantId, delivery.deliveryId); sent += 1;
        } catch (error) { await this.notifications.markTelegramFailed(tenantId, delivery.deliveryId, errorMessage(error)); failed += 1; }
      }
      return { busy: false, sent, failed };
    } finally { this.dispatching.delete(tenantId); }
  }

  private pollTenantInBackground(tenantId: string) {
    void this.pollTenant(tenantId).catch((error) => {
      const message = errorMessage(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`[telegram-polling] tenant=${tenantId} failed: ${message}`, stack);
    });
  }

  private async pollAllTenants() {
    const rows = await this.prisma.$queryRaw<Array<{ tenantId: string }>>`SELECT "tenantId" FROM "TelegramBotConnection" WHERE "status" IN ('connected', 'active', 'polling')`;
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
        if (predatesConnection) {
          this.logger.log(`[telegram-polling] tenant=${tenantId} update=${text(update?.update_id) || 'unknown'} skipped-pre-connection`);
        } else {
          await this.processUpdate(row, update, 'polling');
        }
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

  private async processUpdate(connection: TelegramBotRow, update: Record<string, any>, source: 'polling' | 'webhook') {
    const updateId = text(update?.update_id) || 'unknown';
    const startedAt = Date.now();
    const message = update?.message;
    if (!message?.from?.id || !message?.chat?.id) {
      this.logger.log(`[telegram-${source}] update=${updateId} tenant=${connection.tenantId} ignored-non-message`);
      return { ok: true };
    }
    const telegramUserId = String(message.from.id); const username = telegramUsername(message.from.username); const messageBody = text(message.text || message.caption);
    const isStart = /^\/start(?:@\w+)?(?:\s|$)/i.test(messageBody);
    const sharedOwnContact = message.chat.type === 'private'
      && message.contact
      && String(message.contact.user_id || '') === telegramUserId;
    this.logger.log(`[telegram-${source}] update=${updateId} tenant=${connection.tenantId} message-received start=${isStart} contact=${Boolean(sharedOwnContact)}`);
    const identities = await this.prisma.$queryRaw<TelegramIdentityRow[]>`
      SELECT "personPhone", "uei" FROM "CommunicationIdentity"
      WHERE "tenantId" = ${connection.tenantId} AND "channel" = 'TELEGRAM' AND "externalUserId" = ${telegramUserId} LIMIT 1
    `;
    let identity = identities[0] || null;
    const identityLinked = Boolean(identity && (canonicalPhone(identity.personPhone) || text(identity.uei)));
    if (message.chat.type === 'private' && (!identity || !identityLinked)) {
      identity = await this.communications.ensureTelegramInboundIdentity(connection.tenantId, { telegramUserId, username });
    }
    if (sharedOwnContact) {
      identity = await this.bindVerifiedTelegramPhone(connection.tenantId, {
        telegramUserId,
        username,
        phone: message.contact.phone_number,
      });
      await this.sendSystemMessage(
        connection,
        message.chat.id,
        'Telegram подключён. Теперь это тот же человек, что и по номеру телефона.',
        { remove_keyboard: true },
      );
      const bookingUrl = await this.publicBookingUrl(connection.tenantId);
      if (bookingUrl) {
        await this.sendSystemMessage(connection, message.chat.id, 'Можно продолжать общение здесь или записаться.', {
          inline_keyboard: [[{ text: 'Записаться', url: bookingUrl }]],
        });
      }
    }
    const linkedIdentity = Boolean(identity && (canonicalPhone(identity.personPhone) || text(identity.uei)));
    this.logger.log(`[telegram-${source}] update=${updateId} tenant=${connection.tenantId} identity-found=${Boolean(identity)} linked=${linkedIdentity}`);
    if (isStart) {
      const bookingUrl = await this.publicBookingUrl(connection.tenantId);
      if (!linkedIdentity && message.chat.type === 'private') {
        await this.sendSystemMessage(
          connection,
          message.chat.id,
          'Чтобы не создавать второго человека, подтвердите свой номер телефона.',
          {
            keyboard: [[{ text: 'Поделиться номером', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        );
      } else {
        await this.sendSystemMessage(
          connection,
          message.chat.id,
          'Telegram подключён. Здесь можно писать сообщения и быстро перейти к записи.',
          bookingUrl ? { inline_keyboard: [[{ text: 'Записаться', url: bookingUrl }]] } : null,
        );
      }
      if (!linkedIdentity && bookingUrl) {
        await this.sendSystemMessage(connection, message.chat.id, 'Записаться можно и сразу:', {
          inline_keyboard: [[{ text: 'Записаться', url: bookingUrl }]],
        });
      }
    }
    if (messageBody && !isStart) {
      await this.communications.recordMessage(connection.tenantId, { phone: identity!.personPhone, uei: identity!.uei, direction: 'inbound', kind: 'message', purpose: 'DIRECT', channel: 'TELEGRAM', body: messageBody, externalMessageId: String(message.message_id || ''), externalThreadId: String(message.chat.id), status: 'delivered' });
      this.logger.log(`[telegram-${source}] update=${updateId} tenant=${connection.tenantId} inbound-recorded linked=${linkedIdentity}`);
    }
    this.logger.log(`[telegram-${source}] update=${updateId} tenant=${connection.tenantId} completed ${Date.now() - startedAt}ms`);
    return { ok: true, linked: linkedIdentity };
  }

  async handleWebhook(webhookKey: string, secretToken: unknown, update: Record<string, any>) {
    const updateId = text(update?.update_id) || 'unknown';
    this.logger.log(`[telegram-webhook] received update=${updateId}`);
    const rows = await this.prisma.$queryRaw<TelegramBotRow[]>`
      SELECT "id", "tenantId", "botId", "botUsername", "encryptedToken", "tokenIv", "tokenTag", "webhookKey", "webhookSecretHash", "status", "inboundOffset", "connectedAt", "updatedAt"
      FROM "TelegramBotConnection" WHERE "webhookKey" = ${webhookKey} LIMIT 1
    `;
    const connection = rows[0];
    if (!connection) throw new NotFoundException('Telegram webhook не найден');
    if (sha256(text(secretToken)) !== connection.webhookSecretHash) throw new UnauthorizedException('Некорректный Telegram webhook secret');
    return this.processUpdate(connection, update, 'webhook');
  }
}
