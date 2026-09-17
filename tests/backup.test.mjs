import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptySnapshot, validateSnapshot } from '../extension/core/records.js';
import { deduplicateEvidence } from '../extension/core/evidence.js';
import {
  BACKUP_FORMAT, MAX_BACKUP_BYTES, backupFileName, exportBackup, importChangeLines,
  importCountsText, importIssueLines, previewImport, quarantineDocument, quarantineLines,
  quarantineSummaryText, rawExportDocument, validateBackup,
} from '../extension/core/backup.js';

const NOW = '2026-09-12T12:00:00.000Z';
const LATER = '2026-09-13T12:00:00.000Z';
const LATEST = '2026-09-14T12:00:00.000Z';
// What a clock-skewed or hand-edited record claims: a write time no export could have followed.
const SKEWED = '9999-12-31T23:59:59.999Z';
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

function dateEvent(id, extra = {}) {
  return {
    id, revision: 0, dataClass: 'collector', name: 'Sale', eventKind: 'auction-starts',
    precision: 'date-only', localDate: '2026-10-10', timeZone: 'Europe/London',
    reminderScope: 'standalone', reminders: [], createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

function wonEntry(id, lotId, extra = {}) {
  return {
    id, revision: 0, dataClass: 'collector', lotId, title: 'Nero denarius',
    acquisitionDate: '2026-09-01', sourceLinks: [], createdAt: NOW, updatedAt: NOW, ...extra,
  };
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

test('merge preview skips equal IDs and settles differences by updatedAt, then local', () => {
  const current = createEmptySnapshot(NOW);
  current.alternativeGroups.push(group('11111111-1111-4111-8111-111111111111'));
  const equal = structuredClone(current);
  const equalPreview = previewImport(current, equal, 'merge');
  assert.equal(equalPreview.ok, true);
  assert.equal(equalPreview.value.conflicts.length, 0);
  assert.equal(equalPreview.value.snapshot.alternativeGroups.length, 1);
  assert.equal(equalPreview.value.counts.keptLocal, 1);
  assert.deepEqual(importChangeLines(equalPreview.value), [], 'an identical record is not a change');

  // Revision counters are per install and say nothing across two of them, so even a far higher one
  // loses to an equal write time.
  const higherRevision = structuredClone(current);
  higherRevision.alternativeGroups[0].name = 'Roman';
  higherRevision.alternativeGroups[0].revision = 9;
  const tie = previewImport(current, higherRevision, 'merge');
  assert.equal(tie.value.snapshot.alternativeGroups[0].name, 'Greek');
  assert.equal(tie.value.counts.keptLocal, 1);
  assert.deepEqual(importChangeLines(tie.value), [
    `alternativeGroups: "Greek" keeps the local copy (local ${NOW}, backup ${NOW})`,
  ]);

  const later = structuredClone(higherRevision);
  later.alternativeGroups[0].revision = 0;
  later.alternativeGroups[0].updatedAt = LATER;
  const won = previewImport(current, later, 'merge');
  assert.equal(won.value.snapshot.alternativeGroups[0].name, 'Roman');
  assert.equal(won.value.counts.updated, 1);
  assert.deepEqual(importChangeLines(won.value), [
    'alternativeGroups: "Greek" (in the backup: "Roman") is replaced by the backup\'s copy ' +
    `(backup ${LATER}, local ${NOW}), differing in name`,
  ]);
});

test('a record the merge replaces is stamped past both revisions so stale holders conflict', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { revision: 4, title: 'Local' }));
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(1), { revision: 2, title: 'From the backup', updatedAt: LATER }));
  const first = previewImport(current, incoming, 'merge');
  assert.equal(first.ok, true, first.error?.message);
  assert.equal(first.value.snapshot.lots[0].title, 'From the backup');
  assert.equal(first.value.snapshot.lots[0].revision, 5, 'past the higher of the two revisions');

  // Re-importing the same backup must still change nothing: the stamp is not a difference the
  // backup could restore, so it is neither taken nor listed.
  const again = previewImport(first.value.snapshot, incoming, 'merge');
  assert.equal(again.value.counts.updated, 0);
  assert.equal(again.value.counts.added, 0);
  assert.deepEqual(importChangeLines(again.value), []);
  assert.equal(JSON.stringify(again.value.snapshot), JSON.stringify(first.value.snapshot));
});

test('a change line names the local record and the two write times the right way round', () => {
  const desktop = createEmptySnapshot(NOW);
  desktop.lots.push(lot(uuid(1), { title: 'Desktop title', updatedAt: LATEST }));
  const laptop = createEmptySnapshot(NOW);
  laptop.lots.push(lot(uuid(1), { title: 'Laptop title', updatedAt: LATER }));

  const kept = previewImport(desktop, laptop, 'merge', { exportedAt: LATEST, now: LATEST });
  assert.equal(kept.value.counts.keptLocal, 1);
  assert.deepEqual(importChangeLines(kept.value), [
    `lots: "Desktop title" keeps the local copy (local ${LATEST}, backup ${LATER})`,
  ]);

  // The same two records the other way round: the line names the local title either way.
  const updated = previewImport(laptop, desktop, 'merge', { exportedAt: LATEST, now: LATEST });
  assert.equal(updated.value.counts.updated, 1);
  assert.deepEqual(importChangeLines(updated.value), [
    'lots: "Laptop title" (in the backup: "Desktop title") is replaced by the backup\'s copy ' +
    `(backup ${LATEST}, local ${LATER}), differing in title`,
  ]);
});

test('an updated line names at most eight of the fields that differ', () => {
  const current = createEmptySnapshot(NOW);
  current.auctionEvents.push(dateEvent(uuid(1), {
    capturedText: 'Sale notes', capturedFromUrl: 'https://house.test/local', sourceUrl: 'https://house.test/local-sale',
  }));
  const incoming = createEmptySnapshot(NOW);
  incoming.auctionEvents.push(dateEvent(uuid(1), {
    name: 'Renamed sale', eventKind: 'lot-closes', localDate: '2026-10-11', timeZone: 'Europe/Berlin',
    reminderScope: 'linked-lots', createdAt: LATER, updatedAt: LATER, capturedText: 'Other notes',
    capturedFromUrl: 'https://house.test/backup', sourceUrl: 'https://house.test/backup-sale',
  }));
  const preview = previewImport(current, incoming, 'merge', { exportedAt: LATER, now: LATEST });
  assert.equal(preview.ok, true, preview.error?.message);
  assert.deepEqual(importChangeLines(preview.value), [
    'auctionEvents: "Sale" (in the backup: "Renamed sale") is replaced by the backup\'s copy ' +
    `(backup ${LATER}, local ${NOW}), differing in name, eventKind, localDate, timeZone, ` +
    'reminderScope, createdAt, capturedText, capturedFromUrl and 1 more',
  ]);
});

test('a backup time later than the export itself is compared as the export time', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { title: 'Mine', updatedAt: LATEST }));
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(1), { title: 'Skewed', updatedAt: SKEWED }));

  const preview = previewImport(current, incoming, 'merge', { exportedAt: LATER, now: LATEST });
  assert.equal(preview.value.snapshot.lots[0].title, 'Mine', 'a skewed clock does not beat a real edit');
  assert.deepEqual(importChangeLines(preview.value), [
    `lots: "Mine" keeps the local copy (local ${LATEST}, backup ${SKEWED}); ` +
    `backup time is later than the export itself; compared as ${LATER}`,
  ]);

  // The bound settles the comparison only: a record that still wins keeps the time it claims.
  const older = createEmptySnapshot(NOW);
  older.lots.push(lot(uuid(1), { title: 'Mine', updatedAt: NOW }));
  const won = previewImport(older, incoming, 'merge', { exportedAt: LATER, now: LATEST });
  assert.equal(won.value.snapshot.lots[0].title, 'Skewed');
  assert.equal(won.value.snapshot.lots[0].updatedAt, SKEWED, 'the stored write time is not rewritten');
  assert.equal(
    importChangeLines(won.value)[0].endsWith(`; backup time is later than the export itself; compared as ${LATER}`),
    true,
  );
});

test('an export time from the future does not raise the ceiling past now', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { title: 'Mine', updatedAt: NOW }));
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(1), { title: 'Skewed', updatedAt: SKEWED }));
  const preview = previewImport(current, incoming, 'merge', { exportedAt: SKEWED, now: NOW });
  assert.equal(preview.value.snapshot.lots[0].title, 'Mine');
  assert.equal(preview.value.keptLocal[0].comparedAs, NOW);
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
    collection: 'evidence', id: incoming.evidence[0].id, title: 'House Sale 10 lot 9',
    reason: 'same-sale-collision',
  });
  assert.deepEqual(importIssueLines(preview.value), [
    'evidence: "House Sale 10 lot 9" is the same sale with different numbers, kept local',
  ]);
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
  const document = { format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: NOW, data: { ...data, schemaVersion: 0 } };
  // No migration step exists from version 0, so it still fails - but on the migrated data, not on
  // the document header.
  assert.equal(validateBackup(document).error.path, 'data.schemaVersion');
});

test('a newer backup says what to do, and a header version below one is refused outright', () => {
  const data = createEmptySnapshot(NOW);
  const document = { format: BACKUP_FORMAT, schemaVersion: 2, exportedAt: NOW, data };
  assert.equal(
    validateBackup(document).error.message,
    'This backup was made by a newer version of Giga Pinax. Update the extension, then import it again.',
  );
  assert.equal(validateBackup(document).error.path, 'schemaVersion');
  for (const version of [0, -1, 1.5, '1', undefined, null]) {
    const refused = validateBackup({ ...document, schemaVersion: version });
    assert.equal(refused.ok, false, `schemaVersion ${String(version)} must be refused`);
    assert.equal(refused.error.code, 'unsupported-schema');
    assert.equal(refused.error.path, 'schemaVersion');
    assert.equal(refused.error.message, 'Backup schema version is unsupported.');
  }
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
  assert.deepEqual(preview.value.duplicates, [
    { id: uuid(2), title: 'Nero denarius (backup)', duplicateOf: 'Nero denarius' },
  ]);
  // The line names the record that was skipped, not only the collection it came from.
  assert.deepEqual(importIssueLines(preview.value), [
    'lots: "Nero denarius (backup)" is a duplicate of "Nero denarius", skipped',
  ]);
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

test('a merge never lets two lots claim one collection entry', () => {
  const entry = (id, lotId) => ({
    id, revision: 0, dataClass: 'collector', lotId, title: 'Nero denarius',
    acquisitionDate: '2026-09-01', sourceLinks: [], createdAt: NOW, updatedAt: NOW,
  });
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { collectionEntryId: uuid(50) }));
  current.collectionEntries.push(entry(uuid(50), uuid(1)));
  // The other install gave the same entry ID to a different lot.
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(2), { collectionEntryId: uuid(50) }));
  incoming.collectionEntries.push(entry(uuid(50), uuid(2)));
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.equal(validateSnapshot(preview.value.snapshot).ok, true, 'the merged root must stay valid');
  const claimants = preview.value.snapshot.lots.filter((row) => row.collectionEntryId === uuid(50));
  assert.deepEqual(claimants.map(({ id }) => id), [uuid(1)], 'the local pairing is the one kept');
});

test('a merge takes the backup lot with its collection entry when the local lot has none', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { title: 'Nero denarius' }));
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(1), {
    title: 'Nero denarius', updatedAt: LATER, outcome: { status: 'won' },
    collectionEntryId: uuid(2),
  }));
  incoming.collectionEntries.push({
    id: uuid(2), revision: 0, dataClass: 'collector', lotId: uuid(1), title: 'Nero denarius',
    acquisitionDate: '2026-09-13', sourceLinks: [], createdAt: LATER, updatedAt: LATER,
  });
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.equal(preview.value.snapshot.lots[0].collectionEntryId, uuid(2));
  assert.equal(preview.value.snapshot.collectionEntries.length, 1);
  assert.equal(preview.value.counts.added, 1, 'the entry is added, not filtered out');
  assert.deepEqual(importIssueLines(preview.value), [], 'nothing was left behind to report');

  // Counting entries only after the filter keeps the second run's counts at zero.
  const again = previewImport(preview.value.snapshot, incoming, 'merge');
  assert.equal(again.value.counts.added, 0);
  assert.equal(again.value.counts.updated, 0);
});

test('a merge keeps the local collection entry and raises the review the store would', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { outcome: { status: 'won' }, collectionEntryId: uuid(2) }));
  current.collectionEntries.push({
    id: uuid(2), revision: 0, dataClass: 'collector', lotId: uuid(1), title: 'Nero denarius',
    acquisitionDate: '2026-09-01', sourceLinks: [], createdAt: NOW, updatedAt: NOW,
  });
  // The other install corrected the lot to lost and took its own entry away.
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(1), { outcome: { status: 'lost' }, updatedAt: LATER }));
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  const [merged] = preview.value.snapshot.lots;
  assert.equal(merged.outcome.status, 'lost');
  assert.equal(merged.collectionEntryId, uuid(2), 'the collection history stays');
  assert.equal(merged.collectionReviewReason, 'source-lot-no-longer-won');
  assert.equal(preview.value.snapshot.collectionEntries[0].reviewReason, 'source-lot-no-longer-won');

  // A second merge of the same backup has nothing left to take: what differs is the revision
  // stamp, the collection link and the review this merge itself raised.
  const again = previewImport(preview.value.snapshot, incoming, 'merge', { exportedAt: LATER, now: LATEST });
  assert.equal(again.value.counts.added, 0);
  assert.equal(again.value.counts.updated, 0);
  assert.deepEqual(importChangeLines(again.value), []);
  assert.equal(JSON.stringify(again.value.snapshot), JSON.stringify(preview.value.snapshot));
});

test('a lot the backup corrects back to won withdraws the review on its entry', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), {
    outcome: { status: 'lost' }, collectionEntryId: uuid(2),
    collectionReviewReason: 'source-lot-no-longer-won',
  }));
  current.collectionEntries.push(wonEntry(uuid(2), uuid(1), {
    revision: 1, reviewReason: 'source-lot-no-longer-won',
  }));
  // The other install settled the same lot back to won, later.
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(1), { outcome: { status: 'won' }, updatedAt: LATER }));
  const preview = previewImport(current, incoming, 'merge', { exportedAt: LATER, now: LATEST });
  assert.equal(preview.ok, true, preview.error?.message);
  const [merged] = preview.value.snapshot.lots;
  assert.equal(merged.outcome.status, 'won');
  assert.equal(merged.collectionEntryId, uuid(2), 'the collection history stays');
  assert.equal(merged.collectionReviewReason, undefined, 'a won lot carries no review');
  const [entry] = preview.value.snapshot.collectionEntries;
  assert.equal(entry.reviewReason, undefined, 'the entry follows its lot, as lot.outcome.set does');
  assert.equal(entry.revision, 2, 'a holder of the flagged entry is asked again');
});

test('a backup entry for a lot that already has one is kept local and said so', () => {
  const entry = (id, lotId, title) => ({
    id, revision: 0, dataClass: 'collector', lotId, title,
    acquisitionDate: '2026-09-01', sourceLinks: [], createdAt: NOW, updatedAt: NOW,
  });
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { outcome: { status: 'won' }, collectionEntryId: uuid(2) }));
  current.collectionEntries.push(entry(uuid(2), uuid(1), 'Nero denarius'));
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(1), { outcome: { status: 'won' }, collectionEntryId: uuid(3), updatedAt: LATER }));
  incoming.collectionEntries.push(entry(uuid(3), uuid(1), 'Nero denarius (laptop)'));
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.equal(preview.value.snapshot.lots[0].collectionEntryId, uuid(2));
  assert.deepEqual(preview.value.snapshot.collectionEntries.map(({ id }) => id), [uuid(2)]);
  assert.deepEqual(importIssueLines(preview.value), [
    'collectionEntries: "Nero denarius (laptop)" arrived for a lot that already has a collection entry here, kept local',
  ]);
  assert.equal(preview.value.counts.added, 0);
});

test('a second merge of the same backup changes nothing and reports nothing added or updated', () => {
  const observation = {
    id: uuid(60), queryId: uuid(61), source: 'manual', dataClass: 'collector', retrievedAt: NOW,
    houseSaleId: 'Sale 11', auctionHouse: 'House', auctionDate: '2026-01-02',
    lotNumber: '3', priceBasis: 'hammer', amount: { currency: 'EUR', minor: 9000 },
  };
  const evidenceRow = {
    ...deduplicateEvidence([observation]).value.evidence[0], revision: 0, createdAt: NOW, updatedAt: NOW,
  };
  const context = (lotNumber) => ({
    house: 'CNG', saleId: 'Triton XXIX', lotNumber, pageUrl: `https://house.test/lot/${lotNumber}`,
  });
  const current = createEmptySnapshot(NOW);
  current.alternativeGroups.push(group(uuid(10)));
  current.lots.push(
    lot(uuid(11), { title: 'Shared lot', alternativeGroupId: uuid(10), priority: 1 }),
    lot(uuid(12), { title: 'Nero denarius', auctionContext: context('42') }),
  );

  const incoming = createEmptySnapshot(NOW);
  incoming.alternativeGroups.push(group(uuid(10)));
  incoming.evidence.push(evidenceRow);
  incoming.lots.push(
    // updated: same ID, written later on the other install
    lot(uuid(11), { title: 'Shared lot, retoned', alternativeGroupId: uuid(10), priority: 1, updatedAt: LATER }),
    // skipped duplicate: the same auction lot under a new ID, won and in that install's collection
    lot(uuid(13), {
      title: 'Nero denarius (laptop)', auctionContext: context('42'),
      outcome: { status: 'won' }, collectionEntryId: uuid(14),
    }),
    // added
    lot(uuid(15), { title: 'Attic tetradrachm', auctionContext: context('77') }),
  );
  incoming.collectionEntries.push({
    id: uuid(14), revision: 0, dataClass: 'collector', lotId: uuid(13), title: 'Nero denarius',
    acquisitionDate: '2026-09-13', sourceLinks: [], createdAt: NOW, updatedAt: NOW,
  });

  const first = previewImport(current, incoming, 'merge');
  assert.equal(first.ok, true, first.error?.message);
  assert.equal(first.value.counts.added, 2, 'the new lot and the evidence row');
  assert.equal(first.value.counts.updated, 1);
  assert.equal(first.value.counts.skippedDuplicate, 1);

  const again = previewImport(first.value.snapshot, incoming, 'merge');
  assert.equal(again.ok, true, again.error?.message);
  assert.equal(again.value.counts.added, 0);
  assert.equal(again.value.counts.updated, 0);
  assert.equal(
    JSON.stringify(again.value.snapshot),
    JSON.stringify(first.value.snapshot),
    'the second merge leaves the snapshot byte-identical',
  );
});

test('the import summary counts every outcome the merge reached', () => {
  const preview = {
    mode: 'merge',
    counts: { outgoing: { lots: 2 }, incoming: { lots: 3 }, added: 1, updated: 1, keptLocal: 1, skippedDuplicate: 1, quarantine: 0 },
    conflicts: [{ collection: 'evidence', id: uuid(1), title: 'Sale 10', reason: 'same-sale-collision' }],
    duplicates: [{ id: uuid(2), title: 'Nero denarius (backup)', duplicateOf: 'Nero denarius' }],
  };
  const text = importCountsText(preview);
  assert.equal(text.includes('Local: 2 records. Backup: 3 records.'), true);
  assert.equal(text.includes('Adds 1'), true);
  assert.equal(text.includes('updates 1'), true);
  assert.equal(text.includes('keeps 1 local'), true);
  assert.equal(text.includes('skips 1 duplicate'), true);
  assert.deepEqual(importIssueLines(preview), [
    'lots: "Nero denarius (backup)" is a duplicate of "Nero denarius", skipped',
    'evidence: "Sale 10" is the same sale with different numbers, kept local',
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

test('the raw export copies stored data verbatim, unsaved drafts and all', () => {
  const raw = {
    schemaVersion: 1, revision: 4, lots: 'not a list',
    drafts: [{ id: uuid(1), payload: { rawText: 'RIC 306' } }],
    recentCommands: [{ requestId: 'retry-id' }],
  };
  const parsed = JSON.parse(rawExportDocument(raw, NOW));
  assert.equal(parsed.format, 'ancient-coin-auction-companion');
  assert.equal(parsed.exportedAt, NOW);
  // The rescue file is the collector's last copy of whatever storage holds: it strips nothing.
  assert.deepEqual(parsed.data, raw);
  // Nothing readable at all still produces a file rather than an error.
  assert.equal(JSON.parse(rawExportDocument(null, NOW)).data, null);
});

test('backup file names carry an instant a file system accepts', () => {
  assert.equal(backupFileName('giga-pinax-before-import', NOW), 'giga-pinax-before-import-2026-09-12T12-00-00.000Z.json');
});
