import test from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, SCHEMA_VERSION, createEmptySnapshot, quarantineEntryId } from '../extension/core/records.js';
import { BACKUP_FORMAT, exportBackup, quarantineRestoreText, quarantineRows } from '../extension/core/backup.js';
import { deduplicateEvidence } from '../extension/core/evidence.js';
import { MAX_ROOT_BYTES, STORAGE_KEY, applyCommand, createCommandWriter } from '../extension/store.js';

const NOW = '2026-09-12T12:00:00.000Z';
const LATER = '2026-09-13T12:00:00.000Z';
const LATEST = '2026-09-14T12:00:00.000Z';
let nextId = 1;
const uuid = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
const context = () => ({ now: () => NOW, newId: uuid });

function command(type, fields = {}) {
  return { type, requestId: uuid(), ...fields };
}

function reduce(snapshot, input, ctx = context()) {
  const result = applyCommand(snapshot, input, ctx);
  assert.equal(result.ok, true, result.error?.message);
  return result.value;
}

function memoryStorage(initial = null, options = {}) {
  let value = initial === null ? null : structuredClone(initial);
  return {
    async get(key) {
      if (options.readFails) throw new Error('read failed');
      if (options.verifyFails && options.setCalled) throw new Error('verify failed');
      return value === null ? {} : { [key]: structuredClone(value) };
    },
    async set(items) {
      options.setCalled = true;
      if (options.setFails) throw new Error('set failed');
      value = structuredClone(items[STORAGE_KEY]);
      if (options.mismatch) value.revision += 1;
    },
    read: () => structuredClone(value),
  };
}

test.beforeEach(() => { nextId = 1; });

test('creates, updates, and deletes a lot with authority-owned metadata and revisions', () => {
  const empty = createEmptySnapshot(NOW);
  const created = reduce(empty, command('lot.save', {
    expectedRevision: null,
    lot: { title: 'Athens owl', sourceLinks: [] },
  }));
  assert.equal(created.snapshot.revision, 1);
  assert.equal(created.value.revision, 0);
  assert.equal(created.value.dataClass, 'collector');
  assert.match(created.value.id, /^[0-9a-f-]{36}$/);

  const updated = reduce(created.snapshot, command('lot.save', {
    expectedRevision: 0,
    lot: { id: created.value.id, title: 'Athens tetradrachm', sourceLinks: [] },
  }));
  assert.equal(updated.value.revision, 1);
  assert.equal(updated.snapshot.revision, 2);

  const stale = applyCommand(updated.snapshot, command('lot.delete', {
    lotId: updated.value.id,
    expectedRevision: 0,
  }), context());
  assert.equal(stale.error.code, 'conflict');
  assert.equal(updated.snapshot.lots.length, 1);

  const deleted = reduce(updated.snapshot, command('lot.delete', {
    lotId: updated.value.id,
    expectedRevision: 1,
  }));
  assert.equal(deleted.snapshot.lots.length, 0);
});

test('lot deletion cannot discard a binding bid declaration', () => {
  let state = reduce(createEmptySnapshot(NOW), command('lot.save', {
    expectedRevision: null, lot: { title: 'Bid lot', sourceLinks: [] },
  }));
  state = reduce(state.snapshot, command('bid.place', {
    lotId: state.value.id, expectedRevision: 0,
    activeBid: { amount: { currency: 'GBP', minor: 1000 } },
  }));
  const result = applyCommand(state.snapshot, command('lot.delete', {
    lotId: state.value.id, expectedRevision: 1,
  }), context());
  assert.equal(result.error.code, 'validation');
});

test('bid plan and place atomically persist a matching calculator cost estimate', () => {
  const created = reduce(createEmptySnapshot(NOW), command('lot.save', { expectedRevision: null, lot: { title: 'Fee lot', sourceLinks: [] } }));
  const estimate = { currency: 'GBP', shippingMinor: 500, paymentFeeBps: 300, paymentFeeMinor: 20, incrementMinor: 1000, minimumBidMinor: 2000 };
  const planned = reduce(created.snapshot, command('bid.plan', { lotId: created.value.id, expectedRevision: 0, plannedBid: { amount: { currency: 'GBP', minor: 10000 } }, costEstimate: estimate }));
  assert.deepEqual(planned.value.costEstimate, estimate);
  const placed = reduce(planned.snapshot, command('bid.place', { lotId: created.value.id, expectedRevision: 1, activeBid: { amount: { currency: 'GBP', minor: 12000 } }, costEstimate: { ...estimate, shippingMinor: 750 } }));
  assert.equal(placed.value.costEstimate.shippingMinor, 750);
});

test('bid commands preserve an omitted estimate and reject a supplied estimate in another currency', () => {
  const estimate = { currency: 'GBP', shippingMinor: 500, paymentFeeBps: 300, paymentFeeMinor: 20, incrementMinor: 1000, minimumBidMinor: 2000 };
  const created = reduce(createEmptySnapshot(NOW), command('lot.save', { expectedRevision: null, lot: { title: 'Fee lot', sourceLinks: [], costEstimate: estimate } }));
  const preserved = reduce(created.snapshot, command('bid.plan', { lotId: created.value.id, expectedRevision: 0, plannedBid: { amount: { currency: 'GBP', minor: 10000 } } }));
  assert.deepEqual(preserved.value.costEstimate, estimate);
  const mismatched = applyCommand(preserved.snapshot, command('bid.place', { lotId: created.value.id, expectedRevision: 1, activeBid: { amount: { currency: 'EUR', minor: 12000 } }, costEstimate: estimate }), context());
  assert.equal(mismatched.error.code, 'validation');
  assert.equal(mismatched.error.path, 'costEstimate.currency');
});

test('keeps group order compact and records planned, placed, revised, and cancelled bids', () => {
  let state = createEmptySnapshot(NOW);
  const group = reduce(state, command('group.save', { expectedRevision: null, group: { name: 'One owl' } }));
  state = group.snapshot;
  const first = reduce(state, command('lot.save', { expectedRevision: null, lot: { title: 'A', sourceLinks: [] } }));
  state = first.snapshot;
  const second = reduce(state, command('lot.save', { expectedRevision: null, lot: { title: 'B', sourceLinks: [] } }));
  state = second.snapshot;
  const ordered = reduce(state, command('group.reorder', {
    groupId: group.value.id,
    expectedRevision: 0,
    orderedLotIds: [second.value.id, first.value.id],
    expectedGroupRevisions: { [group.value.id]: 0 },
    expectedLotRevisions: { [first.value.id]: 0, [second.value.id]: 0 },
  }));
  assert.deepEqual(ordered.snapshot.lots.map((lot) => lot.priority), [2, 1]);
  assert.equal(ordered.snapshot.alternativeGroups[0].revision, 1);

  const planned = reduce(ordered.snapshot, command('bid.plan', {
    lotId: first.value.id,
    expectedRevision: 1,
    plannedBid: { amount: { currency: 'USD', minor: 10000 }, buyerPremiumBps: 2500 },
  }));
  const placed = reduce(planned.snapshot, command('bid.place', {
    lotId: first.value.id,
    expectedRevision: 2,
    activeBid: { amount: { currency: 'USD', minor: 9000 } },
  }));
  const revised = reduce(placed.snapshot, command('bid.place', {
    lotId: first.value.id,
    expectedRevision: 3,
    activeBid: { amount: { currency: 'USD', minor: 9500 }, buyerPremiumBps: 2000 },
  }));
  const cancelled = reduce(revised.snapshot, command('bid.cancel', {
    lotId: first.value.id,
    expectedRevision: 4,
  }));
  const cleared = reduce(cancelled.snapshot, command('bid.plan', {
    lotId: first.value.id,
    expectedRevision: 5,
    plannedBid: null,
  }));
  const lot = cleared.value;
  assert.equal('activeBid' in lot, false);
  assert.deepEqual(lot.bidHistory.map(({ action }) => action), [
    'planned-revised', 'placed', 'active-revised', 'externally-cancelled', 'planned-cleared',
  ]);
});

test('moving a lot between groups revises both groups so stale source reorders conflict', () => {
  let state = createEmptySnapshot(NOW);
  const a = reduce(state, command('group.save', { expectedRevision: null, group: { name: 'A' } }));
  state = a.snapshot;
  const b = reduce(state, command('group.save', { expectedRevision: null, group: { name: 'B' } }));
  state = b.snapshot;
  const lot = reduce(state, command('lot.save', { expectedRevision: null, lot: { title: 'Coin', sourceLinks: [] } }));
  state = reduce(lot.snapshot, command('group.reorder', {
    groupId: a.value.id, expectedRevision: 0, orderedLotIds: [lot.value.id],
    expectedGroupRevisions: { [a.value.id]: 0 }, expectedLotRevisions: { [lot.value.id]: 0 },
  })).snapshot;
  const moved = reduce(state, command('group.reorder', {
    groupId: b.value.id, expectedRevision: 0, orderedLotIds: [lot.value.id],
    expectedGroupRevisions: { [a.value.id]: 1, [b.value.id]: 0 },
    expectedLotRevisions: { [lot.value.id]: 1 },
  }));
  assert.equal(moved.snapshot.alternativeGroups.find(({ id }) => id === a.value.id).revision, 2);
  const stale = applyCommand(moved.snapshot, command('group.reorder', {
    groupId: a.value.id, expectedRevision: 1, orderedLotIds: [lot.value.id],
    expectedGroupRevisions: { [a.value.id]: 1, [b.value.id]: 0 },
    expectedLotRevisions: { [lot.value.id]: 1 },
  }), context());
  assert.equal(stale.error.code, 'conflict');
});

test('priority compaction revises every changed remaining lot and its group', () => {
  let state = createEmptySnapshot(NOW);
  const group = reduce(state, command('group.save', { expectedRevision: null, group: { name: 'A' } }));
  const first = reduce(group.snapshot, command('lot.save', { expectedRevision: null, lot: { title: 'First', sourceLinks: [] } }));
  const second = reduce(first.snapshot, command('lot.save', { expectedRevision: null, lot: { title: 'Second', sourceLinks: [] } }));
  state = reduce(second.snapshot, command('group.reorder', {
    groupId: group.value.id, expectedRevision: 0,
    orderedLotIds: [first.value.id, second.value.id],
    expectedGroupRevisions: { [group.value.id]: 0 },
    expectedLotRevisions: { [first.value.id]: 0, [second.value.id]: 0 },
  })).snapshot;
  const removed = reduce(state, command('lot.delete', { lotId: first.value.id, expectedRevision: 1 }));
  const remaining = removed.snapshot.lots[0];
  assert.equal(remaining.priority, 1);
  assert.equal(remaining.revision, 2);
  assert.equal(removed.snapshot.alternativeGroups[0].revision, 2);
});

test('cross-group moves require revisions for source siblings changed by compaction', () => {
  let state = createEmptySnapshot(NOW);
  const a = reduce(state, command('group.save', { expectedRevision: null, group: { name: 'A' } }));
  const b = reduce(a.snapshot, command('group.save', { expectedRevision: null, group: { name: 'B' } }));
  const moving = reduce(b.snapshot, command('lot.save', { expectedRevision: null, lot: { title: 'Move', sourceLinks: [] } }));
  const staying = reduce(moving.snapshot, command('lot.save', { expectedRevision: null, lot: { title: 'Stay', sourceLinks: [] } }));
  state = reduce(staying.snapshot, command('group.reorder', {
    groupId: a.value.id, expectedRevision: 0, orderedLotIds: [moving.value.id, staying.value.id],
    expectedGroupRevisions: { [a.value.id]: 0 },
    expectedLotRevisions: { [moving.value.id]: 0, [staying.value.id]: 0 },
  })).snapshot;
  const missingSibling = applyCommand(state, command('group.reorder', {
    groupId: b.value.id, expectedRevision: 0, orderedLotIds: [moving.value.id],
    expectedGroupRevisions: { [a.value.id]: 1, [b.value.id]: 0 },
    expectedLotRevisions: { [moving.value.id]: 1 },
  }), context());
  assert.equal(missingSibling.error.code, 'conflict');
});

test('sets an outcome and atomically creates reciprocal collection history', () => {
  const created = reduce(createEmptySnapshot(NOW), command('lot.save', {
    expectedRevision: null,
    lot: { title: 'Won coin', sourceLinks: [{ source: 'manual', url: 'https://example.test/lot' }] },
  }));
  const won = reduce(created.snapshot, command('lot.outcome.set', {
    lotId: created.value.id,
    expectedRevision: 0,
    outcome: { status: 'won', hammer: { currency: 'EUR', minor: 12000 } },
    addToCollection: {
      title: 'Won coin', acquisitionDate: '2026-09-12',
      sourceLinks: [{ source: 'manual', url: 'https://example.test/lot' }],
    },
  }));
  assert.equal(won.snapshot.collectionEntries.length, 1);
  assert.equal(won.value.collectionEntryId, won.snapshot.collectionEntries[0].id);
  assert.equal(won.snapshot.collectionEntries[0].lotId, won.value.id);
});

test('correcting a lot back to won answers the collection review the mistake raised', () => {
  const created = reduce(createEmptySnapshot(NOW), command('lot.save', {
    expectedRevision: null, lot: { title: 'Won coin', sourceLinks: [] },
  }));
  const won = reduce(created.snapshot, command('lot.outcome.set', {
    lotId: created.value.id, expectedRevision: 0, outcome: { status: 'won' },
    addToCollection: { title: 'Won coin', acquisitionDate: '2026-09-12', sourceLinks: [] },
  }));
  const lost = reduce(won.snapshot, command('lot.outcome.set', {
    lotId: created.value.id, expectedRevision: 1, outcome: { status: 'lost' },
  }));
  assert.equal(lost.value.collectionReviewReason, 'source-lot-no-longer-won');
  assert.equal(lost.snapshot.collectionEntries[0].reviewReason, 'source-lot-no-longer-won');

  const corrected = reduce(lost.snapshot, command('lot.outcome.set', {
    lotId: created.value.id, expectedRevision: 2, outcome: { status: 'won' },
  }));
  assert.equal(Object.hasOwn(corrected.value, 'collectionReviewReason'), false);
  assert.equal(Object.hasOwn(corrected.snapshot.collectionEntries[0], 'reviewReason'), false);
  assert.equal(corrected.snapshot.collectionEntries[0].revision, 2);
  assert.equal(corrected.value.collectionEntryId, corrected.snapshot.collectionEntries[0].id);
});

test('event save derives timed UTC instant and reminder IDs in the authority', () => {
  const saved = reduce(createEmptySnapshot(NOW), command('event.save', {
    expectedRevision: null,
    event: {
      name: 'London sale', eventKind: 'auction-starts', precision: 'timed',
      localDate: '2026-02-10', localTime: '10:30', timeZone: 'Europe/London',
      reminderScope: 'standalone', reminders: [{ kind: 'offset', offsetMinutes: 60 }],
    },
  }));
  assert.equal(saved.value.startsAt, '2026-02-10T10:30:00.000Z');
  assert.match(saved.value.reminders[0].id, /^[0-9a-f-]{36}$/);

  const invalid = applyCommand(saved.snapshot, command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Gap', eventKind: 'auction-starts', precision: 'timed',
      localDate: '2026-03-29', localTime: '01:30', timeZone: 'Europe/London',
      reminderScope: 'standalone', reminders: [],
    },
  }), context());
  assert.equal(invalid.error.code, 'validation');
});

test('event save rejects a reminder whose wall time does not exist in the confirmed zone', () => {
  const result = applyCommand(createEmptySnapshot(NOW), command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Spring forward', eventKind: 'auction-day', precision: 'date-only',
      localDate: '2026-03-29', timeZone: 'Europe/London', reminderScope: 'standalone',
      reminders: [{ kind: 'wall-time', daysBefore: 0, localTime: '01:30' }],
    },
  }), context());
  assert.equal(result.ok, false);
  assert.equal(result.error.path, 'event.reminders[0].localTime');
});

// A reminder that far before its event has no date to resolve at all: it must be refused as an out-of-bound day count, not shift the calendar past
// the range a Date can hold and crash the writer.
test('event save refuses an absurd daysBefore as an ordinary validation failure', () => {
  for (const daysBefore of [1e9, 366, -1e9, Number.MAX_SAFE_INTEGER]) {
    const result = applyCommand(createEmptySnapshot(NOW), command('event.save', {
      expectedRevision: null,
      event: {
        name: 'Far off', eventKind: 'auction-day', precision: 'date-only',
        localDate: '2026-02-10', timeZone: 'Europe/London', reminderScope: 'standalone',
        reminders: [{ kind: 'wall-time', daysBefore, localTime: '09:00' }],
      },
    }), context());
    assert.equal(result.ok, false, String(daysBefore));
    assert.equal(result.error.code, 'validation', String(daysBefore));
  }
});

test('a stored event whose start instant drifted from its local fields still loads', async () => {
  const stored = createEmptySnapshot(NOW);
  stored.auctionEvents.push({
    id: uuid(), revision: 0, dataClass: 'collector', name: 'Shifted sale',
    eventKind: 'auction-starts', precision: 'timed', localDate: '2026-10-10', localTime: '12:00',
    timeZone: 'Europe/London', startsAt: '2026-10-10T12:00:00.000Z', reminderScope: 'standalone',
    reminders: [{ id: uuid(), kind: 'offset', offsetMinutes: 60 }],
    createdAt: NOW, updatedAt: NOW,
  });
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());
  const reply = await writer.commitCommand(command('snapshot.get'));
  assert.equal(reply.ok, true);
  assert.equal(reply.value.auctionEvents[0].startsAt, '2026-10-10T12:00:00.000Z');
  const reconciled = await writer.commitCommand(command('scheduler.reconcile'));
  assert.equal(reconciled.ok, true);
  assert.equal(storage.read().alerts[0].triggerAt, '2026-10-10T11:00:00.000Z');
});

test('migrates preferences once and bounds shared drafts by expiry and count', () => {
  let state = createEmptySnapshot(NOW);
  const prefs = { currency: 'GBP' };
  const migrated = reduce(state, command('preferences.migrateIfAbsent', { preferences: prefs }));
  state = migrated.snapshot;
  const again = reduce(state, command('preferences.migrateIfAbsent', { preferences: { ...prefs, currency: 'EUR' } }));
  assert.equal(again.snapshot, state);
  assert.equal(again.value.currency, 'GBP');

  for (let index = 0; index < 22; index += 1) {
    state = reduce(state, command('draft.save', {
      kind: 'auction-capture', payload: { rawText: `Auction ${index}` },
    })).snapshot;
  }
  assert.equal(state.drafts.length, 20);
  const read = reduce(state, command('draft.get', { draftId: state.drafts[0].id }));
  assert.equal(read.snapshot, state);
  assert.equal(read.value.id, state.drafts[0].id);
});

// A capture draft is half-hour scratch holding page text, but only saving another draft ever cleared the expired ones:
// a store that captured once kept that text for good.
test('an expired draft is cleared by the next change of any kind', () => {
  let state = reduce(createEmptySnapshot(NOW), command('draft.save', {
    kind: 'auction-capture', payload: { rawText: 'Lot 12, Nero denarius' },
  })).snapshot;
  const fresh = reduce(state, command('lot.save', { expectedRevision: null, lot: { title: 'Soon after', sourceLinks: [] } }));
  assert.equal(fresh.snapshot.drafts.length, 1, 'a draft still inside its half hour stays');
  const expired = state.drafts[0].expiresAt;
  const later = { now: () => expired, newId: uuid };
  const consumed = applyCommand(state, command('draft.consume', { draftId: state.drafts[0].id }), later);
  assert.equal(consumed.ok, false, 'an expired draft is not handed out');
  state = reduce(state, command('lot.save', { expectedRevision: null, lot: { title: 'Much later', sourceLinks: [] } }), later);
  assert.deepEqual(state.snapshot.drafts, [], 'and it is gone with the next write');
});

test('saves bounded unique house premiums and preserves them for older callers', () => {
  const base = reduce(createEmptySnapshot(NOW), command('preferences.migrateIfAbsent', {
    preferences: { currency: 'GBP' },
  }));
  const saved = reduce(base.snapshot, command('preferences.save', {
    expectedRevision: 0,
    preferences: { housePremiumPresets: [{ name: 'Roma Numismatics', buyerPremiumBps: 2400 }] },
  }));
  assert.deepEqual(saved.value.housePremiumPresets, [{ name: 'Roma Numismatics', buyerPremiumBps: 2400 }]);
  const legacy = reduce(saved.snapshot, command('preferences.save', {
    expectedRevision: 1, preferences: { currency: 'EUR' },
  }));
  assert.deepEqual(legacy.value.housePremiumPresets, saved.value.housePremiumPresets);
  const duplicate = applyCommand(legacy.snapshot, command('preferences.save', {
    expectedRevision: 2,
    preferences: { housePremiumPresets: [{ name: 'Roma', buyerPremiumBps: 1 }, { name: ' roma ', buyerPremiumBps: 2 }] },
  }), context());
  assert.equal(duplicate.ok, false);
  assert.deepEqual(legacy.snapshot.preferences.housePremiumPresets, saved.value.housePremiumPresets);
  const stale = applyCommand(legacy.snapshot, command('preferences.save', {
    expectedRevision: 1, preferences: { housePremiumPresets: [] },
  }), context());
  assert.equal(stale.error.code, 'conflict');
});

test('lot save round-trips optional notes and preserves them when omitted', () => {
  const created = reduce(createEmptySnapshot(NOW), command('lot.save', {
    expectedRevision: null, lot: { title: 'Nero denarius', sourceLinks: [], notes: 'Check the reverse die.' },
  }));
  assert.equal(created.value.notes, 'Check the reverse die.');
  const updated = reduce(created.snapshot, command('lot.save', {
    expectedRevision: 0, lot: { id: created.value.id, title: 'Nero denarius, revised', sourceLinks: [] },
  }));
  assert.equal(updated.value.notes, 'Check the reverse die.');
});

test('lot metadata replaces, preserves on omission, and clears on explicit null', () => {
  const metadata = {
    auctionContext: { pageUrl: 'https://house.test/lot/9', canonicalUrl: 'https://house.test/lots/9', house: 'House', saleId: 'Sale', lotNumber: '9' },
    coinDetails: { photoUrls: ['https://img.test/coin.jpg'], weightMg: 3450, diameterHundredthsMm: 1825, condition: 'VF' },
    provenanceNotes: [{ id: '11111111-1111-4111-8111-111111111111', text: 'Old collection', sourceUrl: 'https://source.test/note', recordedAt: NOW, auctionDate: '2020-02-29' }],
    costEstimate: { currency: 'GBP', shippingMinor: 500, paymentFeeBps: 300, paymentFeeMinor: 20, incrementMinor: 1000, minimumBidMinor: 2000 },
  };
  const created = reduce(createEmptySnapshot(NOW), command('lot.save', { expectedRevision: null, lot: { title: 'Coin', sourceLinks: [], ...metadata } }));
  const preserved = reduce(created.snapshot, command('lot.save', { expectedRevision: 0, lot: { id: created.value.id, title: 'Coin 2', sourceLinks: [] } }));
  for (const key of Object.keys(metadata)) assert.deepEqual(preserved.value[key], metadata[key]);
  const cleared = reduce(preserved.snapshot, command('lot.save', { expectedRevision: 1, lot: { id: created.value.id, title: 'Coin 3', sourceLinks: [], auctionContext: null, coinDetails: null, provenanceNotes: null, costEstimate: null } }));
  for (const key of Object.keys(metadata)) assert.equal(Object.hasOwn(cleared.value, key), false);
});

test('lot save rejects malformed optional metadata', () => {
  const result = applyCommand(createEmptySnapshot(NOW), command('lot.save', { expectedRevision: null, lot: {
    title: 'Coin', sourceLinks: [], coinDetails: { photoUrls: ['https://a.test/1', 'https://a.test/2', 'https://a.test/3'] },
  }}), context());
  assert.equal(result.ok, false);
  assert.equal(result.error.path, 'lots[0].coinDetails.photoUrls');
});

test('serialized writer rejects duplicate lot races with the existing lot id', async () => {
  const storage = memoryStorage(createEmptySnapshot(NOW));
  const writer = createCommandWriter(storage, context());
  const [first, duplicate] = await Promise.all([
    writer.commitCommand(command('lot.save', { expectedRevision: null, lot: { title: 'First', sourceLinks: [], auctionContext: { pageUrl: 'https://house.test/lot/1?utm_source=a' } } })),
    writer.commitCommand(command('lot.save', { expectedRevision: null, lot: { title: 'Second', sourceLinks: [], auctionContext: { pageUrl: 'https://house.test/lot/1#photo' } } })),
  ]);
  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.requestId.length > 0, true);
  assert.equal(duplicate.code, 'duplicate');
  assert.equal(duplicate.outcome, 'not-committed');
  assert.deepEqual(duplicate.error, { code: 'duplicate', message: 'This auction lot is already saved.', existingLotId: first.value.id });
  assert.equal(storage.read().lots.length, 1);
});

test('duplicate detection uses preserved auction context after revision validation', () => {
  let state = reduce(createEmptySnapshot(NOW), command('lot.save', { expectedRevision: null, lot: { title: 'First', sourceLinks: [], auctionContext: { pageUrl: 'https://house.test/lot/1' } } }));
  const second = reduce(state.snapshot, command('lot.save', { expectedRevision: null, lot: { title: 'Second', sourceLinks: [], auctionContext: { pageUrl: 'https://house.test/lot/2' } } }));
  const conflict = applyCommand(second.snapshot, command('lot.save', { expectedRevision: 99, lot: { id: second.value.id, title: 'Changed', sourceLinks: [], auctionContext: { pageUrl: 'https://house.test/lot/1' } } }), context());
  assert.equal(conflict.error.code, 'conflict');
  const duplicate = applyCommand(second.snapshot, command('lot.save', { expectedRevision: 0, lot: { id: second.value.id, title: 'Changed', sourceLinks: [], auctionContext: { pageUrl: 'https://house.test/lot/1' } } }), context());
  assert.equal(duplicate.error.code, 'duplicate');
});

test('current-lot draft authority accepts only editable watchlist fields', () => {
  const state = createEmptySnapshot(NOW);
  const accepted = reduce(state, command('draft.save', {
    kind: 'current-lot',
    payload: { target: 'watchlist', title: 'Nero denarius', reference: 'RIC 306', pageUrl: 'https://example.test/lot/1' },
  }));
  assert.deepEqual(accepted.value.payload, {
    target: 'watchlist', title: 'Nero denarius', reference: 'RIC 306', pageUrl: 'https://example.test/lot/1',
  });

  const rejected = applyCommand(state, command('draft.save', {
    kind: 'current-lot',
    payload: {
      target: 'watchlist', title: 'Nero denarius',
      shownPrices: { median: 20000, lots: [{ id: 'provider-row' }] },
    },
  }), context());
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.path, 'payload.shownPrices');
  assert.equal(state.drafts.length, 0);
});

test('preference migration ignores client-owned metadata', () => {
  const prefs = reduce(createEmptySnapshot(NOW), command('preferences.migrateIfAbsent', {
    preferences: {
      id: 'client-id', revision: 42, dataClass: 'sample', createdAt: 'bad',
      currency: 'USD', catalogue: 'Price', number: '23', volume: '', section: '', sampleMode: false,
    },
  }));
  assert.equal(prefs.value.revision, 0);
  assert.equal('id' in prefs.value, false);
  assert.equal(prefs.value.createdAt, NOW);
  // The research form is the popup's own, not the durable root's: a caller still sending it is ignored.
  for (const key of ['catalogue', 'number', 'volume', 'section', 'sampleMode']) {
    assert.equal(key in prefs.value, false, key);
  }
});

test('rejects invalid commands without mutating the supplied snapshot', () => {
  const snapshot = createEmptySnapshot(NOW);
  const before = structuredClone(snapshot);
  const invalid = applyCommand(snapshot, command('lot.save', {
    expectedRevision: null, lot: { title: '', sourceLinks: [] },
  }), context());
  assert.equal(invalid.error.code, 'validation');
  assert.deepEqual(snapshot, before);
  assert.equal(applyCommand(snapshot, command('invented'), context()).error.code, 'unsupported');
  assert.doesNotThrow(() => applyCommand(snapshot, command('lot.save', {
    expectedRevision: null, lot: null,
  }), context()));
  assert.equal(applyCommand(snapshot, command('lot.save', {
    expectedRevision: null, lot: null,
  }), context()).error.code, 'validation');
});

test('serialized writer checks revisions inside its queue and returns prior reply for duplicate request ids', async () => {
  const storage = memoryStorage(createEmptySnapshot(NOW));
  const writer = createCommandWriter(storage, context());
  const first = command('lot.save', { expectedRevision: null, lot: { title: 'First', sourceLinks: [] } });
  const second = command('lot.save', { expectedRevision: null, lot: { title: 'Second', sourceLinks: [] } });
  const [a, b] = await Promise.all([writer.commitCommand(first), writer.commitCommand(second)]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(storage.read().revision, 2);

  const duplicate = await writer.commitCommand(first);
  assert.deepEqual(duplicate, a);
  assert.equal(storage.read().revision, 2);
  assert.equal(storage.read().recentCommands.length, 2);
});

test('an internal reconcile can spend reserved headroom after a near-bound public write', async () => {
  const initial = createEmptySnapshot(NOW);
  const save = command('group.save', {
    expectedRevision: null,
    group: { name: 'Near-bound group', memberLotIds: [] },
  });
  initial.padding = '';
  let projected = applyCommand(initial, save, context()).value.snapshot;
  initial.padding = 'x'.repeat(MAX_ROOT_BYTES - 100_010 - new TextEncoder().encode(JSON.stringify(projected)).length);

  const storage = memoryStorage(initial);
  const writer = createCommandWriter(storage, context());
  const saved = await writer.commitCommand(save);
  assert.equal(saved.ok, true);
  assert.equal((await writer.commitCommand(command('scheduler.reconcile'))).ok, true);
  assert.ok(new TextEncoder().encode(JSON.stringify(storage.read())).length <= MAX_ROOT_BYTES);
  const revision = storage.read().revision;
  assert.deepEqual(await writer.commitCommand(save), saved);
  assert.equal(storage.read().revision, revision);
});

test('writer returns conflict for racing updates to the same record', async () => {
  const storage = memoryStorage(createEmptySnapshot(NOW));
  const writer = createCommandWriter(storage, context());
  const created = await writer.commitCommand(command('lot.save', {
    expectedRevision: null, lot: { title: 'Original', sourceLinks: [] },
  }));
  const update = (title) => command('lot.save', {
    expectedRevision: 0,
    lot: { id: created.value.id, title, sourceLinks: [] },
  });
  const replies = await Promise.all([writer.commitCommand(update('A')), writer.commitCommand(update('B'))]);
  assert.equal(replies.filter(({ ok }) => ok).length, 1);
  assert.equal(replies.find(({ ok }) => !ok).code, 'conflict');
});

test('writer distinguishes rejected writes from uncertain accepted writes', async () => {
  const input = command('lot.save', { expectedRevision: null, lot: { title: 'Coin', sourceLinks: [] } });
  const rejected = await createCommandWriter(memoryStorage(createEmptySnapshot(NOW), { setFails: true }), context())
    .commitCommand(input);
  assert.deepEqual({ code: rejected.code, outcome: rejected.outcome }, { code: 'storage', outcome: 'not-committed' });

  const verifyOptions = { verifyFails: true };
  const uncertain = await createCommandWriter(memoryStorage(createEmptySnapshot(NOW), verifyOptions), context())
    .commitCommand(command('lot.save', { expectedRevision: null, lot: { title: 'Coin', sourceLinks: [] } }));
  assert.deepEqual({ code: uncertain.code, outcome: uncertain.outcome }, { code: 'storage', outcome: 'unknown' });
});

test('malformed writer envelopes and null group drafts return validation replies', async () => {
  const writer = createCommandWriter(memoryStorage(createEmptySnapshot(NOW)), context());
  const missing = await writer.commitCommand(null);
  assert.deepEqual({ ok: missing.ok, code: missing.code, outcome: missing.outcome }, {
    ok: false, code: 'validation', outcome: 'not-committed',
  });
  const nullGroup = await writer.commitCommand(command('group.save', {
    expectedRevision: null, group: null,
  }));
  assert.equal(nullGroup.code, 'validation');
  assert.equal(nullGroup.outcome, 'not-committed');
});

test('snapshot.get reads without writing or entering the request ledger', async () => {
  const storage = memoryStorage(createEmptySnapshot(NOW));
  const writer = createCommandWriter(storage, context());
  const reply = await writer.commitCommand(command('snapshot.get'));
  assert.equal(reply.ok, true);
  assert.equal(reply.value.schemaVersion, SCHEMA_VERSION);
  assert.equal(storage.read().recentCommands.length, 0);
});

test('a root with one corrupt lot still loads, exports, and keeps the lot quarantined', async () => {
  const stored = createEmptySnapshot(NOW);
  const keep = {
    id: uuid(), revision: 0, dataClass: 'collector', title: 'Sound lot', sourceLinks: [],
    bidHistory: [], outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW,
  };
  const corrupt = { ...structuredClone(keep), id: uuid(), outcome: { status: 'maybe' } };
  stored.lots.push(keep, corrupt);
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const reply = await writer.commitCommand(command('snapshot.get'));
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.value.lots.map(({ id }) => id), [keep.id]);
  assert.deepEqual(reply.value.quarantine.map(({ collection, record }) => [collection, record.id]),
    [['lots', corrupt.id]]);
  assert.equal(reply.revision, 0);
  assert.equal(storage.read().lots.length, 2, 'a read must not rewrite storage');
  assert.equal(JSON.parse(exportBackup(reply.value, NOW).value).data.quarantine.length, 1);

  const saved = await writer.commitCommand(command('lot.save', {
    expectedRevision: null, lot: { title: 'Added later', sourceLinks: [] },
  }));
  assert.equal(saved.ok, true);
  assert.deepEqual(storage.read().quarantine.map(({ record }) => record), [corrupt]);
  assert.equal(storage.read().lots.length, 2);
  const reconciled = await writer.commitCommand(command('scheduler.reconcile'));
  assert.equal(reconciled.ok, true);
  assert.equal(storage.read().quarantine.length, 1);
});

// A record set aside by a repair is the collector's own, and until now the only way back was to edit
// a backup by hand. One that validates again goes back where it came from, and the links its removal
// had to clear go back with it - unless the collector has used that field since.
const setAsideEvent = () => ({
  id: uuid(), revision: 3, dataClass: 'collector', name: 'Set-aside sale', eventKind: 'auction-starts',
  precision: 'timed', localDate: '2026-10-10', localTime: '12:00', timeZone: 'UTC',
  startsAt: '2026-10-10T12:00:00.000Z', reminderScope: 'standalone',
  reminders: [{ id: uuid(), kind: 'offset', offsetMinutes: 60 }], createdAt: NOW, updatedAt: NOW,
});
const plainLot = (id, extra = {}) => ({
  id, revision: 2, dataClass: 'collector', title: 'Nero denarius', sourceLinks: [], bidHistory: [],
  outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW, ...extra,
});
const setAsideRoot = (entries, lots, events = []) => {
  const stored = createEmptySnapshot(NOW);
  stored.lots.push(...lots);
  stored.auctionEvents.push(...events);
  stored.quarantine = entries;
  return stored;
};

test('a set-aside record goes back into its collection with the link its removal cleared', async () => {
  const event = setAsideEvent();
  const lotId = uuid();
  const stored = setAsideRoot([{
    collection: 'auctionEvents', record: event, reason: 'duplicate-id', quarantinedAt: NOW,
    clearedReferences: [{ collection: 'lots', id: lotId, field: 'auctionEventId', value: event.id }],
  }], [plainLot(lotId)]);
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const restored = await writer.commitCommand(command('quarantine.restore', {
    entryId: quarantineEntryId(stored.quarantine[0]),
  }));
  assert.equal(restored.ok, true, restored.message);
  assert.deepEqual(restored.value, {
    collection: 'auctionEvents',
    id: event.id,
    restoredReferences: [{ collection: 'lots', id: lotId, field: 'auctionEventId' }],
    keptReferences: [],
  });
  const after = storage.read();
  assert.deepEqual(after.auctionEvents.map(({ id }) => id), [event.id]);
  assert.equal(after.auctionEvents[0].revision, 0, 'counted again from a number every later write can hold');
  assert.equal(after.lots[0].auctionEventId, event.id);
  assert.equal(after.lots[0].revision, 3, 'the lot changed, so a holder of the row it had is asked again');
  assert.equal(Object.hasOwn(after, 'quarantine'), false, 'and the entry has left the bin');
  // The reminder the set-aside sale carries is scheduled again, as it would have been all along.
  assert.equal((await writer.commitCommand(command('scheduler.reconcile'))).ok, true);
  assert.equal(storage.read().alerts.length, 1);
});

test('a field used since it was cleared is left alone and named in the reply', async () => {
  const event = setAsideEvent();
  const kept = setAsideEvent();
  const lotId = uuid();
  const stored = setAsideRoot([{
    collection: 'auctionEvents', record: event, reason: 'duplicate-id', quarantinedAt: NOW,
    clearedReferences: [{ collection: 'lots', id: lotId, field: 'auctionEventId', value: event.id }],
  }], [plainLot(lotId, { auctionEventId: kept.id })], [kept]);
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const restored = await writer.commitCommand(command('quarantine.restore', {
    entryId: quarantineEntryId(stored.quarantine[0]),
  }));
  assert.equal(restored.ok, true, restored.message);
  assert.deepEqual(restored.value.restoredReferences, []);
  assert.deepEqual(restored.value.keptReferences, [{ collection: 'lots', id: lotId, field: 'auctionEventId' }]);
  const after = storage.read();
  assert.deepEqual(after.auctionEvents.map(({ id }) => id).sort(), [kept.id, event.id].sort());
  assert.equal(after.lots[0].auctionEventId, kept.id, 'the sale the collector chose since stays');
  assert.equal(after.lots[0].revision, 2, 'and that lot is not written at all');
});

// Undoing the links a restore had to give up walks them backwards. Each one wrote down the revision
// its host carried before that link was applied, so replaying them forwards left a host that took
// two of them one revision above where it started: an alteration the collector never made, and a
// false conflict for an editor holding the row.
test('a restore whose links are undone leaves a two-link host record untouched', async () => {
  const group = {
    id: uuid(), revision: 0, dataClass: 'collector', name: 'Alternatives', createdAt: NOW, updatedAt: NOW,
  };
  const lotId = uuid();
  const stored = setAsideRoot([{
    collection: 'alternativeGroups', record: group, reason: 'collection-limit', quarantinedAt: NOW,
    clearedReferences: [
      { collection: 'lots', id: lotId, field: 'alternativeGroupId', value: group.id },
      { collection: 'lots', id: lotId, field: 'priority', value: 0 },
    ],
  }], [plainLot(lotId)]);
  const before = structuredClone(stored.lots[0]);
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const restored = await writer.commitCommand(command('quarantine.restore', {
    entryId: quarantineEntryId(stored.quarantine[0]),
  }));
  assert.equal(restored.ok, true, restored.message);
  assert.deepEqual(restored.value.restoredReferences, [], 'a priority of zero is no ordering this root can hold');
  assert.equal(restored.value.keptReferences.length, 2, 'so both links are reported as left out');
  const after = storage.read();
  assert.deepEqual(after.alternativeGroups.map(({ id }) => id), [group.id], 'the group itself is back');
  assert.deepEqual(after.lots[0], before, 'and the lot is exactly the row it was, revision included');
});

test('a set-aside record that still does not validate is refused and stays in the bin', async () => {
  const broken = { ...setAsideEvent(), eventKind: 'bring-your-own' };
  const stored = setAsideRoot([{
    collection: 'auctionEvents', record: broken, reason: 'invalid-enum', quarantinedAt: NOW,
  }], []);
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const refused = await writer.commitCommand(command('quarantine.restore', {
    entryId: quarantineEntryId(stored.quarantine[0]),
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'validation');
  assert.equal(refused.outcome, 'not-committed');
  assert.match(refused.message, /allowed set/i, 'the validator says what is wrong with it');
  const after = storage.read();
  assert.deepEqual(after.auctionEvents, []);
  assert.equal(after.quarantine.length, 1, 'nothing is lost by a refusal');

  const missing = await writer.commitCommand(command('quarantine.restore', { entryId: uuid() }));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'validation');
});

// A lot and its collection entry refer to each other both ways, so a repair that sets the lot aside
// as a duplicate ID sends its entry after it as a foreign key - and neither could ever come back,
// because each was refused over the one still in the bin. They come back together now.
const pairedRoot = () => {
  const lotId = uuid();
  const entryId = uuid();
  const stored = createEmptySnapshot(NOW);
  stored.quarantine = [
    {
      collection: 'lots', reason: 'duplicate-id', quarantinedAt: NOW,
      record: plainLot(lotId, { collectionEntryId: entryId, outcome: { status: 'won' } }),
    },
    {
      collection: 'collectionEntries', reason: 'foreign-key', quarantinedAt: NOW,
      record: {
        id: entryId, revision: 0, dataClass: 'collector', lotId, title: 'Acquired',
        acquisitionDate: '2026-09-12', sourceLinks: [], createdAt: NOW, updatedAt: NOW,
      },
    },
  ];
  return { stored, lotId, entryId };
};

test('a lot and the collection entry set aside with it are put back by one command', async () => {
  const { stored, lotId, entryId } = pairedRoot();
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const restored = await writer.commitCommand(command('quarantine.restore', {
    entryId: quarantineEntryId(stored.quarantine[0]),
  }));
  assert.equal(restored.ok, true, restored.message);
  assert.equal(restored.value.collection, 'lots');
  assert.equal(restored.value.id, lotId);
  assert.deepEqual(restored.value.alsoRestored, [{ collection: 'collectionEntries', id: entryId }],
    'the reply lists the partner that came back with it');
  const after = storage.read();
  assert.deepEqual(after.lots.map(({ id }) => id), [lotId]);
  assert.deepEqual(after.collectionEntries.map(({ id }) => id), [entryId]);
  assert.equal(Object.hasOwn(after, 'quarantine'), false, 'both entries have left the bin');
  assert.match(quarantineRestoreText(restored.value), /linked to went back into collectionEntries/);
});

test('the collection entry of the pair puts its lot back the same way', async () => {
  const { stored, lotId, entryId } = pairedRoot();
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const restored = await writer.commitCommand(command('quarantine.restore', {
    entryId: quarantineEntryId(stored.quarantine[1]),
  }));
  assert.equal(restored.ok, true, restored.message);
  assert.equal(restored.value.id, entryId);
  assert.deepEqual(restored.value.alsoRestored, [{ collection: 'lots', id: lotId }]);
  assert.equal(storage.read().lots.length, 1);
});

test('half a pair alone is refused by naming the partner that is not there', async () => {
  const { stored, entryId } = pairedRoot();
  stored.quarantine = [stored.quarantine[0]];
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const refused = await writer.commitCommand(command('quarantine.restore', {
    entryId: quarantineEntryId(stored.quarantine[0]),
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'validation');
  assert.match(refused.message, /collection entry/, 'it says what kind of record is missing');
  assert.ok(refused.message.includes(entryId), 'and names it');
  assert.doesNotMatch(refused.message, /reminder/i, 'and blames no reminder');
  assert.equal(storage.read().quarantine.length, 1, 'nothing is lost by the refusal');
});

// Two restores that could never succeed, whatever the collector did: a group member whose place was
// taken when the group closed up behind it, and a collection entry whose lot is saved but lost its
// link to it. Each was refused by the validator over something the restore itself can settle.
test('a group member whose place has been taken is put back last in its group', async () => {
  const group = { id: uuid(), revision: 0, dataClass: 'collector', name: 'Alternatives', createdAt: NOW, updatedAt: NOW };
  const first = plainLot(uuid(), { alternativeGroupId: group.id, priority: 1 });
  const second = plainLot(uuid(), { alternativeGroupId: group.id, priority: 2 });
  const setAside = plainLot(uuid(), { alternativeGroupId: group.id, priority: 2 });
  const stored = setAsideRoot([{ collection: 'lots', reason: 'collection-limit', quarantinedAt: NOW, record: setAside }], [first, second]);
  stored.alternativeGroups.push(group);
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const restored = await writer.commitCommand(command('quarantine.restore', { entryId: quarantineEntryId(stored.quarantine[0]) }));
  assert.equal(restored.ok, true, restored.message);
  assert.equal(restored.value.placedLastInGroup, true, 'the reply says where it went');
  const after = storage.read();
  const priorities = Object.fromEntries(after.lots.map(({ id, priority }) => [id, priority]));
  assert.deepEqual(priorities, { [first.id]: 1, [second.id]: 2, [setAside.id]: 3 }, 'the order already there is kept');
  assert.equal(after.lots.find(({ id }) => id === second.id).revision, second.revision, 'and no other lot is written');
  assert.match(quarantineRestoreText(restored.value), /last in its alternative group/);
});

test('a collection entry whose lot is saved without its link is put back and linked again', async () => {
  const won = plainLot(uuid(), { outcome: { status: 'won' } });
  const entry = {
    id: uuid(), revision: 0, dataClass: 'collector', lotId: won.id, title: 'Won', acquisitionDate: '2026-08-01',
    sourceLinks: [], notes: 'bought at the sale', createdAt: NOW, updatedAt: NOW,
  };
  const stored = setAsideRoot([{ collection: 'collectionEntries', reason: 'foreign-key', quarantinedAt: NOW, record: entry }], [won]);
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const restored = await writer.commitCommand(command('quarantine.restore', { entryId: quarantineEntryId(stored.quarantine[0]) }));
  assert.equal(restored.ok, true, restored.message);
  assert.deepEqual(restored.value.restoredReferences, [{ collection: 'lots', id: won.id, field: 'collectionEntryId' }]);
  const after = storage.read();
  assert.equal(after.collectionEntries[0].notes, 'bought at the sale');
  assert.equal(after.lots[0].collectionEntryId, entry.id);
  assert.equal(after.lots[0].revision, won.revision + 1, 'the lot changed, so a holder of the old row is asked again');

  // A lot that already names another entry keeps it: the restore is refused and nothing moves.
  const other = uuid();
  const claimed = setAsideRoot([{ collection: 'collectionEntries', reason: 'foreign-key', quarantinedAt: NOW, record: entry }],
    [plainLot(won.id, { outcome: { status: 'won' }, collectionEntryId: other })]);
  claimed.collectionEntries.push({ ...structuredClone(entry), id: other, notes: 'the one kept' });
  const claimedStorage = memoryStorage(claimed);
  const refused = await createCommandWriter(claimedStorage, context())
    .commitCommand(command('quarantine.restore', { entryId: quarantineEntryId(claimed.quarantine[0]) }));
  assert.equal(refused.ok, false);
  assert.deepEqual(claimedStorage.read(), claimed);
});

// A restore the root refuses is refused in the validator's own words. The reminder preflight runs
// over every schedule-changing command, so its sentence used to be put in front of a refusal that
// was never about reminders at all.
test('a restore the root refuses says what the validator said, without blaming reminders', async () => {
  const lot = plainLot(uuid(), { auctionEventId: uuid() });
  const stored = setAsideRoot([{
    collection: 'lots', record: lot, reason: 'collection-limit', quarantinedAt: NOW,
  }], []);
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const refused = await writer.commitCommand(command('quarantine.restore', {
    entryId: quarantineEntryId(stored.quarantine[0]),
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'validation');
  assert.equal(refused.message, 'Lot refers to an unknown auction event.');
  assert.doesNotMatch(refused.message, /reminder/i);
  assert.equal(storage.read().lots.length, 0, 'and nothing is written');
});

// Two bins unioned by an import hold the same record twice, and a repair that runs again over a bin
// it already wrote must not open a second entry for a cause that is already in there.
test('a bin holding one set-aside record twice folds it into a single entry on repair', async () => {
  const event = setAsideEvent();
  const lotId = uuid();
  const reference = { collection: 'lots', id: lotId, field: 'auctionEventId', value: event.id };
  const entry = { collection: 'auctionEvents', record: event, reason: 'duplicate-id', quarantinedAt: LATER };
  const stored = setAsideRoot([
    { ...structuredClone(entry), clearedReferences: [reference] },
    { ...structuredClone(entry), quarantinedAt: NOW },
  ], [plainLot(lotId), plainLot(uuid(), { outcome: { status: 'maybe' } })]);
  const writer = createCommandWriter(memoryStorage(stored), context());

  const opened = await writer.commitCommand(command('snapshot.get'));
  assert.equal(opened.ok, true, opened.message);
  const events = opened.value.quarantine.filter(({ collection }) => collection === 'auctionEvents');
  assert.equal(events.length, 1, 'one record set aside for one reason is one entry');
  assert.equal(events[0].quarantinedAt, NOW, 'set aside when it first was');
  assert.deepEqual(events[0].clearedReferences, [reference], 'and carrying every link either entry recorded');
  assert.equal(opened.value.quarantine.length, 2, 'the lot the repair set aside is the other entry');
});

// The load-time repair stamps what it sets aside with the moment of that load, and a stored root is only
// rewritten by the next write. Every read in between repaired again at a later moment, so an entry's
// identity - taken from its bytes - changed with each read, and a Restore could never find the entry
// its page had drawn: "no longer in the list. Reload" on every attempt, however often the page reloaded.
test('an entry the load-time repair set aside keeps its identity from one read to the next', async () => {
  let tick = Date.parse(NOW);
  const moving = { now: () => new Date((tick += 1500)).toISOString(), newId: uuid };
  const stored = createEmptySnapshot(NOW);
  const lotId = uuid();
  const entryId = uuid();
  stored.lots.push(plainLot(lotId, { outcome: { status: 'maybe' }, collectionEntryId: entryId }));
  stored.collectionEntries.push({
    id: entryId, revision: 0, dataClass: 'collector', lotId, title: 'Nero denarius',
    acquisitionDate: '2026-08-01', sourceLinks: [], createdAt: NOW, updatedAt: NOW,
  });
  const writer = createCommandWriter(memoryStorage(stored), moving);

  const first = await writer.commitCommand(command('snapshot.get'));
  const second = await writer.commitCommand(command('snapshot.get'));
  const ids = (reply) => quarantineRows(reply.value.quarantine).map(({ id }) => id);
  assert.equal(ids(first).length, 2);
  assert.deepEqual(ids(second), ids(first), 'the same entry is named the same way on every read');

  const entryRow = quarantineRows(first.value.quarantine).find(({ line }) => line.startsWith('collectionEntries'));
  const reply = await writer.commitCommand(command('quarantine.restore', { entryId: entryRow.id }));
  assert.equal(reply.ok, false);
  assert.doesNotMatch(reply.message, /no longer in the list/, 'the entry the page drew is found');
  assert.match(reply.message, /allowed set/, 'and the restore is answered on its merits: its lot is still broken');
});

// The fold behind an import and behind every load-time repair compared each entry and each cleared link
// with all the others. The single command queue waits on it, so it has to stay linear.
test('a crafted set-aside list is imported by the worker without holding the queue', async () => {
  const quarantine = Array.from({ length: 20000 }, (_, index) => ({
    collection: 'lots', reason: 'invalid-record', quarantinedAt: NOW, record: { id: 'x', n: index },
  }));
  const document = JSON.stringify({
    format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: NOW,
    data: { ...createEmptySnapshot(NOW), quarantine },
  });
  const writer = createCommandWriter(memoryStorage(createEmptySnapshot(NOW)), context());
  const started = performance.now();
  const reply = await writer.commitCommand(command('backup.import', { expectedRevision: 0, mode: 'merge', document }));
  const elapsed = performance.now() - started;
  assert.equal(reply.ok, true, reply.message);
  assert.ok(elapsed < 2000, `imported in ${Math.round(elapsed)} ms`);
});

test('a repair clearing thousands of links to one missing record stays linear', async () => {
  const stored = createEmptySnapshot(NOW);
  const missing = uuid();
  for (let index = 0; index < LIMITS.lots; index += 1) stored.lots.push(plainLot(uuid(), { auctionEventId: missing }));
  const writer = createCommandWriter(memoryStorage(stored), context());
  const started = performance.now();
  const opened = await writer.commitCommand(command('snapshot.get'));
  const elapsed = performance.now() - started;
  assert.equal(opened.ok, true, opened.message);
  assert.equal(opened.value.quarantine.length, 1, 'one note for the one missing sale');
  assert.equal(opened.value.quarantine[0].clearedReferences.length, LIMITS.lots, 'carrying every link it cleared');
  assert.ok(elapsed < 2000, `opened in ${Math.round(elapsed)} ms`);
});

// Damage to what every record shares locked the collector out of all of them, down to a plain read.
test('damaged settings, schedule, scratch or root counter no longer lock the store', async () => {
  const settings = (extra) => ({
    schemaVersion: SCHEMA_VERSION, revision: 0, currency: 'USD', housePremiumPresets: [], desktopAlertsEnabled: false,
    createdAt: NOW, updatedAt: NOW, ...extra,
  });
  for (const [label, damage] of [
    ['a currency no build writes', (root) => { root.preferences = settings({ currency: 'JPY' }); }],
    ['a preset with a broken ladder', (root) => {
      root.preferences = settings({ housePremiumPresets: [{ name: 'X', buyerPremiumBps: 2000, incrementLadder: { currency: 'USD', tiers: 'oops' } }] });
    }],
    ['settings from a later version', (root) => { root.preferences = settings({ schemaVersion: SCHEMA_VERSION + 1 }); }],
    ['a wake time that is no instant', (root) => { root.scheduler.nextWakeAt = 'soon'; }],
    ['no list of drafts', (root) => { root.drafts = null; }],
    ['no request ledger', (root) => { root.recentCommands = {}; }],
    ['a root revision at the last safe integer', (root) => { root.revision = Number.MAX_SAFE_INTEGER; }],
  ]) {
    const stored = createEmptySnapshot(NOW);
    const kept = plainLot(uuid());
    stored.lots.push(kept);
    damage(stored);
    const storage = memoryStorage(stored);
    const writer = createCommandWriter(storage, context());
    const opened = await writer.commitCommand(command('snapshot.get'));
    assert.equal(opened.ok, true, `${label}: ${opened.message}`);
    assert.deepEqual(opened.value.lots, [kept], label);
    const saved = await writer.commitCommand(command('lot.save', { expectedRevision: null, lot: { title: 'New', sourceLinks: [] } }));
    assert.equal(saved.ok, true, `${label}: ${saved.message}`);
    assert.equal(storage.read().lots.length, 2, label);
    const reconciled = await writer.commitCommand(command('scheduler.reconcile'));
    assert.equal(reconciled.ok, true, `${label}: ${reconciled.message}`);
  }
});

test('snapshot.raw returns an unusable stored root exactly as stored', async () => {
  const stored = createEmptySnapshot(NOW);
  stored.lots = { id: 'not-a-uuid', title: 'Rescue me' };
  stored.scheduler = 'corrupt';
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());
  const reply = await writer.commitCommand(command('snapshot.raw'));
  assert.equal(reply.ok, true);
  assert.equal(reply.revision, 0);
  assert.deepEqual(reply.value, stored);
  assert.deepEqual(storage.read(), stored);
  const blocked = await writer.commitCommand(command('lot.save', {
    expectedRevision: null, lot: { title: 'New', sourceLinks: [] },
  }));
  assert.equal(blocked.code, 'storage');
});

test('scheduler reconciliation persists occurrences and one next wake', () => {
  let state = reduce(createEmptySnapshot(NOW), command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Future sale', eventKind: 'auction-starts', precision: 'timed',
      localDate: '2026-10-10', localTime: '12:00', timeZone: 'UTC',
      reminderScope: 'standalone', reminders: [{ kind: 'offset', offsetMinutes: 60 }],
    },
  })).snapshot;
  const reconciled = reduce(state, command('scheduler.reconcile'));
  assert.equal(reconciled.snapshot.alerts.length, 1);
  assert.equal(reconciled.snapshot.alerts[0].status, 'pending');
  assert.equal(reconciled.snapshot.scheduler.nextWakeAt, '2026-10-10T11:00:00.000Z');
});

test('repeated reconciliation of an unchanged store neither writes nor bumps the revision', async () => {
  const storage = memoryStorage(createEmptySnapshot(NOW));
  const writer = createCommandWriter(storage, context());
  const saved = await writer.commitCommand(command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Future sale', eventKind: 'auction-starts', precision: 'timed',
      localDate: '2026-10-10', localTime: '12:00', timeZone: 'UTC',
      reminderScope: 'standalone', reminders: [{ kind: 'offset', offsetMinutes: 60 }],
    },
  }));
  assert.equal(saved.ok, true);
  const first = await writer.commitCommand(command('scheduler.reconcile'));
  assert.equal(first.ok, true);
  const settled = storage.read();
  for (let index = 0; index < 3; index += 1) {
    const reply = await writer.commitCommand(command('scheduler.reconcile'));
    assert.equal(reply.ok, true);
    assert.equal(reply.revision, settled.revision);
    assert.equal(reply.value.nextWakeAt, '2026-10-10T11:00:00.000Z');
  }
  assert.deepEqual(storage.read(), settled);
});

test('scheduler reconciliation supports more than 500 alerts from valid events', () => {
  let state = createEmptySnapshot(NOW);
  for (let eventIndex = 0; eventIndex < 26; eventIndex += 1) {
    const saved = reduce(state, command('event.save', {
      expectedRevision: null,
      event: {
        name: `Sale ${eventIndex}`, eventKind: 'auction-starts', precision: 'timed',
        localDate: '2026-10-10', localTime: '12:00', timeZone: 'UTC',
        reminderScope: 'standalone', reminders: Array.from({ length: 20 }, (_, reminderIndex) => ({
          kind: 'offset', offsetMinutes: reminderIndex + 1,
        })),
      },
    }));
    state = saved.snapshot;
  }
  const reconciled = reduce(state, command('scheduler.reconcile'));
  assert.equal(reconciled.snapshot.alerts.length, 520);
});

test('scheduler reconciliation keeps a compact replayable reply with 520 due reminders', () => {
  let state = createEmptySnapshot(NOW);
  for (let eventIndex = 0; eventIndex < 26; eventIndex += 1) {
    state.auctionEvents.push({
      id: uuid(), revision: 0, dataClass: 'collector', name: `Due ${eventIndex}`,
      eventKind: 'auction-starts', precision: 'timed', localDate: '2026-09-12', localTime: '12:00',
      timeZone: 'UTC', startsAt: NOW, reminderScope: 'standalone',
      reminders: Array.from({ length: 20 }, (_, reminderIndex) => ({ id: uuid(), kind: 'offset', offsetMinutes: reminderIndex })),
      createdAt: NOW, updatedAt: NOW,
    });
  }
  const reconciled = reduce(state, command('scheduler.reconcile'));
  assert.deepEqual(Object.keys(reconciled.reply.value).sort(), ['dueEventCount', 'nextWakeAt']);
  assert.equal(reconciled.reply.value.dueEventCount, 26);
  assert.equal(reconciled.snapshot.alerts.length, 520);
});

test('writer atomically rejects an event whose fully materialized reminders exceed 5 MiB', async () => {
  const current = createEmptySnapshot(NOW);
  const event = (eventIndex) => ({
    id: uuid(), revision: 0, dataClass: 'collector', name: `Future ${eventIndex}`,
    eventKind: 'auction-starts', precision: 'timed', localDate: '2026-09-20', localTime: '12:00',
    timeZone: 'UTC', startsAt: '2026-09-20T12:00:00.000Z', reminderScope: 'standalone',
    reminders: Array.from({ length: 20 }, (_, reminderIndex) => ({ id: uuid(), kind: 'offset', offsetMinutes: reminderIndex * 60 })),
    createdAt: NOW, updatedAt: NOW,
  });
  for (let index = 0; index < 499; index += 1) current.auctionEvents.push(event(index));
  const storage = memoryStorage(current);
  const writer = createCommandWriter(storage, context());
  const result = await writer.commitCommand(command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Future 499', eventKind: 'auction-starts', precision: 'timed', localDate: '2026-09-20', localTime: '12:00',
      timeZone: 'UTC', reminderScope: 'standalone', reminders: Array.from({ length: 20 }, (_, reminderIndex) => ({ kind: 'offset', offsetMinutes: reminderIndex * 60 })),
    },
  }));
  assert.equal(result.ok, false);
  assert.match(result.message, /reminders.*5 MiB/i);
  assert.equal(storage.read().auctionEvents.length, 499);
});

// A backup that will not fit is not a reminder problem. The bound is shared with the reminder
// preflight, and its sentence told the collector to remove reminders or auction events, which is no
// way out of a file with too many records in it.
test('an import over the storage bound is refused as an import, not as a reminder', () => {
  const notes = 'x'.repeat(LIMITS.notes);
  const fat = (index) => ({
    id: `00000000-0000-4000-8000-${String(index + 100000).padStart(12, '0')}`, revision: 0,
    dataClass: 'collector', title: `Lot ${index}`, notes, sourceLinks: [], bidHistory: [],
    outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW,
  });
  const incoming = createEmptySnapshot(NOW);
  const lotBytes = new TextEncoder().encode(JSON.stringify(fat(0))).length + 1;
  for (let index = 0; index * lotBytes < MAX_ROOT_BYTES - 50000; index += 1) incoming.lots.push(fat(index));
  const result = applyCommand(createEmptySnapshot(NOW), command('backup.import', {
    expectedRevision: 0, mode: 'replace', document: exportBackup(incoming, NOW).value,
  }), context());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'storage-bound');
  assert.match(result.error.message, /backup/i);
  assert.doesNotMatch(result.error.message, /reminder/i);

  // Nor is a record coming back out of the bin: the way out of that is the records already saved.
  const stored = createEmptySnapshot(NOW);
  stored.lots.push(...incoming.lots);
  stored.quarantine = [{ collection: 'lots', record: fat(999999), reason: 'collection-limit', quarantinedAt: NOW }];
  const restore = applyCommand(stored, command('quarantine.restore', {
    entryId: quarantineEntryId(stored.quarantine[0]),
  }), context());
  assert.equal(restore.ok, false);
  assert.equal(restore.error.code, 'storage-bound');
  assert.match(restore.error.message, /put(ting)? (this record )?back/i);
  assert.doesNotMatch(restore.error.message, /reminder/i);
});

// The reminder preflight ran before the command's own result had been judged, so a lot too many, or a
// store already at the bound, was reported as reminders that could not be scheduled - and the way out
// it offered was removing reminders.
test('a schedule-changing command refused for its own sake does not blame reminders', () => {
  const full = createEmptySnapshot(NOW);
  for (let index = 0; index < LIMITS.lots; index += 1) full.lots.push(plainLot(uuid()));
  const counted = applyCommand(full, command('lot.save', {
    expectedRevision: null, lot: { title: 'One lot too many', sourceLinks: [] },
  }), context());
  assert.equal(counted.ok, false);
  assert.equal(counted.error.code, 'validation');
  assert.equal(counted.error.message, `Expected an array with at most ${LIMITS.lots} entries.`);

  const notes = 'x'.repeat(LIMITS.notes);
  const heavy = createEmptySnapshot(NOW);
  const lotBytes = new TextEncoder().encode(JSON.stringify(plainLot(uuid(), { notes }))).length + 1;
  while (heavy.lots.length * lotBytes < MAX_ROOT_BYTES - LIMITS.commandReplyBytes) heavy.lots.push(plainLot(uuid(), { notes }));
  const bounded = applyCommand(heavy, command('lot.save', {
    expectedRevision: null, lot: { title: 'One more', notes, sourceLinks: [] },
  }), context());
  assert.equal(bounded.ok, false);
  assert.equal(bounded.error.code, 'storage-bound');
  assert.match(bounded.error.message, /5 MiB/);
  assert.doesNotMatch(bounded.error.message, /reminder/i, 'no reminder is involved in this one');
});

test('writer preflights linked reminders when a lot activates their event', async () => {
  const current = createEmptySnapshot(NOW);
  for (let eventIndex = 0; eventIndex < 500; eventIndex += 1) {
    const eventId = uuid();
    current.auctionEvents.push({
      id: eventId, revision: 0, dataClass: 'collector', name: `Linked ${eventIndex}`,
      eventKind: 'auction-starts', precision: 'timed', localDate: '2026-09-20', localTime: '12:00',
      timeZone: 'UTC', startsAt: '2026-09-20T12:00:00.000Z', reminderScope: 'linked-lots',
      reminders: Array.from({ length: 20 }, (_, reminderIndex) => ({ id: uuid(), kind: 'offset', offsetMinutes: reminderIndex * 60 })),
      createdAt: NOW, updatedAt: NOW,
    });
    if (eventIndex < 499) current.lots.push({
      id: uuid(), revision: 0, dataClass: 'collector', title: `Lot ${eventIndex}`, auctionEventId: eventId,
      sourceLinks: [], bidHistory: [], outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW,
    });
  }
  const storage = memoryStorage(current);
  const writer = createCommandWriter(storage, context());
  const result = await writer.commitCommand(command('lot.save', {
    expectedRevision: null,
    lot: { title: 'Final linked lot', auctionEventId: current.auctionEvents.at(-1).id, sourceLinks: [] },
  }));
  assert.equal(result.ok, false);
  assert.match(result.message, /reminders.*5 MiB/i);
  assert.equal(storage.read().lots.length, 499);
});

test('linked-event reminders exist only while at least one linked lot stays open', () => {
  let state = reduce(createEmptySnapshot(NOW), command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Linked sale', eventKind: 'lot-closes', precision: 'timed',
      localDate: '2026-10-10', localTime: '12:00', timeZone: 'UTC',
      reminderScope: 'linked-lots', reminders: [{ kind: 'offset', offsetMinutes: 60 }],
    },
  }));
  const eventId = state.value.id;
  state = reduce(state.snapshot, command('scheduler.reconcile'));
  assert.equal(state.snapshot.alerts.length, 0);
  const lot = reduce(state.snapshot, command('lot.save', {
    expectedRevision: null,
    lot: { title: 'Linked lot', auctionEventId: eventId, sourceLinks: [] },
  }));
  state = reduce(lot.snapshot, command('scheduler.reconcile'));
  assert.equal(state.snapshot.alerts.length, 1);
  state = reduce(state.snapshot, command('lot.outcome.set', {
    lotId: lot.value.id, expectedRevision: 0, outcome: { status: 'passed' },
  }));
  state = reduce(state.snapshot, command('scheduler.reconcile'));
  assert.equal(state.snapshot.alerts.length, 0);
});

// The store the collector already has must open, whatever a crafted backup or an older build left in it. A revision no
// write could have counted to, and an event whose reminder falls outside the instants a record can hold, each made every
// later reconcile fail validation - and the background swallowed that, so the reminders simply stopped.
test('a root carrying an uncountable revision and an underivable reminder still opens, reconciles and exports', async () => {
  const stored = createEmptySnapshot(NOW);
  stored.lots.push({
    id: uuid(), revision: Number.MAX_SAFE_INTEGER, dataClass: 'collector', title: 'Nero denarius',
    sourceLinks: [], bidHistory: [], outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW,
  });
  const reminderId = uuid();
  stored.auctionEvents.push({
    id: uuid(), revision: 0, dataClass: 'collector', name: 'Year zero sale', eventKind: 'auction-starts',
    precision: 'timed', localDate: '2026-10-01', localTime: '00:00', timeZone: 'UTC',
    startsAt: '0000-01-01T00:00:00.000Z', reminderScope: 'standalone',
    reminders: [{ id: reminderId, kind: 'offset', offsetMinutes: 60 }], createdAt: NOW, updatedAt: NOW,
  });
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const opened = await writer.commitCommand(command('snapshot.get'));
  assert.equal(opened.ok, true, opened.message);
  assert.equal(opened.value.lots.length, 1, 'the coin is still there');
  assert.equal(opened.value.auctionEvents.length, 1, 'and so is the sale');
  assert.equal(opened.value.lots[0].revision, 0, 'counted again from a number the arithmetic can hold');

  const reconciled = await writer.commitCommand(command('scheduler.reconcile'));
  assert.equal(reconciled.ok, true, reconciled.message);
  const after = await writer.commitCommand(command('snapshot.get'));
  assert.equal(after.value.lots.length, 1);
  assert.equal(after.value.auctionEvents.length, 1);
  // The one reminder that cannot be spelled as an instant has no alert; nothing else is affected.
  assert.deepEqual(after.value.alerts, []);
  assert.equal(exportBackup(after.value, NOW).ok, true);
});

// A root and a document are held to different ceilings. Validation still accepts 2^52, because a store that already
// carries it has to open; but a record stopped there could never be written to again, so nothing is taken IN above the
// usable ceiling, and a stored root above it is counted again from zero.
const rootWithRevisions = (revision) => {
  const snapshot = createEmptySnapshot(NOW);
  const lotId = uuid();
  snapshot.lots.push({
    id: lotId, revision, dataClass: 'collector', title: 'Nero denarius', sourceLinks: [], bidHistory: [],
    outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW,
  });
  snapshot.preferences = {
    schemaVersion: SCHEMA_VERSION, revision, currency: 'USD', desktopAlertsEnabled: false, createdAt: NOW, updatedAt: NOW,
  };
  return { snapshot, lotId };
};

test('a backup carrying a revision no write could have produced is refused whole, in either mode', async () => {
  for (const revision of [LIMITS.revision, LIMITS.usableRevision + 1]) {
    for (const mode of ['replace', 'merge']) {
      const storage = memoryStorage(createEmptySnapshot(NOW));
      const writer = createCommandWriter(storage, context());
      const { snapshot } = rootWithRevisions(revision);
      const refused = await writer.commitCommand(command('backup.import', {
        expectedRevision: 0, mode, document: exportBackup(snapshot, NOW).value,
      }));
      assert.equal(refused.ok, false, `${mode} at ${revision}`);
      assert.match(refused.message, /crafted or corrupt/i);
      assert.deepEqual(storage.read().lots, [], 'nothing of the file reached storage');
    }
  }
});

test('a backup at the usable ceiling imports, and what it carries can still be saved', async () => {
  const storage = memoryStorage(createEmptySnapshot(NOW));
  const writer = createCommandWriter(storage, context());
  const { snapshot, lotId } = rootWithRevisions(LIMITS.usableRevision);
  const imported = await writer.commitCommand(command('backup.import', {
    expectedRevision: 0, mode: 'replace', document: exportBackup(snapshot, NOW).value,
  }));
  assert.equal(imported.ok, true, imported.message);
  const saved = await writer.commitCommand(command('lot.save', {
    expectedRevision: LIMITS.usableRevision,
    lot: { id: lotId, title: 'Nero denarius, retoned', sourceLinks: [] },
  }));
  assert.equal(saved.ok, true, saved.message);
  assert.equal(saved.value.revision, LIMITS.usableRevision + 1);
  const currency = await writer.commitCommand(command('preferences.save', {
    expectedRevision: LIMITS.usableRevision, preferences: { currency: 'EUR' },
  }));
  assert.equal(currency.ok, true, currency.message);
});

test('a stored root at the ceiling opens, is written to again and exports', async () => {
  const { snapshot, lotId } = rootWithRevisions(LIMITS.revision);
  const storage = memoryStorage(snapshot);
  const writer = createCommandWriter(storage, context());
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  let opened;
  try {
    opened = await writer.commitCommand(command('snapshot.get'));
  } finally {
    console.warn = realWarn;
  }
  assert.equal(opened.ok, true, opened.message);
  assert.equal(opened.value.lots.length, 1, 'the coin is still there');
  assert.equal(opened.value.lots[0].revision, 0, 'counted again from a number every later write can hold');
  assert.equal(opened.value.preferences.revision, 0);
  assert.equal(warnings.length, 1, 'one line for a support request, naming what was restarted');
  assert.match(warnings[0], /lots/);
  assert.match(warnings[0], new RegExp(lotId));

  const saved = await writer.commitCommand(command('lot.save', {
    expectedRevision: 0, lot: { id: lotId, title: 'Nero denarius, retoned', sourceLinks: [] },
  }));
  assert.equal(saved.ok, true, saved.message);
  assert.equal(storage.read().lots[0].revision, 1, 'the restart reached storage with the write');
  assert.equal(storage.read().preferences.revision, 0);

  // Idempotent: the root it wrote has nothing left to restart, so the next load says nothing.
  warnings.length = 0;
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  let after;
  try {
    after = await writer.commitCommand(command('snapshot.get'));
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(warnings, []);
  assert.equal(exportBackup(after.value, NOW).ok, true);
});

test('an ordinary root is read, not rewritten, on load', async () => {
  const { snapshot } = rootWithRevisions(3);
  const options = {};
  const storage = memoryStorage(snapshot, options);
  const writer = createCommandWriter(storage, context());
  const opened = await writer.commitCommand(command('snapshot.get'));
  assert.equal(opened.value.lots[0].revision, 3);
  assert.equal(opened.value.preferences.revision, 3);
  assert.equal(options.setCalled, undefined, 'a load is still a read');
  assert.deepEqual(storage.read(), structuredClone(snapshot));
});

// A replace takes the other install's records, not its schedule: that is derived again from the events it just took.
// Adopting the file's scheduler carried a wake time, and a revision, that belong to a store this one no longer is.
test('a replace import starts the schedule again instead of adopting the file’s', () => {
  const current = createEmptySnapshot(NOW);
  current.scheduler = { revision: 4, nextWakeAt: '2026-09-20T09:00:00.000Z', lastReconciledAt: NOW };
  const incoming = createEmptySnapshot(NOW);
  incoming.scheduler = { revision: 900, nextWakeAt: '2030-01-01T00:00:00.000Z', lastReconciledAt: NOW };
  const eventId = uuid();
  const reminderId = uuid();
  incoming.auctionEvents.push({
    id: eventId, revision: 0, dataClass: 'collector', name: 'Imported sale', eventKind: 'auction-starts',
    precision: 'timed', localDate: '2026-10-10', localTime: '12:00', timeZone: 'UTC',
    startsAt: '2026-10-10T12:00:00.000Z', reminderScope: 'standalone',
    reminders: [{ id: reminderId, kind: 'offset', offsetMinutes: 60 }], createdAt: NOW, updatedAt: NOW,
  });
  incoming.alerts.push({
    id: uuid(), revision: 3, dataClass: 'collector', triggerId: `${eventId}:${reminderId}:2026-10-10T11:00:00.000Z`,
    eventId, eventRevision: 0, reminderId, triggerAt: '2026-10-10T11:00:00.000Z',
    status: 'acknowledged', acknowledgedAt: NOW, createdAt: NOW, updatedAt: NOW,
  });
  const imported = reduce(current, command('backup.import', {
    expectedRevision: 0, mode: 'replace', document: exportBackup(incoming, NOW).value,
  }));
  assert.deepEqual(imported.snapshot.scheduler, { revision: 0, nextWakeAt: null, lastReconciledAt: null });
  // The acknowledgement is kept: its reminder came with the file, so the reconcile derives the same trigger again.
  assert.equal(imported.snapshot.alerts.length, 1);
  assert.equal(imported.snapshot.alerts[0].status, 'acknowledged');
  const reconciled = reduce(imported.snapshot, command('scheduler.reconcile'));
  assert.equal(reconciled.snapshot.alerts.length, 1);
  assert.equal(reconciled.snapshot.alerts[0].status, 'acknowledged');
});

// Every command that changes the schedule is followed by a reconcile that is not part of it. A command whose own
// projection could not be reconciled used to commit and leave the reconcile failing from then on, with nobody to tell.
test('a command whose reconcile would be invalid is refused rather than committed', () => {
  const current = createEmptySnapshot(NOW);
  current.scheduler = { revision: LIMITS.revision, nextWakeAt: null, lastReconciledAt: null };
  const result = applyCommand(current, command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Future sale', eventKind: 'auction-starts', precision: 'timed',
      localDate: '2026-10-10', localTime: '12:00', timeZone: 'UTC',
      reminderScope: 'standalone', reminders: [{ kind: 'offset', offsetMinutes: 60 }],
    },
  }), context());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'validation');
  assert.match(result.error.message, /reminders could not be scheduled/i);
  assert.equal(current.auctionEvents.length, 0);
});

test('backup import replaces through the same validated root mutation', () => {
  const current = createEmptySnapshot(NOW);
  const incoming = createEmptySnapshot(NOW);
  incoming.alternativeGroups.push({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 0, dataClass: 'collector',
    name: 'Imported', createdAt: NOW, updatedAt: NOW,
  });
  const document = exportBackup(incoming, NOW).value;
  const imported = reduce(current, command('backup.import', {
    expectedRevision: 0, mode: 'replace', document,
  }));
  assert.equal(imported.snapshot.alternativeGroups[0].name, 'Imported');
  assert.equal(imported.snapshot.revision, 1);
});

test('a merge import folds a duplicated auction lot into the local one and leaves it editable', () => {
  const auctionContext = { house: 'CNG', saleId: 'Triton XXIX', lotNumber: '42', pageUrl: 'https://house.test/lot/42' };
  const lot = (id, title) => ({
    id, revision: 0, dataClass: 'collector', title, sourceLinks: [], bidHistory: [],
    outcome: { status: 'open' }, outcomeHistory: [], auctionContext, createdAt: NOW, updatedAt: NOW,
  });
  const current = createEmptySnapshot(NOW);
  current.lots.push(lot(uuid(), 'Nero denarius'));
  const incoming = createEmptySnapshot(NOW);
  incoming.lots.push(lot(uuid(), 'Nero denarius from the other install'));
  const imported = reduce(current, command('backup.import', {
    expectedRevision: 0, mode: 'merge', document: exportBackup(incoming, NOW).value,
  }));
  assert.equal(imported.snapshot.lots.length, 1);
  assert.equal(imported.snapshot.lots[0].title, 'Nero denarius');
  const saved = reduce(imported.snapshot, command('lot.save', {
    expectedRevision: 0,
    lot: { id: imported.snapshot.lots[0].id, title: 'Nero denarius, retoned', sourceLinks: [], auctionContext },
  }));
  assert.equal(saved.value.title, 'Nero denarius, retoned');
});

// A lot the merge skips as a duplicate brings the other install's auction event with it, and that
// event merged by ID a moment earlier: one sale became two events, and its reminders fired twice.
const sameSale = { house: 'CNG', saleId: 'Triton XXIX', lotNumber: '42', pageUrl: 'https://house.test/lot/42' };
const saleEvent = (name) => ({
  id: uuid(), revision: 0, dataClass: 'collector', name, eventKind: 'auction-starts', precision: 'timed',
  localDate: '2026-10-10', localTime: '12:00', timeZone: 'UTC', startsAt: '2026-10-10T12:00:00.000Z',
  reminderScope: 'linked-lots', reminders: [{ id: uuid(), kind: 'offset', offsetMinutes: 60 }],
  createdAt: NOW, updatedAt: NOW,
});
const saleLot = (title, extra = {}) => ({
  id: uuid(), revision: 0, dataClass: 'collector', title, sourceLinks: [], bidHistory: [],
  outcome: { status: 'open' }, outcomeHistory: [], auctionContext: sameSale,
  createdAt: NOW, updatedAt: NOW, ...extra,
});

test('a merge that skips a duplicated lot keeps out the auction event it carried', () => {
  const current = createEmptySnapshot(NOW);
  const localEvent = saleEvent('Triton XXIX');
  current.auctionEvents.push(localEvent);
  current.lots.push(saleLot('Nero denarius', { auctionEventId: localEvent.id }));
  const incoming = createEmptySnapshot(NOW);
  const otherEvent = saleEvent('Triton XXIX (laptop)');
  incoming.auctionEvents.push(otherEvent);
  incoming.lots.push(saleLot('Nero denarius (laptop)', { auctionEventId: otherEvent.id }));

  const imported = reduce(current, command('backup.import', {
    expectedRevision: 0, mode: 'merge', document: exportBackup(incoming, NOW).value,
  }));
  assert.deepEqual(imported.snapshot.auctionEvents.map(({ id }) => id), [localEvent.id],
    'one sale, one auction event');
  assert.equal(imported.snapshot.lots.length, 1);
  const reconciled = reduce(imported.snapshot, command('scheduler.reconcile'));
  assert.equal(reconciled.snapshot.alerts.length, 1, 'and one reminder for it, not two');
});

// An import unioned the two bins by exact bytes, so the same record set aside on both installs -
// each at the moment that install repaired it - came through as two entries with two Restore
// buttons for one record. The import folds the way the repair does, in both modes.
test('a backup whose bin holds a record already set aside here leaves one entry', async () => {
  for (const mode of ['merge', 'replace']) {
    const record = { ...setAsideEvent(), eventKind: 'bring-your-own' };
    const stored = setAsideRoot([{
      collection: 'auctionEvents', record, reason: 'invalid-enum', quarantinedAt: LATER,
    }], []);
    const incoming = createEmptySnapshot(NOW);
    incoming.quarantine = [{
      collection: 'auctionEvents', record: structuredClone(record), reason: 'invalid-enum', quarantinedAt: NOW,
    }];
    const storage = memoryStorage(stored);
    const writer = createCommandWriter(storage, context());

    const imported = await writer.commitCommand(command('backup.import', {
      expectedRevision: 0, mode, document: exportBackup(incoming, NOW).value,
    }));
    assert.equal(imported.ok, true, imported.message);
    const bin = storage.read().quarantine;
    assert.equal(bin.length, 1, `one record set aside twice is one entry after a ${mode}`);
    assert.equal(bin[0].quarantinedAt, NOW, 'set aside when it first was');
    assert.equal(quarantineRows(bin).length, 1, 'so Settings offers one Restore');
  }
});

test('a merge links the lot it kept to the auction the backup knew about', () => {
  const current = createEmptySnapshot(NOW);
  const localLot = saleLot('Nero denarius');
  current.lots.push(localLot);
  const incoming = createEmptySnapshot(NOW);
  const otherEvent = saleEvent('Triton XXIX');
  incoming.auctionEvents.push(otherEvent);
  incoming.lots.push(saleLot('Nero denarius (laptop)', { auctionEventId: otherEvent.id }));

  const imported = reduce(current, command('backup.import', {
    expectedRevision: 0, mode: 'merge', document: exportBackup(incoming, NOW).value,
  }));
  assert.deepEqual(imported.snapshot.auctionEvents.map(({ id }) => id), [otherEvent.id]);
  assert.deepEqual(imported.snapshot.lots.map(({ id, auctionEventId }) => [id, auctionEventId]),
    [[localLot.id, otherEvent.id]], 'the lot that stayed is the one the sale is attached to');
  const reconciled = reduce(imported.snapshot, command('scheduler.reconcile'));
  assert.equal(reconciled.snapshot.alerts.length, 1);
  // The link is a change to a record the collector may have open, so it is stamped: a save holding
  // the revision from before the import is told rather than allowed to drop the link again.
  const stale = applyCommand(imported.snapshot, command('lot.save', {
    expectedRevision: localLot.revision, lot: { id: localLot.id, title: 'Nero denarius', sourceLinks: [] },
  }), context());
  assert.equal(stale.error.code, 'conflict');
});

test('a merge import commits with the local rows a conflict kept', () => {
  const observation = {
    id: uuid(), queryId: uuid(), source: 'manual', dataClass: 'collector', retrievedAt: NOW,
    houseSaleId: 'Sale 10', auctionHouse: 'House', auctionDate: '2026-01-02', lotNumber: '9',
    priceBasis: 'hammer', amount: { currency: 'EUR', minor: 12000 },
  };
  const row = { ...deduplicateEvidence([observation]).value.evidence[0], revision: 0, createdAt: NOW, updatedAt: NOW };
  const current = createEmptySnapshot(NOW);
  current.evidence.push(row);
  const incoming = createEmptySnapshot(NOW);
  const conflicting = structuredClone(row);
  conflicting.id = uuid();
  conflicting.observations[0].id = uuid();
  conflicting.observations[0].amount.minor = 14000;
  conflicting.resolved.hammer.minor = 14000;
  incoming.evidence.push(conflicting);
  incoming.alternativeGroups.push({
    id: uuid(), revision: 0, dataClass: 'collector', name: 'Imported', createdAt: NOW, updatedAt: NOW,
  });
  const imported = reduce(current, command('backup.import', {
    expectedRevision: 0, mode: 'merge', document: exportBackup(incoming, NOW).value,
  }));
  assert.deepEqual(imported.snapshot.evidence, [row]);
  assert.equal(imported.snapshot.alternativeGroups.length, 1, 'one conflict no longer blocks the rest');
  assert.equal(imported.value.counts.keptLocal, 1);
});

test('a merge import survives a reminder the other install replaced', () => {
  const event = {
    name: 'Sale', eventKind: 'auction-starts', precision: 'timed', localDate: '2026-10-10',
    localTime: '12:00', timeZone: 'Europe/London', reminderScope: 'standalone',
    reminders: [{ kind: 'offset', offsetMinutes: 60 }],
  };
  let local = reduce(createEmptySnapshot(NOW), command('event.save', { expectedRevision: null, event })).snapshot;
  local = reduce(local, command('scheduler.reconcile')).snapshot;
  assert.equal(local.alerts.length, 1);

  // The other install starts from the same records and rewrites the reminder, so the ID the local
  // alert was derived from no longer exists anywhere in the backup.
  const saved = local.auctionEvents[0];
  let other = structuredClone(local);
  other = reduce(other, command('event.save', {
    expectedRevision: saved.revision,
    event: { ...event, id: saved.id, reminders: [{ kind: 'offset', offsetMinutes: 120 }] },
  }), { now: () => LATER, newId: uuid }).snapshot;

  const imported = reduce(local, command('backup.import', {
    expectedRevision: local.revision, mode: 'merge', document: exportBackup(other, LATER).value,
  }), { now: () => LATER, newId: uuid });
  assert.deepEqual(imported.snapshot.auctionEvents[0].reminders[0].offsetMinutes, 120);
  assert.deepEqual(imported.snapshot.alerts, [], 'the stale alert is dropped, not the whole import');
  // The reconcile that follows an import derives the schedule again from the merged events.
  const reconciled = reduce(imported.snapshot, command('scheduler.reconcile'), { now: () => LATER, newId: uuid });
  assert.equal(reconciled.snapshot.alerts.length, 1);
  assert.equal(reconciled.snapshot.alerts[0].reminderId, imported.snapshot.auctionEvents[0].reminders[0].id);
});

test('a merge import takes the collection history the other install recorded', () => {
  const auctionContext = { house: 'CNG', saleId: 'Triton XXIX', lotNumber: '42', pageUrl: 'https://house.test/lot/42' };
  const local = reduce(createEmptySnapshot(NOW), command('lot.save', {
    expectedRevision: null, lot: { title: 'Nero denarius', sourceLinks: [], auctionContext },
  })).snapshot;
  const saved = local.lots[0];
  const other = reduce(structuredClone(local), command('lot.outcome.set', {
    lotId: saved.id, expectedRevision: saved.revision,
    outcome: { status: 'won', hammer: { currency: 'USD', minor: 50000 } },
    addToCollection: { title: 'Nero denarius', acquisitionDate: '2026-09-13', sourceLinks: [] },
  }), { now: () => LATER, newId: uuid }).snapshot;

  const imported = reduce(local, command('backup.import', {
    expectedRevision: local.revision, mode: 'merge', document: exportBackup(other, LATER).value,
  }), { now: () => LATER, newId: uuid });
  const [merged] = imported.snapshot.lots;
  assert.equal(merged.outcome.status, 'won');
  assert.equal(merged.collectionEntryId, other.lots[0].collectionEntryId);
  assert.deepEqual(
    imported.snapshot.collectionEntries.map(({ id }) => id),
    other.collectionEntries.map(({ id }) => id),
  );
  assert.equal(imported.value.counts.added, 1);
  // A won lot that already carries its entry cannot be added to the collection twice.
  const twice = applyCommand(imported.snapshot, command('lot.outcome.set', {
    lotId: merged.id, expectedRevision: merged.revision, outcome: merged.outcome,
    addToCollection: { title: 'again', acquisitionDate: '2026-09-13', sourceLinks: [] },
  }), context());
  assert.equal(twice.ok, false);
});

test('a lot the merge replaced refuses a save holding the pre-merge revision', () => {
  const shared = reduce(createEmptySnapshot(NOW), command('lot.save', {
    expectedRevision: null, lot: { title: 'Shared', sourceLinks: [] },
  })).snapshot;
  const id = shared.lots[0].id;
  // Both installs edit the same lot from the same starting revision, so the counters end up equal
  // and only the write times tell them apart.
  const local = reduce(structuredClone(shared), command('lot.save', {
    expectedRevision: 0, lot: { id, title: 'Desktop edit', sourceLinks: [], notes: 'desktop notes' },
  }), { now: () => LATER, newId: uuid }).snapshot;
  const other = reduce(structuredClone(shared), command('lot.save', {
    expectedRevision: 0, lot: { id, title: 'Laptop edit', sourceLinks: [] },
  }), { now: () => LATEST, newId: uuid }).snapshot;
  // What an editor opened before the import still holds.
  const basis = local.lots[0].revision;
  assert.equal(basis, other.lots[0].revision, 'per-install counters agree by accident');

  const imported = reduce(local, command('backup.import', {
    expectedRevision: local.revision, mode: 'merge', document: exportBackup(other, LATEST).value,
  }), { now: () => LATEST, newId: uuid });
  assert.equal(imported.snapshot.lots[0].title, 'Laptop edit');
  assert.equal(imported.snapshot.lots[0].notes, undefined, 'the backup replaced the local body');
  const stale = applyCommand(imported.snapshot, command('lot.save', {
    expectedRevision: basis, lot: { id, title: 'Desktop edit', sourceLinks: [] },
  }), context());
  assert.equal(stale.ok, false, 'a stale editor must be told, not allowed to save over the backup');
  assert.equal(stale.error.code, 'conflict');
});

// Every copy and every measurement made of a document is recursive, and a hand-made file can nest an
// object thousands of levels deep: the stack ran out and a RangeError came out of the command queue
// instead of a reply, so the page that asked was never answered at all.
test('a backup nested thousands of levels deep is answered, not thrown out of the writer', async () => {
  const nested = (depth) => `${'{"nested":'.repeat(depth)}null${'}'.repeat(depth)}`;
  const entry = `{"collection":"lots","reason":"invalid-record","quarantinedAt":"${NOW}","record":${nested(3000)}}`;
  const document = JSON.stringify({
    format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: NOW, data: createEmptySnapshot(NOW),
  }).replace('"lots":[]', `"quarantine":[${entry}],"lots":[]`);
  const storage = memoryStorage(createEmptySnapshot(NOW));
  const writer = createCommandWriter(storage, context());

  for (const mode of ['merge', 'replace']) {
    const refused = await writer.commitCommand(command('backup.import', {
      expectedRevision: 0, mode, document,
    }));
    assert.equal(refused.ok, false, mode);
    assert.equal(refused.code, 'validation', mode);
    assert.equal(refused.outcome, 'not-committed', mode);
    assert.match(refused.message, /Export raw data/,
      'and the collector is told the one thing that still works on data nobody here can read');
    assert.equal(Object.hasOwn(storage.read(), 'quarantine'), false, 'nothing of the file reached storage');
  }
  // The queue is still the collector's to write to.
  const saved = await writer.commitCommand(command('lot.save', {
    expectedRevision: null, lot: { title: 'Still writable', sourceLinks: [] },
  }));
  assert.equal(saved.ok, true, saved.message);
});

test('an imported root keeps only the keys the snapshot knows', () => {
  const data = createEmptySnapshot(NOW);
  // A hand-edited or hostile backup whose root carries an own "__proto__" key and an unknown one.
  const text = JSON.stringify({
    format: 'ancient-coin-auction-companion', schemaVersion: SCHEMA_VERSION, exportedAt: NOW, data,
  }).replace('"lots":[]', '"lots":[],"__proto__":{"polluted":true},"extraRootKey":1');
  assert.equal(
    Object.prototype.hasOwnProperty.call(JSON.parse(text).data, '__proto__'), true,
    'the fixture really does carry an own __proto__ key',
  );
  const imported = reduce(createEmptySnapshot(NOW), command('backup.import', {
    expectedRevision: 0, mode: 'replace', document: text,
  }));
  const root = imported.snapshot;
  assert.equal(Object.getPrototypeOf(root), Object.prototype, 'the live root keeps its prototype');
  assert.equal(root.polluted, undefined);
  assert.equal(({}).polluted, undefined);
  assert.equal('extraRootKey' in root, false, 'an unknown root key never reaches the store');
  assert.equal(Object.prototype.hasOwnProperty.call(root, '__proto__'), false);
  assert.equal(root.lots.length, 0);
  assert.equal(root.revision, 1);
});

test('adds manual evidence through authority metadata and resolves a conflicting retained claim', () => {
  let state = createEmptySnapshot(NOW);
  const queryId = uuid();
  const add = (source, minor) => command('evidence.add', {
    observation: {
      queryId, source, houseSaleId: 'Sale 7', auctionHouse: 'House',
      auctionDate: '2026-01-02', lotNumber: '14', priceBasis: 'hammer',
      amount: { currency: 'GBP', minor },
    },
  });
  const first = reduce(state, add('manual', 10000));
  state = first.snapshot;
  assert.equal(first.value.observations[0].dataClass, 'collector');
  assert.equal(first.value.revision, 0);
  const second = reduce(state, add('authorized-import', 12000));
  state = second.snapshot;
  assert.equal(state.evidence.length, 1);
  assert.equal(second.value.inclusion, 'excluded');
  assert.equal(second.value.exclusionReason, 'conflict');
  assert.equal(second.value.revision, 1);
  const selected = second.value.observations[1];
  const resolved = reduce(state, command('evidence.resolve', {
    evidenceId: second.value.id, expectedRevision: 1,
    resolution: { kind: 'observation', observationId: selected.id },
  }));
  assert.equal(resolved.value.inclusion, 'included');
  assert.equal(resolved.value.resolved.hammer.minor, 12000);
  assert.equal(resolved.value.resolved.resolution, 'collector-selected-observation');
  const third = reduce(resolved.snapshot, add('manual', 14000));
  assert.equal(third.value.inclusion, 'included');
  assert.equal(third.value.resolved.observationId, selected.id);
  assert.equal(third.value.resolved.hammer.minor, 12000);
});

test('public evidence entry accepts only manual or authorized-import provenance', () => {
  const result = applyCommand(createEmptySnapshot(NOW), command('evidence.add', {
    observation: {
      queryId: uuid(), source: 'coinarchives', auctionHouse: 'House',
      auctionDate: '2026-01-02', lotNumber: '14', priceBasis: 'hammer',
      amount: { currency: 'GBP', minor: 10000 },
    },
  }), context());
  assert.equal(result.error.code, 'validation');
});

test('acknowledges alerts by the public trigger ID while preserving future siblings', () => {
  let state = reduce(createEmptySnapshot(NOW), command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Near sale', eventKind: 'auction-starts', precision: 'timed',
      localDate: '2026-09-12', localTime: '12:10', timeZone: 'UTC',
      reminderScope: 'standalone', reminders: [
        { kind: 'offset', offsetMinutes: 20 }, { kind: 'offset', offsetMinutes: 5 },
      ],
    },
  })).snapshot;
  state = reduce(state, command('scheduler.reconcile')).snapshot;
  const due = state.alerts.find(({ status }) => status === 'due');
  const pending = state.alerts.find(({ status }) => status === 'pending');
  const acknowledged = reduce(state, command('alert.ack', { triggerIds: [due.triggerId] }));
  assert.equal(acknowledged.snapshot.alerts.find(({ triggerId }) => triggerId === due.triggerId).status, 'acknowledged');
  assert.equal(acknowledged.snapshot.alerts.find(({ triggerId }) => triggerId === pending.triggerId).status, 'pending');
});

function dueAlertState() {
  let state = reduce(createEmptySnapshot(NOW), command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Renamed sale', eventKind: 'auction-starts', precision: 'timed',
      localDate: '2026-09-12', localTime: '12:05', timeZone: 'UTC',
      reminderScope: 'standalone', reminders: [
        { kind: 'offset', offsetMinutes: 20 }, { kind: 'offset', offsetMinutes: 10 },
      ],
    },
  }));
  const event = state.value;
  state = reduce(state.snapshot, command('scheduler.reconcile'));
  const [first, second] = state.snapshot.alerts;
  state = reduce(state.snapshot, command('alert.ack', { triggerIds: [first.triggerId] }));
  state = reduce(state.snapshot, command('alert.snooze', {
    triggerIds: [second.triggerId], snoozedUntil: '2026-09-12T12:10:00.000Z',
  }));
  return { event, snapshot: state.snapshot };
}

function renameEvent(snapshot, event) {
  const stored = snapshot.auctionEvents.find(({ id }) => id === event.id);
  return reduce(snapshot, command('event.save', {
    expectedRevision: stored.revision,
    event: { ...structuredClone(stored), name: 'Renamed sale, corrected' },
  })).snapshot;
}

test('renaming an event keeps acknowledged and snoozed reminders through reconciliation', () => {
  const { event, snapshot } = dueAlertState();
  const reconciled = reduce(renameEvent(snapshot, event), command('scheduler.reconcile')).snapshot;
  assert.equal(reconciled.alerts.length, 2);
  assert.deepEqual(reconciled.alerts.map(({ status }) => status).sort(), ['acknowledged', 'snoozed']);
  const snoozed = reconciled.alerts.find(({ status }) => status === 'snoozed');
  assert.equal(snoozed.snoozedUntil, '2026-09-12T12:10:00.000Z');
  assert.equal(reconciled.alerts.every(({ eventRevision }) => eventRevision === 1), true);
});

test('reconciliation rewrites alert IDs stored in the older revision-scoped format', () => {
  const { event, snapshot } = dueAlertState();
  const legacy = structuredClone(snapshot);
  for (const alert of legacy.alerts) {
    alert.triggerId = `${alert.eventId}:${alert.eventRevision}:${alert.reminderId}:${alert.triggerAt}`;
  }
  const reconciled = reduce(renameEvent(legacy, event), command('scheduler.reconcile')).snapshot;
  assert.equal(reconciled.alerts.length, 2);
  assert.deepEqual(reconciled.alerts.map(({ status }) => status).sort(), ['acknowledged', 'snoozed']);
  assert.equal(reconciled.alerts.every(({ triggerId, eventId, reminderId, triggerAt }) =>
    triggerId === `${eventId}:${reminderId}:${triggerAt}`), true);
});

// The event form rebuilds its command from the fields it shows, so the reminder IDs only survive
// because workspace.js's mergeEventReminders carries them; this is that submitted shape.
test('an event edited through the workspace form keeps its reminder identities', () => {
  const { event, snapshot } = dueAlertState();
  const stored = snapshot.auctionEvents.find(({ id }) => id === event.id);
  const edited = reduce(snapshot, command('event.save', {
    expectedRevision: stored.revision,
    event: {
      id: stored.id, name: 'Renamed sale, corrected', eventKind: 'auction-starts',
      precision: 'timed', localDate: '2026-09-12', localTime: '12:05', timeZone: 'UTC',
      reminderScope: 'standalone',
      reminders: stored.reminders.map((reminder) => ({ ...reminder })),
    },
  })).snapshot;
  assert.deepEqual(edited.auctionEvents[0].reminders.map(({ id }) => id),
    stored.reminders.map(({ id }) => id));
  const reconciled = reduce(edited, command('scheduler.reconcile')).snapshot;
  assert.deepEqual(reconciled.alerts.map(({ status }) => status).sort(), ['acknowledged', 'snoozed']);
});

test('an unsupported stored schema is refused without being taken apart record by record', async () => {
  const stored = createEmptySnapshot(NOW);
  stored.schemaVersion = SCHEMA_VERSION + 1;
  // Judging a later version's records by today's validators is the bug, so the lot counts every
  // read of it: the repair cannot copy or validate a record without going through these.
  let readsOfTheLot = 0;
  stored.lots.push(Object.defineProperties({}, {
    id: { enumerable: true, get() { readsOfTheLot += 1; return '55555555-5555-4555-8555-555555555555'; } },
    title: { enumerable: true, get() { readsOfTheLot += 1; return 'Written by a later version'; } },
  }));
  // The shared fake clones on read, which would strip the getters before the store sees them.
  const storage = {
    async get(key) { return { [key]: stored }; },
    async set() { assert.fail('a root from a later version is left exactly as it is'); },
  };
  const writer = createCommandWriter(storage, context());

  const reply = await writer.commitCommand(command('snapshot.get'));
  assert.equal(reply.ok, false);
  assert.equal(reply.code, 'storage');
  assert.equal(readsOfTheLot, 0, 'a root we cannot read must not be walked record by record');
  const raw = await writer.commitCommand(command('snapshot.raw'));
  assert.equal(raw.value, stored, 'snapshot.raw is the escape hatch for a root we cannot read');
  assert.equal(readsOfTheLot, 0);
});

// The ledger is appended to and trimmed from the front everywhere else, and a retry can only be
// answered from an entry that is still there, so an overflowing one must lose its oldest rows.
test('a repaired ledger keeps its newest entries', async () => {
  const stored = createEmptySnapshot(NOW);
  const ledgerId = (index) => `11111111-0000-4000-8000-${String(index).padStart(12, '0')}`;
  for (let index = 0; index < LIMITS.recentCommands + 50; index += 1) {
    stored.recentCommands.push({
      requestId: ledgerId(index),
      commandType: 'lot.save',
      revision: index,
      committedAt: NOW,
      reply: { ok: true, requestId: ledgerId(index), revision: index, value: null },
    });
  }
  const writer = createCommandWriter(memoryStorage(stored), context());

  const reply = await writer.commitCommand(command('snapshot.get'));
  assert.equal(reply.ok, true);
  assert.equal(reply.value.recentCommands.length, LIMITS.recentCommands);
  assert.deepEqual(
    [reply.value.recentCommands[0].requestId, reply.value.recentCommands.at(-1).requestId],
    [ledgerId(50), ledgerId(LIMITS.recentCommands + 49)],
  );
});

test('claims an overdue event before notification delivery and records the outcome', () => {
  let state = reduce(createEmptySnapshot(NOW), command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Due sale', eventKind: 'auction-starts', precision: 'timed',
      localDate: '2026-09-12', localTime: '12:05', timeZone: 'UTC',
      reminderScope: 'standalone', reminders: [{ kind: 'offset', offsetMinutes: 10 }],
    },
  })).snapshot;
  state = reduce(state, command('scheduler.reconcile')).snapshot;
  const alert = state.alerts[0];
  const claimed = reduce(state, command('alert.claim', {
    eventId: alert.eventId, triggerIds: [alert.triggerId],
  }));
  assert.equal(claimed.snapshot.alerts[0].status, 'claimed');
  assert.equal(claimed.snapshot.alerts[0].attemptedAt, NOW);
  const delivered = reduce(claimed.snapshot, command('alert.delivery.record', {
    triggerIds: [alert.triggerId], delivered: true,
  }));
  assert.equal(delivered.snapshot.alerts[0].status, 'delivered');
  assert.equal(delivered.snapshot.alerts[0].deliveredAt, NOW);
});

test('failed notification delivery remains claimed until the five-minute retry', () => {
  let state = reduce(createEmptySnapshot(NOW), command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Due sale', eventKind: 'auction-starts', precision: 'timed',
      localDate: '2026-09-12', localTime: '13:00', timeZone: 'UTC',
      reminderScope: 'standalone', reminders: [{ kind: 'offset', offsetMinutes: 60 }],
    },
  })).snapshot;
  state = reduce(state, command('scheduler.reconcile')).snapshot;
  const alert = state.alerts[0];
  state = reduce(state, command('alert.claim', { eventId: alert.eventId, triggerIds: [alert.triggerId] })).snapshot;
  const failed = reduce(state, command('alert.delivery.record', { triggerIds: [alert.triggerId], delivered: false }));
  assert.equal(failed.snapshot.alerts[0].status, 'claimed');
  const waiting = reduce(failed.snapshot, command('scheduler.reconcile'), { now: () => '2026-09-12T12:00:01.000Z', newId: uuid });
  assert.equal(waiting.value.nextWakeAt, '2026-09-12T12:05:00.000Z');
  const retry = reduce(waiting.snapshot, command('scheduler.reconcile'), { now: () => '2026-09-12T12:05:00.000Z', newId: uuid });
  assert.equal(retry.snapshot.alerts[0].status, 'due');
  const reclaimed = reduce(retry.snapshot, command('alert.claim', { eventId: alert.eventId, triggerIds: [alert.triggerId] }), {
    now: () => '2026-09-12T12:05:00.000Z', newId: uuid,
  });
  const delivered = reduce(reclaimed.snapshot, command('alert.delivery.record', { triggerIds: [alert.triggerId], delivered: true }), {
    now: () => '2026-09-12T12:05:01.000Z', newId: uuid,
  });
  assert.equal(delivered.snapshot.alerts[0].status, 'delivered');
});

test('failed notification delivery expires without another retry after event relevance', () => {
  let state = reduce(createEmptySnapshot(NOW), command('event.save', {
    expectedRevision: null,
    event: {
      name: 'Ending sale', eventKind: 'auction-starts', precision: 'timed', localDate: '2026-09-12', localTime: '12:00', timeZone: 'UTC',
      reminderScope: 'standalone', reminders: [{ kind: 'offset', offsetMinutes: 1 }],
    },
  })).snapshot;
  state = reduce(state, command('scheduler.reconcile')).snapshot;
  const alert = state.alerts[0];
  state = reduce(state, command('alert.claim', { eventId: alert.eventId, triggerIds: [alert.triggerId] })).snapshot;
  state = reduce(state, command('alert.delivery.record', { triggerIds: [alert.triggerId], delivered: false })).snapshot;
  const expired = reduce(state, command('scheduler.reconcile'), { now: () => '2026-09-12T12:15:00.001Z', newId: uuid });
  assert.equal(expired.snapshot.alerts[0].status, 'missed');
  assert.equal(expired.value.nextWakeAt, null);
});

// Sample mode is gone, but a row a build that had it could have written must not take the store
// down with it. It never counted towards a median while it existed, so it is not quietly relabelled
// as the collector's own: it is set aside verbatim, where Data health shows it and a backup keeps it.
test('a stored evidence row still marked as sample is set aside rather than lost or counted', async () => {
  const observation = {
    id: uuid(), queryId: uuid(), source: 'manual', dataClass: 'sample', retrievedAt: NOW,
    houseSaleId: 'Sale 10', auctionHouse: 'House', auctionDate: '2026-01-02', lotNumber: '9',
    priceBasis: 'hammer', amount: { currency: 'EUR', minor: 12000 },
  };
  const sample = {
    id: uuid(), revision: 0, dataClass: 'sample', observations: [observation],
    saleIdentity: { auctionHouse: 'House', houseSaleId: 'Sale 10', lotNumber: '9' },
    inclusion: 'included',
    resolved: { priceBasis: 'hammer', hammer: { currency: 'EUR', minor: 12000 }, resolution: 'source-agreement' },
    createdAt: NOW, updatedAt: NOW,
  };
  const stored = createEmptySnapshot(NOW);
  stored.evidence.push(sample);
  const storage = memoryStorage(stored);
  const writer = createCommandWriter(storage, context());

  const reply = await writer.commitCommand(command('snapshot.get'));
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.value.evidence, []);
  assert.deepEqual(reply.value.quarantine.map(({ collection, record }) => [collection, record]),
    [['evidence', sample]]);
});

// A whole root as the 0.31.1 build left it in storage - written by that build, with the research
// form in its preferences, a preset with an increment ladder and one without, two lots (one with an
// outcome and a collection entry), an event with two reminders and the alerts they produced, a piece
// of evidence, a group, a draft, a row that build had already set aside, and its request ledger.
// Copied from what that writer produced rather than shaped to suit the migration.
const V1_ROOT = Object.freeze({
  schemaVersion: 1,
  revision: 10,
  updatedAt: NOW,
  preferences: {
    schemaVersion: 1, revision: 1, currency: 'GBP',
    catalogue: 'RIC', number: '306', volume: 'I (2nd edition)', section: 'Nero', sampleMode: true,
    desktopAlertsEnabled: true, createdAt: NOW, updatedAt: NOW,
    housePremiumPresets: [
      { name: 'CNG', buyerPremiumBps: 2000, incrementLadder: { currency: 'EUR', tiers: [{ from: 0, step: 500 }, { from: 10000, step: 1000 }] } },
      { name: 'Roma', buyerPremiumBps: 2400 },
    ],
  },
  lots: [
    { id: '00000000-0000-4000-8000-000000000010', revision: 0, dataClass: 'collector', createdAt: NOW, updatedAt: NOW,
      title: 'Athens owl', sourceLinks: [{ source: 'manual', url: 'https://example.test/lot' }], bidHistory: [],
      outcome: { status: 'open' }, outcomeHistory: [], notes: 'nice', auctionEventId: '00000000-0000-4000-8000-000000000006' },
    { id: '00000000-0000-4000-8000-000000000012', revision: 1, dataClass: 'collector', createdAt: NOW, updatedAt: NOW,
      title: 'Won coin', sourceLinks: [], bidHistory: [],
      outcome: { status: 'won', hammer: { currency: 'EUR', minor: 12000 }, verification: 'personal-unverified' },
      outcomeHistory: [{ id: '996e6cc2-190e-5d13-b922-ed9df65bb00a', from: 'open', to: 'won', recordedAt: NOW }],
      collectionEntryId: '00000000-0000-4000-8000-000000000014' },
  ],
  auctionEvents: [
    { id: '00000000-0000-4000-8000-000000000006', revision: 0, dataClass: 'collector', createdAt: NOW, updatedAt: NOW,
      name: 'Near sale', eventKind: 'auction-starts', precision: 'timed', localDate: '2026-09-12', localTime: '12:10',
      timeZone: 'UTC', startsAt: '2026-09-12T12:10:00.000Z', reminderScope: 'standalone',
      reminders: [
        { kind: 'offset', offsetMinutes: 20, id: '00000000-0000-4000-8000-000000000007' },
        { kind: 'offset', offsetMinutes: 5, id: '00000000-0000-4000-8000-000000000008' },
      ] },
  ],
  alternativeGroups: [
    { id: '00000000-0000-4000-8000-000000000004', revision: 0, dataClass: 'collector', createdAt: NOW, updatedAt: NOW, name: 'One owl' },
  ],
  evidence: [
    { id: 'a798446e-60c6-43d3-9601-b89ad69d8991', revision: 0, dataClass: 'collector', createdAt: NOW, updatedAt: NOW,
      saleIdentity: { auctionHouse: 'House', houseSaleId: 'Sale 7', lotNumber: '14' },
      observations: [{ id: '00000000-0000-4000-8000-000000000017', queryId: '00000000-0000-4000-8000-000000000015',
        source: 'manual', dataClass: 'collector', retrievedAt: NOW, houseSaleId: 'Sale 7', auctionHouse: 'House',
        auctionDate: '2026-01-02', lotNumber: '14', priceBasis: 'hammer', amount: { currency: 'GBP', minor: 10000 } }],
      inclusion: 'included',
      resolved: { priceBasis: 'hammer', hammer: { currency: 'GBP', minor: 10000 }, resolution: 'source-agreement' } },
  ],
  collectionEntries: [
    { id: '00000000-0000-4000-8000-000000000014', revision: 0, dataClass: 'collector', createdAt: NOW, updatedAt: NOW,
      lotId: '00000000-0000-4000-8000-000000000012', title: 'Won coin', acquisitionDate: '2026-09-12',
      sourceLinks: [], hammer: { currency: 'EUR', minor: 12000 } },
  ],
  drafts: [
    { id: '00000000-0000-4000-8000-000000000022', revision: 0, dataClass: 'collector', createdAt: NOW, updatedAt: NOW,
      kind: 'auction-capture', payload: { rawText: 'Auction x' }, expiresAt: '2026-09-12T12:30:00.000Z' },
  ],
  alerts: [
    { id: '00000000-0000-4000-8000-000000000019', revision: 1, dataClass: 'collector', createdAt: NOW, updatedAt: NOW,
      triggerId: '00000000-0000-4000-8000-000000000006:00000000-0000-4000-8000-000000000007:2026-09-12T11:50:00.000Z',
      eventId: '00000000-0000-4000-8000-000000000006', eventRevision: 0,
      reminderId: '00000000-0000-4000-8000-000000000007', triggerAt: '2026-09-12T11:50:00.000Z', status: 'due' },
    { id: '00000000-0000-4000-8000-000000000020', revision: 0, dataClass: 'collector', createdAt: NOW, updatedAt: NOW,
      triggerId: '00000000-0000-4000-8000-000000000006:00000000-0000-4000-8000-000000000008:2026-09-12T12:05:00.000Z',
      eventId: '00000000-0000-4000-8000-000000000006', eventRevision: 0,
      reminderId: '00000000-0000-4000-8000-000000000008', triggerAt: '2026-09-12T12:05:00.000Z', status: 'pending' },
  ],
  scheduler: { revision: 1, nextWakeAt: '2026-09-12T12:05:00.000Z', lastReconciledAt: NOW },
  recentCommands: [
    { requestId: '00000000-0000-4000-8000-000000000009', commandType: 'group.save', revision: 3, committedAt: NOW,
      reply: { ok: true, requestId: '00000000-0000-4000-8000-000000000009', revision: 3, value: { name: 'One owl' } } },
    { requestId: '00000000-0000-4000-8000-000000000021', commandType: 'draft.save', revision: 10, committedAt: NOW,
      reply: { ok: true, requestId: '00000000-0000-4000-8000-000000000021', revision: 10, value: { kind: 'auction-capture' } } },
  ],
  quarantine: [
    { collection: 'lots', record: { id: 'not-a-uuid', title: 42 }, reason: 'invalid-string', quarantinedAt: NOW },
  ],
});

// The five keys the research form kept in the durable root, which version two drops.
const RESEARCH_FORM_KEYS = ['catalogue', 'number', 'volume', 'section', 'sampleMode'];

function versionTwoOf(root) {
  const migrated = structuredClone(root);
  migrated.schemaVersion = 2;
  migrated.preferences.schemaVersion = 2;
  for (const key of RESEARCH_FORM_KEYS) delete migrated.preferences[key];
  return migrated;
}

// Storage that says how often it was written to, and with what: migration is a read-time repair, so
// a start-up on a version 1 root must not be a write at all, and the write that does come must be
// the one whole root this store has always set.
function countingStorage(initial) {
  const storage = memoryStorage(initial);
  const sets = [];
  return {
    ...storage,
    sets,
    async set(items) { sets.push(structuredClone(items[STORAGE_KEY])); return storage.set(items); },
  };
}

test('a stored version one root migrates on read, keeps every record, and is rewritten once', async () => {
  const storage = countingStorage(V1_ROOT);
  const writer = createCommandWriter(storage, context());

  // The rescue copy is the stored bytes, before any repair: a collector who exports it here gets
  // what the older build wrote.
  const raw = await writer.commitCommand(command('snapshot.raw'));
  assert.deepEqual(raw.value, V1_ROOT);

  const read = await writer.commitCommand(command('snapshot.get'));
  assert.equal(read.ok, true, read.message);
  assert.deepEqual(read.value, versionTwoOf(V1_ROOT));
  // Reading is not writing, and a migration is not an edit: nothing was stored and no revision moved.
  assert.deepEqual(storage.sets, []);
  assert.deepEqual(storage.read(), V1_ROOT);
  assert.equal(read.revision, V1_ROOT.revision);

  // The first real write is what puts version two in storage - as one whole-root set, with the five
  // research-form keys gone and every collection exactly as the older build left it.
  const saved = await writer.commitCommand(command('lot.save', {
    expectedRevision: null, lot: { title: 'Added later', sourceLinks: [] },
  }));
  assert.equal(saved.ok, true, saved.message);
  assert.equal(storage.sets.length, 1);
  const stored = storage.read();
  const expected = versionTwoOf(V1_ROOT);
  expected.revision = V1_ROOT.revision + 1;
  expected.lots.push(stored.lots.at(-1));
  expected.recentCommands.push(stored.recentCommands.at(-1));
  assert.deepEqual(stored, expected);
  assert.deepEqual(storage.sets[0], stored);
  assert.equal(stored.lots.at(-1).title, 'Added later');
  assert.equal(stored.recentCommands.at(-1).commandType, 'lot.save');

  // The page that read the older root holds its preferences revision; migration did not move it, so
  // the save it was already composing still lands.
  const preferences = await writer.commitCommand(command('preferences.save', {
    expectedRevision: V1_ROOT.preferences.revision, preferences: { currency: 'EUR' },
  }));
  assert.equal(preferences.ok, true, preferences.message);
  assert.equal(preferences.value.currency, 'EUR');
  assert.equal(preferences.value.revision, V1_ROOT.preferences.revision + 1);
  for (const key of RESEARCH_FORM_KEYS) assert.equal(key in preferences.value, false, key);
});

// The same root as a file, which is how it arrives from an install still on the older build.
const versionOneDocument = () => JSON.stringify({
  format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: NOW,
  data: { ...structuredClone(V1_ROOT), recentCommands: [], drafts: [] },
});

test('a version one backup document imports through the writer, replacing or merging', async () => {
  const replaced = createCommandWriter(countingStorage(createEmptySnapshot(NOW)), context());
  const replace = await replaced.commitCommand(command('backup.import', {
    expectedRevision: 0, mode: 'replace', document: versionOneDocument(),
  }));
  assert.equal(replace.ok, true, replace.message);
  const after = await replaced.commitCommand(command('snapshot.get'));
  assert.equal(after.value.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(after.value.preferences.housePremiumPresets, V1_ROOT.preferences.housePremiumPresets);
  for (const key of RESEARCH_FORM_KEYS) assert.equal(key in after.value.preferences, false, key);
  for (const collection of ['lots', 'auctionEvents', 'evidence', 'collectionEntries', 'alternativeGroups']) {
    assert.deepEqual(after.value[collection], V1_ROOT[collection], collection);
  }

  // A merge keeps this install's own preferences, so the older file's research form has no way back in.
  const local = createEmptySnapshot(NOW);
  local.preferences = {
    schemaVersion: SCHEMA_VERSION, revision: 0, currency: 'CHF', desktopAlertsEnabled: false,
    createdAt: NOW, updatedAt: NOW,
  };
  const merged = createCommandWriter(countingStorage(local), context());
  const merge = await merged.commitCommand(command('backup.import', {
    expectedRevision: 0, mode: 'merge', document: versionOneDocument(),
  }));
  assert.equal(merge.ok, true, merge.message);
  const folded = await merged.commitCommand(command('snapshot.get'));
  assert.equal(folded.value.preferences.currency, 'CHF');
  for (const key of RESEARCH_FORM_KEYS) assert.equal(key in folded.value.preferences, false, key);
  assert.deepEqual(folded.value.lots, V1_ROOT.lots);
});
