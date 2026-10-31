import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma.service';

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
export class ProfessionalPushService {
  constructor(private readonly prisma: PrismaService) {}

  private config() {
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
    const config = this.config();
    return { enabled: config.enabled, publicKey: config.enabled ? config.publicKey : '' };
  }

  async subscriptionState(platformAccountId: string, endpointValue: unknown) {
    const endpoint = text(endpointValue);
    if (!endpoint) return { subscribed: false, enabled: this.config().enabled };
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "PlatformPushSubscription"
      WHERE "platformAccountId" = ${platformAccountId}
        AND "endpoint" = ${endpoint}
      LIMIT 1
    `;
    return { subscribed: Boolean(rows[0]), enabled: this.config().enabled };
  }

  async saveSubscription(platformAccountId: string, input: unknown, userAgent = '') {
    const config = this.config();
    if (!config.enabled) return { subscribed: false, enabled: false };
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, any> : {};
    const endpoint = text(source.endpoint);
    const keys = source.keys && typeof source.keys === 'object' && !Array.isArray(source.keys)
      ? source.keys as Record<string, any>
      : {};
    const p256dh = text(keys.p256dh);
    const auth = text(keys.auth);
    if (!validEndpoint(endpoint) || !p256dh || !auth) throw new BadRequestException('Некорректная Push-подписка');

    const account = await this.prisma.platformAccount.findUnique({
      where: { id: platformAccountId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Платформенный аккаунт не найден');

    await this.prisma.$executeRaw`
      INSERT INTO "PlatformPushSubscription" (
        "id", "platformAccountId", "endpoint", "p256dh", "auth", "userAgent", "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${platformAccountId}, ${endpoint}, ${p256dh}, ${auth}, ${text(userAgent).slice(0, 1000)},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("endpoint") DO UPDATE
      SET "platformAccountId" = EXCLUDED."platformAccountId",
          "p256dh" = EXCLUDED."p256dh",
          "auth" = EXCLUDED."auth",
          "userAgent" = EXCLUDED."userAgent",
          "updatedAt" = CURRENT_TIMESTAMP
    `;
    return { subscribed: true, enabled: true };
  }

  async deleteSubscription(platformAccountId: string, endpointValue: unknown) {
    const endpoint = text(endpointValue);
    if (!endpoint) return { subscribed: false };
    await this.prisma.$executeRaw`
      DELETE FROM "PlatformPushSubscription"
      WHERE "platformAccountId" = ${platformAccountId}
        AND "endpoint" = ${endpoint}
    `;
    return { subscribed: false };
  }

  async send(
    platformAccountId: string,
    input: { id: string; title: string; body?: string; type: string; badgeCount?: number; url?: string },
  ) {
    const config = this.config();
    if (!config.enabled) return { sent: 0, failed: 0 };
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

    const rows = await this.prisma.$queryRaw<Array<{ endpoint: string; p256dh: string; auth: string }>>`
      SELECT "endpoint", "p256dh", "auth"
      FROM "PlatformPushSubscription"
      WHERE "platformAccountId" = ${platformAccountId}
      ORDER BY "updatedAt" DESC
    `;
    const badgeCount = Math.max(0, Math.trunc(Number(input.badgeCount) || 0));
    const payload = JSON.stringify({
      notificationId: text(input.id),
      title: text(input.title),
      body: text(input.body),
      type: text(input.type),
      tag: text(input.id),
      badgeCount,
      url: text(input.url) || '/',
    });

    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await webpush.sendNotification({
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        }, payload, { TTL: 86400, urgency: 'high' });
        sent += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await this.prisma.$executeRaw`DELETE FROM "PlatformPushSubscription" WHERE "endpoint" = ${row.endpoint}`;
        }
        failed += 1;
      }
    }
    return { sent, failed };
  }
}
