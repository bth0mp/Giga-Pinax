import test from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, SCHEMA_VERSION, createEmptySnapshot, quarantineEntryId, validateSnapshot } from '../extension/core/records.js';
import { deduplicateEvidence } from '../extension/core/evidence.js';
import {
  BACKUP_FORMAT, MAX_BACKUP_BYTES, backupFileName, exportBackup, importChangeLines,
  importCountsText, importIssueLines, previewImport, quarantineDocument, quarantineLines,
  quarantineRestoreText, quarantineRows, quarantineSummaryText, rawExportDocument, setAsideCountText, validateBackup,
  importNothingText, OWN_RECORD_FIELDS,
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
  assert.equal(document.schemaVersion, SCHEMA_VERSION);
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

test('backups load while optional presets and lot notes round-trip when present', () => {
  const old = createEmptySnapshot(NOW);
  assert.equal(validateBackup(exportBackup(old, NOW).value).ok, true);
  const current = createEmptySnapshot(NOW);
  current.preferences = {
    schemaVersion: SCHEMA_VERSION, revision: 0, currency: 'GBP', desktopAlertsEnabled: false,
    housePremiumPresets: [
      { name: 'CNG', buyerPremiumBps: 2250 },
      // A ladder is in the house's own currency, which is not the collector's default one here.
      { name: 'Nomos', buyerPremiumBps: 2000, incrementLadder: { currency: 'CHF', tiers: [{ from: 0, step: 500 }, { from: 10000, step: 1000 }] } },
    ],
    createdAt: NOW, updatedAt: NOW,
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

// N1 needs no new schema version: a won coin's cost is an optional field of its outcome. A 0.35 backup, whose won
// coins carry none, imports as it is; a backup with costs round-trips them unchanged.
test('a won coin’s cost round-trips, and a backup written before costs existed still imports', () => {
  const eur = (minor) => ({ currency: 'EUR', minor });
  const snapshot = createEmptySnapshot(NOW);
  snapshot.lots.push(lot(uuid(1), { outcome: { status: 'won', hammer: eur(130000), verification: 'personal-unverified', cost: {
    buyerPremiumBps: 2500, premium: eur(32500), premiumVat: eur(6175), platformFee: eur(0), shipping: eur(1500), paymentFee: eur(0), total: eur(170175),
  } } }));
  snapshot.lots.push(lot(uuid(2), { outcome: { status: 'won', hammer: eur(50000), verification: 'personal-unverified' } }));
  const exported = exportBackup(snapshot, NOW);
  assert.equal(exported.ok, true);
  const imported = validateBackup(exported.value);
  assert.equal(imported.ok, true, imported.error?.message);
  assert.deepEqual(imported.value.lots[0].outcome.cost, snapshot.lots[0].outcome.cost);
  assert.equal(Object.hasOwn(imported.value.lots[1].outcome, 'cost'), false, 'an older won coin is not given a cost on import');
  const replaced = previewImport(createEmptySnapshot(NOW), imported.value, 'replace');
  assert.equal(replaced.ok, true, replaced.error?.message);
});

// N12: which fields the collector corrected on a collection entry is an optional list, so it round-trips and a backup
// without it imports as before.
test('a collection entry’s own corrections round-trip in a backup', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.lots.push(lot(uuid(1), { outcome: { status: 'won' }, collectionEntryId: uuid(2) }));
  snapshot.collectionEntries.push(wonEntry(uuid(2), uuid(1), { notes: 'Cabinet 3', editedFields: ['notes'] }));
  const restored = validateBackup(exportBackup(snapshot, NOW).value);
  assert.equal(restored.ok, true, restored.error?.message);
  assert.deepEqual(restored.value.collectionEntries[0].editedFields, ['notes']);
  delete snapshot.collectionEntries[0].editedFields;
  assert.equal(validateBackup(exportBackup(snapshot, NOW).value).ok, true);
});

test('backups round-trip optional lot auction metadata', () => {
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
  assert.equal(validateBackup({ format: 'ancient-coin-auction-companion', schemaVersion: SCHEMA_VERSION + 1, exportedAt: NOW, data: {} }).error.code, 'unsupported-schema');
  assert.equal(validateBackup('x'.repeat(MAX_BACKUP_BYTES + 1)).error.code, 'file-too-large');
  const invalid = {
    format: 'ancient-coin-auction-companion', schemaVersion: SCHEMA_VERSION, exportedAt: NOW,
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
  const document = { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: NOW, data: { ...data, schemaVersion: 0 } };
  // No migration step exists from version 0, so it still fails - but on the migrated data, not on
  // the document header.
  assert.equal(validateBackup(document).error.path, 'data.schemaVersion');
});

test('a version one backup imports into this version', () => {
  const data = createEmptySnapshot(NOW);
  data.schemaVersion = 1;
  data.preferences = {
    schemaVersion: 1, revision: 2, currency: 'CHF', catalogue: 'RIC', number: '306',
    volume: 'I (2nd edition)', section: 'Nero', sampleMode: true, desktopAlertsEnabled: true,
    housePremiumPresets: [{ name: 'CNG', buyerPremiumBps: 2250 }],
    createdAt: NOW, updatedAt: NOW,
  };
  const restored = validateBackup({ format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: NOW, data });
  assert.equal(restored.ok, true, restored.error?.message);
  assert.equal(restored.value.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(restored.value.preferences, {
    schemaVersion: SCHEMA_VERSION, revision: 2, currency: 'CHF', desktopAlertsEnabled: true,
    housePremiumPresets: [{ name: 'CNG', buyerPremiumBps: 2250 }],
    createdAt: NOW, updatedAt: NOW,
  });
});

test('a newer backup says what to do, and a header version below one is refused outright', () => {
  const data = createEmptySnapshot(NOW);
  const document = { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION + 1, exportedAt: NOW, data };
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

  // The header can lag the root it carries - a file written by a build that moved the root's version
  // before its own. What the collector has is still a backup from a newer Giga Pinax, and there is
  // still one thing to do about it, so it is told the same thing rather than that its file is junk.
  const newerData = {
    format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: NOW,
    data: { ...createEmptySnapshot(NOW), schemaVersion: SCHEMA_VERSION + 1 },
  };
  assert.equal(
    validateBackup(newerData).error.message,
    'This backup was made by a newer version of Giga Pinax. Update the extension, then import it again.',
  );
  assert.equal(validateBackup(newerData).error.code, 'unsupported-schema');
});

test('merge keeps local preferences and alerts, whatever bookkeeping the backup carries', () => {
  const preferences = {
    schemaVersion: SCHEMA_VERSION, revision: 0, currency: 'GBP', desktopAlertsEnabled: false,
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

// The reconcile derives the schedule again from the merged events, so a reminder the collector had already answered on
// the other install came back due on this one: an acknowledgement is the collector's answer, not the other install's
// bookkeeping. A trigger this install already holds still keeps its own alert.
test('merge takes an answered reminder the other install carries and this one has never had', () => {
  const event = {
    id: uuid(1), revision: 0, dataClass: 'collector', name: 'Sale', eventKind: 'auction-starts',
    precision: 'timed', localDate: '2026-10-10', localTime: '12:00', timeZone: 'Europe/London',
    startsAt: '2026-10-10T11:00:00.000Z', reminderScope: 'standalone',
    reminders: [{ id: uuid(2), kind: 'offset', offsetMinutes: 60 }, { id: uuid(3), kind: 'offset', offsetMinutes: 30 }],
    createdAt: NOW, updatedAt: NOW,
  };
  const alert = (id, reminderId, triggerAt, extra = {}) => ({
    id, revision: 0, dataClass: 'collector', triggerId: `${event.id}:${reminderId}:${triggerAt}`,
    eventId: event.id, eventRevision: 0, reminderId, triggerAt, status: 'pending', createdAt: NOW, updatedAt: NOW, ...extra,
  });
  const local = alert(uuid(4), event.reminders[0].id, '2026-10-10T10:00:00.000Z');
  const current = createEmptySnapshot(NOW);
  current.auctionEvents.push(event);
  current.alerts.push(local);
  const incoming = structuredClone(current);
  incoming.alerts[0] = { ...local, id: uuid(9), status: 'acknowledged', acknowledgedAt: LATER, updatedAt: LATER };
  const answered = alert(uuid(5), event.reminders[1].id, '2026-10-10T10:30:00.000Z',
    { status: 'acknowledged', acknowledgedAt: LATER, updatedAt: LATER });
  incoming.alerts.push(answered);
  // A reminder the merge does not bring an event for has nothing to be derived from and is left alone.
  incoming.alerts.push(alert(uuid(6), uuid(7), '2026-10-10T09:00:00.000Z', { status: 'acknowledged', acknowledgedAt: LATER }));
  incoming.auctionEvents[0].reminders.push({ id: uuid(7), kind: 'offset', offsetMinutes: 120 });

  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  const alerts = preview.value.snapshot.alerts;
  assert.deepEqual(alerts.map(({ id }) => id), [local.id, answered.id]);
  assert.equal(alerts[0].status, 'pending', 'the trigger this install already holds keeps its own alert');
  assert.equal(alerts[1].status, 'acknowledged');
  assert.equal(alerts[1].triggerId, `${event.id}:${event.reminders[1].id}:2026-10-10T10:30:00.000Z`);
  assert.equal(validateSnapshot(preview.value.snapshot).ok, true);
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

// The skipped lot's auction event had merged by ID a moment before the lot was skipped, so one sale
// ended up as two events here and its reminders fired twice.
const SAME_SALE = { house: 'CNG', saleId: 'Triton XXIX', lotNumber: '42', pageUrl: 'https://house.test/lot/42' };

test('an auction event arriving only with a skipped duplicate lot is kept out and said so', () => {
  const current = createEmptySnapshot(NOW);
  current.auctionEvents.push(dateEvent(uuid(1), { name: 'Triton XXIX' }));
  current.lots.push(lot(uuid(2), { title: 'Nero denarius', auctionContext: SAME_SALE, auctionEventId: uuid(1) }));
  const incoming = createEmptySnapshot(NOW);
  incoming.auctionEvents.push(dateEvent(uuid(3), { name: 'Triton XXIX (laptop)' }));
  incoming.lots.push(lot(uuid(4), { title: 'Nero denarius (laptop)', auctionContext: SAME_SALE, auctionEventId: uuid(3) }));

  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.deepEqual(preview.value.snapshot.auctionEvents.map(({ id }) => id), [uuid(1)], 'one sale, one event');
  assert.equal(preview.value.counts.added, 0, 'and nothing of the skipped lot is counted as added');
  assert.deepEqual(importIssueLines(preview.value), [
    'lots: "Nero denarius (laptop)" is a duplicate of "Nero denarius", skipped',
    'auctionEvents: "Triton XXIX (laptop)" is the auction of a lot this merge skipped as a duplicate, kept out',
  ]);
  const again = previewImport(preview.value.snapshot, incoming, 'merge');
  assert.equal(again.ok, true, again.error?.message);
  assert.equal(JSON.stringify(again.value.snapshot), JSON.stringify(preview.value.snapshot));
});

test('a merge keeps the auction of a skipped lot when a lot it did take is attached to it', () => {
  const current = createEmptySnapshot(NOW);
  current.auctionEvents.push(dateEvent(uuid(1), { name: 'Triton XXIX' }));
  current.lots.push(lot(uuid(2), { title: 'Nero denarius', auctionContext: SAME_SALE, auctionEventId: uuid(1) }));
  const incoming = createEmptySnapshot(NOW);
  incoming.auctionEvents.push(dateEvent(uuid(3), { name: 'Triton XXIX (laptop)' }));
  incoming.lots.push(
    lot(uuid(4), { title: 'Nero denarius (laptop)', auctionContext: SAME_SALE, auctionEventId: uuid(3) }),
    lot(uuid(5), {
      title: 'Attic tetradrachm', auctionEventId: uuid(3),
      auctionContext: { ...SAME_SALE, lotNumber: '77', pageUrl: 'https://house.test/lot/77' },
    }),
  );
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.deepEqual(preview.value.snapshot.auctionEvents.map(({ id }) => id), [uuid(1), uuid(3)],
    'a lot the merge did take is attached to it, so the sale comes with it');
  assert.equal(preview.value.counts.added, 2);
});

test('a merge adopts the auction of a skipped duplicate when the local lot has none', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { title: 'Nero denarius', auctionContext: SAME_SALE }));
  const incoming = createEmptySnapshot(NOW);
  incoming.auctionEvents.push(dateEvent(uuid(2), { name: 'Triton XXIX' }));
  incoming.lots.push(lot(uuid(3), { title: 'Nero denarius (laptop)', auctionContext: SAME_SALE, auctionEventId: uuid(2) }));

  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.deepEqual(preview.value.snapshot.auctionEvents.map(({ id }) => id), [uuid(2)]);
  const [merged] = preview.value.snapshot.lots;
  assert.deepEqual([merged.id, merged.auctionEventId], [uuid(1), uuid(2)],
    'the lot that stayed is the one the sale is attached to');
  assert.equal(merged.revision, 1, 'a holder of the unlinked lot is asked again');
  assert.deepEqual(importIssueLines(preview.value), [
    'lots: "Nero denarius (laptop)" is a duplicate of "Nero denarius", skipped',
  ]);

  const again = previewImport(preview.value.snapshot, incoming, 'merge');
  assert.equal(again.ok, true, again.error?.message);
  assert.equal(again.value.counts.added, 0);
  assert.equal(JSON.stringify(again.value.snapshot), JSON.stringify(preview.value.snapshot));
});

// Taking the backup's sale for the lot that stayed is a write to that lot, so it is reported and
// stamped like any other: unlisted and unstamped, the preview said nothing, the settings page took
// no safety copy before overwriting the lot, and the row still claimed the write time it had before
// the link was put on it.
test('a lot that takes the auction of a skipped duplicate is listed, counted and stamped', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { title: 'Nero denarius', auctionContext: SAME_SALE }));
  const incoming = createEmptySnapshot(NOW);
  incoming.auctionEvents.push(dateEvent(uuid(2), { name: 'Triton XXIX' }));
  incoming.lots.push(lot(uuid(3), { title: 'Nero denarius (laptop)', auctionContext: SAME_SALE, auctionEventId: uuid(2) }));

  const preview = previewImport(current, incoming, 'merge', { exportedAt: LATER, now: LATEST });
  assert.equal(preview.ok, true, preview.error?.message);
  const [merged] = preview.value.snapshot.lots;
  assert.deepEqual([merged.id, merged.auctionEventId], [uuid(1), uuid(2)]);
  assert.equal(merged.revision, 1, 'a holder of the unlinked lot is asked again');
  assert.equal(merged.updatedAt, LATEST, 'and the row carries the time the link was written');
  assert.equal(preview.value.counts.updated, 1, 'so the settings page takes its safety copy');
  assert.deepEqual(importChangeLines(preview.value), [
    `lots: "Nero denarius" takes the auction of a duplicate this merge skipped (backup ${NOW}, local ${NOW})`,
  ]);

  // The same file merged again changes nothing: the lot is already attached.
  const again = previewImport(preview.value.snapshot, incoming, 'merge', { exportedAt: LATER, now: LATEST });
  assert.equal(again.value.counts.updated, 0);
  assert.deepEqual(importChangeLines(again.value), []);
  assert.equal(JSON.stringify(again.value.snapshot), JSON.stringify(preview.value.snapshot));
});

// An old backup re-merged used to put the sale back on a lot the collector had deliberately
// unlinked since: the link is content from before the export, and a local row written after the
// export wins over it exactly as every other record does.
test('a lot edited after the backup was exported is not attached to that backup\'s auction again', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(1), { title: 'Nero denarius', auctionContext: SAME_SALE, updatedAt: LATEST, revision: 3 }));
  const incoming = createEmptySnapshot(NOW);
  incoming.auctionEvents.push(dateEvent(uuid(2), { name: 'Triton XXIX' }));
  incoming.lots.push(lot(uuid(3), { title: 'Nero denarius (laptop)', auctionContext: SAME_SALE, auctionEventId: uuid(2) }));

  const preview = previewImport(current, incoming, 'merge', { exportedAt: LATER, now: LATEST });
  assert.equal(preview.ok, true, preview.error?.message);
  const [merged] = preview.value.snapshot.lots;
  assert.equal(Object.hasOwn(merged, 'auctionEventId'), false, 'the lot the collector unlinked stays unlinked');
  assert.deepEqual([merged.revision, merged.updatedAt], [3, LATEST], 'and is not touched at all');
  assert.equal(preview.value.counts.updated, 0);
  assert.deepEqual(preview.value.snapshot.auctionEvents, [], 'the sale nothing points at is kept out');
  assert.deepEqual(importIssueLines(preview.value), [
    'lots: "Nero denarius (laptop)" is a duplicate of "Nero denarius", skipped',
    'auctionEvents: "Triton XXIX" is the auction of a lot this merge skipped as a duplicate, kept out',
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

// A merge that cannot produce a valid root answered with the validator's own sentence - "Expected an
// array with at most 1000 entries." - which says nothing about the file the collector chose.
test('a merge that would not validate says the backup cannot be merged before the detail', () => {
  const current = createEmptySnapshot(NOW);
  const incoming = createEmptySnapshot(NOW);
  for (let index = 0; index < 600; index += 1) {
    current.alternativeGroups.push(group(uuid(index)));
    incoming.alternativeGroups.push(group(uuid(index + 1000)));
  }
  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, false);
  assert.equal(preview.error.code, 'merge-invalid');
  assert.match(preview.error.message, /^This backup cannot be merged with your local records\./);
  assert.match(preview.error.message, /at most 1000 entries/, 'the detail is kept after it');
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

// The bins were unioned by exact bytes, so the same record set aside on both installs - at the
// moment each of them repaired it - arrived as two entries with two Restore buttons, although the
// folding the repair does would have made them one. The merge folds the way the repair does.
test('merge folds one record set aside on both installs into a single entry', () => {
  const record = { id: 'broken', title: 'Nero denarius' };
  const reference = { collection: 'lots', id: 'host', field: 'auctionEventId', value: 'broken' };
  const current = createEmptySnapshot(NOW);
  current.quarantine = [{ collection: 'lots', record, reason: 'invalid-enum', quarantinedAt: LATER }];
  const incoming = createEmptySnapshot(NOW);
  incoming.quarantine = [{
    collection: 'lots', record: structuredClone(record), reason: 'invalid-enum', quarantinedAt: NOW,
    clearedReferences: [reference],
  }];

  const preview = previewImport(current, incoming, 'merge');
  assert.equal(preview.ok, true, preview.error?.message);
  assert.deepEqual(preview.value.snapshot.quarantine, [{
    collection: 'lots', record, reason: 'invalid-enum', quarantinedAt: NOW, clearedReferences: [reference],
  }], 'one entry, set aside when it first was, carrying every link either install recorded');
  assert.equal(preview.value.counts.quarantine, 0, 'and nothing was gained by the merge');
  assert.deepEqual(current.quarantine,
    [{ collection: 'lots', record, reason: 'invalid-enum', quarantinedAt: LATER }],
    'the preview leaves local data exactly as it found it');
  assert.equal(quarantineRows(preview.value.snapshot.quarantine).length, 1, 'so Settings offers one Restore');
});

// Folding compared every entry under one key with every other, and every link with every link already
// held: a crafted bin of 20,000 bodies under one ID took a minute to preview and over two in the
// worker, holding the one command queue all that time. The reviewer's shapes, at their largest.
const binDocument = (quarantine) => JSON.stringify({
  format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: NOW,
  data: { ...createEmptySnapshot(NOW), quarantine },
});
const manyBodies = (count) => Array.from({ length: count }, (_, index) => ({
  collection: 'lots', reason: 'invalid-record', quarantinedAt: NOW, record: { id: 'x', n: index },
}));

test('a crafted set-aside list is folded in linear time', () => {
  const links = Array.from({ length: LIMITS.clearedReferences }, (_, index) => ({
    collection: 'lots', id: 'l', field: 'auctionEventId', value: `v-${index}`,
  }));
  const linked = [0, 1].map(() => ({
    collection: 'auctionEvents', reason: 'missing-record', quarantinedAt: NOW, record: { id: 'e' },
    clearedReferences: structuredClone(links),
  }));
  for (const [label, quarantine, kept] of [['bodies', manyBodies(20000), 20000], ['links', linked, 1]]) {
    const started = performance.now();
    const validated = validateBackup(binDocument(quarantine));
    assert.equal(validated.ok, true, validated.error?.message);
    const preview = previewImport(createEmptySnapshot(NOW), validated.value, 'merge');
    const elapsed = performance.now() - started;
    assert.equal(preview.ok, true, preview.error?.message);
    assert.equal(preview.value.snapshot.quarantine.length, kept, label);
    assert.ok(elapsed < 2000, `${label}: read and previewed in ${Math.round(elapsed)} ms`);
  }
});

test('a backup listing more set-aside records than any store holds is refused before anything is folded', () => {
  const refused = validateBackup(binDocument(manyBodies(LIMITS.quarantine + 1)));
  assert.equal(refused.ok, false);
  assert.equal(refused.error.path, 'data.quarantine');
  assert.match(refused.error.message, /more than 30,000 set-aside records/);
  assert.equal(validateBackup(binDocument(manyBodies(LIMITS.quarantine))).ok, true, 'the cap itself imports');
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
    'Coin: ID is not a valid link (set aside 2026-09-12)',
    'A missing auction other records pointed to (set aside 2026-09-13), 2 links cleared',
  ]);
  const document = JSON.parse(quarantineDocument(entries, NOW));
  assert.equal(document.exportedAt, NOW);
  assert.deepEqual(document.quarantine, entries);
});

// The page draws one row per entry and the button on it names the entry the store will look for, so
// the identifier and the sentence the reply becomes are worked out here rather than in the page.
test('each set-aside row carries the line, the entry it names, and whether there is a record to put back', () => {
  const entries = [
    { collection: 'lots', record: { id: uuid(1) }, reason: 'invalid-enum', quarantinedAt: NOW },
    { collection: 'auctionEvents', record: null, reason: 'missing-record', quarantinedAt: LATER },
  ];
  const rows = quarantineRows(entries);
  assert.deepEqual(rows.map(({ line }) => line), quarantineLines(entries));
  assert.deepEqual(rows.map(({ restorable }) => restorable), [true, false],
    'an entry that carries only cleared links has no record to put back');
  assert.deepEqual(rows.map(({ id }) => id), entries.map((entry) => quarantineEntryId(entry)));
  assert.equal(new Set(rows.map(({ id }) => id)).size, 2);
  assert.deepEqual(quarantineRows(null), []);
});

// X-03: a set-aside coin is named, and what is wrong with it is said in plain words, with what can be done about it.
const damagedLot = (extra = {}) => ({
  id: uuid(9), revision: 0, dataClass: 'collector', title: 'Philip I · Antoninianus · Rome', reference: 'RIC IV Philip I 27b',
  sourceLinks: [], bidHistory: [], outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW, ...extra,
});
test('X-03: a set-aside coin is named with the field that stops it, in plain words', () => {
  const title = { collection: 'lots', record: damagedLot({ title: 42 }), reason: 'invalid-string', quarantinedAt: NOW };
  const notes = { collection: 'lots', record: damagedLot({ notes: 7 }), reason: 'invalid-string', quarantinedAt: NOW };
  const kept = { collection: 'lots', record: damagedLot(), reason: 'duplicate-id', quarantinedAt: NOW };
  assert.deepEqual(quarantineLines([title, notes, kept]), [
    'Coin “RIC IV Philip I 27b”: title is not text of up to 300 characters (set aside 2026-09-12)',
    'Coin “Philip I · Antoninianus · Rome”: notes are not text of up to 5000 characters (set aside 2026-09-12)',
    'Coin “Philip I · Antoninianus · Rome”: another record has the same ID (set aside 2026-09-12)',
  ]);
  const [titleRow, notesRow, keptRow] = quarantineRows([title, notes, kept]);
  assert.deepEqual(titleRow.problem, {
    noun: 'coin', label: 'RIC IV Philip I 27b', problem: 'title is not text of up to 300 characters', valid: false,
    problems: [{ field: 'title', fieldLabel: 'title', problem: 'title is not text of up to 300 characters', clearable: false, editable: true, current: '42' }],
  });
  assert.equal(notesRow.problem.problems[0].clearable, true, 'notes are optional, so the coin goes back without them');
  assert.equal(keptRow.problem.valid, true);
  assert.equal(setAsideCountText([title, notes, kept]), '3 coins set aside');
  assert.equal(setAsideCountText([title]), '1 coin set aside');
  assert.equal(setAsideCountText([title, { collection: 'wants', record: { id: 'x' }, reason: 'invalid-record', quarantinedAt: NOW }]), '2 records set aside');
  assert.equal(setAsideCountText([{ collection: 'auctionEvents', record: null, reason: 'missing-record', quarantinedAt: NOW }]), '', 'a note of cleared links is no record');
  assert.equal(setAsideCountText(undefined), '');
});

// Review Minor 5: a whole list the repair set aside is said as a list, offers no field to correct and no Restore, and
// can still be removed; null read as "a missing coin other records pointed to", and {} offered its ID to correct.
test('a whole list set aside reads as that list, and offers Remove alone', () => {
  const lists = [
    { collection: 'lots', record: null, reason: 'unreadable-list', quarantinedAt: NOW },
    { collection: 'lots', record: {}, reason: 'unreadable-list', quarantinedAt: NOW },
    { collection: 'wants', record: 'x', reason: 'unreadable-list', quarantinedAt: NOW },
  ];
  assert.deepEqual(quarantineLines(lists), [
    'The coin list could not be read (set aside 2026-09-12)',
    'The coin list could not be read (set aside 2026-09-12)',
    'The want list could not be read (set aside 2026-09-12)',
  ]);
  assert.deepEqual(quarantineRows(lists).map(({ restorable, removable, noun, problem }) => [restorable, removable, noun, problem]), [
    [false, true, 'coin list', null], [false, true, 'coin list', null], [false, true, 'want list', null],
  ]);
  assert.equal(setAsideCountText(lists.slice(0, 1)), '1 coin list set aside');
  assert.equal(setAsideCountText(lists), '3 lists set aside');
  const coin = { collection: 'lots', record: damagedLot({ title: 42 }), reason: 'invalid-string', quarantinedAt: NOW };
  assert.equal(setAsideCountText([coin, lists[2]]), '2 records set aside');
  // A single record that is an empty object still names its fields, and never offers its ID.
  const empty = quarantineRows([{ collection: 'lots', record: {}, reason: 'invalid-record', quarantinedAt: NOW }])[0];
  assert.equal(empty.restorable, true);
  assert.equal(empty.problem.problems.some(({ field, editable, clearable }) => OWN_RECORD_FIELDS.includes(field) && (editable || clearable)), false);
});

test('settings set aside whole, or an unreadable entry of the list itself, offer no Restore', () => {
  const rows = quarantineRows([
    { collection: 'preferences', record: { currency: 'JPY' }, reason: 'invalid-enum', quarantinedAt: NOW },
    { collection: 'quarantine', record: { broken: true }, reason: 'invalid-entry', quarantinedAt: NOW },
  ]);
  assert.deepEqual(rows.map(({ restorable }) => restorable), [false, false]);
});

test('a restore reply reads as a sentence naming what went back and what was left alone', () => {
  const put = { collection: 'auctionEvents', id: uuid(1), restoredReferences: [], keptReferences: [] };
  assert.equal(quarantineRestoreText(put), 'The record was put back into auctionEvents.');
  assert.equal(
    quarantineRestoreText({ ...put, restoredReferences: [{ collection: 'lots', id: uuid(2), field: 'auctionEventId' }] }),
    'The record was put back into auctionEvents. 1 link was restored with it.',
  );
  assert.equal(
    quarantineRestoreText({
      ...put,
      restoredReferences: [{ collection: 'lots', id: uuid(2), field: 'auctionEventId' }],
      keptReferences: [
        { collection: 'lots', id: uuid(3), field: 'alternativeGroupId' },
        { collection: 'lots', id: uuid(4), field: 'priority' },
      ],
    }),
    'The record was put back into auctionEvents. 1 link was restored with it. 2 links could not be ' +
    'put back, because what they point from has changed since: lots.alternativeGroupId, lots.priority.',
  );
});

test('the raw export copies stored data verbatim, unsaved drafts and all', () => {
  const raw = {
    schemaVersion: SCHEMA_VERSION, revision: 4, lots: 'not a list',
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

test('a raw rescue file is refused as a backup and says which file to use instead', () => {
  const refusal = 'This is a raw rescue file, not a backup. Use Export backup to make a file that can be imported.';
  const marked = validateBackup(rawExportDocument(createEmptySnapshot(NOW), NOW));
  assert.equal(marked.ok, false);
  assert.equal(marked.error.message, refusal);

  // A rescue file taken before the marker existed still carries the request ledger a backup never
  // has, so it is recognised by that too.
  const older = JSON.parse(rawExportDocument({
    ...createEmptySnapshot(NOW), recentCommands: [{ requestId: 'retry-id' }],
  }, NOW));
  delete older.kind;
  const ledger = validateBackup(older);
  assert.equal(ledger.ok, false);
  assert.equal(ledger.error.message, refusal);

  // A backup this build wrote is still a backup.
  assert.equal(validateBackup(exportBackup(createEmptySnapshot(NOW), NOW).value).ok, true);
});

test('backup file names carry an instant a file system accepts', () => {
  assert.equal(backupFileName('giga-pinax-before-import', NOW), 'giga-pinax-before-import-2026-09-12T12-00-00.000Z.json');
});

// v0.32.1 still exported from a root locked at 2^53-1. The root's revision is discarded on import, so it is no
// evidence of a crafted file; a record's revision above the usable ceiling still is.
test('a backup whose root revision is 2^53-1 validates, while a record revision above the usable ceiling does not', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.revision = Number.MAX_SAFE_INTEGER;
  snapshot.lots.push(lot(uuid(1), { title: 'Nero' }));
  const document = exportBackup(snapshot, NOW);
  assert.equal(document.ok, true);
  const valid = validateBackup(document.value);
  assert.equal(valid.ok, true, valid.error?.message);
  assert.equal(valid.value.lots.length, 1);
  snapshot.lots[0].revision = LIMITS.usableRevision + 1;
  const refused = validateBackup(exportBackup(snapshot, NOW).value);
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /crafted or corrupt/);
  assert.equal(refused.error.path, 'data.lots');
});

// Settings set aside whole cannot be restored, and what the collector stands to lose there is their house presets:
// Data health names them, counts them and says how to keep them, rather than calling them one unreadable record.
test('settings set aside whole are named with their house presets and how to keep them', () => {
  const presets = [{ name: 'CNG', buyerPremiumBps: 2000 }, { name: 'NAC', buyerPremiumBps: 2250 }, { name: 'Roma', buyerPremiumBps: 2000 }];
  const settings = {
    collection: 'preferences', reason: 'invalid-ladder', quarantinedAt: NOW,
    record: { currency: 'USD', housePremiumPresets: presets },
  };
  assert.equal(quarantineSummaryText([settings]),
    'Your settings could not be read and were set aside, with 3 house presets. ' +
    'Download set-aside records to keep them, then enter them again under House premiums.');
  assert.deepEqual(quarantineLines([settings]), ['settings with 3 house presets: invalid-ladder (2026-09-12)']);
  const one = { ...settings, record: { housePremiumPresets: presets.slice(0, 1) } };
  assert.deepEqual(quarantineLines([one]), ['settings with 1 house preset: invalid-ladder (2026-09-12)']);
  const lot = { collection: 'lots', record: { id: 'broken' }, reason: 'invalid-enum', quarantinedAt: NOW };
  assert.equal(quarantineSummaryText([lot, one]),
    '1 record could not be read and was set aside. Your settings could not be read and were set aside, with 1 house preset. ' +
    'Download set-aside records to keep it, then enter it again under House premiums.');
  const none = { ...settings, record: 'not an object' };
  assert.equal(quarantineSummaryText([none]), 'Your settings could not be read and were set aside. They held no house presets.');
  assert.deepEqual(quarantineLines([none]), ['settings with no house presets: invalid-ladder (2026-09-12)']);
});

// Fix round, Important 2: a merge that takes a corrected won lot while the local entry row wins on its write time
// still brings the entry's hammer and invoice in step with that lot.
test('a merge that corrects a won lot carries its hammer to the local entry that wins', () => {
  const eur = (minor) => ({ currency: 'EUR', minor });
  const local = createEmptySnapshot(NOW);
  local.lots.push(lot(uuid(1), { outcome: { status: 'won', hammer: eur(130000), verification: 'personal-unverified' }, collectionEntryId: uuid(2) }));
  local.collectionEntries.push(wonEntry(uuid(2), uuid(1), { hammer: eur(130000), notes: 'mine' }));
  const other = structuredClone(local);
  other.lots[0].outcome = { status: 'won', hammer: eur(131000), actualInvoice: eur(160000), verification: 'personal-unverified', correctedAt: LATER };
  other.lots[0].updatedAt = LATER;
  other.lots[0].revision = 1;
  const incoming = validateBackup(exportBackup(other, LATEST).value);
  assert.equal(incoming.ok, true, incoming.error?.message);
  const merged = previewImport(local, incoming.value, 'merge', { now: LATEST });
  assert.equal(merged.ok, true, merged.error?.message);
  const [entry] = merged.value.snapshot.collectionEntries;
  assert.deepEqual(entry.hammer, eur(131000));
  assert.deepEqual(entry.actualInvoice, eur(160000));
  assert.equal(entry.notes, 'mine');
  assert.equal(entry.revision, 1, 'a holder of the old row is asked again');
});

// X-13: whether an import would do anything at all is known at the preview (whether it fits is the store's backup.check).
test('X-13: a merge preview says when nothing would change', () => {
  const current = createEmptySnapshot(NOW);
  current.lots.push(damagedLot());
  const same = previewImport(current, validateBackup(exportBackup(current, NOW).value).value, 'merge');
  assert.equal(importNothingText(same.value), 'Nothing to import: every record in this backup is already here, unchanged.');

  const newer = structuredClone(current);
  newer.lots[0] = { ...newer.lots[0], title: 'Renamed', updatedAt: LATER };
  const older = previewImport(newer, validateBackup(exportBackup(current, NOW).value).value, 'merge');
  assert.equal(importNothingText(older.value), 'Nothing to import: every record in this backup is already here, and your own copies are kept.');
  const replace = previewImport(current, validateBackup(exportBackup(current, NOW).value).value, 'replace');
  assert.equal(importNothingText(replace.value), '', 'a Replace always does something');
});

// Review Important 2 and Minor 5: every bad field is named at once, and only corrections a restore accepts are offered.
test('X-03: a set-aside coin with two bad fields names both, and never offers its ID or revision to edit', () => {
  const two = { collection: 'lots', record: damagedLot({ title: 42, lotNumber: 9 }), reason: 'invalid-string', quarantinedAt: NOW };
  assert.deepEqual(quarantineLines([two]), [
    'Coin “RIC IV Philip I 27b”: title is not text of up to 300 characters; lot number is not text of up to 120 characters (set aside 2026-09-12)',
  ]);
  const { problems } = quarantineRows([two])[0].problem;
  assert.deepEqual(problems.map(({ field, editable, clearable, current }) => [field, editable, clearable, current]), [
    ['title', true, false, '42'], ['lotNumber', true, true, '9'],
  ]);
  const badId = { collection: 'lots', record: damagedLot({ id: 'not-a-uuid' }), reason: 'invalid-id', quarantinedAt: NOW };
  assert.deepEqual(quarantineRows([badId])[0].problem.problems.map(({ field, editable, clearable }) => [field, editable, clearable]), [['id', false, false]]);
});
