import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuery, parseFeed, pickMatch, formatDates, toCard, nomismaSlugs, nomismaLabel, lookupType, lookupById, referenceNumber, parseReference, resolveLabels, bopSeries, bopCitation, seriesOf, kingOf, bopDetails } from '../extension/lookup.js';

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

test('CRRO suggestions: lettered groups match case-insensitively and the group filter runs before the five-suggestion cap', async () => {
  const feed = (...titles) => `<feed>${titles.map((title, index) => `<entry><title>${title}</title><id>x${index}</id></entry>`).join('')}</feed>`;
  const lettered = fakeFetch({ 'crro/apis/search?q=%22': '<feed></feed>', 'crro/apis/search?q=': feed('RRC 197-198B/1a', 'RRC 480/5a') });
  const kept = await lookupType({ catalogue: 'RRC', number: '197-198B/1' }, { fetchImpl: lettered });
  assert.deepEqual(kept.candidates.map((entry) => entry.title), ['RRC 197-198B/1a']);

  const noisy = feed('RRC 480/5a', 'RRC 480/5', 'RRC 44/5', 'RRC 144/1', 'RRC 44/6', 'RRC 344/2', 'RRC 440/1', 'RRC 44/7');
  const capped = await lookupType({ catalogue: 'RRC', number: '44/5a' }, { fetchImpl: fakeFetch({ 'crro/apis/search?q=%22': '<feed></feed>', 'crro/apis/search?q=': noisy }) });
  assert.equal(capped.status, 'candidates');
  assert.deepEqual(capped.candidates.map((entry) => entry.title), ['RRC 44/5', 'RRC 44/6', 'RRC 44/7']);
});

test('referenceNumber drops stray quotes and only strips a real prefix', () => {
  assert.equal(referenceNumber('RRC', '44/5"'), '44/5');
  assert.equal(referenceNumber('RRC', '"RRC 44/5"'), '44/5');
  for (const [typed, expected] of [['Cr44/5', '44/5'], ['CRAWFORD  44/5', '44/5'], ['Cr. 44/5', '44/5'], ['Crawf 44/5', 'Crawf 44/5'], ['Cr . 44/5', 'Cr . 44/5']]) {
    assert.equal(referenceNumber('RRC', typed), expected);
  }
  assert.equal(referenceNumber('Price', 'P23'), 'P23');
});

// node:test takes options before the function; a trailing options object is silently ignored.
test('the plain-search fallback shares the lookup deadline', { timeout: 5000 }, async () => {
  const signals = [];
  const fetchImpl = (url, { signal } = {}) => {
    signals.push(signal);
    if (url.includes('?q=%22')) return Promise.resolve({ ok: true, status: 200, text: async () => '<feed></feed>' });
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  };
  assert.deepEqual(await lookupType({ catalogue: 'RRC', number: '44/5a' }, { fetchImpl, timeoutMs: 30 }), { status: 'network' });
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
});

test('parseReference reads whole RIC, RRC and Price references', () => {
  const ric = (volume, section, number) => ({ catalogue: 'RIC', volume, section, number });
  const cases = [
    ['RIC I² Nero 306', ric('I (2nd edition)', 'Nero', '306')],
    ['RIC I (2nd ed.) Nero 306', ric('I (2nd edition)', 'Nero', '306')],
    ['ric 1(2) nero 306', ric('I (2nd edition)', 'nero', '306')],
    ['RIC I 2nd edition Nero 306', ric('I (2nd edition)', 'Nero', '306')],
    ['RIC I (second edition) Nero 306', ric('I (2nd edition)', 'Nero', '306')],
    ['RIC II.3 Hadrian 12', ric('II, Part 3', 'Hadrian', '12')],
    ['RIC II, Part 3 (2nd ed.) Hadrian 12', ric('II, Part 3 (2nd edition)', 'Hadrian', '12')],
    ['RIC 2/3² Hadrian 12', ric('II, Part 3 (2nd edition)', 'Hadrian', '12')],
    ['RIC vol. IV Septimius Severus 266', ric('IV', 'Septimius Severus', '266')],
    ['RIC IV Septimius Severus 266 (aureus)', ric('IV', 'Septimius Severus', '266 (aureus)')],
    ['RIC VII Antioch 1', ric('VII', 'Antioch', '1')],
    ['RIC IX Antioch 56A', ric('IX', 'Antioch', '56A')],
    ['Crawford 44/5', { catalogue: 'RRC', number: '44/5', volume: '', section: '' }],
    ['RRC 44/5', { catalogue: 'RRC', number: '44/5', volume: '', section: '' }],
    ['cr. 197-198B/1a', { catalogue: 'RRC', number: '197-198B/1a', volume: '', section: '' }],
    ['  Price   23 ', { catalogue: 'Price', number: '23', volume: '', section: '' }],
    ['"Price 3a"', { catalogue: 'Price', number: '3a', volume: '', section: '' }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseReference(text), expected, text);
  for (const text of ['', 'hello', 'RIC Nero 306', 'RIC I Nero', 'Sear 1234', 'Price', 'Crawford', 'RIC XI Nero 1']) {
    assert.equal(parseReference(text), null, text);
  }
});

test('a parsed one-box reference feeds buildQuery the OCRE title shape', () => {
  assert.deepEqual(buildQuery(parseReference('RIC I² Nero 306')), { corpus: 'ocre', query: 'RIC I (second edition) Nero 306' });
  assert.deepEqual(buildQuery(parseReference('RIC II, Part 3 (2nd ed.) Hadrian 12')), { corpus: 'ocre', query: 'RIC II, Part 3 (second edition) Hadrian 12' });
  assert.deepEqual(buildQuery({ catalogue: 'RIC', volume: 'I (2nd edition)"', section: '"Nero', number: '306"' }), { corpus: 'ocre', query: 'RIC I (second edition) Nero 306' });
});

test('an exact title found only by the CRRO plain fallback survives the group filter', async () => {
  const fetchImpl = fakeFetch({
    'crro/apis/search?q=%22': '<feed></feed>',
    'crro/apis/search?q=': '<feed><entry><title>RRC 44/5</title><id>rrc-44.5</id></entry><entry><title>RRC 480/5</title><id>rrc-480.5</id></entry></feed>',
    'crro/id/rrc-44.5.jsonld': fixture('crro-rrc-44-5.jsonld'),
  });
  const result = await lookupType({ catalogue: 'RRC', number: '44/5' }, { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.label, 'RRC 44/5');
});

test('parseReference strips curly quotes, rejects a digit where the section should be, and caps length', () => {
  assert.deepEqual(parseReference('“Crawford 44/5”'), { catalogue: 'RRC', number: '44/5', volume: '', section: '' });
  assert.deepEqual(parseReference('„RIC I² Nero 306“'), { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' });
  for (const text of ['RIC I 2 Nero 306', 'RIC II 3 Hadrian 12', `RIC I Nero ${'1'.repeat(120)}`]) assert.equal(parseReference(text), null, text);
  assert.deepEqual(buildQuery({ catalogue: 'RIC', volume: '“I (2nd edition)”', section: 'Nero', number: '306' }), { corpus: 'ocre', query: 'RIC I (second edition) Nero 306' });
});

test('SC references build the SCO record id and parse from one box', () => {
  assert.deepEqual(buildQuery({ catalogue: 'SC', number: 'SC 1266.2' }), { corpus: 'sco', query: 'SC 1266.2', id: 'sc.1.1266.2' });
  assert.equal(referenceNumber('SC', 'Seleucid Coins 1630.2b'), '1630.2b');
  assert.deepEqual(parseReference('SC 1266.2'), { catalogue: 'SC', number: '1266.2', volume: '', section: '' });
  assert.deepEqual(parseReference('sc1630.2b'), { catalogue: 'SC', number: '1630.2b', volume: '', section: '' });
  assert.equal(parseReference('SC'), null);
});

test('an SC lookup fetches the SCO record directly, without a search', async () => {
  const fetchImpl = fakeFetch({ 'sco/id/sc.1.1266.2.jsonld': fixture('sco-sc-1-1266-2.jsonld') });
  const result = await lookupType({ catalogue: 'SC', number: '1266.2' }, { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.label, 'Seleucid Coins (part 1) 1266.2');
  assert.deepEqual([result.card.authority, result.card.denomination, result.card.mint, result.card.material, result.card.dates],
    ['demetrius_ii_nicator', 'tetradrachm', 'antiocheia_syria', 'ar', '129–128 BC']);
  assert.equal(fetchImpl.calls.filter((url) => url.includes('/apis/search')).length, 0);
});

test('a missing SC number suggests types with the same base number, and other failures are network errors', async () => {
  const sco = fakeFetch({ 'sco/apis/search?q=': fixture('sco-search-sc-1266.xml') });
  const near = await lookupType({ catalogue: 'SC', number: '1266.9' }, { fetchImpl: sco });
  assert.equal(near.status, 'candidates');
  assert.equal(near.query, 'SC 1266.9');
  assert.deepEqual(near.candidates.map((entry) => entry.id), ['sc.1.1266']);
  const searches = sco.calls.filter((url) => url.includes('/apis/search'));
  assert.equal(searches.length, 1);
  assert.ok(searches[0].endsWith('/sco/apis/search?q=SC%201266'), searches[0]);
  const unrelated = fakeFetch({ 'sco/apis/search?q=': '<feed><entry><title>Seleucid Coins (part 2) 1630.2b</title><id>sc.1.1630.2b</id></entry></feed>' });
  assert.deepEqual(await lookupType({ catalogue: 'SC', number: '1266.9' }, { fetchImpl: unrelated }), { status: 'none', corpus: 'sco', query: 'SC 1266.9' });
  const failing = async () => ({ ok: false, status: 503, text: async () => '', json: async () => ({}) });
  assert.deepEqual(await lookupType({ catalogue: 'SC', number: '1266.2' }, { fetchImpl: failing }), { status: 'network' });
});

test('parseReference reads SCO titles so SC chips and suggestions fill the fields', () => {
  assert.deepEqual(parseReference('Seleucid Coins (part 1) 1266.2'), { catalogue: 'SC', number: '1266.2', volume: '', section: '' });
  assert.deepEqual(parseReference('Seleucid Coins (part 1) 1266'), { catalogue: 'SC', number: '1266', volume: '', section: '' });
  assert.equal(parseReference('Seleucid Coins (part 1) 1266.2 (x)'), null);
});

test('resolveLabels works without a cache argument', async () => {
  const fetchImpl = fakeFetch({ 'nomisma.org/id/nero.jsonld': fixture('nomisma-nero.jsonld') });
  assert.deepEqual(await resolveLabels(['nero', 'missing'], { fetchImpl }), { nero: 'Nero' });
});

test('Bop references parse from one box with or without a king, and build a BIGR query', () => {
  const bop = (section, number) => ({ catalogue: 'Bop', number, volume: '', section });
  const cases = [
    ['Bop Euthydemus I 24A', bop('Euthydemus I', '24A')],
    ['Bopearachchi Euthydemus I 24A', bop('Euthydemus I', '24A')],
    ['Euthydemus I Bop. 24A', bop('Euthydemus I', '24A')],
    ['Euthydemus I, Bop 24A', bop('Euthydemus I', '24A')],
    ['Euthydemos Bop 24a', bop('Euthydemos', '24a')],
    ['Diodotus I or Diodotus II Bop 8A', bop('Diodotus I or Diodotus II', '8A')],
    ['Bop-9C', bop('', '9C')],
    ['Bop. 9C', bop('', '9C')],
    ['Bop 9C', bop('', '9C')],
    ['bop9c', bop('', '9c')],
    ['Bopearachchi 9C', bop('', '9C')],
    ['“Bop Philoxenus 9C”', bop('Philoxenus', '9C')],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseReference(text), expected, text);
  for (const text of ['Bop', 'Bopearachchi', 'Euthydemus I 24A', 'Bopearachi 9C', 'Bop 9C tetradrachm', 'Bop Euthydemus 1 24A',
    'Bopearachchi Philoxène 9C (Philoxenus 8.1)', 'Bactrian and Indo-Greek Coinage Euthydemus I 13.1']) {
    assert.equal(parseReference(text), null, text);
  }
  for (const typed of ['24A', 'Bop 24A', 'Bop-24A', 'Bop. 24A', 'bopearachchi24A']) assert.equal(referenceNumber('Bop', typed), '24A', typed);
  assert.equal(bopSeries(' bop. 24a '), '24A');
  assert.deepEqual(buildQuery({ catalogue: 'Bop', number: 'Bop 24a', section: ' Euthydemus I ' }),
    { corpus: 'bigr', query: 'Bopearachchi Euthydemus I 24A', king: 'Euthydemus I', series: '24A' });
  assert.deepEqual(buildQuery({ catalogue: 'Bop', number: '9C' }), { corpus: 'bigr', query: 'Bopearachchi 9C', king: '', series: '9C' });
  assert.deepEqual(buildQuery(parseReference('Euthydemus I, Bop 24A')), { corpus: 'bigr', query: 'Bopearachchi Euthydemus I 24A', king: 'Euthydemus I', series: '24A' });
});

test('bopCitation reads the Bopearachchi idno from a NUDS record and fails closed; seriesOf and kingOf split citation and title', () => {
  assert.equal(bopCitation(fixture('bigr-euthydemus-i-13-1.xml')), 'Euthydème I 24A');
  assert.equal(bopCitation(fixture('bigr-euthydemus-i-13.xml')), 'Euthydème I 24');
  assert.equal(bopCitation(fixture('bigr-philoxenus-6-3.xml')), 'Philoxène 9C');
  const reference = (key, idno) => `<reference><tei:title key="${key}">T</tei:title><tei:idno>${idno}</tei:idno></reference>`;
  const mitchiner = reference('http://nomisma.org/id/mitchiner-1976', '343c');
  assert.equal(bopCitation(`<nuds><refDesc>${mitchiner}</refDesc></nuds>`), null);
  assert.equal(bopCitation(`<nuds><refDesc>${mitchiner}${reference('http://nomisma.org/id/bopearachchi-1991', ' Philox&amp;ne  9C ')}</refDesc></nuds>`), 'Philox&ne 9C');
  assert.equal(bopCitation(`<nuds>${reference('http://nomisma.org/id/bopearachchi-1991', '')}</nuds>`), null);
  for (const bad of ['', '<nuds/>', 'not xml', null, undefined]) assert.equal(bopCitation(bad), null);
  assert.equal(seriesOf('Euthydème I 24A'), '24A');
  assert.equal(seriesOf('Philoxène 9'), '9');
  assert.equal(kingOf('Bactrian and Indo-Greek Coinage Euthydemus I 13.1'), 'Euthydemus I');
  assert.equal(kingOf('Bactrian and Indo-Greek Coinage Diodotus I or Diodotus II 8A'), 'Diodotus I or Diodotus II');
  assert.equal(kingOf('Bactrian and Indo-Greek Coinage Philoxenus 6'), 'Philoxenus');
  assert.deepEqual(bopDetails('Bactrian and Indo-Greek Coinage Euthydemus I 13.1', 'Euthydème I 24A'), { king: 'Euthydemus I', series: '24A', citation: 'Euthydème I 24A' });
  assert.deepEqual(bopDetails('Bactrian and Indo-Greek Coinage Diodotus I or Diodotus II 8A', null), { king: 'Diodotus I or Diodotus II', series: null, citation: null });
});

// Routes match by substring in order: the 24A search is listed before the 24 one, whose needle is its prefix.
const BIGR_ROUTES = {
  'bigr/apis/search?q=Euthydemus%20I%2024A': fixture('bigr-search-euthydemus-i-24a.xml'),
  'bigr/apis/search?q=Euthydemus%20I%2024': fixture('bigr-search-euthydemus-i-24.xml'),
  'bigr/id/bigr.euthydemus_i.13.1.jsonld': fixture('bigr-euthydemus-i-13-1.jsonld'),
  'bigr/id/bigr.euthydemus_i.13.1.xml': fixture('bigr-euthydemus-i-13-1.xml'),
  'bigr/id/bigr.euthydemus_i.13.jsonld': fixture('bigr-euthydemus-i-13.jsonld'),
  'bigr/id/bigr.euthydemus_i.13.xml': fixture('bigr-euthydemus-i-13.xml'),
};

test('a Bop lookup with a king searches "{king} {series}", verifies each hit by its NUDS citation and resolves the one exact type', async () => {
  const fetchImpl = fakeFetch(BIGR_ROUTES);
  const result = await lookupType({ catalogue: 'Bop', section: 'Euthydemus I', number: 'Bop 24a' }, { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.id, 'bigr.euthydemus_i.13.1');
  assert.equal(result.card.label, 'Bactrian and Indo-Greek Coinage Euthydemus I 13.1');
  assert.deepEqual(result.card.bop, { king: 'Euthydemus I', series: '24A', citation: 'Euthydème I 24A' });
  assert.deepEqual([result.card.authority, result.card.denomination, result.card.mint, result.card.material, result.card.dates],
    ['euthydemus_i_bactria', 'denomination_d_sco', null, 'ae', '230–190 BC']);
  assert.equal(result.card.reverse.legend, 'ΒΑΣΙΛΕΩΣ ΕΥΘΥΔΗΜΟΥ');
  assert.equal(fetchImpl.calls[0], 'https://numismatics.org/bigr/apis/search?q=Euthydemus%20I%2024A');
  assert.equal(fetchImpl.calls.filter((url) => url.includes('/apis/search')).length, 1);
  assert.deepEqual(fetchImpl.calls.filter((url) => url.endsWith('.xml')).sort(),
    ['https://numismatics.org/bigr/id/bigr.euthydemus_i.13.1.xml', 'https://numismatics.org/bigr/id/bigr.euthydemus_i.13.xml']);
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/bigr/id/') && url.endsWith('.jsonld')), ['https://numismatics.org/bigr/id/bigr.euthydemus_i.13.1.jsonld']);
  assert.ok(fetchImpl.signals.every((signal) => signal === fetchImpl.signals[0]));

  const parent = await lookupType({ catalogue: 'Bop', section: 'Euthydemus I', number: '24' }, { fetchImpl: fakeFetch(BIGR_ROUTES), cache: new Map() });
  assert.equal(parent.status, 'ok');
  assert.equal(parent.card.id, 'bigr.euthydemus_i.13');
  assert.deepEqual(parent.card.bop, { king: 'Euthydemus I', series: '24', citation: 'Euthydème I 24' });
});

test('a king BIGR does not know falls back to the series alone and offers every verified king as a labelled list', async () => {
  const fetchImpl = fakeFetch({ 'bigr/apis/search?q=Euthydemos%2024A': '<feed></feed>', 'bigr/apis/search?q=24A': fixture('bigr-search-24a.xml'), ...BIGR_ROUTES });
  const result = await lookupType({ catalogue: 'Bop', section: 'Euthydemos', number: '24A' }, { fetchImpl });
  assert.deepEqual(result, { status: 'candidates', corpus: 'bigr', query: 'Bopearachchi Euthydemos 24A',
    candidates: [{ id: 'bigr.euthydemus_i.13.1', title: 'Bopearachchi Euthydème I 24A (Euthydemus I 13.1)' }] });
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/apis/search')),
    ['https://numismatics.org/bigr/apis/search?q=Euthydemos%2024A', 'https://numismatics.org/bigr/apis/search?q=24A']);
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('.xml')).length, 8);
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('.jsonld')).length, 0);
});

test('a Bop series without a king lists the verified types of every king; unverified hits are left out', async () => {
  const fetchImpl = fakeFetch({
    'bigr/apis/search?q=9C': fixture('bigr-search-9c.xml'),
    'bigr/id/bigr.philoxenus.6.3.xml': fixture('bigr-philoxenus-6-3.xml'),
    'bigr/id/bigr.philoxenus.7.1.xml': fixture('bigr-philoxenus-7-1.xml'),
    'bigr/id/bigr.philoxenus.8.1.xml': fixture('bigr-philoxenus-8-1.xml'),
    'bigr/id/bigr.philoxenus.6.xml': fixture('bigr-philoxenus-6.xml'),
    'bigr/id/bigr.antialcidas.12.2.xml': fixture('bigr-antialcidas-12-2.xml'),
    'bigr/id/bigr.hermaeus.9.4.xml': fixture('bigr-hermaeus-9-4.xml'),
  });
  const result = await lookupType({ catalogue: 'Bop', section: '', number: 'Bop-9C' }, { fetchImpl });
  assert.equal(result.status, 'candidates');
  assert.equal(result.query, 'Bopearachchi 9C');
  assert.deepEqual(result.candidates.map((entry) => entry.title), [
    'Bopearachchi Philoxène 9C (Philoxenus 8.1)',
    'Bopearachchi Philoxène 9C (Philoxenus 7.1)',
    'Bopearachchi Philoxène 9C (Philoxenus 6.3)',
    'Bopearachchi Antialcidas 9C (Antialcidas 12.2)',
    'Bopearachchi Hermaios 9C (Hermaeus 9.4)',
  ]);
  assert.deepEqual(result.candidates.map((entry) => entry.id), ['bigr.philoxenus.8.1', 'bigr.philoxenus.7.1', 'bigr.philoxenus.6.3', 'bigr.antialcidas.12.2', 'bigr.hermaeus.9.4']);
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/apis/search')), ['https://numismatics.org/bigr/apis/search?q=9C']);
  const xml = fetchImpl.calls.filter((url) => url.endsWith('.xml'));
  assert.equal(xml.length, 16);
  assert.ok(xml.every((url) => /^https:\/\/numismatics\.org\/bigr\/id\/bigr\.[a-z_]+(?:\.\d+[A-Z]?)+\.xml$/.test(url)), xml.join('\n'));
  assert.ok(fetchImpl.signals.every((signal) => signal === fetchImpl.signals[0]));
});

test('with a king, several exact hits are offered by citation and BIGR number, and near misses follow the five-suggestion rule', async () => {
  const philoxenus = {
    'bigr/id/bigr.philoxenus.6.3.xml': fixture('bigr-philoxenus-6-3.xml'),
    'bigr/id/bigr.philoxenus.7.1.xml': fixture('bigr-philoxenus-7-1.xml'),
    'bigr/id/bigr.philoxenus.8.1.xml': fixture('bigr-philoxenus-8-1.xml'),
    'bigr/id/bigr.philoxenus.6.xml': fixture('bigr-philoxenus-6.xml'),
  };
  const several = fakeFetch({ 'bigr/apis/search?q=Philoxenus%209C': fixture('bigr-search-philoxenus-9c.xml'), ...philoxenus });
  const result = await lookupType({ catalogue: 'Bop', section: 'Philoxenus', number: '9c' }, { fetchImpl: several });
  assert.equal(result.status, 'candidates');
  assert.deepEqual(result.candidates.map((entry) => entry.title), ['Bopearachchi Philoxène 9C (Philoxenus 8.1)', 'Bopearachchi Philoxène 9C (Philoxenus 7.1)', 'Bopearachchi Philoxène 9C (Philoxenus 6.3)']);
  assert.equal(several.calls.filter((url) => url.includes('/apis/search')).length, 1);
  assert.equal(several.calls.filter((url) => url.endsWith('.xml')).length, 6);

  const feed = (...ids) => `<feed>${ids.map((id) => `<entry><title>Bactrian and Indo-Greek Coinage Philoxenus ${id}</title><id>bigr.philoxenus.${id}</id></entry>`).join('')}</feed>`;
  const near = await lookupType({ catalogue: 'Bop', section: 'Philoxenus', number: '9D' }, { fetchImpl: fakeFetch({ 'bigr/apis/search?q=Philoxenus%209D': feed('6', '6.3', '99'), ...philoxenus }) });
  assert.deepEqual(near, { status: 'candidates', corpus: 'bigr', query: 'Bopearachchi Philoxenus 9D', candidates: [
    { id: 'bigr.philoxenus.6', title: 'Bopearachchi Philoxène 9 (Philoxenus 6)' },
    { id: 'bigr.philoxenus.6.3', title: 'Bopearachchi Philoxène 9C (Philoxenus 6.3)' },
    { id: 'bigr.philoxenus.99', title: 'Bactrian and Indo-Greek Coinage Philoxenus 99' },
  ] });
  const many = await lookupType({ catalogue: 'Bop', section: 'Philoxenus', number: '9D' }, { fetchImpl: fakeFetch({ 'bigr/apis/search?q=Philoxenus%209D': feed('1', '2', '3', '4', '5', '6'), ...philoxenus }) });
  assert.deepEqual(many, { status: 'none', corpus: 'bigr', query: 'Bopearachchi Philoxenus 9D' });
  const nothing = await lookupType({ catalogue: 'Bop', section: '', number: '9D' }, { fetchImpl: fakeFetch({ 'bigr/apis/search?q=9D': feed('6', '6.3'), ...philoxenus }) });
  assert.deepEqual(nothing, { status: 'none', corpus: 'bigr', query: 'Bopearachchi 9D' });
});

test('Bop lookups report network errors for a failing search or a timed-out verification', async () => {
  const failing = async () => ({ ok: false, status: 503, text: async () => '', json: async () => ({}) });
  assert.deepEqual(await lookupType({ catalogue: 'Bop', section: 'Euthydemus I', number: '24A' }, { fetchImpl: failing }), { status: 'network' });
  const search = fakeFetch(BIGR_ROUTES);
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const hangXml = (url, init) => (url.endsWith('.xml') ? hang(url, init) : search(url, init));
  assert.deepEqual(await lookupType({ catalogue: 'Bop', section: 'Euthydemus I', number: '24A' }, { fetchImpl: hangXml, timeoutMs: 20 }), { status: 'network' });
  assert.deepEqual(await lookupById('bigr', 'bigr.euthydemus_i.13.1', { fetchImpl: hangXml, cache: new Map(), timeoutMs: 20 }), { status: 'network' });
});

test('lookupById on BIGR fetches the NUDS record for the citation, and an unreadable one leaves the card uncited', async () => {
  const fetchImpl = fakeFetch(BIGR_ROUTES);
  const result = await lookupById('bigr', 'bigr.euthydemus_i.13.1', { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.card.bop, { king: 'Euthydemus I', series: '24A', citation: 'Euthydème I 24A' });
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/bigr/id/')),
    ['https://numismatics.org/bigr/id/bigr.euthydemus_i.13.1.jsonld', 'https://numismatics.org/bigr/id/bigr.euthydemus_i.13.1.xml']);
  const uncited = await lookupById('bigr', 'bigr.euthydemus_i.13.1', { fetchImpl: fakeFetch({ 'bigr/id/bigr.euthydemus_i.13.1.jsonld': fixture('bigr-euthydemus-i-13-1.jsonld') }), cache: new Map() });
  assert.equal(uncited.status, 'ok');
  assert.deepEqual(uncited.card.bop, { king: 'Euthydemus I', series: null, citation: null });
  const other = await lookupById('pella', 'price.23', { fetchImpl: fakeFetch({ 'pella/id/price.23.jsonld': fixture('pella-price-23.jsonld') }), cache: new Map() });
  assert.equal(other.status, 'ok');
  assert.equal(Object.hasOwn(other.card, 'bop'), false);
});
