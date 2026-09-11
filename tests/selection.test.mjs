import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SELECTION, selectionQuery, popupUrlFor, queryFromSearch, cardUrlFor, cardFromSearch } from '../extension/selection.js';

test('selectionQuery collapses whitespace, trims and caps at 120 characters without splitting a character', () => {
  assert.equal(selectionQuery('  RIC I²\n Nero\t306  '), 'RIC I² Nero 306');
  assert.equal(selectionQuery(''), '');
  assert.equal(selectionQuery(undefined), '');
  assert.equal(selectionQuery('x'.repeat(200)).length, MAX_SELECTION);
  assert.equal(MAX_SELECTION, 120);
  assert.equal(selectionQuery(`${'1'.repeat(119)}😀tail`), `${'1'.repeat(119)}😀`);
});

test('a selection longer than 120 characters is cut after its last whole ";" reference, never inside one', () => {
  const references = ['HGC 4, 1218', 'BCD Boiotia 174b', 'SNG Copenhagen 123', 'SNG München 456', 'Traité IV 1234', 'Jameson 1234', 'Babelon 1830', 'Rosen 567'];
  const text = `${references.join('; ')}.`;
  assert.ok(text.length > MAX_SELECTION);
  assert.equal(selectionQuery(text), references.slice(0, -1).join('; '));
  assert.equal(selectionQuery(references.slice(0, 3).join(';\n')), references.slice(0, 3).join('; '));
});

test('the pop-out names the card it shows by corpus and id, never by its title, and the window reads them back', () => {
  for (const card of [{ corpus: 'pella', id: 'price.P1' }, { corpus: 'ocre', id: 'ric.1(2).ner.306' }, { corpus: 'bigr', id: 'bigr.philoxenus.7.1' },
    { corpus: 'sco', id: 'sc.1.689.10.' }, { corpus: 'other', id: 'BCD Boiotia 174b; HGC 4, 1218 & 5+6' }]) {
    const url = cardUrlFor({ ...card, label: 'Title' });
    assert.ok(url.startsWith('popup.html?window=1&') && !url.includes('Title'), url);
    assert.deepEqual(cardFromSearch(url.slice('popup.html'.length)), card);
    assert.equal(queryFromSearch(url.slice('popup.html'.length)), '');
  }
  assert.equal(cardUrlFor({ corpus: 'pella', id: 'price.P1', label: 'Price P1' }), 'popup.html?window=1&corpus=pella&id=price.P1');
  assert.equal(cardUrlFor(null), 'popup.html?window=1');
  for (const search of ['', '?window=1', '?window=1&q=RIC%20972', '?corpus=pella', '?id=price.23', '?corpus=&id=price.23']) assert.equal(cardFromSearch(search), null, search);
});

test('popupUrlFor opens the resizable window on the cleaned selection, and on no reference when there is none', () => {
  assert.equal(popupUrlFor(' Crawford 44/5 '), 'popup.html?window=1&q=Crawford%2044%2F5');
  assert.equal(popupUrlFor('<img src=x onerror=alert(1)>'), 'popup.html?window=1&q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
  for (const nothing of ['', '  ', undefined, null]) assert.equal(popupUrlFor(nothing), 'popup.html?window=1', String(nothing));
  assert.equal(queryFromSearch(popupUrlFor('HGC 4, 1218; BCD Boiotia 174b').slice('popup.html'.length)), 'HGC 4, 1218; BCD Boiotia 174b');
});

test('queryFromSearch reads and cleans q, and is empty without it', () => {
  assert.equal(queryFromSearch('?q=SC%201266.2'), 'SC 1266.2');
  assert.equal(queryFromSearch(`?q=${encodeURIComponent('  Price   23 ')}`), 'Price 23');
  assert.equal(queryFromSearch(''), '');
  assert.equal(queryFromSearch('?other=1'), '');
});
