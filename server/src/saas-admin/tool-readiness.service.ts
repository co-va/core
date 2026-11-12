import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type ToolReadinessStatus = 'NOT_READY' | 'TESTING' | 'READY';

export const READINESS_KEYS = [
  'cabinet.people',
  'cabinet.journal.day',
  'cabinet.journal.day.events',
  'cabinet.journal.day.notes',
  'cabinet.journal.day.record',
  'cabinet.journal.month',
  'cabinet.journal.list',
  'cabinet.timetable',
  'cabinet.profile.data',
  'cabinet.profile.workspaces',
  'cabinet.service.procedures',
  'cabinet.service.products',
  'cabinet.chat',
  'cabinet.loyalty.deposit',
  'cabinet.loyalty.personal-account',
  'cabinet.loyalty.certificate',
  'cabinet.loyalty.subscription',
  'cabinet.loyalty.referral',
  'cabinet.loyalty.bonus',
  'cabinet.finance.cash.wallets',
  'cabinet.finance.cash.loans',
  'cabinet.finance.cash.investments',
  'cabinet.finance.dds',
  'cabinet.finance.z-report',
  'cabinet.inventory.stock',
  'cabinet.inventory.movements',
  'cabinet.inventory.order',
  'cabinet.inventory.stocktake',
  'cabinet.settings.data-transfer',
  'cabinet.settings.online-booking',
  'cabinet.settings.notifications',
  'cabinet.settings.integrations',
  'cabinet.settings.documents',
  'cabinet.settings.tags',
  'records.profile',
  'records.journal.day',
  'records.journal.day.events',
  'records.journal.day.notes',
  'records.journal.day.record',
  'records.journal.month',
  'records.journal.list',
  'records.contacts',
  'records.integrations.google-calendar',
  'records.integrations.yandex-calendar',
  'records.chat',
] as const;

const READINESS_KEY_SET = new Set<string>(READINESS_KEYS);
const READINESS_STATUS_SET = new Set<ToolReadinessStatus>(['NOT_READY', 'TESTING', 'READY']);

function statusValue(value: unknown): ToolReadinessStatus {
  const status = String(value ?? '').trim().toUpperCase() as ToolReadinessStatus;
  if (!READINESS_STATUS_SET.has(status)) {
    throw new BadRequestException('Статус должен быть NOT_READY, TESTING или READY');
  }
  return status;
}

@Injectable()
export class ToolReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureRows() {
    await this.prisma.adminToolReadiness.createMany({
      data: READINESS_KEYS.map((key) => ({ key, status: 'NOT_READY', enforced: false })),
      skipDuplicates: true,
    });
  }

  async list() {
    await this.ensureRows();
    const rows = await this.prisma.adminToolReadiness.findMany({
      where: { key: { in: [...READINESS_KEYS] } },
    });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return READINESS_KEYS.map((key) => ({ key, status: byKey.get(key)?.status || 'NOT_READY', enforced: byKey.get(key)?.enforced === true }));
  }

  async update(key: string, input: Record<string, unknown>, actorPlatformAccountId = '') {
    if (!READINESS_KEY_SET.has(key)) throw new NotFoundException('Элемент карты инструментов не найден');
    const status = statusValue(input.status);
    await this.prisma.$transaction(async tx => {
      const before = await tx.adminToolReadiness.findUnique({ where: { key } });
      await tx.adminToolReadiness.upsert({
        where: { key },
        update: { status, enforced: true },
        create: { key, status, enforced: true },
      });
      if (!before || before.status !== status || !before.enforced) {
        await tx.platformActivityEvent.create({
          data: {
            tenantId: null,
            platformAccountId: actorPlatformAccountId || null,
            eventType: 'TOOL_READINESS_CHANGED',
            metadata: {
              entityType: 'tool-readiness', entityId: key, action: 'update',
              before: before?.status || null, after: status, enforced: true,
            },
          },
        });
      }
    });
    return this.list();
  }
}
