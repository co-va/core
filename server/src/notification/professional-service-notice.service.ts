import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ProfessionalPushService } from '../push/professional-push.service';

type ServiceNoticeRow = {
  id: string;
  tenantId: string;
  platformAccountId: string;
  type: string;
  title: string;
  body: string;
  metadata: unknown;
  readAt: Date | null;
  createdAt: Date;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function project(row: ServiceNoticeRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    metadata: row.metadata,
    readAt: row.readAt?.toISOString() || '',
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ProfessionalServiceNoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: ProfessionalPushService,
  ) {}

  private async owner(tenantId: string) {
    return this.prisma.membership.findFirst({
      where: { tenantId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
      select: { platformAccountId: true },
    });
  }

  private async unreadCount(tenantId: string, platformAccountId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
      SELECT COUNT(*)::int AS "count"
      FROM "ProfessionalServiceNotice"
      WHERE "tenantId" = ${tenantId}
        AND "platformAccountId" = ${platformAccountId}
        AND "readAt" IS NULL
    `;
    const count = Number(rows[0]?.count || 0);
    return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  }

  async list(tenantId: string, platformAccountId: string) {
    const rows = await this.prisma.$queryRaw<ServiceNoticeRow[]>`
      SELECT "id", "tenantId", "platformAccountId", "type", "title", "body", "metadata", "readAt", "createdAt"
      FROM "ProfessionalServiceNotice"
      WHERE "tenantId" = ${tenantId}
        AND "platformAccountId" = ${platformAccountId}
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT 200
    `;
    return rows.map(project);
  }

  async markRead(tenantId: string, platformAccountId: string, noticeId: string) {
    const rows = await this.prisma.$queryRaw<ServiceNoticeRow[]>`
      SELECT "id", "tenantId", "platformAccountId", "type", "title", "body", "metadata", "readAt", "createdAt"
      FROM "ProfessionalServiceNotice"
      WHERE "id" = ${noticeId}
        AND "tenantId" = ${tenantId}
        AND "platformAccountId" = ${platformAccountId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Сервисное уведомление не найдено');
    if (!row.readAt) {
      await this.prisma.$executeRaw`
        UPDATE "ProfessionalServiceNotice"
        SET "readAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${noticeId}
          AND "tenantId" = ${tenantId}
          AND "platformAccountId" = ${platformAccountId}
      `;
    }
    return { id: row.id, readAt: row.readAt?.toISOString() || new Date().toISOString() };
  }

  async createForTenantOwner(
    tenantId: string,
    input: { type: string; title: string; body?: string; metadata?: unknown },
  ) {
    const membership = await this.owner(tenantId);
    if (!membership) return null;
    const id = randomUUID();
    const metadata = json(input.metadata);
    const title = text(input.title) || 'Уведомление';
    const body = text(input.body);
    const type = text(input.type);

    const rows = await this.prisma.$queryRaw<ServiceNoticeRow[]>`
      INSERT INTO "ProfessionalServiceNotice" (
        "id", "tenantId", "platformAccountId", "type", "title", "body", "metadata", "createdAt"
      ) VALUES (
        ${id}, ${tenantId}, ${membership.platformAccountId}, ${type}, ${title}, ${body}, ${JSON.stringify(metadata)}::jsonb, CURRENT_TIMESTAMP
      )
      RETURNING "id", "tenantId", "platformAccountId", "type", "title", "body", "metadata", "readAt", "createdAt"
    `;
    const notice = rows[0];
    if (!notice) return null;
    const badgeCount = await this.unreadCount(tenantId, membership.platformAccountId);
    await this.push.send(membership.platformAccountId, {
      id: notice.id,
      type: notice.type,
      title: notice.title,
      body: notice.body,
      badgeCount,
      url: '/',
    }).catch(() => ({ sent: 0, failed: 0 }));
    return project(notice);
  }
}
