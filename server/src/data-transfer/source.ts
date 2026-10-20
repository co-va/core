import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { DOMAINS, LABELS, Fact, parseCsv, text } from './formats';

export const FIELDS: Record<string, string> = {
  transferId: 'ID переноса', externalId: 'ID источника', sourceKey: 'Ключ строки', name: 'Имя', surname: 'Фамилия', phone: 'Телефон', email: 'Email', uei: 'UEI',
  personKey: 'ID человека CO-VA', workplace: 'Рабочее пространство', workplaceKey: 'ID пространства CO-VA', procedure: 'Процедура', procedureId: 'ID процедуры CO-VA',
  date: 'Дата обслуживания', from: 'Время обслуживания', to: 'Окончание обслуживания', createdAt: 'Дата создания в источнике', occurredAt: 'Дата факта',
  recordId: 'ID записи CO-VA', recordTransferId: 'ID переноса записи', personTransferId: 'ID переноса человека', workplaceTransferId: 'ID переноса пространства',
  price: 'Исторический прайс', cost: 'Цена работы', discountPercent: 'Скидка %', discountMoney: 'Скидка суммой', duration: 'Длительность',
  amount: 'Сумма оплаты', walletId: 'ID кошелька CO-VA', wallet: 'Кошелёк', material: 'Расходник', itemId: 'ID позиции CO-VA', itemTransferId: 'ID переноса позиции',
  manufacturer: 'Производитель', unit: 'Единица', quantity: 'Количество', unitCost: 'Себестоимость единицы', kind: 'Тип движения', note: 'Примечание', withoutProcedure: 'Без процедуры',
};
export const DOMAIN_FIELDS: Record<string, string[]> = {
  people: ['name','surname','phone','email','uei','personKey','createdAt'],
  workplaces: ['name','workplaceKey','note'], procedures: ['name','procedureId','workplace','workplaceKey','price','duration','occurredAt'],
  schedule: ['workplace','workplaceKey','date','from','to'],
  records: ['personKey','personTransferId','name','phone','uei','workplace','workplaceKey','workplaceTransferId','date','from','to','procedure','cost','price','discountPercent','discountMoney','duration','createdAt'],
  payments: ['recordId','recordTransferId','personKey','personTransferId','phone','uei','name','date','from','procedure','workplace','workplaceKey','occurredAt','amount','wallet','walletId'],
  items: ['name','itemId','manufacturer','unit','quantity','unitCost','occurredAt'],
  movements: ['itemId','itemTransferId','material','manufacturer','unit','quantity','unitCost','kind','occurredAt','workplace','workplaceKey'],
  consumables: ['recordId','recordTransferId','personKey','personTransferId','phone','uei','name','date','from','procedure','withoutProcedure','itemId','itemTransferId','material','manufacturer','unit','quantity','unitCost','occurredAt','workplace','workplaceKey'],
};
export type Sheet = { name: string; headers: string[]; rows: any[][] };
export type SourceInput = { dataUrl?: string; filename?: string; source?: string; sheets?: Record<string, { domain: string; columns?: Record<string, number>; withoutProcedure?: boolean }> };
function cellValue(value: any): any {
  if (value == null || value instanceof Date || typeof value !== 'object') return value ?? '';
  // Do not execute formulas or accept stale cached formula results as source facts.
  if ('formula' in value || 'sharedFormula' in value) return { invalid: 'Формула: замените значением' };
  if (value.richText) return value.richText.map((v: any) => v.text || '').join('');
  return { invalid: 'Неверный тип значения ячейки' };
}
export async function readSource(input: SourceInput): Promise<{ sheets: Sheet[]; fingerprint: string }> {
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(text(input.dataUrl));
  if (!match) throw Error('Не удалось прочитать файл');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw Error('Размер файла должен быть от 1 байта до 25 МБ');
  const fingerprint = createHash('sha256').update(buffer).digest('hex');
  const sheets: Sheet[] = [];
  if (/\.csv$|\.tsv$/i.test(text(input.filename))) {
    const rows = parseCsv(buffer.toString('utf8')); sheets.push({ name: 'Данные', headers: rows.shift() || [], rows });
  } else if (/\.xlsx$/i.test(text(input.filename))) {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
    if (workbook.properties.date1904) throw Error('Excel использует даты 1904. Сохраните даты текстом в формате ГГГГ-ММ-ДД.');
    workbook.eachSheet(sheet => {
      const header = sheet.getRow(1); const headers: string[] = [];
      for (let col = 1; col <= sheet.columnCount; col++) headers.push(text(cellValue(header.getCell(col).value)));
      const rows: any[][] = [];
      for (let row = 2; row <= sheet.rowCount; row++) {
        const values = headers.map((_, col) => cellValue(sheet.getCell(row, col + 1).value)); rows.push(values);
      }
      if (headers.some(Boolean)) sheets.push({ name: sheet.name, headers, rows });
    });
  } else throw Error('Загрузите XLSX, CSV или TSV');
  if (sheets.reduce((n, s) => n + s.rows.length, 0) > 20000) throw Error('В одном файле допускается до 20 000 строк');
  return { sheets, fingerprint };
}
export function defaultDomain(name: string) { return DOMAINS.find(key => name === key || name === LABELS[key]) || ''; }
export function defaultColumns(headers: string[]) {
  const result: Record<string, number> = {};
  for (const [field, label] of Object.entries(FIELDS)) {
    const matches = headers.map((h, i) => h === field || h === label ? i : -1).filter(i => i >= 0);
    if (matches.length === 1) result[field] = matches[0];
  }
  return result;
}
export function sourceFacts(sheets: Sheet[], fingerprint: string, input: SourceInput): Fact[] {
  const facts: Fact[] = [];
  for (const sheet of sheets) {
    const mapping = input.sheets?.[sheet.name];
    const domain = mapping?.domain ?? defaultDomain(sheet.name);
    if (domain === 'skip') continue;
    const columns = mapping?.columns || defaultColumns(sheet.headers);
    for (let index = 0; index < sheet.rows.length; index++) {
      const row = sheet.rows[index]; if (!row.some(v => v !== '' && v != null)) continue;
      const values: Record<string, any> = {};
      for (const [field, col] of Object.entries(columns)) if (FIELDS[field] && Number.isInteger(col) && col >= 0 && col < sheet.headers.length && row[col] !== '' && row[col] != null) values[field] = row[col];
      if (mapping?.withoutProcedure === true) values.withoutProcedure = true;
      const sourceKey = text(values.sourceKey) || (text(values.externalId)
        ? `${text(input.source)}:${domain}:${text(values.externalId)}`
        : `${fingerprint}:${sheet.name}:${index + 2}`);
      facts.push({ domain, sheet: sheet.name, row: index + 2, values, sourceKey });
    }
  }
  // Explicit people/place facts embedded in a record are independent facts too.
  const embedded: Fact[] = [];
  for (const fact of facts) if (fact.domain === 'records') {
    const v = fact.values;
    if (v.name && (v.phone || v.uei) && !v.personKey && !v.personTransferId) embedded.push({ ...fact, domain: 'people', sourceKey: fact.sourceKey + ':person',
      values: Object.fromEntries(['name','surname','phone','email','uei'].filter(k => v[k] !== undefined).map(k => [k,v[k]])) });
    if (v.workplace && !v.workplaceKey && !v.workplaceTransferId) embedded.push({ ...fact, domain: 'workplaces', sourceKey: fact.sourceKey + ':workplace', values: { name: v.workplace } });
  }
  for (const fact of facts) if (fact.domain === 'items' && fact.values.quantity != null) {
    const v = fact.values;
    embedded.push({ ...fact, domain: 'movements', sourceKey: fact.sourceKey + ':stock', values: {
      itemTransferId: text(v.transferId) || fact.sourceKey, material: v.name, manufacturer: v.manufacturer,
      unit: v.unit, quantity: v.quantity, unitCost: v.unitCost, occurredAt: v.occurredAt, kind: 'RECEIPT',
    } });
    fact.values = Object.fromEntries(Object.entries(v).filter(([key]) => !['quantity','unitCost','occurredAt'].includes(key)));
  }
  facts.push(...embedded);
  return facts.sort((a, b) => DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(b.domain));
}
export async function transferWorkbook(rows: any[], template = false) {
  const workbook = new ExcelJS.Workbook();
  for (const domain of DOMAINS) {
    const facts = rows.filter(row => row.domain === domain);
    if (!template && !facts.length) continue;
    const sheet = workbook.addWorksheet(LABELS[domain]);
    const keys = ['transferId','externalId','sourceKey', ...DOMAIN_FIELDS[domain], 'note'];
    const unique = [...new Set(keys)];
    sheet.columns = [...unique.map(key => ({ header: FIELDS[key] || key, key, width: 24 })), { header: 'Причина', key: 'reason', width: 65 }];
    sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (const fact of facts) sheet.addRow({ ...fact.values, transferId: fact.transferId || '', sourceKey: fact.sourceKey, reason: fact.reason || '' });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: unique.length + 1 } };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
