import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NotificationEventService } from './notification-event.service';

type JsonObject = Record<string, any>;

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const REMINDER_SCAN_INTERVAL_MS = 5 * 60 * 1000;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function localDateTimeUtc(dateValue: unknown, timeValue: unknown, timeZoneValue: unknown) {
  const date = text(dateValue).slice(0, 10);
  const time = text(timeValue).slice(0, 5);
  const match = `${date}T${time}`.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as any;
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  const timeZone = text(timeZoneValue) || 'Europe/Moscow';
  let instant = desired;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
      const represented = Date.UTC(
        Number(parts.year), Number(parts.month) - 1, Number(parts.day),
        Number(parts.hour), Number(parts.minute),
      );
      instant += desired - represented;
    }
    return new Date(instant);
  } catch {
    return new Date(desired);
  }
}

@Injectable()
export class NotificationReminderService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: NotificationEventService,
  ) {}

  onModuleInit() {
    void this.scan().catch(() => undefined);
    this.timer = setInterval(() => void this.scan().catch(() => undefined), REMINDER_SCAN_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scan(now = new Date()) {
    if (this.scanning) return { scanned: 0, sent: 0 };
    this.scanning = true;
    try {
      const [records, workplaces, recordEvents] = await Promise.all([
        this.prisma.record.findMany({ orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }] }),
        this.prisma.workplace.findMany({ where: { deletedAt: null }, select: { tenantId: true, key: true, name: true, timeZone: true } }),
        this.prisma.recordEvent.findMany({ orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }] }),
      ]);
      const workplaceByKey = new Map(workplaces.map((workplace) => [`${workplace.tenantId}:${workplace.key}`, workplace]));
      const inactiveRecords = new Set(recordEvents
        .map((row) => objectValue(row.data))
        .filter((event) => ['cancelled', 'no-show'].includes(text(event.type)))
        .map((event) => text(event.recordId))
        .filter(Boolean));
      const nowMs = now.getTime();
      const untilMs = nowMs + REMINDER_WINDOW_MS;
      let sent = 0;

      for (const row of records) {
        const record = objectValue(row.data);
        const recordId = text(record.id || row.recordId);
        if (!recordId || inactiveRecords.has(recordId)) continue;
        const workplaceKey = text(record.workplaceId);
        const workplace = workplaceByKey.get(`${row.tenantId}:${workplaceKey}`);
        const startsAt = localDateTimeUtc(record.date, record.from, workplace?.timeZone);
        if (!startsAt || startsAt.getTime() <= nowMs || startsAt.getTime() > untilMs) continue;

        const existing = await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "Notification"
          WHERE "tenantId" = ${row.tenantId}
            AND "type" = 'booking.reminder'
            AND "entityType" = 'record'
            AND "entityId" = ${recordId}
          LIMIT 1
        `;
        if (existing.length) continue;

        const result = await this.events.createEventForPerson(row.tenantId, objectValue(record.person), {
          type: 'booking.reminder',
          entityType: 'record',
          entityId: recordId,
          context: {
            date: text(record.date).slice(0, 10),
            time: text(record.from),
            workplace: text(workplace?.name) || workplaceKey,
            record: { id: recordId },
          },
        });
        if ((result as any)?.notification) sent += 1;
      }
      return { scanned: records.length, sent };
    } finally {
      this.scanning = false;
    }
  }
}
