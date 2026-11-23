import ExcelJS from 'exceljs';
import { Fact, text } from './formats';
import type { Sheet } from './source';

// Visible columns mirror the Professional contact editor. One person per row.
export const CONTACT_COLUMNS = [
  {key:'uei',label:'Код клиента',width:20},
  {key:'name',label:'Имя',width:24},
  {key:'surname',label:'Фамилия',width:24},
  {key:'gender',label:'Пол',width:16},
  {key:'birthday',label:'Дата рождения',width:20},
  {key:'discountPercent',label:'Скидка, %',width:16},
  {key:'phone',label:'Телефон',width:23},
  {key:'additionalPhone',label:'Дополнительный телефон',width:27},
  {key:'email',label:'Email',width:31},
  {key:'additionalEmail',label:'Дополнительный Email',width:32},
  {key:'telegram',label:'Telegram',width:24},
  {key:'additionalTelegram',label:'Дополнительный Telegram',width:29},
  {key:'personKey',label:'Ключ карточки',width:20,hidden:true},
] as const;

const MAPPING:Record<string,string> = Object.fromEntries(CONTACT_COLUMNS.map(col=>[col.label,col.key]));
const LEGACY:Record<string,string>={UEI:'uei','ID человека CO-VA':'personKey'};
function safeText(value:unknown):string { return text(value); }

export async function peopleWorkbook(rows:any[], template=false):Promise<Buffer> {
  if(!Array.isArray(rows)||rows.length>20000)
    throw Error('В таблице допускается не более 20 000 человек');
  const book=new ExcelJS.Workbook();
  book.creator='VA Tools';
  const sheet=book.addWorksheet('Люди',{views:[{state:'frozen',ySplit:2,xSplit:1}]});
  sheet.columns=CONTACT_COLUMNS.map(col=>({
    key:col.key,width:col.width,hidden:'hidden' in col?col.hidden:false,
  }));
  sheet.mergeCells('A1:F1');
  sheet.mergeCells('G1:L1');
  sheet.getCell('A1').value='Личные данные';
  sheet.getCell('G1').value='Контактные данные';
  sheet.getRow(1).height=34;
  sheet.getRow(2).height=31;
  for(const [from,to,hex] of [[1,6,'FF303238'],[7,12,'FF46505A']] as const){
    const cell=sheet.getCell(1,from);
    cell.font={bold:true,color:{argb:'FFFFFFFF'},size:13};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:hex}};
    cell.alignment={horizontal:'left',vertical:'middle',indent:1};
    sheet.getRow(2).eachCell({includeEmpty:true},()=>{});
    for(let n=from;n<=to;n++){
      const h=sheet.getCell(2,n);
      h.value=CONTACT_COLUMNS[n-1].label;
      h.font={bold:true,color:{argb:'FFFFFFFF'},size:11};
      h.fill={type:'pattern',pattern:'solid',fgColor:{argb:hex}};
      h.alignment={vertical:'middle',horizontal:'left',indent:1,wrapText:true};
    }
  }
  sheet.getCell('M2').value=CONTACT_COLUMNS[12].label;
  sheet.getColumn(13).hidden=true;
  sheet.getCell('A2').note='Если код клиента известен, укажите его. Если нет — оставьте пустым.';
  sheet.getCell('B2').note='Можно написать имя и фамилию в одной ячейке. При загрузке они разделятся.';
  sheet.getCell('E2').note='Год необязателен. Например: 15.06, 15/6, 15.06.85, 15/6/1985.';
  sheet.getCell('F2').note='Личная скидка в процентах, от 0 до 100. Необязательное поле.';
  sheet.getCell('G2').note='Телефон помогает найти существующую карточку человека.';
  for(const column of [1,5,7,8,9,10,11,12,13])
    sheet.getColumn(column).numFmt='@';
  (sheet as any).dataValidations.add('D3:D20002',{
    type:'list',allowBlank:true,formulae:['"Мужской,Женский"'],
  });
  if(!template)for(const item of rows){
    const input=item&&typeof item==='object'?item:{};
    const values=CONTACT_COLUMNS.map(col=>safeText(input[col.key]));
    const row=sheet.addRow(values);
    for(const c of [1,5,7,8,9,10,11,12,13])row.getCell(c).numFmt='@';
  }
  sheet.autoFilter={from:{row:2,column:1},to:{row:Math.max(2,sheet.rowCount),column:12}};
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function peopleExcelFacts(sheets:Sheet[],fingerprint:string,source:string):Fact[]{
  if(sheets.length!==1||sheets[0]?.name!=='Люди')
    throw Error('Выберите шаблон Контактов');
  const sheet=sheets[0];
  const headers=sheet.headers.map(safeText);
  const mapping:Record<string,number>={};
  for(let i=0;i<headers.length;i++){
    const label=headers[i];
    const key=MAPPING[label]||LEGACY[label];
    if(!key)continue;
    if(mapping[key]!==undefined)throw Error('Столбец «'+label+'» повторяется');
    mapping[key]=i;
  }
  if(mapping.name===undefined)throw Error('В таблице отсутствует столбец «Имя»');
  // New grouped templates are a strict contract. Keep accepting the older
  // one-header worksheet, so previous downloads do not stop importing.
  if(sheet.headerRow===2){
    for(const col of CONTACT_COLUMNS.slice(0,12))
      if(mapping[col.key]===undefined)
        throw Error('В таблице отсутствует столбец «'+col.label+'»');
  }
  const result:Fact[]=[];
  for(let i=0;i<sheet.rows.length;i++){
    const row=sheet.rows[i];
    if(!row.some(v=>v!==''&&v!=null))continue;
    const values:Record<string,any>={};
    for(const [key,index] of Object.entries(mapping)){
      const value=row[index];
      if(value!==''&&value!=null)values[key]=value;
    }
    const rowNumber=i+(sheet.headerRow||1)+1;
    result.push({
      domain:'people',sheet:sheet.name,row:rowNumber,
      sourceKey:(sheet.stableFingerprint||fingerprint)+':'+sheet.name+':'+rowNumber,
      values,
    });
  }
  return result;
}

// The contact editor stores birthday without a year as MM-DD. A complete
// birthdate remains YYYY-MM-DD; no fictitious year is introduced.
export function parsePersonBirthday(input:unknown,now=new Date()):string{
  if(input==null||input==='')return '';
  if(input instanceof Date && Number.isFinite(input.getTime()))
    return input.toISOString().slice(0,10);
  if(typeof input==='number'){
    if(!Number.isFinite(input)||input<1||input>2958465||Math.floor(input)===60)
      throw Error('Дата рождения: неверная дата Excel');
    const days=Math.floor(input);
    return new Date(Date.UTC(1899,11,31)+(days>60?days-1:days)*86400000).toISOString().slice(0,10);
  }
  let raw=text(input).replace(/[.\/-]$/,'');
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
    const [year,month,day]=raw.split('-').map(Number);
    if(!validBirthday(year,month,day))throw Error('Дата рождения: проверьте день, месяц и год');
    return raw;
  }
  if(/^\d{1,2}-\d{1,2}$/.test(raw) && Number(raw.split('-')[0])<=12){
    const [month,day]=raw.split('-').map(Number);
    if(!validBirthday(2000,month,day))throw Error('Дата рождения: проверьте день и месяц');
    return pad(month)+'-'+pad(day);
  }
  const match=/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(raw);
  if(!match)throw Error('Дата рождения: используйте день и месяц, год необязателен');
  const day=Number(match[1]),month=Number(match[2]);
  if(!match[3]){
    if(!validBirthday(2000,month,day))throw Error('Дата рождения: проверьте день и месяц');
    return pad(month)+'-'+pad(day);
  }
  let year=Number(match[3]);
  if(match[3].length===2){
    const current=now.getUTCFullYear();
    const century=Math.floor(current/100)*100;
    year=century+year;
    if(year>current)year-=100;
  }
  if(!validBirthday(year,month,day) || year>now.getUTCFullYear())
    throw Error('Дата рождения: проверьте день, месяц и год');
  return String(year).padStart(4,'0')+'-'+pad(month)+'-'+pad(day);
}
function pad(n:number){return String(n).padStart(2,'0');}
function validBirthday(year:number,month:number,day:number):boolean{
  if(!Number.isInteger(year)||year<1||year>9999||month<1||month>12||day<1||day>31)return false;
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}
