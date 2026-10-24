import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

const NOTE_DEFAULT_COLOR = '#CFC3FF';

type NoteInput = {
  id?: unknown;
  ownerType?: unknown;
  ownerId?: unknown;
  context?: unknown;
  date?: unknown;
  from?: unknown;
  to?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  title?: unknown;
  text?: unknown;
  color?: unknown;
  createdAt?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dateValue(value: unknown) {
  const candidate = stringValue(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new BadRequestException('Некорректная дата заметки');
  }
  return candidate;
}

function optionalTime(value: unknown) {
  const candidate = stringValue(value);
  if (!candidate) return '';
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate)) {
    throw new BadRequestException('Некорректное время заметки');
  }
  return candidate;
}

function colorValue(value: unknown) {
  const candidate = stringValue(value).toUpperCase();
  if (!candidate) return NOTE_DEFAULT_COLOR;
  if (!/^#[0-9A-F]{6}$/.test(candidate)) {
    throw new BadRequestException('Некорректный цвет заметки');
  }
  return candidate;
}

function notePayload(row: any) {
  return {
    id: row.id,
    tenantId: row.tenantId || '',
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    context: row.context,
    date: row.date,
    from: row.from,
    to: row.to,
    targetType: row.targetType,
    targetId: row.targetId,
    title: row.title,
    text: row.text,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class NoteService {
  constructor(private readonly prisma: PrismaService) {}

  private async profileOwnerId(tenantId: string, platformAccountId: string) {
    const profile = await this.prisma.profile.findFirst({
      where: { tenantId, platformAccountId },
      select: { id: true },
    });
    if (!profile?.id) throw new NotFoundException('Профиль не найден');
    return profile.id;
  }

  private async validateTarget(tenantId: string, date: string, targetType: string, targetId: string) {
    if (!targetType && !targetId) return;
    if (!targetType || !targetId || (targetType !== 'record' && targetType !== 'event')) {
      throw new BadRequestException('Некорректная связь заметки');
    }

    if (targetType === 'record') {
      const row = await this.prisma.record.findUnique({
        where: { tenantId_recordId: { tenantId, recordId: targetId } },
        select: { data: true },
      });
      const record = objectValue(row?.data);
      if (!row || stringValue(record.date).slice(0, 10) !== date) {
        throw new BadRequestException('Запись для заметки не найдена в выбранной дате');
      }
      return;
    }

    const event = await this.prisma.event.findFirst({
      where: { id: targetId, tenantId },
      select: { date: true },
    });
    if (!event || event.date !== date) {
      throw new BadRequestException('Событие для заметки не найдено в выбранной дате');
    }
  }

  async listProfile(tenantId: string, platformAccountId: string) {
    const ownerId = await this.profileOwnerId(tenantId, platformAccountId);
    const rows = await this.prisma.note.findMany({
      where: { tenantId, ownerType: 'profile', ownerId },
      orderBy: [{ date: 'asc' }, { from: 'asc' }, { to: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(notePayload);
  }

  async getProfile(tenantId: string, platformAccountId: string, id: string) {
    const ownerId = await this.profileOwnerId(tenantId, platformAccountId);
    const row = await this.prisma.note.findFirst({
      where: { id, tenantId, ownerType: 'profile', ownerId },
    });
    if (!row) throw new NotFoundException('Заметка не найдена');
    return notePayload(row);
  }

  async upsertProfile(tenantId: string, platformAccountId: string, id: string, body: unknown) {
    const ownerId = await this.profileOwnerId(tenantId, platformAccountId);
    const source = objectValue(body);
    const input = objectValue(source.note) as NoteInput;
    const noteId = stringValue(id);

    if (!noteId || (stringValue(input.id) && stringValue(input.id) !== noteId)) {
      throw new BadRequestException('Некорректный id заметки');
    }
    if (stringValue(input.ownerType) && stringValue(input.ownerType) !== 'profile') {
      throw new BadRequestException('Некорректный владелец заметки');
    }
    if (stringValue(input.ownerId) && stringValue(input.ownerId) !== ownerId) {
      throw new BadRequestException('Некорректный владелец заметки');
    }

    const existingById = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (existingById && (
      existingById.tenantId !== tenantId
      || existingById.ownerType !== 'profile'
      || existingById.ownerId !== ownerId
    )) {
      throw new NotFoundException('Заметка не найдена');
    }

    const date = dateValue(input.date);
    const from = optionalTime(input.from);
    const to = optionalTime(input.to);
    const targetType = stringValue(input.targetType);
    const targetId = stringValue(input.targetId);
    const title = stringValue(input.title);
    const noteText = stringValue(input.text);
    if (!title && !noteText) {
      throw new BadRequestException('Укажите наименование или текст заметки');
    }

    const preservesExistingTarget = Boolean(existingById
      && existingById.date === date
      && existingById.targetType === targetType
      && existingById.targetId === targetId);
    if (!preservesExistingTarget) {
      await this.validateTarget(tenantId, date, targetType, targetId);
    }

    const contextValue = input.context && typeof input.context === 'object' && !Array.isArray(input.context)
      ? objectValue(input.context)
      : { scope: 'professional' };
    const createdAtCandidate = stringValue(input.createdAt);
    const createdAt = existingById?.createdAt
      || (createdAtCandidate && !Number.isNaN(new Date(createdAtCandidate).getTime())
        ? new Date(createdAtCandidate)
        : new Date());
    const context = contextValue as Prisma.InputJsonValue;

    const data = {
      tenantId,
      ownerType: 'profile',
      ownerId,
      context,
      date,
      from,
      to,
      targetType: targetType === 'record' || targetType === 'event' ? targetType : '',
      targetId: targetType === 'record' || targetType === 'event' ? targetId : '',
      title,
      text: noteText,
      color: colorValue(input.color),
      createdAt,
    };

    const row = existingById
      ? await this.prisma.note.update({ where: { id: noteId }, data })
      : await this.prisma.note.create({ data: { id: noteId, ...data } });

    return notePayload(row);
  }

  async removeProfile(tenantId: string, platformAccountId: string, id: string) {
    const ownerId = await this.profileOwnerId(tenantId, platformAccountId);
    const row = await this.prisma.note.findFirst({
      where: { id, tenantId, ownerType: 'profile', ownerId },
      select: { id: true },
    });
    if (!row) return { ok: true };
    await this.prisma.note.delete({ where: { id: row.id } });
    return { ok: true };
  }

  async listOwned(ownerType: string, ownerId: string) {
    const rows = await this.prisma.note.findMany({
      where: { ownerType, ownerId, tenantId: null },
      orderBy: [{ date: 'asc' }, { from: 'asc' }, { to: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(notePayload);
  }

  async getOwned(ownerType: string, ownerId: string, id: string) {
    const row = await this.prisma.note.findFirst({
      where: { id, ownerType, ownerId, tenantId: null },
    });
    if (!row) throw new NotFoundException('Заметка не найдена');
    return notePayload(row);
  }

  async upsertOwned(ownerType: string, ownerId: string, id: string, body: unknown) {
    const source = objectValue(body);
    const input = objectValue(source.note) as NoteInput;
    const noteId = stringValue(id);
    if (!ownerType || !ownerId || !noteId || (stringValue(input.id) && stringValue(input.id) !== noteId)) {
      throw new BadRequestException('Некорректный id заметки');
    }
    if (stringValue(input.ownerType) && stringValue(input.ownerType) !== ownerType) {
      throw new BadRequestException('Некорректный владелец заметки');
    }
    if (stringValue(input.ownerId) && stringValue(input.ownerId) !== ownerId) {
      throw new BadRequestException('Некорректный владелец заметки');
    }

    const existingById = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (existingById && (
      existingById.tenantId !== null
      || existingById.ownerType !== ownerType
      || existingById.ownerId !== ownerId
    )) {
      throw new NotFoundException('Заметка не найдена');
    }

    const date = dateValue(input.date);
    const from = optionalTime(input.from);
    const to = optionalTime(input.to);
    const targetType = stringValue(input.targetType);
    const targetId = stringValue(input.targetId);
    if ((targetType || targetId) && (!targetType || !targetId || (targetType !== 'record' && targetType !== 'event'))) {
      throw new BadRequestException('Некорректная связь заметки');
    }
    const title = stringValue(input.title);
    const noteText = stringValue(input.text);
    if (!title && !noteText) {
      throw new BadRequestException('Укажите наименование или текст заметки');
    }

    const context = {
      ...objectValue(input.context),
      scope: 'account',
    } as Prisma.InputJsonValue;
    const createdAtCandidate = stringValue(input.createdAt);
    const createdAt = existingById?.createdAt
      || (createdAtCandidate && !Number.isNaN(new Date(createdAtCandidate).getTime())
        ? new Date(createdAtCandidate)
        : new Date());
    const data = {
      tenantId: null,
      ownerType,
      ownerId,
      context,
      date,
      from,
      to,
      targetType: targetType === 'record' || targetType === 'event' ? targetType : '',
      targetId: targetType === 'record' || targetType === 'event' ? targetId : '',
      title,
      text: noteText,
      color: colorValue(input.color),
      createdAt,
    };

    const row = existingById
      ? await this.prisma.note.update({ where: { id: noteId }, data })
      : await this.prisma.note.create({ data: { id: noteId, ...data } });
    return notePayload(row);
  }

  async removeOwned(ownerType: string, ownerId: string, id: string) {
    const row = await this.prisma.note.findFirst({
      where: { id, ownerType, ownerId, tenantId: null },
      select: { id: true },
    });
    if (!row) return { ok: true };
    await this.prisma.note.delete({ where: { id: row.id } });
    return { ok: true };
  }

}
