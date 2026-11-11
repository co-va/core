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
      publishedAt: Date;
    }>>`
      SELECT d."key", d."title", d."type", d."requiredForRegistration",
             v."version", v."contentSnapshot" AS "content", v."publishedAt",
             v."editorEdition", ed."application"
      FROM "PlatformDocument" d
      JOIN LATERAL (
        SELECT "version", "contentSnapshot", "publishedAt"
        FROM "PlatformDocumentVersion"
        WHERE "documentId" = d."id"
        ORDER BY "version" DESC, "publishedAt" DESC
        LIMIT 1
      ) v ON true
      LEFT JOIN "PlatformDocumentDraft" ed ON ed."key"=d."key"
      WHERE d."isActive" = true
      ORDER BY d."key" ASC
    `;
  }


  // Editorial drafts are never part of PlatformDocumentVersion or consent history.
  // All routes invoking these methods are protected by JwtAuthGuard + PlatformAdminGuard.
  async adminDrafts() {
    return this.prisma.$queryRaw<Array<{
      key: string; application: string; title: string; type: string; content: string;
      edition: string; requiredForRegistration: boolean; baseVersion: number;
    }>>`
      SELECT "key","application","title","type","content","edition",
             "requiredForRegistration","baseVersion"
      FROM "PlatformDocumentDraft"
      WHERE "draftActive" = true
      ORDER BY "createdAt" ASC
    `;
  }

  async saveAdminDraft(input: unknown) {
    const body = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown> : {};
    const requestedKey = String(body.key || '').trim();
    const requestedApplication = String(body.application || '').trim().toLowerCase();
    if (!['professional','user'].includes(requestedApplication)) {
      throw new BadRequestException('Не выбрано приложение документа');
    }
    const key = requestedKey || `admin-${requestedApplication}-${randomUUID()}`;
    if (!/^[a-z0-9][a-z0-9-]{1,110}$/.test(key)) {
      throw new BadRequestException('Некорректный ключ документа');
    }
    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    const edition = String(body.edition || '').trim();
    if (!title || title.length > 250 || content.length > 200_000 || edition.length > 40) {
      throw new BadRequestException('Проверьте название, редакцию и текст документа');
    }
    const saved = await this.prisma.$queryRaw<Array<{
      application: string; baseVersion: number; draftActive: boolean;
    }>>`
      SELECT "application","baseVersion","draftActive"
      FROM "PlatformDocumentDraft" WHERE "key" = ${key}
    `;
    const existing = await this.prisma.$queryRaw<Array<{
      version: number; type: string; requiredForRegistration: boolean;
    }>>`
      SELECT v."version",d."type",d."requiredForRegistration"
      FROM "PlatformDocument" d
      LEFT JOIN LATERAL (
        SELECT "version" FROM "PlatformDocumentVersion"
        WHERE "documentId" = d."id" ORDER BY "version" DESC LIMIT 1
      ) v ON true
      WHERE d."key" = ${key}
    `;
    if (!saved.length && !existing.length && !key.startsWith(`admin-${requestedApplication}-`)) {
      throw new BadRequestException('Новый документ должен создаваться через реестр');
    }
    const application = saved[0]?.application ||
      (key === 'account-terms' || key === 'platform-privacy-policy' || key.startsWith('admin-user-')
        ? 'user' : 'professional');
    if (application !== requestedApplication) {
      throw new BadRequestException('Документ принадлежит другому приложению');
    }
    const requestedType = String(body.type || '').toUpperCase();
    const type = existing[0]?.type || (requestedType === 'CUSTOM_WORKING' ? 'CUSTOM_WORKING' : 'CUSTOM_LEGAL');
    const required = existing.length ? Boolean(existing[0].requiredForRegistration) : Boolean(body.requiredForRegistration);
    const baseVersion = saved[0]?.draftActive
      ? Number(saved[0].baseVersion)
      : Number(existing[0]?.version || 0);
    await this.prisma.$executeRaw`
      INSERT INTO "PlatformDocumentDraft" (
        "key","application","title","type","content","edition",
        "requiredForRegistration","baseVersion","draftActive","publishedOnce"
      ) VALUES (
        ${key},${application},${title},${type},${content},${edition},
        ${required},${baseVersion},true,false
      )
      ON CONFLICT ("key") DO UPDATE SET
        "title"=EXCLUDED."title","type"=EXCLUDED."type",
        "content"=EXCLUDED."content","edition"=EXCLUDED."edition",
        "requiredForRegistration"=EXCLUDED."requiredForRegistration",
        "baseVersion"=EXCLUDED."baseVersion","draftActive"=true,
        "updatedAt"=CURRENT_TIMESTAMP
    `;
    return { key, application, title, type, content, edition, requiredForRegistration: required, baseVersion };
  }

  async publishAdminDraft(keyInput: string) {
    const key = String(keyInput || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{1,110}$/.test(key)) {
      throw new BadRequestException('Некорректный документ');
    }
    return this.prisma.$transaction(async (tx) => {
      const drafts = await tx.$queryRaw<Array<{
        key: string; title: string; type: string; content: string; edition: string;
        requiredForRegistration: boolean; baseVersion: number;
      }>>`
        SELECT "key","title","type","content","edition","requiredForRegistration","baseVersion"
        FROM "PlatformDocumentDraft"
        WHERE "key" = ${key} AND "draftActive" = true FOR UPDATE
      `;
      const draft = drafts[0];
      if (!draft) throw new BadRequestException('Сохранённый черновик не найден');
      if (!draft.title.trim() || !draft.content.trim() || !draft.edition.trim()) {
        throw new BadRequestException('Для публикации нужны название, редакция и текст');
      }
      const existing = await tx.$queryRaw<Array<{ id: string; type: string }>>`
        SELECT "id","type" FROM "PlatformDocument" WHERE "key" = ${key} FOR UPDATE
      `;
      const documentId = existing[0]?.id || randomUUID();
      const latest = existing.length ? await tx.$queryRaw<Array<{
        version: number; contentHash: string; editorEdition: string | null;
      }>>`
        SELECT "version","contentHash","editorEdition" FROM "PlatformDocumentVersion"
        WHERE "documentId" = ${documentId} ORDER BY "version" DESC LIMIT 1
      ` : [];
      const currentVersion = Number(latest[0]?.version || 0);
      if (Number(draft.baseVersion) !== currentVersion) {
        throw new ConflictException('Документ обновился после создания черновика. Необходимо сверить редакции.');
      }
      const contentHash = createHash('sha256').update(draft.content, 'utf8').digest('hex');
      if (latest[0]?.contentHash === contentHash) {
        throw new BadRequestException('Текст не изменён. Новая редакция не требуется.');
      }
      await tx.$executeRaw`
        INSERT INTO "PlatformDocument" (
          "id","key","type","title","requiredForRegistration",
          "requiredForLive","requiredForPublicBooking","isActive","createdAt","updatedAt"
        ) VALUES (
          ${documentId},${key},${draft.type},${draft.title},
          ${draft.requiredForRegistration},false,false,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
        ) ON CONFLICT ("key") DO UPDATE SET
          "title"=EXCLUDED."title","isActive"=true,"updatedAt"=CURRENT_TIMESTAMP
      `;
      if (latest.length) {
        await tx.$executeRaw`
          UPDATE "PlatformDocumentVersion"
          SET "supersededAt"=CURRENT_TIMESTAMP
          WHERE "documentId"=${documentId} AND "supersededAt" IS NULL
        `;
      }
      const version = currentVersion + 1;
      await tx.$executeRaw`
        INSERT INTO "PlatformDocumentVersion" (
          "id","documentId","version","contentSnapshot","contentHash",
          "operatorIdentitySnapshot","publishedAt","supersededAt","editorEdition"
        ) VALUES (
          ${randomUUID()},${documentId},${version},${draft.content},${contentHash},
          '{}'::jsonb,CURRENT_TIMESTAMP,NULL,${draft.edition}
        )
      `;
      await tx.$executeRaw`
        UPDATE "PlatformDocumentDraft" SET
          "draftActive"=false,"publishedOnce"=true,"content"='',"baseVersion"=${version},
          "updatedAt"=CURRENT_TIMESTAMP
        WHERE "key"=${key}
      `;
      return { key, version, edition: draft.edition };
    });
  }

  async archivedAdminVersions() {
    return this.prisma.$queryRaw<Array<{
      id: string; documentKey: string; documentTitle: string; documentVersion: number;
      documentContent: string; editorEdition: string | null; publishedAt: Date;
      supersededAt: Date; application: string;
    }>>`
      SELECT v."id",d."key" AS "documentKey",d."title" AS "documentTitle",
             v."version" AS "documentVersion",v."contentSnapshot" AS "documentContent",
             v."editorEdition",v."publishedAt",v."supersededAt",
             COALESCE(ed."application",
               CASE WHEN d."key" IN ('account-terms','platform-privacy-policy')
                 THEN 'user' ELSE 'professional' END) AS "application"
      FROM "PlatformDocumentVersion" v
      JOIN "PlatformDocument" d ON d."id"=v."documentId"
      LEFT JOIN "PlatformDocumentDraft" ed ON ed."key"=d."key"
      WHERE v."supersededAt" IS NOT NULL
      ORDER BY v."supersededAt" DESC,v."id" DESC
      LIMIT 500
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
        // Admin-published revisions must never be reverted by the static seed on login.
        const editorOwned = await tx.$queryRaw<Array<{ key: string }>>`
          SELECT "key" FROM "PlatformDocumentDraft"
          WHERE "key"=${item.key} AND "publishedOnce"=true
        `;
        if (editorOwned.length) continue;
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
