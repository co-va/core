import assert from 'node:assert/strict';
import { dataTable, sortedTableRows } from '../ui/page/page.js';
const rows = [{ reason: 'Телефон', value: '<script>' }, { reason: 'Дата', value: 2 }];
assert.equal(sortedTableRows(rows, 'reason')[0].reason, 'Дата');
assert.equal(sortedTableRows(rows, 'reason', true)[0].reason, 'Телефон');
assert.equal(rows[0].reason, 'Телефон');
const html = dataTable({ columns: [{ key: 'reason', label: 'Причина' }, { key: 'value', label: 'Значение' }], rows, caption: 'Ошибки', sortKey: 'reason' });
assert.match(html, /scope="col"/); assert.match(html, /Причина/); assert.match(html, /aria-sort="ascending"/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
console.log('Shared data table: OK');
