import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { BusinessStateService } from '../business-state/business-state.service';
import { peopleExcelFacts } from './contacts-excel';
import { readSource, SourceInput, Sheet } from './source';
import { normalizePhone } from '../../../core/phone/index.js';
import { normalizeUEI } from '../../../core/uei-format.js';

type Obj = Record<string, any>;
type Tx = Prisma.TransactionClient;
type Issue = {
  field: string; label: string; system: string; excel: string;
  owners: Array<{ key: string; code: string; name: string }>;
  decision?: { mode: 'keep' | 'replace' | 'remove'; value: string };
};
type Row = { id: string; rowNumber: number; values: Prisma.JsonValue; issues: Prisma.JsonValue;
  status: string; personKey: string; error: string };
const text = (v:unknown)=>String(v??'').trim();
const obj = (v:unknown):Obj => v && typeof v==='object' && !Array.isArray(v) ? v as Obj : {};
const arr = (v:unknown):Obj[]=>Array.isArray(v)?v.map(obj):[];
const phone = (v:unknown)=>{ try {return text(v)?normalizePhone(v):'';}catch{return '';} };
const code = (v:unknown)=>{try{return text(v)?normalizeUEI(v):'';}catch{return '';}};
const email = (v:unknown)=>text(v).toLocaleLowerCase('ru-RU');
const norm = (v:unknown)=>text(v).toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ');
const labels:Record<string,string>={
  uei:'Код клиента',phone:'Телефон',additionalPhone:'Дополнительный телефон',
  email:'Email',additionalEmail:'Дополнительный Email',name:'Имя',
  surname:'Фамилия',birthDate:'Дата рождения',gender:'Пол',
  discountPercent:'Скидка',telegram:'Telegram',additionalTelegram:'Дополнительный Telegram',
  note:'Примечание',format:'Данные строки',
};
const primaryFields=['uei','phone','name','surname','email','additionalPhone',
  'additionalEmail','birthDate','gender','discountPercent','telegram','additionalTelegram','note'];
const fieldNorm=(field:string,value:unknown)=>{
  if(field==='uei')return code(value);
  if(field==='phone'||field==='additionalPhone')return phone(value);
  if(field==='email'||field==='additionalEmail')return email(value);
  if(field==='discountPercent')return text(value).replace(',','.');
  return norm(value);
};
const relevant=(v:Obj,field:string)=>text(v[field])!=='';
const ownerLabel=(person:Obj,identity:Obj)=>({
  key:text(person.key),
  code:text(obj(identity.relations)['person:'+text(person.key)]||person.uei),
  name:[text(person.name),text(person.surname)].filter(Boolean).join(' '),
});
const existingField=(person:Obj,identity:Obj,field:string):string=>{
  if(field==='uei')return text(obj(identity.relations)['person:'+text(person.key)]||person.uei);
  const map:Record<string,string>={email:'emails',additionalEmail:'emails',
    phone:'phones',additionalPhone:'phones',telegram:'telegrams',additionalTelegram:'telegrams'};
  if(map[field])return text(Array.isArray(person[map[field]])
    ?person[map[field]][field.startsWith('additional')?1:0]:'');
  return text(person[field]);
};
const present=(person:Obj,field:string,value:unknown):boolean=>{
  const map:Record<string,string>={email:'emails',additionalEmail:'emails',
    phone:'phones',additionalPhone:'phones',telegram:'telegrams',additionalTelegram:'telegrams'};
  if(map[field])return (Array.isArray(person[map[field]])?person[map[field]]:[])
    .some((candidate:unknown)=>fieldNorm(field,candidate)===fieldNorm(field,value));
  return fieldNorm(field,person[field])===fieldNorm(field,value);
};
function issue(field:string,existing:unknown,incoming:unknown,owners:Issue['owners']=[]):Issue{
  return {field,label:labels[field]||field,system:text(existing),excel:text(incoming),owners};
}
function matches(people:Obj[],identity:Obj,values:Obj){
  const p=phone(values.phone),u=code(values.uei);
  const byPhone=p?people.filter(person=>[...(Array.isArray(person.phones)?person.phones:[])].some((v:unknown)=>phone(v)===p)):[];
  const byCode=u?people.filter(person=>code(obj(identity.relations)['person:'+text(person.key)]||person.uei)===u):[];
  const found=byPhone.length===1?byPhone[0]:byCode.length===1?byCode[0]:null;
  return {found,byPhone,byCode};
}
function inspect(values:Obj,people:Obj[],identity:Obj,file:Obj[],rowNumber:number,originalIssues:Issue[]=[]){
  const {found,byPhone,byCode}=matches(people,identity,values);
  const issues=new Map<string,Issue>();
  const add=(field:string,system:unknown,excelValue:unknown,owners:Issue['owners']=[])=>
    issues.set(field,issue(field,system,excelValue,owners));
  if(byPhone.length>1)add('phone',byPhone.map(p=>ownerLabel(p,identity).name).join('; '),values.phone,byPhone.map(p=>ownerLabel(p,identity)));
  if(byCode.length>1)add('uei',byCode.map(p=>ownerLabel(p,identity).name).join('; '),values.uei,byCode.map(p=>ownerLabel(p,identity)));
  if(byPhone.length===1 && byCode.length===1 && byPhone[0].key!==byCode[0].key)
    add('uei',existingField(byPhone[0],identity,'uei'),values.uei,[ownerLabel(byCode[0],identity)]);
  if(found){
    for(const field of primaryFields){
      if(!relevant(values,field))continue;
      const current=existingField(found,identity,field);
      if(field==='uei' && byCode.length===1 && byCode[0].key!==found.key)continue;
      if(field==='phone'||field==='additionalPhone'||field==='email'
        ||field==='additionalEmail'||field==='telegram'||field==='additionalTelegram'){
        if(current&&!present(found,field,values[field]))add(field,current,values[field]);
      }else if(current&&fieldNorm(field,current)!==fieldNorm(field,values[field])){
        add(field,current,values[field]);
      }
    }
  }else if(!phone(values.phone)&&!code(values.uei)){
    add('phone','',values.phone||'Укажите телефон или код клиента');
  }
  // A source file must not silently assign the same phone, code or email to
  // two different rows. Each row is resolved independently.
  for(const [field,normalizer] of [['phone',phone],['uei',code],['email',email]] as const){
    const current=normalizer(values[field]);
    if(!current)continue;
    const overlapping=file.filter(row=>row.row!==rowNumber
      && normalizer(obj(row.values)[field])===current);
    if(overlapping.length && overlapping.some(row=>
      norm(obj(row.values).name)!==norm(values.name)
      ||norm(obj(row.values).surname)!==norm(values.surname)
      ||field==='email')){
      const owners=overlapping.map(row=>({
        key:'excel:'+row.row,code:text(obj(row.values).uei),
        name:[text(obj(row.values).name),text(obj(row.values).surname)].filter(Boolean).join(' '),
      }));
      add(field,existingField(found||{},identity,field)||'Повтор в Excel',values[field],owners);
    }
  }
  // Email collisions across existing contacts must also be explicitly
  // acknowledged, regardless of whether shared addresses are legitimate.
  for(const field of ['email','additionalEmail']){
    if(!relevant(values,field))continue;
    const owners=people.filter(p=>p.key!==found?.key && present(p,'email',values[field]));
    if(owners.length)add(field,existingField(found||{},identity,field)||'Email занят',
      values[field],owners.map(p=>ownerLabel(p,identity)));
  }
  for(const field of ['phone','additionalPhone']){
    if(!relevant(values,field))continue;
    const owners=people.filter(p=>p.key!==found?.key && present(p,'phone',values[field]));
    if(owners.length)add(field,existingField(found||{},identity,field)||'Телефон занят',
      values[field],owners.map(p=>ownerLabel(p,identity)));
  }
  if(values.uei && !code(values.uei))add('uei','',values.uei);
  if(values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(values.email)))
    add('email','',values.email);
  for(const previous of originalIssues){
    if(previous.field==='format')add('format',previous.system,previous.excel,previous.owners||[]);
  }
  return {person:found,issues:[...issues.values()]};
}
@Injectable()
export class ContactImportService {
  constructor(private readonly prisma:PrismaService,private readonly people:BusinessStateService){}

  private async getBatch(tenantId:string,batchId:string,tx:PrismaService|Tx=this.prisma){
    const batch=await tx.contactImportBatch.findFirst({where:{id:batchId,tenantId}});
    if(!batch)throw new NotFoundException('Загрузка не найдена');
    return batch;
  }
  private async current(tx:Tx,tenantId:string){
    const [rows,state]=await Promise.all([
      tx.person.findMany({where:{tenantId}}),
      tx.ueiState.findUnique({where:{tenantId}}),
    ]);
    return {people:rows.map(row=>obj(row.data)),identity:obj(state?.data)};
  }
  private async fileRows(tx:Tx,batchId:string){
    return tx.contactImportRow.findMany({where:{batchId},orderBy:{rowNumber:'asc'}});
  }
  private summary(batch:Obj,rows:Row[],withRows=false){
    const done=rows.filter(r=>r.status==='done').length;
    const pending=rows.filter(r=>r.status!=='done').length;
    const issues=rows.filter(r=>r.status!=='done').flatMap(row=>
      ((Array.isArray(row.issues)?row.issues:[]) as unknown as Issue[]).filter(i=>!i.decision||Boolean(row.error))
        .map(i=>({...i,rowNumber:row.rowNumber,rowId:row.id,
          personKey:row.personKey,contact:[
            text(obj(row.values).uei),text(obj(row.values).name),
            text(obj(row.values).surname),
          ].filter(Boolean).join(' '),error:row.error})));
    const groups=Object.entries(issues.reduce((a:Obj,i:Issue)=>{
      const key=text(i.field);a[key] ||= {field:key,label:i.label,count:0};a[key].count++;return a;
    },{})).map(([,v])=>v);
    return {id:batch.id,filename:batch.filename,total:batch.total,
      done,pending,groupCount:groups.length,groups,status:pending?'review':'completed',
      createdAt:batch.createdAt,
      ...(withRows?{issues,rows:rows.map(r=>({
        rowNumber:r.rowNumber,status:r.status,personKey:r.personKey,
        name:[text(obj(r.values).name),text(obj(r.values).surname)].filter(Boolean).join(' '),
        code:text(obj(r.values).uei),error:r.error,
      }))}:{}),
    };
  }
  async list(tenantId:string){
    const batches=await this.prisma.contactImportBatch.findMany({
      where:{tenantId},orderBy:{createdAt:'desc'},take:100,
      include:{rows:{orderBy:{rowNumber:'asc'}}},
    });
    return batches.map(batch=>this.summary(batch,batch.rows));
  }
  async detail(tenantId:string,batchId:string){
    const batch=await this.prisma.contactImportBatch.findFirst({
      where:{tenantId,id:batchId},include:{rows:{orderBy:{rowNumber:'asc'}}},
    });
    if(!batch)throw new NotFoundException('Загрузка не найдена');
    return this.summary(batch,batch.rows,true);
  }
  async create(tenantId:string,accountId:string,input:SourceInput){
    const file=await readSource(input);
    const existing=await this.prisma.contactImportBatch.findFirst({
      where:{tenantId,fingerprint:file.fingerprint},
      orderBy:{createdAt:'desc'},
    });
    if(existing)return this.detail(tenantId,existing.id);
    const sheet=file.sheets[0];
    if(file.sheets.length!==1 || !['Люди','Данные'].includes(sheet?.name))
      throw new BadRequestException('Выберите Excel из раздела Контакты');
    const grouped=sheet.headers[0]==='Личные данные';
    const rows:Obj[]=[];
    for(let i=grouped?1:0;i<sheet.rows.length;i++){
      const row=sheet.rows[i];
      if(!row.some(x=>x!==''&&x!=null))continue;
      const rowNumber=i+2;
      const subSheet:Sheet={...sheet,rows:grouped?[sheet.rows[0],row]:[row]};
      try {
        const fact=peopleExcelFacts([subSheet],file.fingerprint,text(input.source)||'Контакты')[0];
        if(!fact)continue;
        rows.push({row:rowNumber,values:fact.values,issues:[]});
      }catch(error){
        const headers=grouped?(sheet.rows[0]||[]).map(text):sheet.headers;
        const at=(label:string)=>text(row[headers.indexOf(label)]);
        rows.push({row:rowNumber,values:{
          name:at('Имя'),surname:at('Фамилия'),phone:at('Телефон'),
          uei:at('Код клиента'),email:at('Email'),note:at('Примечание'),
        },issues:[issue('format',(error as Error).message,'Исправьте строку Excel')]});
      }
    }
    if(!rows.length)throw new BadRequestException('В файле нет контактов');
    // Store first, before processing anything. A failed browser request can
    // never lose the uploaded source or partially completed review.
    const id=randomUUID();
    await this.prisma.contactImportBatch.create({data:{
      id,tenantId,accountId,filename:text(input.filename)||'Контакты.xlsx',
      fingerprint:file.fingerprint,total:rows.length,
      rows:{create:rows.map(row=>({
        id:randomUUID(),tenantId,rowNumber:row.row,
        values:row.values as Prisma.InputJsonValue,
        issues:row.issues as Prisma.InputJsonValue,
        status:row.issues.length?'review':'new',
      }))},
    }});
    // Resolve obvious cases in bounded chunks. The Q UI continues /advance.
    await this.advance(tenantId,id,30);
    return this.detail(tenantId,id);
  }
  async advance(tenantId:string,batchId:string,limit=30){
    await this.getBatch(tenantId,batchId);
    const size=Math.min(100,Math.max(1,Number(limit)||30));
    const work=await this.prisma.contactImportRow.findMany({
      where:{tenantId,batchId,status:'new'},orderBy:{rowNumber:'asc'},take:size,
    });
    for(const row of work){
      await this.prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))::text`;
        const latest=await tx.contactImportRow.findFirst({where:{id:row.id,tenantId,batchId}});
        if(!latest||latest.status!=='new')return;
        const {people,identity}=await this.current(tx,tenantId);
        const all=(await this.fileRows(tx,batchId)).map(item=>({
          row:item.rowNumber,values:obj(item.values),
        }));
        const checked=inspect(obj(latest.values),people,identity,all,latest.rowNumber,
          arr(latest.issues) as unknown as Issue[]);
        if(checked.issues.length){
          await tx.contactImportRow.update({where:{id:latest.id},data:{
            status:'review',personKey:text(checked.person?.key),
            issues:checked.issues as unknown as Prisma.InputJsonValue,
          }});
        }else{
          try{
            const personKey=await this.safeImport(tx,tenantId,obj(latest.values),
              text(checked.person?.key),[]);
            await tx.contactImportRow.update({where:{id:latest.id},
              data:{status:'done',personKey,issues:[] as Prisma.InputJsonValue,error:''}});
          }catch(error){
            await tx.contactImportRow.update({where:{id:latest.id},data:{
              status:'review',personKey:text(checked.person?.key),
              error:text((error as Error).message),
              issues:[issue('format',text((error as Error).message),'Проверьте контакт')] as Prisma.InputJsonValue,
            }});
          }
        }
      },{timeout:30000});
    }
    const left=await this.prisma.contactImportRow.count({where:{tenantId,batchId,status:'new'}});
    if(!left)await this.complete(tenantId,batchId);
    return {...await this.detail(tenantId,batchId),more:left>0};
  }
  private async complete(tenantId:string,batchId:string){
    const pending=await this.prisma.contactImportRow.count({
      where:{tenantId,batchId,status:{not:'done'}},
    });
    await this.prisma.contactImportBatch.update({
      where:{id:batchId},data:{status:pending?'review':'completed'},
    });
  }
  private async safeImport(tx:Tx,tenantId:string,values:Obj,targetId:string,decisions:Issue[]){
    const payload={...values};const ownership:Obj={};
    const existing=targetId?await tx.person.findFirst({where:{tenantId,key:targetId}}):null;
    if(targetId&&!existing)throw new ConflictException('Контакт изменён или удалён. Требуется повторная проверка.');
    const previous=obj(existing?.data);
    const identity=targetId?await tx.ueiState.findUnique({where:{tenantId}}):null;
    const savedCode=text(obj(obj(identity?.data).relations)['person:'+targetId]||previous.uei);
    for(const issue of decisions){
      const decision=issue.decision;
      if(!decision)throw new BadRequestException('Сначала разрешите все различия');
      const field=issue.field;
      if(field==='format')throw new BadRequestException('Исправьте исходные данные строки Excel');
      if(decision.mode==='keep'||decision.mode==='remove'){
        delete payload[field];continue;
      }
      payload[field]=decision.value;
      if(field==='uei'&&savedCode)ownership.uei=savedCode;
      if(['name','surname','birthDate','gender','note','discountPercent'].includes(field)
        &&previous[field]!==undefined)ownership[field]=previous[field];
      if(field==='email'&&Array.isArray(previous.emails)&&previous.emails.length)
        ownership.email=previous.emails[0];
      if(field==='phone'&&Array.isArray(previous.phones)&&previous.phones.length)
        ownership.phone=previous.phones[0];
    }
    for(const field of ['name','surname','note','birthDate','gender','discountPercent'])
      if(previous[field] && payload[field]!==undefined
        && fieldNorm(field,previous[field])!==fieldNorm(field,payload[field])
        && !ownership.hasOwnProperty(field))
        throw new ConflictException('Данные контакта изменились. Повторно проверьте: '+(labels[field]||field));
    if(!text(payload.name)&&!targetId)
      throw new BadRequestException('Укажите имя контакта');
    return this.people.importPerson(tenantId,payload,targetId,tx,ownership);
  }
  async decide(tenantId:string,batchId:string,body:unknown){
    const action=obj(body),rowNumber=Number(action.rowNumber);
    const field=text(action.field),mode=text(action.mode),value=text(action.value);
    if(!Number.isInteger(rowNumber)||rowNumber<1||!labels[field]
      ||!['keep','replace','remove'].includes(mode)||value.length>500)
      throw new BadRequestException('Неверное решение для различия');
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))::text`;
      await this.getBatch(tenantId,batchId,tx);
      const row=await tx.contactImportRow.findUnique({
        where:{batchId_rowNumber:{batchId,rowNumber}},
      });
      if(!row||row.tenantId!==tenantId)throw new NotFoundException('Строка загрузки не найдена');
      if(row.status==='done')return this.summary(await this.getBatch(tenantId,batchId,tx),
        await this.fileRows(tx,batchId),true);
      let issues=arr(row.issues) as unknown as Issue[];
      const changed=issues.find(item=>item.field===field);
      if(!changed)throw new BadRequestException('Различие уже устранено');
      if(mode==='replace'){
        if(!value && !['email','additionalEmail','telegram','additionalTelegram','note'].includes(field))
          throw new BadRequestException('Укажите новое значение');
        if(field==='uei'&&(!code(value)||code(value)==='0000'))
          throw new BadRequestException('Код клиента: от 1 до 4 букв или цифр');
        if((field==='phone'||field==='additionalPhone')&&!phone(value))
          throw new BadRequestException('Неверный номер телефона');
        if((field==='email'||field==='additionalEmail') && value
          && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
          throw new BadRequestException('Неверный Email');
      }
      changed.decision={mode:mode as 'keep' | 'replace' | 'remove',value};
      const stillPending=issues.some(item=>!item.decision);
      if(stillPending){
        await tx.contactImportRow.update({where:{id:row.id},
          data:{issues:issues as unknown as Prisma.InputJsonValue,error:''}});
      }else{
        try{
          const key=await this.safeImport(tx,tenantId,obj(row.values),row.personKey,issues);
          await tx.contactImportRow.update({where:{id:row.id},data:{
            status:'done',personKey:key,issues:issues as unknown as Prisma.InputJsonValue,error:'',
          }});
        }catch(error){
          // Keep all decisions but leave this row in review; the form shows
          // the error and a field can be corrected without uploading again.
          await tx.contactImportRow.update({where:{id:row.id},data:{
            issues:issues as unknown as Prisma.InputJsonValue,
            error:text((error as Error).message),
          }});
        }
      }
      const rows=await this.fileRows(tx,batchId);
      const batch=await this.getBatch(tenantId,batchId,tx);
      await tx.contactImportBatch.update({where:{id:batchId},
        data:{status:rows.every(r=>r.status==='done')?'completed':'review'}});
      return this.summary(batch,rows,true);
    },{timeout:30000});
  }
}
