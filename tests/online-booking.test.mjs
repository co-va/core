import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bookingDuration,
  bookingProcedureCost,
  bookingProcedurePrice,
  getBookingProcedures,
  getBookingSlots,
  getBookingWorkingDates,
} from '../online-booking/model.js';

const context = {
  workplaces: [
    { key: 'moscow', name: 'Москва', timeZone: 'Europe/Moscow', from: '10:00', to: '18:00' },
    { key: 'spb', name: 'Питер', timeZone: 'Europe/Moscow', from: '10:00', to: '18:00' },
    { key: 'ekb', name: 'Екатеринбург', timeZone: 'Asia/Yekaterinburg', from: '10:00', to: '18:00' },
  ],
  procedures: [
    { id: 'cut', name: 'Стрижка', duration: 60, workplaces: [{ workplaceId: 'spb' }] },
    { id: 'color', name: 'Окрашивание', duration: 120, workplaces: [{ workplaceId: 'spb' }] },
    { id: 'other', name: 'Другая', duration: 30, workplaces: [{ workplaceId: 'moscow' }, { workplaceId: 'ekb' }] },
  ],
  days: [
    { workplaceId: 'spb', date: '2026-09-20', from: '10:00', to: '18:00' },
    { workplaceId: 'spb', date: '2026-09-21', from: '12:00', to: '18:00' },
    { workplaceId: 'moscow', date: '2026-09-20', from: '09:00', to: '15:00' },
    { workplaceId: 'ekb', date: '2026-09-20', from: '10:00', to: '18:00' },
  ],
  occupancy: [
    { id: 'r1', workplaceId: 'spb', date: '2026-09-20', from: '12:00', to: '13:00' },
    { id: 'r2', workplaceId: 'moscow', date: '2026-09-20', from: '10:00', to: '11:00' },
  ],
  documents: [
    { id: 'pdn-consent', version: 2, personConsent: true, required: true },
    { id: 'messages-consent', version: 1, personConsent: true, required: false },
  ],
};

assert.deepEqual(getBookingProcedures(context, 'spb').map((item) => item.id), ['cut', 'color']);
assert.equal(bookingDuration(context, 'spb', ['cut', 'color']), 180);
assert.deepEqual(getBookingWorkingDates(context, 'spb', { fromDate: '2026-09-21' }), ['2026-09-21']);

const fixed = { id: 'fixed', cost: { from: 1, to: 9999 }, workplaces: [{ workplaceId: 'spb', cost: { from: 2, to: 9999 }, bookingPrice: { minimum: 1500, variable: false, free: false } }] };
const from = { id: 'from', cost: { amount: 1 }, workplaces: [{ workplaceId: 'spb', cost: { amount: 2 }, bookingPrice: { minimum: 1500, variable: true, free: false } }] };
const range = { id: 'range', cost: { amount: 1 }, workplaces: [{ workplaceId: 'spb', cost: { amount: 2 }, bookingPrice: { minimum: 1500, variable: true, free: false } }] };
assert.deepEqual(bookingProcedurePrice(fixed, 'spb'), { minimum: 1500, variable: false, free: false }, 'fixed ready price must stay exact');
assert.deepEqual(bookingProcedurePrice(from, 'spb'), { minimum: 1500, variable: true, free: false }, 'ready from price must stay variable');
assert.deepEqual(bookingProcedurePrice(range, 'spb'), { minimum: 1500, variable: true, free: false }, 'owner-normalized range must arrive as from semantics');
assert.equal(bookingProcedureCost(range, 'spb'), 1500, 'Booking calculations must use the ready minimum');

const modelSource = readFileSync(new URL('../online-booking/model.js', import.meta.url), 'utf8');
const procedureSource = readFileSync(new URL('../server/src/procedure/procedure.service.ts', import.meta.url), 'utf8');
assert.match(modelSource, /procedureWorkplaceAssignment\(procedure, workplaceKey\)\?\.bookingPrice/, 'Booking must consume owner-provided price semantics');
assert.doesNotMatch(modelSource, /cost\.amount|cost\.from|cost\.to|assigned\.amount|assigned\.from|assigned\.to/, 'Booking must not parse raw price shapes');
assert.match(procedureSource, /bookingPriceFor\(/, 'Procedure owner must normalize Booking price semantics');
assert.match(procedureSource, /bookingPrice: this\.bookingPriceFor\(procedure, workplaceId\)/, 'public procedure assignment must carry ready Booking price');

const slots = getBookingSlots(context, {
  workplaceKey: 'spb',
  date: '2026-09-20',
  procedureIds: ['cut', 'color'],
  step: 15,
  now: new Date('2026-09-20T05:00:00Z'),
});
assert.equal(slots.some((slot) => slot.from === '10:00'), false, 'three-hour selection must not overlap the 12:00 booking');
assert.equal(slots.some((slot) => slot.from === '13:00' && slot.to === '16:00'), true);

const sameDaySlots = getBookingSlots(context, {
  workplaceKey: 'moscow',
  date: '2026-09-20',
  procedureIds: ['other'],
  step: 15,
  now: new Date('2026-09-20T08:10:00Z'),
});
assert.equal(sameDaySlots[0]?.from, '11:15', 'same-day public booking must start at the next slot in the Workplace timezone');
assert.equal(sameDaySlots.some((slot) => slot.from === '10:00'), false, 'elapsed same-day slots must not be shown');

const futureDaySlots = getBookingSlots(context, {
  workplaceKey: 'spb',
  date: '2026-09-21',
  procedureIds: ['cut'],
  step: 15,
  now: new Date('2026-09-20T08:10:00Z'),
});
assert.equal(futureDaySlots[0]?.from, '12:00', 'future dates must still start from the working plan');

const ekbSlots = getBookingSlots(context, {
  workplaceKey: 'ekb',
  date: '2026-09-20',
  procedureIds: ['other'],
  step: 15,
  now: new Date('2026-09-20T08:10:00Z'),
});
assert.equal(ekbSlots[0]?.from, '13:15', 'the same instant must use the selected Workplace timezone, not visitor or server time');

console.log('online booking tests passed');