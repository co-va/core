import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CapabilityValueType, TenantAccessStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { TenantInvitationService, TOOL_CAPABILITY_KEYS } from '../tenant-invitation/tenant-invitation.service';
import { DocumentRegistryService } from '../document-registry/document-registry.service';
import { TransactionalEmailService } from '../transactional-email/transactional-email.service';
import { PlatformNoticeService } from '../platform-notice/platform-notice.service';

@Injectable()
export class SaasAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SaasAccessService,
    private readonly invitations: TenantInvitationService,
    private readonly documentRegistry: DocumentRegistryService,
    private readonly email: TransactionalEmailService,
    private readonly notices: PlatformNoticeService,
  ) {}

  async me(adminId: string, platformAccountId: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
      include: { account: { select: { id: true, email: true } } },
    });
    if (!admin || admin.platformAccountId !== platformAccountId) throw new NotFoundException('Администратор не найден');
    return { id: admin.id, account: admin.account };
  }

  documentRegistryHistory() {
    return this.documentRegistry.history();
  }

  syncDocumentRegistry(documents: unknown) {
    return this.documentRegistry.syncCatalog(documents);
  }

  async capabilities() {
    await this.invitations.ensureStarterPlan();
    return this.prisma.capability.findMany({
      where: {
        isActive: true,
        OR: [
          { key: { in: [...TOOL_CAPABILITY_KEYS] } },
          { valueType: CapabilityValueType.LIMIT },
        ],
      },
      orderBy: [{ groupKey: 'asc' }, { position: 'asc' }, { key: 'asc' }],
      select: {
        id: true,
        key: true,
        groupKey: true,
        name: true,
        description: true,
        valueType: true,
        defaultEnabled: true,
        defaultLimit: true,
        position: true,
      },
    });
  }

  // User dashboard counts Account identities, never Person/UEI/contact rows or bookings.
  // Deleted User accounts are retained as anonymized tombstones and excluded.
  async userAccountOverview() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [accounts, logins] = await Promise.all([
      this.prisma.$queryRaw<Array<{ registered: bigint; new30: bigint }>>`
        SELECT
          COUNT(*)::bigint AS "registered",
          COUNT(*) FILTER (WHERE "createdAt" >= ${since})::bigint AS "new30"
        FROM "Account"
        WHERE COALESCE("profileData"->>'deletedAt', '') = ''
      `,
      this.prisma.$queryRaw<Array<{ logged30: bigint }>>`
        SELECT COUNT(DISTINCT e."subjectAccountId")::bigint AS "logged30"
        FROM "PlatformActivityEvent" e
        INNER JOIN "Account" a ON a."id" = e."subjectAccountId"
        WHERE e."eventType" = 'AUTH_LOGIN_SUCCEEDED'
          AND e."occurredAt" >= ${since}
          AND e."metadata"->'source'->>'surface' = 'user'
          AND COALESCE(a."profileData"->>'deletedAt', '') = ''
      `,
    ]);
    return {
      registered: Number(accounts[0]?.registered ?? 0n),
      newLast30Days: Number(accounts[0]?.new30 ?? 0n),
      loggedInLast30Days: Number(logins[0]?.logged30 ?? 0n),
      periodDays: 30,
      loginMetric: 'recorded-successful-user-logins',
    };
  }

  async tenants() {
    await this.invitations.ensureStarterPlan();
    const rows = await this.prisma.tenantAccess.findMany({
      include: {
        plan: { select: { id: true, key: true, name: true } },
        tenant: {
          include: {
            memberships: {
              include: { account: { select: { id: true, email: true, createdAt: true } } },
              orderBy: { createdAt: 'asc' },
            },
            profiles: {
              select: { platformAccountId: true, name: true, surname: true, profession: true },
            },
            tenantInvitations: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, email: true, name: true, status: true, createdAt: true, expiresAt: true, activatedAt: true, demoExpiresAt: true },
            },

          },
        },
      },
      orderBy: [{ isOwnerBook: 'desc' }, { createdAt: 'asc' }],
    });

    return Promise.all(rows.map(async (row) => {
      const membership = row.tenant.memberships[0] || null;
      const profile = membership
        ? row.tenant.profiles.find((item) => item.platformAccountId === membership.platformAccountId) || null
        : null;
      const invitation = row.tenant.tenantInvitations[0] || null;
      const resolved = await this.access.resolveTenantAccess(row.tenantId);
      return {
        tenantId: row.tenantId,
        tenantName: row.tenant.name,
        status: row.status,
        isOwnerBook: row.isOwnerBook,
        isTester: row.isTester,
        plan: row.plan,
        ownerProfile: membership ? {
          platformAccountId: membership.account.id,
          email: membership.account.email,
          name: [profile?.name, profile?.surname].filter(Boolean).join(' ') || invitation?.name || row.tenant.name,
          profession: profile?.profession || '',
          registeredAt: membership.account.createdAt,
        } : null,
        invitation,
        access: resolved,

        liveRequestedAt: row.liveRequestedAt?.toISOString() || '',
        liveRequestedByPlatformAccountId: row.liveRequestedByPlatformAccountId || '',
      };
    }));
  }

  async sendTechnicalEmail(tenantId: string, input: { subject?: unknown; body?: unknown }) {
    const subject = String(input?.subject || '').trim();
    const body = String(input?.body || '').trim();
    if (!subject) throw new BadRequestException('Введите тему письма');
    if (!body) throw new BadRequestException('Введите текст письма');
    if (subject.length > 200) throw new BadRequestException('Тема письма слишком длинная');
    if (body.length > 20000) throw new BadRequestException('Текст письма слишком длинный');

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        memberships: {
          include: { account: { select: { id: true, email: true } } },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
        profiles: {
          select: { platformAccountId: true, name: true, surname: true },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Профиль не найден');

    const membership = tenant.memberships[0];
    if (!membership) throw new BadRequestException('У профиля ещё нет учётной записи');

    const recipientEmail = String(membership.account.email || '').trim().toLowerCase();
    if (!recipientEmail || !recipientEmail.includes('@')) throw new BadRequestException('У профиля нет корректного email');

    const profile = tenant.profiles.find((item) => item.platformAccountId === membership.platformAccountId);
    const recipientName = [profile?.name, profile?.surname].filter(Boolean).join(' ') || tenant.name;
    const escaped = body.replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[char] || char);

    const sent = await this.email.send({
      to: recipientEmail,
      toName: recipientName,
      subject,
      text: body,
      html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escaped}</div>`,
      tag: 'platform-service',
    });

    return {
      recipientEmail,
      recipientName,
      messageId: sent.messageId,
    };
  }

  async updateTenantAccess(tenantId: string, input: {
    status?: unknown;
    capabilities?: unknown;
    isTester?: unknown;
  }, actorPlatformAccountId = '') {
    const tenantAccess = await this.prisma.tenantAccess.findUnique({
      where: { tenantId },
      include: {
        plan: { include: { capabilityValues: true } },
        overrides: true,
      },
    });
    if (!tenantAccess) throw new NotFoundException('Рабочее пространство не найдено');

    const planValues = new Map(tenantAccess.plan?.capabilityValues.map((item) => [item.capabilityId, item]) || []);
    const overrideValues = new Map(tenantAccess.overrides.map((item) => [item.capabilityId, item]));

    const baseValue = (capability: {
      id: string;
      valueType: CapabilityValueType;
      defaultEnabled: boolean;
      defaultLimit: number | null;
    }) => {
      const planValue = planValues.get(capability.id);
      if (capability.valueType === CapabilityValueType.BOOLEAN) {
        if (tenantAccess.isOwnerBook && !tenantAccess.plan) return true;
        if (planValue?.enabled !== null && planValue?.enabled !== undefined) return planValue.enabled;
        return capability.defaultEnabled;
      }
      if (tenantAccess.isOwnerBook && !tenantAccess.plan) return null;
      if (planValue) return planValue.limit;
      return capability.defaultLimit;
    };

    const currentValue = (capability: {
      id: string;
      valueType: CapabilityValueType;
      defaultEnabled: boolean;
      defaultLimit: number | null;
    }) => {
      const override = overrideValues.get(capability.id);
      if (capability.valueType === CapabilityValueType.BOOLEAN) {
        if (override?.enabled !== null && override?.enabled !== undefined) return override.enabled;
        return baseValue(capability);
      }
      if (override) return override.limit;
      return baseValue(capability);
    };

    const statusText = String(input?.status || '').trim().toUpperCase();
    if (statusText) {
      if (!Object.values(TenantAccessStatus).includes(statusText as TenantAccessStatus)) {
        throw new BadRequestException('Неизвестный статус рабочего пространства');
      }
      if (tenantAccess.isOwnerBook && statusText === TenantAccessStatus.SUSPENDED) {
        throw new BadRequestException('Пространство администратора нельзя отключить');
      }
      if (statusText !== tenantAccess.status) {
        await this.prisma.$transaction([
          this.prisma.tenantAccess.update({
            where: { tenantId },
            data: { status: statusText as TenantAccessStatus },
          }),
          this.prisma.platformActivityEvent.create({
            data: {
              tenantId,
              platformAccountId: actorPlatformAccountId || null,
              eventType: 'ACCESS_STATUS_CHANGED',
              metadata: {
                entityType: 'tenant-access', entityId: tenantId,
                action: 'update', from: tenantAccess.status, to: statusText,
              },
            },
          }),
        ]);
        await this.notices.createForTenantOwner(tenantId, {
          type: 'ACCESS_STATUS_CHANGED',
          title: statusText === TenantAccessStatus.SUSPENDED
            ? 'Рабочее пространство временно отключено'
            : 'Рабочее пространство снова доступно',
          body: statusText === TenantAccessStatus.SUSPENDED
            ? 'Администратор временно ограничил доступ к рабочему пространству.'
            : 'Администратор восстановил доступ к рабочему пространству.',
          metadata: { status: statusText },
        });
      }
    }

    // Tester is an explicit administrator assignment, independent of registration or DEMO/LIVE.
    if (input?.isTester !== undefined) {
      if (typeof input.isTester !== 'boolean') {
        throw new BadRequestException('Статус тестировщика должен быть включён или выключен');
      }
      if (tenantAccess.isOwnerBook) {
        throw new BadRequestException('Статус тестировщика нельзя менять для пространства администратора');
      }
      if (input.isTester !== tenantAccess.isTester) {
        await this.prisma.$transaction([
          this.prisma.tenantAccess.update({
            where: { tenantId },
            data: { isTester: input.isTester },
          }),
          this.prisma.platformActivityEvent.create({
            data: {
              tenantId,
              platformAccountId: actorPlatformAccountId || null,
              eventType: 'TESTER_STATUS_CHANGED',
              metadata: {
                entityType: 'tenant-access', entityId: tenantId,
                action: 'update', before: tenantAccess.isTester, after: input.isTester,
              },
            },
          }),
        ]);
      }
    }

    const values = Array.isArray(input?.capabilities) ? input.capabilities : [];
    const seenKeys = new Set<string>();
    for (const raw of values) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const value = raw as Record<string, unknown>;
      const key = String(value.key || '').trim();
      if (!key) continue;
      if (seenKeys.has(key)) throw new BadRequestException(`Инструмент ${key} передан несколько раз`);
      seenKeys.add(key);

      const capability = await this.prisma.capability.findUnique({ where: { key } });
      if (!capability || !capability.isActive) throw new BadRequestException(`Неизвестная возможность: ${key}`);
      const before = currentValue(capability);

      // Each capability change and audit fact commit or roll back together.
      const after = await this.prisma.$transaction(async tx => {
        if (value.inherit === true) {
          await tx.tenantCapabilityOverride.deleteMany({
            where: { tenantId, capabilityId: capability.id },
          });
          overrideValues.delete(capability.id);
        } else if (capability.valueType === CapabilityValueType.BOOLEAN) {
          if (typeof value.enabled !== 'boolean') throw new BadRequestException(`Для ${key} требуется ON/OFF`);
          const saved = await tx.tenantCapabilityOverride.upsert({
            where: { tenantId_capabilityId: { tenantId, capabilityId: capability.id } },
            create: { tenantId, capabilityId: capability.id, enabled: value.enabled, limit: null },
            update: { enabled: value.enabled, limit: null },
          });
          overrideValues.set(capability.id, saved);
        } else {
          const limit = value.limit === null ? null : Number(value.limit);
          if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
            throw new BadRequestException(`Для ${key} требуется целый лимит или без ограничения`);
          }
          const saved = await tx.tenantCapabilityOverride.upsert({
            where: { tenantId_capabilityId: { tenantId, capabilityId: capability.id } },
            create: { tenantId, capabilityId: capability.id, enabled: null, limit },
            update: { enabled: null, limit },
          });
          overrideValues.set(capability.id, saved);
        }

        const updatedValue = currentValue(capability);
        if (before !== updatedValue) {
          await tx.platformActivityEvent.create({
            data: {
              tenantId,
              platformAccountId: actorPlatformAccountId || null,
              eventType: 'CAPABILITY_CHANGED',
              metadata: {
                entityType: 'capability', entityId: capability.key, action: 'update',
                before: before ?? null, after: updatedValue ?? null,
              },
            },
          });
        }
        return updatedValue;
      });
      if (before === after) continue;
      if (capability.key === 'workplaces.max') {
        await this.access.enforceLiveWorkplaceCapacity(tenantId);
      }

      const booleanChange = capability.valueType === CapabilityValueType.BOOLEAN;
      const enabled = booleanChange ? after === true : null;
      await this.notices.createForTenantOwner(tenantId, {
        type: 'CAPABILITY_CHANGED',
        title: booleanChange
          ? (enabled ? `Инструмент «${capability.name}» добавлен` : `Инструмент «${capability.name}» отключён`)
          : `Изменён лимит «${capability.name}»`,
        body: booleanChange
          ? (enabled
            ? 'Администратор добавил этот инструмент в ваш набор. Он станет доступен в соответствии с текущим режимом работы.'
            : 'Администратор отключил этот инструмент в вашем наборе.')
          : `Новое значение лимита: ${after === null ? 'без ограничения' : after}.`,
        metadata: {
          key: capability.key,
          valueType: capability.valueType,
          before,
          after,
        },
      });
    }

    return this.access.resolveTenantAccess(tenantId);
  }

  async deleteTenant(tenantId: string) {
    const access = await this.prisma.tenantAccess.findUnique({
      where: { tenantId },
      select: {
        tenantId: true,
        isOwnerBook: true,
        tenant: {
          select: {
            memberships: { select: { platformAccountId: true } },
          },
        },
      },
    });
    if (!access) throw new NotFoundException('Рабочее пространство не найдено');
    if (access.isOwnerBook) throw new BadRequestException('OWNER Book нельзя удалить');

    const platformAccountIds = [...new Set(access.tenant.memberships.map((item) => item.platformAccountId))];

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL "book.allow_test_tenant_delete" = \'on\'');
      const guard = await tx.$queryRaw<Array<{ value: string | null }>>`
        SELECT current_setting('book.allow_test_tenant_delete', true) AS "value"
      `;
      if (guard[0]?.value !== 'on') {
        throw new Error('Test tenant delete guard was not enabled');
      }

      await tx.$executeRaw`
        DELETE FROM "PlatformConsentEvent"
        WHERE "tenantId" = ${tenantId}
      `;
      await tx.tenant.delete({ where: { id: tenantId } });

      for (const platformAccountId of platformAccountIds) {
        const remainingMemberships = await tx.membership.count({ where: { platformAccountId } });
        const platformAdmin = await tx.platformAdmin.findUnique({
          where: { platformAccountId },
          select: { id: true },
        });
        if (remainingMemberships === 0 && !platformAdmin) {
          await tx.$executeRaw`
            DELETE FROM "PlatformConsentEvent"
            WHERE "platformAccountId" = ${platformAccountId}
          `;
          await tx.platformAccount.delete({ where: { id: platformAccountId } });
        }
      }
    });

    return { deleted: true, tenantId, platformAccountIds };
  }

  async setCommercialMode(tenantId: string, mode: unknown, platformAdminId: string) {
    const normalizedMode = String(mode || '').trim().toUpperCase();
    const before = await this.prisma.tenantAccess.findUnique({
      where: { tenantId },
      select: { commercialMode: true },
    });
    const result = await this.access.setCommercialMode(tenantId, mode, platformAdminId);
    if (normalizedMode === 'LIVE' && before?.commercialMode !== 'LIVE') {
      await Promise.all([
        this.notices.resolveLiveRequest(tenantId),
        this.notices.createForTenantOwner(tenantId, {
          type: 'LIVE_ENABLED',
          title: 'LIVE включён',
          body: 'Администратор включил рабочий режим LIVE.',
          metadata: { tenantId },
        }),
      ]);
    }
    return result;
  }

  extendDemo(tenantId: string, days: unknown) {
    return this.access.extendDemo(tenantId, days);
  }

  async updateCapabilityOrder(tenantId: string, keysValue: unknown, actorPlatformAccountId = '') {
    const keys = (Array.isArray(keysValue) ? keysValue : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    if (!keys.length || new Set(keys).size !== keys.length) {
      throw new BadRequestException('Передайте порядок инструментов без дублей');
    }

    const capabilities = await this.prisma.capability.findMany({
      where: { isActive: true, key: { in: [...TOOL_CAPABILITY_KEYS] } },
      select: { id: true, key: true },
    });
    const byKey = new Map(capabilities.map((item) => [item.key, item]));
    if (keys.length !== capabilities.length || capabilities.some((item) => !keys.includes(item.key))) {
      throw new BadRequestException('Передайте полный порядок доступных инструментов');
    }

    await this.prisma.$transaction(async (tx) => {
      const previous = await tx.tenantCapabilityOrder.findMany({
        where: { tenantId }, orderBy: { position: 'asc' },
        select: { capabilityId: true },
      });
      const beforeKeys = previous
        .map(item => capabilities.find(capability => capability.id === item.capabilityId)?.key || '')
        .filter(Boolean);
      await tx.tenantCapabilityOrder.deleteMany({ where: { tenantId } });
      for (const [index, key] of keys.entries()) {
        const capability = byKey.get(key)!;
        await tx.tenantCapabilityOrder.create({
          data: {
            tenantId,
            capabilityId: capability.id,
            position: (index + 1) * 10,
          },
        });
      }
      if (JSON.stringify(beforeKeys) !== JSON.stringify(keys)) {
        await tx.platformActivityEvent.create({
          data: {
            tenantId, platformAccountId: actorPlatformAccountId || null,
            eventType: 'CAPABILITY_ORDER_CHANGED',
            metadata: {
              entityType: 'capability-order', entityId: tenantId,
              action: 'update', before: beforeKeys, after: keys,
            },
          },
        });
      }
    });

    return this.access.resolveTenantAccess(tenantId);
  }
}
