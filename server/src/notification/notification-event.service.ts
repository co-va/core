import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { NotificationService } from './notification.service';
import { NOTIFICATION_EVENT_CATALOG, NOTIFICATION_EVENT_TYPES, notificationEventDefinition } from './notification-events';

type JsonObject = Record<string, any>;
type EnabledRow = { eventType: string; enabled: boolean };

const DELIVERY_POLICY_TYPE = '__delivery__';
const SERVICE_POLICY_TYPE = '__service__';

function text(value: unknown) {
  return String(value ?? '').trim();
}

@Injectable()
export class NotificationEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async listPolicies(tenantId: string) {
    const [policies, enabledRows] = await Promise.all([
      this.notifications.listRoutingPolicies(tenantId),
      this.prisma.$queryRaw<EnabledRow[]>`
        SELECT "eventType", "enabled"
        FROM "NotificationRoutingPolicy"
        WHERE "tenantId" = ${tenantId}
          AND "eventType" NOT IN (${DELIVERY_POLICY_TYPE}, ${SERVICE_POLICY_TYPE})
      `,
    ]);
    const byType = new Map((Array.isArray(policies) ? policies : []).map((policy: any) => [text(policy?.eventType), policy]));
    const enabledByType = new Map(enabledRows.map((row) => [row.eventType, Boolean(row.enabled)]));
    const known = new Set<string>(NOTIFICATION_EVENT_TYPES);
    const types = [
      ...NOTIFICATION_EVENT_TYPES,
      ...(Array.isArray(policies) ? policies : []).map((policy: any) => text(policy?.eventType)).filter((type) => type && !known.has(type)),
    ];
    return types.map((eventType) => ({
      ...(byType.get(eventType) || { eventType }),
      enabled: enabledByType.get(eventType) === true,
    }));
  }

  async getPolicy(tenantId: string, eventType: string) {
    const type = text(eventType);
    if (type === DELIVERY_POLICY_TYPE) return this.notifications.getRoutingPolicy(tenantId, type);
    if (type === SERVICE_POLICY_TYPE) {
      const rows = await this.prisma.$queryRaw<EnabledRow[]>`
        SELECT "eventType", "enabled"
        FROM "NotificationRoutingPolicy"
        WHERE "tenantId" = ${tenantId} AND "eventType" = ${type}
        LIMIT 1
      `;
      return {
        eventType: SERVICE_POLICY_TYPE,
        enabled: rows[0]?.enabled !== false,
        mode: 'always',
        channels: [],
        titleTemplate: '',
        bodyTemplate: '',
      };
    }
    const [policy, rows] = await Promise.all([
      this.notifications.getRoutingPolicy(tenantId, type),
      this.prisma.$queryRaw<EnabledRow[]>`
        SELECT "eventType", "enabled"
        FROM "NotificationRoutingPolicy"
        WHERE "tenantId" = ${tenantId} AND "eventType" = ${type}
        LIMIT 1
      `,
    ]);
    return { ...policy, enabled: rows[0]?.enabled === true };
  }

  async savePolicy(
    tenantId: string,
    eventType: string,
    input: { enabled?: unknown; mode?: unknown; channels?: unknown; titleTemplate?: unknown; bodyTemplate?: unknown },
  ) {
    const type = text(eventType);
    if (type === DELIVERY_POLICY_TYPE) return this.notifications.saveRoutingPolicy(tenantId, type, input);

    if (type === SERVICE_POLICY_TYPE) {
      if (input.enabled !== undefined) {
        const id = randomUUID();
        const enabled = Boolean(input.enabled);
        await this.prisma.$executeRaw`
          INSERT INTO "NotificationRoutingPolicy" (
            "id", "tenantId", "eventType", "mode", "channels", "titleTemplate", "bodyTemplate", "enabled", "createdAt", "updatedAt"
          ) VALUES (
            ${id}, ${tenantId}, ${type}, 'always', '[]'::jsonb, '', '', ${enabled}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          ON CONFLICT ("tenantId", "eventType") DO UPDATE
          SET "enabled" = EXCLUDED."enabled", "updatedAt" = CURRENT_TIMESTAMP
        `;
      }
      return this.getPolicy(tenantId, type);
    }

    const hasTemplateOrRoutingChange = input.mode !== undefined
      || input.channels !== undefined
      || input.titleTemplate !== undefined
      || input.bodyTemplate !== undefined;
    if (hasTemplateOrRoutingChange) await this.notifications.saveRoutingPolicy(tenantId, type, input);

    if (input.enabled !== undefined) {
      const existing = await this.notifications.getRoutingPolicy(tenantId, type);
      const definition = notificationEventDefinition(type);
      const id = randomUUID();
      const channelsJson = JSON.stringify(Array.isArray((existing as any)?.channels) ? (existing as any).channels : ['PUSH']);
      const titleTemplate = definition?.defaultTitle || text((existing as any)?.titleTemplate) || 'Уведомление';
      const bodyTemplate = definition?.defaultBody || text((existing as any)?.bodyTemplate) || '';
      const mode = text((existing as any)?.mode) || 'always';
      const enabled = Boolean(input.enabled);
      await this.prisma.$executeRaw`
        INSERT INTO "NotificationRoutingPolicy" (
          "id", "tenantId", "eventType", "mode", "channels", "titleTemplate", "bodyTemplate", "enabled", "createdAt", "updatedAt"
        ) VALUES (
          ${id}, ${tenantId}, ${type}, ${mode}, ${channelsJson}::jsonb, ${titleTemplate}, ${bodyTemplate}, ${enabled}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("tenantId", "eventType") DO UPDATE
        SET "enabled" = EXCLUDED."enabled", "updatedAt" = CURRENT_TIMESTAMP
      `;
    }

    return this.getPolicy(tenantId, type);
  }

  async createEventForPerson(
    tenantId: string,
    personValue: unknown,
    input: { type: string; entityType?: string; entityId?: string; context?: JsonObject },
  ) {
    const type = text(input?.type);
    if (!type) return { notification: null, routed: [], blocked: 'EVENT_TYPE_MISSING' };
    return this.notifications.createEventForPerson(tenantId, personValue, input);
  }

  catalog() {
    return NOTIFICATION_EVENT_CATALOG;
  }
}
