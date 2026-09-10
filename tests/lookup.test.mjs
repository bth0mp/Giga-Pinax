import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuery, parseFeed, pickMatch } from '../extension/lookup.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('buildQuery targets the right corpus and normalises ordinal editions', () => {
  assert.deepEqual(buildQuery({ catalogue: 'Price', number: ' 23 ' }), { corpus: 'pella', query: 'Price 23' });
  assert.deepEqual(
    buildQuery({ catalogue: 'RIC', volume: 'I (2nd edition)', section: ' Nero', number: '306' }),
    { corpus: 'ocre', query: 'RIC I (second edition) Nero 306' },
  );
  assert.equal(buildQuery({ catalogue: 'RIC', volume: 'II', section: 'Hadrian', number: '  12a ' }).query, 'RIC II Hadrian 12a');
  assert.equal(buildQuery({ catalogue: 'RIC', volume: 'I (1st edition)', section: 'Nero', number: '1' }).query, 'RIC I (first edition) Nero 1');
});

test('parseFeed lists entry ids and titles from real Atom feeds', () => {
  assert.deepEqual(parseFeed(fixture('ocre-search-nero-306.xml')), [
    { id: 'ric.1(2).ner.306', title: 'RIC I (second edition) Nero 306' },
  ]);
  assert.deepEqual(parseFeed(fixture('pella-search-price-23.xml')).map((entry) => entry.id), ['price.1655', 'price.23']);
  assert.deepEqual(parseFeed('<feed><entry><title>A &amp; B</title><id>x</id></entry></feed>'), [{ id: 'x', title: 'A & B' }]);
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('<feed><entry><title>no id</title></entry></feed>'), []);
});

test('pickMatch prefers the exact title regardless of rank, else offers up to five candidates', () => {
  const pella = parseFeed(fixture('pella-search-price-23.xml'));
  assert.equal(pickMatch(pella, 'price 23').entry.id, 'price.23');
  assert.equal(pickMatch(pella, '  Price   23 ').status, 'ok');
  const near = [{ id: 'a', title: 'RIC II Hadrian 12a' }, { id: 'b', title: 'RIC II Hadrian 12b' }];
  assert.deepEqual(pickMatch(near, 'RIC II Hadrian 12'), { status: 'candidates', candidates: near });
  assert.deepEqual(pickMatch([], 'RIC II Hadrian 12'), { status: 'none' });
  const many = Array.from({ length: 6 }, (_, index) => ({ id: String(index), title: `T ${index}` }));
  assert.deepEqual(pickMatch(many, 'nothing'), { status: 'none' });
});
