// The workspace page itself, driven like a page against the real store: its markup in the fake DOM,
// the real command writer behind the real bridge, and a second view writing through the same
// background when a case needs one. These are the editor-state checks docs/MANUAL-TEST.md used to
// ask a person to click through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceBackground, mountWorkspace, settle } from './helpers/dom.mjs';
import { COIN_REMOVED_NOTICE } from '../extension/workspace.js';

async function backgroundWithCoins(...titles) {
  const background = await createWorkspaceBackground();
  for (const title of titles) {
    const reply = await background.send({ type: 'lot.save', expectedRevision: null, lot: { title, sourceLinks: [] } });
    assert.equal(reply.ok, true, reply.message);
  }
  return background;
}
const storedLot = (background, title) => background.root().lots.find((lot) => lot.title === title);

async function fillNewAuction(page, name) {
  await page.type('event-form', 'name', name);
  await page.type('event-form', 'localDate', '2026-10-15');
  await page.type('event-form', 'localTime', '14:00');
}

test('an auction added from a coin whose details are unsaved is attached, and the next details save keeps it', async () => {
  const background = await backgroundWithCoins('Nero, denarius', 'Trajan, sestertius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.typeDetails('notes', 'Typed but not saved');
  await page.click('edit-selected-event');
  assert.equal(page.location.hash, '#auctions');
  await fillNewAuction(page, 'Roma Auction 31');
  await page.submit('event-form');

  const [event] = background.root().auctionEvents;
  assert.equal(event.name, 'Roma Auction 31');
  assert.equal(page.status(), 'Auction saved and attached to the coin.');
  assert.equal(page.location.hash, '#watchlist');
  assert.equal(storedLot(background, 'Nero, denarius').auctionEventId, event.id);
  const details = page.$('lot-form').elements;
  assert.equal(details.notes.value, 'Typed but not saved', 'the unsaved notes are still in the form');
  assert.equal(details.auctionEventId.value, event.id, 'the attachment followed into the dirty form');

  await page.saveDetails();
  const saved = storedLot(background, 'Nero, denarius');
  assert.equal(saved.notes, 'Typed but not saved');
  assert.equal(saved.auctionEventId, event.id, 'the details save did not undo the attachment');
  assert.equal(page.blocksUnload(), false);
});

test('typing in the auction form while its save is in flight keeps the typing and attaches nothing', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.click('edit-selected-event');
  await fillNewAuction(page, 'Roma Auction 31');
  const hold = background.holdReply('event.save');
  const saving = page.startSubmit('event-form');
  await hold.written;
  await settle();
  await page.type('event-form', 'name', 'Roma Auction 31, second session');
  hold.release();
  await saving;
  await settle();

  assert.equal(page.status(), 'Auction saved. The auction form changed while it was saving, so it was not attached to the coin. Attach it from coin details.');
  assert.equal(page.$('event-form').elements.name.value, 'Roma Auction 31, second session');
  assert.equal(page.$('event-form').hidden, false);
  assert.equal(background.root().auctionEvents.length, 1, 'no second event was written');
  assert.equal(storedLot(background, 'Nero, denarius').auctionEventId, undefined);
  assert.deepEqual(page.commands.filter(({ type }) => type === 'lot.save'), []);
  assert.equal(page.blocksUnload(), true, 'the later typing is still unsaved');
});

test('reload committed data refills only the form whose record another tab changed', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const tabA = await mountWorkspace({ background, hash: '#watchlist' });
  const tabB = await mountWorkspace({ background, hash: '#watchlist' });
  await tabA.openCoin('Nero, denarius');
  await tabA.typeDetails('notes', 'Tab A notes');
  await tabA.click('edit-selected-event');
  await tabA.type('event-form', 'name', 'Draft auction');

  await tabB.openCoin('Nero, denarius');
  await tabB.typeDetails('title', 'Nero, denarius (corrected)');
  await tabB.saveDetails();
  await settle();

  assert.equal(tabA.conflictBanner(), 'Committed data changed while the coin details form has unsaved input.');
  await tabA.click('reload-snapshot');
  assert.equal(tabA.conflictBanner(), '');
  const details = tabA.$('lot-form').elements;
  assert.equal(details.title.value, 'Nero, denarius (corrected)', 'the details form was refilled from the saved record');
  assert.equal(details.notes.value, '');
  assert.equal(tabA.$('event-form').hidden, false);
  assert.equal(tabA.$('event-form').elements.name.value, 'Draft auction', 'the auction form keeps every word');
  assert.equal(tabA.blocksUnload(), true, 'the auction form is still unsaved');
});

test('a coin removed in another tab while its editors are dirty clears them and says so', async () => {
  const background = await backgroundWithCoins('Nero, denarius', 'Trajan, sestertius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.typeDetails('notes', 'About to be lost');
  await page.type('bid-form', 'amount', '250');
  const lot = storedLot(background, 'Nero, denarius');
  assert.equal((await background.send({ type: 'lot.delete', lotId: lot.id, expectedRevision: lot.revision })).ok, true);
  await settle();

  assert.equal(page.status(), COIN_REMOVED_NOTICE);
  assert.equal(page.conflictBanner(), '', 'a removal is not a conflict');
  assert.equal(page.$('coin-editor').hidden, true);
  assert.equal(page.$('lot-form').elements.notes.value, '');
  assert.equal(page.$('bid-form').elements.amount.value, '');
  assert.equal(page.blocksUnload(), false, 'nothing unsaved is left to guard');
  await page.openCoin('Trajan, sestertius');
  assert.deepEqual(page.prompts, [], 'opening another coin asks about nothing');
});

test('a coin this page removes clears its editors without blaming another view', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.typeDetails('notes', 'Typed before removing');
  await page.click('delete-lot');
  assert.deepEqual(page.prompts, ['Remove “Nero, denarius”?']);
  assert.equal(background.root().lots.length, 0);
  assert.notEqual(page.status(), COIN_REMOVED_NOTICE);
  assert.equal(page.blocksUnload(), false);
});

test('the unsaved-changes guard holds exactly while a form has unsaved input', async () => {
  const background = await backgroundWithCoins('Nero, denarius', 'Trajan, sestertius');
  const page = await mountWorkspace({ background, hash: '#watchlist', confirmAnswers: [false] });
  assert.equal(page.blocksUnload(), false);
  await page.openCoin('Nero, denarius');
  assert.equal(page.blocksUnload(), false, 'opening a coin is not editing it');
  await page.typeDetails('notes', 'Unsaved');
  assert.equal(page.blocksUnload(), true);

  await page.openCoin('Trajan, sestertius');
  assert.deepEqual(page.prompts, ['Discard unsaved changes and open another coin?']);
  assert.equal(page.$('selected-title').textContent, 'Nero, denarius', 'declining keeps the coin open');
  assert.equal(page.$('lot-form').elements.notes.value, 'Unsaved');

  await page.saveDetails();
  assert.equal(storedLot(background, 'Nero, denarius').notes, 'Unsaved');
  assert.equal(page.blocksUnload(), false, 'a saved form needs no guard');
  await page.openCoin('Trajan, sestertius');
  assert.equal(page.prompts.length, 1, 'nothing left to discard, so nothing is asked');
});

test('Add coin after discarding starts clean: no second prompt, no guard, and the new coin saves', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.typeDetails('notes', 'Half-typed');
  await page.click('new-lot');
  assert.deepEqual(page.prompts, ['Discard unsaved changes and open another coin?']);
  assert.equal(page.$('lot-form').elements.notes.value, '', 'the discarded input is gone from the form');
  assert.equal(page.blocksUnload(), false);
  await page.click('new-lot');
  assert.equal(page.prompts.length, 1, 'the empty form is not asked about again');

  await page.typeDetails('title', 'Hadrian, denarius');
  await page.saveDetails();
  assert.deepEqual(background.root().lots.map((lot) => lot.title), ['Nero, denarius', 'Hadrian, denarius']);
  assert.equal(storedLot(background, 'Nero, denarius').notes, undefined, 'the discarded notes were never saved');
  assert.equal(page.blocksUnload(), false);
});

test('the standalone preview discards the details form on Add coin too', async () => {
  const page = await mountWorkspace();
  assert.equal(page.status(), 'Standalone preview: durable features are unavailable.');
  await page.click('new-lot');
  await page.typeDetails('title', 'Half-typed coin');
  await page.click('new-lot');
  assert.deepEqual(page.prompts, ['Discard unsaved changes and open another coin?']);
  assert.equal(page.$('lot-form').elements.title.value, '', 'the discarded input is gone from the form');
  await page.click('new-lot');
  assert.equal(page.prompts.length, 1, 'the empty form is not asked about again');
});

// A lot draft opened from the research popup is consumed by the save that adds its coin. Once the
// collector discards it, it belongs to no form, so a later save of another coin leaves it where it is.
async function backgroundWithDraft() {
  const background = await backgroundWithCoins('Kept coin');
  const draft = await background.send({ type: 'draft.save', kind: 'current-lot', payload: { target: 'watchlist', title: 'Captured coin', pageUrl: 'https://example.test/lot/1' } });
  assert.equal(draft.ok, true, draft.message);
  return { background, hash: `#lot-draft=${draft.value.id}`, draftId: draft.value.id };
}

test('a lot draft discarded by Add coin or by opening another coin is not consumed by a later save', async () => {
  for (const discard of [(page) => page.click('new-lot'), (page) => page.openCoin('Kept coin')]) {
    const { background, hash, draftId } = await backgroundWithDraft();
    const page = await mountWorkspace({ background, hash });
    assert.equal(page.$('lot-form').elements.title.value, 'Captured coin', 'the draft is in the form');
    await discard(page);
    assert.deepEqual(page.prompts, ['Discard unsaved changes and open another coin?']);
    await page.typeDetails('title', 'Another title');
    await page.saveDetails();
    assert.ok(page.commands.some(({ type }) => type === 'lot.save'), 'the details were saved');
    assert.deepEqual(page.commands.filter(({ type }) => type === 'draft.consume'), []);
    assert.deepEqual(background.root().drafts.map(({ id }) => id), [draftId]);
  }
});

test('the save that adds the drafted coin consumes its draft', async () => {
  const { background, hash, draftId } = await backgroundWithDraft();
  const page = await mountWorkspace({ background, hash });
  await page.saveDetails();
  await settle();
  assert.deepEqual(page.commands.filter(({ type }) => type === 'draft.consume').map((command) => command.draftId), [draftId]);
  assert.deepEqual(background.root().drafts, []);
  assert.ok(storedLot(background, 'Captured coin'));
});

// The History route's collection view, from records written through the store as the workspace
// writes them: an outcome saved as won with "Add a won coin to collection history", and comparables
// saved by hand under the coin's reference.
async function wonCoin(background, { title, reference, hammer, actualInvoice, acquisitionDate }) {
  const saved = await background.send({ type: 'lot.save', expectedRevision: null, lot: { title, sourceLinks: [], ...(reference ? { reference } : {}) } });
  const won = await background.send({
    type: 'lot.outcome.set', lotId: saved.value.id, expectedRevision: saved.value.revision,
    outcome: { status: 'won', hammer, ...(actualInvoice ? { actualInvoice } : {}) },
    addToCollection: { title, acquisitionDate, sourceLinks: [] },
  });
  assert.equal(won.ok, true, won.message);
}
async function savedComparable(background, queryLabel, lotNumber, amount) {
  const reply = await background.send({ type: 'evidence.add', observation: {
    queryId: `00000000-0000-4000-9000-${String(lotNumber).padStart(12, '0')}`, queryLabel, source: 'manual',
    auctionHouse: 'Test House', auctionDate: '2025-03-01', lotNumber: String(lotNumber), priceBasis: 'hammer', amount,
  } });
  assert.equal(reply.ok, true, reply.message);
}
const cells = (row) => row.querySelectorAll('th, td').map((cell) => cell.textContent);

test('the History route totals the collection per currency and shows each entry’s own saved comparables', async () => {
  const background = await createWorkspaceBackground();
  await wonCoin(background, { title: 'Philip I, antoninianus', reference: 'RIC 27b', hammer: { currency: 'EUR', minor: 20000 }, actualInvoice: { currency: 'EUR', minor: 25000 }, acquisitionDate: '2019-04-01' });
  await wonCoin(background, { title: 'Nero, denarius', reference: 'RIC 60', hammer: { currency: 'USD', minor: 50000 }, acquisitionDate: '2023-06-15' });
  await wonCoin(background, { title: 'Athens, owl', hammer: { currency: 'EUR', minor: 100000 }, acquisitionDate: '2021-01-20' });
  await savedComparable(background, 'RIC 27b', 1, { currency: 'EUR', minor: 15000 });
  await savedComparable(background, 'RIC 27b', 2, { currency: 'EUR', minor: 18000 });
  await savedComparable(background, 'RIC 27b', 3, { currency: 'EUR', minor: 30000 });
  await savedComparable(background, 'RIC 27b', 4, { currency: 'USD', minor: 99900 });
  const page = await mountWorkspace({ background, hash: '#history' });

  assert.equal(page.$('route-history').hidden, false);
  const collection = page.$('collection-list');
  assert.match(collection.querySelector('.collection-note').textContent, /your own records.*not an appraisal or a valuation.*no amount is converted/i);
  const table = collection.querySelector('#collection-totals');
  assert.deepEqual(cells(table.querySelector('thead').querySelector('tr')), ['Currency', 'Entries', 'Hammer', 'Invoice paid', 'Acquired']);
  assert.deepEqual(table.querySelector('tbody').querySelectorAll('tr').map(cells), [
    ['USD', '1', '$500.00', 'None recorded', '2023'],
    ['EUR', '2', '€1,200.00', '€250.00 (1 of 2)', '2019–2021'],
  ]);
  const lines = collection.querySelectorAll('.collection-comparables').map((line) => line.textContent);
  assert.deepEqual(lines, [
    'Your saved comparables for RIC 27b: median €180.00 from 3 in EUR',
    'No saved comparables for RIC 60 in USD',
    'No saved comparables: the coin has no reference to match',
  ]);
});

test('the History route says so when there is no collection yet', async () => {
  const background = await createWorkspaceBackground();
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Watched only', sourceLinks: [] } });
  const page = await mountWorkspace({ background, hash: '#history' });
  assert.equal(page.$('collection-totals'), null);
  assert.ok(page.$('collection-list').textContent.includes('No collection entries yet.'));
});

// The harness answers only what the background worker answers: a command type the worker does not
// list gets no reply at all, which a page sees as the worker being unreachable.
test('the harness refuses a command the background worker would not answer', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  const before = background.root();
  await assert.rejects(page.browser.runtime.sendMessage({ type: 'lot.purge', requestId: 'request-unlisted' }), /no reply/i);
  assert.deepEqual(background.root(), before, 'nothing was written');
  const listed = await page.browser.runtime.sendMessage({ type: 'snapshot.get', requestId: 'request-listed' });
  assert.equal(listed.ok, true);
});
