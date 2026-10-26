import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';

type JsonObject = Record<string, any>;
type TenantConsentEventRow = {
  id: string;
  subjectType: string;
  subjectKey: string;
  contactType: string;
  contactValue: string;
  documentId: string;
  documentVersion: number;
  status: string;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  source: string;
  occurredAt: Date;
  createdAt: Date;
};

const MUTABLE_DATASETS = new Set(['documents', 'history']);
const CURRENT_CONSENT_DOCUMENTS = new Map([
  ['pdn-consent', 'pdnActive'],
  ['messages-consent', 'marketingActive'],
]);

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function isCanonicalRknGuide(item: any, templateKey = '') {
  const attachment = objectValue(item?.attachment);
  return (
    attachment.type === 'RKN_GUIDE_PDF'
    && Boolean(text(attachment.templateKey))
    && Number(attachment.templateVersion || 0) > 0
    && Boolean(text(attachment.sourceHash))
    && Boolean(text(attachment.pdfBase64))
    && (!templateKey || text(attachment.templateKey) === templateKey)
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function normalize(value: unknown) {
  const source = objectValue(value);
  return {
    documents: Array.isArray(source.documents) ? clone(source.documents) : [],
    history: Array.isArray(source.history) ? clone(source.history) : [],
    helpers: clone(objectValue(source.helpers)),
  };
}

function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonical(value: unknown) {
  return JSON.stringify(stable(normalize(value)));
}

function json(value: unknown): Prisma.InputJsonValue {
  return clone(value) as Prisma.InputJsonValue;
}

function consentInvalidations(currentDocuments: any[], nextDocuments: any[]) {
  const invalid = new Set<string>();
  for (const [documentId, field] of CURRENT_CONSENT_DOCUMENTS) {
    const previous = currentDocuments.find((item) => text(item?.id) === documentId) || null;
    const next = nextDocuments.find((item) => text(item?.id) === documentId) || null;
    const previousVersion = previous ? Math.max(1, Number(previous?.version || 1)) : 0;
    const nextVersion = next ? Math.max(1, Number(next?.version || 1)) : 0;
    if (
      previousVersion !== nextVersion
      || Boolean(previous?.personConsent) !== Boolean(next?.personConsent)
    ) invalid.add(field);
  }
  return invalid;
}

function publicConsentEvent(row: TenantConsentEventRow) {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectKey: row.subjectKey,
    contactType: row.contactType,
    contactValue: row.contactValue,
    documentId: row.documentId,
    documentVersion: row.documentVersion,
    status: row.status,
    acceptedAt: row.acceptedAt?.toISOString() || '',
    revokedAt: row.revokedAt?.toISOString() || '',
    source: row.source,
    eventAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TenantDocumentArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  private async canonicalConsentEvents(tenantId: string) {
    const rows = await this.prisma.$queryRaw<TenantConsentEventRow[]>`
      SELECT "id", "subjectType", "subjectKey", "contactType", "contactValue", "documentId",
             "documentVersion", "status", "acceptedAt", "revokedAt", "source", "occurredAt",
             "createdAt"
      FROM "TenantConsentEvent"
      WHERE "tenantId" = ${tenantId}
      ORDER BY "occurredAt" ASC, "createdAt" ASC, "id" ASC
    `;
    return rows.map(publicConsentEvent);
  }

  private async snapshot(tenantId: string) {
    const state = await this.prisma.tenantDocumentArchive.findUnique({ where: { tenantId } });
    if (!state) throw new NotFoundException('Архив документов не найден');
    const stored = normalize(state.data || {});
    const consents = await this.canonicalConsentEvents(tenantId);
    return { data: { ...stored, consents } };
  }

  private async invalidateCurrentConsentState(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fields: Set<string>,
  ) {
    if (!fields.size) return;
    const rows = await tx.person.findMany({ where: { tenantId } });
    for (const row of rows) {
      const person = objectValue(row.data);
      const consentState = objectValue(person.consentState);
      const nextState = { ...consentState };
      let changed = false;
      for (const field of fields) {
        if (nextState[field] !== false) {
          nextState[field] = false;
          changed = true;
        }
      }
      if (!changed) continue;
      await tx.person.update({
        where: { id: row.id },
        data: { data: json({ ...person, consentState: nextState }) },
      });
    }
  }

  get(tenantId: string) { return this.snapshot(tenantId); }

  async initialize(tenantId: string, body: unknown) {
    await this.prisma.tenantDocumentArchive.upsert({
      where: { tenantId },
      create: { tenantId, data: json(normalize(body)) },
      update: {},
    });
    return this.snapshot(tenantId);
  }

  async updateDataset(tenantId: string, dataset: string, body: unknown) {
    if (!MUTABLE_DATASETS.has(dataset)) throw new BadRequestException('Неизвестный раздел Архива документов');
    const state = await this.prisma.tenantDocumentArchive.findUnique({ where: { tenantId } });
    if (!state) throw new NotFoundException('Архив документов не найден');
    const current = normalize(state.data);
    const source = objectValue(body);
    const value = source.value;
    const nextValue = Array.isArray(value) ? clone(value) : [];
    const invalidations = dataset === 'documents'
      ? consentInvalidations(current.documents, nextValue)
      : new Set<string>();
    current[dataset as keyof typeof current] = nextValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantDocumentArchive.update({ where: { tenantId }, data: { data: json(current) } });
      await this.invalidateCurrentConsentState(tx, tenantId, invalidations);
    });
    return { dataset, value: current[dataset as keyof typeof current] };
  }

  async rememberRknGuideState(tenantId: string, inputValue: unknown) {
    const state = await this.prisma.tenantDocumentArchive.findUnique({ where: { tenantId } });
    if (!state) throw new NotFoundException('Архив документов не найден');
    const current = normalize(state.data);
    const input = objectValue(inputValue);
    current.helpers = objectValue(current.helpers);
    current.helpers.rkn = {
      snapshot: clone(objectValue(input.snapshot)),
      documentId: text(input.documentId),
      generatedAt: text(input.generatedAt),
    };
    await this.prisma.tenantDocumentArchive.update({
      where: { tenantId },
      data: { data: json(current) },
    });
    return clone(current.helpers.rkn);
  }

  async saveRknGuide(tenantId: string, inputValue: unknown) {
    const state = await this.prisma.tenantDocumentArchive.findUnique({ where: { tenantId } });
    if (!state) throw new NotFoundException('Архив документов не найден');

    const current = normalize(state.data);

    const input = objectValue(inputValue);
    const snapshot = objectValue(input.snapshot);
    const templateKey = String(input.templateKey || '').trim();
    const templateVersion = Number(input.templateVersion || 0);
    const templateContent = String(input.templateContent || '');
    const personalizedContent = String(input.personalizedContent || '');
    const pdfBase64 = String(input.pdfBase64 || '');
    const guideMode = String(input.guideMode || '').toUpperCase() === 'UPDATE' ? 'UPDATE' : 'INITIAL';
    if (!templateKey || !templateVersion || !templateContent || !personalizedContent || !pdfBase64) {
      throw new BadRequestException('Персональная инструкция РКН сформирована не полностью');
    }

    const source = { templateKey, templateVersion, templateContent, snapshot, guideMode };
    const sourceHash = createHash('sha256').update(JSON.stringify(stable(source)), 'utf8').digest('hex');
    const existing = current.documents.find((item: any) => (
      isCanonicalRknGuide(item, templateKey)
      && item?.attachment?.sourceHash === sourceHash
    ));
    if (existing) {
      return clone(existing);
    }

    const generatedAt = new Date().toISOString();
    const title = guideMode === 'INITIAL'
      ? 'Инструкция по уведомлению Роскомнадзора'
      : 'Инструкция по изменению сведений Роскомнадзора';
    const document = {
      id: `rkn-guide-${randomUUID()}`,
      system: true,
      kind: 'instruction',
      documentClass: 'FILE',
      signable: false,
      title,
      personConsent: false,
      required: false,
      version: 1,
      text: personalizedContent,
      sourceMode: 'BOOK',
      baseKey: templateKey,
      baseVersion: templateVersion,
      attachment: {
        type: 'RKN_GUIDE_PDF',
        guideMode,
        fileName: guideMode === 'INITIAL'
          ? 'rkn-guide-initial.pdf'
          : `rkn-guide-update-${generatedAt.slice(0, 10)}.pdf`,
        mimeType: 'application/pdf',
        generatedAt,
        templateKey,
        templateVersion,
        sourceHash,
        snapshot: clone(snapshot),
        pdfBase64,
      },
    };
    current.documents.push(document);
    current.helpers = objectValue(current.helpers);
    current.helpers.rkn = {
      snapshot: clone(snapshot),
      documentId: document.id,
      generatedAt,
    };

    await this.prisma.tenantDocumentArchive.update({
      where: { tenantId },
      data: { data: json(current) },
    });
    return clone(document);
  }

  async rknGuideDocument(tenantId: string, documentId: string) {
    const state = await this.prisma.tenantDocumentArchive.findUnique({ where: { tenantId } });
    if (!state) throw new NotFoundException('Архив документов не найден');
    const document = normalize(state.data).documents.find((item: any) => (
      String(item?.id || '') === documentId
      && item?.attachment?.type === 'RKN_GUIDE_PDF'
    ));
    if (!document) throw new NotFoundException('Инструкция РКН не найдена');
    const attachment = objectValue(document?.attachment);
    if (!isCanonicalRknGuide(document)) throw new ConflictException('Файл инструкции имеет неподдерживаемый формат');
    return clone(document);
  }

  async publicDocuments(tenantId: string) {
    const state = await this.prisma.tenantDocumentArchive.findUnique({ where: { tenantId } });
    if (!state) throw new NotFoundException('Архив документов не найден');
    return normalize(state.data).documents.filter((document: any) => (
      !document?.hidden
      && String(document?.documentClass || '') !== 'FILE'
      && Boolean(document?.signable || document?.personConsent)
    ));
  }

}
