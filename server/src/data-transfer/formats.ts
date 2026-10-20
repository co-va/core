// Technical formats only. No identity or business inference belongs here.
export type Fact = { domain: string; sheet: string; row: number; values: Record<string, any>; sourceKey: string };
export const DOMAINS = ['people', 'workplaces', 'wallets', 'programs', 'articles', 'loans', 'investments', 'procedures', 'schedule', 'records', 'deposits', 'accounts', 'payments', 'operations', 'items', 'offers', 'movements', 'consumables'];
export const LABELS: Record<string, string> = { people: 'Люди', workplaces: 'Рабочие пространства', procedures: 'Процедуры', schedule: 'График', records: 'Записи', payments: 'Оплаты', items: 'Склад', movements: 'Движения', consumables: 'Расходники', wallets: 'Кошельки', programs: 'Программы', articles: 'Статьи', loans: 'Займы', investments: 'Инвестиции', deposits: 'Депозиты', accounts: 'Личные счета', operations: 'Финансовые операции', offers: 'Предложения поставщиков' };
export function text(value: unknown): string { return String(value ?? '').trim(); }
export function decimal(value: unknown, label: string, optional = false): number | undefined {
  if (value == null || value === '') { if (optional) return; throw Error(`Не указано значение: ${label}`); }
  const raw = text(value).replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) throw Error(`${label}: неверный формат числа`);
  const result = Number(raw);
  if (!Number.isFinite(result) || result < 0) throw Error(`${label}: неверный тип значения`);
  return result;
}
export function calendarDate(value: unknown): string {
  let raw: string;
  if (value instanceof Date) raw = value.toISOString().slice(0, 10);
  else if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465 || Math.floor(value) === 60) throw Error('Неверная дата Excel');
    const days = Math.floor(value);
    raw = new Date(Date.UTC(1899, 11, 31) + (days > 60 ? days - 1 : days) * 86400000).toISOString().slice(0, 10);
  } else {
    raw = text(value);
    const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T]00:00(?::00(?:\.000)?)?)?$/.exec(raw);
    if (ru) raw = `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
    else if (/^\d{4}-\d{2}-\d{2}(?:[ T]00:00(?::00(?:\.000)?)?Z?)?$/.test(raw)) raw = raw.slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(new Date(`${raw}T00:00:00Z`).getTime()) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) throw Error('Неверная дата');
  return raw;
}
export function clock(value: unknown, optional = true): string {
  if (value == null || value === '') { if (optional) return ''; throw Error('Не указано время обслуживания'); }
  let raw = text(value);
  if (value instanceof Date) raw = value.toISOString().slice(11, 16);
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440); raw = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(raw);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw Error('Неверное время обслуживания');
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}
export function instant(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    const date = new Date(raw); if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return `${calendarDate(value)}T00:00:00.000Z`;
}
export function parseCsv(raw: string): string[][] {
  const source = raw.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else if (quoted || cell === '') quoted = !quoted; else throw Error('Некорректные кавычки CSV'); }
    else if (!quoted && ch === delimiter) { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) { if (ch === '\r' && source[i + 1] === '\n') i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (quoted) throw Error('Незакрытые кавычки CSV');
  row.push(cell); if (row.some(Boolean)) rows.push(row); return rows;
}

export function canonical(value: any): string {
  function sorted(v: any): any { return Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v; }
  return JSON.stringify(sorted(value));
}
