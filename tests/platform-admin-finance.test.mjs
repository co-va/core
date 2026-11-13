import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderCommercialFinance } from '../admin/commercial-finance.js';

const admin = readFileSync(new URL('../admin/admin.js',import.meta.url),'utf8');
const controller = readFileSync(new URL('../server/src/saas-admin/commercial-finance.controller.ts',import.meta.url),'utf8');
const service = readFileSync(new URL('../server/src/saas-admin/commercial-finance.service.ts',import.meta.url),'utf8');
assert.match(admin,/\{ id: 'finance', label: 'Финансы', icon: 'finance' \}/);
assert.match(admin,/\{ id: 'tariffs', label: 'Тарифы', icon: 'tags' \}/);
assert.match(admin,/if \(state.section === 'finance'\) return renderFinanceSection\(\)/);
assert.match(controller,/@UseGuards\(JwtAuthGuard, PlatformAdminGuard\)/);
assert.match(service,/FROM "CommercialOrder"/);
assert.match(service,/FROM "CommercialPayment"/);
assert.match(service,/bankReconciliationConnected: false/);
assert.doesNotMatch(service,/bankReconciliationConnected: true/);

let markup = '';
let selected = '';
const body = {
  set innerHTML(v){markup=v;},
  get innerHTML(){return markup;},
  querySelectorAll(){return [{dataset:{financeTenant:'t1'},addEventListener(name,fn){this.fn=fn;}}]},
};
const escapeHtml = (v) => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
renderCommercialFinance(body,{
  summary:{pendingOrders:2,pendingMinor:500000,confirmedPayments:1,confirmedMinor:100000,paymentsWithoutWallet:1},
  paymentSetup:{paymentUrlConfigured:true,instructionsConfigured:false,bankReconciliationConnected:false},
  orders:[{
    id:'o1',tenantId:'t1',status:'PENDING',totalMinor:500000,currency:'RUB',tariffKey:'tariff.start-plus',
    periodMonths:6,accessDays:216,createdAt:'2026-11-12T12:00:00.000Z',paidAt:null,receiptUrl:'',
  }],
  payments:[{
    id:'p1',orderId:'o0',tenantId:'t1',status:'SUCCEEDED',provider:'MANUAL',
    amountMinor:100000,currency:'RUB',walletKey:'',occurredAt:'2026-11-12T12:00:00.000Z',
  }],
},{escapeHtml,tenantName:() => 'Тест <script>',onTenant:(id)=>selected=id});
assert.match(markup,/Банком|Сверка с банком/);
assert.match(markup,/Не подключена/);
assert.match(markup,/Не назначено/);
assert.match(markup,/216 дней/);
assert.match(markup,/Ручное подтверждение/);
assert.match(markup,/&lt;script&gt;/);
assert.doesNotMatch(markup,/<script>/);
assert.match(markup,/Отмечено как оплачено/, 'Use the published Admin wording, not internal Core jargon');
assert.match(markup,/Фактическое поступление денег нужно проверять по банковской выписке/,
  'Payment status must never claim bank settlement');
assert.doesNotMatch(markup,/Подтверждено в Core/,
  'Do not return technical payment labels to the Administrator');
console.log('Admin Finance reads commercial receipts and payment history without claiming bank settlement: PASS');
