import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { createDepositInstance } from './deposit-state';
import { depositHistoricalLedger } from './deposit-history';
import { DepositService } from './deposit.service';
import { depositWorkbook, excelDay, parseDepositWorkbook } from './deposit-excel-format';
import { planDepositExcel } from './deposit-excel-plan';

type Row = Record<string, any>;
const text=(x:unknown)=>String(x??'').trim();
const obj=(x:unknown):Row=>x&&typeof x==='object'&&!Array.isArray(x)?x as Row:{};
const json=(x:unknown)=>JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue;
const money=(x:unknown)=>Math.round(Number(String(x??'0').replace(/\s/g,'').replace(',','.'))*100)/100;
const add=(x:number,y:number)=>Math.round((x+y)*100)/100;

@Injectable()
export class DepositExcelService {
  constructor(private readonly prisma:PrismaService,private readonly deposits:DepositService) {}
  async template(){return depositWorkbook();}
  private async analyze(tenantId:string,body:unknown,db:any=this.prisma) {
    const input=obj(body);
    const from=text(input.from),to=text(input.to);
    if(from&&excelDay(from)!==from||to&&excelDay(to)!==to||from&&to&&from>to)
      throw new BadRequestException('Некорректный период «С — По»');
    const parsed=await parseDepositWorkbook(input.file);
    const batchId=createHash('sha256').update(parsed.buffer).digest('hex').slice(0,32);
    const plan=await planDepositExcel(db,tenantId,parsed.raw,batchId,from,to);
    return {plan,batchId};
  }
  async preview(tenantId:string,body:unknown){
    const {plan,batchId}=await this.analyze(tenantId,body);
    return {batchId,selected:plan.selected,skipped:plan.skipped,
      programs:plan.programs.length,people:plan.people.length,
      deposits:new Set(plan.events.map(e=>e.depositId)).size,
      operations:plan.events.length,errors:plan.errors.slice(0,100),
      ready:plan.errors.length===0&&plan.selected>0,
      rows:plan.events.slice(0,80).map(e=>({row:e.row,date:e.occurredAt.toISOString().slice(0,10),
        person:e.person.name,deposit:e.programName,action:e.kind==='deposit-funding'?'Пополнение':'Списание',
        amount:e.amount,wallet:e.walletName||'Не определён'}))};
  }
  async apply(tenantId:string,body:unknown){
    const result=await this.prisma.$transaction(async(tx)=>{
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))::text AS lock',tenantId);
      const result=await this.analyze(tenantId,body,tx);
      const {plan}=result;
      if(text(obj(body).batchId)&&text(obj(body).batchId)!==result.batchId)
        throw new BadRequestException('Файл изменился после предварительной проверки');
      if(plan.errors.length)throw new BadRequestException('Ошибки Excel: '+plan.errors.slice(0,3)
        .map(e=>'строка '+e.row+': '+e.message).join('; '));
      if(!plan.selected)throw new BadRequestException('За выбранный период операций нет');
      for(const program of plan.programs)await tx.loyaltyDepositProgram.create({
        data:{tenantId,programId:program.id,data:json(program)},
      });
      let position=await tx.person.count({where:{tenantId}});
      for(const person of plan.people)await tx.person.create({
        data:{tenantId,key:person.key,position:position++,data:json(person)},
      });
      if(plan.programs.length||plan.people.length)await tx.ueiState.upsert({
        where:{tenantId},create:{tenantId,data:json(plan.identity)},update:{data:json(plan.identity)},
      });
      const touched=new Set<string>();
      for(const e of plan.events){
        const existing=await tx.loyaltyDepositInstance.findUnique({
          where:{tenantId_depositId:{tenantId,depositId:e.depositId}},
        });
        if(!existing){
          if(e.kind!=='deposit-funding')throw new BadRequestException('Нельзя создать карту списанием');
          await createDepositInstance(tx,tenantId,{
            depositId:e.depositId,programId:e.programId,programName:e.programName,
            person:e.person,terms:e.terms,amount:e.amount,occurredAt:e.occurredAt,
            fundingOperationId:e.operationId,
          });
        }
        const operation=await tx.financeOperation.create({data:{
          tenantId,operationId:e.operationId,kind:e.kind,status:'completed',
          sourceType:'deposit',sourceId:e.depositId,originalOperationId:'',
          occurredAt:e.occurredAt,origin:'excel_import',importBatchId:result.batchId,
          externalOperationId:e.externalOperationId,sourceRow:e.row,
          reconciliationStatus:e.kind==='deposit-import-spend'?'unmatched':'not_applicable',
          linkedRecordId:'',walletResolution:e.kind==='deposit-funding'
            ?(e.walletId?'resolved':'unknown'):'not_applicable',
          data:json({depositId:e.depositId,programId:e.programId,programName:e.programName,
            person:e.person,amount:e.amount,total:e.amount,description:e.note,
            walletId:e.walletId,walletName:e.walletName,terms:e.terms,
            ...(e.kind==='deposit-import-spend'?{depositAllocations:[{
              depositId:e.depositId,amount:e.amount,
              principalAmount:e.principalAmount,benefitAmount:e.benefitAmount,
            }]}:{}),
          }),
        }});
        if(e.kind==='deposit-funding'&&e.walletId)await tx.financeLedgerEntry.create({data:{
          tenantId,financeOperationId:operation.id,entryId:randomUUID(),walletId:e.walletId,
          direction:'IN',economicType:'DEPOSIT_RECEIVED',amount:e.amount,
          occurredAt:e.occurredAt,sourceType:'deposit',sourceId:e.depositId,
          data:json({walletName:e.walletName,component:'deposit-funding',
            relatedOperationId:'',articleId:'',articleName:'',lineName:e.programName,
            quantity:null,unitPrice:null,note:e.personKey}),
        }});
        touched.add(e.depositId);
      }
      if(touched.size){
        const operations=await tx.financeOperation.findMany({where:{tenantId,kind:{
          in:['deposit-funding','deposit-withdrawal','payment','refund','deposit-import-spend']}}});
        for(const id of touched){
          const row=await tx.loyaltyDepositInstance.findUnique({
            where:{tenantId_depositId:{tenantId,depositId:id}},
          });
          if(!row)throw new Error('Депозит отсутствует после импорта');
          const funding=operations.filter(op=>op.sourceType==='deposit'&&op.sourceId===id
            &&op.kind==='deposit-funding').sort((a,b)=>a.occurredAt.getTime()-b.occurredAt.getTime());
          if(!funding.length)throw new Error('Депозит без пополнений');
          const total=funding.reduce((s,o)=>add(s,money(obj(o.data).amount)),0);
          const state=depositHistoricalLedger(operations,id,row.terms,new Date('9999-12-31T23:59:59Z'));
          const terms=obj(row.terms),end=text(terms.termEndDate);
          const expired=['dated','fixed'].includes(text(terms.termMode))&&!!end&&end<new Date().toISOString().slice(0,10);
          await tx.loyaltyDepositInstance.update({where:{id:row.id},data:{
            initialAmount:total,principalBalance:state.remainingPrincipal,
            benefitBalance:state.remainingBenefit,balance:state.remaining,
            fundedAt:funding[0].occurredAt,fundingOperationId:funding[0].operationId,
            status:expired?'expired':row.status,
          }});
        }
      }
      return result;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:120000,maxWait:30000});
    const p=result.plan;
    return {batchId:result.batchId,imported:p.events.length,skipped:p.skipped,
      programs:p.programs.length,people:p.people.length,deposits:[...new Set(p.events.map(e=>e.depositId))].length};
  }
  async export(tenantId:string,from='',to=''){
    if(from&&excelDay(from)!==from||to&&excelDay(to)!==to||from&&to&&from>to)
      throw new BadRequestException('Некорректный период');
    const [programRows,issued,people,ueiRow]=await Promise.all([
      this.prisma.loyaltyDepositProgram.findMany({where:{tenantId}}),
      this.deposits.list(tenantId),
      this.prisma.person.findMany({where:{tenantId}}),
      this.prisma.ueiState.findUnique({where:{tenantId}}),
    ]);
    const programs=new Map(programRows.map(p=>[p.programId,obj(p.data)]));
    const peopleMap=new Map(people.map(p=>[p.key,obj(p.data)]));
    const codes=obj(obj(ueiRow?.data).relations);
    const rows:Array<Array<string|number|Date|null>>=[];
    const issuedPrograms=new Set<string>();
    const preface=(p:Row):Array<string|number>=>[
      text(p.name),text(p.amountMode)==='fixed'?'Фиксированная':'Свободная',
      text(p.amountMode)==='fixed'?money(p.amount):'',text(p.termMode)==='dated'?'Период':'Бессрочно',
      text(p.termStartDate),text(p.termEndDate),
      text(p.benefitType)==='discount'?'На обслуживание':text(p.benefitType)==='accrual'?'Начисление сразу':'Нет',
      money(p.benefitValue),text(codes['loyalty-deposit-program:'+text(p.id)]),
    ];
    for(const dep of issued){
      const p=programs.get(dep.programId)||obj(dep.terms);
      issuedPrograms.add(text(dep.programId));
      const person=peopleMap.get(text(obj(dep.person).key))||obj(dep.person);
      const name=[person.name,person.surname].filter(Boolean).join(' ');
      for(const e of Array.isArray(dep.history)?dep.history:[]){
        const date=text(e.occurredAt).slice(0,10);
        if(from&&date<from||to&&date>to)continue;
        const action=e.kind==='deposit-funding'?'Пополнение':
          ['payment','deposit-import-spend'].includes(e.kind)?'Списание':'';
        if(!action)continue;
        const programCode=text(codes['loyalty-deposit-program:'+text(p.id)]);
        const clientCode=text(codes['person:'+text(person.key)]);
        const cardKey=text(obj(dep.terms).importCardKey)
          ||(programCode.length===4&&clientCode.length===4?programCode+clientCode:'');
        rows.push([...preface(p),
          clientCode,name,
          text((Array.isArray(person.phones)?person.phones:[])[0]||person.phone),
          cardKey,
          date,action,money(e.amount),text(e.walletName),text(e.description),
          money(e.balanceAfter),e.dueToFund==null?'':money(e.dueToFund),
          e.origin==='excel_import'?'Excel':'Приложение',
          e.walletResolution==='unknown'?'Нет':'Да',
          e.reconciliationStatus==='unmatched'?'Не сопоставлена':
            e.reconciliationStatus==='matched'?'Сопоставлена':'—',
          text(e.recordedAt),text(e.recordId),text(e.operationId),
        ]);
      }
    }
    if(!from&&!to)for(const p of programs.values())if(!issuedPrograms.has(text(p.id)))rows.push(preface(p));
    return depositWorkbook(rows,true);
  }
}
