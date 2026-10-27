import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CapabilityValueType } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export type AccountToolProvider = 'google' | 'yandex';

const ACCOUNT_TOOL_CATALOG = [
  {
    key: 'account.calendar.google',
    groupKey: 'account.integrations',
    name: 'Google Calendar',
    description: 'Синхронизация личного Journal с Google Calendar',
    enabled: false,
    position: 10,
    provider: 'google' as const,
  },
  {
    key: 'account.calendar.yandex',
    groupKey: 'account.integrations',
    name: 'Яндекс Календарь',
    description: 'Синхронизация личного Journal с Яндекс Календарём',
    enabled: true,
    position: 20,
    provider: 'yandex' as const,
  },
] as const;

const ACCOUNT_TOOL_KEYS = new Set<string>(ACCOUNT_TOOL_CATALOG.map((item) => item.key));
const PROVIDER_KEYS: Record<AccountToolProvider, string> = {
  google: 'account.calendar.google',
  yandex: 'account.calendar.yandex',
};

@Injectable()
export class AccountToolService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureCatalog() {
    for (const item of ACCOUNT_TOOL_CATALOG) {
      await this.prisma.capability.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          groupKey: item.groupKey,
          name: item.name,
          description: item.description,
          valueType: CapabilityValueType.BOOLEAN,
          defaultEnabled: item.enabled,
          defaultLimit: null,
          position: item.position,
          isActive: false,
        },
        update: {
          groupKey: item.groupKey,
          name: item.name,
          description: item.description,
          valueType: CapabilityValueType.BOOLEAN,
          defaultLimit: null,
          position: item.position,
          // Account tools are platform-level and must never enter TenantAccess resolution.
          isActive: false,
        },
      });
    }

    const rows = await this.prisma.capability.findMany({
      where: { key: { in: [...ACCOUNT_TOOL_KEYS] } },
      select: { key: true, defaultEnabled: true },
    });
    const enabledByKey = new Map(rows.map((row) => [row.key, row.defaultEnabled]));
    for (const item of ACCOUNT_TOOL_CATALOG) {
      const enabled = enabledByKey.get(item.key) ?? item.enabled;
      if (enabled) {
        await this.prisma.accountCalendarConnection.updateMany({
          where: { provider: item.provider, status: 'tool-disabled' },
          data: { status: 'active' },
        });
      } else {
        await this.prisma.accountCalendarConnection.updateMany({
          where: { provider: item.provider, status: 'active' },
          data: { status: 'tool-disabled' },
        });
      }
    }
  }

  async list() {
    await this.ensureCatalog();
    const rows = await this.prisma.capability.findMany({
      where: { key: { in: [...ACCOUNT_TOOL_KEYS] } },
      orderBy: [{ groupKey: 'asc' }, { position: 'asc' }, { key: 'asc' }],
      select: {
        key: true,
        groupKey: true,
        name: true,
        description: true,
        defaultEnabled: true,
        position: true,
      },
    });
    return rows.map((row) => ({
      key: row.key,
      groupKey: row.groupKey,
      name: row.name,
      description: row.description,
      enabled: row.defaultEnabled,
      position: row.position,
    }));
  }

  async isEnabled(key: string) {
    await this.ensureCatalog();
    const row = await this.prisma.capability.findUnique({
      where: { key },
      select: { key: true, defaultEnabled: true },
    });
    return Boolean(row && ACCOUNT_TOOL_KEYS.has(row.key) && row.defaultEnabled);
  }

  async providerAvailability() {
    await this.ensureCatalog();
    const rows = await this.prisma.capability.findMany({
      where: { key: { in: Object.values(PROVIDER_KEYS) } },
      select: { key: true, defaultEnabled: true },
    });
    const enabledByKey = new Map(rows.map((row) => [row.key, row.defaultEnabled]));
    return {
      google: Boolean(enabledByKey.get(PROVIDER_KEYS.google)),
      yandex: Boolean(enabledByKey.get(PROVIDER_KEYS.yandex)),
    };
  }

  async assertProviderEnabled(provider: AccountToolProvider) {
    const enabled = await this.isEnabled(PROVIDER_KEYS[provider]);
    if (!enabled) throw new ServiceUnavailableException('Интеграция временно отключена администратором');
  }

  async setEnabled(keyValue: unknown, enabledValue: unknown) {
    await this.ensureCatalog();
    const key = String(keyValue || '').trim();
    if (!ACCOUNT_TOOL_KEYS.has(key)) throw new BadRequestException('Неизвестный инструмент конечного пользователя');
    if (typeof enabledValue !== 'boolean') throw new BadRequestException('Нужно передать enabled: true или false');

    const item = ACCOUNT_TOOL_CATALOG.find((entry) => entry.key === key)!;
    const row = await this.prisma.capability.update({
      where: { key },
      data: { defaultEnabled: enabledValue },
      select: {
        key: true,
        groupKey: true,
        name: true,
        description: true,
        defaultEnabled: true,
        position: true,
      },
    });

    if (enabledValue) {
      await this.prisma.accountCalendarConnection.updateMany({
        where: { provider: item.provider, status: 'tool-disabled' },
        data: { status: 'active' },
      });
    } else {
      await this.prisma.accountCalendarConnection.updateMany({
        where: { provider: item.provider, status: 'active' },
        data: { status: 'tool-disabled' },
      });
    }

    return {
      key: row.key,
      groupKey: row.groupKey,
      name: row.name,
      description: row.description,
      enabled: row.defaultEnabled,
      position: row.position,
    };
  }
}
