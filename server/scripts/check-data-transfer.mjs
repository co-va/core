import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const { DataTransferService } = require('../dist/data-transfer/data-transfer.service.js');
const { BusinessStateService } = require('../dist/business-state/business-state.service.js');
const { ProfileService } = require('../dist/profile/profile.service.js');
const { RecordService } = require('../dist/record/record.service.js');
const { FinanceService } = require('../dist/finance/finance.service.js');
const { InventoryService } = require('../dist/inventory/inventory.service.js');
const { ProcedureService } = require('../dist/procedure/procedure.service.js');
const { TimeService } = require('../dist/time/time.service.js');
const { SaasAccessService } = require('../dist/saas-access/saas-access.service.js');
const { AuxiliaryStateService } = require('../dist/auxiliary-state/auxiliary-state.service.js');
const { PersonalAccountFinanceService } = require('../dist/finance/personal-account-finance.service.js');
const { HistoryService } = require('../dist/history/history.service.js');
const db = new PrismaClient();
const tenantId = `transfer-check-${randomUUID()}`;
const accountId = `transfer-check-${randomUUID()}`;
const access = new SaasAccessService(db);
const finance = new FinanceService(db, access);
const procedures = new ProcedureService(db);
const records = new RecordService(db, new TimeService(), finance, procedures);
const people = new BusinessStateService(db, records);
const inventory = new InventoryService(db);
const service = new DataTransferService(db, people, new ProfileService(db), records, finance, inventory, procedures, access, new AuxiliaryStateService(db,access), new PersonalAccountFinanceService(db), new HistoryService(db));
async function file(domain, rows, filename='fixture.xlsx') {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet(domain);
  const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))]; sheet.addRow(keys);
  for(const row of rows) sheet.addRow(keys.map(key=>row[key] ?? ''));
  return { filename, source:'suite', dataUrl:`data:application/octet-stream;base64,${Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')}` };
}
async function run(domain, rows, preview=false) { return service.run(tenantId,accountId,await file(domain,rows),preview); }
const error = (result, pattern) => { assert.ok(result.failed > 0,JSON.stringify(result));assert.ok(result.rows.some(row=>pattern.test(row.reason)),JSON.stringify(result.rows)); };
const target = (result,domain) => result.rows.find(row=>row.domain===domain && !row.reason);
const person = {name:'Анна',phone:'79991234567',uei:'12'};
const record = {externalId:'r1',...person,workplace:'BeautyToria',date:'2024-05-15',from:'14:00',to:'15:00',procedure:'Осветление',cost:7000,createdAt:'2024-05-15T11:15:00Z'};
try {
  await db.tenant.create({data:{id:tenantId,name:'Isolated transfer regression'}});
  await db.platformAccount.create({data:{id:accountId,email:`${accountId}@example.invalid`,passwordHash:'no-login'}});
  await db.profile.create({data:{tenantId,platformAccountId:accountId,phones:[],emails:[],telegrams:[],customProfessions:[]}});
  await db.tenantAccess.create({data:{tenantId,commercialMode:'LIVE',isOwnerBook:true}});
  await db.businessAuxiliaryState.create({data:{tenantId,data:{wallets:[{id:'cash',name:'Наличные'}]}}});
  // Preview uses the real domain/trigger paths and must leave zero saved facts.
  let result=await run('people',[{...person,externalId:'p1'}],true);assert.equal(result.failed,0);
  assert.equal(await db.person.count({where:{tenantId}}),0);assert.equal(await db.dataTransferFact.count({where:{tenantId}}),0);
  result=await run('people',[{...person,externalId:'p1'},{name:'Мария',phone:'bad',externalId:'bad'}]);
  assert.equal(result.transferred,1);assert.equal(result.failed,1);
  const personId=target(result,'people').targetId;const personTransfer=target(result,'people').transferId;
  assert.ok(personTransfer); assert.equal(result.rows.find(row=>row.reason).transferId,'');
  result=await run('people',[{...person,externalId:'p1'}]);assert.equal(result.unchanged,1);
  const originalPerson=(await db.person.findFirst({where:{tenantId,key:personId}})).data;
  await people.upsertPerson(tenantId,personId,{person:{...originalPerson,phones:[...originalPerson.phones,'+79991230000'],emails:['keep@example.test']}});
  result=await run('people',[{...person,externalId:'p-extra',email:'new@example.test'}]);assert.equal(result.failed,0);
  const supplemented=(await db.person.findFirst({where:{tenantId,key:personId}})).data;
  assert.equal(supplemented.phones.length,2);assert.ok(supplemented.emails.includes('keep@example.test'));assert.ok(supplemented.emails.includes('new@example.test'));

  error(await run('people',[{name:'Аня',phone:person.phone}]),/Телефон уже принадлежит.*Анна/);
  error(await run('people',[{...person,uei:'315'}]),/Сохранён UEI 0012/);
  error(await run('people',[{name:'Другая',phone:'79997654321',uei:'12'}]),/Проверьте|UEI|имя/);
  // Adding an initially absent UEI updates the same canonical person.
  result=await run('people',[{name:'Вера',phone:'79990000001'}]);const vera=target(result,'people').targetId;
  result=await run('people',[{name:'Вера',phone:'79990000001',uei:'55'}]);assert.equal(target(result,'people').targetId,vera);
  // Record-only source can contain explicit person/place facts. No historical catalog required.
  result=await run('records',[record]);assert.equal(result.failed,0,JSON.stringify(result));
  const recordId=target(result,'records').targetId; const recordTransfer=target(result,'records').transferId;
  const stored=(await db.record.findUnique({where:{tenantId_recordId:{tenantId,recordId}}})).data;
  assert.equal(stored.person.key,personId);assert.equal(stored.procedures[0].cost,7000);assert.equal(stored.from,'14:00');
  assert.equal(stored.procedures[0].historicalPrice,undefined);assert.equal(stored.procedures[0].historicalDiscount,undefined);
  assert.equal(await db.financeOperation.count({where:{tenantId}}),0);
  assert.equal(Number((await db.$queryRaw`SELECT COUNT(*) AS count FROM "Notification" WHERE "tenantId"=${tenantId}`)[0].count),0);
  assert.equal(await db.recordEvent.count({where:{tenantId}}),0);
  result=await run('records',[record]);assert.equal(result.failed,0);assert.equal(result.unchanged,3);
  result=await run('records',[{...record,externalId:'no-price',date:'2024-05-16',cost:''}]);assert.equal(result.failed,0);
  const noPriceId=target(result,'records').targetId;
  assert.equal(await db.financeSettlement.count({where:{tenantId,sourceId:noPriceId}}),0);
  await finance.settlementForSource(tenantId,'record',noPriceId,{items:[],planTotal:0});
  assert.equal(await db.financeSettlement.count({where:{tenantId,sourceId:noPriceId}}),0);
  result=await run('records',[{...record,externalId:'priced',date:'2024-05-17',price:10000,cost:7000}]);assert.equal(result.failed,0);
  const priced=(await db.record.findUnique({where:{tenantId_recordId:{tenantId,recordId:target(result,'records').targetId}}})).data;
  assert.equal(priced.procedures[0].historicalPrice,10000);assert.equal(priced.procedures[0].historicalDiscount,undefined);
  // Similar workplace names stay distinct.
  result=await run('workplaces',[{name:'Москва BeautyToria'}]);assert.equal(result.failed,0);
  assert.equal(await db.workplace.count({where:{tenantId}}),2);
  // Only stock, including unknown purchase cost, saves known quantity without inventing a price.
  result=await run('items',[{externalId:'i1',name:'Материал',manufacturer:'Производитель',unit:'г',quantity:100,occurredAt:'2024-05-01'}]);
  assert.equal(result.failed,0,JSON.stringify(result));const itemId=target(result,'items').targetId;
  const itemTransfer=target(result,'items').transferId;
  assert.equal((await inventory.snapshot(tenantId)).lots[0].unitCost,null);
  const consumption={externalId:'c1',uei:'12',date:45427,procedure:'Осветление',material:'Материал',manufacturer:'Производитель',unit:'г',quantity:10};
  result=await run('consumables',[consumption]);assert.equal(result.failed,0,JSON.stringify(result));
  const consumptionTransfer=target(result,'consumables').transferId;
  const movement=await db.inventoryMovement.findFirst({where:{tenantId,movementId:target(result,'consumables').targetId}});
  assert.equal(movement.recordId,recordId);assert.equal(movement.procedureKey,stored.procedures[0].id);
  assert.equal(await db.person.count({where:{tenantId}}),2);
  result=await run('consumables',[consumption]);assert.equal(result.unchanged,1);
  error(await run('consumables',[{...consumption,externalId:'wrong',procedure:'Смывка'}]),/Не удалось сопоставить процедуру/);
  error(await run('consumables',[{...consumption,externalId:'missing',procedure:''}]),/Не указана процедура для расходника/);
  result=await run('consumables',[{...consumption,externalId:'free',procedure:'',withoutProcedure:'Да'}]);assert.equal(result.failed,0);
  const free=await db.inventoryMovement.findFirst({where:{tenantId,movementId:target(result,'consumables').targetId}});assert.equal(free.procedureKey,'');assert.equal(free.recordId,recordId);
  // Permission is per fact; even a legacy sheet-wide flag grants no permission.
  const scoped=await file('consumables',[{...consumption,externalId:'scope-one',procedure:''},{...consumption,externalId:'scope-two',procedure:''}]);
  scoped.sheets={consumables:{domain:'consumables',withoutProcedure:true}};
  result=await service.run(tenantId,accountId,scoped,true);assert.equal(result.failed,2);
  const selected=result.rows[0].sourceKey;
  scoped.withoutProcedureFacts=[selected];
  result=await service.run(tenantId,accountId,scoped,true);assert.equal(result.failed,1);assert.equal(result.transferred,1);
  assert.equal(result.rows.find(row=>!row.reason).sourceKey,selected);
  result=await service.run(tenantId,accountId,scoped,false);assert.equal(result.failed,1);assert.equal(result.transferred,1);
  const selectedMovement=await db.inventoryMovement.findFirst({where:{tenantId,movementId:target(result,'consumables').targetId}});
  assert.equal(selectedMovement.procedureKey,'');assert.equal(selectedMovement.recordId,recordId);
  assert.ok(result.rows.find(row=>row.sourceKey!==selected).reason.includes('Не указана процедура для расходника'));
  // Excel's technical 00:00 must not become a service-time constraint.
  result=await run('consumables',[{...consumption,externalId:'midnight',date:new Date('2024-05-15T00:00:00Z')}]);assert.equal(result.failed,0);
  result=await run('records',[{...record,externalId:'r2',from:'17:00',to:'18:00'}]);assert.equal(result.failed,0);
  error(await run('consumables',[{...consumption,externalId:'ambiguous'}]),/Не удалось однозначно определить запись/);
  // A transfer that matched an independent Person owns only its new values.
  await people.upsertPerson(tenantId,'independent-anna',{person:{key:'independent-anna',name:'Анна',phones:['+79990000010'],emails:['independent@example.test']}});
  result=await run('people',[{externalId:'matched-anna',name:'Анна',phone:'79990000010',email:'imported@example.test'}]);assert.equal(result.failed,0);
  const matchedTransfer=target(result,'people').transferId;
  error(await run('people',[{transferId:matchedTransfer,name:'Света',phone:'79990000010',email:'changed@example.test'}]),/имя.*не принадлежит этому переносу/);
  let independent=(await db.person.findFirst({where:{tenantId,key:'independent-anna'}})).data;
  assert.equal(independent.name,'Анна');assert.ok(independent.emails.includes('imported@example.test'));
  result=await run('people',[{transferId:matchedTransfer,name:'Анна',phone:'79990000010',email:'corrected@example.test'}]);assert.equal(result.failed,0);
  independent=(await db.person.findFirst({where:{tenantId,key:'independent-anna'}})).data;
  assert.ok(independent.emails.includes('independent@example.test'));assert.ok(independent.emails.includes('corrected@example.test'));assert.ok(!independent.emails.includes('imported@example.test'));
  result=await run('people',[{transferId:matchedTransfer,name:'Анна',phone:'79990000011',email:'corrected@example.test'}]);assert.equal(result.failed,0);
  independent=(await db.person.findFirst({where:{tenantId,key:'independent-anna'}})).data;
  assert.ok(independent.phones.includes('+79990000010'));assert.ok(independent.phones.includes('+79990000011'));
  // Independently edited imported values are no longer owned by the transfer.
  const original=(await db.person.findFirst({where:{tenantId,key:personId}})).data;
  await people.upsertPerson(tenantId,personId,{person:{...original,name:'Анна независимое исправление'}});
  error(await run('people',[{transferId:personTransfer,name:'Света',phone:person.phone,uei:'12'}]),/имя.*не принадлежит этому переносу/);
  await people.upsertPerson(tenantId,personId,{person:original});
  result=await run('consumables',[{...consumption,transferId:consumptionTransfer,recordId,quantity:15}]);assert.equal(result.failed,0,JSON.stringify(result));
  assert.equal(await db.inventoryMovement.count({where:{tenantId,recordId,procedureKey:stored.procedures[0].id}}),2);
  const payment={externalId:'pay1',recordTransferId:recordTransfer,amount:2000,wallet:'Наличные',occurredAt:'2023-05-17'};
  const paymentCount=await db.financeOperation.count({where:{tenantId}});
  error(await run('payments',[{...payment,externalId:'wrong-procedure',procedure:'Смывка'}]),/Не удалось сопоставить процедуру.*Осветление.*Смывка/);
  error(await run('payments',[{...payment,externalId:'wrong-procedure-natural',recordTransferId:'',uei:'12',date:'2024-05-16',procedure:'Смывка'}]),/Не удалось сопоставить процедуру/);
  assert.equal(await db.financeOperation.count({where:{tenantId}}),paymentCount);
  result=await run('payments',[payment]);assert.equal(result.failed,0,JSON.stringify(result));const paymentTransfer=target(result,'payments').transferId;
  const operationId=target(result,'payments').targetId;
  result=await run('payments',[payment]);assert.equal(result.unchanged,1);
  assert.equal(await db.financeOperation.count({where:{tenantId,operationId}}),1);
  assert.equal(await db.financeSettlement.count({where:{tenantId,sourceType:'record',sourceId:recordId}}),1);
  result=await run('payments',[{...payment,transferId:paymentTransfer,amount:2500}]);assert.equal(result.failed,0);
  assert.equal(await db.financeOperation.count({where:{tenantId,operationId}}),1);
  assert.equal(await db.financeLedgerEntry.count({where:{tenantId,sourceId:recordId}}),1);
  const history=await db.$queryRaw`SELECT "sourceType", "sourceId", "occurredAt", "recordedAt", "provenance" FROM "BusinessHistoryEvent" WHERE "tenantId"=${tenantId} AND "financeOperationId"=${operationId} AND "entityType"='finance-operation' ORDER BY "id" DESC LIMIT 1`;
  assert.equal(history[0].sourceType,'record');assert.equal(history[0].sourceId,recordId);
  assert.equal(history[0].occurredAt.toISOString().slice(0,10),'2023-05-17');assert.ok(history[0].recordedAt>history[0].occurredAt);
  assert.equal(history[0].provenance.type,'import');assert.equal(history[0].provenance.transferId,paymentTransfer);
  assert.equal(Number((await db.$queryRaw`SELECT COUNT(*) AS count FROM "Notification" WHERE "tenantId"=${tenantId}`)[0].count),0);
  // Correction keeps the Record ID, line IDs and single Settlement owner.
  result=await run('records',[{...record,name:'Анна',transferId:recordTransfer,cost:7500}]);assert.equal(result.failed,0,JSON.stringify(result));
  assert.equal(target(result,'records').targetId,recordId);
  const corrected=(await db.record.findFirst({where:{tenantId,recordId}})).data;
  assert.equal(corrected.procedures[0].id,stored.procedures[0].id);assert.equal(corrected.procedures[0].cost,7500);
  assert.equal(await db.financeSettlement.count({where:{tenantId,sourceId:recordId}}),1);
  result=await run('records',[{...record,name:'Анна',externalId:'discount',date:'2024-05-20',discountPercent:20}]);assert.equal(result.failed,0);
  const explicitDiscount=(await db.record.findFirst({where:{tenantId,recordId:target(result,'records').targetId}})).data;
  assert.equal(explicitDiscount.procedures[0].historicalDiscount.value,20);assert.equal(explicitDiscount.procedures[0].cost,7000);
  result=await run('payments',[{externalId:'standalone-payment',amount:100,wallet:'Наличные',occurredAt:'2023-06-01'}]);assert.equal(result.failed,0);
  assert.equal((await db.financeOperation.findFirst({where:{tenantId,operationId:target(result,'payments').targetId}})).sourceType,'payment');
  result=await run('schedule',[{workplace:'BeautyToria',date:'2020-01-01',from:'09:00',to:'18:00'}]);assert.equal(result.failed,0);
  result=await run('items',[{name:'Позиция с ошибкой остатка',unit:'г',quantity:'не число',occurredAt:'2024-01-01'}]);assert.equal(result.transferred,1);assert.equal(result.failed,1);
  assert.equal(await db.inventoryItem.count({where:{tenantId,name:'Позиция с ошибкой остатка'}}),1);
  const unknownRecord=(await records.listForPeople(tenantId,[{key:personId}])).find(row=>row.id===noPriceId);
  assert.equal(unknownRecord.payment.state,'unknown');assert.equal(unknownRecord.payment.due,null);
  const epoch1904=new ExcelJS.Workbook();epoch1904.properties.date1904=true;
  const epochSheet=epoch1904.addWorksheet('people');epochSheet.addRow(['name','phone']);epochSheet.addRow(['Пример 1904','79991110001']);
  result=await service.run(tenantId,accountId,{filename:'epoch.xlsx',source:'epoch',dataUrl:`data:application/octet-stream;base64,${Buffer.from(await epoch1904.xlsx.writeBuffer()).toString('base64')}`},false);
  assert.equal(result.failed,0);assert.equal(result.transferred,1);
  // Historical catalog prices do not mutate today's catalog or workplace price.
  const state=(await db.businessOperationalState.findUnique({where:{tenantId}}))?.data || {};
  const workplaceKey=stored.workplaceId;
  const currentProcedure={id:'current-procedure',name:'Текущая процедура',duration:60,cost:{amount:10000},workplaces:[{workplaceId:workplaceKey,cost:{amount:11000}}]};
  await db.businessOperationalState.upsert({where:{tenantId},create:{tenantId,data:{...state,procedures:[currentProcedure]}},update:{data:{...state,procedures:[currentProcedure]}}});
  result=await run('procedures',[{externalId:'old-price',name:'Текущая процедура',price:3000,duration:45,workplaceKey,occurredAt:'2022-05-01'}]);assert.equal(result.failed,0,JSON.stringify(result));
  const priceTransfer=target(result,'procedures').transferId;
  assert.deepEqual((await db.businessOperationalState.findUnique({where:{tenantId}})).data.procedures,[currentProcedure]);
  let priceHistory=await db.$queryRaw`SELECT "occurredAt", "effectiveAt", "provenance", "data", "sourceType", "sourceId" FROM "BusinessHistoryEvent" WHERE "tenantId"=${tenantId} AND "entityType"='procedure' AND "eventType"='versioned' ORDER BY "id" DESC LIMIT 1`;
  assert.equal(priceHistory[0].occurredAt.toISOString().slice(0,10),'2022-05-01');assert.equal(priceHistory[0].effectiveAt.toISOString().slice(0,10),'2022-05-01');
  assert.equal(priceHistory[0].provenance.transferId,priceTransfer);assert.equal(priceHistory[0].data.current.cost.amount,3000);assert.equal(priceHistory[0].sourceType,'procedure');assert.equal(priceHistory[0].sourceId,currentProcedure.id);
  // Archived price facts are not a source for new bookings.
  assert.equal((await procedures.snapshots(tenantId,workplaceKey,[currentProcedure.id]))[0].cost,11000);
  result=await run('procedures',[{transferId:priceTransfer,name:'Текущая процедура',price:3500,workplaceKey,occurredAt:'2022-05-01'}]);assert.equal(result.failed,0);
  assert.deepEqual((await db.businessOperationalState.findUnique({where:{tenantId}})).data.procedures,[currentProcedure]);
  assert.equal((await db.businessOperationalState.findUnique({where:{tenantId}})).data.procedureHistory.filter(p=>p.transferId===priceTransfer).length,1);
  // One explicitly mapped CRM row saves Person + Workplace + Record despite bad Payment.
  const crm={externalId:'mixed-1',name:'Клиент CRM',phone:'79990000222',uei:'222',workplace:'CRM пространство',date:'2022-06-01',procedure:'Работа CRM',cost:7000,amount:'не сумма',occurredAt:'2022-06-01',wallet:'Наличные'};
  const crmFile=await file('CRM',[crm]);crmFile.sheets={CRM:{domain:'mixed'}};
  result=await service.run(tenantId,accountId,crmFile,false);assert.equal(result.transferred,3,JSON.stringify(result));assert.equal(result.failed,1);
  assert.equal(result.rows.find(row=>row.reason).domain,'payments');assert.match(result.rows.find(row=>row.reason).reason,/Сумма оплаты/);
  const crmPerson=target(result,'people').targetId;const crmRecord=target(result,'records').targetId;
  assert.equal((await db.record.findFirst({where:{tenantId,recordId:crmRecord}})).data.person.key,crmPerson);
  result=await service.run(tenantId,accountId,crmFile,false);assert.equal(result.unchanged,3);assert.equal(result.failed,1);
  const correctedCrm=await file('CRM',[{...crm,amount:2000}]);correctedCrm.sheets=crmFile.sheets;
  result=await service.run(tenantId,accountId,correctedCrm,false);assert.equal(result.failed,0,JSON.stringify(result));assert.equal(result.unchanged,3);assert.equal(result.transferred,1);
  assert.equal(target(result,'records').targetId,crmRecord);
  assert.equal((await db.financeOperation.findFirst({where:{tenantId,operationId:target(result,'payments').targetId}})).sourceId,crmRecord);
  result=await service.run(tenantId,accountId,correctedCrm,false);assert.equal(result.unchanged,4);
  // The recognized Record sheet also expands its explicitly mapped Payment fields.
  result=await run('records',[{...crm,externalId:'record-with-payment',date:'2022-06-02',amount:500}]);assert.equal(result.failed,0);assert.ok(target(result,'payments'));
  // All-invalid source has neither a new transfer ID nor saved facts.
  const before=await db.dataTransferFact.count({where:{tenantId}});
  result=await run('people',[{name:'',phone:'invalid'}]);assert.ok(result.failed);assert.ok(result.rows.every(row=>!row.transferId));
  assert.equal(await db.dataTransferFact.count({where:{tenantId}}),before);
  // A corrected bad row complements the successful original row.
  result=await run('people',[{externalId:'bad',name:'Мария',phone:'79991112233'}]);assert.equal(result.failed,0);
  // Real one-sheet Contacts Excel, with no service metadata in visible columns.
  const emptyContacts = new ExcelJS.Workbook();
  await emptyContacts.xlsx.load(await service.workbook({ domain:'people',template:true }));
  const contactSheet = emptyContacts.worksheets[0];
  assert.equal(emptyContacts.worksheets.length,1);
  assert.equal(contactSheet.name,'Люди');
  assert.equal(contactSheet.rowCount,2,'Template has group and field headers, no people');
  assert.equal(contactSheet.getCell(1,1).value,'Личные данные');
  assert.equal(contactSheet.getCell(1,7).value,'Контактные данные');
  assert.deepEqual(contactSheet.getRow(2).values.slice(1,13),[
    'Код клиента','Имя','Фамилия','Пол','Дата рождения','Скидка, %',
    'Телефон','Дополнительный телефон','Email','Дополнительный Email',
    'Telegram','Дополнительный Telegram',
  ]);
  assert.equal(contactSheet.getCell(2,13).value,'Источник интеграции');
  assert.equal(contactSheet.getCell(2,13).fill.fgColor.argb,'FF303238');
  assert.equal(contactSheet.getColumn(14).hidden,true,'Internal key is not exposed to professionals');
  assert.equal(contactSheet.getCell(2,14).value,'ID человека');
  contactSheet.getRow(3).values=[
    'A012','Ксения Примерная','','Ж','15/6/85',10,'79997771234',
    '79997771235','ksenia@example.test','ksenia.second@example.test',
    '@ksenia_test','@ksenia_alt','YCLIENTS',
  ];
  const contactPayload={filename:'contacts.xlsx',source:'Контакты',
    dataUrl:'data:application/octet-stream;base64,'+Buffer.from(await emptyContacts.xlsx.writeBuffer()).toString('base64'),
    strict:true,expectedDomain:'people',sheets:{'Люди':{domain:'people'}}};
  const beforeContacts=await db.person.count({where:{tenantId}});
  const inspected=await service.run(tenantId,accountId,contactPayload,true);
  assert.equal(inspected.failed,0,JSON.stringify(inspected.rows));
  assert.equal(inspected.transferred,1);
  assert.equal(await db.person.count({where:{tenantId}}),beforeContacts,'Preview never writes people');
  const committed=await service.run(tenantId,accountId,contactPayload,false);
  assert.equal(committed.transferred,1);
  assert.equal(await db.person.count({where:{tenantId}}),beforeContacts+1);
  const importedPerson=await db.person.findFirst({where:{tenantId,data:{path:['name'],equals:'Ксения'}}});
  assert.equal(importedPerson.data.contactStatus,'import');
  const originFact=await db.dataTransferFact.findFirst({where:{tenantId,domain:'people',targetId:importedPerson.key}});
  assert.equal(originFact?.input?.integrationSource,'YCLIENTS','Source is retained in import provenance');
  assert.equal(importedPerson.data.surname,'Примерная');
  assert.equal(importedPerson.data.gender,'female');
  assert.equal(importedPerson.data.birthDate,'1985-06-15');
  assert.equal(importedPerson.data.discountPercent,10);
  assert.deepEqual(importedPerson.data.phones.slice().sort(),['+79997771234','+79997771235'].sort());
  assert.deepEqual(importedPerson.data.emails.slice().sort(),['ksenia@example.test','ksenia.second@example.test'].sort());
  assert.deepEqual(importedPerson.data.telegrams.slice().sort(),['@ksenia_test','@ksenia_alt'].sort());
  const duplicate=await service.run(tenantId,accountId,contactPayload,false);
  assert.equal(duplicate.unchanged,1,'Re-upload never duplicates');
  assert.equal(await db.person.count({where:{tenantId}}),beforeContacts+1);
  const wrongContacts=new ExcelJS.Workbook();
  await wrongContacts.xlsx.load(await service.workbook({domain:'people',template:true}));
  wrongContacts.worksheets[0].getRow(3).values=['','Ирина','','М','15.06','','79993332211'];
  wrongContacts.worksheets[0].getRow(4).values=['','Неверный','','М','15.06','','bad-phone'];
  const badPayload={...contactPayload,
    dataUrl:'data:application/octet-stream;base64,'+Buffer.from(await wrongContacts.xlsx.writeBuffer()).toString('base64')};
  const badChecked=await service.run(tenantId,accountId,badPayload,true);
  assert.ok(badChecked.failed>0,'User must be shown invalid lines before import');
  await assert.rejects(()=>service.run(tenantId,accountId,badPayload,false),
    /В файле есть ошибки/,'Strict import aborts the entire batch');
  assert.equal(await db.person.count({where:{tenantId}}),beforeContacts+1,'No partial contacts saved');
  const existingExport=new ExcelJS.Workbook();
  await existingExport.xlsx.load(await service.workbook({domain:'people',rows:[{
    name:'Ксения',surname:'Примерная',phone:'79997771234',
    email:'ksenia@example.test',personKey:importedPerson.key,
  }]}));
  assert.equal(existingExport.worksheets[0].getCell(3,2).value,'Ксения');
  assert.equal(existingExport.worksheets[0].getCell(3,14).value,importedPerson.key);
  const noYearBook=new ExcelJS.Workbook();
  await noYearBook.xlsx.load(await service.workbook({domain:'people',template:true}));
  noYearBook.worksheets[0].getRow(3).values=['','Алиса Сергеева','','М','15.06','','79997776655'];
  const noYearInput={...contactPayload,dataUrl:'data:application/octet-stream;base64,'+
    Buffer.from(await noYearBook.xlsx.writeBuffer()).toString('base64')};
  const noYearPreview=await service.run(tenantId,accountId,noYearInput,true);
  assert.equal(noYearPreview.failed,0,JSON.stringify(noYearPreview.rows));
  const noYearCommit=await service.run(tenantId,accountId,noYearInput,false);
  assert.equal(noYearCommit.transferred,1);
  const noYearPerson=await db.person.findFirst({where:{tenantId,data:{path:['name'],equals:'Алиса'}}});
  assert.equal(noYearPerson?.data.surname,'Сергеева');
  assert.equal(noYearPerson?.data.birthDate,'06-15','Birthday without year must not synthesize a year');
  assert.equal(noYearPerson?.data.gender,'male');
  const legacyContact=new ExcelJS.Workbook();
  const legacySheet=legacyContact.addWorksheet('Люди');
  legacySheet.addRow(['Имя','Фамилия','Телефон','Дополнительный телефон','Email','Дата рождения','Пол','UEI','ID человека']);
  legacySheet.addRow(['Ольга','Л.', '79996663344','','olga@example.test','15.06.1985','Женский','']);
  const legacyInput={...contactPayload,dataUrl:'data:application/octet-stream;base64,'+
    Buffer.from(await legacyContact.xlsx.writeBuffer()).toString('base64')};
  const legacyCheck=await service.run(tenantId,accountId,legacyInput,true);
  assert.equal(legacyCheck.failed,0,JSON.stringify(legacyCheck.rows));
  assert.equal(legacyCheck.transferred,1);
  console.log('PASS: grouping, contacts, secondary fields, short and full birthdays, gender and old file compatibility');
  console.log('PASS: Contacts Excel one-sheet template, preview, strict atomic import, origin, duplicate safety, export');
  // Journal: six named groups plus standalone fields, same identity order as Contacts, and
  // one booking per row regardless of the number of services.
  const jBook=new ExcelJS.Workbook();
  await jBook.xlsx.load(await service.workbook({domain:'records',template:true}));
  const jSheet=jBook.worksheets[0];
  assert.equal(jBook.worksheets.length,1);
  assert.equal(jSheet.name,'Записи');
  assert.deepEqual([2,7,10,13,17,21].map(i=>jSheet.getCell(1,i).value),
    ['Клиент','Визит','Создание записи','История записи','Услуги','Статусы']);
  assert.equal(jSheet.getCell(1,1).value,null);
  assert.equal(jSheet.getCell(1,20).value,null);
  assert.equal(jSheet.getCell(1,23).value,null);
  assert.equal(jSheet.getCell(2,2).fill.fgColor.argb,'FF303238');
  assert.equal(jSheet.getCell(2,2).font.color.argb,'FFFFFFFF');
  const jHeaders=jSheet.getRow(2).values;
  assert.deepEqual(jHeaders.slice(2,7),['Код клиента','Имя','Фамилия','Телефон','Email']);
  assert.ok(jHeaders.includes('Услуга 3'));
  assert.ok(!jHeaders.includes('Услуга 4'));
  assert.ok(!jHeaders.includes('Оплачено полностью'));
  assert.ok(!jHeaders.includes('Товар 1'));
  assert.ok(!jHeaders.includes('Кошелёк'));
  assert.equal(jSheet.getColumn(jHeaders.indexOf('ID записи')).hidden,true);
  const putJ=(sheet,row,values)=>{
    const header=sheet.getRow(2).values;
    for(const [label,value] of Object.entries(values)){
      const [group,field]=label.includes('/')?label.split('/'):[null,label];
      const groupStart=group?sheet.getRow(1).values.indexOf(group):0;
      const col=group?header.findIndex((title,i)=>i>=groupStart&&i<groupStart+5&&title===field):header.indexOf(field);
      assert.ok(col>0,'Missing Journal Excel column '+label);
      sheet.getRow(row).getCell(col).value=value;
    }
  };
  putJ(jSheet,3,{
    'Рабочее пространство':'BeautyToria',
    'Код клиента':'12','Имя':'Анна','Телефон':'79991234567','Email':'anna.booking@example.test',
    'Дата визита':'2014-06-15','Время начала':'10:00',
    'Создание записи/Имя':'Администратор','Создание записи/Дата':'2014-06-01',
    'Создание записи/Время':'09:30','История записи/Статус':'Записался',
    'История записи/Имя':'Администратор','История записи/Дата':'2014-06-02',
    'История записи/Время':'10:45',
    'Услуга 1':'Стрижка','Услуга 2':'Укладка',
    'Стоимость':3500,'Статус посещения':'Не пришёл',
    'Статус оплаты':'Оплачено',
    'Комментарий':'Подтверждение по телефону','Источник интеграции':'Онлайн-запись',
  });
  const jPayload={filename:'Записи.xlsx',source:'Журнал',strict:true,expectedDomain:'records',
    dataUrl:'data:application/octet-stream;base64,'+Buffer.from(await jBook.xlsx.writeBuffer()).toString('base64')};
  const beforeJ=await db.record.count({where:{tenantId}});
  const beforePayments=await db.financeOperation.count({where:{tenantId}});
  const jPreview=await service.run(tenantId,accountId,jPayload,true);
  assert.equal(jPreview.failed,0,JSON.stringify(jPreview.rows));
  assert.equal(jPreview.transferred,1);
  assert.equal(await db.record.count({where:{tenantId}}),beforeJ);
  result=await service.run(tenantId,accountId,jPayload,false);
  assert.equal(result.transferred,1,JSON.stringify(result.rows));
  const jId=target(result,'records').targetId;
  const jRecord=(await db.record.findUnique({where:{tenantId_recordId:{tenantId,recordId:jId}}})).data;
  assert.equal(jRecord.procedures.length,2);
  assert.equal(jRecord.procedures[0].name,'Стрижка');
  assert.equal(jRecord.procedures[1].name,'Укладка');
  assert.equal(jRecord.to,'','Unknown departure time is allowed');
  assert.equal(jRecord.historicalVisit,'Не пришёл');
  assert.equal(jRecord.historicalPaymentStatus,'Оплачено');
  assert.equal(jRecord.historicalAction,'Записался');
  assert.equal(jRecord.historicalCreatorName,'Администратор');
  assert.equal(jRecord.historicalCreatedDate,'2014-06-01');
  assert.equal(jRecord.historicalCreatedTime,'09:30');
  assert.equal(jRecord.historicalChangedBy,'Администратор');
  assert.equal(jRecord.historicalChangedDate,'2014-06-02');
  assert.equal(jRecord.historicalChangedTime,'10:45');
  assert.equal(jRecord.historicalQuotedTotal,3500);
  assert.equal(jRecord.historicalComment,'Подтверждение по телефону');
  assert.equal(jRecord.person.email,'anna.booking@example.test');
  assert.equal(jRecord.historicalIntegrationSource,'Онлайн-запись');
  assert.equal(jRecord.source,'online-booking','Source meaning survives import');
  assert.equal(await db.financeOperation.count({where:{tenantId}}),beforePayments,
    'Paid status and record price do not create money movements');
  result=await service.run(tenantId,accountId,jPayload,false);
  assert.equal(result.unchanged,1,'Repeat upload does not duplicate Record');
  assert.equal(await db.record.count({where:{tenantId}}),beforeJ+1);
  const jExport=new ExcelJS.Workbook();
  await jExport.xlsx.load(await service.workbook({domain:'records',rows:[{
    recordId:jId,workplace:'BeautyToria',uei:'12',name:'Анна',
    date:'2014-06-15',from:'10:00',creatorName:'Администратор',
    actionStatus:'Записался',paymentStatus:'Оплачено',paidFull:'Да',quotedTotal:3500,
    services:[{name:'Стрижка'},{name:'Укладка'}],
  }]}));
  const jExportSheet=jExport.worksheets[0];
  assert.equal(jExportSheet.rowCount,3);
  assert.equal(jExportSheet.getCell(3,17).value,'Стрижка');
  assert.equal(jExportSheet.getCell(3,18).value,'Укладка');
  assert.equal(jExportSheet.getCell(3,jExportSheet.getRow(2).values.indexOf('Стоимость')).value,3500);
  assert.equal(jExportSheet.getCell(3,jExportSheet.getRow(2).values.indexOf('ID записи')).value,jId);
  const jInvalid=new ExcelJS.Workbook();
  await jInvalid.xlsx.load(await service.workbook({domain:'records',template:true}));
  putJ(jInvalid.worksheets[0],3,{
    'Рабочее пространство':'BeautyToria','Код клиента':'12',
    'Имя':'Анна','Телефон':'79991234567','Дата визита':'2013-03-12',
    'Время визита':'09:00','История записи/Статус':'Записался',
    'Статус посещения':'Пришёл','Статус оплаты':'Не оплачено','Услуга 1':'Стрижка',
  });
  putJ(jInvalid.worksheets[0],4,{
    'Рабочее пространство':'BeautyToria','Имя':'Несуществующий',
    'Телефон':'79999992200','Дата визита':'2013-03-13',
    'Время визита':'10:00','История записи/Статус':'Записался',
    'Статус посещения':'Пришёл','Статус оплаты':'Не оплачено','Услуга 1':'Стрижка',
  });
  const jInvalidPayload={...jPayload,
    dataUrl:'data:application/octet-stream;base64,'+Buffer.from(await jInvalid.xlsx.writeBuffer()).toString('base64')};
  assert.equal((await service.run(tenantId,accountId,jInvalidPayload,true)).failed,1);
  await assert.rejects(()=>service.run(tenantId,accountId,jInvalidPayload,false),/В файле есть ошибки/);
  assert.equal(await db.record.count({where:{tenantId}}),beforeJ+1,'No partial Journal upload');

  // DDS Excel: one operation per row, real imported payment bound to Record.
  const fBook=new ExcelJS.Workbook();
  await fBook.xlsx.load(await service.workbook({domain:'finance',template:true}));
  const fSheet=fBook.worksheets[0];
  assert.equal(fSheet.name,'Финансы');
  fSheet.getRow(2).values=[
    '', '2014-06-15T10:00:00Z','Оплата услуги','Наличные',750,'','',jId,
  ];
  const fPayload={filename:'ДДС.xlsx',source:'ДДС',strict:true,expectedDomain:'finance',
    dataUrl:'data:application/octet-stream;base64,'+Buffer.from(await fBook.xlsx.writeBuffer()).toString('base64')};
  const beforeF=await db.financeOperation.count({where:{tenantId}});
  result=await service.run(tenantId,accountId,fPayload,true);
  assert.equal(result.failed,0,JSON.stringify(result.rows));
  assert.equal(result.transferred,1);
  assert.equal(await db.financeOperation.count({where:{tenantId}}),beforeF);
  result=await service.run(tenantId,accountId,fPayload,false);
  assert.equal(result.transferred,1,JSON.stringify(result.rows));
  const journalPaymentId=target(result,'payments').targetId;
  assert.equal((await db.financeOperation.findUnique({
    where:{tenantId_operationId:{tenantId,operationId:journalPaymentId}},
  })).sourceId,jId);
  result=await service.run(tenantId,accountId,fPayload,false);
  assert.equal(result.unchanged,1,'Repeat finance upload never duplicates payment');
  assert.equal(await db.financeOperation.count({where:{tenantId}}),beforeF+1);
  // Exported Record and Finance files can be uploaded again without duplication.
  const jRoundtrip={filename:'Записи.xlsx',source:'Журнал',strict:true,expectedDomain:'records',
    dataUrl:'data:application/octet-stream;base64,'+
      Buffer.from(await jExport.xlsx.writeBuffer()).toString('base64')};
  result=await service.run(tenantId,accountId,jRoundtrip,false);
  assert.equal(result.unchanged,1,JSON.stringify(result.rows));
  assert.equal(await db.record.count({where:{tenantId}}),beforeJ+1);
  const latestPaymentId=journalPaymentId;
  assert.ok(latestPaymentId);
  const fRoundtripBook=new ExcelJS.Workbook();
  await fRoundtripBook.xlsx.load(await service.workbook({domain:'finance',rows:[{
    operationId:latestPaymentId,occurredAt:'2014-06-15T10:00:00Z',
    kind:'Оплата услуги',wallet:'Наличные',amount:750,recordId:jId,
  }]}));
  const fRoundtrip={filename:'Финансы.xlsx',source:'ДДС',strict:true,expectedDomain:'finance',
    dataUrl:'data:application/octet-stream;base64,'+
      Buffer.from(await fRoundtripBook.xlsx.writeBuffer()).toString('base64')};
  result=await service.run(tenantId,accountId,fRoundtrip,false);
  assert.equal(result.unchanged,1,JSON.stringify(result.rows));
  assert.equal(await db.financeOperation.count({where:{tenantId}}),beforeF+1);

  // Cash refund correctly reduces the real payment; no deposit entry is invented.
  const refundBook=new ExcelJS.Workbook();
  await refundBook.xlsx.load(await service.workbook({domain:'finance',template:true}));
  const refundSheet=refundBook.worksheets[0];
  const refundRow=refundSheet.getRow(2);
  const index=(label)=>refundSheet.getRow(1).values.indexOf(label);
  refundRow.getCell(index('Дата операции')).value='2014-06-20T10:00:00Z';
  refundRow.getCell(index('Вид операции')).value='Возврат оплаты';
  refundRow.getCell(index('Кошелёк')).value='Наличные';
  refundRow.getCell(index('Сумма')).value=200;
  refundRow.getCell(index('Исходная оплата')).value=latestPaymentId;
  const refundInput={filename:'Возвраты.xlsx',source:'ДДС',strict:true,expectedDomain:'finance',
    dataUrl:'data:application/octet-stream;base64,'+
      Buffer.from(await refundBook.xlsx.writeBuffer()).toString('base64')};
  result=await service.run(tenantId,accountId,refundInput,true);
  assert.equal(result.failed,0,JSON.stringify(result.rows));
  result=await service.run(tenantId,accountId,refundInput,false);
  assert.equal(result.failed,0,JSON.stringify(result.rows));
  const refundId=target(result,'operations').targetId;
  const refundOp=await db.financeOperation.findUnique({
    where:{tenantId_operationId:{tenantId,operationId:refundId}},
  });
  assert.equal(refundOp.kind,'refund');
  assert.equal(refundOp.originalOperationId,latestPaymentId);
  result=await service.run(tenantId,accountId,refundInput,false);
  assert.equal(result.unchanged,1);

  // CSV is not a fake export-only format: the same header imports as a Record.
  const csvText='Имя;Телефон;Дата;Рабочее пространство;Статус записи;Посещение;Оплата;Услуга 1\n'
    +'Анна;79991234567;2012-05-06;BeautyToria;Записался;Пришёл;Не оплачено;Стрижка\n';
  const csvInput={filename:'Записи.csv',source:'Журнал',strict:true,expectedDomain:'records',
    dataUrl:'data:text/csv;base64,'+Buffer.from(csvText).toString('base64')};
  result=await service.run(tenantId,accountId,csvInput,false);
  assert.equal(result.failed,0,JSON.stringify(result.rows));
  assert.equal(result.transferred,1);
  result=await service.run(tenantId,accountId,csvInput,false);
  assert.equal(result.unchanged,1);
  // Cancelled historical DDS facts create a genuine reversal, preserving zero cash effect.
  const articleResult=await run('articles',[{
    article:'Excel тест дохода',articleDirection:'Доход',articleEconomicType:'Прочий доход',
  }]);
  assert.equal(articleResult.failed,0,JSON.stringify(articleResult.rows));
  const cancelBook=new ExcelJS.Workbook();
  await cancelBook.xlsx.load(await service.workbook({domain:'finance',template:true}));
  const cancelSheet=cancelBook.worksheets[0];
  const position=(label)=>cancelSheet.getRow(1).values.indexOf(label);
  const cancelLine=cancelSheet.getRow(2);
  cancelLine.getCell(position('Дата операции')).value='2022-01-05T12:00:00Z';
  cancelLine.getCell(position('Вид операции')).value='Доход';
  cancelLine.getCell(position('Кошелёк')).value='Наличные';
  cancelLine.getCell(position('Сумма')).value=100;
  cancelLine.getCell(position('Статья')).value='Excel тест дохода';
  cancelLine.getCell(position('Статус')).value='Отменена';
  cancelLine.getCell(position('Дата отмены')).value='2022-01-07T10:00:00Z';
  const cancelInput={filename:'Отменённые.xlsx',source:'ДДС',strict:true,expectedDomain:'finance',
    dataUrl:'data:application/octet-stream;base64,'+
      Buffer.from(await cancelBook.xlsx.writeBuffer()).toString('base64')};
  result=await service.run(tenantId,accountId,cancelInput,true);
  assert.equal(result.failed,0,JSON.stringify(result.rows));
  result=await service.run(tenantId,accountId,cancelInput,false);
  assert.equal(result.failed,0,JSON.stringify(result.rows));
  const cancelledId=target(result,'operations').targetId;
  const cancelled=await db.financeOperation.findUnique({
    where:{tenantId_operationId:{tenantId,operationId:cancelledId}},
  });
  assert.equal(cancelled.status,'cancelled');
  const reversal=await db.financeOperation.findUnique({
    where:{tenantId_operationId:{tenantId,operationId:'cancel-'+cancelledId}},
  });
  assert.equal(reversal?.kind,'cancel');
  result=await service.run(tenantId,accountId,cancelInput,false);
  assert.equal(result.unchanged,1);
  console.log('PASS: historical cancelled DDS operation and reversal');
  console.log('PASS: XLSX export/reimport, refunds, and CSV upload');
  console.log('PASS: Journal and DDS Excel templates, horizontal services, preview, atomic import, repeat safety');
  await (await import('./check-universal-transfer.mjs')).verifyUniversalTransfer({db,service,people,finance,procedures,inventory,accountId});
  console.log('Data transfer PostgreSQL integration: all scenarios passed');
} finally {
  // This script owns only its random isolated fixture, never existing tenant data.
  await db.tenant.delete({where:{id:tenantId}}).catch(()=>{});
  await db.platformAccount.delete({where:{id:accountId}}).catch(()=>{});
  await db.$disconnect();
}
