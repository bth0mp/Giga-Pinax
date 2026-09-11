import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SELECTION, selectionQuery, popupUrlFor, queryFromSearch } from '../extension/selection.js';

test('selectionQuery collapses whitespace, trims and caps at 120 characters without splitting a character', () => {
  assert.equal(selectionQuery('  RIC I²\n Nero\t306  '), 'RIC I² Nero 306');
  assert.equal(selectionQuery(''), '');
  assert.equal(selectionQuery(undefined), '');
  assert.equal(selectionQuery('x'.repeat(200)).length, MAX_SELECTION);
  assert.equal(MAX_SELECTION, 120);
  assert.equal(selectionQuery(`${'1'.repeat(119)}😀tail`), `${'1'.repeat(119)}😀`);
});

test('popupUrlFor encodes the cleaned selection into the popup query', () => {
  assert.equal(popupUrlFor(' Crawford 44/5 '), 'popup.html?q=Crawford%2044%2F5');
  assert.equal(popupUrlFor('<img src=x onerror=alert(1)>'), 'popup.html?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
});

test('queryFromSearch reads and cleans q, and is empty without it', () => {
  assert.equal(queryFromSearch('?q=SC%201266.2'), 'SC 1266.2');
  assert.equal(queryFromSearch(`?q=${encodeURIComponent('  Price   23 ')}`), 'Price 23');
  assert.equal(queryFromSearch(''), '');
  assert.equal(queryFromSearch('?other=1'), '');
});
