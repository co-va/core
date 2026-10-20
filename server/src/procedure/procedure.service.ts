import { randomUUID } from 'node:crypto';
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

  async importProcedure(tenantId: string, input: JsonObject, targetId: string, tx: Prisma.TransactionClient) {
    if (!text(input.name)) throw new BadRequestException('Не указана процедура');
    if (input.price != null && !input.occurredAt) throw new BadRequestException('Не указана дата исторического прайса');
    const stored = await tx.businessOperationalState.findUnique({ where: { tenantId } });
    const operational = objectValue(stored?.data);
    const catalog = arrayValue(operational.procedures);
    const matches = catalog.filter(p => text(p.name) === text(input.name));
    if (!targetId && matches.length > 1) throw new BadRequestException('Не удалось однозначно определить процедуру');
    const id = targetId || text(input.procedureId) || matches[0]?.id || randomUUID();
    const index = catalog.findIndex(p => p.id === id);
    if (targetId && index < 0) throw new BadRequestException('Перенесённая процедура не найдена');
    const value = { ...(catalog[index] || {}), id, name: text(input.name),
      ...(input.duration !== undefined ? { duration: input.duration } : {}),
      ...(input.price !== undefined ? { cost: { amount: input.price } } : {}),
      ...(input.workplaceId ? { workplaces: [{ workplaceId: input.workplaceId, ...(input.price !== undefined ? { cost: { amount: input.price } } : {}) }] } : {}),
    };
    if (index < 0) catalog.push(value); else catalog[index] = value;
    operational.procedures = catalog;
    await tx.businessOperationalState.upsert({ where: { tenantId }, create: { tenantId, data: operational as Prisma.InputJsonValue }, update: { data: operational as Prisma.InputJsonValue } });
    return id;
  }

  matchTransferredProcedure(record: JsonObject, nameValue: unknown, allowWithoutProcedure = false) {
    const name = text(nameValue);
    if (!name) {
      if (allowWithoutProcedure) return null;
      throw new BadRequestException('Не указана процедура для расходника.');
    }
    const procedures = arrayValue(record.procedures);
    const found = procedures.filter(p => text(p.name) === name);
    if (found.length > 1) throw new BadRequestException('Не удалось однозначно определить процедуру');
    if (!found.length) throw new BadRequestException(`Не удалось сопоставить процедуру: в записи “${procedures.map(p => text(p.name)).join(', ')}”, в импортируемых данных “${name}”.`);
    return found[0];
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
