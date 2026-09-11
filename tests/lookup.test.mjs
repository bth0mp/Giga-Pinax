import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuery, parseFeed, pickMatch, formatDates, toCard, nomismaSlugs, nomismaLabel, lookupType, lookupById, referenceNumber } from '../extension/lookup.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(fixture(name));

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

test('formatDates renders BC, AD, mixed and single years', () => {
  assert.equal(formatDates('0062', '0068'), 'AD 62–68');
  assert.equal(formatDates('-0336', '-0323'), '336–323 BC');
  assert.equal(formatDates('-0027', '0014'), '27 BC–AD 14');
  assert.equal(formatDates('0068', '0068'), 'AD 68');
  assert.equal(formatDates('-0323', undefined), '323 BC');
  assert.equal(formatDates(undefined, undefined), null);
});

test('toCard reads an OCRE record and substitutes nomisma labels', () => {
  const card = toCard(json('ocre-nero-306.jsonld'), 'ocre', { nero: 'Nero', as: 'As', rome: 'Rome', ae: 'Bronze' });
  assert.equal(card.id, 'ric.1(2).ner.306');
  assert.equal(card.uri, 'http://numismatics.org/ocre/id/ric.1(2).ner.306');
  assert.equal(card.corpus, 'ocre');
  assert.equal(card.label, 'RIC I (second edition) Nero 306');
  assert.deepEqual(
    [card.authority, card.denomination, card.mint, card.material, card.dates],
    ['Nero', 'As', 'Rome', 'Bronze', 'AD 62–68'],
  );
  assert.deepEqual(card.obverse, { legend: 'NERO CAESAR AVG GERM IMP', description: 'Head of Nero, laureate, right' });
  assert.equal(card.reverse.legend, 'PACE P R VBIQ PARTA IANVM CLVSIT S C');
});

test('toCard tolerates missing mint, legend and labels, preferring English text', () => {
  const card = toCard(json('pella-price-23.jsonld'), 'pella', {});
  assert.equal(card.mint, null);
  assert.equal(card.authority, 'alexander_iii');
  assert.equal(card.obverse.legend, null);
  assert.equal(card.obverse.description, 'Head of beardless Heracles right wearing lion skin headdress');
  assert.equal(card.reverse.legend, 'ΑΛΕΞΑΝΔΡΟΥ');
  assert.equal(card.dates, '336–323 BC');
  assert.equal(toCard({}, 'pella'), null);
  assert.equal(toCard(null, 'pella'), null);
});

test('nomismaSlugs lists referenced concepts in display order; nomismaLabel reads the English label', () => {
  assert.deepEqual(nomismaSlugs(json('ocre-nero-306.jsonld')), ['nero', 'as', 'rome', 'ae']);
  assert.deepEqual(nomismaSlugs(json('pella-price-23.jsonld')), ['alexander_iii', 'tetradrachm', 'ar']);
  assert.deepEqual(nomismaSlugs({}), []);
  assert.equal(nomismaLabel(json('nomisma-nero.jsonld'), 'nero'), 'Nero');
  assert.equal(nomismaLabel(json('nomisma-as.jsonld'), 'as'), 'As');
  assert.equal(nomismaLabel({}, 'nero'), null);
});

function fakeFetch(routes) {
  const calls = [];
  const signals = [];
  const impl = async (url, { signal } = {}) => {
    calls.push(url);
    signals.push(signal);
    if (signal?.aborted) throw new Error('aborted');
    const hit = Object.entries(routes).find(([needle]) => url.includes(needle));
    if (!hit) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    return { ok: true, status: 200, text: async () => hit[1], json: async () => JSON.parse(hit[1]) };
  };
  impl.calls = calls;
  impl.signals = signals;
  return impl;
}

test('lookupType resolves an exact RIC match into a labelled card and caches labels', async () => {
  const fetchImpl = fakeFetch({
    'ocre/apis/search': fixture('ocre-search-nero-306.xml'),
    'ocre/id/ric.1(2).ner.306.jsonld': fixture('ocre-nero-306.jsonld'),
    'nomisma.org/id/nero.jsonld': fixture('nomisma-nero.jsonld'),
    'nomisma.org/id/as.jsonld': fixture('nomisma-as.jsonld'),
  });
  const cache = new Map([['rome', 'Rome']]);
  const result = await lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' }, { fetchImpl, cache });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.authority, 'Nero');
  assert.equal(result.card.denomination, 'As');
  assert.equal(result.card.mint, 'Rome');
  assert.equal(result.card.material, 'ae');
  assert.equal(cache.get('nero'), 'Nero');
  assert.ok(fetchImpl.calls[0].endsWith('/ocre/apis/search?q=%22RIC%20I%20(second%20edition)%20Nero%20306%22'));
  assert.ok(fetchImpl.calls[0].startsWith('https://numismatics.org/'));
  assert.ok(!fetchImpl.calls.some((url) => url.includes('rome.jsonld')));
});

test('lookupType reports candidates, none, network and timeout outcomes', async () => {
  const pella = fakeFetch({ 'pella/apis/search': fixture('pella-search-price-23.xml') });
  const near = await lookupType({ catalogue: 'Price', number: '2' }, { fetchImpl: pella });
  assert.equal(near.status, 'candidates');
  assert.equal(near.corpus, 'pella');
  assert.equal(near.query, 'Price 2');
  assert.equal(near.candidates.length, 2);

  const empty = fakeFetch({ 'pella/apis/search': '<feed></feed>' });
  assert.deepEqual(await lookupType({ catalogue: 'Price', number: '23000' }, { fetchImpl: empty }), { status: 'none', corpus: 'pella', query: 'Price 23000' });

  assert.deepEqual(await lookupType({ catalogue: 'Price', number: '23' }, { fetchImpl: fakeFetch({}) }), { status: 'network' });

  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  assert.deepEqual(await lookupType({ catalogue: 'Price', number: '23' }, { fetchImpl: hang, timeoutMs: 20 }), { status: 'network' });

  const search = fakeFetch({ 'pella/apis/search': fixture('pella-search-price-23.xml') });
  const hangRecord = (url, init) => (url.includes('.jsonld') ? hang(url, init) : search(url, init));
  assert.deepEqual(
    await lookupType({ catalogue: 'Price', number: '23' }, { fetchImpl: hangRecord, cache: new Map(), timeoutMs: 20 }),
    { status: 'network' },
  );
});

test('lookupType shares one deadline between the search and record requests', async () => {
  const fetchImpl = fakeFetch({
    'ocre/apis/search': fixture('ocre-search-nero-306.xml'),
    'ocre/id/ric.1(2).ner.306.jsonld': fixture('ocre-nero-306.jsonld'),
  });
  const result = await lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' }, { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  const signals = fetchImpl.signals;
  assert.ok(signals[0] instanceof AbortSignal);
  assert.ok(signals.every((signal) => signal === signals[0]));
});

test('lookupById fetches one record directly', async () => {
  const fetchImpl = fakeFetch({ 'pella/id/price.23.jsonld': fixture('pella-price-23.jsonld') });
  const result = await lookupById('pella', 'price.23', { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.label, 'Price 23');
  assert.equal(result.card.denomination, 'tetradrachm');
  assert.deepEqual(await lookupById('pella', 'price.23', { fetchImpl: fakeFetch({}) }), { status: 'network' });
});

test('CRRO: RRC references build a CRRO query and fall back to the issuer as authority', () => {
  assert.deepEqual(buildQuery({ catalogue: 'RRC', number: ' 44/5 ' }), { corpus: 'crro', query: 'RRC 44/5' });
  assert.equal(pickMatch(parseFeed(fixture('crro-search-rrc-44-5.xml')), 'RRC 44/5').entry.id, 'rrc-44.5');
  const jsonld = json('crro-rrc-44-5.jsonld');
  assert.deepEqual(nomismaSlugs(jsonld), ['anonymous', 'denarius', 'rome', 'ar']);
  const card = toCard(jsonld, 'crro', { anonymous: 'Anonymous', denarius: 'Denarius', rome: 'Rome', ar: 'Silver' });
  assert.equal(card.id, 'rrc-44.5');
  assert.equal(card.label, 'RRC 44/5');
  assert.deepEqual([card.authority, card.denomination, card.mint, card.material, card.dates], ['Anonymous', 'Denarius', 'Rome', 'Silver', '211 BC']);
  assert.deepEqual(card.obverse, { legend: null, description: 'Helmeted head of Roma, right. Border of dots.' });
  assert.equal(card.reverse.legend, 'ROMA');
  assert.equal(nomismaLabel(json('nomisma-denarius.jsonld'), 'denarius'), 'Denarius');
});

test('authority still wins over issuer when a record has both', () => {
  const jsonld = { '@graph': [{ '@id': 'http://numismatics.org/crro/id/x', 'skos:prefLabel': [{ '@value': 'X' }],
    'nmo:hasAuthority': [{ '@id': 'http://nomisma.org/id/nero' }], 'nmo:hasIssuer': [{ '@id': 'http://nomisma.org/id/anonymous' }] }] };
  assert.deepEqual(nomismaSlugs(jsonld), ['nero']);
  assert.equal(toCard(jsonld, 'crro', {}).authority, 'nero');
});

test('referenceNumber strips a typed catalogue prefix for RRC and Price only', () => {
  for (const typed of ['44/5', 'RRC 44/5', 'rrc44/5', 'Crawford 44/5', 'Cr. 44/5', ' Cr 44/5 ']) assert.equal(referenceNumber('RRC', typed), '44/5');
  assert.equal(referenceNumber('Price', 'Price 23'), '23');
  assert.equal(referenceNumber('RIC', 'RIC 306'), 'RIC 306');
  assert.deepEqual(buildQuery({ catalogue: 'RRC', number: 'Crawford 44/5' }), { corpus: 'crro', query: 'RRC 44/5' });
  assert.deepEqual(buildQuery({ catalogue: 'Price', number: 'price 23' }), { corpus: 'pella', query: 'Price 23' });
});

test('lookupType resolves an exact reference from the quoted search without a second search', async () => {
  const fetchImpl = fakeFetch({
    'crro/apis/search?q=%22': fixture('crro-search-quoted-rrc-1-1.xml'),
    'crro/id/rrc-1.1.jsonld': fixture('crro-rrc-1-1.jsonld'),
  });
  const result = await lookupType({ catalogue: 'RRC', number: 'RRC 1/1' }, { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.label, 'RRC 1/1');
  assert.ok(fetchImpl.calls[0].includes('/crro/apis/search?q=%22RRC%201%2F1%22'));
  assert.equal(fetchImpl.calls.filter((url) => url.includes('/apis/search')).length, 1);
});

test('lookupType falls back to the plain search for suggestions, and CRRO suggestions stay in the typed group', async () => {
  const ocre = fakeFetch({ 'ocre/apis/search?q=%22': '<feed></feed>', 'ocre/apis/search?q=': fixture('ocre-search-nero-306.xml') });
  const near = await lookupType({ catalogue: 'RIC', volume: 'I', section: 'Nero', number: '306' }, { fetchImpl: ocre });
  assert.equal(near.status, 'candidates');
  assert.equal(near.query, 'RIC I Nero 306');
  assert.deepEqual(near.candidates.map((entry) => entry.id), ['ric.1(2).ner.306']);
  assert.equal(ocre.calls.filter((url) => url.includes('/apis/search')).length, 2);

  const feed = (...titles) => `<feed>${titles.map((title, index) => `<entry><title>${title}</title><id>x${index}</id></entry>`).join('')}</feed>`;
  const unrelated = fakeFetch({ 'crro/apis/search?q=%22': '<feed></feed>', 'crro/apis/search?q=': feed('RRC 480/5a', 'RRC 480/5') });
  assert.deepEqual(await lookupType({ catalogue: 'RRC', number: '44/5a' }, { fetchImpl: unrelated }), { status: 'none', corpus: 'crro', query: 'RRC 44/5a' });
  const related = fakeFetch({ 'crro/apis/search?q=%22': '<feed></feed>', 'crro/apis/search?q=': feed('RRC 480/5a', 'RRC 44/5', 'RRC 44/6') });
  const kept = await lookupType({ catalogue: 'RRC', number: '44/5a' }, { fetchImpl: related });
  assert.deepEqual(kept.candidates.map((entry) => entry.title), ['RRC 44/5', 'RRC 44/6']);
});
