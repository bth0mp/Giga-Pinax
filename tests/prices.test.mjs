import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSearchUrl, extractLots, parsePrice, defaultTerm, coinArchivesTerm, coinArchivesSection, coinArchivesUrl, searchCategory, summarise, fetchPrices, summaryText, greekName, chooseTerm, priceCheck, medianStrength, saleDate, PERIODS, lotsInPeriod, localDay, trendOf, lastSale, trendText } from '../extension/prices.js';
import { BIGR_KINGS } from '../extension/catalogues.js';

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
  assert.equal(defaultTerm({ catalogue: 'RIC', section: ' Nero ', number: '306' }), 'Nero 306');
  assert.equal(defaultTerm({ catalogue: 'Price', number: ' 23 ' }), 'Price 23');
  // OCRE's split-section parenthetical would make acsearch require "East", "Caesar"… that dealers rarely write; the number's own stays.
  assert.equal(defaultTerm({ catalogue: 'RIC', section: 'Leo I (East)', number: '605' }), 'Leo I 605');
  assert.equal(defaultTerm({ catalogue: 'RIC', section: 'Gallienus (joint reign)', number: '123' }), 'Gallienus 123');
  assert.equal(defaultTerm({ catalogue: 'RIC', section: 'Septimius Severus', number: '266 (aureus)' }), 'Septimius Severus 266 (aureus)');
});

const lot = (price, date = '01.01.2024', id = '1') => ({ id, title: `Lot ${id}`, date, price });

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
  assert.equal(summary.signedOut, false);
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

test('summarise handles one, two and a hundred lots, and flags signed-out pages', () => {
  const one = summarise([lot('500')]);
  assert.deepEqual([one.median, one.lowerQuartile, one.upperQuartile, one.min, one.max], [500, 500, 500, 500, 500]);
  const two = summarise([lot('100'), lot('300')]);
  assert.deepEqual([two.median, two.lowerQuartile, two.upperQuartile], [200, 150, 250]);
  const hundred = summarise(Array.from({ length: 100 }, (_, index) => lot(String(index + 1), '01.01.2024', String(index))));
  assert.equal(hundred.count, 100);
  assert.equal(hundred.median, 50.5);
  assert.equal(hundred.capped, true);
  const out = summarise([lot('*'), lot('*')]);
  assert.equal(out.signedOut, true);
  assert.equal(out.count, 0);
  assert.equal(out.median, null);
  assert.equal(summarise([lot('*'), lot('')]).signedOut, true);
  const unsold = summarise([lot(''), lot('-')]);
  assert.equal(unsold.signedOut, false);
  assert.equal(unsold.count, 0);
  const empty = summarise([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.signedOut, false);
  assert.equal(empty.earliest, null);
});

test('summarise reads the year from either date style', () => {
  const summary = summarise([lot('500', '2024-05-01'), lot('600', '28.07.2026 14:00')]);
  assert.equal(summary.earliest, 2024);
  assert.equal(summary.latest, 2026);
});

function fakeFetch(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, init }); return { ok, status, text: async () => body }; };
  impl.calls = calls;
  return impl;
}

test('fetchPrices sends credentials to acsearch and classifies outcomes', { timeout: 5000 }, async () => {
  const signedOut = fakeFetch(fixture('acsearch-search-nero-306.html'));
  assert.deepEqual(await fetchPrices({ term: 'Nero 306', currency: 'USD' }, { fetchImpl: signedOut }), { status: 'signed-out' });
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
  // The page's lots come back too, for the popup to draw a period from without another request.
  assert.deepEqual(ok.lots, [lot('100'), lot('300'), lot('*')]);
  const many = await fetchPrices({ term: 'Nero', currency: 'USD' }, { fetchImpl: fakeFetch(page(Array.from({ length: 150 }, (_, index) => lot(String(index + 1), '01.01.2024', String(index))))) });
  assert.equal(many.summary.priced.length, 100);
  assert.equal(many.summary.capped, true);
  assert.equal(many.lots.length, 100);
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot('200 EUR'), lot('300 EUR')])) }), { status: 'unpriced', term: 'q', examples: ['200 EUR', '300 EUR'] });
  assert.deepEqual(await fetchPrices({ term: 'zzz', currency: 'USD' }, { fetchImpl: fakeFetch(page([])) }), { status: 'empty', term: 'zzz' });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot(''), lot('-')])) }), { status: 'unpriced', term: 'q' });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch('<html>changed</html>') }), { status: 'network' });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch('', { ok: false, status: 503 }) }), { status: 'network' });
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: hang, timeoutMs: 20 }), { status: 'network' });
});

test('defaultTerm uses Crawford wording for RRC, which acsearch lists far more often', () => {
  assert.equal(defaultTerm({ catalogue: 'RRC', number: ' 44/5 ' }), 'Crawford 44/5');
});

test('defaultTerm ignores a typed catalogue prefix', () => {
  assert.equal(defaultTerm({ catalogue: 'RRC', number: 'RRC 44/5' }), 'Crawford 44/5');
  assert.equal(defaultTerm({ catalogue: 'RRC', number: 'Cr. 44/5' }), 'Crawford 44/5');
  assert.equal(defaultTerm({ catalogue: 'Price', number: 'Price 23' }), 'Price 23');
});

test('summarise lists up to five raw prices it could not count, skipping blanks, * and digit-free markers', () => {
  const lots = [lot('100'), lot(''), lot('*'), lot('-'), lot('1.200,- €'), lot('3000 CHF (3300 USD)'), lot('abc'), lot('x1'), lot('x2'), lot('x3'), lot('x4')];
  assert.deepEqual(summarise(lots, 'USD').uncounted, ['1.200,- €', '3000 CHF (3300 USD)', 'x1', 'x2', 'x3']);
  assert.deepEqual(summarise([lot('100'), lot('')], 'USD').uncounted, []);
});

test('fetchPrices quotes unrecognised prices only when there are some', async () => {
  const page = (lots) => `<script>acsearch.initSearchResults = ${JSON.stringify(lots)};</script>`;
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot('1.200,- €'), lot('')])) }), { status: 'unpriced', term: 'q', examples: ['1.200,- €'] });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot(''), lot('-')])) }), { status: 'unpriced', term: 'q' });
});

test('summaryText produces a shareable plain-text summary', () => {
  const amounts = ['90', '110', '135', '165', '180', '215', '245', '310', '450'];
  const summary = summarise(amounts.map((price, i) => lot(price, `01.01.${2020 + (i % 4)}`, String(i))).concat([lot('1.200,- €')]), 'USD');
  assert.equal(summaryText({ label: 'Price 23', corpus: 'pella', id: 'price.23' }, summary, 'USD', 'Price 23'), [
    'Price 23',
    'Median hammer $180 · middle 50% $135–$245 · range $90–$450 · 9 sales (moderate) matching “Price 23” · 2020–2023',
    'Not counted: “1.200,- €”',
    'https://numismatics.org/pella/id/price.23',
  ].join('\n'));
  const one = summarise([lot('500', '01.01.2024')], 'CHF');
  assert.equal(summaryText({ label: 'RRC 1/1', corpus: 'crro', id: 'rrc-1.1' }, one, 'CHF', 'Crawford 1/1'), [
    'RRC 1/1',
    'Median hammer CHF 500 · middle 50% CHF 500–CHF 500 · range CHF 500–CHF 500 · 1 sale (thin) matching “Crawford 1/1” · 2024',
    'https://numismatics.org/crro/id/rrc-1.1',
  ].join('\n'));
});

test('summaryText has no type link for a reference without type data', () => {
  const summary = summarise([lot('100', '01.01.2025'), lot('300', '01.01.2026'), lot('')], 'USD');
  assert.equal(summaryText({ label: 'HGC 4, 1218', corpus: 'other', id: 'HGC 4, 1218' }, summary, 'USD', '"HGC 4, 1218"'), [
    'HGC 4, 1218',
    'Median hammer $200 · middle 50% $150–$250 · range $100–$300 · 2 sales (thin) matching “"HGC 4, 1218"” · 2025–2026',
  ].join('\n'));
});

test('medianStrength rates a median by how many sales it rests on: Thin under 5, Moderate under 15, Solid from 15', () => {
  for (const [count, strength] of [[1, 'Thin'], [4, 'Thin'], [5, 'Moderate'], [14, 'Moderate'], [15, 'Solid'], [100, 'Solid']]) {
    assert.equal(medianStrength(count), strength, String(count));
  }
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

test('coinArchivesTerm gives plain words for every catalogue, with no acsearch quotes or brackets', () => {
  assert.equal(coinArchivesTerm({ catalogue: 'RIC', section: ' Nero ', number: '306' }), 'Nero 306');
  assert.equal(coinArchivesTerm({ catalogue: 'RIC', section: 'Leo I (East)', number: '605' }), 'Leo I 605');
  assert.equal(coinArchivesTerm({ catalogue: 'RIC', section: 'Hadrian', number: '266 (aureus)' }), 'Hadrian 266 aureus');
  assert.equal(coinArchivesTerm({ catalogue: 'RRC', number: 'Cr. 44/5' }), 'Crawford 44/5');
  assert.equal(coinArchivesTerm({ catalogue: 'SC', number: 'SC 1266.2' }), 'SC 1266.2');
  assert.equal(coinArchivesTerm({ catalogue: 'Price', number: ' 23 ' }), 'Price 23');
  assert.equal(coinArchivesTerm({ catalogue: 'Bop', section: 'Hermaeus', number: '20' }), 'Hermaeus Bopearachchi 20');
  assert.equal(coinArchivesTerm({ catalogue: 'Bop', section: 'Euthydemus I', number: 'Bop 24a' }), 'Euthydemus Bopearachchi 24A');
  const other = (number) => ({ catalogue: 'Other', number, section: '' });
  assert.equal(coinArchivesTerm(other('SG 6829 var.')), 'Sear 6829');
  assert.equal(coinArchivesTerm(other('SG 6829a; SC 1')), 'Sear 6829a');
  assert.equal(coinArchivesTerm(other('SGCV 6829')), 'Sear 6829');
  assert.equal(coinArchivesTerm(other('SG6829v')), 'Sear 6829');
  assert.equal(coinArchivesTerm(other('SG 6829v (this coin)')), 'Sear 6829');
  assert.equal(coinArchivesTerm(other('BCD Boiotia 174b; HGC 4, 1218')), 'BCD Boiotia 174b');
  assert.equal(coinArchivesTerm(other('“[SNG Cop 123]” (this coin); BMC 4')), 'SNG Cop 123');
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

test('defaultTerm uses SC wording for Seleucid Coins', () => {
  assert.equal(defaultTerm({ catalogue: 'SC', number: 'SC 1266.2' }), 'SC 1266.2');
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

test('defaultTerm groups both spellings of the king and quotes the Bopearachchi series as an exact phrase', () => {
  const bop = (section, number) => ({ catalogue: 'Bop', section, number });
  assert.equal(defaultTerm(bop(' Hermaeus ', 'Bop 20')), '(Hermaeus Hermaios) "Bopearachchi 20"');
  assert.equal(defaultTerm(bop(' Euthydemus I ', 'Bop 24a')), '(Euthydemus Euthydemos) "Bopearachchi 24A"');
  assert.equal(defaultTerm(bop('Diodotus I or Diodotus II', '8A')), '(Diodotus Diodotos) "Bopearachchi 8A"');
  assert.equal(defaultTerm(bop('Strato I', '12')), '(Strato Straton) "Bopearachchi 12"');
  assert.equal(defaultTerm(bop('Menander I', '9C')), 'Menander "Bopearachchi 9C"');
  assert.equal(defaultTerm(bop('Hermaios', '20')), 'Hermaios "Bopearachchi 20"');
  assert.equal(defaultTerm(bop('', 'Bop-9C')), '"Bopearachchi 9C"');
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

test('localDay keeps the local date of a moment, at midnight UTC like a sale date, whatever the time of day', () => {
  // Built from the local clock, so this holds in any time zone: late on 10 September is still the 10th, just after midnight the 11th.
  assert.equal(localDay(new Date(2026, 8, 10, 21)).toISOString(), '2026-09-10T00:00:00.000Z');
  assert.equal(localDay(new Date(2026, 8, 11, 0, 30)).toISOString(), '2026-09-11T00:00:00.000Z');
  assert.equal(localDay(new Date(2028, 1, 29, 23, 59)).toISOString(), '2028-02-29T00:00:00.000Z');
  // West of UTC, 21:00 on the 10th is already the 11th in UTC; the collector's 10th still keeps a sale from exactly two years before.
  assert.deepEqual(lotsInPeriod([lot('100', '10.09.2024', 'edge')], '2y', localDay(new Date(2026, 8, 10, 21))).map((entry) => entry.id), ['edge']);
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
    'Median hammer $250 (last 2 years) · middle 50% $225–$275 · range $200–$300 · 3 sales (thin) matching “Price 23” · 2024–2026',
    'Last sale 28.07.2026 14:00 · $250',
    'Last 2 years: $250 median, up 67% on earlier sales ($150)',
    'Not counted: “200 EUR”',
    'https://numismatics.org/pella/id/price.23',
  ].join('\n'));
  assert.ok(summaryText(card, summarise(lotsInPeriod(lots, '5y', NOW), 'USD'), 'USD', 'Price 23', { ...extras, period: PERIODS[1] }).includes('\nMedian hammer $200 (last 5 years) · '));
  // All is not named, and without a trend there is no trend line.
  assert.equal(summaryText(card, summarise(lots, 'USD'), 'USD', 'Price 23', { ...extras, period: PERIODS[0], trend: null }), [
    'Price 23',
    'Median hammer $250 · middle 50% $175–$750 · range $100–$5,000 · 7 sales (moderate) matching “Price 23” · 2020–2026',
    'Last sale 28.07.2026 14:00 · $250',
    'Not counted: “200 EUR”',
    'https://numismatics.org/pella/id/price.23',
  ].join('\n'));
  // A copied line never splits, whatever whitespace the page put in a date.
  const split = { period: PERIODS[0], last: { ...extras.last, date: '28.07.2026\n14:00' }, trend: null };
  assert.equal(summaryText(card, summarise(lots, 'USD'), 'USD', 'Price 23', split).split('\n')[2], 'Last sale 28.07.2026 14:00 · $250');
});

test('chooseTerm keeps a remembered term unless it is blank or the v0.12 Bop default', () => {
  const hermaeus = { catalogue: 'Bop', section: 'Hermaeus', number: '20' };
  assert.equal(chooseTerm(hermaeus, 'Hermaeus Bopearachchi 20'), '(Hermaeus Hermaios) "Bopearachchi 20"');
  assert.equal(chooseTerm(hermaeus, ' Hermaeus  Bopearachchi 20 '), '(Hermaeus Hermaios) "Bopearachchi 20"');
  assert.equal(chooseTerm(hermaeus, 'Hermaios Bopearachchi 20 tetradrachm'), 'Hermaios Bopearachchi 20 tetradrachm');
  assert.equal(chooseTerm(hermaeus, '(Hermaeus Hermaios) "Bopearachchi 20"'), '(Hermaeus Hermaios) "Bopearachchi 20"');
  for (const blank of ['', '   ', undefined, null]) assert.equal(chooseTerm(hermaeus, blank), '(Hermaeus Hermaios) "Bopearachchi 20"');
  assert.equal(chooseTerm({ catalogue: 'Bop', section: '', number: '9C' }, 'Bopearachchi 9C'), '"Bopearachchi 9C"');
  assert.equal(chooseTerm({ catalogue: 'Bop', section: 'Hermaeus', number: '' }, 'Hermaeus Bopearachchi'), '(Hermaeus Hermaios) Bopearachchi');
  const nero = { catalogue: 'RIC', section: 'Nero', number: '306' };
  assert.equal(chooseTerm(nero, 'Nero 306'), 'Nero 306');
  assert.equal(chooseTerm(nero, 'Nero 306 denarius'), 'Nero 306 denarius');
  assert.equal(chooseTerm(nero, ''), 'Nero 306');
  assert.equal(chooseTerm({ catalogue: 'Price', number: '23' }, undefined), 'Price 23');
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
  assert.equal(coinArchivesTerm(other('Netherlands KM# 123')), 'Netherlands KM 123');
  assert.equal(coinArchivesTerm(other('KM# 123.2a')), 'KM 123.2a');
  assert.equal(coinArchivesTerm(other('Württemberg KM# 123')), 'Württemberg KM 123');
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
  assert.equal(coinArchivesTerm(other('Russia Y# 59.3')), 'Russia Y 59.3');
  assert.equal(coinArchivesTerm(other('Y# 31')), 'Y 31');
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
  assert.equal(coinArchivesTerm(other('SNG Copenhagen 12, 13, 14, 15, 16, 17')), 'SNG Copenhagen 12, 13, 14, 15, 16, 17');
});

// A term saved before 0.22 for what is now prose would fetch the whole sentence again when its chip reopens, so it is dropped with the default.
test('a remembered term is dropped when its Other reference gives no searchable part', () => {
  const prose = { catalogue: 'Other', number: 'Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago', section: '' };
  assert.equal(chooseTerm(prose, '"Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago"'), '');
  // Every reference that still searches keeps the term the collector saved.
  assert.equal(chooseTerm({ catalogue: 'Other', number: 'BCD Boiotia 174b', section: '' }, 'BCD Boiotia 174'), 'BCD Boiotia 174');
  assert.equal(chooseTerm({ catalogue: 'RIC', section: 'Nero', number: '306' }, 'Nero denarius'), 'Nero denarius');
});
