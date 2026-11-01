import assert from 'node:assert/strict';
import fs from 'node:fs';

const controller = fs.readFileSync('server/src/business-state/business-state.controller.ts', 'utf8');
const moduleSource = fs.readFileSync('server/src/business-state/business-state-http.module.ts', 'utf8');

assert.match(controller, /import \{ TimeService \} from '\.\.\/time\/time\.service';/,
  'BusinessStateController must use the canonical TimeService for workplace-local past-time checks');
assert.match(moduleSource, /import \{ TimeModule \} from '\.\.\/time\/time\.module';/,
  'BusinessStateHttpModule must import TimeModule');
assert.match(moduleSource, /imports:\s*\[[^\]]*TimeModule[^\]]*\]/,
  'BusinessStateHttpModule must provide TimeService through TimeModule');
assert.match(controller, /private readonly time: TimeService/,
  'BusinessStateController must inject TimeService');
assert.match(controller, /const hasScheduledStart =[^;]+this\.time\.timeToMinutes\(recordFrom\) != null;/,
  'historical suppression must only apply when Record has a valid scheduled start');
assert.match(
  controller,
  /if \(type === 'booking\.created' && hasScheduledStart && this\.time\.isPastZonedStart\(recordDate, recordFrom, workplace\?\.timeZone\)\) return;/,
  'only booking.created for a past workplace-local Record start may be suppressed',
);
assert.match(controller, /'booking\.rescheduled'/, 'rescheduled notification behavior must remain wired');
assert.match(controller, /'booking\.deleted'/, 'deleted notification behavior must remain wired');
assert.match(controller, /'booking\.cancelled'/, 'cancelled notification behavior must remain wired');
assert.match(controller, /'booking\.confirmed'/, 'confirmed notification behavior must remain wired');
assert.match(controller, /'booking\.no-show'/, 'no-show notification behavior must remain wired');

console.log('historical Record notification guard: OK');
