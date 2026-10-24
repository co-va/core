import assert from 'node:assert/strict';
import { hydrateDaysFromServer } from '../core/day/index.js';
import { configureWorkplaceSource } from '../core/workplace-time.js';
import { checkTimeAvailability, configureTimeUsageSource } from '../core/time/index.js';

globalThis.window = { dispatchEvent() {} };

configureWorkplaceSource(() => [{ key: 'studio', name: 'Studio', from: '09:00', to: '18:00' }]);
hydrateDaysFromServer([
  { date: '2026-10-22', workplaceId: 'studio', from: '09:00', to: '18:00' },
  { date: '2026-10-23', workplaceId: 'studio', from: '09:00', to: '18:00' },
]);
configureTimeUsageSource(({ date, workplaceId } = {}) => {
  if (workplaceId !== 'studio') return [];
  if (date === '2026-10-22') return [
    { type: 'record', rigidity: 'hard', sourceId: 'record-1', date, from: '10:00', to: '11:00' },
    { type: 'event', rigidity: 'soft', sourceId: 'event-1', date, from: '12:00', to: '13:00' },
  ];
  return [];
});

assert.equal(checkTimeAvailability({ date: '2026-10-22', workplaceId: 'studio', from: '10:30', to: '11:30' }).reason, 'occupied', 'Event must not overlap Record');
assert.equal(checkTimeAvailability({ date: '2026-10-22', workplaceId: 'studio', from: '12:30', to: '13:30' }).reason, 'occupied', 'Event must not overlap Event');
assert.equal(checkTimeAvailability({ date: '2026-10-22', workplaceId: 'studio', from: '12:00', to: '13:00', excludeId: 'event-1' }).ok, true, 'editing must exclude the same Event id');
assert.equal(checkTimeAvailability({ date: '2026-10-22', workplaceId: 'studio', from: '17:30', to: '18:30' }).reason, 'outside-working-time', 'Work Schedule must constrain Event');

hydrateDaysFromServer([
  { date: '2026-10-22', workplaceId: 'studio', from: '12:00', to: '20:00' },
]);
configureTimeUsageSource(() => []);
assert.equal(checkTimeAvailability({ date: '2026-10-22', workplaceId: 'studio', from: '19:30', to: '20:00' }).ok, true, 'Event ending exactly at Work Schedule end must be allowed');
assert.equal(checkTimeAvailability({ date: '2026-10-22', workplaceId: 'studio', from: '19:30', to: '20:15' }).reason, 'outside-working-time', 'Event beyond Work Schedule end must still be rejected');

hydrateDaysFromServer([
  { date: '2026-10-22', workplaceId: 'studio', from: '22:00', to: '23:59' },
  { date: '2026-10-23', workplaceId: 'studio', from: '00:00', to: '03:00' },
]);
configureTimeUsageSource(({ date, workplaceId } = {}) => {
  if (workplaceId !== 'studio') return [];
  if (date === '2026-10-22') return [
    { type: 'record', rigidity: 'hard', sourceId: 'record-night', date: '2026-10-22', from: '23:00', to: '23:30' },
  ];
  if (date === '2026-10-23') return [
    { type: 'event', rigidity: 'soft', sourceId: 'event-night', date: '2026-10-23', from: '00:30', to: '01:00' },
  ];
  return [];
});

assert.equal(checkTimeAvailability({ date: '2026-10-22', workplaceId: 'studio', from: '23:30', to: '00:15' }).ok, true, 'one Event may cross midnight when both Work Schedule segments are free');
assert.equal(checkTimeAvailability({ date: '2026-10-22', workplaceId: 'studio', from: '22:30', to: '00:15' }).reason, 'occupied', 'cross-midnight Event must detect a Record before midnight');
assert.equal(checkTimeAvailability({ date: '2026-10-22', workplaceId: 'studio', from: '23:30', to: '00:45' }).reason, 'occupied', 'cross-midnight Event must detect another Event after midnight');
assert.equal(checkTimeAvailability({ date: '2026-10-22', workplaceId: 'studio', from: '23:30', to: '03:30' }).reason, 'outside-working-time', 'cross-midnight Event must obey next-day Work Schedule');

console.log('Event availability tests: OK');
