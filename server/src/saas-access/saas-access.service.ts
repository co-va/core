import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CapabilityValueType, TenantAccessStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';

const DEMO_DAYS = 14;

type ResolutionSource = 'TENANT_OVERRIDE' | 'PLAN' | 'DEFAULT' | 'OWNER' | 'SUSPENDED' | 'DEMO' | 'DEMO_EXPIRED' | 'COMMERCIAL_EXPIRED';

type CommercialPaidState = {
  startsAt: Date | null;
  endsAt: Date | null;
  expired: boolean;
  paidCapabilityKeys: Set<string>;
};

export type ResolvedCapability = {
  key: string;
  valueType: CapabilityValueType;
  enabled: boolean | null;
  limit: number | null;
  source: ResolutionSource;
};

export type ResolvedTenantAccess = {
  tenantId: string;
  status: TenantAccessStatus;
  isOwnerBook: boolean;
  commercialMode: string;
  demoActivatedAt: string;
  demoExpiresAt: string;
  liveRequestedAt: string;
  liveApprovedAt: string;
  paidAccessStartsAt: string;
  paidAccessEndsAt: string;
  paidAccessExpired: boolean;
  plan: { id: string; key: string; name: string } | null;
  capabilityOrder: string[];
  capabilities: ResolvedCapability[];
};

@Injectable()
export class SaasAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async activateDemo(tenantId: string, platformAccountId: string): Promise<ResolvedTenantAccess> {
    const current = await this.prisma.tenantAccess.findUnique({ where: { tenantId } });
    if (!current) throw new NotFoundException('Состояние рабочего пространства не настроено');
    if (current.commercialMode !== 'DEMO') return this.resolveTenantAccess(tenantId);
    if (current.demoActivatedAt && current.demoExpiresAt) return this.resolveTenantAccess(tenantId);

    const now = new Date();
    const demoExpiresAt = new Date(now.getTime() + DEMO_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantAccess.update({
        where: { tenantId },
        data: { demoActivatedAt: now, demoExpiresAt },
      });
      await tx.tenantInvitation.updateMany({
        where: { tenantId },
        data: { activatedAt: now, demoExpiresAt },
      });
      await tx.platformActivityEvent.create({
        data: {
          tenantId,
          platformAccountId,
          eventType: 'DEMO_ACTIVATED',
          metadata: { demoDays: DEMO_DAYS, source: 'APP_OPENED' },
          occurredAt: now,
        },
      });
    });

    return this.resolveTenantAccess(tenantId);
  }

  async requestLive(tenantId: string, platformAccountId: string) {
    const access = await this.prisma.tenantAccess.findUnique({ where: { tenantId } });
    if (!access) throw new NotFoundException('Рабочее пространство не найдено');
    if (access.commercialMode === 'LIVE') {
      return {
        transitioned: false,
        alreadyLive: true,
        access: await this.resolveTenantAccess(tenantId),
      };
    }

    const now = new Date();
    const transition = await this.prisma.$transaction(async (tx) => {
      const current = await tx.tenantAccess.findUnique({ where: { tenantId } });
      if (!current) throw new NotFoundException('Рабочее пространство не найдено');
      if (current.commercialMode === 'LIVE') {
        return { changed: false, occurredAt: current.liveApprovedAt || now };
      }

      await tx.tenantAccess.update({
        where: { tenantId },
        data: {
          commercialMode: 'LIVE',
          liveRequestedAt: now,
          liveRequestedByPlatformAccountId: platformAccountId,
          liveApprovedAt: now,
          liveApprovedByAdminId: null,
        },
      });
      await tx.platformActivityEvent.create({
        data: {
          tenantId,
          platformAccountId,
          eventType: 'LIVE_ACTIVATED_BY_USER',
          metadata: {
            from: current.commercialMode,
            demoActivatedAt: current.demoActivatedAt?.toISOString() || '',
            demoExpiresAt: current.demoExpiresAt?.toISOString() || '',
          },
          occurredAt: now,
        },
      });
      await tx.platformActivityEvent.create({
        data: {
          tenantId,
          platformAccountId,
          eventType: 'COMMERCIAL_MODE_CHANGED',
          metadata: { from: current.commercialMode, commercialMode: 'LIVE', source: 'USER' },
          occurredAt: now,
        },
      });
      return { changed: true, occurredAt: now };
    });

    if (transition.changed) {
      await this.cleanupDemoOperationalData(tenantId);
    }

    return {
      transitioned: transition.changed,
      alreadyLive: transition.changed ? undefined : true,
      occurredAt: transition.occurredAt.toISOString(),
      access: await this.resolveTenantAccess(tenantId),
    };
  }

  async assertRealOperationsAllowed(tenantId: string) {
    const access = await this.prisma.tenantAccess.findUnique({ where: { tenantId } });
    if (!access) throw new NotFoundException('Состояние рабочего пространства не настроено');
    if (access.status !== 'ACTIVE') throw new ForbiddenException('Рабочее пространство временно недоступно');
    if (access.commercialMode !== 'LIVE') {
      throw new ForbiddenException('Реальные внешние действия доступны после перехода в LIVE');
    }
    return true;
  }

  async setCommercialMode(tenantId: string, modeValue: unknown, platformAdminId = '') {
    const mode = String(modeValue || '').trim().toUpperCase();
    if (!['DEMO', 'LIVE'].includes(mode)) throw new BadRequestException('Неизвестный режим');
    const approvedByAdminId = String(platformAdminId || '').trim();
    if (mode === 'LIVE' && !approvedByAdminId) {
      throw new BadRequestException('LIVE требует явного подтверждения администратора');
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.tenantAccess.findUnique({ where: { tenantId } });
      if (!current) throw new NotFoundException('Рабочее пространство не найдено');
      if (current.isOwnerBook && mode === 'LIVE' && current.commercialMode === 'LIVE') {
        return { access: current, previousMode: current.commercialMode };
      }
      if (mode === 'LIVE' && current.commercialMode === 'LIVE') {
        return { access: current, previousMode: current.commercialMode };
      }

      const updated = await tx.tenantAccess.update({
        where: { tenantId },
        data: mode === 'LIVE'
          ? {
            commercialMode: 'LIVE',
            liveApprovedAt: now,
            liveApprovedByAdminId: approvedByAdminId,
          }
          : {
            commercialMode: 'DEMO',
            liveRequestedAt: null,
            liveRequestedByPlatformAccountId: null,
            liveApprovedAt: null,
            liveApprovedByAdminId: null,
          },
      });
      await tx.platformActivityEvent.create({
        data: {
          tenantId,
          eventType: 'COMMERCIAL_MODE_CHANGED',
          metadata: { from: current.commercialMode, commercialMode: mode, approvedByAdminId: mode === 'LIVE' ? approvedByAdminId : '' },
          occurredAt: now,
        },
      });
      if (mode === 'LIVE') {
        await tx.platformActivityEvent.create({
          data: {
            tenantId,
            eventType: 'LIVE_APPROVED_BY_ADMIN',
            metadata: {
              platformAdminId: approvedByAdminId,
              requestedAt: current.liveRequestedAt?.toISOString() || '',
              requestedByPlatformAccountId: current.liveRequestedByPlatformAccountId || '',
            },
            occurredAt: now,
          },
        });
      }
      return { access: updated, previousMode: current.commercialMode };
    });

    if (mode === 'LIVE' && result.previousMode !== 'LIVE') {
      await this.cleanupDemoOperationalData(tenantId);
    }

    const access = result.access;
    return {
      commercialMode: access.commercialMode,
      demoActivatedAt: access.demoActivatedAt?.toISOString() || '',
      demoExpiresAt: access.demoExpiresAt?.toISOString() || '',
      liveRequestedAt: access.liveRequestedAt?.toISOString() || '',
      liveRequestedByPlatformAccountId: access.liveRequestedByPlatformAccountId || '',
      liveApprovedAt: access.liveApprovedAt?.toISOString() || '',
      liveApprovedByAdminId: access.liveApprovedByAdminId || '',
    };
  }

  extendDemo(_tenantId: string, _daysValue: unknown = DEMO_DAYS) {
    throw new BadRequestException('DEMO всегда длится 14 дней и не продлевается');
  }

  private async cleanupDemoOperationalData(tenantId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.financeSettlement.deleteMany({ where: { tenantId } });
      await tx.financeOperation.deleteMany({ where: { tenantId } });
      await tx.recordEvent.deleteMany({ where: { tenantId } });
      await tx.record.deleteMany({ where: { tenantId } });
      await tx.person.deleteMany({ where: { tenantId } });
      await tx.bookingRequest.deleteMany({ where: { tenantId } });
      await tx.ueiState.updateMany({
        where: { tenantId },
        data: { data: { entities: {}, relations: {}, revoked: [] } },
      });
      await tx.$executeRaw`DELETE FROM "NotificationDelivery" WHERE "tenantId" = ${tenantId}`;
      await tx.$executeRaw`DELETE FROM "Notification" WHERE "tenantId" = ${tenantId}`;
      await tx.$executeRaw`DELETE FROM "CommunicationMessage" WHERE "tenantId" = ${tenantId}`;
      await tx.$executeRaw`DELETE FROM "CommunicationIdentity" WHERE "tenantId" = ${tenantId}`;
      await tx.$executeRaw`DELETE FROM "CommunicationPreference" WHERE "tenantId" = ${tenantId}`;
      await tx.$executeRaw`DELETE FROM "CommunicationBroadcastRun" WHERE "tenantId" = ${tenantId}`;
      await tx.platformActivityEvent.create({
        data: {
          tenantId,
          eventType: 'DEMO_OPERATIONAL_DATA_CLEARED',
          metadata: { reason: 'LIVE_ACTIVATED' },
          occurredAt: new Date(),
        },
      });
    });
  }

  private async commercialPaidState(tenantId: string): Promise<CommercialPaidState> {
    const [terms] = await this.prisma.$queryRawUnsafe<Array<{
      paidAccessStartsAt: Date | null;
      paidAccessEndsAt: Date | null;
      discountPercent: number;
      freeForever: boolean;
      freeUntil: Date | null;
    }>>(
      `SELECT "paidAccessStartsAt","paidAccessEndsAt","discountPercent","freeForever","freeUntil" FROM "CommercialTenantTerms" WHERE "tenantId"=$1 LIMIT 1`,
      tenantId,
    );
    const startsAt = terms?.paidAccessStartsAt || null;
    const endsAt = terms?.paidAccessEndsAt || null;
    const now = Date.now();
    const complimentary = Boolean(
      terms?.freeForever
      || Number(terms?.discountPercent || 0) >= 100
      || (terms?.freeUntil && terms.freeUntil.getTime() >= now),
    );
    const expired = !complimentary && Boolean(endsAt && endsAt.getTime() <= now);
    if (!expired) return { startsAt, endsAt, expired: false, paidCapabilityKeys: new Set() };

    const rows = await this.prisma.$queryRawUnsafe<Array<{ capabilityKey: string }>>(
      `WITH RECURSIVE
       free_products("id") AS (
         SELECT "id" FROM "CommercialProduct" WHERE "isActive"=true AND "isSaleable"=true AND "isFree"=true
         UNION
         SELECT inclusion."childProductId"
         FROM "CommercialProductInclusion" inclusion
         JOIN free_products parent ON parent."id"=inclusion."parentProductId"
       ),
       paid_products("id") AS (
         SELECT "id" FROM "CommercialProduct" WHERE "isActive"=true AND "isSaleable"=true AND "isFree"=false
         UNION
         SELECT inclusion."childProductId"
         FROM "CommercialProductInclusion" inclusion
         JOIN paid_products parent ON parent."id"=inclusion."parentProductId"
       ),
       free_capabilities AS (
         SELECT DISTINCT link."capabilityKey" FROM "CommercialProductCapability" link JOIN free_products product ON product."id"=link."productId"
       ),
       paid_capabilities AS (
         SELECT DISTINCT link."capabilityKey" FROM "CommercialProductCapability" link JOIN paid_products product ON product."id"=link."productId"
       )
       SELECT paid."capabilityKey"
       FROM paid_capabilities paid
       LEFT JOIN free_capabilities free ON free."capabilityKey"=paid."capabilityKey"
       WHERE free."capabilityKey" IS NULL`,
    );
    return {
      startsAt,
      endsAt,
      expired: true,
      paidCapabilityKeys: new Set(rows.map((row) => row.capabilityKey)),
    };
  }

  async resolveCapability(tenantId: string, capabilityKey: string): Promise<ResolvedCapability> {
    const capability = await this.prisma.capability.findUnique({
      where: { key: capabilityKey },
    });

    if (!capability || !capability.isActive) {
      throw new NotFoundException(`Неизвестная возможность: ${capabilityKey}`);
    }

    const access = await this.prisma.tenantAccess.findUnique({
      where: { tenantId },
      include: {
        plan: {
          include: {
            capabilityValues: {
              where: { capabilityId: capability.id },
              take: 1,
            },
          },
        },
        overrides: {
          where: { capabilityId: capability.id },
          take: 1,
        },
      },
    });

    if (!access) {
      throw new NotFoundException('Состояние рабочего пространства не настроено');
    }

    if (access.status === TenantAccessStatus.SUSPENDED) {
      return this.suspendedValue(capability.key, capability.valueType);
    }

    const override = access.overrides[0];
    const planValue = access.plan?.capabilityValues[0];

    if (this.demoActive(access)) {
      if (capability.valueType === CapabilityValueType.BOOLEAN && override && override.enabled !== null) {
        return {
          key: capability.key,
          valueType: capability.valueType,
          enabled: override.enabled,
          limit: null,
          source: 'TENANT_OVERRIDE',
        };
      }
      return this.demoValue(capability.key, capability.valueType);
    }
    if (this.demoExpired(access)) return this.demoExpiredValue(capability.key, capability.valueType);

    const commercialPaid = await this.commercialPaidState(tenantId);
    if (!access.isOwnerBook && access.commercialMode === 'LIVE' && commercialPaid.expired && commercialPaid.paidCapabilityKeys.has(capability.key)) {
      return this.commercialExpiredValue(capability.key, capability.valueType);
    }

    if (capability.valueType === CapabilityValueType.BOOLEAN) {
      if (override && override.enabled !== null) {
        return {
          key: capability.key,
          valueType: capability.valueType,
          enabled: override.enabled,
          limit: null,
          source: 'TENANT_OVERRIDE',
        };
      }

      if (access.isOwnerBook && !access.plan) {
        return this.ownerValue(capability.key, capability.valueType);
      }

      if (planValue && planValue.enabled !== null) {
        return {
          key: capability.key,
          valueType: capability.valueType,
          enabled: planValue.enabled,
          limit: null,
          source: 'PLAN',
        };
      }

      return {
        key: capability.key,
        valueType: capability.valueType,
        enabled: capability.defaultEnabled,
        limit: null,
        source: 'DEFAULT',
      };
    }

    if (override) {
      return {
        key: capability.key,
        valueType: capability.valueType,
        enabled: null,
        limit: override.limit,
        source: 'TENANT_OVERRIDE',
      };
    }

    if (access.isOwnerBook && !access.plan) {
      return this.ownerValue(capability.key, capability.valueType);
    }

    if (planValue) {
      return {
        key: capability.key,
        valueType: capability.valueType,
        enabled: null,
        limit: planValue.limit,
        source: 'PLAN',
      };
    }

    return {
      key: capability.key,
      valueType: capability.valueType,
      enabled: null,
      limit: capability.defaultLimit,
      source: 'DEFAULT',
    };
  }

  async resolveTenantAccess(tenantId: string): Promise<ResolvedTenantAccess> {
    const capabilities = await this.prisma.capability.findMany({
      where: { isActive: true },
      orderBy: [{ groupKey: 'asc' }, { position: 'asc' }, { key: 'asc' }],
    });

    const access = await this.prisma.tenantAccess.findUnique({
      where: { tenantId },
      include: {
        plan: {
          include: {
            capabilityValues: true,
          },
        },
        overrides: true,
        capabilityOrder: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      },
    });

    if (!access) {
      throw new NotFoundException('Состояние рабочего пространства не настроено');
    }

    const commercialPaid = await this.commercialPaidState(tenantId);
    const planValues = new Map(access.plan?.capabilityValues.map((value) => [value.capabilityId, value]) || []);
    const overrides = new Map(access.overrides.map((value) => [value.capabilityId, value]));
    const customOrder = new Map(access.capabilityOrder.map((value, index) => [value.capabilityId, index]));

    capabilities.sort((left, right) => {
      const leftOrder = customOrder.get(left.id);
      const rightOrder = customOrder.get(right.id);
      if (leftOrder != null && rightOrder != null) return leftOrder - rightOrder;
      if (leftOrder != null) return -1;
      if (rightOrder != null) return 1;
      return left.position - right.position || left.key.localeCompare(right.key);
    });

    const resolved = capabilities.map<ResolvedCapability>((capability) => {
      if (access.status === TenantAccessStatus.SUSPENDED) {
        return this.suspendedValue(capability.key, capability.valueType);
      }

      const override = overrides.get(capability.id);
      const planValue = planValues.get(capability.id);

      if (this.demoActive(access)) {
        if (capability.valueType === CapabilityValueType.BOOLEAN && override && override.enabled !== null) {
          return {
            key: capability.key,
            valueType: capability.valueType,
            enabled: override.enabled,
            limit: null,
            source: 'TENANT_OVERRIDE',
          };
        }
        return this.demoValue(capability.key, capability.valueType);
      }
      if (this.demoExpired(access)) return this.demoExpiredValue(capability.key, capability.valueType);

      if (!access.isOwnerBook && access.commercialMode === 'LIVE' && commercialPaid.expired && commercialPaid.paidCapabilityKeys.has(capability.key)) {
        return this.commercialExpiredValue(capability.key, capability.valueType);
      }

      if (capability.valueType === CapabilityValueType.BOOLEAN) {
        if (override && override.enabled !== null) {
          return {
            key: capability.key,
            valueType: capability.valueType,
            enabled: override.enabled,
            limit: null,
            source: 'TENANT_OVERRIDE',
          };
        }
        if (access.isOwnerBook && !access.plan) {
          return this.ownerValue(capability.key, capability.valueType);
        }
        if (planValue && planValue.enabled !== null) {
          return {
            key: capability.key,
            valueType: capability.valueType,
            enabled: planValue.enabled,
            limit: null,
            source: 'PLAN',
          };
        }
        return {
          key: capability.key,
          valueType: capability.valueType,
          enabled: capability.defaultEnabled,
          limit: null,
          source: 'DEFAULT',
        };
      }

      if (override) {
        return {
          key: capability.key,
          valueType: capability.valueType,
          enabled: null,
          limit: override.limit,
          source: 'TENANT_OVERRIDE',
        };
      }
      if (access.isOwnerBook && !access.plan) {
        return this.ownerValue(capability.key, capability.valueType);
      }
      if (planValue) {
        return {
          key: capability.key,
          valueType: capability.valueType,
          enabled: null,
          limit: planValue.limit,
          source: 'PLAN',
        };
      }
      return {
        key: capability.key,
        valueType: capability.valueType,
        enabled: null,
        limit: capability.defaultLimit,
        source: 'DEFAULT',
      };
    });

    return {
      tenantId,
      status: access.status,
      isOwnerBook: access.isOwnerBook,
      commercialMode: access.commercialMode,
      demoActivatedAt: access.demoActivatedAt?.toISOString() || '',
      demoExpiresAt: access.demoExpiresAt?.toISOString() || '',
      liveRequestedAt: access.liveRequestedAt?.toISOString() || '',
      liveApprovedAt: access.liveApprovedAt?.toISOString() || '',
      paidAccessStartsAt: commercialPaid.startsAt?.toISOString() || '',
      paidAccessEndsAt: commercialPaid.endsAt?.toISOString() || '',
      paidAccessExpired: commercialPaid.expired,
      plan: access.plan ? { id: access.plan.id, key: access.plan.key, name: access.plan.name } : null,
      capabilityOrder: capabilities.map((capability) => capability.key),
      capabilities: resolved,
    };
  }

  private demoActive(access: { commercialMode: string; demoActivatedAt: Date | null; demoExpiresAt: Date | null }) {
    return access.commercialMode === 'DEMO'
      && (!access.demoExpiresAt || access.demoExpiresAt.getTime() > Date.now());
  }

  private demoExpired(access: { commercialMode: string; demoActivatedAt: Date | null; demoExpiresAt: Date | null }) {
    return access.commercialMode === 'DEMO'
      && Boolean(access.demoExpiresAt)
      && access.demoExpiresAt!.getTime() <= Date.now();
  }

  private demoValue(key: string, valueType: CapabilityValueType): ResolvedCapability {
    if (valueType === CapabilityValueType.BOOLEAN) {
      return { key, valueType, enabled: true, limit: null, source: 'DEMO' };
    }
    return { key, valueType, enabled: null, limit: null, source: 'DEMO' };
  }

  private demoExpiredValue(key: string, valueType: CapabilityValueType): ResolvedCapability {
    if (valueType === CapabilityValueType.BOOLEAN) {
      return { key, valueType, enabled: false, limit: null, source: 'DEMO_EXPIRED' };
    }
    return { key, valueType, enabled: null, limit: 0, source: 'DEMO_EXPIRED' };
  }

  private commercialExpiredValue(key: string, valueType: CapabilityValueType): ResolvedCapability {
    if (valueType === CapabilityValueType.BOOLEAN) {
      return { key, valueType, enabled: false, limit: null, source: 'COMMERCIAL_EXPIRED' };
    }
    return { key, valueType, enabled: null, limit: 0, source: 'COMMERCIAL_EXPIRED' };
  }

  private ownerValue(key: string, valueType: CapabilityValueType): ResolvedCapability {
    if (valueType === CapabilityValueType.BOOLEAN) {
      return { key, valueType, enabled: true, limit: null, source: 'OWNER' };
    }
    return { key, valueType, enabled: null, limit: null, source: 'OWNER' };
  }

  private suspendedValue(key: string, valueType: CapabilityValueType): ResolvedCapability {
    if (valueType === CapabilityValueType.BOOLEAN) {
      return { key, valueType, enabled: false, limit: null, source: 'SUSPENDED' };
    }
    return { key, valueType, enabled: null, limit: 0, source: 'SUSPENDED' };
  }
}
