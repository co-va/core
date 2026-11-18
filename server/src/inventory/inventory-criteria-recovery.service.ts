import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type RecoveryRow = { sku: string; manufacturer: string; category: string; productType: string };
type ProposedChange = RecoveryRow & {
  itemId: string; name: string; beforeCategory: string; beforeProductType: string;
};
type Product = {
  itemId: string; sku: string | null; manufacturer: string;
  category: string; productType: string; name: string;
};
const clean = (value: unknown) => String(value ?? '').trim();
const keyOf = (row: { sku: string; manufacturer: string }) =>
  clean(row.manufacturer).toLocaleUpperCase('ru-RU') + '\u0000' +
  clean(row.sku).toLocaleUpperCase('ru-RU');
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

function rowsFrom(body: unknown): RecoveryRow[] {
  const value = isObject(body) ? body.rows : null;
  if (!Array.isArray(value) || !value.length || value.length > 1000)
    throw new BadRequestException('Файл должен содержать от 1 до 1000 товаров.');
  const unique = new Set<string>();
  return value.map((record: unknown) => {
    if (!isObject(record)) throw new BadRequestException('Некорректная строка файла.');
    const row = {
      sku: clean(record.sku), manufacturer: clean(record.manufacturer),
      category: clean(record.category), productType: clean(record.productType),
    };
    if (!row.sku || !row.manufacturer || !row.category || !row.productType
      || Object.values(row).some(value => value.length > 200))
      throw new BadRequestException('Неполные данные классификации в файле.');
    const key = keyOf(row);
    if (unique.has(key)) throw new BadRequestException('В файле повторяется артикул: ' + row.sku);
    unique.add(key);
    return row;
  });
}

@Injectable()
export class InventoryCriteriaRecoveryService {
  constructor(private readonly prisma: PrismaService) {}

  // Preview is read-only. Source rows are supplied by the signed-in
  // professional, not a tenant-specific fixture checked into the app.
  async preview(tenantId: string, body: unknown) {
    const rows = rowsFrom(body);
    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, archivedAt: null },
      select: { itemId: true, sku: true, manufacturer: true, category: true,
        productType: true, name: true },
    });
    const index = new Map<string, Product[]>();
    for (const item of items) {
      if (!clean(item.sku)) continue;
      const key = keyOf({ sku: item.sku || '', manufacturer: item.manufacturer });
      const matches = index.get(key) || [];
      matches.push(item);
      index.set(key, matches);
    }
    const changes: ProposedChange[] = [];
    const notFound: string[] = [];
    const ambiguous: string[] = [];
    let unchanged = 0;
    for (const row of rows) {
      const matches = index.get(keyOf(row)) || [];
      if (!matches.length) { notFound.push(row.sku); continue; }
      if (matches.length !== 1) { ambiguous.push(row.sku); continue; }
      const item = matches[0];
      if (item.category === row.category && item.productType === row.productType) {
        unchanged++;
        continue;
      }
      changes.push({
        ...row, itemId: item.itemId, name: item.name,
        beforeCategory: item.category, beforeProductType: item.productType,
      });
    }
    return {
      sourceCount: rows.length, stockCount: items.length,
      matchedCount: unchanged + changes.length, unchangedCount: unchanged,
      changes, notFound, ambiguous,
    };
  }

  // Every condition is rechecked by Core. One transaction either restores all
  // expected rows or none; it does not alter stock, lots, movements or pricing.
  async apply(tenantId: string, body: unknown) {
    const value = isObject(body) ? body.changes : null;
    if (!Array.isArray(value) || !value.length || value.length > 1000)
      throw new BadRequestException('Нет позиций для восстановления.');
    const unique = new Set<string>();
    const changes = value.map((input: unknown) => {
      if (!isObject(input)) throw new BadRequestException('Некорректные изменения.');
      const itemId = clean(input.itemId);
      const row = {
        itemId, sku: clean(input.sku), manufacturer: clean(input.manufacturer),
        category: clean(input.category), productType: clean(input.productType),
        beforeCategory: clean(input.beforeCategory),
        beforeProductType: clean(input.beforeProductType),
      };
      if (!row.itemId || !row.sku || !row.manufacturer || !row.category || !row.productType
        || Object.values(row).some(part => part.length > 200))
        throw new BadRequestException('Некорректная строка восстановления.');
      if (unique.has(itemId)) throw new BadRequestException('Повторяется товар ' + itemId);
      unique.add(itemId);
      return row;
    });
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Serializes multiple classification repairs for this tenant.
      await tx.$queryRawUnsafe(
        'SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))) AS guard',
        tenantId, 'inventory-criteria',
      );
      const items = await tx.inventoryItem.findMany({
        where: { tenantId, archivedAt: null, itemId: { in: changes.map(row => row.itemId) } },
        select: { itemId: true, sku: true, manufacturer: true, category: true, productType: true },
      });
      const byId = new Map(items.map(item => [item.itemId, item]));
      for (const change of changes) {
        const item = byId.get(change.itemId);
        if (!item || keyOf({ sku: item.sku || '', manufacturer: item.manufacturer }) !== keyOf(change)
          || item.category !== change.beforeCategory
          || item.productType !== change.beforeProductType)
          throw new BadRequestException('Склад изменился после проверки. Ничего не записано: обновите сравнение.');
      }
      for (const change of changes) {
        const saved = await tx.inventoryItem.updateMany({
          where: { tenantId, archivedAt: null, itemId: change.itemId,
            category: change.beforeCategory, productType: change.beforeProductType,
            sku: byId.get(change.itemId)!.sku,
            manufacturer: byId.get(change.itemId)!.manufacturer },
          data: { category: change.category, productType: change.productType },
        });
        if (saved.count !== 1)
          throw new BadRequestException('При записи данные изменились. Вся операция отменена.');
      }
      // Only superseded legacy values involved in this restore may be hidden.
      // An old label is retired only when NO stock item still uses it. Values
      // in other products, manual unused options and all product facts remain.
      let hiddenValuesCount = 0;
      const catalog = await tx.inventoryCriteriaCatalog.findUnique({ where: { tenantId } });
      const data = isObject(catalog?.data) ? JSON.parse(JSON.stringify(catalog.data)) : null;
      if (data && Array.isArray(data.groups)) {
        const remaining = await tx.inventoryItem.findMany({
          where: { tenantId, archivedAt: null },
          select: { category: true, productType: true },
        });
        const remainingCategories = new Set(remaining.map(item => item.category));
        const remainingTypes = new Set(remaining.map(item => item.productType));
        const previousCategories = new Set(changes.map(change => change.beforeCategory));
        const previousTypes = new Set(changes.map(change => change.beforeProductType));
        for (const group of data.groups) {
          if (!Array.isArray(group.values)) continue;
          const field = group.legacyField;
          if (field !== 'category' && field !== 'productType') continue;
          const oldNames = field === 'category' ? previousCategories : previousTypes;
          const stillUsed = field === 'category' ? remainingCategories : remainingTypes;
          for (const value of group.values) {
            if (value.archived === true || !oldNames.has(value.name) || stillUsed.has(value.name)) continue;
            value.archived = true;
            hiddenValuesCount++;
          }
        }
        if (hiddenValuesCount) await tx.inventoryCriteriaCatalog.update({
          where: { tenantId }, data: { data },
        });
      }
      return { updatedCount: changes.length, hiddenValuesCount };
    }, { maxWait: 10000, timeout: 60000 });
  }
}
