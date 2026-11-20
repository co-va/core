import { Prisma } from '@prisma/client';
import { captureOwnedState, restoreOwnedState, TransferState } from '../data-transfer/restore-state';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InventoryCriteriaService } from './inventory-criteria.service';
import { PrismaService } from '../prisma.service';
import { FinanceService } from '../finance/finance.service';
import { effectiveSupplierOfferPrice, resolveInventoryBasePricing, supplierOfferUnitPrice } from './inventory-pricing';
import { canonicalInventoryUnit, stockQuantityForUnit } from './inventory-usage';

type AnyRecord = Record<string, any>;
type Tx = AnyRecord;
const PRIMARY_STORAGE = 'primary';
const RESOURCE_UNITS = new Set(['проц.', 'примен.', 'цикл', 'ч', 'дн.', 'км']);

type PreparedLine = {
  itemId: string;
  quantity: number;
  storageLocationId: string;
  // Only when explicitly supplied; legacy movements already use stock units.
  quantityUnit: string;
  direction: 'IN' | 'OUT';
  unitCost: number | null;
  expectedQuantity: number | null;
  actualQuantity: number | null;
  containerDelta: number | null;
  expectedContainerCount: number | null;
  actualContainerCount: number | null;
  supplier: string;
  offerId: string;
  listPrice: number | null;
  discountPercent: number | null;
  note: string;
};

const OUT_KINDS = new Set(['CONSUMPTION', 'SALE', 'WRITE_OFF', 'SUPPLIER_RETURN']);
const IN_KINDS = new Set(['RECEIPT', 'RETURN']);
const MOVEMENT_KINDS = new Set([...OUT_KINDS, ...IN_KINDS, 'ADJUSTMENT', 'CORRECTION']);
const EPSILON = 0.000001;

function objectValue(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function optionalText(value: unknown): string {
  return text(value);
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
  return Math.max(0, numberValue(value, fallback));
}

function nullableNonNegative(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = numberValue(value, NaN);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function nullablePercent(value: unknown): number | null {
  const parsed = nullableNonNegative(value);
  return parsed == null ? null : Math.min(100, parsed);
}

function optionalOfferAmount(value: unknown, label: string, maximum = Infinity): number | null {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) {
    throw new BadRequestException(`${label}: неверное значение`);
  }
  return parsed;
}

// Do not infer the number of tubes from grams. Count is an exact integer or unknown.
function optionalContainerInteger(value: unknown, label: string, nonnegative = true): number | null {
  if (value == null || value === '') return null;
  const numeric = Number(String(value).replace(',', '.'));
  if (!Number.isSafeInteger(numeric) || (nonnegative && numeric < 0)) {
    throw new BadRequestException(`${label}: укажите целое число тюбиков.`);
  }
  return numeric;
}

function offerPackSize(value: unknown): number {
  const result = optionalOfferAmount(value, 'Количество в предложении');
  if (result === null || result <= 0) {
    throw new BadRequestException('Количество в предложении должно быть больше нуля');
  }
  return result;
}

function dateValue(value: unknown, fallback = new Date()): Date {
  if (!value) return fallback;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function movementDirection(kind: string, quantity: number, explicit = ''): 'IN' | 'OUT' {
  if (explicit === 'IN' || explicit === 'OUT') return explicit;
  if (IN_KINDS.has(kind)) return 'IN';
  if (OUT_KINDS.has(kind)) return 'OUT';
  return quantity < 0 ? 'OUT' : 'IN';
}

function normalizedMovementLines(kind: string, value: unknown): PreparedLine[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((raw) => {
    const row = objectValue(raw);
    const signed = numberValue(row.quantity, 0);
    const direction = movementDirection(kind, signed, text(row.direction).toUpperCase());
    return {
      itemId: text(row.itemId),
      quantity: Math.abs(signed),
      storageLocationId: text(row.storageLocationId) || PRIMARY_STORAGE,
      quantityUnit: text(row.quantityUnit),
      direction,
      unitCost: nullableNonNegative(row.unitCost ?? row.actualPrice),
      expectedQuantity: nullableNonNegative(row.expectedQuantity),
      actualQuantity: nullableNonNegative(row.actualQuantity),
      containerDelta: optionalContainerInteger(row.containerDelta, 'Изменение тюбиков', false),
      expectedContainerCount: optionalContainerInteger(row.expectedContainerCount, 'Учётные тюбики'),
      actualContainerCount: optionalContainerInteger(row.actualContainerCount, 'Фактические тюбики'),
      supplier: optionalText(row.supplier),
      offerId: text(row.offerId),
      listPrice: nullableNonNegative(row.listPrice),
      discountPercent: nullablePercent(row.discountPercent),
      note: optionalText(row.note),
    };
  }).filter((row) => row.itemId && (row.quantity > 0
    || row.containerDelta !== null && row.containerDelta !== 0
    || kind === 'ADJUSTMENT' && row.actualContainerCount !== null));
}

function optionalUsageUnit(value: unknown): string | null {
  if (value == null || value === '') return null;
  const unit = canonicalInventoryUnit(value);
  if (!unit) throw new BadRequestException('Неизвестная единица списания.');
  return unit;
}

function optionalUsageQuantity(value: unknown): number | null {
  return optionalOfferAmount(value, 'Количество списания', 100000000);
}

function optionalUnit(value: unknown, title: string): string | null {
  if (value == null || value === '') return null;
  const unit = canonicalInventoryUnit(value);
  if (!unit) throw new BadRequestException(title + ': неизвестная единица.');
  return unit;
}
function optionalDate(value: unknown, title: string): Date | null {
  if (value == null || value === '') return null;
  const result = new Date(String(value));
  if (Number.isNaN(result.getTime())) throw new BadRequestException(title + ': неверная дата.');
  return result;
}
function optionalPositive(value: unknown, title: string): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  if (!(parsed > 0) || !Number.isFinite(parsed)) throw new BadRequestException(title + ': укажите положительное число.');
  return parsed;
}
function optionalRules(value: unknown): AnyRecord[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 30) throw new BadRequestException('Неверные правила пересчёта.');
  const values = value.map((raw) => {
    const item = objectValue(raw);
    const unit = optionalUnit(item.unit, 'Единица пересчёта');
    const stockPerUnit = optionalPositive(item.stockPerUnit, 'Коэффициент пересчёта');
    if (!unit || stockPerUnit == null) throw new BadRequestException('Укажите единицу и коэффициент.');
    return { unit, stockPerUnit };
  });
  if (new Set(values.map((row) => row.unit)).size !== values.length)
    throw new BadRequestException('Повтор единицы пересчёта.');
  return values;
}
function inventoryCardChanges(source: AnyRecord): AnyRecord {
  const result: AnyRecord = {};
  if ('catalogName' in source) result.catalogName = optionalText(source.catalogName);
  if ('nominalQuantity' in source) result.nominalQuantity = optionalPositive(source.nominalQuantity, 'Номинал');
  if ('nominalUnit' in source) result.nominalUnit = optionalUnit(source.nominalUnit, 'Единица номинала');
  if ('receiptUnit' in source) result.receiptUnit = optionalUnit(source.receiptUnit, 'Ед. прихода');
  if ('thresholdUnit' in source) result.thresholdUnit = optionalUnit(source.thresholdUnit, 'Ед. остатка');
  if ('containerMode' in source) {
    const mode = text(source.containerMode);
    if (mode && !['WITH', 'NONE'].includes(mode)) throw new BadRequestException('Тара: WITH или NONE.');
    result.containerMode = mode || null;
  }
  if ('conversionRules' in source) result.conversionRules = optionalRules(source.conversionRules);
  if ('resourceLimit' in source) result.resourceLimit = optionalPositive(source.resourceLimit, 'Ресурс');
  if ('resourceStockQuantity' in source) result.resourceStockQuantity = optionalPositive(source.resourceStockQuantity, 'Размер списываемой единицы');
  if ('resourceUnit' in source) {
    const unit = text(source.resourceUnit);
    if (unit && !RESOURCE_UNITS.has(unit)) throw new BadRequestException('Неверная единица ресурса.');
    result.resourceUnit = unit || null;
  }
  if ('resourceExhaustionAction' in source) {
    const action = text(source.resourceExhaustionAction);
    if (action && !['WRITE_OFF', 'REVIEW'].includes(action)) throw new BadRequestException('Неверное действие после выработки ресурса.');
    result.resourceExhaustionAction = action || null;
  }
  if ('serviceStartAt' in source) result.serviceStartAt = optionalDate(source.serviceStartAt, 'Начало эксплуатации');
  if ('serviceEndAt' in source) result.serviceEndAt = optionalDate(source.serviceEndAt, 'Окончание эксплуатации');
  return result;
}
function validateInventoryCard(value: AnyRecord) {
  if ((value.nominalQuantity != null) !== (value.nominalUnit != null))
    throw new BadRequestException('Номинал: укажите и число, и единицу.');
  if ((value.resourceLimit != null) !== (value.resourceUnit != null))
    throw new BadRequestException('Ресурс: укажите количество и единицу.');
  if (value.serviceStartAt != null && value.serviceEndAt != null
    && new Date(value.serviceEndAt).getTime() < new Date(value.serviceStartAt).getTime())
    throw new BadRequestException('Окончание эксплуатации раньше начала.');
  if (value.resourceExhaustionAction === 'WRITE_OFF' && value.resourceLimit != null
    && !(Number(value.resourceStockQuantity ?? 1) > 0))
    throw new BadRequestException('Укажите количество списания при исчерпании ресурса.');
}
function applyMovementQuantityUnits(lines: PreparedLine[], items: AnyRecord[]) {
  const byId = new Map(items.map(item => [item.itemId, item]));
  for (const line of lines) {
    if (!line.quantityUnit) continue;
    const item = byId.get(line.itemId);
    if (!item) throw new BadRequestException('Продукт не найден: ' + line.itemId);
    try {
      const unit = canonicalInventoryUnit(line.quantityUnit);
      line.quantity = stockQuantityForUnit({
        unit: item.unit,
        packageQuantity: item.packageQuantity,
        netPackageWeight: item.grossWeight != null && item.tareWeight != null
          ? decimalNumber(item.grossWeight) - decimalNumber(item.tareWeight) : null,
        nominalQuantity: item.nominalQuantity, nominalUnit: item.nominalUnit,
        conversionRules: item.conversionRules,
      }, line.quantity, line.quantityUnit);
      if (unit === 'шт.' && canonicalInventoryUnit(item.unit) === 'шт.' && !Number.isSafeInteger(line.quantity))
        throw new Error('Количество штук должно быть целым');
    } catch (error) {
      throw new BadRequestException(String(error instanceof Error ? error.message : error));
    }
  }
}

function decimalNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareDates(left: unknown, right: unknown): number {
  return new Date(String(left)).getTime() - new Date(String(right)).getTime();
}

@Injectable()
export class InventoryService {
  transferState(tx: Prisma.TransactionClient, tenantId: string) { return captureOwnedState(tx, tenantId, ['InventoryClassificationGroup', 'InventoryItem', 'InventorySupplierOffer', 'InventoryLot', 'InventoryMovement', 'InventoryMovementLine', 'InventoryMovementAllocation', 'InventoryPurchaseOrder', 'InventoryPurchaseOrderLine']); }
  restoreTransfer(tx: Prisma.TransactionClient, tenantId: string, before: TransferState, after: TransferState, checkOnly = false) { return restoreOwnedState(tx,tenantId,['InventoryClassificationGroup', 'InventoryItem', 'InventorySupplierOffer', 'InventoryLot', 'InventoryMovement', 'InventoryMovementLine', 'InventoryMovementAllocation', 'InventoryPurchaseOrder', 'InventoryPurchaseOrderLine'],before,after,checkOnly); }

  constructor(private readonly prisma: PrismaService, private readonly finance: FinanceService,
    private readonly criteria: InventoryCriteriaService) {}

  private groupName(value: unknown) {
    const name = text(value);
    if (!name || name.length > 120) throw new BadRequestException('Название группы: 1–120 символов.');
    return name;
  }

  private async groupPath(owner: Tx | PrismaService, tenantId: string, groupId: string) {
    const groups = await owner.inventoryClassificationGroup.findMany({
      where: { tenantId, archivedAt: null },
    });
    const byId = new Map((groups as AnyRecord[]).map(row => [row.groupId, row]));
    const path: AnyRecord[] = [], visited = new Set<string>();
    let id = groupId;
    while (id) {
      if (visited.has(id) || path.length > 64) throw new BadRequestException('Повреждена вложенность групп.');
      visited.add(id);
      const group = byId.get(id);
      if (!group) throw new BadRequestException('Группа не найдена или исключена.');
      path.unshift(group);
      id = group.parentGroupId || '';
    }
    return path;
  }

  private async resolveItemGroup(owner: Tx, tenantId: string, raw: AnyRecord, current?: AnyRecord) {
    if ('classificationGroupId' in raw) {
      const id = text(raw.classificationGroupId);
      if (!id) return null;
      await this.groupPath(owner, tenantId, id);
      return id;
    }
    const legacy = ['manufacturer', 'category', 'productType'] as const;
    if (current && !legacy.some(key => key in raw)) return undefined;
    const parts = legacy.map(key => text(key in raw ? raw[key] : current?.[key])).filter(Boolean);
    if (!parts.length) return null;
    await owner.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('inventory-classification'))) AS guard`;
    let parentGroupId = '';
    for (const name of parts) {
      let group = await owner.inventoryClassificationGroup.findFirst({
        where: { tenantId, parentGroupId, name: { equals: name, mode: 'insensitive' } },
      });
      if (group?.archivedAt) {
        await owner.inventoryClassificationGroup.update({
          where: { id: group.id }, data: { archivedAt: null },
        });
      } else if (!group) {
        group = await owner.inventoryClassificationGroup.create({
          data: { tenantId, groupId: randomUUID(), parentGroupId, name },
        });
      }
      parentGroupId = group!.groupId;
    }
    return parentGroupId;
  }

  async listClassificationGroups(tenantId: string) {
    const rows = await this.prisma.inventoryClassificationGroup.findMany({
      where: { tenantId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    return rows.map(row => ({
      groupId: row.groupId, parentGroupId: row.parentGroupId, name: row.name, position: row.position,
    }));
  }

  async createClassificationGroup(tenantId: string, body: unknown) {
    const source = objectValue(body);
    const name = this.groupName(source.name);
    const parentGroupId = text(source.parentGroupId);
    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('inventory-classification'))) AS guard`;
      if (parentGroupId) await this.groupPath(tx, tenantId, parentGroupId);
      const existing = await tx.inventoryClassificationGroup.findFirst({
        where: { tenantId, parentGroupId, name: { equals: name, mode: 'insensitive' } },
      });
      if (existing) {
        if (!existing.archivedAt) throw new BadRequestException('Такая группа уже существует.');
        await tx.inventoryClassificationGroup.update({
          where: { id: existing.id }, data: { archivedAt: null },
        });
      } else {
        await tx.inventoryClassificationGroup.create({
          data: { tenantId, groupId: randomUUID(), parentGroupId, name },
        });
      }
    });
    return this.listClassificationGroups(tenantId);
  }

  async updateClassificationGroup(tenantId: string, groupId: string, body: unknown) {
    const source = objectValue(body);
    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('inventory-classification'))) AS guard`;
      const group = await tx.inventoryClassificationGroup.findFirst({
        where: { tenantId, groupId, archivedAt: null },
      });
      if (!group) throw new NotFoundException('Группа не найдена.');
      const nextParent = 'parentGroupId' in source ? text(source.parentGroupId) : group.parentGroupId;
      const name = 'name' in source ? this.groupName(source.name) : group.name;
      if (nextParent) {
        const path = await this.groupPath(tx, tenantId, nextParent);
        if (path.some(node => node.groupId === groupId))
          throw new BadRequestException('Нельзя переместить группу внутрь себя.');
      }
      if (source.archived === true) {
        const child = await tx.inventoryClassificationGroup.findFirst({
          where: { tenantId, parentGroupId: groupId, archivedAt: null },
        });
        const member = await tx.inventoryItem.findFirst({
          where: { tenantId, classificationGroupId: groupId }, select: { id: true },
        });
        if (child || member) throw new BadRequestException('Группа содержит подгруппы или товары.');
        await tx.inventoryClassificationGroup.update({
          where: { id: group.id }, data: { archivedAt: new Date() },
        });
        return;
      }
      const duplicate = await tx.inventoryClassificationGroup.findFirst({
        where: { tenantId, parentGroupId: nextParent,
          name: { equals: name, mode: 'insensitive' }, groupId: { not: groupId } },
      });
      if (duplicate) throw new BadRequestException('Такая группа уже существует.');
      const position = 'position' in source ? Number(source.position) : group.position;
      if (!Number.isSafeInteger(position) || position < 0)
        throw new BadRequestException('Неверный порядок группы.');
      await tx.inventoryClassificationGroup.update({
        where: { id: group.id }, data: { name, parentGroupId: nextParent, position },
      });
    });
    return this.listClassificationGroups(tenantId);
  }

  async snapshot(tenantId: string) {
    const [items, lots, movements, movementTotals, supplierOffers, orders, storageLocations, resourceProgress, resourceEvents, classificationGroups, locationTargets, supplierClaims, claimSettlements] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { tenantId, archivedAt: null },
        orderBy: [{ manufacturer: 'asc' }, { position: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.inventoryLot.findMany({
        where: { tenantId, quantityRemaining: { gt: 0 } },
        orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.inventoryMovement.findMany({
        where: { tenantId },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: 600,
      }),
      // All-time totals remain exact, but historical movement lines are not
      // materialized in Node for every inventory screen visit.
      this.prisma.inventoryMovementLine.groupBy({
        by: ['inventoryItemId', 'storageLocationId', 'direction'],
        where: { tenantId },
        _sum: { quantity: true, containerDelta: true },
      }),
      this.prisma.inventorySupplierOffer.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ supplier: 'asc' }, { updatedAt: 'desc' }],
      }),
      this.prisma.inventoryPurchaseOrder.findMany({
        where: { tenantId },
        include: { lines: { orderBy: { position: 'asc' } } },
        orderBy: [{ createdAt: 'desc' }, { orderId: 'asc' }],
      }),
      this.prisma.inventoryStorageLocation.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
      this.prisma.inventoryResourceProgress.findMany({ where: { tenantId } }),
      this.prisma.inventoryResourceEvent.findMany({ where: { tenantId }, orderBy: { occurredAt: 'desc' }, take: 200 }),
      this.prisma.inventoryClassificationGroup.findMany({
        where: { tenantId, archivedAt: null }, orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.inventoryLocationTarget.findMany({ where: { tenantId } }),
      this.prisma.inventorySupplierClaim.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.inventorySupplierClaimSettlement.findMany({ where: { tenantId }, orderBy: { occurredAt: 'desc' } }),
    ]);

    // The UI requests only the latest 600 movements. Fetch line details
    // for those movements alone; old lines were already counted above.
    const lines = movements.length ? await this.prisma.inventoryMovementLine.findMany({
      where: { tenantId, inventoryMovementId: { in: movements.map(movement => movement.id) } },
      orderBy: { position: 'asc' },
    }) : [];

    const balances = new Map<string, number>();
    const byStorage = new Map<string, Map<string, number>>();
    const byStorageContainers = new Map<string, Map<string, number>>();
    movementTotals.forEach((line: AnyRecord) => {
      const quantity = decimalNumber(line._sum.quantity);
      const signed = line.direction === 'OUT' ? -quantity : quantity;
      balances.set(line.inventoryItemId, (balances.get(line.inventoryItemId) || 0) + signed);
      const site = line.storageLocationId || PRIMARY_STORAGE;
      const perItem = byStorage.get(line.inventoryItemId) || new Map<string, number>();
      perItem.set(site, (perItem.get(site) || 0) + signed);
      byStorage.set(line.inventoryItemId, perItem);
      if (line._sum.containerDelta != null) {
        const units = byStorageContainers.get(line.inventoryItemId) || new Map<string, number>();
        units.set(site, (units.get(site) || 0) + Number(line._sum.containerDelta));
        byStorageContainers.set(line.inventoryItemId, units);
      }
    });
    // A threshold is a whole receipt unit; compare it to the physical stock
    // unit only through an explicit, grounded quantity per unit.
    // Thresholds are defined in whole receipt units, not stock grams/pieces.
    // Legacy weighed items used tube equivalents; keep them identical.
    const thresholdBalances = new Map<string, number | null>();
    const thresholdFactors = new Map<string, number | null>();
    for (const item of items as AnyRecord[]) {
      const stockBalance = balances.get(item.id) || 0;
      const thresholdUnit = item.thresholdUnit || item.receiptUnit
        || (canonicalInventoryUnit(item.unit) === 'г' ? 'шт.' : item.unit);
      let stockPerThreshold: number | null = null;
      if (canonicalInventoryUnit(thresholdUnit) === canonicalInventoryUnit(item.unit)) {
        stockPerThreshold = 1;
      } else {
        try {
          stockPerThreshold = stockQuantityForUnit({
            unit: item.unit, packageQuantity: item.packageQuantity,
            nominalQuantity: item.nominalQuantity, nominalUnit: item.nominalUnit,
            conversionRules: item.conversionRules,
            netPackageWeight: item.grossWeight != null && item.tareWeight != null
              ? decimalNumber(item.grossWeight) - decimalNumber(item.tareWeight) : null,
          }, 1, thresholdUnit);
        } catch { stockPerThreshold = null; }
      }
      thresholdFactors.set(item.id, stockPerThreshold);
      thresholdBalances.set(item.id, stockPerThreshold && stockPerThreshold > 0
        ? Math.round(stockBalance / stockPerThreshold * 1000) / 1000
        : stockBalance === 0 ? 0 : null);
    }
    const resourceByItem = new Map<string, AnyRecord[]>();
    for (const progress of resourceProgress as AnyRecord[]) {
      const list = resourceByItem.get(progress.inventoryItemId) || [];
      list.push({ storageLocationId: progress.storageLocationId, progress: decimalNumber(progress.progress) });
      resourceByItem.set(progress.inventoryItemId, list);
    }

    const itemByInternal = new Map(items.map((item: AnyRecord) => [item.id, item]));
    const offersByItem = new Map<string, AnyRecord[]>();
    supplierOffers.forEach((offer: AnyRecord) => {
      const rows = offersByItem.get(offer.inventoryItemId) || [];
      rows.push({
        offerId: offer.offerId,
        supplier: offer.supplier,
        counterpartyId: offer.counterpartyId || null,
        catalogItemId: offer.catalogItemId || null,
        listPrice: offer.listPrice == null ? null : decimalNumber(offer.listPrice),
        discountPercent: offer.discountPercent == null ? null : decimalNumber(offer.discountPercent),
        actualPrice: offer.actualPrice == null ? null : decimalNumber(offer.actualPrice),
        unitsPerOffer: offer.unitsPerOffer == null ? null : decimalNumber(offer.unitsPerOffer),
        effectivePrice: effectiveSupplierOfferPrice(offer),
        unitPrice: supplierOfferUnitPrice(offer),
        supplierSku: offer.supplierSku,
        note: offer.note,
      });
      offersByItem.set(offer.inventoryItemId, rows);
    });

    const linesByMovement = new Map<string, AnyRecord[]>();
    lines.forEach((line: AnyRecord) => {
      const group = linesByMovement.get(line.inventoryMovementId) || [];
      const item = itemByInternal.get(line.inventoryItemId) as AnyRecord | undefined;
      group.push({
        lineId: line.lineId,
        itemId: item?.itemId || '',
        name: item?.name || '',
        manufacturer: item?.manufacturer || '',
        unit: item?.unit || '',
        direction: line.direction,
        quantity: decimalNumber(line.quantity),
        unitCost: line.costKnown === false ? null : decimalNumber(line.unitCost),
        amount: line.costKnown === false ? null : decimalNumber(line.amount),
        expectedQuantity: line.expectedQuantity == null ? null : decimalNumber(line.expectedQuantity),
        actualQuantity: line.actualQuantity == null ? null : decimalNumber(line.actualQuantity),
        containerDelta: line.containerDelta == null ? null : Number(line.containerDelta),
        storageLocationId: line.storageLocationId || PRIMARY_STORAGE,
        expectedContainerCount: line.expectedContainerCount == null ? null : Number(line.expectedContainerCount),
        actualContainerCount: line.actualContainerCount == null ? null : Number(line.actualContainerCount),
        note: line.note,
      });
      linesByMovement.set(line.inventoryMovementId, group);
    });

    // Positions are user-assigned. 0 means "not assigned" and always comes last.
    // Do not generate sequential numbers or alter other catalog records on update.
    const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
    const positionOf = (item: AnyRecord) => Number.isSafeInteger(item.position) && item.position > 0
      ? item.position : Number.MAX_SAFE_INTEGER;
    const orderedItems = [...items].sort((left: AnyRecord, right: AnyRecord) =>
      collator.compare(String(left.manufacturer || ''), String(right.manufacturer || ''))
      || positionOf(left) - positionOf(right)
      || collator.compare(String(left.name || ''), String(right.name || ''))
      || String(left.itemId || '').localeCompare(String(right.itemId || '')));

    const targetsByItem = new Map<string, AnyRecord[]>();
    for (const row of locationTargets as AnyRecord[]) {
      const values = targetsByItem.get(row.inventoryItemId) || [];
      values.push({ locationId: row.locationId, targetStock: decimalNumber(row.targetStock) });
      targetsByItem.set(row.inventoryItemId, values);
    }
    const classificationById = new Map((classificationGroups as AnyRecord[])
      .map(row => [row.groupId, row]));
    const pathFor = (id: string): string[] => {
      const values: string[] = [], visited = new Set<string>();
      while (id && !visited.has(id) && values.length < 64) {
        visited.add(id);
        const row = classificationById.get(id) as AnyRecord | undefined;
        if (!row) break;
        values.unshift(row.name);
        id = row.parentGroupId || '';
      }
      return values;
    };
    return {
      classificationGroups: (classificationGroups as AnyRecord[]).map(row => ({
        groupId: row.groupId, parentGroupId: row.parentGroupId,
        name: row.name, position: row.position,
      })),
      items: orderedItems.map((item: AnyRecord) => {
        const grossWeight = item.grossWeight == null ? null : decimalNumber(item.grossWeight);
        const tareWeight = item.tareWeight == null ? null : decimalNumber(item.tareWeight);
        const itemOffers = offersByItem.get(item.id) || [];
        const basePricing = resolveInventoryBasePricing(item, itemOffers);
        return {
          itemId: item.itemId,
          position: item.position,
          classificationGroupId: item.classificationGroupId || null,
          criteriaValues: item.criteriaValues || {},
          classificationPath: pathFor(item.classificationGroupId || ''),

          name: item.name,
          catalogName: item.catalogName || '',
          nominalQuantity: item.nominalQuantity == null ? null : decimalNumber(item.nominalQuantity),
          nominalUnit: item.nominalUnit,
          receiptUnit: item.receiptUnit,
          containerMode: item.containerMode,
          thresholdUnit: item.thresholdUnit,
          balanceInThresholdUnit: thresholdBalances.get(item.id) ?? null,
          thresholdStockFactor: thresholdFactors.get(item.id) ?? null,
          conversionRules: item.conversionRules || [],
          resourceLimit: item.resourceLimit == null ? null : decimalNumber(item.resourceLimit),
          resourceUnit: item.resourceUnit,
          resourceStockQuantity: item.resourceStockQuantity == null ? null : decimalNumber(item.resourceStockQuantity),
          resourceExhaustionAction: item.resourceExhaustionAction,
          serviceStartAt: item.serviceStartAt,
          serviceEndAt: item.serviceEndAt,
          resourceProgress: resourceByItem.get(item.id) || [],
          locationBalances: [...(byStorage.get(item.id) || new Map([[PRIMARY_STORAGE, 0]])).entries()].map(([locationId, balance]) => ({ locationId, balance: Math.round(balance * 1000) / 1000 })),
          locationContainerCounts: [...(byStorageContainers.get(item.id) || new Map()).entries()].map(
            ([locationId, containers]) => ({ locationId, containers }),
          ),
          manufacturer: item.manufacturer,
          productType: item.productType,
          unit: item.unit,
          category: item.category,
          sku: item.sku,
          barcode: item.barcode,
          location: item.location,
          assignedStorageLocations: Array.isArray(item.storageLocationIds)
            ? item.storageLocationIds.filter((id: unknown) => typeof id === 'string') : [],
          supplier: item.supplier,
          minStock: item.minStock == null ? null : decimalNumber(item.minStock),
          targetStock: item.targetStock == null ? null : decimalNumber(item.targetStock),
          targetStockMode: item.targetStockMode === 'locations' ? 'locations' : 'overall',
          locationTargets: targetsByItem.get(item.id) || [],
          packageQuantity: item.packageQuantity == null ? null : decimalNumber(item.packageQuantity),
          containerCount: item.containerCount == null ? null : Number(item.containerCount),
          grossWeight,
          tareWeight,
          netPackageWeight: grossWeight != null && tareWeight != null ? Math.max(0, grossWeight - tareWeight) : null,
          referencePrice: item.referencePrice == null ? null : decimalNumber(item.referencePrice),
          primaryOfferId: item.primaryOfferId || null,
          ...basePricing,
          lastPurchasePrice: item.lastPurchasePrice == null ? null : decimalNumber(item.lastPurchasePrice),
          supplierOffers: itemOffers,
          trackLots: item.trackLots,
          canConsume: item.canConsume,
          canSell: item.canSell,
          consumeUnit: item.consumeUnit || canonicalInventoryUnit(item.unit),
          consumeQuantity: item.consumeQuantity == null ? null : decimalNumber(item.consumeQuantity),
          saleUnit: item.saleUnit || canonicalInventoryUnit(item.unit),
          saleQuantity: item.saleQuantity == null ? null : decimalNumber(item.saleQuantity),
          saleMarkupMode: item.saleMarkupMode || 'percent',
          saleMarkupValue: item.saleMarkupValue == null ? null : decimalNumber(item.saleMarkupValue),
          salePrice: item.salePrice == null ? null : decimalNumber(item.salePrice),
          balance: balances.get(item.id) || 0,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
      storageLocations: [
        { locationId: PRIMARY_STORAGE, name: 'Основное', archivedAt: null, isPrimary: true },
        ...(storageLocations as AnyRecord[]).map((row) => ({ locationId: row.locationId, name: row.name, archivedAt: row.archivedAt, isPrimary: false })),
      ],
      resourceEvents: (resourceEvents as AnyRecord[]).map((row) => ({
        eventId: row.eventId, itemId: itemByInternal.get(row.inventoryItemId)?.itemId || '',
        storageLocationId: row.storageLocationId, quantity: decimalNumber(row.quantity),
        resourceUnit: row.resourceUnit, writeOffMovementId: row.writeOffMovementId,
        occurredAt: row.occurredAt, note: row.note,
      })),
      supplierClaims: (supplierClaims as AnyRecord[]).map(row => ({
        claimId: row.claimId, orderId: row.orderId, itemId: row.itemId,
        sourceKind: row.sourceKind, packages: row.packages,
        amount: decimalNumber(row.amount), settledAmount: decimalNumber(row.settledAmount),
        outstanding: Math.round((decimalNumber(row.amount) - decimalNumber(row.settledAmount)) * 100) / 100,
        reason: row.reason, movementId: row.movementId, createdAt: row.createdAt,
      })),
      supplierClaimSettlements: (claimSettlements as AnyRecord[]).map(row => ({
        settlementId: row.settlementId, claimId: row.claimId, kind: row.kind,
        amount: decimalNumber(row.amount), walletId: row.walletId,
        occurredAt: row.occurredAt, financeOperationId: row.financeOperationId,
      })),
      orders: orders.map((order: AnyRecord) => ({
        orderId: order.orderId,
        status: order.status,
        supplier: order.supplier,
        note: order.note,
        financeOperationId: order.financeOperationId,
        receiptMovementId: order.receiptMovementId,
        paidAt: order.paidAt,
        receivedAt: order.receivedAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        total: Math.round((order.lines || []).reduce((sum: number, line: AnyRecord) =>
          sum + Number(line.packages) * decimalNumber(line.packPrice), 0) * 100) / 100,
        lines: (order.lines || []).map((line: AnyRecord) => ({
          itemId: line.itemId,
          name: line.name,
          manufacturer: line.manufacturer,
          unit: line.unit,
          packageSize: decimalNumber(line.packageSize),
          packages: line.packages,
          packPrice: decimalNumber(line.packPrice),
          offerId: line.offerId,
        })),
      })),
      lots: lots.map((lot: AnyRecord) => ({
        lotId: lot.lotId,
        itemId: (itemByInternal.get(lot.inventoryItemId) as AnyRecord | undefined)?.itemId || '',
        quantityReceived: decimalNumber(lot.quantityReceived),
        quantityRemaining: decimalNumber(lot.quantityRemaining),
        unitCost: lot.costKnown === false ? null : decimalNumber(lot.unitCost),
        listPrice: lot.listPrice == null ? null : decimalNumber(lot.listPrice),
        discountPercent: lot.discountPercent == null ? null : decimalNumber(lot.discountPercent),
        receivedAt: lot.receivedAt,
        expiresAt: lot.expiresAt,
        supplier: lot.supplier,
        note: lot.note,
      })),
      movements: movements.map((movement: AnyRecord) => ({
        movementId: movement.movementId,
        kind: movement.kind,
        status: movement.status,
        sourceType: movement.sourceType,
        sourceId: movement.sourceId,
        originalMovementId: movement.originalMovementId,
        personKey: movement.personKey,
        personUei: movement.personUei,
        recordId: movement.recordId,
        procedureKey: movement.procedureKey,
        workplaceKey: movement.workplaceKey,
        note: movement.note,
        occurredAt: movement.occurredAt,
        recordedAt: movement.createdAt,
        lines: linesByMovement.get(movement.id) || [],
      })),
    };
  }


  // Purchase orders are stored independently of movements. Only receiving one
  // paid order posts a canonical RECEIPT, inside the same database transaction.
  private async preparePurchaseOrderLines(tx: Tx, tenantId: string, body: unknown) {
    const rows = Array.isArray(body) ? body.map(objectValue) : [];
    if (!rows.length || rows.length > 500) throw new BadRequestException('Выберите позиции заказа');
    const ids = rows.map(row => text(row.itemId));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
      throw new BadRequestException('В заказе не может быть пустых или повторяющихся позиций');
    }
    const items = await tx.inventoryItem.findMany({
      where: { tenantId, itemId: { in: ids }, archivedAt: null },
    });
    const byId = new Map((items as AnyRecord[]).map(row => [row.itemId, row]));
    if (byId.size !== ids.length) throw new BadRequestException('Не все позиции заказа найдены в складе');
    const offerIds = [...new Set(rows.map((row, index) =>
      text(row.offerId || byId.get(ids[index])?.primaryOfferId)).filter(Boolean))];
    const offers = offerIds.length ? await tx.inventorySupplierOffer.findMany({
      where: { tenantId, offerId: { in: offerIds }, isActive: true },
    }) : [];
    const offersById = new Map((offers as AnyRecord[]).map(row => [row.offerId, row]));
    return rows.map((row, index) => {
      const item = byId.get(ids[index]) as AnyRecord;
      const packages = Number(row.packages);
      if (!Number.isSafeInteger(packages) || packages < 1 || packages > 100000) {
        throw new BadRequestException('Количество упаковок должно быть целым положительным числом');
      }
      const unit = text(item.unit) || 'шт.';
      const weighted = ['г', 'гр', 'гр.', 'грамм', 'граммы'].includes(unit.toLocaleLowerCase('ru-RU'));
      // A purchase order commits whole packages, not grams. A missing net
      // package weight must not prevent creating/editing/paying an order.
      // Use 0 to explicitly mark unresolved gram content of a weighed pack.
      const configuredSize = item.packageQuantity == null ? 0 : decimalNumber(item.packageQuantity);
      const packageSize = configuredSize > 0 ? configuredSize : weighted ? 0 : 1;
      const offerId = text(row.offerId || item.primaryOfferId);
      const offer = offersById.get(offerId) as AnyRecord | undefined;
      if (row.offerId && (!offer || offer.inventoryItemId !== item.id)) {
        throw new BadRequestException('Поставщик не соответствует позиции: ' + text(item.name));
      }
      const offeredUnitCost = offer ? supplierOfferUnitPrice(offer) : null;
      const suggestedPrice = offeredUnitCost == null
        ? item.referencePrice == null ? 0 : decimalNumber(item.referencePrice)
        : offeredUnitCost * packageSize;
      const price = row.packPrice == null || row.packPrice === ''
        ? suggestedPrice : Number(String(row.packPrice).replace(',', '.'));
      if (!Number.isFinite(price) || price < 0 || price > 100000000) {
        throw new BadRequestException('Проверьте цену упаковки: ' + text(item.name));
      }
      return {
        tenantId, itemId: item.itemId, name: text(item.name),
        manufacturer: text(item.manufacturer), unit, packageSize,
        packages, packPrice: Math.round(price * 100) / 100,
        offerId: offer ? offerId : '', position: index,
      };
    });
  }

  async createPurchaseOrder(tenantId: string, body: unknown) {
    const raw = objectValue(body);
    const orderId = randomUUID();
    await this.prisma.$transaction(async (tx: Tx) => {
      const lines = await this.preparePurchaseOrderLines(tx, tenantId, raw.lines);
      await tx.inventoryPurchaseOrder.create({
        data: {
          tenantId, orderId, supplier: optionalText(raw.supplier), note: optionalText(raw.note),
          lines: { create: lines },
        },
      });
    });
    return this.snapshot(tenantId);
  }

  async updatePurchaseOrder(tenantId: string, orderId: string, body: unknown) {
    const raw = objectValue(body);
    await this.prisma.$transaction(async (tx: Tx) => {
      const lines = await this.preparePurchaseOrderLines(tx, tenantId, raw.lines);
      const claimed = await tx.inventoryPurchaseOrder.updateMany({
        where: { tenantId, orderId, status: 'formed' },
        data: { supplier: optionalText(raw.supplier), note: optionalText(raw.note) },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('Изменять позиции можно только до оплаты заказа');
      }
      const order = await tx.inventoryPurchaseOrder.findUnique({
        where: { tenantId_orderId: { tenantId, orderId } },
      });
      if (!order) throw new BadRequestException('Заказ не найден');
      await tx.inventoryPurchaseOrderLine.deleteMany({
        where: { tenantId, purchaseOrderId: order.id },
      });
      await tx.inventoryPurchaseOrderLine.createMany({
        data: lines.map(line => ({ ...line, purchaseOrderId: order.id })),
      });
    });
    return this.snapshot(tenantId);
  }

  async deletePurchaseOrder(tenantId: string, orderId: string) {
    const deleted = await this.prisma.inventoryPurchaseOrder.deleteMany({
      where: { tenantId, orderId, status: 'formed' },
    });
    if (deleted.count !== 1) throw new BadRequestException('Удалять можно только неоплаченный заказ');
    return this.snapshot(tenantId);
  }

  async payPurchaseOrder(tenantId: string, orderId: string, body: unknown) {
    const raw = objectValue(body);
    const walletId = text(raw.walletId);
    const walletName = text(raw.walletName);
    if (!walletId) throw new BadRequestException('Выберите кошелёк');
    const paidAt = raw.paidAt ? new Date(String(raw.paidAt)) : new Date();
    if (!Number.isFinite(paidAt.getTime())) throw new BadRequestException('Проверьте дату оплаты');
    await this.prisma.$transaction(async (tx: Tx) => {
      const claimed = await tx.inventoryPurchaseOrder.updateMany({
        where: { tenantId, orderId, status: 'formed' }, data: { status: 'paid', paidAt },
      });
      if (claimed.count !== 1) {
        const existing = await tx.inventoryPurchaseOrder.findUnique({
          where: { tenantId_orderId: { tenantId, orderId } },
        });
        if (existing?.status === 'paid' || existing?.status === 'received') return;
        throw new BadRequestException('Нельзя оплатить заказ в текущем состоянии');
      }
      const order = await tx.inventoryPurchaseOrder.findUnique({
        where: { tenantId_orderId: { tenantId, orderId } },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
      if (!order || !order.lines.length) throw new BadRequestException('В заказе нет товаров');
      const operation = await this.finance.recordInventoryPurchaseExpenseInTx(
        tx as Prisma.TransactionClient, tenantId, orderId, walletId, walletName, paidAt,
        order.lines.map((line: AnyRecord) => ({
          name: line.name, packages: line.packages, packPrice: decimalNumber(line.packPrice),
        })),
      );
      if (!operation) throw new BadRequestException('Финансы не подтвердили расход');
      await tx.inventoryPurchaseOrder.update({
        where: { id: order.id },
        data: { financeOperationId: 'inventory-purchase-' + orderId },
      });
    }, { timeout: 60000, maxWait: 10000 });
    return this.snapshot(tenantId);
  }

  async receivePurchaseOrder(tenantId: string, orderId: string, body: unknown) {
    const raw = objectValue(body);
    if (!raw.receivedAt) throw new BadRequestException('Укажите дату получения заказа');
    const receivedAt = new Date(String(raw.receivedAt));
    if (!Number.isFinite(receivedAt.getTime())) throw new BadRequestException('Некорректная дата поступления');
    await this.prisma.$transaction(async (tx: Tx) => {
      // An atomic status transition owns the one and only inventory receipt.
      const claimed = await tx.inventoryPurchaseOrder.updateMany({
        where: { tenantId, orderId, status: 'paid', financeOperationId: { not: '' } },
        data: { status: 'received', receivedAt },
      });
      if (claimed.count !== 1) {
        const existing = await tx.inventoryPurchaseOrder.findUnique({
          where: { tenantId_orderId: { tenantId, orderId } },
        });
        if (existing?.status === 'received') return;
        throw new BadRequestException('Получить можно только оплаченный заказ');
      }
      const order = await tx.inventoryPurchaseOrder.findUnique({
        where: { tenantId_orderId: { tenantId, orderId } },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
      if (!order || !order.lines.length) throw new BadRequestException('Пустой заказ нельзя принять');
      const itemIds = order.lines.map((line: AnyRecord) => line.itemId);
      const actualItems = await tx.inventoryItem.findMany({
        where: { tenantId, itemId: { in: itemIds }, archivedAt: null },
      });
      const byId = new Map((actualItems as AnyRecord[]).map(item => [item.itemId, item]));
      if (byId.size !== order.lines.length || order.lines.some((line: AnyRecord) =>
        text(byId.get(line.itemId)?.unit) !== line.unit)) {
        throw new BadRequestException('Карточка материала изменилась или удалена. Проверьте заказ перед приходом');
      }
      // Physical allocations are decided at RECEIPT, not in the supplier order.
      // Legacy clients without allocations retain their original primary receipt.
      const allocations = Array.isArray(raw.allocations) ? raw.allocations.map(objectValue) : null;
      const rejections = Array.isArray(raw.rejections) ? raw.rejections.map(objectValue) : [];
      const orderByItem = new Map((order.lines as AnyRecord[]).map(line => [line.itemId, line]));
      const receivedByItem = new Map<string, number>();
      const rejectedByItem = new Map<string, number>();
      const receiptParts: AnyRecord[] = [];
      const rejectionParts: AnyRecord[] = [];
      if (allocations) {
        if (allocations.length > 500 || rejections.length > 500) throw new BadRequestException('Слишком много строк приёмки.');
        for (const row of allocations) {
          const itemId = text(row.itemId), locationId = text(row.storageLocationId);
          if (!orderByItem.has(itemId) || !locationId) throw new BadRequestException('Неизвестная позиция или склад приёмки.');
          const packages = Number(row.packages);
          if (!Number.isSafeInteger(packages) || packages <= 0) throw new BadRequestException('Приёмка ведётся целыми упаковками.');
          receivedByItem.set(itemId, (receivedByItem.get(itemId) || 0) + packages);
          receiptParts.push({ itemId, locationId, packages });
        }
        for (const row of rejections) {
          const itemId = text(row.itemId);
          if (!orderByItem.has(itemId)) throw new BadRequestException('Неизвестная позиция возврата.');
          const packages = Number(row.packages), reason = text(row.reason);
          if (!Number.isSafeInteger(packages) || packages <= 0 || !reason) throw new BadRequestException('Укажите число возвращённых упаковок и причину.');
          rejectedByItem.set(itemId, (rejectedByItem.get(itemId) || 0) + packages);
          rejectionParts.push({ itemId, packages, reason });
        }
        for (const line of order.lines as AnyRecord[]) {
          if ((receivedByItem.get(line.itemId) || 0) + (rejectedByItem.get(line.itemId) || 0) !== line.packages)
            throw new BadRequestException('Приёмка и возвраты должны точно совпадать с количеством в заказе: ' + line.name);
        }
        await this.assertStorageLocations(tx, tenantId, receiptParts.map(part => part.locationId));
      } else {
        if (rejections.length) throw new BadRequestException('Для возврата при получении укажите распределение по складам.');
        for (const line of order.lines as AnyRecord[]) receiptParts.push({
          itemId: line.itemId, locationId: PRIMARY_STORAGE, packages: line.packages,
        });
      }
      const movementId = 'inventory-order-receipt-' + orderId;
      const previous = await tx.inventoryMovement.findFirst({
        where: { tenantId, sourceType: 'inventory-purchase-order', sourceId: orderId },
      });
      if (previous) throw new BadRequestException('По этому заказу приход уже был создан');
      const plannedReceipts = receiptParts.map(part => {
          const line = orderByItem.get(part.itemId) as AnyRecord;
          const item = byId.get(part.itemId) as AnyRecord;
          const weighted = ['г', 'гр', 'гр.', 'грамм', 'граммы'].includes(
            String(line.unit).toLocaleLowerCase('ru-RU'));
          const savedSize = decimalNumber(line.packageSize);
          const currentSize = decimalNumber(item.packageQuantity);
          const gross = item.grossWeight == null ? 0 : decimalNumber(item.grossWeight);
          const tare = item.tareWeight == null ? null : decimalNumber(item.tareWeight);
          // Gross is the weight of a full tube. If tare is not measured yet,
          // count ALL gross grams as product; zero tare is a valid reading.
          // If tare is known, it is excluded from usable product and cost per
          // gram. A recorded net/packageQuantity is used when gross is absent.
          if (gross > 0 && tare !== null && tare > gross) {
            throw new BadRequestException('Масса тары превышает вес полной упаковки: ' + text(line.name));
          }
          const measuredSize = gross > 0 ? gross - (tare === null ? 0 : tare) : 0;
          const size = weighted && gross > 0 ? measuredSize
            : currentSize > 0 ? currentSize
            : savedSize > 0 ? savedSize : 0;
          // A physical receipt by pieces is valid without any known mass.
          // Unmeasured grams are not invented; receipts record tube count.
          if (!weighted && size <= 0) throw new BadRequestException('Проверьте количество в упаковке: ' + text(line.name));
          return {
            itemId: line.itemId,
            quantity: part.packages * size,
            unitCost: size > 0 ? decimalNumber(line.packPrice) / size : null,
            containerDelta: weighted ? part.packages : null,
            storageLocationId: part.locationId,
            supplier: order.supplier, offerId: '',
            ...(weighted && size === 0 ? { note: 'Тюбики получены; вес содержимого пока не определён' } : {}),
          };
      });
      if (plannedReceipts.length) {
        await this.createMovementInTx(tx, tenantId, {
          movementId, kind: 'RECEIPT', sourceType: 'inventory-purchase-order',
          sourceId: orderId, occurredAt: receivedAt,
          supplier: order.supplier, note: 'Приход по заказу', lines: plannedReceipts,
        }, { allowPurchaseOrderReceipt: true });
      }
      for (const part of rejectionParts) {
        const ordered = orderByItem.get(part.itemId) as AnyRecord;
        await tx.inventorySupplierClaim.create({ data: {
          tenantId, claimId: randomUUID(), orderId, itemId: part.itemId,
          sourceKind: 'receipt-rejection', packages: part.packages,
          packPrice: ordered.packPrice, amount: Math.round(part.packages * decimalNumber(ordered.packPrice) * 100) / 100,
          reason: part.reason,
        } });
      }
      await tx.inventoryPurchaseOrder.update({
        where: { id: order.id }, data: { receiptMovementId: plannedReceipts.length ? movementId : '' },
      });
    }, { timeout: 60000, maxWait: 10000 });
    return this.snapshot(tenantId);
  }


  // An accepted purchase can be returned to its supplier. This is a separate
  // OUT movement, never an ordinary RETURN (which means goods coming IN).
  async returnPurchaseOrderToSupplier(tenantId: string, orderId: string, body: unknown) {
    const source = objectValue(body);
    const locationId = text(source.storageLocationId);
    const returnId = text(source.returnId);
    if (!returnId || returnId.length > 128) throw new BadRequestException('Не указан идентификатор возврата.');
    if (!locationId) throw new BadRequestException('Выберите склад возврата.');
    const requested = Array.isArray(source.lines) ? source.lines.map(objectValue) : [];
    if (!requested.length || requested.length > 100) throw new BadRequestException('Выберите возвращаемые товары.');
    const occurredAt = optionalDate(source.occurredAt, 'Дата возврата') || new Date();
    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${orderId})) ) AS guard`;
      const movementId = 'inventory-supplier-return-' + returnId;
      const previous = await tx.inventoryMovement.findFirst({ where: { tenantId, movementId } });
      if (previous) {
        if (previous.kind === 'SUPPLIER_RETURN' && previous.sourceId === orderId) return;
        throw new BadRequestException('Идентификатор возврата уже занят.');
      }
      const order = await tx.inventoryPurchaseOrder.findFirst({
        where: { tenantId, orderId, status: 'received' },
        include: { lines: true },
      });
      if (!order) throw new BadRequestException('Возврат возможен только после получения заказа.');
      await this.assertStorageLocations(tx, tenantId, [locationId]);
      const byItem = new Map((order.lines as AnyRecord[]).map(row => [row.itemId, row]));
      const ids = [...new Set(requested.map(row => text(row.itemId)))];
      if (ids.length !== requested.length || ids.some(itemId => !byItem.has(itemId)))
        throw new BadRequestException('Повторяющиеся или отсутствующие позиции заказа.');
      const actual = await tx.inventoryItem.findMany({
        where: { tenantId, itemId: { in: ids }, archivedAt: null },
      });
      if (actual.length !== ids.length) throw new BadRequestException('Складская единица больше не доступна.');
      const actualById = new Map((actual as AnyRecord[]).map(item => [item.itemId, item]));
      const claims = await tx.inventorySupplierClaim.findMany({ where: { tenantId, orderId } });
      const stockLines: AnyRecord[] = [];
      const claimParts: AnyRecord[] = [];
      for (const part of requested) {
        const itemId = text(part.itemId), packages = Number(part.packages);
        const reason = text(part.reason);
        if (!Number.isSafeInteger(packages) || packages <= 0 || !reason)
          throw new BadRequestException('Укажите целые упаковки и причину возврата.');
        const line = byItem.get(itemId) as AnyRecord;
        const item = actualById.get(itemId) as AnyRecord;
        const alreadyClaimed = (claims as AnyRecord[])
          .filter(row => row.itemId === itemId)
          .reduce((sum: number, row: AnyRecord) => sum + row.packages, 0);
        if (packages + alreadyClaimed > line.packages)
          throw new BadRequestException('Возврат превышает количество оплаченных и полученных товаров.');
        const unit = canonicalInventoryUnit(item.unit);
        const weighted = unit === 'г' || unit === 'мл';
        const gross = item.grossWeight == null ? 0 : decimalNumber(item.grossWeight);
        const tare = item.tareWeight == null ? null : decimalNumber(item.tareWeight);
        if (gross > 0 && tare !== null && tare > gross)
          throw new BadRequestException('Масса тары превышает брутто.');
        const size = unit === 'г' && gross > 0
          ? gross - (tare === null ? 0 : tare)
          : decimalNumber(item.packageQuantity) > 0
            ? decimalNumber(item.packageQuantity) : decimalNumber(line.packageSize);
        if (!weighted && size <= 0) throw new BadRequestException('Не указан размер упаковки.');
        if (weighted) {
          const localTubes = await tx.inventoryMovementLine.findMany({
            where: { tenantId, inventoryItemId: item.id, storageLocationId: locationId },
            select: { containerDelta: true, actualContainerCount: true, direction: true },
          });
          const physical = (localTubes as AnyRecord[]).reduce((sum: number, row: AnyRecord) =>
            sum + (row.containerDelta == null ? 0 : Number(row.containerDelta)), 0);
          if (physical < packages) throw new BadRequestException('Недостаточно банок на выбранном складе.');
        }
        const stock = packages * size;
        const available = await this.storageBalanceInTx(tx, tenantId, item.id, locationId);
        if (stock > available + EPSILON) throw new BadRequestException('Недостаточный остаток на складе возврата.');
        stockLines.push({
          itemId, quantity: stock, direction: 'OUT', storageLocationId: locationId,
          ...(weighted ? { containerDelta: -packages } : {}),
          note: reason,
        });
        claimParts.push({
          tenantId, claimId: randomUUID(), orderId, itemId,
          sourceKind: 'supplier-return', packages, packPrice: line.packPrice,
          amount: Math.round(packages * decimalNumber(line.packPrice) * 100) / 100,
          reason, movementId,
        });
      }
      await this.createMovementInTx(tx, tenantId, {
        movementId, kind: 'SUPPLIER_RETURN', sourceType: 'inventory-supplier-return',
        sourceId: orderId, occurredAt, note: text(source.note) || 'Возврат товара поставщику',
        lines: stockLines,
      }, { allowSupplierReturn: true });
      for (const claim of claimParts) await tx.inventorySupplierClaim.create({ data: claim });
    }, { timeout: 60000, maxWait: 10000 });
    return this.snapshot(tenantId);
  }

  // The claim exists before money moves. A reimbursement is posted atomically
  // to Finance's canonical wallet ledger, never as a fabricated sale.
  async refundSupplierClaim(tenantId: string, claimId: string, body: unknown) {
    const source = objectValue(body);
    const settlementId = text(source.settlementId);
    const walletId = text(source.walletId), walletName = text(source.walletName);
    const amount = Number(String(source.amount ?? '').replace(',', '.'));
    if (!settlementId || settlementId.length > 128) throw new BadRequestException('Не указан идентификатор погашения.');
    if (!walletId || !walletName) throw new BadRequestException('Выберите кошелёк поступления.');
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) / 100 !== amount)
      throw new BadRequestException('Проверьте сумму возврата.');
    const occurredAt = optionalDate(source.occurredAt, 'Дата возврата денег') || new Date();
    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${claimId}))) AS guard`;
      const previous = await tx.inventorySupplierClaimSettlement.findFirst({ where: { tenantId, settlementId } });
      if (previous) {
        if (previous.claimId === claimId && decimalNumber(previous.amount) === amount) return;
        throw new BadRequestException('Идентификатор погашения уже использован.');
      }
      const claim = await tx.inventorySupplierClaim.findFirst({ where: { tenantId, claimId } });
      if (!claim) throw new NotFoundException('Задолженность поставщика не найдена.');
      if (amount > decimalNumber(claim.amount) - decimalNumber(claim.settledAmount) + 0.001)
        throw new BadRequestException('Сумма превышает задолженность поставщика.');
      const operationId = 'inventory-supplier-refund-' + settlementId;
      await this.finance.recordInventorySupplierRefundInTx(
        tx as Prisma.TransactionClient, tenantId, claimId, settlementId, walletId, walletName, amount, occurredAt,
      );
      await tx.inventorySupplierClaimSettlement.create({ data: {
        tenantId, settlementId, claimId, kind: 'refund', amount,
        walletId, walletName, financeOperationId: operationId, occurredAt,
      } });
      await tx.inventorySupplierClaim.update({
        where: { id: claim.id }, data: {
          settledAmount: Math.round((decimalNumber(claim.settledAmount) + amount) * 100) / 100,
        },
      });
    }, { timeout: 60000, maxWait: 10000 });
    return this.snapshot(tenantId);
  }

  private inventoryPosition(value: unknown): number {
    if (value == null) return 0;
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2147483647)
      throw new BadRequestException('Порядковый номер должен быть целым положительным числом или пустым');
    return Number(value);
  }

  // Serialize reorder and number edits for this tenant. Only product positions
  // are written; stock quantities, lots, movements and company data remain intact.
  private async lockInventoryOrder(tx: Tx, tenantId: string) {
    const key = `inventory-order:${tenantId}`;
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
  }

  // An occupied number is an insertion point, not a validation failure.
  // Shift the consecutive occupied slots inside this manufacturer only.
  private async freeInventoryPosition(tx: Tx, tenantId: string, manufacturer: string, position: number, excludeId = '', oldPosition = 0) {
    if (position === 0) return;
    // Moving an already-numbered item down uses the vacated slot above it:
    // 2 → 4 shifts old 3 to 2 and old 4 to 3, instead of leaving an empty 2.
    if (oldPosition > 0 && oldPosition < position) {
      const between: AnyRecord[] = await tx.inventoryItem.findMany({
        where: {
          tenantId, archivedAt: null, manufacturer,
          position: { gt: oldPosition, lte: position },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true, position: true },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });
      for (const row of between) {
        await tx.inventoryItem.update({ where: { id: row.id }, data: { position: row.position - 1 } });
      }
      return;
    }
    const rows: AnyRecord[] = await tx.inventoryItem.findMany({
      where: {
        tenantId, archivedAt: null, manufacturer, position: { gte: position },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, position: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    let occupied = position;
    for (const row of rows) {
      if (row.position !== occupied || (oldPosition > 0 && occupied >= oldPosition)) break;
      occupied += 1;
      await tx.inventoryItem.update({ where: { id: row.id }, data: { position: occupied } });
    }
  }

  // Every active item has a positive, consecutive rank inside its manufacturer.
  // Previously unnumbered legacy items join the end. Explicitly cleared
  // selections move after all other items, in their former relative order.
  // One atomic SQL update changes positions only; never stock or movements.
  private async compactInventoryPositions(tx: Tx, tenantId: string, manufacturer: string,
    clearItemIds: Set<string> = new Set()): Promise<{ itemId: string; position: number }[]> {
    const rows: AnyRecord[] = await tx.inventoryItem.findMany({
      where: { tenantId, manufacturer, archivedAt: null },
      select: { id: true, itemId: true, position: true, name: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
    const ordered = [...rows].sort((a, b) => {
      const rank = (item: AnyRecord) => Number(item.position) > 0
        ? Number(item.position) : Number.MAX_SAFE_INTEGER;
      return rank(a) - rank(b)
        || collator.compare(String(a.name || ''), String(b.name || ''))
        || String(a.id).localeCompare(String(b.id));
    });
    const remaining = ordered.filter(row => !clearItemIds.has(String(row.itemId)));
    const moved = ordered.filter(row => clearItemIds.has(String(row.itemId)));
    const positions = [...remaining, ...moved].map((row, index) => ({
      id: row.id,
      itemId: String(row.itemId),
      before: Number(row.position) || 0,
      position: index + 1,
    }));
    if (positions.length > 2147483647)
      throw new BadRequestException('Слишком много позиций для нумерации.');
    const changes = positions.filter(row => row.before !== row.position);
    if (changes.length) {
      const cases = changes.map(row => Prisma.sql`WHEN ${row.id} THEN ${row.position}`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "InventoryItem"
        SET "position" = CASE "id" ${Prisma.join(cases, ' ')} ELSE "position" END
        WHERE "tenantId" = ${tenantId}
          AND "id" IN (${Prisma.join(changes.map(row => row.id))})
      `);
    }
    return positions.map(({ itemId, position }) => ({ itemId, position }));
  }

  // "Clear number" means MOVE TO END. Every selected item is numbered
  // after the remaining items; all affected manufacturer ranks stay 1..N.
  async clearItemPositions(tenantId: string, body: unknown) {
    const source = objectValue(body);
    const raw = Array.isArray(source.items) ? source.items : [];
    if (!raw.length || raw.length > 10000)
      throw new BadRequestException('Выберите от 1 до 10000 товаров.');
    const selected = raw.map((entry: unknown) => {
      const value = objectValue(entry);
      const itemId = text(value.itemId);
      const expectedPosition = value.expectedPosition;
      if (!itemId || !Number.isSafeInteger(expectedPosition)
        || expectedPosition < 0 || expectedPosition > 2147483647)
        throw new BadRequestException('Обновите склад перед очисткой номеров.');
      return { itemId, expectedPosition };
    });
    const ids = selected.map(row => row.itemId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Повторяющаяся позиция.');
    const previous = new Map(selected.map(row => [row.itemId, row.expectedPosition]));
    const positions: { itemId: string; position: number }[] = [];
    await this.prisma.$transaction(async (tx: Tx) => {
      await this.lockInventoryOrder(tx, tenantId);
      const targets: AnyRecord[] = await tx.inventoryItem.findMany({
        where: { tenantId, archivedAt: null, itemId: { in: ids } },
        select: { itemId: true, position: true, manufacturer: true },
      });
      if (targets.length !== ids.length
        || targets.some(row => Number(row.position) !== previous.get(String(row.itemId))))
        throw new BadRequestException('Порядок изменился. Обновите склад и повторите.');
      const manufacturers = [...new Set(targets.map(row => String(row.manufacturer || '')))].sort();
      const toClear = new Set(ids);
      for (const manufacturer of manufacturers) {
        positions.push(...await this.compactInventoryPositions(tx, tenantId, manufacturer, toClear));
      }
    }, { maxWait: 10000, timeout: 120000 });
    return { clearedItemIds: ids, positions };
  }

  // A reorder is an atomic permutation of the entire manufacturer list.
  // It assigns consecutive 1..N ranks even to legacy unnumbered products,
  // while protecting against changes made in another browser tab.
  async reorderItems(tenantId: string, body: unknown) {
    const source = objectValue(body);
    const manufacturer = text(source.manufacturer);
    const ids = Array.isArray(source.itemIds) ? source.itemIds.map(text) : [];
    const previous = Array.isArray(source.previousPositions) ? source.previousPositions : [];
    if (!ids.length || ids.length > 10000 || new Set(ids).size !== ids.length || ids.some(id => !id))
      throw new BadRequestException('Некорректный список материалов');
    // Required optimistic concurrency: older tabs must not overwrite a more
    // recent manual numbering performed on another phone or computer.
    if (previous.length !== ids.length || previous.some(value =>
      !Number.isSafeInteger(value) || Number(value) < 0)) {
      throw new BadRequestException('Список изменился. Обновите склад перед перемещением.');
    }

    await this.prisma.$transaction(async (tx: Tx) => {
      await this.lockInventoryOrder(tx, tenantId);
      const items: AnyRecord[] = await tx.inventoryItem.findMany({
        where: { tenantId, archivedAt: null, manufacturer },
        select: { id: true, itemId: true, name: true, position: true },
      });
      const byId = new Map(items.map(item => [item.itemId, item]));
      if (ids.length !== items.length || ids.some(id => !byId.has(id)))
        throw new BadRequestException('Список материалов изменился. Откройте компанию повторно.');
      const ordered = ids.map(id => byId.get(id)!);
      if (ordered.some((item, index) => Number(item.position) !== previous[index])) {
        throw new BadRequestException('Порядок изменён в другом окне. Обновите список перед перемещением.');
      }

      // One atomic permutation also restores any legacy unnumbered items.
      // Every item in the requested order receives rank index + 1.
      const changed = ordered
        .map((item, index) => ({ item, position: index + 1 }))
        .filter(({ item, position }) => item.position !== position);
      if (!changed.length) return;
      const cases = changed.map(({ item, position }) => Prisma.sql`WHEN ${item.id} THEN ${position}`);
      const internalIds = changed.map(({ item }) => item.id);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "InventoryItem"
        SET "position" = CASE "id" ${Prisma.join(cases, ' ')} ELSE "position" END
        WHERE "tenantId" = ${tenantId} AND "id" IN (${Prisma.join(internalIds)})
      `);
    }, { timeout: 20000 });
    return this.snapshot(tenantId);
  }

  async createItem(tenantId: string, body: unknown, db?: Tx) {
    const source = objectValue(body);
    const name = text(source.name);
    if (!name) throw new BadRequestException('Укажите наименование позиции');
    const unit = text(source.unit) || 'шт.';
    const itemId = text(source.itemId) || randomUUID();
    const position = this.inventoryPosition(source.position);
    const initialQuantity = nonNegative(source.quantity);
    const purchasePrice = nullableNonNegative(source.purchasePrice ?? source.actualPrice ?? source.lastPurchasePrice);
    const grossWeight = nullableNonNegative(source.grossWeight);
    const tareWeight = nullableNonNegative(source.tareWeight);
    if (grossWeight != null && tareWeight != null && tareWeight > grossWeight) {
      throw new BadRequestException('Масса тары не может быть больше массы брутто');
    }

    const card = inventoryCardChanges(source);
    if (card.receiptUnit && !('thresholdUnit' in card)) card.thresholdUnit = card.receiptUnit;
    validateInventoryCard(card);
    const work = async (tx: Tx) => {
      await this.lockInventoryOrder(tx, tenantId);
      const manufacturer = optionalText(source.manufacturer);
      // Normalize older gaps/blank ranks before determining an insertion slot.
      const existing = await this.compactInventoryPositions(tx, tenantId, manufacturer);
      const assignedPosition = position > 0 ? Math.min(position, existing.length + 1)
        : existing.length + 1;
      if (assignedPosition > 2147483647)
        throw new BadRequestException('Невозможно добавить позицию: список заполнен.');
      if (position > 0)
        await this.freeInventoryPosition(tx, tenantId, manufacturer, assignedPosition);
      const classificationGroupId = await this.resolveItemGroup(tx, tenantId, source);
      const criteriaValues = 'criteriaValues' in source
        ? await this.criteria.validateSelections(tx as Prisma.TransactionClient, tenantId, source.criteriaValues)
        : undefined;
      await tx.inventoryItem.create({
        data: {
          tenantId,
          itemId,
          name,
          classificationGroupId,
          ...(criteriaValues === undefined ? {} : { criteriaValues }),
          ...card,
          manufacturer: optionalText(source.manufacturer),
          productType: optionalText(source.productType),
          unit,
          category: optionalText(source.category),
          sku: optionalText(source.sku),
          barcode: optionalText(source.barcode),
          location: optionalText(source.location),
          supplier: optionalText(source.supplier),
          minStock: nullableNonNegative(source.minStock),
          targetStock: nullableNonNegative(source.targetStock),
          targetStockMode: 'overall',
          packageQuantity: nullableNonNegative(source.packageQuantity),
          containerCount: optionalContainerInteger(source.containerCount, 'Количество тюбиков'),
          grossWeight,
          tareWeight,
          referencePrice: optionalOfferAmount(source.referencePrice, 'Базовая цена'),
          lastPurchasePrice: purchasePrice,
          trackLots: source.trackLots !== false,
          canConsume: source.canConsume !== false,
          canSell: source.canSell === true,
          consumeUnit: optionalUsageUnit(source.consumeUnit),
          consumeQuantity: optionalUsageQuantity(source.consumeQuantity),
          saleUnit: optionalUsageUnit(source.saleUnit),
          saleQuantity: optionalUsageQuantity(source.saleQuantity),
          saleMarkupMode: source.saleMarkupMode === 'amount' ? 'amount' : 'percent',
          saleMarkupValue: optionalOfferAmount(source.saleMarkupValue, 'Наценка'),
          salePrice: optionalOfferAmount(source.salePrice, 'Цена продажи'),
          position: assignedPosition,
        },
      });

      if (initialQuantity > 0) {
        await this.createMovementInTx(tx, tenantId, {
          kind: 'RECEIPT',
          sourceType: 'initial-stock',
          sourceId: itemId,
          occurredAt: source.occurredAt,
          note: 'Начальный остаток',
          lines: [{
            itemId,
            quantity: initialQuantity,
            unitCost: purchasePrice,
            supplier: source.supplier,
            listPrice: source.listPrice,
            discountPercent: source.discountPercent,
          }],
        });
      }
    };
    if (db) await work(db); else await this.prisma.$transaction(work);

    return db ? { itemId } : this.snapshot(tenantId);
  }

  // Archiving only changes the active catalog flag. Inventory history is never
  // rewritten and no full /inventory snapshot is reconstructed for this action.
  private async assertItemsCanBeArchived(tx: Tx, tenantId: string, items: AnyRecord[]) {
    if (!items.length) return;
    const ids = items.map(item => item.id);
    // Aggregate in PostgreSQL: avoid loading every historical movement line
    // into Node just to decide whether an item can be archived.
    const totals = await tx.inventoryMovementLine.groupBy({
      by: ['inventoryItemId', 'storageLocationId', 'direction'],
      where: { tenantId, inventoryItemId: { in: ids } },
      _sum: { quantity: true, containerDelta: true },
    });
    const balances = new Map<string, number>();
    const containers = new Map<string, number>();
    for (const row of totals as AnyRecord[]) {
      const key = row.inventoryItemId + ':' + (row.storageLocationId || PRIMARY_STORAGE);
      const quantity = decimalNumber(row._sum.quantity);
      const signed = row.direction === 'OUT' ? -quantity : quantity;
      balances.set(key, (balances.get(key) || 0) + signed);
      containers.set(key, (containers.get(key) || 0) + Number(row._sum.containerDelta || 0));
    }
    const occupied = items.filter(item =>
      [...balances].some(([key, amount]) => key.startsWith(item.id + ':') && Math.abs(amount) > EPSILON)
      || [...containers].some(([key, count]) => key.startsWith(item.id + ':') && count !== 0)
      || item.containerCount != null && Number(item.containerCount) > 0);
    if (occupied.length)
      throw new BadRequestException('Нельзя удалить товары с остатками. Сначала оформите движение: ' +
        occupied.slice(0, 4).map(item => item.name).join(', '));
    // One indexed relationship query instead of loading every order line.
    const activeOrder = await tx.inventoryPurchaseOrderLine.findFirst({
      where: {
        tenantId, itemId: { in: items.map(item => item.itemId) },
        order: { is: { tenantId, status: { in: ['formed', 'paid'] } } },
      },
      select: { itemId: true },
    });
    if (activeOrder)
      throw new BadRequestException('Нельзя удалить позицию из не полученного заказа.');
  }

  // One server request for selected product characteristics; no N repeated full
  // inventory snapshots. Physical movements and purchase history are untouched.
  async updateItemsBatch(tenantId: string, body: unknown) {
    const source = objectValue(body);
    const raw = Array.isArray(source.updates) ? source.updates : [];
    if (!raw.length || raw.length > 100)
      throw new BadRequestException('Выберите от 1 до 100 позиций для изменения.');
    const allowed = new Set([
      'category', 'productType', 'name', 'manufacturer', 'sku', 'barcode',
      'supplier', 'referencePrice', 'unit', 'packageQuantity',
      'grossWeight', 'tareWeight', 'minStock', 'targetStock',
      'canConsume', 'canSell',
    ]);
    const updates = raw.map((value: unknown) => {
      const input = objectValue(value);
      const itemId = text(input.itemId);
      const patch = objectValue(input.patch);
      const keys = Object.keys(patch);
      if (!itemId || !keys.length || keys.some(key => !allowed.has(key)))
        throw new BadRequestException('Выберите товар и допустимые поля изменения.');
      return { itemId, patch };
    });
    const ids = updates.map(row => row.itemId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Повторяющаяся позиция в изменениях.');
    await this.prisma.$transaction(async (tx: Tx) => {
      await this.lockInventoryOrder(tx, tenantId);
      const existing = await tx.inventoryItem.findMany({
        where: { tenantId, itemId: { in: ids }, archivedAt: null },
        select: { id: true, itemId: true },
      });
      if (existing.length !== ids.length)
        throw new BadRequestException('Состав товаров изменился. Обновите остатки.');
      // Lock once in deterministic order. Existing updateItem remains the sole
      // owner of every field validation and classification rule.
      await tx.$queryRaw`SELECT id FROM "InventoryItem"
        WHERE id IN (${Prisma.join(existing.map((item: AnyRecord) => item.id))})
        ORDER BY id FOR UPDATE`;
      for (const update of updates) {
        await this.updateItem(tenantId, update.itemId, update.patch, tx);
      }
    }, { maxWait: 10000, timeout: 120000 });
    return { updatedItemIds: ids };
  }

  async archiveSelectedItems(tenantId: string, body: unknown) {
    const source = objectValue(body);
    const ids = Array.isArray(source.itemIds) ? source.itemIds.map(text) : [];
    if (!ids.length || ids.length > 500 || ids.some(id => !id) || new Set(ids).size !== ids.length)
      throw new BadRequestException('Выберите от 1 до 500 разных товаров.');
    await this.prisma.$transaction(async (tx: Tx) => {
      await this.lockInventoryOrder(tx, tenantId);
      const items = await tx.inventoryItem.findMany({
        where: { tenantId, itemId: { in: ids } },
      });
      if (items.length !== ids.length)
        throw new BadRequestException('Одна из позиций не найдена. Обновите остатки.');
      const active = items.filter((item: AnyRecord) => !item.archivedAt);
      if (!active.length) return; // An acknowledged retry is idempotent.
      // Lock the selected items with one query, rather than one per product.
      await tx.$queryRaw`SELECT id FROM "InventoryItem"
        WHERE id IN (${Prisma.join(active.map((item: AnyRecord) => item.id))})
        ORDER BY id FOR UPDATE`;
      await this.assertItemsCanBeArchived(tx, tenantId, active);
      const updated = await tx.inventoryItem.updateMany({
        where: { tenantId, itemId: { in: active.map((item: AnyRecord) => item.itemId) }, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (updated.count !== active.length)
        throw new BadRequestException('Состав товаров изменился. Повторите операцию.');
    }, { maxWait: 10000, timeout: 120000 });
    // The IDs are the only response. No read of lots, movements or orders.
    return { archivedItemIds: ids };
  }

  async updateItem(tenantId: string, itemId: string, body: unknown, db?: Tx) {
    const source = objectValue(body);
    // Public manual number writes must carry the last visible value. Internal
    // transfer/import transactions may pass their own DB context instead.
    if (!db && 'position' in source && !('expectedPosition' in source))
      throw new BadRequestException('Обновите склад перед изменением номера.');
    // A number edit or company transfer is atomic with its order adjustment.
    if (!db && ('position' in source || 'manufacturer' in source || 'category' in source
        || 'productType' in source || 'classificationGroupId' in source
        || 'criteriaValues' in source
        || 'targetStock' in source || source.archived === true)) {
      await this.prisma.$transaction(async (tx: Tx) => {
        await this.updateItem(tenantId, itemId, body, tx);
      }, { maxWait: 10000, timeout: 60000 });
      return this.snapshot(tenantId);
    }
    const owner = db || this.prisma;
    if (db && ('position' in source || 'manufacturer' in source || source.archived === true))
      await this.lockInventoryOrder(owner, tenantId);
    const current = await owner.inventoryItem.findFirst({ where: { tenantId, itemId, archivedAt: null } });
    if (!current) throw new NotFoundException('Позиция склада не найдена');
    if ('position' in source && 'expectedPosition' in source
      && (!Number.isSafeInteger(source.expectedPosition)
        || Number(source.expectedPosition) !== Number(current.position))) {
      throw new BadRequestException('Порядок изменился в другом окне. Обновите склад.');
    }

    const data: AnyRecord = {};
    const classificationGroupId = db
      ? await this.resolveItemGroup(db, tenantId, source, current)
      : undefined;
    if (classificationGroupId !== undefined) data.classificationGroupId = classificationGroupId;
    if ('criteriaValues' in source) data.criteriaValues = await this.criteria.validateSelections(
      owner as Prisma.TransactionClient, tenantId, source.criteriaValues, current.criteriaValues);
    if ('name' in source) {
      const name = text(source.name);
      if (!name) throw new BadRequestException('Укажите наименование позиции');
      data.name = name;
    }
    if ('unit' in source) {
      const nextUnit = text(source.unit) || current.unit;
      if (nextUnit !== current.unit) {
        const existingMovement = await owner.inventoryMovementLine.findFirst({
          where: { tenantId, inventoryItemId: current.id },
          select: { id: true },
        });
        if (existingMovement) {
          throw new BadRequestException('Единицу учёта нельзя менять после складских движений');
        }
      }
      data.unit = nextUnit;
    }
    for (const key of ['manufacturer', 'productType', 'category', 'sku', 'barcode', 'location', 'supplier'] as const) {
      if (key in source) data[key] = optionalText(source[key]);
    }
    for (const key of ['minStock', 'targetStock', 'packageQuantity', 'grossWeight', 'tareWeight', 'lastPurchasePrice'] as const) {
      if (key in source) data[key] = nullableNonNegative(source[key]);
    }
    // Existing stock editor may still send an unchanged global target.
    // Never overwrite a location-derived value, or permit a global target
    // below the sum of declared per-location targets.
    if ('targetStock' in source) {
      if (current.targetStockMode === 'locations') {
        const previous = current.targetStock == null ? null : decimalNumber(current.targetStock);
        if (data.targetStock !== previous)
          throw new BadRequestException('Желаемый остаток рассчитывается по складам.');
        delete data.targetStock;
      } else {
        const targets = await owner.inventoryLocationTarget.findMany({
          where: { tenantId, inventoryItemId: current.id }, select: { targetStock: true },
        });
        const allocated = Math.round(targets.reduce((sum: number, row: AnyRecord) =>
          sum + decimalNumber(row.targetStock), 0) * 1000) / 1000;
        if (targets.length && (data.targetStock == null || data.targetStock < allocated))
          data.targetStock = allocated;
      }
    }
    if ('referencePrice' in source) data.referencePrice = optionalOfferAmount(source.referencePrice, 'Базовая цена');
    const grossWeight = 'grossWeight' in data ? data.grossWeight : (current.grossWeight == null ? null : decimalNumber(current.grossWeight));
    const tareWeight = 'tareWeight' in data ? data.tareWeight : (current.tareWeight == null ? null : decimalNumber(current.tareWeight));
    if (grossWeight != null && tareWeight != null && tareWeight > grossWeight) {
      throw new BadRequestException('Масса тары не может быть больше массы брутто');
    }
    Object.assign(data, inventoryCardChanges(source));
    validateInventoryCard({ ...current, ...data });
    if ('trackLots' in source) data.trackLots = source.trackLots !== false;
    if ('canConsume' in source) data.canConsume = source.canConsume !== false;
    if ('canSell' in source) data.canSell = source.canSell === true;
    if ('consumeUnit' in source) data.consumeUnit = optionalUsageUnit(source.consumeUnit);
    if ('saleUnit' in source) data.saleUnit = optionalUsageUnit(source.saleUnit);
    if ('consumeQuantity' in source) data.consumeQuantity = optionalUsageQuantity(source.consumeQuantity);
    if ('saleQuantity' in source) data.saleQuantity = optionalUsageQuantity(source.saleQuantity);
    if ('saleMarkupMode' in source) {
      if (!['percent', 'amount'].includes(String(source.saleMarkupMode))) throw new BadRequestException('Наценка: выберите % или ₽');
      data.saleMarkupMode = source.saleMarkupMode;
    }
    if ('saleMarkupValue' in source) data.saleMarkupValue = optionalOfferAmount(source.saleMarkupValue, 'Наценка');
    if ('salePrice' in source) data.salePrice = optionalOfferAmount(source.salePrice, 'Цена продажи');
    const manufacturer = 'manufacturer' in data ? data.manufacturer : current.manufacturer;
    const changedManufacturer = manufacturer !== current.manufacturer;
    const positionSpecified = 'position' in source;
    if (positionSpecified || changedManufacturer) {
      const existing = await this.compactInventoryPositions(owner, tenantId, manufacturer);
      const oldPosition = changedManufacturer ? 0
        : existing.find(row => row.itemId === itemId)?.position || 0;
      const requested = positionSpecified ? this.inventoryPosition(source.position) : 0;
      // An empty number means "to the end", not an unassigned rank.
      const nextPosition = requested > 0
        ? Math.min(requested, existing.length + (changedManufacturer ? 1 : 0))
        : existing.length + (changedManufacturer ? 1 : 0);
      if (nextPosition < 1 || nextPosition > 2147483647)
        throw new BadRequestException('Невозможно определить новый порядковый номер.');
      if (nextPosition !== oldPosition)
        await this.freeInventoryPosition(owner, tenantId, manufacturer, nextPosition,
          current.id, oldPosition);
      data.position = nextPosition;
    }
    if (source.archived === true) {
      if (!db) throw new BadRequestException('Для удаления требуется транзакция.');
      await this.assertItemsCanBeArchived(db, tenantId, [current]);
      data.archivedAt = new Date();
    }

    await owner.inventoryItem.update({ where: { id: current.id }, data });
    // Moving an item to another manufacturer closes the old list's gap.
    if (changedManufacturer)
      await this.compactInventoryPositions(owner, tenantId, String(current.manufacturer || ''));
    return db ? { itemId } : this.snapshot(tenantId);
  }

  private async findCatalogItem(owner: Tx | PrismaService, tenantId: string, itemId: string) {
    const item = await owner.inventoryItem.findFirst({ where: { tenantId, itemId, archivedAt: null } });
    if (!item) throw new NotFoundException('Продукт не найден');
    return item;
  }

  async createSupplierOffer(tenantId: string, itemId: string, body: unknown) {
    const source = objectValue(body);
    const supplier = text(source.supplier);
    if (!supplier) throw new BadRequestException('Укажите место покупки или поставщика');
    const item = await this.findCatalogItem(this.prisma, tenantId, itemId);
    await this.prisma.inventorySupplierOffer.create({
      data: {
        tenantId,
        inventoryItemId: item.id,
        offerId: randomUUID(),
        supplier,
        listPrice: optionalOfferAmount(source.listPrice, 'Цена по прайсу'),
        discountPercent: optionalOfferAmount(source.discountPercent, 'Скидка', 100),
        actualPrice: optionalOfferAmount(source.actualPrice, 'Цена покупки'),
        unitsPerOffer: source.unitsPerOffer == null || source.unitsPerOffer === ''
          ? null : offerPackSize(source.unitsPerOffer),
        supplierSku: optionalText(source.supplierSku),
        note: optionalText(source.note),
        isActive: true,
      },
    });
    return this.snapshot(tenantId);
  }

  async updateSupplierOffer(tenantId: string, itemId: string, offerId: string, body: unknown) {
    const item = await this.findCatalogItem(this.prisma, tenantId, itemId);
    const offer = await this.prisma.inventorySupplierOffer.findFirst({
      where: { tenantId, inventoryItemId: item.id, offerId, isActive: true },
    });
    if (!offer) throw new NotFoundException('Предложение поставщика не найдено');
    const source = objectValue(body);
    const data: AnyRecord = {};
    if ('supplier' in source) {
      const supplier = text(source.supplier);
      if (!supplier) throw new BadRequestException('Укажите место покупки или поставщика');
      data.supplier = supplier;
    }
    if ('listPrice' in source) data.listPrice = optionalOfferAmount(source.listPrice, 'Цена по прайсу');
    if ('discountPercent' in source) data.discountPercent = optionalOfferAmount(source.discountPercent, 'Скидка', 100);
    if ('actualPrice' in source) data.actualPrice = optionalOfferAmount(source.actualPrice, 'Цена покупки');
    if ('unitsPerOffer' in source) data.unitsPerOffer = source.unitsPerOffer == null || source.unitsPerOffer === ''
      ? null : offerPackSize(source.unitsPerOffer);
    if ('supplierSku' in source) data.supplierSku = optionalText(source.supplierSku);
    if ('note' in source) data.note = optionalText(source.note);
    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.inventorySupplierOffer.update({ where: { id: offer.id }, data });
      if (item.primaryOfferId === offerId && data.supplier !== undefined) {
        await tx.inventoryItem.update({ where: { id: item.id }, data: { supplier: data.supplier } });
      }
    });
    return this.snapshot(tenantId);
  }

  async archiveSupplierOffer(tenantId: string, itemId: string, offerId: string) {
    await this.prisma.$transaction(async (tx: Tx) => {
      const item = await this.findCatalogItem(tx, tenantId, itemId);
      const offer = await tx.inventorySupplierOffer.findFirst({
        where: { tenantId, inventoryItemId: item.id, offerId, isActive: true },
      });
      if (!offer) throw new NotFoundException('Предложение поставщика не найдено');
      await tx.inventorySupplierOffer.update({ where: { id: offer.id }, data: { isActive: false } });
      if (item.primaryOfferId === offerId) {
        await tx.inventoryItem.update({ where: { id: item.id }, data: { primaryOfferId: null } });
      }
    });
    return this.snapshot(tenantId);
  }

  async setPrimarySupplierOffer(tenantId: string, itemId: string, body: unknown) {
    const source = objectValue(body);
    if (!('offerId' in source)) throw new BadRequestException('Укажите предложение поставщика');
    const offerId = text(source.offerId);
    await this.prisma.$transaction(async (tx: Tx) => {
      const item = await this.findCatalogItem(tx, tenantId, itemId);
      const offer = offerId ? await tx.inventorySupplierOffer.findFirst({
        where: { tenantId, inventoryItemId: item.id, offerId, isActive: true },
      }) : null;
      if (offerId && !offer) throw new NotFoundException('Предложение поставщика не найдено');
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          primaryOfferId: offerId || null,
          ...(offer ? { supplier: offer.supplier } : {}),
        },
      });
    });
    return this.snapshot(tenantId);
  }

  // This is called INSIDE the Record owner's transaction. A stock sale is a
  // movement fact owned by Inventory; Service stores no duplicate product row.
  // Always compare the desired totals with previous SALE/RETURN movements.
  // Retried record writes become no-ops; quantity edits create only the delta.
  async syncRecordSalesInTx(
    tx: Tx, tenantId: string, recordId: string, products: AnyRecord[],
    context: { personKey?: string; workplaceKey?: string } = {},
  ) {
    const sourceType = 'record-sale';
    const requested = (Array.isArray(products) ? products : []).filter(row => text(row?.inventoryItemId));
    const movementsBefore = await tx.inventoryMovement.findMany({
      where: { tenantId, sourceType, sourceId: recordId },
      include: { lines: { include: { item: true } } },
    });
    const affected = new Set<string>(requested.map(row => text(row.inventoryItemId)));
    for (const movement of movementsBefore as AnyRecord[]) {
      for (const line of movement.lines as AnyRecord[]) affected.add(text(line.item?.itemId));
    }
    if (!affected.size) return;
    const ids = [...affected].filter(Boolean).sort();
    const catalog = await tx.inventoryItem.findMany({
      where: { tenantId, itemId: { in: ids } },
      orderBy: { itemId: 'asc' },
    });
    if (catalog.length !== ids.length) throw new BadRequestException('Складская позиция продажи не найдена');
    // Serialize movement and stock reads for the same product, including
    // concurrent retries of a single record's sale.
    for (const item of catalog as AnyRecord[]) {
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${item.id} FOR UPDATE`;
    }
    const byId = new Map((catalog as AnyRecord[]).map(row => [text(row.itemId), row]));
    const movements = await tx.inventoryMovement.findMany({
      where: { tenantId, sourceType, sourceId: recordId },
      include: { lines: { include: { item: true } } },
    });
    const previous = new Map<string, number>();
    const previousContainers = new Map<string, number>();
    for (const movement of movements as AnyRecord[]) {
      for (const line of movement.lines as AnyRecord[]) {
        const id = text(line.item?.itemId);
        if (!id) continue;
        const direction = line.direction === 'OUT' ? 1 : -1;
        previous.set(id, (previous.get(id) || 0) + direction * decimalNumber(line.quantity));
        previousContainers.set(id, (previousContainers.get(id) || 0) - Number(line.containerDelta || 0));
      }
    }
    const desired = new Map<string, number>();
    const desiredContainers = new Map<string, number>();
    for (const sale of requested) {
      const id = text(sale.inventoryItemId);
      const item = byId.get(id) as AnyRecord | undefined;
      if (!item)
        throw new BadRequestException('Товар не найден: ' + id);
      const amount = Number(sale.quantity);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new BadRequestException('Укажите количество продажи: ' + item.name);
      const requestedUnit = text(sale.unit) || text(item.saleUnit) || text(item.unit);
      if (item.saleUnit && requestedUnit !== text(item.saleUnit))
        throw new BadRequestException('Единица продажи изменилась. Откройте товар повторно.');
      let stockAmount: number;
      try {
        stockAmount = stockQuantityForUnit({
          unit: item.unit,
          packageQuantity: item.packageQuantity,
          netPackageWeight: item.grossWeight != null && item.tareWeight != null
            ? decimalNumber(item.grossWeight) - decimalNumber(item.tareWeight) : null,
          nominalQuantity: item.nominalQuantity, nominalUnit: item.nominalUnit,
          conversionRules: item.conversionRules,
        }, amount, requestedUnit);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Неверная единица продажи');
      }
      desired.set(id, (desired.get(id) || 0) + stockAmount);
      const physicalUnit = canonicalInventoryUnit(item.unit);
      if (['шт.', 'уп.'].includes(requestedUnit) && (physicalUnit === 'г' || physicalUnit === 'мл')) {
        desiredContainers.set(id, (desiredContainers.get(id) || 0) + amount);
      }
    }
    const saleLines: AnyRecord[] = [];
    const returnLines: AnyRecord[] = [];
    for (const id of ids) {
      const item = byId.get(id) as AnyRecord;
      const diff = Math.round(((desired.get(id) || 0) - (previous.get(id) || 0)) * 1000) / 1000;
      const countDiff = (desiredContainers.get(id) || 0) - (previousContainers.get(id) || 0);
      if (diff > EPSILON && (item.archivedAt || item.canSell !== true))
        throw new BadRequestException('Товар недоступен для продажи: ' + item.name);
      if (diff > EPSILON || countDiff > 0)
        saleLines.push({ itemId: id, quantity: Math.max(0, diff),
          ...(countDiff > 0 ? { containerDelta: -countDiff } : {}) });
      if (diff < -EPSILON || countDiff < 0)
        returnLines.push({ itemId: id, quantity: Math.max(0, -diff),
          ...(countDiff < 0 ? { containerDelta: -countDiff } : {}) });
    }
    if (!saleLines.length && !returnLines.length) return;
    // Reject negative stock before creating an outbound sale. Existing
    // manual movements retain their existing semantics.
    if (saleLines.length) {
      const internalIds = saleLines.map(line => (byId.get(line.itemId) as AnyRecord).id);
      const stockLines = await tx.inventoryMovementLine.findMany({
        where: { tenantId, inventoryItemId: { in: internalIds } },
      });
      const balances = new Map<string, number>();
      for (const line of stockLines as AnyRecord[]) {
        balances.set(line.inventoryItemId, (balances.get(line.inventoryItemId) || 0)
          + (line.direction === 'OUT' ? -1 : 1) * decimalNumber(line.quantity));
      }
      for (const line of saleLines) {
        const key = (byId.get(line.itemId) as AnyRecord).id;
        const amount = balances.get(key) || 0;
        const credit = returnLines.find(row => row.itemId === line.itemId)?.quantity || 0;
        if (amount + credit + EPSILON < line.quantity)
          throw new BadRequestException('Недостаточный остаток: ' + (byId.get(line.itemId) as AnyRecord).name);
      }
    }
    const metadata = {
      sourceType, sourceId: recordId, recordId, personKey: text(context.personKey),
      workplaceKey: text(context.workplaceKey),
    };
    // Restore before the additional sale so that corrections can be
    // applied without transient negative stock within one transaction.
    if (returnLines.length) await this.createMovementInTx(tx, tenantId, {
      ...metadata, kind: 'RETURN', lines: returnLines,
      note: 'Корректировка продажи по записи',
    }, { allowRecordSale: true });
    if (saleLines.length) await this.createMovementInTx(tx, tenantId, {
      ...metadata, kind: 'SALE', lines: saleLines,
      note: 'Продажа по записи',
    }, { allowRecordSale: true });
  }

  private async assertStorageLocations(tx: Tx, tenantId: string, locations: string[]) {
    const selected = [...new Set(locations.filter((id) => id && id !== PRIMARY_STORAGE))];
    if (!selected.length) return;
    const rows = await tx.inventoryStorageLocation.findMany({
      where: { tenantId, locationId: { in: selected }, archivedAt: null },
      select: { locationId: true },
    });
    if (rows.length !== selected.length) throw new BadRequestException('Место хранения не найдено или закрыто.');
  }

  private async storageBalanceInTx(tx: Tx, tenantId: string, inventoryItemId: string, locationId: string) {
    const rows = await tx.inventoryMovementLine.findMany({
      where: { tenantId, inventoryItemId, storageLocationId: locationId },
      select: { direction: true, quantity: true },
    });
    return rows.reduce((sum: number, row: AnyRecord) =>
      sum + (row.direction === 'OUT' ? -1 : 1) * decimalNumber(row.quantity), 0);
  }

  // Desired stock is planning metadata, never a physical movement. The effective
  // global target is either the manually declared total (at least the location
  // allocation sum) or the sum of individual locations, as explicitly selected.
  async updateStockTargets(tenantId: string, itemId: string, body: unknown) {
    const source = objectValue(body);
    const mode = text(source.mode);
    if (mode !== 'overall' && mode !== 'locations')
      throw new BadRequestException('Выберите расчёт: от общего или по складам.');
    if (!Array.isArray(source.locations) || source.locations.length > 100)
      throw new BadRequestException('Передайте распределение по складам.');
    const parseTarget = (raw: unknown): number | null => {
      if (raw == null || raw === '') return null;
      const numeric = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 999999999)
        throw new BadRequestException('Некорректный желаемый остаток.');
      return Math.round(numeric * 1000) / 1000;
    };
    const targets = new Map<string, number>();
    for (const value of source.locations) {
      const line = objectValue(value);
      const locationId = text(line.locationId);
      if (!locationId || targets.has(locationId))
        throw new BadRequestException('Повторяющееся или пустое место хранения.');
      if (line.targetStock == null || line.targetStock === '') continue;
      const amount = parseTarget(line.targetStock);
      if (amount == null) continue;
      targets.set(locationId, amount);
    }
    let manualTarget: number | null = null;
    if (mode === 'overall') {
      manualTarget = parseTarget(source.targetStock);
    }
    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT id FROM "InventoryItem"
        WHERE "tenantId" = ${tenantId} AND "itemId" = ${itemId} FOR UPDATE`;
      const item = await tx.inventoryItem.findFirst({
        where: { tenantId, itemId, archivedAt: null },
      });
      if (!item) throw new NotFoundException('Товар не найден.');
      await this.assertStorageLocations(tx, tenantId, [...targets.keys()]);
      const allocated = Math.round([...targets.values()]
        .reduce((total, value) => total + value, 0) * 1000) / 1000;
      const targetStock = mode === 'locations'
        ? targets.size ? allocated : null
        : manualTarget == null ? (targets.size ? allocated : null)
          : Math.max(manualTarget, allocated);
      if (item.minStock != null && targetStock != null &&
          targetStock <= decimalNumber(item.minStock))
        throw new BadRequestException('Желаемый остаток должен быть больше критического.');
      await tx.inventoryLocationTarget.deleteMany({ where: { tenantId, inventoryItemId: item.id } });
      if (targets.size) {
        await tx.inventoryLocationTarget.createMany({
          data: [...targets.entries()].map(([locationId, targetStock]) => ({
            tenantId, inventoryItemId: item.id, locationId, targetStock,
          })),
        });
      }
      await tx.inventoryItem.update({
        where: { id: item.id }, data: { targetStockMode: mode, targetStock },
      });
    }, { timeout: 20000 });
    return this.snapshot(tenantId);
  }

  async createStorageLocation(tenantId: string, body: unknown) {
    const source = objectValue(body);
    const name = text(source.name);
    if (!name || name.length > 120) throw new BadRequestException('Название места хранения: 1–120 символов.');
    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('inventory-storage'))) AS guard`;
      const locations = await tx.inventoryStorageLocation.findMany({ where: { tenantId, archivedAt: null } });
      if (name.toLocaleLowerCase('ru-RU') === 'основное'
        || locations.some((location: AnyRecord) =>
          location.name.toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU')))
        throw new BadRequestException('Такое место хранения уже существует.');
      await tx.inventoryStorageLocation.create({
        data: { tenantId, locationId: randomUUID(), name },
      });
    });
    return this.snapshot(tenantId);
  }

  async updateStorageLocation(tenantId: string, locationId: string, body: unknown) {
    if (!locationId || locationId === PRIMARY_STORAGE) throw new BadRequestException('Основное место нельзя изменять.');
    const source = objectValue(body);
    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('inventory-storage'))) AS guard`;
      const location = await tx.inventoryStorageLocation.findFirst({
        where: { tenantId, locationId, archivedAt: null },
      });
      if (!location) throw new NotFoundException('Место хранения не найдено.');
      if (source.archived === true) {
        const rows = await tx.inventoryMovementLine.findMany({ where: { tenantId, storageLocationId: locationId }, select: { inventoryItemId: true, direction: true, quantity: true } });
        const totals = new Map<string, number>();
        for (const row of rows as AnyRecord[]) totals.set(row.inventoryItemId, (totals.get(row.inventoryItemId) || 0)
          + (row.direction === 'OUT' ? -1 : 1) * decimalNumber(row.quantity));
        if ([...totals.values()].some((n) => Math.abs(n) > EPSILON))
          throw new BadRequestException('Нельзя закрыть место хранения с остатками.');
        const unfinished = await tx.inventoryResourceProgress.findFirst({ where: { tenantId, storageLocationId: locationId, progress: { gt: 0 } } });
        if (unfinished) throw new BadRequestException('Здесь есть незавершённый ресурс использования.');
        await tx.inventoryStorageLocation.update({ where: { id: location.id }, data: { archivedAt: new Date() } });
      } else if ('name' in source) {
        const name = text(source.name);
        if (!name || name.length > 120) throw new BadRequestException('Название места хранения: 1–120 символов.');
        const duplicates = await tx.inventoryStorageLocation.findMany({ where: { tenantId, archivedAt: null } });
        if (name.toLocaleLowerCase('ru-RU') === 'основное'
          || duplicates.some((other: AnyRecord) => other.id !== location.id
            && other.name.toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU')))
          throw new BadRequestException('Такое место хранения уже существует.');
        await tx.inventoryStorageLocation.update({ where: { id: location.id }, data: { name } });
      }
    });
    return this.snapshot(tenantId);
  }

  // One atomic move; paired storage lines cancel globally and do not touch FIFO lots.
  async transferStock(tenantId: string, body: unknown) {
    const source = objectValue(body);
    const from = text(source.fromLocationId) || PRIMARY_STORAGE;
    const to = text(source.toLocationId) || PRIMARY_STORAGE;
    const requested = Array.isArray(source.lines) ? source.lines.map(objectValue) : [];
    const assignmentItemIds = Array.isArray(source.assignmentItemIds)
      ? source.assignmentItemIds.map(text) : [];
    if (!requested.length && !assignmentItemIds.length)
      throw new BadRequestException('Выберите позиции для перемещения.');
    if (requested.length > 500 || assignmentItemIds.length > 500)
      throw new BadRequestException('За один раз можно выбрать не более 500 позиций.');
    if (assignmentItemIds.some(id => !id) ||
        new Set(assignmentItemIds).size !== assignmentItemIds.length)
      throw new BadRequestException('Некорректный список выбранных товаров.');
    if (requested.length && from === to)
      throw new BadRequestException('Выберите другое место хранения.');
    const movementId = text(source.transferId) || randomUUID();
    await this.prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.inventoryMovement.findFirst({ where: { tenantId, movementId } });
      if (existing) {
        if (existing.kind === 'TRANSFER') return;
        throw new BadRequestException('Идентификатор движения уже используется.');
      }
      await this.assertStorageLocations(tx, tenantId, [from, to]);
      const movementIds = requested.map((row: AnyRecord) => text(row.itemId));
      if (movementIds.some(id => !id) || new Set(movementIds).size !== movementIds.length)
        throw new BadRequestException('Товар нельзя повторять в одной операции.');
      const ids = [...new Set([...movementIds, ...assignmentItemIds])].sort();
      const items = await tx.inventoryItem.findMany({ where: { tenantId, itemId: { in: ids }, archivedAt: null } });
      if (items.length !== ids.length) throw new BadRequestException('Одна из позиций переноса не найдена.');
      const byId = new Map((items as AnyRecord[]).map((item) => [item.itemId, item]));
      const quantities = new Map<string, number>();
      const physicalQuantities = new Map<string, number>();
      for (const item of (items as AnyRecord[]).sort((a, b) => String(a.id).localeCompare(String(b.id))))
        await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${item.id} FOR UPDATE`;
      // Assigning a zero-stock card changes catalog availability, not grams.
      for (const itemId of assignmentItemIds) {
        const item = byId.get(itemId) as AnyRecord;
        const existing = Array.isArray(item.storageLocationIds)
          ? item.storageLocationIds.filter((id: unknown) => typeof id === 'string') : [];
        if (!existing.includes(to)) {
          await tx.inventoryItem.update({
            where: { id: item.id },
            data: { storageLocationIds: [...existing, to] },
          });
        }
      }
      if (!requested.length) return;
      for (const row of requested) {
        const itemId = text(row.itemId);
        const item = byId.get(itemId) as AnyRecord;
        const full = row.fullBalance === true;
        const quantity = full ? 0 : Number(String(row.quantity ?? '').replace(',', '.'));
        if (!full && (!Number.isFinite(quantity) || quantity <= 0))
          throw new BadRequestException('Количество переноса должно быть положительным.');
        let stock: number;
        if (full) {
          stock = await this.storageBalanceInTx(tx, tenantId, item.id, from);
          if (!(stock > EPSILON)) throw new BadRequestException('Нет остатка для переноса: ' + item.name);
          // A full move includes the actual number of containers recorded at
          // this source. Do not infer tubes from grams or nominal size.
          const physical = await tx.inventoryMovementLine.findMany({
            where: { tenantId, inventoryItemId: item.id, storageLocationId: from },
            select: { containerDelta: true },
          });
          const count = (physical as AnyRecord[]).reduce((total: number, line: AnyRecord) =>
            total + (line.containerDelta == null ? 0 : Number(line.containerDelta)), 0);
          if (count < 0) throw new BadRequestException('Исправьте учёт упаковок перед переносом: ' + item.name);
          if (count > 0) physicalQuantities.set(itemId, count);
        } else {
          try {
            stock = stockQuantityForUnit({ unit: item.unit, packageQuantity: item.packageQuantity,
              netPackageWeight: item.grossWeight != null && item.tareWeight != null
                ? decimalNumber(item.grossWeight) - decimalNumber(item.tareWeight) : null,
              nominalQuantity: item.nominalQuantity, nominalUnit: item.nominalUnit,
              conversionRules: item.conversionRules }, quantity, row.unit || item.unit);
          } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Единица переноса'); }
        }
        quantities.set(itemId, (quantities.get(itemId) || 0) + stock);
        // A weighed tube transferred by 'шт.' has two independent dimensions:
        // its usable grams/ml and the exact number of physical containers.
        if (!full && ['г','мл'].includes(canonicalInventoryUnit(item.unit) || '') &&
            canonicalInventoryUnit(row.unit || item.unit) === 'шт.') {
          if (!Number.isSafeInteger(quantity))
            throw new BadRequestException('Тюбики переносятся целыми штуками.');
          physicalQuantities.set(itemId, (physicalQuantities.get(itemId) || 0) + quantity);
        }
      }
      for (const [itemId, quantity] of quantities) {
        const item = byId.get(itemId) as AnyRecord;
        const available = await this.storageBalanceInTx(tx, tenantId, item.id, from);
        if (quantity > available + EPSILON) throw new BadRequestException('Недостаточный остаток для переноса: ' + item.name);
      }
      for (const [itemId, containers] of physicalQuantities) {
        const item = byId.get(itemId) as AnyRecord;
        const prior = await tx.inventoryMovementLine.findMany({
          where: { tenantId, inventoryItemId: item.id, storageLocationId: from },
          select: { containerDelta: true },
        });
        const available = (prior as AnyRecord[]).reduce((sum: number, line: AnyRecord) =>
          sum + (line.containerDelta == null ? 0 : Number(line.containerDelta)), 0);
        if (containers > available)
          throw new BadRequestException('Недостаточно целых тюбиков на исходном складе.');
      }
      const movement = await tx.inventoryMovement.create({ data: {
        tenantId, movementId, kind: 'TRANSFER', status: 'completed',
        sourceType: 'inventory-storage-transfer', sourceId: movementId,
        note: optionalText(source.note), occurredAt: optionalDate(source.occurredAt, 'Дата переноса') || new Date(),
      } });
      let position = 0;
      for (const [itemId, quantity] of quantities) {
        const item = byId.get(itemId) as AnyRecord;
        for (const [direction, locationId] of [['OUT', from], ['IN', to]] as const) {
          await tx.inventoryMovementLine.create({ data: {
            tenantId, inventoryMovementId: movement.id, inventoryItemId: item.id,
            lineId: randomUUID(), position: position++, direction, storageLocationId: locationId,
            quantity: Math.round(quantity * 1000) / 1000, costKnown: false, unitCost: 0, amount: 0,
            containerDelta: physicalQuantities.has(itemId)
              ? (direction === 'OUT' ? -1 : 1) * (physicalQuantities.get(itemId) || 0) : null,
            note: '',
          } });
        }
      }
    }, { maxWait: 10000, timeout: 120000 });
    return this.snapshot(tenantId);
  }

  // Use can be counted in procedures, cycles, hours or distance. A disposable
  // unit is removed only on resource exhaustion; equipment can request review.
  async recordResourceUse(tenantId: string, body: unknown) {
    const source = objectValue(body);
    const itemId = text(source.itemId);
    const locationId = text(source.storageLocationId) || PRIMARY_STORAGE;
    const eventId = text(source.eventId) || randomUUID();
    const amount = optionalPositive(source.quantity, 'Количество использования');
    if (!itemId || amount == null) throw new BadRequestException('Укажите позицию и количество использования.');
    await this.prisma.$transaction(async (tx: Tx) => {
      const old = await tx.inventoryResourceEvent.findFirst({ where: { tenantId, eventId } });
      if (old) return;
      await this.assertStorageLocations(tx, tenantId, [locationId]);
      const item = await tx.inventoryItem.findFirst({ where: { tenantId, itemId, archivedAt: null } });
      if (!item) throw new NotFoundException('Позиция склада не найдена.');
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${item.id} FOR UPDATE`;
      const limit = Number(item.resourceLimit);
      if (!(limit > 0) || !item.resourceUnit) throw new BadRequestException('Сначала настройте ресурс в карточке товара.');
      const progress = await tx.inventoryResourceProgress.findUnique({
        where: { tenantId_inventoryItemId_storageLocationId: { tenantId, inventoryItemId: item.id, storageLocationId: locationId } },
      });
      const before = progress ? decimalNumber(progress.progress) : 0;
      const next = before + amount;
      const action = item.resourceExhaustionAction || 'REVIEW';
      const units = action === 'WRITE_OFF' ? Math.floor((next + EPSILON) / limit) : 0;
      const remaining = action === 'WRITE_OFF' ? Math.max(0, next - units * limit) : next;
      const stockAmount = Number(item.resourceStockQuantity ?? 1);
      const available = await this.storageBalanceInTx(tx, tenantId, item.id, locationId);
      if (available + EPSILON < Math.max(units * stockAmount, stockAmount))
        throw new BadRequestException('Недостаточно товара для использования в выбранном месте хранения.');
      let writeOffMovementId: string | null = null;
      if (units) {
        const movement = await this.createMovementInTx(tx, tenantId, {
          kind: 'WRITE_OFF', sourceType: 'inventory-resource-usage', sourceId: eventId,
          occurredAt: source.occurredAt,
          note: 'Списание по исчерпанию ресурса',
          lines: [{ itemId, quantity: Math.round(units * stockAmount * 1000) / 1000,
            storageLocationId: locationId, note: 'Использование: ' + String(amount) + ' ' + item.resourceUnit }],
        });
        writeOffMovementId = movement.movementId;
      }
      await tx.inventoryResourceProgress.upsert({
        where: { tenantId_inventoryItemId_storageLocationId: { tenantId, inventoryItemId: item.id, storageLocationId: locationId } },
        create: { tenantId, inventoryItemId: item.id, storageLocationId: locationId, progress: Math.round(remaining * 1000) / 1000 },
        update: { progress: Math.round(remaining * 1000) / 1000 },
      });
      await tx.inventoryResourceEvent.create({ data: {
        tenantId, eventId, inventoryItemId: item.id, storageLocationId: locationId,
        quantity: amount, resourceUnit: item.resourceUnit, writeOffMovementId,
        note: optionalText(source.note), occurredAt: optionalDate(source.occurredAt, 'Дата использования') || new Date(),
      } });
    });
    return this.snapshot(tenantId);
  }
  async createMovement(tenantId: string, body: unknown) {
    await this.prisma.$transaction(async (tx: Tx) => {
      await this.createMovementInTx(tx, tenantId, objectValue(body));
    });
    return this.snapshot(tenantId);
  }

  async createMovements(tenantId: string, bodies: unknown[]) {
    const sources = (Array.isArray(bodies) ? bodies : []).map(objectValue);
    if (!sources.length) return this.snapshot(tenantId);
    await this.prisma.$transaction(async (tx: Tx) => {
      for (const source of sources) await this.createMovementInTx(tx, tenantId, source);
    });
    return this.snapshot(tenantId);
  }

  async correctMovement(tenantId: string, movementId: string, body: unknown) {
    const source = objectValue(body);
    const original = await this.prisma.inventoryMovement.findFirst({
      where: { tenantId, movementId },
      include: { lines: { include: { item: true } } },
    });
    if (!original) throw new NotFoundException('Движение не найдено');
    // A received purchase is a finalized order fact. A generic correction
    // must not silently desynchronize its saved quantities from its receipt.
    if (original.kind === 'TRANSFER') throw new BadRequestException('Перенос между местами нельзя корректировать обычной корректировкой.');
    if (original.lines.some((line: AnyRecord) => (line.storageLocationId || PRIMARY_STORAGE) !== PRIMARY_STORAGE))
      throw new BadRequestException('Движение по месту хранения исправляется отдельным компенсирующим движением.');
    if (original.sourceType === 'inventory-purchase-order') {
      throw new BadRequestException('Приход полученного заказа нельзя исправлять отдельно от заказа');
    }
    // A physically counted stocktake is an absolute observation. Editing it
    // retroactively would silently invalidate later tube receipts/stocktakes.
    if (original.lines.some((line: AnyRecord) => line.actualContainerCount != null)) {
      throw new BadRequestException('Физическую инвентаризацию корректируйте новой инвентаризацией.');
    }

    const desired = normalizedMovementLines(original.kind, source.lines);
    if (!desired.length) throw new BadRequestException('В корректировке нет позиций');
    const desiredItems = await this.prisma.inventoryItem.findMany({
      where: { tenantId, itemId: { in: desired.map(line => line.itemId) }, archivedAt: null },
    });
    applyMovementQuantityUnits(desired, desiredItems as AnyRecord[]);

    const currentByItem = new Map<string, { signed: number; unitCost: number; containers: number }>();
    (original.lines as AnyRecord[]).forEach((line) => {
      const itemId = String(line.item?.itemId || '');
      const signed = line.direction === 'OUT' ? -decimalNumber(line.quantity) : decimalNumber(line.quantity);
      const row = currentByItem.get(itemId) || { signed: 0, unitCost: decimalNumber(line.unitCost), containers: 0 };
      row.signed += signed;
      row.containers += line.containerDelta == null ? 0 : Number(line.containerDelta);
      if (!row.unitCost) row.unitCost = decimalNumber(line.unitCost);
      currentByItem.set(itemId, row);
    });

    const desiredByItem = new Map<string, { signed: number; unitCost: number | null; containers: number }>();
    desired.forEach((line) => {
      const signed = line.direction === 'OUT' ? -line.quantity : line.quantity;
      const row = desiredByItem.get(line.itemId) || { signed: 0, unitCost: line.unitCost, containers: 0 };
      row.signed += signed;
      row.containers += line.containerDelta == null ? 0 : line.containerDelta;
      if (row.unitCost == null && line.unitCost != null) row.unitCost = line.unitCost;
      desiredByItem.set(line.itemId, row);
    });

    const itemIds = new Set([...currentByItem.keys(), ...desiredByItem.keys()]);
    const deltaLines: AnyRecord[] = [];
    itemIds.forEach((itemId) => {
      const before = currentByItem.get(itemId)?.signed || 0;
      const after = desiredByItem.get(itemId)?.signed || 0;
      const delta = after - before;
      const containerDelta = (desiredByItem.get(itemId)?.containers || 0) - (currentByItem.get(itemId)?.containers || 0);
      if (Math.abs(delta) < EPSILON && containerDelta === 0) return;
      deltaLines.push({
        itemId,
        quantity: delta,
        ...(containerDelta !== 0 ? { containerDelta } : {}),
        unitCost: delta > 0
          ? (desiredByItem.get(itemId)?.unitCost ?? currentByItem.get(itemId)?.unitCost ?? null)
          : null,
      });
    });
    if (!deltaLines.length) return this.snapshot(tenantId);

    await this.prisma.$transaction(async (tx: Tx) => {
      await this.createMovementInTx(tx, tenantId, {
        kind: 'CORRECTION',
        sourceType: 'inventory-correction',
        sourceId: movementId,
        originalMovementId: movementId,
        personKey: original.personKey,
        personUei: original.personUei,
        recordId: original.recordId,
        procedureKey: original.procedureKey,
        workplaceKey: original.workplaceKey,
        occurredAt: source.occurredAt || original.occurredAt,
        note: optionalText(source.note) || 'Корректировка движения',
        lines: deltaLines,
      });
    });

    return this.snapshot(tenantId);
  }

  async resolveTransferredItem(tenantId: string, input: AnyRecord, tx: Tx) {
    const rows = await tx.inventoryItem.findMany({ where: { tenantId, archivedAt: null,
      ...(text(input.itemId) ? { itemId: text(input.itemId) } : { name: text(input.material || input.name) }) } });
    const matches = rows.filter((row: AnyRecord) => (!input.manufacturer || row.manufacturer === text(input.manufacturer)) && (!input.unit || row.unit === text(input.unit)));
    if (matches.length !== 1) throw new BadRequestException('Не удалось однозначно определить позицию склада');
    return matches[0];
  }

  async importOffer(tenantId:string,input:AnyRecord,targetId:string,tx:Tx) {
    const item=await this.resolveTransferredItem(tenantId,input,tx);if(!text(input.supplier))throw new BadRequestException('Не указан поставщик');
    const existing=await tx.inventorySupplierOffer.findMany({where:{tenantId,inventoryItemId:item.id,supplier:text(input.supplier)}});
    if(!targetId&&existing.length>1)throw new BadRequestException('Не удалось однозначно определить предложение поставщика');
    const offerId=targetId || existing[0]?.offerId || randomUUID();
    const data={inventoryItemId:item.id,supplier:text(input.supplier),...(input.listPrice!==undefined?{listPrice:input.listPrice}:{}),...(input.actualPrice!==undefined?{actualPrice:input.actualPrice}:{}),...(input.supplierDiscount!==undefined?{discountPercent:input.supplierDiscount}:{}),...(input.supplierSku!==undefined?{supplierSku:text(input.supplierSku)}:{}),note:text(input.note)};
    await tx.inventorySupplierOffer.upsert({where:{tenantId_offerId:{tenantId,offerId}},create:{tenantId,offerId,...data},update:data});return offerId;
  }

  async importItem(tenantId: string, input: AnyRecord, targetId: string, tx: Tx) {
    if (!text(input.name) || !text(input.unit)) throw new BadRequestException('Не указано наименование или единица склада');
    const matches = !targetId && !input.itemId ? await tx.inventoryItem.findMany({ where: { tenantId, archivedAt: null,
      name: text(input.name), unit: text(input.unit), ...(input.manufacturer ? { manufacturer: text(input.manufacturer) } : {}) } }) : [];
    if (matches.length > 1) throw new BadRequestException('Не удалось однозначно определить позицию склада');
    const itemId = targetId || text(input.itemId) || matches[0]?.itemId || randomUUID();
    const existing = await tx.inventoryItem.findFirst({ where: { tenantId, itemId } });
    if (targetId && !existing) throw new NotFoundException('Перенесённая позиция склада не найдена');
    if (existing) await this.updateItem(tenantId, itemId, input, tx);
    else await this.createItem(tenantId, { ...input, itemId, quantity: 0 }, tx);
    return itemId;
  }

  async importMovement(tenantId: string, input: AnyRecord, targetId: string, tx: Tx, initialStock = false) {
    const movementId = targetId || randomUUID();
    const item = await this.resolveTransferredItem(tenantId, input, tx);
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('Количество имеет неверный формат');
    if (!input.occurredAt) throw new BadRequestException('Не указана дата складского движения');
    const existing = await tx.inventoryMovement.findFirst({ where: { tenantId, movementId }, include: { lines: true } });
    const raw = { ...input, movementId, historicalTransfer: true, lines: [{ itemId: item.itemId, quantity,
      unitCost: input.unitCost, listPrice: input.listPrice, discountPercent: input.discountPercent, supplier: input.supplier, direction:input.direction, expectedQuantity:input.expectedQuantity,actualQuantity:input.actualQuantity, containerDelta:input.containerDelta, expectedContainerCount:input.expectedContainerCount, actualContainerCount:input.actualContainerCount }] };
    if (!existing) {
      if (targetId && !initialStock) throw new NotFoundException('Перенесённое складское движение не найдено');
      await this.createMovementInTx(tx, tenantId, raw);
    } else {
      if (existing.lines.length !== 1 || existing.lines[0].inventoryItemId !== item.id || existing.kind !== input.kind) throw new BadRequestException('Позиция или тип движения не совпадает с ID переноса');
      const line = existing.lines[0];
      const known = input.unitCost != null;
      const allocations = await tx.inventoryMovementAllocation.findMany({ where: { inventoryMovementLineId: line.id } });
      await tx.inventoryMovement.update({ where: { id: existing.id }, data: { occurredAt: new Date(input.occurredAt),
        personKey: text(input.personKey), personUei: text(input.personUei), recordId: text(input.recordId),
        procedureKey: text(input.procedureKey), workplaceKey: text(input.workplaceKey), note: text(input.note) } });
      await tx.inventoryMovementLine.update({ where: { id: line.id }, data: { quantity, costKnown: known, unitCost: input.unitCost ?? 0, amount: quantity * (input.unitCost ?? 0) } });
      if (line.direction === 'IN') for (const allocation of allocations) {
        const lot = await tx.inventoryLot.findUnique({ where: { id: allocation.inventoryLotId } });
        await tx.inventoryMovementAllocation.update({ where: { id: allocation.id }, data: { quantity, unitCost: input.unitCost ?? 0, amount: quantity * (input.unitCost ?? 0) } });
        if (lot) await tx.inventoryLot.update({ where: { id: lot.id }, data: { quantityReceived: quantity,
          quantityRemaining: Math.max(0, Number(lot.quantityRemaining) + quantity - Number(line.quantity)),
          costKnown: known, unitCost: input.unitCost ?? 0, receivedAt: new Date(input.occurredAt) } });
      }
    }
    await this.rebuildItemCostingInTx(tx,tenantId,item.id,true);
    return movementId;
  }

  private async maxKnownUnitCostInTx(tx: Tx, tenantId: string, inventoryItemId: string, fallback: number) {
    const [lots, offers] = await Promise.all([
      tx.inventoryLot.findMany({
        where: { tenantId, inventoryItemId },
        select: { unitCost: true },
      }),
      tx.inventorySupplierOffer.findMany({
        where: { tenantId, inventoryItemId, isActive: true },
        select: { actualPrice: true, listPrice: true, discountPercent: true },
      }),
    ]);

    let maximum = Math.max(0, fallback);
    for (const lot of lots as AnyRecord[]) maximum = Math.max(maximum, decimalNumber(lot.unitCost));
    for (const offer of offers as AnyRecord[]) {
      const listPrice = offer.listPrice == null ? null : decimalNumber(offer.listPrice);
      const discount = offer.discountPercent == null ? null : decimalNumber(offer.discountPercent);
      const actual = offer.actualPrice == null ? null : decimalNumber(offer.actualPrice);
      const effective = actual ?? (listPrice == null ? null : listPrice * (1 - (discount ?? 0) / 100));
      if (effective != null) maximum = Math.max(maximum, effective);
    }
    return maximum;
  }

  private async rebuildItemCostingInTx(tx: Tx, tenantId: string, inventoryItemId: string, preserveCosts = false) {
    const item = await tx.inventoryItem.findFirst({ where: { tenantId, id: inventoryItemId } });
    if (!item) return;

    const lines = await tx.inventoryMovementLine.findMany({
      where: { tenantId, inventoryItemId, movement: { kind: { not: 'TRANSFER' } } },
    });
    if (!lines.length) return;

    const movementIds = [...new Set((lines as AnyRecord[]).map((line) => line.inventoryMovementId))];
    const lineIds = (lines as AnyRecord[]).map((line) => line.id);
    const [movements, lots, allocations] = await Promise.all([
      tx.inventoryMovement.findMany({
        where: { tenantId, id: { in: movementIds } },
        select: { id: true, occurredAt: true, createdAt: true },
      }),
      tx.inventoryLot.findMany({
        where: { tenantId, inventoryItemId },
        orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.inventoryMovementAllocation.findMany({
        where: { tenantId, inventoryMovementLineId: { in: lineIds } },
      }),
    ]);

    const movementById = new Map((movements as AnyRecord[]).map((movement) => [movement.id, movement]));
    const lineById = new Map((lines as AnyRecord[]).map((line) => [line.id, line]));
    const lotById = new Map((lots as AnyRecord[]).map((lot) => [lot.id, lot]));
    const inboundLotByLine = new Map<string, string>();
    for (const allocation of allocations as AnyRecord[]) {
      const line = lineById.get(allocation.inventoryMovementLineId) as AnyRecord | undefined;
      if (line?.direction === 'IN') inboundLotByLine.set(line.id, allocation.inventoryLotId);
    }

    const outLineIds = (lines as AnyRecord[])
      .filter((line) => line.direction === 'OUT')
      .map((line) => line.id);
    if (outLineIds.length) {
      await tx.inventoryMovementAllocation.deleteMany({
        where: { tenantId, inventoryMovementLineId: { in: outLineIds } },
      });
    }

    const remainingByLot = new Map<string, number>();
    for (const lot of lots as AnyRecord[]) remainingByLot.set(lot.id, 0);

    const maxKnownUnitCost = await this.maxKnownUnitCostInTx(
      tx,
      tenantId,
      inventoryItemId,
      decimalNumber(item.lastPurchasePrice),
    );

    const chronological = [...(lines as AnyRecord[])].sort((left, right) => {
      const leftMovement = movementById.get(left.inventoryMovementId) as AnyRecord;
      const rightMovement = movementById.get(right.inventoryMovementId) as AnyRecord;
      const byFact = compareDates(leftMovement.occurredAt, rightMovement.occurredAt);
      if (byFact !== 0) return byFact;
      if (left.direction !== right.direction) return left.direction === 'IN' ? -1 : 1;
      const byAudit = compareDates(leftMovement.createdAt, rightMovement.createdAt);
      if (byAudit !== 0) return byAudit;
      const byPosition = Number(left.position || 0) - Number(right.position || 0);
      return byPosition !== 0 ? byPosition : String(left.id).localeCompare(String(right.id));
    });

    for (const line of chronological) {
      if (line.direction === 'IN') {
        const lotId = inboundLotByLine.get(line.id);
        const lot = lotId ? lotById.get(lotId) as AnyRecord | undefined : undefined;
        if (lot) remainingByLot.set(lot.id, decimalNumber(lot.quantityReceived));
        continue;
      }

      let remaining = decimalNumber(line.quantity);
      let totalCost = 0;
      const movement = movementById.get(line.inventoryMovementId) as AnyRecord;
      const eligibleLots = (lots as AnyRecord[]).filter((lot) => {
        const available = remainingByLot.get(lot.id) || 0;
        return available > EPSILON && compareDates(lot.receivedAt, movement.occurredAt) <= 0;
      });

      for (const lot of eligibleLots) {
        if (remaining <= EPSILON) break;
        const available = remainingByLot.get(lot.id) || 0;
        const quantity = Math.min(remaining, available);
        const unitCost = decimalNumber(lot.unitCost);
        await tx.inventoryMovementAllocation.create({
          data: {
            tenantId,
            inventoryMovementLineId: line.id,
            inventoryLotId: lot.id,
            allocationId: randomUUID(),
            quantity,
            unitCost,
            amount: quantity * unitCost,
          },
        });
        remainingByLot.set(lot.id, available - quantity);
        totalCost += quantity * unitCost;
        remaining -= quantity;
      }

      if (remaining > EPSILON) totalCost += remaining * maxKnownUnitCost;
      const quantity = decimalNumber(line.quantity);
      const unitCost = quantity > 0 ? totalCost / quantity : 0;
      if(!preserveCosts) await tx.inventoryMovementLine.update({
        where: { id: line.id },
        data: { unitCost, amount: totalCost },
      });
    }

    for (const lot of lots as AnyRecord[]) {
      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: { quantityRemaining: Math.max(0, remainingByLot.get(lot.id) || 0) },
      });
    }

    const latestLot = [...(lots as AnyRecord[])].sort((left, right) => {
      const byFact = compareDates(right.receivedAt, left.receivedAt);
      if (byFact !== 0) return byFact;
      return compareDates(right.createdAt, left.createdAt);
    })[0];
    if (latestLot && !preserveCosts) {
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: { lastPurchasePrice: decimalNumber(latestLot.unitCost) },
      });
    }
  }

  private async createMovementInTx(tx: Tx, tenantId: string, raw: AnyRecord,
    options: { allowPurchaseOrderReceipt?: boolean; allowRecordSale?: boolean; allowSupplierReturn?: boolean } = {}) {
    // The generic movement endpoint cannot impersonate a purchase receipt.
    // The Purchase Order owner alone authorizes this source in its transaction.
    if (text(raw.sourceType) === 'inventory-purchase-order' && !options.allowPurchaseOrderReceipt) {
      throw new BadRequestException('Приход по заказу создаётся только при получении заказа');
    }
    if (text(raw.kind) === 'SUPPLIER_RETURN' && !options.allowSupplierReturn)
      throw new BadRequestException('Возврат поставщику оформляется только из полученного заказа.');
    if (text(raw.sourceType) === 'record-sale' && !options.allowRecordSale) {
      throw new BadRequestException('Продажа из записи создаётся только при сохранении записи');
    }
    const kind = text(raw.kind).toUpperCase();
    if (!MOVEMENT_KINDS.has(kind)) throw new BadRequestException('Неизвестный тип складского движения');
    const lines = normalizedMovementLines(kind, raw.lines);
    if (!lines.length) throw new BadRequestException('Добавьте хотя бы одну позицию');

    const requestedIds = [...new Set(lines.map((line) => line.itemId))];
    const items = await tx.inventoryItem.findMany({
      where: { tenantId, itemId: { in: requestedIds },
        // Allow an original record sale to be returned after product archiving.
        ...(options.allowRecordSale && kind === 'RETURN' ? {} : { archivedAt: null }) },
    });
    const itemById = new Map((items as AnyRecord[]).map((item) => [item.itemId, item]));
    if (itemById.size !== requestedIds.length) throw new BadRequestException('Одна из позиций склада не найдена');
    applyMovementQuantityUnits(lines, items as AnyRecord[]);
    await this.assertStorageLocations(tx, tenantId, lines.map((line) => line.storageLocationId));
    // Protect named locations against negative stock, including multiple lines
    // for the same item in one movement. Legacy primary behaviour is unchanged.
    const outByLocation = new Map<string, number>();
    for (const line of lines) if (line.direction === 'OUT' && line.storageLocationId !== PRIMARY_STORAGE) {
      const item = itemById.get(line.itemId) as AnyRecord;
      const key = item.id + ':' + line.storageLocationId;
      outByLocation.set(key, (outByLocation.get(key) || 0) + line.quantity);
    }
    for (const [key, outgoing] of outByLocation) {
      const index = key.indexOf(':');
      const itemId = key.slice(0, index);
      const locationId = key.slice(index + 1);
      const available = await this.storageBalanceInTx(tx, tenantId, itemId, locationId);
      if (outgoing > available + EPSILON) throw new BadRequestException('Недостаточный остаток в месте хранения.');
    }

    const selectedOfferIds = [...new Set(lines
      .filter((line) => line.direction === 'IN' && line.offerId && !raw.historicalTransfer)
      .map((line) => line.offerId))];
    const selectedOffers = selectedOfferIds.length ? await tx.inventorySupplierOffer.findMany({
      where: { tenantId, isActive: true, offerId: { in: selectedOfferIds } },
    }) : [];
    const offerById = new Map((selectedOffers as AnyRecord[]).map((offer) => [offer.offerId, offer]));

    // Check expected gram balances inside the same transaction before
    // adjusting either grams or physical tubes (not only in the UI).
    if (kind === 'ADJUSTMENT' && lines.some(line => line.expectedQuantity !== null)) {
      const previous = await tx.inventoryMovementLine.findMany({
        where: { tenantId, inventoryItemId: { in: items.map((item: AnyRecord) => item.id) } },
        select: { inventoryItemId: true, direction: true, quantity: true },
      });
      const totals = new Map<string, number>();
      for (const row of previous as AnyRecord[]) {
        const amount = (row.direction === 'OUT' ? -1 : 1) * decimalNumber(row.quantity);
        totals.set(row.inventoryItemId, (totals.get(row.inventoryItemId) || 0) + amount);
      }
      for (const line of lines) {
        if (line.expectedQuantity === null) continue;
        const item = itemById.get(line.itemId) as AnyRecord;
        if (Math.abs((totals.get(item.id) || 0) - line.expectedQuantity) > EPSILON)
          throw new BadRequestException('Учётные граммы изменились. Повторите инвентаризацию.');
      }
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        tenantId,
        movementId: text(raw.movementId) || randomUUID(),
        kind,
        status: 'completed',
        sourceType: optionalText(raw.sourceType),
        sourceId: optionalText(raw.sourceId),
        originalMovementId: optionalText(raw.originalMovementId),
        personKey: optionalText(raw.personKey),
        personUei: optionalText(raw.personUei),
        recordId: optionalText(raw.recordId),
        procedureKey: optionalText(raw.procedureKey),
        workplaceKey: optionalText(raw.workplaceKey),
        note: optionalText(raw.note),
        occurredAt: dateValue(raw.occurredAt),
      },
    });

    const affectedInternalIds = new Set<string>();
    for (let position = 0; position < lines.length; position += 1) {
      const line = lines[position];
      const item = itemById.get(line.itemId) as AnyRecord;
      // Count is a separately audited physical dimension. For an unknown legacy
      // count, a delta alone must never invent a total number of containers.
      const beforeContainers = item.containerCount == null ? null : Number(item.containerCount);
      let nextContainers = beforeContainers;
      let containerDelta = line.containerDelta;
      if (containerDelta !== null && line.actualContainerCount === null) {
        if (kind === 'RECEIPT' && containerDelta < 0) throw new BadRequestException('Приход не может уменьшать число тюбиков.');
        if (['CONSUMPTION', 'SALE', 'WRITE_OFF'].includes(kind) && containerDelta > 0)
          throw new BadRequestException('Расход не может увеличивать число тюбиков.');
      }
      if (kind === 'ADJUSTMENT' && line.actualContainerCount !== null) {
        if (line.expectedContainerCount !== beforeContainers)
          throw new BadRequestException('Количество тюбиков изменилось. Повторите инвентаризацию.');
        nextContainers = line.actualContainerCount;
        containerDelta = beforeContainers === null ? null : nextContainers - beforeContainers;
      } else if (line.actualContainerCount !== null) {
        throw new BadRequestException('Фактическое число тюбиков задаётся только инвентаризацией.');
      } else if (containerDelta !== null && beforeContainers !== null) {
        nextContainers = beforeContainers + containerDelta;
        if (nextContainers < 0) throw new BadRequestException('Нельзя списать больше тюбиков, чем числится.');
      }
      if (nextContainers !== beforeContainers) {
        await tx.inventoryItem.update({ where: { id: item.id }, data: { containerCount: nextContainers } });
        item.containerCount = nextContainers;
      }
      const physical = {
        containerDelta,
        expectedContainerCount: kind === 'ADJUSTMENT' && line.actualContainerCount !== null
          ? beforeContainers : line.expectedContainerCount,
        actualContainerCount: line.actualContainerCount,
      };
      if (line.quantity === 0) {
        // Tube-only stocktake changes no mass, lot, purchase cost, or allocation.
        await tx.inventoryMovementLine.create({ data: {
          tenantId, inventoryMovementId: movement.id, inventoryItemId: item.id,
          lineId: randomUUID(), position, direction: line.direction,
          quantity: 0, costKnown: false, unitCost: 0, amount: 0,
          expectedQuantity: line.expectedQuantity, actualQuantity: line.actualQuantity,
          storageLocationId: line.storageLocationId,
          ...physical, note: line.note,
        } });
        continue;
      }
      affectedInternalIds.add(item.id);

      if (line.direction === 'IN') {
        const offer = line.offerId && !raw.historicalTransfer ? offerById.get(line.offerId) : null;
        if (line.offerId && !raw.historicalTransfer && (!offer || offer.inventoryItemId !== item.id)) {
          throw new BadRequestException('Предложение не принадлежит выбранному продукту');
        }
        // Purchase quantities and costs are always expressed in this item's stock unit.
        // User-supplied actual cost wins; the selected offer supplies only a default.
        const offerUnitPrice = offer ? supplierOfferUnitPrice(offer) : null;
        const unitCost = line.unitCost ?? offerUnitPrice ?? (raw.historicalTransfer ? 0 : decimalNumber(item.lastPurchasePrice));
        const packSize = offer?.unitsPerOffer == null ? null : decimalNumber(offer.unitsPerOffer);
        const offeredListPrice = offer?.listPrice == null || packSize == null || packSize <= 0
          ? null : decimalNumber(offer.listPrice) / packSize;
        const lotListPrice = line.listPrice ?? offeredListPrice;
        const lotDiscount = line.discountPercent ?? (offer?.discountPercent == null ? null : decimalNumber(offer.discountPercent));
        const lotSupplier = line.supplier || offer?.supplier || optionalText(raw.supplier) || item.supplier;
        const lineRow = await tx.inventoryMovementLine.create({
          data: {
            tenantId,
            inventoryMovementId: movement.id,
            inventoryItemId: item.id,
            lineId: randomUUID(),
            position,
            direction: 'IN',
            storageLocationId: line.storageLocationId,
            costKnown: !raw.historicalTransfer || line.unitCost != null,
            quantity: line.quantity,
            unitCost,
            amount: line.quantity * unitCost,
            expectedQuantity: line.expectedQuantity,
            actualQuantity: line.actualQuantity,
            ...physical,
            note: line.note,
          },
        });
        const lot = await tx.inventoryLot.create({
          data: {
            tenantId,
            lotId: randomUUID(),
            inventoryItemId: item.id,
            costKnown: !raw.historicalTransfer || line.unitCost != null,
            quantityReceived: line.quantity,
            quantityRemaining: line.quantity,
            unitCost,
            listPrice: lotListPrice,
            discountPercent: lotDiscount,
            receivedAt: movement.occurredAt,
            expiresAt: raw.expiresAt ? dateValue(raw.expiresAt) : null,
            supplier: lotSupplier,
            note: line.note,
          },
        });
        await tx.inventoryMovementAllocation.create({
          data: {
            tenantId,
            inventoryMovementLineId: lineRow.id,
            inventoryLotId: lot.id,
            allocationId: randomUUID(),
            quantity: line.quantity,
            unitCost,
            amount: line.quantity * unitCost,
          },
        });
        continue;
      }

      await tx.inventoryMovementLine.create({
        data: {
          tenantId,
          inventoryMovementId: movement.id,
          inventoryItemId: item.id,
          lineId: randomUUID(),
          position,
          direction: 'OUT',
          storageLocationId: line.storageLocationId,
          quantity: line.quantity,
          costKnown: !raw.historicalTransfer || line.unitCost != null,
          unitCost: raw.historicalTransfer ? line.unitCost ?? 0 : 0,
          amount: raw.historicalTransfer ? line.quantity * (line.unitCost ?? 0) : 0,
          expectedQuantity: line.expectedQuantity,
          actualQuantity: line.actualQuantity,
          ...physical,
          note: line.note,
        },
      });
    }

    if (!raw.historicalTransfer) for (const inventoryItemId of affectedInternalIds) {
      await this.rebuildItemCostingInTx(tx, tenantId, inventoryItemId);
    }

    return movement;
  }
}
