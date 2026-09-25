// The want list (G-22 / Q-13): a reference the collector is looking for, its record and its validation, the store's
// commands for it, its place in backups, merges and the CSV, and the catalogue rules it is matched by.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS, createEmptySnapshot, quarantineEntryId, quarantineInvalidRecords, validateQuarantinedRecord, validateSnapshot, validateWant,
} from '../extension/core/records.js';
import { WANT_GRADES } from '../extension/core/fields.js';
import { STORAGE_KEY, applyCommand, createCommandWriter } from '../extension/store.js';
import { createWorkspaceBackground } from './helpers/dom.mjs';

const NOW = '2026-09-25T12:00:00.000Z';
const WANT_ID = '11111111-1111-4111-8111-111111111111';
const LOT_ID = '22222222-2222-4222-8222-222222222222';

function makeWant(overrides = {}) {
  return {
    id: WANT_ID, revision: 0, dataClass: 'collector', createdAt: NOW, updatedAt: NOW,
    reference: 'RIC II Trajan 253',
    ...overrides,
  };
}

test('a want is a reference, with notes, a maximum price in one currency and a lowest grade, all optional', () => {
  assert.deepEqual(WANT_GRADES, ['F', 'VF', 'EF', 'AU']);
  assert.equal(validateWant(makeWant()).ok, true);
  assert.equal(validateWant(makeWant({ notes: 'Good portrait only', maxPrice: { currency: 'EUR', minor: 80000 }, minGrade: 'VF' })).ok, true);
  assert.equal(validateWant(makeWant({ foundLotId: LOT_ID, foundAt: NOW })).ok, true);
  for (const [overrides, path] of [
    [{ reference: '' }, 'want.reference'],
    [{ reference: '   ' }, 'want.reference'],
    [{ reference: 'R'.repeat(LIMITS.shortText + 1) }, 'want.reference'],
    [{ reference: 253 }, 'want.reference'],
    [{ notes: '' }, 'want.notes'],
    [{ notes: 'n'.repeat(LIMITS.notes + 1) }, 'want.notes'],
    [{ maxPrice: { currency: 'EUR', minor: 0 } }, 'want.maxPrice.minor'],
    [{ maxPrice: { currency: 'EUR', minor: 12.5 } }, 'want.maxPrice'],
    [{ maxPrice: { currency: 'XXX', minor: 100 } }, 'want.maxPrice'],
    [{ maxPrice: '800 EUR' }, 'want.maxPrice'],
    [{ minGrade: 'Good VF' }, 'want.minGrade'],
    [{ minGrade: 'vf' }, 'want.minGrade'],
    [{ foundLotId: 'not-a-lot' , foundAt: NOW }, 'want.foundLotId'],
    [{ foundLotId: LOT_ID }, 'want.foundAt'],
    [{ foundAt: NOW }, 'want.foundAt'],
    [{ dataClass: 'sample' }, 'want.dataClass'],
  ]) {
    const result = validateWant(makeWant(overrides));
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal(result.error.path, path, JSON.stringify(overrides));
  }
});

test('the want list is an optional collection: a root without one is valid, and one with one is held to it', () => {
  const empty = createEmptySnapshot(NOW);
  assert.equal(Object.hasOwn(empty, 'wants'), false, 'a new root carries no want list until the first want');
  assert.equal(validateSnapshot(empty).ok, true);
  assert.equal(validateSnapshot({ ...empty, wants: [] }).ok, true);
  assert.equal(validateSnapshot({ ...empty, wants: [makeWant()] }).ok, true);
  const invalid = validateSnapshot({ ...empty, wants: [makeWant({ minGrade: 'XF' })] });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.path, 'wants[0].minGrade');
  assert.equal(validateSnapshot({ ...empty, wants: {} }).ok, false);
  const twice = validateSnapshot({ ...empty, wants: [makeWant(), makeWant({ reference: 'Price 112' })] });
  assert.equal(twice.ok, false);
  assert.equal(twice.error.code, 'duplicate-id');
  const tooMany = Array.from({ length: LIMITS.wants + 1 }, (_, index) => makeWant({ id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}` }));
  assert.equal(validateSnapshot({ ...empty, wants: tooMany }).ok, false);
});

test('a want that stops validating is set aside on its own, and can be put back', () => {
  const root = { ...createEmptySnapshot(NOW), wants: [makeWant(), makeWant({ id: '33333333-3333-4333-8333-333333333333', minGrade: 'XF' })] };
  const repaired = quarantineInvalidRecords(root, NOW);
  assert.equal(repaired.ok, true);
  assert.deepEqual(repaired.value.wants.map(({ id }) => id), [WANT_ID]);
  assert.deepEqual(repaired.value.quarantine, [{ collection: 'wants', record: root.wants[1], reason: 'invalid-enum', quarantinedAt: NOW }]);
  assert.equal(validateQuarantinedRecord('wants', makeWant()).ok, true, 'a want is a record that can go back');
  // A want list that is no list is set aside whole; every other record stays.
  const broken = quarantineInvalidRecords({ ...createEmptySnapshot(NOW), wants: { reference: 'RIC 1' } }, NOW);
  assert.equal(broken.ok, true);
  assert.equal(Object.hasOwn(broken.value, 'wants'), false);
  assert.equal(broken.value.quarantine[0].collection, 'wants');
  // A root with no want list is repaired without one.
  assert.equal(Object.hasOwn(quarantineInvalidRecords(createEmptySnapshot(NOW), NOW).value, 'wants'), false);
});

// --- The store's commands -------------------------------------------------------------------------

let nextId = 1;
const uuid = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
const context = (now = NOW) => ({ now: () => now, newId: uuid });
const command = (type, fields = {}) => ({ type, requestId: uuid(), ...fields });
function reduce(snapshot, input, ctx = context()) {
  const result = applyCommand(snapshot, input, ctx);
  assert.equal(result.ok, true, result.error?.message);
  return result.value;
}

test('want.save adds a want, keeps only what the collector wrote, and writes the list with its first want', () => {
  const empty = createEmptySnapshot(NOW);
  const added = reduce(empty, command('want.save', { expectedRevision: null, want: {
    reference: '  RIC II Trajan 253 ', notes: 'Good portrait', maxPrice: { currency: 'EUR', minor: 80000 }, minGrade: 'VF',
    foundLotId: LOT_ID, foundAt: NOW, revision: 7, dataClass: 'authorized',
  } }));
  assert.deepEqual(added.value, {
    id: added.value.id, revision: 0, dataClass: 'collector', createdAt: NOW, updatedAt: NOW,
    reference: 'RIC II Trajan 253', notes: 'Good portrait', maxPrice: { currency: 'EUR', minor: 80000 }, minGrade: 'VF',
  }, 'the found fields and the bookkeeping are the store’s, never the page’s');
  assert.deepEqual(added.snapshot.wants, [added.value]);
  // Blank and null fields are left off.
  const bare = reduce(added.snapshot, command('want.save', { expectedRevision: null, want: { reference: 'Price 112', notes: '  ', maxPrice: null, minGrade: null } }));
  assert.deepEqual(Object.keys(bare.value).sort(), ['createdAt', 'dataClass', 'id', 'reference', 'revision', 'updatedAt']);
  const refused = applyCommand(empty, command('want.save', { expectedRevision: null, want: { reference: 'Price 1', id: WANT_ID } }), context());
  assert.equal(refused.error.path, 'want.id');
  for (const [want, path] of [
    [{ reference: '' }, 'want.reference'], [{ reference: 'RIC 1', maxPrice: { currency: 'EUR', minor: 0 } }, 'want.maxPrice.minor'],
    [{ reference: 'RIC 1', minGrade: 'Fine' }, 'want.minGrade'], [null, 'want'],
  ]) {
    const result = applyCommand(empty, command('want.save', { expectedRevision: null, want }), context());
    assert.equal(result.ok, false, JSON.stringify(want));
    assert.equal(result.error.path, path, JSON.stringify(want));
  }
});

test('want.save edits a want at its revision and keeps it found; want.delete takes the list away with its last want', () => {
  let state = reduce(createEmptySnapshot(NOW), command('lot.save', { expectedRevision: null, lot: { title: 'Trajan', reference: 'RIC II Trajan 253', sourceLinks: [] } }));
  const lot = state.value;
  state = reduce(state.snapshot, command('lot.outcome.set', { lotId: lot.id, expectedRevision: 0, outcome: { status: 'won', hammer: { currency: 'EUR', minor: 70000 } } }));
  state = reduce(state.snapshot, command('want.save', { expectedRevision: null, want: { reference: 'RIC II Trajan 253', minGrade: 'VF' } }));
  const want = state.value;
  state = reduce(state.snapshot, command('want.found', { wantId: want.id, expectedRevision: 0, lotId: lot.id }), context('2026-09-26T08:00:00.000Z'));
  assert.equal(state.value.foundLotId, lot.id);
  assert.equal(state.value.foundAt, '2026-09-26T08:00:00.000Z');
  const edited = reduce(state.snapshot, command('want.save', { expectedRevision: 1, want: { id: want.id, reference: 'RIC II Trajan 253', notes: 'Found at Künker' } }), context('2026-09-27T08:00:00.000Z'));
  assert.deepEqual(edited.value, {
    id: want.id, revision: 2, dataClass: 'collector', createdAt: NOW, updatedAt: '2026-09-27T08:00:00.000Z',
    reference: 'RIC II Trajan 253', notes: 'Found at Künker', foundLotId: lot.id, foundAt: '2026-09-26T08:00:00.000Z',
  }, 'the grade left out of the edit is gone, the found coin kept');
  const stale = applyCommand(edited.snapshot, command('want.save', { expectedRevision: 1, want: { id: want.id, reference: 'RIC II Trajan 254' } }), context());
  assert.equal(stale.error.code, 'conflict');
  assert.equal(applyCommand(edited.snapshot, command('want.delete', { wantId: want.id, expectedRevision: 1 }), context()).error.code, 'conflict');
  const deleted = reduce(edited.snapshot, command('want.delete', { wantId: want.id, expectedRevision: 2 }));
  assert.equal(deleted.value.id, want.id);
  assert.equal(Object.hasOwn(deleted.snapshot, 'wants'), false, 'no want list is left behind');
  assert.equal(validateSnapshot(deleted.snapshot).ok, true);
});

test('want.found names only a won coin, and lotId null takes it back', () => {
  let state = reduce(createEmptySnapshot(NOW), command('lot.save', { expectedRevision: null, lot: { title: 'Open coin', sourceLinks: [] } }));
  const open = state.value;
  state = reduce(state.snapshot, command('want.save', { expectedRevision: null, want: { reference: 'Price 112' } }));
  const want = state.value;
  const notWon = applyCommand(state.snapshot, command('want.found', { wantId: want.id, expectedRevision: 0, lotId: open.id }), context());
  assert.equal(notWon.ok, false);
  assert.equal(notWon.error.message, 'Only a coin you won can be what a want found.');
  assert.equal(applyCommand(state.snapshot, command('want.found', { wantId: want.id, expectedRevision: 0, lotId: LOT_ID }), context()).error.message, 'That coin is no longer saved.');
  assert.equal(applyCommand(state.snapshot, command('want.found', { wantId: want.id, expectedRevision: 0, lotId: null }), context()).error.message, 'This want is not marked found.');
  state = reduce(state.snapshot, command('lot.outcome.set', { lotId: open.id, expectedRevision: 0, outcome: { status: 'won' } }));
  state = reduce(state.snapshot, command('want.found', { wantId: want.id, expectedRevision: 0, lotId: open.id }));
  state = reduce(state.snapshot, command('want.found', { wantId: want.id, expectedRevision: 1, lotId: null }));
  assert.equal(Object.hasOwn(state.value, 'foundLotId'), false);
  assert.equal(Object.hasOwn(state.value, 'foundAt'), false);
  assert.equal(state.value.revision, 2);
});

test('the background worker answers the want commands, and a want set aside comes back, into a new list if need be', async () => {
  const background = await createWorkspaceBackground();
  for (const type of ['want.save', 'want.delete', 'want.found']) assert.equal(background.commandTypes.has(type), true, type);
  // A root holding one broken want: the load sets it aside, and Restore brings it back once its shape is today's.
  const root = { ...createEmptySnapshot(NOW), wants: [makeWant({ minGrade: 'XF' })] };
  const stored = new Map([[STORAGE_KEY, root]]);
  const area = {
    async get(key) { return stored.has(key) ? { [key]: structuredClone(stored.get(key)) } : {}; },
    async set(items) { for (const [key, value] of Object.entries(items)) stored.set(key, structuredClone(value)); },
  };
  const writer = createCommandWriter(area, context());
  const saved = await writer.commitCommand(command('want.save', { expectedRevision: null, want: { reference: 'Price 112' } }));
  assert.equal(saved.ok, true, saved.message);
  const after = stored.get(STORAGE_KEY);
  assert.deepEqual(after.wants.map(({ reference }) => reference), ['Price 112']);
  assert.equal(after.quarantine[0].collection, 'wants');
  // Put right in the bin by hand, as a later build's validator could accept it, it goes back beside the new one.
  const fixed = { ...after, quarantine: [{ ...after.quarantine[0], record: makeWant() }] };
  stored.set(STORAGE_KEY, fixed);
  const restored = await writer.commitCommand(command('quarantine.restore', { entryId: quarantineEntryId(fixed.quarantine[0]) }));
  assert.equal(restored.ok, true, restored.message);
  assert.deepEqual(stored.get(STORAGE_KEY).wants.map(({ reference }) => reference).sort(), ['Price 112', 'RIC II Trajan 253']);
  // And into a root that has no want list at all.
  const bare = { ...createEmptySnapshot(NOW), quarantine: [{ collection: 'wants', record: makeWant(), reason: 'invalid-enum', quarantinedAt: NOW }] };
  stored.set(STORAGE_KEY, bare);
  const intoNone = await writer.commitCommand(command('quarantine.restore', { entryId: quarantineEntryId(bare.quarantine[0]) }));
  assert.equal(intoNone.ok, true, intoNone.message);
  assert.deepEqual(stored.get(STORAGE_KEY).wants.map(({ id }) => id), [WANT_ID]);
});
