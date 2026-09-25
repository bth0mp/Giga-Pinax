import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACSEARCH_MAX_BYTES, buildSearchUrl, citationPhrases, citesReference, extractLots, filterableDenomination, filtersCitations, GRADE_BUCKETS, gradeMedians, gradeOf, gradeText, namesDenomination, parsePrice, defaultTerm, referenceName, searchesReference, signedOutPage, coinArchivesTerm, coinArchivesSection, futureText, coinArchivesUrl, searchCategory, summarise, fetchPrices, summaryText, greekName, chooseTerm, priceCheck, saleDate, PERIODS, lotsInPeriod, localDay, trendOf, lastSale, trendText, createPriceCuration, stableResultId, pricePanelVisibility, ungradedText, upcomingLots, upcomingText, isoDay, mediansByYear, yearText, yearsSentence } from '../extension/prices.js';
import { BIGR_KINGS } from '../extension/catalogues.js';
import { formatMoney, minorDigits } from '../extension/core/money.js';
import { readFileSync as readSource } from 'node:fs';

// An amount as Copy summary writes it: the one money rule (formatMoney, the narrow sign, whole units as the panel rounds them), its no-break spaces
// plain, as the copy's are.
const copied = (units, currency = 'USD', locale = 'en-US') => formatMoney({ currency, minor: units * 10 ** minorDigits(currency) }, locale,
  { narrow: true, whole: true }).replace(/[  ]/g, ' ');

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('session curation uses stable IDs and one included set for every statistic', () => {
  const lots = [
    { id: 9, title: 'A', date: '2026-01-01', price: '100' },
    { title: 'B', date: '2025-01-01', price: '300' },
    { title: 'C', date: '2024-01-01', price: '-' },
  ];
  // The provider is the caller's to name: the public CoinArchives rows are curated too, and an "acsearch:" prefix on them stopped being true.
  assert.equal(stableResultId(lots[0], 'acsearch'), 'acsearch:9');
  assert.equal(stableResultId(lots[0], 'coinarchives'), 'coinarchives:9');
  assert.equal(stableResultId(lots[1], 'acsearch'), stableResultId({ ...lots[1] }, 'acsearch'));
  assert.notEqual(stableResultId(lots[1], 'acsearch'), stableResultId(lots[1], 'coinarchives'));
  const curation = createPriceCuration('acsearch');
  curation.exclude(lots[1]);
  assert.deepEqual(curation.counts(lots), { included: 2, excluded: 1 });
  assert.equal(summarise(curation.included(lots), 'USD').median, 100);
  curation.reset();
  assert.deepEqual(curation.counts(lots), { included: 3, excluded: 0 });
});

test('every curation redraw recalculates the entered price comparison', () => {
  const source = readSource(new URL('../extension/popup.js', import.meta.url), 'utf8');
  const render = source.slice(source.indexOf('function renderPrices('), source.indexOf('// Checked against the sales shown'));
  assert.match(render, /shownPrices\s*=.*\n\s*showCheck\(\);/s);
});

test('all-excluded render hides statistics but keeps Inspect sales and Reset reachable', () => {
  const lots = ['100', '200', '300', '1000'].map((price, id) => ({ id, price }));
  const curation = createPriceCuration();
  lots.forEach((lot) => curation.exclude(lot));
  const included = curation.included(lots);
  assert.deepEqual(pricePanelVisibility(summarise(included, 'USD').count, summarise(lots, 'USD').count), {
    statistics: false, curation: true,
  });
  curation.reset();
  assert.equal(summarise(curation.included(lots), 'USD').count, 4);
});

test('buildSearchUrl targets acsearch search with term, ancient category, currency and most-recent order', () => {
  assert.equal(buildSearchUrl({ term: ' Nero 306 ', currency: 'USD' }), 'https://www.acsearch.info/search.html?term=Nero+306&category=1&currency=usd&order=1');
  assert.equal(buildSearchUrl({ term: 'Price 23', currency: 'CHF', order: 0 }), 'https://www.acsearch.info/search.html?term=Price+23&category=1&currency=chf&order=0');
  assert.equal(buildSearchUrl({ term: 'a&b=c', currency: 'EUR' }), 'https://www.acsearch.info/search.html?term=a%26b%3Dc&category=1&currency=eur&order=1');
});

test('extractLots reads the embedded results array from a whole page', () => {
  const lots = extractLots(fixture('acsearch-search-nero-306.html'));
  assert.equal(lots.length, 5);
  assert.deepEqual(Object.keys(lots[0]), ['id', 'title', 'date', 'price', 'description']);
  assert.equal(lots[0].id, '90010001');
  assert.equal(lots[0].title, 'Fabricius Numismatics, Auction 4, Lot 11');
  assert.match(lots[0].date, /^\d{2}\.\d{2}\.\d{4}$/);
  assert.ok(lots.every((lot) => lot.price === '*'));
  // A "];" inside a description must not truncate the array.
  assert.match(lots[1].description, /\[RIC I, 306\];/);
});

// What the panel would make of the whole page: the rows a search for Nero "RIC 306" brings back, read by the two filters a median rests on.
test('the fixture page reads as two citations of another type, and the grades the dealers wrote', () => {
  const lots = extractLots(fixture('acsearch-search-nero-306.html'));
  const nero = { catalogue: 'RIC', section: 'Nero', number: '306', volume: 'I (2nd edition)' };
  assert.deepEqual(lots.map((entry) => citesReference(entry.description, nero)), [true, true, false, false, true]);
  assert.deepEqual(lots.map((entry) => gradeOf(entry.description)), ['VF', 'VF', 'VF', 'EF', 'AU/Mint State']);
});

// A page is untrusted text off the network. 0.32 tried each "];" in turn and parsed the whole slice again at every one, so a description of two
// megabytes with its terminators at the end took seconds on the popup's own thread. The array's end is found in one pass that reads strings as
// JSON writes them, and the slice is parsed once: a page of nothing but terminators inside a string is simply a lot whose text is terminators.
const countingParses = (read) => {
  const parse = JSON.parse;
  let parses = 0;
  JSON.parse = (...args) => { parses += 1; return parse(...args); };
  try { return { result: read(), parses }; } finally { JSON.parse = parse; }
};
test('a page made of nothing but array terminators is read in one pass and parsed once', () => {
  const terminators = (bytes) => `acsearch.initSearchResults = [{"id":"${'];'.repeat(bytes / 2 - 20)}"}];`;
  for (const bytes of [64 * 1024, 512 * 1024, 2 * 1024 * 1024]) {
    const started = performance.now();
    const { result, parses } = countingParses(() => extractLots(terminators(bytes)));
    const spent = performance.now() - started;
    assert.equal(result?.length, 1, `${bytes} bytes`);
    assert.equal(parses, 1);
    assert.ok(spent < 2000, `${bytes} bytes of terminators took ${spent.toFixed(0)} ms`);
  }
  // The worst shape for the old reader: one description nearly the whole slice, its terminators at the very end.
  const late = `acsearch.initSearchResults = [{"id":"1","description":"${'x'.repeat(2 * 1024 * 1024 - 4200)}${'];'.repeat(1999)}"}];`;
  const started = performance.now();
  const { result, parses } = countingParses(() => extractLots(late));
  assert.equal(result?.length, 1);
  assert.equal(parses, 1);
  assert.ok(performance.now() - started < 1000, 'the worst shape is read promptly');
  // Escapes are honoured: an escaped quote does not end the string, and an escaped backslash does not escape the quote after it.
  assert.deepEqual(extractLots('acsearch.initSearchResults = [{"id":"a\\"]","title":"b\\\\"}, {"id":"c"}];').map((entry) => entry.id), ['a"]', 'c']);
  // An array that never closes inside the bytes read is no page at all, and costs one pass to find out.
  assert.equal(extractLots(`acsearch.initSearchResults = [{"id":"${'];'.repeat(1024 * 1024)}`), null);
  assert.equal(extractLots('acsearch.initSearchResults = {"id":1};'), null);
  // A page with more results text than any reply carries is read up to the bound and no further.
  const beyond = performance.now();
  assert.equal(extractLots(`${' '.repeat(4 * 1024 * 1024)}acsearch.initSearchResults = [];`), null);
  assert.ok(performance.now() - beyond < 1000);
  // The handful a real page's descriptions carry is still read through.
  const inside = `acsearch.initSearchResults = [{"id":"1","title":"${'see [RIC 306]; '.repeat(20)}"}];`;
  assert.equal(extractLots(inside)?.length, 1);
});

// A full result page is a hundred lots, and a dealer who writes "[RIC 306]; " three times in a description puts three
// hundred terminators in front of the array's own. The limit has to be out of a real page's reach, not merely above the
// handful the fixtures carry, or a page the parser used to read comes back as no prices at all.
test('a full page of descriptions that each carry terminators is still read', () => {
  const lots = Array.from({ length: 100 }, (unused, index) => ({
    id: String(index + 1), title: `Lot ${index + 1}`, date: '01.02.2023', price: '1,200',
    description: `Nero, RIC 306. Cf. [RIC 305]; [RIC 306]; [RIC 307]; ${'x'.repeat(400)}`,
  }));
  const page = `<script>acsearch.initSearchResults = ${JSON.stringify(lots)}; acsearch.x=1;</script>`;
  const started = performance.now();
  const parsed = extractLots(page);
  assert.equal(parsed?.length, 100);
  assert.equal(parsed[99].description.includes('[RIC 307];'), true);
  assert.ok(performance.now() - started < 1000, 'and read promptly');
});

test('extractLots survives "];" inside descriptions and rejects pages without the array', () => {
  const page = '<script>acsearch.initSearchResults = [{"id":1,"title":"A","description":"see [RIC 306]; nice","date":"01.02.2023","price":"1,200","last":false}]; acsearch.x=1;</script>';
  assert.deepEqual(extractLots(page), [{ id: '1', title: 'A', date: '01.02.2023', price: '1,200', description: 'see [RIC 306]; nice' }]);
  assert.equal(extractLots('<html>no results here</html>'), null);
  assert.equal(extractLots('acsearch.initSearchResults = [{broken]; '), null);
  assert.equal(extractLots(''), null);
  assert.deepEqual(extractLots('acsearch.initSearchResults = [];'), []);
});

test('parsePrice accepts exactly one amount in common separator styles and fails closed on anything else', () => {
  assert.equal(parsePrice('1,200'), 1200);
  assert.equal(parsePrice("1'200"), 1200);
  assert.equal(parsePrice('1 200'), 1200);
  assert.equal(parsePrice('1200 USD'), 1200);
  assert.equal(parsePrice('$ 1,200.50'), 1200.5);
  assert.equal(parsePrice('1.200,50'), 1200.5);
  assert.equal(parsePrice('12.5'), 12.5);
  assert.equal(parsePrice('950'), 950);
  for (const bad of ['*', '', ' ', 'abc', '0', '-', null, undefined]) assert.equal(parsePrice(bad), null);
  for (const bad of ['200 USD (estimate 150 USD)', 'Hammer: 200 USD, estimate 150 USD', '3000 CHF (3300 USD)', '-5', '1,2345']) {
    assert.equal(parsePrice(bad), null, bad);
  }
  assert.equal(parsePrice('200 EUR', 'EUR'), 200);
  assert.equal(parsePrice('200 EUR', 'USD'), null);
  assert.equal(parsePrice('1,200', 'USD'), 1200);
});

test('parsePrice never joins two numbers: marks only at the ends, one separator throughout, distinct decimal separator', () => {
  const valid = [
    ['1,200', 1200], ["1'200", 1200], ['1 200', 1200], ['1\u00a0200', 1200], ['1\u202f200', 1200],
    ['12,345.67', 12345.67], ['1.234.567', 1234567], ['1.200,50', 1200.5], ['$ 1,200.50', 1200.5],
    ['12.5', 12.5], ['950', 950], ['1200 USD', 1200], ['US$ 900', 900],
  ];
  for (const [text, value] of valid) assert.equal(parsePrice(text), value, text);
  assert.equal(parsePrice('Fr. 450', 'CHF'), 450);
  assert.equal(parsePrice('450 CHF', 'CHF'), 450);
  assert.equal(parsePrice('€1.250', 'EUR'), 1250);
  assert.equal(parsePrice('£ 700', 'GBP'), 700);
  for (const bad of ['$200 $150', '200$ 150$', '€200 €150', '1,200 500', '1.200.50', '1,2345', '-5',
    '200 USD (estimate 150 USD)', '3000 CHF (3300 USD)', '1,200,50']) {
    assert.equal(parsePrice(bad), null, bad);
  }
  assert.equal(parsePrice('€200 €150', 'EUR'), null);
  assert.equal(parsePrice('1200EUR', 'USD'), null);
});

test('defaultTerm builds the acsearch term from the guided reference', () => {
  assert.equal(defaultTerm({ catalogue: 'RIC', section: ' Nero ', number: '306' }), 'Nero "RIC 306"');
  assert.equal(defaultTerm({ catalogue: 'Price', number: ' 23 ' }), '"Price 23"');
  // OCRE's split-section parenthetical would make acsearch require "East", "Caesar"… that dealers rarely write; the number's own stays, outside the
  // phrase, as the word OCRE tells two types apart by.
  assert.equal(defaultTerm({ catalogue: 'RIC', section: 'Leo I (East)', number: '605' }), 'Leo I "RIC 605"');
  assert.equal(defaultTerm({ catalogue: 'RIC', section: 'Gallienus (joint reign)', number: '123' }), 'Gallienus "RIC 123"');
  assert.equal(defaultTerm({ catalogue: 'RIC', section: 'Septimius Severus', number: '266 (aureus)' }), 'Septimius Severus aureus "RIC 266"');
});

// 0.32: a bare "Price 23" matched every lot holding the words, so "Price 3014" and "4.23 g" were medianed as this type's sales. Every typed catalogue
// reference is now the exact phrases dealers cite it with, offered either-or as Bop, Sear Greek and Krause already were.
test('a typed catalogue reference searches as the exact phrases dealers cite it with', () => {
  assert.equal(defaultTerm({ catalogue: 'Price', number: 'Price 23' }), '"Price 23"');
  assert.equal(defaultTerm({ catalogue: 'SC', number: 'SC 1266.2' }), '("SC 1266.2" "Seleucid Coins 1266.2")');
  assert.equal(defaultTerm({ catalogue: 'RRC', number: ' 44/5 ' }), '("Crawford 44/5" "Cr. 44/5" "RRC 44/5")');
  // The number must sit next to a RIC key; the volume numeral goes inside the phrases without its edition mark, since dealers cite "RIC I", not "RIC I²".
  assert.equal(defaultTerm({ catalogue: 'RIC', section: 'Nero', number: '306', volume: 'I (2nd edition)' }), 'Nero ("RIC 306" "RIC I 306" "RIC I, 306")');
  assert.equal(defaultTerm({ catalogue: 'RIC', section: 'Titus', number: '123', volume: 'II, Part 1 (2nd edition)' }), 'Titus ("RIC 123" "RIC II 123" "RIC II, 123")');
  assert.equal(defaultTerm({ catalogue: 'RIC', section: '', number: '287', volume: 'VII', rulers: ['Constantine II'] }), 'Constantine II ("RIC 287" "RIC VII 287" "RIC VII, 287")');
  assert.equal(defaultTerm({ catalogue: 'RIC', section: 'Nero', number: '306', volume: '' }), 'Nero "RIC 306"');
});

const lot = (price, date = '01.01.2024', id = '1', description = '') => ({ id, title: `Lot ${id}`, date, price, description });

test('summarise computes median and interpolated quartiles over priced lots only', () => {
  const amounts = [90, 110, 135, 165, 180, 215, 245, 310, 450];
  const lots = [
    ...amounts.map((amount, index) => lot(String(amount), `01.0${index + 1}.${2019 + (index % 3)}`, String(index))),
    lot('*', '01.01.2020', 'x'),
    lot('', '01.01.2021', 'y'),
  ];
  const summary = summarise(lots);
  assert.equal(summary.total, 11);
  assert.equal(summary.count, 9);
  assert.equal(summary.median, 180);
  assert.equal(summary.lowerQuartile, 135);
  assert.equal(summary.upperQuartile, 245);
  assert.equal(summary.min, 90);
  assert.equal(summary.max, 450);
  assert.equal(summary.earliest, 2019);
  assert.equal(summary.latest, 2021);
  assert.equal(summary.capped, false);
  assert.deepEqual(summary.priced.map((entry) => entry.amount).slice(0, 3), [90, 110, 135]);
});

test('summarise handles one, two and a hundred lots, and counts no hidden price', () => {
  const one = summarise([lot('500')]);
  assert.deepEqual([one.median, one.lowerQuartile, one.upperQuartile, one.min, one.max], [500, 500, 500, 500, 500]);
  const two = summarise([lot('100'), lot('300')]);
  assert.deepEqual([two.median, two.lowerQuartile, two.upperQuartile], [200, 150, 250]);
  const hundred = summarise(Array.from({ length: 100 }, (_, index) => lot(String(index + 1), '01.01.2024', String(index))));
  assert.equal(hundred.count, 100);
  assert.equal(hundred.median, 50.5);
  assert.equal(hundred.capped, true);
  const out = summarise([lot('*'), lot('*')]);
  assert.equal(out.count, 0);
  assert.equal(out.median, null);
  const unsold = summarise([lot(''), lot('-')]);
  assert.equal(unsold.count, 0);
  const empty = summarise([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.earliest, null);
});

test('summarise reads the year from either date style', () => {
  const summary = summarise([lot('500', '2024-05-01'), lot('600', '28.07.2026 14:00')]);
  assert.equal(summary.earliest, 2024);
  assert.equal(summary.latest, 2026);
});

function fakeFetch(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  // A real Response, whose body is a stream: fetchPrices reads it through a byte bound, never whole.
  const impl = async (url, init) => { calls.push({ url, init }); return new Response(body, { status: ok ? 200 : status }); };
  impl.calls = calls;
  return impl;
}

// 0.33 review (S3): the reply is untrusted and was read whole before a byte of it was looked at. It is read through a bound now, and a reply past it
// is cut off as soon as the bound is passed and said to be too large, not reported as a connection that failed.
test('fetchPrices stops reading a reply past its byte bound', async () => {
  let cancelled = false;
  const endless = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(64 * 1024).fill(32)); }, cancel() { cancelled = true; } });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: async () => new Response(endless) }), { status: 'network', reason: 'too-large' });
  assert.equal(cancelled, true);
  const declared = new Response('x', { headers: { 'content-length': String(ACSEARCH_MAX_BYTES + 1) } });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: async () => declared }), { status: 'network', reason: 'too-large' });
  assert.ok(ACSEARCH_MAX_BYTES >= 2 * 1024 * 1024 && ACSEARCH_MAX_BYTES <= 4 * 1024 * 1024);
  // A page that is not valid UTF-8 is read as the browser reads it, as it always was.
  const bytes = new Uint8Array([...new TextEncoder().encode('<script>acsearch.initSearchResults = [];</script>'), 0xff]);
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: async () => new Response(bytes) }), { status: 'empty', term: 'q' });
});

test('fetchPrices sends credentials to acsearch and classifies outcomes', { timeout: 5000 }, async () => {
  const signedOut = fakeFetch(fixture('acsearch-search-nero-306.html'));
  // The page's lots come back with every outcome that has any, so the lots not sold yet can still be listed as upcoming.
  const hidden = await fetchPrices({ term: 'Nero 306', currency: 'USD' }, { fetchImpl: signedOut });
  assert.equal(hidden.status, 'signed-out');
  assert.equal(hidden.lots.length, 5);
  assert.equal(signedOut.calls.length, 1);
  assert.equal(signedOut.calls[0].init.cache, 'no-store');
  assert.equal(signedOut.calls[0].url, 'https://www.acsearch.info/search.html?term=Nero+306&category=1&currency=usd&order=1');
  assert.equal(signedOut.calls[0].init.credentials, 'include');
  assert.ok(signedOut.calls[0].init.signal instanceof AbortSignal);

  const page = (lots) => `<script>acsearch.initSearchResults = ${JSON.stringify(lots)};</script>`;
  const ok = await fetchPrices({ term: 'Nero 306', currency: 'EUR' }, { fetchImpl: fakeFetch(page([lot('100'), lot('300'), lot('*')])) });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.summary.median, 200);
  assert.equal(ok.summary.total, 3);
  // The page's lots come back too, for the popup to draw a period from without another request, each carrying the grade read once here.
  assert.deepEqual(ok.lots, [lot('100'), lot('300'), lot('*')].map((entry) => ({ ...entry, grade: null })));
  const many = await fetchPrices({ term: 'Nero', currency: 'USD' }, { fetchImpl: fakeFetch(page(Array.from({ length: 150 }, (_, index) => lot(String(index + 1), '01.01.2024', String(index))))) });
  assert.equal(many.summary.priced.length, 100);
  assert.equal(many.summary.capped, true);
  assert.equal(many.lots.length, 100);
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot('200 EUR'), lot('300 EUR')])) }), { status: 'unpriced', term: 'q', examples: ['200 EUR', '300 EUR'], lots: [lot('200 EUR'), lot('300 EUR')].map((entry) => ({ ...entry, grade: null })) });
  assert.deepEqual(await fetchPrices({ term: 'zzz', currency: 'USD' }, { fetchImpl: fakeFetch(page([])) }), { status: 'empty', term: 'zzz' });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot(''), lot('-')])) }), { status: 'unpriced', term: 'q', lots: [lot(''), lot('-')].map((entry) => ({ ...entry, grade: null })) });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch('<html>changed</html>') }), { status: 'network' });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch('', { ok: false, status: 503 }) }), { status: 'network' });
  // Node's AbortSignal.timeout keeps no timer of its own alive, so the pending one here holds the event loop until it fires.
  const hang = (url, { signal }) => new Promise((resolve, reject) => {
    const alive = setTimeout(resolve, 1000);
    signal.addEventListener('abort', () => { clearTimeout(alive); reject(new Error('aborted')); });
  });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: hang, timeoutMs: 20 }), { status: 'network' });
});

// 0.32: "no counted price plus a star" also describes a signed-in collector whose only hits are lots not yet sold, and he was told to sign in again.
test('a signed-out session is what the page says, with the stars only as a fallback', async () => {
  const shell = (lots, header = '') => `<html><nav>${header}</nav><script>acsearch.initSearchResults = ${JSON.stringify(lots)};</script></html>`;
  const login = '<li><a href="login.html"><span>Log in</span></a></li>';
  const hidden = [lot('*', '01.01.2024', 'a'), lot('*', '01.02.2024', 'b')];
  const outcome = async (html) => (await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(html), now: NOW })).status;
  assert.equal(await outcome(shell(hidden, login)), 'signed-out');
  assert.equal(await outcome(fixture('acsearch-search-nero-306.html')), 'signed-out');
  // No marker: the stars still read as hidden prices, but only while every lot has already been sold.
  assert.equal(await outcome(shell(hidden)), 'signed-out');
  assert.equal(await outcome(shell([...hidden, lot('*', '01.06.2028', 'c')])), 'unpriced');
  assert.equal(await outcome(shell([...hidden, lot('*', 'n/a', 'c')])), 'unpriced');
  // Lots nobody bid on are not hidden prices, with or without the marker.
  assert.equal(await outcome(shell([lot('-', '01.01.2024', 'a'), lot('', '01.02.2024', 'b')], login)), 'unpriced');
});

test('defaultTerm leads on Crawford wording for RRC, which acsearch lists far more often', () => {
  assert.equal(defaultTerm({ catalogue: 'RRC', number: ' 44/5 ' }).startsWith('("Crawford 44/5"'), true);
});

test('defaultTerm ignores a typed catalogue prefix', () => {
  assert.equal(defaultTerm({ catalogue: 'RRC', number: 'RRC 44/5' }), '("Crawford 44/5" "Cr. 44/5" "RRC 44/5")');
  assert.equal(defaultTerm({ catalogue: 'RRC', number: 'Cr. 44/5' }), '("Crawford 44/5" "Cr. 44/5" "RRC 44/5")');
  assert.equal(defaultTerm({ catalogue: 'Price', number: 'Price 23' }), '"Price 23"');
});

// A catalogue name the table does not hold is Price's search, name and all: the fallback picks the whole Price row, so the typed prefix it strips is
// Price's too and nothing doubles it. Every function the term feeds reads the same one reference.
test('a catalogue outside the table searches as Price does, prefix and all', () => {
  const reference = { catalogue: 'price', number: 'Price 23' };
  assert.equal(defaultTerm(reference), '"Price 23"');
  assert.deepEqual(citationPhrases(reference), ['Price 23']);
  assert.equal(referenceName(reference), 'Price 23');
  assert.equal(coinArchivesTerm(reference), '"Price 23"');
  assert.equal(chooseTerm(reference, ''), '"Price 23"');
  assert.equal(searchesReference('"Price 23"', reference), true);
  assert.equal(searchesReference('"Price 230"', reference), false);
  for (const catalogue of [['RIC'], 'constructor', '__proto__', null, 23]) {
    assert.equal(defaultTerm({ catalogue, number: 'Price 23' }), '"Price 23"', JSON.stringify(catalogue) ?? String(catalogue));
  }
});

test('summarise lists up to five raw prices it could not count, skipping blanks, * and digit-free markers', () => {
  const lots = [lot('100'), lot(''), lot('*'), lot('-'), lot('1.200,- €'), lot('3000 CHF (3300 USD)'), lot('abc'), lot('x1'), lot('x2'), lot('x3'), lot('x4')];
  assert.deepEqual(summarise(lots, 'USD').uncounted, ['1.200,- €', '3000 CHF (3300 USD)', 'x1', 'x2', 'x3']);
  assert.deepEqual(summarise([lot('100'), lot('')], 'USD').uncounted, []);
});

test('fetchPrices quotes unrecognised prices only when there are some', async () => {
  const page = (lots) => `<script>acsearch.initSearchResults = ${JSON.stringify(lots)};</script>`;
  const bare = ({ lots, ...outcome }) => outcome;
  assert.deepEqual(bare(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot('1.200,- €'), lot('')])) })), { status: 'unpriced', term: 'q', examples: ['1.200,- €'] });
  assert.deepEqual(bare(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot(''), lot('-')])) })), { status: 'unpriced', term: 'q' });
});

test('summaryText produces a shareable plain-text summary', () => {
  const amounts = ['90', '110', '135', '165', '180', '215', '245', '310', '450'];
  const summary = summarise(amounts.map((price, i) => lot(price, `01.01.${2020 + (i % 4)}`, String(i))).concat([lot('1.200,- €')]), 'USD');
  assert.equal(summaryText({ label: 'Price 23', corpus: 'pella', id: 'price.23' }, summary, 'USD', 'Price 23'), [
    'Price 23',
    `Median hammer ${copied(180)} · middle 50% ${copied(135)}–${copied(245)} · range ${copied(90)}–${copied(450)} · 9 recorded sales matching “Price 23” · 2020–2023`,
    'Not counted: “1.200,- €”',
    'https://numismatics.org/pella/id/price.23',
  ].join('\n'));
  const one = summarise([lot('500', '01.01.2024')], 'CHF');
  assert.equal(summaryText({ label: 'RRC 1/1', corpus: 'crro', id: 'rrc-1.1' }, one, 'CHF', 'Crawford 1/1'), [
    'RRC 1/1',
    `Median hammer ${copied(500, 'CHF')} · middle 50% ${copied(500, 'CHF')}–${copied(500, 'CHF')} · range ${copied(500, 'CHF')}–${copied(500, 'CHF')} · 1 recorded sale matching “Crawford 1/1” · 2024`,
    'https://numismatics.org/crro/id/rrc-1.1',
  ].join('\n'));
});

test('summaryText has no type link for a reference without type data', () => {
  const summary = summarise([lot('100', '01.01.2025'), lot('300', '01.01.2026'), lot('')], 'USD');
  assert.equal(summaryText({ label: 'HGC 4, 1218', corpus: 'other', id: 'HGC 4, 1218' }, summary, 'USD', '"HGC 4, 1218"'), [
    'HGC 4, 1218',
    `Median hammer ${copied(200)} · middle 50% ${copied(150)}–${copied(250)} · range ${copied(100)}–${copied(300)} · 2 recorded sales matching "HGC 4, 1218" · 2025–2026`,
  ].join('\n'));
});

test('defaultTerm uses one verified RIC person from a mint-volume lot to disambiguate the number', () => {
  assert.equal(defaultTerm({ catalogue: 'RIC', section: '', number: '287', rulers: ['Constantine II'] }), 'Constantine II "RIC 287"');
  assert.equal(defaultTerm({ catalogue: 'RIC', section: '', number: '287', rulers: ['Constantinus II'] }), 'Constantine II "RIC 287"');
  assert.equal(defaultTerm({ catalogue: 'RIC', section: '', number: '287', rulers: ['Constantine II', 'Licinius'] }), '"RIC 287"');
});

test('summaryText labels an unverified price query without inventing a type link', () => {
  const summary = summarise([{ price: '200', date: '2026-01-01' }], 'USD');
  assert.equal(summaryText({ label: 'RIC 972' }, summary, 'USD', 'RIC 972'), [
    'RIC 972',
    `Median hammer ${copied(200)} · middle 50% ${copied(200)}–${copied(200)} · range ${copied(200)}–${copied(200)} · 1 recorded sale matching “RIC 972” · 2026`,
  ].join('\n'));
});

test('priceCheck counts the counted sales strictly under an amount and sets it against the median', () => {
  const amounts = ['90', '110', '135', '165', '180', '215', '245', '310', '450'];
  // A lot without a price and one in another currency are not sales the amount is checked against.
  const summary = summarise(amounts.map((price, i) => lot(price, '01.01.2024', String(i))).concat([lot(''), lot('200 EUR')]), 'USD');
  assert.deepEqual(priceCheck(summary, 288), { below: 7, count: 9, ratio: 1.6 });
  assert.deepEqual(priceCheck(summary, 180), { below: 4, count: 9, ratio: 1 });
  assert.deepEqual(priceCheck(summary, 45), { below: 0, count: 9, ratio: 0.25 });
  assert.deepEqual(priceCheck(summary, 900), { below: 9, count: 9, ratio: 5 });
  assert.deepEqual(priceCheck(summarise([lot('500')], 'USD'), 800), { below: 1, count: 1, ratio: 1.6 });
});

test('summarise counts the lots without a price apart from the prices it could not read', () => {
  const summary = summarise([lot('100'), lot(''), lot('*'), lot('-'), lot('unsold'), lot('200 EUR'), lot('1.200,- €')], 'USD');
  assert.deepEqual([summary.total, summary.count, summary.unpriced], [7, 1, 4]);
  assert.deepEqual(summary.uncounted, ['200 EUR', '1.200,- €']);
  assert.equal(summarise([lot('100'), lot('300')], 'USD').unpriced, 0);
  assert.equal(summarise([], 'USD').unpriced, 0);
});

test('defaultTerm searches a reference without type data as an exact phrase, and several ";" references as either-or phrases', () => {
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(defaultTerm(other(' HGC 4,  1218 ')), '"HGC 4, 1218"');
  assert.equal(defaultTerm(other('BCD Boiotia 174b; HGC 4, 1218')), '("BCD Boiotia 174b" "HGC 4, 1218")');
  assert.equal(defaultTerm(other('"Sear 1234"; ; “SNG Cop 123”;')), '("Sear 1234" "SNG Cop 123")');
});

test('an Other term drops a trailing remark and every bracket, which acsearch cannot match in a phrase, and searches only parts with a letter and a digit', () => {
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(defaultTerm(other('(BCD Boiotia 174b)')), '"BCD Boiotia 174b"');
  assert.equal(defaultTerm(other('HGC 4, 1218; BCD Boiotia 174b (this coin)')), '("HGC 4, 1218" "BCD Boiotia 174b")');
  assert.equal(defaultTerm(other('[SNG Cop 123]')), '"SNG Cop 123"');
  // "Not in" citations and remarks carry no number and would match unrelated lots.
  assert.equal(defaultTerm(other('SNG Cop –; BMC –; HGC 4, 1218')), '"HGC 4, 1218"');
  assert.equal(defaultTerm(other('HGC 4, 1218; Rare; unpublished')), '"HGC 4, 1218"');
  assert.equal(defaultTerm(other('Rare; 1218')), '');
});

test('an SG part is searched as both "Sear N" and "SG N", either-or, with any other part joining the same group', () => {
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(defaultTerm(other('SG 6829')), '("Sear 6829" "SG 6829")');
  assert.equal(defaultTerm(other('SG 6829 var.')), '("Sear 6829" "SG 6829")');
  assert.equal(defaultTerm(other('SG 6829a')), '("Sear 6829a" "SG 6829a")');
  assert.equal(defaultTerm(other('SG 6829 var.; SC 1')), '("Sear 6829" "SG 6829" "SC 1")');
  assert.equal(defaultTerm(other('HGC 9, 12; SG 6829')), '("HGC 9, 12" "Sear 6829" "SG 6829")');
  // Only a whole SG part is rewritten; "SG" inside a longer citation stays as written.
  assert.equal(defaultTerm(other('SNG Cop 123')), '"SNG Cop 123"');
  // Any SG spelling reads so: a Recent chip saved before 0.19, and a "v" behind a remark.
  for (const number of ['SG6829v', 'SG 6829 var', 'SGCV 6829', 'GCV 6829', 'Sear Greek 6829', 'SG6829', 'SG 6829v (this coin)', 'SG-6829']) {
    assert.equal(defaultTerm(other(number)), '("Sear 6829" "SG 6829")', number);
  }
  assert.equal(defaultTerm(other('SG 6829v; SNG Spaer 1712')), '("Sear 6829" "SG 6829" "SNG Spaer 1712")');
  assert.equal(defaultTerm(other('SGI 123')), '"SGI 123"');
  assert.equal(defaultTerm(other('Sear 6829')), '"Sear 6829"');
});

// CoinArchives has no either-or group but it honours a double-quoted phrase, so its term is the acsearch term with each group cut to the spelling
// dealers cite most.
test('coinArchivesTerm quotes the catalogue phrase and offers one spelling of it', () => {
  assert.equal(coinArchivesTerm({ catalogue: 'RIC', section: ' Nero ', number: '306' }), 'Nero "RIC 306"');
  assert.equal(coinArchivesTerm({ catalogue: 'RIC', section: 'Nero', number: '306', volume: 'I (2nd edition)' }), 'Nero "RIC 306"');
  assert.equal(coinArchivesTerm({ catalogue: 'RIC', section: 'Leo I (East)', number: '605' }), 'Leo I "RIC 605"');
  assert.equal(coinArchivesTerm({ catalogue: 'RIC', section: 'Hadrian', number: '266 (aureus)' }), 'Hadrian aureus "RIC 266"');
  assert.equal(coinArchivesTerm({ catalogue: 'RRC', number: 'Cr. 44/5' }), '"Crawford 44/5"');
  assert.equal(coinArchivesTerm({ catalogue: 'SC', number: 'SC 1266.2' }), '"SC 1266.2"');
  assert.equal(coinArchivesTerm({ catalogue: 'Price', number: ' 23 ' }), '"Price 23"');
  assert.equal(coinArchivesTerm({ catalogue: 'Bop', section: 'Hermaeus', number: '20' }), 'Hermaeus "Bopearachchi 20"');
  assert.equal(coinArchivesTerm({ catalogue: 'Bop', section: 'Euthydemus I', number: 'Bop 24a' }), 'Euthydemus "Bopearachchi 24A"');
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(coinArchivesTerm(other('SG 6829 var.')), '"Sear 6829"');
  assert.equal(coinArchivesTerm(other('SG 6829a; SC 1')), '"Sear 6829a"');
  assert.equal(coinArchivesTerm(other('SGCV 6829')), '"Sear 6829"');
  assert.equal(coinArchivesTerm(other('SG6829v')), '"Sear 6829"');
  assert.equal(coinArchivesTerm(other('SG 6829v (this coin)')), '"Sear 6829"');
  assert.equal(coinArchivesTerm(other('BCD Boiotia 174b; HGC 4, 1218')), '"BCD Boiotia 174b"');
  assert.equal(coinArchivesTerm(other('“[SNG Cop 123]” (this coin); BMC 4')), '"SNG Cop 123"');
  assert.equal(coinArchivesTerm(other('Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago')), '');
});

test('coinArchivesUrl encodes the words into a CoinArchives search address', () => {
  assert.equal(coinArchivesUrl('Crawford 44/5'), 'https://www.coinarchives.com/a/results.php?search=Crawford%2044%2F5&s=0');
  assert.equal(coinArchivesUrl(' BCD  Boiotia 174b '), 'https://www.coinarchives.com/a/results.php?search=BCD%20Boiotia%20174b&s=0');
  assert.equal(coinArchivesUrl('a&s=9#x'), 'https://www.coinarchives.com/a/results.php?search=a%26s%3D9%23x&s=0');
});

test('an acsearch page that found nothing is no sales, not a connection failure', async () => {
  const term = '"(BCD Boiotia 174b)"';
  assert.deepEqual(await fetchPrices({ term, currency: 'USD' }, { fetchImpl: fakeFetch(fixture('acsearch-search-no-results.html')) }), { status: 'empty', term });
});

test('summaryText collapses whitespace inside a quoted raw price so a copied line never splits', () => {
  const summary = summarise([lot('500', '01.01.2024'), lot('1.200,-\n€')], 'USD');
  assert.deepEqual(summary.uncounted, ['1.200,-\n€']);
  assert.equal(summaryText({ label: 'RRC 1/1', corpus: 'crro', id: 'rrc-1.1' }, summary, 'USD', 'Crawford 1/1').split('\n')[2], 'Not counted: “1.200,- €”');
});

test('defaultTerm offers both Seleucid Coins spellings', () => {
  assert.equal(defaultTerm({ catalogue: 'SC', number: '1266.2' }), '("SC 1266.2" "Seleucid Coins 1266.2")');
});

test('quoted uncounted prices are squashed of control characters and capped at 40 characters', () => {
  const long = `${'1'.repeat(30)} EUR ${'2'.repeat(30)}`;
  const summary = summarise([lot('100'), lot(long), lot('7\u00858 EUR')], 'USD');
  const text = summaryText({ label: 'X', corpus: 'pella', id: 'x' }, summary, 'USD', 'X');
  assert.ok(text.includes(`Not counted: “${long.slice(0, 40)}…”, “7 8 EUR”`), text);
  assert.equal(text.split('\n').length, 4);
});

test('the quoting cap never splits an astral character', () => {
  // Digits, because only a raw price with a digit is listed as uncounted.
  const raw = `${'1'.repeat(39)}😀😀 EUR`;
  const summary = summarise([lot('100'), lot(raw)], 'USD');
  const text = summaryText({ label: 'X', corpus: 'pella', id: 'x' }, summary, 'USD', 'X');
  assert.ok(text.includes(`“${'1'.repeat(39)}😀…”`), text);
});

test('defaultTerm groups both spellings of the king and the Bopearachchi series as the exact phrases dealers cite it with', () => {
  const bop = (section, number) => ({ catalogue: 'Bop', section, number });
  assert.equal(defaultTerm(bop(' Hermaeus ', 'Bop 20')), '(Hermaeus Hermaios) ("Bopearachchi 20" "Bop 20" "Bopearachchi Série 20")');
  assert.equal(defaultTerm(bop(' Euthydemus I ', 'Bop 24a')), '(Euthydemus Euthydemos) ("Bopearachchi 24A" "Bop 24A" "Bopearachchi Série 24A")');
  assert.equal(defaultTerm(bop('Diodotus I or Diodotus II', '8A')), '(Diodotus Diodotos) ("Bopearachchi 8A" "Bop 8A" "Bopearachchi Série 8A")');
  assert.equal(defaultTerm(bop('Strato I', '12')), '(Strato Straton) ("Bopearachchi 12" "Bop 12" "Bopearachchi Série 12")');
  assert.equal(defaultTerm(bop('Menander I', '9C')), 'Menander ("Bopearachchi 9C" "Bop 9C" "Bopearachchi Série 9C")');
  assert.equal(defaultTerm(bop('Hermaios', '20')), 'Hermaios ("Bopearachchi 20" "Bop 20" "Bopearachchi Série 20")');
  assert.equal(defaultTerm(bop('', 'Bop-9C')), '("Bopearachchi 9C" "Bop 9C" "Bopearachchi Série 9C")');
  assert.equal(defaultTerm(bop('Hermaeus', '')), '(Hermaeus Hermaios) Bopearachchi');
  assert.equal(defaultTerm(bop('', '')), 'Bopearachchi');
});

// Latin (BIGR) first name to the Greek form dealers use; the unchanged names prove the rules leave them alone.
const GREEK = {
  Hermaeus: 'Hermaios', Euthydemus: 'Euthydemos', Eucratides: 'Eukratides', Philoxenus: 'Philoxenos', Antialcidas: 'Antialkidas',
  Agathocles: 'Agathokles', Heliocles: 'Heliokles', Apollodotus: 'Apollodotos', Demetrius: 'Demetrios', Diodotus: 'Diodotos',
  Antimachus: 'Antimachos', Zoilus: 'Zoilos', Hippostratus: 'Hippostratos', Artemidorus: 'Artemidoros', Nicias: 'Nikias',
  Archebius: 'Archebios', Peucolaus: 'Peukolaos', Polyxenus: 'Polyxenos', Theophilus: 'Theophilos', Telephus: 'Telephos',
  Dionysius: 'Dionysios', Antiochus: 'Antiochos', Strato: 'Straton', Plato: 'Platon',
  Menander: 'Menander', Lysias: 'Lysias', Amyntas: 'Amyntas', Epander: 'Epander', Thrason: 'Thrason', Pantaleon: 'Pantaleon',
  Diomedes: 'Diomedes', Apollophanes: 'Apollophanes',
};

test('greekName follows the four spelling rules for every BIGR first name', () => {
  assert.equal(Object.keys(GREEK).length, 32);
  for (const [latin, greek] of Object.entries(GREEK)) assert.equal(greekName(latin), greek, latin);
  const firstNames = new Set(BIGR_KINGS.map((king) => king.split(' ')[0]));
  assert.deepEqual([...firstNames].filter((name) => !Object.hasOwn(GREEK, name)), []);
  assert.equal(greekName(''), '');
  assert.equal(greekName(undefined), '');
});

test('buildSearchUrl encodes the parentheses and quotes of a Bop term', () => {
  assert.equal(buildSearchUrl({ term: '(Hermaeus Hermaios) "Bopearachchi 20"', currency: 'USD' }),
    'https://www.acsearch.info/search.html?term=%28Hermaeus+Hermaios%29+%22Bopearachchi+20%22&category=1&currency=usd&order=1');
  assert.equal(buildSearchUrl({ term: 'Menander "Bopearachchi 24A"', currency: 'EUR' }),
    'https://www.acsearch.info/search.html?term=Menander+%22Bopearachchi+24A%22&category=1&currency=eur&order=1');
});

const iso = (date) => date?.toISOString().slice(0, 10) ?? null;

test('saleDate reads the day of a lot in any of its three forms as midnight UTC, and nothing else', () => {
  assert.equal(saleDate('08.07.2026').toISOString(), '2026-07-08T00:00:00.000Z');
  assert.equal(iso(saleDate('28.07.2026 14:00')), '2026-07-28');
  assert.equal(iso(saleDate('2024-05-01')), '2024-05-01');
  assert.equal(iso(saleDate(' 29.02.2028 ')), '2028-02-29');
  // Date.UTC would roll an impossible day into the next month.
  for (const bad of ['', 'n/a', '31.02.2026', '29.02.2026', '2026-02-30', '00.07.2026', '08.13.2026', '8.7.2026', '07/08/2026', '2026', '08.07.2026x', null, undefined]) {
    assert.equal(saleDate(bad), null, String(bad));
  }
});

// The day the tests are drawn on; two years before it is 11.09.2024 and five years 11.09.2021.
const NOW = new Date(Date.UTC(2026, 8, 11));

test('PERIODS offers All, the last 5 years and the last 2 years', () => {
  assert.deepEqual(PERIODS.map(({ value, label, years }) => [value, label, years]), [['all', 'All', null], ['5y', 'Last 5 years', 5], ['2y', 'Last 2 years', 2]]);
  assert.ok(Object.isFrozen(PERIODS));
});

test('lotsInPeriod keeps the lots sold on or after the same day N years ago, and only All keeps a lot without a readable date', () => {
  const lots = [lot('100', '11.09.2024', 'edge2'), lot('100', '10.09.2024 23:59', 'before2'), lot('100', '2021-09-11', 'edge5'), lot('100', '10.09.2021', 'before5'),
    lot('100', '', 'blank'), lot('100', 'n/a', 'na'), lot('', '08.07.2026', 'unpriced')];
  const ids = (period, now = NOW) => lotsInPeriod(lots, period, now).map((entry) => entry.id);
  assert.deepEqual(ids('all'), lots.map((entry) => entry.id));
  assert.deepEqual(ids('5y'), ['edge2', 'before2', 'edge5', 'unpriced']);
  assert.deepEqual(ids('2y'), ['edge2', 'unpriced']);
  // The time of day doesn't move the boundary.
  assert.deepEqual(ids('2y', new Date(Date.UTC(2026, 8, 11, 23, 59))), ['edge2', 'unpriced']);
  // 29 February falls back to the 28th in a year without one.
  const leap = [lot('100', '28.02.2026', 'kept'), lot('100', '27.02.2026', 'dropped')];
  assert.deepEqual(lotsInPeriod(leap, '2y', new Date(Date.UTC(2028, 1, 29, 18))).map((entry) => entry.id), ['kept']);
});

// A moment as a clock in a fixed zone reports it, whatever zone the machine running the tests keeps: the local getters are the UTC ones, shifted.
// The host's own zone would leave this test unable to fail on a machine set to UTC, which is what a build server usually is.
const inZone = (iso, offsetMinutes) => {
  const shifted = new Date(new Date(iso).getTime() + offsetMinutes * 60000);
  return { getFullYear: () => shifted.getUTCFullYear(), getMonth: () => shifted.getUTCMonth(), getDate: () => shifted.getUTCDate() };
};

test('localDay keeps the local date of a moment, at midnight UTC like a sale date, whatever the zone', () => {
  // 02:00 UTC on the 11th is still the 10th five hours west, and 22:00 UTC on the 10th is already the 11th ten hours east.
  assert.equal(localDay(inZone('2026-09-11T02:00:00Z', -5 * 60)).toISOString(), '2026-09-10T00:00:00.000Z');
  assert.equal(localDay(inZone('2026-09-10T22:00:00Z', 10 * 60)).toISOString(), '2026-09-11T00:00:00.000Z');
  assert.equal(localDay(inZone('2028-02-29T23:59:00Z', 0)).toISOString(), '2028-02-29T00:00:00.000Z');
  // The collector's own 10th still keeps a sale from exactly two years before, though UTC has moved on to the 11th.
  assert.deepEqual(lotsInPeriod([lot('100', '10.09.2024', 'edge')], '2y', localDay(inZone('2026-09-11T02:00:00Z', -5 * 60))).map((entry) => entry.id), ['edge']);
});

// Three counted sales in the last 2 years (median 250), with a lot without a price and one in euros; three before (median 150).
const RECENT = [lot('300', '11.09.2024', 'r1'), lot('$200', '08.07.2026', 'r2'), lot('250', '28.07.2026 14:00', 'r3'), lot('-', '01.08.2026', 'r4'), lot('200 EUR', '02.08.2026', 'r5')];
const EARLIER = [lot('100', '10.09.2024', 'e1'), lot('150', '2024-05-01', 'e2'), lot('1,200', '01.01.2020', 'e3')];
const UNDATED = lot('5000', 'n/a', 'u');

test('trendOf sets the median of the last 2 years against earlier sales, only when both rest on at least 3 counted sales', () => {
  assert.deepEqual(trendOf([...RECENT, ...EARLIER, UNDATED], 'USD', NOW), { recent: 250, recentCount: 3, earlier: 150, earlierCount: 3, change: 250 / 150 - 1 });
  // A sale without a readable date belongs to neither side: two earlier sales and it are not three.
  assert.equal(trendOf([...RECENT, ...EARLIER.slice(0, 2), UNDATED], 'USD', NOW), null);
  assert.equal(trendOf([...RECENT.slice(1), ...EARLIER], 'USD', NOW), null);
  assert.equal(trendOf([], 'USD', NOW), null);
});

test('lastSale is the counted sale with the latest readable date, the first in page order on a tie', () => {
  const summary = summarise([UNDATED, lot('-', '01.08.2026', 'unsold'), lot('200 EUR', '09.07.2026', 'euro'), lot('100', '2024-05-01', 'old'),
    lot('$950', '08.07.2026', 'first'), lot('1,200', '08.07.2026 18:00', 'tie')], 'USD');
  assert.deepEqual([lastSale(summary).id, lastSale(summary).amount], ['first', 950]);
  assert.equal(lastSale(summarise([lot('100', ''), lot('200', 'n/a')], 'USD')), null);
  assert.equal(lastSale(summarise([], 'USD')), null);
});

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;
const move = (recent, earlier) => ({ recent, recentCount: 3, earlier, earlierCount: 3, change: recent / earlier - 1 });

test('trendText says how far the last 2 years moved from earlier sales, and that a move within 5% is about the same', () => {
  assert.equal(trendText(trendOf([...RECENT, ...EARLIER], 'USD', NOW), usd), 'Last 2 years: $250 median, up 67% on earlier sales ($150)');
  assert.equal(trendText(move(150, 250), usd), 'Last 2 years: $150 median, down 40% on earlier sales ($250)');
  // 210 against 200 is 5%, still about the same.
  for (const [recent, earlier] of [[210, 200], [190, 200], [204, 200], [200, 200]]) {
    assert.equal(trendText(move(recent, earlier), usd), `Last 2 years: $${recent} median, about the same as earlier sales ($${earlier})`);
  }
  assert.equal(trendText(move(212, 200), usd), 'Last 2 years: $212 median, up 6% on earlier sales ($200)');
  assert.equal(trendText(move(188, 200), usd), 'Last 2 years: $188 median, down 6% on earlier sales ($200)');
  // An exact 5.5% rounds up whichever way it moves, though 105.5 / 100 - 1 is 5.4999…% in floating point.
  assert.equal(trendText(move(211, 200), usd), 'Last 2 years: $211 median, up 6% on earlier sales ($200)');
  assert.equal(trendText(move(105.5, 100), usd), 'Last 2 years: $106 median, up 6% on earlier sales ($100)');
  assert.equal(trendText(move(94.5, 100), usd), 'Last 2 years: $95 median, down 6% on earlier sales ($100)');
});

test('summaryText names a period other than All, then adds the last sale and the trend', () => {
  const card = { label: 'Price 23', corpus: 'pella', id: 'price.23' };
  const lots = [...RECENT, ...EARLIER, UNDATED];
  const extras = { period: PERIODS[2], last: lastSale(summarise(lots, 'USD')), trend: trendOf(lots, 'USD', NOW) };
  assert.equal(summaryText(card, summarise(lotsInPeriod(lots, '2y', NOW), 'USD'), 'USD', 'Price 23', extras), [
    'Price 23',
    `Median hammer ${copied(250)} (last 2 years) · middle 50% ${copied(225)}–${copied(275)} · range ${copied(200)}–${copied(300)} · 3 recorded sales matching “Price 23” · 2024–2026`,
    `Last sale Jul 28, 2026 · ${copied(250)}`,
    `Last 2 years: ${copied(250)} median, up 67% on earlier sales (${copied(150)})`,
    'Not counted: “200 EUR”',
    'https://numismatics.org/pella/id/price.23',
  ].join('\n'));
  assert.ok(summaryText(card, summarise(lotsInPeriod(lots, '5y', NOW), 'USD'), 'USD', 'Price 23', { ...extras, period: PERIODS[1] }).includes(`\nMedian hammer ${copied(200)} (last 5 years) · `));
  // All is not named, and without a trend there is no trend line.
  assert.equal(summaryText(card, summarise(lots, 'USD'), 'USD', 'Price 23', { ...extras, period: PERIODS[0], trend: null }), [
    'Price 23',
    `Median hammer ${copied(250)} · middle 50% ${copied(175)}–${copied(750)} · range ${copied(100)}–${copied(5000)} · 7 recorded sales matching “Price 23” · 2020–2026`,
    `Last sale Jul 28, 2026 · ${copied(250)}`,
    'Not counted: “200 EUR”',
    'https://numismatics.org/pella/id/price.23',
  ].join('\n'));
  // A copied line never splits, whatever whitespace the page put in a date.
  const split = { period: PERIODS[0], last: { ...extras.last, date: '28.07.2026\n14:00' }, trend: null };
  assert.equal(summaryText(card, summarise(lots, 'USD'), 'USD', 'Price 23', split).split('\n')[2], `Last sale Jul 28, 2026 · ${copied(250)}`);
  // A date the reader cannot place is written as the page gave it, squashed.
  const unread = { period: PERIODS[0], last: { ...extras.last, date: 'Summer\n2026' }, trend: null };
  assert.equal(summaryText(card, summarise(lots, 'USD'), 'USD', 'Price 23', unread).split('\n')[2], `Last sale Summer 2026 · ${copied(250)}`);
});

test('chooseTerm keeps a remembered term unless it is blank or the v0.12 Bop default', () => {
  const hermaeus = { catalogue: 'Bop', section: 'Hermaeus', number: '20' };
  assert.equal(chooseTerm(hermaeus, 'Hermaeus Bopearachchi 20'), '(Hermaeus Hermaios) ("Bopearachchi 20" "Bop 20" "Bopearachchi Série 20")');
  assert.equal(chooseTerm(hermaeus, ' Hermaeus  Bopearachchi 20 '), '(Hermaeus Hermaios) ("Bopearachchi 20" "Bop 20" "Bopearachchi Série 20")');
  assert.equal(chooseTerm(hermaeus, 'Hermaios Bopearachchi 20 tetradrachm'), 'Hermaios Bopearachchi 20 tetradrachm');
  assert.equal(chooseTerm(hermaeus, '(Hermaeus Hermaios) ("Bopearachchi 20" "Bop 20" "Bopearachchi Série 20")'), '(Hermaeus Hermaios) ("Bopearachchi 20" "Bop 20" "Bopearachchi Série 20")');
  for (const blank of ['', '   ', undefined, null]) assert.equal(chooseTerm(hermaeus, blank), '(Hermaeus Hermaios) ("Bopearachchi 20" "Bop 20" "Bopearachchi Série 20")');
  assert.equal(chooseTerm({ catalogue: 'Bop', section: '', number: '9C' }, 'Bopearachchi 9C'), '("Bopearachchi 9C" "Bop 9C" "Bopearachchi Série 9C")');
  assert.equal(chooseTerm({ catalogue: 'Bop', section: 'Hermaeus', number: '' }, 'Hermaeus Bopearachchi'), '(Hermaeus Hermaios) Bopearachchi');
  const nero = { catalogue: 'RIC', section: 'Nero', number: '306' };
  assert.equal(chooseTerm(nero, 'Nero 306 denarius'), 'Nero 306 denarius');
  assert.equal(chooseTerm(nero, ''), 'Nero "RIC 306"');
  assert.equal(chooseTerm({ catalogue: 'Price', number: '23' }, undefined), '"Price 23"');
});

// The first signed-in acsearch run showed `"RIC  237"` in acsearch's own search field for a RIC reference typed without a ruler, where defaultTerm
// returns `"RIC 237"`. Every place the term passes through on its way there squashes its whitespace — the RIC builder with no ruler and no volume to
// put in front of the number, a term the collector saved with two spaces in it, and the search URL the popup fetches and links to — so a second space
// cannot enter from any of them. (The one unsquashed path left in the extension is the workspace's own query box, which is not this term.)
test('an acsearch term carries one space, wherever the second one was typed', () => {
  const ric237 = { catalogue: 'RIC', number: '237', section: '', volume: '', rulers: [] };
  assert.equal(defaultTerm(ric237), '"RIC 237"');
  assert.equal(defaultTerm({ ...ric237, number: ' 237 ' }), '"RIC 237"');
  for (const saved of ['"RIC  237"', ' "RIC\t237" ', '"RIC  237"']) assert.equal(chooseTerm(ric237, saved), '"RIC 237"');
  // What the popup fetches and what its link opens are the same URL, and both carry the one space.
  assert.equal(buildSearchUrl({ term: '"RIC  237"', currency: 'USD' }), buildSearchUrl({ term: '"RIC 237"', currency: 'USD' }));
  assert.match(buildSearchUrl({ term: '"RIC  237"', currency: 'USD' }), /[?&]term=%22RIC\+237%22(?:&|$)/);
});

// The unquoted default of 0.31 and before was stored under the type whenever Get prices ran, so it would hide the exact-phrase default for good;
// it counts as unsaved, as the v0.12 Bop default does. Anything else the collector saved still wins.
test('chooseTerm drops a remembered term that is only the old unquoted default', () => {
  assert.equal(chooseTerm({ catalogue: 'RIC', section: 'Nero', number: '306' }, 'Nero 306'), 'Nero "RIC 306"');
  assert.equal(chooseTerm({ catalogue: 'RIC', section: 'Leo I (East)', number: '605', volume: 'X' }, ' Leo I  605 '), 'Leo I ("RIC 605" "RIC X 605" "RIC X, 605")');
  assert.equal(chooseTerm({ catalogue: 'RIC', section: '', number: '287', rulers: ['Constantine II'] }, 'Constantine II 287'), 'Constantine II "RIC 287"');
  assert.equal(chooseTerm({ catalogue: 'Price', number: '23' }, 'Price 23'), '"Price 23"');
  assert.equal(chooseTerm({ catalogue: 'RRC', number: '44/5' }, 'Crawford 44/5'), '("Crawford 44/5" "Cr. 44/5" "RRC 44/5")');
  assert.equal(chooseTerm({ catalogue: 'SC', number: '1266.2' }, 'SC 1266.2'), '("SC 1266.2" "Seleucid Coins 1266.2")');
  // Anything the collector typed himself stays, including a narrowed old default.
  assert.equal(chooseTerm({ catalogue: 'Price', number: '23' }, 'Price 23 tetradrachm'), 'Price 23 tetradrachm');
  assert.equal(chooseTerm({ catalogue: 'RRC', number: '44/5' }, 'RRC 44/5'), 'RRC 44/5');
});

// Krause (0.20): a KM reference is modern, so it searches acsearch's category 2 and CoinArchives' world section, in both spellings dealers cite.
test('defaultTerm offers both Krause spellings, keeping a country in front of an all-KM reference', () => {
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(defaultTerm(other('KM# 123')), '("KM 123" "Krause/Mishler 123")');
  assert.equal(defaultTerm(other('KM 123')), '("KM 123" "Krause/Mishler 123")');
  assert.equal(defaultTerm(other('KM# 123.2a')), '("KM 123.2a" "Krause/Mishler 123.2a")');
  assert.equal(defaultTerm(other('KM# A123')), '("KM A123" "Krause/Mishler A123")');
  assert.equal(defaultTerm(other('Netherlands KM# 123')), 'Netherlands ("KM 123" "Krause/Mishler 123")');
  assert.equal(defaultTerm(other('German States Rostock KM# 123')), 'German States Rostock ("KM 123" "Krause/Mishler 123")');
  // A country is letters in any script here too, the way lookup reads it: Württemberg and México are ordinary Krause headings.
  assert.equal(defaultTerm(other('Württemberg KM# 123')), 'Württemberg ("KM 123" "Krause/Mishler 123")');
  assert.equal(defaultTerm(other('México KM-123')), 'México ("KM 123" "Krause/Mishler 123")');
  // Mixed with another catalogue: both phrases join the one either-or group and the country goes, since the search is no longer certainly that country's.
  assert.equal(defaultTerm(other('KM# 123; SG 6829')), '("KM 123" "Krause/Mishler 123" "Sear 6829" "SG 6829")');
  assert.equal(defaultTerm(other('Netherlands KM# 123; Scholten 782')), '("KM 123" "Krause/Mishler 123" "Scholten 782")');
  // Two countries, or one of two parts carrying one: acsearch ANDs the bare word with the whole group, so it would exclude the other country's lots.
  assert.equal(defaultTerm(other('Netherlands KM# 123; Bolivia KM# 124')), '("KM 123" "Krause/Mishler 123" "KM 124" "Krause/Mishler 124")');
  assert.equal(defaultTerm(other('KM# 123; Netherlands KM# 124')), '("KM 123" "Krause/Mishler 123" "KM 124" "Krause/Mishler 124")');
});

test('searchCategory sends an all-KM reference to modern coins and everything else to ancients', () => {
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(searchCategory(other('KM# 123')), '2');
  assert.equal(searchCategory(other('Netherlands KM# 123.2a')), '2');
  assert.equal(searchCategory(other('Württemberg KM# 123')), '2');
  assert.equal(searchCategory(other('KM# 123; KM# 124')), '2');
  assert.equal(searchCategory(other('KM# 123; SG 6829')), '1');
  assert.equal(searchCategory(other('SG 6829')), '1');
  assert.equal(searchCategory(other('HGC 4, 1218')), '1');
  assert.equal(searchCategory(other('Rare')), '1');
  assert.equal(searchCategory({ catalogue: 'RIC', section: 'Nero', number: '306' }), '1');
  assert.equal(searchCategory({ catalogue: 'SC', number: 'SC 1266.2' }), '1');
});

test('buildSearchUrl carries the category it is given', () => {
  assert.equal(buildSearchUrl({ term: 'KM 123', currency: 'USD', category: '2' }), 'https://www.acsearch.info/search.html?term=KM+123&category=2&currency=usd&order=1');
  assert.equal(buildSearchUrl({ term: 'Nero 306', currency: 'USD' }), 'https://www.acsearch.info/search.html?term=Nero+306&category=1&currency=usd&order=1');
});

test('a KM reference links to CoinArchives world section in plain words', () => {
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(coinArchivesTerm(other('Netherlands KM# 123')), 'Netherlands "KM 123"');
  assert.equal(coinArchivesTerm(other('KM# 123.2a')), '"KM 123.2a"');
  assert.equal(coinArchivesTerm(other('Württemberg KM# 123')), 'Württemberg "KM 123"');
  assert.equal(coinArchivesSection(other('KM# 123')), 'w');
  assert.equal(coinArchivesSection(other('Württemberg KM# 123')), 'w');
  // The section follows the part the term was built from, not acsearch's stricter all-KM rule: the link searches "KM 123", which /a/ can never hold.
  assert.equal(coinArchivesSection(other('KM# 123; SG 6829')), 'w');
  assert.equal(coinArchivesSection(other('SG 6829; KM# 123')), 'a');
  assert.equal(coinArchivesSection(other('SG 6829')), 'a');
  assert.equal(coinArchivesSection({ catalogue: 'RIC', section: 'Nero', number: '306' }), 'a');
  assert.equal(coinArchivesUrl('Netherlands KM 123', 'w'), 'https://www.coinarchives.com/w/results.php?search=Netherlands%20KM%20123&s=0');
  assert.equal(coinArchivesUrl('Crawford 44/5'), 'https://www.coinarchives.com/a/results.php?search=Crawford%2044%2F5&s=0');
});

// Y# (0.22): the same Krause family as KM, so it searches modern coins and links to the world section, in the two spellings dealers write.
test('a Y# reference searches world coins exactly as KM does', () => {
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(defaultTerm(other('Y# 31')), '("Y 31" "Y# 31")');
  assert.equal(defaultTerm(other('Y 31')), '("Y 31" "Y# 31")');
  assert.equal(defaultTerm(other('Y# 59.3a')), '("Y 59.3a" "Y# 59.3a")');
  assert.equal(defaultTerm(other('Russia Y# 59.3')), 'Russia ("Y 59.3" "Y# 59.3")');
  // A country in front is kept only when every part is Krause and names it, as for KM; the two keys mix freely.
  assert.equal(defaultTerm(other('Russia Y# 31; Russia KM# 123')), 'Russia ("Y 31" "Y# 31" "KM 123" "Krause/Mishler 123")');
  assert.equal(defaultTerm(other('Y# 31; Scholten 782')), '("Y 31" "Y# 31" "Scholten 782")');
  assert.equal(searchCategory(other('Y# 31')), '2');
  assert.equal(searchCategory(other('Russia Y# 59.3')), '2');
  assert.equal(searchCategory(other('Y# 31; KM# 123')), '2');
  // Mixed with an ancient reference it stays in Ancients, as KM does, while the link follows the first part: Y first opens /w/, SG first /a/.
  assert.equal(searchCategory(other('Y# 31; SG 6829')), '1');
  assert.equal(coinArchivesSection(other('Y# 31; SG 6829')), 'w');
  assert.equal(coinArchivesTerm(other('Russia Y# 59.3')), 'Russia "Y 59.3"');
  assert.equal(coinArchivesTerm(other('Y# 31')), '"Y 31"');
  assert.equal(coinArchivesSection(other('Y# 31')), 'w');
  assert.equal(coinArchivesSection(other('SG 6829; Y# 31')), 'a');
});

// A sentence is not a reference (0.22): a pasted description would search as one exact phrase and median unrelated lots.
test('an Other part longer than a citation is not searched', () => {
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(defaultTerm(other('Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago, bought in Vienna')), '');
  assert.equal(defaultTerm(other('BCD Boiotia 174b; HGC 4, 1218')), '("BCD Boiotia 174b" "HGC 4, 1218")');
  assert.equal(defaultTerm(other('SNG von Aulock 8305')), '"SNG von Aulock 8305"');
  assert.equal(defaultTerm(other('German States Rostock KM# 123')), 'German States Rostock ("KM 123" "Krause/Mishler 123")');
  assert.equal(defaultTerm(other('Sylloge Nummorum Graecorum Copenhagen 123')), '"Sylloge Nummorum Graecorum Copenhagen 123"');
  assert.equal(defaultTerm(other('RPC I 1234; SNG Cop 5')), '("RPC I 1234" "SNG Cop 5")');
  // A short part beside prose still searches on its own, and a trailing remark is dropped before the words are counted.
  assert.equal(defaultTerm(other('a very long sentence of eight words here; HGC 4, 1218')), '"HGC 4, 1218"');
  assert.equal(defaultTerm(other('BCD Boiotia 174b (this coin, ex Berk 1991)')), '"BCD Boiotia 174b"');
  assert.equal(coinArchivesTerm(other('Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago')), '');
});

// A group lot cites a run of numbers under one key ("SNG von Aulock 5960, 5961, ..."): one citation, so it is searched, not counted out as prose.
test('a citation listing several numbers under one catalogue is still searched', () => {
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(defaultTerm(other('SNG von Aulock 5960, 5961, 5962, 5963, 5964')), '"SNG von Aulock 5960, 5961, 5962, 5963, 5964"');
  assert.equal(defaultTerm(other('HGC 4, 1218, 1219, 1220, 1221, 1222, 1223')), '"HGC 4, 1218, 1219, 1220, 1221, 1222, 1223"');
  assert.equal(coinArchivesTerm(other('SNG Copenhagen 12, 13, 14, 15, 16, 17')), '"SNG Copenhagen 12, 13, 14, 15, 16, 17"');
});

// A term saved before 0.22 for what is now prose would fetch the whole sentence again when its chip reopens, so it is dropped with the default.
test('a remembered term is dropped when its Other reference gives no searchable part', () => {
  const prose = { catalogue: 'Other', number: 'Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago', section: '' };
  assert.equal(chooseTerm(prose, '"Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago"'), '');
  // Every reference that still searches keeps the term the collector saved.
  assert.equal(chooseTerm({ catalogue: 'Other', number: 'BCD Boiotia 174b', section: '' }, 'BCD Boiotia 174'), 'BCD Boiotia 174');
  assert.equal(chooseTerm({ catalogue: 'RIC', section: 'Nero', number: '306' }, 'Nero denarius'), 'Nero denarius');
});

// 0.32: the search brings back every lot that holds the words, so a row is counted only when its description cites the reference itself.
test('citesReference asks for the catalogue key next to the number, as a whole token', () => {
  const price23 = { catalogue: 'Price', number: '23' };
  assert.equal(citesReference('Macedon. Tetradrachm. Price 23. Very Fine.', price23), true);
  assert.equal(citesReference('Cf. Price 23; unpublished variety.', price23), true);
  // The two the reviewer found under the bare words: another number that begins with it, and a weight.
  assert.equal(citesReference('Alexander III. Tetradrachm. Price 3014. Good Very Fine.', price23), false);
  assert.equal(citesReference('Drachm (4.23 g), Miletos. Fine.', price23), false);
  assert.equal(citesReference('Starting price 23 EUR. No reference given.', price23), false);
  assert.equal(citesReference('PRICE 23, this coin.', price23), true);
  const ric306 = { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)' };
  // "RIC II.1 306" was read as this type until the review: the card is volume I, and volume II's 306 is another coin. Only the card's own numeral counts.
  for (const cited of ['Nero. As. RIC 306.', 'RIC I 306; BMC 227.', 'Cited as RIC I, 306.', 'RIC I² 306, rare.', 'RIC I.1 306.', 'RIC 306 var.']) {
    assert.equal(citesReference(cited, ric306), true, cited);
  }
  assert.equal(citesReference('RIC II.1 306.', ric306), false);
  for (const other of ['Nero. Dupondius (4.23 g). RIC 3061.', 'RIC 306a, a different obverse.', 'RIC 30.', 'Sold with 306 other lots.']) {
    assert.equal(citesReference(other, ric306), false, other);
  }
  assert.equal(citesReference('Seleucid Coins 1266.2, this coin.', { catalogue: 'SC', number: '1266.2' }), true);
  assert.equal(citesReference('SC 1266.25.', { catalogue: 'SC', number: '1266.2' }), false);
  assert.equal(citesReference('Roman Republic. Denarius. Cr. 44/5.', { catalogue: 'RRC', number: '44/5' }), true);
  assert.equal(citesReference('Crawford 44/5a.', { catalogue: 'RRC', number: '44/5' }), false);
  assert.equal(citesReference('Bopearachchi 24A.', { catalogue: 'Bop', number: 'Bop 24a' }), true);
  // An Other reference already searches as the exact citation, and a row with no description is never dropped on missing data.
  assert.equal(citesReference('Anything at all.', { catalogue: 'Other', number: 'HGC 4, 1218' }), true);
  assert.equal(citesReference('', price23), true);
  assert.equal(citesReference(undefined, price23), true);
});

// 0.32 review: the filter was probed with the text dealers actually write and misjudged rows both ways. A row wrongly in or wrongly out of the
// statistics moves the median a collector bids on, so every spelling below is asserted.
test('citesReference reads a suffix letter in either case, as the catalogues themselves do', () => {
  assert.equal(citesReference('Euthydemus I. Tetradrachm. Bopearachchi 24a.', { catalogue: 'Bop', number: 'Bop 24A' }), true);
  assert.equal(citesReference('Nero. As. RIC 22a.', { catalogue: 'RIC', number: '22A' }), true);
  assert.equal(citesReference('Nero. As. RIC 22A.', { catalogue: 'RIC', number: '22a' }), true);
  assert.equal(citesReference('Seleucid Coins 1266.2A, this coin.', { catalogue: 'SC', number: '1266.2a' }), true);
  // A dealer writes a decimal point as a comma as readily as a full stop.
  assert.equal(citesReference('Antiochos III. Drachm. SC 1266,2.', { catalogue: 'SC', number: '1266.2' }), true);
  // A lettered number is its own type: it is cited on its own and never stands for the plain one, as "RIC 306a" never did.
  assert.equal(citesReference('Macedon. Tetradrachm. Price 23a.', { catalogue: 'Price', number: '23' }), false);
  assert.equal(citesReference('Seleucid Coins 1266.2a.', { catalogue: 'SC', number: '1266.2' }), false);
});

test('citesReference knows every key and volume spelling dealers write', () => {
  const rrc = { catalogue: 'RRC', number: '44/5' };
  for (const key of ['Cr 44/5', 'Cr. 44/5', 'Craw. 44/5', 'Crawf. 44/5', 'Crawford 44/5', 'RRC 44/5']) {
    assert.equal(citesReference(`Roman Republic. Denarius. ${key}. Very Fine.`, rrc), true, key);
  }
  const ric306 = { catalogue: 'RIC', number: '306' };
  for (const cited of ['RIC² 306', 'RIC2 306', 'RIC I(2) 306', 'RIC I² 306', 'R.I.C. 306', 'RIC (306)',
    'RIC I (second edition) Nero 306', 'RIC I Nero 306', 'RIC I, Nero 306', 'RIC 305-306', 'RIC 306-307']) {
    assert.equal(citesReference(`Nero. As, Rome. ${cited}. Very Fine.`, ric306), true, cited);
  }
  // A ruler or a spelled-out edition may stand between the volume and the number, but nothing holding a digit, a dash, a semicolon or a full stop:
  // those belong to another citation on the same line.
  for (const other of ['RIC -; C. 306', 'RIC 12; Cohen 306']) assert.equal(citesReference(`Nero. As. ${other}.`, ric306), false, other);
  // With no volume on the card any numeral counts; with one, only that volume's, whatever edition mark it carries.
  assert.equal(citesReference('Nero. As. RIC II 306.', ric306), true);
  const volumeOne = { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)' };
  assert.equal(citesReference('Nero. As. RIC II 306.', volumeOne), false);
  assert.equal(citesReference('Nero. As. RIC I² 306.', volumeOne), true);
});

test('citesReference never reads a price line as a citation', () => {
  const price23 = { catalogue: 'Price', number: '23' };
  const price100 = { catalogue: 'Price', number: '100' };
  assert.equal(citesReference('Macedon. Tetradrachm. Price 23. Very Fine.', price23), true);
  for (const [line, reference] of [['Starting Price: 100 EUR', price100], ['Price: 100 USD', price100], ['STARTING PRICE 23 EUR', price23],
    ['Price 23 EUR', price23], ['Hammer Price 100', price100], ['Price realized 100', price100]]) {
    assert.equal(citesReference(line, reference), false, line);
  }
  // A letter in front of the number is part of another catalogue's number unless the card's own number carries it.
  assert.equal(citesReference('Macedon. Tetradrachm. Price L23.', price23), false);
  assert.equal(citesReference('Macedon. Tetradrachm. Price L23.', { catalogue: 'Price', number: 'L23' }), true);
});

// The filter judges the reference the card is about, so it may only judge a search that still looks for it: a collector who typed something else
// is looking for something else.
test('searchesReference asks whether the term still searches the card’s own citation', () => {
  const price23 = { catalogue: 'Price', number: '23' };
  assert.equal(searchesReference('"Price 23"', price23), true);
  assert.equal(searchesReference('Price 23 tetradrachm', price23), true);
  assert.equal(searchesReference('Müller 5', price23), false);
  assert.equal(referenceName(price23), 'Price 23');
  const nero = { catalogue: 'RIC', section: 'Nero', number: '306', volume: 'I (2nd edition)' };
  assert.equal(searchesReference(defaultTerm(nero), nero), true);
  assert.equal(searchesReference('Nero sestertius', nero), false);
  assert.equal(referenceName(nero), 'RIC 306');
  assert.equal(referenceName({ catalogue: 'RRC', number: '44/5' }), 'Crawford 44/5');
  // A reference with no phrase to search (an Other reference that is prose) is never filtered out of its own results.
  assert.equal(searchesReference('anything', { catalogue: 'Other', number: 'Rare', section: '' }), true);
});

// 0.32 review, round 2: the term was tested by substring, so a search for another type that begins with the same digits switched the filter on and
// judged its rows against a reference nobody searched for.
test('searchesReference reads the number as a whole token, edition mark and all', () => {
  const price23 = { catalogue: 'Price', number: '23' };
  assert.equal(searchesReference('"Price 230"', price23), false);
  assert.equal(searchesReference('Price 2300', price23), false);
  assert.equal(searchesReference('Price 23a', price23), false);
  assert.equal(searchesReference('Price 23.5 g', price23), false);
  assert.equal(searchesReference('Alexander "Price 23" Amphipolis', price23), true);
  const nero = { catalogue: 'RIC', section: 'Nero', number: '306', volume: 'I (2nd edition)' };
  assert.equal(searchesReference('Nero "RIC 3061"', nero), false);
  assert.equal(searchesReference('Nero "RIC 306"', nero), true);
  // The collector may keep the edition mark the default term leaves out; it is still his card's own citation.
  assert.equal(searchesReference('Nero "RIC I² 306"', nero), true);
  assert.equal(searchesReference('Nero "RIC² 306"', nero), true);
  // 0.33 review (R8): a collector names the ruler between the volume and the number, as dealers do, and is still searching his card's citation.
  assert.equal(searchesReference('RIC I Nero 306', nero), true);
  assert.equal(searchesReference('RIC I, Nero Claudius 306', nero), true);
  assert.equal(searchesReference('RIC I Nero 3061', nero), false);
  assert.equal(searchesReference('RIC I Nero Claudius Caesar Augustus 306', nero), false, 'a few words, not a sentence');
  assert.equal(searchesReference('RIC X Leo I 605', { catalogue: 'RIC', number: '605', volume: 'X', section: 'Leo I (East)' }), true);
  // A ruler never stands between a key and a number with no volume: "Price Alexander 23" is not how Price 23 is cited.
  assert.equal(searchesReference('Price Alexander 23', { catalogue: 'Price', number: '23' }), false);
  // 0.33 review, fix round 1: another ruler's name, or another catalogue's key, between the volume and the number is a search for another coin.
  assert.equal(searchesReference('RIC I Galba 306', nero), false);
  assert.equal(searchesReference('RIC I Cohen 306', nero), false);
  assert.equal(searchesReference('RIC I Otho, 306', nero), false);
  // The card's own ruler may stand beside another word of his name, and a word that names nobody (a mint) is no other ruler.
  assert.equal(searchesReference('RIC I Nero Augustus 306', nero), true);
  assert.equal(searchesReference('RIC I Nero Rome 306', nero), true);
  assert.equal(searchesReference('RIC I Rome 306', nero), true);
  assert.equal(searchesReference('RIC I Galba 306 RIC I Nero 306', nero), true);
  const leo = { catalogue: 'RIC', number: '605', volume: 'X', section: 'Leo I (East)' };
  assert.equal(searchesReference('RIC X Zeno 605', leo), false);
  assert.equal(searchesReference('RIC X Leo I 605', leo), true);
  // A card without a section has no ruler to hold a name against.
  assert.equal(searchesReference('RIC I Galba 306', { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)', section: '' }), true);
});

// 0.32 review, round 2: the intervening words were counted, not read. A ruler's own regnal numeral ended the match, a volume's part mark ended it,
// and another catalogue's key did not — so "RIC I, Cohen 306" was counted as a sale of RIC 306.
test('citesReference reads a ruler’s numeral, a volume part, and stops at another catalogue', () => {
  const leo = { catalogue: 'RIC', number: '605', volume: 'X', section: 'Leo I (East)' };
  assert.equal(citesReference('Leo I. Solidus. RIC X Leo I 605.', leo), true);
  assert.equal(citesReference('Constantine II. RIC VII Constantine II 12.', { catalogue: 'RIC', number: '12', volume: 'VII' }), true);
  assert.equal(citesReference('Philip I. Antoninianus. RIC IV Philip I 27.', { catalogue: 'RIC', number: '27', volume: 'IV' }), true);
  // A volume's part, however the dealer punctuates it, against a card whose volume names none.
  const severus = { catalogue: 'RIC', number: '266', volume: 'IV', section: 'Septimius Severus' };
  for (const cited of ['RIC IV-1 266', 'RIC IV/1 266', 'RIC IV, part I, 266', 'RIC IV.1 266']) {
    assert.equal(citesReference(`Septimius Severus. Denarius. ${cited}. VF.`, severus), true, cited);
  }
  assert.equal(citesReference('Aurelian. Antoninianus. RIC V/1, 12.', { catalogue: 'RIC', number: '12', volume: 'V' }), true);
  assert.equal(citesReference('Nero. As. RIC I (2) 306.', { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)' }), true);
  // A card on a volume with a part takes that part's citations, and no other's.
  const titus = { catalogue: 'RIC', number: '123', volume: 'II, Part 1 (2nd edition)', section: 'Titus' };
  for (const cited of ['RIC II, Part 1, 123', 'RIC II.1² 123', 'RIC II-1 123', 'RIC II/1 123', 'RIC II² 123']) {
    assert.equal(citesReference(`Titus. Denarius. ${cited}. VF.`, titus), true, cited);
  }
  const hadrian = { catalogue: 'RIC', number: '123', volume: 'II, Part 3 (2nd edition)', section: 'Hadrian' };
  assert.equal(citesReference('Hadrian. Denarius. RIC II.3 123.', hadrian), true);
  assert.equal(citesReference('Hadrian. Denarius. RIC II.1 123.', hadrian), false);
  // Another catalogue's key between the two ends the match: what follows is that catalogue's number, not RIC's.
  const ric306 = { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)' };
  for (const line of ['Not in RIC. Cohen 306.', 'Unlisted in RIC, BMCRE 306.', 'RIC unlisted, Cohen 306', 'RIC I, Cohen 306', 'RIC I and BMC 306']) {
    assert.equal(citesReference(line, ric306), false, line);
  }
  assert.equal(citesReference('Nero. As. RIC I Nero 306.', ric306), true);
});

// A number that turns out to be money, a measurement or a die axis is not a catalogue number, whatever key stands in front of it.
test('citesReference never reads an amount, a unit or a die axis as the number', () => {
  const price23 = { catalogue: 'Price', number: '23' };
  for (const line of ['Opening Price 23', 'Start Price 23', 'Reserve Price 23', 'Asking Price 23', 'Sale Price 23', 'Estimated Price 23',
    'Price 23 AUD', 'Price 23 Euro', 'Price 23 Euros', 'Price 23 US$', 'Price 23,- EUR', 'Price 23.- CHF', 'Price 23.00', 'Price 23,50',
    'Price 23.5 g', 'Price (23 mm)']) {
    assert.equal(citesReference(line, price23), false, line);
  }
  assert.equal(citesReference('Macedon. Tetradrachm. Price 23. Very Fine.', price23), true);
  // A number followed by "h" is the die axis a dealer prints beside the weight.
  const sc12 = { catalogue: 'SC', number: '12' };
  assert.equal(citesReference('Antiochos. AE. Rev: large SC, 12 h.', sc12), false);
  assert.equal(citesReference('Antiochos. AE. SC 12 h.', sc12), false);
  assert.equal(citesReference('Antiochos. AE. SC 12. Very Fine.', sc12), true);
});

// 0.32 review, round 3: a ".1" behind the volume numeral was read as the separator between key and number, so the part's own digit answered for the
// type number and "RIC IV.1 266" cited a card on RIC IV type 1.
test('a part glued to the volume numeral is a part, never the type number', () => {
  const ricIv1 = { catalogue: 'RIC', number: '1', volume: 'IV', section: 'Septimius Severus' };
  for (const cited of ['RIC IV.1 266', 'RIC IV-1 266', 'RIC IV/1 266']) {
    assert.equal(citesReference(`Septimius Severus. Denarius. ${cited}. VF.`, ricIv1), false, cited);
  }
  assert.equal(citesReference('Titus. Denarius. RIC II.1 123. VF.', { catalogue: 'RIC', number: '1', volume: 'II' }), false);
  // The volume's own type 1 still cites it, written with the part or without.
  assert.equal(citesReference('Septimius Severus. Denarius. RIC IV 1. VF.', ricIv1), true);
  assert.equal(citesReference('Septimius Severus. Denarius. RIC IV.1 1. VF.', ricIv1), true);
});

// 0.32 review, round 3: dealers list several types behind one key. "RIC 306,307" lost its citation to the amount rule (a comma and digits read as a
// decimal), and "RIC 305, 306" never had one, since only a dash joined two numbers.
test('citesReference reads a list of type numbers behind one key', () => {
  const ric306 = { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)' };
  for (const line of ['Nero. As. RIC 306, 307.', 'Nero. As. RIC 305, 306.', 'Nero. As. RIC 306,307.', 'Nero. As. RIC 305-306.', 'Nero. As. RIC 304, 305, 306.']) {
    assert.equal(citesReference(line, ric306), true, line);
  }
  // A decimal amount is still an amount: one or two digits behind the comma and nothing after them.
  const price23 = { catalogue: 'Price', number: '23' };
  assert.equal(citesReference('Price 23,50', price23), false);
  assert.equal(citesReference('Price 23,5', price23), false);
  assert.equal(citesReference('Price 23.00', price23), false);
});

// The timed reads below are timed in this process's CPU time, not on the wall clock. Each costs a few milliseconds; a 250 ms wall-clock budget failed
// now and then when the suites ran in parallel on a busy machine, which stretches the wall clock of a read without adding to what the read costs. The
// shapes these guard against cost seconds, and 250 ms of CPU still tells them from a loaded runner (0.33 review, H7).
const CPU_BUDGET_MS = 250;
const cpuMs = (read) => {
  const started = process.cpuUsage();
  read();
  const { user, system } = process.cpuUsage(started);
  return (user + system) / 1000;
};
// What one read costs on average, over enough reads to fill a few ticks of the CPU clock (Windows counts it in 15.6 ms steps).
const cpuPerRead = (read) => {
  const started = process.cpuUsage();
  let reads = 0;
  let spent = 0;
  while (spent < 50) {
    read();
    reads += 1;
    const { user, system } = process.cpuUsage(started);
    spent = (user + system) / 1000;
  }
  return spent / reads;
};

// 0.32 review, round 3: two adjacent separator groups behind the key split a run of them between themselves, so 'RIC ' followed by 100,000 full stops
// took 4-7 seconds. They are one group now, and a description is cut to CITATION_LIMIT characters before the pattern reads it at all.
test('a run of separators behind the key costs no more than the text it stands in', () => {
  const ric = { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)' };
  for (const text of [`RIC ${'.'.repeat(100000)}`, `RIC ${'.'.repeat(3000)}`, `RIC ${'. '.repeat(50000)}`, `RIC ${', '.repeat(50000)}306`, `RIC ${'(('.repeat(50000)}306`]) {
    const spent = cpuMs(() => citesReference(text, ric));
    assert.ok(spent < CPU_BUDGET_MS, `citesReference took ${spent} ms of CPU on ${text.length} characters`);
  }
  // Only the opening of a description is read, as the grade reader already did: what stands 10,000 characters in is a group lot's literature.
  assert.equal(citesReference(`${'x '.repeat(100)}RIC 306`, ric), true);
  assert.equal(citesReference(`${'x '.repeat(6000)}RIC 306`, ric), false);
});

// The grade reader is bounded the same way, and the worst shape the reviewer found is timed at both lengths.
test('the grade reader reads an adversarial description in one bounded pass', () => {
  for (const length of [3000, 100000]) {
    for (const shape of ['. Good Very ', '. ss-', '. Extremely Fin', 'NGC Ch VF 5/5 - ', 'Av. ss, Rs. s / vz. ', '. , : ( / ', '. sehr schön-']) {
      const text = shape.repeat(Math.ceil(length / shape.length)).slice(0, length);
      const spent = cpuMs(() => gradeOf(text));
      assert.ok(spent < CPU_BUDGET_MS, `gradeOf took ${spent} ms of CPU on ${length} characters of “${shape}”`);
    }
  }
});

// 75,000 characters of repeated lowercase marks took the reviewer's machine 948 ms, because every match sliced the description again.
test('a long description is read once and quickly', () => {
  const long = `Fine. ${'ss ss ss '.repeat(8000)}`;
  const spent = cpuMs(() => assert.equal(gradeOf(long), 'Fine and below'));
  assert.ok(spent < CPU_BUDGET_MS, `gradeOf took ${spent} ms of CPU`);
  // Only the opening of a description is read: a dealer's grade is never 3,000 characters in.
  assert.equal(gradeOf(`${'x'.repeat(4000)}. EF`), null);
  // The citation pattern is bounded in the same way: a group lot's page of literature costs no more per character than a one-line description.
  const ric = { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)' };
  for (const text of [`RIC ${'a '.repeat(30000)}306`, 'RIC I Nero '.repeat(7000), `RIC ${'3'.repeat(60000)}`, 'RIC ('.repeat(15000)]) {
    const spent = cpuMs(() => assert.equal(citesReference(text, ric), false));
    assert.ok(spent < CPU_BUDGET_MS, `citesReference took ${spent} ms of CPU`);
  }
});

// A budget alone lets a quadratic read through on a fast machine. Ten times the description may cost at most thirty times as much: a read that grows
// with the text passes with room to spare, and one that reads the description again at every match, as the 948 ms shape did, costs a hundred times.
test('the grade reader costs no more per character on a long description than on a short one', () => {
  const read = (repeats) => {
    const text = `Fine. ${'ss ss ss '.repeat(repeats)}`;
    gradeOf(text);
    return Math.min(...[1, 2, 3].map(() => cpuPerRead(() => gradeOf(text))));
  };
  const short = read(800);
  const long = read(8000);
  assert.ok(long < 30 * short, `gradeOf took ${long.toFixed(2)} ms of CPU at 8000 repeats, ${short.toFixed(2)} ms at 800`);
});

test('namesDenomination matches the card word as a whole word, plural tolerated', () => {
  assert.equal(namesDenomination('Nero. AR denarius, Rome.', 'denarius'), true);
  assert.equal(namesDenomination('Group of three denarii.', 'denarius'), true);
  assert.equal(namesDenomination('Nero. AR Denarius.', 'Denarius'), true);
  assert.equal(namesDenomination('Nero. Sestertius, Rome.', 'denarius'), false);
  assert.equal(namesDenomination('Drachms of Amphipolis.', 'drachm'), true);
  assert.equal(namesDenomination('A denariusish thing.', 'denarius'), false);
  // Positive match only: a row with nothing to read does not name it, and a card with no denomination filters nothing.
  assert.equal(namesDenomination('', 'denarius'), false);
  assert.equal(namesDenomination('Nero. Sestertius.', ''), true);
});

test('gradeOf reads the dealer grade into one of four buckets, the lower of two', () => {
  assert.equal(gradeOf('Nero. As. RIC 306. Very Fine, dark patina.'), 'VF');
  assert.equal(gradeOf('Good very fine, lightly toned.'), 'VF');
  assert.equal(gradeOf('Extremely Fine, minor marks.'), 'EF');
  // A slab's own grading line, scores and all.
  assert.equal(gradeOf('NGC Choice VF 5/5 - 4/5.'), 'VF');
  assert.equal(gradeOf('gVF'), 'VF');
  assert.equal(gradeOf('VF/EF'), 'VF');
  // Consciously changed in round 3: bare "Fine" never stands in front of a comma opening a lower-case adjective and its noun, which is what tells
  // "Fine, high-relief portrait" from a grade. "Fine, porous" — one word, no noun — is still the grade.
  assert.equal(gradeOf('Fine, rough surfaces.'), null);
  assert.equal(gradeOf('Fine, porous.'), 'Fine and below');
  assert.equal(gradeOf('FDC.'), 'AU/Mint State');
  assert.equal(gradeOf('Mint State, fully lustrous.'), 'AU/Mint State');
  // German, French and Italian grades.
  assert.equal(gradeOf('Schoene Patina. ss-vz.'), 'VF');
  assert.equal(gradeOf('Erhaltung: st'), 'AU/Mint State');
  assert.equal(gradeOf('Herrliche Patina, vorzüglich.'), 'EF');
  assert.equal(gradeOf('Belle patine. TTB.'), 'VF');
  assert.equal(gradeOf('Patina verde. SPL.'), 'EF');
  assert.equal(gradeOf('Stempelglanz.'), 'AU/Mint State');
  // A two-letter lowercase token is a grade only as a clause of its own; "fine style" is not a grade at all.
  assert.equal(gradeOf('Die Erhaltung ist gut, ss ist untertrieben, schaut selbst'), null);
  assert.equal(gradeOf('Of fine style, some wear.'), null);
  assert.equal(gradeOf('Nero. As. RIC 306.'), null);
  assert.equal(gradeOf(''), null);
});

// "AU" is the chemical symbol for gold as often as it is "About Uncirculated", and a gold lot that says so was being counted in the top bucket
// without a dealer ever grading it. A metal says what the coin is made of: the weight or diameter printed straight behind it, the bracket it stands
// in behind "Gold", and the denomination it follows are the three shapes that say which of the two it is.
test('gradeOf reads AU as the metal where the lot says gold, and as the grade everywhere else', () => {
  for (const text of ['Solidus. AU 4.45 g.', 'Aureus. AU, 7.25 g.', 'Gold (AU) solidus', 'AU 21 mm.', 'Tremissis. AU 1.48 g, 15 mm.',
    'Byzantine. Solidus. AU.']) {
    assert.equal(gradeOf(text), null, text);
  }
  // The grade is untouched wherever the lot is not saying gold: a slab's own line, the spelled-out name, a range, and the die axis a dealer prints
  // behind a grade, which is no weight at all.
  for (const [text, bucket] of [['NGC AU 58', 'AU/Mint State'], ['About Uncirculated', 'AU/Mint State'], ['AU', 'AU/Mint State'],
    ['Choice AU', 'AU/Mint State'], ['AU/EF', 'EF'], ['AU - EF.', 'EF'], ['AU 12 h.', 'AU/Mint State'],
    ['Nero. AR Denarius. NGC AU 5/5.', 'AU/Mint State'], ['Solidus. NGC AU 58', 'AU/Mint State']]) {
    assert.equal(gradeOf(text), bucket, text);
  }
});

// 0.32 review: the dealer's prose was read as a grade. "a fine portrait" and "as fine as any" are the adjective, "the BB collection" is a name, and
// the lower-of-two rule then put every one of those lots in the wrong bucket. A grade is a clause of its own or it is not a grade.
test('gradeOf reads a grade only where a dealer writes one: at a clause edge', () => {
  assert.equal(gradeOf('An attractive example with a fine portrait. Good very fine.'), 'VF');
  assert.equal(gradeOf('Extremely Fine, with a fine old cabinet tone.'), 'EF');
  assert.equal(gradeOf('A portrait as fine as any. EF'), 'EF');
  assert.equal(gradeOf('From the BB collection. EF'), 'EF');
  // The clause rule replaces the end-of-description rule for the German, French and Italian marks.
  assert.equal(gradeOf('Schöne Patina. ss. Aus Sammlung Müller.'), 'VF');
  assert.equal(gradeOf('ss, R!'), 'VF');
  assert.equal(gradeOf('ss+'), 'VF');
  assert.equal(gradeOf('Er ist stolz'), null);
  assert.equal(gradeOf('Kassel'), null);
  // A name needs the capitals dealers give it; an abbreviation needs its own, which is all that tells it from an ordinary word.
  for (const graded of [['Fine', 'Fine and below'], ['Very Fine', 'VF'], ['Very fine', 'VF'], ['Good very fine', 'VF'], ['Good VF', 'VF'],
    ['About EF', 'EF'], ['Extremely fine', 'EF'], ['vorzüglich', 'EF'], ['Vorzüglich', 'EF']]) {
    assert.equal(gradeOf(graded[0]), graded[1], graded[0]);
  }
  // A bare lower-case name is the ordinary adjective; issue #6 gives a qualified one ("good very fine") a grade's standing, tested below.
  for (const prose of ['fine', 'very fine', 'a fine coin', 'vf', 'ef', 'fdc']) assert.equal(gradeOf(prose), null, prose);
  // Split grades still go to the lower bucket.
  assert.equal(gradeOf('Erhaltung: ss-vz.'), 'VF');
  assert.equal(gradeOf('(VF/EF)'), 'VF');
});

// 0.32 review, round 2: the clause rule wanted both edges and knew two qualifiers, so it ungraded the commonest house styles ("Near EF", "Choice EF",
// "Fast vorzüglich", a slab line, "Very Fine and rare"). The closing edge is what tells a grade from prose; in front of it a closed list of qualifiers
// carries the bucket through.
test('gradeOf reads the qualifiers, slab lines and closing edges dealers write', () => {
  const graded = [
    ['Near EF.', 'EF'], ['Nearly Extremely Fine.', 'EF'], ['Almost Very Fine.', 'VF'], ['About Very Fine.', 'VF'],
    ['Choice EF.', 'EF'], ['Superb EF.', 'EF'], ['Nice VF.', 'VF'], ['Toned VF.', 'VF'],
    ['A few light marks, otherwise EF.', 'EF'], ['Minor porosity, otherwise Very Fine.', 'VF'],
    ['Fast vorzüglich.', 'EF'], ['Gutes sehr schön.', 'VF'], ['Fast sehr schön.', 'VF'], ['Knapp sehr schön.', 'VF'], ['fast vz.', 'EF'], ['Buon BB.', 'VF'],
    // A slab's own line: the grade, then its strike and surface scores.
    ['NGC Choice VF 5/5 - 4/5', 'VF'], ['NGC MS 5/5 - 4/5, Fine Style', 'AU/Mint State'], ['NGC XF 4/5', 'EF'], ['NGC Ch VF', 'VF'], ['MS 63', 'AU/Mint State'],
    // The closing edges: a dash, a bracket, a conjunction, a preposition, the French "à", a plus.
    ['Very Fine and rare.', 'VF'], ['Very Fine & Rare.', 'VF'], ['Very Fine - Extremely Fine.', 'VF'], ['VF - EF.', 'VF'],
    ['VF (scratch).', 'VF'], ['Very Fine (light scratches).', 'VF'], ['Extremely Fine for the issue.', 'EF'], ['EF with luster.', 'EF'],
    ['Sehr schön +.', 'VF'], ['TTB à SUP.', 'VF'], ['TB à TTB.', 'Fine and below'],
    // Both sides graded: the lower of the two, as any other pair of grades.
    ['Obverse VF, reverse Fine.', 'Fine and below'],
  ];
  for (const [text, bucket] of graded) assert.equal(gradeOf(text), bucket, text);
  // The prose the clause rule was written for stays prose, and a slab's "Fine Style" is a die engraver's compliment, not a grade.
  assert.equal(gradeOf('An attractive example with a fine portrait. Good very fine.'), 'VF');
  assert.equal(gradeOf('A portrait as fine as any. EF'), 'EF');
  assert.equal(gradeOf('From the BB collection. EF'), 'EF');
  assert.equal(gradeOf('EF, Fine Style'), 'EF');
});

// Issue #6: "AU" ("About Uncirculated") is the American trade's grade between EF and Mint State, and a whole house style writes nothing else. It has
// no bucket of its own, so the decision is that it counts in the top one, which is what that bucket is now labelled. Left unplaced it ungraded every
// such row, and a range that opened with it ("AU/EF") had no statement of its own for the second grade to join.
test('gradeOf counts AU in the top bucket', () => {
  for (const [text, bucket] of [['AU', 'AU/Mint State'], ['AU.', 'AU/Mint State'], ['About Uncirculated', 'AU/Mint State'],
    ['Choice AU', 'AU/Mint State'], ['NGC AU 5/5 - 4/5', 'AU/Mint State'], ['NGC AU 58', 'AU/Mint State'],
    ['Nero. AR Denarius. NGC AU 5/5.', 'AU/Mint State'], ['NGC Choice AU★ 5/5 - 5/5, Fine Style.', 'AU/Mint State'],
    // A range that opens with AU is the lower of the two, as any other pair.
    ['AU/EF', 'EF'], ['AU - EF.', 'EF']]) {
    assert.equal(gradeOf(text), bucket, text);
  }
  // The qualifier still keeps "About Uncirculated" from reading as "Uncirculated", and the top bucket is still one bucket.
  assert.equal(GRADE_BUCKETS.length, 4);
  assert.equal(GRADE_BUCKETS.at(-1), 'AU/Mint State');
});

// Issue #6: a closing edge is what tells a grade from prose, and a dealer closes one with more than a full stop — the quotes he wraps it in, the
// asterisk or star he hangs a footnote on, and the "though" his reservation opens with.
test('gradeOf reads the quote, star and "though" a dealer closes a grade with', () => {
  for (const [text, bucket] of [['"Good VF"', 'VF'], ['“EF”', 'EF'], ['Nero. As. RIC 306. "Very Fine"', 'VF'],
    ['VF*', 'VF'], ['EF★', 'EF'], ['Schöne Patina. ss*', 'VF'],
    ['Extremely Fine though weakly struck.', 'EF'], ['Good VF though off-centre.', 'VF'], ['ss, though schwach ausgeprägt.', 'VF']]) {
    assert.equal(gradeOf(text), bucket, text);
  }
  // A quote closes a grade; it does not open one, and it lends the prose inside it nothing.
  assert.equal(gradeOf('A "fine" portrait.'), null);
  assert.equal(gradeOf('Ex "MS" collection.'), null);
});

// Issue #6: a name spelled out needs a capital somewhere, since "very fine" is the ordinary adjective — but a dealer who qualifies it is grading the
// coin whatever his capitals, and "Flan crack, otherwise very fine" was the commonest description the reader left ungraded.
test('gradeOf reads a lower-case grade name behind a lower-case qualifier', () => {
  for (const [text, bucket] of [['otherwise very fine', 'VF'], ['Flan crack, otherwise very fine.', 'VF'],
    ['nearly extremely fine', 'EF'], ['Flan crack, otherwise nearly extremely fine.', 'EF'],
    ['Flan crack, otherwise good very fine', 'VF'], ['about uncirculated with luster', 'AU/Mint State']]) {
    assert.equal(gradeOf(text), bucket, text);
  }
  // Without the qualifier it is the adjective again, and with one it still needs its closing edge.
  assert.equal(gradeOf('Some corrosion, very fine portrait.'), null);
  assert.equal(gradeOf('a nearly extremely fine example of the type'), null);
});

// Issue #6: the Italian trade qualifies its marks with a letter glued to the front — "q" for quasi, "m" for migliore di — and with a plus. Each keeps
// the bucket of the mark it qualifies, exactly as "gVF" keeps VF's.
test('gradeOf reads the Italian qualified marks', () => {
  for (const [text, bucket] of [['qBB', 'VF'], ['q.BB', 'VF'], ['qSPL', 'EF'], ['qFDC', 'AU/Mint State'],
    ['BB+', 'VF'], ['SPL+', 'EF'], ['mBB', 'VF'], ['Bella patina. mBB.', 'VF'], ['Moneta con patina, BB+.', 'VF'],
    ['Roma. Sesterzio. RIC 306. qSPL', 'EF']]) {
    assert.equal(gradeOf(text), bucket, text);
  }
  // The "m" is read in lower case and only in front of a capital, so a manuscript and a monogram keep their own letters.
  assert.equal(gradeOf('Vgl. mss. Kommentar.'), null);
  assert.equal(gradeOf('Monogramma mBB nel campo.'), null);
});

// Issue #6: a house that prints the coin's weight, diameter or die axis behind the grade ("VF 3.41 g", "Fine 12 h.") closes the grade with it. The
// number alone closes nothing: "Slg. vz 12." is a collection and its lot number, and that is the shape this rule must not read.
test('gradeOf reads a grade the weight or die axis follows, and not a lot number', () => {
  for (const [text, bucket] of [['VF 3.41 g', 'VF'], ['Fine 12 h.', 'Fine and below'], ['VF 17.23 g, 18 mm, 6 h.', 'VF'],
    ['Nero. Denarius. RIC 306. VF 3.41 g', 'VF'], ['ss 3,41 g', 'VF'], ['EF 18mm', 'EF']]) {
    assert.equal(gradeOf(text), bucket, text);
  }
  assert.equal(gradeOf('Slg. vz 12.'), null);
  assert.equal(gradeOf('Ex Slg. MS 63.'), null);
  assert.equal(gradeOf('Fine 12.'), null);
});

// "s." is German for "siehe", see: a lot references a comment, a catalogue or a plate with it in nearly every German description, and as the lower of
// two grades it took every one of those lots down to Fine.
test('gradeOf reads the German "s." as see, never as a grade of its own', () => {
  assert.equal(gradeOf('Selten, s. Kommentar. vz'), 'EF');
  assert.equal(gradeOf('Aus Sammlung Müller, s. Auktion 12. Vorzüglich.'), 'EF');
  assert.equal(gradeOf('Vgl. RIC 306 (s. Anm.). ss'), 'VF');
  assert.equal(gradeOf('Ex Slg. X (s. o.). vz'), 'EF');
  assert.equal(gradeOf('Rs. Adler n. r., s. RIC 12. ss.'), 'VF');
  // Inside a range with another mark, or right behind "Erhaltung", it is the grade schön.
  assert.equal(gradeOf('Nero. Denar. RIC 306. s-ss'), 'Fine and below');
  assert.equal(gradeOf('s/ss'), 'Fine and below');
  assert.equal(gradeOf('Erhaltung: s'), 'Fine and below');
});

// Loop N5: whole houses grade in spellings the reader did not know, so their rows fell out of every grade median: NAC's mixed-case "Fdc", the British
// "GVF"/"GEF"/"NEF"/"NVF", German "Stgl." and "prfr.", Austrian "prägefrisch", the American "BU", "aUNC" and "Gem MS", Italian "Spl", Spanish "S/C",
// German "sge" and English "Fair". Each is read in the class whose edges fit it, and each keeps out of the prose it could be mistaken for.
test('gradeOf reads the house spellings of NAC, Baldwin’s, Künker, Rauch, Heritage, Artemide, Áureo and Gorny', () => {
  for (const [text, bucket] of [
    ['Virtually as struck and Fdc', 'AU/Mint State'], ['Rare. Fdc.', 'AU/Mint State'], ['Extremely fine / Fdc', 'EF'],
    ['Toned, GVF.', 'VF'], ['Attractive, GEF, rare.', 'EF'], ['NEF with some lustre', 'EF'], ['Some porosity, NVF.', 'VF'], ['Toned, nEF.', 'EF'],
    ['Toned, nVF.', 'VF'], ['GVF/GEF', 'VF'],
    ['RIC 53. 3,42 g. Stgl.', 'AU/Mint State'], ['Feine Tönung. Stgl', 'AU/Mint State'], ['fast Stgl.', 'AU/Mint State'], ['f.Stgl.', 'AU/Mint State'],
    ['vz-Stgl.', 'EF'], ['Feine Tönung, prfr.', 'AU/Mint State'], ['Herrliche Tönung, prägefrisch.', 'AU/Mint State'], ['Fast prägefrisch.', 'AU/Mint State'],
    ['BU, prooflike', 'AU/Mint State'], ['Choice BU.', 'AU/Mint State'], ['aUNC.', 'AU/Mint State'], ['AUNC', 'AU/Mint State'],
    ['NGC Gem MS 5/5 - 5/5', 'AU/Mint State'], ['Brilliant Uncirculated.', 'AU/Mint State'],
    ['Bella patina. Spl', 'EF'], ['qSpl.', 'EF'], ['BB/Spl', 'VF'],
    ['S/C. Brillo original.', 'AU/Mint State'], ['EBC/S/C', 'EF'],
    ['Schöne Patina, sge', 'Fine and below'], ['sge-s', 'Fine and below'], ['sge/ss', 'Fine and below'],
    ['Fair, worn.', 'Fine and below'], ['Fair to Fine', 'Fine and below'], ['Pitted. Fair.', 'Fine and below']]) {
    assert.equal(gradeOf(text), bucket, text);
  }
  // None of them reads the prose, the monogram, the senate's mark or the collection it could be taken for.
  for (const prose of ['A fair portrait.', 'Fair Lawn collection. Unread.', 'Ex Fair collection', 'fair', 'Of Fair style',
    'Rev. BU monogram in field.', 'Ex BU collection.', 'Cohen 302 (BU).', 'control: BU.',
    'Rev. Spes advancing left. S/C.', 'Rev. S/C, legend around.', 'SC (unlisted)', 'S/C (unlisted)',
    'Splendido esemplare.', 'Gemma incisa. Pubblicato.', 'Gem of a portrait.', 'fdc', 'gvf', 'Stglanz', 'prägefrischer Glanz']) {
    assert.equal(gradeOf(prose), null, prose);
  }
  // Loop N5 review: Áureo & Calicó write S/C behind the weight or a closing remark, a German grade sentence opens "Prfr.", Heritage writes "Gem BU",
  // and a Spanish lot labels its grade "Conservación:". A remark outside the closed list, or a described reverse, still leaves S/C the senate's.
  for (const [text, bucket] of [['Felipe II. 1589. Sevilla. B. 8 reales. (Cal. 690). 27,23 g. S/C.', 'AU/Mint State'],
    ['Felipe II. 8 reales. 27,23 g. S/C.', 'AU/Mint State'], ['Felipe II. 8 reales. Brillo original. S/C.', 'AU/Mint State'],
    ['Felipe II. 8 reales. Muy bella. S/C.', 'AU/Mint State'], ['Felipe II. 8 reales. Bonita pátina. S/C.', 'AU/Mint State'],
    ['Nero. Denar. Prfr.', 'AU/Mint State'], ['Morgan Dollar. Gem BU.', 'AU/Mint State'], ['Conservación: S/C', 'AU/Mint State'],
    ['Conservación: EBC', 'EF']]) {
    assert.equal(gradeOf(text), bucket, text);
  }
  for (const prose of ['Rev.: Roma sentada. S/C.', 'Rev. Victory standing. 10,85 g. Rev. S/C.', 'Felipe II. 8 reales. Victoria alada. S/C.', 'Gem BUlk lot']) {
    assert.equal(gradeOf(prose), null, prose);
  }
  // A new spelling joins the others exactly as the old ones do: the grade still counted is the dealer's last statement, and a labelled one wins.
  assert.equal(gradeOf('Ex Fair collection. GVF.'), 'VF');
  assert.equal(gradeOf('Erhaltung: Stgl. Notes: vz for the type'), 'AU/Mint State');
});

// 0.32 review, round 3: three rounds of patching the reader traded one class of error for another, so it was redesigned against a corpus instead of
// patched again. Every description the reviewer's probes and the report's own tables name is in the corpus with the bucket the design reads it into;
// a row the design cannot read carries null there, and its note says why. A wrong bucket is what this guards against — an ungraded row is not one.
test('every description in the grade corpus reads into the bucket the corpus records', () => {
  const corpus = JSON.parse(fixture('grade-corpus.json'));
  const buckets = { fine: 'Fine and below', vf: 'VF', ef: 'EF', mint: 'AU/Mint State' };
  const disagreements = corpus.flatMap((row) => {
    const wanted = row.grade === null ? null : buckets[row.grade];
    const read = gradeOf(row.text);
    return read === wanted ? [] : [`${JSON.stringify(row.text)}: corpus ${wanted}, read ${read} — ${row.note}`];
  });
  for (const line of disagreements) console.log(line);
  assert.equal(disagreements.length, 0, `${disagreements.length} of ${corpus.length} corpus rows disagree`);
});

test('filterableDenomination offers only a label that can be matched as a word', () => {
  assert.equal(filterableDenomination('Denarius'), 'denarius');
  assert.equal(filterableDenomination(' Tetradrachm '), 'tetradrachm');
  // "as" is the English word as often as the coin, and nothing shorter than four letters reads any better.
  assert.equal(filterableDenomination('As'), '');
  assert.equal(filterableDenomination('AE'), '');
  // An unresolved slug is no word at all.
  assert.equal(filterableDenomination('266_aureus'), '');
  assert.equal(filterableDenomination('AE 3'), '');
  assert.equal(filterableDenomination(''), '');
  assert.equal(filterableDenomination(null), '');
});

// acsearch's account menu links to the login page from every page of the site, so the address is relative on one and absolute on another.
test('signedOutPage reads the login link wherever the page keeps it', () => {
  const hidden = [lot('*', '01.01.2024', 'a')];
  for (const href of ['login.html', '/login.html', 'https://www.acsearch.info/login.html', '/en/login.html?next=search']) {
    assert.equal(signedOutPage(`<nav><a href="${href}"><span>Log in</span></a></nav>`, hidden, NOW), true, href);
  }
  // Not the marker, and a lot that has yet to be sold: the stars are no longer evidence of anything.
  assert.equal(signedOutPage('<a href="/prelogin.htmlx">x</a>', [...hidden, lot('*', '01.06.2028', 'c')], NOW), false);
});

test('gradeMedians reports only a bucket resting on at least three counted sales', () => {
  const graded = (price, grade, id) => lot(price, '01.01.2024', id, `Nero. As. RIC 306. ${grade}`);
  const lots = [graded('100', 'Very Fine', 'a'), graded('200', 'gVF', 'b'), graded('300', 'VF', 'c'), graded('*', 'VF', 'd'),
    graded('900', 'Extremely Fine', 'e'), graded('1100', 'EF', 'f')];
  assert.deepEqual(gradeMedians(lots, 'USD'), [{ bucket: 'VF', median: 200, count: 3 }]);
  assert.deepEqual(gradeMedians([], 'USD'), []);
  // Loop P-09: the figure between the bucket and its count, one separator throughout, the count as sales.
  assert.equal(gradeText({ bucket: 'VF', median: 180, count: 9 }, usd), 'VF · $180 · 9 sales');
  assert.equal(gradeText({ bucket: 'AU/Mint State', median: 1200, count: 1 }, usd), 'AU/Mint State · $1,200 · 1 sale');
  // What the buckets leave unsaid: a row the dealer graded nothing at all.
  const plain = lot('400', '01.01.2024', 'g', 'Nero. As. RIC 306.');
  assert.equal(ungradedText([...lots, plain]), '1 of 7 results carry no grade');
  assert.equal(ungradedText([plain]), '1 of 1 result carries no grade');
  assert.equal(ungradedText(lots), '');
});

// A description was read four times over at every redraw, once per bucket. The page reads it once, when it arrives, and the grade travels with the lot.
test('the grade is read once, when the page is read', async () => {
  const page = (lots) => `<script>acsearch.initSearchResults = ${JSON.stringify(lots)};</script>`;
  const lots = [lot('100', '01.01.2024', '1', 'Nero. As. RIC 306. Very Fine.'), lot('300', '01.01.2024', '2', 'Nero. As. RIC 306.')];
  const ok = await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page(lots)) });
  assert.deepEqual(ok.lots.map((entry) => entry.grade), ['VF', null]);
  // gradeMedians counts the grade the page read, never the description again.
  const carried = ['100', '200', '300'].map((price, index) => ({ ...lot(price, '01.01.2024', String(index), 'Fine.'), grade: 'EF' }));
  assert.deepEqual(gradeMedians(carried, 'USD'), [{ bucket: 'EF', median: 200, count: 3 }]);
});

// The filters leave a row out of the statistics by default and say why; the collector may still count it by hand, and Reset restores the default.
test('curation drops a row the filters name, until the collector says otherwise', () => {
  const cited = lot('100', '01.01.2024', 'a', 'Nero. As. RIC 306. VF');
  const stranger = lot('300', '01.01.2024', 'b', 'Nero. Dupondius. RIC 3061. VF');
  const lots = [cited, stranger];
  const curation = createPriceCuration();
  curation.filter((entry) => (citesReference(entry.description, { catalogue: 'RIC', number: '306' }) ? null : 'not-cited'));
  assert.equal(curation.reasonFor(stranger), 'not-cited');
  assert.equal(curation.reasonFor(cited), null);
  assert.deepEqual(curation.counts(lots), { included: 1, excluded: 1 });
  assert.equal(summarise(curation.included(lots), 'USD').median, 100);
  curation.include(stranger);
  assert.equal(curation.reasonFor(stranger), null);
  assert.equal(summarise(curation.included(lots), 'USD').median, 200);
  curation.exclude(cited);
  assert.equal(curation.reasonFor(cited), 'by-hand');
  assert.equal(curation.changed(), true);
  curation.reset();
  assert.equal(curation.changed(), false);
  assert.deepEqual(curation.counts(lots), { included: 1, excluded: 1 });
  assert.equal(curation.reasonFor(stranger), 'not-cited');
});

test('summaryText carries what the filters left out and the median of each grade', () => {
  const summary = summarise([lot('100', '01.01.2024', 'a'), lot('300', '01.01.2024', 'b')], 'USD');
  // The lines the panel shows, in the panel's own words: the filter counts name the reference, and the grade medians say what they leave unsaid.
  const extras = { filters: ['39 of 55 results cite Price 23'], grades: [{ bucket: 'VF', median: 180, count: 9 }, { bucket: 'EF', median: 400, count: 3 }],
    ungraded: '27 of 39 results carry no grade' };
  assert.deepEqual(summaryText({ label: 'Price 23' }, summary, 'USD', '"Price 23"', extras).split('\n').slice(2), [
    '39 of 55 results cite Price 23',
    `VF · ${copied(180)} · 9 sales`,
    `EF · ${copied(400)} · 3 sales`,
    '27 of 39 results carry no grade',
  ]);
});

// 0.33 review (R7): the Spanish "SC" (sin circular) is the key Seleucid Coins is cited under, too. A grade mark is never a citation, and a citation is
// never a grade: each is read only where it stands as itself.
test('SC reads as a grade only where no number follows it, and cites Seleucid Coins only with its number', () => {
  const seleucid = { catalogue: 'SC', number: '379.1' };
  const graded = 'Seleucid Kings. Antiochos I. Tetradrachm. SC 379.1. SC.';
  assert.equal(citesReference(graded, seleucid), true);
  assert.equal(gradeOf(graded), 'AU/Mint State');
  assert.equal(gradeOf('Seleucid Kings. Antiochos I. Tetradrachm. SC 379.1.'), null);
  assert.equal(gradeOf('SC 379.1; ESM 123. EBC.'), 'EF');
  assert.equal(citesReference('Seleucid Kings. Antiochos I. Tetradrachm. EBC/SC.', seleucid), false);
  // The senate's mark on a Roman bronze is neither.
  assert.equal(gradeOf('Rev. SC, legend around.'), null);
  assert.equal(gradeOf('Rev. Minerva standing right; SC.'), null);
});

// 0.33 review (R11): the copied summary wrapped a term that carries its own quotes in a second pair, as the panel had stopped doing.
test('summaryText quotes the search term as the panel does', () => {
  const summary = summarise([lot('100', '01.01.2024', 'a')], 'USD');
  assert.match(summaryText({ label: 'Price 23' }, summary, 'USD', '"Price 23"').split('\n')[1], /matching "Price 23" · 2024$/);
  assert.match(summaryText({ label: 'RIC 306' }, summary, 'USD', 'Nero ("RIC 306" "RIC I 306")').split('\n')[1], /matching Nero \("RIC 306" "RIC I 306"\) · 2024$/);
  assert.match(summaryText({ label: 'Nero 306' }, summary, 'USD', 'Nero 306').split('\n')[1], /matching “Nero 306” · 2024$/);
});

// 0.33 review (R11): Bopearachchi is cited "Bop. 24A" and, by French dealers, "Bopearachchi Série 24A"; neither was searched nor counted.
test('a Bop reference searches and counts the short key and the French series word', () => {
  const euthydemus = { catalogue: 'Bop', section: 'Euthydemus I', number: 'Bop 24a' };
  assert.equal(defaultTerm(euthydemus), '(Euthydemus Euthydemos) ("Bopearachchi 24A" "Bop 24A" "Bopearachchi Série 24A")');
  assert.equal(referenceName(euthydemus), 'Bopearachchi 24A');
  assert.equal(coinArchivesTerm(euthydemus), 'Euthydemus "Bopearachchi 24A"');
  // The 0.32 default a collector may have saved counts as unsaved, so it gives way to the new one.
  assert.equal(chooseTerm(euthydemus, '(Euthydemus Euthydemos) "Bopearachchi 24A"'), defaultTerm(euthydemus));
  for (const cited of ['Euthydemus I. Tetradrachm. Bop. 24A.', 'Bop 24a.', 'BOP 24A', 'Bopearachchi Série 24A.', 'Bopearachchi, série 24A.']) {
    assert.equal(citesReference(cited, euthydemus), true, cited);
  }
  for (const other of ['Bop. 24B.', 'Bop. 124A.', 'Bopearachchi Série 24.']) assert.equal(citesReference(other, euthydemus), false, other);
  assert.equal(searchesReference('Euthydemus "Bop 24A"', euthydemus), true);
});

// 0.33 review (R11): three more ways a RIC I citation is written.
test('citesReference reads "(2nd ed.)", "vol. I" and the volume as a digit on a volume I card', () => {
  const nero = { catalogue: 'RIC', section: 'Nero', number: '306', volume: 'I (2nd edition)' };
  for (const cited of ['Nero. As. RIC I (2nd ed.) 306.', 'RIC I (2nd edition) 306', 'RIC vol. I 306.', 'RIC Vol I, 306', 'Nero. As. RIC 1 306.']) {
    assert.equal(citesReference(cited, nero), true, cited);
  }
  assert.equal(citesReference('RIC vol. II 306.', nero), false);
  assert.equal(citesReference('RIC 1 3061.', nero), false);
  // A digit stands for the volume only on a volume I card: "RIC 2 306" could as well be the second edition of volume I.
  assert.equal(citesReference('RIC 2 306.', { catalogue: 'RIC', number: '306', volume: 'II' }), false);
});

// 0.33 review (R11): a slab prints its score straight behind the grade as often as with a space.
test('gradeOf reads a slab grade glued to its score, and only behind a slabber', () => {
  assert.equal(gradeOf('PCGS MS63'), 'AU/Mint State');
  assert.equal(gradeOf('NGC AU58'), 'AU/Mint State');
  assert.equal(gradeOf('NGC XF45. Strike 5/5.'), 'EF');
  assert.equal(gradeOf('Slg. MS63.'), null);
  assert.equal(gradeOf('Ex Slg. vz12.'), null);
});

// A stop after an abbreviated key is the dealer's own spelling of the same citation, not a search for another coin.
test('a hand-typed "Bop. 24A" still searches the Bopearachchi card', () => {
  const bop = { catalogue: 'Bop', number: '24A', section: 'Euthydemus I', volume: '' };
  assert.equal(searchesReference('Bop. 24A', bop), true);
  assert.equal(searchesReference('Bop. 24B', bop), false);
});

// 0.34 (I2): the lots acsearch lists that have not been sold yet, as the Upcoming list shows them.
test('upcomingLots keeps the unpriced lots dated today or later in the collector’s own day, soonest first', () => {
  // Noon on 11 September, local time: the collector's day is the 11th wherever the test runs.
  const now = new Date(2026, 8, 11, 12);
  const lots = [lot('*', '10.09.2026', 'yesterday'), lot('*', '11.09.2026 18:00', 'today'), lot('*', '2026-10-12', 'october'),
    lot('', '01.12.2026', 'blank'), lot('250', '12.10.2026', 'priced'), lot('*', 'n/a', 'undated'), lot('*', '12.10.2026', 'october-2'),
    lot('*', '31.02.2027', 'no-such-day'), lot('200', '11.09.2026', 'sold-today')];
  // A priced row dated after today is not sold either (loop N11): its figure is a starting price, and it is listed. One priced today was sold.
  assert.deepEqual(upcomingLots(lots, now).map((entry) => entry.id), ['today', 'october', 'priced', 'october-2', 'blank']);
  assert.deepEqual(upcomingLots([], now), []);
});

test('upcomingText counts the lots and names the first sale day, date only, in the locale it is given', () => {
  const now = new Date(2026, 8, 11, 12);
  const lots = upcomingLots([lot('*', '12.10.2026 14:00', 'a'), lot('*', '2026-09-30', 'b'), lot('*', '01.12.2026', 'c')], now);
  assert.equal(upcomingText(lots, 'en-US'), 'Upcoming: 3 lots, first on Wed, Sep 30, 2026');
  assert.equal(upcomingText(lots.slice(-1), 'en-US'), 'Upcoming: 1 lot, first on Tue, Dec 1, 2026');
  assert.equal(upcomingText([]), '');
  assert.equal(isoDay('28.07.2026 14:00'), '2026-07-28');
  assert.equal(isoDay('n/a'), '');
});

test('summaryText adds the upcoming lots', () => {
  const card = { label: 'Price 23', corpus: 'pella', id: 'price.23' };
  const summary = summarise([lot('100', '01.01.2023', 'a')], 'USD');
  const upcoming = upcomingLots([lot('*', '12.10.2026', 'u1'), lot('*', '01.11.2026', 'u2')], new Date(2026, 8, 11, 12));
  assert.equal(summaryText(card, summary, 'USD', 'Price 23', { upcoming }).split('\n')[2], 'Upcoming: 2 lots, first on Mon, Oct 12, 2026');
  assert.equal(summaryText(card, summary, 'USD', 'Price 23', { upcoming: [] }).split('\n').length, 3);
});
test('mediansByYear gives a median per year of at least three counted sales, oldest first', () => {
  const lots = [lot('100', '01.01.2023', 'a'), lot('200', '2023-06-01', 'b'), lot('300', '31.12.2023', 'c'),
    lot('400', '01.01.2024', 'd'), lot('500', '01.02.2024', 'e'),
    lot('90', '01.01.2021', 'f'), lot('110', '01.02.2021', 'g'), lot('130', '01.03.2021', 'h'), lot('150', '01.04.2021', 'i'),
    // Not a counted sale: no price, another currency, no readable date.
    lot('*', '01.05.2021', 'j'), lot('200 EUR', '01.05.2023', 'k'), lot('1000', 'n/a', 'l'), lot('1000', '', 'l2'), lot('1000', '2023', 'l3')];
  assert.deepEqual(mediansByYear(lots, 'USD'), [{ year: 2021, median: 120, count: 4 }, { year: 2023, median: 200, count: 3 }]);
  assert.deepEqual(mediansByYear(lots.slice(3, 5), 'USD'), []);
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;
  assert.equal(yearText({ year: 2021, median: 120, count: 4 }, usd), '2021 · $120 · 4 sales');
  assert.equal(yearsSentence(mediansByYear(lots, 'USD'), usd), 'Median by year: 2021, $120 from 4 sales; 2023, $200 from 3 sales.');
  assert.equal(yearsSentence([], usd), '');
});

test('summaryText adds the medians by year and the upcoming lots', () => {
  const card = { label: 'Price 23', corpus: 'pella', id: 'price.23' };
  const lots = [lot('100', '01.01.2023', 'a'), lot('200', '01.02.2023', 'b'), lot('300', '01.03.2023', 'c')];
  const summary = summarise(lots, 'USD');
  const upcoming = upcomingLots([lot('*', '12.10.2026', 'u1'), lot('*', '01.11.2026', 'u2')], new Date(2026, 8, 11, 12));
  const text = summaryText(card, summary, 'USD', 'Price 23', { years: mediansByYear(lots, 'USD'), upcoming });
  assert.equal(text, [
    'Price 23',
    `Median hammer ${copied(200)} · middle 50% ${copied(150)}–${copied(250)} · range ${copied(100)}–${copied(300)} · 3 recorded sales matching “Price 23” · 2023`,
    `2023 · ${copied(200)} · 3 sales`,
    'Upcoming: 2 lots, first on Mon, Oct 12, 2026',
    'https://numismatics.org/pella/id/price.23',
  ].join('\n'));
  assert.equal(summaryText(card, summary, 'USD', 'Price 23', { years: [], upcoming: [] }).split('\n').length, 3);
});

// Loop N11: acsearch marks a lot it has not sold yet with "*", but a row dated after today that carried a figure — a starting price, say — was
// medianed as a hammer, stretched the years to 2028 and became the "Last sale". A sale day after the collector's own today is no sale, whatever the
// price field holds: the row is left out of every count, listed as upcoming, and the coverage says how many.
test('a lot dated after today is never counted as a sale, whatever its price field holds', async () => {
  const now = new Date(2026, 8, 11, 12);
  const lots = [lot('100', '01.01.2024', 'a'), lot('200', '11.09.2026', 'today'), lot('380', '01.06.2028', 'future'), lot('150', '12.09.2026', 'tomorrow'),
    lot('*', '01.10.2026', 'starred')];
  const summary = summarise(lots, 'USD', now);
  assert.deepEqual(summary.priced.map(({ id }) => id), ['a', 'today']);
  assert.equal(summary.count, 2);
  assert.equal(summary.future, 2);
  assert.equal(summary.latest, 2026);
  assert.equal(summary.unpriced, 1);
  assert.equal(futureText(summary), '2 future-dated lots not counted');
  assert.equal(futureText(summarise([lot('380', '01.06.2028')], 'USD', now)), '1 future-dated lot not counted');
  assert.equal(futureText(summarise(lots.slice(0, 2), 'USD', now)), '');
  // They are upcoming, soonest first, as the starred lots are; a priced lot dated today has been sold.
  assert.deepEqual(upcomingLots(lots, now).map(({ id }) => id), ['tomorrow', 'starred', 'future']);
  // The last sale, the years and the medians rest on the counted sales only.
  assert.equal(lastSale(summary).id, 'today');
  assert.deepEqual(mediansByYear([...lots, lot('900', '02.06.2028', 'f2'), lot('900', '03.06.2028', 'f3')], 'USD', now), []);
  // fetchPrices reads the page as of its own now, and a page whose only priced rows lie ahead has counted nothing.
  const page = (rows) => `<script>acsearch.initSearchResults = ${JSON.stringify(rows)};</script>`;
  const fetched = await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page(lots)), now });
  assert.equal(fetched.status, 'ok');
  assert.equal(fetched.summary.count, 2);
  const ahead = await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot('380', '01.06.2028')])), now });
  assert.equal(ahead.status, 'unpriced');
  // The copied summary says so beside what it could not count.
  const card = { label: 'Price 23', corpus: 'pella', id: 'price.23' };
  assert.ok(summaryText(card, summary, 'USD', 'Price 23').split('\n').includes('2 future-dated lots not counted'));
});

// Loop N20: three spellings of a citation the filter did not know, each written by a whole house: some German houses put a hyphen where Crawford
// writes the slash ("Crawford 344-1a"), a volume published in parts is written in Arabic figures ("RIC 2.1 356"), and CGB separates key, volume and
// number with full stops ("RIC.I.53").
test('citesReference reads a hyphen for Crawford’s slash, an Arabic volume with its part, and full stops between key, volume and number', () => {
  const titurius = { catalogue: 'RRC', number: '344/1a' };
  for (const cited of ['Crawford 344-1a', 'Cr. 344-1a', 'RRC 344-1a.', 'Crawford 344/1a']) assert.equal(citesReference(cited, titurius), true, cited);
  // A hyphen is the slash only where it cannot be a range: a lettered sub-number, or a sub-number a range would count down to.
  assert.equal(citesReference('Crawford 385-4', { catalogue: 'RRC', number: '385/4' }), true);
  // "44-5" and "344-5" are the way a dealer shortens 44–45 and 344–345: they may be two types, so neither cites 44/5 or 344/5.
  assert.equal(citesReference('Crawford 44-5', { catalogue: 'RRC', number: '44/5' }), false);
  assert.equal(citesReference('Crawford 344-5', { catalogue: 'RRC', number: '344/5' }), false);
  for (const other of ['Crawford 344-1b', 'Crawford 344-1', 'Crawford 344-10a', 'Crawford 3441a', 'Crawford 344-1a,5 g']) {
    assert.equal(citesReference(other, titurius), false, other);
  }
  const vespasian = { catalogue: 'RIC', number: '356', volume: 'II, Part 1 (2nd edition)', section: 'Vespasian' };
  for (const cited of ['RIC 2.1 356', 'RIC 2-1 356', 'RIC 2/1 356', 'RIC II.1 356']) assert.equal(citesReference(cited, vespasian), true, cited);
  // The figure stands for the volume only with its part: "RIC 2 356" may be the second edition of volume I spaced out, and part 3 is another book.
  for (const other of ['RIC 2 356', 'RIC 2.3 356', 'RIC 3.1 356', 'RIC 2.1 3561', 'RIC 2.1 356 g']) assert.equal(citesReference(other, vespasian), false, other);
  const nero = { catalogue: 'RIC', number: '53', volume: 'I (2nd edition)', section: 'Nero' };
  for (const cited of ['RIC.I.53', 'RIC. I. 53', 'RIC.53', 'C.119 - RIC.I.53 - BMC/RE.74']) assert.equal(citesReference(cited, nero), true, cited);
  for (const other of ['RIC.I.530', 'RIC.I.5.3', 'RIC.II.53', 'RIC.I.53a']) assert.equal(citesReference(other, nero), false, other);
  // A volume RIC publishes in parts keeps its guard: the figure glued behind the numeral is the part, never the type.
  assert.equal(citesReference('RIC.IV.1 266', { catalogue: 'RIC', number: '1', volume: 'IV' }), false);
  // Loop N20 review: the full stops reach a volume published in parts too. A part is one figure, so two or more behind the stop are the number.
  const trajan = { catalogue: 'RIC', number: '53', volume: 'II', section: 'Trajan' };
  for (const cited of ['RIC.II.53', 'RIC.II.1.53', 'C.119 - RIC.II.53 - BMC 74']) assert.equal(citesReference(cited, trajan), true, cited);
  assert.equal(citesReference('RIC.II.1.53', { ...trajan, volume: 'II, Part 1 (2nd edition)' }), true);
  assert.equal(citesReference('RIC.IV.1.266', { catalogue: 'RIC', number: '266', volume: 'IV' }), true);
  for (const other of ['RIC.II.3.53', 'RIC.II.530', 'RIC.II.5']) assert.equal(citesReference(other, { ...trajan, volume: 'II, Part 1 (2nd edition)' }), false, other);
  // "RIC.VI.1 53" and "RIC VII.1 53" read as "RIC II.1 356" does: the figure glued behind the numeral is a part, the last number the type. So the
  // row cites VI 53, as it did before the full stop was a separator, and never VI 1.
  for (const [cited, number, volume] of [['RIC.VI.1 53', '1', 'VI'], ['RIC VII.1 53', '1', 'VII'], ['RIC I.5 53', '5', 'I (2nd edition)']]) {
    assert.equal(citesReference(cited, { catalogue: 'RIC', number, volume }), false, `${cited} as ${volume} ${number}`);
  }
  for (const [cited, volume] of [['RIC.VI.1 53', 'VI'], ['RIC VI.1 53', 'VI'], ['RIC VII.1 53', 'VII'], ['RIC I.5 53', 'I (2nd edition)']]) {
    assert.equal(citesReference(cited, { catalogue: 'RIC', number: '53', volume }), true, `${cited} as ${volume} 53`);
  }
});

// Loop Q-02: Áureo & Calicó, Stack's Bowers, Heritage and Stephen Album glue a hyphen to the number, and a few houses a colon or a hash. With the
// citation filter on, which is the default, every one of their sales left the median as "not citing" the card.
test('citesReference reads a hyphen, colon or hash glued to the number, and never a spaced dash or another key behind it', () => {
  const trajan = { catalogue: 'RIC', number: '118', volume: 'II', section: 'Trajan' };
  for (const cited of ['RIC-118.', 'RIC-118; Cal-1015; RSC-462a.', 'RIC II-118.', 'RIC: 118.', 'RIC:118.', 'RIC#118.', 'RIC–118.', 'RIC-117-118.']) {
    assert.equal(citesReference(`Trajano. Denario. ${cited}`, trajan), true, cited);
  }
  for (const other of ['RIC - 118.', 'RIC -; BMC -.', 'RIC -, cf. 118.', 'RIC-1180.', 'RIC-118a.', 'RIC-; Cohen 118.', 'RIC -118.', 'RIC--118.',
    'RIC-118.5 g', 'Cohen-118.']) {
    assert.equal(citesReference(`Trajano. Denario. ${other}`, trajan), false, other);
  }
  // Only the card's own volume: "RIC II-118" is not volume I's 118.
  assert.equal(citesReference('RIC II-118.', { catalogue: 'RIC', number: '118', volume: 'I (2nd edition)' }), false);
  // Behind a volume the mark still opens a part, which is one figure: "RIC IV-1 266" is IV 266 and never IV 1.
  assert.equal(citesReference('RIC IV-1 266.', { catalogue: 'RIC', number: '266', volume: 'IV' }), true);
  assert.equal(citesReference('RIC IV-1 266.', { catalogue: 'RIC', number: '1', volume: 'IV' }), false);
  assert.equal(citesReference('RIC IV-1.', { catalogue: 'RIC', number: '1', volume: 'IV' }), false);
  const price = { catalogue: 'Price', number: '112' };
  for (const cited of ['Price-112.', 'Price#112.', 'Price 111-112.']) assert.equal(citesReference(cited, price), true, cited);
  // "Price:" is the word in front of a sale's amount, never PELLA's type, and a longer number is another type.
  for (const other of ['Price: 112.', 'Price:112', 'Price-1120.', 'Price - 112.', 'Starting Price-112 EUR']) assert.equal(citesReference(other, price), false, other);
  assert.equal(citesReference('Cr-44/5.', { catalogue: 'RRC', number: '44/5' }), true);
  assert.equal(citesReference('SC-1266.2.', { catalogue: 'SC', number: '1266.2' }), true);
  assert.equal(citesReference('CPE-B549.', { catalogue: 'CPE', number: 'B549' }), true);
  assert.equal(citesReference('Bopearachchi-24A.', { catalogue: 'Bop', number: '24A' }), true);
});

// Loop Q-03: Jean Elsen, Bertolami, Artemide and InAsta grade straight behind the weight, with no full stop between ("3,21 g TTB."), and Heritage
// Europe and Schulman space the plus off the first grade of a range ("Zeer fraai +/prachtig"). The first went unread, or read only its second half,
// which put a Fine coin in the EF bucket; the second dropped the lower half of the range.
test('gradeOf reads a grade the weight or diameter stands straight in front of, and a range whose first grade carries a spaced plus', () => {
  for (const [text, bucket] of [
    ['4,03g Très Beau à Superbe / Superbe.', 'Fine and below'], ['14,40g Superbe.', 'EF'], ['3,21g TTB.', 'VF'], ['3,21 g TTB.', 'VF'],
    ['17,10 g BB.', 'VF'], ['17,10 g BB+.', 'VF'], ['g 17,10 BB.', 'VF'], ['(g 17,10) BB+.', 'VF'], ['gr. 3,45 SPL.', 'EF'], ['24 mm MBC.', 'VF'],
    ['3,45 g vz.', 'EF'], ['17.15 g - Zeer fraai +/prachtig.', 'VF'], ['17.15 g - Zeer fraai/prachtig.', 'VF'], ['Zeer fraai +/prachtig.', 'VF'],
    ['Vorzüglich +/Stempelglanz.', 'EF'], ['VF + / EF.', 'VF'], ['Sehr schön+/vorzüglich.', 'VF'], ['ss +- vz.', 'VF'],
  ]) assert.equal(gradeOf(text), bucket, text);
  // The measurement opens a grade; it lends no word the closing edge a grade needs, nor a capital, nor the senate's SC its sin circular.
  for (const prose of ['Rev. Victory. 3,21 g MB in field.', '14,40 g superbe patine verte.', '3.21 g Fine style portrait.', 'Rev. S C. 25 mm SC.',
    '17 mm very fine portrait.', 'Lot of 12 g BB silver.', 'Ex Slg. 3,45 g 12.']) {
    assert.equal(gradeOf(prose), null, prose);
  }
  // A die axis is no opening edge: "12 h" closes the grade in front of it.
  assert.equal(gradeOf('Fine 12 h TTB portrait.'), 'Fine and below');
});

// Loop Q-06: dealers write one RPC Online temporary number three ways ("RPC IV.2 online 1234", "RPC IV.2, 1234 (temporary)", "RPC IV 1234 (temp.)"),
// so its term offers all of them either-or, as Price's and Sear's do. A printed number keeps its one phrase.
test('an RPC Online temporary number is searched in every spelling dealers cite it with', () => {
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  const offered = '("RPC IV.2 1234" "RPC IV 1234" "RPC IV.2 online 1234")';
  for (const written of ['RPC IV.2 online 1234 (temporary)', 'RPC IV.2 online 1234', 'RPC IV.2, 1234 (temporary)', 'RPC IV.2 1234 (temp.)']) {
    assert.equal(defaultTerm(other(written)), offered, written);
  }
  assert.equal(defaultTerm(other('RPC VI online 3231 (temporary)')), '("RPC VI 3231" "RPC VI online 3231")');
  assert.equal(defaultTerm(other('RPC IV.2 online 1234 (temporary); SNG von Aulock 3151')), '("RPC IV.2 1234" "RPC IV 1234" "RPC IV.2 online 1234" "SNG von Aulock 3151")');
  assert.equal(coinArchivesTerm(other('RPC IV.2 online 1234 (temporary)')), '"RPC IV.2 1234"');
  // The single phrase 0.36 searched, remembered by a Get prices, gives way to the new default; a term the collector wrote himself still wins.
  const temporary = other('RPC IV.2, 1234 (temporary)');
  assert.equal(chooseTerm(temporary, '"RPC IV.2, 1234"'), offered);
  assert.equal(chooseTerm(other('RPC IV.2 online 1234 (temporary)'), '"RPC IV.2 online 1234"'), offered);
  assert.equal(chooseTerm(temporary, '"RPC IV 1234" Antoninus'), '"RPC IV 1234" Antoninus');
  assert.equal(chooseTerm(other('RPC I 4156'), '"RPC I 4156"'), '"RPC I 4156"');
  // A printed number, and anything that only looks like one, is searched as written.
  for (const [written, term] of [['RPC I 4156', '"RPC I 4156"'], ['RPC VII.1 706', '"RPC VII.1 706"'], ['RPC IV.2 1234', '"RPC IV.2 1234"'],
    ['RPC I 1234 (this coin)', '"RPC I 1234"'], ['SNG Cop 1234 (temporary)', '"SNG Cop 1234"']]) {
    assert.equal(defaultTerm(other(written)), term, written);
  }
});

// Loop Q-17: AGCO's own title form, "Newell, Demetrius Poliorcetes 92", and the spaced RIC type letter of CGB and Jean Elsen ("RIC 27 b").
test('citesReference reads Newell with Poliorcetes behind the key, and a spaced RIC type letter as the letter', () => {
  const newell = { catalogue: 'Newell', number: '92' };
  for (const cited of ['Newell, Demetrius Poliorcetes 92.', 'Newell Demetrius Poliorcetes 92.', 'Newell Demetrius 92.', 'Newell 92.']) {
    assert.equal(citesReference(cited, newell), true, cited);
  }
  for (const other of ['Newell, Demetrius Poliorcetes 920.', 'Demetrius Poliorcetes 92.', 'Newell Poliorcetes 92.', 'Newell, Demetrius Poliorcetes 9.']) {
    assert.equal(citesReference(other, newell), false, other);
  }
  const lettered = { catalogue: 'RIC', number: '27b', volume: 'IV', section: 'Philip I' };
  for (const cited of ['RIC 27 b;', 'RIC IV 27 b; C. 9.', 'RIC 27b.', 'RIC 27 b (Rome).', 'RIC 27 b']) assert.equal(citesReference(cited, lettered), true, cited);
  for (const other of ['RIC 27 c.', 'RIC 27 B.', 'RIC 27.', 'RIC 27 bis.']) assert.equal(citesReference(other, lettered), false, other);
  // The plain type is no longer cited by its lettered sibling, and still by a number a word or another number follows.
  const plain = { catalogue: 'RIC', number: '27', volume: 'IV', section: 'Philip I' };
  for (const other of ['RIC 27 b;', 'RIC IV 27 b; C. 9.', 'RIC 27 b (Rome).', 'RIC 27 a']) assert.equal(citesReference(other, plain), false, other);
  for (const cited of ['RIC 27.', 'RIC 27 C. 9.', 'RIC 27 a rare variety.', 'RIC 27 e 28.', 'RIC 27 a.C.', 'RIC 27; C. 9.']) {
    assert.equal(citesReference(cited, plain), true, cited);
  }
});

// Loop P2 review, Important 1 and 2 on the filter side: the same rule as the lot row. A dotted letter is an abbreviation ("306 f." and following,
// "27 s." see, "u." and, "a. Chr."), so it cites the plain type; CGB's " - ", "=" and a line break close a spaced letter.
test('citesReference reads a spaced RIC letter exactly as the lot row does', () => {
  const plain = { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)', section: 'Nero' };
  for (const cited of ['RIC 306 s.', 'RIC 306 u. Cohen 12.', 'RIC 306 a. Chr.', 'RIC 306 ff.', 'RIC 306 m;']) assert.equal(citesReference(cited, plain), true, cited);
  assert.equal(citesReference('RIC 306 f.', { ...plain, number: '306f' }), false);
  const philip = { catalogue: 'RIC', number: '27', volume: 'IV', section: 'Philip I' };
  const lettered = { ...philip, number: '27b' };
  for (const text of ['RIC.27 b - C.9 - RSC.9.', 'RIC 27 b = C. 9.', 'RIC 27 b – C. 9.', 'RIC 27 b\nCohen 9.', 'RIC 27 b, C. 9.']) {
    assert.equal(citesReference(text, lettered), true, text);
    assert.equal(citesReference(text, philip), false, text);
  }
  assert.equal(citesReference('RIC 27 f; C. 9.', { ...philip, number: '27f' }), true);
  assert.equal(citesReference('RIC 27 f; C. 9.', philip), false);
});

// Loop P2 review, Minors Q-02 and Q-03.
test('the glued separator reads a spaced colon, a hyphen before the volume and a dotted key; a figure needs its decimals to open a grade', () => {
  const trajan = { catalogue: 'RIC', number: '118', volume: 'II', section: 'Trajan' };
  for (const cited of ['RIC : 118.', 'RIC-II 118.', 'RIC-II-118.']) assert.equal(citesReference(cited, trajan), true, cited);
  assert.equal(citesReference('RIC-II 118.', { ...trajan, volume: 'I (2nd edition)' }), false);
  assert.equal(citesReference('Cr.-44/5.', { catalogue: 'RRC', number: '44/5' }), true);
  assert.equal(citesReference('Bop.-24A.', { catalogue: 'Bop', number: '24A' }), true);
  assert.equal(citesReference('Price : 112.', { catalogue: 'Price', number: '112' }), false);
  for (const text of ['RIC 12 g BB.', 'Lot 12 g BB.', 'Cohen 12 g BB.', 'g 12 BB.']) assert.equal(gradeOf(text), null, text);
  for (const [text, bucket] of [['3,21 g TTB.', 'VF'], ['24 mm MBC.', 'VF'], ['g 17,10 BB.', 'VF']]) assert.equal(gradeOf(text), bucket, text);
});

test('an RPC temporary number with a remark behind a comma is searched in every spelling', () => {
  assert.equal(defaultTerm({ catalogue: 'Other', number: 'RPC IV.2 online 1234 (temporary), corr.', section: '' }),
    '("RPC IV.2 1234" "RPC IV 1234" "RPC IV.2 online 1234")');
});

// Loop P2 fix round 3 (re-review Minor 2, the lead's decision): a dotted letter is ambiguous, so the row counts for neither card: not the plain type,
// not the lettered one. The spaced abbreviations and grades behind a number, which are no dotted letter, still cite the plain type.
test('citesReference counts an ambiguous dotted-letter citation for neither card', () => {
  const plain = { catalogue: 'RIC', number: '27', volume: 'IV', section: 'Philip I' };
  const lettered = { ...plain, number: '27b' };
  for (const text of ['RIC 27 b.', 'RIC.27 b.', 'RIC IV 27 b. C. 9.', 'RIC 27 b. Sehr schön.', 'RIC 27 b. (Rome)']) {
    assert.equal(citesReference(text, plain), false, text);
    assert.equal(citesReference(text, lettered), false, text);
  }
  const nero = { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)', section: 'Nero' };
  assert.equal(citesReference('RIC 306 f.', nero), false);
  assert.equal(citesReference('RIC 306 f.', { ...nero, number: '306f' }), false);
  for (const text of ['RIC 306 a. Chr.', 'RIC 306 f. vz.', 'RIC 306 a. VF.', 'RIC 306 d. h. selten.', 'RIC 306 i. e. rare.', 'RIC 306 c. 300 AD.', 'RIC 306 a. C.']) {
    assert.equal(citesReference(text, nero), true, text);
  }
});

// Loop V-03: with Citing on, every Tauler & Fau, Áureo and Cayón row was counted as not citing the card: they write the key in title case, glued to
// its number or volume ("(Ric-II 118)", "(Ric-118)") or with its stop ("Ric. 306"). That spelling of the key is read; a lower-case "ric" never is.
test('citesReference reads the title-case Ric glued to its number or volume, in a bracket or with its stop, and never a lower-case ric', () => {
  const trajan = { catalogue: 'RIC', number: '118', volume: 'II', section: 'Trajan' };
  for (const cited of ['(Ric-II 118). (Bmcre-284).', '(Ric-118). (Rsc-74).', 'Ric-II-118.', 'Ric-118; Cal-1015.', 'Ric. 118.', '(Ric 118)', 'Ric.II 118.']) {
    assert.equal(citesReference(`Trajan. Denarius. ${cited}`, trajan), true, cited);
  }
  for (const other of ['ric-118.', '(ric-II 118).', 'ric. 118.', 'Ric 118.', 'Eric-118.', 'Ric-1180.', 'Ric-II 1180.', 'Ric - 118.', 'Ric-118a.', 'Price-Ric 118']) {
    assert.equal(citesReference(`Trajan. Denarius. ${other}`, trajan), false, other);
  }
  // Only the card's own volume.
  assert.equal(citesReference('(Ric-II 118)', { ...trajan, volume: 'I (2nd edition)' }), false);
  const nero = { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)', section: 'Nero' };
  for (const cited of ['(Ric-I 306). (Wcn-275).', 'Ric. 306', '(Ric-306)']) assert.equal(citesReference(cited, nero), true, cited);
  const pius = { catalogue: 'RIC', number: '772', volume: 'III', section: 'Antoninus Pius' };
  assert.equal(citesReference('(Ric-III 772). (Bmcre-1655).', pius), true);
});

// Loop V-15: a RIC row the reader could not place ("RIC XI 5", or Tauler's "Ric-II 118" before it was read) has no citation to name, and the panel
// said "No result text names , so all 4 results are counted" round the blank. With nothing to name there is no filter to switch off: every row counts,
// and no line is written.
test('a reference with no citation to name filters nothing', () => {
  for (const reference of [{ catalogue: 'RIC', number: 'XI 5', volume: '', section: '' }, { catalogue: 'RIC', number: 'II 118', volume: '', section: '' }]) {
    assert.equal(referenceName(reference), '', reference.number);
    assert.equal(filtersCitations(reference), false, reference.number);
  }
  // A reference with a name is filtered as before.
  assert.equal(filtersCitations({ catalogue: 'RIC', number: '306', volume: 'I (2nd edition)', section: 'Nero' }), true);
  assert.equal(filtersCitations({ catalogue: 'Price', number: '23', volume: '', section: '' }), true);
});

// Loop cycle 5, the money rule (lead, from S3): Copy summary wrote every amount in en-US ("$120") while the panel wrote the collector's own
// ("120 $" in German), and its Upcoming line gave the sale day as an ISO date. Every amount is formatMoney's, in the locale the caller passes, with
// the narrow sign and whole units as the panel rounds them; every day is written in that language, with its year, since a pasted summary outlives
// the popup that wrote it.
test('summaryText writes money and days in the locale it is given', () => {
  const money = (currency, units, locale) => formatMoney({ currency, minor: units * 10 ** minorDigits(currency) }, locale, { narrow: true, whole: true })
    .replace(/[\u00a0\u202f]/g, ' ');
  const lots = [lot('100', '01.01.2024', 'a'), lot('300', '01.06.2025', 'b'), lot('', '12.10.2026', 'c')];
  const summary = summarise(lots, 'USD', new Date('2026-09-25T12:00:00Z'));
  const extras = { last: lastSale(summary), grades: [{ bucket: 'VF', median: 180, count: 9 }], upcoming: [lots[2]] };
  const german = summaryText({ label: 'Price 23' }, summary, 'USD', 'Price 23', extras, 'de-DE');
  const [, stats, last, grade, upcoming] = german.split('\n');
  assert.equal(stats, `Median hammer ${money('USD', 200, 'de-DE')} · middle 50% ${money('USD', 150, 'de-DE')}–${money('USD', 250, 'de-DE')}`
    + ` · range ${money('USD', 100, 'de-DE')}–${money('USD', 300, 'de-DE')} · 2 recorded sales matching “Price 23” · 2024–2025`);
  assert.match(stats, /Median hammer 200 \$ /);
  assert.ok(!german.includes('$200') && !german.includes('$300'), german);
  assert.equal(last, `Last sale 1. Juni 2025 · ${money('USD', 300, 'de-DE')}`);
  assert.equal(grade, `VF · ${money('USD', 180, 'de-DE')} · 9 sales`);
  assert.equal(upcoming, 'Upcoming: 1 lot, first on Mo., 12. Okt. 2026');
  // In US English, as before, and the day written out rather than as an ISO date.
  const english = summaryText({ label: 'Price 23' }, summary, 'USD', 'Price 23', extras, 'en-US').split('\n');
  assert.match(english[1], /^Median hammer \$200(?:\.00)? · /);
  assert.equal(english[2], `Last sale Jun 1, 2025 · ${money('USD', 300, 'en-US')}`);
  assert.equal(english[4], 'Upcoming: 1 lot, first on Mon, Oct 12, 2026');
  const british = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date('2026-10-12T12:00:00Z'));
  assert.equal(upcomingText([lots[2]], 'en-GB'), `Upcoming: 1 lot, first on ${british}`);
  // A figure that is no amount is a dash, never a thrown summary.
  assert.match(summaryText({ label: 'X' }, { ...summary, lowerQuartile: Number.NaN }, 'USD', 'X', {}, 'de-DE'), /middle 50% —–/);
});

// Loop 6 (X-17): a page whose every price is "*" but carries no login link and one lot still to come was told "No hammer prices among the sales".
// It is marked hidden, for the popup to say what the stars are; a page with any other kind of missing price is not.
test('a page whose every price is a star is marked hidden, and no other unpriced page is', async () => {
  const shell = (lots) => `<html><script>acsearch.initSearchResults = ${JSON.stringify(lots)};</script></html>`;
  const read = async (lots) => fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(shell(lots)), now: NOW });
  const stars = await read([lot('*', '01.01.2024', 'a'), lot('*', '01.06.2028', 'c')]);
  assert.equal(stars.status, 'unpriced');
  assert.equal(stars.hidden, true);
  const mixed = await read([lot('*', '01.06.2028', 'c'), lot('-', '01.01.2024', 'a')]);
  assert.equal(mixed.status, 'unpriced');
  assert.equal(Object.hasOwn(mixed, 'hidden'), false);
});

// Loop 6 (X-04): the search term drops an edition remark kept on a RIC number: "Nero 1st ed. \"RIC 306\"" is no phrase a dealer writes.
test('a RIC term leaves an edition remark out, and keeps a denomination word', () => {
  const nero = { catalogue: 'RIC', volume: '', section: '', rulers: ['Nero'] };
  assert.equal(defaultTerm({ ...nero, number: '306 (1st ed.)' }), defaultTerm({ ...nero, number: '306' }));
  assert.equal(defaultTerm({ ...nero, number: '306 (1. Aufl.)' }), defaultTerm({ ...nero, number: '306' }));
  assert.doesNotMatch(defaultTerm({ catalogue: 'RIC', volume: 'I', section: '', number: '306 (1st ed.)' }), /ed\./);
  assert.match(defaultTerm({ catalogue: 'RIC', volume: 'II', section: 'Trajan', number: '253 (aureus)' }), /aureus/);
});
