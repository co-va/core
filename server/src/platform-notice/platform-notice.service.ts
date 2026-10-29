import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma.service';

const SERVICE_UNSEEN_ROLLOUT_AT = new Date('2026-10-29T17:20:31.000Z');

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

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
export class PlatformNoticeService {
  constructor(private readonly prisma: PrismaService) {}

  private pushConfig() {
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

  pushConfiguration() {
    const config = this.pushConfig();
    return { enabled: config.enabled, publicKey: config.enabled ? config.publicKey : '' };
  }

  async pushSubscriptionState(platformAccountId: string, endpointValue: unknown) {
    const endpoint = text(endpointValue);
    if (!endpoint) return { subscribed: false, enabled: this.pushConfig().enabled };
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "PlatformPushSubscription"
      WHERE "platformAccountId" = ${platformAccountId}
        AND "endpoint" = ${endpoint}
      LIMIT 1
    `;
    return { subscribed: Boolean(rows[0]), enabled: this.pushConfig().enabled };
  }

  async savePushSubscription(platformAccountId: string, input: unknown, userAgent = '') {
    const config = this.pushConfig();
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

  async deletePushSubscription(platformAccountId: string, endpointValue: unknown) {
    const endpoint = text(endpointValue);
    if (!endpoint) return { subscribed: false };
    await this.prisma.$executeRaw`
      DELETE FROM "PlatformPushSubscription"
      WHERE "platformAccountId" = ${platformAccountId}
        AND "endpoint" = ${endpoint}
    `;
    return { subscribed: false };
  }

  private async unreadCount(platformAccountId: string, tenantId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
      SELECT (
        (
          SELECT COUNT(*)
          FROM "CommunicationMessage" m
          INNER JOIN "Membership" membership
            ON membership."tenantId" = m."tenantId"
           AND membership."platformAccountId" = ${platformAccountId}
          WHERE (${tenantId} = '' OR m."tenantId" = ${tenantId})
            AND m."direction" = 'inbound'
            AND m."purpose" = 'DIRECT'
            AND m."readAt" IS NULL
            AND m."failedAt" IS NULL
            AND m."status" <> 'failed'
        ) + (
          SELECT COUNT(*)
          FROM "PlatformNotice" n
          WHERE n."platformAccountId" = ${platformAccountId}
            AND (${tenantId} = '' OR n."tenantId" = ${tenantId})
            AND n."type" = 'BOOKING_CREATED'
            AND n."createdAt" >= ${SERVICE_UNSEEN_ROLLOUT_AT}
            AND n."readAt" IS NULL
        )
      )::int AS "count"
    `;
    const count = Number(rows[0]?.count || 0);
    return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  }

  private async dispatchPush(
    platformAccountId: string,
    notice: { id: string; tenantId?: string; title: string; body: string; type: string; metadata: unknown },
  ) {
    const config = this.pushConfig();
    if (!config.enabled) return { sent: 0, failed: 0 };
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

    const rows = await this.prisma.$queryRaw<Array<{ endpoint: string; p256dh: string; auth: string }>>`
      SELECT "endpoint", "p256dh", "auth"
      FROM "PlatformPushSubscription"
      WHERE "platformAccountId" = ${platformAccountId}
      ORDER BY "updatedAt" DESC
    `;
    const metadata = notice.metadata && typeof notice.metadata === 'object' && !Array.isArray(notice.metadata)
      ? notice.metadata as Record<string, any>
      : {};
    const tenantId = text(notice.tenantId || metadata.tenantId);
    const explicitUrl = text(metadata.url);
    const url = explicitUrl || (tenantId ? `/admin/?liveRequest=${encodeURIComponent(tenantId)}` : '/admin/');
    const badgeCount = await this.unreadCount(platformAccountId, tenantId);
    const payload = JSON.stringify({
      notificationId: notice.id,
      title: notice.title,
      body: notice.body,
      type: notice.type,
      tag: notice.id,
      badgeCount,
      url,
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

  async list(tenantId: string, platformAccountId: string) {
    const rows = await this.prisma.platformNotice.findMany({
      where: { tenantId, platformAccountId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      metadata: row.metadata,
      readAt: row.readAt?.toISOString() || '',
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async markRead(tenantId: string, platformAccountId: string, noticeId: string) {
    const row = await this.prisma.platformNotice.findUnique({ where: { id: noticeId } });
    if (!row || row.tenantId !== tenantId || row.platformAccountId !== platformAccountId) {
      throw new NotFoundException('Уведомление не найдено');
    }
    const updated = await this.prisma.platformNotice.update({
      where: { id: noticeId },
      data: { readAt: row.readAt || new Date() },
    });
    return {
      id: updated.id,
      readAt: updated.readAt?.toISOString() || '',
    };
  }

  async createForTenantOwner(
    tenantId: string,
    input: { type: string; title: string; body?: string; metadata?: unknown },
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: { tenantId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
      select: { platformAccountId: true },
    });
    if (!membership) return null;
    const sourceMetadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata as Record<string, unknown>
      : {};
    const notice = await this.prisma.platformNotice.create({
      data: {
        tenantId,
        platformAccountId: membership.platformAccountId,
        type: input.type,
        title: input.title,
        body: input.body || '',
        metadata: json({ url: '/', ...sourceMetadata }),
      },
    });
    await this.dispatchPush(membership.platformAccountId, notice).catch(() => ({ sent: 0, failed: 0 }));
    return notice;
  }

  async pushToTenantOwner(
    tenantId: string,
    input: { type: string; title: string; body?: string; metadata?: unknown },
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: { tenantId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
      select: { platformAccountId: true },
    });
    if (!membership) return { sent: 0, failed: 0 };
    return this.dispatchPush(membership.platformAccountId, {
      id: randomUUID(),
      tenantId,
      title: input.title,
      body: input.body || '',
      type: input.type,
      metadata: json(input.metadata),
    });
  }

  async createForPlatformAdmins(
    input: { type: string; title: string; body?: string; metadata?: unknown },
  ) {
    const admins = await this.prisma.platformAdmin.findMany({
      select: { platformAccountId: true },
      orderBy: { createdAt: 'asc' },
    });
    const created = [];
    for (const admin of admins) {
      const memberships = await this.prisma.membership.findMany({
        where: { platformAccountId: admin.platformAccountId },
        include: { tenant: { include: { saasAccess: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const membership = memberships.find((item) => item.tenant.saasAccess?.isOwnerBook) || memberships[0];
      if (!membership) continue;
      const notice = await this.prisma.platformNotice.create({
        data: {
          tenantId: membership.tenantId,
          platformAccountId: admin.platformAccountId,
          type: input.type,
          title: input.title,
          body: input.body || '',
          metadata: json(input.metadata),
        },
      });
      await this.dispatchPush(admin.platformAccountId, notice).catch(() => ({ sent: 0, failed: 0 }));
      created.push(notice);
    }
    return created;
  }

  async resolveLiveRequest(targetTenantId: string) {
    await this.prisma.$executeRaw`
      UPDATE "PlatformNotice"
      SET "readAt" = COALESCE("readAt", CURRENT_TIMESTAMP)
      WHERE "type" = 'LIVE_REQUESTED'
        AND "metadata"->>'tenantId' = ${targetTenantId}
        AND "readAt" IS NULL
    `;
  }
}
