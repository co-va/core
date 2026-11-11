import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';

@Injectable()
export class DocumentRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  // Read the persisted current edition, not the legal edition printed in source text.
  // Keep this read scoped behind the existing PlatformAdminGuard.
  async currentDocuments() {
    return this.prisma.$queryRaw<Array<{
      key: string;
      title: string;
      type: string;
      requiredForRegistration: boolean;
      version: number;
      content: string;
    }>>`
      SELECT d."key", d."title", d."type", d."requiredForRegistration",
             v."version", v."contentSnapshot" AS "content"
      FROM "PlatformDocument" d
      JOIN LATERAL (
        SELECT "version", "contentSnapshot"
        FROM "PlatformDocumentVersion"
        WHERE "documentId" = d."id"
        ORDER BY "version" DESC, "publishedAt" DESC
        LIMIT 1
      ) v ON true
      WHERE d."isActive" = true
      ORDER BY d."key" ASC
    `;
  }

  async tenantLegalTemplateBases() {
    const rows = await this.prisma.$queryRaw<Array<{
      key: string;
      title: string;
      version: number;
      content: string;
    }>>`
      SELECT
        d."key",
        d."title",
        v."version",
        v."contentSnapshot" AS "content"
      FROM "PlatformDocument" d
      JOIN LATERAL (
        SELECT "version","contentSnapshot"
        FROM "PlatformDocumentVersion"
        WHERE "documentId" = d."id" AND "supersededAt" IS NULL
        ORDER BY "version" DESC
        LIMIT 1
      ) v ON true
      WHERE d."isActive" = true
        AND d."key" IN (
          'user-document-pdn-policy',
          'user-document-pdn-consent',
          'user-document-messages-consent'
        )
    `;

    const config = new Map([
      ['user-document-pdn-policy', { documentId: 'pdn-agreement', kind: 'agreement', personConsent: false, required: false, order: 0 }],
      ['user-document-pdn-consent', { documentId: 'pdn-consent', kind: 'consent', personConsent: true, required: true, order: 1 }],
      ['user-document-messages-consent', { documentId: 'messages-consent', kind: 'consent', personConsent: true, required: false, order: 2 }],
    ]);
    const result = rows
      .map((row) => {
        const settings = config.get(row.key);
        if (!settings) return null;
        return {
          key: row.key,
          documentId: settings.documentId,
          kind: settings.kind,
          personConsent: settings.personConsent,
          required: settings.required,
          title: row.title,
          version: Math.max(1, Number(row.version || 1)),
          content: row.content,
          order: settings.order,
        };
      })
      .filter(Boolean)
      .sort((left: any, right: any) => left.order - right.order)
      .map(({ order, ...item }: any) => item);

    if (result.length !== 3) {
      throw new ConflictException('Реестр основных документов профиля заполнен не полностью');
    }
    return result;
  }

  async syncCatalog(input: unknown) {
    const items = Array.isArray(input) ? input : [];
    if (!items.length) throw new BadRequestException('Каталог документов пуст');

    const normalized = items.map((raw) => {
      const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const key = String(item.key || '').trim();
      const type = String(item.type || '').trim();
      const title = String(item.title || '').trim();
      const content = String(item.content || '').trim();
      if (!key || !type || !title || !content) throw new BadRequestException('Документ Реестра заполнен не полностью');
      return {
        key,
        type,
        title,
        content,
        requiredForRegistration: Boolean(item.requiredForRegistration),
        requiredForLive: Boolean(item.requiredForLive),
        requiredForPublicBooking: Boolean(item.requiredForPublicBooking),
      };
    });

    await this.prisma.$transaction(async (tx) => {
      for (const item of normalized) {
        const existing = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "PlatformDocument" WHERE "key" = ${item.key} LIMIT 1
        `;
        const documentId = existing[0]?.id || randomUUID();

        await tx.$executeRaw`
          INSERT INTO "PlatformDocument" (
            "id","key","type","title","requiredForRegistration","requiredForLive",
            "requiredForPublicBooking","isActive","createdAt","updatedAt"
          ) VALUES (
            ${documentId},${item.key},${item.type},${item.title},
            ${item.requiredForRegistration},${item.requiredForLive},
            ${item.requiredForPublicBooking},true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
          )
          ON CONFLICT ("key") DO UPDATE SET
            "type" = EXCLUDED."type",
            "title" = EXCLUDED."title",
            "requiredForRegistration" = EXCLUDED."requiredForRegistration",
            "requiredForLive" = EXCLUDED."requiredForLive",
            "requiredForPublicBooking" = EXCLUDED."requiredForPublicBooking",
            "isActive" = true,
            "updatedAt" = CURRENT_TIMESTAMP
        `;

        const hash = createHash('sha256').update(item.content, 'utf8').digest('hex');
        const latest = await tx.$queryRaw<Array<{ id: string; version: number; contentHash: string }>>`
          SELECT "id","version","contentHash"
          FROM "PlatformDocumentVersion"
          WHERE "documentId" = ${documentId}
          ORDER BY "version" DESC
          LIMIT 1
        `;
        if (latest[0]?.contentHash === hash) continue;

        if (latest[0]) {
          await tx.$executeRaw`
            UPDATE "PlatformDocumentVersion"
            SET "supersededAt" = CURRENT_TIMESTAMP
            WHERE "documentId" = ${documentId} AND "supersededAt" IS NULL
          `;
        }

        await tx.$executeRaw`
          INSERT INTO "PlatformDocumentVersion" (
            "id","documentId","version","contentSnapshot","contentHash",
            "operatorIdentitySnapshot","publishedAt","supersededAt"
          ) VALUES (
            ${randomUUID()},${documentId},${Number(latest[0]?.version || 0) + 1},
            ${item.content},${hash},'{}'::jsonb,CURRENT_TIMESTAMP,NULL
          )
        `;
      }
    });

    return { synchronized: normalized.length };
  }

  history() {
    return this.prisma.$queryRaw<Array<{
      id: string;
      subjectType: string;
      subjectId: string;
      tenantId: string | null;
      tenantName: string | null;
      platformAccountId: string;
      accountId: string;
      accountEmail: string;
      documentKey: string;
      documentTitle: string;
      documentVersion: number;
      documentContent: string;
      action: string;
      source: string;
      technicalEvidence: unknown;
      occurredAt: Date;
    }>>`
      SELECT *
      FROM (
        SELECT
          e."id",
          'PLATFORM_ACCOUNT'::text AS "subjectType",
          e."platformAccountId" AS "subjectId",
          e."tenantId",
          t."name" AS "tenantName",
          e."platformAccountId",
          ''::text AS "accountId",
          a."email" AS "accountEmail",
          d."key" AS "documentKey",
          d."title" AS "documentTitle",
          v."version" AS "documentVersion",
          v."contentSnapshot" AS "documentContent",
          e."action",
          e."source",
          e."technicalEvidence",
          e."occurredAt"
        FROM "PlatformConsentEvent" e
        JOIN "PlatformDocumentVersion" v ON v."id" = e."documentVersionId"
        JOIN "PlatformDocument" d ON d."id" = v."documentId"
        LEFT JOIN "PlatformAccount" a ON a."id" = e."platformAccountId"
        LEFT JOIN "Tenant" t ON t."id" = e."tenantId"

        UNION ALL

        SELECT
          e."id",
          'ACCOUNT'::text AS "subjectType",
          e."accountId" AS "subjectId",
          NULL::text AS "tenantId",
          NULL::text AS "tenantName",
          ''::text AS "platformAccountId",
          e."accountId",
          a."email" AS "accountEmail",
          d."key" AS "documentKey",
          d."title" AS "documentTitle",
          v."version" AS "documentVersion",
          v."contentSnapshot" AS "documentContent",
          e."action",
          e."source",
          e."technicalEvidence",
          e."occurredAt"
        FROM "AccountDocumentEvent" e
        JOIN "PlatformDocumentVersion" v ON v."id" = e."documentVersionId"
        JOIN "PlatformDocument" d ON d."id" = v."documentId"
        JOIN "Account" a ON a."id" = e."accountId"
      ) history
      ORDER BY history."occurredAt" DESC, history."id" DESC
    `;
  }
}
