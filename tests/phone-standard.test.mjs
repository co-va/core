import assert from 'node:assert/strict';
import {
  formatPhone,
  normalizePhone,
  phoneInputState,
  phonesMatch,
} from '../core/phone/index.js';

assert.equal(normalizePhone('9031234567'), '+79031234567');
assert.equal(normalizePhone('79031234567'), '+79031234567');
assert.equal(normalizePhone('89031234567'), '+79031234567');
assert.equal(normalizePhone('+7 903 123-45-67'), '+79031234567');
assert.equal(normalizePhone('7 903 123 45 67'), '+79031234567');
assert.equal(formatPhone('+79031234567'), '+7 903 123-45-67');
assert.equal(phonesMatch('8 903 123-45-67', '+7 903 123-45-67'), true);

const tooLong = phoneInputState('89031234567890', 'RU');
assert.equal(tooLong.national, '9031234567');
assert.equal(tooLong.canonical, '+79031234567');

const german = phoneInputState('+49 151 23456789', 'RU');
assert.equal(german.countryIso, 'DE');
assert.equal(german.canonical, '+4915123456789');

const incomplete = phoneInputState('90312', 'RU');
assert.equal(incomplete.complete, false);
assert.equal(incomplete.canonical, '');

console.log('Core shared phone rules: PASS');
