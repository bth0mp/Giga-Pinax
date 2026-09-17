import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { catalogueMetadataText, createLocalCatalogue, packedRecordToCard } from '../extension/local-catalogue.js';
import { findReferences, lotLookup } from '../extension/lot.js';
import { parseReference } from '../extension/lookup.js';

const metadata = {
  schemaVersion: 1, corpus: 'ocre', recordCount: 3, activeRecordCount: 2,
  aliases: { 'ric.1(2).ner.306-old': 'ric.1(2).ner.306' },
  shards: { '1(2)': 'records-1(2).json', '2': 'records-2.json', '2_1(2)': 'records-2_1(2).json', '2_3(2)': 'records-2_3(2).json', '4': 'records-4.json', '7': 'records-7.json' },
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
  const routes = { 'metadata.json': metadata, 'index.json': index, 'records-1(2).json': { schemaVersion: 1, records }, 'records-2.json': { schemaVersion: 1, records }, 'records-2_1(2).json': { schemaVersion: 1, records }, 'records-2_3(2).json': { schemaVersion: 1, records }, 'records-4.json': { schemaVersion: 1, records }, 'records-7.json': { schemaVersion: 1, records }, ...overrides };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const key = Object.keys(routes).find((part) => String(url).endsWith(part));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    const value = routes[key];
    if (value instanceof Error) throw value;
    return { ok: true, status: 200, json: async () => value };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('local catalogue resolves exact RIC titles without loading an unrelated shard', async () => {
  const fetchImpl = fixtureFetch();
  const local = createLocalCatalogue({ fetchImpl, baseUrl: 'moz-extension://test/data/ocre/', cache: new Map([['nero', 'Nero'], ['as', 'As'], ['rome', 'Rome'], ['ae', 'Bronze']]) });
  const result = await local.lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.id, 'ric.1(2).ner.306');
  assert.equal(result.card.source, 'local');
  assert.deepEqual(fetchImpl.calls.map((url) => url.split('/').pop()), ['metadata.json', 'index.json', 'records-1(2).json']);
});

test('local catalogue preserves RIC partial, suffix, volume and sibling candidate rules', async () => {
  const fetchImpl = fixtureFetch();
  const local = createLocalCatalogue({ fetchImpl, baseUrl: 'moz-extension://test/data/ocre/' });
  const partial = await local.lookupType({ catalogue: 'RIC', volume: '', section: '', number: '972' });
  assert.equal(partial.status, 'ok');
  assert.equal(partial.card.id, 'ric.2_1(2).ves.972');
  assert.equal((await local.lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306A' })).status, 'none');
});

test('lookupById respects aliases and caches metadata, index and shards', async () => {
  const fetchImpl = fixtureFetch();
  const local = createLocalCatalogue({ fetchImpl, baseUrl: 'moz-extension://test/data/ocre/' });
  const first = await local.lookupById('ocre', 'ric.1(2).ner.306-old');
  const second = await local.lookupById('ocre', 'ric.1(2).ner.306');
  assert.equal(first.card.id, 'ric.1(2).ner.306');
  assert.equal(second.status, 'ok');
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('metadata.json')).length, 1);
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('records-1(2).json')).length, 1);
});

test('mint-volume person lookup filters authority and obverse portraits before opening a type', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/ocre/' });
  const result = await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Constantine II', number: '287' });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.id, 'ric.7.lon.287');
});

test('a local person miss labels broader same-reference candidates honestly', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/ocre/' });
  const result = await local.lookupType({ catalogue: 'RIC', volume: 'VII', section: 'Constantine III', number: '287' });
  assert.equal(result.status, 'candidates');
  assert.equal(result.personMismatch, true);
  assert.equal(result.candidates.length, 4);
});

test('a strict id hint opens only when it matches the parsed citation and explicit mint', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/ocre/' });
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
  const missing = createLocalCatalogue({ fetchImpl: fixtureFetch({ 'metadata.json': new Error('missing') }), baseUrl: 'moz-extension://test/data/ocre/' });
  assert.equal((await missing.lookupType({ catalogue: 'RIC', volume: '', section: '', number: '1' })).status, 'unavailable');
  const corrupt = createLocalCatalogue({ fetchImpl: fixtureFetch({ 'metadata.json': { schemaVersion: 2 } }), baseUrl: 'moz-extension://test/data/ocre/' });
  assert.equal((await corrupt.lookupById('ocre', 'ric.1(2).ner.306')).status, 'unavailable');
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
  assert.equal(catalogueMetadataText({ recordCount: 56116, activeRecordCount: 55990, generatedOn: '2026-09-14', publicationDate: null }),
    '55,990 active types from 56,116 OCRE records. Local files generated 14 September 2026. Source publication date unknown.');
  assert.equal(catalogueMetadataText(null), 'Local OCRE catalogue unavailable.');
});

test('a plain volume numeral finds the part of its family that has the ruler, and never answers with another ruler', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/ocre/' });
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
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/ocre/' });
  const lot = findReferences('Philip I. AR Antoninianus. Rome. RIC 27b; RSC 9.');
  assert.deepEqual(lot.rulers, ['Philip I']);
  const reference = lotLookup(lot.references[0], lot.rulers);
  assert.deepEqual(reference, { catalogue: 'RIC', volume: 'IV', section: 'Philip I', number: '27b' });
  const found = await local.lookupType(reference);
  assert.equal(found.status, 'ok');
  assert.equal(found.card.id, 'ric.4.ph_i.27B');
});

test('the local fallback broadens the volume before the section, and a section it had to drop is only ever offered', async () => {
  const local = createLocalCatalogue({ fetchImpl: fixtureFetch(), baseUrl: 'moz-extension://test/data/ocre/' });
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
  const failures = new Set(['metadata.json', 'index.json', 'records-1(2).json']);
  const fetchImpl = fixtureFetch();
  const once = async (url) => {
    const failing = [...failures].find((name) => String(url).endsWith(name));
    if (failing) { failures.delete(failing); throw new Error(`offline: ${failing}`); }
    return fetchImpl(url);
  };
  const local = createLocalCatalogue({ fetchImpl: once, baseUrl: 'moz-extension://test/data/ocre/' });
  const reference = { catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' };
  // One dropped request each for the metadata, the index and the shard; a cached rejection would make any of them permanent.
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await local.lookupType(reference)).status, 'unavailable', String(attempt));
  const found = await local.lookupType(reference);
  assert.equal(found.status, 'ok');
  assert.equal(found.card.id, 'ric.1(2).ner.306');
  assert.equal(failures.size, 0);
});

// The bundled catalogue itself, not the fixture above: what a heading's ruler costs only shows against OCRE's own numbering, where one man's name
// stands inside another's. The index is served one number at a time — the entries carrying that RIC number, which is the first thing pickRicEntries
// keeps — so every answer is the one the whole bundle gives while the sweep stays a few seconds. Skipped where the bundle is not checked out.
const BUNDLE = fileURLToPath(new URL('../extension/data/ocre/', import.meta.url));
const skip = existsSync(`${BUNDLE}index.json`) ? false : 'extension/data/ocre is not bundled here';
const files = new Map();
const bundleJson = (name) => {
  if (!files.has(name)) files.set(name, JSON.parse(readFileSync(`${BUNDLE}${name}`, 'utf8')));
  return files.get(name);
};
let byNumber;
const bundleIndex = () => {
  if (byNumber) return byNumber;
  byNumber = new Map();
  for (const entry of bundleJson('index.json').entries) {
    const hit = parseReference(entry[1], false);
    if (hit?.catalogue !== 'RIC') continue;
    const number = String(hit.number).toLowerCase().replace(/\s*\([^()]*\)$/, '').trim();
    if (!byNumber.has(number)) byNumber.set(number, []);
    byNumber.get(number).push(entry);
  }
  return byNumber;
};
const bundleCatalogue = (...numbers) => createLocalCatalogue({
  baseUrl: 'moz-extension://test/data/ocre/',
  fetchImpl: async (url) => {
    const name = decodeURIComponent(String(url).split('/').pop());
    const entries = numbers.flatMap((number) => bundleIndex().get(number) ?? []);
    return { ok: true, status: 200, json: async () => (name === 'index.json' ? { schemaVersion: 1, entries } : bundleJson(name)) };
  },
});
// Every coin a heading opens on its own over RIC numbers 1 to 400, read exactly as a pasted lot is read.
async function openedOver(heading) {
  const opened = [];
  for (let number = 1; number <= 400; number += 1) {
    const lot = findReferences(`${heading}. RIC ${number}`);
    const found = lot.references[0];
    if (!found) continue;
    const result = await bundleCatalogue(String(number)).lookupType(lotLookup(found, lot.rulers));
    if (result?.status === 'ok') opened.push({ number, card: result.card });
  }
  return opened;
}
// Who is on a coin, as the record itself says: its authorities and its obverse portraits. The card names neither where a type has two authorities
// (RIC V's joint reigns), and it is the record the person filter reads anyway.
const peopleOn = (id) => {
  const record = bundleJson(bundleJson('metadata.json').shards[String(id).split('.')[1]])?.records?.[id];
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
  const local = bundleCatalogue('10-11', '10');
  const typed = await local.lookupType(parseReference('RIC II.3 Hadrian 10-11'));
  assert.deepEqual(typed.candidates.map((entry) => entry.id), ['ric.2_3(2).hdn.10-11']);
  const lot = findReferences('Hadrian. AR Denarius. RIC II.3 Hadrian 10-11.');
  const row = await local.lookupType(lotLookup(lot.references[0], lot.rulers));
  assert.deepEqual(row.candidates.map((entry) => entry.id), ['ric.2_3(2).hdn.10-11']);
  // A range OCRE has no record of falls back to the first number, which is the type the other 654 ranges share.
  const missing = await bundleCatalogue('10').lookupType(parseReference('RIC II.3 Hadrian 10-11'));
  assert.deepEqual(missing.candidates.map((entry) => entry.id), ['ric.2_3(2).hdn.10']);
});

test('the shards a person filter needs are loaded together, not one after another', async () => {
  const waiting = [];
  const barrier = fixtureFetch();
  // Every shard request is held until all three are in flight: loaded one after another, this lookup could never finish.
  const held = (url) => (String(url).includes('records-') ? new Promise((resolve) => {
    waiting.push(() => resolve(barrier(url)));
    if (waiting.length === 3) for (const release of waiting.splice(0)) release();
  }) : barrier(url));
  const local = createLocalCatalogue({ fetchImpl: held, baseUrl: 'moz-extension://test/data/ocre/' });
  const result = await local.lookupType({ catalogue: 'RIC', volume: '', section: 'Trajan', number: '720' });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.id, 'ric.2.tr.720');
});
