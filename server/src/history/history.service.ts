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

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any> : {};
}

// Platform history is a control-plane projection. Never expose tenant payloads
// or receipt links/recipient addresses from commercial audit metadata.
function platformMetadata(value: unknown) {
  const original = objectValue(value);
  if (original.scope === 'platform' && original.entityType === 'authentication') {
    return original; // Known, deliberately minimized technical auth schema.
  }
  const permitted = [
    'from','to','before','after','status','commercialMode','discountPercent',
    'freeForever','freeUntil','productKeys','amountMinor','currency','provider',
    'paidAt','receiptSent','capabilitiesApplied','enabled','enforced','isTester',
    'reason','correlationId','result','action','entityType','entityId',
  ];
  return Object.fromEntries(permitted
    .filter(key => Object.hasOwn(original,key))
    .filter(key => original[key] === null || ['string','number','boolean'].includes(typeof original[key])
      || ((key === 'productKeys' || key === 'before' || key === 'after') &&
        Array.isArray(original[key]) && original[key].length <= 100 &&
        original[key].every((item: unknown) => typeof item === 'string')))
    .map(key => [key,original[key]]));
}

function publicRow(row: HistoryRow, tenantId: string) {
  const audit = objectValue(row.data);
  return {
    scope: 'tenant',
    owner: { type: 'tenant', id: tenantId },
    action: row.eventType,
    actor: audit.actor || { type: 'unknown' },
    reason: audit.reason || null,
    result: audit.result || 'committed',
    correlationId: audit.correlationId || null,
    before: audit.before ?? audit.deleted ?? null,
    after: audit.after ?? audit.current ?? null,
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

  async list(tenantId: string, filters: HistoryFilters = {}, platformAccountId = '') {
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
        AND (
          "entityType" <> 'note'
          OR (
            "relations"->>'ownerType' = 'profile'
            AND EXISTS (
              SELECT 1 FROM "Profile" p
              WHERE p."tenantId" = ${tenantId}
                AND p."platformAccountId" = ${platformAccountId}
                AND p."id" = ("BusinessHistoryEvent"."relations"->>'ownerId')
            )
          )
        )
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

    return rows.map(row => publicRow(row, tenantId));
  }

  // Account-owned facts only. Tenant source Records are never duplicated here.
  async listAccount(accountId: string, filters: { entityType?: string; entityId?: string; limit?: number } = {}) {
    const entityType = text(filters.entityType);
    const entityId = text(filters.entityId);
    const limit = Math.max(1, Math.min(200, Math.floor(Number(filters.limit) || 100)));
    const rows = await this.prisma.$queryRaw<Array<{
      eventId: string;
      entityType: string;
      entityId: string;
      eventType: string;
      status: string;
      sourceType: string;
      sourceId: string;
      occurredAt: Date;
      recordedAt: Date;
      relations: unknown;
      data: unknown;
    }>>(Prisma.sql`
      SELECT "eventId", "entityType", "entityId", "eventType", "status",
             "sourceType", "sourceId", "occurredAt", "recordedAt", "relations", "data"
      FROM "AccountHistoryEvent"
      WHERE "accountId" = ${accountId}
        AND (${entityType === ''} OR "entityType" = ${entityType})
        AND (${entityId === ''} OR "entityId" = ${entityId})
      ORDER BY "occurredAt" DESC, "id" DESC
      LIMIT ${limit}
    `);
    const owned = rows.map(row => {
      const metadata = objectValue(row.data);
      return {
      scope: 'account',
      owner: { type: 'account', id: accountId },
      actor: metadata.actor || { type: 'unknown' },
      reason: metadata.reason || null,
      result: metadata.result || 'committed',
      correlationId: metadata.correlationId || null,
      before: metadata.before ?? metadata.deleted ?? null,
      after: metadata.after ?? metadata.current ?? null,
      eventId: row.eventId,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.eventType,
      eventType: row.eventType,
      status: row.status,
      source: { type: row.sourceType, id: row.sourceId },
      occurredAt: row.occurredAt.toISOString(),
      recordedAt: row.recordedAt.toISOString(),
      relations: row.relations,
      data: row.data,
    };
    });

    // Read a permitted view of the platform-owned login fact, never duplicate it.
    const includeAuthentication = (!entityType || entityType === 'authentication')
      && (!entityId || entityId === accountId);
    const logins = includeAuthentication
      ? await this.prisma.platformActivityEvent.findMany({
          where: {
            subjectAccountId: accountId,
            eventType: { in: ['AUTH_LOGIN_SUCCEEDED','AUTH_LOGIN_DENIED'] },
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: limit,
        })
      : [];
    const authFacts = logins.map(row => {
      const metadata = objectValue(row.metadata);
      return {
        scope: 'platform',
        owner: { type: 'platform' },
        projection: 'account',
        eventId: row.id,
        entityType: 'authentication',
        entityId: accountId,
        action: 'login',
        eventType: 'login',
        status: String(metadata.result || 'unknown'),
        actor: metadata.actor || { type: 'unknown' },
        before: null,
        after: null,
        reason: metadata.reason || null,
        result: metadata.result || 'unknown',
        correlationId: metadata.correlationId || null,
        source: { type: 'platform-auth', id: row.id },
        occurredAt: row.occurredAt.toISOString(),
        recordedAt: row.createdAt.toISOString(),
        relations: { accountId },
        data: metadata,
      };
    });
    return [...owned, ...authFacts]
      .sort((a,b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
  }

  // Platform Admin only. Read existing control-plane audit sources; never
  // query BusinessHistoryEvent or AccountHistoryEvent from this method.
  async listPlatform(filters: { tenantId?: string; limit?: number } = {}) {
    const tenantId = text(filters.tenantId);
    const limit = Math.max(1,Math.min(200,Math.floor(Number(filters.limit) || 100)));
    const [activity, commercial] = await Promise.all([
      this.prisma.platformActivityEvent.findMany({
        where: tenantId ? { tenantId } : {},
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.prisma.$queryRaw<Array<{
        id: string; tenantId: string; actorAdminId: string | null;
        eventType: string; entityType: string; entityId: string;
        metadata: unknown; occurredAt: Date;
      }>>(Prisma.sql`
        SELECT "id","tenantId","actorAdminId","eventType","entityType",
               "entityId","metadata","occurredAt"
        FROM "CommercialAuditEvent"
        WHERE (${tenantId === ''} OR "tenantId" = ${tenantId})
        ORDER BY "occurredAt" DESC
        LIMIT ${limit}
      `),
    ]);
    const events = activity.map(row => {
      const safe = platformMetadata(row.metadata);
      const metadata = objectValue(row.metadata);
      return {
        scope: 'platform',
        owner: { type: 'platform' },
        eventId: row.id,
        tenantId: row.tenantId || '',
        entityType: text(safe.entityType) || 'platform-access',
        entityId: text(safe.entityId) || row.tenantId || '',
        action: text(safe.action) || row.eventType.toLowerCase(),
        eventType: row.eventType,
        status: text(metadata.result) || 'committed',
        actor: metadata.actor || {
          type: row.platformAccountId ? 'platform-account' : 'unknown',
          platformAccountId: row.platformAccountId || '',
        },
        before: safe.before ?? null,
        after: safe.after ?? null,
        reason: safe.reason ?? null,
        result: safe.result ?? 'committed',
        correlationId: safe.correlationId ?? null,
        source: { type: 'platform-activity', id: row.id },
        occurredAt: row.occurredAt.toISOString(),
        recordedAt: row.createdAt.toISOString(),
        data: safe,
      };
    });
    const commercialEvents = commercial.map(row => {
      const safe = platformMetadata(row.metadata);
      return {
        scope: 'platform',
        owner: { type: 'platform' },
        eventId: row.id,
        tenantId: row.tenantId,
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.eventType.toLowerCase(),
        eventType: row.eventType,
        status: 'committed',
        actor: { type: row.actorAdminId ? 'platform-admin' : 'unknown', id: row.actorAdminId || '' },
        before: safe.before ?? null,
        after: safe.after ?? null,
        reason: safe.reason ?? null,
        result: 'committed',
        correlationId: null,
        source: { type: 'commercial-audit', id: row.id },
        occurredAt: row.occurredAt.toISOString(),
        recordedAt: row.occurredAt.toISOString(),
        data: safe,
      };
    });
    return [...events,...commercialEvents]
      .sort((a,b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0,limit);
  }

  async asOf(tenantId: string, entityTypeValue: unknown, entityIdValue: unknown, atValue: unknown, platformAccountId = '') {
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
        AND (
          "entityType" <> 'note'
          OR (
            "relations"->>'ownerType' = 'profile'
            AND EXISTS (
              SELECT 1 FROM "Profile" p
              WHERE p."tenantId" = ${tenantId}
                AND p."platformAccountId" = ${platformAccountId}
                AND p."id" = ("BusinessHistoryEvent"."relations"->>'ownerId')
            )
          )
        )
        AND "entityType" = ${entityType}
        AND "entityId" = ${entityId}
        AND "effectiveAt" <= ${at}
      ORDER BY "effectiveAt" DESC, "occurredAt" DESC, "recordedAt" DESC, "id" DESC
      LIMIT 1
    `);

    return rows[0] ? publicRow(rows[0], tenantId) : null;
  }
}
