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
// Finance is a ledger of single-wallet movements, not a list of Record IDs.
// Every visible Excel row describes ONE wallet movement; repeat the invoice
// information when a payment is split between several wallets.
const FINANCE_BASE = [
  { key:'workplace', label:'Рабочее пространство' },
  { key:'invoiceDate', label:'Дата счёта' },
  { key:'invoiceTime', label:'Время' },
  { key:'participantCode', label:'Код' },
  { key:'participant', label:'Имя / название' },
  { key:'phone', label:'Телефон' },
  { key:'documentNumber', label:'Номер документа' },
  { key:'purpose', label:'Назначение' },
  { key:'subject', label:'Наименование' },
  { key:'direction', label:'Движение' },
  { key:'price', label:'Цена' },
  { key:'discount', label:'Скидка' },
  { key:'quotedTotal', label:'К оплате' },
  { key:'amount', label:'Оплачено' },
  { key:'paymentDate', label:'Дата оплаты' },
  { key:'wallet', label:'Кошелёк' },
  { key:'note', label:'Комментарий' },
  { key:'integrationSource', label:'Источник интеграции' },
] as const;
const FINANCE_SECTIONS:readonly (readonly [string,number,number])[]=[
  ['Счёт',1,3],['Участник',4,6],['Операция',7,10],
  ['Финансовые данные',11,14],['Касса',15,16],['Дополнительно',17,18],
];
function financeKind(purpose:string,direction:string):{kind:string,article:string,service:boolean} {
  const label=purpose.trim().toLocaleLowerCase('ru-RU');
  if(['услуга','услуги','оплата услуги','оплата услуг','обслуживание'].includes(label)){
    if(direction!=='Приход')throw Error('Оплата услуги должна быть приходом. Для возврата укажите «Возврат оплаты».');
    return {kind:'Оплата услуги',article:'Услуги',service:true};
  }
  if(['продажа','продажа товара','продажа товаров','товар','товары'].includes(label))
    return {kind:'Доход',article:'Продажа товаров',service:false};
  if(['закупка','покупка товара','закупка товаров','закупка материалов','материалы'].includes(label))
    return {kind:'Расход',article:'Материалы',service:false};
  if(['пополнение депозита','депозит','возврат депозита','оплата депозитом'].includes(label))
    throw Error('Депозитные движения сопоставляются через раздел «Депозиты». Не загружайте их повторно в кассу.');
  if(['перевод','перевод между кошельками'].includes(label))
    throw Error('Перевод между кошельками требует подтверждения обоих кошельков в Кассе.');
  if(['возврат оплаты','возврат'].includes(label))
    throw Error('Для возврата необходима ссылка на исходный платёж. Выполните возврат в Кассе.');
  const articles:Record<string,string>={
    'доход':'Прочие доходы','прочие доходы':'Прочие доходы',
    'расход':'Прочие расходы','прочие расходы':'Прочие расходы',
    'аренда':'Аренда','налог':'Налог','налоги':'Налог',
    'продажа товаров':'Продажа товаров','услуги':'Услуги',
    'чаевые':'Чаевые',
  };
  const article=articles[label]||purpose.trim();
  if(!article)throw Error('Укажите назначение финансовой операции');
  return {kind:direction==='Приход'?'Доход':'Расход',article,service:false};
}
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
    : (() => {
      if(sheets.length!==1||!['Финансы','Данные'].includes(sheets[0]?.name))
        throw Error('Выберите файл из шаблона Финансов');
      return sheets[0];
    })();
  // XLSX has two header rows (group and field). CSV and earlier XLSX files
  // contain one field-header row. The same parser handles all three.
  const grouped = domain === 'records'
    ? sheet.headers.includes('Клиент') && sheet.headers.includes('Визит')
      && (sheet.rows[0] || []).includes('Код клиента')
    : sheet.headers.includes('Счёт') && sheet.headers.includes('Касса')
      && (sheet.rows[0] || []).includes('Дата счёта');
  const headers = grouped ? sheet.rows[0].map(text) : sheet.headers;
  const first = grouped ? 1 : 0;
  if(domain==='records')for(const label of ['Рабочее пространство','Имя','Услуга 1']){
    if(headers.filter(h=>h===label).length < 1 || label!=='Имя' && headers.filter(h=>h===label).length!==1)
      throw Error('Отсутствует столбец «'+label+'». Скачайте шаблон Записей.');
  }
  if(domain==='records' && !headers.includes('Дата визита') && !headers.includes('Дата'))
    throw Error('Отсутствует дата визита. Скачайте шаблон Записей.');
  if(domain==='finance' && headers.includes('Дата счёта')){
    for(const column of FINANCE_BASE)if(headers.filter(h=>h===column.label).length!==1)
      throw Error('Не найден столбец «'+column.label+'». Скачайте шаблон Финансов.');
  }else if(domain==='finance'){
    for(const label of ['Дата операции','Вид операции','Кошелёк','Сумма'])
      if(headers.filter(h=>h===label).length!==1)
        throw Error('Неверный финансовый Excel. Скачайте актуальный шаблон.');
  }
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
    const newFinance=domain==='finance'&&headers.includes('Дата счёта');
    // Source invoice number is NOT a unique payment ID (split payments share it).
    // Same source/document/wallet/date/amount is idempotent across re-uploads;
    // different wallets or amounts remain different financial movements.
    const financeSource=get('Источник интеграции')||source;
    const sourceKey=newFinance
      ? financeSource+':finance:'+JSON.stringify(get('Номер документа')
          // A document number identifies a source invoice, not a single payment.
          // Wallet + date + subject distinguish the payments under that invoice.
          ?[get('Номер документа'),get('Дата оплаты'),get('Кошелёк'),
            get('Наименование'),get('Движение')]
          // Without a source ID the full economic fact is the only stable key.
          :[get('Рабочее пространство'),get('Дата счёта'),
            get('Время'),get('Код'),get('Имя / название'),
            get('Назначение'),get('Наименование'),get('Движение'),
            get('Оплачено'),get('Дата оплаты'),get('Кошелёк')])
      :external ? source+':'+domain+':'+external : (sheet.stableFingerprint || fingerprint)+':'+(n+2);
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
    } else if(newFinance) {
      const direction=get('Движение');
      if(!['Приход','Расход'].includes(direction))
        throw Error('Строка '+(n+2)+': движение — Приход или Расход');
      const purpose=get('Назначение');
      const route=financeKind(purpose,direction);
      if(route.service && direction!=='Приход' || !route.service
        && route.kind==='Доход' && direction!=='Приход'
        || !route.service && route.kind==='Расход' && direction!=='Расход')
        throw Error('Строка '+(n+2)+': назначение и движение противоречат друг другу');
      const paid=at('Оплачено');
      if(!meaningful(paid) || !(Number(text(paid).replace(',','.'))>0))
        throw Error('Строка '+(n+2)+': укажите фактическую положительную сумму «Оплачено»');
      if(!get('Дата оплаты'))throw Error('Строка '+(n+2)+': укажите дату оплаты');
      if(!get('Кошелёк'))throw Error('Строка '+(n+2)+': укажите кошелёк для движения денег');
      const rawDiscount=get('Скидка');
      const hasPercent=rawDiscount.endsWith('%');
      const discount=hasPercent?rawDiscount.slice(0,-1):rawDiscount;
      const shared={
        documentNumber:get('Номер документа'),invoiceDate:at('Дата счёта'),
        invoiceTime:at('Время'),workplace:get('Рабочее пространство'),
        participant:get('Имя / название'),uei:get('Код'),phone:get('Телефон'),
        subject:get('Наименование'),purpose,direction,
        price:meaningful(at('Цена'))?at('Цена'):undefined,
        ...(discount?hasPercent?{discountPercent:discount}:{discountMoney:discount}:{}),
        quotedTotal:meaningful(at('К оплате'))?at('К оплате'):undefined,
        integrationSource:financeSource,occurredAt:at('Дата оплаты'),
        wallet:get('Кошелёк'),note:get('Комментарий'),
        ...(get('Номер документа')?{sourceDocumentNumber:get('Номер документа')}:{}),
      };
      const values=route.service
        ?{...shared,amount:paid,date:at('Дата счёта'),from:at('Время'),
          procedure:get('Наименование'),name:get('Имя / название')}
        :{...shared,financeKind:route.kind,financeAmount:paid,article:route.article};
      facts.push({domain:route.service?'payments':'operations',
        sheet:sheet.name,row:n+2,sourceKey,values});
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
function financeColumns(_rows:any[],_template:boolean) {
  return [...FINANCE_BASE];
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
    {views:[{state:'frozen',ySplit:2,xSplit:1}]});
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
    sheet.columns=cols.map(col=>({key:col.key,width:Math.max(18,col.label.length+4),numFmt:'@'}));
    for(const [title,start,end] of FINANCE_SECTIONS){
      sheet.mergeCells(1,start,1,end);
      for(let c=start;c<=end;c++)sheet.getCell(1,c).fill=
        {type:'pattern',pattern:'solid',fgColor:{argb:'FFDEDFE0'}};
      const cell=sheet.getCell(1,start);cell.value=title;
      cell.font={bold:true,color:{argb:'FF25272B'},size:12};
      cell.alignment={vertical:'middle',horizontal:'center'};
    }
    sheet.getRow(1).height=30;sheet.getRow(2).height=34;
    cols.forEach((col,i)=>{
      const cell=sheet.getCell(2,i+1);cell.value=col.label;
      cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF303238'}};
      cell.alignment={vertical:'middle'};
    });
    sheet.getCell(2,2).note='Дата счёта или визита, не дата поступления денег.';
    sheet.getCell(2,7).note='Необязательный номер исходного документа. При разделённой оплате он повторяется.';
    sheet.getCell(2,12).note='Скидка: например 10% или 500 рублей.';
    sheet.getCell(2,13).note='Историческая итоговая стоимость. Не подтягивается из текущего прайса.';
    sheet.getCell(2,14).note='Только сумма этого движения по кошельку. При разделённой оплате повторите счёт в следующей строке.';
    sheet.getCell(2,15).note='Фактическая дата движения денег, может отличаться от даты счёта.';
  }
  if(!template)for(const input of rows) {
    const row:any={...input};
    if(domain==='records')for(let i=0;i<(input.services||[]).length;i++){
      const item=input.services[i]||{};
      row['service'+(i+1)]=text(item.name);
    }
    // Finance input rows already represent one movement per wallet.
    sheet.addRow(row);
  }
  const headerRow=2;
  sheet.autoFilter={from:{row:headerRow,column:1},to:{row:Math.max(headerRow,sheet.rowCount),column:cols.length-(domain==='records'?1:0)}};
  return Buffer.from(await book.xlsx.writeBuffer());
}


// Export-only document registry: this sheet is deliberately not the import template.
export async function financeRegistryWorkbook(rows:any[]):Promise<Buffer>{
 if(!Array.isArray(rows)||rows.length>20000)throw Error('Выгрузка допускает не более 20 000 строк за один раз');
 const columns=[
  ['workplace','Рабочее пространство',24],['occurredAt','Дата и время операции',24],
  ['code','Код',12],['person','Клиент / контрагент',28],['contact','Телефон',20],
  ['id','Номер документа',38],['title','Операция',20],['article','Статья',32],['status','Статус',16],
  ['wallet','Источник',30],['cashIn','Приход в кошельки',20],['cashOut','Расход из кошельков',20],
  ['depositPrincipal','Денежная часть депозита',24],['personal','Движение личного счёта',24],
  ['bonus','Бонусные движения',20],['depositNet','Итог по депозиту',22],['grossAmount','Стоимость до выгоды',22],['benefitGranted','Предоставленная выгода',24],['benefitReversed','Аннулирована при возврате',25],['benefitWrittenOff','Аннулирована при расторжении',27],['bonusUsed','Использовано бонусов',22],['bonusRestored','Восстановлено бонусов',24],['documentAmount','Сумма документа',20],['uncertainty','Неуточнённые данные',32],
 ] as const;
 const book=new ExcelJS.Workbook();
 const sheet=book.addWorksheet('Реестр ДДС',{views:[{state:'frozen',ySplit:2,xSplit:2}]});
 sheet.columns=columns.map(([key,label,width])=>({key,width,numFmt:['cashIn','cashOut','depositPrincipal','personal','bonus','depositNet','grossAmount','benefitGranted','benefitReversed','benefitWrittenOff','bonusUsed','bonusRestored','documentAmount'].includes(key)?'#,##0.00;[Red]-#,##0.00':'@'}));
 const groups=[['Операция',1,2],['Клиент / контрагент',3,5],['Документ',6,10],['Деньги',11,14],['Выгода и расчёт',15,22],['Документ и контроль',23,24]] as const;
 for(const [label,start,end] of groups){
  if(end>start)sheet.mergeCells(1,start,1,end);
  for(let c=start;c<=end;c++)sheet.getCell(1,c).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDEDFE0'}};
  const cell=sheet.getCell(1,start);cell.value=label;cell.font={bold:true,color:{argb:'FF25272B'},size:12};cell.alignment={vertical:'middle',horizontal:'center'};
 }
 sheet.getRow(1).height=30;sheet.getRow(2).height=34;
 columns.forEach(([,label],i)=>{const cell=sheet.getCell(2,i+1);cell.value=label;cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF303238'}};cell.alignment={vertical:'middle',wrapText:true};});
 sheet.getCell(2,13).note='Изменение ранее внесённых денежных средств, не повторное движение физического кошелька.';
 sheet.getCell(2,15).note='Бонусы не являются деньгами. Пустая ячейка при неуточнённой сумме не означает ноль.';
 sheet.getCell(2,16).note='Итоговое изменение доступного баланса депозита. Не складывать с отдельными денежными и бонусными компонентами.';
 sheet.getCell(2,23).note='Сумма исходного документа; не суммировать с его отдельными компонентами.';
 for(const input of rows){
  const row:Record<string,string|number|null>={};
  for(const [key] of columns){
   const value=input?.[key];
   if(['cashIn','cashOut','depositPrincipal','personal','bonus','depositNet','grossAmount','benefitGranted','benefitReversed','benefitWrittenOff','bonusUsed','bonusRestored','documentAmount'].includes(key))row[key]=typeof value==='number'&&Number.isFinite(value)?value:null;
   else row[key]=String(value??'');
  }
  sheet.addRow(row);
 }
 sheet.autoFilter={from:{row:2,column:1},to:{row:Math.max(2,sheet.rowCount),column:columns.length}};
 return Buffer.from(await book.xlsx.writeBuffer());
}
