import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptySnapshot } from '../extension/core/records.js';
import { deduplicateEvidence } from '../extension/core/evidence.js';
import { exportBackup, previewImport, validateBackup } from '../extension/core/backup.js';

const NOW = '2026-09-12T12:00:00.000Z';

test('exports a versioned UTF-8 JSON document without the request ledger', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.recentCommands.push({ requestId: 'secret-retry-id' });
  const result = exportBackup(snapshot, NOW);
  assert.equal(result.ok, true);
  const document = JSON.parse(result.value);
  assert.equal(document.format, 'ancient-coin-auction-companion');
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.exportedAt, NOW);
  assert.deepEqual(document.data.recentCommands, []);
  assert.equal(result.value.includes('secret-retry-id'), false);
});

test('round-trips CHF money as its own exact minor-unit currency', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.lots.push({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 0, dataClass: 'collector',
    title: 'Swiss-priced coin', sourceLinks: [], bidHistory: [],
    activeBid: { amount: { currency: 'CHF', minor: 10000 }, buyerPremiumBps: 2500, placedAt: NOW },
    outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW,
  });
  const exported = exportBackup(snapshot, NOW);
  assert.equal(exported.ok, true);
  const restored = validateBackup(exported.value);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.value.lots[0].activeBid.amount, { currency: 'CHF', minor: 10000 });
});

test('old schema-one backups load while optional presets and lot notes round-trip when present', () => {
  const old = createEmptySnapshot(NOW);
  assert.equal(validateBackup(exportBackup(old, NOW).value).ok, true);
  const current = createEmptySnapshot(NOW);
  current.preferences = {
    schemaVersion: 1, revision: 0, currency: 'GBP', catalogue: 'RIC', number: '306',
    volume: 'I', section: 'Nero', sampleMode: false, desktopAlertsEnabled: false,
    housePremiumPresets: [{ name: 'CNG', buyerPremiumBps: 2250 }], createdAt: NOW, updatedAt: NOW,
  };
  current.lots.push({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 0, dataClass: 'collector',
    title: 'Nero denarius', notes: 'Compare with the plated example.', sourceLinks: [], bidHistory: [],
    outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW,
  });
  const restored = validateBackup(exportBackup(current, NOW).value);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.value.preferences.housePremiumPresets, current.preferences.housePremiumPresets);
  assert.equal(restored.value.lots[0].notes, current.lots[0].notes);
});

test('schema-one backups round-trip optional lot auction metadata', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.lots.push({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 0, dataClass: 'collector', title: 'Coin', sourceLinks: [], bidHistory: [], outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW,
    auctionContext: { pageUrl: 'https://house.test/lot/1' },
    coinDetails: { weightMg: 4100 },
    provenanceNotes: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', text: 'Sale', sourceUrl: 'https://source.test', recordedAt: NOW, auctionDate: '2026-09-12' }],
    costEstimate: { currency: 'CHF', shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0 },
  });
  const restored = validateBackup(exportBackup(snapshot, NOW).value);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.value.lots[0], snapshot.lots[0]);
});

test('validates the whole backup and rejects malformed, future, oversized, or invalid data', () => {
  assert.equal(validateBackup('{').error.code, 'invalid-json');
  assert.equal(validateBackup({ format: 'ancient-coin-auction-companion', schemaVersion: 2, exportedAt: NOW, data: {} }).error.code, 'unsupported-schema');
  assert.equal(validateBackup('x'.repeat(5 * 1024 * 1024 + 1)).error.code, 'file-too-large');
  const invalid = {
    format: 'ancient-coin-auction-companion', schemaVersion: 1, exportedAt: NOW,
    data: { ...createEmptySnapshot(NOW), revision: -1 },
  };
  assert.equal(validateBackup(invalid).ok, false);
});

test('merge preview deduplicates equal IDs and reports unequal collisions without partial merge', () => {
  const current = createEmptySnapshot(NOW);
  current.alternativeGroups.push({
    id: '11111111-1111-4111-8111-111111111111', revision: 0, dataClass: 'collector',
    name: 'Greek', createdAt: NOW, updatedAt: NOW,
  });
  const equal = structuredClone(current);
  const equalPreview = previewImport(current, equal, 'merge');
  assert.equal(equalPreview.ok, true);
  assert.equal(equalPreview.value.conflicts.length, 0);
  assert.equal(equalPreview.value.snapshot.alternativeGroups.length, 1);

  const unequal = structuredClone(current);
  unequal.alternativeGroups[0].name = 'Roman';
  const conflict = previewImport(current, unequal, 'merge');
  assert.equal(conflict.ok, true);
  assert.equal(conflict.value.conflicts[0].collection, 'alternativeGroups');
  assert.equal(conflict.value.snapshot, null);
});

test('replace preview reports exact outgoing and incoming collection counts', () => {
  const current = createEmptySnapshot(NOW);
  const incoming = createEmptySnapshot(NOW);
  incoming.alternativeGroups.push({
    id: '11111111-1111-4111-8111-111111111111', revision: 0, dataClass: 'collector',
    name: 'Greek', createdAt: NOW, updatedAt: NOW,
  });
  const preview = previewImport(current, incoming, 'replace');
  assert.equal(preview.ok, true);
  assert.equal(preview.value.counts.outgoing.alternativeGroups, 0);
  assert.equal(preview.value.counts.incoming.alternativeGroups, 1);
});

test('merge preview preserves current drafts while omitting incoming drafts', () => {
  const current = createEmptySnapshot(NOW);
  const draft = {
    id: '66666666-6666-4666-8666-666666666666', revision: 0, dataClass: 'collector',
    kind: 'research-highlight', payload: { rawText: 'RIC 306', pageUrl: 'https://example.test/lot' },
    createdAt: NOW, updatedAt: NOW, expiresAt: '2026-09-12T12:30:00.000Z',
  };
  current.drafts.push(draft);
  const incoming = createEmptySnapshot(NOW);
  incoming.drafts.push({ ...draft, id: '77777777-7777-4777-8777-777777777777' });
  const before = structuredClone(current);
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.value.snapshot.drafts, [draft]);
  assert.deepEqual(current, before, 'preview must not mutate current data');
  assert.equal(JSON.stringify(preview.value.snapshot.drafts).includes('RIC 306'), true);
});

test('merge preview reports canonical same-sale evidence under different stable IDs', () => {
  const observation = {
    id: '11111111-1111-4111-8111-111111111111',
    queryId: '22222222-2222-4222-8222-222222222222',
    source: 'manual', dataClass: 'collector', retrievedAt: NOW,
    houseSaleId: 'Sale 10', auctionHouse: 'House', auctionDate: '2026-01-02',
    lotNumber: '9', priceBasis: 'hammer', amount: { currency: 'EUR', minor: 12000 },
  };
  const row = {
    ...deduplicateEvidence([observation]).value.evidence[0],
    revision: 0, createdAt: NOW, updatedAt: NOW,
  };
  const current = createEmptySnapshot(NOW);
  current.evidence.push(row);
  const incoming = createEmptySnapshot(NOW);
  const conflicting = structuredClone(row);
  conflicting.id = '33333333-3333-4333-8333-333333333333';
  conflicting.observations[0].id = '44444444-4444-4444-8444-444444444444';
  conflicting.observations[0].amount.minor = 14000;
  conflicting.resolved.hammer.minor = 14000;
  incoming.evidence.push(conflicting);
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true);
  assert.equal(preview.value.snapshot, null);
  assert.deepEqual(preview.value.conflicts[0], {
    collection: 'evidence', id: incoming.evidence[0].id, reason: 'same-sale-collision',
  });
});
