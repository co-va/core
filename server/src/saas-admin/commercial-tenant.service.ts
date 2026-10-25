import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { CommercialCatalogService } from './commercial-catalog.service';

type ProductRow = {
  id: string;
  key: string;
  name: string;
  type: string;
  priceMinor: number;
  currency: string;
  isActive: boolean;
  isSaleable: boolean;
  isFree: boolean;
};

type InclusionRow = { parentProductId: string; childProductId: string };
type CapabilityLink = { productId: string; capabilityKey: string };

type TermsRow = {
  tenantId: string;
  discountPercent: number;
  freeForever: boolean;
  freeUntil: Date | null;
  livePaidStartsAt: Date | null;
  updatedByAdminId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function discount(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new BadRequestException('Скидка должна быть целым числом от 0 до 100');
  }
  return parsed;
}

function optionalDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Некорректная дата');
  return parsed;
}

@Injectable()
export class CommercialTenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CommercialCatalogService,
  ) {}

  private async audit(actorAdminId: string | null, tenantId: string, eventType: string, entityType: string, entityId: string, metadata: unknown = {}) {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "CommercialAuditEvent" ("id","actorAdminId","tenantId","eventType","entityType","entityId","metadata","occurredAt") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,CURRENT_TIMESTAMP)`,
      randomUUID(), actorAdminId, tenantId, eventType, entityType, entityId, JSON.stringify(metadata ?? {}),
    );
  }

  private async productGraph() {
    await this.catalogService.syncAppCatalog();
    const [products, inclusions, capabilityLinks] = await Promise.all([
      this.prisma.$queryRawUnsafe<ProductRow[]>(
        `SELECT "id","key","name","type","priceMinor","currency","isActive","isSaleable","isFree" FROM "CommercialProduct" ORDER BY "position" ASC,"name" ASC`,
      ),
      this.prisma.$queryRawUnsafe<InclusionRow[]>(
        `SELECT "parentProductId","childProductId" FROM "CommercialProductInclusion" ORDER BY "position" ASC`,
      ),
      this.prisma.$queryRawUnsafe<CapabilityLink[]>(
        `SELECT "productId","capabilityKey" FROM "CommercialProductCapability"`,
      ),
    ]);
    return { products, inclusions, capabilityLinks };
  }

  private expandSelectedProductIds(selectedIds: Set<string>, inclusions: InclusionRow[]) {
    const result = new Set(selectedIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of inclusions) {
        if (result.has(row.parentProductId) && !result.has(row.childProductId)) {
          result.add(row.childProductId);
          changed = true;
        }
      }
    }
    return result;
  }

  private quote(products: ProductRow[], selectedProductIds: Set<string>, terms: Pick<TermsRow, 'discountPercent' | 'freeForever' | 'freeUntil'> | null) {
    const selected = products.filter((product) => selectedProductIds.has(product.id));
    const subtotalMinor = selected.reduce(
      (sum, product) => sum + (product.isFree ? 0 : Math.max(0, Number(product.priceMinor || 0))),
      0,
    );
    const now = Date.now();
    const freeUntilActive = Boolean(terms?.freeUntil && terms.freeUntil.getTime() >= now);
    const effectiveDiscountPercent = terms?.freeForever || freeUntilActive ? 100 : Number(terms?.discountPercent || 0);
    const discountMinor = Math.round(subtotalMinor * effectiveDiscountPercent / 100);
    return {
      subtotalMinor,
      discountPercent: Number(terms?.discountPercent || 0),
      effectiveDiscountPercent,
      discountMinor,
      totalMinor: Math.max(0, subtotalMinor - discountMinor),
      currency: selected[0]?.currency || 'RUB',
      freeForever: Boolean(terms?.freeForever),
      freeUntil: terms?.freeUntil?.toISOString() || '',
    };
  }

  async getTenantCommercial(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Пользователь не найден');
    const { products, inclusions } = await this.productGraph();
    const [termsRows, selectedRows, accessRows, audit] = await Promise.all([
      this.prisma.$queryRawUnsafe<TermsRow[]>(`SELECT * FROM "CommercialTenantTerms" WHERE "tenantId"=$1`, tenantId),
      this.prisma.$queryRawUnsafe<Array<{ productId: string }>>(`SELECT "productId" FROM "CommercialTenantProduct" WHERE "tenantId"=$1`, tenantId),
      this.prisma.$queryRawUnsafe<Array<{ commercialMode: string; liveApprovedAt: Date | null }>>(`SELECT "commercialMode","liveApprovedAt" FROM "TenantAccess" WHERE "tenantId"=$1`, tenantId),
      this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "id","eventType","entityType","entityId","metadata","occurredAt" FROM "CommercialAuditEvent" WHERE "tenantId"=$1 ORDER BY "occurredAt" DESC LIMIT 100`, tenantId,
      ),
    ]);
    const terms = termsRows[0] || null;
    const selectedIds = new Set(selectedRows.map((row) => row.productId));
    const expandedIds = this.expandSelectedProductIds(selectedIds, inclusions);
    const quote = this.quote(products, selectedIds, terms);
    const access = accessRows[0] || null;
    return {
      tenantId,
      terms: {
        discountPercent: terms?.discountPercent || 0,
        freeForever: terms?.freeForever || false,
        freeUntil: terms?.freeUntil?.toISOString() || '',
        livePaidStartsAt: terms?.livePaidStartsAt?.toISOString() || access?.liveApprovedAt?.toISOString() || '',
      },
      quote,
      access,
      products: products.filter((product) => product.isActive && product.isSaleable).map((product) => ({
        ...product,
        selected: selectedIds.has(product.id),
        includedBySelection: !selectedIds.has(product.id) && expandedIds.has(product.id),
      })),
      audit,
    };
  }

  async updateTenantCommercial(tenantId: string, input: Record<string, unknown>, actorAdminId: string | null) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Пользователь не найден');
    const { products, inclusions, capabilityLinks } = await this.productGraph();
    const selectedKeys = Array.isArray(input.productKeys)
      ? [...new Set(input.productKeys.map(text).filter(Boolean))]
      : [];
    const selectable = new Map(products.filter((product) => product.isActive && product.isSaleable).map((product) => [product.key, product]));
    for (const key of selectedKeys) {
      if (!selectable.has(key)) throw new BadRequestException(`Неизвестный коммерческий инструмент: ${key}`);
    }
    const selectedProducts = selectedKeys.map((key) => selectable.get(key)!);
    const selectedIds = new Set(selectedProducts.map((product) => product.id));
    const expandedIds = this.expandSelectedProductIds(selectedIds, inclusions);
    const discountPercent = discount(input.discountPercent);
    const freeForever = input.freeForever === true;
    const freeUntil = freeForever ? null : optionalDate(input.freeUntil);
    const [access] = await this.prisma.$queryRawUnsafe<Array<{ liveApprovedAt: Date | null }>>(
      `SELECT "liveApprovedAt" FROM "TenantAccess" WHERE "tenantId"=$1`, tenantId,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "CommercialTenantTerms" ("tenantId","discountPercent","freeForever","freeUntil","livePaidStartsAt","updatedByAdminId","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
         ON CONFLICT ("tenantId") DO UPDATE SET "discountPercent"=EXCLUDED."discountPercent","freeForever"=EXCLUDED."freeForever","freeUntil"=EXCLUDED."freeUntil","livePaidStartsAt"=COALESCE("CommercialTenantTerms"."livePaidStartsAt",EXCLUDED."livePaidStartsAt"),"updatedByAdminId"=EXCLUDED."updatedByAdminId","updatedAt"=CURRENT_TIMESTAMP`,
        tenantId, discountPercent, freeForever, freeUntil, access?.liveApprovedAt || null, actorAdminId,
      );
      await tx.$executeRawUnsafe(`DELETE FROM "CommercialTenantProduct" WHERE "tenantId"=$1`, tenantId);
      for (const product of selectedProducts) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "CommercialTenantProduct" ("tenantId","productId","createdAt") VALUES ($1,$2,CURRENT_TIMESTAMP)`,
          tenantId, product.id,
        );
      }

      const managedCapabilityKeys = [...new Set(capabilityLinks
        .filter((link) => products.some((product) => product.id === link.productId && product.isSaleable))
        .map((link) => link.capabilityKey))];
      const enabledCapabilityKeys = new Set(capabilityLinks
        .filter((link) => expandedIds.has(link.productId))
        .map((link) => link.capabilityKey));
      if (managedCapabilityKeys.length) {
        const capabilityRows = await tx.$queryRawUnsafe<Array<{ id: string; key: string; valueType: string }>>(
          `SELECT "id","key","valueType"::text AS "valueType" FROM "Capability" WHERE "key" = ANY($1::text[])`, managedCapabilityKeys,
        );
        for (const capability of capabilityRows) {
          if (capability.valueType !== 'BOOLEAN') continue;
          await tx.$executeRawUnsafe(
            `INSERT INTO "TenantCapabilityOverride" ("id","tenantId","capabilityId","enabled","limit","createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
             ON CONFLICT ("tenantId","capabilityId") DO UPDATE SET "enabled"=EXCLUDED."enabled","limit"=NULL,"updatedAt"=CURRENT_TIMESTAMP`,
            randomUUID(), tenantId, capability.id, enabledCapabilityKeys.has(capability.key),
          );
        }
      }
    });

    const quote = this.quote(products, selectedIds, { discountPercent, freeForever, freeUntil } as TermsRow);
    await this.audit(actorAdminId, tenantId, 'TENANT_COMMERCIAL_TERMS_UPDATED', 'TENANT', tenantId, {
      productKeys: selectedKeys,
      discountPercent,
      freeForever,
      freeUntil: freeUntil?.toISOString() || '',
      quote,
    });
    return this.getTenantCommercial(tenantId);
  }

  async createOrderSnapshot(tenantId: string, actorAdminId: string | null) {
    const commercial = await this.getTenantCommercial(tenantId);
    const selected = commercial.products.filter((product) => product.selected);
    const [publication] = await this.prisma.$queryRawUnsafe<Array<{ version: number }>>(
      `SELECT "version" FROM "CommercialCatalogPublication" ORDER BY "version" DESC LIMIT 1`,
    );
    const id = randomUUID();
    const status = commercial.quote.totalMinor === 0 ? 'ZERO' : 'PENDING';
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "CommercialOrder" ("id","tenantId","status","subtotalMinor","discountPercent","discountMinor","totalMinor","currency","catalogVersion","liveStartsAt","createdByAdminId","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        id, tenantId, status, commercial.quote.subtotalMinor, commercial.quote.effectiveDiscountPercent,
        commercial.quote.discountMinor, commercial.quote.totalMinor, commercial.quote.currency,
        publication?.version || null, commercial.terms.livePaidStartsAt ? new Date(commercial.terms.livePaidStartsAt) : null, actorAdminId,
      );
      for (const product of selected) {
        const effectivePriceMinor = product.isFree ? 0 : product.priceMinor;
        await tx.$executeRawUnsafe(
          `INSERT INTO "CommercialOrderItem" ("id","orderId","productKey","productName","priceMinor","quantity","totalMinor","snapshot") VALUES ($1,$2,$3,$4,$5,1,$5,$6::jsonb)`,
          randomUUID(), id, product.key, product.name, effectivePriceMinor, JSON.stringify(product),
        );
      }
    });
    await this.audit(actorAdminId, tenantId, 'COMMERCIAL_ORDER_CREATED', 'ORDER', id, {
      status,
      subtotalMinor: commercial.quote.subtotalMinor,
      discountMinor: commercial.quote.discountMinor,
      totalMinor: commercial.quote.totalMinor,
      productKeys: selected.map((product) => product.key),
      catalogVersion: publication?.version || null,
    });
    return this.orderHistory(tenantId);
  }

  async orderHistory(tenantId: string) {
    return this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT o.*,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('productKey',i."productKey",'productName',i."productName",'priceMinor',i."priceMinor",'quantity',i."quantity",'totalMinor',i."totalMinor") ORDER BY i."id") FROM "CommercialOrderItem" i WHERE i."orderId"=o."id"),'[]'::jsonb) AS "items",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',p."provider",'status',p."status",'amountMinor',p."amountMinor",'walletKey',p."walletKey",'occurredAt',p."occurredAt") ORDER BY p."createdAt") FROM "CommercialPayment" p WHERE p."orderId"=o."id"),'[]'::jsonb) AS "payments"
       FROM "CommercialOrder" o WHERE o."tenantId"=$1 ORDER BY o."createdAt" DESC LIMIT 100`, tenantId,
    );
  }
}
