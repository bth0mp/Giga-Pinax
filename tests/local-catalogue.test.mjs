import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { catalogueMetadataText, createLocalCatalogue, numberKey, packedRecordToCard } from '../extension/local-catalogue.js';
import { findReferences, lotLookup } from '../extension/lot.js';
import { lookupType, nomismaSlugs, parseReference, portraitSlug, toCard } from '../extension/lookup.js';

const whole = (prefix) => [{ file: `records-${prefix}.json`, from: '' }];
const metadata = {
  schemaVersion: 1, corpus: 'ocre', recordCount: 12, activeRecordCount: 11,
  aliases: { 'ric.1(2).ner.306-old': 'ric.1(2).ner.306' },
  shards: Object.fromEntries(['1(2)', '2', '2_1(2)', '2_3(2)', '4', '7'].map((prefix) => [prefix, whole(prefix)])),
};
const index = { schemaVersion: 1, entries: [
  ['ric.1(2).ner.306', 'RIC I (second edition) Nero 306'],
  ['ric.2_1(2).ves.972', 'RIC II, Part 1 (second edition) Vespasian 972'],
  ['ric.7.ar.287', 'RIC VII Arelate 287'],
  ['ric.7.lon.287', 'RIC VII Londinium 287'],
  ['ric.7.lug.287', 'RIC VII Lugdunum 287'],
  ['ric.7.rom.287', 'RIC VII Rome 287'],
  ['ric.2.tr.720', 'RIC II Trajan 720'],
  ['ric.2_1(2).dom.720', 'RIC II, Part 1 (second edition) Domitian 720'],
  ['ric.2_3(2).hdn.720', 'RIC II, Part 3 (second edition) Hadrian 720'],
  ['ric.4.ph_i.27A', 'RIC IV Philip I 27A'],
  ['ric.4.ph_i.27B', 'RIC IV Philip I 27B'],
] };
// The index positions each RIC number's leading integer reaches, as the importer writes them beside the index, under the
// count of the entries they were taken from.
const numbers = { schemaVersion: 1, entryCount: index.entries.length, numbers: { 27: [9, 10], 287: [2, 3, 4, 5], 306: [0], 720: [6, 7, 8], 972: [1] } };
const records = {
  'ric.1(2).ner.306': { i: 'ric.1(2).ner.306', l: 'RIC I (second edition) Nero 306', a: ['nero'], d: ['as'], m: ['rome'], x: ['ae'], s: '0062', e: '0068', o: { l: 'NERO', d: 'Head of Nero', p: ['nero'] }, r: { d: 'Temple' } },
  'ric.2_1(2).ves.972': { i: 'ric.2_1(2).ves.972', l: 'RIC II, Part 1 (second edition) Vespasian 972', a: ['vespasian'], d: ['denarius', 'aureus'], o: { p: ['titus'] }, r: {} },
  'ric.7.ar.287': { i: 'ric.7.ar.287', l: 'RIC VII Arelate 287', a: ['constantine_i'], o: { p: ['constantine_i'] }, r: {} },
  'ric.7.lon.287': { i: 'ric.7.lon.287', l: 'RIC VII Londinium 287', a: ['constantine_i'], o: { p: ['constantine_ii'] }, r: {} },
  'ric.7.lug.287': { i: 'ric.7.lug.287', l: 'RIC VII Lugdunum 287', a: ['constantine_i'], o: { p: ['constantius_ii'] }, r: {} },
  'ric.7.rom.287': { i: 'ric.7.rom.287', l: 'RIC VII Rome 287', a: ['licinius'], o: { p: ['licinius'] }, r: {} },
  'ric.2.tr.720': { i: 'ric.2.tr.720', l: 'RIC II Trajan 720', a: ['trajan'], o: { p: ['trajan'] }, r: {} },
  'ric.2_1(2).dom.720': { i: 'ric.2_1(2).dom.720', l: 'RIC II, Part 1 (second edition) Domitian 720', a: ['domitian'], o: { p: ['domitian'] }, r: {} },
  'ric.2_3(2).hdn.720': { i: 'ric.2_3(2).hdn.720', l: 'RIC II, Part 3 (second edition) Hadrian 720', a: ['hadrian'], o: { p: ['hadrian'] }, r: {} },
  'ric.4.ph_i.27A': { i: 'ric.4.ph_i.27A', l: 'RIC IV Philip I 27A', a: ['philip_the_arab'], o: { p: ['philip_the_arab'] }, r: {} },
  'ric.4.ph_i.27B': { i: 'ric.4.ph_i.27B', l: 'RIC IV Philip I 27B', a: ['philip_the_arab'], o: { p: ['philip_the_arab'] }, r: {} },
};

function fixtureFetch(overrides = {}) {
  const routes = { 'metadata.json': metadata, 'index.json': index, 'numbers.json': numbers, 'records-1(2).json': { schemaVersion: 1, records }, 'records-2.json': { schemaVersion: 1, records }, 'records-2_1(2).json': { schemaVersion: 1, records }, 'records-2_3(2).json': { schemaVersion: 1, records }, 'records-4.json': { schemaVersion: 1, records }, 'records-7.json': { schemaVersion: 1, records }, ...overrides };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const key = Object.keys(routes).find((part) => String(url).endsWith(part));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    const value = routes[key];
    if (value instanceof Error) throw value;
    // A number stands for the status a file comes back with, so a bundle with one file missing can be served as the package would serve it.
    if (typeof value === 'number') return { ok: false, status: value, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => value };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('local catalogue resolves exact RIC titles without loading an unrelated shard', async () => {
  const fetchImpl = fixtureFetch();
  const local = createLocalCatalogue({ fetchImpl, baseUrl: 'moz-extension://test/data/', cache: new Map([['nero', 'Nero'], ['as', 'As'], ['rome', 'Rome'], ['ae', 'Bronze']]) });
  const result = await local.lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.id, 'ric.1(2).ner.306');
  assert.equal(result.card.source, 'local');
  assert.deepEqual(fetchImpl.calls.map((url) => url.split('/').pop()), ['metadata.json', 'index.json', 'numbers.json', 'records-1(2).json']);
});

test('local catalogue preserves RIC partial, suffix, volume and sibling candidate rules', async () => {
  const fetchImpl = fixtureFetch();
  const local = createLocalCatalogue({ fetchImpl, baseUrl: 'moz-extension://test/data/' });
  const partial = await local.lookupType({ catalogue: 'RIC', volume: '', section: '', number: '972' });
  assert.equal(partial.status, 'ok');
  assert.equal(partial.card.id, 'ric.2_1(2).ves.972');
  assert.equal((await local.lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306A' })).status, 'none');
});

test('lookupById respects aliases and caches metadata, index and shards', async () => {
  const fetchImpl = fixtureFetch();
  const local = createLocalCatalogue({ fetchImpl, baseUrl: 'moz-extension://test/data/' });
  const first = await local.lookupById('ocre', 'ric.1(2).ner.306-old');
  const second = await local.lookupById('ocre', 'ric.1(2).ner.306');
  assert.equal(first.card.id, 'ric.1(2).ner.306');
  assert.equal(second.status, 'ok');
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('metadata.json')).length, 1);
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('records-1(2).json')).length, 1);
});

test('mint-volume person lookup filters authority and obverse portraits before opening a type', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/' });
  const result = await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Constantine II', number: '287' });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.id, 'ric.7.lon.287');
});

test('a local person miss labels broader same-reference candidates honestly', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/' });
  const result = await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Constantine III', number: '287' });
  assert.equal(result.status, 'candidates');
  assert.equal(result.personMismatch, true);
  assert.equal(result.candidates.length, 4);
});

test('a strict id hint opens only when it matches the parsed citation and explicit mint', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/' });
  assert.equal((await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: '', number: '287', id: 'ric.7.lon.287' })).card.id, 'ric.7.lon.287');
  const conflicting = await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Rome', number: '287', id: 'ric.7.lon.287' });
  assert.equal(conflicting.card.id, 'ric.7.rom.287');
  const wrongPerson = await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: '', number: '287', rulers: ['Constantius II'], id: 'ric.7.lon.287' });
  assert.equal(wrongPerson.card.id, 'ric.7.lug.287');
  const mintAndWrongPerson = await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Londinium', number: '287', rulers: ['Constantius II'], id: 'ric.7.lon.287' });
  assert.equal(mintAndWrongPerson.status, 'candidates');
  assert.equal(mintAndWrongPerson.personMismatch, true);
});

test('missing and corrupt bundles fail closed and never claim a catalogue miss', async () => {
  const missing = createLocalCatalogue({ fetchImpl: fixtureFetch({ 'metadata.json': new Error('missing') }), baseUrl: 'moz-extension://test/data/' });
  assert.equal((await missing.lookupType({ catalogue: 'RIC', volume: '', section: '', number: '1' })).status, 'unavailable');
  const corrupt = createLocalCatalogue({ fetchImpl: fixtureFetch({ 'metadata.json': { schemaVersion: 2 } }), baseUrl: 'moz-extension://test/data/' });
  assert.equal((await corrupt.lookupById('ocre', 'ric.1(2).ner.306')).status, 'unavailable');
  // numbers.json decides which titles a number is read from, so a bundle whose number index is missing, foreign or pointing outside the index it
  // was built for must fail closed. "none" from any of these would tell a collector the coin is not in RIC when only the file is wrong.
  for (const override of [{ 'numbers.json': 404 }, { 'numbers.json': { ...numbers, schemaVersion: 2 } },
    { 'numbers.json': { ...numbers, numbers: 306 } }, { 'numbers.json': { ...numbers, numbers: { 306: [99] } } },
    // A schema-valid index of another, smaller catalogue: every position in it resolves, and the answers would be its answers, not this bundle's.
    { 'numbers.json': { ...numbers, entryCount: 10 } }, { 'numbers.json': { schemaVersion: 1, numbers: numbers.numbers } },
    { 'metadata.json': { ...metadata, shards: 7 } }, { 'records-1(2).json': { schemaVersion: 1, records: 306 } },
    // Past "z" there is no letter left to name a part, and fromCharCode would carry on into punctuation.
    { 'metadata.json': { ...metadata, shards: { ...metadata.shards, 3: Array.from({ length: 27 }, (value, position) => (
      { file: `records-3.${String.fromCharCode(97 + position)}.json`, from: position === 0 ? '' : `ric.3.x.${String(position).padStart(3, '0')}` })) } } }]) {
    const local = createLocalCatalogue({ fetchImpl: fixtureFetch(override), baseUrl: 'moz-extension://test/data/' });
    const result = await local.lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' });
    assert.equal(result.status, 'unavailable', JSON.stringify(override));
  }
});

test('packed cards use verified cached labels and omit ambiguous summaries and portraits', () => {
  const cache = new Map([['vespasian', 'Vespasian'], ['titus', 'Titus'], ['denarius', 'Denarius'], ['aureus', 'Aureus']]);
  const card = packedRecordToCard(records['ric.2_1(2).ves.972'], cache);
  assert.equal(card.authority, 'Vespasian');
  assert.equal(card.denomination, null);
  assert.equal(card.portrait, 'Titus');
  assert.equal(packedRecordToCard({ ...records['ric.2_1(2).ves.972'], a: ['vespasian', 'titus'] }, cache).portrait, null);
  assert.equal(packedRecordToCard(records['ric.2_1(2).ves.972'], new Map()).portrait, 'Titus');
});

test('catalogue metadata reports actual coverage and separates generation from unknown publication date', () => {
  assert.equal(catalogueMetadataText({ corpus: 'ocre', recordCount: 56116, activeRecordCount: 55990, generatedOn: '2026-09-14', publicationDate: null }),
    '55,990 active types from 56,116 OCRE records. Local files generated 14 September 2026. Source publication date unknown.');
  assert.equal(catalogueMetadataText({ corpus: 'crro', recordCount: 2602, activeRecordCount: 2602, generatedOn: '2026-09-17', publicationDate: null }),
    '2,602 active types from 2,602 CRRO records. Local files generated 17 September 2026. Source publication date unknown.');
  // A corpus bundled in part says so, in the words the importer recorded beside the count, so the panel cannot claim
  // coverage the data does not have.
  assert.equal(catalogueMetadataText({ corpus: 'pella', recordCount: 7229, activeRecordCount: 4573, generatedOn: '2026-09-17', publicationDate: null,
    excluded: { count: 2656, reason: 'only Price numbers are cited', byGroup: {} } }),
  '4,573 active types from 7,229 PELLA records, leaving out 2,656 (only Price numbers are cited). Local files generated 17 September 2026. Source publication date unknown.');
  assert.equal(catalogueMetadataText(null), 'Local catalogue unavailable.');
  assert.equal(catalogueMetadataText({ corpus: 'bigr', recordCount: 1, activeRecordCount: 1 }), 'Local catalogue unavailable.');
});

test('a plain volume numeral finds the part of its family that has the ruler, and never answers with another ruler', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/' });
  // RIC II has no Domitian, II.1² does: the family's hit is found and offered, since II.1² numbers Domitian's coins its own way and the dealer
  // wrote II. Trajan 720 is never the answer to a Domitian reference.
  const domitian = await local.lookupType({ catalogue: 'RIC', volume: 'II', section: 'Domitian', number: '720' });
  assert.equal(domitian.status, 'candidates');
  assert.deepEqual(domitian.candidates.map((entry) => entry.id), ['ric.2_1(2).dom.720']);
  // The same on the person path, where the section is blanked before the final pick: a ruler RIC II does have, in a part that numbers him
  // differently, is still only ever offered.
  for (const reference of [{ catalogue: 'RIC', volume: 'II', section: 'Hadrian', number: '720' },
    { catalogue: 'RIC', volume: 'II', section: '', number: '720', rulers: ['Hadrian'] }]) {
    const hadrian = await local.lookupType(reference);
    assert.equal(hadrian.status, 'candidates', JSON.stringify(reference));
    assert.deepEqual(hadrian.candidates.map((entry) => entry.id), ['ric.2_3(2).hdn.720'], JSON.stringify(reference));
  }
  // A ruler in no part of the family leaves the family's other sections as choices, never as the one result.
  const missing = await local.lookupType({ catalogue: 'RIC', volume: 'II', section: 'Otho', number: '720' });
  assert.equal(missing.status, 'candidates');
  assert.deepEqual(missing.candidates.map((entry) => entry.id), ['ric.2.tr.720', 'ric.2_1(2).dom.720', 'ric.2_3(2).hdn.720']);
});

// RIC heads a section "Philip I", but no person is called that: read as a ruler the name reached neither OCRE's facets nor the local index, and a
// numberless "RIC 27b" then offered two dozen coins. Read as the section it is, with the volume that section implies, it is one coin.
test('a heading name RIC heads a section with is passed as that section, not as a person', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/' });
  const lot = findReferences('Philip I. AR Antoninianus. Rome. RIC 27b; RSC 9.');
  assert.deepEqual(lot.rulers, ['Philip I']);
  const reference = lotLookup(lot.references[0], lot.rulers);
  assert.deepEqual(reference, { catalogue: 'RIC', volume: 'IV', section: 'Philip I', number: '27b' });
  const found = await local.lookupType(reference);
  assert.equal(found.status, 'ok');
  assert.equal(found.card.id, 'ric.4.ph_i.27B');
});

test('the local fallback broadens the volume before the section, and a section it had to drop is only ever offered', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/' });
  // A mint heads sections in RIC VI-IX alike: the same mint in another volume is a far better answer than another mint in the volume asked for.
  const mint = await local.lookupType({ catalogue: 'RIC', volume: 'VIII', section: 'Londinium', number: '287' });
  assert.equal(mint.status, 'candidates');
  assert.deepEqual(mint.candidates.map((entry) => entry.id), ['ric.7.lon.287']);
  // Only when no volume has the section is the section dropped, and then its one hit is a choice, not the answer.
  const dropped = await local.lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Ostia', number: '306' });
  assert.equal(dropped.status, 'candidates');
  assert.deepEqual(dropped.candidates.map((entry) => entry.id), ['ric.1(2).ner.306']);
});

test('a failed bundle load is retried, never remembered', async () => {
  const failures = new Set(['metadata.json', 'index.json', 'numbers.json', 'records-1(2).json']);
  const fetchImpl = fixtureFetch();
  const once = async (url) => {
    const failing = [...failures].find((name) => String(url).endsWith(name));
    if (failing) { failures.delete(failing); throw new Error(`offline: ${failing}`); }
    return fetchImpl(url);
  };
  const local = createLocalCatalogue({ fetchImpl: once, baseUrl: 'moz-extension://test/data/' });
  const reference = { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' };
  // One dropped request each for the metadata, the two index files (asked for together) and the shard; a cached
  // rejection would make any of them permanent.
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await local.lookupType(reference)).status, 'unavailable', String(attempt));
  const found = await local.lookupType(reference);
  assert.equal(found.status, 'ok');
  assert.equal(found.card.id, 'ric.1(2).ner.306');
  assert.equal(failures.size, 0);
});

// The bundled catalogue itself, not the fixture above: what a heading's ruler costs only shows against OCRE's own numbering, where one man's name
// stands inside another's. Every file is served as the package serves it, parsed once here, and numbers.json is what keeps the sweep to a few
// seconds. Skipped where the bundle is not checked out.
const BUNDLE = fileURLToPath(new URL('../extension/data/', import.meta.url));
const skip = existsSync(`${BUNDLE}ocre/index.json`) ? false : 'extension/data is not bundled here';
const files = new Map();
// A bundled file by the path the package serves it under, "<corpus>/<name>".
const bundleJson = (path) => {
  if (!files.has(path)) files.set(path, JSON.parse(readFileSync(`${BUNDLE}${path}`, 'utf8')));
  return files.get(path);
};
const bundlePath = (url) => decodeURIComponent(String(url)).split('/').slice(-2).join('/');
// Every file served as the package serves it, and every request recorded, so a test can say what a lookup cost.
const asked = [];
const bundle = createLocalCatalogue({
  baseUrl: 'moz-extension://test/data/',
  fetchImpl: async (url) => {
    asked.push(bundlePath(url));
    return { ok: true, status: 200, json: async () => bundleJson(bundlePath(url)) };
  },
});
// What the last lookup read, and the slate wiped for the next one. The catalogue keeps every file it has parsed, so
// only the first lookup of a corpus records anything; a test that counts requests asks for its own catalogue.
const readFiles = () => asked.splice(0);
// Every coin a heading opens on its own over RIC numbers 1 to 400, read exactly as a pasted lot is read.
async function openedOver(heading) {
  const opened = [];
  for (let number = 1; number <= 400; number += 1) {
    const lot = findReferences(`${heading}. RIC ${number}`);
    const found = lot.references[0];
    if (!found) continue;
    const result = await bundle.lookupType(lotLookup(found, lot.rulers));
    if (result?.status === 'ok') opened.push({ number, card: result.card });
  }
  return opened;
}
// Who is on a coin, as the record itself says: its authorities and its obverse portraits. The card names neither where a type has two authorities
// (RIC V's joint reigns), and it is the record the person filter reads anyway.
const shardPartOf = (id) => {
  const parts = bundleJson('ocre/metadata.json').shards[String(id).split('.')[1]] ?? [];
  return parts.reduce((chosen, part) => (part.from <= id ? part : chosen), parts[0]);
};
const peopleOn = (id) => {
  const record = bundleJson(`ocre/${shardPartOf(id)?.file}`)?.records?.[id];
  return [...(record?.a ?? []), ...(record?.o?.p ?? [])];
};
const opensOnly = (opened, ids, heading) => {
  for (const hit of opened) assert.ok(peopleOn(hit.card.id).some((id) => ids.includes(id)), `${heading}: ${hit.card.id}`);
};

test('over the bundled catalogue, a heading that is one man\'s own name opens his coins and nobody else\'s', { skip }, async () => {
  // Germanicus is a person Nomisma names, and also a word inside Nero Claudius Drusus Germanicus: widened, the heading answered thirteen numbers
  // with one of Drusus's coins. These ten are the coins the heading opened before any of the alias work, all of them Germanicus's own.
  const germanicus = await openedOver('Germanicus');
  assert.deepEqual(germanicus.map(({ number }) => number), [35, 43, 50, 57, 59, 60, 61, 62, 105, 106]);
  opensOnly(germanicus, ['germanicus'], 'Germanicus');
  // Licinius is Gallienus's own nomen, so widening cost the heading every one of its answers. It opens what it always opened, and each coin is his.
  const licinius = await openedOver('Licinius');
  assert.equal(licinius.length, 88);
  opensOnly(licinius, ['licinius'], 'Licinius');
  // A dealer usually writes the father with his numeral; it must reach the same coins, not fall back into the widened set.
  assert.deepEqual((await openedOver('Licinius I')).map(({ card }) => card.id), licinius.map(({ card }) => card.id));
});

test('over the bundled catalogue, a spelling nobody is named outright still opens nothing it should not', { skip }, async () => {
  // A name no person carries alone names nobody: none of these headings may pick one man out of the several it could mean.
  for (const heading of ['Sept. Severus', 'Maximinus', 'Drusus']) assert.deepEqual(await openedOver(heading), [], heading);
  // A shared spelling keeps every owner, and a coin only opens where one of them is on it.
  for (const [heading, count, owners] of [['Valerianus', 83, ['valerian', 'valerian_ii']], ['Domitianus', 6, ['domitian_ii', 'domitius_domitianus']],
    ['Valens', 12, ['valens']], ['Romulus', 12, ['romulus']], ['Maximus', 18, ['gaius_julius_verus_maximus']]]) {
    const opened = await openedOver(heading);
    assert.equal(opened.length, count, heading);
    opensOnly(opened, owners, heading);
  }
  // A heading RIC heads a section with is that section, and its number opens the one coin.
  const philip = await openedOver('Philip I');
  assert.equal(philip.find(({ number }) => number === 16)?.card.id, 'ric.4.ph_i.16');
  opensOnly(philip, ['philip_the_arab'], 'Philip I');
});

test('over the bundled catalogue, a cited range reaches the record OCRE titles over it', { skip }, async () => {
  const typed = await bundle.lookupType(parseReference('RIC II.3 Hadrian 10-11'));
  assert.deepEqual(typed.candidates.map((entry) => entry.id), ['ric.2_3(2).hdn.10-11']);
  const lot = findReferences('Hadrian. AR Denarius. RIC II.3 Hadrian 10-11.');
  const row = await bundle.lookupType(lotLookup(lot.references[0], lot.rulers));
  assert.deepEqual(row.candidates.map((entry) => entry.id), ['ric.2_3(2).hdn.10-11']);
  // A range OCRE has no record of falls back to the first number, which is the type the other 654 ranges share.
  const missing = await bundle.lookupType(parseReference('RIC II.3 Hadrian 10-12'));
  assert.deepEqual(missing.candidates.map((entry) => entry.id), ['ric.2_3(2).hdn.10']);
});

test('over the bundled catalogue, guided fields naming a mint by its modern name open the coin', { skip }, async () => {
  const localProvider = bundle;
  const guided = await lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Trier', number: '12' }, { localProvider, online: false });
  assert.equal(guided.status, 'ok');
  assert.equal(guided.card.id, 'ric.7.tri.12');
  // Unmapped, the name is no section of any volume and the sixteen mints of RIC VII are all that is left to offer.
  assert.equal((await localProvider.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Trier', number: '12' })).candidates.length, 16);
});

// numbers.json is written by scripts/import_rdf.py, which reads the number off a title with a regex of its own. That regex is only safe while it
// keys every title exactly where parseReference reads its number, so the two are compared over all 52,254 bundled titles: a title whose entry sat in
// the wrong list, or in none, would hide a coin from every lookup for that number.
// The key is the runtime's own, not a copy of it, so that a change to the way a lookup keys a number is caught here rather than in the field.
test('every bundled title is listed under the number parseReference reads in it', { skip }, () => {
  const { entries } = bundleJson('ocre/index.json');
  const listed = new Map();
  for (const [key, positions] of Object.entries(bundleJson('ocre/numbers.json').numbers)) {
    for (const position of positions) {
      assert.equal(listed.has(position), false, `position ${position} is listed twice`);
      listed.set(position, key);
    }
  }
  let ric = 0;
  entries.forEach(([id, title], position) => {
    const hit = parseReference(title, false);
    const key = hit?.catalogue === 'RIC' ? numberKey(hit.number) : null;
    if (key === null) return;
    ric += 1;
    assert.equal(listed.get(position), key, `${id}: ${title}`);
  });
  assert.equal(ric, 51248);
});

// The same bundle, served a number index that lists every entry under every number: numbered() then hands pickRicEntries the whole index in index
// order, which is the scan the lookup made before numbers.json existed. Whole answers are compared, cards and candidates and all, so a reference
// whose entries the pre-filter narrowed differently cannot come out looking the same.
const scanned = createLocalCatalogue({
  baseUrl: 'moz-extension://test/data/',
  fetchImpl: async (url) => {
    const path = bundlePath(url);
    if (path !== 'ocre/numbers.json') return { ok: true, status: 200, json: async () => bundleJson(path) };
    const everyPosition = bundleJson('ocre/index.json').entries.map((entry, position) => position);
    return { ok: true, status: 200, json: async () => ({ ...bundleJson(path), numbers: new Proxy({}, { get: () => everyPosition }) }) };
  },
});
const lotReference = (text) => {
  const found = findReferences(text);
  return lotLookup(found.references[0], found.rulers);
};

test('the number index answers every shape of reference exactly as a scan of the whole index does', { skip }, async () => {
  const references = [
    // A plain number, the number the most volumes carry, and a number written with the zeros a dealer sometimes pads it to.
    parseReference('RIC 972'), parseReference('RIC 1'), parseReference('RIC 007'),
    // A heading that is a man's name, and a heading RIC heads a section with.
    lotReference('Vespasian. AR Denarius. RIC 972.'), lotReference('Philip I. AR Antoninianus. Rome. RIC 27b; RSC 9.'),
    // A volume with a ruler section, a volume with a mint section, and a mint under the modern name RIC does not file it under.
    parseReference('RIC II Vespasian 972'), parseReference('RIC VII Londinium 12'),
    { catalogue: 'RIC', volume: 'VII', section: 'Trier', number: '12' },
    // A letter in either case, alone and under the volume that heads it.
    parseReference('RIC 27b'), parseReference('RIC IV Philip I 27B'),
    // A range OCRE titles a type over, its first number alone, and a range OCRE has no record of.
    parseReference('RIC II.3 Hadrian 1009-1012'), parseReference('RIC II.3 Hadrian 1009'), parseReference('RIC II.3 Hadrian 10-12'),
    // A plain volume numeral over a family whose parts number the same ruler differently.
    parseReference('RIC II Hadrian 720'), parseReference('RIC II Domitian 720'),
    // The one split volume: 264 stands on both sides of the cut, and each side is asked for again by its own id.
    parseReference('RIC V Gallienus 264'),
    { catalogue: 'RIC', volume: 'V', section: 'Gallienus', number: '264', id: 'ric.5.gall(2).264' },
    { catalogue: 'RIC', volume: 'V', section: 'Gallienus', number: '264', id: 'ric.5.gall(2).264.1' },
    // A second-edition volume by id, and an id nothing carries.
    { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306', id: 'ric.1(2).ner.306' },
    { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306', id: 'ric.1(2).nobody.306' },
    // A number past the end of every volume, and one the volume asked for does not reach.
    parseReference('RIC 1000000'), parseReference('RIC VII Londinium 99999'),
    // Answers only the broadened passes find: the same mint in another volume, and a section no volume has.
    parseReference('RIC VIII Londinium 287'), { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Ostia', number: '306' },
    // A heading naming a ruler who is on no coin of that number.
    lotReference('Otho. AR Denarius. RIC II 720.'),
  ];
  assert.equal(references.length, 25);
  for (const reference of references) {
    assert.ok(reference, JSON.stringify(reference));
    assert.deepEqual(await bundle.lookupType(reference), await scanned.lookupType(reference), JSON.stringify(reference));
  }
});

test('a split volume is read from the part its id falls in, and no index is touched for it', { skip }, async () => {
  const read = [];
  const local = createLocalCatalogue({
    baseUrl: 'moz-extension://test/data/',
    fetchImpl: async (url) => {
      read.push(bundlePath(url));
      return { ok: true, status: 200, json: async () => bundleJson(bundlePath(url)) };
    },
  });
  // RIC V is the one volume over the 4 MiB cap: the first id of its second part, and the id before it, must come from their own files.
  const [first, second] = bundleJson('ocre/metadata.json').shards['5'].map((part) => part.file);
  const boundary = bundleJson('ocre/metadata.json').shards['5'][1].from;
  const before = Object.keys(bundleJson(`ocre/${first}`).records).at(-1);
  assert.equal((await local.lookupById('ocre', boundary)).card.id, boundary);
  assert.deepEqual(read, ['ocre/metadata.json', `ocre/${second}`]);
  assert.equal((await local.lookupById('ocre', before)).card.id, before);
  assert.deepEqual(read, ['ocre/metadata.json', `ocre/${second}`, `ocre/${first}`]);
  assert.equal((await local.lookupById('ocre', 'ric.5.nobody.1')).status, 'none');
});

test('the shards a person filter needs are loaded together, not one after another', async () => {
  const waiting = [];
  const barrier = fixtureFetch();
  // Every shard request is held until all three are in flight: loaded one after another, this lookup could never finish.
  const held = (url) => (String(url).includes('records-') ? new Promise((resolve) => {
    waiting.push(() => resolve(barrier(url)));
    if (waiting.length === 3) for (const release of waiting.splice(0)) release();
  }) : barrier(url));
  const local = createLocalCatalogue({ fetchImpl: held, baseUrl: 'moz-extension://test/data/' });
  const result = await local.lookupType({ catalogue: 'RIC', volume: '', section: 'Trajan', number: '720' });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.id, 'ric.2.tr.720');
});

// CRRO, PELLA and SCO, over the data the package really carries. A card these answer must be the card the online path
// builds from the same record, and a reference the online path resolves today must reach the same record here.
const jsonld = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const PARITY = [
  ['crro', 'rrc-44.5', 'crro-rrc-44-5.jsonld'],
  ['crro', 'rrc-1.1', 'crro-rrc-1-1.jsonld'],
  ['pella', 'price.23', 'pella-price-23.jsonld'],
  ['sco', 'sc.1.1266.2', 'sco-sc-1-1266-2.jsonld'],
];

test('a local card is field for field the card the online path builds from the same record', { skip }, async () => {
  for (const [corpus, id, name] of PARITY) {
    const record = jsonld(name);
    // Both sides are given the same resolved labels: the online path fetches them from Nomisma and the local path takes
    // them from the label cache those fetches fill, so this compares the two readings of the record and not what
    // either side happened to be allowed to reach.
    const slugs = [...nomismaSlugs(record), ...(portraitSlug(record) ? [portraitSlug(record)] : [])];
    const labels = Object.fromEntries(slugs.map((slug) => [slug, `Name of ${slug}`]));
    const online = toCard(record, corpus, labels);
    const cached = createLocalCatalogue({ baseUrl: 'moz-extension://test/data/', cache: new Map(Object.entries(labels)),
      fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => bundleJson(bundlePath(url)) }) });
    const { card } = await cached.lookupById(corpus, id);
    // source is the one field the online card has no opinion about: it is how the popup says which bundle answered.
    assert.equal(card.source, 'local');
    assert.deepEqual({ ...card, source: undefined }, { ...online, source: undefined }, `${corpus} ${id}`);
    // With no label for anything, both sides fall back to the identifier the record carries and neither invents one.
    assert.deepEqual({ ...(await bundle.lookupById(corpus, id)).card, source: undefined },
      { ...toCard(record, corpus, {}), source: undefined }, `${corpus} ${id} unlabelled`);
  }
});

test('a bundled reference is answered without one request to numismatics.org', { skip }, async () => {
  // Any request off the package is a failure here, not a fallback: a local hit must need no host permission at all.
  const refuse = async (url) => { throw new Error(`no network lookup should happen: ${url}`); };
  for (const [reference, id] of [[parseReference('Crawford 44/5'), 'rrc-44.5'], [parseReference('Price 23'), 'price.23'],
    [parseReference('SC 1266.2'), 'sc.1.1266.2'], [parseReference('RIC I (2nd edition) Nero 306'), 'ric.1(2).ner.306']]) {
    const found = await lookupType(reference, { localProvider: bundle, fetchImpl: refuse, online: true });
    assert.equal(found.status, 'ok', JSON.stringify(reference));
    assert.equal(found.card.id, id);
    assert.equal(found.card.source, 'local');
  }
});

test('each reference shape is answered from the bundle as the online path answers it', { skip }, async () => {
  // Exact: the title the reference is, or the identifier it names outright.
  for (const [text, id] of [['RRC 1/1', 'rrc-1.1'], ['Cr. 44/5', 'rrc-44.5'], ['RRC 98B', 'rrc-98b'],
    ['Price 23', 'price.23'], ['SC 1266.2', 'sc.1.1266.2'], ['SC 1266', 'sc.1.1266']]) {
    const found = await bundle.lookupType(parseReference(text));
    assert.equal(found.status, 'ok', text);
    assert.equal(found.card.id, id, text);
  }
  // A number the base group has near misses for is offered, out of the group the online base-number search is filtered to.
  const sc = await bundle.lookupType(parseReference('SC 1266.9'));
  assert.deepEqual([sc.status, sc.candidates.map((entry) => entry.id), sc.corpus, sc.query],
    ['candidates', ['sc.1.1266', 'sc.1.1266.2'], 'sco', 'SC 1266.9']);
  assert.ok(sc.candidates.every((entry) => entry.source === 'local'));
  const rrc = await bundle.lookupType(parseReference('RRC 1/9'));
  assert.deepEqual([rrc.status, rrc.candidates.map((entry) => entry.id)], ['candidates', ['rrc-1.1']]);
  // More near misses than a "did you mean" may list, and a number no group has: both are a local miss, and lookupType
  // falls back to the online catalogue rather than reporting that the type does not exist.
  for (const text of ['RRC 44/99', 'Price 999999', 'SC 999999']) {
    assert.equal((await bundle.lookupType(parseReference(text))).status, 'none', text);
  }
});

test('a lookup loads only the corpus it asks about, and never an index it does not need', { skip }, async () => {
  const read = [];
  const local = createLocalCatalogue({
    baseUrl: 'moz-extension://test/data/',
    fetchImpl: async (url) => {
      read.push(bundlePath(url));
      return { ok: true, status: 200, json: async () => bundleJson(bundlePath(url)) };
    },
  });
  // A popup that has only opened reads nothing; a Bopearachchi reference is not bundled and reads nothing either.
  assert.deepEqual(read, []);
  assert.equal(await local.lookupType(parseReference('Bop Euthydemus I 24A')), null);
  assert.equal(await local.lookupById('bigr', 'bigr.euthydemus_i.13.1'), null);
  assert.deepEqual(read, []);
  // An SC reference names its record, so the index is never read for it.
  assert.equal((await local.lookupType(parseReference('SC 1266.2'))).card.id, 'sc.1.1266.2');
  assert.deepEqual(read.splice(0), ['sco/metadata.json', 'sco/records-sc.json']);
  // A Price reference is a title, so it reads that corpus's index and its shard, and nothing of any other corpus.
  assert.equal((await local.lookupType(parseReference('Price 23'))).card.id, 'price.23');
  assert.deepEqual(read.splice(0).sort(), ['pella/index.json', 'pella/metadata.json', 'pella/records-price.json']);
  assert.equal((await local.lookupById('crro', 'rrc-44.5')).card.id, 'rrc-44.5');
  assert.deepEqual(read.splice(0), ['crro/metadata.json', 'crro/records-rrc.json']);
});

test('a damaged corpus fails closed, and a dropped request is retried', { skip }, async () => {
  for (const [corpus, broken] of [['crro', 'crro/metadata.json'], ['pella', 'pella/index.json'], ['sco', 'sco/records-sc.json']]) {
    const local = createLocalCatalogue({
      baseUrl: 'moz-extension://test/data/',
      fetchImpl: async (url) => (bundlePath(url) === broken ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => bundleJson(bundlePath(url)) }),
    });
    // Never "none": a file the package should carry and does not says nothing about whether the coin is catalogued.
    const reference = { crro: 'RRC 44/5', pella: 'Price 99999999', sco: 'SC 1266.2' }[corpus];
    assert.equal((await local.lookupType(parseReference(reference))).status, 'unavailable', broken);
  }
  // One dropped request for each of the three files a CRRO reference reads — the index it is matched against, the
  // metadata that names the shard, and the shard — then the same reference answered: a remembered rejection would
  // leave the bundle unusable for the life of the page.
  const failures = new Set(['crro/metadata.json', 'crro/index.json', 'crro/records-rrc.json']);
  const once = async (url) => {
    const path = bundlePath(url);
    if (failures.delete(path)) throw new Error(`offline: ${path}`);
    return { ok: true, status: 200, json: async () => bundleJson(path) };
  };
  const retried = createLocalCatalogue({ baseUrl: 'moz-extension://test/data/', fetchImpl: once });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await retried.lookupType(parseReference('RRC 44/5'))).status, 'unavailable', String(attempt));
  }
  assert.equal((await retried.lookupType(parseReference('RRC 44/5'))).card.id, 'rrc-44.5');
  assert.equal(failures.size, 0);
});
