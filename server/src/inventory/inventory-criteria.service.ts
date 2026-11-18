import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type Tx = Prisma.TransactionClient;
type Row = Record<string, any>;
type Value = { id: string; name: string; archived?: boolean };
type Group = {
  id: string; name: string; legacyField: string;
  position: number; archived?: boolean; values: Value[];
};

const SEEDS = [
  { id: 'manufacturer', name: 'Производитель', legacyField: 'manufacturer' },
  { id: 'category', name: 'Категория', legacyField: 'category' },
  { id: 'productType', name: 'Тип', legacyField: 'productType' },
] as const;
const legacyKeys = new Set<string>(SEEDS.map(v => v.legacyField));
const text = (value: unknown) => String(value ?? '').trim();
const asObject = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const toJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const equal = (a: string, b: string) => a.localeCompare(b, 'ru', { sensitivity: 'accent' }) === 0;
function validName(value: unknown) {
  const name = text(value);
  if (!name || name.length > 120) throw new BadRequestException('Название должно содержать 1–120 символов.');
  return name;
}
function normalize(value: unknown): Group[] {
  const entries = asObject(value).groups;
  return (Array.isArray(entries) ? entries : []).filter(row => row && text(row.id))
    .map(row => ({
      id: text(row.id), name: text(row.name), legacyField: text(row.legacyField),
      position: Number.isSafeInteger(row.position) ? row.position : 0,
      archived: row.archived === true,
      values: (Array.isArray(row.values) ? row.values : [])
        .filter((v: Row) => v && text(v.id))
        .map((v: Row) => ({ id: text(v.id), name: text(v.name), archived: v.archived === true })),
    }));
}

@Injectable()
export class InventoryCriteriaService {
  constructor(private readonly prisma: PrismaService) {}

  private async lock(tx: Tx, tenantId: string) {
    await tx.$queryRawUnsafe('SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))) AS guard',
      tenantId, 'inventory-criteria');
  }

  private async state(tx: Tx, tenantId: string): Promise<Group[]> {
    await this.lock(tx, tenantId);
    const stored = await tx.inventoryCriteriaCatalog.findUnique({ where: { tenantId } });
    const groups = normalize(stored?.data);
    let changed = !stored;
    for (const [index, seed] of SEEDS.entries()) {
      if (groups.some(group => group.id === seed.id)) continue;
      groups.push({ ...seed, position: index, archived: false, values: [] });
      changed = true;
    }
    // Reconstitute existing Excel values without touching product records.
    const items = await tx.inventoryItem.findMany({
      where: { tenantId, archivedAt: null },
      select: { manufacturer: true, category: true, productType: true },
    });
    for (const group of groups) {
      if (!legacyKeys.has(group.legacyField)) continue;
      const field = group.legacyField as 'manufacturer' | 'category' | 'productType';
      for (const item of items) {
        const value = text(item[field]);
        if (!value || group.values.some(v => v.name === value)) continue;
        group.values.push({ id: randomUUID(), name: value, archived: false });
        changed = true;
      }
    }
    // Brand and legacy values have an alphabetical initial order; later
    // reorder operations preserve their saved array positions.
    if (!stored) groups.forEach(group=>group.values.sort((a,b)=>
      a.name.localeCompare(b.name,'ru',{numeric:true,sensitivity:'base'})));
    if (changed) await tx.inventoryCriteriaCatalog.upsert({
      where: { tenantId },
      create: { tenantId, data: toJson({ groups }) },
      update: { data: toJson({ groups }) },
    });
    return groups;
  }

  private output(groups: Group[]) {
    return groups.filter(group => !group.archived)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'ru'))
      .map(group => ({
        id: group.id, name: group.name, legacyField: group.legacyField,
        position: group.position,
        values: group.values.filter(value => !value.archived)
          .map(value => ({ id: value.id, name: value.name })),
      }));
  }

  private async save(tx: Tx, tenantId: string, groups: Group[]) {
    await tx.inventoryCriteriaCatalog.update({ where: { tenantId }, data: { data: toJson({ groups }) } });
    return this.output(groups);
  }

  private required(groups: Group[], id: string) {
    const group = groups.find(g => g.id === id && !g.archived);
    if (!group) throw new BadRequestException('Группа не найдена.');
    return group;
  }

  async list(tenantId: string) {
    return this.prisma.$transaction(async tx => this.output(await this.state(tx, tenantId)));
  }

  async create(tenantId: string, body: unknown) {
    const name = validName(asObject(body).name);
    return this.prisma.$transaction(async tx => {
      const groups = await this.state(tx, tenantId);
      if (groups.some(g => !g.archived && equal(g.name, name)))
        throw new BadRequestException('Группа с таким названием уже существует.');
      groups.push({ id: randomUUID(), name, legacyField: '', archived: false,
        position: groups.reduce((n, g) => Math.max(n, g.position), -1) + 1, values: [] });
      return this.save(tx, tenantId, groups);
    });
  }

  async update(tenantId: string, id: string, body: unknown) {
    const source = asObject(body);
    return this.prisma.$transaction(async tx => {
      const groups = await this.state(tx, tenantId);
      const group = this.required(groups, id);
      if ('name' in source) {
        const name = validName(source.name);
        if (groups.some(g => g !== group && !g.archived && equal(g.name, name)))
          throw new BadRequestException('Группа с таким названием уже существует.');
        group.name = name;
      }
      if ('position' in source) {
        const position = Number(source.position);
        if (!Number.isSafeInteger(position) || position < 0)
          throw new BadRequestException('Неверный порядок группы.');
        group.position = position;
      }
      if (source.archived === true) group.archived = true;
      return this.save(tx, tenantId, groups);
    });
  }

  async createValue(tenantId: string, groupId: string, body: unknown) {
    const name = validName(asObject(body).name);
    return this.prisma.$transaction(async tx => {
      const groups = await this.state(tx, tenantId);
      const group = this.required(groups, groupId);
      const existing = group.values.find(v => equal(v.name, name));
      if (existing && !existing.archived) throw new BadRequestException('Такое значение уже существует.');
      if (existing) existing.archived = false;
      else group.values.push({ id: randomUUID(), name, archived: false });
      return this.save(tx, tenantId, groups);
    });
  }


  async reorderValues(tenantId: string, id: string, body: unknown) {
    const ids = asObject(body).valueIds;
    if (!Array.isArray(ids) || ids.some(value => !text(value))
      || new Set(ids.map(text)).size !== ids.length)
      throw new BadRequestException('Некорректный порядок значений.');
    return this.prisma.$transaction(async tx => {
      const groups = await this.state(tx, tenantId);
      const group = this.required(groups, id);
      const values = new Map(group.values.filter(value => !value.archived)
        .map(value => [value.id, value]));
      if (ids.some(value => !values.has(text(value))))
        throw new BadRequestException('Значение больше не существует. Обновите список.');
      const byId = new Map(group.values.map(value => [value.id, value]));
      const ordered = ids.map(value => byId.get(text(value))!);
      group.values = [...ordered, ...group.values.filter(value => !ids.includes(value.id))];
      return this.save(tx, tenantId, groups);
    });
  }

  async updateValue(tenantId: string, groupId: string, valueId: string, body: unknown) {
    const source = asObject(body);
    return this.prisma.$transaction(async tx => {
      const groups = await this.state(tx, tenantId);
      const group = this.required(groups, groupId);
      const value = group.values.find(v => v.id === valueId && !v.archived);
      if (!value) throw new BadRequestException('Значение не найдено.');
      const field = group.legacyField as 'manufacturer' | 'category' | 'productType';
      if (source.archived === true) {
        const items = await tx.inventoryItem.findMany({
          where: { tenantId, archivedAt: null },
          select: { manufacturer: true, category: true, productType: true, criteriaValues: true },
        });
        const used = legacyKeys.has(field)
          ? items.some(item => text(item[field]) === value.name)
          : items.some(item => text(asObject(item.criteriaValues)[groupId]) === valueId);
        if (used) throw new BadRequestException('Значение используется в товарах. Сначала переназначьте товары.');
        value.archived = true;
      } else if ('name' in source) {
        const name = validName(source.name);
        if (group.values.some(v => v !== value && !v.archived && equal(v.name, name)))
          throw new BadRequestException('Такое значение уже существует.');
        if (name !== value.name && legacyKeys.has(field)) {
          const where = { tenantId, archivedAt: null };
          if (field === 'manufacturer') await tx.inventoryItem.updateMany({
            where: { ...where, manufacturer: value.name }, data: { manufacturer: name },
          });
          if (field === 'category') await tx.inventoryItem.updateMany({
            where: { ...where, category: value.name }, data: { category: name },
          });
          if (field === 'productType') await tx.inventoryItem.updateMany({
            where: { ...where, productType: value.name }, data: { productType: name },
          });
        }
        value.name = name;
      }
      return this.save(tx, tenantId, groups);
    });
  }

  // Existing legacy fields retain their ordinary source-of-truth semantics.
  // Only extra groups use the new ID-based selection map.
  async validateSelections(tx: Tx, tenantId: string, requested: unknown, previous: unknown = {}) {
    const source = asObject(requested);
    const groups = await this.state(tx, tenantId);
    // Preserve assignments belonging to archived groups; a normal edit
    // of other fields must never destroy historical classification data.
    const result: Record<string, string> = {};
    for (const [id, rawValue] of Object.entries(asObject(previous))) {
      if (text(rawValue)) result[id] = text(rawValue);
    }
    for (const [id, rawValue] of Object.entries(source)) {
      const valueId = text(rawValue);
      const group = groups.find(g => g.id === id && !g.archived && !g.legacyField);
      if (!group) throw new BadRequestException('Группа классификации недоступна.');
      if (!valueId) { delete result[id]; continue; }
      if (!group.values.some(v => v.id === valueId && !v.archived))
        throw new BadRequestException('Неизвестное значение классификации.');
      result[id] = valueId;
    }
    return toJson(result);
  }
}
