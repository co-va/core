import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';

type AnyRecord = Record<string, any>;
type Tx = AnyRecord;

type PreparedLine = {
  itemId: string;
  quantity: number;
  direction: 'IN' | 'OUT';
  unitCost: number | null;
  expectedQuantity: number | null;
  actualQuantity: number | null;
  supplier: string;
  listPrice: number | null;
  discountPercent: number | null;
  note: string;
};

const OUT_KINDS = new Set(['CONSUMPTION', 'SALE', 'WRITE_OFF']);
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
      direction,
      unitCost: nullableNonNegative(row.unitCost ?? row.actualPrice),
      expectedQuantity: nullableNonNegative(row.expectedQuantity),
      actualQuantity: nullableNonNegative(row.actualQuantity),
      supplier: optionalText(row.supplier),
      listPrice: nullableNonNegative(row.listPrice),
      discountPercent: nullablePercent(row.discountPercent),
      note: optionalText(row.note),
    };
  }).filter((row) => row.itemId && row.quantity > 0);
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
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(tenantId: string) {
    const [items, lots, movements, lines, supplierOffers] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { tenantId, archivedAt: null },
        orderBy: [{ position: 'asc' }, { manufacturer: 'asc' }, { name: 'asc' }],
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
      this.prisma.inventoryMovementLine.findMany({
        where: { tenantId },
        orderBy: { position: 'asc' },
      }),
      this.prisma.inventorySupplierOffer.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ supplier: 'asc' }, { updatedAt: 'desc' }],
      }),
    ]);

    const balances = new Map<string, number>();
    lines.forEach((line: AnyRecord) => {
      const signed = line.direction === 'OUT' ? -decimalNumber(line.quantity) : decimalNumber(line.quantity);
      balances.set(line.inventoryItemId, (balances.get(line.inventoryItemId) || 0) + signed);
    });

    const itemByInternal = new Map(items.map((item: AnyRecord) => [item.id, item]));
    const offersByItem = new Map<string, AnyRecord[]>();
    supplierOffers.forEach((offer: AnyRecord) => {
      const rows = offersByItem.get(offer.inventoryItemId) || [];
      rows.push({
        offerId: offer.offerId,
        supplier: offer.supplier,
        listPrice: offer.listPrice == null ? null : decimalNumber(offer.listPrice),
        discountPercent: offer.discountPercent == null ? null : decimalNumber(offer.discountPercent),
        actualPrice: offer.actualPrice == null ? null : decimalNumber(offer.actualPrice),
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
        note: line.note,
      });
      linesByMovement.set(line.inventoryMovementId, group);
    });

    return {
      items: items.map((item: AnyRecord) => {
        const grossWeight = item.grossWeight == null ? null : decimalNumber(item.grossWeight);
        const tareWeight = item.tareWeight == null ? null : decimalNumber(item.tareWeight);
        return {
          itemId: item.itemId,
          name: item.name,
          manufacturer: item.manufacturer,
          productType: item.productType,
          unit: item.unit,
          category: item.category,
          sku: item.sku,
          barcode: item.barcode,
          location: item.location,
          supplier: item.supplier,
          minStock: item.minStock == null ? null : decimalNumber(item.minStock),
          targetStock: item.targetStock == null ? null : decimalNumber(item.targetStock),
          packageQuantity: item.packageQuantity == null ? null : decimalNumber(item.packageQuantity),
          grossWeight,
          tareWeight,
          netPackageWeight: grossWeight != null && tareWeight != null ? Math.max(0, grossWeight - tareWeight) : null,
          lastPurchasePrice: item.lastPurchasePrice == null ? null : decimalNumber(item.lastPurchasePrice),
          supplierOffers: offersByItem.get(item.id) || [],
          trackLots: item.trackLots,
          canConsume: item.canConsume,
          canSell: item.canSell,
          balance: balances.get(item.id) || 0,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
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

  async createItem(tenantId: string, body: unknown, db?: Tx) {
    const source = objectValue(body);
    const name = text(source.name);
    if (!name) throw new BadRequestException('Укажите наименование позиции');
    const unit = text(source.unit) || 'шт.';
    const itemId = text(source.itemId) || randomUUID();
    const initialQuantity = nonNegative(source.quantity);
    const purchasePrice = nullableNonNegative(source.purchasePrice ?? source.actualPrice ?? source.lastPurchasePrice);
    const grossWeight = nullableNonNegative(source.grossWeight);
    const tareWeight = nullableNonNegative(source.tareWeight);
    if (grossWeight != null && tareWeight != null && tareWeight > grossWeight) {
      throw new BadRequestException('Масса тары не может быть больше массы брутто');
    }

    const work = async (tx: Tx) => {
      await tx.inventoryItem.create({
        data: {
          tenantId,
          itemId,
          name,
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
          packageQuantity: nullableNonNegative(source.packageQuantity),
          grossWeight,
          tareWeight,
          lastPurchasePrice: purchasePrice,
          trackLots: source.trackLots !== false,
          canConsume: source.canConsume !== false,
          canSell: source.canSell === true,
          position: Number.isInteger(source.position) ? source.position : 0,
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

  async updateItem(tenantId: string, itemId: string, body: unknown, db?: Tx) {
    const owner = db || this.prisma;
    const source = objectValue(body);
    const current = await owner.inventoryItem.findFirst({ where: { tenantId, itemId, archivedAt: null } });
    if (!current) throw new NotFoundException('Позиция склада не найдена');

    const data: AnyRecord = {};
    if ('name' in source) {
      const name = text(source.name);
      if (!name) throw new BadRequestException('Укажите наименование позиции');
      data.name = name;
    }
    if ('unit' in source) data.unit = text(source.unit) || current.unit;
    for (const key of ['manufacturer', 'productType', 'category', 'sku', 'barcode', 'location', 'supplier'] as const) {
      if (key in source) data[key] = optionalText(source[key]);
    }
    for (const key of ['minStock', 'targetStock', 'packageQuantity', 'grossWeight', 'tareWeight', 'lastPurchasePrice'] as const) {
      if (key in source) data[key] = nullableNonNegative(source[key]);
    }
    const grossWeight = 'grossWeight' in data ? data.grossWeight : (current.grossWeight == null ? null : decimalNumber(current.grossWeight));
    const tareWeight = 'tareWeight' in data ? data.tareWeight : (current.tareWeight == null ? null : decimalNumber(current.tareWeight));
    if (grossWeight != null && tareWeight != null && tareWeight > grossWeight) {
      throw new BadRequestException('Масса тары не может быть больше массы брутто');
    }
    if ('trackLots' in source) data.trackLots = source.trackLots !== false;
    if ('canConsume' in source) data.canConsume = source.canConsume !== false;
    if ('canSell' in source) data.canSell = source.canSell === true;
    if ('position' in source && Number.isInteger(source.position)) data.position = source.position;
    if (source.archived === true) data.archivedAt = new Date();

    await owner.inventoryItem.update({ where: { id: current.id }, data });
    return db ? { itemId } : this.snapshot(tenantId);
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

    const desired = normalizedMovementLines(original.kind, source.lines);
    if (!desired.length) throw new BadRequestException('В корректировке нет позиций');

    const currentByItem = new Map<string, { signed: number; unitCost: number }>();
    (original.lines as AnyRecord[]).forEach((line) => {
      const itemId = String(line.item?.itemId || '');
      const signed = line.direction === 'OUT' ? -decimalNumber(line.quantity) : decimalNumber(line.quantity);
      const row = currentByItem.get(itemId) || { signed: 0, unitCost: decimalNumber(line.unitCost) };
      row.signed += signed;
      if (!row.unitCost) row.unitCost = decimalNumber(line.unitCost);
      currentByItem.set(itemId, row);
    });

    const desiredByItem = new Map<string, { signed: number; unitCost: number | null }>();
    desired.forEach((line) => {
      const signed = line.direction === 'OUT' ? -line.quantity : line.quantity;
      const row = desiredByItem.get(line.itemId) || { signed: 0, unitCost: line.unitCost };
      row.signed += signed;
      if (row.unitCost == null && line.unitCost != null) row.unitCost = line.unitCost;
      desiredByItem.set(line.itemId, row);
    });

    const itemIds = new Set([...currentByItem.keys(), ...desiredByItem.keys()]);
    const deltaLines: AnyRecord[] = [];
    itemIds.forEach((itemId) => {
      const before = currentByItem.get(itemId)?.signed || 0;
      const after = desiredByItem.get(itemId)?.signed || 0;
      const delta = after - before;
      if (Math.abs(delta) < EPSILON) return;
      deltaLines.push({
        itemId,
        quantity: delta,
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
      unitCost: input.unitCost, listPrice: input.listPrice, discountPercent: input.discountPercent, supplier: input.supplier }] };
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

  private async rebuildItemCostingInTx(tx: Tx, tenantId: string, inventoryItemId: string) {
    const item = await tx.inventoryItem.findFirst({ where: { tenantId, id: inventoryItemId } });
    if (!item) return;

    const lines = await tx.inventoryMovementLine.findMany({
      where: { tenantId, inventoryItemId },
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
      await tx.inventoryMovementLine.update({
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
    if (latestLot) {
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: { lastPurchasePrice: decimalNumber(latestLot.unitCost) },
      });
    }
  }

  private async createMovementInTx(tx: Tx, tenantId: string, raw: AnyRecord) {
    const kind = text(raw.kind).toUpperCase();
    if (!MOVEMENT_KINDS.has(kind)) throw new BadRequestException('Неизвестный тип складского движения');
    const lines = normalizedMovementLines(kind, raw.lines);
    if (!lines.length) throw new BadRequestException('Добавьте хотя бы одну позицию');

    const requestedIds = [...new Set(lines.map((line) => line.itemId))];
    const items = await tx.inventoryItem.findMany({
      where: { tenantId, itemId: { in: requestedIds }, archivedAt: null },
    });
    const itemById = new Map((items as AnyRecord[]).map((item) => [item.itemId, item]));
    if (itemById.size !== requestedIds.length) throw new BadRequestException('Одна из позиций склада не найдена');

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
      affectedInternalIds.add(item.id);

      if (line.direction === 'IN') {
        const unitCost = line.unitCost ?? (raw.historicalTransfer ? 0 : decimalNumber(item.lastPurchasePrice));
        const lineRow = await tx.inventoryMovementLine.create({
          data: {
            tenantId,
            inventoryMovementId: movement.id,
            inventoryItemId: item.id,
            lineId: randomUUID(),
            position,
            direction: 'IN',
            costKnown: !raw.historicalTransfer || line.unitCost != null,
            quantity: line.quantity,
            unitCost,
            amount: line.quantity * unitCost,
            expectedQuantity: line.expectedQuantity,
            actualQuantity: line.actualQuantity,
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
            listPrice: line.listPrice,
            discountPercent: line.discountPercent,
            receivedAt: movement.occurredAt,
            expiresAt: raw.expiresAt ? dateValue(raw.expiresAt) : null,
            supplier: line.supplier || optionalText(raw.supplier) || item.supplier,
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
          quantity: line.quantity,
          costKnown: !raw.historicalTransfer || line.unitCost != null,
          unitCost: raw.historicalTransfer ? line.unitCost ?? 0 : 0,
          amount: raw.historicalTransfer ? line.quantity * (line.unitCost ?? 0) : 0,
          expectedQuantity: line.expectedQuantity,
          actualQuantity: line.actualQuantity,
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
