import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptySnapshot } from '../extension/core/records.js';
import { exportBackup } from '../extension/core/backup.js';
import { MAX_ROOT_BYTES, STORAGE_KEY, applyCommand, createCommandWriter } from '../extension/store.js';

const NOW = '2026-09-12T12:00:00.000Z';
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

test('migrates preferences once and bounds shared drafts by expiry and count', () => {
  let state = createEmptySnapshot(NOW);
  const prefs = { currency: 'GBP', catalogue: 'RIC', number: '306', volume: 'I (2nd edition)', section: 'Nero', sampleMode: true };
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
  assert.equal(reply.value.schemaVersion, 1);
  assert.equal(storage.read().recentCommands.length, 0);
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
