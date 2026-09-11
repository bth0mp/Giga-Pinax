import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSearchUrl, extractLots, parsePrice, defaultTerm, summarise, fetchPrices, summaryText, greekName, chooseTerm } from '../extension/prices.js';
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
  const many = await fetchPrices({ term: 'Nero', currency: 'USD' }, { fetchImpl: fakeFetch(page(Array.from({ length: 150 }, (_, index) => lot(String(index + 1), '01.01.2024', String(index))))) });
  assert.equal(many.summary.priced.length, 100);
  assert.equal(many.summary.capped, true);
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
    'Median hammer $180 · middle 50% $135–$245 · 9 sales matching “Price 23” · 2020–2023',
    'Not counted: “1.200,- €”',
    'https://numismatics.org/pella/id/price.23',
  ].join('\n'));
  const one = summarise([lot('500', '01.01.2024')], 'CHF');
  assert.equal(summaryText({ label: 'RRC 1/1', corpus: 'crro', id: 'rrc-1.1' }, one, 'CHF', 'Crawford 1/1'), [
    'RRC 1/1',
    'Median hammer CHF 500 · middle 50% CHF 500–CHF 500 · 1 sale matching “Crawford 1/1” · 2024',
    'https://numismatics.org/crro/id/rrc-1.1',
  ].join('\n'));
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
