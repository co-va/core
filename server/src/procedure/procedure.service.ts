import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type JsonObject = Record<string, any>;
type BookingPrice = { minimum: number; variable: boolean; free: boolean; display: string };

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

@Injectable()
export class ProcedureService {
  constructor(private readonly prisma: PrismaService) {}

  private assignmentFor(procedure: JsonObject, workplaceId: string) {
    return arrayValue(procedure.workplaces)
      .find((item) => text(item?.workplaceId ?? item?.key ?? item?.id) === workplaceId) || null;
  }

  // Canonical effective settings for one procedure in one workplace.
  // Preserve explicit 0, empty description and disabled group overrides.
  private effectiveFor(procedure: JsonObject, workplaceId: string) {
    const assignment = this.assignmentFor(procedure, workplaceId);
    const group = assignment?.groupBooking ?? procedure?.groupBooking;
    const groupEnabled = group?.enabled === true;
    return {
      duration: Math.max(0, Number(assignment?.duration ?? procedure?.duration ?? 0) || 0),
      breakDuration: Math.max(0, Number(assignment?.breakDuration ?? procedure?.breakDuration ?? 0) || 0),
      description: String(assignment?.description ?? procedure?.description ?? ''),
      groupBooking: {
        enabled: groupEnabled,
        capacity: groupEnabled ? Math.max(2, Math.min(999, Math.floor(Number(group?.capacity) || 2))) : 1,
      },
    };
  }

  private costSourceFor(procedure: JsonObject, workplaceId: string) {
    const assignment = this.assignmentFor(procedure, workplaceId);
    const assigned = assignment?.cost;
    const base = procedure?.cost;
    const hasAssigned = assigned && typeof assigned === 'object' && (
      assigned.free === true
      || hasPriceValue(assigned.amount)
      || hasPriceValue(assigned.from)
      || hasPriceValue(assigned.to)
    );
    return hasAssigned ? assigned : base;
  }

  // Canonical price for all booking contexts. Display is prepared by the server,
  // never inferred from a number in a booking frontend.
  private bookingPriceFor(procedure: JsonObject, workplaceId: string): BookingPrice {
    const cost = this.costSourceFor(procedure, workplaceId);
    if (cost == null || cost?.free) {
      return { minimum: 0, variable: false, free: true, display: 'Бесплатно' };
    }

    const source = typeof cost === 'object' ? cost : { mode: 'amount', amount: cost };
    const mode = text(source.mode);
    const hasAmount = hasPriceValue(source.amount);
    const hasFrom = hasPriceValue(source.from);
    const hasTo = hasPriceValue(source.to);
    const explicitFrom = mode === 'from' || mode === 'from-to';
    const variable = explicitFrom || (mode !== 'amount' && (hasTo || (!hasAmount && hasFrom)));
    const minimum = priceNumber(explicitFrom
      ? (hasFrom ? source.from : source.amount)
      : (hasAmount ? source.amount : source.from));

    if (variable && minimum === 0) {
      return { minimum, variable, free: false, display: 'Цена уточняется' };
    }
    const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(minimum);
    return { minimum, variable, free: false, display: `${variable ? 'от ' : ''}${formatted} ₽` };
  }

  publicBookingCatalog(proceduresValue: unknown, workplaceIds: string[]): JsonObject[] {
    const allowed = new Set(workplaceIds.map(text).filter(Boolean));
    const result: JsonObject[] = [];
    for (const value of arrayValue(proceduresValue)) {
      const procedure = objectValue(value);
      if (procedure.deletedAt || procedure.visibleInPublicBooking === false) continue;
      const workplaces = arrayValue(procedure.workplaces)
        .filter((assignment) => allowed.has(text(assignment?.workplaceId ?? assignment?.key ?? assignment?.id))
          && assignment?.visibleInPublicBooking !== false)
        .map((assignment) => {
          const workplaceId = text(assignment?.workplaceId ?? assignment?.key ?? assignment?.id);
          return {
            ...objectValue(assignment),
            ...this.effectiveFor(procedure, workplaceId),
            bookingPrice: this.bookingPriceFor(procedure, workplaceId),
          };
        });
      if (workplaces.length) {
        // One-workplace contexts keep the historical top-level duration API.
        // Multi-workplace contexts expose distinct effective fields per assignment.
        result.push({
          ...procedure,
          ...(workplaces.length === 1 ? this.effectiveFor(procedure, text(workplaces[0].workplaceId ?? workplaces[0].key ?? workplaces[0].id)) : {}),
          workplaces,
        });
      }
    }
    return result;
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

  async snapshots(tenantId: string, workplaceId: string, procedureIds: string[], publicBooking = false) {
    const ids = [...new Set(procedureIds.map(text).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('Выберите хотя бы одну процедуру');

    // One live catalog for every new Record, regardless of service date.
    // Previously saved Record snapshots and transferred facts are not catalog entries.
    const row = await this.prisma.businessOperationalState.findUnique({ where: { tenantId } });
    const catalog = arrayValue(objectValue(row?.data).procedures).map((item) => objectValue(item));

    return ids.map((id) => {
      const procedure = catalog.find((item) => text(item?.id) === id);
      const assignment = procedure && this.assignmentFor(procedure, workplaceId);
      if (!procedure || procedure.deletedAt || !assignment
        || (publicBooking && (procedure.visibleInPublicBooking === false || assignment.visibleInPublicBooking === false))) {
        throw new BadRequestException('Одна из услуг недоступна в этом рабочем пространстве');
      }
      const price = this.bookingPriceFor(procedure, workplaceId);
      return {
        id,
        name: text(procedure?.name),
        ...this.effectiveFor(procedure, workplaceId),
        cost: price.free ? '' : price.minimum,
        priceText: price.display,
      };
    });
  }
}