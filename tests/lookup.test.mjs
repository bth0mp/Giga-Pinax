import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuery, parseFeed, pickMatch, formatDates, toCard, nomismaSlugs, nomismaLabel, lookupType, lookupById, referenceNumber, parseReference, resolveLabels, bopSeries, kmNumber, sgNumber, bopCitation, seriesOf, kingOf, bopDetails, rpcUrl, searchablePart, portraitSlug, filingNote, pickRicEntries } from '../extension/lookup.js';

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

// Hand-written OCRE records for the portrait cases no fixture holds: the portraits of each side and the authorities, by slug.
const record = (obverse, reverse = [], authority = ['vespasian']) => {
  const uri = 'http://numismatics.org/ocre/id/ric.2_1(2).ves.972';
  const portraits = (slugs) => slugs.map((slug) => ({ '@id': `http://nomisma.org/id/${slug}` }));
  return { '@graph': [
    { '@id': uri, 'skos:prefLabel': [{ '@value': 'RIC II, Part 1 (second edition) Vespasian 972', '@language': 'en' }], 'nmo:hasAuthority': portraits(authority) },
    { '@id': `${uri}#obverse`, 'nmo:hasPortrait': portraits(obverse) },
    { '@id': `${uri}#reverse`, 'nmo:hasPortrait': portraits(reverse) },
  ] };
};

test('toCard keeps the obverse portrait as its own label, never the reverse one and never a bare slug', () => {
  const labels = { vespasian: 'Vespasian', titus: 'Titus', denarius: 'Denarius', rome: 'Rome', ar: 'Silver', annona: 'Annona' };
  const card = toCard(json('ocre-vespasian-972.jsonld'), 'ocre', labels);
  assert.equal(card.portrait, 'Titus');
  assert.equal(card.authority, 'Vespasian');
  // The portrait is a root field, so the sides keep exactly the two keys the rest of the popup reads.
  assert.deepEqual(card.obverse, { legend: 'T CAESAR VESPASIANVS', description: 'Head of Titus, laureate, right' });
  assert.equal(toCard(json('ocre-nero-306.jsonld'), 'ocre', { nero: 'Nero' }).portrait, 'Nero');
  assert.equal(toCard(json('ocre-titus-123.jsonld'), 'ocre', { titus: 'Titus' }).portrait, 'Titus');
  // The reverse portrait is a deity: it is never read, whatever the obverse holds.
  assert.equal(toCard(record([], ['annona']), 'ocre', labels).portrait, null);
  // An unresolved label fails closed, so "Portrait of cornelia_salonina" can never render.
  assert.equal(toCard(json('ocre-vespasian-972.jsonld'), 'ocre', {}).portrait, null);
  // Joint types carry two of either: half an answer is no answer.
  assert.equal(toCard(record(['leo_ii', 'zeno']), 'ocre', { leo_ii: 'Leo II', zeno: 'Zeno', vespasian: 'Vespasian' }).portrait, null);
  assert.equal(toCard(record(['titus'], [], ['vespasian', 'titus']), 'ocre', labels).portrait, null);
});

test('portraitSlug reads the obverse portrait of a record, and nothing else', () => {
  assert.equal(portraitSlug(json('ocre-vespasian-972.jsonld')), 'titus');
  assert.equal(portraitSlug(json('ocre-nero-306.jsonld')), 'nero');
  assert.equal(portraitSlug(record([], ['annona'])), null);
  assert.equal(portraitSlug(record(['leo_ii', 'zeno'])), null);
  assert.equal(portraitSlug({}), null);
});

test('filingNote explains a RIC filing only when the record says so, and is silent otherwise', () => {
  const card = (label, authority, portrait = null, corpus = 'ocre') => ({ corpus, label, authority, portrait });
  // The report: Titus 972 opens Vespasian 972, and the card now says why.
  assert.equal(filingNote(card('RIC II, Part 1 (second edition) Vespasian 972', 'Vespasian', 'Titus')), 'Portrait of Titus, listed under Vespasian.');
  // The ordinary case says nothing at all.
  assert.equal(filingNote(card('RIC I (second edition) Nero 306', 'Nero', 'Nero')), '');
  assert.equal(filingNote(card('RIC II, Part 1 (second edition) Titus 123', 'Titus', 'Titus')), '');
  assert.equal(filingNote(card('RIC II, Part 1 (second edition) Titus 123', 'Titus')), '');
  // Case and spacing never make two names of one.
  assert.equal(filingNote(card('RIC II, Part 1 (second edition) Titus 123', 'Titus', ' titus ')), '');
  // A deity or personification is never a name RIC files a section under.
  assert.equal(filingNote(card('RIC II, Part 1 (second edition) Domitian 759', 'Domitian', 'Apollo')), '');
  assert.equal(filingNote(card('RIC IV Elagabalus 268', 'Elagabalus', 'Julia Maesa')), '');
  // A mint volume files by mint, so no ruler is the section and the sentence must not claim one.
  assert.equal(filingNote(card('RIC IX Siscia 38C', 'Valentinian II', 'Arcadius')), 'Portrait of Arcadius; issuing authority Valentinian II.');
  assert.equal(filingNote(card('RIC VI Londinium 1a', 'Maximian', 'Diocletian')), 'Portrait of Diocletian; issuing authority Maximian.');
  // A city personification heads a mint section, never a person's: the gate reads the ruler volumes only.
  assert.equal(filingNote(card('RIC I (second edition) Clodius Macer 22', 'Clodius Macer', 'Carthage')), '');
  // An authority whose nomisma label never resolved is a bare slug: the sentence prints RIC's own heading instead.
  assert.equal(filingNote(card('RIC II, Part 1 (second edition) Vespasian 972', 'vespasian', 'Titus')), 'Portrait of Titus, listed under Vespasian.');
  assert.equal(filingNote(card('RIC II, Part 1 (second edition) Vespasian 972', 'septimius_severus', 'Titus')), '');
  // A parenthesised section is the heading the card already shows, so it is the one named.
  assert.equal(filingNote(card('RIC V Gallienus (joint reign) 306', 'Gallienus', 'Salonina')),
    'Portrait of Salonina, listed under Gallienus (joint reign). RIC V also has a Gallienus section.');
  // A card the collector asked for, whose portrait is its own ruler, says nothing — even where the volume splits that reign in two. On its own the
  // sibling sentence would sit under every one of RIC V's thousands of Gallienus types and answer a question he never asked.
  assert.equal(filingNote(card('RIC V Gallienus 306', 'Gallienus', 'Gallienus')), '');
  assert.equal(filingNote(card('RIC V Gallienus (joint reign) 306', 'Gallienus', 'Gallienus')), '');
  assert.equal(filingNote(card('RIC X Zeno (East) 914', 'Zeno', 'Zeno')), '');
  assert.equal(filingNote(card('RIC IV Gordian III (Caesar) 2', 'Gordian III', 'Gordian III')), '');
  assert.equal(filingNote(card('RIC IV Gordian III 95', 'Gordian III', 'Gordian III')), '');
  assert.equal(filingNote(card('RIC V Gallienus and Salonina 1', 'Gallienus', 'Gallienus')), '');
  // An empress sits under her husband, but the nomisma name is not RIC's section name, so nothing can be said that RIC would recognise.
  assert.equal(filingNote(card('RIC V Salonina (2) 93', 'Gallienus', 'Cornelia Salonina')), '');
  // Both sentences share one paragraph, the portrait first.
  assert.equal(filingNote(card('RIC V Gallienus 306', 'Gallienus', 'Salonina')),
    'Portrait of Salonina, listed under Gallienus. RIC V also has a Gallienus (joint reign) section.');
  // No sibling sentence either: a mint section, a volume without one, a name that does not split at " (".
  assert.equal(filingNote(card('RIC VII Treveri 100', 'Constantine I', 'Constantine I')), '');
  assert.equal(filingNote(card('RIC I (second edition) Nero 306', 'Nero', 'Nero')), '');
  // Gates: only OCRE, only a label that reads back as RIC.
  assert.equal(filingNote(card('RIC II, Part 1 (second edition) Vespasian 972', 'Vespasian', 'Titus', 'crro')), '');
  assert.equal(filingNote(card('ric.2_1(2).ves.972', 'Vespasian', 'Titus')), '');
  assert.equal(filingNote({ corpus: 'other', label: 'BCD Boiotia 174b', authority: null, portrait: null }), '');
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

test('RIC lookup uses an injected local provider before remote requests', async () => {
  const card = { id: 'ric.1(2).ner.306', corpus: 'ocre', label: 'RIC I (second edition) Nero 306', source: 'local' };
  const localProvider = { lookupType: async () => ({ status: 'ok', card }), lookupById: async () => ({ status: 'ok', card }) };
  const fetchImpl = () => { throw new Error('remote fetch must not run'); };
  assert.deepEqual(await lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' }, { localProvider, fetchImpl }), { status: 'ok', card });
  assert.deepEqual(await lookupById('ocre', card.id, { localProvider, fetchImpl }), { status: 'ok', card });
});

test('RIC lookup can report that online fallback is required after a local miss or bundle failure', async () => {
  const reference = { catalogue: 'RIC', volume: '', section: '', number: '99999' };
  for (const status of ['none', 'unavailable']) {
    const localProvider = { lookupType: async () => ({ status }), lookupById: async () => ({ status }) };
    assert.deepEqual(await lookupType(reference, { localProvider, online: false }), { status: 'online-required', localStatus: status, corpus: 'ocre', query: 'RIC 99999' });
    assert.deepEqual(await lookupById('ocre', 'ric.1(2).ner.306', { localProvider, online: false }), { status: 'online-required', localStatus: status, corpus: 'ocre', id: 'ric.1(2).ner.306' });
  }
});

test('lookupType distinguishes a temporarily unavailable catalogue from a connection failure', async () => {
  const unavailable = async () => ({ ok: false, status: 503, text: async () => '' });
  const limited = async () => ({ ok: false, status: 429, text: async () => '' });

  assert.deepEqual(
    await lookupType({ catalogue: 'Price', number: '23' }, { fetchImpl: unavailable }),
    { status: 'unavailable', httpStatus: 503 },
  );
  assert.deepEqual(
    await lookupType({ catalogue: 'Price', number: '23' }, { fetchImpl: limited }),
    { status: 'rate-limited', httpStatus: 429 },
  );
});

test('lookupById distinguishes a temporarily unavailable catalogue from a missing record', async () => {
  const unavailable = async () => ({ ok: false, status: 503, json: async () => ({}) });

  assert.deepEqual(await lookupById('pella', 'price.23', { fetchImpl: unavailable }), { status: 'unavailable', httpStatus: 503 });
  assert.deepEqual(await lookupById('pella', 'price.23', { fetchImpl: fakeFetch({}) }), { status: 'network' });
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
  assert.equal(Object.hasOwn(near, 'partial'), false);
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
  for (const [typed, expected] of [['Cr44/5', '44/5'], ['CRAWFORD  44/5', '44/5'], ['Cr. 44/5', '44/5'], ['Crawf 44/5', '44/5'], ['Craw. 44/5', '44/5'], ['Crawfrd 44/5', 'Crawfrd 44/5'], ['Cr . 44/5', 'Cr . 44/5']]) {
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
  for (const text of ['', 'hello', 'RIC I Nero', 'Price', 'Crawford', 'RIC XI Nero 1']) {
    assert.equal(parseReference(text), null, text);
  }
});

test('a parsed one-box reference feeds buildQuery the OCRE title shape', () => {
  assert.deepEqual(buildQuery(parseReference('RIC I² Nero 306')), { corpus: 'ocre', query: 'RIC I (second edition) Nero 306' });
  assert.deepEqual(buildQuery(parseReference('RIC II, Part 3 (2nd ed.) Hadrian 12')), { corpus: 'ocre', query: 'RIC II, Part 3 (second edition) Hadrian 12' });
  assert.deepEqual(buildQuery({ catalogue: 'RIC', volume: 'I (2nd edition)"', section: '"Nero', number: '306"' }), { corpus: 'ocre', query: 'RIC I (second edition) Nero 306' });
});

test('parseReference reads a RIC number alone, a volume without a ruler, and a ruler OCRE knows without a volume', () => {
  const ric = (volume, section, number) => ({ catalogue: 'RIC', volume, section, number });
  const cases = [
    ['RIC 972', ric('', '', '972')],
    ['ric 56a', ric('', '', '56a')],
    ['RIC 266 (aureus)', ric('', '', '266 (aureus)')],
    ['RIC I² 306', ric('I (2nd edition)', '', '306')],
    ['RIC 2/3² 12', ric('II, Part 3 (2nd edition)', '', '12')],
    ['RIC Titus 123', ric('', 'Titus', '123')],
    ['ric titus 123', ric('', 'titus', '123')],
    ['RIC Nero 306', ric('', 'Nero', '306')],
    ['Titus 123', ric('', 'Titus', '123')],
    ['Hadrian 12', ric('', 'Hadrian', '12')],
    ['Rome 306', ric('', 'Rome', '306')],
    ['  zeno  (east) 972 ', ric('', 'zeno (east)', '972')],
    ['“Gaius/Caligula 12”', ric('', 'Gaius/Caligula', '12')],
    // A ruler OCRE splits into sections ("Theodosius II (East)" and "(West)") is known by the name before the parenthesis too.
    ['Theodosius II 306', ric('', 'Theodosius II', '306')],
    ['Leo I 605', ric('', 'Leo I', '605')],
    ['Zeno 972', ric('', 'Zeno', '972')],
    ['Gordian III 1', ric('', 'Gordian III', '1')],
    ['Salonina (2) 12', ric('', 'Salonina (2)', '12')],
    ['RIC Gallienus and Salonina (2) 5', ric('', 'Gallienus and Salonina (2)', '5')],
    // Sentence punctuation a selection drags along is dropped, for every catalogue.
    ['RIC 972.', ric('', '', '972')],
    ['RIC 972 :', ric('', '', '972')],
    ['Hadrian 12,', ric('', 'Hadrian', '12')],
    ['RIC I² Nero 306;', ric('I (2nd edition)', 'Nero', '306')],
    ['Crawford 44/5.', { catalogue: 'RRC', number: '44/5', volume: '', section: '' }],
    ['SC 1266.2;', { catalogue: 'SC', number: '1266.2', volume: '', section: '' }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseReference(text), expected, text);
  for (const text of ['RIC XI Nero 1', 'RIC I 2 Nero 306', 'RIC hello 5', '972', 'RIC', 'Titus']) {
    assert.equal(parseReference(text), null, text);
  }
});

test('buildQuery squashes a blank RIC volume or ruler out of the query and marks the reference partial', () => {
  assert.deepEqual(buildQuery(parseReference('RIC 972')), { corpus: 'ocre', query: 'RIC 972', partial: true });
  assert.deepEqual(buildQuery(parseReference('Hadrian 12')), { corpus: 'ocre', query: 'RIC Hadrian 12', partial: true });
  assert.deepEqual(buildQuery(parseReference('RIC I² 306')), { corpus: 'ocre', query: 'RIC I (second edition) 306', partial: true });
  assert.deepEqual(buildQuery({ catalogue: 'RIC', volume: '"', section: ' Titus ', number: '123' }), { corpus: 'ocre', query: 'RIC Titus 123', partial: true });
  assert.equal(Object.hasOwn(buildQuery(parseReference('RIC II Titus 5')), 'partial'), false);
});

test('a RIC number without volume or ruler lists every type with that number in RIC volume order, from one typeNumber search', async () => {
  const fetchImpl = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-typenumber-972.xml') });
  assert.deepEqual(await lookupType(parseReference('RIC 972'), { fetchImpl }), { status: 'candidates', corpus: 'ocre', query: 'RIC 972', partial: true, candidates: [
    { id: 'ric.2_1(2).ves.972', title: 'RIC II, Part 1 (second edition) Vespasian 972' },
    { id: 'ric.2_3(2).hdn.972', title: 'RIC II, Part 3 (second edition) Hadrian 972' },
    { id: 'ric.3.ant.972', title: 'RIC III Antoninus Pius 972' },
    { id: 'ric.3.m_aur.972', title: 'RIC III Marcus Aurelius 972' },
    { id: 'ric.5.cara.972', title: 'RIC V Carausius 972' },
    { id: 'ric.10.zeno(2)_e.972', title: 'RIC X Zeno (East) 972' },
  ] });
  assert.deepEqual(fetchImpl.calls, [`https://numismatics.org/ocre/apis/search?q=${encodeURIComponent('(typeNumber:"972" OR typeNumber:972_*)')}`]);
  // A volume narrows the same search: none of the six is in IV.
  assert.deepEqual(await lookupType({ catalogue: 'RIC', volume: 'IV', section: '', number: '972' }, { fetchImpl }), { status: 'none', corpus: 'ocre', query: 'RIC IV 972' });
  // A guided number keeps no sentence punctuation either.
  assert.equal((await lookupType({ catalogue: 'RIC', volume: '', section: '', number: '972.' }, { fetchImpl })).candidates?.length, 6);
});

test('a ruler also keeps the sections OCRE splits it into and offers them, and only subtypes are left out of a number list', async () => {
  const feed = (...titles) => `<feed>${titles.map((title, index) => `<entry><title>${title}</title><id>x${index}</id></entry>`).join('')}</feed>`;
  const ric = (section, number) => ({ catalogue: 'RIC', volume: '', section, number });
  const gallienus = await lookupType(ric('Gallienus', '123'), { fetchImpl: fakeFetch({ 'ocre/apis/search': feed('RIC V Gallienus 123', 'RIC V Gallienus (joint reign) 123', 'RIC V Valerian 123') }) });
  assert.deepEqual(gallienus.candidates?.map((entry) => entry.title), ['RIC V Gallienus 123', 'RIC V Gallienus (joint reign) 123']);
  // One sibling alone is offered too, never opened as the type: "Zeno" finds only Zeno (East) 972.
  const zeno = await lookupType(parseReference('Zeno 972'), { fetchImpl: fakeFetch({ 'ocre/apis/search': fixture('ocre-search-typenumber-972.xml') }) });
  assert.deepEqual(zeno, { status: 'candidates', corpus: 'ocre', query: 'RIC Zeno 972', partial: true, candidates: [{ id: 'ric.10.zeno(2)_e.972', title: 'RIC X Zeno (East) 972' }] });
  const theodosius = await lookupType(parseReference('Theodosius II 306'), { fetchImpl: fakeFetch({ 'ocre/apis/search': fixture('ocre-search-typenumber-306.xml') }) });
  assert.deepEqual(theodosius.candidates?.map((entry) => entry.id), ['ric.10.theo_ii_e.306']);
  // "Salonina (2)" is a real section, not a subtype: only a colon marks one.
  const fifty = await lookupType(parseReference('RIC 50'), { fetchImpl: fakeFetch({ 'ocre/apis/search': feed('RIC V Salonina (2) 50', 'RIC IX Thessalonica 50: Subtype 1', 'RIC IX Thessalonica 50') }) });
  assert.deepEqual(fifty.candidates?.map((entry) => entry.title), ['RIC V Salonina (2) 50', 'RIC IX Thessalonica 50']);
  const salonina = await lookupType(ric('Salonina', '12'), { fetchImpl: fakeFetch({ 'ocre/apis/search': feed('RIC V Salonina 12', 'RIC V Salonina (2) 12') }) });
  assert.deepEqual(salonina.candidates?.map((entry) => entry.title), ['RIC V Salonina 12', 'RIC V Salonina (2) 12']);
});

test('with the volume the popup fills in, a ruler OCRE also splits into sections is still listed, so a sibling with the number is never skipped', async () => {
  const feed = (...titles) => `<feed>${titles.map((title, index) => `<entry><title>${title}</title><id>x${index}</id></entry>`).join('')}</feed>`;
  const ric = (volume, section, number) => ({ catalogue: 'RIC', volume, section, number });
  for (const [volume, section] of [['V', 'Gallienus'], ['IV', 'gordian iii'], ['X', 'Zeno'], ['X', 'Theodosius II'], ['X', 'Leo I'], ['V', 'Salonina'], ['V', 'Gallienus and Salonina']]) {
    assert.deepEqual(buildQuery(ric(volume, section, '12')), { corpus: 'ocre', query: `RIC ${volume} ${section} 12`, partial: true }, section);
  }
  // A section with no sibling, a sibling itself, and a volume OCRE does not list are looked up by their exact title as before.
  for (const [volume, section] of [['II, Part 1 (2nd edition)', 'Titus'], ['I (2nd edition)', 'Nero'], ['V', 'Gallienus (joint reign)'], ['V', 'Salonina (2)'], ['X', 'Zeno (East)'],
    ['X', 'Leo II'], ['V', 'Valerian'], ['IX', 'Antioch'], ['I', 'Nero'], ['V, Part 1', 'Gallienus']]) {
    assert.equal(Object.hasOwn(buildQuery(ric(volume, section, '12')), 'partial'), false, section);
  }
  const fetchImpl = fakeFetch({ 'ocre/apis/search': feed('RIC V Gallienus 123', 'RIC V Gallienus (joint reign) 123', 'RIC V Valerian 123') });
  const gallienus = await lookupType(ric('V', 'Gallienus', '123'), { fetchImpl });
  assert.deepEqual(gallienus, { status: 'candidates', corpus: 'ocre', query: 'RIC V Gallienus 123', partial: true,
    candidates: [{ id: 'x0', title: 'RIC V Gallienus 123' }, { id: 'x1', title: 'RIC V Gallienus (joint reign) 123' }] });
  assert.deepEqual(fetchImpl.calls.map((url) => decodeURIComponent(url.split('?q=')[1])), ['(typeNumber:"123" OR typeNumber:123_*) AND "RIC V" AND "Gallienus"']);
  const zeno = await lookupType(ric('X', 'Zeno', '972'), { fetchImpl: fakeFetch({ 'ocre/apis/search': fixture('ocre-search-typenumber-972.xml') }) });
  assert.deepEqual(zeno.candidates, [{ id: 'ric.10.zeno(2)_e.972', title: 'RIC X Zeno (East) 972' }]);
});

test('a volume OCRE does not list is matched by its numeral, and by its part where OCRE divides the volume, and its types are always offered', async () => {
  const ocre306 = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-typenumber-306.xml') });
  assert.deepEqual(await lookupType(parseReference('RIC I 306'), { fetchImpl: ocre306 }), { status: 'candidates', corpus: 'ocre', query: 'RIC I 306', partial: true, candidates: [
    { id: 'ric.1(2).aug.306', title: 'RIC I (second edition) Augustus 306' },
    { id: 'ric.1(2).gal.306', title: 'RIC I (second edition) Galba 306' },
    { id: 'ric.1(2).ner.306', title: 'RIC I (second edition) Nero 306' },
  ] });
  // OCRE keeps IV and V whole, so "V/2" and "IV.1" are all of V and IV.
  assert.deepEqual((await lookupType(parseReference('RIC V/2 306'), { fetchImpl: ocre306 })).candidates?.map((entry) => entry.id),
    ['ric.5.aur.306', 'ric.5.cara.306', 'ric.5.car.306', 'ric.5.dio.306', 'ric.5.gall(2).306', 'ric.5.gall(1).306', 'ric.5.post.306', 'ric.5.pro.306']);
  const ocre266 = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-typenumber-266.xml') });
  assert.deepEqual((await lookupType(parseReference('RIC IV.1 266'), { fetchImpl: ocre266 })).candidates?.map((entry) => entry.id),
    ['ric.4.crl.266', 'ric.4.el.266', 'ric.4.gor_iii.266', 'ric.4.ph_i.266', 'ric.4.ss.266_aureus', 'ric.4.ss.266_denarius']);
  // RIC II parts exist only in the second edition, so "II.3" is II.3², offered even when it is the only one; OCRE has no II.2.
  const ocre972 = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-typenumber-972.xml') });
  assert.deepEqual(await lookupType(parseReference('RIC II.3 972'), { fetchImpl: ocre972 }), { status: 'candidates', corpus: 'ocre', query: 'RIC II, Part 3 972', partial: true,
    candidates: [{ id: 'ric.2_3(2).hdn.972', title: 'RIC II, Part 3 (second edition) Hadrian 972' }] });
  assert.equal((await lookupType(parseReference('RIC II.2 306'), { fetchImpl: ocre306 })).status, 'none');
});

test('a volume narrows the typeNumber search by its OCRE title words, or by its numeral (and divided part) when OCRE does not list it', async () => {
  const fetchImpl = fakeFetch({ 'ocre/apis/search': '<feed></feed>' });
  for (const [volume, number] of [['I (2nd edition)', '12'], ['II, Part 3 (2nd edition)', '12'], ['VII', '1'], ['I', '306'], ['II, Part 3', '972'], ['IV, Part 1', '266'], ['V, Part 2', '306']]) {
    await lookupType({ catalogue: 'RIC', volume, section: '', number }, { fetchImpl });
  }
  assert.deepEqual(fetchImpl.calls.map((url) => decodeURIComponent(url.split('?q=')[1])), [
    '(typeNumber:"12" OR typeNumber:12_*) AND "RIC I (second edition)"',
    '(typeNumber:"12" OR typeNumber:12_*) AND "RIC II, Part 3 (second edition)"',
    '(typeNumber:"1" OR typeNumber:1_*) AND "RIC VII"',
    '(typeNumber:"306" OR typeNumber:306_*) AND "RIC I"',
    '(typeNumber:"972" OR typeNumber:972_*) AND "RIC II, Part 3"',
    '(typeNumber:"266" OR typeNumber:266_*) AND "RIC IV"',
    '(typeNumber:"306" OR typeNumber:306_*) AND "RIC V"',
  ]);
});

test('a number list includes the types OCRE stores with a word after the number, and a typed word keeps only its own types', async () => {
  const ocre266 = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-typenumber-266.xml') });
  const all = await lookupType(parseReference('RIC 266'), { fetchImpl: ocre266 });
  assert.equal(all.candidates?.length, 43);
  for (const title of ['RIC II Trajan 266 (aureus)', 'RIC IV Septimius Severus 266 (denarius)']) assert.ok(all.candidates.some((entry) => entry.title === title), title);
  const aurei = await lookupType(parseReference('RIC 266 (Aureus)'), { fetchImpl: ocre266 });
  assert.deepEqual(aurei.candidates?.map((entry) => entry.id), ['ric.2.tr.266_aureus', 'ric.4.ss.266_aureus']);
  // Typed without the space OCRE's titles have, the word still keeps the types the search found.
  const unspaced = await lookupType(parseReference('RIC 266(aureus)'), { fetchImpl: ocre266 });
  assert.deepEqual(unspaced.candidates?.map((entry) => entry.id), ['ric.2.tr.266_aureus', 'ric.4.ss.266_aureus']);
});

test('a ruler without a volume narrows the search by a quoted phrase, and the one hit it keeps is looked up as the type', async () => {
  const routes = { 'ocre/apis/search': fixture('ocre-search-typenumber-123-titus.xml'), 'ocre/id/ric.2_1(2).tit.123.jsonld': fixture('ocre-titus-123.jsonld') };
  const fetchImpl = fakeFetch(routes);
  const result = await lookupType({ catalogue: 'RIC', volume: '', section: 'Titus', number: '123' }, { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.id, 'ric.2_1(2).tit.123');
  assert.equal(result.card.label, 'RIC II, Part 1 (second edition) Titus 123');
  assert.equal(result.card.dates, 'AD 80');
  assert.equal(fetchImpl.calls[0], `https://numismatics.org/ocre/apis/search?q=${encodeURIComponent('(typeNumber:"123" OR typeNumber:123_*) AND "Titus"')}`);
  assert.equal(fetchImpl.calls.filter((url) => url.includes('/apis/search')).length, 1);
  assert.ok(fetchImpl.signals.every((signal) => signal === fetchImpl.signals[0]));
  // OCRE's phrase search ignores case (same two hits for "titus"), and so does the ruler check that drops RIC III Antoninus Pius 123.
  assert.equal((await lookupType(parseReference('ric titus 123'), { fetchImpl: fakeFetch(routes), cache: new Map() })).card?.id, 'ric.2_1(2).tit.123');
});

test('a number list leaves out subtypes, keeps to a chosen volume, and more hits than one page is too many to list', async () => {
  const ocre306 = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-typenumber-306.xml') });
  const all = await lookupType(parseReference('RIC 306'), { fetchImpl: ocre306 });
  assert.equal(all.status, 'candidates');
  assert.equal(all.candidates.length, 33);
  assert.ok(all.candidates.every((entry) => !entry.title.includes('Subtype')));
  assert.deepEqual([all.candidates[0].title, all.candidates.at(-1).title], ['RIC I (second edition) Augustus 306', 'RIC X Theodosius II (East) 306']);
  const first = await lookupType(parseReference('RIC I² 306'), { fetchImpl: ocre306 });
  assert.deepEqual(first.candidates.map((entry) => entry.id), ['ric.1(2).aug.306', 'ric.1(2).gal.306', 'ric.1(2).ner.306']);

  const one = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-typenumber-1.xml') });
  assert.deepEqual(await lookupType(parseReference('RIC 1'), { fetchImpl: one }), { status: 'too-many', corpus: 'ocre', query: 'RIC 1' });
  assert.equal(one.calls.length, 1);
  assert.deepEqual(await lookupType(parseReference('RIC 99999'), { fetchImpl: fakeFetch({ 'ocre/apis/search': '<feed></feed>' }) }), { status: 'none', corpus: 'ocre', query: 'RIC 99999' });
  assert.deepEqual(await lookupType(parseReference('RIC 972'), { fetchImpl: fakeFetch({}) }), { status: 'network' });
});

test('the typeNumber search asks for both cases of a letter suffix and for the types stored with a word after the number, joins a parenthetical as OCRE does, and keeps quotes, backslashes and trailing punctuation out', async () => {
  const fetchImpl = fakeFetch({ 'ocre/apis/search': '<feed></feed>' });
  for (const reference of [
    { number: '56a', section: '' }, { number: '972', section: 'Zeno (East)' }, { number: '"123\\', section: 'Ti"tus\\' },
    { number: '266 (aureus)', section: '' }, { number: '266C (denarius)', section: '' }, { number: '266 (Aureus)', section: '' }, { number: '509 (BB)', section: '' },
    { number: '1a1', section: '' }, { number: '12,', section: 'Hadrian' },
  ]) await lookupType({ catalogue: 'RIC', volume: '', ...reference }, { fetchImpl });
  assert.deepEqual(fetchImpl.calls.map((url) => decodeURIComponent(url.split('?q=')[1])), [
    '(typeNumber:"56a" OR typeNumber:56a_* OR typeNumber:"56A" OR typeNumber:56A_*)',
    '(typeNumber:"972" OR typeNumber:972_*) AND "Zeno (East)"',
    // Each miss with a ruler asks the portrait facet once more, quoted the same way.
    '(typeNumber:"972" OR typeNumber:972_*) AND (portrait_facet:"Zeno (East)" OR authority_facet:"Zeno (East)")',
    '(typeNumber:"123" OR typeNumber:123_*) AND "Titus"',
    '(typeNumber:"123" OR typeNumber:123_*) AND (portrait_facet:"Titus" OR authority_facet:"Titus")',
    'typeNumber:"266_aureus"',
    '(typeNumber:"266c_denarius" OR typeNumber:"266C_denarius")',
    '(typeNumber:"266_Aureus" OR typeNumber:"266_aureus")',
    '(typeNumber:"509_BB" OR typeNumber:"509_bb")',
    '(typeNumber:"1a1" OR typeNumber:"1A1")',
    '(typeNumber:"12" OR typeNumber:12_*) AND "Hadrian"',
    '(typeNumber:"12" OR typeNumber:12_*) AND (portrait_facet:"Hadrian" OR authority_facet:"Hadrian")',
  ]);
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

const codePoints = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => String.fromCodePoint(from + index));

test('a reference copied from a sale page reads without the hidden characters dealer pages add, and with Craw., Crawf. or Crawford', () => {
  const rrc = { catalogue: 'RRC', number: '44/5', volume: '', section: '' };
  for (const text of ['Crawford 44/5;', 'Craw. 44/5', 'Crawf. 44/5', 'Craw 44/5', 'crawf44/5', 'Cra\u00adwford 44/5']) assert.deepEqual(parseReference(text), rrc, text);
  assert.deepEqual(parseReference('RIC\u200b I² Nero 306'), { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' });
  assert.deepEqual(parseReference('SC 2195.5c\u00ad'), { catalogue: 'SC', number: '2195.5c', volume: '', section: '' });
  assert.deepEqual(parseReference('Bop\u00a0Hermaeus 20'), { catalogue: 'Bop', number: '20', volume: '', section: 'Hermaeus' });
  assert.deepEqual(parseReference('\ufeffPrice 23'), { catalogue: 'Price', number: '23', volume: '', section: '' });
  // Soft hyphen, zero-width and direction marks, bidi embeddings and isolates, word joiner and invisible operators, byte order mark.
  const hidden = ['\u00ad', ...codePoints(0x200b, 0x200f), ...codePoints(0x202a, 0x202e), ...codePoints(0x2060, 0x2064), ...codePoints(0x2066, 0x2069), '\ufeff'];
  for (const mark of hidden) {
    assert.deepEqual(parseReference(`${mark}RIC${mark} 972${mark}`), { catalogue: 'RIC', volume: '', section: '', number: '972' }, mark.codePointAt(0).toString(16));
  }
  // Removed before anything else: they never reach an Other card, its Recent chip or its acsearch term, nor count towards the length cap.
  assert.deepEqual(parseReference('HGC\u200b 4, 1218\u00ad'), { catalogue: 'Other', number: 'HGC 4, 1218', volume: '', section: '' });
  assert.deepEqual(parseReference(`${'\u200b'.repeat(200)}Price 23`), { catalogue: 'Price', number: '23', volume: '', section: '' });
});

test('a reference no type rule reads is Other, whole, unless a supported catalogue or its titles begin it; the first ";" part a type rule reads wins', () => {
  const other = (number) => ({ catalogue: 'Other', number, volume: '', section: '' });
  for (const [text, number] of [
    ['Sear 1234', 'Sear 1234'], ['HGC 4, 1218', 'HGC 4, 1218'], ['BCD Boiotia 174b; HGC 4, 1218', 'BCD Boiotia 174b; HGC 4, 1218'],
    ['SNG Cop 123', 'SNG Cop 123'], ['RPC I 1234', 'RPC I 1234'], ['hello 5', 'hello 5'], ['  “HGC  4, 1218.”  ', 'HGC 4, 1218'],
    // A ruler OCRE does not know and a Bop series without "Bop" are no type reference either.
    ['Tit 123', 'Tit 123'], ['Leo 605', 'Leo 605'], ['Theodosius 306', 'Theodosius 306'], ['Euthydemus I 24A', 'Euthydemus I 24A'],
    // Catalogues that only share their first letters with a supported one (Sydenham's CRR, Sear's CRI, Schönert-Geiss…).
    ['CRR 1234', 'CRR 1234'], ['CRI 123', 'CRI 123'], ['Croesus 5', 'Croesus 5'], ['Schönert-Geiss 123', 'Schönert-Geiss 123'], ['Crusafont 1', 'Crusafont 1'],
    ['Ricci 3', 'Ricci 3'], ['Craig 5', 'Craig 5'], ['Schulten 12', 'Schulten 12'], ['Scheers 30', 'Scheers 30'], ['SCBI 12', 'SCBI 12'],
    // Brackets that wrap the whole text are dropped; a remark's are kept, and a part that names no catalogue with a number ("RIC –") is no reference.
    ['(BCD Boiotia 174b)', 'BCD Boiotia 174b'], ['HGC 4, 1218; BCD Boiotia 174b (this coin)', 'HGC 4, 1218; BCD Boiotia 174b (this coin)'], ['Sear 1234; RIC –', 'Sear 1234; RIC –'],
  ]) assert.deepEqual(parseReference(text), other(number), text);
  assert.deepEqual(parseReference('SC 2195.5c; SNG Spaer 1712'), { catalogue: 'SC', number: '2195.5c', volume: '', section: '' });
  assert.deepEqual(parseReference('HGC 9, 1; RIC I² Nero 306'), { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' });
  assert.deepEqual(parseReference('Titus 123; RIC 972'), { catalogue: 'RIC', volume: '', section: 'Titus', number: '123' });
  // A supported reference in brackets or single quotes reads as the type, alone or as one ";" part.
  const ric972 = { catalogue: 'RIC', volume: '', section: '', number: '972' };
  for (const text of ['(RIC 972)', '[RIC 972]', '‘RIC 972’', "'RIC 972'", '(RIC 972).', '(RIC 972.)', 'HGC 4, 1218; (RIC 972)']) assert.deepEqual(parseReference(text), ric972, text);
  assert.deepEqual(parseReference('(Crawford 44/5)'), { catalogue: 'RRC', number: '44/5', volume: '', section: '' });
  assert.deepEqual(parseReference('(Price 23)'), { catalogue: 'Price', number: '23', volume: '', section: '' });
  assert.deepEqual(parseReference('(SC 1266.2)'), { catalogue: 'SC', number: '1266.2', volume: '', section: '' });
  assert.deepEqual(parseReference('(RIC I² Nero 306)'), { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' });
  // Unread text in a supported catalogue (or a title of one) is still an error, and so is text without a letter or without a digit.
  for (const text of ['Bopearachi 9C', 'RIC XI Nero 1', 'Crawfrd 44/5', 'Cr . 44/5', 'Cr x1', 'price 23 x', 'SCO 5', 'Sc. 5', 'seleucid 5', 'RIC hello 5; ',
    'Bactrian and Indo-Greek Coinage Euthydemus I 13.1', 'hello', 'Price', '972', '1; 2', ';', `HGC ${'1'.repeat(120)}`,
    // A supported catalogue named inside a numbered part, after a word: never searched as loose text.
    'cf. RIC 972', 'Ref: RIC 972', 'Lot 80: RIC 972', 'HGC 4, 1218; cf. Crawford 44/5', 'cf. Cr. 44/5', 'SNG Spaer 1712 (SC 2195.5c)',
    // The Crawford abbreviations the prefix reads are catalogue names here too.
    'cf. Craw. 44/5', 'Lot 80: Crawf. 44/5', 'HGC 4, 1218; cf. Craw. 44/5']) {
    assert.equal(parseReference(text), null, text);
  }
});

test('an Other reference is its own card, built without a request, and lookupById builds the same card for a Recent chip', async () => {
  const fetchImpl = fakeFetch({});
  const text = 'BCD Boiotia 174b; HGC 4, 1218';
  const card = { id: text, corpus: 'other', label: text, authority: null, denomination: null, mint: null, material: null, dates: null, portrait: null,
    obverse: { legend: null, description: null }, reverse: { legend: null, description: null } };
  assert.deepEqual(buildQuery({ catalogue: 'Other', number: ' "BCD Boiotia  174b; HGC 4, 1218" ' }), { corpus: 'other', query: text });
  // Typed in the guided field, an Other reference is cleaned as the Reference box cleans it, so both give the same card, Recent chip and term.
  assert.deepEqual(buildQuery({ catalogue: 'Other', number: 'HGC 4, 1218.' }), { corpus: 'other', query: 'HGC 4, 1218' });
  assert.deepEqual(buildQuery({ catalogue: 'Other', number: '(BCD Boiotia 174b)' }), { corpus: 'other', query: 'BCD Boiotia 174b' });
  assert.deepEqual(await lookupType(parseReference(text), { fetchImpl }), { status: 'ok', card });
  assert.deepEqual(await lookupType({ catalogue: 'Other', number: ` “${text}” `, volume: 'IV', section: 'Nero' }, { fetchImpl }), { status: 'ok', card });
  assert.deepEqual(await lookupById('other', text, { fetchImpl }), { status: 'ok', card });
  assert.equal(fetchImpl.calls.length, 0);
});

test('a Sear Greek (SG) reference is Other, its number normalised to "SG n", a "v" or "var." suffix as " var."', () => {
  const other = (number) => ({ catalogue: 'Other', number, volume: '', section: '' });
  for (const [text, number] of [
    ['SG 6829', 'SG 6829'], ['SG6829', 'SG 6829'], ['SG 6829v', 'SG 6829 var.'], ['SG6829v', 'SG 6829 var.'], ['SG 6829 var.', 'SG 6829 var.'],
    ['SG 6829 var', 'SG 6829 var.'], ['SGCV 6829', 'SG 6829'], ['GCV 6829', 'SG 6829'], ['Sear Greek 6829', 'SG 6829'], ['SG 6829a', 'SG 6829a'],
    ['sg 6829V', 'SG 6829 var.'], ['SG 6829a var.', 'SG 6829a var.'], ['(SG 6829v)', 'SG 6829 var.'], ['SG 6829v; SNG Spaer 1712', 'SG 6829 var.; SNG Spaer 1712'],
    // SGCV's volume (the numbers run on across both), and a dot or dash after the key.
    ['SGCV II 6829', 'SG 6829'], ['GCV II 6829', 'SG 6829'], ['SGCV 2 6829', 'SG 6829'], ['SGCV I 1234', 'SG 1234'], ['SGCV II, 6829', 'SG 6829'],
    ['SGCV 26829', 'SG 26829'], ['SG.6829', 'SG 6829'], ['SG-6829', 'SG 6829'], ['SG. 6829', 'SG 6829'], ['SG–6829', 'SG 6829'], ['SG 1 234', 'SG 1 234'],
  ]) assert.deepEqual(parseReference(text), other(number), text);
  // A card title, as a Recent chip recalls it, reads the same again, and the guided field gives the same card.
  assert.deepEqual(parseReference('SG 6829 var.'), other('SG 6829 var.'));
  assert.deepEqual(buildQuery({ catalogue: 'Other', number: 'SG6829v' }), { corpus: 'other', query: 'SG 6829 var.' });
  assert.deepEqual(buildQuery({ catalogue: 'Other', number: 'SG 6829 var.' }), { corpus: 'other', query: 'SG 6829 var.' });
  // Sear Greek Imperial and a Sear number alone stay as written; SC and its titles are untouched, and a typed part still wins.
  assert.deepEqual(parseReference('SGI 123'), other('SGI 123'));
  assert.deepEqual(parseReference('Sear 6829'), other('Sear 6829'));
  assert.deepEqual(parseReference('SC 1266.2'), { catalogue: 'SC', number: '1266.2', volume: '', section: '' });
  assert.deepEqual(parseReference('sc1630.2b'), { catalogue: 'SC', number: '1630.2b', volume: '', section: '' });
  assert.deepEqual(parseReference('Seleucid Coins (part 1) 1266.2'), { catalogue: 'SC', number: '1266.2', volume: '', section: '' });
  assert.deepEqual(parseReference('SG 6829v; SC 1'), { catalogue: 'SC', number: '1', volume: '', section: '' });
});

test('a Sear Greek reference reads with the book title in front of the key ("Sear GCV 2757"), which lot text runs on into it', () => {
  const other = (number) => ({ catalogue: 'Other', number, volume: '', section: '' });
  for (const [text, number] of [
    ['Sear GCV 2757', 'SG 2757'], ['Sear SGCV 2757', 'SG 2757'], ['Sear SG 6829', 'SG 6829'], ['Sear Greek 6829', 'SG 6829'],
    ['Sear SGCV II 6829', 'SG 6829'], ['Sear GCV 2757v', 'SG 2757 var.'], ['sear gcv 2757', 'SG 2757'], ['Sear SG-6829', 'SG 6829'],
  ]) {
    assert.equal(sgNumber(text), number, text);
    assert.deepEqual(parseReference(text), other(number), text);
  }
  // Sear's Roman and Byzantine volumes carry their own numbers, which are no SG.
  assert.equal(sgNumber('Sear 6829'), null);
  assert.deepEqual(parseReference('Sear 6829'), other('Sear 6829'));
  assert.equal(sgNumber('Sear Byzantine 1234'), null);
  assert.equal(sgNumber('Sear'), null);
});

test('lookupById gives an older SG chip ("SG6829v") the SG spelling, and keeps every other Other id as saved', async () => {
  const fetchImpl = fakeFetch({});
  for (const [id, text] of [['SG6829v', 'SG 6829 var.'], ['SGCV 6829', 'SG 6829'], ['Sear Greek 6829', 'SG 6829'], ['"BCD Boiotia 174b"', '"BCD Boiotia 174b"']]) {
    const { card } = await lookupById('other', id, { fetchImpl });
    assert.deepEqual([card.id, card.label], [text, text], id);
  }
  assert.equal(fetchImpl.calls.length, 0);
});

test('rpcUrl links an RPC reference to its RPC Online page, the volume in Arabic numerals and a part as ".2", and nothing else', () => {
  for (const [text, path] of [
    ['RPC I 1234', '1/1234'], ['RPC I, 1234', '1/1234'], ['rpc i 1234', '1/1234'], ['RPC V.2 1234', '5.2/1234'], ['RPC V/2 1234', '5.2/1234'],
    ['RPC V, Part 2 1234', '5.2/1234'], ['RPC V part 2, 1234', '5.2/1234'], ['RPC VII.1 40', '7.1/40'], ['RPC II 12', '2/12'], ['RPC IX 5', '9/5'],
    ['RPC X 1', '10/1'], ['RPC 3 567', '3/567'],
  ]) assert.equal(rpcUrl(text), `https://rpc.ashmus.ox.ac.uk/coins/${path}`, text);
  for (const text of ['RPC 1234', 'RPC I', 'RPC XI 1', 'RPC I 12a', 'RPC I 2 3', 'RPC I 1234 (this coin)', 'RIC I 1234', 'SNG Cop 123', 'Sear 1234', '', undefined, null]) {
    assert.equal(rpcUrl(text), null, String(text));
  }
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

test('a missing SC number suggests types with the same base number, and service failures are unavailable', async () => {
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
  assert.deepEqual(await lookupType({ catalogue: 'SC', number: '1266.2' }, { fetchImpl: failing }), { status: 'unavailable', httpStatus: 503 });
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
  for (const text of ['Bop', 'Bopearachchi', 'Bopearachi 9C', 'Bop 9C tetradrachm', 'Bop Euthydemus 1 24A',
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

// Routes match by substring in order: the 24A search is listed before the 24 one, whose needle is its prefix. Hits are verified by one getNuds
// request; its route answers with the real group for the eight hits of the 24A search, which holds every hit here (a record missing from a group
// is simply absent). The .xml route serves lookupById, which still fetches a card's own NUDS record.
const BIGR_ROUTES = {
  'bigr/apis/search?q=Euthydemus%20I%2024A': fixture('bigr-search-euthydemus-i-24a.xml'),
  'bigr/apis/search?q=Euthydemus%20I%2024': fixture('bigr-search-euthydemus-i-24.xml'),
  'bigr/apis/getNuds': fixture('bigr-getnuds-24a.xml'),
  'bigr/id/bigr.euthydemus_i.13.1.jsonld': fixture('bigr-euthydemus-i-13-1.jsonld'),
  'bigr/id/bigr.euthydemus_i.13.1.xml': fixture('bigr-euthydemus-i-13-1.xml'),
  'bigr/id/bigr.euthydemus_i.13.jsonld': fixture('bigr-euthydemus-i-13.jsonld'),
};
const groups = (fetchImpl) => fetchImpl.calls.filter((url) => url.includes('/apis/getNuds'));
const identifiers = (url) => decodeURIComponent(url.split('?identifiers=')[1]).split('|');

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
  // Both hits in one request, the "|" between ids encoded (the server refuses a bare one with HTTP 400); the type's card needs no .xml of its own.
  assert.deepEqual(groups(fetchImpl), ['https://numismatics.org/bigr/apis/getNuds?identifiers=bigr.euthydemus_i.13.1%7Cbigr.euthydemus_i.13']);
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('.xml')).length, 0);
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/bigr/id/') && url.endsWith('.jsonld')), ['https://numismatics.org/bigr/id/bigr.euthydemus_i.13.1.jsonld']);
  assert.ok(fetchImpl.signals.every((signal) => signal === fetchImpl.signals[0]));

  const parentFetch = fakeFetch(BIGR_ROUTES);
  const parent = await lookupType({ catalogue: 'Bop', section: 'Euthydemus I', number: '24' }, { fetchImpl: parentFetch, cache: new Map() });
  assert.equal(parent.status, 'ok');
  assert.equal(parent.card.id, 'bigr.euthydemus_i.13');
  assert.deepEqual(parent.card.bop, { king: 'Euthydemus I', series: '24', citation: 'Euthydème I 24' });
  assert.deepEqual(groups(parentFetch).map(identifiers), [['bigr.euthydemus_i.13']]);
});

test('a king BIGR does not know falls back to the series alone and offers every verified king as a labelled list', async () => {
  const fetchImpl = fakeFetch({ 'bigr/apis/search?q=Euthydemos%2024A': '<feed></feed>', 'bigr/apis/search?q=24A': fixture('bigr-search-24a.xml'), ...BIGR_ROUTES });
  const result = await lookupType({ catalogue: 'Bop', section: 'Euthydemos', number: '24A' }, { fetchImpl });
  assert.deepEqual(result, { status: 'candidates', corpus: 'bigr', query: 'Bopearachchi Euthydemos 24A', candidates: [
    { id: 'bigr.eucratides_i.28.1', title: 'Bopearachchi Eucratide I 24A (Eucratides I 28.1)' },
    { id: 'bigr.euthydemus_i.13.1', title: 'Bopearachchi Euthydème I 24A (Euthydemus I 13.1)' },
    { id: 'bigr.strato_i.28.1', title: 'Bopearachchi Straton I 24A (Strato I 28.1)' },
    { id: 'bigr.menander_i.23.1', title: 'Bopearachchi Ménandre I 24A (Menander I 23.1)' },
  ] });
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/apis/search')),
    ['https://numismatics.org/bigr/apis/search?q=Euthydemos%2024A', 'https://numismatics.org/bigr/apis/search?q=24A']);
  // The empty first search verifies nothing; the eight hits of the second cost one request.
  assert.deepEqual(groups(fetchImpl).map(identifiers), [['bigr.eucratides_i.28', 'bigr.eucratides_i.28.1', 'bigr.euthydemus_i.13.1', 'bigr.euthydemus_i.13',
    'bigr.strato_i.28', 'bigr.strato_i.28.1', 'bigr.menander_i.23', 'bigr.menander_i.23.1']]);
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('.xml') || url.endsWith('.jsonld')).length, 0);
});

test('a Bop series without a king lists the exact types of every king, its sixteen hits verified in one request', async () => {
  const fetchImpl = fakeFetch({ 'bigr/apis/search?q=9C': fixture('bigr-search-9c.xml'), 'bigr/apis/getNuds': fixture('bigr-getnuds-9c.xml') });
  const result = await lookupType({ catalogue: 'Bop', section: '', number: 'Bop-9C' }, { fetchImpl });
  assert.equal(result.status, 'candidates');
  assert.equal(result.query, 'Bopearachchi 9C');
  // The parent types ("Philoxène 9") are verified too, and left out: their series is not 9C.
  assert.deepEqual(result.candidates.map((entry) => entry.title), [
    'Bopearachchi Philoxène 9C (Philoxenus 8.1)',
    'Bopearachchi Philoxène 9C (Philoxenus 7.1)',
    'Bopearachchi Philoxène 9C (Philoxenus 6.3)',
    'Bopearachchi Antialcidas 9C (Antialcidas 12.2)',
    'Bopearachchi Ménandre I 9C (Menander I 17.3)',
    'Bopearachchi Eucratide I 9C (Eucratides I 9.2)',
    'Bopearachchi Hermaios 9C (Hermaeus 9.4)',
    'Bopearachchi Straton I 9C (Strato I 12.3)',
  ]);
  assert.deepEqual(result.candidates.map((entry) => entry.id), ['bigr.philoxenus.8.1', 'bigr.philoxenus.7.1', 'bigr.philoxenus.6.3', 'bigr.antialcidas.12.2',
    'bigr.menander_i.17.3', 'bigr.eucratides_i.9.2', 'bigr.hermaeus.9.4', 'bigr.strato_i.12.3']);
  assert.deepEqual(fetchImpl.calls.filter((url) => url.includes('/apis/search')), ['https://numismatics.org/bigr/apis/search?q=9C']);
  assert.deepEqual(groups(fetchImpl).map(identifiers), [parseFeed(fixture('bigr-search-9c.xml')).map((entry) => entry.id)]);
  assert.equal(identifiers(groups(fetchImpl)[0]).length, 16);
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('.xml')).length, 0);
  assert.ok(fetchImpl.signals.every((signal) => signal === fetchImpl.signals[0]));
});

test('with a king, several exact hits are offered by citation and BIGR number, and near misses follow the five-suggestion rule', async () => {
  // The real group for the 9C search's sixteen hits holds the Philoxenus ones; bigr.philoxenus.99 is in no group, so it stays unverified.
  const philoxenus = { 'bigr/apis/getNuds': fixture('bigr-getnuds-9c.xml') };
  const several = fakeFetch({ 'bigr/apis/search?q=Philoxenus%209C': fixture('bigr-search-philoxenus-9c.xml'), ...philoxenus });
  const result = await lookupType({ catalogue: 'Bop', section: 'Philoxenus', number: '9c' }, { fetchImpl: several });
  assert.equal(result.status, 'candidates');
  assert.deepEqual(result.candidates.map((entry) => entry.title), ['Bopearachchi Philoxène 9C (Philoxenus 8.1)', 'Bopearachchi Philoxène 9C (Philoxenus 7.1)', 'Bopearachchi Philoxène 9C (Philoxenus 6.3)']);
  assert.equal(several.calls.filter((url) => url.includes('/apis/search')).length, 1);
  assert.equal(groups(several).length, 1);
  assert.equal(several.calls.filter((url) => url.endsWith('.xml')).length, 0);

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

test('Bop lookups distinguish an unavailable search from failed or timed-out verification, never "not found"', async () => {
  const failing = async () => ({ ok: false, status: 503, text: async () => '', json: async () => ({}) });
  const euthydemus = { catalogue: 'Bop', section: 'Euthydemus I', number: '24A' };
  assert.deepEqual(await lookupType(euthydemus, { fetchImpl: failing }), { status: 'unavailable', httpStatus: 503 });
  // The search answers but getNuds fails (here 404, as a bare "|" would give 400): the hits could not be checked, which is an outage, not a miss.
  const searchOnly = fakeFetch({ 'bigr/apis/search?q=Euthydemus%20I%2024A': fixture('bigr-search-euthydemus-i-24a.xml') });
  assert.deepEqual(await lookupType(euthydemus, { fetchImpl: searchOnly }), { status: 'network' });
  assert.equal(groups(searchOnly).length, 1);
  const search = fakeFetch(BIGR_ROUTES);
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const hangGroup = (url, init) => (url.includes('/apis/getNuds') ? hang(url, init) : search(url, init));
  assert.deepEqual(await lookupType(euthydemus, { fetchImpl: hangGroup, timeoutMs: 20 }), { status: 'network' });
  const hangXml = (url, init) => (url.endsWith('.xml') ? hang(url, init) : search(url, init));
  assert.deepEqual(await lookupById('bigr', 'bigr.euthydemus_i.13.1', { fetchImpl: hangXml, cache: new Map(), timeoutMs: 20 }), { status: 'network' });
  // No hits, nothing to verify: no request, and the miss is reported as one.
  const empty = fakeFetch({ 'bigr/apis/search': '<feed></feed>' });
  assert.deepEqual(await lookupType({ catalogue: 'Bop', section: '', number: '9D' }, { fetchImpl: empty }), { status: 'none', corpus: 'bigr', query: 'Bopearachchi 9D' });
  assert.equal(groups(empty).length, 0);
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

test('a typed ruler and number that OCRE files elsewhere retries once on the portrait facet, and opens the coin the card can explain', async () => {
  const titus = JSON.stringify({ '@graph': [{ '@id': 'nm:titus', 'skos:prefLabel': [{ '@value': 'Titus', '@language': 'en' }] }] });
  // The section search finds nothing (RIC files Titus as Caesar under Vespasian); only the facet search answers.
  const routes = () => ({ 'portrait_facet': fixture('ocre-search-titus-972.xml'), 'ocre/apis/search': '<feed></feed>',
    'ocre/id/ric.2_1(2).ves.972.jsonld': fixture('ocre-vespasian-972.jsonld'), 'nomisma.org/id/titus.jsonld': titus });
  const fetchImpl = fakeFetch(routes());
  const typed = { catalogue: 'RIC', volume: 'II, Part 1 (2nd edition)', section: 'Titus', number: '972' };
  const result = await lookupType(typed, { fetchImpl, cache: new Map([['vespasian', 'Vespasian']]) });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.label, 'RIC II, Part 1 (second edition) Vespasian 972');
  // The 0.24 line is what explains the other ruler, so it must be there.
  assert.equal(filingNote(result.card), 'Portrait of Titus, listed under Vespasian.');
  const searches = fetchImpl.calls.filter((url) => url.includes('/apis/search'));
  assert.equal(searches.length, 3);
  const facets = '(typeNumber:"972" OR typeNumber:972_*) AND (portrait_facet:"Titus" OR authority_facet:"Titus") AND "RIC II, Part 1 (second edition)"';
  assert.equal(searches[2], `https://numismatics.org/ocre/apis/search?q=${encodeURIComponent(facets)}`);
  // The same retry from Any volume, where the typed ruler is a title word instead.
  const any = fakeFetch(routes());
  assert.equal((await lookupType({ ...typed, volume: '' }, { fetchImpl: any, cache: new Map([['vespasian', 'Vespasian']]) })).card?.id, 'ric.2_1(2).ves.972');
  assert.equal(any.calls.filter((url) => url.includes('/apis/search')).length, 2);
});

test('parseReference accepts verified mint-volume people and Latin aliases without a volume', () => {
  assert.deepEqual(parseReference('RIC Constantine II 287'), { catalogue: 'RIC', number: '287', volume: '', section: 'Constantine II' });
  assert.deepEqual(parseReference('RIC Constantinus II 287'), { catalogue: 'RIC', number: '287', volume: '', section: 'Constantinus II' });
  assert.equal(parseReference('RIC Constantine IIII 287'), null);
});

test('a verified person typed in a mint-organised volume uses canonical person facets', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return { ok: true, text: async () => '<feed><opensearch:totalResults>0</opensearch:totalResults></feed>' };
  };
  await lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Constantinus II', number: '287' }, { fetchImpl });
  assert.equal(calls.length, 1);
  assert.match(decodeURIComponent(calls[0]), /portrait_facet:\"Constantine II\"/);
  assert.doesNotMatch(decodeURIComponent(calls[0]), /title:\"RIC VII Constantinus II 287\"/);
});

test('a mint-filed card explains a verified obverse portrait distinct from its issuing authority', () => {
  assert.equal(filingNote({ corpus: 'ocre', label: 'RIC VII Londinium 287', authority: 'Constantine I', portrait: 'Constantine II' }),
    'Portrait of Constantine II; issuing authority Constantine I.');
});

test('a portrait-facet hit the card cannot explain is offered, never opened, and a retry that finds nothing keeps the original miss', async () => {
  // No portrait label resolves, so the card would say nothing about the other ruler: the collector chooses instead.
  const fetchImpl = fakeFetch({ 'portrait_facet': fixture('ocre-search-titus-972.xml'), 'ocre/apis/search': '<feed></feed>',
    'ocre/id/ric.2_1(2).ves.972.jsonld': fixture('ocre-vespasian-972.jsonld') });
  const typed = { catalogue: 'RIC', volume: 'II, Part 1 (2nd edition)', section: 'Titus', number: '972' };
  assert.deepEqual(await lookupType(typed, { fetchImpl, cache: new Map([['vespasian', 'Vespasian']]) }), {
    status: 'candidates', corpus: 'ocre', query: 'RIC II, Part 1 (second edition) Titus 972', partial: true,
    candidates: [{ id: 'ric.2_1(2).ves.972', title: 'RIC II, Part 1 (second edition) Vespasian 972' }],
  });
  const empty = fakeFetch({ 'ocre/apis/search': '<feed></feed>' });
  assert.deepEqual(await lookupType(typed, { fetchImpl: empty, cache: new Map() }),
    { status: 'none', corpus: 'ocre', query: 'RIC II, Part 1 (second edition) Titus 972' });
  assert.equal(empty.calls.length, 3);
  // A mint section (RIC VI–IX) and a catalogue without sections at all never make the extra request.
  const mint = fakeFetch({ 'ocre/apis/search': '<feed></feed>' });
  await lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Antioch', number: '99999' }, { fetchImpl: mint, cache: new Map() });
  assert.equal(mint.calls.filter((url) => url.includes('portrait_facet')).length, 0);
});

test('a portrait hit whose own portrait is a third ruler is offered, never opened under the name that was asked for', async () => {
  // OCRE's portrait_facet carries reverse portraits too, so a Domitian search can match a coin RIC files under Vespasian whose obverse is Titus.
  // The card would explain itself — "Portrait of Titus, listed under Vespasian." — without ever naming Domitian, so it is offered instead.
  const titus = JSON.stringify({ '@graph': [{ '@id': 'nm:titus', 'skos:prefLabel': [{ '@value': 'Titus', '@language': 'en' }] }] });
  const fetchImpl = fakeFetch({ 'portrait_facet': fixture('ocre-search-titus-972.xml'), 'ocre/apis/search': '<feed></feed>',
    'ocre/id/ric.2_1(2).ves.972.jsonld': fixture('ocre-vespasian-972.jsonld'), 'nomisma.org/id/titus.jsonld': titus });
  assert.deepEqual(await lookupType({ catalogue: 'RIC', volume: '', section: 'Domitian', number: '972' },
    { fetchImpl, cache: new Map([['vespasian', 'Vespasian']]) }), {
    status: 'candidates', corpus: 'ocre', query: 'RIC Domitian 972', partial: true,
    candidates: [{ id: 'ric.2_1(2).ves.972', title: 'RIC II, Part 1 (second edition) Vespasian 972' }],
  });
});

test('a failed portrait retry leaves the miss standing, and a section naming two people never makes the request', async () => {
  // The retry is a second chance, so its own failure must not turn a clean "not found" into "couldn't reach numismatics.org".
  const thrown = fakeFetch({ 'ocre/apis/search': '<feed></feed>' });
  let attempts = 0;
  const failing = async (url, options) => {
    if (url.includes('portrait_facet')) { attempts += 1; throw new TypeError('Failed to fetch'); }
    return thrown(url, options);
  };
  assert.deepEqual(await lookupType({ catalogue: 'RIC', volume: '', section: 'Titus', number: '9999' }, { fetchImpl: failing, cache: new Map() }),
    { status: 'none', corpus: 'ocre', query: 'RIC Titus 9999' });
  assert.equal(attempts, 1);
  // No facet holds "Leo II and Zeno", so asking for one would spend a request that cannot answer.
  const pair = fakeFetch({ 'ocre/apis/search': '<feed></feed>' });
  assert.equal((await lookupType({ catalogue: 'RIC', volume: '', section: 'Leo II and Zeno', number: '3' }, { fetchImpl: pair, cache: new Map() })).status, 'none');
  assert.equal(pair.calls.filter((url) => url.includes('portrait_facet')).length, 0);
});

test('rulers from a lot text search OCRE portrait and authority facets without a section filter, and one kept hit is the type', async () => {
  const facets = '(typeNumber:"972" OR typeNumber:972_*) AND (portrait_facet:"Titus" OR authority_facet:"Titus")';
  const routes = { 'ocre/apis/search': fixture('ocre-search-titus-972.xml'), 'ocre/id/ric.2_1(2).ves.972.jsonld': fixture('ocre-vespasian-972.jsonld') };
  const fetchImpl = fakeFetch(routes);
  const result = await lookupType({ catalogue: 'RIC', volume: '', section: '', number: '972', rulers: ['Titus'] }, { fetchImpl, cache: new Map([['titus', 'Titus']]) });
  assert.equal(result.status, 'ok');
  // Titus as Caesar sits in the Vespasian section, which a section filter would drop.
  assert.equal(result.card.label, 'RIC II, Part 1 (second edition) Vespasian 972');
  assert.equal(fetchImpl.calls[0], `https://numismatics.org/ocre/apis/search?q=${encodeURIComponent(facets)}`);
  assert.equal(fetchImpl.calls.filter((url) => url.includes('/apis/search')).length, 1);
  const titus1073 = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-titus-1073.xml'), 'ocre/id/ric.2_1(2).ves.1073.jsonld': fixture('ocre-vespasian-1073.jsonld') });
  assert.equal((await lookupType({ catalogue: 'RIC', volume: '', section: '', number: '1073', rulers: ['Titus'] }, { fetchImpl: titus1073, cache: new Map([['titus', 'Titus']]) })).card?.id, 'ric.2_1(2).ves.1073');
});

test('a lot ruler facet hit opens only when the card verifies its authority or obverse portrait', async () => {
  const titus = JSON.stringify({ '@graph': [{ '@id': 'nm:titus', 'skos:prefLabel': [{ '@value': 'Titus', '@language': 'en' }] }] });
  const fetchImpl = fakeFetch({ 'portrait_facet': fixture('ocre-search-titus-972.xml'),
    'ocre/id/ric.2_1(2).ves.972.jsonld': fixture('ocre-vespasian-972.jsonld'), 'nomisma.org/id/titus.jsonld': titus });
  const result = await lookupType({ catalogue: 'RIC', volume: '', section: '', number: '972', rulers: ['Domitian'] },
    { fetchImpl, cache: new Map([['vespasian', 'Vespasian']]) });
  assert.equal(result.status, 'candidates');
  assert.deepEqual(result.candidates, [{ id: 'ric.2_1(2).ves.972', title: 'RIC II, Part 1 (second edition) Vespasian 972' }]);
});

test('an OCRE lookup resolves the obverse portrait label too, and only when it is not the authority already asked for', async () => {
  const titus = JSON.stringify({ '@graph': [{ '@id': 'nm:titus', 'skos:prefLabel': [{ '@value': 'Titus', '@language': 'en' }] }] });
  const fetchImpl = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-titus-972.xml'), 'ocre/id/ric.2_1(2).ves.972.jsonld': fixture('ocre-vespasian-972.jsonld'),
    'nomisma.org/id/titus.jsonld': titus });
  const result = await lookupType({ catalogue: 'RIC', volume: '', section: '', number: '972', rulers: ['Titus'] }, { fetchImpl, cache: new Map([['vespasian', 'Vespasian']]) });
  assert.equal(result.card.portrait, 'Titus');
  assert.equal(fetchImpl.calls.filter((url) => url.includes('nomisma.org/id/titus.jsonld')).length, 1);
  // Portrait and authority share a slug on an ordinary type, so the request count is unchanged.
  const nero = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-nero-306.xml'), 'ocre/id/ric.1(2).ner.306.jsonld': fixture('ocre-nero-306.jsonld'),
    'nomisma.org/id/nero.jsonld': fixture('nomisma-nero.jsonld') });
  const plain = await lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' }, { fetchImpl: nero, cache: new Map() });
  assert.equal(plain.card.portrait, 'Nero');
  assert.equal(nero.calls.filter((url) => url.includes('nomisma.org/id/nero.jsonld')).length, 1);
  assert.equal(nero.calls.filter((url) => url.includes('nomisma.org/')).length, 4);
  // Only OCRE files coins under an authority, so no other corpus asks for a portrait label.
  const crro = fakeFetch({ 'crro/id/rrc-44.5.jsonld': fixture('crro-rrc-44-5.jsonld') });
  await lookupById('crro', 'rrc-44.5', { fetchImpl: crro, cache: new Map() });
  assert.equal(crro.calls.filter((url) => url.includes('roma.jsonld')).length, 0);
});

test('several rulers and a volume make one bracketed facet group, quote-safe, and several kept hits are offered with the rulers in the query', async () => {
  const feed = (...titles) => `<feed>${titles.map((title, index) => `<entry><title>${title}</title><id>x${index}</id></entry>`).join('')}</feed>`;
  const fetchImpl = fakeFetch({ 'ocre/apis/search': feed('RIC I (second edition) Nero 306', 'RIC I (second edition) Claudius 306', 'RIC I (second edition) Nero 306: Subtype 1') });
  const result = await lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: '', number: '306', rulers: ['Claudius', 'Ne"ro\\'] }, { fetchImpl });
  assert.deepEqual(result, { status: 'candidates', corpus: 'ocre', query: 'RIC I (second edition) 306 (Claudius, Nero)', partial: true, candidates: [
    { id: 'x1', title: 'RIC I (second edition) Claudius 306' },
    { id: 'x0', title: 'RIC I (second edition) Nero 306' },
  ] });
  const q = '(typeNumber:"306" OR typeNumber:306_*) AND (portrait_facet:"Claudius" OR authority_facet:"Claudius" OR portrait_facet:"Nero" OR authority_facet:"Nero") AND "RIC I (second edition)"';
  assert.deepEqual(fetchImpl.calls, [`https://numismatics.org/ocre/apis/search?q=${encodeURIComponent(q)}`]);
});

test('a RIC section asks the facets by OCRE\'s own name for it: "Gaius/Caligula" whole, Claudius Gothicus as "Claudius II Gothicus"', async () => {
  const fetchImpl = fakeFetch({ 'ocre/apis/search': '<feed></feed>' });
  await lookupType({ catalogue: 'RIC', volume: '', section: '', number: '1', rulers: ['Gaius/Caligula'] }, { fetchImpl });
  const q = '(typeNumber:"1" OR typeNumber:1_*) AND (portrait_facet:"Gaius/Caligula" OR authority_facet:"Gaius/Caligula")';
  assert.equal(fetchImpl.calls[0], `https://numismatics.org/ocre/apis/search?q=${encodeURIComponent(q)}`);
  const gothicus = fakeFetch({ 'ocre/apis/search': '<feed></feed>' });
  await lookupType({ catalogue: 'RIC', volume: '', section: '', number: '36', rulers: ['Claudius Gothicus'] }, { fetchImpl: gothicus });
  const facet = '(typeNumber:"36" OR typeNumber:36_*) AND (portrait_facet:"Claudius II Gothicus" OR authority_facet:"Claudius II Gothicus")';
  assert.equal(gothicus.calls[0], `https://numismatics.org/ocre/apis/search?q=${encodeURIComponent(facet)}`);
});

test('a single facet hit in a volume typed another way than OCRE lists it ("RIC I") is offered, never opened', async () => {
  const fetchImpl = fakeFetch({ 'ocre/apis/search': '<feed><entry><title>RIC I (second edition) Claudius 66</title><id>x0</id></entry></feed>' });
  const result = await lookupType({ catalogue: 'RIC', volume: 'I', section: '', number: '66', rulers: ['Claudius'] }, { fetchImpl });
  assert.equal(result.status, 'candidates');
  assert.deepEqual(result.candidates, [{ id: 'x0', title: 'RIC I (second edition) Claudius 66' }]);
});

test('a facet miss retries the number search without rulers once, and offers even a single hit rather than opening it', async () => {
  const feed = (...titles) => `<feed>${titles.map((title, index) => `<entry><title>${title}</title><id>x${index}</id></entry>`).join('')}</feed>`;
  // Nero has no 972 in OCRE's facets: the six types with the number are offered.
  const nero = fakeFetch({ 'portrait_facet': fixture('ocre-search-nero-972.xml'), 'ocre/apis/search': fixture('ocre-search-typenumber-972.xml') });
  const listed = await lookupType({ catalogue: 'RIC', volume: '', section: '', number: '972', rulers: ['Nero'] }, { fetchImpl: nero });
  assert.equal(listed.status, 'candidates');
  assert.equal(listed.partial, true);
  assert.equal(listed.query, 'RIC 972 (Nero)');
  assert.equal(listed.candidates.length, 6);
  assert.equal(nero.calls.length, 2);
  assert.equal(nero.calls[1], `https://numismatics.org/ocre/apis/search?q=${encodeURIComponent('(typeNumber:"972" OR typeNumber:972_*)')}`);
  const single = fakeFetch({ 'portrait_facet': '<feed></feed>', 'ocre/apis/search': feed('RIC III Faustina I 394a') });
  assert.deepEqual(await lookupType({ catalogue: 'RIC', volume: 'III', section: '', number: '394a', rulers: ['Faustina'] }, { fetchImpl: single }),
    { status: 'candidates', corpus: 'ocre', query: 'RIC III 394a (Faustina)', partial: true, candidates: [{ id: 'x0', title: 'RIC III Faustina I 394a' }] });
  assert.equal(single.calls.length, 2);
  const none = fakeFetch({ 'ocre/apis/search': '<feed></feed>' });
  assert.deepEqual(await lookupType({ catalogue: 'RIC', volume: '', section: '', number: '99999', rulers: ['Nero'] }, { fetchImpl: none }), { status: 'none', corpus: 'ocre', query: 'RIC 99999 (Nero)' });
});

test('a reference with a section, or with no rulers, ignores the rulers and searches as before', async () => {
  const fetchImpl = fakeFetch({ 'ocre/apis/search': fixture('ocre-search-elagabalus-268.xml'), 'ocre/id/': fixture('ocre-elagabalus-268.jsonld') });
  const result = await lookupType({ catalogue: 'RIC', volume: '', section: 'Elagabalus', number: '268', rulers: ['Julia Maesa'] }, { fetchImpl, cache: new Map() });
  assert.equal(fetchImpl.calls[0], `https://numismatics.org/ocre/apis/search?q=${encodeURIComponent('(typeNumber:"268" OR typeNumber:268_*) AND "Elagabalus"')}`);
  assert.equal(result.status, 'ok');
  const empty = fakeFetch({ 'ocre/apis/search': '<feed></feed>' });
  assert.deepEqual(await lookupType({ catalogue: 'RIC', volume: '', section: '', number: '972', rulers: [] }, { fetchImpl: empty }), { status: 'none', corpus: 'ocre', query: 'RIC 972' });
  assert.equal(empty.calls.length, 1);
});

test('a Krause (KM#) reference is Other, its number normalised to "KM# n", with a country kept in front', () => {
  const other = (number) => ({ catalogue: 'Other', number, volume: '', section: '' });
  for (const [text, number] of [
    ['KM# 123', 'KM# 123'], ['KM 123', 'KM# 123'], ['KM#123', 'KM# 123'], ['KM-123', 'KM# 123'], ['KM.123', 'KM# 123'], ['KM–123', 'KM# 123'],
    ['KM# 123.2', 'KM# 123.2'], ['KM# 123.2a', 'KM# 123.2a'], ['KM# A123', 'KM# A123'], ['km# a123', 'KM# A123'], ['KM 123.2A', 'KM# 123.2a'],
    ['(KM# 123)', 'KM# 123'], ['KM# 123.', 'KM# 123'],
    // A country typed in front is kept, up to four words.
    ['Netherlands KM# 123', 'Netherlands KM# 123'], ['German States Rostock KM# 123', 'German States Rostock KM# 123'],
    // Letters in any script, so prices.js must read the country the same way ("Württemberg" cannot be spelled without the umlaut).
    ['Württemberg KM 123', 'Württemberg KM# 123'], ['México KM-123', 'México KM# 123'],
    ['netherlands km 123', 'netherlands KM# 123'],
    // Every part is read, KM or SG.
    ['KM# 123; SG 6829', 'KM# 123; SG 6829'], ['SG 6829; KM-123', 'SG 6829; KM# 123'],
  ]) assert.deepEqual(parseReference(text), other(number), text);
  assert.equal(kmNumber('KM# 123.2a'), 'KM# 123.2a');
  assert.equal(kmNumber('Netherlands KM 123'), 'Netherlands KM# 123');
  assert.equal(kmNumber('Scholten 782'), null);
  assert.equal(kmNumber(undefined), null);
  // A letter that case-folds to ASCII (KELVIN SIGN, long s) passes the key pattern, so reading the number back must never throw and kill the box.
  assert.equal(kmNumber('KM 123'), 'KM# 123');
  for (const text of ['KM-K5', 'KM ſ123', 'KM 123K']) {
    assert.doesNotThrow(() => kmNumber(text), text);
    assert.doesNotThrow(() => parseReference(text), text);
  }
  // "KM" inside a word is never a key, and a country of five words is text.
  for (const text of ['KMS 1', 'AKM 5', 'KMS1', 'KM123', 'One Two Three Four Five KM# 123']) assert.deepEqual(parseReference(text), other(text), text);
  // A card title, as a Recent chip recalls it, reads the same again, and the guided field gives the same card.
  assert.deepEqual(buildQuery({ catalogue: 'Other', number: 'KM-123' }), { corpus: 'other', query: 'KM# 123' });
  assert.deepEqual(buildQuery({ catalogue: 'Other', number: 'Netherlands KM# 123' }), { corpus: 'other', query: 'Netherlands KM# 123' });
  // The catalogues with type data are untouched.
  assert.deepEqual(parseReference('SC 1266.2'), { catalogue: 'SC', number: '1266.2', volume: '', section: '' });
  assert.deepEqual(parseReference('KM# 123; SC 1'), { catalogue: 'SC', number: '1', volume: '', section: '' });
});

test('Krause\'s Y# is the KM family, normalised the same way, so one number is one row and one search', () => {
  const other = (number) => ({ catalogue: 'Other', number, volume: '', section: '' });
  for (const [text, number] of [
    ['Y#31', 'Y# 31'], ['Y# 31', 'Y# 31'], ['Y 31', 'Y# 31'], ['Y-31', 'Y# 31'], ['Y.31', 'Y# 31'], ['Y–31', 'Y# 31'],
    ['Y#31a', 'Y# 31a'], ['Y#59.3', 'Y# 59.3'], ['y#31', 'Y# 31'], ['Y# A31', 'Y# A31'],
    // A country in front narrows a number that repeats, as it does for KM.
    ['Russia Y# 59.3', 'Russia Y# 59.3'], ['China Empire Y 31', 'China Empire Y# 31'],
  ]) {
    assert.equal(kmNumber(text), number, text);
    assert.deepEqual(parseReference(text), other(number), text);
  }
  // The KM spelling is untouched, and Y needs its separator and its own word, as KM does.
  assert.equal(kmNumber('KM# 123.2a'), 'KM# 123.2a');
  assert.equal(kmNumber('KM 123'), 'KM# 123');
  for (const text of ['Y31', 'SY 31', 'Yeoman 31', 'Scholten 782']) assert.equal(kmNumber(text), null, text);
});

// A sentence is not a reference (0.22): prose has nothing prices.js can search, so the Reference box says so instead of showing a prices-only card.
test('an Other reference whose every part is too long to be a citation is not read', () => {
  const other = (number) => ({ catalogue: 'Other', number, volume: '', section: '' });
  assert.equal(parseReference('Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago, bought in Vienna'), null);
  assert.equal(parseReference('bought in Vienna in 2014 from a dealer I no longer remember'), null);
  for (const text of ['BCD Boiotia 174b; HGC 4, 1218', 'SNG von Aulock 8305', 'Sylloge Nummorum Graecorum Copenhagen 123', 'RPC I 1234; SNG Cop 5']) {
    assert.deepEqual(parseReference(text), other(text), text);
  }
  assert.deepEqual(parseReference('German States Rostock KM# 123'), other('German States Rostock KM# 123'));
  // One short part carries the reference, whatever prose stands beside it; a trailing remark is the reference's, not its own words.
  assert.deepEqual(parseReference('a very long sentence of eight words here; HGC 4, 1218'), other('a very long sentence of eight words here; HGC 4, 1218'));
  assert.deepEqual(parseReference('BCD Boiotia 174b (this coin, ex Berk 1991)'), other('BCD Boiotia 174b (this coin, ex Berk 1991)'));
});

// A group lot cites several numbers under one key, and that run is one citation, not prose: the words are counted with the run collapsed.
test('a citation listing several numbers under one catalogue is still read', () => {
  const other = (number) => ({ catalogue: 'Other', number, volume: '', section: '' });
  for (const text of ['SNG von Aulock 5960, 5961, 5962, 5963, 5964, 5965, 5966', 'SNG Copenhagen 12, 13, 14, 15, 16, 17', 'Svoronos pl. 20, 1, 2, 3, 4, 5, 6', 'HGC 4, 1218, 1219, 1220, 1221, 1222, 1223']) {
    assert.equal(searchablePart(text), true, text);
    assert.deepEqual(parseReference(text), other(text), text);
  }
  // Prose is alphabetic where a run of numbers is not, so it is still refused, and so is a sentence that ends on a number.
  assert.equal(searchablePart('Good VF, 3.21 g, 6h, lot 42, from an old album, ex Berk 12 years ago'), false);
  assert.equal(searchablePart('a lovely old cabinet piece bought in Vienna in 2014'), false);
});

// A plain numeral is the volume a dealer writes; OCRE shelves the same numeral under several titles ("II", "II, Part 1 (second edition)").
test('a plain volume numeral reaches every volume of its family, the volume as typed first', () => {
  const entry = (id, title) => ({ id, title });
  const trajan972 = entry('ric.2.tr.972', 'RIC II Trajan 972');
  const vespasian972 = entry('ric.2_1(2).ves.972', 'RIC II, Part 1 (second edition) Vespasian 972');
  const hadrian972 = entry('ric.2_3(2).hdn.972', 'RIC II, Part 3 (second edition) Hadrian 972');
  const domitian720 = entry('ric.2_1(2).dom.720', 'RIC II, Part 1 (second edition) Domitian 720');
  const trajan720 = entry('ric.2.tr.720', 'RIC II Trajan 720');
  // "RIC II 972" is in no OCRE title, but II.1² and II.3² both hold the number: they are offered, never one of them opened.
  assert.deepEqual(pickRicEntries([vespasian972, hadrian972], parseReference('RIC II 972')),
    { status: 'candidates', candidates: [vespasian972, hadrian972], partial: true });
  // A ruler the volume as typed does not have is looked for in the rest of the family, and offered because the volume was not the one typed.
  assert.deepEqual(pickRicEntries([domitian720, trajan720], parseReference('RIC II Domitian 720')),
    { status: 'candidates', candidates: [domitian720], partial: true });
  // The volume as typed wins when it has the ruler asked for: II Trajan 972 opens although II.1² also holds 972.
  assert.deepEqual(pickRicEntries([trajan972, vespasian972], parseReference('RIC II Trajan 972')), { status: 'ok', entry: trajan972 });
  // A volume that names its part or edition still asks for itself alone.
  assert.deepEqual(pickRicEntries([vespasian972, hadrian972], parseReference('RIC II.3 Hadrian 972')),
    { status: 'candidates', candidates: [hadrian972], partial: true });
  assert.deepEqual(pickRicEntries([trajan972, vespasian972, hadrian972], parseReference('RIC 972')),
    { status: 'candidates', candidates: [trajan972, vespasian972, hadrian972], partial: true });
});
