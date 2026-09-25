// The want list (G-22 / Q-13): a reference the collector is looking for, its record and its validation, the store's
// commands for it, its place in backups, merges and the CSV, and the catalogue rules it is matched by.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS, createEmptySnapshot, quarantineEntryId, quarantineInvalidRecords, validateQuarantinedRecord, validateSnapshot, validateWant,
} from '../extension/core/records.js';
import { WANT_GRADES } from '../extension/core/fields.js';
import { exportBackup, importChangeLines, previewImport, validateBackup } from '../extension/core/backup.js';
import { CSV_TABLES, csvFiles } from '../extension/core/csv.js';
import { formatMoney } from '../extension/core/money.js';
import {
  namesOneType, openWantsFor, sameWantedType, wantBadgeText, wantFromForm, wantReferenceProblem, wantTermsText, wantedReading, wonCoinsFor,
} from '../extension/core/wantlist.js';
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

// --- Backups, merges and the CSV ------------------------------------------------------------------

const LATER = '2026-09-26T12:00:00.000Z';
const OTHER_WANT = '44444444-4444-4444-8444-444444444444';
function wonLot(id, extra = {}) {
  return {
    id, revision: 1, dataClass: 'collector', title: 'Trajan denarius', reference: 'RIC II Trajan 253', sourceLinks: [], bidHistory: [],
    outcome: { status: 'won', hammer: { currency: 'EUR', minor: 70000 }, verification: 'personal-unverified' },
    outcomeHistory: [], createdAt: NOW, updatedAt: NOW, ...extra,
  };
}
const withWants = (...wants) => ({ ...createEmptySnapshot(NOW), wants });
const exported = (snapshot) => {
  const result = exportBackup(snapshot, LATER);
  assert.equal(result.ok, true, result.error?.message);
  return result.value;
};

test('a backup carries the want list, and a replace import brings it in whole', async () => {
  const want = makeWant({ notes: 'Only with a good portrait', maxPrice: { currency: 'CHF', minor: 120000 }, minGrade: 'EF' });
  const document = exported(withWants(want));
  assert.deepEqual(JSON.parse(document).data.wants, [want]);
  const incoming = validateBackup(document);
  assert.equal(incoming.ok, true, incoming.error?.message);
  const replaced = previewImport(createEmptySnapshot(NOW), incoming.value, 'replace', { now: LATER });
  assert.deepEqual(replaced.value.snapshot.wants, [want]);
  assert.equal(replaced.value.counts.incoming.wants, 1);
  assert.equal(replaced.value.counts.outgoing.wants, 0);
  // Through the store's own import, which copies only the root keys it knows.
  const background = await createWorkspaceBackground();
  const before = await background.send({ type: 'snapshot.get' });
  const reply = await background.send({ type: 'backup.import', mode: 'replace', expectedRevision: before.revision, document });
  assert.equal(reply.ok, true, reply.message);
  assert.deepEqual(background.root().wants, [want]);
  // A backup from before the want list replaces one that has it: replace is everything.
  const older = exported(createEmptySnapshot(NOW));
  const now = await background.send({ type: 'snapshot.get' });
  assert.equal((await background.send({ type: 'backup.import', mode: 'replace', expectedRevision: now.revision, document: older })).ok, true);
  assert.equal(Object.hasOwn(background.root(), 'wants'), false);
});

test('a merge takes new wants, settles one on both sides by its later write, and keeps the local list of an older backup', () => {
  const local = withWants(makeWant({ notes: 'local' }));
  const incoming = withWants(
    makeWant({ notes: 'from the other install', revision: 3, updatedAt: LATER }),
    makeWant({ id: OTHER_WANT, reference: 'Price 112' }),
  );
  const preview = previewImport(local, incoming, 'merge', { exportedAt: LATER, now: LATER });
  assert.equal(preview.ok, true, preview.error?.message);
  assert.deepEqual(preview.value.snapshot.wants.map(({ id, notes, revision }) => [id, notes ?? null, revision]),
    [[WANT_ID, 'from the other install', 4], [OTHER_WANT, null, 0]]);
  assert.equal(preview.value.counts.added, 1);
  assert.equal(preview.value.counts.updated, 1);
  assert.deepEqual(importChangeLines(preview.value), [
    `wants: "RIC II Trajan 253" is replaced by the backup's copy (backup ${LATER}, local ${NOW}), differing in notes`,
  ]);
  // A backup from before the want list keeps the local one; neither side having one leaves none.
  const older = previewImport(local, createEmptySnapshot(NOW), 'merge', { now: LATER });
  assert.deepEqual(older.value.snapshot.wants, local.wants);
  const none = previewImport(createEmptySnapshot(NOW), createEmptySnapshot(NOW), 'merge', { now: LATER });
  assert.equal(Object.hasOwn(none.value.snapshot, 'wants'), false);
  assert.equal(validateSnapshot(none.value.snapshot).ok, true);
});

test('a merged want found by a coin the merge skipped as a duplicate names the local copy of that coin', () => {
  const localLot = wonLot(LOT_ID, { auctionContext: { pageUrl: 'https://house.test/lot/7' } });
  const theirLot = wonLot('55555555-5555-4555-8555-555555555555', { auctionContext: { pageUrl: 'https://house.test/lot/7' } });
  const local = { ...createEmptySnapshot(NOW), lots: [localLot] };
  const incoming = { ...createEmptySnapshot(NOW), lots: [theirLot], wants: [makeWant({ foundLotId: theirLot.id, foundAt: NOW })] };
  const preview = previewImport(local, incoming, 'merge', { now: LATER });
  assert.equal(preview.ok, true, preview.error?.message);
  assert.equal(preview.value.duplicates.length, 1, 'the coin is the same auction lot');
  assert.equal(preview.value.snapshot.wants[0].foundLotId, LOT_ID);
});

test('the Want list CSV writes each want with its maximum in its own currency and the coin that found it', () => {
  const snapshot = {
    ...createEmptySnapshot(NOW),
    lots: [wonLot(LOT_ID)],
    wants: [
      makeWant({ notes: '=HYPERLINK("x")', maxPrice: { currency: 'GBP', minor: 65050 }, minGrade: 'VF', foundLotId: LOT_ID, foundAt: LATER }),
      makeWant({ id: OTHER_WANT, reference: 'Price 112' }),
    ],
  };
  assert.deepEqual(CSV_TABLES.map(({ key }) => key), ['lots', 'collection', 'bids', 'outcomes', 'wants']);
  assert.equal(CSV_TABLES.at(-1).label, 'Want list');
  const lines = csvFiles(snapshot).wants.replace(/^﻿/, '').trimEnd().split('\r\n');
  assert.deepEqual(lines, [
    '"want_id","reference","max_price","max_price_currency","min_grade","status","found_lot_id","found_lot_title","found_at","notes","created_at","updated_at"',
    `"${WANT_ID}","RIC II Trajan 253","650.50","GBP","Very Fine","Found","${LOT_ID}","Trajan denarius","${LATER}","'=HYPERLINK(""x"")","${NOW}","${NOW}"`,
    `"${OTHER_WANT}","Price 112","","","","Wanted","","","","","${NOW}","${NOW}"`,
  ]);
  assert.equal(csvFiles(createEmptySnapshot(NOW)).wants.replace(/^﻿/, '').trimEnd().split('\r\n').length, 1, 'no wants, the header alone');
});

// --- Matching by catalogue rules --------------------------------------------------------------------

test('a want matches the same type in any spelling the lookup reads, and never a neighbour', () => {
  for (const [left, right] of [
    ['RIC I² Nero 306', 'RIC I (second edition) Nero 306'],
    ['RIC II Trajan 253', 'ric ii trajan 253'],
    ['RIC II Trajan 253', 'RIC II Trajan 253; BMC 12'],
    ['RRC 44/5', 'Crawford 44/5'],
    ['Price 112', 'Price  112'],
    ['SC 2195.5c', 'SC 2195.5c'],
    ['RIC VII Antioch 1', 'RIC VII Antioch 1'],
  ]) assert.equal(sameWantedType(left, right), true, `${left} = ${right}`);
  for (const [left, right] of [
    ['RIC I² Nero 306', 'RIC I² Nero 306a'],
    ['RIC I² Nero 306', 'RIC I Nero 306'],
    ['RIC II Trajan 253', 'RIC II Trajan 254'],
    ['RIC II Trajan 253', 'RIC II Hadrian 253'],
    ['RIC II Trajan 253', 'RIC III Trajan 253'],
    ['RRC 44/5', 'RRC 44/5a'],
    ['Price 112', 'Price L112'],
    ['Price 112', 'SC 112'],
    ['RIC II Hadrian 1009', 'RIC II Hadrian 1009–1012'],
  ]) assert.equal(sameWantedType(left, right), false, `${left} ≠ ${right}`);
});

test('only a reading that names one type can be wanted or match one', () => {
  for (const reference of ['RIC 306', 'RIC II 253', 'RIC 268 (Elagabalus)', 'SNG Cop 123', 'RPC I 1234', 'HGC 4, 1218',
    'Sear 1234', 'Good VF', 'RIC IV 27 b.', '', '   ', null, 42]) {
    assert.equal(wantedReading(reference), null, String(reference));
    assert.notEqual(wantReferenceProblem(reference), '', String(reference));
    assert.equal(sameWantedType(reference, reference), false, `${reference} does not even match itself`);
  }
  // A dealer's dotted letter, as lot.js reads one, names two types.
  assert.equal(namesOneType({ catalogue: 'RIC', number: '27', volume: 'IV', section: 'Caracalla', dottedLetter: 'b' }), false);
  for (const reference of ['RIC I² Nero 306', 'RIC VII Antioch 1', 'RRC 44/5', 'Price 112', 'SC 2195.5c', 'CPE 12', 'Bopearachchi 5A', 'RIC II.3² Hadrian 1009-1012']) {
    assert.ok(wantedReading(reference), reference);
    assert.equal(wantReferenceProblem(reference), '', reference);
  }
  assert.equal(wantReferenceProblem('RIC 306'), 'A RIC reference names its volume and its ruler or mint, as a card does: RIC II Trajan 253, RIC VII Antioch 1.');
  // OCRE titles some types over a range, so a range is one type when it is written as the want was, and only then.
  assert.equal(sameWantedType('RIC II.3² Hadrian 1009-1012', 'RIC II, Part 3 (second edition) Hadrian 1009–1012'), true);
  assert.match(wantReferenceProblem('SNG Cop 123'), /^“SNG Cop 123” is not read as one catalogue type\./);
});

test('the open wants of a type are the ones not yet found; a stored want no rule reads matches nothing', () => {
  const wants = [
    makeWant({ reference: 'RIC I² Nero 306', maxPrice: { currency: 'EUR', minor: 80000 }, minGrade: 'VF' }),
    makeWant({ id: OTHER_WANT, reference: 'RIC I (second edition) Nero 306', foundLotId: LOT_ID, foundAt: NOW }),
    makeWant({ id: '66666666-6666-4666-8666-666666666666', reference: 'SNG Cop 123' }),
  ];
  assert.deepEqual(openWantsFor(wants, 'RIC I (second edition) Nero 306').map(({ id }) => id), [WANT_ID]);
  assert.deepEqual(openWantsFor(wants, { catalogue: 'RIC', number: '306', volume: 'I (2nd edition)', section: 'Nero' }).map(({ id }) => id), [WANT_ID], 'a reading already made');
  assert.deepEqual(openWantsFor(wants, 'SNG Cop 123'), []);
  assert.deepEqual(openWantsFor(wants, 'RIC 306'), []);
  assert.deepEqual(openWantsFor(undefined, 'RIC I² Nero 306'), []);
  assert.equal(wantBadgeText(openWantsFor(wants, 'RIC I² Nero 306')), 'On your want list · up to €800.00 · VF or better');
  assert.equal(wantBadgeText([makeWant()]), 'On your want list');
  assert.equal(wantBadgeText([]), '');
  assert.equal(wantTermsText(makeWant({ minGrade: 'F' })), 'Fine or better');
  assert.equal(wantTermsText(makeWant({ maxPrice: { currency: 'CHF', minor: 120000 } })), `up to ${formatMoney({ currency: 'CHF', minor: 120000 }, 'en-US', { narrow: true })}`);
});

test('a won coin of the type is the one a want can be marked found by', () => {
  const lots = [
    wonLot(LOT_ID),
    wonLot('77777777-7777-4777-8777-777777777777', { reference: 'RIC II Trajan 254' }),
    { ...wonLot('88888888-8888-4888-8888-888888888888'), outcome: { status: 'open' } },
    wonLot('99999999-9999-4999-8999-999999999999', { reference: undefined }),
  ];
  assert.deepEqual(wonCoinsFor(makeWant(), lots).map(({ id }) => id), [LOT_ID]);
});

test('the Want list form is read into a want, or names the field that stops it', () => {
  const wants = [makeWant(), makeWant({ id: OTHER_WANT, reference: 'Price 112', foundLotId: LOT_ID, foundAt: NOW })];
  assert.deepEqual(wantFromForm({ reference: ' RIC I² Nero 306 ', maxPrice: '1,200.50', currency: 'GBP', minGrade: 'EF', notes: 'Dark tone' }, { wants }),
    { ok: true, value: { reference: 'RIC I² Nero 306', maxPrice: { currency: 'GBP', minor: 120050 }, minGrade: 'EF', notes: 'Dark tone' } });
  assert.deepEqual(wantFromForm({ reference: 'Price 112', maxPrice: '', currency: 'EUR', minGrade: '', notes: '  ' }, { wants }),
    { ok: true, value: { reference: 'Price 112' } }, 'a found want of the type does not stop a new one');
  assert.deepEqual(wantFromForm({ id: WANT_ID, reference: 'ric ii trajan 253' }, { wants }).ok, true, 'an edit keeps its own reference');
  assert.deepEqual(wantFromForm({ reference: 'RIC II Trajan 253' }, { wants }),
    { ok: false, field: 'reference', message: 'RIC II Trajan 253 is already on your want list.' });
  assert.deepEqual(wantFromForm({ reference: 'RIC 306' }).field, 'reference');
  assert.deepEqual(wantFromForm({ reference: 'Price 1', maxPrice: 'lots', currency: 'EUR' }).field, 'maxPrice');
  assert.deepEqual(wantFromForm({ reference: 'Price 1', maxPrice: '0', currency: 'EUR' }).field, 'maxPrice');
  assert.deepEqual(wantFromForm({ reference: 'Price 1', minGrade: 'XF' }).field, 'minGrade');
  assert.deepEqual(wantFromForm({ reference: 'Price 1', maxPrice: '1.200,50', currency: 'EUR' }, { locale: 'de-DE' }).value.maxPrice, { currency: 'EUR', minor: 120050 });
});
