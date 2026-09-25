// The want list (G-22 / Q-13): a reference the collector is looking for, its record and its validation, the store's
// commands for it, its place in backups, merges and the CSV, and the catalogue rules it is matched by.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS, createEmptySnapshot, quarantineInvalidRecords, validateQuarantinedRecord, validateSnapshot, validateWant,
} from '../extension/core/records.js';
import { WANT_GRADES } from '../extension/core/fields.js';

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
