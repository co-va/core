import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccountContactType } from '@prisma/client';
import { ConsentPolicyService } from '../tenant-document-archive/consent-policy.service';
import { PrismaService } from '../prisma.service';
import { WebPushService } from './web-push.service';
import { NOTIFICATION_EVENT_TYPES, notificationEventDefinition } from './notification-events';
import { normalizeMessagePurpose, type MessagePurpose } from '../communication/message-purpose';

type JsonObject = Record<string, any>;

type NotificationInput = {
  purpose: MessagePurpose;
  type?: string;
  title?: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  uei?: string;
};

type NotificationRow = {
  id: string;
  tenantId: string;
  personPhone: string;
  uei: string;
  type: string;
  purpose: MessagePurpose | null;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  deliveryStatus: string;
  deliveryCreatedAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  error: string;
};

type ExternalDeliveryRow = {
  deliveryId: string;
  notificationId: string;
  tenantId: string;
  recipientKey: string;
  status: string;
  title: string;
  body: string;
  type: string;
  purpose: MessagePurpose | null;
  entityType: string;
  entityId: string;
  personPhone: string;
  uei: string;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  error: string;
};

type RoutingPolicyRow = {
  id: string;
  tenantId: string;
  eventType: string;
  mode: string;
  channels: unknown;
  titleTemplate: string;
  bodyTemplate: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type AccountIdentity = Awaited<ReturnType<NotificationService['accountIdentity']>>;
type RoutedDelivery = { channel: string; recipient: string };

const ROUTING_MODES = new Set(['always', 'fallback']);
const ROUTING_CHANNELS = new Set(['PUSH', 'TELEGRAM', 'EMAIL']);
const ACTIVE_EXTERNAL_CHANNELS = new Set(['TELEGRAM', 'EMAIL']);
const DELIVERY_POLICY_TYPE = '__delivery__';

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function canonicalPhone(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function canonicalEmail(value: unknown) {
  const email = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeMode(value: unknown) {
  const mode = text(value).toLowerCase();
  return ROUTING_MODES.has(mode) ? mode : 'always';
}

function normalizeChannels(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => text(item).toUpperCase()).filter((item) => ROUTING_CHANNELS.has(item)))];
}

function policyChannels(value: unknown, { defaultPush = false } = {}) {
  const channels = normalizeChannels(value);
  return channels.length || !defaultPush ? channels : ['PUSH'];
}

function accountIdsFromPerson(person: JsonObject) {
  const values = [person.accountId, ...arrayValue(person.accounts)];
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function phonesMatch(left: unknown, right: unknown) {
  const a = canonicalPhone(left);
  const b = canonicalPhone(right);
  return Boolean(a && b && a === b);
}

function defaultTemplate(eventType: string) {
  const definition = notificationEventDefinition(eventType);
  return definition
    ? { title: definition.defaultTitle, body: definition.defaultBody }
    : { title: 'Уведомление', body: '' };
}

function renderTemplate(template: unknown, context: JsonObject) {
  return text(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = String(path || '').split('.').reduce<any>((current, key) => objectValue(current)[key], context);
    return text(value);
  });
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ConsentPolicyService,
    private readonly webPush: WebPushService,
  ) {}

  private async accountIdentity(tenantId: string, accountId: string) {
    const [account, personRows, identityRow] = await Promise.all([
      this.prisma.account.findUnique({
        where: { id: accountId },
        select: { phone: true, email: true },
      }),
      this.prisma.person.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.ueiState.findUnique({ where: { tenantId } }),
    ]);
    if (!account) throw new NotFoundException('Аккаунт не найден');
    const personPhone = canonicalPhone(account.phone);
    if (!personPhone) throw new NotFoundException('У человека не определён номер телефона');

    const matched = personRows.find((row) => {
      const person = objectValue(row.data);
      return accountIdsFromPerson(person).includes(accountId)
        || phonesMatch(person.phone, account.phone)
        || arrayValue(person.phones).some((phone) => phonesMatch(phone, account.phone));
    }) || null;
    const person = objectValue(matched?.data);
    const personKey = text(person.key || matched?.key);
    const identity = objectValue(identityRow?.data);
    const relations = objectValue(identity.relations);
    const uei = personKey ? text(relations[`person:${personKey}`]) : '';
    const telegramRows = await this.prisma.$queryRaw<Array<{ externalUserId: string }>>`
      SELECT "externalUserId"
      FROM "CommunicationIdentity"
      WHERE "tenantId" = ${tenantId}
        AND "channel" = 'TELEGRAM'
        AND ("personPhone" = ${personPhone} OR (${uei} <> '' AND "uei" = ${uei}))
      ORDER BY "verifiedAt" DESC NULLS LAST, "updatedAt" DESC
      LIMIT 1
    `;
    return {
      accountId,
      personPhone,
      personKey,
      uei,
      email: canonicalEmail(account.email),
      telegramId: text(telegramRows[0]?.externalUserId),
    };
  }

  private async accountIdentityByPhone(tenantId: string, personPhone: string) {
    const phone = canonicalPhone(personPhone);
    if (!phone) return null;
    const contact = await this.prisma.accountContact.findUnique({
      where: { type_value: { type: AccountContactType.PHONE, value: phone } },
      select: { accountId: true },
    });
    return contact ? this.accountIdentity(tenantId, contact.accountId) : null;
  }

  private project(row: NotificationRow) {
    return {
      id: row.id,
      type: row.type,
      purpose: row.purpose,
      title: row.title,
      body: row.body,
      entityType: row.entityType,
      entityId: row.entityId,
      uei: row.uei,
      createdAt: row.createdAt,
      status: row.deliveryStatus,
      sentAt: row.sentAt,
      deliveredAt: row.deliveredAt,
      readAt: row.readAt,
      failedAt: row.failedAt,
      error: row.error,
      read: Boolean(row.readAt) || row.deliveryStatus === 'read',
    };
  }

  private projectPolicy(row: RoutingPolicyRow | null, eventType: string) {
    const fallback = defaultTemplate(eventType);
    return {
      eventType,
      mode: normalizeMode(row?.mode),
      channels: policyChannels(row?.channels, { defaultPush: !row }),
      titleTemplate: text(row?.titleTemplate) || fallback.title,
      bodyTemplate: text(row?.bodyTemplate) || fallback.body,
    };
  }

  private projectDeliveryPolicy(row: RoutingPolicyRow | null) {
    const configured = policyChannels(row?.channels, { defaultPush: true });
    const external = configured.filter((channel) => ACTIVE_EXTERNAL_CHANNELS.has(channel));
    return {
      eventType: DELIVERY_POLICY_TYPE,
      mode: normalizeMode(row?.mode),
      channels: ['PUSH', ...external],
      titleTemplate: '',
      bodyTemplate: '',
    };
  }

  private requireRoutingType(eventType: unknown) {
    const type = text(eventType);
    if (!type) throw new BadRequestException('Не указан тип уведомления');
    if (type !== DELIVERY_POLICY_TYPE && !notificationEventDefinition(type)) {
      throw new BadRequestException('Неизвестный тип сервисного уведомления');
    }
    return type;
  }

  private async deliveryPolicyRow(tenantId: string) {
    const rows = await this.prisma.$queryRaw<RoutingPolicyRow[]>`
      SELECT "id", "tenantId", "eventType", "mode", "channels", "titleTemplate", "bodyTemplate", "enabled", "createdAt", "updatedAt"
      FROM "NotificationRoutingPolicy"
      WHERE "tenantId" = ${tenantId}
        AND "eventType" = ${DELIVERY_POLICY_TYPE}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  private async getDeliveryPolicy(tenantId: string) {
    return this.projectDeliveryPolicy(await this.deliveryPolicyRow(tenantId));
  }

  async listRoutingPolicies(tenantId: string) {
    const rows = await this.prisma.$queryRaw<RoutingPolicyRow[]>`
      SELECT "id", "tenantId", "eventType", "mode", "channels", "titleTemplate", "bodyTemplate", "enabled", "createdAt", "updatedAt"
      FROM "NotificationRoutingPolicy"
      WHERE "tenantId" = ${tenantId}
        AND "eventType" <> ${DELIVERY_POLICY_TYPE}
      ORDER BY "eventType" ASC
    `;
    const byType = new Map(rows.map((row) => [row.eventType, row]));
    return NOTIFICATION_EVENT_TYPES.map((type) => this.projectPolicy(byType.get(type) || null, type));
  }

  async getRoutingPolicy(tenantId: string, eventType: string) {
    const type = this.requireRoutingType(eventType);
    if (type === DELIVERY_POLICY_TYPE) return this.getDeliveryPolicy(tenantId);
    const rows = await this.prisma.$queryRaw<RoutingPolicyRow[]>`
      SELECT "id", "tenantId", "eventType", "mode", "channels", "titleTemplate", "bodyTemplate", "enabled", "createdAt", "updatedAt"
      FROM "NotificationRoutingPolicy"
      WHERE "tenantId" = ${tenantId}
        AND "eventType" = ${type}
      LIMIT 1
    `;
    return this.projectPolicy(rows[0] || null, type);
  }

  async saveRoutingPolicy(
    tenantId: string,
    eventType: string,
    input: { mode?: unknown; channels?: unknown; titleTemplate?: unknown; bodyTemplate?: unknown },
  ) {
    const type = this.requireRoutingType(eventType);
    const existing = await this.getRoutingPolicy(tenantId, type);
    const fallback = defaultTemplate(type);
    const mode = normalizeMode(input?.mode ?? existing.mode);
    const requestedChannels = input?.channels === undefined ? existing.channels : policyChannels(input?.channels);
    const channels = type === DELIVERY_POLICY_TYPE
      ? ['PUSH', ...requestedChannels.filter((channel) => ACTIVE_EXTERNAL_CHANNELS.has(channel))]
      : requestedChannels;
    const titleTemplate = type === DELIVERY_POLICY_TYPE
      ? ''
      : text(input?.titleTemplate) || existing.titleTemplate || fallback.title;
    const bodyTemplate = type === DELIVERY_POLICY_TYPE
      ? ''
      : text(input?.bodyTemplate) || existing.bodyTemplate || fallback.body;
    const id = randomUUID();
    const channelsJson = JSON.stringify(channels);
    await this.prisma.$executeRaw`
      INSERT INTO "NotificationRoutingPolicy" (
        "id", "tenantId", "eventType", "mode", "channels", "titleTemplate", "bodyTemplate", "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${tenantId}, ${type}, ${mode}, ${channelsJson}::jsonb, ${titleTemplate}, ${bodyTemplate}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId", "eventType") DO UPDATE
      SET "mode" = EXCLUDED."mode",
          "channels" = EXCLUDED."channels",
          "titleTemplate" = EXCLUDED."titleTemplate",
          "bodyTemplate" = EXCLUDED."bodyTemplate",
          "updatedAt" = CURRENT_TIMESTAMP
    `;
    return this.getRoutingPolicy(tenantId, type);
  }

  private recipientForChannel(identity: AccountIdentity, channel: string) {
    if (channel === 'EMAIL') return identity.email;
    if (channel === 'TELEGRAM') return identity.telegramId;
    return '';
  }

  private async queueDelivery(tenantId: string, notificationId: string, channel: string, recipientKey: string) {
    const recipient = text(recipientKey);
    if (!recipient) return false;
    await this.prisma.$executeRaw`
      INSERT INTO "NotificationDelivery" (
        "id", "tenantId", "notificationId", "channel", "recipientKey", "status", "createdAt", "error"
      ) VALUES (
        ${randomUUID()}, ${tenantId}, ${notificationId}, ${channel}, ${recipient}, 'created', CURRENT_TIMESTAMP, ''
      )
      ON CONFLICT ("notificationId", "channel", "recipientKey") DO NOTHING
    `;
    return true;
  }

  private async externalAllowed(
    tenantId: string,
    identity: AccountIdentity,
    channel: string,
    purposeValue: unknown,
  ) {
    const purpose = normalizeMessagePurpose(purposeValue);
    if (!purpose) return false;
    if (purpose !== 'MARKETING') return true;
    if (channel === 'PUSH') return false;
    const recipient = this.recipientForChannel(identity, channel);
    if (!recipient) return false;
    return this.documents.canSendMarketing(tenantId, channel, recipient);
  }

  private async queueChannel(
    tenantId: string,
    notificationId: string,
    channel: string,
    purpose: MessagePurpose,
    identity: AccountIdentity,
  ): Promise<RoutedDelivery[]> {
    if (channel === 'PUSH') {
      if (!(await this.externalAllowed(tenantId, identity, channel, purpose))) return [];
      const endpoints = await this.webPush.listAccountEndpoints(identity.accountId);
      const routed: RoutedDelivery[] = [];
      for (const endpoint of endpoints) {
        if (await this.queueDelivery(tenantId, notificationId, 'PUSH', endpoint)) {
          routed.push({ channel: 'PUSH', recipient: endpoint });
        }
      }
      return routed;
    }
    if (!ACTIVE_EXTERNAL_CHANNELS.has(channel)) return [];
    const recipient = this.recipientForChannel(identity, channel);
    if (!recipient || !(await this.externalAllowed(tenantId, identity, channel, purpose))) return [];
    const queued = await this.queueDelivery(tenantId, notificationId, channel, recipient);
    return queued ? [{ channel, recipient }] : [];
  }

  private async queueExternalByPolicy(
    tenantId: string,
    notificationId: string,
    _eventType: string,
    purpose: MessagePurpose,
    identity: AccountIdentity,
  ) {
    const policy = await this.getDeliveryPolicy(tenantId);
    const routed: RoutedDelivery[] = [];
    routed.push(...await this.queueChannel(tenantId, notificationId, 'PUSH', purpose, identity));

    const externalChannels = policy.channels.filter((channel) => ACTIVE_EXTERNAL_CHANNELS.has(channel));
    if (policy.mode === 'fallback') {
      for (const channel of externalChannels) {
        const external = await this.queueChannel(tenantId, notificationId, channel, purpose, identity);
        if (external.length) {
          routed.push(...external);
          break;
        }
      }
      return routed;
    }

    for (const channel of externalChannels) {
      routed.push(...await this.queueChannel(tenantId, notificationId, channel, purpose, identity));
    }
    return routed;
  }

  private async queueFallbackAfter(
    tenantId: string,
    notificationId: string,
    _eventType: string,
    purposeValue: unknown,
    identity: AccountIdentity,
    failedChannel: string,
  ) {
    const purpose = normalizeMessagePurpose(purposeValue);
    if (!purpose || !ACTIVE_EXTERNAL_CHANNELS.has(failedChannel)) return [];
    const policy = await this.getDeliveryPolicy(tenantId);
    if (policy.mode !== 'fallback') return [];
    const externalChannels = policy.channels.filter((channel) => ACTIVE_EXTERNAL_CHANNELS.has(channel));
    const failedIndex = externalChannels.indexOf(failedChannel);
    if (failedIndex < 0) return [];
    for (const channel of externalChannels.slice(failedIndex + 1)) {
      const routed = await this.queueChannel(tenantId, notificationId, channel, purpose, identity);
      if (routed.length) return routed;
    }
    return [];
  }

  private async createForAccountInternal(
    tenantId: string,
    accountId: string,
    input: NotificationInput,
    routeExternal: boolean,
  ) {
    const identity = await this.accountIdentity(tenantId, accountId);
    const notificationId = randomUUID();
    const inAppDeliveryId = randomUUID();
    const now = new Date();
    const purpose = normalizeMessagePurpose(input.purpose);
    if (!purpose) throw new BadRequestException('Не указан purpose уведомления');
    const type = text(input.type) || 'message';
    const title = text(input.title) || 'Уведомление';
    const body = text(input.body);
    const entityType = text(input.entityType);
    const entityId = text(input.entityId);
    const uei = text(input.uei) || identity.uei;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "Notification" (
          "id", "tenantId", "personPhone", "uei", "type", "purpose", "title", "body", "entityType", "entityId", "createdAt"
        ) VALUES (
          ${notificationId}, ${tenantId}, ${identity.personPhone}, ${uei}, ${type}, ${purpose}, ${title}, ${body}, ${entityType}, ${entityId}, ${now}
        )
      `;
      await tx.$executeRaw`
        INSERT INTO "NotificationDelivery" (
          "id", "tenantId", "notificationId", "channel", "recipientKey", "status", "createdAt", "deliveredAt", "error"
        ) VALUES (
          ${inAppDeliveryId}, ${tenantId}, ${notificationId}, 'IN_APP', ${identity.personPhone}, 'delivered', ${now}, ${now}, ''
        )
      `;
    });

    const routed = routeExternal ? await this.queueExternalByPolicy(tenantId, notificationId, type, purpose, identity) : [];
    if (routeExternal && routed.some((item) => item.channel === 'PUSH')) {
      await this.webPush.dispatchNotification(tenantId, notificationId);
    }
    return { notification: await this.getForAccount(tenantId, accountId, notificationId), routed };
  }

  async createInAppForAccount(tenantId: string, accountId: string, input: NotificationInput) {
    const created = await this.createForAccountInternal(tenantId, accountId, input, false);
    return created.notification;
  }

  async createForAccount(tenantId: string, accountId: string, input: NotificationInput) {
    return this.createForAccountInternal(tenantId, accountId, input, true);
  }

  async createEventForPerson(
    tenantId: string,
    personValue: unknown,
    input: { type?: unknown; entityType?: unknown; entityId?: unknown; context?: unknown },
  ) {
    const person = objectValue(personValue);
    const type = text(input?.type);
    if (!type) throw new BadRequestException('Не указан тип уведомления');
    const definition = notificationEventDefinition(type);
    if (!definition) throw new BadRequestException('Неизвестный тип сервисного уведомления');

    let accountId = accountIdsFromPerson(person)[0] || '';
    if (!accountId) {
      const identity = await this.accountIdentityByPhone(tenantId, text(person.phone));
      accountId = text(identity?.accountId);
    }
    if (!accountId) return { notification: null, routed: [], blocked: 'ACCOUNT_REQUIRED' };

    const policy = await this.getRoutingPolicy(tenantId, type);
    const context = {
      ...objectValue(input?.context),
      person: {
        name: text(person.name),
        surname: text(person.surname),
        phone: text(person.phone),
      },
    };
    return this.createForAccount(tenantId, accountId, {
      purpose: definition.purpose,
      type,
      title: renderTemplate(policy.titleTemplate, context),
      body: renderTemplate(policy.bodyTemplate, context),
      entityType: text(input?.entityType),
      entityId: text(input?.entityId),
    });
  }

  async listForAccount(tenantId: string, accountId: string) {
    const { personPhone } = await this.accountIdentity(tenantId, accountId);
    const rows = await this.prisma.$queryRaw<NotificationRow[]>`
      SELECT
        n."id", n."tenantId", n."personPhone", n."uei", n."type", n."purpose", n."title", n."body",
        n."entityType", n."entityId", n."createdAt",
        d."status" AS "deliveryStatus", d."createdAt" AS "deliveryCreatedAt",
        d."sentAt", d."deliveredAt", d."readAt", d."failedAt", d."error"
      FROM "Notification" n
      INNER JOIN "NotificationDelivery" d
        ON d."notificationId" = n."id"
       AND d."tenantId" = n."tenantId"
       AND d."channel" = 'IN_APP'
       AND d."recipientKey" = ${personPhone}
      WHERE n."tenantId" = ${tenantId}
        AND n."personPhone" = ${personPhone}
      ORDER BY n."createdAt" DESC, n."id" DESC
      LIMIT 200
    `;
    const items = rows.map((row) => this.project(row));
    return { unreadCount: items.filter((item) => !item.read).length, items };
  }

  async getForAccount(tenantId: string, accountId: string, notificationId: string) {
    const { personPhone } = await this.accountIdentity(tenantId, accountId);
    const rows = await this.prisma.$queryRaw<NotificationRow[]>`
      SELECT
        n."id", n."tenantId", n."personPhone", n."uei", n."type", n."purpose", n."title", n."body",
        n."entityType", n."entityId", n."createdAt",
        d."status" AS "deliveryStatus", d."createdAt" AS "deliveryCreatedAt",
        d."sentAt", d."deliveredAt", d."readAt", d."failedAt", d."error"
      FROM "Notification" n
      INNER JOIN "NotificationDelivery" d
        ON d."notificationId" = n."id"
       AND d."tenantId" = n."tenantId"
       AND d."channel" = 'IN_APP'
       AND d."recipientKey" = ${personPhone}
      WHERE n."tenantId" = ${tenantId}
        AND n."personPhone" = ${personPhone}
        AND n."id" = ${notificationId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Уведомление не найдено');
    return this.project(row);
  }

  async markReadForAccount(tenantId: string, accountId: string, notificationId: string) {
    const { personPhone } = await this.accountIdentity(tenantId, accountId);
    const current = await this.getForAccount(tenantId, accountId, notificationId);
    if (!current.read) {
      const now = new Date();
      await this.prisma.$executeRaw`
        UPDATE "NotificationDelivery"
        SET "status" = 'read', "readAt" = ${now}
        WHERE "tenantId" = ${tenantId}
          AND "notificationId" = ${notificationId}
          AND "channel" = 'IN_APP'
          AND "recipientKey" = ${personPhone}
      `;
    }
    return this.getForAccount(tenantId, accountId, notificationId);
  }

  private async pendingDeliveries(tenantId: string, channel: 'EMAIL' | 'TELEGRAM', limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    return this.prisma.$queryRaw<ExternalDeliveryRow[]>`
      SELECT
        d."id" AS "deliveryId", d."notificationId", d."tenantId", d."recipientKey", d."status",
        d."createdAt", d."sentAt", d."deliveredAt", d."failedAt", d."error",
        n."title", n."body", n."type", n."purpose", n."entityType", n."entityId", n."personPhone", n."uei"
      FROM "NotificationDelivery" d
      INNER JOIN "Notification" n
        ON n."id" = d."notificationId"
       AND n."tenantId" = d."tenantId"
      WHERE d."tenantId" = ${tenantId}
        AND d."channel" = ${channel}
        AND d."status" = 'created'
      ORDER BY d."createdAt" ASC, d."id" ASC
      LIMIT ${safeLimit}
    `;
  }

  async pendingEmailDeliveries(tenantId: string, limit = 100) {
    return this.pendingDeliveries(tenantId, 'EMAIL', limit);
  }

  async pendingTelegramDeliveries(tenantId: string, limit = 100) {
    return this.pendingDeliveries(tenantId, 'TELEGRAM', limit);
  }

  private async canSendDelivery(tenantId: string, notificationId: string, channel: 'EMAIL' | 'TELEGRAM') {
    const rows = await this.prisma.$queryRaw<Array<{ personPhone: string; purpose: string | null }>>`
      SELECT n."personPhone", n."purpose"
      FROM "Notification" n
      INNER JOIN "NotificationDelivery" d
        ON d."notificationId" = n."id"
       AND d."tenantId" = n."tenantId"
       AND d."channel" = ${channel}
      WHERE n."tenantId" = ${tenantId}
        AND n."id" = ${notificationId}
      LIMIT 1
    `;
    const identity = rows[0]?.personPhone ? await this.accountIdentityByPhone(tenantId, rows[0].personPhone) : null;
    return Boolean(identity && await this.externalAllowed(tenantId, identity, channel, rows[0]?.purpose));
  }

  async canSendEmailDelivery(tenantId: string, notificationId: string) {
    return this.canSendDelivery(tenantId, notificationId, 'EMAIL');
  }

  async canSendTelegramDelivery(tenantId: string, notificationId: string) {
    return this.canSendDelivery(tenantId, notificationId, 'TELEGRAM');
  }

  private async markDeliverySent(tenantId: string, deliveryId: string, channel: 'EMAIL' | 'TELEGRAM') {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "NotificationDelivery"
      SET "status" = 'sent', "sentAt" = ${now}, "failedAt" = NULL, "error" = ''
      WHERE "tenantId" = ${tenantId} AND "id" = ${deliveryId} AND "channel" = ${channel}
    `;
    return { deliveryId, status: 'sent', sentAt: now };
  }

  private async markDeliveryDelivered(tenantId: string, deliveryId: string, channel: 'EMAIL' | 'TELEGRAM') {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "NotificationDelivery"
      SET "status" = 'delivered', "deliveredAt" = ${now}, "failedAt" = NULL, "error" = ''
      WHERE "tenantId" = ${tenantId} AND "id" = ${deliveryId} AND "channel" = ${channel}
    `;
    return { deliveryId, status: 'delivered', deliveredAt: now };
  }

  private async markDeliveryFailed(tenantId: string, deliveryId: string, channel: 'EMAIL' | 'TELEGRAM', error: unknown) {
    const rows = await this.prisma.$queryRaw<Array<{ notificationId: string; channel: string; personPhone: string; type: string; purpose: string | null }>>`
      SELECT d."notificationId", d."channel", n."personPhone", n."type", n."purpose"
      FROM "NotificationDelivery" d
      INNER JOIN "Notification" n ON n."id" = d."notificationId" AND n."tenantId" = d."tenantId"
      WHERE d."tenantId" = ${tenantId} AND d."id" = ${deliveryId} AND d."channel" = ${channel}
      LIMIT 1
    `;
    const current = rows[0];
    const now = new Date();
    const message = text(error).slice(0, 2000);
    await this.prisma.$executeRaw`
      UPDATE "NotificationDelivery"
      SET "status" = 'failed', "failedAt" = ${now}, "error" = ${message}
      WHERE "tenantId" = ${tenantId} AND "id" = ${deliveryId} AND "channel" = ${channel}
    `;

    if (current) {
      const identity = await this.accountIdentityByPhone(tenantId, current.personPhone);
      if (identity) {
        await this.queueFallbackAfter(
          tenantId,
          current.notificationId,
          current.type,
          current.purpose,
          identity,
          current.channel,
        );
      }
    }
    return { deliveryId, status: 'failed', failedAt: now, error: message };
  }

  async markEmailSent(tenantId: string, deliveryId: string) {
    return this.markDeliverySent(tenantId, deliveryId, 'EMAIL');
  }

  async markEmailDelivered(tenantId: string, deliveryId: string) {
    return this.markDeliveryDelivered(tenantId, deliveryId, 'EMAIL');
  }

  async markEmailFailed(tenantId: string, deliveryId: string, error: unknown) {
    return this.markDeliveryFailed(tenantId, deliveryId, 'EMAIL', error);
  }

  async markTelegramSent(tenantId: string, deliveryId: string) {
    return this.markDeliverySent(tenantId, deliveryId, 'TELEGRAM');
  }

  async markTelegramFailed(tenantId: string, deliveryId: string, error: unknown) {
    return this.markDeliveryFailed(tenantId, deliveryId, 'TELEGRAM', error);
  }
}
