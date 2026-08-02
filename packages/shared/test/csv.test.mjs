import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toCsv, parseCsv } from '../dist/index.js';

test('toCsv emits a header and rows in column order', () => {
  const csv = toCsv([{ name: 'Asha', phone: '900' }], ['name', 'phone']);
  assert.equal(csv, 'name,phone\nAsha,900');
});

test('toCsv quotes fields containing commas, quotes or newlines', () => {
  const csv = toCsv([{ note: 'prefers 10am, no fringe' }, { note: 'said "hi"' }], ['note']);
  assert.equal(csv, 'note\n"prefers 10am, no fringe"\n"said ""hi"""');
});

test('parseCsv round-trips quoted fields', () => {
  const original = [
    { name: 'Priya, S', note: 'said "yes"\nnext week' },
    { name: 'Ravi', note: 'plain' },
  ];
  const csv = toCsv(original, ['name', 'note']);
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed, original);
});

test('parseCsv keys by header and tolerates a trailing newline', () => {
  const rows = parseCsv('name,phone\nAsha,900\nBhavna,901\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'Asha', phone: '900' });
  assert.deepEqual(rows[1], { name: 'Bhavna', phone: '901' });
});

test('parseCsv handles CRLF line endings', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n');
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});

test('parseCsv on empty input returns no rows', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('name,phone\n'), []);
});
