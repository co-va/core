import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
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


  async journalHiddenRecords(accountId: string) {
    const items = await this.prisma.accountJournalHiddenRecord.findMany({
      where: { accountId },
      select: { tenantId: true, recordId: true },
    });
    return { items };
  }

  async hideJournalRecord(accountId: string, tenantIdValue: unknown, recordIdValue: unknown) {
    const tenantId = text(tenantIdValue);
    const recordId = text(recordIdValue);
    if (!tenantId || !recordId || tenantId.length > 128 || recordId.length > 128) {
      throw new BadRequestException('Не указана запись');
    }
    const link = await this.prisma.accountTenantLink.findUnique({
      where: { accountId_tenantId: { accountId, tenantId } },
      select: { id: true },
    });
    if (!link) throw new ForbiddenException('Запись недоступна');
    await this.prisma.accountJournalHiddenRecord.upsert({
      where: { accountId_tenantId_recordId: { accountId, tenantId, recordId } },
      create: { accountId, tenantId, recordId },
      update: {},
    });
    return { hidden: true, tenantId, recordId };
  }

  async deletedRecordHistory(accountId: string) {
    const rows = await this.prisma.$queryRaw<Array<{
      notificationId: string;
      tenantId: string;
      recordId: string;
      title: string;
      body: string;
      createdAt: Date;
      readAt: Date | null;
      recordSnapshot: unknown;
    }>>`
      SELECT
        n."id" AS "notificationId",
        n."tenantId",
        n."entityId" AS "recordId",
        n."title",
        n."body",
        n."createdAt",
        d."readAt",
        s."data" AS "recordSnapshot"
      FROM "Notification" n
      INNER JOIN "NotificationDelivery" d
        ON d."notificationId" = n."id"
       AND d."tenantId" = n."tenantId"
       AND d."channel" = 'IN_APP'
      LEFT JOIN LATERAL (
        SELECT e."data"->'payload'->'snapshot' AS "data"
        FROM "BusinessRecordEvent" e
        WHERE e."tenantId" = n."tenantId"
          AND e."recordId" = n."entityId"
          AND e."data"->>'type' = 'deleted'
        ORDER BY e."createdAt" DESC
        LIMIT 1
      ) s ON TRUE
      INNER JOIN "AccountTenantLink" l
        ON l."accountId" = ${accountId}
       AND l."tenantId" = n."tenantId"
      INNER JOIN "AccountContact" c
        ON c."accountId" = ${accountId}
       AND c."type" = 'PHONE'
       AND c."value" = d."recipientKey"
      WHERE n."purpose" = 'SERVICE'
        AND n."type" = 'booking.deleted'
        AND n."entityType" = 'record'
        AND n."entityId" <> ''
      ORDER BY n."createdAt" DESC, n."id" DESC
      LIMIT 250
    `;
    return {
      items: rows.map((row) => {
        const body = text(row.body);
        const snapshot = objectValue(row.recordSnapshot);
        const procedures = (Array.isArray(snapshot.procedures) ? snapshot.procedures : [])
          .map((value) => {
            const procedure = objectValue(value);
            return {
              id: text(procedure.id),
              name: text(procedure.name),
              duration: Math.max(0, Number(procedure.duration) || 0),
            };
          })
          .filter((procedure) => Boolean(procedure.name));
        return {
          id: text(row.notificationId),
          tenantId: text(row.tenantId),
          recordId: text(row.recordId),
          title: text(row.title),
          body,
          date: text(snapshot.date).slice(0, 10) || body.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || '',
          from: text(snapshot.from) || body.match(/\b\d{1,2}:\d{2}\b/)?.[0] || '',
          to: text(snapshot.to),
          workplaceId: text(snapshot.workplaceId),
          procedures,
          removedAt: row.createdAt,
          read: Boolean(row.readAt),
        };
      }),
    };
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
