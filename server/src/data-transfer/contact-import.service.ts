import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { BusinessStateService } from '../business-state/business-state.service';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { peopleExcelFacts, contactBirthday } from './contacts-excel';
import { inspectContactRow } from './contact-review-inspect';
import type { ReviewIssue } from './contact-review-inspect';
import { contactMatches, findContactCandidates, reliableContactCandidate } from './contact-identity';
import { readSource, SourceInput, Sheet } from './source';
import { normalizePhone } from '../../../core/phone/index.js';
import { normalizeUEI } from '../../../core/uei-format.js';

type Obj = Record<string, any>;
type Tx = Prisma.TransactionClient;
type Issue = ReviewIssue;
type Row = { id: string; rowNumber: number; values: Prisma.JsonValue; issues: Prisma.JsonValue;
  status: string; personKey: string; error: string };
const text = (v:unknown)=>String(v??'').trim();
const obj = (v:unknown):Obj => v && typeof v==='object' && !Array.isArray(v) ? v as Obj : {};
const arr = (v:unknown):Obj[]=>Array.isArray(v)?v.map(obj):[];
const processed=(status:string)=>status==='done'||status==='unchanged';
const phone = (v:unknown)=>{ try {return text(v)?normalizePhone(v):'';}catch{return '';} };
const code = (v:unknown)=>{try{return text(v)?normalizeUEI(v):'';}catch{return '';}};
const email = (v:unknown)=>text(v).toLocaleLowerCase('ru-RU');
const norm = (v:unknown)=>text(v).toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ');
const labels:Record<string,string>={
  uei:'Код клиента',phone:'Телефон',additionalPhone:'Дополнительный телефон',
  email:'Email',additionalEmail:'Дополнительный Email',name:'Имя',
  surname:'Фамилия',birthDate:'Дата рождения',gender:'Пол',
  discountPercent:'Скидка',telegram:'Telegram',additionalTelegram:'Дополнительный Telegram',
  note:'Примечание',format:'Данные строки',identity:'Совпадение контакта',
};
const fieldNorm=(field:string,value:unknown)=>{
  if(field==='uei')return code(value);
  if(field==='phone'||field==='additionalPhone')return phone(value);
  if(field==='email'||field==='additionalEmail')return email(value);
  if(field==='discountPercent')return text(value).replace(',','.');
  return norm(value);
};
function issue(field:string,existing:unknown,incoming:unknown,owners:Issue['owners']=[]):Issue{
  return {field,label:labels[field]||field,system:text(existing),excel:text(incoming),owners};
}
const inspect=inspectContactRow;
@Injectable()
export class ContactImportService {
  constructor(private readonly prisma:PrismaService,private readonly people:BusinessStateService,
    private readonly access:SaasAccessService){}
  private async assertAccess(tenantId:string){
    const access=await this.access.resolveTenantAccess(tenantId);
    if(access.status!=='ACTIVE'||access.commercialMode!=='LIVE')
      throw new BadRequestException('Загрузка реальных контактов доступна только в рабочем режиме');
  }

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
    const done=rows.filter(r=>processed(r.status)).length;
    const skipped=rows.filter(r=>r.status==='unchanged').length;
    const pending=rows.length-done;
    const issues=rows.filter(r=>!processed(r.status)).flatMap(row=>
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
      done,skipped,pending,groupCount:groups.length,groups,status:pending?'review':'completed',
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
    await this.assertAccess(tenantId);
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
    try{
      peopleExcelFacts([{...sheet,rows:grouped?[sheet.rows[0]]:[]}],
        file.fingerprint,text(input.source)||'Контакты');
    }catch(error){
      throw new BadRequestException(text((error as Error).message));
    }
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
        const at=(label:string)=>headers.indexOf(label)<0?'':text(row[headers.indexOf(label)]);
        const message=text((error as Error).message);
        const field=/имя/i.test(message)?'name'
          :/дата рождения|год рождения/i.test(message)?'birthDate'
          :/пол:/i.test(message)?'gender'
          :/скидк/i.test(message)?'discountPercent'
          :/телефон/i.test(message)?'phone':'format';
        const raw:Obj={
          name:at('Имя'),surname:at('Фамилия'),phone:at('Телефон'),
          additionalPhone:at('Дополнительный телефон'),
          email:at('Email'),additionalEmail:at('Дополнительный Email'),
          uei:at('Код клиента')||at('UEI'),birthDate:at('Дата рождения'),
          gender:at('Пол'),discountPercent:at('Скидка, %'),
          telegram:at('Telegram'),additionalTelegram:at('Дополнительный Telegram'),
          note:at('Примечание'),integrationSource:at('Источник интеграции'),
        };
        rows.push({row:rowNumber,values:raw,
          issues:[issue(field,message,field==='format'?'Исправьте строку':raw[field])],
        });
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
    await this.assertAccess(tenantId);
    await this.getBatch(tenantId,batchId);
    const size=Math.min(100,Math.max(1,Number(limit)||30));
    const work=await this.prisma.contactImportRow.findMany({
      where:{tenantId,batchId,status:'new'},orderBy:{rowNumber:'asc'},take:size,
    });
    const all=(await this.prisma.contactImportRow.findMany({
      where:{tenantId,batchId},select:{rowNumber:true,values:true},
      orderBy:{rowNumber:'asc'},
    })).map(item=>({row:item.rowNumber,values:obj(item.values)}));
    for(const row of work){
      await this.prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))::text`;
        const latest=await tx.contactImportRow.findFirst({where:{id:row.id,tenantId,batchId}});
        if(!latest||latest.status!=='new')return;
        const {people,identity}=await this.current(tx,tenantId);
        const checked=inspect(obj(latest.values),people,identity,all,latest.rowNumber,
          arr(latest.issues) as unknown as Issue[]);
        if(checked.issues.length){
          await tx.contactImportRow.update({where:{id:latest.id},data:{
            status:'review',personKey:text(checked.person?.key),
            issues:checked.issues as unknown as Prisma.InputJsonValue,
          }});
        }else if(checked.unchanged && checked.person){
          // No Person/UEI write: identical facts are recorded as processed.
          await tx.contactImportRow.update({where:{id:latest.id},data:{
            status:'unchanged',personKey:text(checked.person.key),
            issues:[] as Prisma.InputJsonValue,error:'',
          }});
        }else{
          await tx.$executeRawUnsafe('SAVEPOINT contact_import_row');
          try{
            const personKey=await this.safeImport(tx,tenantId,obj(latest.values),
              text(checked.person?.key),[]);
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT contact_import_row');
            await tx.contactImportRow.update({where:{id:latest.id},
              data:{status:'done',personKey,issues:[] as Prisma.InputJsonValue,error:''}});
          }catch(error){
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT contact_import_row');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT contact_import_row');
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
      where:{tenantId,batchId,status:{notIn:['done','unchanged']}},
    });
    await this.prisma.contactImportBatch.update({
      where:{id:batchId},data:{status:pending?'review':'completed'},
    });
  }
  private async safeImport(tx:Tx,tenantId:string,values:Obj,targetId:string,decisions:Issue[]){
    const payload={...values};const ownership:Obj={};
    const decisionIdentity=decisions.find(item=>item.field==='identity')?.decision;
    const identityExplicitlyApproved=decisionIdentity?.mode==='same'
      &&decisionIdentity.value===targetId;
    if(decisionIdentity&&!['same','different'].includes(decisionIdentity.mode))
      throw new BadRequestException('Укажите: тот же человек или другой человек');
    if(decisionIdentity?.mode==='different'&&targetId)
      throw new ConflictException('Выбран отдельный человек, но цель сопоставления не очищена');
    const existing=targetId?await tx.person.findFirst({where:{tenantId,key:targetId}}):null;
    if(targetId&&!existing)throw new ConflictException('Контакт изменён или удалён. Требуется повторная проверка.');
    const previous=obj(existing?.data);
    const identity=targetId?await tx.ueiState.findUnique({where:{tenantId}}):null;
    const savedCode=text(obj(obj(identity?.data).relations)['person:'+targetId]||previous.uei);
    if(targetId){
      const sourceCandidates=findContactCandidates(
        (await tx.person.findMany({where:{tenantId}})).map(row=>obj(row.data)),
        obj(identity?.data),values);
      if(identityExplicitlyApproved && !sourceCandidates.some(candidate=>candidate.key===targetId))
        throw new ConflictException('Подтверждённое совпадение изменилось. Повторите проверку.');
      const originalPhone=phone(values.phone);
      const originalCode=code(values.uei);
      const verifiedByPhone=originalPhone&&Array.isArray(previous.phones)
        &&previous.phones.some((v:unknown)=>phone(v)===originalPhone);
      const verifiedByCode=originalCode&&code(savedCode)===originalCode;
      if(!verifiedByPhone&&!verifiedByCode&&!identityExplicitlyApproved)
        throw new ConflictException('Сопоставление изменилось. Проверьте код клиента или телефон.');
    }
    for(const issue of decisions){
      const decision=issue.decision;
      if(!decision)throw new BadRequestException('Сначала разрешите все различия');
      const field=issue.field;
      if(field==='identity')continue;
      if(field==='format')throw new BadRequestException('Исправьте исходные данные строки Excel');
      if(decision.mode==='keep'||decision.mode==='remove'){
        delete payload[field];continue;
      }
      payload[field]=decision.value;
      if(field==='uei'&&savedCode)ownership.uei=savedCode;
      if(['name','surname','birthDate','gender','note','discountPercent'].includes(field)
        &&previous[field]!==undefined)ownership[field]=previous[field];
      if(decision.mode!=='add'&&field==='email'
        &&Array.isArray(previous.emails)&&previous.emails.length)
        ownership.email=previous.emails[0];
      if(decision.mode!=='add'&&field==='phone'
        &&Array.isArray(previous.phones)&&previous.phones.length)
        ownership.phone=previous.phones[0];
    }
    for(const field of ['name','surname','note','birthDate','gender','discountPercent'])
      if(previous[field] && payload[field]!==undefined
        && fieldNorm(field,previous[field])!==fieldNorm(field,payload[field])
        && !ownership.hasOwnProperty(field))
        throw new ConflictException('Данные контакта изменились. Повторно проверьте: '+(labels[field]||field));
    if(payload.birthDate && typeof payload.birthDate==='string' &&
      !/^\\d{2}-\\d{2}$|^\\d{4}-\\d{2}-\\d{2}$/.test(payload.birthDate))
      payload.birthDate=contactBirthday(payload.birthDate);
    if(payload.discountPercent!==undefined && text(payload.discountPercent))
      payload.discountPercent=Number(text(payload.discountPercent).replace('%','').replace(',','.'));
    if(!text(payload.name)&&!targetId)
      throw new BadRequestException('Укажите имя контакта');
    if(!targetId&&!phone(payload.phone)&&!code(payload.uei))
      throw new BadRequestException('Для нового контакта укажите телефон или код клиента.');
    if(decisionIdentity?.mode==='different'){
      const current=await this.current(tx,tenantId);
      // An independent person never inherits another Person's Email.
      // Identity decisions are checked again under the tenant transaction
      // lock so concurrent imports cannot silently duplicate it.
      for(const field of ['email','additionalEmail'] as const){
        if(!text(payload[field]))continue;
        if(current.people.some(person=>
          contactMatches(person,current.identity,field,payload[field])))
          delete payload[field];
      }
      const occupied=findContactCandidates(current.people,current.identity,payload);
      if(occupied.some(candidate=>reliableContactCandidate(candidate)))
        throw new ConflictException('Телефон или код всё ещё принадлежит другому человеку. Исправьте поле или выберите существующий контакт.');
    }
    return this.people.importPerson(tenantId,payload,targetId,tx,ownership);
  }
  async decide(tenantId:string,batchId:string,body:unknown){
    await this.assertAccess(tenantId);
    const action=obj(body),rowNumber=Number(action.rowNumber);
    const field=text(action.field),mode=text(action.mode),value=text(action.value);
    if(!Number.isInteger(rowNumber)||rowNumber<1||!labels[field]
      ||!['keep','replace','remove','add','same','different'].includes(mode)||value.length>500)
      throw new BadRequestException('Неверное решение для различия');
    if(field==='identity'&&!['same','different'].includes(mode))
      throw new BadRequestException('Укажите: тот же человек или другой человек');
    if(field!=='identity'&&['same','different'].includes(mode))
      throw new BadRequestException('Это решение предназначено только для сопоставления людей');
    if(mode==='add'&&!['email','additionalEmail','phone','additionalPhone',
      'telegram','additionalTelegram'].includes(field))
      throw new BadRequestException('Для этого поля возможно только исправление или сохранение прежнего значения');
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))::text`;
      await this.getBatch(tenantId,batchId,tx);
      const row=await tx.contactImportRow.findUnique({
        where:{batchId_rowNumber:{batchId,rowNumber}},
      });
      if(!row||row.tenantId!==tenantId)throw new NotFoundException('Строка загрузки не найдена');
      if(processed(row.status))return this.summary(await this.getBatch(tenantId,batchId,tx),
        await this.fileRows(tx,batchId),true);
      let issues=arr(row.issues) as unknown as Issue[];
      const changed=issues.find(item=>item.field===field);
      if(!changed)throw new BadRequestException('Различие уже устранено');
      if(mode==='replace'||mode==='add'){
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
      let personKey=row.personKey;
      if(field==='identity'){
        const state=await this.current(tx,tenantId);
        const candidates=findContactCandidates(state.people,state.identity,obj(row.values));
        const sourceRows=await this.fileRows(tx,batchId);
        const sources=sourceRows.map(item=>({
          row:item.rowNumber,values:obj(item.values),
        }));
        const possible=inspect(obj(row.values),state.people,state.identity,
          sources,row.rowNumber,issues);
        let chosenValue=value;
        if(mode==='same'&&value.startsWith('excel:')){
          const sourceNumber=Number(value.slice(6));
          if(!possible.sourceCandidates.some(candidate=>candidate.key===value))
            throw new BadRequestException('Выберите строку из найденных совпадений');
          const other=sourceRows.find(item=>item.rowNumber===sourceNumber);
          if(!other||other.status!=='done'||!other.personKey)
            throw new BadRequestException('Сначала обработайте контакт из строки '+sourceNumber);
          chosenValue=other.personKey;
        }
        if(mode==='same'&&!findContactCandidates(state.people,state.identity,obj(row.values))
          .some(candidate=>candidate.key===chosenValue))
          throw new BadRequestException('Совпадение изменилось. Проверьте номер телефона, Email или код');
        if(mode==='different'&&value)
          throw new BadRequestException('Для нового человека значение должно быть пустым');
        changed.decision={mode:mode as 'same'|'different',value:chosenValue};
        const inspected=inspect(obj(row.values),state.people,state.identity,
          sources,row.rowNumber,issues,changed.decision);
        issues=inspected.issues as Issue[];
        personKey=mode==='same'?chosenValue:'';
      }else{
        changed.decision={mode:mode as 'keep'|'replace'|'remove'|'add',value};
      }
      const stillPending=issues.some(item=>!item.decision);
      if(stillPending){
        await tx.contactImportRow.update({where:{id:row.id},
          data:{issues:issues as unknown as Prisma.InputJsonValue,error:'',personKey}});
      }else{
        await tx.$executeRawUnsafe('SAVEPOINT contact_import_decision');
        try{
          const key=await this.safeImport(tx,tenantId,obj(row.values),personKey,issues);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT contact_import_decision');
          await tx.contactImportRow.update({where:{id:row.id},data:{
            status:'done',personKey:key,issues:issues as unknown as Prisma.InputJsonValue,error:'',
          }});
        }catch(error){
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT contact_import_decision');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT contact_import_decision');
          // Keep all decisions but leave this row in review.
          await tx.contactImportRow.update({where:{id:row.id},data:{
            issues:issues as unknown as Prisma.InputJsonValue,
            personKey,
            error:text((error as Error).message),
          }});
        }
      }
      const rows=await this.fileRows(tx,batchId);
      const batch=await this.getBatch(tenantId,batchId,tx);
      await tx.contactImportBatch.update({where:{id:batchId},
        data:{status:rows.every(r=>processed(r.status))?'completed':'review'}});
      return this.summary(batch,rows,true);
    },{timeout:30000});
  }
}
