import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);
const { PrismaClient }=require('@prisma/client');
const ExcelJS=require('exceljs');
const { DepositExcelService }=require('../dist/loyalty/deposit-excel.service.js');
const { DepositService }=require('../dist/loyalty/deposit.service.js');

const prisma=new PrismaClient();
const tenantId='deposit-excel-smoke-'+randomUUID();
const deposits=new DepositService(prisma,null);
const excel=new DepositExcelService(prisma,deposits);
const pad=(values)=>values;
let created=false;
try {
  await prisma.tenant.create({data:{id:tenantId,name:'Isolated deposit Excel smoke'}});
  created=true;
  const template=await excel.template();
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(template);
  assert.equal(workbook.worksheets.length,1,'Only one sheet in the template');
  const sheet=workbook.worksheets[0];
  assert.equal(sheet.rowCount,2,'Empty template must not contain phantom data rows');
  assert.equal(sheet.getCell(2,1).value,'Депозит');
  assert.deepEqual([1,10,14].map(c=>sheet.getCell(1,c).value),
    ['Данные депозита','Данные клиента','Данные операции']);
  assert.deepEqual(sheet.getRow(2).values.slice(1,19),[
    'Депозит','Вид суммы','Номинал','Срок','С','По','Выгода','Выгода, %',
    'Код программы','Код клиента','Имя','Телефон','Номер карты',
    'Дата операции','Действие','Сумма','Кошелёк','Комментарий',
  ]);
  assert.equal(sheet.getCell(2,15).value,'Действие');
  assert.equal(sheet.views[0].ySplit,2);
  assert.ok(!sheet.views[0].xSplit,'The first column must NOT be frozen');
  assert.equal(sheet.getCell(1,1).fill.fgColor.argb,'FFDEDFE0');
  assert.equal(sheet.getCell(2,1).fill.fgColor.argb,'FF303238');
  assert.equal(sheet.getCell(2,1).font.color.argb,'FFFFFFFF');
  assert.match(sheet.getCell(2,9).note.texts.map(item=>item.text).join(''),/4 символа/);
  assert.match(sheet.getCell(2,13).note.texts.map(item=>item.text).join(''),/8 символов/);
  sheet.getRow(3).values=pad(['Ромашка','Фиксированная',30000,'Период',
    '2024-01-01','2024-12-31','Нет',0,'','','Маша Иванова',
    '79990001122','','2024-02-15','Пополнение',15000,'','']);
  sheet.getRow(4).values=pad(['Ромашка','','','','','','','','','',
    'Маша Иванова','79990001122','','2024-02-20','Пополнение',15000,'','']);
  sheet.getRow(5).values=pad(['Ромашка','','','','','','','','','',
    'Маша Иванова','79990001122','','2024-02-25','Списание',5000,'','Услуги']);
  const payload={file:Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')};
  const preview=await excel.preview(tenantId,payload);
  assert.equal(preview.ready,true,JSON.stringify(preview.errors));
  assert.equal(preview.operations,3);
  assert.equal(preview.programs,1);
  assert.equal(preview.people,1);
  assert.equal(await prisma.financeOperation.count({where:{tenantId}}),0,'Preview must not modify the database');
  const imported=await excel.apply(tenantId,{...payload,batchId:preview.batchId});
  assert.equal(imported.imported,3);
  assert.equal(imported.programs,1);
  assert.equal(await prisma.person.count({where:{tenantId}}),1);
  assert.equal(await prisma.loyaltyDepositInstance.count({where:{tenantId}}),1);
  assert.equal(await prisma.financeOperation.count({where:{tenantId}}),3);
  assert.equal(await prisma.financeLedgerEntry.count({where:{tenantId}}),0,'Unknown wallets must not become cash');
  assert.equal(await prisma.record.count({where:{tenantId}}),0,'Historical spending must not invent Journal records');
  const [issued]=await deposits.list(tenantId);
  assert.equal(issued.fundedAmount,30000);
  assert.equal(issued.balance,25000);
  assert.equal(issued.status,'expired','Historic expiry must not erase the unspent remainder');
  const spending=issued.history.find(x=>x.kind==='deposit-import-spend');
  assert.equal(spending.balanceAfter,25000);
  assert.equal(spending.origin,'excel_import');
  assert.equal(spending.reconciliationStatus,'unmatched');
  assert.equal(spending.recordId,'');
  assert.equal(issued.history.filter(x=>x.kind==='deposit-funding').length,2);
  const repeat=await excel.apply(tenantId,{...payload,batchId:preview.batchId});
  assert.equal(repeat.imported,0,'Repeated file never creates new financial events');
  assert.equal(repeat.skipped,3);
  assert.equal(await prisma.financeOperation.count({where:{tenantId}}),3);
  const funds=await prisma.financeOperation.findFirst({where:{tenantId,sourceRow:3,origin:'excel_import'}});
  assert.equal(funds.walletResolution,'unknown');
  await deposits.correctFunding(tenantId,issued.depositId,funds.operationId,{
    amount:15000,walletId:'cashless',walletName:'Безналичные',occurredAt:funds.occurredAt.toISOString(),
  });
  const fixed=await prisma.financeOperation.findUnique({where:{id:funds.id}});
  assert.equal(fixed.walletResolution,'resolved','Choosing wallet preserves original imported operation');
  assert.equal(fixed.origin,'excel_import');
  assert.equal(await prisma.financeLedgerEntry.count({where:{tenantId}}),1);
  assert.equal((await deposits.get(tenantId,issued.depositId)).balance,25000,'Wallet assignment never duplicates funding');
  const exported=await excel.export(tenantId);
  const output=new ExcelJS.Workbook();
  await output.xlsx.load(exported);
  assert.equal(output.worksheets.length,1);
  assert.equal(output.worksheets[0].getCell(2,19).value,'Остаток');
  assert.equal(output.worksheets[0].getCell(2,21).value,'Источник');
  assert.equal(output.worksheets[0].getCell(2,26).value,'ID операции');
  assert.equal(output.worksheets[0].getCell(5,19).value,25000);
  assert.equal(output.worksheets[0].rowCount,5,'Export rows must start after the headers');
  const ex=output.worksheets[0];
  const code=String(ex.getCell(3,9).value),client=String(ex.getCell(3,10).value);
  assert.equal(code.length,4);assert.equal(client.length,4);
  assert.equal(ex.getCell(3,13).value,code+client,'Card = program code + client code');
  assert.ok(String(ex.getCell(3,26).value).startsWith('excel-'));
  const reimportFile={file:Buffer.from(await output.xlsx.writeBuffer()).toString('base64')};
  const roundTrip=await excel.preview(tenantId,reimportFile);
  assert.equal(roundTrip.ready,true,JSON.stringify(roundTrip.errors));
  assert.equal(roundTrip.skipped,3,'Reimport of canonical export must not create operations');
  const reapplied=await excel.apply(tenantId,{...reimportFile,batchId:roundTrip.batchId});
  assert.equal(reapplied.imported,0);
  assert.equal(await prisma.loyaltyDepositInstance.count({where:{tenantId}}),1);
  console.log('PASS: deposit Excel one-sheet template, preview, atomic funding/spending, wallet unknown, expiry, repeat import, wallet correction, export');
} finally {
  if(created) {
    await prisma.financeLedgerEntry.deleteMany({where:{tenantId}});
    await prisma.financeOperation.deleteMany({where:{tenantId}});
    await prisma.loyaltyDepositInstance.deleteMany({where:{tenantId}});
    await prisma.loyaltyDepositProgram.deleteMany({where:{tenantId}});
    await prisma.person.deleteMany({where:{tenantId}});
    await prisma.ueiState.deleteMany({where:{tenantId}});
    await prisma.tenant.deleteMany({where:{id:tenantId}});
  }
  await prisma.$disconnect();
}
