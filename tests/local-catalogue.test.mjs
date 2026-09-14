import test from 'node:test';
import assert from 'node:assert/strict';

import { catalogueMetadataText, createLocalCatalogue, packedRecordToCard } from '../extension/local-catalogue.js';

const metadata = {
  schemaVersion: 1, corpus: 'ocre', recordCount: 3, activeRecordCount: 2,
  aliases: { 'ric.1(2).ner.306-old': 'ric.1(2).ner.306' },
  shards: { '1(2)': 'records-1(2).json', '2_1(2)': 'records-2_1(2).json' },
};
const index = { schemaVersion: 1, entries: [
  ['ric.1(2).ner.306', 'RIC I (second edition) Nero 306'],
  ['ric.2_1(2).ves.972', 'RIC II, Part 1 (second edition) Vespasian 972'],
] };
const records = {
  'ric.1(2).ner.306': { i: 'ric.1(2).ner.306', l: 'RIC I (second edition) Nero 306', a: ['nero'], d: ['as'], m: ['rome'], x: ['ae'], s: '0062', e: '0068', o: { l: 'NERO', d: 'Head of Nero', p: ['nero'] }, r: { d: 'Temple' } },
  'ric.2_1(2).ves.972': { i: 'ric.2_1(2).ves.972', l: 'RIC II, Part 1 (second edition) Vespasian 972', a: ['vespasian'], d: ['denarius', 'aureus'], o: { p: ['titus'] }, r: {} },
};

function fixtureFetch(overrides = {}) {
  const routes = { 'metadata.json': metadata, 'index.json': index, 'records-1(2).json': { schemaVersion: 1, records }, 'records-2_1(2).json': { schemaVersion: 1, records }, ...overrides };
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
  assert.equal(packedRecordToCard(records['ric.2_1(2).ves.972'], new Map()).portrait, null);
});

test('catalogue metadata reports actual coverage and separates generation from unknown publication date', () => {
  assert.equal(catalogueMetadataText({ recordCount: 56116, activeRecordCount: 55990, generatedOn: '2026-09-14', publicationDate: null }),
    '55,990 active types from 56,116 OCRE records. Local files generated 14 September 2026. Source publication date unknown.');
  assert.equal(catalogueMetadataText(null), 'Local OCRE catalogue unavailable.');
});
