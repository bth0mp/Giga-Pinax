import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchCoinArchivesPrices, parseCoinArchivesPublic } from '../extension/coinarchives-prices.js';

const row = (id, date, price, title = `Auction, Lot ${id}`, description = '') => `<tr id="${id}"><td><a class='R' href='lotviewer.php?LotID=${id}&amp;AucID=7&amp;Lot=${id}&amp;Val=x'><div class="auctiontitle">${title}</div><span class="lottext">${description}</span></a></td><td><nobr>${date}</nobr></td><td class="price">${price}</td><td></td></tr>`;
const page = (rows, count = rows.length) => `<div class="resultsinfo"><span class="headertext">Your search for <b>'test</b>' matched ${count} lots from auctions added in the last six months.</span><br>Only the first 100 results are shown.</div><table class='results'>${rows.join('')}</table>`;
const options = { term: 'test', section: 'a', currency: 'USD', now: new Date('2026-09-15T00:00:00Z') };

test('parses only strict realized-price cells and keeps native currencies', () => {
  const result = parseCoinArchivesPublic(page([
    row('1', '1 Sep 2026', '1,000&nbsp;USD', 'One &amp; Co', 'Estimate: 99,999 USD'),
    row('2', '2 Sep 2026', '2,000&nbsp;USD'),
    row('3', '3 Sep 2026', '500&nbsp;EUR'),
  ]), options);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.availableCurrencyCounts, { EUR: 1, USD: 2 });
  assert.deepEqual(result.selectedLots.map(({ amount }) => amount), [2000, 1000]);
  assert.equal(result.summary.median, 1500);
  assert.equal(result.lots.find(({ id }) => id === '1').title, 'One & Co');
  assert.deepEqual(result.dateSpan, { earliest: '2026-09-01', latest: '2026-09-03' });
});

test('summarises an exact native currency even when the shared acsearch parser has no symbol for it', () => {
  const result = parseCoinArchivesPublic(page([
    row('1', '1 Sep 2026', '725&nbsp;AUD'),
    row('2', '2 Sep 2026', '2,400&nbsp;AUD'),
  ]), { ...options, currency: 'AUD' });
  assert.equal(result.summary.count, 2);
  assert.equal(result.summary.median, 1562.5);
  assert.equal(result.summary.priced[0].currency, 'AUD');
});

test('classifies incomplete and malformed rows without using descriptions', () => {
  const result = parseCoinArchivesPublic(page([
    row('1', '20 Sep 2026', 'Upcoming<br>Auction&nbsp;'),
    row('2', '12 Sep 2026', 'To Be<br>Posted&nbsp;'),
    row('3', '11 Sep 2026', '-'),
    row('4', '10 Sep 2026', 'USD 500'),
    row('5', '31 Feb 2026', '500&nbsp;USD'),
    row('6', '16 Sep 2026', '500&nbsp;USD'),
  ]), options);
  assert.equal(result.status, 'unpriced');
  assert.deepEqual(result.excluded, { upcoming: 1, toBePosted: 1, unpriced: 1, malformedPrice: 1, malformedDate: 1, futureDate: 1, duplicateId: 0, conflictingId: 0 });
});

test('fails closed for closest matches and result-count layout drift', () => {
  assert.equal(parseCoinArchivesPublic('<p>Closest matches</p>', options).status, 'closest');
  assert.equal(parseCoinArchivesPublic(page([row('1', '1 Sep 2026', '10&nbsp;USD')], 2), options).status, 'layout');
});

test('does not attribute a different displayed query to the requested term', () => {
  const html = page([row('1', '1 Sep 2026', '10&nbsp;USD')]).replace("<b>'test</b>", "<b>'nearby result</b>");
  assert.equal(parseCoinArchivesPublic(html, options).status, 'closest');
});

test('quarantines duplicate and conflicting lot identifiers', () => {
  const same = row('1', '1 Sep 2026', '10&nbsp;USD');
  const result = parseCoinArchivesPublic(page([same, same, row('2', '2 Sep 2026', '20&nbsp;USD'), row('2', '3 Sep 2026', '30&nbsp;USD'), row('3', '4 Sep 2026', '40&nbsp;USD'), row('3', '4 Sep 2026', 'To Be<br>Posted&nbsp;')]), options);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.lots.map(({ id }) => id), ['1']);
  assert.equal(result.excluded.duplicateId, 1);
  assert.equal(result.excluded.conflictingId, 4);
});

test('rejects zero and unsafe realized amounts before selecting lots', () => {
  const result = parseCoinArchivesPublic(page([
    row('1', '1 Sep 2026', '0&nbsp;USD'),
    row('2', '2 Sep 2026', '9,007,199,254,740,993&nbsp;USD'),
  ]), options);
  assert.equal(result.status, 'unpriced');
  assert.equal(result.excluded.malformedPrice, 2);
  assert.equal(result.lots.length, 0);
});

test('fetches one bounded public page without credentials or redirects', async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.match(url, /^https:\/\/www\.coinarchives\.com\/a\/results\.php\?/);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    return new Response(page([row('1', '1 Sep 2026', '10&nbsp;USD')]), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const result = await fetchCoinArchivesPrices({ term: 'test', section: 'a', currency: 'USD' }, { fetchImpl, now: options.now });
  assert.equal(calls, 1);
  assert.equal(result.status, 'ok');
});

test('rejects oversized and off-origin responses', async () => {
  const oversized = await fetchCoinArchivesPrices({ term: 'x', section: 'a', currency: 'USD' }, { fetchImpl: async () => new Response('x', { headers: { 'content-length': '9999999', 'content-type': 'text/html' } }) });
  assert.equal(oversized.status, 'network');
  assert.equal(oversized.reason, 'too-large');
  const redirected = await fetchCoinArchivesPrices({ term: 'x', section: 'a', currency: 'USD' }, { fetchImpl: async () => ({ ok: true, status: 200, url: 'https://evil.example/a/results.php', headers: new Headers(), text: async () => page([]) }) });
  assert.equal(redirected.reason, 'redirect');
});

test('cancels a response stream as soon as its body exceeds the byte limit', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  });
  const response = new Response(body, { headers: { 'content-type': 'text/html' } });
  const result = await fetchCoinArchivesPrices({ term: 'x', section: 'a', currency: 'USD' }, { fetchImpl: async () => response, maxBytes: 4 });
  assert.equal(result.reason, 'too-large');
  assert.equal(cancelled, true);
});
