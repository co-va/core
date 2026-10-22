import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type EventInput = {
  id?: unknown;
  ownerType?: unknown;
  ownerId?: unknown;
  context?: unknown;
  date?: unknown;
  from?: unknown;
  to?: unknown;
  title?: unknown;
  description?: unknown;
  color?: unknown;
  workplaceId?: unknown;
  createdAt?: unknown;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function time(value: unknown) {
  const candidate = text(value);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate)) throw new BadRequestException('Некорректное время события');
  return candidate;
}

function date(value: unknown) {
  const candidate = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) throw new BadRequestException('Некорректная дата события');
  return candidate;
}

function eventPayload(row: any) {
  return {
    id: row.id,
    tenantId: row.tenantId || '',
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    context: row.context,
    date: row.date,
    from: row.from,
    to: row.to,
    title: row.title,
    description: row.description,
    color: row.color,
    workplaceId: row.workplaceId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const rows = await this.prisma.event.findMany({
      where: { tenantId },
      orderBy: [{ date: 'asc' }, { from: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(eventPayload);
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.event.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Событие не найдено');
    return eventPayload(row);
  }

  async upsert(tenantId: string, id: string, body: unknown) {
    const source = objectValue(body);
    const input = objectValue(source.event) as EventInput;
    const eventId = text(id);
    if (!eventId || (text(input.id) && text(input.id) !== eventId)) throw new BadRequestException('Некорректный id события');
    const title = text(input.title);
    const workplaceId = text(input.workplaceId);
    if (!title) throw new BadRequestException('Укажите название события');
    if (!workplaceId) throw new BadRequestException('Укажите рабочее пространство события');

    const existing = await this.prisma.event.findFirst({ where: { id: eventId, tenantId } });
    const createdAtCandidate = text(input.createdAt);
    const createdAt = existing?.createdAt
      || (createdAtCandidate && !Number.isNaN(new Date(createdAtCandidate).getTime()) ? new Date(createdAtCandidate) : new Date());
    const context = input.context && typeof input.context === 'object' && !Array.isArray(input.context)
      ? input.context as Prisma.InputJsonValue
      : { scope: 'professional' } as Prisma.InputJsonValue;

    const data = {
      tenantId,
      ownerType: text(input.ownerType) || 'tenant',
      ownerId: text(input.ownerId) || tenantId,
      context,
      date: date(input.date),
      from: time(input.from),
      to: time(input.to),
      title,
      description: text(input.description),
      color: text(input.color) || '#777A7D',
      workplaceId,
      createdAt,
    };

    const row = existing
      ? await this.prisma.event.update({ where: { id: eventId }, data })
      : await this.prisma.event.create({ data: { id: eventId, ...data } });
    return eventPayload(row);
  }

  async remove(tenantId: string, id: string) {
    const row = await this.prisma.event.findFirst({ where: { id, tenantId } });
    if (!row) return { ok: true };
    await this.prisma.event.delete({ where: { id } });
    return { ok: true };
  }
}
