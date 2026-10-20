import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma.service';
import { InventoryService } from './inventory.service';

type AnyRecord = Record<string, any>;

const STOCK_HEADERS = [
  'Производитель', 'Наименование *', 'Категория / тип', 'Единица *', 'Количество *',
  'В упаковке', 'Масса брутто полной упаковки', 'Масса тары',
  'Поставщик начального остатка', 'Прайсовая цена', 'Скидка %', 'Фактическая цена закупки',
  'Место хранения', 'Минимальный остаток', 'Целевой остаток', 'Артикул', 'Штрихкод',
];

const SUPPLIER_HEADERS = [
  'Производитель', 'Наименование товара *', 'Единица', 'Поставщик *',
  'Прайсовая цена', 'Скидка %', 'Фактическая цена', 'Артикул поставщика', 'Примечание',
];

const MOVEMENT_HEADERS = [
  'Дата *', 'Время', 'UEI', 'Имя', 'Процедура', 'Часть / зона', 'Тип *',
  'Производитель', 'Материал *', 'Количество *', 'Единица', 'Поставщик',
  'Прайсовая цена', 'Скидка %', 'Фактическая цена закупки', 'Себестоимость', 'Примечание',
];

const ORDER_HEADERS = ['Наименование', 'Количество', 'Единица', 'Поставщик', 'Артикул'];

const KIND_LABELS: Record<string, string> = {
  RECEIPT: 'Приход',
  CONSUMPTION: 'Расход',
  WRITE_OFF: 'Списание',
  SALE: 'Продажа',
  RETURN: 'Возврат',
  ADJUSTMENT: 'Инвентаризация',
  CORRECTION: 'Корректировка',
};

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const object = value as AnyRecord;
    if (object.text != null) return String(object.text).trim();
    if (object.result != null) return String(object.result).trim();
    if (Array.isArray(object.richText)) return object.richText.map((part: AnyRecord) => String(part?.text || '')).join('').trim();
  }
  return String(value ?? '').trim();
}

function numberValue(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed == null ? null : Math.max(0, parsed);
}

function styleSheet(sheet: ExcelJS.Worksheet, headers: string[]) {
  const row = sheet.getRow(1);
  row.values = headers;
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 30;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  headers.forEach((header, index) => {
    sheet.getColumn(index + 1).width = Math.max(14, Math.min(34, header.length + 4));
  });
}

async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

@Injectable()
export class InventoryExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async stockExport(tenantId: string) {
    const snapshot = await this.inventory.snapshot(tenantId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Остатки');
    styleSheet(sheet, STOCK_HEADERS);
    snapshot.items.forEach((item: AnyRecord) => sheet.addRow([
      item.manufacturer || '', item.name, item.productType || item.category || '', item.unit, item.balance,
      item.packageQuantity ?? '', item.grossWeight ?? '', item.tareWeight ?? '',
      '', '', '', item.lastPurchasePrice ?? '',
      item.location || '', item.minStock ?? '', item.targetStock ?? '', item.sku || '', item.barcode || '',
    ]));

    const suppliers = workbook.addWorksheet('Поставщики');
    styleSheet(suppliers, SUPPLIER_HEADERS);
    snapshot.items.forEach((item: AnyRecord) => {
      (item.supplierOffers || []).forEach((offer: AnyRecord) => suppliers.addRow([
        item.manufacturer || '', item.name, item.unit, offer.supplier || '',
        offer.listPrice ?? '', offer.discountPercent ?? '', offer.actualPrice ?? '',
        offer.supplierSku || '', offer.note || '',
      ]));
    });
    return workbookBuffer(workbook);
  }

  private async ueiPersonMap(tenantId: string) {
    const state = await this.prisma.ueiState.findUnique({ where: { tenantId } });
    const relations = ((state?.data as AnyRecord)?.relations || {}) as Record<string, string>;
    const map = new Map<string, string>();
    Object.entries(relations).forEach(([member, uei]) => {
      if (member.startsWith('person:') && uei) map.set(String(uei), member.slice('person:'.length));
    });
    return map;
  }

  private async personNames(tenantId: string) {
    const [people, ueiMap] = await Promise.all([
      this.prisma.person.findMany({ where: { tenantId }, select: { key: true, data: true } }),
      this.ueiPersonMap(tenantId),
    ]);
    const byKey = new Map(people.map((person) => {
      const data = (person.data || {}) as AnyRecord;
      return [person.key, [text(data.name), text(data.surname)].filter(Boolean).join(' ')];
    }));
    const byUei = new Map<string, string>();
    ueiMap.forEach((key, uei) => byUei.set(uei, byKey.get(key) || ''));
    return { byKey, byUei };
  }

  async movementExport(tenantId: string, from = '', to = '') {
    const start = from ? new Date(`${from}T00:00:00`) : undefined;
    const end = to ? new Date(`${to}T23:59:59.999`) : undefined;
    const movements = await this.prisma.inventoryMovement.findMany({
      where: {
        tenantId,
        ...(start || end ? { occurredAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
      },
      include: {
        lines: {
          include: { item: true, allocations: { include: { lot: true } } },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });
    const names = await this.personNames(tenantId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Движения');
    styleSheet(sheet, MOVEMENT_HEADERS);
    movements.forEach((movement: AnyRecord) => {
      const date = new Date(movement.occurredAt);
      const personName = names.byUei.get(movement.personUei) || names.byKey.get(movement.personKey) || '';
      (movement.lines || []).forEach((line: AnyRecord) => {
        const lots = (line.allocations || []).map((allocation: AnyRecord) => allocation.lot).filter(Boolean);
        const suppliers = [...new Set(lots.map((lot: AnyRecord) => text(lot.supplier)).filter(Boolean))];
        const listPrices = [...new Set(lots.map((lot: AnyRecord) => lot.listPrice == null ? '' : String(lot.listPrice)).filter(Boolean))];
        const discounts = [...new Set(lots.map((lot: AnyRecord) => lot.discountPercent == null ? '' : String(lot.discountPercent)).filter(Boolean))];
        sheet.addRow([
          date.toLocaleDateString('ru-RU'),
          date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          movement.personUei || '',
          personName,
          movement.procedureKey || '',
          line.note || '',
          KIND_LABELS[movement.kind] || movement.kind,
          line.item?.manufacturer || '',
          line.item?.name || '',
          Number(line.quantity),
          line.item?.unit || '',
          suppliers.join(', '),
          listPrices.length === 1 ? Number(listPrices[0]) : '',
          discounts.length === 1 ? Number(discounts[0]) : '',
          line.direction === 'IN' ? Number(line.unitCost) || '' : '',
          Number(line.unitCost) || '',
          movement.note || '',
        ]);
      });
    });
    return workbookBuffer(workbook);
  }

  async orderExport(tenantId: string, selections: unknown) {
    const rows = Array.isArray(selections) ? selections.map((item) => item as AnyRecord) : [];
    if (!rows.length) throw new BadRequestException('Не выбраны позиции заказа');
    const ids = rows.map((row) => text(row.itemId)).filter(Boolean);
    const items = await this.prisma.inventoryItem.findMany({ where: { tenantId, itemId: { in: ids }, archivedAt: null } });
    const byId = new Map(items.map((item: AnyRecord) => [item.itemId, item]));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Заказ');
    styleSheet(sheet, ORDER_HEADERS);
    rows.forEach((row) => {
      const item = byId.get(text(row.itemId)) as AnyRecord | undefined;
      if (!item) return;
      sheet.addRow([item.name, nonNegative(row.quantity) || 0, item.unit, item.supplier || '', item.sku || '']);
    });
    return workbookBuffer(workbook);
  }
}
