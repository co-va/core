import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type JsonObject = Record<string, any>;
type HistoryProcedureRow = { entityId: string; status: string; data: unknown };

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function historySnapshot(value: unknown) {
  const data = objectValue(value);
  return objectValue(data.current ?? data.after ?? data.deleted);
}

function historicalMoment(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const moment = new Date(dateOnly ? `${raw}T23:59:59.999Z` : raw);
  return Number.isFinite(moment.getTime()) ? moment : null;
}

@Injectable()
export class ProcedureService {
  constructor(private readonly prisma: PrismaService) {}

  private assignmentFor(procedure: JsonObject, workplaceId: string) {
    return arrayValue(procedure.workplaces)
      .find((item) => text(item?.workplaceId ?? item?.key ?? item?.id) === workplaceId) || null;
  }

  private costFor(procedure: JsonObject, workplaceId: string) {
    const assignment = this.assignmentFor(procedure, workplaceId);
    const assigned = assignment?.cost;
    const base = procedure?.cost;
    const hasAssigned = assigned && typeof assigned === 'object' && !assigned.free && (
      assigned.amount !== '' && assigned.amount != null
      || assigned.from !== '' && assigned.from != null
      || assigned.to !== '' && assigned.to != null
    );
    const cost = hasAssigned ? assigned : base;
    if (cost == null || cost?.free) return '';
    if (typeof cost === 'number' || typeof cost === 'string') return cost;
    return cost.amount ?? cost.from ?? '';
  }

  private async catalogAt(tenantId: string, ids: string[], atValue: unknown) {
    const at = historicalMoment(atValue);
    if (!at) return null;
    const rows = await this.prisma.$queryRaw<HistoryProcedureRow[]>(Prisma.sql`
      SELECT DISTINCT ON ("entityId") "entityId", "status", "data"
      FROM "BusinessHistoryEvent"
      WHERE "tenantId" = ${tenantId}
        AND "entityType" = 'procedure'
        AND "entityId" IN (${Prisma.join(ids)})
        AND "effectiveAt" <= ${at}
      ORDER BY "entityId", "effectiveAt" DESC, "occurredAt" DESC, "recordedAt" DESC, "id" DESC
    `);
    const byId = new Map(rows.map((row) => [row.entityId, row]));
    return ids.map((id) => {
      const row = byId.get(id);
      if (!row || row.status === 'deleted') return null;
      const procedure = historySnapshot(row.data);
      return Object.keys(procedure).length ? procedure : null;
    });
  }

  async snapshots(tenantId: string, workplaceId: string, procedureIds: string[], atValue: unknown = '') {
    const ids = [...new Set(procedureIds.map(text).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('Выберите хотя бы одну процедуру');

    const historical = await this.catalogAt(tenantId, ids, atValue);
    let catalog: JsonObject[];
    if (historical) {
      catalog = historical.filter((item): item is JsonObject => Boolean(item));
    } else {
      const row = await this.prisma.businessOperationalState.findUnique({ where: { tenantId } });
      const data = objectValue(row?.data);
      catalog = arrayValue(data.procedures).map((item) => objectValue(item));
    }

    return ids.map((id) => {
      const procedure = catalog.find((item) => text(item?.id) === id);
      if (!procedure || !this.assignmentFor(procedure, workplaceId)) {
        throw new BadRequestException('Одна из процедур недоступна в этом рабочем пространстве на выбранную дату');
      }
      const groupEnabled = procedure?.groupBooking?.enabled === true;
      return {
        id,
        name: text(procedure?.name),
        duration: Math.max(0, Number(procedure?.duration || 0)),
        cost: this.costFor(procedure, workplaceId),
        groupBooking: {
          enabled: groupEnabled,
          capacity: groupEnabled ? Math.max(2, Math.min(999, Math.floor(Number(procedure?.groupBooking?.capacity) || 2))) : 1,
        },
      };
    });
  }
}
