import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type UnreadRow = {
  tenantId: string;
  unreadCount: number | bigint | string;
};

type ServiceUnseenRow = {
  notificationId: string;
  tenantId: string;
  type: string;
  entityType: string;
  entityId: string;
  createdAt: Date;
  date: string | null;
};

const SERVICE_UNSEEN_ROLLOUT_AT = new Date('2026-10-29T17:20:31.000Z');

function countValue(value: number | bigint | string | undefined) {
  const count = Number(value || 0);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

@Injectable()
export class AccountUnreadService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(accountId: string) {
    await this.prisma.$executeRaw`
      UPDATE "CommunicationMessage" m
      SET "status" = 'delivered',
          "deliveredAt" = COALESCE(m."deliveredAt", CURRENT_TIMESTAMP)
      FROM "AccountTenantLink" l, "AccountContact" c
      WHERE l."accountId" = ${accountId}
        AND c."accountId" = ${accountId}
        AND c."type" = 'PHONE'
        AND l."tenantId" = m."tenantId"
        AND c."value" = m."personPhone"
        AND m."direction" = 'outbound'
        AND m."purpose" = 'DIRECT'
        AND m."readAt" IS NULL
        AND m."failedAt" IS NULL
        AND m."status" <> 'failed'
        AND m."deliveredAt" IS NULL
    `;

    const chatRows = await this.prisma.$queryRaw<UnreadRow[]>`
      SELECT m."tenantId", COUNT(*)::int AS "unreadCount"
      FROM "CommunicationMessage" m
      INNER JOIN "AccountTenantLink" l
        ON l."accountId" = ${accountId}
       AND l."tenantId" = m."tenantId"
      INNER JOIN "AccountContact" c
        ON c."accountId" = ${accountId}
       AND c."type" = 'PHONE'
       AND c."value" = m."personPhone"
      WHERE m."direction" = 'outbound'
        AND m."purpose" = 'DIRECT'
        AND m."readAt" IS NULL
        AND m."failedAt" IS NULL
        AND m."status" <> 'failed'
      GROUP BY m."tenantId"
    `;

    const byTenant = chatRows
      .map((row) => ({
        tenantId: String(row.tenantId || '').trim(),
        unreadCount: countValue(row.unreadCount),
      }))
      .filter((row) => Boolean(row.tenantId))
      .sort((left, right) => left.tenantId.localeCompare(right.tenantId));

    return {
      total: byTenant.reduce((sum, row) => sum + row.unreadCount, 0),
      byTenant,
    };
  }

  async serviceUnseen(accountId: string) {
    const rows = await this.prisma.$queryRaw<ServiceUnseenRow[]>`
      SELECT
        n."id" AS "notificationId",
        n."tenantId",
        n."type",
        n."entityType",
        n."entityId",
        n."createdAt",
        NULLIF(r."data"->>'date', '') AS "date"
      FROM "Notification" n
      INNER JOIN "NotificationDelivery" d
        ON d."notificationId" = n."id"
       AND d."tenantId" = n."tenantId"
       AND d."channel" = 'IN_APP'
      INNER JOIN "AccountTenantLink" l
        ON l."accountId" = ${accountId}
       AND l."tenantId" = n."tenantId"
      INNER JOIN "AccountContact" c
        ON c."accountId" = ${accountId}
       AND c."type" = 'PHONE'
       AND c."value" = d."recipientKey"
      LEFT JOIN "BusinessRecord" r
        ON r."tenantId" = n."tenantId"
       AND r."recordId" = n."entityId"
      WHERE n."purpose" = 'SERVICE'
        AND n."entityType" = 'record'
        AND n."createdAt" >= ${SERVICE_UNSEEN_ROLLOUT_AT}
        AND d."readAt" IS NULL
      ORDER BY n."createdAt" DESC, n."id" DESC
    `;
    const items = rows.map((row) => ({
      id: row.notificationId,
      tenantId: text(row.tenantId),
      type: text(row.type),
      entityType: text(row.entityType),
      entityId: text(row.entityId),
      recordIds: [text(row.entityId)].filter(Boolean),
      date: text(row.date),
      createdAt: row.createdAt,
    }));
    return { total: items.length, items };
  }

  async markServiceRecordsSeen(accountId: string, recordIdsValue: unknown) {
    const recordIds = [...new Set((Array.isArray(recordIdsValue) ? recordIdsValue : [])
      .map((value) => text(value))
      .filter(Boolean))].slice(0, 100);
    let updated = 0;
    for (const recordId of recordIds) {
      updated += await this.prisma.$executeRaw`
        UPDATE "NotificationDelivery" d
        SET "status" = 'read',
            "readAt" = COALESCE(d."readAt", CURRENT_TIMESTAMP)
        FROM "Notification" n, "AccountTenantLink" l, "AccountContact" c
        WHERE d."notificationId" = n."id"
          AND d."tenantId" = n."tenantId"
          AND d."channel" = 'IN_APP'
          AND d."readAt" IS NULL
          AND n."purpose" = 'SERVICE'
          AND n."entityType" = 'record'
          AND n."entityId" = ${recordId}
          AND n."createdAt" >= ${SERVICE_UNSEEN_ROLLOUT_AT}
          AND l."accountId" = ${accountId}
          AND l."tenantId" = n."tenantId"
          AND c."accountId" = ${accountId}
          AND c."type" = 'PHONE'
          AND c."value" = d."recipientKey"
      `;
    }
    return { seen: updated, recordIds };
  }
}
