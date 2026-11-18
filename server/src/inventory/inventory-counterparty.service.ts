import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma.service';
import { SaasAccessService } from '../saas-access/saas-access.service';

export type SupplierFile = { originalname: string; buffer: Buffer; size: number };
type Row = {
  position: number; supplierSku: string; name: string; manufacturer: string;
  brand: string; category: string; supplierNote: string; sourceSheet: string; sourceRow: number | null;
  supplierAvailable: boolean | null; barcode: string; unit: string; packageQuantity: number | null;
  listPrice: number | null; retailPrice: number | null; suggestedOrderQuantity: number | null;
  actualPrice: number | null; discountPercent: number | null;
};
type Parsed = { format: 'xlsx' | 'pdf'; status: 'READY' | 'NEEDS_TEMPLATE'; rows: Row[]; errors: string[]; terms?: string; supplierName?: string };

const MAX_FILE = 8 * 1024 * 1024;
const MAX_ROWS = 10000;
const COLUMNS = [
  'supplierSku','name','manufacturer','brand','category','supplierNote',
  'supplierAvailable','listPrice','retailPrice','actualPrice','discountPercent',
  'unit','packageQuantity','barcode','suggestedOrderQuantity',
] as const;
type Column = typeof COLUMNS[number];
const HEADERS: Record<Column, string[]> = {
  supplierSku: ['артикул','артикул поставщика','код товара','код продукта','sku','article','item code'],
  name: ['наименование','наименование товара','название','название товара','номенклатура','товар','продукт','product','description','name'],
  manufacturer: ['производитель','manufacturer'],
  brand: ['бренд','марка','brand'],
  category: ['категория','группа','раздел','category'],
  supplierNote: ['комментарии','комментарий','примечание','описание','новинка','note'],
  supplierAvailable: ['есть нет на складе','наличие у поставщика','наличие','доступность','есть нет','availability','in stock'],
  listPrice: ['цена','прайс','прайсовая цена','цена прайс','цена руб','цена бцо','бцо','оптовая цена','base price','wholesale','price','list price'],
  retailPrice: ['ррц','цена ррц','розничная цена','рекомендованная розничная цена','retail price','msrp'],
  actualPrice: ['цена закупки','цена со скидкой','фактическая цена','закупочная цена','purchase price'],
  discountPercent: ['скидка','скидка %','discount','discount %'],
  unit: ['единица','ед изм','единица измерения','ед','unit'],
  packageQuantity: ['в упаковке','количество в упаковке','номинал','фасовка','упаковка','package quantity'],
  barcode: ['штрихкод','штрих код','ean','barcode'],
  suggestedOrderQuantity: ['кол во штук','количество заказа','количество штук','количество','qty','order quantity'],
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
  return plain(value).toLocaleLowerCase('ru-RU').replace(/[.,:;()№*/\\-]/g, ' ').replace(/\s+/g, ' ').trim();
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
function supplierAvailability(value: unknown): boolean | null {
  const raw = normal(value);
  if (['да','есть','в наличии','доступен','доступно','1','yes','true'].includes(raw)) return true;
  if (['нет','отсутствует','нет в наличии','нет на складе','0','no','false'].includes(raw)) return false;
  return null;
}

function mapRow(values: Record<Column, unknown>, position: number, errors: string[],
  meta: { brand?: string; category?: string; sourceSheet?: string; sourceRow?: number } = {}): Row | null {
  const name = plain(values.name).slice(0, 300);
  if (!name) { errors.push('Строка ' + position + ': нет наименования'); return null; }
  const size = amount(values.packageQuantity, 'В упаковке', position, errors);
  if (size !== null && size <= 0) errors.push('Строка ' + position + ': количество в упаковке должно быть больше нуля');
  return {
    position, name,
    supplierSku: plain(values.supplierSku).slice(0, 160),
    manufacturer: plain(values.manufacturer).slice(0, 160),
    brand: (plain(values.brand) || meta.brand || '').slice(0, 160),
    category: (plain(values.category) || meta.category || '').slice(0, 200),
    supplierNote: plain(values.supplierNote).slice(0, 2000),
    sourceSheet: (meta.sourceSheet || '').slice(0, 160),
    sourceRow: meta.sourceRow ?? null,
    supplierAvailable: supplierAvailability(values.supplierAvailable),
    barcode: plain(values.barcode).slice(0, 160),
    unit: plain(values.unit).slice(0, 24),
    packageQuantity: size && size > 0 ? size : null,
    listPrice: amount(values.listPrice, 'Цена БЦО/прайса', position, errors),
    retailPrice: normal(values.retailPrice) === 'не для продажи'
      ? null : amount(values.retailPrice, 'РРЦ', position, errors),
    suggestedOrderQuantity: amount(values.suggestedOrderQuantity, 'Количество для заказа', position, errors),
    actualPrice: amount(values.actualPrice, 'Моя закупочная цена', position, errors),
    discountPercent: amount(values.discountPercent, 'Скидка', position, errors, 100),
  };
}

function detectColumn(label: string): Column | null {
  if (/(?:^| )бцо(?: |$)|базов.*цен/i.test(label)) return 'listPrice';
  if (/(?:^| )ррц(?: |$)|рекомендованн.*рознич/i.test(label)) return 'retailPrice';
  for (const key of COLUMNS) if (HEADERS[key].some((name) => normal(name) === label)) return key;
  return null;
}

async function parseExcel(data: Buffer): Promise<Parsed> {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(data as any); }
  catch { return { format: 'xlsx', status: 'NEEDS_TEMPLATE', rows: [], errors: ['Не удалось прочитать Excel. Используйте шаблон .xlsx.'] }; }
  const rows: Row[] = [], errors: string[] = [], terms: string[] = [];
  const supplierNames = new Set<string>();
  // An order form can have hidden lookup/helper sheets. Choose the actual priced
  // supplier sheets, never import auxiliary SKU lists as additional products.
  const definitions = workbook.worksheets.map((sheet) => {
    let header = 0;
    let mapping: Partial<Record<Column, number>> = {};
    for (let n = 1; n <= Math.min(30, sheet.rowCount); n++) {
      const candidate: Partial<Record<Column, number>> = {};
      sheet.getRow(n).eachCell({ includeEmpty: false }, (cell, index) => {
        const key = detectColumn(normal(cell.value));
        if (key && candidate[key] == null) candidate[key] = index;
      });
      if (candidate.name && (candidate.listPrice || candidate.retailPrice || candidate.actualPrice || candidate.supplierSku)) {
        header = n; mapping = candidate; break;
      }
    }
    return { sheet, header, mapping, priced: Boolean(mapping.listPrice || mapping.retailPrice || mapping.actualPrice) };
  });
  const priced = definitions.some(d => d.header && d.priced);
  const eligible = definitions.filter(d => d.header && (!priced || d.priced));
  if (!eligible.length) {
    return { format: 'xlsx', status: 'NEEDS_TEMPLATE', rows: [], errors: [
      'Не найдены колонки наименования и цены/артикула. Перенесите данные в шаблон Excel.',
    ] };
  }
  for (const { sheet, header, mapping } of eligible) {
    let brand = '', category = '';
    let sheetSupplier = '';
    const headerCells = sheet.getRow(header);
    let supplierColumn = 0;
    headerCells.eachCell({ includeEmpty: false }, (cell, index) => {
      if (['контрагент', 'поставщик', 'supplier'].includes(normal(cell.value)))
        supplierColumn = index;
    });
    for (let n = 1; n < header; n++) {
      sheet.getRow(n).eachCell({ includeEmpty: false }, (cell) => {
        const phrase = plain(cell.value);
        if (/минимальн.*сумм.*заказ/i.test(phrase)) terms.push(sheet.name + ': ' + phrase.slice(0, 500));
        const inlineSupplier = phrase.match(/^(?:контрагент|поставщик|supplier)\s*[:：]\s*(.+)$/i);
        if (inlineSupplier) sheetSupplier = inlineSupplier[1].trim().slice(0, 160);
        else if (/^(?:контрагент|поставщик|supplier)\s*[:：]?$/i.test(phrase)) {
          const next = plain(sheet.getRow(n).getCell(cell.col + 1).value);
          if (next) sheetSupplier = next.slice(0, 160);
        }
      });
    }
    for (let n = header + 1; n <= sheet.rowCount; n++) {
      const source = sheet.getRow(n);
      if (supplierColumn) {
        const cellSupplier = plain(source.getCell(supplierColumn).value).slice(0, 160);
        if (cellSupplier) sheetSupplier = cellSupplier;
      }
      const values = Object.fromEntries(COLUMNS.map((key) =>
        [key, mapping[key] ? source.getCell(mapping[key]!).value : ''])) as Record<Column, unknown>;
      // Supplier's unlabeled helper column may mark a product as new.
      if (!values.supplierNote) {
        let newArrival = false;
        source.eachCell({ includeEmpty: false }, (cell) => {
          if (normal(cell.value) === 'новинка') newArrival = true;
        });
        if (newArrival) values.supplierNote = 'Новинка';
      }
      const name = plain(values.name);
      const sku = plain(values.supplierSku);
      const price = plain(values.listPrice) || plain(values.retailPrice) || plain(values.actualPrice);
      const barcode = plain(values.barcode);
      if (!name && !sku && !price && !barcode) continue;
      if (!barcode && !price && /^\d{1,3}[.)]\s*/.test(name)) {
        // Brand and numbered collection headings are not catalog items.
        if (sku) brand = sku.slice(0, 160);
        category = name.slice(0, 200);
        continue;
      }
      if (!sku && !barcode && !price) {
        // Text-only section heading, never an orderable product.
        if (name) category = name.slice(0, 200);
        continue;
      }
      if (!name) {
        errors.push('Лист «' + sheet.name + '», строка ' + n + ': отсутствует наименование');
        continue;
      }
      if (!sku && !barcode && !price) continue;
      const row = mapRow(values, rows.length + 1, errors, { brand, category, sourceSheet: sheet.name, sourceRow: n });
      if (row) {
        rows.push(row);
        if (sheetSupplier) supplierNames.add(sheetSupplier);
      }
      if (rows.length > MAX_ROWS) throw new BadRequestException('Слишком большой прайс: максимум 10 000 строк');
    }
  }
  if (!rows.length) errors.push('В файле нет строк товаров.');
  if (new Set([...supplierNames].map(value => normal(value))).size > 1)
    errors.push('В файле несколько поставщиков. Загрузите прайс каждого отдельно.');
  return { format: 'xlsx', status: errors.length ? 'NEEDS_TEMPLATE' : 'READY',
    rows: errors.length ? [] : rows, errors, terms: terms.join(' | ').slice(0, 3000),
    supplierName: supplierNames.size ? [...supplierNames][0] : '' };
}
async function parsePdf(data: Buffer): Promise<Parsed> {
  const parse: (data: Buffer, options?: Record<string, unknown>) => Promise<{ text: string; numpages: number }> = require('pdf-parse');
  let result: { text: string; numpages: number };
  try { result = await parse(data, { max: 100 }); }
  catch {
    // A scanned, unusual or extractor-incompatible PDF is still a valid
    // supplier original. Preserve it and request a structured Excel template;
    // never invent or silently drop catalog rows from a failed extraction.
    return { format: 'pdf', status: 'NEEDS_TEMPLATE', rows: [],
      errors: ['Не удалось извлечь таблицу из PDF. Оригинал будет сохранён; для каталога используйте шаблон Excel.'] };
  }
  if (result.numpages > 100) throw new BadRequestException('PDF: максимум 100 страниц');
  const errors: string[] = [], rows: Row[] = [];
  // PDF is not a table format. Parse only lines with a clearly separated final price.
  const lines = result.text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  for (let n = 0; n < lines.length; n++) {
    const match = lines[n].match(/^(?:(\S+)\s{2,})?(.{3,}?)\s{2,}(\d[\d\s.,]*)\s*(?:₽|руб\.?)?$/i);
    if (!match) continue;
    const row = mapRow({ supplierSku: match[1] || '', name: match[2], listPrice: match[3],
      manufacturer: '', brand: '', category: '', supplierNote: '', supplierAvailable: '',
      barcode: '', unit: '', packageQuantity: '', retailPrice: '', suggestedOrderQuantity: '',
      actualPrice: '', discountPercent: '' }, n + 1, errors);
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

  private discount(value: unknown): number | null {
    if (value == null || String(value).trim() === '') return null;
    const result = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(result) || result < 0 || result > 100)
      throw new BadRequestException('Скидка должна быть от 0 до 100%.');
    return Math.round(result * 10000) / 10000;
  }

  private nonnegativePrice(value: unknown): number | null {
    if (value == null || String(value).trim() === '') return null;
    const result = Number(String(value).replace(',', '.'));
    if (!Number.isFinite(result) || result < 0 || result > 1e9)
      throw new BadRequestException('Цена должна быть неотрицательной.');
    return Math.round((result + Number.EPSILON) * 100) / 100;
  }

  private appliedDiscount(row: {discountPercent?: unknown}, agreement: unknown): number {
    return Number(row.discountPercent ?? agreement ?? 0);
  }

  private catalogView<T extends {listPrice?: unknown;discountPercent?: unknown}>(row: T, agreement: unknown) {
    const discount = this.appliedDiscount(row, agreement);
    const price = row.listPrice == null ? null : Number(row.listPrice);
    return {
      ...row,
      appliedDiscountPercent: discount,
      effectivePrice: price == null ? null : Math.round((price * (1 - discount / 100) + Number.EPSILON) * 100) / 100,
      discountSource: row.discountPercent != null ? 'product' : agreement != null ? 'agreement' : 'none',
    };
  }

  private async latestCatalogInTx(tx: any, tenantId: string, id: string) {
    const latest = await tx.inventoryCounterpartyPriceList.findFirst({
      where: { tenantId, counterpartyId: id, parserStatus: 'READY' },
      orderBy: { revision: 'desc' }, select: { id: true },
    });
    if (!latest) throw new NotFoundException('Ассортимент не найден.');
    return latest;
  }

  private async refreshOfferForRow(tx: any, tenantId: string, id: string,
    row: {id: string; supplierSku: string; listPrice: unknown; discountPercent: unknown}, agreement: unknown) {
    await tx.inventorySupplierOffer.updateMany({
      where: { tenantId, counterpartyId: id, catalogItemId: row.id, isActive: true },
      data: { listPrice: row.listPrice as any, supplierSku: row.supplierSku,
        discountPercent: this.appliedDiscount(row, agreement), agreementPriced: true },
    });
  }

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
      website: plain(input?.website).slice(0, 500), note: plain(input?.note).slice(0, 2000),
      discountPercent: this.discount(input?.discountPercent) } });
  }
  async update(tenantId: string, id: string, input: Record<string, unknown>) {
    await this.requireAccess(tenantId);
    await this.company(tenantId, id);
    const allowed = ['name','kind','contactName','phone','email','website','note'] as const;
    const changes: Record<string, any> = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
      changes[key] = plain(input[key]).slice(0, key === 'note' ? 2000 : key === 'website' ? 500 : 254);
    }
    if ('name' in changes && !changes.name) throw new BadRequestException('Название не может быть пустым');
    if ('kind' in changes) {
      changes.kind = changes.kind.toUpperCase();
      if (!['SUPPLIER','MANUFACTURER','DISTRIBUTOR','MARKETPLACE','STORE','OTHER'].includes(changes.kind)) throw new BadRequestException('Неизвестный тип');
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, 'discountPercent')) {
      changes.discountPercent = this.discount(input.discountPercent);
    }
    if (!Object.prototype.hasOwnProperty.call(changes, 'discountPercent')) {
      await this.prisma.inventoryCounterparty.updateMany({ where: { tenantId, id, archivedAt: null }, data: changes });
      return this.company(tenantId, id);
    }
    // An agreement change affects future offers, not already-paid invoices or receipts.
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}),hashtext(${id}))) AS guard`;
      await tx.inventoryCounterparty.updateMany({ where: { tenantId, id, archivedAt: null }, data: changes });
      const latest = await tx.inventoryCounterpartyPriceList.findFirst({
        where: { tenantId, counterpartyId: id, parserStatus: 'READY' },
        orderBy: { revision: 'desc' }, select: { id: true },
      });
      if (!latest) return;
      const rows = await tx.inventoryCounterpartyCatalogItem.findMany({
        where: { tenantId, priceListId: latest.id, excludedAt: null },
        select: { id: true, discountPercent: true },
      });
      const grouped = new Map<number, string[]>();
      for (const row of rows) {
        const applied = this.appliedDiscount(row, changes.discountPercent);
        const ids = grouped.get(applied) || [];
        ids.push(row.id); grouped.set(applied, ids);
      }
      for (const [discountPercent, ids] of grouped) {
        await tx.inventorySupplierOffer.updateMany({
          where: { tenantId, counterpartyId: id, isActive: true, catalogItemId: { in: ids } },
          data: { discountPercent, agreementPriced: true },
        });
      }
    }, { timeout: 60000 });
    return this.company(tenantId, id);
  }
  async template(tenantId: string) {
    await this.requireAccess(tenantId);
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Прайс');
    sheet.addRow(['Контрагент','Артикул','Наименование','Производитель','Бренд','Категория','Есть/нет на складе','БЦО','РРЦ',
      'Цена закупки','Скидка %','Единица','В упаковке','Штрихкод','Новинка','Кол-во штук']);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).height = 28;
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (let n = 1; n <= 16; n++) sheet.getColumn(n).width = [28,23,48,28,22,24,20,18,18,20,16,16,18,25,16,18][n-1];
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
  // Only unambiguous identifiers allow excluded choices to survive a new file revision.
  // Ambiguous rows remain excluded in their original revision, never auto-excluded elsewhere.
  private excludedFromPrevious(previous: Array<{supplierSku: string; barcode: string; excludedAt: Date | null}>, current: Row[]) {
    const key = (value: unknown) => plain(value).toLocaleUpperCase('ru-RU');
    const counts = (values: string[]) => {
      const seen = new Map<string, number>();
      values.filter(Boolean).forEach(value => seen.set(value, (seen.get(value) || 0) + 1));
      return seen;
    };
    const oldSku = counts(previous.map(row => key(row.supplierSku)));
    const oldBarcode = counts(previous.map(row => key(row.barcode)));
    const newSku = counts(current.map(row => key(row.supplierSku)));
    const newBarcode = counts(current.map(row => key(row.barcode)));
    const bySku = new Map(previous.map(row => [key(row.supplierSku), row]));
    const byBarcode = new Map(previous.map(row => [key(row.barcode), row]));
    return current.map(row => {
      const sku = key(row.supplierSku), barcode = key(row.barcode);
      const candidates = new Set<typeof previous[number]>();
      if (sku && oldSku.get(sku) === 1 && newSku.get(sku) === 1)
        candidates.add(bySku.get(sku)!);
      if (barcode && oldBarcode.get(barcode) === 1 && newBarcode.get(barcode) === 1)
        candidates.add(byBarcode.get(barcode)!);
      if (candidates.size !== 1) return null;
      const old = [...candidates][0];
      // A changed barcode with unchanged SKU can mean an entirely different product.
      if (sku && key(old.supplierSku) === sku && barcode && old.barcode
        && key(old.barcode) !== barcode) return null;
      return old.excludedAt || null;
    });
  }

  async setExcluded(tenantId: string, id: string, body: { rowIds?: string[]; excluded?: boolean }) {
    await this.requireAccess(tenantId);
    await this.company(tenantId, id);
    const ids = Array.isArray(body?.rowIds) ? [...new Set(body.rowIds)] : [];
    if (!ids.length || ids.length > 10000 || ids.some(value => typeof value !== 'string' || !value.trim()))
      throw new BadRequestException('Выберите позиции ассортимента');
    if (typeof body?.excluded !== 'boolean')
      throw new BadRequestException('Не указано действие');
    return this.prisma.$transaction(async tx => {
      const latest = await tx.inventoryCounterpartyPriceList.findFirst({
        where: { tenantId, counterpartyId: id, parserStatus: 'READY' },
        orderBy: { revision: 'desc' }, select: { id: true },
      });
      if (!latest) throw new NotFoundException('Ассортимент не найден');
      const where = { tenantId, priceListId: latest.id, id: { in: ids } };
      const found = await tx.inventoryCounterpartyCatalogItem.count({ where });
      if (found !== ids.length) throw new BadRequestException('Выбор устарел. Обновите ассортимент.');
      await tx.inventoryCounterpartyCatalogItem.updateMany({
        where, data: { excludedAt: body.excluded ? new Date() : null },
      });
      return { updated: ids.length, excluded: body.excluded };
    });
  }

  private async saveParsedInTx(tx: any, tenantId: string, id: string,
    file: SupplierFile, parsed: Parsed, company: { discountPercent?: unknown }) {
    const hash = createHash('sha256').update(file.buffer).digest('hex');

      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${id}))) AS guard) AS guard`;
      const duplicate = await tx.inventoryCounterpartyPriceList.findFirst({
        where: { tenantId, counterpartyId: id, sha256: hash },
        select: { id: true, revision: true, parserStatus: true },
      });
      if (duplicate) return { ...duplicate, duplicate: true };
      const last = await tx.inventoryCounterpartyPriceList.findFirst({
        where: { tenantId, counterpartyId: id }, orderBy: { revision: 'desc' }, select: { revision: true },
      });
      const previousReady = parsed.status === 'READY'
        ? await tx.inventoryCounterpartyPriceList.findFirst({
            where: { tenantId, counterpartyId: id, parserStatus: 'READY' },
            orderBy: { revision: 'desc' }, select: { id: true },
          }) : null;
      const prior = previousReady ? await tx.inventoryCounterpartyCatalogItem.findMany({
        where: { tenantId, priceListId: previousReady.id },
        select: { supplierSku: true, barcode: true, excludedAt: true },
      }) : [];
      const inheritedExcluded = this.excludedFromPrevious(prior, parsed.rows);
      const list = await tx.inventoryCounterpartyPriceList.create({
        data: { tenantId, counterpartyId: id, revision: (last?.revision || 0) + 1,
          filename: file.originalname.slice(0, 250), format: parsed.format, sha256: hash,
          parserStatus: parsed.status, terms: parsed.terms || '', sourceFile: Uint8Array.from(file.buffer) },
      });
      for (let i = 0; i < parsed.rows.length; i += 500) {
        await tx.inventoryCounterpartyCatalogItem.createMany({
          data: parsed.rows.slice(i, i + 500).map((row, offset) => ({ ...row,
            tenantId, priceListId: list.id, excludedAt: inheritedExcluded[i + offset] })),
        });
      }
      // Refresh only explicitly connected offers with unique supplier SKU.
      // Price-list updates must never alter historical receipts, lots or purchase documents.
      if (parsed.status === 'READY') {
        const skuCounts = new Map<string, number>();
        for (const row of parsed.rows) {
          if (row.supplierSku) skuCounts.set(row.supplierSku, (skuCounts.get(row.supplierSku) || 0) + 1);
        }
        const uniqueSkus = [...skuCounts].filter(([, count]) => count === 1).map(([sku]) => sku);
        if (uniqueSkus.length) {
          const [catalogRows, linkedOffers] = await Promise.all([
            tx.inventoryCounterpartyCatalogItem.findMany({
              where: { tenantId, priceListId: list.id, supplierSku: { in: uniqueSkus } },
              select: { id: true, supplierSku: true, listPrice: true, actualPrice: true, discountPercent: true },
            }),
            tx.inventorySupplierOffer.findMany({
              where: { tenantId, counterpartyId: id, isActive: true,
                catalogItemId: { not: null }, supplierSku: { in: uniqueSkus } },
              select: { id: true, supplierSku: true, agreementPriced: true },
            }),
          ]);
          const current = new Map(catalogRows.map((row) => [row.supplierSku, row]));
          for (const offer of linkedOffers) {
            const row = current.get(offer.supplierSku);
            if (!row) continue;
            await tx.inventorySupplierOffer.update({
              where: { id: offer.id }, data: {
                catalogItemId: row.id, listPrice: row.listPrice,
                ...(offer.agreementPriced
                  ? { discountPercent: this.appliedDiscount(row, company.discountPercent) }
                  : {}),
                // Keep legacy manual prices unchanged until the agreement is configured.
                // Invoice / movement history is never re-priced.
              },
            });
          }
        }
      }
      return { id: list.id, revision: list.revision, parserStatus: list.parserStatus,
        count: parsed.rows.length, errors: parsed.errors };
  }

  async previewGlobal(tenantId: string, file: SupplierFile) {
    await this.requireAccess(tenantId);
    const parsed = await this.parsed(file);
    const matches = parsed.supplierName
      ? await this.prisma.inventoryCounterparty.findMany({
        where: { tenantId, archivedAt: null,
          name: { equals: parsed.supplierName, mode: 'insensitive' } },
        select: { id: true, name: true },
      }) : [];
    return { format: parsed.format, status: parsed.status, count: parsed.rows.length,
      sample: parsed.rows.slice(0, 30), errors: parsed.errors.slice(0, 30),
      supplierName: parsed.supplierName || '',
      matchedCounterpartyId: matches.length === 1 ? matches[0].id : null,
      ambiguousMatch: matches.length > 1 };
  }

  async importGlobal(tenantId: string, file: SupplierFile,
    options: { counterpartyId?: string; name?: string; confirmedPdf?: boolean } = {}) {
    await this.requireAccess(tenantId);
    const parsed = await this.parsed(file);
    if (parsed.status !== 'READY' || !parsed.rows.length)
      throw new BadRequestException(parsed.errors[0] || 'Не удалось распознать прайс. Используйте шаблон Excel.');
    if (parsed.format === 'pdf' && !options.confirmedPdf)
      throw new BadRequestException('Подтвердите распознанный PDF перед загрузкой.');
    const selectedId = plain(options.counterpartyId);
    const name = (plain(options.name) || plain(parsed.supplierName)).slice(0, 160);
    if (!selectedId && !name)
      throw new BadRequestException('Укажите поставщика или выберите существующего.');
    return this.prisma.$transaction(async tx => {
      let company: { id: string; name: string; discountPercent?: unknown };
      let createdCompany = false;
      if (selectedId) {
        const found = await tx.inventoryCounterparty.findFirst({
          where: { id: selectedId, tenantId, archivedAt: null },
        });
        if (!found) throw new NotFoundException('Выбранный контрагент не найден.');
        company = found;
      } else {
        // Serialise matching names per account: simultaneous imports cannot create duplicates.
        const key = name.toLocaleLowerCase('ru-RU');
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${key}))`;
        const found = await tx.inventoryCounterparty.findMany({
          where: { tenantId, archivedAt: null, name: { equals: name, mode: 'insensitive' } },
        });
        if (found.length > 1)
          throw new BadRequestException('Найдено несколько контрагентов с этим названием. Выберите нужного.');
        if (found.length) company = found[0];
        else {
          company = await tx.inventoryCounterparty.create({
            data: { tenantId, name, kind: 'SUPPLIER' },
          });
          createdCompany = true;
        }
      }
      const imported = await this.saveParsedInTx(tx, tenantId, company.id, file, parsed, company);
      return { ...imported, counterpartyId: company.id, counterpartyName: company.name, createdCompany };
    }, { timeout: 60000 });
  }

  async import(tenantId: string, id: string, file: SupplierFile, confirmedPdf = false) {
    await this.requireAccess(tenantId);
    const company = await this.company(tenantId, id);
    const parsed = await this.parsed(file);
    if (parsed.format === 'pdf' && parsed.status === 'READY' && !confirmedPdf)
      throw new BadRequestException('Перед импортом PDF проверьте распознанные строки в предпросмотре');
    return this.prisma.$transaction(tx =>
      this.saveParsedInTx(tx, tenantId, id, file, parsed, company), { timeout: 45000 });
  }
  async catalog(tenantId: string, id: string, search = '', skip = 0, excluded = false) {
    await this.requireAccess(tenantId);
    await this.company(tenantId, id);
    const list = await this.prisma.inventoryCounterpartyPriceList.findFirst({
      where: { tenantId, counterpartyId: id, parserStatus: 'READY' }, orderBy: { revision: 'desc' },
      select: { id: true, revision: true, filename: true, createdAt: true },
    });
    if (!list) return { priceList: null, count: 0, items: [] };
    const condition = { tenantId, priceListId: list.id,
      excludedAt: excluded ? { not: null } : null,
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
    const company = await this.company(tenantId, id);
    return { priceList: list, count,
      items: items.map(row => this.catalogView(row, company.discountPercent)) };
  }
  async editCatalogRow(tenantId: string, id: string, rowId: string, input: Record<string, unknown>) {
    await this.requireAccess(tenantId);
    const company = await this.company(tenantId, id);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}),hashtext(${id}))) AS guard`;
      const latest = await this.latestCatalogInTx(tx, tenantId, id);
      const row = await tx.inventoryCounterpartyCatalogItem.findFirst({
        where: { tenantId, id: rowId, priceListId: latest.id, excludedAt: null },
      });
      if (!row) throw new NotFoundException('Позиция отсутствует в текущем прайсе.');
      const changes: Record<string, any> = {};
      const fields: Record<string, number> = {
        name: 300, manufacturer: 160, brand: 160, category: 200,
        supplierNote: 2000, supplierSku: 160, barcode: 160, unit: 24,
      };
      for (const [field, limit] of Object.entries(fields)) {
        if (Object.prototype.hasOwnProperty.call(input, field))
          changes[field] = plain(input[field]).slice(0, limit);
      }
      if ('name' in changes && !changes.name)
        throw new BadRequestException('Наименование поставщика не может быть пустым.');
      if (Object.prototype.hasOwnProperty.call(input, 'listPrice'))
        changes.listPrice = this.nonnegativePrice(input.listPrice);
      if (Object.prototype.hasOwnProperty.call(input, 'retailPrice'))
        changes.retailPrice = this.nonnegativePrice(input.retailPrice);
      if (Object.prototype.hasOwnProperty.call(input, 'discountPercent'))
        changes.discountPercent = this.discount(input.discountPercent);
      if (Object.prototype.hasOwnProperty.call(input, 'packageQuantity')) {
        const raw = input.packageQuantity;
        const quantity = raw == null || raw === '' ? null : Number(String(raw).replace(',', '.'));
        if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9))
          throw new BadRequestException('Неверный номинал поставщика.');
        changes.packageQuantity = quantity;
      }
      if (!Object.keys(changes).length) throw new BadRequestException('Нет изменений.');
      const updated = await tx.inventoryCounterpartyCatalogItem.update({
        where: { id: row.id }, data: changes,
      });
      if ('listPrice' in changes || 'discountPercent' in changes || 'supplierSku' in changes) {
        await this.refreshOfferForRow(tx, tenantId, id, updated, company.discountPercent);
      }
      return this.catalogView(updated, company.discountPercent);
    }, { timeout: 60000 });
  }

  async changeCatalogPrices(tenantId: string, id: string, input: {
    rowIds?: string[]; mode?: string; value?: number;
  }) {
    await this.requireAccess(tenantId);
    const company = await this.company(tenantId, id);
    const ids = Array.isArray(input?.rowIds) ? [...new Set(input.rowIds)] : [];
    if (!ids.length || ids.length > 1000 || ids.some(x => typeof x !== 'string' || !x))
      throw new BadRequestException('Выберите от 1 до 1000 позиций.');
    if (input.mode !== 'percent' && input.mode !== 'amount')
      throw new BadRequestException('Выберите изменение в процентах или рублях.');
    const value = Number(input.value);
    if (!Number.isFinite(value)
      || input.mode === 'percent' && (value < -100 || value > 1000)
      || input.mode === 'amount' && Math.abs(value) > 1e9)
      throw new BadRequestException('Проверьте размер изменения цены.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}),hashtext(${id}))) AS guard`;
      const latest = await this.latestCatalogInTx(tx, tenantId, id);
      const rows = await tx.inventoryCounterpartyCatalogItem.findMany({
        where: { tenantId, priceListId: latest.id, excludedAt: null, id: { in: ids } },
      });
      if (rows.length !== ids.length)
        throw new BadRequestException('Выбор устарел. Обновите ассортимент.');
      // Validate every price before changing any row; transaction rolls back on failure.
      const proposed = rows.map(row => {
        if (row.listPrice == null)
          throw new BadRequestException('У позиции «' + row.name + '» не указана цена.');
        const oldPrice = Number(row.listPrice);
        const changed = input.mode === 'percent' ? oldPrice * (1 + value / 100) : oldPrice + value;
        if (!Number.isFinite(changed) || changed < 0 || changed > 1e9)
          throw new BadRequestException('Некорректная новая цена: ' + row.name);
        return { row, price: Math.round((changed + Number.EPSILON) * 100) / 100 };
      });
      for (const { row, price } of proposed) {
        const updated = await tx.inventoryCounterpartyCatalogItem.update({
          where: { id: row.id }, data: { listPrice: price },
        });
        await this.refreshOfferForRow(tx, tenantId, id, updated, company.discountPercent);
      }
      return { updated: proposed.length };
    }, { timeout: 60000 });
  }

  // Canonical server-owned classification of supplier rows against working Stock.
  // Matching codes are suggestions only; only persisted offers are confirmed links.
  async linkStatuses(tenantId: string, id: string) {
    await this.requireAccess(tenantId);
    await this.company(tenantId, id);
    const latest = await this.prisma.inventoryCounterpartyPriceList.findFirst({
      where: { tenantId, counterpartyId: id, parserStatus: 'READY' },
      orderBy: { revision: 'desc' }, select: { id: true },
    });
    if (!latest) return { count: 0, statuses: [] };
    const [rows, items, offers] = await Promise.all([
      this.prisma.inventoryCounterpartyCatalogItem.findMany({
        where: { tenantId, priceListId: latest.id, excludedAt: null },
        select: { id: true, supplierSku: true, barcode: true },
      }),
      this.prisma.inventoryItem.findMany({
        where: { tenantId, archivedAt: null }, select: { id: true, itemId: true, sku: true, barcode: true },
      }),
      this.prisma.inventorySupplierOffer.findMany({
        where: { tenantId, counterpartyId: id, isActive: true, catalogItemId: { not: null } },
        select: { catalogItemId: true, inventoryItemId: true },
      }),
    ]);
    const norm = (value: unknown) => plain(value).toLocaleUpperCase('ru-RU');
    const index = <T>(values: T[], selector: (entry: T) => string) => {
      const result = new Map<string, T[]>();
      for (const entry of values) {
        const key = selector(entry);
        if (!key) continue;
        const set = result.get(key) || [];
        set.push(entry);
        result.set(key, set);
      }
      return result;
    };
    const rowBySku = index(rows, row => norm(row.supplierSku));
    const rowByBarcode = index(rows, row => norm(row.barcode));
    const itemBySku = index(items, row => norm(row.sku));
    const itemByBarcode = index(items, row => norm(row.barcode));
    const itemByDbId = new Map(items.map(row => [row.id, row]));
    const offerByRow = index(offers, row => row.catalogItemId || '');
    const statuses = rows.map(row => {
      const confirmed = [...new Set((offerByRow.get(row.id) || [])
        .map(offer => itemByDbId.get(offer.inventoryItemId)?.itemId).filter(Boolean))];
      if (confirmed.length === 1) return { catalogItemId: row.id,
        status: 'linked', itemId: confirmed[0] };
      if (confirmed.length > 1) return { catalogItemId: row.id,
        status: 'conflict', itemId: null };
      const candidates = new Set<string>();
      const sku = norm(row.supplierSku), barcode = norm(row.barcode);
      if (sku && rowBySku.get(sku)?.length === 1 && itemBySku.get(sku)?.length === 1)
        candidates.add(itemBySku.get(sku)![0].itemId);
      if (barcode && rowByBarcode.get(barcode)?.length === 1
        && itemByBarcode.get(barcode)?.length === 1)
        candidates.add(itemByBarcode.get(barcode)![0].itemId);
      if (candidates.size > 1) return { catalogItemId: row.id, status: 'conflict', itemId: null };
      if (candidates.size === 1) return { catalogItemId: row.id,
        status: 'matched', itemId: [...candidates][0] };
      return { catalogItemId: row.id, status: 'unlinked', itemId: null };
    });
    return { count: statuses.length, statuses };
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
  async link(tenantId: string, id: string, rowId: string, itemId: string, requestedUnits?: number) {
    await this.requireAccess(tenantId);
    const company = await this.company(tenantId, id);
    return this.prisma.$transaction(async tx => {
      // Serialise supplier-specific links to avoid duplicate offers from concurrent taps.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${id}))) AS guard`;
      const latest = await tx.inventoryCounterpartyPriceList.findFirst({
        where: { tenantId, counterpartyId: id, parserStatus: 'READY' },
        orderBy: { revision: 'desc' }, select: { id: true },
      });
      if (!latest) throw new NotFoundException('Ассортимент не найден');
      const [row, item] = await Promise.all([
        tx.inventoryCounterpartyCatalogItem.findFirst({
          where: { id: rowId, tenantId, priceListId: latest.id, excludedAt: null },
        }),
        tx.inventoryItem.findFirst({ where: { tenantId, itemId, archivedAt: null } }),
      ]);
      if (!row) throw new NotFoundException('Позиция не найдена в действующем ассортименте');
      if (!item) throw new NotFoundException('Карточка склада не найдена');
      const linkedRow = await tx.inventorySupplierOffer.findFirst({
        where: { tenantId, counterpartyId: id, catalogItemId: row.id, isActive: true },
      });
      if (linkedRow && linkedRow.inventoryItemId !== item.id)
        throw new BadRequestException('Эта позиция уже связана с другой карточкой склада.');

      const existing = linkedRow || await tx.inventorySupplierOffer.findFirst({
        where: { tenantId, inventoryItemId: item.id, counterpartyId: id, isActive: true,
          ...(row.supplierSku ? { supplierSku: row.supplierSku } : { catalogItemId: row.id }) },
      });
      const unit = (value: unknown) => plain(value).toLocaleLowerCase('ru-RU').replace(/\.$/, '');
      const supplierUnit = unit(row.unit), itemUnit = unit(item.unit);
      const explicit = requestedUnits == null ? null : Number(requestedUnits);
      if (explicit != null && (!Number.isFinite(explicit) || explicit <= 0 || explicit > 100000000))
        throw new BadRequestException('Количество учётных единиц в предложении должно быть положительным.');
      if (supplierUnit && supplierUnit !== itemUnit && explicit == null)
        throw new BadRequestException('Единицы поставщика и склада различаются. Укажите unitsPerOffer.');
      const supplierSize = row.packageQuantity == null ? 0 : Number(row.packageQuantity);
      const ownSize = item.packageQuantity == null ? 0 : Number(item.packageQuantity);
      const size = explicit
        ?? (supplierUnit === itemUnit && supplierSize > 0 ? supplierSize
          : ownSize > 0 ? ownSize
          : itemUnit === 'шт' ? 1 : null);
      if (size == null || !Number.isFinite(size) || size <= 0)
        throw new BadRequestException('Укажите unitsPerOffer для безопасной привязки.');
      const fields = { supplier: company.name, counterpartyId: id, catalogItemId: row.id,
        listPrice: row.listPrice, supplierSku: row.supplierSku,
        discountPercent: this.appliedDiscount(row, company.discountPercent),
        agreementPriced: row.listPrice != null,
        unitsPerOffer: size };
      if (existing) {
        await tx.inventorySupplierOffer.update({ where: { id: existing.id }, data: fields });
        return { offerId: existing.offerId, itemId };
      }
      const offerId = randomUUID();
      await tx.inventorySupplierOffer.create({
        data: { tenantId, inventoryItemId: item.id, offerId, ...fields,
          actualPrice: row.actualPrice },
      });
      return { offerId, itemId };
    });
  }
}
