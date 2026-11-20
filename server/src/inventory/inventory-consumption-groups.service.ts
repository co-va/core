import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { canonicalInventoryUnit, stockQuantityForUnit } from './inventory-usage';
import { InventoryService } from './inventory.service';

type GroupInput = Record<string, unknown>;
const text = (value: unknown) => String(value ?? '').trim();
const asIds = (value: unknown) => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
    throw new BadRequestException('Выберите складские позиции.');
  const ids = value.map(text);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || ids.length > 500)
    throw new BadRequestException('Список складских позиций содержит дубликаты или неверные значения.');
  return ids;
};
const rounded = (value: number, digits = 3) => Number(value.toFixed(digits));
const numeric = (value: unknown) => value == null || value === '' ? null : Number(value);
const stockFactor = (item: Record<string, any>, unit: string): number | null => {
  const gross = numeric(item.grossWeight);
  const tare = numeric(item.tareWeight);
  try {
    const quantity = stockQuantityForUnit({
      ...item,
      netPackageWeight: gross != null && tare != null && gross >= tare ? gross - tare : null,
    }, 1, unit);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
  } catch {
    return null;
  }
};

@Injectable()
export class InventoryConsumptionGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SaasAccessService,
    private readonly inventory: InventoryService,
  ) {}

  private async assertAccess(tenantId: string) {
    const right = await this.access.resolveCapability(tenantId, 'inventory.consumption_groups.access');
    if (!right.enabled) throw new ForbiddenException('Группы расхода недоступны для этого аккаунта.');
  }

  private async assertMembership(tenantId: string, ids: string[], unit: string) {
    if (!ids.length) return;
    const stock = await this.prisma.inventoryItem.findMany({
      where: { tenantId, itemId: { in: ids }, archivedAt: null },
    });
    if (stock.length !== ids.length) throw new BadRequestException('Одна из складских позиций недоступна.');
    for (const item of stock) {
      if (stockFactor(item as Record<string, any>, unit) == null)
        throw new BadRequestException('Единицу позиции «' + item.name +
          '» невозможно достоверно пересчитать в ' + unit + '. Проверьте складскую карточку.');
    }
  }

  async list(tenantId: string) {
    await this.assertAccess(tenantId);
    const groups = await this.prisma.inventoryConsumptionGroup.findMany({
      where: { tenantId, archivedAt: null }, orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
    if (!groups.length) return { groups: [] };
    // The existing Inventory owner prepares all-time physical balances and
    // supplier price per stock unit; no duplicate stock calculation is added.
    const stock = await this.inventory.snapshot(tenantId);
    const byId = new Map(stock.items.map(item => [String(item.itemId), item]));
    return { groups: groups.map(group => {
      const itemIds = Array.isArray(group.itemIds)
        ? group.itemIds.filter((id): id is string => typeof id === 'string') : [];
      let physicalBalance = 0;
      let knownStockValue = 0;
      let pricedQuantity = 0;
      const incompatibleItemIds: string[] = [];
      for (const id of itemIds) {
        const item = byId.get(id);
        if (!item) { incompatibleItemIds.push(id); continue; }
        const ratio = stockFactor(item, group.unit);
        if (ratio == null) { incompatibleItemIds.push(id); continue; }
        const amount = Number(item.balance || 0) / ratio;
        physicalBalance += amount;
        const price = numeric(item.baseUnitPrice);
        if (price !== null && Number.isFinite(price) && price >= 0) {
          knownStockValue += Number(item.balance || 0) * price;
          pricedQuantity += amount;
        }
      }
      // Unknown purchase price or conversion must not produce a false average.
      const complete = !incompatibleItemIds.length && Math.abs(pricedQuantity - physicalBalance) < 0.000001;
      return {
        groupId: group.groupId, name: group.name, unit: group.unit, itemIds,
        physicalBalance: incompatibleItemIds.length ? null : rounded(physicalBalance),
        averageUnitCost: complete && physicalBalance > 0
          ? rounded(knownStockValue / physicalBalance, 4) : null,
        knownStockValue: rounded(knownStockValue, 2),
        costComplete: complete,
        incompatibleItemIds,
      };
    }) };
  }

  private validate(body: GroupInput) {
    const name = text(body.name).replace(/\s+/g, ' ');
    if (!name || name.length > 120) throw new BadRequestException('Укажите название группы (до 120 символов).');
    const unit = canonicalInventoryUnit(body.unit);
    if (!unit) throw new BadRequestException('Выберите единицу группового расхода.');
    const itemIds = asIds(body.itemIds);
    return { name, unit, itemIds };
  }

  async create(tenantId: string, body: GroupInput) {
    await this.assertAccess(tenantId);
    const { name, unit, itemIds } = this.validate(body);
    await this.assertMembership(tenantId, itemIds, unit);
    try {
      await this.prisma.inventoryConsumptionGroup.create({
        data: { tenantId, groupId: randomUUID(), name, unit, itemIds },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Группа расхода с таким названием уже существует.');
      throw error;
    }
    return this.list(tenantId);
  }

  async update(tenantId: string, groupId: string, body: GroupInput) {
    await this.assertAccess(tenantId);
    const existing = await this.prisma.inventoryConsumptionGroup.findFirst({
      where: { tenantId, groupId, archivedAt: null },
    });
    if (!existing) throw new NotFoundException('Группа расхода не найдена.');
    if (body.archived === true) {
      await this.prisma.inventoryConsumptionGroup.update({
        where: { id: existing.id }, data: { archivedAt: new Date() },
      });
      return this.list(tenantId);
    }
    const { name, unit, itemIds } = this.validate({
      name: body.name ?? existing.name,
      unit: body.unit ?? existing.unit,
      itemIds: body.itemIds ?? existing.itemIds,
    });
    await this.assertMembership(tenantId, itemIds, unit);
    try {
      await this.prisma.inventoryConsumptionGroup.update({
        where: { id: existing.id }, data: { name, unit, itemIds },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Группа расхода с таким названием уже существует.');
      throw error;
    }
    return this.list(tenantId);
  }
}
