import ExcelJS from 'exceljs';
import { Fact, text } from './formats';
import type { Sheet } from './source';

type Column = {key:string;label:string;width:number;hidden?:boolean};
export const CONTACT_COLUMNS:Column[]=[
  {key:'uei',label:'Код клиента',width:17},
  {key:'name',label:'Имя',width:25},
  {key:'surname',label:'Фамилия',width:25},
  {key:'gender',label:'Пол',width:12},
  {key:'birthday',label:'Дата рождения',width:20},
  {key:'discountPercent',label:'Скидка, %',width:16},
  {key:'phone',label:'Телефон',width:24},
  {key:'additionalPhone',label:'Дополнительный телефон',width:28},
  {key:'email',label:'Email',width:34},
  {key:'additionalEmail',label:'Дополнительный Email',width:34},
  {key:'telegram',label:'Telegram',width:26},
  {key:'additionalTelegram',label:'Дополнительный Telegram',width:30},
  {key:'personKey',label:'ID человека',width:16,hidden:true},
];

const pad=(n:number)=>String(n).padStart(2,'0');
export function formatContactBirthday(value:unknown):string {
  const raw=text(value);
  if(!raw)return '';
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if(match)return match[3]+'.'+match[2]+'.'+match[1];
  const md=/^(\d{2})-(\d{2})$/.exec(raw);
  return md?md[2]+'.'+md[1]:raw;
}
export function contactBirthday(value:unknown,date1904=false):string {
  if(value==null||value==='')return '';
  let day:number,month:number,year:number|undefined;
  if(value instanceof Date){
    if(!Number.isFinite(value.getTime()))throw Error('Неверная дата рождения');
    day=value.getUTCDate();month=value.getUTCMonth()+1;year=value.getUTCFullYear();
  }else if(typeof value==='number'){
    if(!Number.isFinite(value)||value<1||value>2958465||Math.floor(value)===60)
      throw Error('Неверная дата рождения');
    const days=Math.floor(value)+(date1904?1462:0);
    const parsed=new Date(Date.UTC(1899,11,31)+(days>60?days-1:days)*86400000);
    day=parsed.getUTCDate();month=parsed.getUTCMonth()+1;year=parsed.getUTCFullYear();
  }else{
    const raw=text(value).replace(/\.$/,'');
    const iso=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
    const knownMonthDay=/^(\d{2})-(\d{2})$/.exec(raw);
    const ordinary=/^(\d{1,2})[.\/\-](\d{1,2})(?:[.\/\-](\d{2}|\d{4}))?$/.exec(raw);
    if(iso){year=Number(iso[1]);month=Number(iso[2]);day=Number(iso[3]);}
    else if(ordinary){
      day=Number(ordinary[1]);month=Number(ordinary[2]);
      if(!ordinary[3] && knownMonthDay && Number(knownMonthDay[2])>12){
        // Canonical month-day, e.g. 06-15, from an earlier export.
        month=Number(knownMonthDay[1]);day=Number(knownMonthDay[2]);
      }
      if(ordinary[3]){
        year=Number(ordinary[3]);
        if(ordinary[3].length===2){
          const currentYear=new Date().getUTCFullYear();
          year=year+2000<=currentYear?year+2000:year+1900;
        }
      }
    }else throw Error('Дата рождения: укажите день и месяц, год необязателен');
  }
  if(month<1||month>12||day<1||day>31)throw Error('Неверная дата рождения');
  const checkYear=year===undefined?2000:year;
  if(checkYear<1900||checkYear>new Date().getUTCFullYear())throw Error('Неверный год рождения');
  const parsed=new Date(Date.UTC(checkYear,month-1,day));
  if(parsed.getUTCFullYear()!==checkYear||parsed.getUTCMonth()+1!==month||parsed.getUTCDate()!==day)
    throw Error('Неверная дата рождения');
  return year===undefined?pad(month)+'-'+pad(day)
    :String(year).padStart(4,'0')+'-'+pad(month)+'-'+pad(day);
}
function normalizedGender(value:unknown){
  const raw=text(value).toLocaleLowerCase('ru-RU').replace(/\./g,'').trim();
  if(!raw)return '';
  if(['м','муж','мужской','male'].includes(raw))return 'male';
  if(['ж','жен','женский','female'].includes(raw))return 'female';
  throw Error('Пол: укажите М, Ж, Мужской или Женский');
}
function splitName(value:unknown,surname:unknown){
  const source=text(value).replace(/\s+/g,' ');
  const last=text(surname);
  if(!source)return {name:'',surname:last};
  if(last||!source.includes(' '))return {name:source,surname:last};
  const [first,...rest]=source.split(' ');
  return {name:first,surname:rest.join(' ')};
}
function field(row:any[],headers:string[],label:string):unknown {
  const i=headers.indexOf(label);
  return i<0?'':row[i];
}
function nonempty(value:unknown){return value!==''&&value!=null;}
export function peopleExcelFacts(sheets:Sheet[],sourceFingerprint:string,source='Контакты'):Fact[]{
  if(sheets.length!==1||!['Люди','Данные'].includes(sheets[0]?.name))
    throw Error('Выберите файл из шаблона Контактов');
  const sheet=sheets[0];
  const grouped=sheet.headers[0]==='Личные данные'&&sheet.headers[6]==='Контактные данные';
  const headers=grouped?(sheet.rows[0]||[]).map(text):sheet.headers;
  const first=grouped?1:0;
  const offset=2;
  const required=CONTACT_COLUMNS.filter(c=>!c.hidden).map(c=>c.label);
  const legacy=headers.includes('UEI')&&headers.includes('Имя')&&!grouped;
  if(!legacy && required.some(label=>headers.filter(h=>h===label).length!==1))
    throw Error('В таблице отсутствуют необходимые столбцы. Скачайте актуальный шаблон.');
  if(legacy && !headers.includes('Телефон'))
    throw Error('Неверные столбцы контактов. Скачайте актуальный шаблон.');
  const cell=(row:any[],label:string)=>field(row,headers,label);
  const facts:Fact[]=[];
  for(let i=first;i<sheet.rows.length;i++){
    const row=sheet.rows[i];
    if(!row.some(nonempty))continue;
    const code=legacy?cell(row,'UEI'):cell(row,'Код клиента');
    const n=splitName(cell(row,'Имя'),cell(row,'Фамилия'));
    if(!n.name)throw Error('Строка '+(i+offset)+': укажите имя');
    const values:Record<string,any>={name:n.name,...(n.surname?{surname:n.surname}:{})};
    if(nonempty(code))values.uei=text(code);
    for(const [key,label] of [
      ['phone','Телефон'],['additionalPhone','Дополнительный телефон'],
      ['email','Email'],['additionalEmail','Дополнительный Email'],
      ['telegram','Telegram'],['additionalTelegram','Дополнительный Telegram'],
    ])if(nonempty(cell(row,label)))values[key]=text(cell(row,label));
    const gender=normalizedGender(cell(row,'Пол'));
    if(gender)values.gender=gender;
    const birthday=cell(row,'Дата рождения');
    if(nonempty(birthday))values.birthDate=contactBirthday(birthday,sheet.date1904===true);
    const percent=cell(row,'Скидка, %');
    if(nonempty(percent)){
      const rate=Number(text(percent).replace(/\s/g,'').replace('%','').replace(',','.'));
      if(!Number.isFinite(rate)||rate<0||rate>100)
        throw Error('Строка '+(i+offset)+': скидка должна быть от 0 до 100%');
      values.discountPercent=rate;
    }
    const key=cell(row,'ID человека');
    if(nonempty(key))values.personKey=text(key);
    const sourceKey=values.personKey?source+':people:'+values.personKey
      :(sheet.stableFingerprint||sourceFingerprint)+':'+(i+offset);
    facts.push({domain:'people',sheet:sheet.name,row:i+offset,sourceKey,values});
  }
  return facts;
}
export async function peopleWorkbook(rows:any[],template=false):Promise<Buffer>{
  if(!Array.isArray(rows)||rows.length>20000)throw Error('За один раз допускается до 20 000 контактов');
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('Люди',{views:[{state:'frozen',ySplit:2}]});
  sheet.columns=CONTACT_COLUMNS.map(col=>({
    key:col.key,width:col.width,hidden:!!col.hidden,
    // Preserve leading zeros in codes and prevent Excel from changing phone
    // or birthdays into unrelated numeric or date formats.
    numFmt:'@',
  }));
  sheet.mergeCells('A1:F1');
  sheet.mergeCells('G1:L1');
  for(const [key,label] of [['A1','Личные данные'],['G1','Контактные данные']]){
    const cell=sheet.getCell(key);
    cell.value=label;
    cell.font={bold:true,color:{argb:'FFFFFFFF'},size:12};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF303238'}};
    cell.alignment={vertical:'middle',horizontal:'left',indent:1};
  }
  sheet.getRow(1).height=30;
  sheet.getRow(2).height=34;
  CONTACT_COLUMNS.forEach((col,index)=>{
    const cell=sheet.getCell(2,index+1);
    cell.value=col.label;
    cell.font={bold:true,color:{argb:'FF25272B'},size:11};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEDEEF0'}};
    cell.alignment={vertical:'middle',horizontal:'left',indent:1};
  });
  sheet.getCell('A2').note='Код клиента необязателен. Не более четырёх букв или цифр.';
  sheet.getCell('B2').note='Можно указать имя и фамилию вместе, через пробел.';
  sheet.getCell('D2').note='М, Ж, Мужской или Женский. Можно оставить пустым.';
  sheet.getCell('E2').note='День и месяц, например 15.06 или 15/6. Год необязателен; если известен, добавьте его.';
  sheet.getCell('F2').note='Личная скидка в процентах. Если нет — оставьте пустым.';
  sheet.getCell('G2').note='Телефон или код клиента помогают найти уже существующую карточку.';
  if(!template)for(const input of rows){
    const item=input&&typeof input==='object'?input:{};
    const row=sheet.addRow(Object.fromEntries(CONTACT_COLUMNS.map(col=>[
      col.key,
      col.key==='birthday'?formatContactBirthday(item.birthday)
        :col.key==='gender'?item.gender==='male'?'М':item.gender==='female'?'Ж':''
        :String(item[col.key]??''),
    ])));
    for(let i=1;i<=CONTACT_COLUMNS.length;i++)row.getCell(i).numFmt='@';
  }
  sheet.autoFilter={from:{row:2,column:1},to:{row:Math.max(2,sheet.rowCount),column:12}};
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
