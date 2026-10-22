import assert from 'node:assert/strict';
import fs from 'node:fs';

const day = fs.readFileSync('journal/день.js', 'utf8');
const rerenderStart = day.indexOf('const rerender = () => {');
assert.ok(rerenderStart >= 0, 'Journal Day rerender callback is missing');
const rerenderEnd = day.indexOf('\n  };', rerenderStart);
assert.ok(rerenderEnd > rerenderStart, 'Journal Day rerender callback is malformed');
const rerender = day.slice(rerenderStart, rerenderEnd);
const disposeIndex = rerender.indexOf('dispose();');
const renderIndex = rerender.indexOf('renderJournalDay(root');
assert.ok(disposeIndex >= 0, 'Journal Day rerender must dispose its live-time timer');
assert.ok(renderIndex > disposeIndex, 'Journal Day must dispose the live-time timer before rerendering');

console.log('Note / Y rerender lifecycle regression passed.');
