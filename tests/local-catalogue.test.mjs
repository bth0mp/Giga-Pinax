import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { catalogueMetadataText, createLocalCatalogue, packedRecordToCard } from '../extension/local-catalogue.js';
import { ricMintSection } from '../extension/catalogues.js';
import { findReferences, lotLookup } from '../extension/lot.js';
import { lookupType, nomismaSlugs, parseReference, pickRicEntries, pickRicHits, portraitSlug, toCard } from '../extension/lookup.js';
import { bundle, bundleJson, bundledLabels, bundlePath, peopleOn, skip } from './helpers/bundle.mjs';

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
  assert.deepEqual(fetchImpl.calls.map((url) => url.split('/').pop()), ['metadata.json', 'index.json', 'numbers.json', 'records-1(2).json', 'nomisma-labels.json']);
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

// The bundled catalogue itself, not the fixture above, served as the package serves it (tests/helpers/bundle.mjs). The long sweeps over it are in
// local-catalogue-headings, local-catalogue-mints and local-catalogue-index, which node runs beside this file. Skipped where the bundle is not
// checked out.

test('over the bundled catalogue, a cited range reaches the record OCRE titles over it', { skip }, async () => {
  // RIC II.3 is held in its second edition alone, so with Hadrian named the one type opens (loop V-06), as "RIC II.3² Hadrian 10-11" always did.
  const typed = await bundle.lookupType(parseReference('RIC II.3 Hadrian 10-11'));
  assert.equal(typed.card?.id, 'ric.2_3(2).hdn.10-11');
  const lot = findReferences('Hadrian. AR Denarius. RIC II.3 Hadrian 10-11.');
  const row = await bundle.lookupType(lotLookup(lot.references[0], lot.rulers));
  assert.equal(row.card?.id, 'ric.2_3(2).hdn.10-11');
  // A range OCRE has no record of falls back to the first number, which is the type the other 654 ranges share.
  const missing = await bundle.lookupType(parseReference('RIC II.3 Hadrian 10-12'));
  assert.equal(missing.card?.id, 'ric.2_3(2).hdn.10');
  assert.equal((await bundle.lookupType(parseReference('RIC II.3² Hadrian 10-12'))).card?.id, 'ric.2_3(2).hdn.10');
});

test('over the bundled catalogue, guided fields naming a mint by its modern name open the coin', { skip }, async () => {
  const localProvider = bundle;
  const guided = await lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Trier', number: '12' }, { localProvider, online: false });
  assert.equal(guided.status, 'ok');
  assert.equal(guided.card.id, 'ric.7.tri.12');
  // Unmapped, the name is no section of any volume and the sixteen mints of RIC VII are all that is left to offer.
  assert.equal((await localProvider.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Trier', number: '12' })).candidates.length, 16);
});

// A mint's modern name is now taken from the mint's own country, from English and from the exonym several western languages share, so a reference
// typed the way a dealer writes it reaches RIC's Latin section with no network at all.
test('over the bundled catalogue, a mint typed by a modern name Nomisma publishes opens the coin offline', { skip }, async () => {
  const localProvider = bundle;
  for (const [written, id] of [['RIC VII Arles 12', 'ric.7.ar.12'], ['RIC VII Trier 12', 'ric.7.tri.12'], ['RIC VII Sisak 12', 'ric.7.sis.12'],
    ['RIC VI Antakya 12', 'ric.6.anch.12'], ['RIC VII Istanbul 12', 'ric.7.cnp.12']]) {
    const found = await lookupType(parseReference(written), { localProvider, online: false });
    assert.equal(found.status, 'ok', written);
    assert.equal(found.card.id, id, written);
  }
  // The names Wikidata adds through Nomisma's own closeMatch links open the same coins. Sofia is the one that matters most: it is what Serdica is
  // called today, and Nomisma writes it in Cyrillic alone.
  for (const [written, id] of [['RIC VII Sofia 1', 'ric.7.serd.1'], ['RIC VI Carthago 1', 'ric.6.carth.1'], ['RIC VI Triers 12', 'ric.6.tri.12'],
    ['RIC VIII Samarobriva 12', 'ric.8.amb.12'], ['RIC VI Nikomedya 12', 'ric.6.nic.12']]) {
    const found = await lookupType(parseReference(written), { localProvider, online: false });
    assert.equal(found.status, 'ok', written);
    assert.equal(found.card.id, id, written);
  }
  // RIC's own spelling still reaches the same coin, and Rome — the one mint section that is an ordinary English word — is untouched.
  for (const [written, id] of [['RIC VII Arelate 12', 'ric.7.ar.12'], ['RIC VI Rome 12', 'ric.6.rom.12'], ['RIC VII Londinium 12', 'ric.7.lon.12'],
    ['RIC VI Serdica 16', 'ric.6.serd.16']]) {
    const found = await lookupType(parseReference(written), { localProvider, online: false });
    assert.equal(found.status, 'ok', written);
    assert.equal(found.card.id, id, written);
  }
  // The names the mint volumes were asked for, reached through the one statement the linked Wikidata item publishes: London, Lyon, Milan, Pavia and
  // Trier open their Latin sections with no network at all.
  for (const [written, id] of [['RIC VII London 12', 'ric.7.lon.12'], ['RIC VII Lyon 12', 'ric.7.lug.12'], ['RIC VII Trier 12', 'ric.7.tri.12'],
    ['RIC VII Pavia 12', 'ric.7.tic.12'], ['RIC VI Pavia 1', 'ric.6.tic.1'], ['RIC IX Milan 1', 'ric.9.med.1'],
    ['RIC IX Mailand 1', 'ric.9.med.1'], ['RIC VI London 12', 'ric.6.lon.12'], ['RIC VII Londres 12', 'ric.7.lon.12']]) {
    const found = await lookupType(parseReference(written), { localProvider, online: false });
    assert.equal(found.status, 'ok', written);
    assert.equal(found.card.id, id, written);
  }
  // Two of the brief's own references name a number the bundle does not hold rather than a mint it cannot reach: OCRE heads no RIC VII section with
  // Mediolanum (Milan is RIC VIII and IX), and RIC VI Ticinum runs 1-11 and then 13. The section is read in both, and the number is what is missing.
  for (const written of ['RIC VII Milan 12', 'RIC VI Pavia 12']) {
    const reference = parseReference(written);
    assert.equal(ricMintSection(reference.section), written.includes('Milan') ? 'Mediolanum' : 'Ticinum', written);
    assert.notEqual((await lookupType(reference, { localProvider, online: false })).status, 'ok', written);
  }
  // "Lyons" is the one name of the five still unreachable: Wikidata publishes it as a name of Lyon in no language kept, and none was invented.
  const lyons = await lookupType(parseReference('RIC VII Lyons 12'), { localProvider, online: false });
  assert.notEqual(lyons.status, 'ok');
});


// "Rome mint" stands in most RIC I-V descriptions and a heading is ruler-less wherever the table does not hold its spelling, so a mint that discarded
// the lot's own volume sent the number to four volumes it is not in. Over the bundle, each of these opened the wrong coin or the wrong choice.
test('over the bundled catalogue, a mint beside a volume of another part of RIC leaves the volume standing', { skip }, async () => {
  const lookup = async (text) => { const lot = findReferences(text); return bundle.lookupType(lotLookup(lot.references[0], lot.rulers)); };
  // RIC IV has no Rome section: the number belongs to the two RIC IV coins that carry it, not to RIC VIII Rome 460.
  const four = await lookup('Rome mint. RIC IV 460');
  assert.equal(four.status, 'candidates');
  assert.deepEqual(four.candidates.map((entry) => entry.id), ['ric.4.crl.460', 'ric.4.sa.460']);
  // And the volume the lot states opens its own coin instead of a choice of mints that never held the number.
  for (const [text, id] of [['Diva Faustina. AR Denarius, Rome mint. RIC III 360', 'ric.3.m_aur.360'],
    ['Constantinople. RIC X 12', 'ric.10.arc_e.12']]) {
    const found = await lookup(text);
    assert.equal(found.status, 'ok', text);
    assert.equal(found.card.id, id, text);
  }
  // A mint beside one of its own volumes still names the section, and so does a citation with no volume at all; the section came from the heading
  // alone, so its coin is offered rather than opened.
  assert.deepEqual((await lookup('Trier mint. RIC VII 12')).candidates.map((entry) => entry.id), ['ric.7.tri.12']);
  assert.deepEqual((await lookup('Londinium. RIC 12')).candidates.map((entry) => entry.id), ['ric.6.lon.12', 'ric.7.lon.12']);
  // A house whose name is a mint spelling still reads as that mint where the volume it cites is one of the mint's own, and it too is only offered.
  assert.deepEqual((await lookup('Roma Numismatics E-Sale 100. RIC VI 12')).candidates.map((entry) => entry.id), ['ric.6.rom.12']);
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
  assert.deepEqual(read, ['ocre/metadata.json', `ocre/${second}`, 'nomisma-labels.json']);
  assert.equal((await local.lookupById('ocre', before)).card.id, before);
  assert.deepEqual(read, ['ocre/metadata.json', `ocre/${second}`, 'nomisma-labels.json', `ocre/${first}`]);
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
    // And with nothing cached at all: the names in the package must build the card the online path builds once
    // nomisma.org has answered for every concept the package carries a name for.
    const packaged = Object.fromEntries(slugs.filter((slug) => Object.hasOwn(bundledLabels(), slug))
      .map((slug) => [slug, bundledLabels()[slug]]));
    assert.deepEqual({ ...(await bundle.lookupById(corpus, id)).card, source: undefined },
      { ...toCard(record, corpus, packaged), source: undefined }, `${corpus} ${id} bundled labels`);
    assert.ok(Object.keys(packaged).length > 0, `${corpus} ${id} has no bundled label at all`);
  }
});

test('a name the collector already has wins over the bundled one, and an unnamed concept stays its identifier', { skip }, async () => {
  // RIC's own spelling of a ruler is what the collector typed and what the section above the coin says, so
  // ric-people.js outranks the Nomisma label for an OCRE authority; nomisma.org's answer, cached by an online lookup,
  // outranks both because it is the record's own publisher answering now.
  const record = { i: 'ric.1(2).ner.306', l: 'RIC I (second edition) Nero 306', a: ['nero'], d: ['as'], o: { p: ['nero'] }, r: {} };
  const labels = new Map([['nero', 'Nero Claudius Caesar Augustus Germanicus'], ['as', 'As']]);
  assert.equal(packedRecordToCard(record, new Map(), 'ocre', labels).authority, 'Nero');
  assert.equal(packedRecordToCard(record, new Map(), 'ocre', labels).portrait, 'Nero');
  assert.equal(packedRecordToCard(record, new Map([['nero', 'Nero of Rome']]), 'ocre', labels).authority, 'Nero of Rome');
  // A corpus ric-people.js was never filtered for takes the bundled name and nothing else.
  assert.equal(packedRecordToCard({ i: 'price.23', l: 'Price 23', a: ['nero'], o: {}, r: {} }, new Map(), 'pella', labels).authority,
    'Nero Claudius Caesar Augustus Germanicus');
  // Nomisma publishes no English label for these two, so no name is guessed and neither card gains one.
  assert.equal((await bundle.lookupById('ocre', 'ric.3.m_aur.1505')).card.denomination, 'dupondius_or_as');
  assert.equal((await bundle.lookupById('sco', 'sc.1.1278')).card.mint, 'uncertain_74_sco');
});

test('the labels are read once, only when a card is built, and a broken label file leaves the identifiers standing', { skip }, async () => {
  const read = [];
  const serve = (override = () => null) => async (url) => {
    const path = bundlePath(url);
    read.push(path);
    return override(path) ?? { ok: true, status: 200, json: async () => bundleJson(path) };
  };
  const local = createLocalCatalogue({ baseUrl: 'moz-extension://test/data/', fetchImpl: serve() });
  // A miss builds no card, so it asks for no names.
  assert.equal((await local.lookupType(parseReference('Price 999999'))).status, 'none');
  assert.ok(!read.includes('nomisma-labels.json'), read.join(' '));
  assert.equal((await local.lookupById('pella', 'price.23')).card.material, 'Silver');
  assert.equal(read.filter((path) => path === 'nomisma-labels.json').length, 1);
  assert.equal((await local.lookupById('crro', 'rrc-44.5')).card.material, 'Silver');
  assert.equal(read.filter((path) => path === 'nomisma-labels.json').length, 1);
  // Missing, or there but not the file the package ships: the card is still the record, with the identifiers on it.
  for (const broken of [{ ok: false, status: 404, json: async () => ({}) }, { ok: true, status: 200, json: async () => ({ schemaVersion: 2 }) }]) {
    const degraded = createLocalCatalogue({ baseUrl: 'moz-extension://test/data/',
      fetchImpl: serve((path) => (path === 'nomisma-labels.json' ? broken : null)) });
    const found = await degraded.lookupById('pella', 'price.23');
    assert.equal(found.status, 'ok');
    assert.equal(found.card.material, 'ar');
    assert.equal(found.card.authority, 'alexander_iii');
  }
  // A dropped request is forgotten as the rejection passes, so the next card asks again rather than staying nameless.
  let dropped = true;
  const retried = createLocalCatalogue({ baseUrl: 'moz-extension://test/data/',
    fetchImpl: async (url) => {
      const path = bundlePath(url);
      if (path === 'nomisma-labels.json' && dropped) { dropped = false; throw new Error('offline'); }
      return { ok: true, status: 200, json: async () => bundleJson(path) };
    } });
  assert.equal((await retried.lookupById('crro', 'rrc-44.5')).card.material, 'ar');
  assert.equal((await retried.lookupById('crro', 'rrc-44.5')).card.material, 'Silver');
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
  // Deliberately a superset of the online answer: ANS's own search for "SC 1266" returns sc.1.1266 alone
  // (tests/fixtures/sco-search-sc-1266.xml, <opensearch:totalResults>1</opensearch:totalResults>), while the bundle
  // applies inGroup's rule to the whole index and so also offers sc.1.1266.2, a real record of that group Solr left
  // out. Candidates are offered, never opened, so the wider list is a longer "did you mean" and never a wrong answer.
  const sc = await bundle.lookupType(parseReference('SC 1266.9'));
  assert.deepEqual([sc.status, sc.candidates.map((entry) => entry.id), sc.corpus, sc.query],
    ['candidates', ['sc.1.1266', 'sc.1.1266.2'], 'sco', 'SC 1266.9']);
  assert.equal(readFileSync(new URL('./fixtures/sco-search-sc-1266.xml', import.meta.url), 'utf8')
    .match(/<opensearch:totalResults>(\d+)</)[1], '1');
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
  // An SC reference names its record, so the index is never read for it. The shared label file is read with the first
  // card built, whichever corpus builds it, and never again.
  assert.equal((await local.lookupType(parseReference('SC 1266.2'))).card.id, 'sc.1.1266.2');
  assert.deepEqual(read.splice(0), ['sco/metadata.json', 'sco/records-sc.json', 'nomisma-labels.json']);
  // A Price reference is a title, so it reads that corpus's index and its shard, and nothing of any other corpus.
  assert.equal((await local.lookupType(parseReference('Price 23'))).card.id, 'price.23');
  assert.deepEqual(read.splice(0).sort(), ['pella/index.json', 'pella/metadata.json', 'pella/records-price.json']);
  assert.equal((await local.lookupById('crro', 'rrc-44.5')).card.id, 'rrc-44.5');
  assert.deepEqual(read.splice(0), ['crro/metadata.json', 'crro/records-rrc.json']);
});

test('an index and the metadata beside it that disagree are unavailable, never a miss', { skip }, async () => {
  // A record dropped from the index is still a schema-valid index, and every title left in it resolves: nothing but the
  // count the metadata carries tells the two apart, and without it the bundle would answer "no such Price number" for a
  // coin it holds. The number index does this for OCRE; the count does it for the corpora matched on titles.
  const served = (overrides) => createLocalCatalogue({ baseUrl: 'moz-extension://test/data/',
    fetchImpl: async (url) => {
      const path = bundlePath(url);
      const value = Object.hasOwn(overrides, path) ? overrides[path] : bundleJson(path);
      if (value === null) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => value };
    } });
  const short = (corpus, file, id) => ({ ...bundleJson(`${corpus}/${file}`),
    entries: bundleJson(`${corpus}/${file}`).entries.filter((entry) => entry[0] !== id) });
  for (const [reference, overrides] of [
    ['Price 23', { 'pella/index.json': short('pella', 'index.json', 'price.23') }],
    ['RRC 44/5', { 'crro/index.json': short('crro', 'index.json', 'rrc-44.5') }],
    ['SC 1266.9', { 'sco/index.json': short('sco', 'index.json', 'sc.1.1266.2') }],
    // Metadata that cannot be read at all is the same answer: the count it carries is what the index is judged by.
    ['Price 99999', { 'pella/metadata.json': null }],
    ['Price 99999', { 'pella/metadata.json': { schemaVersion: 1, corpus: 'pella', shards: 7, aliases: {} } }],
    ['RRC 44/99', { 'crro/metadata.json': null }],
    ['SC 999999', { 'sco/metadata.json': null }],
  ]) {
    const found = await served(overrides).lookupType(parseReference(reference));
    assert.equal(found.status, 'unavailable', `${reference} ${JSON.stringify(Object.keys(overrides))}`);
  }
  // And the bundle as it is shipped still answers, so the gate is the disagreement and not the check itself.
  assert.equal((await served({}).lookupType(parseReference('Price 23'))).card.id, 'price.23');
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
  // leave the bundle unusable for the life of the page. The metadata and the index are asked for together, so one
  // attempt can spend two of the three.
  const failures = new Set(['crro/metadata.json', 'crro/index.json', 'crro/records-rrc.json']);
  const once = async (url) => {
    const path = bundlePath(url);
    if (failures.delete(path)) throw new Error(`offline: ${path}`);
    return { ok: true, status: 200, json: async () => bundleJson(path) };
  };
  const retried = createLocalCatalogue({ baseUrl: 'moz-extension://test/data/', fetchImpl: once });
  for (let attempt = 0; failures.size > 0; attempt += 1) {
    assert.ok(attempt < 3, 'a dropped request was never retried');
    assert.equal((await retried.lookupType(parseReference('RRC 44/5'))).status, 'unavailable', String(attempt));
  }
  assert.equal((await retried.lookupType(parseReference('RRC 44/5'))).card.id, 'rrc-44.5');
});

// A mint bracketed after the number of a lot citing no volume opened whichever mint volume's coin carried that mint and number, whoever the heading
// named. The heading's ruler now rides with the mint, so the coin opens only when he is on it.
test('a mint bracketed beside a RIC number with no volume opens only a coin of the heading\'s ruler', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/' });
  const lookup = async (text) => { const lot = findReferences(text); return local.lookupType(lotLookup(lot.references[0], lot.rulers)); };
  const nero = await lookup('Nero. AR Denarius. RIC 287 (Rome).');
  assert.equal(nero.status, 'candidates');
  assert.equal(nero.personMismatch, true);
  assert.deepEqual(nero.candidates.map(({ id }) => id), ['ric.7.rom.287']);
  assert.equal((await lookup('Licinius. Follis. RIC 287 (Rome).')).card?.id, 'ric.7.rom.287');
  // A mint with no coin of that number for the ruler leaves his own coins with the number to choose from, never one of them opened: nothing ties
  // them to the mint the lot wrote.
  const ticinum = await lookup('Constantine I. Follis. RIC 287 (Ticinum).');
  assert.equal(ticinum.status, 'candidates');
  assert.equal(ticinum.partial, true);
  assert.deepEqual(ticinum.candidates.map(({ id }) => id), ['ric.7.ar.287', 'ric.7.lon.287', 'ric.7.lug.287']);
});

test('over the bundled catalogue, a mint bracketed after a number opens no coin of another ruler', { skip }, async () => {
  for (const [ruler, mint, from, to] of [['Probus', 'Ticinum', 1, 40], ['Nero', 'Rome', 400, 420], ['Gallienus', 'Siscia', 1, 20], ['Diocletian', 'Antioch', 1, 20]]) {
    for (let number = from; number <= to; number += 1) {
      const lot = findReferences(`${ruler}. Antoninianus. RIC ${number} (${mint}).`);
      const result = await bundle.lookupType(lotLookup(lot.references[0], lot.rulers));
      if (result.status === 'ok') assert.ok(peopleOn(result.card.id).includes(ruler.toLowerCase()), `${ruler} ${number}: ${result.card.label}`);
    }
  }
});

// A section read from the heading's mint and nothing else never opens a coin: the heading may name a ruler the people table cannot place.
test('a section taken only from the heading\'s mint is offered, never opened', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/' });
  const lot = findReferences('Usurper. Follis. Londinium. RIC VII 287.');
  const offered = await local.lookupType(lotLookup(lot.references[0], lot.rulers));
  assert.equal(offered.status, 'candidates');
  assert.equal(offered.partial, true);
  assert.deepEqual(offered.candidates.map(({ id }) => id), ['ric.7.lon.287']);
  // The same section cited in the reference itself still opens its coin.
  assert.equal((await local.lookupType(parseReference('RIC VII Londinium 287'))).card?.id, 'ric.7.lon.287');
});

// The index is what a lookup is matched against, so a record it lists and its shard lacks is a stale or damaged bundle, never a coin missing from
// RIC: the lookup is unavailable, and the caller goes online for it, rather than offering the wrong numbers or saying it is not there.
test('a record the index lists and its shard lacks makes the lookup unavailable, never a miss or a list of other coins', async () => {
  const { 'ric.1(2).ner.306': dropped, ...rest } = records;
  assert.ok(dropped);
  const stale = () => createLocalCatalogue({ fetchImpl: fixtureFetch({ 'records-1(2).json': { schemaVersion: 1, records: rest } }), baseUrl: 'moz-extension://test/data/' });
  assert.equal((await stale().lookupType(parseReference('RIC I (2nd ed.) Nero 306'))).status, 'unavailable');
  assert.equal((await stale().lookupType({ catalogue: 'RIC', volume: '', section: '', number: '306', rulers: ['Nero'] })).status, 'unavailable');
  assert.equal((await stale().lookupType({ catalogue: 'RIC', volume: '', section: '', number: '306' })).status, 'unavailable');
  // A lookup by an identifier the index was never asked about still answers that the record is not here.
  assert.equal((await stale().lookupById('ocre', 'ric.1(2).ner.306')).status, 'none');
});

test('over the bundled catalogue, a title lookup whose shard lacks the record it matched is unavailable', { skip }, async () => {
  for (const [corpus, file, id, reference] of [['crro', 'crro/records-rrc.json', 'rrc-44.5', 'RRC 44/5'], ['pella', 'pella/records-price.json', 'price.23', 'Price 23'],
    ['sco', 'sco/records-sc.json', 'sc.1.1266.2', 'SC 1266.2']]) {
    const local = createLocalCatalogue({ baseUrl: 'moz-extension://test/data/', fetchImpl: async (url) => {
      const path = bundlePath(url);
      const value = bundleJson(path);
      const served = path === file ? { schemaVersion: 1, records: Object.fromEntries(Object.entries(value.records).filter(([key]) => key !== id)) } : value;
      return { ok: true, status: 200, json: async () => served };
    } });
    assert.equal((await local.lookupType(parseReference(reference))).status, 'unavailable', corpus);
  }
});

test('over the bundled catalogue, a joint heading never opens one of its rulers\' own coins', { skip }, async () => {
  const lot = findReferences('Aurelian and Severina. Antoninianus. RIC 2.');
  const result = await bundle.lookupType(lotLookup(lot.references[0], lot.rulers));
  assert.equal(result.status, 'candidates');
  assert.ok(result.candidates.some(({ id }) => id === 'ric.5.aur_seva.2'), JSON.stringify(result.candidates));
});

// RIC V files Diocletian by name and RIC VI by mint, so "Diocletian. RIC 15 (Lugdunum)" is his own RIC V 15 as readily as the RIC VI Lugdunum 15 the
// mint alone reaches: the mint's coin is never opened while the ruler's own section holds a coin with the number. Another mint's coin of his is no
// choice here, since the lot says where it was struck.
test('over the bundled catalogue, a mint bracketed after a number offers the ruler\'s own-section coin beside the mint\'s', { skip }, async () => {
  const lookup = async (text) => {
    const lot = findReferences(text);
    return lookupType(lotLookup(lot.references[0], lot.rulers), { localProvider: bundle, online: false });
  };
  const diocletian = await lookup('Diocletian. Antoninianus. RIC 15 (Lugdunum).');
  assert.equal(diocletian.status, 'candidates');
  assert.equal(diocletian.partial, true);
  assert.deepEqual(diocletian.candidates.map(({ id }) => id), ['ric.6.lug.15', 'ric.5.dio.15']);
  const carausius = await lookup('Carausius, with Diocletian and Maximian. Antoninianus. RIC 12 (London).');
  assert.equal(carausius.status, 'candidates');
  assert.ok(carausius.candidates.some(({ id }) => id === 'ric.6.lon.12'), JSON.stringify(carausius.candidates));
  assert.ok(carausius.candidates.some(({ id }) => id === 'ric.5.cara.12'), JSON.stringify(carausius.candidates));
  assert.ok(carausius.candidates.every(({ title }) => !/ (?:Antioch|Alexandria|Aquileia|Nicomedia) /.test(title)), JSON.stringify(carausius.candidates));
  // A ruler whose own sections hold no coin with the number still opens the mint's.
  assert.equal((await lookup('Constantine I. Follis. RIC 40 (Ticinum).')).card?.id, 'ric.7.tic.40');
});

// A typed or guided reference whose section is a mint and which states no volume ("RIC 411 (Rome)", "RIC Rome 411", Any volume) says where a coin
// was struck and nothing about whose it is, as a heading's mint does: its one coin is offered, never opened. With a volume it opens as it always did.
test('a mint section typed with no volume is offered, never opened, and opens with a volume', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/' });
  for (const reference of [parseReference('RIC 287 (Londinium)'), parseReference('RIC Londinium 287'), { catalogue: 'RIC', volume: '', section: 'Londinium', number: '287' }]) {
    const offered = await local.lookupType(reference);
    assert.equal(offered.status, 'candidates', JSON.stringify(reference));
    assert.equal(offered.partial, true);
    assert.deepEqual(offered.candidates.map(({ id }) => id), ['ric.7.lon.287']);
  }
  assert.equal((await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Londinium', number: '287' })).card?.id, 'ric.7.lon.287');
});

// Only a record the answer rests on makes a stale shard unavailable: one missing record among the other rulers' coins with the number must not cost
// a ruler the coin that is plainly his ("Trajan. RIC 720" with Domitian's RIC II.1² 720 gone), while a lookup whose own ruler's record is the one
// missing still goes online.
test('a stale shard is unavailable only where the answer needs the record it lacks', async () => {
  const { 'ric.2_1(2).dom.720': dropped, ...rest } = records;
  assert.ok(dropped);
  const stale = () => createLocalCatalogue({ fetchImpl: fixtureFetch({ 'records-2_1(2).json': { schemaVersion: 1, records: rest } }), baseUrl: 'moz-extension://test/data/' });
  assert.equal((await stale().lookupType({ catalogue: 'RIC', volume: '', section: '', number: '720', rulers: ['Trajan'] })).card?.id, 'ric.2.tr.720');
  assert.equal((await stale().lookupType({ catalogue: 'RIC', volume: '', section: '', number: '720', rulers: ['Domitian'] })).status, 'unavailable');
  assert.equal((await stale().lookupType({ catalogue: 'RIC', volume: '', section: '', number: '720', rulers: ['Nero'] })).status, 'unavailable');
});

// A joint heading naming a RIC section and a person ("Philip I and Otacilia Severa") looks in the section and for the person, and offers what it
// finds: the section alone opened Philip's own coin before, and the person alone left every coin with the number to choose from.
test('a joint heading naming a section and a person offers the section\'s coins and the person\'s, never every coin with the number', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/' });
  const lot = findReferences('Philip I and Otacilia Severa. Antoninianus. RIC 27a.');
  assert.deepEqual(lot.rulers, ['Philip I', 'Otacilia Severa']);
  const result = await local.lookupType(lotLookup(lot.references[0], lot.rulers));
  assert.equal(result.status, 'candidates');
  assert.equal(result.partial, true);
  assert.equal(result.personMismatch, undefined);
  assert.deepEqual(result.candidates.map(({ id }) => id), ['ric.4.ph_i.27A']);
});

test('over the bundled catalogue, a joint heading naming a section and a person offers a few of their coins', { skip }, async () => {
  for (const [text, id] of [['Philip I and Otacilia Severa. RIC 1.', 'ric.4.ph_i.1'], ['Philip I and Otacilia Severa. Antoninianus. RIC 30.', 'ric.4.ph_i.30']]) {
    const lot = findReferences(text);
    const result = await bundle.lookupType(lotLookup(lot.references[0], lot.rulers));
    assert.equal(result.status, 'candidates', text);
    assert.equal(result.personMismatch, undefined, text);
    assert.ok(result.candidates.some((entry) => entry.id === id), JSON.stringify(result.candidates));
    assert.ok(result.candidates.length <= 5, JSON.stringify(result.candidates));
  }
});

// The index is read into objects once per bundle, and a RIC lookup the number index narrows builds only the entries it lists. Each index pair here
// counts how often it is read after the index has loaded (its validation reads every pair once, which is the load and not a lookup).
const countedIndex = () => {
  let loaded = false;
  const reads = new Map();
  const entries = index.entries.map((pair, position) => new Proxy(pair, { get(target, key) {
    if (loaded && (key === '0' || key === '1')) reads.set(position, (reads.get(position) ?? 0) + 1);
    return Reflect.get(target, key);
  } }));
  return { value: { schemaVersion: 1, entries }, reads, start: () => { loaded = true; } };
};

test('a RIC lookup builds only the index entries the number index lists, and a second lookup rebuilds none', async () => {
  const counted = countedIndex();
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch({ 'index.json': counted.value }), baseUrl: 'moz-extension://test/data/' });
  // The index is loaded, and validated, by the first lookup; only what the lookups after it read is counted.
  assert.equal((await local.lookupType({ catalogue: 'RIC', volume: '', section: '', number: '972' })).card.id, 'ric.2_1(2).ves.972');
  counted.start();
  assert.equal((await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Rome', number: '287' })).card.id, 'ric.7.rom.287');
  // RIC 287's four positions are 2 to 5, and nothing else is built for it.
  assert.deepEqual([...counted.reads.keys()].sort((a, b) => a - b), [2, 3, 4, 5]);
  counted.reads.clear();
  assert.equal((await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Londinium', number: '287' })).card.id, 'ric.7.lon.287');
  assert.deepEqual([...counted.reads.keys()], []);
  // Another number builds its own entries and nobody else's.
  assert.equal((await local.lookupType({ catalogue: 'RIC', volume: 'II', section: 'Trajan', number: '720' })).card.id, 'ric.2.tr.720');
  assert.deepEqual([...counted.reads.keys()].sort((a, b) => a - b), [6, 7, 8]);
});

test('a title catalogue\'s index is read into entries once, however many lookups follow', async () => {
  const pella = {
    'metadata.json': { schemaVersion: 1, corpus: 'pella', recordCount: 2, activeRecordCount: 2, aliases: {}, shards: { price: whole('price') } },
    'records-price.json': { schemaVersion: 1, records: {
      'price.23': { i: 'price.23', l: 'Price 23', o: {}, r: {} }, 'price.24': { i: 'price.24', l: 'Price 24', o: {}, r: {} } } },
  };
  let loaded = false;
  let reads = 0;
  const entries = [['price.23', 'Price 23'], ['price.24', 'Price 24']].map((pair) => new Proxy(pair, { get(target, key) {
    if (loaded && (key === '0' || key === '1')) reads += 1;
    return Reflect.get(target, key);
  } }));
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch({ ...pella, 'index.json': { schemaVersion: 1, entries } }), baseUrl: 'moz-extension://test/data/' });
  assert.equal((await local.lookupType(parseReference('Price 23'))).card.id, 'price.23');
  loaded = true;
  assert.equal((await local.lookupType(parseReference('Price 24'))).card.id, 'price.24');
  assert.equal((await local.lookupType(parseReference('Price 99'))).status, 'candidates');
  assert.equal(reads, 0);
});

// The bundled catalogue keeps each title's reading and picks over the readings, so a broadened retry reads nothing twice: the pick over read titles
// is the pick over the titles themselves.
test('picking over titles already read is picking over the titles', () => {
  const entries = index.entries.map(([id, title]) => ({ id, title }));
  const read = entries.map((entry) => ({ entry, hit: parseReference(entry.title, false) }));
  for (const reference of [{ catalogue: 'RIC', volume: 'VII', section: 'Rome', number: '287' }, { catalogue: 'RIC', volume: '', section: '', number: '287' },
    { catalogue: 'RIC', volume: 'II', section: 'Domitian', number: '720' }, { catalogue: 'RIC', volume: '', section: '', number: '999' }]) {
    assert.deepEqual(pickRicHits(read, reference), pickRicEntries(entries, reference), JSON.stringify(reference));
  }
});
