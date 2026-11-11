import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';

type AccountTermsRow = {
  documentId: string;
  documentVersionId: string;
  key: string;
  title: string;
  version: number;
  contentSnapshot: string;
  changeType: string;
  requiresAcceptance: boolean;
  publishedAt: Date;
};

type AcceptanceRow = {
  id: string;
  documentVersionId: string;
  version: number;
  action: string;
  source: string;
  occurredAt: Date;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

@Injectable()
export class AccountDocumentService {
  constructor(private readonly prisma: PrismaService) {}

  private async currentTerms() {
    const rows = await this.prisma.$queryRaw<AccountTermsRow[]>`
      SELECT
        d."id" AS "documentId",
        v."id" AS "documentVersionId",
        d."key",
        d."title",
        v."version",
        v."contentSnapshot",
        v."changeType",
        v."requiresAcceptance",
        v."publishedAt"
      FROM "PlatformDocument" d
      JOIN LATERAL (
        SELECT *
        FROM "PlatformDocumentVersion"
        WHERE "documentId" = d."id"
        ORDER BY "version" DESC, "publishedAt" DESC
        LIMIT 1
      ) v ON true
      WHERE d."key" = 'account-terms'
        AND d."isActive" = true
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Условия использования учетной записи не опубликованы');
    return row;
  }

  private async requiredVersion(documentId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ requiredVersion: number }>>`
      SELECT COALESCE(MAX("version") FILTER (WHERE "requiresAcceptance" = true), 1)::int AS "requiredVersion"
      FROM "PlatformDocumentVersion"
      WHERE "documentId" = ${documentId}
    `;
    return Math.max(1, Number(rows[0]?.requiredVersion || 1));
  }

  private async latestAcceptance(accountId: string, documentId: string) {
    if (!accountId) return null;
    const rows = await this.prisma.$queryRaw<AcceptanceRow[]>`
      SELECT
        e."id",
        e."documentVersionId",
        v."version",
        e."action",
        e."source",
        e."occurredAt"
      FROM "AccountDocumentEvent" e
      JOIN "PlatformDocumentVersion" v ON v."id" = e."documentVersionId"
      WHERE e."accountId" = ${accountId}
        AND v."documentId" = ${documentId}
        AND e."action" = 'ACCEPTED'
      ORDER BY e."occurredAt" DESC, e."createdAt" DESC, e."id" DESC
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async publicTerms() {
    const current = await this.currentTerms();
    return {
      key: current.key,
      title: current.title,
      version: current.version,
      content: current.contentSnapshot,
      changeType: current.changeType,
      requiresAcceptance: current.requiresAcceptance,
      publishedAt: current.publishedAt.toISOString(),
    };
  }

  // Canonical User PDN policy: one current legal snapshot in core DB.
  // This is an informational document; no signature event is required.
  async publicPrivacyPolicy() {
    const rows = await this.prisma.$queryRaw<Array<{
      key: string; title: string; version: number;
      content: string; publishedAt: Date;
    }>>`
      SELECT d."key", d."title", v."version",
             v."contentSnapshot" AS "content", v."publishedAt"
      FROM "PlatformDocument" d
      JOIN LATERAL (
        SELECT "version", "contentSnapshot", "publishedAt"
        FROM "PlatformDocumentVersion"
        WHERE "documentId" = d."id"
        ORDER BY "version" DESC, "publishedAt" DESC
        LIMIT 1
      ) v ON true
      WHERE d."key" = 'platform-privacy-policy'
        AND d."isActive" = true
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null; // Migration may not yet be deployed to this backend.
    return {
      key: row.key,
      title: row.title,
      version: row.version,
      content: row.content,
      publishedAt: row.publishedAt.toISOString(),
    };
  }

  async state(accountIdValue: unknown) {
    const accountId = text(accountIdValue);
    const current = await this.currentTerms();
    const requiredVersion = await this.requiredVersion(current.documentId);
    const acceptance = accountId ? await this.latestAcceptance(accountId, current.documentId) : null;
    const acceptedVersion = Math.max(0, Number(acceptance?.version || 0));
    return {
      privacyPolicy: await this.publicPrivacyPolicy(),
      document: {
        key: current.key,
        title: current.title,
        version: current.version,
        content: current.contentSnapshot,
        changeType: current.changeType,
        requiresAcceptance: current.requiresAcceptance,
        publishedAt: current.publishedAt.toISOString(),
      },
      requiredVersion,
      accepted: Boolean(acceptance && acceptedVersion >= requiredVersion),
      acceptedVersion,
      acceptedAt: acceptance?.occurredAt.toISOString() || '',
      source: acceptance?.source || '',
      eventId: acceptance?.id || '',
    };
  }

  async accept(
    accountIdValue: unknown,
    factValue: unknown,
    source = 'account',
    evidenceValue: unknown = {},
  ) {
    const accountId = text(accountIdValue);
    if (!accountId) throw new BadRequestException('Не указан аккаунт');

    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { id: true } });
    if (!account) throw new NotFoundException('Аккаунт не найден');

    const current = await this.currentTerms();
    const fact = objectValue(factValue);
    const accepted = Boolean(fact.accepted);
    const key = text(fact.key);
    const version = Math.max(1, Number(fact.version || 1));

    if (!accepted) throw new BadRequestException('Необходимо принять Условия использования учетной записи');
    if (key !== current.key || version !== current.version) {
      throw new BadRequestException('Редакция Условий изменилась. Откройте актуальную версию и подтвердите её.');
    }

    const evidence = {
      ...objectValue(evidenceValue),
      submittedKey: key,
      submittedVersion: version,
      submittedAcceptedAt: text(fact.acceptedAt),
    };
    const evidenceJson = JSON.stringify(evidence);
    const occurredAt = new Date();
    const id = randomUUID();

    await this.prisma.$executeRaw`
      INSERT INTO "AccountDocumentEvent" (
        "id", "accountId", "documentVersionId", "action",
        "source", "technicalEvidence", "occurredAt", "createdAt"
      ) VALUES (
        ${id}, ${accountId}, ${current.documentVersionId}, 'ACCEPTED',
        ${text(source)}, ${evidenceJson}::jsonb, ${occurredAt}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("accountId", "documentVersionId", "action") DO NOTHING
    `;

    return this.state(accountId);
  }
}
