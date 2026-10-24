import assert from 'node:assert/strict';
import fs from 'node:fs';

const entry = fs.readFileSync(new URL('../online-booking/user-entry.js', import.meta.url), 'utf8');
const access = fs.readFileSync(new URL('../online-booking/access.js', import.meta.url), 'utf8');

assert.match(entry, /getGlobalAccountRelationships/, 'Journal booking must source specialists from global Contacts relationships');
assert.match(entry, /openRecordCreationOwner\(\)/, 'Journal booking specialist choice must use the Shared record creation Q owner');
assert.match(entry, /title: 'Выбор специалиста'/, 'The first Journal booking step must be professional selection');
assert.match(entry, /header: field\([\s\S]*data-account-booking-professional-search/, 'Professional search must live in the Q header');
assert.match(entry, /recordPersonList\(/, 'Professional choice must use the Shared record person list');

const journalListenerStart = entry.indexOf("window.addEventListener('cova:account-journal-open-contacts'");
assert.ok(journalListenerStart >= 0, 'Journal booking event listener is required');
const journalListener = entry.slice(journalListenerStart, entry.indexOf('\n});', journalListenerStart) + 4);
assert.match(journalListener, /openAccountBookingProfessionalSelector/, 'Journal booking must open the professional selector');
assert.doesNotMatch(journalListener, /renderGlobalClientRoot\(\{ tab: 'contacts'/, 'Journal booking must not redirect to Contacts');

assert.match(entry, /params\.set\('origin', 'journal'\)/, 'Journal booking route must preserve Journal as its origin');
assert.match(entry, /route\.entry === 'account-booking' && route\.origin !== 'journal'/, 'Contact booking must preserve Contact detail beneath Shared Q while Journal booking must not replace Journal');
assert.match(entry, /content\.style\.visibility = 'hidden'/, 'Global account loading placeholder must not be exposed during account surface restoration');
assert.match(entry, /finally \{ content\.style\.visibility = '';/, 'Global account surface must become visible after restoration');

assert.match(access, /workplaces\.length === 1 \? String\(workplaces\[0\]\?\.key \|\| ''\) : ''/, 'Existing booking must keep automatic single-workplace skip');
assert.match(access, /openRecords\(\{[\s\S]*context: 'online'/, 'Existing Shared Record booking flow must remain the booking owner');

console.log('account journal booking entry: ok');