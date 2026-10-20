import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type HistoryRow = {
  eventId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  status: string;
  personKey: string;
  recordId: string;
  workplaceKey: string;
  procedureId: string;
  documentId: string;
  inventoryItemId: string;
  financeOperationId: string;
  sourceType: string;
  sourceId: string;
  effectiveAt: Date;
  occurredAt: Date;
  recordedAt: Date;
  relations: unknown;
  data: unknown;
  provenance: unknown;
};

type HistoryFilters = {
  personKey?: string;
  personKeys?: string[];
  recordId?: string;
  workplaceKey?: string;
  procedureId?: string;
  documentId?: string;
  inventoryItemId?: string;
  financeOperationId?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function dateValue(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function publicRow(row: HistoryRow) {
  return {
    eventId: row.eventId,
    entityType: row.entityType,
    entityId: row.entityId,
    eventType: row.eventType,
    status: row.status,
    personKey: row.personKey,
    recordId: row.recordId,
    workplaceKey: row.workplaceKey,
    procedureId: row.procedureId,
    documentId: row.documentId,
    inventoryItemId: row.inventoryItemId,
    financeOperationId: row.financeOperationId,
    source: { type: row.sourceType, id: row.sourceId },
    effectiveAt: row.effectiveAt.toISOString(),
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    relations: row.relations,
    data: row.data,
    provenance: row.provenance,
  };
}

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async cancelTransfer(tx:Prisma.TransactionClient,tenantId:string,sessionId:string) {
    await tx.$executeRaw`DELETE FROM "BusinessHistoryEvent" WHERE "tenantId"=${tenantId} AND "provenance"->>'sessionId'=${sessionId}`;
  }
  async transferReferences(tx:Prisma.TransactionClient,tenantId:string) {
    const rows=await tx.$queryRaw<Array<{value:any}>>`SELECT to_jsonb(t) AS value FROM "BusinessHistoryEvent" t WHERE "tenantId"=${tenantId} ORDER BY "id"`;
    return {BusinessHistoryEvent:rows.map(row=>row.value)};
  }

  async list(tenantId: string, filters: HistoryFilters = {}) {
    const personKeys = [...new Set([
      text(filters.personKey),
      ...(Array.isArray(filters.personKeys) ? filters.personKeys.map(text) : []),
    ].filter(Boolean))];
    const recordId = text(filters.recordId);
    const workplaceKey = text(filters.workplaceKey);
    const procedureId = text(filters.procedureId);
    const documentId = text(filters.documentId);
    const inventoryItemId = text(filters.inventoryItemId);
    const financeOperationId = text(filters.financeOperationId);
    const entityType = text(filters.entityType);
    const entityId = text(filters.entityId);
    const from = dateValue(filters.from);
    const to = dateValue(filters.to);
    const limit = Math.max(1, Math.min(2000, Math.floor(Number(filters.limit) || 500)));

    const rows = await this.prisma.$queryRaw<HistoryRow[]>(Prisma.sql`
      SELECT
        "eventId", "entityType", "entityId", "eventType", "status",
        "personKey", "recordId", "workplaceKey", "procedureId", "documentId",
        "inventoryItemId", "financeOperationId", "sourceType", "sourceId",
        "effectiveAt", "occurredAt", "recordedAt", "relations", "data", "provenance"
      FROM "BusinessHistoryEvent"
      WHERE "tenantId" = ${tenantId}
        AND (${personKeys.length === 0} OR "personKey" IN (${Prisma.join(personKeys.length ? personKeys : [''])}))
        AND (${recordId === ''} OR "recordId" = ${recordId})
        AND (${workplaceKey === ''} OR "workplaceKey" = ${workplaceKey})
        AND (${procedureId === ''} OR "procedureId" = ${procedureId})
        AND (${documentId === ''} OR "documentId" = ${documentId})
        AND (${inventoryItemId === ''} OR "inventoryItemId" = ${inventoryItemId})
        AND (${financeOperationId === ''} OR "financeOperationId" = ${financeOperationId})
        AND (${entityType === ''} OR "entityType" = ${entityType})
        AND (${entityId === ''} OR "entityId" = ${entityId})
        AND (${from == null} OR "occurredAt" >= ${from})
        AND (${to == null} OR "occurredAt" <= ${to})
      ORDER BY "occurredAt" DESC, "recordedAt" DESC, "id" DESC
      LIMIT ${limit}
    `);

    return rows.map(publicRow);
  }

  async asOf(tenantId: string, entityTypeValue: unknown, entityIdValue: unknown, atValue: unknown) {
    const entityType = text(entityTypeValue);
    const entityId = text(entityIdValue);
    const at = dateValue(atValue);
    if (!entityType || !entityId || !at) return null;

    const rows = await this.prisma.$queryRaw<HistoryRow[]>(Prisma.sql`
      SELECT
        "eventId", "entityType", "entityId", "eventType", "status",
        "personKey", "recordId", "workplaceKey", "procedureId", "documentId",
        "inventoryItemId", "financeOperationId", "sourceType", "sourceId",
        "effectiveAt", "occurredAt", "recordedAt", "relations", "data", "provenance"
      FROM "BusinessHistoryEvent"
      WHERE "tenantId" = ${tenantId}
        AND "entityType" = ${entityType}
        AND "entityId" = ${entityId}
        AND "effectiveAt" <= ${at}
      ORDER BY "effectiveAt" DESC, "occurredAt" DESC, "recordedAt" DESC, "id" DESC
      LIMIT 1
    `);

    return rows[0] ? publicRow(rows[0]) : null;
  }
}
