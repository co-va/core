import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma.service';

type WebPushSubscriptionRow = {
  id: string;
  tenantId: string;
  accountId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
  createdAt: Date;
  updatedAt: Date;
};

type PushDeliveryRow = {
  deliveryId: string;
  notificationId: string;
  tenantId: string;
  recipientKey: string;
  title: string;
  body: string;
  type: string;
  entityType: string;
  entityId: string;
  accountId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function validEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

@Injectable()
export class WebPushService {
  constructor(private readonly prisma: PrismaService) {}

  private vapid() {
    const publicKey = text(process.env.WEB_PUSH_VAPID_PUBLIC_KEY);
    const privateKey = text(process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
    const subject = text(process.env.WEB_PUSH_VAPID_SUBJECT);
    return {
      enabled: Boolean(publicKey && privateKey && subject),
      publicKey,
      privateKey,
      subject,
    };
  }

  configuration() {
    const config = this.vapid();
    return { enabled: config.enabled, publicKey: config.enabled ? config.publicKey : '' };
  }

  private configureSender() {
    const config = this.vapid();
    if (!config.enabled) throw new ServiceUnavailableException('Web Push не настроен');
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    return config;
  }

  private async ensureAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Аккаунт не найден');
    return account;
  }

  async saveSubscription(
    tenantId: string,
    accountId: string,
    input: unknown,
    userAgent = '',
  ) {
    this.configureSender();
    await this.ensureAccount(accountId);
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, any> : {};
    const endpoint = text(source.endpoint);
    const keys = source.keys && typeof source.keys === 'object' && !Array.isArray(source.keys)
      ? source.keys as Record<string, any>
      : {};
    const p256dh = text(keys.p256dh);
    const auth = text(keys.auth);
    if (!validEndpoint(endpoint) || !p256dh || !auth) throw new BadRequestException('Некорректная Push-подписка');

    // A browser Push endpoint belongs to the global Account/device, not to one
    // professional relationship. tenantId records the registration context while
    // routing is resolved by accountId.
    await this.prisma.$executeRaw`
      INSERT INTO "WebPushSubscription" (
        "id", "tenantId", "accountId", "endpoint", "p256dh", "auth", "userAgent", "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${tenantId}, ${accountId}, ${endpoint}, ${p256dh}, ${auth}, ${text(userAgent).slice(0, 1000)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("endpoint") DO UPDATE
      SET "tenantId" = EXCLUDED."tenantId",
          "accountId" = EXCLUDED."accountId",
          "p256dh" = EXCLUDED."p256dh",
          "auth" = EXCLUDED."auth",
          "userAgent" = EXCLUDED."userAgent",
          "updatedAt" = CURRENT_TIMESTAMP
    `;
    return { subscribed: true, endpoint };
  }

  async deleteSubscription(_tenantId: string, accountId: string, endpointValue: unknown) {
    const endpoint = text(endpointValue);
    if (!endpoint) return { subscribed: false };
    await this.prisma.$executeRaw`
      DELETE FROM "WebPushSubscription"
      WHERE "accountId" = ${accountId} AND "endpoint" = ${endpoint}
    `;
    return { subscribed: false };
  }

  async listAccountEndpoints(_tenantId: string, accountId: string) {
    if (!this.vapid().enabled) return [];
    const rows = await this.prisma.$queryRaw<Array<{ endpoint: string }>>`
      SELECT "endpoint"
      FROM "WebPushSubscription"
      WHERE "accountId" = ${accountId}
      ORDER BY "updatedAt" DESC
    `;
    return rows.map((row) => text(row.endpoint)).filter(Boolean);
  }

  private targetUrl(tenantId: string) {
    const base = text(process.env.ACCOUNT_APP_URL).replace(/\/$/, '');
    if (!base) return `/?booking=${encodeURIComponent(tenantId)}`;
    const url = new URL(base);
    url.searchParams.set('booking', tenantId);
    return url.toString();
  }

  private async globalUnreadCount(accountId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
      SELECT COUNT(*) AS "count"
      FROM "NotificationDelivery" d
      INNER JOIN "AccountContact" c
        ON c."accountId" = ${accountId}
       AND c."type" = 'PHONE'
       AND c."value" = d."recipientKey"
      WHERE d."channel" = 'IN_APP'
        AND d."readAt" IS NULL
    `;
    const count = Number(rows[0]?.count || 0);
    return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  }

  private async markSent(tenantId: string, deliveryId: string) {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "NotificationDelivery"
      SET "status" = 'sent', "sentAt" = ${now}, "failedAt" = NULL, "error" = ''
      WHERE "tenantId" = ${tenantId} AND "id" = ${deliveryId} AND "channel" = 'PUSH'
    `;
  }

  private async markFailed(tenantId: string, deliveryId: string, error: unknown) {
    const now = new Date();
    const message = error instanceof Error ? error.message : text(error);
    await this.prisma.$executeRaw`
      UPDATE "NotificationDelivery"
      SET "status" = 'failed', "failedAt" = ${now}, "error" = ${message.slice(0, 2000)}
      WHERE "tenantId" = ${tenantId} AND "id" = ${deliveryId} AND "channel" = 'PUSH'
    `;
  }

  private async removeEndpoint(endpoint: string) {
    await this.prisma.$executeRaw`DELETE FROM "WebPushSubscription" WHERE "endpoint" = ${endpoint}`;
  }

  async dispatchNotification(tenantId: string, notificationId: string) {
    if (!this.vapid().enabled) return { sent: 0, failed: 0 };
    this.configureSender();
    const rows = await this.prisma.$queryRaw<PushDeliveryRow[]>`
      SELECT
        d."id" AS "deliveryId", d."notificationId", d."tenantId", d."recipientKey",
        n."title", n."body", n."type", n."entityType", n."entityId",
        s."accountId", s."endpoint", s."p256dh", s."auth"
      FROM "NotificationDelivery" d
      INNER JOIN "Notification" n
        ON n."id" = d."notificationId" AND n."tenantId" = d."tenantId"
      INNER JOIN "WebPushSubscription" s
        ON s."endpoint" = d."recipientKey"
      WHERE d."tenantId" = ${tenantId}
        AND d."notificationId" = ${notificationId}
        AND d."channel" = 'PUSH'
        AND d."status" = 'created'
      ORDER BY d."createdAt" ASC, d."id" ASC
    `;

    let sent = 0;
    let failed = 0;
    const unreadByAccount = new Map<string, number>();
    for (const row of rows) {
      if (!unreadByAccount.has(row.accountId)) {
        unreadByAccount.set(row.accountId, await this.globalUnreadCount(row.accountId));
      }
      const payload = JSON.stringify({
        notificationId: row.notificationId,
        title: row.title,
        body: row.body,
        type: row.type,
        entityType: row.entityType,
        entityId: row.entityId,
        tag: row.notificationId,
        badgeCount: unreadByAccount.get(row.accountId) || 0,
        url: this.targetUrl(tenantId),
      });
      try {
        await webpush.sendNotification({
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        }, payload, { TTL: 86400, urgency: 'normal' });
        await this.markSent(tenantId, row.deliveryId);
        sent += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) await this.removeEndpoint(row.endpoint);
        await this.markFailed(tenantId, row.deliveryId, error);
        failed += 1;
      }
    }
    return { sent, failed };
  }
}
