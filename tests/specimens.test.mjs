import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchSpecimens, lookupType, parseReference } from '../extension/lookup.js';
import { bundle, skip } from './helpers/bundle.mjs';

// The fixture is Nomisma's own answer to the specimen query for RIC I² Nero 306 (https://nomisma.org/query, 2026-09-24), trimmed by hand to the
// variables fetchSpecimens asks for. Six specimens, every one with both sides imaged and a holding collection.
const fixture = () => readFileSync(new URL('./fixtures/nomisma-specimens-nero-306.json', import.meta.url), 'utf8');
const nero = { id: 'ric.1(2).ner.306', corpus: 'ocre', label: 'RIC I (second edition) Nero 306', uri: 'https://numismatics.org/ocre/id/ric.1(2).ner.306' };
const answer = (text) => async () => ({ ok: true, status: 200, headers: new Map(), text: async () => text });

test('one query to Nomisma, asked for the type under both schemes, answered with at most three specimen pairs', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push({ url, init }); return answer(fixture())(); };
  const specimens = await fetchSpecimens(nero, { fetchImpl });
  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://nomisma.org/query');
  assert.equal(url.searchParams.get('output'), 'json');
  assert.equal(requests[0].init.headers.Accept, 'application/sparql-results+json');
  const query = url.searchParams.get('query');
  // The predicates Nomisma documents for a physical coin (nomisma.org/documentation/contribute): the type, the collection, the two sides and their
  // FOAF images. The type is asked for under http and https alike, since the corpora do not agree on one.
  for (const part of ['nmo:hasTypeSeriesItem', 'nmo:NumismaticObject', 'nmo:hasCollection', 'nmo:hasObverse', 'nmo:hasReverse', 'foaf:thumbnail', 'foaf:depiction',
    '<http://numismatics.org/ocre/id/ric.1(2).ner.306>', '<https://numismatics.org/ocre/id/ric.1(2).ner.306>', 'LIMIT 6']) {
    assert.ok(query.includes(part), part);
  }
  assert.deepEqual(specimens, [
    { page: 'http://numismatics.org/collection/1918.999.111', collection: 'American Numismatic Society',
      obverse: 'https://numismatics.org/collectionimages/19001949/1918/1918.999.111.obv.width175.jpg',
      reverse: 'https://numismatics.org/collectionimages/19001949/1918/1918.999.111.rev.width175.jpg' },
    { page: 'https://gallica.bnf.fr/ark:/12148/btv1b104456737', collection: 'Bibliothèque nationale de France',
      obverse: 'https://gallica.bnf.fr/iiif/ark:/12148/btv1b104456737/f1/full/,120/0/native.jpg',
      reverse: 'https://gallica.bnf.fr/iiif/ark:/12148/btv1b104456737/f2/full/,120/0/native.jpg' },
    { page: 'https://hdl.handle.net/428894.vzg/c4aeee88-d25a-4a13-a81d-6244757e5b5a', collection: 'Oldenburg Municipal Museum',
      obverse: 'https://www.kenom.de/iiif/image/record_DE-MUS-109513_kenom_213442/record_DE-MUS-109513_kenom_213442_vs.jpg/full/120,/0/default.jpg',
      reverse: 'https://www.kenom.de/iiif/image/record_DE-MUS-109513_kenom_213442/record_DE-MUS-109513_kenom_213442_rs.jpg/full/120,/0/default.jpg' },
  ]);
});

test('only http(s) images and pages are kept: a javascript: thumbnail falls back to the depiction, a side with none drops its specimen', async () => {
  const data = JSON.parse(fixture());
  const [first, second, third] = data.results.bindings;
  first.obverseThumbnail.value = 'javascript:alert(1)';
  second.reverseThumbnail.value = 'javascript:alert(1)';
  second.reverseDepiction.value = 'data:image/png;base64,AAAA';
  third.object.value = 'javascript:alert(1)';
  const specimens = await fetchSpecimens(nero, { fetchImpl: answer(JSON.stringify(data)) });
  assert.equal(specimens.length, 3);
  assert.equal(specimens[0].obverse, 'https://numismatics.org/collectionimages/19001949/1918/1918.999.111.obv.width350.jpg');
  assert.deepEqual(specimens.map((specimen) => specimen.collection), ['American Numismatic Society', 'Münzkabinett der Universität Göttingen', 'American Numismatic Society']);
  for (const specimen of specimens) {
    for (const url of [specimen.page, specimen.obverse, specimen.reverse]) assert.match(url, /^https?:\/\//);
  }
});

test('the same specimen twice is one pair, and a specimen with no collection name is not shown', async () => {
  const data = JSON.parse(fixture());
  data.results.bindings.splice(1, 0, structuredClone(data.results.bindings[0]));
  delete data.results.bindings[2].collection;
  const specimens = await fetchSpecimens(nero, { fetchImpl: answer(JSON.stringify(data)) });
  assert.deepEqual(specimens.map((specimen) => specimen.page), [
    'http://numismatics.org/collection/1918.999.111',
    'https://hdl.handle.net/428894.vzg/c4aeee88-d25a-4a13-a81d-6244757e5b5a',
    'https://hdl.handle.net/428894.vzg/139c4117-2be1-44f9-9873-f2f24b1fe907',
  ]);
});

test('no type, no request: an Other card, a card with no id and an id that could break out of the query', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return answer(fixture())(); };
  assert.deepEqual(await fetchSpecimens({ id: 'BCD Boiotia 174b', corpus: 'other', label: 'BCD Boiotia 174b' }, { fetchImpl }), []);
  assert.deepEqual(await fetchSpecimens({ corpus: 'ocre' }, { fetchImpl }), []);
  assert.deepEqual(await fetchSpecimens({ id: 'ric.1> } ; DROP <x', corpus: 'ocre' }, { fetchImpl }), []);
  assert.deepEqual(await fetchSpecimens(null, { fetchImpl }), []);
  assert.equal(requests, 0);
});

test('a failed, unreadable, oversized or slow query is no specimens', { timeout: 5000 }, async () => {
  assert.deepEqual(await fetchSpecimens(nero, { fetchImpl: async () => ({ ok: false, status: 503, headers: new Map() }) }), []);
  assert.deepEqual(await fetchSpecimens(nero, { fetchImpl: async () => { throw new TypeError('offline'); } }), []);
  assert.deepEqual(await fetchSpecimens(nero, { fetchImpl: answer('<html>not json</html>') }), []);
  assert.deepEqual(await fetchSpecimens(nero, { fetchImpl: answer('{"results":{"bindings":"none"}}') }), []);
  const huge = async () => ({ ok: true, status: 200, headers: new Map([['content-length', String(64 * 1024 * 1024)]]), text: async () => fixture() });
  assert.deepEqual(await fetchSpecimens(nero, { fetchImpl: huge }), []);
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const started = Date.now();
  assert.deepEqual(await fetchSpecimens(nero, { fetchImpl: hang, timeoutMs: 20 }), []);
  assert.ok(Date.now() - started < 2000);
});

// The nine bundled OCRE ids (of 68,123 bundled records) that carry a "?" or a "," — a doubtful letter and RIC II.3² Hadrian's number lists. Both
// characters may stand inside a SPARQL IRI, so each is asked for, literally and with the two characters percent-encoded, under both schemes.
const PUNCTUATED_IDS = [
  'ric.2.hdn.312a?', 'ric.2.hdn.323e?', 'ric.2_3(2).hdn.1299-1303,1305-1309', 'ric.2_3(2).hdn.1343-1347,1349', 'ric.2_3(2).hdn.1715-1719,1721-1722',
  'ric.2_3(2).hdn.2848,2850', 'ric.2_3(2).hdn.2849,2850A', 'ric.2_3(2).hdn.2911,2913', 'ric.2_3(2).hdn.870-873,875',
];
test('a bundled id with a "?" or a "," is asked for, as written and percent-encoded', async () => {
  for (const id of PUNCTUATED_IDS) {
    const requests = [];
    await fetchSpecimens({ id, corpus: 'ocre' }, { fetchImpl: async (url) => { requests.push(url); return answer(fixture())(); } });
    assert.equal(requests.length, 1, id);
    const query = new URL(requests[0]).searchParams.get('query');
    const encoded = id.replace(/[?,]/g, (character) => encodeURIComponent(character));
    for (const scheme of ['http', 'https']) {
      assert.ok(query.includes(`<${scheme}://numismatics.org/ocre/id/${id}>`), `${id} ${scheme}`);
      assert.ok(query.includes(`<${scheme}://numismatics.org/ocre/id/${encoded}>`), `${id} ${scheme} encoded`);
    }
  }
});

// Anything that could end the IRI, start another term or hide in it is refused before a request is made.
test('an id that could break out of the query makes no request', async () => {
  const HOSTILE = ['ric.1>', 'ric.1"', "ric.1'", 'ric 1', 'ric.1\n', 'ric.1\r', 'ric.1#x', 'ric.1%3E', 'ric.1{', 'ric.1|', 'ric.1`', 'ric.1\\', '<ric.1',
    'ric.1> } ; DROP <x', '', 'ric\u00a01', 'ric\u200b1', '../ric.1', 'ric.1\u0000', 'rice\u0301', 'ric.1^', 'ric.1}'];
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return answer(fixture())(); };
  for (const id of HOSTILE) assert.deepEqual(await fetchSpecimens({ id, corpus: 'ocre' }, { fetchImpl }), [], JSON.stringify(id));
  assert.equal(requests, 0);
});

test('the caller cancelling stops the request itself', async () => {
  const controller = new AbortController();
  let seen;
  const fetchImpl = (url, { signal }) => { seen = signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))); };
  const pending = fetchSpecimens(nero, { fetchImpl, signal: controller.signal });
  controller.abort();
  assert.deepEqual(await pending, []);
  assert.equal(seen.aborted, true);
});

// 0.34 final review: PCO (Lorber's CPE) and AGCO (Newell's Demetrius Poliorcetes) cards are type cards like the others, so the strip asks for them
// too, under the URI each corpus publishes (http://numismatics.org/pco/id/cpe.1_1.1, http://numismatics.org/agco/id/newell.demetrius.1) and https.
for (const [corpus, id] of [['pco', 'cpe.1_1.1'], ['pco', 'cpe.1_2.B549'], ['agco', 'newell.demetrius.1'], ['agco', 'newell.demetrius.45']]) {
  test(`a ${corpus} card (${id}) asks Nomisma once for its type, under both schemes`, async () => {
    const requests = [];
    await fetchSpecimens({ id, corpus }, { fetchImpl: async (url) => { requests.push(url); return answer(fixture())(); } });
    assert.equal(requests.length, 1);
    const query = new URL(requests[0]).searchParams.get('query');
    for (const scheme of ['http', 'https']) assert.ok(query.includes(`<${scheme}://numismatics.org/${corpus}/id/${id}>`), `${id} ${scheme}`);
  });
}

// The cards the package itself opens: CPE 330, Newell Demetrius 45, and CPE 330 again as reached from Svoronos 487, filed in PCO under its CPE id.
test('the bundled CPE, Newell and Svoronos-filed cards each ask for their own type', { skip }, async () => {
  const noRequest = async (url) => { throw new Error(`no request: ${url}`); };
  for (const [text, corpus, id] of [['CPE 330', 'pco', 'cpe.1_1.330'], ['Newell Demetrius 45', 'agco', 'newell.demetrius.45'],
    ['Svoronos 487', 'pco', 'cpe.1_1.330']]) {
    const found = await lookupType(parseReference(text), { localProvider: bundle, fetchImpl: noRequest });
    assert.equal(found.status, 'ok', text);
    assert.equal(found.card.corpus, corpus, text);
    assert.equal(found.card.id, id, text);
    const requests = [];
    await fetchSpecimens(found.card, { fetchImpl: async (url) => { requests.push(url); return answer(fixture())(); } });
    assert.equal(requests.length, 1, text);
    assert.ok(new URL(requests[0]).searchParams.get('query').includes(`<http://numismatics.org/${corpus}/id/${id}>`), text);
  }
});
