import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);const ExcelJS=require('exceljs');
const {STANDARD_FIELDS}=require('../dist/data-transfer/standard.js');
const {transferWorkbook}=require('../dist/data-transfer/source.js');
export async function verifyUniversalTransfer({db,service,people,accountId}){
 const tenantId='universal-'+randomUUID();
 const file=async(rows)=>{
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Данные');sheet.addRow(STANDARD_FIELDS.map(field=>field.label));
  rows.forEach(row=>sheet.addRow(STANDARD_FIELDS.map(field=>row[field.key]??'')));
  return {filename:'standard.xlsx',source:'standard',dataUrl:'data:application/octet-stream;base64,'+Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')};
 };
 const run=async(rows,preview=false)=>service.run(tenantId,accountId,await file(rows),preview);
 const assertOk=result=>assert.equal(result.failed,0,JSON.stringify(result));
 const historyCount=async()=>Number((await db.$queryRaw`SELECT count(*) AS count FROM "BusinessHistoryEvent" WHERE "tenantId"=${tenantId}`)[0].count);
 try{
  await db.tenant.create({data:{id:tenantId,name:'Universal isolated regression'}});
  await db.profile.create({data:{tenantId,platformAccountId:accountId,phones:[],emails:[],telegrams:[],customProfessions:[]}});
  await db.tenantAccess.create({data:{tenantId,commercialMode:'LIVE',isOwnerBook:true}});
  const template=await transferWorkbook([],true);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(template);
  assert.equal(workbook.worksheets.length,1);assert.equal(workbook.worksheets[0].name,'Данные');
  const visible=workbook.worksheets[0].columns.filter(col=>!col.hidden).map(col=>workbook.worksheets[0].getCell(1,col.number).text);
  assert.ok(!visible.some(header=>/CO-VA|ID|JSON|Ключ строки|Скидка %|Скидка суммой/.test(header)));
  assert.ok(visible.includes('Скидка'));assert.ok(visible.includes('Операция личного счёта'));assert.ok(visible.includes('Сумма операции депозита'));assert.ok(visible.includes('Артикул'));
  const data=[{name:'Проверка',phone:'79990007701',workplace:'Место',date:'2022-05-15',from:'14:00',procedure:'Первая',cost:7000,discount:'20%',amount:'не сумма',occurredAt:'2022-05-15',wallet:'Касса'},
   {name:'Проверка',phone:'79990007701',workplace:'Место',date:'2022-05-15',from:'14:00',procedure:'Вторая',cost:3000,discount:'500'}];
  const inspected=await service.inspect(await file(data));assert.equal(inspected.sheets[0].standard,true);
  const preHistory=await historyCount();let result=await run(data,true);assert.equal(result.failed,1,JSON.stringify(result));
  assert.equal(await db.dataTransferSession.count({where:{tenantId}}),0);assert.equal(await db.record.count({where:{tenantId}}),0);assert.equal(await historyCount(),preHistory);
  result=await run(data);assert.equal(result.failed,1,JSON.stringify(result));assert.ok(result.sessionId);
  assert.equal(await db.record.count({where:{tenantId}}),1);assert.equal(await db.person.count({where:{tenantId}}),1);
  const record=(await db.record.findFirst({where:{tenantId}})).data;
  assert.equal(record.procedures.length,2);assert.equal(record.procedures[0].historicalDiscount.value,20);assert.equal(record.procedures[1].historicalDiscount.value,500);
  assert.equal(await db.financeOperation.count({where:{tenantId}}),0);
  const again=await run(data);assert.equal(again.transferred,0);assert.equal(again.failed,1);
  // A correction workbook contains exactly the failed fact, hidden linkage, and a human reason.
  const correction=await transferWorkbook(result.rows.filter(row=>row.reason));const bad=new ExcelJS.Workbook();await bad.xlsx.load(correction);
  const sheet=bad.worksheets[0];assert.equal(bad.worksheets.length,1);assert.equal(sheet.name,'Данные');assert.equal(sheet.rowCount,2);
  const headers=sheet.getRow(1).values.slice(1);assert.ok(headers.includes('Причина'));
  assert.ok(sheet.columns.find(col=>sheet.getCell(1,col.number).text==='_co_va_transfer').hidden);
  sheet.getCell(2,headers.indexOf('Сумма оплаты')+1).value=2000;
  let corrected={filename:'fixed.xlsx',source:'changed source',dataUrl:'data:application/octet-stream;base64,'+Buffer.from(await bad.xlsx.writeBuffer()).toString('base64')};
  let payment=await service.run(tenantId,accountId,corrected,false);assertOk(payment);assert.equal(payment.transferred,1);
  assert.equal(await db.record.count({where:{tenantId}}),1);assert.equal(await db.person.count({where:{tenantId}}),1);
  assert.equal((await db.financeOperation.findFirst({where:{tenantId}})).sourceId,record.id);
  assert.equal((await service.run(tenantId,accountId,corrected,false)).unchanged,1);
  await service.cancel(tenantId,payment.sessionId);assert.equal(await db.financeOperation.count({where:{tenantId}}),0);
  await assert.rejects(()=>service.cancel(tenantId,payment.sessionId),/уже отменён/);
  await assert.rejects(()=>service.cancel('foreign-tenant',result.sessionId),/не найден/);
  // Empty/unchanged later runs do not prevent cancellation of the originating session.
  await service.cancel(tenantId,result.sessionId);
  assert.equal(await db.record.count({where:{tenantId}}),0);assert.equal(await db.person.count({where:{tenantId}}),0);assert.equal(await db.financeLedgerEntry.count({where:{tenantId}}),0);assert.equal(await historyCount(),preHistory);
  // Restore only imported changes on an existing Person, preserving an independent later phone.
  await people.upsertPerson(tenantId,'existing',{person:{key:'existing',name:'Существующий',phones:['+79990007702'],emails:['keep@example.test']}});
  const previousHistory=await historyCount();result=await run([{name:'Существующий',phone:'79990007702',email:'new@example.test'}]);assertOk(result);
  let existing=(await db.person.findFirst({where:{tenantId,key:'existing'}})).data;
  await people.upsertPerson(tenantId,'existing',{person:{...existing,phones:[...existing.phones,'+79990007703']}});
  await service.cancel(tenantId,result.sessionId);
  existing=(await db.person.findFirst({where:{tenantId,key:'existing'}})).data;assert.deepEqual(existing.emails,['keep@example.test']);assert.ok(existing.phones.includes('+79990007703'));
  assert.equal((await db.$queryRaw`SELECT count(*) AS count FROM "BusinessHistoryEvent" WHERE "tenantId"=${tenantId} AND "provenance"->>'sessionId'=${result.sessionId}`)[0].count,0n);
  assert.ok(await historyCount()>=previousHistory);
  // A new Person with independent later edits is never deleted by rollback.
  result=await run([{name:'Не удалять',phone:'79990007704'}]);assertOk(result);const created=result.rows.find(row=>row.domain==='people').targetId;
  const createdPerson=(await db.person.findFirst({where:{tenantId,key:created}})).data;
  await people.upsertPerson(tenantId,created,{person:{...createdPerson,surname:'Независимая'}});
  await assert.rejects(()=>service.cancel(tenantId,result.sessionId),/независим|изменены/);
  assert.equal((await db.person.findFirst({where:{tenantId,key:created}})).data.surname,'Независимая');
  // Existing owners: program, deposit funding, account funding/payment, general finance and inventory.
  const complex=[{name:'Финансы',phone:'79990007705',workplace:'Место финансов',wallet:'Наличные',program:'Депозитная программа',benefitType:'Нет',depositAction:'Пополнение',depositAmount:1000,occurredAt:'2022-01-01'},
   {phone:'79990007705',name:'Финансы',accountAction:'Пополнение',accountAmount:500,wallet:'Наличные',occurredAt:'2022-01-02'},
   {name:'Финансы',phone:'79990007705',workplace:'Место финансов',date:'2022-01-03',from:'12:00',procedure:'Услуга',cost:800},
   {phone:'79990007705',date:'2022-01-03',from:'12:00',procedure:'Услуга',paymentSource:'Личный счёт',amount:200,occurredAt:'2022-01-03'},
   {phone:'79990007705',date:'2022-01-03',from:'12:00',procedure:'Услуга',paymentSource:'Депозит',deposit:'Депозитная программа',amount:300,occurredAt:'2022-01-03'},
   {material:'Позиция',unit:'г',sku:'A-1',manufacturer:'Фабрика',category:'Материалы',supplier:'Поставщик',grossWeight:100,tareWeight:10,minStock:5,targetStock:20,quantity:100,unitCost:5,kind:'Приход',occurredAt:'2022-01-01',listPrice:6,supplierSku:'SUP-1'},
   {phone:'79990007705',date:'2022-01-03',procedure:'Услуга',material:'Позиция',manufacturer:'Фабрика',unit:'г',quantity:5},
   {wallet:'Наличные',article:'Прочий доход',articleDirection:'Доход',financeKind:'Доход',financeAmount:400,occurredAt:'2022-01-04'}];
  const baseline={people:await db.person.count({where:{tenantId}}),records:await db.record.count({where:{tenantId}}),history:await historyCount(),operations:await db.financeOperation.count({where:{tenantId}})};
  result=await run(complex);assertOk(result);
  const deposit=await db.loyaltyDepositInstance.findFirst({where:{tenantId}});assert.equal(Number(deposit.principalBalance),700);assert.equal(Number(deposit.benefitBalance),0);
  const accounts=await db.$queryRaw`SELECT "balance" FROM "LoyaltyPersonalAccount" WHERE "tenantId"=${tenantId}`;assert.equal(Number(accounts[0].balance),300);
  const item=await db.inventoryItem.findFirst({where:{tenantId}});assert.equal(item.sku,'A-1');assert.equal(item.category,'Материалы');assert.equal(Number(item.grossWeight),100);
  assert.equal(await db.inventorySupplierOffer.count({where:{tenantId}}),1);assert.equal(await db.inventoryMovement.count({where:{tenantId}}),2);
  assert.equal((await run(complex)).transferred,0);
  const sessionHistory=await db.$queryRaw`SELECT "occurredAt","recordedAt" FROM "BusinessHistoryEvent" WHERE "tenantId"=${tenantId} AND "provenance"->>'sessionId'=${result.sessionId} AND "entityType" IN ('finance-operation','record','inventory-movement')`;
  assert.ok(sessionHistory.length);assert.ok(sessionHistory.every(event=>event.occurredAt<event.recordedAt));
  await service.cancel(tenantId,result.sessionId);
  assert.equal(await db.person.count({where:{tenantId}}),baseline.people);assert.equal(await db.record.count({where:{tenantId}}),baseline.records);assert.equal(await historyCount(),baseline.history);
  assert.equal(await db.financeOperation.count({where:{tenantId}}),baseline.operations);assert.equal(await db.loyaltyDepositInstance.count({where:{tenantId}}),0);assert.equal(await db.inventoryItem.count({where:{tenantId}}),0);
  assert.equal((await db.$queryRaw`SELECT count(*) AS count FROM "LoyaltyPersonalAccountMovement" WHERE "tenantId"=${tenantId}`)[0].count,0n);
  assert.ok((await service.sessions(tenantId)).some(session=>session.id===result.sessionId && session.status==='cancelled'));
  console.log('Universal transfer PostgreSQL: single sheet, correction, owners and safe session rollback passed');
 }finally{await db.tenant.delete({where:{id:tenantId}});}
}
