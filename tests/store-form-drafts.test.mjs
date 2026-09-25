import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORM_DRAFT_MAX_AGE_MS, FORM_DRAFT_PREFIX, createFormDraftStore, formDraftOfferText,
} from '../extension/store-form-drafts.js';

// The page's session storage, as a map.
function sessionArea({ throws = false } = {}) {
  const items = new Map();
  return {
    items,
    getItem(key) { if (throws) throw new Error('blocked'); return items.has(key) ? items.get(key) : null; },
    setItem(key, value) { if (throws) throw new Error('blocked'); items.set(key, String(value)); },
    removeItem(key) { if (throws) throw new Error('blocked'); items.delete(key); },
  };
}

test('X-14: typing in a coin, auction or want editor is kept and read back with the record it edits', () => {
  const area = sessionArea();
  let clock = 1_000_000;
  const drafts = createFormDraftStore(area, { now: () => clock });
  assert.equal(drafts.save('lot', { title: 'Nero denarius', reference: 'RIC I² 306', watched: true }), true);
  assert.equal(drafts.save('event', { name: 'Leu 30' }, { recordId: 'event-1', revision: 4 }), true);
  clock += 60_000;
  assert.deepEqual(drafts.load('lot'), {
    fields: { title: 'Nero denarius', reference: 'RIC I² 306', watched: true }, savedAt: 1_000_000, recordId: null, revision: null,
  });
  assert.deepEqual(drafts.load('event'), { fields: { name: 'Leu 30' }, savedAt: 1_000_000, recordId: 'event-1', revision: 4 });
  assert.equal(drafts.load('want'), null);
  assert.deepEqual([...area.items.keys()].sort(), [`${FORM_DRAFT_PREFIX}event`, `${FORM_DRAFT_PREFIX}lot`]);

  drafts.discard('lot');
  assert.equal(drafts.load('lot'), null);
});

test('X-14: a form with nothing typed keeps nothing, and clears what it kept', () => {
  const area = sessionArea();
  const drafts = createFormDraftStore(area);
  drafts.save('lot', { title: 'Nero' });
  assert.equal(drafts.save('lot', { title: '  ', watched: false }), false);
  assert.equal(drafts.load('lot'), null);
  assert.equal(area.items.size, 0);
});

test('X-14: only known editors and a plain shape are kept; anything else read back is dropped', () => {
  const area = sessionArea();
  const drafts = createFormDraftStore(area);
  assert.equal(drafts.save('settings', { currency: 'EUR' }), false, 'not an editor this keeps');
  assert.equal(drafts.save('lot', { __proto__: 'x' }), false);
  drafts.save('lot', { title: 'Nero', note: { nested: true }, count: 3, 'bad name': 'x' });
  assert.deepEqual(drafts.load('lot').fields, { title: 'Nero' }, 'only text and ticks under plain names');
  assert.equal(drafts.save('lot', { title: 'x'.repeat(5001) }), false, 'a value longer than any field holds is refused');

  for (const damaged of ['not json', '{"fields":[]}', '{"fields":{"title":"Nero"}}', JSON.stringify({ fields: { title: 'Nero' }, savedAt: 'soon' })]) {
    area.items.set(`${FORM_DRAFT_PREFIX}want`, damaged);
    assert.equal(drafts.load('want'), null, damaged);
  }
});

test('X-14: a draft older than a week is not offered back', () => {
  const area = sessionArea();
  let clock = 0;
  const drafts = createFormDraftStore(area, { now: () => clock });
  drafts.save('want', { reference: 'RIC I² Nero 306' });
  clock = FORM_DRAFT_MAX_AGE_MS;
  assert.ok(drafts.load('want'));
  clock += 1;
  assert.equal(drafts.load('want'), null);
});

test('X-14: storage the browser refuses keeps nothing and never throws', () => {
  const blocked = createFormDraftStore(sessionArea({ throws: true }));
  assert.equal(blocked.save('lot', { title: 'Nero' }), false);
  assert.equal(blocked.load('lot'), null);
  blocked.discard('lot');
  const none = createFormDraftStore(null);
  assert.equal(none.save('lot', { title: 'Nero' }), false);
  assert.equal(none.load('lot'), null);
});

test('X-14: the offer says what the collector was doing', () => {
  const draft = { fields: { title: 'x' }, savedAt: 0, recordId: null, revision: null };
  assert.equal(formDraftOfferText('lot', draft), 'You were adding a coin');
  assert.equal(formDraftOfferText('event', draft), 'You were adding an auction');
  assert.equal(formDraftOfferText('lot', { ...draft, recordId: 'lot-1' }, 'Nero denarius'), 'You were editing “Nero denarius”');
  assert.equal(formDraftOfferText('want', { ...draft, recordId: 'want-1' }), 'You were editing a want');
});
