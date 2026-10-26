import { PrismaService } from '../prisma.service';

type JsonObject = Record<string, any>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export async function journalFinanceProjection(prisma: PrismaService, tenantId: string) {
  const [settlements, operations] = await Promise.all([
    prisma.financeSettlement.findMany({
      where: { tenantId, sourceType: 'record' },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.financeOperation.findMany({
      where: {
        tenantId,
        sourceType: 'record',
        kind: { in: ['payment', 'refund'] },
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  return {
    version: 8,
    articles: [],
    settlements: settlements.map((row) => ({
      source: { type: row.sourceType, id: row.sourceId },
      settlement: clone(row.data),
      recordedAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    operations: operations.map((row) => ({
      operationId: row.operationId,
      kind: row.kind,
      status: row.status,
      source: { type: row.sourceType, id: row.sourceId },
      originalOperationId: text(row.originalOperationId),
      occurredAt: row.occurredAt.toISOString(),
      recordedAt: row.createdAt.toISOString(),
      data: clone(objectValue(row.data)),
    })),
    ledger: [],
  };
}
