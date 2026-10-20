import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import type { Domain, JsonObject, SourceBundle, SourceRow } from './data-transfer.types';

export function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

export function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function text(value: unknown) {
  return String(value ?? '').trim();
}

export function normalized(value: unknown) {
  return text(value)
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function headerKey(value: unknown) {
  return normalized(value).replaceAll(' ', '');
}

export function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

export function stableId(prefix: string, value: unknown) {
  return `${prefix}:${hash(value)}`;
}

export function phone(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

export function email(value: unknown) {
  return text(value).toLocaleLowerCase('ru-RU');
}

export function numberValue(value: unknown): number | null {
  if (value == null || text(value) === '') return null;
  const parsed = Number(text(value).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const ru = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (ru) {
    const year = ru[3].length === 2 ? `20${ru[3]}` : ru[3];
    return `${year}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
}

function timeOnly(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  const match = text(value).match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

export function dateTime(dateValue: unknown, timeValue: unknown = '') {
  const raw = text(dateValue);
  if (raw && /T\d{2}:\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
  }
  const date = dateOnly(dateValue);
  if (!date) return '';
  const time = timeOnly(timeValue) || '12:00';
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function fileBuffer(dataUrlValue: unknown) {
  const raw = text(dataUrlValue);
  const comma = raw.indexOf(',');
  const base64 = comma >= 0 ? raw.slice(comma + 1) : raw;
  if (!base64) throw new BadRequestException('Файл пуст');
  return Buffer.from(base64, 'base64');
}

function cellText(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const object = value as JsonObject;
    if (object.text != null) return text(object.text);
    if (object.result != null) return text(object.result);
    if (Array.isArray(object.richText)) return object.richText.map((part: JsonObject) => text(part?.text)).join('');
  }
  return text(value);
}

function csvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(value.trim());
      value = '';
      continue;
    }
    value += char;
  }
  cells.push(value.trim());
  return cells;
}

function rowObject(headers: string[], values: unknown[]) {
  const result: JsonObject = {};
  headers.forEach((header, index) => {
    if (!header) return;
    result[headerKey(header)] = cellText(values[index]);
  });
  return result;
}

export function pick(row: JsonObject, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[headerKey(alias)];
    if (value != null && text(value) !== '') return value;
  }
  return '';
}

function domainFrom(sheetValue: unknown, headers: string[]): Domain | null {
  const sheet = normalized(sheetValue);
  const headerSet = new Set(headers.map(headerKey));
  const has = (...names: string[]) => names.some((name) => headerSet.has(headerKey(name)));
  if (/историческ.*прайс|история.*прайс|price history|procedure history/.test(sheet)) return 'procedure-history';
  if (/рабоч.*простран|workplace|workspace/.test(sheet)) return 'workplace';
  if (/люди|people|persons/.test(sheet)) return 'person';
  if (/график|расписан|schedule|work plan/.test(sheet)) return 'schedule';
  if (/процедур|услуг|прайс|procedures|services|price/.test(sheet)) return 'procedure';
  if (/запис|визит|record|appointment|visit/.test(sheet)) return 'record';
  if (/финанс|оплат|платеж|finance|payment|operations/.test(sheet)) return 'finance';
  if (/движен.*склад|^движения$|inventory movement|stock movement/.test(sheet)) return 'inventory-movement';
  if (/склад|остатк|inventory|stock/.test(sheet)) return 'inventory';
  if (has('имя', 'телефон') && !has('дата', 'сумма', 'количество')) return 'person';
  if (has('дата') && has('процедура', 'услуга', 'начало', 'время')) return 'record';
  if (has('сумма', 'кошелек', 'статья') && has('дата')) return 'finance';
  if (has('количество') && has('наименование', 'материал') && has('единица', 'единица измерения')) return 'inventory';
  if (has('название', 'процедура') && has('цена', 'стоимость', 'длительность')) return 'procedure';
  if (has('рабочее пространство', 'место') && has('город', 'адрес')) return 'workplace';
  return null;
}

export function personFact(row: JsonObject) {
  return {
    externalId: text(pick(row, ['id', 'код', 'person id', 'external id'])),
    name: text(pick(row, ['имя', 'name', 'first name'])),
    surname: text(pick(row, ['фамилия', 'surname', 'last name'])),
    phone: phone(pick(row, ['телефон', 'phone', 'mobile'])),
    email: email(pick(row, ['email', 'e-mail', 'почта'])),
  };
}

export function workplaceFact(row: JsonObject) {
  return {
    externalId: text(pick(row, ['id', 'код', 'workplace id', 'workspace id'])),
    key: text(pick(row, ['key', 'ключ'])),
    name: text(pick(row, ['название', 'рабочее пространство', 'место', 'name'])),
    city: text(pick(row, ['город', 'city'])),
    address: text(pick(row, ['адрес', 'address'])),
    phone: text(pick(row, ['телефон', 'phone'])),
    currency: text(pick(row, ['валюта', 'currency'])),
    timeZone: text(pick(row, ['часовой пояс', 'timezone', 'time zone'])),
    from: timeOnly(pick(row, ['с', 'начало', 'from', 'start'])),
    to: timeOnly(pick(row, ['до', 'окончание', 'to', 'end'])),
  };
}

export function scheduleFact(row: JsonObject) {
  return {
    workplace: text(pick(row, ['рабочее пространство', 'место', 'workplace', 'workspace'])),
    date: dateOnly(pick(row, ['дата', 'date'])),
    from: timeOnly(pick(row, ['с', 'начало', 'from', 'start'])),
    to: timeOnly(pick(row, ['до', 'окончание', 'to', 'end'])),
  };
}

export function procedureFact(row: JsonObject, historical = false) {
  const price = numberValue(pick(row, ['цена', 'стоимость', 'price', 'cost']));
  const duration = numberValue(pick(row, ['длительность', 'минуты', 'duration', 'minutes']));
  return {
    externalId: text(pick(row, ['id', 'код', 'procedure id', 'service id'])),
    name: text(pick(row, ['название', 'процедура', 'услуга', 'name'])),
    workplace: text(pick(row, ['рабочее пространство', 'место', 'workplace', 'workspace'])),
    price,
    duration: duration == null ? 0 : Math.max(0, duration),
    effectiveAt: historical ? dateTime(pick(row, ['дата', 'дата с', 'effective at', 'from date'])) : dateTime(pick(row, ['дата с', 'effective at', 'from date'])),
  };
}

export function recordFact(row: JsonObject) {
  const rawPrice = pick(row, ['цена', 'стоимость', 'сумма', 'price', 'cost', 'total']);
  const duration = numberValue(pick(row, ['длительность', 'минуты', 'duration', 'minutes']));
  return {
    externalId: text(pick(row, ['id', 'код', 'record id', 'appointment id'])),
    date: dateOnly(pick(row, ['дата', 'date'])),
    from: timeOnly(pick(row, ['время', 'с', 'начало', 'time', 'from', 'start'])),
    to: timeOnly(pick(row, ['до', 'окончание', 'to', 'end'])),
    workplace: text(pick(row, ['рабочее пространство', 'место', 'workplace', 'workspace'])),
    personExternalId: text(pick(row, ['person id', 'человек id', 'человек код'])),
    personName: text(pick(row, ['человек', 'имя', 'person', 'name'])),
    personSurname: text(pick(row, ['фамилия', 'surname'])),
    personPhone: phone(pick(row, ['телефон', 'phone', 'mobile'])),
    personEmail: email(pick(row, ['email', 'e-mail', 'почта'])),
    procedureId: text(pick(row, ['procedure id', 'процедура id', 'service id'])),
    procedureName: text(pick(row, ['процедура', 'услуга', 'service', 'procedure'])),
    price: rawPrice === '' ? null : numberValue(rawPrice),
    duration: duration == null ? 0 : Math.max(0, duration),
    status: normalized(pick(row, ['статус', 'status'])),
    statusAt: dateTime(pick(row, ['дата статуса', 'status at']), pick(row, ['время статуса', 'status time'])),
    createdAt: dateTime(pick(row, ['создано', 'дата создания', 'created at']), pick(row, ['время создания', 'created time'])),
  };
}

export function financeFact(row: JsonObject) {
  const kind = normalized(pick(row, ['тип', 'операция', 'kind', 'type']));
  let direction = text(pick(row, ['направление', 'direction'])).toUpperCase();
  if (!direction) {
    if (/доход|income/.test(kind)) direction = 'IN';
    if (/расход|expense/.test(kind)) direction = 'OUT';
  }
  return {
    externalId: text(pick(row, ['id', 'код', 'operation id', 'payment id'])),
    kind,
    direction,
    amount: numberValue(pick(row, ['сумма', 'amount', 'total'])),
    tips: numberValue(pick(row, ['чаевые', 'tips'])) || 0,
    occurredAt: dateTime(pick(row, ['дата', 'date', 'occurred at']), pick(row, ['время', 'time'])),
    recordRef: text(pick(row, ['запись id', 'record id', 'record', 'запись'])),
    wallet: text(pick(row, ['кошелек', 'кошелёк', 'wallet', 'payment method'])),
    article: text(pick(row, ['статья', 'article', 'category'])),
    note: text(pick(row, ['примечание', 'комментарий', 'note'])),
  };
}

export function inventoryFact(row: JsonObject, movement = false) {
  const quantity = numberValue(pick(row, ['количество', 'quantity']));
  const price = numberValue(pick(row, ['цена', 'себестоимость', 'фактическая цена закупки', 'price', 'unit cost']));
  const rawKind = normalized(pick(row, ['тип', 'kind']));
  const movementKinds: Record<string, string> = {
    приход: 'RECEIPT',
    расход: 'CONSUMPTION',
    списание: 'WRITE_OFF',
    продажа: 'SALE',
    возврат: 'RETURN',
    инвентаризация: 'ADJUSTMENT',
    корректировка: 'CORRECTION',
  };
  return {
    externalId: text(pick(row, ['id', 'код', 'item id', 'movement id'])),
    name: text(pick(row, ['наименование', 'материал', 'name', 'item'])),
    manufacturer: text(pick(row, ['производитель', 'manufacturer'])),
    unit: text(pick(row, ['единица', 'единица измерения', 'unit'])) || 'шт.',
    quantity,
    price,
    sku: text(pick(row, ['артикул', 'sku'])),
    barcode: text(pick(row, ['штрихкод', 'barcode'])),
    location: text(pick(row, ['место хранения', 'location'])),
    kind: movement ? (movementKinds[rawKind] || text(pick(row, ['тип', 'kind'])).toUpperCase()) : 'ADJUSTMENT',
    occurredAt: movement ? dateTime(pick(row, ['дата', 'date']), pick(row, ['время', 'time'])) : dateTime(pick(row, ['дата', 'date'])),
    workplace: text(pick(row, ['рабочее пространство', 'место', 'workplace'])),
    recordRef: text(pick(row, ['запись id', 'record id'])),
    note: text(pick(row, ['примечание', 'note'])),
  };
}

export function rowIdentity(domain: Domain, row: JsonObject) {
  if (domain === 'person') {
    const fact = personFact(row);
    return [fact.externalId || fact.phone || fact.email || normalized(`${fact.name} ${fact.surname}`), fact];
  }
  if (domain === 'workplace') {
    const fact = workplaceFact(row);
    return [fact.externalId || fact.key || normalized(fact.name), fact];
  }
  if (domain === 'schedule') {
    const fact = scheduleFact(row);
    return [fact.workplace, fact.date, fact.from, fact.to];
  }
  if (domain === 'procedure' || domain === 'procedure-history') {
    const fact = procedureFact(row, domain === 'procedure-history');
    return [fact.externalId || normalized(fact.name), fact.workplace, fact.effectiveAt, fact.price, fact.duration];
  }
  if (domain === 'record') {
    const fact = recordFact(row);
    return fact.externalId ? ['external', fact.externalId] : [fact.date, fact.from, fact.to, fact.workplace, fact.personPhone, fact.personEmail, normalized(`${fact.personName} ${fact.personSurname}`), fact.procedureId || normalized(fact.procedureName), fact.price, fact.status];
  }
  if (domain === 'finance') {
    const fact = financeFact(row);
    return fact.externalId ? ['external', fact.externalId] : [fact.occurredAt, fact.kind, fact.direction, fact.amount, fact.recordRef, fact.wallet, fact.article];
  }
  const fact = inventoryFact(row, domain === 'inventory-movement');
  if (fact.externalId) return ['external', fact.externalId];
  return [domain, fact.sku || fact.barcode || normalized(`${fact.manufacturer} ${fact.name} ${fact.unit}`), fact.quantity, fact.price, fact.kind, fact.occurredAt];
}

export function sourceImportKey(domain: Domain, row: JsonObject) {
  return stableId('transfer', [domain, rowIdentity(domain, row)]);
}

export function importedWorkplaceKey(fact: ReturnType<typeof workplaceFact>) {
  return fact.key || (fact.externalId ? `import-workplace-${hash(fact.externalId)}` : `import-workplace-${hash([fact.name, fact.address])}`);
}

export function sourceWorkplaceTargetKey(fact: ReturnType<typeof workplaceFact>, existing: any[]) {
  const refs = [fact.key, fact.name].map(normalized).filter(Boolean);
  const matches = existing.filter((item) => !item.deletedAt && refs.some((ref) => normalized(item.key) === ref || normalized(item.name) === ref));
  return matches.length === 1 ? text(matches[0].key) : importedWorkplaceKey(fact);
}

export function importedPersonKey(fact: ReturnType<typeof personFact> | { externalId?: string; phone?: string; email?: string; name?: string; surname?: string }) {
  return text(fact.externalId)
    ? `import-person-${hash(text(fact.externalId))}`
    : `import-person-${hash([phone(fact.phone), email(fact.email), text(fact.name), text(fact.surname)])}`;
}

export function personMatches(personValue: unknown, fact: ReturnType<typeof personFact> | ReturnType<typeof recordFact>) {
  const person = objectValue(personValue);
  const sourcePhone = 'phone' in fact ? fact.phone : fact.personPhone;
  const sourceEmail = 'email' in fact ? fact.email : fact.personEmail;
  const sourceName = 'name' in fact ? fact.name : fact.personName;
  const sourceSurname = 'surname' in fact ? fact.surname : fact.personSurname;
  const phones = arrayValue(person.phones).map(phone).filter(Boolean);
  const emails = arrayValue(person.emails).map(email).filter(Boolean);
  if (sourcePhone && phones.includes(sourcePhone)) return true;
  if (sourceEmail && emails.includes(sourceEmail)) return true;
  return !sourcePhone && !sourceEmail
    && normalized(`${text(person.name)} ${text(person.surname)}`) === normalized(`${sourceName} ${sourceSurname}`)
    && Boolean(normalized(`${sourceName} ${sourceSurname}`));
}

export function recordNaturalSignature(value: unknown) {
  const record = objectValue(value);
  const person = objectValue(record.person);
  const procedures = arrayValue(record.procedures);
  return JSON.stringify([
    text(record.date).slice(0, 10), text(record.from), text(record.to), text(record.workplaceId),
    phone(person.phone || arrayValue(person.phones)[0]), email(person.email || arrayValue(person.emails)[0]),
    normalized(`${text(person.name)} ${text(person.surname)}`),
    procedures.map((item) => normalized(objectValue(item).name)).join('|'),
  ]);
}

export async function parseSource(fileNameValue: unknown, dataUrl: unknown): Promise<SourceBundle> {
  const fileName = text(fileNameValue) || 'data.xlsx';
  const buffer = fileBuffer(dataUrl);
  const rows: SourceRow[] = [];
  const ignoredSheets: string[] = [];
  const append = (sheet: string, headers: string[], values: unknown[][]) => {
    const domain = domainFrom(sheet, headers);
    if (!domain) {
      ignoredSheets.push(sheet);
      return;
    }
    values.forEach((valuesRow, index) => {
      const mapped = rowObject(headers, valuesRow);
      if (!Object.values(mapped).some((value) => text(value))) return;
      rows.push({ domain, sheet, row: index + 2, values: mapped, importKey: sourceImportKey(domain, mapped) });
    });
  };

  if (/\.csv$/i.test(fileName)) {
    const source = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = source.split(/\r?\n/).filter((line: string) => line.trim());
    if (!lines.length) throw new BadRequestException('Файл пуст');
    const delimiter = (lines[0].match(/;/g)?.length || 0) >= (lines[0].match(/,/g)?.length || 0) ? ';' : ',';
    const headers = csvLine(lines[0], delimiter);
    append(fileName.replace(/\.[^.]+$/, ''), headers, lines.slice(1).map((line: string) => csvLine(line, delimiter)));
  } else if (/\.xlsx$/i.test(fileName)) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    for (const sheet of workbook.worksheets) {
      const headerRow = sheet.getRow(1);
      const count = Math.max(headerRow.cellCount, sheet.columnCount);
      const headers = Array.from({ length: count }, (_, index) => cellText(headerRow.getCell(index + 1).value));
      const values: unknown[][] = [];
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        values.push(Array.from({ length: count }, (_, index) => row.getCell(index + 1).value));
      }
      append(sheet.name, headers, values);
    }
  } else {
    throw new BadRequestException('Поддерживаются файлы .xlsx и .csv');
  }
  if (!rows.length) throw new BadRequestException('Не удалось распознать данные в файле');
  return { fileName, rows, ignoredSheets };
}
