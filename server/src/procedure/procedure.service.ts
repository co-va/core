import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type JsonObject = Record<string, any>;
type HistoryProcedureRow = { entityId: string; status: string; data: unknown };
type BookingPrice = { minimum: number; variable: boolean; free: boolean };

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function priceNumber(value: unknown) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function hasPriceValue(value: unknown) {
  return value !== '' && value != null;
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

  private costSourceFor(procedure: JsonObject, workplaceId: string) {
    const assignment = this.assignmentFor(procedure, workplaceId);
    const assigned = assignment?.cost;
    const base = procedure?.cost;
    const hasAssigned = assigned && typeof assigned === 'object' && !assigned.free && (
      hasPriceValue(assigned.amount)
      || hasPriceValue(assigned.from)
      || hasPriceValue(assigned.to)
    );
    return hasAssigned ? assigned : base;
  }

  private costFor(procedure: JsonObject, workplaceId: string) {
    const cost = this.costSourceFor(procedure, workplaceId);
    if (cost == null || cost?.free) return '';
    if (typeof cost === 'number' || typeof cost === 'string') return cost;
    return cost.amount ?? cost.from ?? '';
  }

  private bookingPriceFor(procedure: JsonObject, workplaceId: string): BookingPrice {
    const cost = this.costSourceFor(procedure, workplaceId);
    if (cost == null || cost?.free) return { minimum: 0, variable: false, free: true };
    if (typeof cost === 'number' || typeof cost === 'string') {
      return { minimum: priceNumber(cost), variable: false, free: false };
    }
    if (hasPriceValue(cost.amount)) {
      return { minimum: priceNumber(cost.amount), variable: false, free: false };
    }
    if (hasPriceValue(cost.from)) {
      return { minimum: priceNumber(cost.from), variable: true, free: false };
    }
    return { minimum: 0, variable: hasPriceValue(cost.to), free: false };
  }

  publicBookingCatalog(proceduresValue: unknown, workplaceIds: string[]): JsonObject[] {
    const allowed = new Set(workplaceIds.map(text).filter(Boolean));
    const result: JsonObject[] = [];
    for (const value of arrayValue(proceduresValue)) {
      const procedure = objectValue(value);
      const workplaces = arrayValue(procedure.workplaces)
        .filter((assignment) => allowed.has(text(assignment?.workplaceId ?? assignment?.key ?? assignment?.id)))
        .map((assignment) => {
          const workplaceId = text(assignment?.workplaceId ?? assignment?.key ?? assignment?.id);
          return {
            ...objectValue(assignment),
            bookingPrice: this.bookingPriceFor(procedure, workplaceId),
          };
        });
      if (workplaces.length) result.push({ ...procedure, workplaces });
    }
    return result;
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
      ...(input.workplaceId ? { workplaces: [...arrayValue(catalog[index]?.workplaces).filter(w => text(w.workplaceId) !== text(input.workplaceId)), { ...arrayValue(catalog[index]?.workplaces).find(w => text(w.workplaceId) === text(input.workplaceId)), workplaceId: input.workplaceId }] } : {}),
    };
    // A dated price is a historical version, never an update of today's catalog.
    if (index < 0) catalog.push(value); else if (input.price === undefined) catalog[index] = value;
    let historicalVersion: JsonObject | null = null;
    if (input.price !== undefined) {
      const provenanceRows = await tx.$queryRaw<Array<{ value: string }>>`SELECT current_setting('co_va.transfer_provenance', true) AS value`;
      const provenance = JSON.parse(provenanceRows[0]?.value || '{}');
      const history = arrayValue(operational.procedureHistory);
      const version = { id, name: text(input.name), cost: { amount: input.price },
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        workplaces: input.workplaceId ? [{ workplaceId: input.workplaceId, cost: { amount: input.price } }] : [],
        effectiveAt: input.occurredAt, historyAction: 'versioned', transferId: provenance.transferId };
      operational.procedureHistory = [...history.filter(p => p.transferId !== provenance.transferId), version];
      historicalVersion = version;
    }
    operational.procedures = catalog;
    await tx.businessOperationalState.upsert({ where: { tenantId }, create: { tenantId, data: operational as Prisma.InputJsonValue }, update: { data: operational as Prisma.InputJsonValue } });
    if (historicalVersion) {
      await tx.$queryRaw`SELECT "professional_history_write"(
        ${tenantId}::text, 'procedure', ${id}::text, 'versioned', 'active',
        ${new Date(input.occurredAt)}::timestamp, ${new Date(input.occurredAt)}::timestamp, 'procedure', ${id}::text,
        '', '', ${text(input.workplaceId)}::text, ${id}::text, '', '', '',
        ${JSON.stringify({ procedure: id })}::jsonb, ${JSON.stringify({ current: historicalVersion })}::jsonb
      )::text`;
    }
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