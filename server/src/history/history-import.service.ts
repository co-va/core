import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type JsonObject = Record<string, any>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function moment(value: unknown) {
  const date = value instanceof Date ? value : new Date(text(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

@Injectable()
export class HistoryImportService {
  constructor(private readonly prisma: PrismaService) {}

  async markProvenance(tenantId: string, entityTypeValue: unknown, entityIdValue: unknown, provenanceValue: unknown) {
    const entityType = text(entityTypeValue);
    const entityId = text(entityIdValue);
    const provenance = { type: 'import', ...objectValue(provenanceValue) };
    if (!entityType || !entityId) return;
    await this.prisma.$executeRaw`
      UPDATE "BusinessHistoryEvent"
      SET "relations" = COALESCE("relations", '{}'::jsonb)
        || jsonb_build_object('provenance', ${JSON.stringify(provenance)}::jsonb)
      WHERE "tenantId" = ${tenantId}
        AND "entityType" = ${entityType}
        AND "entityId" = ${entityId}
    `;
  }

  async recordProcedureSnapshot(tenantId: string, inputValue: unknown) {
    const input = objectValue(inputValue);
    const procedureId = text(input.procedureId);
    const eventId = text(input.eventId);
    const at = moment(input.effectiveAt || input.occurredAt);
    if (!procedureId || !eventId || !at) return false;
    const snapshot = objectValue(input.snapshot);
    const provenance = { type: 'import', ...objectValue(input.provenance) };
    const relations = { procedure: procedureId, provenance };
    const data = { current: snapshot };
    const eventType = text(input.eventType) || 'update';
    await this.prisma.$executeRaw`
      INSERT INTO "BusinessHistoryEvent" (
        "tenantId", "eventId", "entityType", "entityId", "eventType", "status",
        "personKey", "recordId", "workplaceKey", "procedureId", "documentId",
        "inventoryItemId", "financeOperationId", "sourceType", "sourceId",
        "effectiveAt", "occurredAt", "relations", "data"
      ) VALUES (
        ${tenantId}, ${eventId}, 'procedure', ${procedureId}, ${eventType}, 'active',
        '', '', '', ${procedureId}, '', '', '', 'procedure', ${procedureId},
        ${at}, ${at}, ${JSON.stringify(relations)}::jsonb, ${JSON.stringify(data)}::jsonb
      )
      ON CONFLICT ("tenantId", "eventId") DO NOTHING
    `;
    return true;
  }
}
