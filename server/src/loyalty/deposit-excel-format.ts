import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

export const DEPOSIT_XLSX_MAX_ROWS = 3000;
export const DEPOSIT_XLSX_MAX_BYTES = 4 * 1024 * 1024;

// First twenty columns are the editable one-sheet contract. The rest are read-only export projections.
export const DEPOSIT_INPUT_COLUMNS = [
  'Депозит', 'Вид суммы', 'Номинал', 'Срок', 'С', 'По', 'Выгода', 'Выгода, %',
  'Условия', 'UEI программы',
  'Человек', 'Телефон', 'Код контакта', 'Номер карты',
  'Дата операции', 'Действие', 'Сумма', 'Кошелёк', 'Описание', 'ID операции',
];
export const DEPOSIT_EXPORT_COLUMNS = [
  'Остаток', 'К оплате', 'Источник', 'Кошелёк определён',
  'Связь с Журналом', 'Дата регистрации', 'ID записи',
];
export type DepositExcelRawRow = {
  row: number; programName: string; amountMode: string; nominal: string; termMode: string;
  termStartDate: string; termEndDate: string; benefitType: string; benefitPercent: string;
  description: string; programUei: string; personName: string; phone: string;
  personCode: string; cardKey: string; occurredAt: string; action: string;
  amount: string; wallet: string; note: string; externalOperationId: string;
};

function plain(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const o = value as Record<string, any>;
    if (o.text != null) return String(o.text).trim();
    if (o.result != null) return plain(o.result);
    if (Array.isArray(o.richText)) return o.richText.map(p => String(p?.text ?? '')).join('').trim();
    if (o.formula != null || o.sharedFormula != null) throw new BadRequestException('В шаблоне нельзя использовать формулы без готового значения');
  }
  return String(value).trim();
}

export function excelDay(raw: unknown): string {
  const value = plain(raw);
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(value + 'T12:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : '';
  }
  const match = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (match) {
    const year = match[3].length === 2 ? Number(match[3]) + (Number(match[3]) > 70 ? 1900 : 2000) : Number(match[3]);
    return excelDay(String(year).padStart(4, '0') + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0'));
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return excelDay(value.slice(0, 10));
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  return '';
}

function widths(index: number): number {
  return [24, 20, 16, 18, 13, 13, 22, 16, 31, 18, 24, 20, 18, 20,
    20, 17, 15, 20, 31, 24, 17, 17, 17, 22, 22, 22, 24][index] || 18;
}

export async function depositWorkbook(rows: Array<Array<string | number | Date | null>> = [], includeExport = false): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VA Tools';
  const sheet = workbook.addWorksheet('Депозиты', { views: [{ state: 'frozen', ySplit: 2, xSplit: 1 }] });
  const headers = includeExport ? [...DEPOSIT_INPUT_COLUMNS, ...DEPOSIT_EXPORT_COLUMNS] : DEPOSIT_INPUT_COLUMNS;
  for (let c = 1; c <= headers.length; c++) sheet.getColumn(c).width = widths(c - 1);
  const groups: Array<[number, number, string]> = [[1, 10, 'ДЕПОЗИТ'], [11, 14, 'ЧЕЛОВЕК'], [15, 20, 'ОПЕРАЦИЯ']];
  if (includeExport) groups.push([21, 27, 'РЕЗУЛЬТАТ · ТОЛЬКО ДЛЯ ПРОСМОТРА']);
  for (const [start, end, title] of groups) {
    sheet.mergeCells(1, start, 1, end);
    const cell = sheet.getCell(1, start);
    cell.value = title;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B2E33' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (let c = start + 1; c <= end; c++) sheet.getCell(1, c).fill = cell.fill;
  }
  sheet.getRow(1).height = 28;
  sheet.getRow(2).values = headers;
  sheet.getRow(2).height = 30;
  sheet.getRow(2).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9ECF0' } };
    cell.font = { bold: true, size: 10, color: { argb: 'FF22252A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } };
  const listValidation = (column: number, values: string[]) => {
    const formulae = ['"' + values.join(',') + '"'];
    for (let r = 3; r <= 2000; r++) {
      sheet.getCell(r, column).dataValidation = { type: 'list', allowBlank: true, formulae };
    }
  };
  listValidation(2, ['Фиксированная', 'Свободная']);
  listValidation(4, ['Бессрочно', 'Период']);
  listValidation(7, ['Нет', 'На обслуживание', 'Начисление сразу']);
  listValidation(16, ['Пополнение', 'Списание']);
  for (const row of rows) sheet.addRow(row);
  for (let r = 3; r < Math.min(rows.length + 3, 2001); r++) {
    sheet.getCell(r, 3).numFmt = '#,##0.00';
    sheet.getCell(r, 8).numFmt = '0.##';
    sheet.getCell(r, 17).numFmt = '#,##0.00';
    sheet.getCell(r, 5).numFmt = 'dd.mm.yyyy';
    sheet.getCell(r, 6).numFmt = 'dd.mm.yyyy';
    sheet.getCell(r, 15).numFmt = 'dd.mm.yyyy';
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function parseDepositWorkbook(base64: unknown): Promise<{ raw: DepositExcelRawRow[]; buffer: Buffer }> {
  const input = String(base64 || '').replace(/^data:.*?;base64,/, '');
  if (!input || !/^[A-Za-z0-9+/=\s]+$/.test(input)) throw new BadRequestException('Загрузите заполненный XLSX');
  if (input.length > DEPOSIT_XLSX_MAX_BYTES * 1.4) throw new BadRequestException('Файл превышает допустимые 4 МБ');
  const buffer = Buffer.from(input, 'base64');
  if (buffer.length > DEPOSIT_XLSX_MAX_BYTES || buffer.subarray(0, 2).toString('hex') !== '504b') {
    throw new BadRequestException('Нужен файл XLSX размером до 4 МБ');
  }
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
  catch { throw new BadRequestException('Не удалось прочитать XLSX. Скачайте шаблон приложения'); }
  if (workbook.worksheets.length !== 1) throw new BadRequestException('Шаблон должен содержать ровно один лист');
  const sheet = workbook.worksheets[0];
  if (sheet.rowCount > DEPOSIT_XLSX_MAX_ROWS + 2) throw new BadRequestException('За один раз допускается до 3000 строк');
  for (let i = 0; i < DEPOSIT_INPUT_COLUMNS.length; i++) {
    if (plain(sheet.getCell(2, i + 1).value) !== DEPOSIT_INPUT_COLUMNS[i]) {
      throw new BadRequestException('Столбцы Excel не соответствуют шаблону приложения (первое несовпадение: ' + DEPOSIT_INPUT_COLUMNS[i] + ')');
    }
  }
  const raw: DepositExcelRawRow[] = [];
  for (let r = 3; r <= sheet.rowCount; r++) {
    const cols = Array.from({ length: 20 }, (_, i) => plain(sheet.getCell(r, i + 1).value));
    if (!cols.some(Boolean)) continue;
    if (!cols[0] && !cols[15] && !cols[16]) continue;
    const [programName,amountMode,nominal,termMode,termStartDate,termEndDate,benefitType,benefitPercent,
      description,programUei,personName,phone,personCode,cardKey,occurredAt,action,amount,wallet,note,externalOperationId] = cols;
    raw.push({ row:r, programName,amountMode,nominal,termMode,termStartDate,termEndDate,benefitType,benefitPercent,
      description,programUei,personName,phone,personCode,cardKey,occurredAt,action,amount,wallet,note,externalOperationId });
  }
  return { raw, buffer };
}
