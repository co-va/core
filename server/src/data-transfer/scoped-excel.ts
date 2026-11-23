import ExcelJS from 'exceljs';
import { Fact, text } from './formats';
import type { Sheet } from './source';

export type ScopedDomain = 'records' | 'finance';
const RECORD_BASE = [
  { key: 'recordId', label: 'Запись', hidden: true },
  { key: 'name', label: 'Имя' },
  { key: 'surname', label: 'Фамилия' },
  { key: 'phone', label: 'Телефон' },
  { key: 'uei', label: 'UEI' },
  { key: 'date', label: 'Дата' },
  { key: 'from', label: 'Время начала' },
  { key: 'to', label: 'Время окончания' },
  { key: 'workplace', label: 'Рабочее пространство' },
  { key: 'bookedBy', label: 'Кто записал' },
  { key: 'actionStatus', label: 'Статус записи' },
  { key: 'visitStatus', label: 'Посещение' },
  { key: 'paymentStatus', label: 'Оплата' },
  { key: 'createdAt', label: 'Дата создания' },
] as const;
const FINANCE_BASE = [
  { key: 'operationId', label: 'Операция', hidden: true },
  { key: 'occurredAt', label: 'Дата операции' },
  { key: 'kind', label: 'Вид операции' },
  { key: 'wallet', label: 'Кошелёк' },
  { key: 'amount', label: 'Сумма' },
  { key: 'article', label: 'Статья' },
  { key: 'toWallet', label: 'Кошелёк назначения' },
  { key: 'recordId', label: 'Запись', hidden: true },
  { key: 'phone', label: 'Телефон человека' },
  { key: 'recordDate', label: 'Дата записи' },
  { key: 'recordFrom', label: 'Время записи' },
  { key: 'loan', label: 'Займ' },
  { key: 'investment', label: 'Инвестиция' },
  { key: 'note', label: 'Примечание' },
  { key: 'status', label: 'Статус' },
  { key: 'tips', label: 'Чаевые' },
  { key: 'originalPayment', label: 'Исходная оплата', hidden: true },
] as const;
function meaningful(v: unknown): boolean {
  return v !== null && v !== undefined && text(v) !== '';
}
function cell(row: any[], headers: string[], label: string): any {
  const index = headers.indexOf(label);
  return index < 0 ? '' : row[index];
}
function value(row: any[], headers: string[], label: string): string {
  return text(cell(row, headers, label));
}
function ensureSheet(sheets: Sheet[], name: string, required: string[]) {
  if (sheets.length !== 1 || (sheets[0]?.name !== name && sheets[0]?.name !== 'Данные')) throw Error('Выберите файл из шаблона этого раздела');
  const sheet = sheets[0];
  for (const label of required) {
    if (sheet.headers.filter(h => h === label).length !== 1) {
      throw Error('В таблице отсутствует столбец «'+label+'». Скачайте шаблон.');
    }
  }
  return sheet;
}
export function scopedExcelFacts(sheets: Sheet[], fingerprint: string, domain: ScopedDomain, source: string): Fact[] {
  const sheet = domain === 'records'
    ? ensureSheet(sheets,'Записи',['Имя','Дата','Рабочее пространство','Статус записи','Посещение','Оплата','Услуга 1'])
    : ensureSheet(sheets,'Финансы',['Дата операции','Вид операции','Кошелёк','Сумма']);
  const facts: Fact[] = [];
  for (let n=0; n<sheet.rows.length; n++) {
    const row = sheet.rows[n];
    if (!row.some(meaningful)) continue;
    const at = (label: string) => cell(row,sheet.headers,label);
    const get = (label: string) => value(row,sheet.headers,label);
    const external = get(domain==='records' ? 'Запись':'Операция');
    const sourceKey=external ? source+':'+domain+':'+external : (sheet.stableFingerprint || fingerprint)+':'+(n+2);
    if (domain === 'records') {
      const procedures: any[] = [];
      for (const [headerIndex, label] of sheet.headers.entries()) {
        const match=/^Услуга ([1-9]\d*)$/.exec(label);
        if (!match) continue;
        const name=text(row[headerIndex]);
        if (!name) continue;
        const number=match[1];
        const cost=at('Цена услуги '+number);
        const duration=at('Длительность услуги '+number);
        procedures.push({name,...(meaningful(cost)?{cost}:{}),...(meaningful(duration)?{duration}:{})});
      }
      facts.push({domain:'records',sheet:sheet.name,row:n+2,sourceKey,values:{
        ...(external?{recordId:external}:{}),
        name:get('Имя'), surname:get('Фамилия'),phone:get('Телефон'),uei:get('UEI'),
        date:at('Дата'),from:at('Время начала'),to:at('Время окончания'),
        workplace:get('Рабочее пространство'),createdAt:at('Дата создания')||undefined,
        bookedBy:get('Кто записал'),actionStatus:get('Статус записи'),
        visitStatus:get('Посещение'),paymentStatus:get('Оплата'),
        procedures:JSON.stringify(procedures),
      }});
    } else {
      const kind=get('Вид операции');
      const status=get('Статус');
      if(status && !['Активна','Отменена'].includes(status))
        throw Error('Статус операции: выберите Активна или Отменена');
      if(status==='Отменена')
        throw Error('Отменённые операции требуют отдельной истории отмены. Переносите исходную операцию без изменения её статуса.');
      const allocations:any[]=[];
      for(const [column,label] of sheet.headers.entries()){
        const match=/^Кошелёк ([1-9]\d*)$/.exec(label);
        if(!match || !meaningful(row[column]))continue;
        const number=match[1];
        allocations.push({wallet:text(row[column]),amount:at('Сумма кошелька '+number)});
      }
      const data={
        occurredAt:at('Дата операции'),wallet:get('Кошелёк')||allocations[0]?.wallet||'',article:get('Статья'),
        toWallet:get('Кошелёк назначения'),loan:get('Займ'),
        investment:get('Инвестиция'),note:get('Примечание'),
        ...(external?{canonicalOperationId:external}:{}),
      };
      if (kind==='Оплата услуги') {
        facts.push({domain:'payments',sheet:sheet.name,row:n+2,sourceKey,values:{
          ...data,amount:at('Сумма'),recordId:get('Запись'),phone:get('Телефон человека'),
          date:at('Дата записи')||undefined,from:at('Время записи')||undefined,
          tips:at('Чаевые')||undefined,
          ...(allocations.length?{allocations:JSON.stringify(allocations)}:{}),
        }});
      } else {
        facts.push({domain:'operations',sheet:sheet.name,row:n+2,sourceKey,values:{
          ...data,financeKind:kind,financeAmount:at('Сумма'),
        }});
      }
    }
  }
  return facts;
}
function financeColumns(rows: any[], template: boolean) {
  const maximum=Math.max(template?3:1,...rows.map(r=>Array.isArray(r.allocations)?r.allocations.length:0));
  const cols:any[]=[...FINANCE_BASE];
  for(let i=1;i<=maximum;i++){
    cols.push({key:'wallet'+i,label:'Кошелёк '+i});
    cols.push({key:'walletAmount'+i,label:'Сумма кошелька '+i});
  }
  return cols;
}
function recordColumns(rows: any[], template: boolean) {
  const maximum=Math.max(template ? 10 : 1,...rows.map(row=>Array.isArray(row.services)?row.services.length:0));
  const cols:any[]=[...RECORD_BASE];
  for(let i=1;i<=maximum;i++)cols.push({key:'service'+i,label:'Услуга '+i});
  return cols;
}
export async function scopedExcelWorkbook(domain:ScopedDomain, rows:any[], template=false):Promise<Buffer> {
  if (!Array.isArray(rows) || rows.length>20000)throw Error('Выгрузка допускает не более 20 000 строк за один раз');
  const book=new ExcelJS.Workbook();
  book.creator='VA Tools';
  const cols:any[]=domain==='records'?recordColumns(rows,template):financeColumns(rows,template);
  const sheet=book.addWorksheet(domain==='records'?'Записи':'Финансы',{views:[{state:'frozen',ySplit:1,xSplit:1}]});
  sheet.columns=cols.map(col=>({key:col.key,header:col.label,width:col.label.length>24?28:22,hidden:!!col.hidden}));
  sheet.getRow(1).height=32;
  sheet.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF303238'}};c.alignment={vertical:'middle'};});
  if(!template)for(const input of rows) {
    const row:any={...input};
    if(domain==='records')for(let i=0;i<(input.services||[]).length;i++){
      const item=input.services[i]||{};
      row['service'+(i+1)]=text(item.name);
    }
    if(domain==='finance')for(let i=0;i<(input.allocations||[]).length;i++){
      const item=input.allocations[i]||{};
      row['wallet'+(i+1)]=text(item.wallet);
      row['walletAmount'+(i+1)]=item.amount ?? '';
    }
    sheet.addRow(row);
  }
  sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:cols.length}};
  return Buffer.from(await book.xlsx.writeBuffer());
}
