import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ProfessionalPushService } from '../push/professional-push.service';

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

@Injectable()
export class PlatformNoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: ProfessionalPushService,
  ) {}

  private async unreadCount(platformAccountId: string, tenantId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
      SELECT COUNT(*)::int AS "count"
      FROM "PlatformNotice"
      WHERE "platformAccountId" = ${platformAccountId}
        AND (${tenantId} = '' OR "tenantId" = ${tenantId})
        AND "readAt" IS NULL
    `;
    const count = Number(rows[0]?.count || 0);
    return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
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
    const badgeCount = await this.unreadCount(membership.platformAccountId, tenantId);
    await this.push.send(membership.platformAccountId, {
      id: notice.id,
      title: notice.title,
      body: notice.body,
      type: notice.type,
      badgeCount,
      url: text((notice.metadata as Record<string, unknown> | null)?.url) || '/',
    }).catch(() => ({ sent: 0, failed: 0 }));
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
    const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata as Record<string, unknown>
      : {};
    return this.push.send(membership.platformAccountId, {
      id: randomUUID(),
      title: input.title,
      body: input.body || '',
      type: input.type,
      badgeCount: await this.unreadCount(membership.platformAccountId, tenantId),
      url: text(metadata.url) || '/',
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
      await this.push.send(admin.platformAccountId, {
        id: notice.id,
        title: notice.title,
        body: notice.body,
        type: notice.type,
        badgeCount: await this.unreadCount(admin.platformAccountId, membership.tenantId),
        url: text((notice.metadata as Record<string, unknown> | null)?.url) || '/admin/',
      }).catch(() => ({ sent: 0, failed: 0 }));
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
