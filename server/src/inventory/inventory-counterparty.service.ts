import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma.service';
import { SaasAccessService } from '../saas-access/saas-access.service';

export type SupplierFile = { originalname: string; buffer: Buffer; size: number };
type Row = {
  position: number; supplierSku: string; name: string; manufacturer: string;
  barcode: string; unit: string; packageQuantity: number | null;
  listPrice: number | null; actualPrice: number | null; discountPercent: number | null;
};
type Parsed = { format: 'xlsx' | 'pdf'; status: 'READY' | 'NEEDS_TEMPLATE'; rows: Row[]; errors: string[] };

const MAX_FILE = 8 * 1024 * 1024;
const MAX_ROWS = 10000;
const COLUMNS = ['supplierSku','name','manufacturer','listPrice','actualPrice','discountPercent','unit','packageQuantity','barcode'] as const;
type Column = typeof COLUMNS[number];
const HEADERS: Record<Column, string[]> = {
  supplierSku: ['артикул','код товара','код продукта','артикул поставщика','sku','article','item code'],
  name: ['наименование','наименование товара','название','название товара','товар','продукт','product','description','name'],
  manufacturer: ['производитель','бренд','марка','brand','manufacturer'],
  listPrice: ['цена','прайс','прайсовая цена','цена прайс','цена руб','ррц','розничная цена','оптовая цена','price','list price'],
  actualPrice: ['цена закупки','цена со скидкой','фактическая цена','закупочная цена','purchase price'],
  discountPercent: ['скидка','скидка %','discount','discount %'],
  unit: ['единица','ед изм','единица измерения','ед','unit'],
  packageQuantity: ['в упаковке','количество в упаковке','номинал','фасовка','упаковка','package quantity'],
  barcode: ['штрихкод','штрих код','ean','barcode'],
};
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function plain(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (o.result != null) return plain(o.result);
    if (o.text != null) return plain(o.text);
    if (Array.isArray(o.richText)) return o.richText.map((p) => plain(p)).join('');
    return '';
  }
  return String(value).trim();
}
function normal(value: unknown) {
  return plain(value).toLocaleLowerCase('ru-RU').replace(/[.,:;()№*]/g, ' ').replace(/\s+/g, ' ').trim();
}
function amount(value: unknown, field: string, row: number, errors: string[], max = 1e12): number | null {
  const raw = plain(value).replace(/[\s\u00a0\u202f₽]/g, '').replace(/руб(?:лей|ля|\.)?/gi, '');
  if (!raw) return null;
  const s = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > max) {
    errors.push('Строка ' + row + ': неверное значение «' + field + '»');
    return null;
  }
  return n;
}
function mapRow(values: Record<Column, unknown>, position: number, errors: string[]): Row | null {
  const name = plain(values.name).slice(0, 300);
  if (!name) { errors.push('Строка ' + position + ': нет наименования'); return null; }
  const size = amount(values.packageQuantity, 'В упаковке', position, errors);
  if (size !== null && size <= 0) errors.push('Строка ' + position + ': количество в упаковке должно быть больше нуля');
  return {
    position, name,
    supplierSku: plain(values.supplierSku).slice(0, 160),
    manufacturer: plain(values.manufacturer).slice(0, 160),
    barcode: plain(values.barcode).slice(0, 160),
    unit: plain(values.unit).slice(0, 24),
    packageQuantity: size && size > 0 ? size : null,
    listPrice: amount(values.listPrice, 'Цена', position, errors),
    actualPrice: amount(values.actualPrice, 'Цена закупки', position, errors),
    discountPercent: amount(values.discountPercent, 'Скидка', position, errors, 100),
  };
}
async function parseExcel(data: Buffer): Promise<Parsed> {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(data as any); }
  catch { return { format: 'xlsx', status: 'NEEDS_TEMPLATE', rows: [], errors: ['Не удалось прочитать Excel. Используйте шаблон .xlsx.'] }; }
  const rows: Row[] = [], errors: string[] = [];
  let found = false;
  for (const sheet of workbook.worksheets) {
    let header = 0;
    let mapping: Partial<Record<Column, number>> = {};
    for (let n = 1; n <= Math.min(30, sheet.rowCount); n++) {
      const candidate: Partial<Record<Column, number>> = {};
      sheet.getRow(n).eachCell({ includeEmpty: false }, (cell, index) => {
        const label = normal(cell.value);
        for (const key of COLUMNS) {
          if (candidate[key] == null && HEADERS[key].some((name) => normal(name) === label)) {
            candidate[key] = index;
            break;
          }
        }
      });
      if (candidate.name && (candidate.listPrice || candidate.actualPrice || candidate.supplierSku)) {
        header = n; mapping = candidate; break;
      }
    }
    if (!header) {
      // Do not silently import only the first tab of a multi-sheet supplier workbook.
      // Explanatory sheets of one or two rows are ignored.
      if (sheet.rowCount > 2) errors.push('Лист «' + sheet.name + '»: не удалось определить таблицу. Используйте шаблон Excel.');
      continue;
    }
    found = true;
    for (let n = header + 1; n <= sheet.rowCount; n++) {
      const source = sheet.getRow(n);
      const values = Object.fromEntries(COLUMNS.map((key) => [key, mapping[key] ? source.getCell(mapping[key]!).value : ''])) as Record<Column, unknown>;
      if (COLUMNS.every((key) => !plain(values[key]))) continue;
      if (!plain(values.name) && !plain(values.supplierSku) && !plain(values.listPrice) && !plain(values.actualPrice)) continue;
      const row = mapRow(values, n, errors);
      if (row) rows.push({ ...row, position: rows.length + 1 });
      if (rows.length > MAX_ROWS) throw new BadRequestException('Слишком большой прайс: максимум 10 000 строк');
    }
  }
  if (!found) errors.push('Не найдены колонки наименования и цены/артикула. Перенесите данные в шаблон Excel.');
  if (!rows.length && found) errors.push('В файле нет строк товаров.');
  return { format: 'xlsx', status: !errors.length && rows.length ? 'READY' : 'NEEDS_TEMPLATE', rows: errors.length ? [] : rows, errors };
}
async function parsePdf(data: Buffer): Promise<Parsed> {
  const parse: (data: Buffer, options?: Record<string, unknown>) => Promise<{ text: string; numpages: number }> = require('pdf-parse');
  let result: { text: string; numpages: number };
  try { result = await parse(data, { max: 100 }); }
  catch { throw new BadRequestException('PDF повреждён или не может быть прочитан'); }
  if (result.numpages > 100) throw new BadRequestException('PDF: максимум 100 страниц');
  const errors: string[] = [], rows: Row[] = [];
  // PDF is not a table format. Parse only lines with a clearly separated final price.
  const lines = result.text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  for (let n = 0; n < lines.length; n++) {
    const match = lines[n].match(/^(?:(\S+)\s{2,})?(.{3,}?)\s{2,}(\d[\d\s.,]*)\s*(?:₽|руб\.?)?$/i);
    if (!match) continue;
    const row = mapRow({ supplierSku: match[1] || '', name: match[2], listPrice: match[3],
      manufacturer: '', barcode: '', unit: '', packageQuantity: '', actualPrice: '', discountPercent: '' }, n + 1, errors);
    if (row) rows.push(row);
    if (rows.length > MAX_ROWS) throw new BadRequestException('Слишком большой прайс: максимум 10 000 строк');
  }
  // Never silently treat an OCR scan or ambiguous PDF layout as the complete catalog.
  const looksComplete = rows.length >= 1 && !errors.length && lines.length <= rows.length * 3 + 10;
  if (!looksComplete) return { format: 'pdf', status: 'NEEDS_TEMPLATE', rows: [], errors: [
    'PDF сохранится как оригинал. Таблицу невозможно надёжно распознать полностью: перенесите её в шаблон Excel.',
  ] };
  return { format: 'pdf', status: 'READY', rows, errors: [] };
}
function validFile(file: SupplierFile): 'xlsx' | 'pdf' {
  if (!file?.buffer || !file.size || file.size > MAX_FILE || file.buffer.length !== file.size) {
    throw new BadRequestException('Выберите файл Excel или PDF размером до 8 МБ');
  }
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.xlsx') && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b) return 'xlsx';
  if (name.endsWith('.pdf') && file.buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  throw new BadRequestException('Поддерживаются Excel .xlsx и PDF. Для .xls используйте шаблон .xlsx');
}

@Injectable()
export class InventoryCounterpartyService {
  constructor(private readonly prisma: PrismaService, private readonly access: SaasAccessService) {}

  private async requireAccess(tenantId: string) {
    const right = await this.access.resolveCapability(tenantId, 'inventory.counterparties.access');
    if (!right.enabled) throw new ForbiddenException('Контрагенты недоступны для аккаунта');
  }
  private async company(tenantId: string, counterpartyId: string) {
    const value = await this.prisma.inventoryCounterparty.findFirst({
      where: { id: counterpartyId, tenantId, archivedAt: null },
    });
    if (!value) throw new NotFoundException('Контрагент не найден');
    return value;
  }
  async list(tenantId: string) {
    await this.requireAccess(tenantId);
    return this.prisma.inventoryCounterparty.findMany({
      where: { tenantId, archivedAt: null }, orderBy: { name: 'asc' },
      include: { priceLists: { select: { id: true, revision: true, filename: true, format: true,
        parserStatus: true, createdAt: true, _count: { select: { rows: true } } }, orderBy: { revision: 'desc' } } },
    });
  }
  async create(tenantId: string, input: Record<string, unknown>) {
    await this.requireAccess(tenantId);
    const name = plain(input?.name).slice(0, 160);
    if (!name) throw new BadRequestException('Укажите название контрагента');
    const kinds = ['SUPPLIER','MANUFACTURER','DISTRIBUTOR','MARKETPLACE','STORE','OTHER'];
    const kind = plain(input?.kind).toUpperCase() || 'SUPPLIER';
    if (!kinds.includes(kind)) throw new BadRequestException('Неизвестный тип контрагента');
    return this.prisma.inventoryCounterparty.create({ data: { tenantId, name, kind,
      contactName: plain(input?.contactName).slice(0, 160),
      phone: plain(input?.phone).slice(0, 100), email: plain(input?.email).slice(0, 254),
      website: plain(input?.website).slice(0, 500), note: plain(input?.note).slice(0, 2000) } });
  }
  async update(tenantId: string, id: string, input: Record<string, unknown>) {
    await this.requireAccess(tenantId);
    await this.company(tenantId, id);
    const allowed = ['name','kind','contactName','phone','email','website','note'] as const;
    const changes: Record<string, string> = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
      changes[key] = plain(input[key]).slice(0, key === 'note' ? 2000 : key === 'website' ? 500 : 254);
    }
    if ('name' in changes && !changes.name) throw new BadRequestException('Название не может быть пустым');
    if ('kind' in changes) {
      changes.kind = changes.kind.toUpperCase();
      if (!['SUPPLIER','MANUFACTURER','DISTRIBUTOR','MARKETPLACE','STORE','OTHER'].includes(changes.kind)) throw new BadRequestException('Неизвестный тип');
    }
    await this.prisma.inventoryCounterparty.updateMany({ where: { tenantId, id, archivedAt: null }, data: changes });
    return this.company(tenantId, id);
  }
  async template(tenantId: string) {
    await this.requireAccess(tenantId);
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Прайс');
    sheet.addRow(['Артикул','Наименование','Производитель','Цена','Цена закупки','Скидка %','Единица','В упаковке','Штрихкод']);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).height = 28;
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (let n = 1; n <= 9; n++) sheet.getColumn(n).width = [23,48,28,18,20,16,16,18,25][n-1];
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  private async parsed(file: SupplierFile): Promise<Parsed> {
    const format = validFile(file);
    return format === 'xlsx' ? parseExcel(file.buffer) : parsePdf(file.buffer);
  }
  async preview(tenantId: string, id: string, file: SupplierFile) {
    await this.requireAccess(tenantId);
    await this.company(tenantId, id);
    const parsed = await this.parsed(file);
    return { format: parsed.format, status: parsed.status, count: parsed.rows.length,
      sample: parsed.rows.slice(0, 30), errors: parsed.errors.slice(0, 30) };
  }
  async import(tenantId: string, id: string, file: SupplierFile, confirmedPdf = false) {
    await this.requireAccess(tenantId);
    await this.company(tenantId, id);
    const parsed = await this.parsed(file);
    if (parsed.format === 'pdf' && parsed.status === 'READY' && !confirmedPdf) {
      throw new BadRequestException('Перед импортом PDF проверьте распознанные строки в предпросмотре');
    }
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const previous = await this.prisma.inventoryCounterpartyPriceList.findFirst({
      where: { tenantId, counterpartyId: id, sha256: hash }, select: { id: true, revision: true, parserStatus: true },
    });
    if (previous) return { ...previous, duplicate: true };
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${id}))) AS guard`; 
      const last = await tx.inventoryCounterpartyPriceList.findFirst({
        where: { tenantId, counterpartyId: id }, orderBy: { revision: 'desc' }, select: { revision: true },
      });
      const list = await tx.inventoryCounterpartyPriceList.create({
        data: { tenantId, counterpartyId: id, revision: (last?.revision || 0) + 1,
          filename: file.originalname.slice(0, 250), format: parsed.format, sha256: hash,
          parserStatus: parsed.status, sourceFile: Uint8Array.from(file.buffer) },
      });
      for (let i = 0; i < parsed.rows.length; i += 500) {
        await tx.inventoryCounterpartyCatalogItem.createMany({
          data: parsed.rows.slice(i, i + 500).map((row) => ({ ...row,
            tenantId, priceListId: list.id })),
        });
      }
      return { id: list.id, revision: list.revision, parserStatus: list.parserStatus,
        count: parsed.rows.length, errors: parsed.errors };
    }, { timeout: 45000 });
  }
  async catalog(tenantId: string, id: string, search = '', skip = 0) {
    await this.requireAccess(tenantId);
    await this.company(tenantId, id);
    const list = await this.prisma.inventoryCounterpartyPriceList.findFirst({
      where: { tenantId, counterpartyId: id, parserStatus: 'READY' }, orderBy: { revision: 'desc' },
      select: { id: true, revision: true, filename: true, createdAt: true },
    });
    if (!list) return { priceList: null, count: 0, items: [] };
    const condition = { tenantId, priceListId: list.id,
      ...(search.trim() ? { OR: [
        { name: { contains: search.trim(), mode: 'insensitive' as const } },
        { supplierSku: { contains: search.trim(), mode: 'insensitive' as const } },
        { manufacturer: { contains: search.trim(), mode: 'insensitive' as const } },
      ] } : {}),
    };
    const [count, items] = await Promise.all([
      this.prisma.inventoryCounterpartyCatalogItem.count({ where: condition }),
      this.prisma.inventoryCounterpartyCatalogItem.findMany({
        where: condition, orderBy: { position: 'asc' },
        skip: Math.max(0, Math.min(Number(skip)||0, 100000)), take: 100,
      }),
    ]);
    return { priceList: list, count, items };
  }
  async original(tenantId: string, id: string, priceListId: string) {
    await this.requireAccess(tenantId);
    await this.company(tenantId, id);
    const list = await this.prisma.inventoryCounterpartyPriceList.findFirst({
      where: { tenantId, counterpartyId: id, id: priceListId },
    });
    if (!list) throw new NotFoundException('Прайс-лист не найден');
    return { filename: list.filename, mime: list.format === 'pdf' ? 'application/pdf' : XLSX_MIME,
      buffer: Buffer.from(list.sourceFile) };
  }
  async linkCompany(tenantId: string, id: string, itemId: string) {
    await this.requireAccess(tenantId);
    const company = await this.company(tenantId, id);
    const item = await this.prisma.inventoryItem.findFirst({ where: { tenantId, itemId, archivedAt: null } });
    if (!item) throw new NotFoundException('Рабочая карточка не найдена');
    const existing = await this.prisma.inventorySupplierOffer.findFirst({
      where: { tenantId, inventoryItemId: item.id, counterpartyId: id, catalogItemId: null, isActive: true },
    });
    if (existing) return { offerId: existing.offerId, itemId };
    const offerId = randomUUID();
    await this.prisma.inventorySupplierOffer.create({
      data: { tenantId, inventoryItemId: item.id, offerId, supplier: company.name,
        counterpartyId: id, unitsPerOffer: item.packageQuantity || 1, isActive: true },
    });
    return { offerId, itemId };
  }
  async link(tenantId: string, id: string, rowId: string, itemId: string) {
    await this.requireAccess(tenantId);
    const company = await this.company(tenantId, id);
    const [row, item] = await Promise.all([
      this.prisma.inventoryCounterpartyCatalogItem.findFirst({
        where: { id: rowId, tenantId, priceList: { counterpartyId: id, parserStatus: 'READY' } },
      }),
      this.prisma.inventoryItem.findFirst({ where: { tenantId, itemId, archivedAt: null } }),
    ]);
    if (!row) throw new NotFoundException('Позиция прайса не найдена');
    if (!item) throw new NotFoundException('Рабочая карточка не найдена');
    const existing = await this.prisma.inventorySupplierOffer.findFirst({
      where: { tenantId, inventoryItemId: item.id, counterpartyId: id, isActive: true,
        ...(row.supplierSku ? { supplierSku: row.supplierSku } : { catalogItemId: row.id }) },
    });
    const sameUnit = Boolean(row.unit) && row.unit.trim().toLowerCase() === item.unit.trim().toLowerCase();
    const size = sameUnit && row.packageQuantity != null && Number(row.packageQuantity) > 0
      ? Number(row.packageQuantity)
      : item.packageQuantity != null && Number(item.packageQuantity) > 0
        ? Number(item.packageQuantity) : 1;
    const fields = { supplier: company.name, counterpartyId: id, catalogItemId: row.id,
      listPrice: row.listPrice, actualPrice: row.actualPrice,
      discountPercent: row.discountPercent, supplierSku: row.supplierSku,
      unitsPerOffer: size };
    if (existing) {
      await this.prisma.inventorySupplierOffer.update({ where: { id: existing.id }, data: fields });
      return { offerId: existing.offerId, itemId };
    }
    const offerId = randomUUID();
    await this.prisma.inventorySupplierOffer.create({
      data: { tenantId, inventoryItemId: item.id, offerId, ...fields },
    });
    return { offerId, itemId };
  }
}
