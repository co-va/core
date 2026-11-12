import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';

type ProductType = 'SYSTEM' | 'TOOL' | 'FOLDER' | 'PACKAGE' | 'CAPACITY' | 'ADDON';
type ProductReadiness = 'NOT_READY' | 'TESTING' | 'READY';

// Tariffs are packages in the existing commercial catalog, not a second tool registry.
const TARIFF_KEYS = ['tariff.start', 'tariff.start-plus', 'tariff.pro'] as const;
type TariffKey = typeof TARIFF_KEYS[number];

type CatalogManifestItem = {
  key: string;
  name: string;
  description: string;
  type: ProductType;
  position: number;
  isSaleable: boolean;
  isFree: boolean;
  priceMinor: number;
  capabilityKeys: string[];
  includedKeys?: string[];
};

type ProductRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  type: ProductType;
  position: number;
  isActive: boolean;
  readiness: ProductReadiness;
  isSaleable: boolean;
  isFree: boolean;
  priceMinor: number;
  currency: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
};

const APP_CATALOG: CatalogManifestItem[] = [
  { key: 'system.profile', name: 'Профиль', description: 'Профиль пользователя', type: 'SYSTEM', position: 10, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['profile.access'] },
  { key: 'system.workplace', name: 'Рабочее пространство', description: 'Первое рабочее пространство', type: 'SYSTEM', position: 20, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['workplaces.access'] },
  { key: 'capacity.workplace.extra', name: 'Дополнительное рабочее пространство', description: 'Дополнительная ёмкость рабочих пространств', type: 'CAPACITY', position: 30, isSaleable: true, isFree: false, priceMinor: 0, capabilityKeys: ['workplaces.max'] },
  { key: 'tool.timetable', name: 'График (режим Журнала)', description: 'Управление рабочими днями из режима месяца Журнала; отдельной F-карточки нет', type: 'TOOL', position: 100, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['timetable.access'] },
  { key: 'tool.people', name: 'Клиенты', description: 'Работа со списком людей', type: 'TOOL', position: 110, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['people.access'] },
  { key: 'tool.services', name: 'Сервис', description: 'Услуги и процедуры', type: 'TOOL', position: 120, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['services.access'] },
  { key: 'tool.online-booking', name: 'Онлайн-запись', description: 'Публичная онлайн-запись', type: 'TOOL', position: 130, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['online_booking.access'] },
  { key: 'tool.documents', name: 'Документы', description: 'Документы и согласия', type: 'TOOL', position: 140, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['documents.access'] },
  { key: 'tool.tags', name: 'Ярлыки', description: 'Ярлыки и классификация', type: 'TOOL', position: 150, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['tags.access'] },
  { key: 'tool.notifications', name: 'Уведомления', description: 'Системные уведомления', type: 'TOOL', position: 160, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['notifications.access'] },
  { key: 'tool.integrations', name: 'Интеграции', description: 'Базовый раздел интеграций', type: 'TOOL', position: 170, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['integrations.access'] },
  { key: 'tool.journal', name: 'Журнал', description: 'День, месяц (просмотр и режим графика), список записей', type: 'TOOL', position: 180, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['journal.day.access', 'journal.month.access', 'journal.list.access'] },
  // Additive catalog entries: price is configurable from each Loyalty E row.
  // No saleability or paid access is enabled by default.
  { key: 'tool.loyalty.deposit', name: 'Депозит', description: '', type: 'TOOL', position: 190, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['loyalty.deposit.access'] },
  { key: 'tool.loyalty.personal-account', name: 'Личный счёт', description: '', type: 'TOOL', position: 191, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['loyalty.personal_account.access'] },
  { key: 'tool.loyalty.certificate', name: 'Сертификат', description: '', type: 'TOOL', position: 192, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['loyalty.certificate.access'] },
  { key: 'tool.loyalty.subscription', name: 'Абонемент', description: '', type: 'TOOL', position: 193, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['loyalty.subscription.access'] },
  { key: 'tool.loyalty.referral', name: 'Реферальная программа', description: '', type: 'TOOL', position: 194, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['loyalty.referral.access'] },
  { key: 'tool.loyalty.bonus', name: 'Бонусная программа', description: '', type: 'TOOL', position: 195, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: ['loyalty.bonus.access'] },

  { key: 'tool.finance.cash', name: 'Касса', description: 'Кошельки и движения по ним', type: 'TOOL', position: 300, isSaleable: true, isFree: false, priceMinor: 0, capabilityKeys: ['finance.cash.access'] },
  { key: 'tool.finance.dds', name: 'ДДС', description: 'Движение денежных средств, статьи и финансовые операции', type: 'TOOL', position: 310, isSaleable: true, isFree: false, priceMinor: 0, capabilityKeys: ['finance.dds.access', 'finance.income_expense.access', 'finance.articles.access', 'finance.special.access'] },
  { key: 'tool.finance.investment', name: 'Инвестиции', description: 'Инвестиции и разрешённые роли', type: 'TOOL', position: 320, isSaleable: true, isFree: false, priceMinor: 0, capabilityKeys: ['finance.investment.self.access', 'finance.investment.raise.access', 'finance.investment.external.access'] },
  { key: 'tool.finance.z-report', name: 'Z-отчёт', description: 'Z-отчёт', type: 'TOOL', position: 330, isSaleable: true, isFree: false, priceMinor: 0, capabilityKeys: ['finance.z_report.access'] },
  { key: 'folder.finance', name: 'Финансы', description: 'Папка финансовых инструментов', type: 'FOLDER', position: 390, isSaleable: true, isFree: false, priceMinor: 99900, capabilityKeys: [], includedKeys: ['tool.finance.cash', 'tool.finance.dds', 'tool.finance.investment', 'tool.finance.z-report'] },

  { key: 'tool.inventory', name: 'Склад', description: 'Позиции, остатки, партии, поставщики и движения склада', type: 'TOOL', position: 400, isSaleable: true, isFree: false, priceMinor: 99900, capabilityKeys: [] },

  { key: 'package.full', name: 'Полный пакет', description: 'Единый пакет доступных платных наборов и инструментов', type: 'PACKAGE', position: 900, isSaleable: true, isFree: false, priceMinor: 199900, capabilityKeys: [], includedKeys: ['folder.finance', 'tool.inventory'] },

  // These three existing-model package records are initially not sold by the legacy
  // per-product checkout. Pricing/selection is prepared without changing live access.
  { key: 'tariff.start', name: 'Start', description: 'Базовый тариф Professional', type: 'PACKAGE', position: 930, isSaleable: false, isFree: true, priceMinor: 0, capabilityKeys: [], includedKeys: ['system.profile', 'system.workplace'] },
  { key: 'tariff.start-plus', name: 'Start+', description: 'Расширенный тариф Professional', type: 'PACKAGE', position: 940, isSaleable: false, isFree: false, priceMinor: 0, capabilityKeys: [], includedKeys: ['tariff.start'] },
  { key: 'tariff.pro', name: 'Pro', description: 'Максимальный тариф Professional', type: 'PACKAGE', position: 950, isSaleable: false, isFree: false, priceMinor: 0, capabilityKeys: [], includedKeys: ['tariff.start-plus'] },
];

function integer(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestException(`${field}: требуется целое неотрицательное число`);
  return parsed;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function productReadiness(value: unknown, fallback: ProductReadiness): ProductReadiness {
  const status = text(value).toUpperCase();
  if (!status) return fallback;
  if (status === 'NOT_READY' || status === 'TESTING' || status === 'READY') return status;
  throw new BadRequestException('Статус инструмента должен быть NOT_READY, TESTING или READY');
}

@Injectable()
export class CommercialCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private async audit(actorAdminId: string | null, eventType: string, entityType: string, entityId: string, metadata: unknown = {}) {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "CommercialAuditEvent" ("id","actorAdminId","eventType","entityType","entityId","metadata","occurredAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,CURRENT_TIMESTAMP)`,
      randomUUID(), actorAdminId, eventType, entityType, entityId, JSON.stringify(metadata ?? {}),
    );
  }

  async syncAppCatalog() {
    for (const item of APP_CATALOG) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "CommercialProduct" ("id","key","name","description","type","position","isActive","isSaleable","isFree","priceMinor","currency","source","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,'RUB','APP',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
         ON CONFLICT ("key") DO UPDATE SET "name"=EXCLUDED."name", "description"=EXCLUDED."description", "type"=EXCLUDED."type", "position"=EXCLUDED."position", "updatedAt"=CURRENT_TIMESTAMP`,
        randomUUID(), item.key, item.name, item.description, item.type, item.position, item.isSaleable, item.isFree, item.priceMinor,
      );
      const [product] = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "CommercialProduct" WHERE "key"=$1`, item.key,
      );
      if (!product) continue;
      await this.prisma.$executeRawUnsafe(`DELETE FROM "CommercialProductCapability" WHERE "productId"=$1`, product.id);
      for (const capabilityKey of item.capabilityKeys) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "CommercialProductCapability" ("productId","capabilityKey") VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          product.id, capabilityKey,
        );
      }
    }

    for (const item of APP_CATALOG.filter((entry) => entry.includedKeys?.length)) {
      const [parent] = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "CommercialProduct" WHERE "key"=$1`, item.key);
      if (!parent) continue;
      const [countRow] = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS "count" FROM "CommercialProductInclusion" WHERE "parentProductId"=$1`, parent.id,
      );
      if (Number(countRow?.count || 0) > 0) continue;
      for (const [index, childKey] of (item.includedKeys || []).entries()) {
        const [child] = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "CommercialProduct" WHERE "key"=$1`, childKey);
        if (!child) continue;
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "CommercialProductInclusion" ("parentProductId","childProductId","position") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          parent.id, child.id, index,
        );
      }
    }
  }

  async catalog() {
    await this.syncAppCatalog();
    const products = await this.prisma.$queryRawUnsafe<ProductRow[]>(
      `SELECT * FROM "CommercialProduct" ORDER BY "position" ASC, "name" ASC`,
    );
    const capabilities = await this.prisma.$queryRawUnsafe<Array<{ productId: string; capabilityKey: string }>>(
      `SELECT "productId","capabilityKey" FROM "CommercialProductCapability" ORDER BY "capabilityKey" ASC`,
    );
    const inclusions = await this.prisma.$queryRawUnsafe<Array<{ parentProductId: string; childProductId: string; position: number }>>(
      `SELECT "parentProductId","childProductId","position" FROM "CommercialProductInclusion" ORDER BY "position" ASC`,
    );
    const [publication] = await this.prisma.$queryRawUnsafe<Array<{ version: number; publishedAt: Date }>>(
      `SELECT "version","publishedAt" FROM "CommercialCatalogPublication" ORDER BY "version" DESC LIMIT 1`,
    );
    const byId = new Map(products.map((product) => [product.id, product]));
    return {
      publication: publication || null,
      products: products.map((product) => ({
        ...product,
        capabilityKeys: capabilities.filter((item) => item.productId === product.id).map((item) => item.capabilityKey),
        includedProducts: inclusions
          .filter((item) => item.parentProductId === product.id)
          .map((item) => byId.get(item.childProductId))
          .filter(Boolean)
          .map((item) => ({ key: item!.key, name: item!.name, type: item!.type })),
      })),
    };
  }

  // The three tariff cards use the same CommercialProduct/Inclusion graph as
  // the existing packages. Direct membership stores the minimum tariff once;
  // higher tiers inherit through the two package-to-package edges.
  async tariffs() {
    const catalog = await this.catalog();
    const products = catalog.products;
    const byKey = new Map(products.map((product) => [product.key, product]));
    const assignments: Record<string, string> = {};
    for (const tierKey of TARIFF_KEYS) {
      for (const child of byKey.get(tierKey)?.includedProducts || []) {
        if (!TARIFF_KEYS.includes(child.key as TariffKey)) assignments[child.key] = tierKey;
      }
    }

    const rows = await this.prisma.$queryRawUnsafe<Array<{ tenantId: string; tierKey: string | null; entitled: boolean }>>(
      `SELECT a."tenantId", p."key" AS "tierKey",
          (COALESCE(t."freeForever",false) OR COALESCE(t."discountPercent",0)=100
           OR t."freeUntil" >= CURRENT_TIMESTAMP OR t."paidAccessEndsAt" > CURRENT_TIMESTAMP) AS "entitled"
         FROM "TenantAccess" a
         LEFT JOIN "CommercialTenantTerms" t ON t."tenantId"=a."tenantId"
         LEFT JOIN "CommercialTenantProduct" tp ON tp."tenantId"=a."tenantId"
         LEFT JOIN "CommercialProduct" p ON p."id"=tp."productId" AND p."key" = ANY($1::text[])
         WHERE a."commercialMode"='LIVE' AND a."isOwnerBook"=false AND a."status"='ACTIVE'`,
      [...TARIFF_KEYS],
    );
    const tenantTier = new Map<string, number>();
    for (const row of rows) {
      const index = row.entitled ? TARIFF_KEYS.indexOf(row.tierKey as TariffKey) : -1;
      tenantTier.set(row.tenantId, Math.max(tenantTier.get(row.tenantId) ?? 0, index));
    }
    const counts = TARIFF_KEYS.map((_, index) => [...tenantTier.values()].filter((value) => value === index).length);

    const expand = (key: string, collected = new Set<string>()): Set<string> => {
      if (collected.has(key)) return collected;
      collected.add(key);
      for (const child of byKey.get(key)?.includedProducts || []) expand(child.key, collected);
      return collected;
    };
    return {
      tiers: TARIFF_KEYS.map((key, index) => ({
        key,
        name: byKey.get(key)?.name || ['Start', 'Start+', 'Pro'][index],
        priceMinor: byKey.get(key)?.priceMinor ?? 0,
        connected: counts[index],
        tools: [...expand(key)].filter((childKey) => !TARIFF_KEYS.includes(childKey as TariffKey))
          .map((childKey) => byKey.get(childKey)).filter((item) => item && item.isActive)
          .map((item) => ({ key: item!.key, name: item!.name, type: item!.type })),
      })),
      assignments,
    };
  }

  async assignTariff(input: Record<string, unknown>, actorAdminId: string) {
    await this.syncAppCatalog();
    const productKey = text(input.productKey);
    const minimumTariff = text(input.minimumTariff);
    if (minimumTariff && !TARIFF_KEYS.includes(minimumTariff as TariffKey)) {
      throw new BadRequestException('Неизвестный тариф');
    }
    // Profile and the first workspace are structural Start capabilities,
    // including when a paid tier inherits Start. They must not disappear.
    if (['system.profile', 'system.workplace'].includes(productKey) && minimumTariff !== 'tariff.start') {
      throw new BadRequestException('Базовые возможности всегда входят в Start');
    }
    const [product] = await this.prisma.$queryRawUnsafe<Array<{ id: string; type: ProductType }>>(
      `SELECT "id","type" FROM "CommercialProduct" WHERE "key"=$1 AND "isActive"=true`, productKey,
    );
    if (!product || product.type === 'PACKAGE') throw new BadRequestException('Инструмент не найден');
    const tiers = await this.prisma.$queryRawUnsafe<Array<{ id: string; key: string }>>(
      `SELECT "id","key" FROM "CommercialProduct" WHERE "key" = ANY($1::text[])`, [...TARIFF_KEYS],
    );
    if (tiers.length !== TARIFF_KEYS.length) throw new BadRequestException('Тарифы не настроены');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM "CommercialProductInclusion" WHERE "parentProductId" = ANY($1::text[]) AND "childProductId"=$2`,
        tiers.map((tier) => tier.id), product.id,
      );
      if (minimumTariff) {
        const parent = tiers.find((tier) => tier.key === minimumTariff)!;
        await tx.$executeRawUnsafe(
          `INSERT INTO "CommercialProductInclusion" ("parentProductId","childProductId","position")
           VALUES ($1,$2,500) ON CONFLICT DO NOTHING`, parent.id, product.id,
        );
      }
    });
    await this.audit(actorAdminId, 'TARIFF_TOOL_ASSIGNED', 'PRODUCT', product.id, { productKey, minimumTariff });
    return this.tariffs();
  }

  async updateProduct(key: string, input: Record<string, unknown>, actorAdminId: string) {
    await this.syncAppCatalog();
    const [current] = await this.prisma.$queryRawUnsafe<ProductRow[]>(`SELECT * FROM "CommercialProduct" WHERE "key"=$1`, key);
    if (!current) throw new NotFoundException('Инструмент не найден');
    const priceMinor = 'priceMinor' in input ? integer(input.priceMinor, 'Цена') : current.priceMinor;
    const isFree = bool(input.isFree, current.isFree);
    const isSaleable = bool(input.isSaleable, current.isSaleable);
    const isActive = bool(input.isActive, current.isActive);
    const readiness = productReadiness(input.readiness, current.readiness);
    await this.prisma.$executeRawUnsafe(
      `UPDATE "CommercialProduct" SET "priceMinor"=$2,"isFree"=$3,"isSaleable"=$4,"isActive"=$5,"readiness"=$6,"updatedAt"=CURRENT_TIMESTAMP WHERE "key"=$1`,
      key, priceMinor, isFree, isSaleable, isActive, readiness,
    );

    if (Array.isArray(input.includedProductKeys)) {
      if (current.type !== 'FOLDER' && current.type !== 'PACKAGE') throw new BadRequestException('Состав можно менять только у папки или пакета');
      const keys = [...new Set(input.includedProductKeys.map(text).filter(Boolean))];
      const rows = keys.length
        ? await this.prisma.$queryRawUnsafe<Array<{ id: string; key: string }>>(
            `SELECT "id","key" FROM "CommercialProduct" WHERE "key" = ANY($1::text[]) AND "isActive"=true`, keys,
          )
        : [];
      if (rows.length !== keys.length) throw new BadRequestException('В составе указан неизвестный инструмент');
      await this.prisma.$executeRawUnsafe(`DELETE FROM "CommercialProductInclusion" WHERE "parentProductId"=$1`, current.id);
      for (const [position, childKey] of keys.entries()) {
        if (childKey === key) throw new BadRequestException('Пакет не может включать сам себя');
        const child = rows.find((row) => row.key === childKey)!;
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "CommercialProductInclusion" ("parentProductId","childProductId","position") VALUES ($1,$2,$3)`,
          current.id, child.id, position,
        );
      }
    }
    await this.audit(actorAdminId, 'CATALOG_PRODUCT_UPDATED', 'PRODUCT', current.id, { key, priceMinor, isFree, isSaleable, isActive, readiness, includedProductKeys: input.includedProductKeys });
    return this.catalog();
  }

  async createPackage(input: Record<string, unknown>, actorAdminId: string) {
    await this.syncAppCatalog();
    const name = text(input.name);
    if (!name) throw new BadRequestException('Укажите название пакета');
    const type = text(input.type).toUpperCase() === 'FOLDER' ? 'FOLDER' : 'PACKAGE';
    const priceMinor = integer(input.priceMinor ?? 0, 'Цена');
    const id = randomUUID();
    const key = `custom.${type.toLowerCase()}.${id}`;
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "CommercialProduct" ("id","key","name","description","type","position","isActive","isSaleable","isFree","priceMinor","currency","source","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,850,true,true,$6,$7,'RUB','CUSTOM',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      id, key, name, text(input.description), type, bool(input.isFree, false), priceMinor,
    );
    await this.updateProduct(key, { includedProductKeys: Array.isArray(input.includedProductKeys) ? input.includedProductKeys : [] }, actorAdminId);
    await this.audit(actorAdminId, 'CATALOG_PACKAGE_CREATED', type, id, { key, name, priceMinor });
    return this.catalog();
  }

  async publish(actorAdminId: string) {
    const current = await this.catalog();
    const [row] = await this.prisma.$queryRawUnsafe<Array<{ version: number }>>(
      `SELECT COALESCE(MAX("version"),0)::integer + 1 AS "version" FROM "CommercialCatalogPublication"`,
    );
    const version = row?.version || 1;
    const id = randomUUID();
    const snapshot = { version, publishedAt: new Date().toISOString(), products: current.products };
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "CommercialCatalogPublication" ("id","version","snapshot","createdByAdminId","publishedAt","createdAt") VALUES ($1,$2,$3::jsonb,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      id, version, JSON.stringify(snapshot), actorAdminId,
    );
    await this.audit(actorAdminId, 'CATALOG_PUBLISHED', 'PUBLICATION', id, { version });
    return { version, snapshot };
  }

  async auditEvents(limitValue: unknown = 200) {
    const limit = Math.min(500, Math.max(1, Number(limitValue) || 200));
    return this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT e.*, a."platformAccountId", pa."email" AS "actorEmail"
       FROM "CommercialAuditEvent" e
       LEFT JOIN "PlatformAdmin" a ON a."id"=e."actorAdminId"
       LEFT JOIN "PlatformAccount" pa ON pa."id"=a."platformAccountId"
       ORDER BY e."occurredAt" DESC LIMIT $1`, limit,
    );
  }
}
