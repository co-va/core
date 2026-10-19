import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync('ui/record/runtime.js', 'utf8');
const view = fs.readFileSync('core/records/view.js', 'utf8');
const finance = fs.readFileSync('core/finance/settlement.js', 'utf8');
const payment = fs.readFileSync('core/payment/record-payment.js', 'utf8');
const program = fs.readFileSync('core/loyalty/record-program.js', 'utf8');
const programMutation = fs.readFileSync('core/records/program-selection.js', 'utf8');
const auxiliaryState = fs.readFileSync('core/runtime/auxiliary-state.js', 'utf8');
const recordServer = fs.readFileSync('server/src/record/record.service.ts', 'utf8');
const serverPriceCondition = fs.readFileSync('server/src/loyalty/price-condition.ts', 'utf8');
const depositState = fs.readFileSync('server/src/loyalty/deposit-state.ts', 'utf8');

// Shared Record UI: mini-card -> program selector -> procedures.
assert.match(runtime, /programControl = ''/);
assert.match(runtime, /record-confirmation-view__card[^]*record-confirmation-view__program[^]*record-confirmation-view__procedures/);

// Record View shows a Program selector only when assigned programs exist and delegates mutation to Record owner.
assert.match(view, /programOptions\.length \? select\(\{/);
assert.match(view, /label: 'Программа'/);
assert.match(view, /\{ value: '', label: 'Не выбрано' \}/);
assert.match(view, /data-record-view-program/);
assert.match(view, /setRecordLoyaltyProgram\(source, recordProgramSelection\(nextProgram\)\)/);
assert.doesNotMatch(view, /updateRecord/);
assert.match(programMutation, /updateRecord\(current\.id, \{ loyaltyProgram: next \}\)/);
assert.match(programMutation, /getRecordPaymentState\(current\)\.hasPayments/);

// Deposit assignments are loaded during authenticated workspace bootstrap, not only after opening Loyalty.
assert.match(auxiliaryState, /loadAllDeposits/);
assert.match(auxiliaryState, /Promise\.all\(\[payload\(await apiRequest\('\/finance'\)/);

// Personal account stays outside the Program selector.
assert.doesNotMatch(program, /personal-account/);
assert.doesNotMatch(program, /PersonalAccount/);
assert.match(program, /type: 'deposit'/);
assert.match(program, /type: 'certificate'/);
assert.match(program, /type: 'subscription'/);
assert.match(program, /type: 'referral'/);
assert.match(program, /type: 'bonus'/);

// Client Finance applies only the program explicitly stored on the record.
assert.doesNotMatch(finance, /getPersonDepositPriceConditions/);
assert.match(finance, /record\?\.loyaltyProgram/);
assert.match(finance, /selected\?\.pricePercent/);
assert.match(finance, /resolvePersonPriceCondition\(null, \[\{/);

// Server Record persists that explicit selection and validates the concrete selected deposit.
assert.match(recordServer, /resolveSelectedRecordProgramPricePercent/);
assert.match(recordServer, /const programChanged =/);
assert.match(recordServer, /loyaltyProgram,/);
assert.match(recordServer, /refreshProcedures \|\| productsChanged \|\| programChanged/);
assert.match(serverPriceCondition, /selectedDepositPriceSource/);
assert.match(serverPriceCondition, /resolvePersonPriceCondition\(null, source \? \[source\] : \[\]\)/);
assert.match(depositState, /export async function selectedDepositPriceSource/);
assert.match(depositState, /Выбранный депозит принадлежит другому человеку/);

// A deposit appears as a payment source only when that deposit was selected for the record.
assert.match(payment, /selectedRecordDepositId\(record\)/);
assert.match(payment, /if \(!selectedDepositId && !currentIds\.size\) return \[\]/);

console.log('Record explicit program selection smoke test passed');
