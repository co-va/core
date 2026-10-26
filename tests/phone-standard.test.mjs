import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatPhone,
  normalizePhone,
  phoneInputState,
  phonesMatch,
} from '../core/phone/index.js';
import { phoneInput } from '../ui/inputs/index.js';

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

const ruMarkup = phoneInput({ name: 'phone', value: '+79031234567' });
assert.match(ruMarkup, /<span class="ui-select__value">\+7<\/span>/, 'closed RU phone selector must show only +7');
const deMarkup = phoneInput({ name: 'phone', value: '+4915123456789' });
assert.match(deMarkup, /<span class="ui-select__value">\+49<\/span>/, 'closed international selector must show only dial prefix');
assert.match(deMarkup, /Германия \+49/, 'opened selector options must keep country name and dial prefix');

const css = readFileSync(new URL('../ui/inputs/inputs.css', import.meta.url), 'utf8');
assert.match(css, /\.phone-input\{[^}]*grid-template-columns:60px minmax\(0,1fr\)/, 'Shared phone field must reserve only a compact prefix column');
assert.doesNotMatch(css, /\.phone-input\{grid-template-columns:1fr\}/, 'Shared phone field must not stack prefix and national number on narrow screens');
assert.match(css, /@media\(max-width:360px\)[\s\S]*?\.phone-input\{grid-template-columns:60px minmax\(0,1fr\)\}/, 'Shared phone field must remain one row at <=360px');

console.log('phone standard tests passed');
