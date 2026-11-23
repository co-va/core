import ExcelJS from 'exceljs';
import { Fact, text } from './formats';
import type { Sheet } from './source';

export type ScopedDomain = 'records' | 'finance';
// Journal is a booking fact, not a payment or product transaction.
const RECORD_BASE = [
  { key: 'workplace', label: 'Рабочее пространство' },
  { key: 'uei', label: 'Код клиента' },
  { key: 'name', label: 'Имя' },
  { key: 'surname', label: 'Фамилия' },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'Email' },
  { key: 'date', label: 'Дата визита' },
  { key: 'from', label: 'Время визита' },
  { key: 'to', label: 'Время окончания' },
  { key: 'creatorName', label: 'Имя' },
  { key: 'createdDate', label: 'Дата' },
  { key: 'createdTime', label: 'Время' },
  { key: 'actionStatus', label: 'Статус' },
  { key: 'changedBy', label: 'Имя' },
  { key: 'changedDate', label: 'Дата' },
  { key: 'changedTime', label: 'Время' },
] as const;
const RECORD_AFTER_SERVICES = [
  { key: 'quotedTotal', label: 'Стоимость' },
  { key: 'visitStatus', label: 'Статус посещения' },
  { key: 'paymentStatus', label: 'Статус оплаты' },
  { key: 'comment', label: 'Комментарий' },
  { key: 'integrationSource', label: 'Источник интеграции' },
  // Kept for round-trip identity; the professional never needs to enter it.
  { key: 'recordId', label: 'ID записи', hidden: true },
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
  { key: 'cancelledAt', label: 'Дата отмены' },
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
    ? (() => {
      if (sheets.length !== 1 || !['Записи','Данные'].includes(sheets[0]?.name))
        throw Error('Выберите файл из шаблона Записей');
      return sheets[0];
    })()
    : ensureSheet(sheets,'Финансы',['Дата операции','Вид операции','Кошелёк','Сумма']);
  // XLSX has two header rows (group and field). CSV and earlier XLSX files
  // contain one field-header row. The same parser handles all three.
  const grouped = domain === 'records' && sheet.headers.includes('Клиент')
    && sheet.headers.includes('Визит') && (sheet.rows[0] || []).includes('Код клиента');
  const headers = grouped ? sheet.rows[0].map(text) : sheet.headers;
  const first = grouped ? 1 : 0;
  if(domain==='records')for(const label of ['Рабочее пространство','Имя','Услуга 1']){
    if(headers.filter(h=>h===label).length!==1)
      throw Error('Отсутствует столбец «'+label+'». Скачайте шаблон Записей.');
  }
  if(domain==='records' && !headers.includes('Дата визита') && !headers.includes('Дата'))
    throw Error('Отсутствует дата визита. Скачайте шаблон Записей.');
  const facts: Fact[] = [];
  for (let n=first; n<sheet.rows.length; n++) {
    const row = sheet.rows[n];
    if (!row.some(meaningful)) continue;
    const at = (label: string) => cell(row,headers,label);
    const get = (label: string) => value(row,headers,label);
    // Short repeated labels are read relative to their group.
    // The one-row CSV variant uses fixed anchors instead.
    const groupField=(group:string,offset:number,legacyLabel:string):any=>{
      const start=grouped?sheet.headers.indexOf(group):-1;
      if(start>=0)return row[start+offset];
      if(headers.includes('Статус')&&headers.includes('Стоимость')){
        const i=group==='Создание записи'
          ?headers.indexOf('Время окончания')+1:headers.indexOf('Статус');
        if(i>=0)return row[i+offset];
      }
      return cell(row,headers,legacyLabel);
    };
    const external = domain==='records' ? get('ID записи')||get('Запись') : get('Операция');
    const sourceKey=external ? source+':'+domain+':'+external : (sheet.stableFingerprint || fingerprint)+':'+(n+2);
    if (domain === 'records') {
      const procedures: any[] = [];
      for (const [headerIndex, label] of headers.entries()) {
        const match=/^Услуга ([1-9]\d*)$/.exec(label);
        if (!match) continue;
        const name=text(row[headerIndex]);
        if (!name) continue;
        const number=match[1];
        const cost=at('Цена услуги '+number);
        const duration=at('Длительность услуги '+number);
        procedures.push({name,...(meaningful(cost)?{cost}:{}),...(meaningful(duration)?{duration}:{})});
      }
      const paidFull=get('Оплачено полностью').toLowerCase();
      const paidYes=['да','1','true','оплачено'].includes(paidFull);
      const paidNo=['нет','0','false','не оплачено'].includes(paidFull);
      if(paidFull && !paidYes && !paidNo)
        throw Error('Строка '+(n+2)+': «Оплачено полностью» — укажите Да или Нет');
      const declaredPayment=get('Статус оплаты')||get('Оплата');
      const paymentStatus=declaredPayment||(paidYes?'Оплачено':paidNo?'Не оплачено':'');
      if(paidFull && declaredPayment && paidYes!==(declaredPayment==='Оплачено'))
        throw Error('Строка '+(n+2)+': статус оплаты противоречит отметке «Оплачено полностью»');
      facts.push({domain:'records',sheet:sheet.name,row:n+2,sourceKey,values:{
        ...(external?{recordId:external}:{}),
        name:get('Имя'),surname:get('Фамилия'),phone:get('Телефон'),
        email:get('Email'),uei:get('Код клиента')||get('UEI'),
        workplace:get('Рабочее пространство'),
        date:at('Дата визита')||at('Дата'),
        from:at('Время визита')||at('Время начала'),to:at('Время окончания'),
        creatorName:text(groupField('Создание записи',0,'Кто создал')),
        createdDate:headers.includes('Дата визита')
          ?(groupField('Создание записи',1,'Дата создания')||undefined):undefined,
        createdTime:groupField('Создание записи',2,'Время создания')||undefined,
        createdAt:!headers.includes('Дата визита')?(at('Дата создания')||undefined):undefined,
        actionStatus:text(groupField('История записи',0,'Статус записи')),
        changedBy:text(groupField('История записи',1,'Кто изменил')),
        changedDate:groupField('История записи',2,'Дата изменения')||undefined,
        changedTime:groupField('История записи',3,'Время изменения')||undefined,
        quotedTotal:meaningful(at('Стоимость'))?at('Стоимость')
          :meaningful(at('Стоимость записи'))?at('Стоимость записи'):undefined,
        visitStatus:get('Статус посещения')||get('Посещение'),paymentStatus,
        comment:get('Комментарий'),integrationSource:get('Источник интеграции'),
        bookedBy:get('Кто записал'),procedures:JSON.stringify(procedures),
      }});
    } else {
      const kind=get('Вид операции');
      const status=get('Статус');
      if(status && !['Активна','Отменена'].includes(status))
        throw Error('Статус операции: выберите Активна или Отменена');
      if(status==='Отменена' && !meaningful(at('Дата отмены')))
        throw Error('Укажите фактическую дату отмены операции');
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
        originalPayment:get('Исходная оплата'),tips:at('Чаевые')||undefined,
        ...(status==='Отменена'?{importCancelled:true,cancelledAt:at('Дата отмены')}:{}),
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
  const maximum=Math.max(template?3:1,...rows.map(row=>Array.isArray(row.services)?row.services.length:0));
  const cols:any[]=[...RECORD_BASE];
  for(let i=1;i<=maximum;i++)cols.push({key:'service'+i,label:'Услуга '+i});
  return [...cols,...RECORD_AFTER_SERVICES];
}
export async function scopedExcelWorkbook(domain:ScopedDomain, rows:any[], template=false):Promise<Buffer> {
  if (!Array.isArray(rows) || rows.length>20000)throw Error('Выгрузка допускает не более 20 000 строк за один раз');
  const book=new ExcelJS.Workbook();
  const cols:any[]=domain==='records'?recordColumns(rows,template):financeColumns(rows,template);
  const sheet=book.addWorksheet(domain==='records'?'Записи':'Финансы',
    {views:[{state:'frozen',ySplit:domain==='records'?2:1,xSplit:1}]});
  if(domain==='records'){
    sheet.columns=cols.map(col=>({key:col.key,width:Math.max(17,col.label.length+4),
      hidden:!!col.hidden,numFmt:'@'}));
    const servicesCount=cols.filter(col=>/^Услуга \d+$/.test(col.label)).length;
    const sections=[
      ['Клиент',2,6],['Визит',7,9],
      ['Создание записи',10,12],['История записи',13,16],
      ['Услуги',17,16+servicesCount],
      ['Статусы',18+servicesCount,19+servicesCount],
    ] as const;
    for(const [label,first,last] of sections){
      if(last>first)sheet.mergeCells(1,first,1,last);
      const cell=sheet.getCell(1,first);
      cell.value=label;
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDEDFE0'}};
      cell.font={bold:true,color:{argb:'FF25272B'},size:12};
      cell.alignment={vertical:'middle',horizontal:'center'};
      for(let c=first;c<=last;c++)sheet.getCell(1,c).fill=
        {type:'pattern',pattern:'solid',fgColor:{argb:'FFDEDFE0'}};
    }
    // Unnamed first-row cells are intentional for standalone columns.
    for(let c=1;c<=cols.length;c++)sheet.getCell(1,c).fill=
      {type:'pattern',pattern:'solid',fgColor:{argb:'FFDEDFE0'}};
    sheet.getRow(1).height=30;
    sheet.getRow(2).height=34;
    cols.forEach((col,i)=>{
      const cell=sheet.getCell(2,i+1);
      cell.value=col.label;
      cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF303238'}};
      cell.alignment={vertical:'middle'};
    });
    sheet.getCell(2,2).note='Код клиента необязателен. То же значение, что в Контактах.';
    sheet.getCell(2,9).note='Время окончания можно не указывать, если неизвестно.';
    sheet.getCell(2,17).note='Одна запись занимает одну строку. Если услуг больше трёх, добавьте «Услуга 4», «Услуга 5» и далее.';
    sheet.getCell(2,17+servicesCount).note='Стоимость записи — цена визита, а не факт поступления денег.';
  } else {
    sheet.columns=cols.map(col=>({key:col.key,header:col.label,width:col.label.length>24?28:22,hidden:!!col.hidden}));
    sheet.getRow(1).height=32;
    sheet.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF303238'}};
      c.alignment={vertical:'middle'};});
  }
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
  const headerRow=domain==='records'?2:1;
  sheet.autoFilter={from:{row:headerRow,column:1},to:{row:Math.max(headerRow,sheet.rowCount),column:cols.length-(domain==='records'?1:0)}};
  return Buffer.from(await book.xlsx.writeBuffer());
}
