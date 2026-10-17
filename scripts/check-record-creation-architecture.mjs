import fs from 'node:fs';

const failures = [];
const expect = (value, message) => { if (!value) failures.push(message); };
const read = (path) => fs.readFileSync(path, 'utf8');

const records = read('core/records/records.js');
const owner = read('ui/record/creation-flow.js');
const day = read('journal/день.js');
const personEntry = read('core/people/record-creation.js');
const booking = read('online-booking/access.js');

expect(!fs.existsSync('journal/record.js'), 'journal/record.js must not exist.');
expect(!fs.existsSync('journal/record-view.js'), 'journal/record-view.js must not exist.');
expect(!fs.existsSync('journal/record-creation-x.js'), 'journal/record-creation-x.js must not exist.');
expect(fs.existsSync('journal/journal-view.js'), 'Journal plaque display must live in journal/journal-view.js.');
expect(records.includes('export function openRecords'), 'core/records/records.js must own the Records flow.');
expect(owner.includes("variant: 'q'"), 'Records must use the canonical Q modal owner.');
expect(day.includes("import('../core/records/records.js')"), 'Journal Day must call canonical Records.');
expect(day.includes("import('./journal-view.js')"), 'Journal Day must open Journal View for an existing plaque.');
expect(personEntry.includes("from '../records/records.js'"), 'Person entry must call canonical Records.');
expect(booking.includes("from '../core/records/records.js'"), 'Online booking must call canonical Records.');
expect(!fs.existsSync('records/records.js'), 'Root records/records.js must not remain after Records moved into Core.');
expect(!fs.existsSync('core/records.js'), 'Core must not contain Records JS directly; Records must live in core/records/records.js.');

if (failures.length) {
  console.error('Records compatibility check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Records compatibility check passed.');
