import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSearchUrl, extractLots, parsePrice, defaultTerm } from '../extension/prices.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('buildSearchUrl targets acsearch search with term, ancient category, currency and most-recent order', () => {
  assert.equal(buildSearchUrl({ term: ' Nero 306 ', currency: 'USD' }), 'https://www.acsearch.info/search.html?term=Nero+306&category=1&currency=usd&order=1');
  assert.equal(buildSearchUrl({ term: 'Price 23', currency: 'CHF', order: 0 }), 'https://www.acsearch.info/search.html?term=Price+23&category=1&currency=chf&order=0');
  assert.equal(buildSearchUrl({ term: 'a&b=c', currency: 'EUR' }), 'https://www.acsearch.info/search.html?term=a%26b%3Dc&category=1&currency=eur&order=1');
});

test('extractLots reads the embedded results array from a real page', () => {
  const lots = extractLots(fixture('acsearch-search-nero-306.html'));
  assert.equal(lots.length, 3);
  assert.deepEqual(Object.keys(lots[0]), ['id', 'title', 'date', 'price']);
  assert.equal(lots[0].id, '16937025');
  assert.equal(lots[0].title, 'Heritage Auctions, Auction 61635, Lot 23312');
  assert.match(lots[0].date, /^\d{2}\.\d{2}\.\d{4}$/);
  assert.ok(lots.every((lot) => lot.price === '*'));
});

test('extractLots survives "];" inside descriptions and rejects pages without the array', () => {
  const page = '<script>acsearch.initSearchResults = [{"id":1,"title":"A","description":"see [RIC 306]; nice","date":"01.02.2023","price":"1,200","last":false}]; acsearch.x=1;</script>';
  assert.deepEqual(extractLots(page), [{ id: '1', title: 'A', date: '01.02.2023', price: '1,200' }]);
  assert.equal(extractLots('<html>no results here</html>'), null);
  assert.equal(extractLots('acsearch.initSearchResults = [{broken]; '), null);
  assert.equal(extractLots(''), null);
  assert.deepEqual(extractLots('acsearch.initSearchResults = [];'), []);
});

test('parsePrice tolerates common separators and rejects non-prices', () => {
  assert.equal(parsePrice('1,200'), 1200);
  assert.equal(parsePrice("1'200"), 1200);
  assert.equal(parsePrice('1 200'), 1200);
  assert.equal(parsePrice('1200 USD'), 1200);
  assert.equal(parsePrice('$ 1,200.50'), 1200.5);
  assert.equal(parsePrice('1.200,50'), 1200.5);
  assert.equal(parsePrice('12.5'), 12.5);
  assert.equal(parsePrice('950'), 950);
  for (const bad of ['*', '', ' ', 'abc', '0', '-', null, undefined]) assert.equal(parsePrice(bad), null);
});

test('defaultTerm builds the acsearch term from the guided reference', () => {
  assert.equal(defaultTerm({ catalogue: 'RIC', section: ' Nero ', number: '306' }), 'Nero 306');
  assert.equal(defaultTerm({ catalogue: 'Price', number: ' 23 ' }), 'Price 23');
});
