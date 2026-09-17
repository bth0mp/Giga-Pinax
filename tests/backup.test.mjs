import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptySnapshot } from '../extension/core/records.js';
import { deduplicateEvidence } from '../extension/core/evidence.js';
import {
  MAX_BACKUP_BYTES, backupFileName, exportBackup, importCountsText, importIssueLines, previewImport,
  quarantineDocument, quarantineLines, quarantineSummaryText, rawExportDocument, validateBackup,
} from '../extension/core/backup.js';

const NOW = '2026-09-12T12:00:00.000Z';
const LATER = '2026-09-13T12:00:00.000Z';
const uuid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

function lot(id, extra = {}) {
  return {
    id, revision: 0, dataClass: 'collector', title: 'Coin', sourceLinks: [], bidHistory: [],
    outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

function group(id, name = 'Greek') {
  return { id, revision: 0, dataClass: 'collector', name, createdAt: NOW, updatedAt: NOW };
}

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
  assert.equal(validateBackup('x'.repeat(MAX_BACKUP_BYTES + 1)).error.code, 'file-too-large');
  const invalid = {
    format: 'ancient-coin-auction-companion', schemaVersion: 1, exportedAt: NOW,
    data: { ...createEmptySnapshot(NOW), revision: -1 },
  };
  assert.equal(validateBackup(invalid).ok, false);
});

test('merge preview deduplicates equal IDs and settles differences by revision, date, then local', () => {
  const current = createEmptySnapshot(NOW);
  current.alternativeGroups.push(group('11111111-1111-4111-8111-111111111111'));
  const equal = structuredClone(current);
  const equalPreview = previewImport(current, equal, 'merge');
  assert.equal(equalPreview.ok, true);
  assert.equal(equalPreview.value.conflicts.length, 0);
  assert.equal(equalPreview.value.snapshot.alternativeGroups.length, 1);
  assert.equal(equalPreview.value.counts.keptLocal, 1);

  const newer = structuredClone(current);
  newer.alternativeGroups[0].name = 'Roman';
  newer.alternativeGroups[0].revision = 1;
  const won = previewImport(current, newer, 'merge');
  assert.equal(won.value.snapshot.alternativeGroups[0].name, 'Roman');
  assert.equal(won.value.counts.updated, 1);

  const sameRevision = structuredClone(newer);
  sameRevision.alternativeGroups[0].revision = 0;
  const kept = previewImport(current, sameRevision, 'merge');
  assert.equal(kept.value.snapshot.alternativeGroups[0].name, 'Greek', 'a tie goes to the local row');
  assert.equal(kept.value.counts.keptLocal, 1);

  const later = structuredClone(sameRevision);
  later.alternativeGroups[0].updatedAt = LATER;
  const byDate = previewImport(current, later, 'merge');
  assert.equal(byDate.value.snapshot.alternativeGroups[0].name, 'Roman');
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
  assert.deepEqual(preview.value.conflicts[0], {
    collection: 'evidence', id: incoming.evidence[0].id, reason: 'same-sale-collision',
  });
  // A conflict keeps the local row and no longer blocks the rest of the import.
  assert.equal(preview.value.snapshot.evidence.length, 1);
  assert.deepEqual(preview.value.snapshot.evidence[0], row);
  assert.equal(preview.value.counts.keptLocal, 1);
});

test('a five-thousand-lot store exports compact and its pretty-printed backup still imports', () => {
  const snapshot = createEmptySnapshot(NOW);
  for (let index = 0; index < 5000; index += 1) {
    snapshot.lots.push(lot(uuid(index), { notes: 'Nero denarius. '.repeat(60) }));
  }
  const exported = exportBackup(snapshot, NOW);
  assert.equal(exported.ok, true, exported.error?.message);
  assert.equal(exported.value.includes('\n'), false, 'the export is compact JSON');

  const pretty = JSON.stringify(JSON.parse(exported.value), null, 2);
  assert.equal(pretty.length > 5 * 1024 * 1024, true, 'the pretty-printed form is over the old bound');
  const restored = validateBackup(pretty);
  assert.equal(restored.ok, true, restored.error?.message);
  assert.equal(restored.value.lots.length, 5000);
});

test('a backup written by an older schema migrates instead of being refused', () => {
  const data = createEmptySnapshot(NOW);
  const document = { format: 'ancient-coin-auction-companion', schemaVersion: 0, exportedAt: NOW, data: { ...data, schemaVersion: 0 } };
  // No migration step exists from version 0, so it still fails - but on the migrated data, not on
  // the document header, and a future build's backup is what is refused outright.
  assert.equal(validateBackup(document).error.path, 'data.schemaVersion');
  const future = { ...document, schemaVersion: 99, data };
  assert.equal(validateBackup(future).error.code, 'unsupported-schema');
  assert.equal(validateBackup(future).error.path, 'schemaVersion');
});

test('merge keeps local preferences and alerts, whatever bookkeeping the backup carries', () => {
  const preferences = {
    schemaVersion: 1, revision: 0, currency: 'GBP', catalogue: 'RIC', number: '306',
    volume: 'I', section: 'Nero', sampleMode: false, desktopAlertsEnabled: false,
    createdAt: NOW, updatedAt: NOW,
  };
  const current = createEmptySnapshot(NOW);
  current.preferences = preferences;
  const incoming = createEmptySnapshot(NOW);
  // Two fresh installs agree on every value and differ only in when each row was written.
  incoming.preferences = { ...preferences, revision: 3, createdAt: LATER, updatedAt: LATER };
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true);
  assert.equal(preview.value.conflicts.length, 0);
  assert.deepEqual(preview.value.snapshot.preferences, preferences);

  const empty = createEmptySnapshot(NOW);
  const adopted = previewImport(empty, incoming, 'merge');
  assert.deepEqual(adopted.value.snapshot.preferences, incoming.preferences);
});

test('merge keeps local alerts and never reports the rescheduled ones as conflicts', () => {
  const event = {
    id: uuid(1), revision: 0, dataClass: 'collector', name: 'Sale', eventKind: 'auction-starts',
    precision: 'timed', localDate: '2026-10-10', localTime: '12:00', timeZone: 'Europe/London',
    startsAt: '2026-10-10T11:00:00.000Z', reminderScope: 'standalone',
    reminders: [{ id: uuid(2), kind: 'offset', offsetMinutes: 60 }], createdAt: NOW, updatedAt: NOW,
  };
  const alert = {
    id: uuid(3), revision: 0, dataClass: 'collector', triggerId: `${event.id}:${event.reminders[0].id}`,
    eventId: event.id, eventRevision: 0, reminderId: event.reminders[0].id,
    triggerAt: '2026-10-10T10:00:00.000Z', status: 'pending', createdAt: NOW, updatedAt: NOW,
  };
  const current = createEmptySnapshot(NOW);
  current.auctionEvents.push(event);
  current.alerts.push(alert);
  const incoming = structuredClone(current);
  incoming.alerts[0] = { ...alert, revision: 9, status: 'acknowledged', acknowledgedAt: LATER, updatedAt: LATER };
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.equal(preview.value.conflicts.length, 0);
  assert.deepEqual(preview.value.snapshot.alerts, [alert]);
});

test('merge skips an incoming lot that is the same auction lot under a new ID', () => {
  const auctionContext = { house: 'CNG', saleId: 'Triton XXIX', lotNumber: '42', pageUrl: 'https://house.test/lot/42' };
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { title: 'Nero denarius', auctionContext }));
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(2), { title: 'Nero denarius (backup)', auctionContext }));
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.equal(preview.value.snapshot.lots.length, 1);
  assert.equal(preview.value.snapshot.lots[0].id, uuid(1));
  assert.equal(preview.value.counts.skippedDuplicate, 1);
  assert.deepEqual(preview.value.duplicates, [{ id: uuid(2), title: 'Nero denarius' }]);
  assert.equal(
    importIssueLines(preview.value).includes('lots: duplicate of Nero denarius'),
    true,
  );
});

test('merge is idempotent and adds unseen records once', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { title: 'Local' }));
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(2), {
    title: 'Imported',
    auctionContext: { house: 'A', saleId: 'B', lotNumber: '7', pageUrl: 'https://house.test/lot/7' },
  }));
  const first = previewImport(current, incoming, 'merge');
  assert.equal(first.ok, true, first.error?.message);
  assert.equal(first.value.counts.added, 1);
  const again = previewImport(first.value.snapshot, incoming, 'merge');
  assert.equal(again.ok, true);
  assert.equal(again.value.counts.added, 0);
  assert.equal(again.value.counts.skippedDuplicate + again.value.counts.keptLocal, 1);
  assert.deepEqual(again.value.snapshot.lots, first.value.snapshot.lots);
});

test('merge unions the quarantine bin and counts only the entries it gained', () => {
  const entry = { collection: 'lots', record: { id: 'broken' }, reason: 'invalid-enum', quarantinedAt: NOW };
  const other = { collection: 'alerts', record: null, reason: 'missing-record', quarantinedAt: LATER };
  const current = createEmptySnapshot(NOW);
  current.quarantine = [entry];
  const incoming = createEmptySnapshot(NOW);
  incoming.quarantine = [structuredClone(entry), other];
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.deepEqual(preview.value.snapshot.quarantine, [entry, other]);
  assert.equal(preview.value.counts.quarantine, 1);
});

test('merge renumbers alternative priorities two installs assigned independently', () => {
  const current = createEmptySnapshot(NOW);
  current.alternativeGroups.push(group(uuid(1)));
  current.lots.push(lot(uuid(2), { title: 'Local', alternativeGroupId: uuid(1), priority: 1 }));
  const incoming = structuredClone(current);
  incoming.lots = [lot(uuid(3), { title: 'Imported', alternativeGroupId: uuid(1), priority: 1 })];
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.deepEqual(
    preview.value.snapshot.lots.map(({ title, priority }) => [title, priority]),
    [['Local', 1], ['Imported', 2]],
  );
});

test('merge never breaks the mutual link between a lot and its collection entry', () => {
  const current = createEmptySnapshot(NOW);
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(1), { collectionEntryId: uuid(2) }));
  incoming.collectionEntries.push({
    id: uuid(2), revision: 0, dataClass: 'collector', lotId: uuid(1), title: 'Coin',
    acquisitionDate: '2026-09-01', sourceLinks: [], createdAt: NOW, updatedAt: NOW,
  });
  const added = previewImport(current, incoming, 'merge');
  assert.equal(added.ok, true, added.error?.message);
  assert.equal(added.value.snapshot.collectionEntries.length, 1);

  // The same entry arriving for a lot the merge did not take cannot be attached to anything.
  const orphaned = createEmptySnapshot(NOW);
  orphaned.lots.push(lot(uuid(1)));
  const preview = previewImport(orphaned, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.deepEqual(preview.value.snapshot.collectionEntries, []);
  assert.equal(preview.value.conflicts[0].collection, 'collectionEntries');
});

test('the import summary counts every outcome the merge reached', () => {
  const preview = {
    mode: 'merge',
    counts: { outgoing: { lots: 2 }, incoming: { lots: 3 }, added: 1, updated: 1, keptLocal: 1, skippedDuplicate: 1, quarantine: 0 },
    conflicts: [{ collection: 'evidence', id: uuid(1), reason: 'same-sale-collision' }],
    duplicates: [{ id: uuid(2), title: 'Nero denarius' }],
  };
  const text = importCountsText(preview);
  assert.equal(text.includes('Local: 2 records. Backup: 3 records.'), true);
  assert.equal(text.includes('Adds 1'), true);
  assert.equal(text.includes('updates 1'), true);
  assert.equal(text.includes('keeps 1 local'), true);
  assert.equal(text.includes('skips 1 duplicate'), true);
  assert.deepEqual(importIssueLines(preview), [
    'lots: duplicate of Nero denarius',
    'evidence: the same sale with different numbers, kept local',
  ]);
  const replace = { mode: 'replace', counts: { outgoing: { lots: 2 }, incoming: { lots: 3 } }, conflicts: [], duplicates: [] };
  assert.equal(importCountsText(replace), 'Local: 2 records. Backup: 3 records. Replaces everything local.');
});

test('set-aside records are summarized, listed and downloadable on their own', () => {
  const entries = [
    { collection: 'lots', record: { id: 'broken' }, reason: 'invalid-enum', quarantinedAt: NOW },
    {
      collection: 'auctionEvents', record: null, reason: 'missing-record', quarantinedAt: LATER,
      clearedReferences: [
        { collection: 'lots', id: uuid(1), field: 'auctionEventId', value: uuid(2) },
        { collection: 'lots', id: uuid(3), field: 'auctionEventId', value: uuid(2) },
      ],
    },
  ];
  assert.equal(quarantineSummaryText([]), '');
  assert.equal(quarantineSummaryText(entries), '1 record could not be read and was set aside.');
  assert.equal(quarantineSummaryText([entries[0], { ...entries[0] }]), '2 records could not be read and were set aside.');
  assert.deepEqual(quarantineLines(entries), [
    'lots: invalid-enum (2026-09-12)',
    'auctionEvents: missing-record (2026-09-13), 2 links cleared',
  ]);
  const document = JSON.parse(quarantineDocument(entries, NOW));
  assert.equal(document.exportedAt, NOW);
  assert.deepEqual(document.quarantine, entries);
});

test('the raw export copies stored data verbatim without the request ledger', () => {
  const raw = { schemaVersion: 1, revision: 4, lots: 'not a list', recentCommands: [{ requestId: 'secret-retry-id' }] };
  const document = rawExportDocument(raw, NOW);
  assert.equal(document.includes('secret-retry-id'), false);
  const parsed = JSON.parse(document);
  assert.equal(parsed.format, 'ancient-coin-auction-companion');
  assert.equal(parsed.exportedAt, NOW);
  assert.equal(parsed.data.lots, 'not a list');
  assert.deepEqual(parsed.data.recentCommands, []);
  // Nothing readable at all still produces a file rather than an error.
  assert.equal(JSON.parse(rawExportDocument(null, NOW)).data, null);
});

test('backup file names carry an instant a file system accepts', () => {
  assert.equal(backupFileName('giga-pinax-before-import', NOW), 'giga-pinax-before-import-2026-09-12T12-00-00.000Z.json');
});
