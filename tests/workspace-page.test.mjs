// The workspace page itself, driven like a page against the real store: its markup in the fake DOM,
// the real command writer behind the real bridge, and a second view writing through the same
// background when a case needs one. These are the editor-state checks docs/MANUAL-TEST.md used to
// ask a person to click through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceBackground, mountWorkspace, parseHtmlFile, settle } from './helpers/dom.mjs';
import { COIN_REMOVED_NOTICE } from '../extension/workspace-editing.js';
import { STORAGE_KEY } from '../extension/store.js';
import { exportBackup } from '../extension/core/backup.js';
import { csvFiles } from '../extension/core/csv.js';
import { formatMoney } from '../extension/core/money.js';
import { deriveReminderTriggers } from '../extension/core/reminders.js';

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
// A currency's stat row of the collection totals (G-17), read as the table row it replaced: currency, then each figure.
const totalRows = (page) => page.$('collection-totals').querySelectorAll('.collection-total-row')
  .map((row) => [row.querySelector('.collection-total-currency').textContent, ...row.querySelectorAll('.stat-value').map((value) => value.textContent)]);

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
  assert.equal(collection.querySelector('.why').children[0].textContent, 'Why', 'the reasons fold under one line');
  const labels = page.$('collection-totals').querySelectorAll('.collection-total-row')[0].querySelectorAll('.stat-label').map((label) => label.textContent);
  assert.deepEqual(labels, ['Entries', 'Hammer', 'Total cost', 'Invoice paid', 'Acquired']);
  // None of these coins had a bid with a premium rate or fees saved, so no total cost is guessed at.
  assert.deepEqual(totalRows(page), [
    ['USD', '1', '$500.00', 'Incomplete', 'None recorded', '2023'],
    ['EUR', '2', '€1,200.00', 'Incomplete', '€250.00 (1 of 2)', '2019–2021'],
  ]);
  const lines = page.$('history-list').querySelectorAll('.collection-comparables').map((line) => line.textContent);
  assert.deepEqual(lines, [
    'Your saved comparables for RIC 27b: median €180.00 from 3 in EUR',
    'No saved comparables for RIC 60 in USD',
    'No saved comparables: the coin has no reference to match',
  ]);
});

// N1: the History card of a won coin carries its real cost - the premium at the placed bid's rate, VAT on it and the
// fees saved with the bid - in one money line, and the collection totals it per currency.
test('a won coin’s History card and the collection totals show what it really cost', async () => {
  const background = await createWorkspaceBackground();
  const saved = await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Künker lot 1234', sourceLinks: [] } });
  const placed = await background.send({
    type: 'bid.place', lotId: saved.value.id, expectedRevision: 0,
    activeBid: { amount: { currency: 'EUR', minor: 150000 }, buyerPremiumBps: 2500 },
    costEstimate: { currency: 'EUR', shippingMinor: 1500, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1000, minimumBidMinor: 0, premiumVatBps: 1900 },
  });
  assert.equal(placed.ok, true, placed.message);
  const won = await background.send({
    type: 'lot.outcome.set', lotId: saved.value.id, expectedRevision: 1,
    outcome: { status: 'won', hammer: { currency: 'EUR', minor: 130000 } },
    addToCollection: { title: 'Künker lot 1234', acquisitionDate: '2026-09-20', sourceLinks: [] },
  });
  assert.equal(won.ok, true, won.message);
  await wonCoin(background, { title: 'Nero, denarius', hammer: { currency: 'EUR', minor: 50000 }, acquisitionDate: '2023-06-15' });
  const page = await mountWorkspace({ background, hash: '#history' });

  const card = page.$('history-list').children.find((item) => item.textContent.includes('Künker lot 1234'));
  const line = card.querySelector('.money-line');
  assert.deepEqual(line.children.map((cell) => cell.textContent), ['EUR', 'Hammer 1,300.00', 'Premium 325.00', 'Fees 76.75', 'Total 1,701.75']);
  assert.ok(card.textContent.includes('Premium 25% · VAT on premium 61.75 · shipping 15.00'));
  const nero = page.$('history-list').children.find((item) => item.textContent.includes('Nero, denarius'));
  assert.ok(nero.textContent.includes('Total incomplete: no buyer’s premium rate.'));
  assert.equal(nero.querySelector('.money-line').dataset.tone, 'warning');
  // The one figure that would complete it is a link to the coin's Outcome tab, on that field.
  const fix = nero.querySelectorAll('button').find((button) => button.textContent === 'Add the premium rate');
  await fix.click(); await settle();
  assert.equal(page.location.hash, '#watchlist');
  assert.equal(page.$('selected-title').textContent, 'Nero, denarius');
  assert.equal(page.$('detail-tab-outcome').getAttribute('aria-selected'), 'true');
  assert.ok(page.document.activeElement === page.$('outcome-form').elements.premium);
  const [eur] = totalRows(page);
  assert.deepEqual(eur, ['EUR', '2', '€1,800.00', '€1,701.75 (1 of 2)', 'None recorded', '2023–2026']);
  // G-17: one card per won coin - its collection entry sits under its money line, which is shown once.
  assert.equal(card.querySelectorAll('.money-line').length, 1);
  assert.ok(card.querySelector('.collection-since').textContent.startsWith('In your collection since '));
});

// N12: a collection entry is corrected in place on the History route - acquisition date, invoice paid, notes - and
// only what the collector changed is sent, so a later outcome correction still reaches everything else.
const entryCard = (page, title) => page.$('history-list').querySelectorAll('article').find((item) => item.textContent.includes(title));
test('a collection entry is corrected in place, and says the invoice is the collector’s own figure', async () => {
  const background = await createWorkspaceBackground();
  await wonCoin(background, { title: 'Nero, denarius', hammer: { currency: 'EUR', minor: 50000 }, actualInvoice: { currency: 'EUR', minor: 62500 }, acquisitionDate: '2023-06-15' });
  const page = await mountWorkspace({ background, hash: '#history' });
  const edit = entryCard(page, 'Nero, denarius').querySelectorAll('button').find((button) => button.textContent === 'Edit entry');
  await edit.click();
  const form = page.$('entry-edit-form');
  assert.equal(form.elements.acquisitionDate.value, '2023-06-15');
  assert.equal(form.elements.invoice.value, '625.00');
  assert.equal(form.elements.invoiceCurrency.value, 'EUR');
  await page.type('entry-edit-form', 'acquisitionDate', '2023-06-20');
  await page.type('entry-edit-form', 'invoice', '640');
  // Another view writes while the form is open: the page is drawn again, and what was typed stays.
  const other = await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Unrelated coin', sourceLinks: [] } });
  assert.equal(other.ok, true);
  await settle();
  assert.equal(page.$('entry-edit-form').elements.invoice.value, '640', 'typing survives a redraw');
  await page.type('entry-edit-form', 'notes', 'Tray 4, envelope from the sale');
  await page.submit('entry-edit-form');

  const [stored] = background.root().collectionEntries;
  assert.equal(stored.acquisitionDate, '2023-06-20');
  assert.deepEqual(stored.actualInvoice, { currency: 'EUR', minor: 64000 });
  assert.equal(stored.notes, 'Tray 4, envelope from the sale');
  assert.deepEqual(stored.editedFields, ['acquisitionDate', 'actualInvoice', 'notes']);
  assert.equal(page.$('entry-edit-form'), null, 'the form closes once saved');
  const card = entryCard(page, 'Nero, denarius');
  assert.ok(card.textContent.includes('Invoice paid €640.00 (your correction; the outcome records €625.00)'));
  assert.ok(card.textContent.includes('Tray 4, envelope from the sale'));
  assert.equal(card.querySelector('.collection-since').textContent, 'In your collection since Jun 20, 2023');
});

test('an entry form sends only what changed, refuses a bad amount beside the field, and Cancel keeps the entry', async () => {
  const background = await createWorkspaceBackground();
  await wonCoin(background, { title: 'Nero, denarius', hammer: { currency: 'EUR', minor: 50000 }, actualInvoice: { currency: 'EUR', minor: 62500 }, acquisitionDate: '2023-06-15' });
  const page = await mountWorkspace({ background, hash: '#history' });
  const open = () => entryCard(page, 'Nero, denarius').querySelectorAll('button').find((button) => button.textContent === 'Edit entry').click();
  await open(); await settle();
  await page.type('entry-edit-form', 'invoice', '6,40,0');
  await page.submit('entry-edit-form');
  const error = page.$('entry-edit-form').querySelector('.error');
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /digits with at most two decimal places/);
  const cancel = page.$('entry-edit-form').querySelectorAll('button').find((button) => button.textContent === 'Cancel');
  await cancel.click(); await settle();
  assert.equal(page.$('entry-edit-form'), null);
  assert.equal(background.root().collectionEntries[0].revision, 0, 'nothing was written');

  await open(); await settle();
  await page.type('entry-edit-form', 'notes', 'Only the notes');
  await page.submit('entry-edit-form');
  const sent = page.commands.filter(({ type }) => type === 'collection.update');
  assert.deepEqual(sent.map(({ entry }) => entry), [{ notes: 'Only the notes' }]);
  assert.deepEqual(background.root().collectionEntries[0].editedFields, ['notes']);
});

test('the History route says so when there is no collection yet', async () => {
  const background = await createWorkspaceBackground();
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Watched only', sourceLinks: [] } });
  const page = await mountWorkspace({ background, hash: '#history' });
  assert.equal(page.$('collection-totals'), null);
  assert.equal(page.$('collection-list').closest('.panel').hidden, true, 'no collection, no panel to say so');
  assert.equal(page.$('history-list').querySelector('.empty-state').querySelector('h3').textContent, 'Nothing settled yet');
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

// A comparable saved while a coin is open is saved under that coin's reference unless the collector
// typed another query, so the History route's own-comparables line can find it.
test('the Search route offers the open coin’s reference as the query, never over typed text', async () => {
  const background = await createWorkspaceBackground();
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Philip I, antoninianus', reference: 'RIC 27b', sourceLinks: [] } });
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Uncatalogued coin', sourceLinks: [] } });
  const page = await mountWorkspace({ background, hash: '#search' });
  assert.equal(page.$('research-query').value, '', 'no coin is open, so nothing is offered');

  await page.navigate('#watchlist');
  await page.openCoin('Philip I, antoninianus');
  await page.navigate('#search');
  assert.equal(page.$('research-query').value, 'RIC 27b');
  for (const [field, value] of [['auctionHouse', 'Test House'], ['lotNumber', '12'], ['auctionDate', '2025-03-01'], ['priceBasis', 'hammer'], ['amount', '180'], ['currency', 'EUR']]) {
    await page.type('evidence-form', field, value);
  }
  await page.submit('evidence-form');
  assert.deepEqual(background.root().evidence.flatMap((row) => row.observations.map((item) => item.queryLabel)), ['RIC 27b']);

  page.$('research-query').value = 'Philip I antoninianus Rome';
  await page.$('research-form').emit('input', { target: page.$('research-query') });
  await page.navigate('#watchlist');
  await page.navigate('#search');
  assert.equal(page.$('research-query').value, 'Philip I antoninianus Rome', 'typed text is never replaced');

  page.$('research-query').value = '';
  await page.navigate('#watchlist');
  await page.openCoin('Uncatalogued coin');
  await page.navigate('#search');
  assert.equal(page.$('research-query').value, '', 'a coin with no reference offers nothing');
});

// 0.34 (W2a): a lot draft captured from a page brings what the page stated about its sale - a photo link, an estimate, when it closes - each
// labelled as the page's, for the collector to keep or clear before anything is saved.
async function backgroundWithPageDraft(payload) {
  const background = await backgroundWithCoins();
  const draft = await background.send({ type: 'draft.save', kind: 'current-lot', payload: { target: 'watchlist', title: 'Captured coin', pageUrl: 'https://house.example/lot/27', ...payload } });
  assert.equal(draft.ok, true, draft.message);
  return { background, hash: `#lot-draft=${draft.value.id}` };
}

test('a lot draft shows the page’s photo, estimate and closing as the page’s, and saves only what the collector kept', async () => {
  const { background, hash } = await backgroundWithPageDraft({
    estimate: { minor: 120000, currency: 'EUR' }, closesAt: '2026-10-15T14:00+02:00', photoUrl: 'https://images.house.example/27.jpg',
  });
  const page = await mountWorkspace({ background, hash });
  const form = page.$('lot-form').elements;
  assert.equal(page.$('lot-page-values').hidden, false);
  const shown = page.$('lot-page-values').textContent;
  for (const phrase of ['from the page', 'EUR 1200.00', 'Photo URL 1', '2026-10-15T14:00+02:00']) assert.ok(shown.includes(phrase), phrase);
  assert.equal(form.photoUrl1.value, 'https://images.house.example/27.jpg');
  assert.equal(form.notes.value, 'Estimate from page: EUR 1200.00');
  assert.equal(form.pageAuction.checked, false, 'the auction is offered, not added');

  // The collector clears the photo and leaves the auction unticked: the estimate line is kept, and no auction is written.
  await page.typeDetails('photoUrl1', '');
  await page.saveDetails();
  const saved = storedLot(background, 'Captured coin');
  assert.equal(saved.notes, 'Estimate from page: EUR 1200.00');
  assert.equal(saved.coinDetails, undefined);
  assert.equal(saved.auctionEventId, undefined);
  assert.deepEqual(background.root().auctionEvents, []);
  assert.equal(page.$('lot-page-values').hidden, true, 'the page values go once the coin is saved');
});

test('ticking the offered auction saves it at the page’s instant and attaches it to the drafted coin', async () => {
  const { background, hash } = await backgroundWithPageDraft({ closesAt: '2026-10-15T14:00+02:00' });
  const page = await mountWorkspace({ background, hash });
  const box = page.$('lot-form').elements.pageAuction;
  box.checked = true;
  await page.$('lot-form').emit('input', { target: box });
  await page.saveDetails();
  await settle();
  const [event] = background.root().auctionEvents;
  assert.equal(event.startsAt, '2026-10-15T12:00:00.000Z');
  assert.equal(event.precision, 'timed');
  assert.equal(event.eventKind, 'lot-closes');
  assert.equal(event.name, 'Captured coin');
  assert.equal(event.capturedText, 'From the page: 2026-10-15T14:00+02:00');
  assert.equal(event.capturedFromUrl, 'https://house.example/lot/27');
  assert.equal(storedLot(background, 'Captured coin').auctionEventId, event.id);
});

test('an auction start the page gives is offered as the auction starting, and saved as one', async () => {
  const { background, hash } = await backgroundWithPageDraft({ startsAt: '2026-10-15T10:00+02:00' });
  const page = await mountWorkspace({ background, hash });
  assert.match(page.$('lot-page-values').textContent, /Add an auction starting 2026-10-15 \d\d:\d\d \(.+\) when saving, from the page \(2026-10-15T10:00\+02:00\)\./);
  page.$('lot-form').elements.pageAuction.checked = true;
  await page.saveDetails();
  await settle();
  const [event] = background.root().auctionEvents;
  assert.equal(event.eventKind, 'auction-starts');
  assert.equal(event.startsAt, '2026-10-15T08:00:00.000Z');
  assert.equal(storedLot(background, 'Captured coin').auctionEventId, event.id);
});

test('an auction the collector already chose wins over the one the page offers', async () => {
  const { background, hash } = await backgroundWithPageDraft({ closesAt: '2026-10-15' });
  const chosen = await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Chosen sale', eventKind: 'auction-day', precision: 'date-only',
    localDate: '2026-11-01', timeZone: 'UTC', reminderScope: 'standalone', reminders: [] } });
  const page = await mountWorkspace({ background, hash });
  page.$('lot-form').elements.pageAuction.checked = true;
  await page.typeDetails('auctionEventId', chosen.value.id);
  await page.saveDetails();
  await settle();
  assert.equal(background.root().auctionEvents.length, 1);
  assert.equal(storedLot(background, 'Captured coin').auctionEventId, chosen.value.id);
});

// 0.34 (W2a): the provenance the page lists is offered as rows of the Sourced provenance editor, with the lot page as each row's source; only the
// rows the collector ticks are saved.
test('the page’s provenance is offered as unticked rows, and only a ticked row is saved, sourced to the lot page', async () => {
  const { background, hash } = await backgroundWithPageDraft({ provenance: [
    { text: 'Ex Leu 7 (1973), lot 123', source: 'Leu 7', year: 1973, lot: '123' },
    { text: "Ex Hunt collection, Sotheby's 1991", source: "Hunt collection, Sotheby's", year: 1991 },
  ] });
  const page = await mountWorkspace({ background, hash });
  const rows = page.$('provenance-editor').querySelectorAll('.provenance-row');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('[name="provenanceText"]').value, 'Ex Leu 7 (1973), lot 123');
  assert.equal(rows[0].querySelector('[name="provenanceSourceUrl"]').value, 'https://house.example/lot/27');
  assert.ok(rows[0].textContent.includes('From the page: Leu 7, 1973, lot 123'));
  for (const row of rows) assert.equal(row.querySelector('[name="provenanceKeep"]').checked, false, 'nothing is kept unticked');
  assert.ok(page.$('lot-page-values').textContent.includes('Provenance from the page: 2 entries under Sourced provenance'));

  rows[1].querySelector('[name="provenanceKeep"]').checked = true;
  await page.saveDetails();
  const saved = storedLot(background, 'Captured coin');
  assert.deepEqual(saved.provenanceNotes.map(({ text, sourceUrl }) => [text, sourceUrl]), [["Ex Hunt collection, Sotheby's 1991", 'https://house.example/lot/27']]);
  assert.equal(saved.provenanceNotes[0].auctionDate, undefined, 'a year is not a day');
});

test('a draft whose rows are all left unticked saves no provenance', async () => {
  const { background, hash } = await backgroundWithPageDraft({ provenance: [{ text: 'Ex Hess 1958', source: 'Hess', year: 1958 }] });
  const page = await mountWorkspace({ background, hash });
  await page.saveDetails();
  assert.deepEqual(storedLot(background, 'Captured coin').provenanceNotes ?? [], []);
});

// 0.34 review (W2a, Important 1): the offered auction never stands between the collector and the coin. A refused auction write - here a closing
// that falls in the hour Europe/Zurich lives twice - still saves the coin, and the status says the auction was left off and why.
test('a refused offered auction still saves the coin and says why the auction was left off', async () => {
  const zone = process.env.TZ;
  process.env.TZ = 'Europe/Zurich';
  try {
    const { background, hash } = await backgroundWithPageDraft({ closesAt: '2026-10-25T00:30Z' });
    const page = await mountWorkspace({ background, hash });
    assert.ok(page.$('lot-page-values').textContent.includes('02:30 (Europe/Zurich)'));
    page.$('lot-form').elements.pageAuction.checked = true;
    await page.saveDetails();
    for (let tick = 0; tick < 20; tick += 1) await settle();
    assert.deepEqual(background.root().auctionEvents, []);
    const saved = storedLot(background, 'Captured coin');
    assert.ok(saved, 'the coin is saved');
    assert.equal(saved.auctionEventId, undefined);
    assert.equal(page.$('lot-action-status').textContent, 'Coin added to the watchlist. The auction from the page was not added: That local time occurs more than once in this time zone. Add it under Auction reminder.');
  } finally {
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
  }
});

// A reply lost on its way back leaves the auction written but unknown to the page. Saving again sends the same request, which the store's ledger
// answers with the auction it already wrote: one auction, and the coin attached to it.
test('saving again after a lost auction reply writes one auction and attaches the coin to it', async () => {
  const { background, hash } = await backgroundWithPageDraft({ closesAt: '2026-10-15T14:00+02:00' });
  const page = await mountWorkspace({ background, hash });
  const deliver = page.browser.runtime.sendMessage;
  let lost = false;
  page.browser.runtime.sendMessage = async (message) => {
    const reply = await deliver(message);
    if (message.type === 'event.save' && !lost) { lost = true; throw new Error('Could not establish connection. Receiving end does not exist.'); }
    return reply;
  };
  page.$('lot-form').elements.pageAuction.checked = true;
  await page.saveDetails();
  for (let tick = 0; tick < 20; tick += 1) await settle();
  assert.equal(background.root().auctionEvents.length, 1, 'the lost write did land');
  assert.equal(background.root().lots.length, 0, 'the coin waits while the worker is unreachable');
  await page.saveDetails();
  for (let tick = 0; tick < 20; tick += 1) await settle();
  const events = background.root().auctionEvents;
  assert.equal(events.length, 1);
  assert.equal(storedLot(background, 'Captured coin').auctionEventId, events[0].id);
  const sent = page.commands.filter(({ type }) => type === 'event.save').map(({ requestId }) => requestId);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
});

// W-01: a coin row reads title and amount on one line, the auction's day, time and how soon on the next, and its
// status as a pill of its own; the coin's attached auction and the Auctions list say the time the same way.
async function backgroundWithBidOnAuction() {
  const background = await createWorkspaceBackground();
  const event = await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Roma E-Sale 130', eventKind: 'lot-closes', precision: 'timed',
    localDate: '2030-10-01', localTime: '15:00', timeZone: 'Europe/London', reminderScope: 'linked-lots', reminders: [] } });
  assert.equal(event.ok, true, event.message);
  const lot = await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Nero, denarius', reference: 'RIC I² 306', sourceLinks: [], auctionEventId: event.value.id } });
  const placed = await background.send({ type: 'bid.place', lotId: lot.value.id, expectedRevision: lot.value.revision, activeBid: { amount: { currency: 'GBP', minor: 65000 }, buyerPremiumBps: 2000 } });
  assert.equal(placed.ok, true, placed.message);
  return background;
}

test('a coin row shows its amount beside the title, the auction’s time and how soon, and a status pill', async () => {
  const page = await mountWorkspace({ background: await backgroundWithBidOnAuction(), hash: '#watchlist' });
  const [row] = page.$('lot-list').children;
  assert.equal(row.querySelector('.coin-row-title').textContent, 'RIC I² 306');
  assert.equal(row.querySelector('.coin-row-amount').textContent, '£650.00');
  assert.match(row.querySelector('.coin-row-when').textContent, /^Closes Tue, Oct 1, 3:00 PM( London)? · in \d+ days$/);
  assert.equal(row.querySelector('.status-pill').textContent, 'Bid active');
  assert.equal(row.querySelector('.coin-row-event').textContent, 'Roma E-Sale 130');
  assert.equal(row.querySelector('.status-pill').dataset.tone, 'active');
  await page.openCoin('Nero, denarius');
  assert.match(page.$('attached-event').textContent, /^Roma E-Sale 130 · Closes Tue, Oct 1, 3:00 PM( London)? · in \d+ days$/);
  await page.navigate('#auctions');
  assert.match(page.$('event-list').textContent, /Closes Tue, Oct 1, 3:00 PM( London)? · in \d+ days/);
});

// N3: on an open lot the Outcome tab opens on Won in the bid's currency, asks no re-open question and offers no
// "Still open" no-op; ticking "Add to collection" with the date cleared stops in the page, beside the field, and
// saves nothing - the won outcome is not lost to a refused collection entry.
test('the Outcome tab opens an open lot on Won in its bid’s currency and checks the acquisition date in the page', async () => {
  const background = await backgroundWithBidOnAuction();
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const f = page.$('outcome-form').elements;
  assert.equal(f.status.value, 'won');
  assert.equal(f.hammerCurrency.value, 'GBP');
  assert.equal(f.invoiceCurrency.value, 'GBP');
  assert.equal(f.hammer.value, '');
  assert.equal(f.hammer.placeholder, 'Your bid 650.00');
  assert.equal(page.$('reopen-choice').hidden, true);
  assert.equal(page.$('open-outcome').closest('label').hidden, true, 'no no-op choice on an open lot');
  assert.equal(f.acquisitionDate.value, '2030-10-01', 'the auction’s day is offered');

  await page.type('outcome-form', 'hammer', '700');
  f.addToCollection.checked = true;
  await page.type('outcome-form', 'acquisitionDate', '');
  const sent = page.commands.length;
  await page.submit('outcome-form');
  assert.equal(page.commands.length, sent, 'nothing was sent');
  assert.equal(page.$('acquisition-error').textContent, 'Enter the acquisition date to add this coin to the collection.');
  assert.equal(page.$('acquisition-error').hidden, false);

  await page.type('outcome-form', 'acquisitionDate', '2030-10-01');
  await page.submit('outcome-form');
  const saved = storedLot(background, 'Nero, denarius');
  assert.equal(saved.outcome.status, 'won');
  assert.deepEqual(saved.outcome.hammer, { currency: 'GBP', minor: 70000 });
  assert.equal(background.root().collectionEntries[0].acquisitionDate, '2030-10-01');
  assert.equal(page.$('acquisition-error').hidden, true);
});

test('the re-open question appears only when a settled lot is set back to open', async () => {
  const background = await backgroundWithBidOnAuction();
  const lot = background.root().lots[0];
  assert.equal((await background.send({ type: 'lot.outcome.set', lotId: lot.id, expectedRevision: lot.revision, outcome: { status: 'won', hammer: { currency: 'GBP', minor: 70000 } } })).ok, true);
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  page.$('lot-queue').value = 'all-coins';
  await page.$('lot-queue').emit('change');
  await page.openCoin('Nero, denarius');
  assert.equal(page.$('outcome-form').elements.status.value, 'won');
  assert.equal(page.$('reopen-choice').hidden, true);
  assert.equal(page.$('open-outcome').closest('label').hidden, false, 'a settled lot can be re-opened');
  page.$('outcome-form').elements.status.value = 'open';
  await page.$('outcome-form').emit('change', { target: page.$('open-outcome') });
  assert.equal(page.$('reopen-choice').hidden, false);
});

// N4: a settled lot's bids cannot change, so its Bid tab says so and offers nothing to press; the Bid tab of an open
// lot shows the placed figure.
test('the Bid tab shows the placed bid, and a settled lot’s is closed with the reason', async () => {
  const background = await backgroundWithBidOnAuction();
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  assert.equal(page.$('bid-form').elements.amount.value, '650.00');
  assert.equal(page.$('bid-fields').disabled, false);
  assert.equal(page.$('bid-settled').hidden, true);

  page.$('outcome-form').elements.status.value = 'won';
  await page.type('outcome-form', 'hammer', '700');
  await page.submit('outcome-form');
  assert.equal(storedLot(background, 'Nero, denarius').outcome.status, 'won');
  assert.equal(page.$('bid-fields').disabled, true);
  assert.equal(page.$('bid-settled').hidden, false);
  assert.equal(page.$('bid-settled').textContent, 'Settled — re-open the lot under Outcome to change bids.');
});

// G-09: the Bid tab is one form for one figure. Under the maximum and premium a live line says what the bid costs all
// in; the house preset fills the premium, VAT and platform fee; the Fees fold is the fee sheet saved with the bid; the
// budget fold answers the highest hammer and puts it in the maximum. A bid saved again keeps the fee sheet it shows.
test('the Bid tab works out the all-in cost, the preset and the budget in one form, and saves the fee sheet with the bid', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  await background.send({ type: 'preferences.migrateIfAbsent', preferences: { currency: 'CHF', housePremiumPresets: [{ name: 'Leu', buyerPremiumBps: 2250 }, { name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900 }] } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const f = page.$('bid-form').elements;
  assert.deepEqual(f.preset.options.map((option) => option.textContent), ['No preset', 'Leu', 'Künker']);
  await page.type('bid-form', 'currency', 'CHF');
  await page.type('bid-form', 'amount', '1200');
  assert.equal(page.$('bid-live').textContent, 'Add the buyer’s premium to see what this bid costs all in.');
  f.preset.value = 'Leu'; await page.$('bid-form').emit('change', { target: f.preset }); await settle();
  assert.equal(f.premium.value, '22.5');
  assert.equal(page.$('bid-live').textContent, '≈ CHF\u00a01,470.00 all-in · premium CHF\u00a0270.00 · no fees recorded');
  await page.type('bid-form', 'shipping', '20');
  assert.equal(page.$('bid-live').textContent, '≈ CHF\u00a01,490.00 all-in · premium CHF\u00a0270.00 · fees CHF\u00a020.00');

  await page.type('bid-form', 'budget', '999');
  assert.equal(page.$('bid-budget-answer').textContent, 'Maximum hammer CHF\u00a0799.18 · CHF\u00a0999.00 all-in');
  await page.type('bid-form', 'increment', '10');
  assert.equal(page.$('bid-budget-answer').textContent, 'Maximum hammer CHF\u00a0790.00 · CHF\u00a0987.75 all-in');
  let prevented = false;
  await f.budget.emit('keydown', { key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'Enter in the budget box never saves a plan');
  await page.click('use-budget');
  assert.equal(f.amount.value, '790.00');

  await page.submit('bid-form', { value: 'plan' });
  const saved = storedLot(background, 'Nero, denarius');
  assert.deepEqual(saved.plannedBid, { amount: { currency: 'CHF', minor: 79000 }, buyerPremiumBps: 2250 });
  assert.deepEqual(saved.costEstimate, { currency: 'CHF', shippingMinor: 2000, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1000, minimumBidMinor: 0 });
  assert.equal(f.shipping.value, '20.00', 'the saved fee sheet is what the form shows again');
  assert.equal(f.increment.value, '10.00');
  assert.equal(f.paymentPercent.value, '', 'a fee of nothing beside a real one reads blank (Fix round, Minor 5)');
  // Clearing the sheet and the grid it shows takes it off the lot.
  for (const name of ['shipping', 'increment']) await page.type('bid-form', name, '');
  await page.submit('bid-form', { value: 'plan' });
  assert.equal(Object.hasOwn(storedLot(background, 'Nero, denarius'), 'costEstimate'), false);
});

// W-04: the details form keeps the five fields a lot page asks for open - title, reference, auction page, notes and
// auction - and folds the rest into sections that open themselves only when they hold something. Save, Undo and
// Remove sit in an action bar that stays in view and says when there are unsaved changes; the Outcome tab has one too.
test('the details form folds its optional sections until they hold a value, and its action bar shows unsaved changes', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Trajan, sestertius', sourceLinks: [], coinDetails: { photoUrls: [], weightMg: 25400 },
    provenanceNotes: [{ id: '00000000-0000-4000-9000-000000000001', text: 'Ex Leu 7', sourceUrl: 'https://leu.example/7', recordedAt: '2026-01-01T00:00:00.000Z' }] } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  const form = page.$('lot-form');
  for (const field of ['title', 'reference', 'auctionPageUrl', 'notes', 'auctionEventId']) assert.equal(form.elements[field].closest('details'), null, `${field} is always open`);
  const group = (name) => form.querySelector(`[data-group="${name}"]`);
  for (const field of ['auctionCanonicalUrl', 'auctionHouse', 'sourceUrl']) assert.equal(form.elements[field].closest('details'), group('identity'), field);
  assert.equal(form.elements.weightGrams.closest('details'), group('coin'));
  assert.equal(page.$('provenance-editor').closest('details'), group('provenance'));

  await page.openCoin('Nero, denarius');
  assert.deepEqual(['identity', 'coin', 'provenance'].map((name) => group(name).open), [false, false, false], 'nothing to show, all folded');
  await page.openCoin('Trajan, sestertius');
  assert.deepEqual(['identity', 'coin', 'provenance'].map((name) => group(name).open), [false, true, true], 'the sections holding values open');

  const bar = form.querySelector('.action-bar');
  assert.ok(bar.querySelector('button[type="submit"]'), 'Save details is in the bar');
  assert.equal(page.$('undo-lot').closest('.action-bar'), bar);
  assert.equal(page.$('delete-lot').closest('.action-bar'), bar);
  assert.equal(page.$('lot-dirty').hidden, true);
  await page.typeDetails('notes', 'Toned');
  assert.equal(page.$('lot-dirty').hidden, false);
  assert.equal(page.$('lot-dirty').textContent, 'Unsaved changes');
  await page.saveDetails();
  assert.equal(page.$('lot-dirty').hidden, true);

  const outcomeBar = page.$('outcome-form').querySelector('.action-bar');
  assert.ok(outcomeBar.querySelector('button[type="submit"]'));
  assert.equal(page.$('outcome-dirty').hidden, true);
  await page.type('outcome-form', 'hammer', '100');
  assert.equal(page.$('outcome-dirty').hidden, false);
});

test('a lot draft opens the sections the page filled', async () => {
  const { background, hash } = await backgroundWithPageDraft({ photoUrl: 'https://images.house.example/27.jpg', provenance: [{ text: 'Ex Hess 1958', source: 'Hess', year: 1958 }],
    auctionContext: { pageUrl: 'https://house.example/lot/27', house: 'House', saleId: '5', lotNumber: '27' } });
  const page = await mountWorkspace({ background, hash });
  const group = (name) => page.$('lot-form').querySelector(`[data-group="${name}"]`);
  assert.deepEqual(['identity', 'coin', 'provenance'].map((name) => group(name).open), [true, true, true]);
  assert.equal(page.$('lot-dirty').hidden, false, 'a draft is unsaved');
});

// W-03: the Reminders tab names the attached auction and its time, lists its reminders in words, and offers the
// standard two when it has none; with no auction it offers to attach one. Passed is explained only when it is off.
test('the Reminders tab shows the attached auction and offers the standard reminders when it has none', async () => {
  const background = await backgroundWithBidOnAuction();
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const tab = page.$('selected-reminders');
  assert.match(tab.querySelector('.reminder-event').textContent, /^Roma E-Sale 130 · Closes Tue, Oct 1, 3:00 PM/);
  assert.ok(tab.textContent.includes('No reminders set.'));
  const add = page.$('add-standard-reminders');
  assert.equal(add.textContent, 'Add the standard two (1 day and 1 hour before)');
  await page.click('add-standard-reminders');
  const [event] = background.root().auctionEvents;
  assert.deepEqual(event.reminders.map((reminder) => reminder.offsetMinutes), [1440, 60]);
  assert.deepEqual(page.$('selected-reminders').querySelectorAll('.reminder-row').map((row) => row.querySelector('.reminder-when').textContent), ['1 day before', '1 hour before']);
  assert.equal(page.$('add-standard-reminders'), null);

  // Passed is off while a placed bid is active, and only then is the reason shown.
  assert.equal(page.$('passed-outcome').disabled, true);
  assert.equal(page.$('passed-help').hidden, false);
});

test('the Reminders tab of a coin with no auction offers to attach one', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Leu 32', eventKind: 'auction-day', precision: 'date-only', localDate: '2030-10-01', timeZone: 'UTC', reminderScope: 'standalone', reminders: [] } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  assert.ok(page.$('selected-reminders').textContent.includes('Attach an auction to set reminders.'));
  assert.equal(page.$('passed-help').hidden, true, 'Passed is available, so nothing explains it away');
  await page.click('attach-auction');
  assert.equal(page.$('lot-form').hidden, false, 'the Details tab is shown');
  assert.equal(page.document.activeElement, page.$('lot-form').elements.auctionEventId);
});

// H-01: the auction form asks in words. The time zone is a list starting on the collector's own zone, with "Other…"
// for a name the list lacks; the reminders are two choices, a custom number of minutes only when asked for; and the
// line under Save says what will be saved, where a confirm dialog used to ask.
test('the auction form offers a time zone list, reminder choices and a summary instead of a confirm dialog', async () => {
  const background = await createWorkspaceBackground();
  const page = await mountWorkspace({ background, hash: '#auctions' });
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await page.click('new-event');
  const f = page.$('event-form').elements;
  assert.equal(page.$('event-form').querySelector('h3').textContent, 'Auction');
  assert.equal(f.timeZoneChoice.value, own, 'the collector’s own zone to start with');
  assert.equal(f.timeZone.value, own);
  assert.equal(page.$('time-zone-other').hidden, true);
  assert.ok(f.timeZoneChoice.options.some((option) => option.value === 'Europe/Zurich'));
  assert.equal(f.timeZoneChoice.options.at(-1).value, 'other');
  assert.deepEqual([f.reminderFirst.value, f.reminderSecond.value], ['1440', '60']);
  assert.deepEqual(f.reminderFirst.options.map((option) => option.textContent), ['No reminder', '1 day before', '1 hour before', '30 minutes before', 'Custom…']);
  assert.equal(page.$('reminder-first-custom').hidden, true);

  await page.type('event-form', 'name', 'Leu Web Auction 32');
  assert.equal(page.$('event-summary').textContent, '', 'G-19: nothing is summed up before there is a day');
  assert.equal(f.remindEachCoin.checked, false, 'an auction reminds whatever is attached, unless the collector says otherwise');
  assert.equal(page.$('event-captured').open, false, 'a hand-made sale has nothing captured to show');
  await page.type('event-form', 'localDate', '2030-10-15');
  await page.type('event-form', 'localTime', '14:00');
  f.timeZoneChoice.value = 'Europe/Zurich';
  await page.$('event-form').emit('change', { target: f.timeZoneChoice });
  f.reminderSecond.value = 'custom';
  await page.$('event-form').emit('change', { target: f.reminderSecond });
  assert.equal(page.$('reminder-second-custom').hidden, false);
  await page.type('event-form', 'reminderSecondMinutes', '90');
  assert.equal(page.$('event-summary').textContent, 'Auction starts Tue, Oct 15, 2030, 2:00 PM Zurich · reminders 1 day and 90 minutes before');
  await page.submit('event-form');
  assert.deepEqual(page.prompts, [], 'no confirm dialog');
  const [event] = background.root().auctionEvents;
  assert.equal(event.timeZone, 'Europe/Zurich');
  assert.equal(event.reminderScope, 'standalone');
  assert.deepEqual(event.reminders.map((reminder) => reminder.offsetMinutes), [1440, 90]);

  // A zone the list does not hold is kept, under Other….
  await page.click('new-event');
  f.timeZoneChoice.value = 'other';
  await page.$('event-form').emit('change', { target: f.timeZoneChoice });
  assert.equal(page.$('time-zone-other').hidden, false);
});

// N14: a new auction for a house starts in the zone its last auction was saved in, and says where the zone came
// from; a zone the collector chose is never replaced. Each reminder of the coin's auction shows when it goes off.
test('a new auction takes the zone of the house’s last auction until the collector picks one', async () => {
  const background = await createWorkspaceBackground();
  await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Leu Web Auction 30', eventKind: 'lot-closes', precision: 'timed', localDate: '2030-10-15',
    localTime: '14:00', timeZone: 'Asia/Tokyo', reminderScope: 'standalone', reminders: [{ id: 'a', kind: 'offset', offsetMinutes: 1440 }] } });
  const page = await mountWorkspace({ background, hash: '#auctions' });
  await page.click('new-event');
  const f = page.$('event-form').elements;
  await page.type('event-form', 'name', 'Leu Web Auction 32');
  assert.equal(f.timeZone.value, 'Asia/Tokyo');
  assert.equal(f.timeZoneChoice.value, 'Asia/Tokyo');
  assert.equal(page.$('time-zone-note').hidden, false);
  assert.equal(page.$('time-zone-note').textContent, 'The time zone of your last auction from this house, Leu Web Auction 30. Change it if this one differs.');
  f.timeZoneChoice.value = 'Europe/Zurich';
  await page.$('event-form').emit('change', { target: f.timeZoneChoice });
  await page.type('event-form', 'name', 'Leu Web Auction 33');
  assert.equal(f.timeZone.value, 'Europe/Zurich', 'the collector’s choice stands');
  assert.equal(page.$('time-zone-note').hidden, true);
});

test('each reminder in the Reminders tab says when it goes off in the collector’s time', async () => {
  const background = await createWorkspaceBackground();
  const event = await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Leu 30', eventKind: 'lot-closes', precision: 'timed', localDate: '2030-10-15',
    localTime: '14:00', timeZone: 'Asia/Tokyo', reminderScope: 'linked-lots', reminders: [{ id: 'a', kind: 'offset', offsetMinutes: 1440 }] } });
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Nero, denarius', sourceLinks: [], auctionEventId: event.value.id } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const [row] = page.$('selected-reminders').querySelectorAll('.reminder-row');
  assert.equal(row.querySelector('.reminder-when').textContent, '1 day before');
  assert.match(row.querySelector('.reminder-at').textContent, /^\S.* \(your time\)( · (.+ )?2:00 PM Tokyo)?$/);
});

// Q-19: a date-only auction saved now rings at 09:00 on the collector's clock, and its row says so first, then the auction's
// own clock where its zone is not theirs. Kiritimati's day is 14 hours ahead of UTC, so its clock differs from any tester's.
test('a date-only auction’s reminders show 09:00 your time in the Reminders tab', async () => {
  const viewer = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const background = await createWorkspaceBackground({ timeZone: viewer });
  const event = await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Kiritimati sale', eventKind: 'auction-day', precision: 'date-only',
    localDate: '2030-10-15', timeZone: 'Pacific/Kiritimati', reminderScope: 'linked-lots', reminders: [
      { kind: 'wall-time', daysBefore: 1, localTime: '09:00' }, { kind: 'wall-time', daysBefore: 0, localTime: '09:00' }] } });
  assert.equal(event.ok, true, event.message);
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Nero, denarius', sourceLinks: [], auctionEventId: event.value.id } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const rows = [...page.$('selected-reminders').querySelectorAll('.reminder-row')];
  assert.deepEqual(rows.map((row) => row.querySelector('.reminder-when').textContent), ['Previous day at 09:00', 'Auction day at 09:00']);
  const [previous, onTheDay] = rows.map((row) => row.querySelector('.reminder-at').textContent);
  assert.match(previous, /^\S.* 9:00 AM \(your time\)( · .+ Kiritimati)?$/);
  // The sale-day reminder rings on the sale day in Kiritimati, no later than 09:00 there (V-04), and its row shows that
  // instant on your clock. The bound is checked on the instant, since the row names Kiritimati's day only where it is not yours.
  const { triggerAt } = deriveReminderTriggers([event.value]).find(({ reminderId }) => reminderId === event.value.reminders[1].id);
  const kiritimati = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(triggerAt)).replace(',', '');
  assert.ok(kiritimati.startsWith('2030-10-15 ') && kiritimati.slice(11) <= '09:00', kiritimati);
  const yours = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: viewer }).format(new Date(triggerAt));
  assert.match(onTheDay, /^\S.* \(your time\)( · .+ Kiritimati)?$/);
  assert.ok(onTheDay.includes(` ${yours} (your time)`), onTheDay);
  // The auction form says whose clock new reminders ring on, and where each one's time is shown: true of an older
  // auction's untouched reminders too, which keep the auction's clock (review Minor 4).
  assert.equal(page.$('date-only-reminder-note').textContent, "New reminders ring on your clock, the Auction day one before the sale's morning where it is; the Reminders tab shows each one's time.");
});

// W-07: the saved comparables speak plainly - one sentence when there are none, and "3 comparables · median … · middle
// half … · years" when there are; the set list names each reference with how many it holds.
test('the saved comparables say plainly what they hold', async () => {
  const background = await createWorkspaceBackground();
  const empty = await mountWorkspace({ background, hash: '#search' });
  assert.equal(empty.$('statistics-output').textContent, 'No saved comparablesSales you record by hand, kept apart from acsearch.');
  const queryId = '00000000-0000-4000-9000-000000000099';
  for (const [lotNumber, minor, auctionDate] of [[1, 15000, '2024-03-01'], [2, 18000, '2025-05-10'], [3, 30000, '2026-02-11'], [4, 99900, '2026-02-12']]) {
    const reply = await background.send({ type: 'evidence.add', observation: { queryId, queryLabel: 'RIC 27b', source: 'manual', auctionHouse: 'Test House', auctionDate,
      lotNumber: String(lotNumber), priceBasis: 'hammer', amount: { currency: lotNumber === 4 ? 'USD' : 'EUR', minor } } });
    assert.equal(reply.ok, true, reply.message);
  }
  const page = await mountWorkspace({ background, hash: '#search' });
  const select = page.$('evidence-query');
  assert.deepEqual(select.options.map((option) => option.textContent), ['New comparable set', 'RIC 27b (4)']);
  select.value = queryId;
  await page.$('evidence-filters').emit('input', { target: select });
  assert.equal(page.$('evidence-currency').value, 'EUR', 'a set is shown in the currency most of its sales are in');
  page.$('evidence-to').value = '2026-12-31';
  await page.$('evidence-filters').emit('input', { target: page.$('evidence-currency') });
  const lines = page.$('statistics-output').children.map((line) => line.textContent);
  assert.deepEqual(lines, ['3 comparables · median €180.00 · middle half €150.00–€300.00 · 2024–2026', 'Left out: 1 in another currency.']);
  assert.ok(page.$('evidence-list').textContent.includes('Mar 1, 2024'), 'dates are written in the browser’s language');
});

// G-06 (was W-08): loading is not said at all - the page line is for page-level notices - and a form's save answers in
// the form's own action bar, leaving the page's notice alone (G-07).
test('nothing is said on loading, and a form save answers in its own bar, not the page line', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  assert.equal(page.status(), '');
  await page.openCoin('Nero, denarius');
  await page.typeDetails('notes', 'Toned');
  page.$('workspace-status').textContent = 'Stored records could not be verified.';
  await page.saveDetails();
  assert.equal(page.$('lot-action-status').textContent, 'Details saved. You can undo this edit until the coin changes again.', 'a form answers in its own action bar');
  assert.equal(page.status(), 'Stored records could not be verified.', 'a form save leaves the page’s notice alone');
});

// N7: a coin whose auction ended with no outcome is flagged on its row and in its heading and has a queue of its own;
// a reminder missed while the browser was closed is listed under Due reminders and acknowledged with the rest.
async function backgroundWithEndedSale() {
  const background = await createWorkspaceBackground();
  const event = await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Nomos 30', eventKind: 'lot-closes', precision: 'timed',
    localDate: '2026-09-12', localTime: '10:00', timeZone: 'UTC', reminderScope: 'linked-lots', reminders: [{ id: 'hour', kind: 'offset', offsetMinutes: 60 }] } });
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Athens, owl', sourceLinks: [], auctionEventId: event.value.id } });
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Watched, no sale', sourceLinks: [] } });
  await background.send({ type: 'scheduler.reconcile' });
  return background;
}

test('a coin whose sale ended without an outcome is flagged and queued', async () => {
  const page = await mountWorkspace({ background: await backgroundWithEndedSale(), hash: '#watchlist' });
  assert.ok(page.$('lot-queue').options.some((option) => option.value === 'needs-outcome' && option.textContent === 'Needs outcome'));
  const row = page.$('lot-list').children.find((item) => item.textContent.includes('Athens, owl'));
  const pills = row.querySelectorAll('.status-pill').map((pill) => [pill.textContent, pill.dataset.tone]);
  assert.deepEqual(pills, [['Watching', 'watching'], ['Ended · record outcome', 'ended']]);
  const other = page.$('lot-list').children.find((item) => item.textContent.includes('Watched, no sale'));
  assert.equal(other.querySelectorAll('.status-pill').length, 1);
  page.$('lot-queue').value = 'needs-outcome';
  await page.$('lot-queue').emit('change');
  assert.deepEqual(page.$('lot-list').children.map((item) => item.querySelector('.coin-row-title').textContent), ['Athens, owl']);
  await page.openCoin('Athens, owl');
  assert.equal(page.$('selected-ended').hidden, false);
});

test('a missed reminder is listed under Due reminders and acknowledged with the rest', async () => {
  const background = await backgroundWithEndedSale();
  assert.equal(background.root().alerts[0].status, 'missed');
  const page = await mountWorkspace({ background, hash: '#auctions' });
  // Q-14: which reminder, when it went off in the collector's time, the auction, and the coins left needing an outcome.
  const [row] = page.$('alert-list').children;
  assert.match(row.textContent, /^Missed · 1 hour before · .+ \(your time\)(?: · [^·]+)? · Nomos 30 — 1 lot needs an outcome Record outcomes$/);
  assert.equal(row.querySelector('a').getAttribute('href'), '#watchlist?queue=needs-outcome');
  await page.navigate('#watchlist?queue=needs-outcome');
  assert.equal(page.$('lot-queue').value, 'needs-outcome');
  assert.deepEqual(page.$('lot-list').children.map((item) => item.querySelector('.coin-row-title').textContent), ['Athens, owl']);
  await page.navigate('#auctions');
  assert.equal(page.$('due-reminders').hidden, false);
  await page.click('ack-alerts');
  assert.equal(background.root().alerts[0].status, 'acknowledged');
  assert.deepEqual(page.$('alert-list').children.map((item) => item.textContent), []);
  assert.equal(page.$('due-reminders').hidden, true, 'G-18: no panel of buttons with nothing due');
});

// N18: every text box holds exactly what the store accepts, and says how much room is left once it is nearly full.
test('text boxes take their limits from the store and count down near the end', async () => {
  const { LIMITS } = await import('../extension/core/fields.js');
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  const lot = page.$('lot-form').elements;
  // Stale markup numbers would pass the check below by themselves; the page's own pass has to replace them.
  assert.deepEqual([lot.title.maxLength, lot.reference.maxLength, lot.lotNumber.maxLength, lot.notes.maxLength, lot.auctionHouse.maxLength],
    [LIMITS.title, LIMITS.shortText, LIMITS.shortText, LIMITS.notes, LIMITS.shortText].map(String));
  assert.equal(page.$('event-form').elements.name.maxLength, String(LIMITS.title));
  assert.equal(page.$('outcome-form').elements.collectionNotes.maxLength, String(LIMITS.notes));
  assert.equal(page.$('group-form').elements.name.maxLength, String(LIMITS.title));
  await page.openCoin('Nero, denarius');
  await page.typeDetails('title', 'x'.repeat(250));
  assert.equal(lot.title.parentElement.querySelector('.char-count')?.hidden ?? true, true, 'no count while there is room');
  await page.typeDetails('title', 'x'.repeat(280));
  assert.equal(lot.title.parentElement.querySelector('.char-count').textContent, '20 characters left');
  assert.equal(lot.title.parentElement.querySelector('.char-count').hidden, false);
});

// W-02: the Bid tab shows what the coin's own saved comparables sold for, in the bid's currency, with the other
// currencies counted apart; "Add comparable" opens the Search route on the coin's reference.
test('the Bid tab shows the coin’s saved comparables beside the maximum hammer', async () => {
  const background = await backgroundWithBidOnAuction();
  const queryId = '00000000-0000-4000-9000-000000000077';
  for (const [lotNumber, minor, currency] of [[1, 50000, 'GBP'], [2, 62000, 'GBP'], [3, 70000, 'GBP'], [4, 80000, 'USD']]) {
    await background.send({ type: 'evidence.add', observation: { queryId, queryLabel: 'RIC I² 306', source: 'manual', auctionHouse: 'CNG', auctionDate: `202${lotNumber}-03-01`,
      lotNumber: String(lotNumber), priceBasis: 'hammer', amount: { currency, minor } } });
  }
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const strip = page.$('bid-evidence');
  assert.equal(strip.closest('.detail-section'), page.$('bid-form').closest('.detail-section'));
  assert.equal(strip.querySelector('.bid-evidence-figure').textContent, 'Your saved comparables for RIC I² 306: median £620.00 from 3, 2021–2023');
  assert.equal(strip.querySelector('.bid-evidence-other').textContent, 'Also 1 in USD, not converted.');
  await page.type('bid-form', 'currency', 'USD');
  assert.equal(strip.querySelector('.bid-evidence-figure').textContent, 'Your saved comparables for RIC I² 306: 1 in USD, too few for a median, 2024');
  await page.click('bid-add-comparable');
  assert.equal(page.location.hash, '#search');
  assert.equal(page.$('research-query').value, 'RIC I² 306');
  assert.equal(page.$('evidence-query').value, queryId, 'the set already saved for the reference is the one shown');
});

// Review Important 1: a value the browser refuses inside a folded section opens that section and names the field, where
// Save used to do nothing at all.
test('an invalid value in a folded section opens it and names the field', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const form = page.$('lot-form');
  const photo = form.elements.photoUrl1;
  assert.equal(photo.closest('details').open, false);
  await form.emit('invalid', { target: photo });
  assert.equal(photo.closest('details').open, true);
  assert.equal(page.$('lot-action-status').textContent, 'Check Photo URL 1 under Coin details: the value is not valid.');
  const outcome = page.$('outcome-form');
  await outcome.emit('invalid', { target: outcome.elements.acquisitionDate });
  assert.equal(page.$('workspace-status').textContent, 'Check Acquisition date: the value is not valid.');
});

// Review Minor 3: a value the store refuses opens its section and names and focuses the field.
test('a value the store refuses opens its section and names the field', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const form = page.$('lot-form');
  await page.typeDetails('photoUrl1', 'javascript:alert(1)');
  form.elements.photoUrl1.closest('details').open = false;
  await page.saveDetails();
  assert.equal(page.$('lot-action-status').textContent, 'Expected an HTTP or HTTPS URL. (Photo URL 1)');
  assert.equal(form.elements.photoUrl1.closest('details').open, true);
  assert.equal(page.document.activeElement, form.elements.photoUrl1);
});

// Review Minor 2: Add comparable finds the saved set by the same reading the strip counts it by.
test('Add comparable opens the set saved under the reference however it was spelled', async () => {
  const background = await backgroundWithBidOnAuction();
  const queryId = '00000000-0000-4000-9000-000000000066';
  await background.send({ type: 'evidence.add', observation: { queryId, queryLabel: 'ric  i² 306', source: 'manual', auctionHouse: 'CNG', auctionDate: '2024-03-01',
    lotNumber: '1', priceBasis: 'hammer', amount: { currency: 'GBP', minor: 50000 } } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.click('bid-add-comparable');
  assert.equal(page.$('evidence-query').value, queryId);
});

// Review Minor 5: after a cancellation the Bid tab offers the cancelled terms in the form, and the store keeps no plan.
test('after recording a cancellation the Bid tab offers the cancelled terms without restoring a plan', async () => {
  const background = await backgroundWithBidOnAuction();
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.click('cancel-bid');
  const lot = storedLot(background, 'Nero, denarius');
  assert.equal(lot.activeBid, undefined);
  assert.equal(lot.plannedBid, undefined, 'no plan is written');
  const f = page.$('bid-form').elements;
  assert.deepEqual([f.amount.value, f.currency.value, f.premium.value], ['650.00', 'GBP', '20']);
});

// Review Minor 7: the zone note is tied to its list, and the countdown is heard as it changes.
test('the zone note describes the zone list and the character count is announced politely', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  assert.equal(page.$('event-form').elements.timeZoneChoice.getAttribute('aria-describedby'), 'time-zone-note');
  await page.openCoin('Nero, denarius');
  await page.typeDetails('title', 'x'.repeat(290));
  const title = page.$('lot-form').elements.title;
  const count = title.parentElement.querySelector('.char-count');
  assert.equal(count.getAttribute('aria-live'), 'polite');
  assert.ok(count.id);
  assert.equal(title.getAttribute('aria-describedby'), count.id);
});

// Review Important 2: a control that gets the focus under the sticky bar - a tall notes box the browser counts as
// already in view - is scrolled clear of it, but never so far that its top leaves the window.
test('a focused control under the sticky bar is scrolled clear of it', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const form = page.$('lot-form');
  form.querySelector('.action-bar').getBoundingClientRect = () => ({ top: 739, bottom: 800 });
  const notes = form.elements.notes;
  notes.getBoundingClientRect = () => ({ top: 718, bottom: 806 });
  await form.emit('focusin', { target: notes });
  assert.deepEqual(page.scrolls, [[0, 75]], 'the box’s bottom clears the bar by 8 px');
  const title = form.elements.title;
  title.getBoundingClientRect = () => ({ top: 400, bottom: 439 });
  await form.emit('focusin', { target: title });
  assert.equal(page.scrolls.length, 1, 'a control clear of the bar is left where it is');
  const tall = form.elements.condition;
  tall.getBoundingClientRect = () => ({ top: 60, bottom: 900 });
  await form.emit('focusin', { target: tall });
  assert.deepEqual(page.scrolls.at(-1), [0, 44], 'a box taller than the room keeps its top in the window');
});

// --- Fix round -------------------------------------------------------------------------------------

const editButton = (page, title) => entryCard(page, title).querySelectorAll('button').find((button) => button.textContent === 'Edit entry');
async function wonNero(background, extra = {}) {
  await wonCoin(background, { title: 'Nero, denarius', hammer: { currency: 'EUR', minor: 50000 }, actualInvoice: { currency: 'EUR', minor: 62500 }, acquisitionDate: '2023-06-15', ...extra });
}
async function openSettledCoin(page, title) {
  page.$('lot-queue').value = 'all-coins';
  await page.$('lot-queue').emit('change');
  await page.openCoin(title);
}

// Important 1: a save refused because another tab changed the entry keeps what was typed, and takes every field the
// collector did not touch from the entry as it now stands - never sending the old figure back as their correction.
test('a second save after another tab corrected the outcome neither reverts the invoice nor claims it as the collector\u2019s', async () => {
  const background = await createWorkspaceBackground();
  await wonNero(background);
  const first = await mountWorkspace({ background, hash: '#history' });
  const second = await mountWorkspace({ background, hash: '#watchlist' });
  await editButton(first, 'Nero, denarius').click(); await settle();
  await first.type('entry-edit-form', 'notes', 'Tray 4');

  await openSettledCoin(second, 'Nero, denarius');
  await second.type('outcome-form', 'invoice', '630');
  await second.submit('outcome-form');
  assert.deepEqual(background.root().collectionEntries[0].actualInvoice, { currency: 'EUR', minor: 63000 }, 'the entry followed the other tab');
  await settle();

  await first.submit('entry-edit-form');
  assert.match(first.$('entry-edit-form').querySelector('.error').textContent, /changed while you were editing/);
  assert.equal(first.$('entry-edit-form').elements.invoice.value, '630.00', 'the untouched invoice now reads as stored');
  assert.equal(first.$('entry-edit-form').elements.notes.value, 'Tray 4', 'what was typed is kept');
  await first.submit('entry-edit-form');
  const [stored] = background.root().collectionEntries;
  assert.deepEqual(stored.actualInvoice, { currency: 'EUR', minor: 63000 });
  assert.equal(stored.notes, 'Tray 4');
  assert.deepEqual(stored.editedFields, ['notes']);
});

// Important 2: one hammer on the page and in the file, whether the entry drifted under 0.35 or through a merge.
function hammersShown(page, title) {
  const line = entryCard(page, title).querySelector('.money-line');
  const [eur] = totalRows(page);
  return { card: line.children[1].textContent, table: eur[2] };
}
test('an entry left behind by a correction made under 0.35 shows its lot\u2019s one hammer on the card, in the totals and in the CSV', async () => {
  const background = await createWorkspaceBackground();
  await wonNero(background);
  const root = background.root();
  root.lots[0].outcome = { ...root.lots[0].outcome, hammer: { currency: 'EUR', minor: 51000 }, correctedAt: '2026-09-12T12:00:00.000Z' };
  delete root.lots[0].outcome.cost;
  // As 0.35 left it in storage before this version was installed: written, and heard of, before the page opens.
  await background.storage.set({ [STORAGE_KEY]: root });
  await settle();
  const page = await mountWorkspace({ background, hash: '#history' });
  assert.deepEqual(hammersShown(page, 'Nero, denarius'), { card: 'Hammer 510.00', table: '€510.00' });
  const read = await background.send({ type: 'snapshot.get' });
  assert.match(csvFiles(read.value).collection, /"510\.00","EUR"/);
  assert.doesNotMatch(csvFiles(read.value).collection, /"500\.00"/);
});

test('a merge that corrects a won lot while the local entry row wins shows one hammer everywhere', async () => {
  const background = await createWorkspaceBackground();
  await wonNero(background);
  const other = background.root();
  other.lots[0].outcome = { ...other.lots[0].outcome, hammer: { currency: 'EUR', minor: 51000 } };
  delete other.lots[0].outcome.cost;
  other.lots[0].updatedAt = '2026-09-13T12:00:00.000Z';
  other.lots[0].revision += 1;
  const imported = await background.send({
    type: 'backup.import', mode: 'merge', expectedRevision: background.root().revision,
    document: exportBackup(other, '2026-09-13T12:00:00.000Z').value,
  });
  assert.equal(imported.ok, true, imported.message);
  const page = await mountWorkspace({ background, hash: '#history' });
  assert.deepEqual(hammersShown(page, 'Nero, denarius'), { card: 'Hammer 510.00', table: '€510.00' });
  assert.match(csvFiles(background.root()).collection, /"510\.00","EUR"/);
});

// Minor 5: an invoice the collector cleared on the entry still says what the outcome records.
test('an invoice cleared on the entry says what the outcome records', async () => {
  const background = await createWorkspaceBackground();
  await wonNero(background);
  const page = await mountWorkspace({ background, hash: '#history' });
  await editButton(page, 'Nero, denarius').click(); await settle();
  await page.type('entry-edit-form', 'invoice', '');
  await page.submit('entry-edit-form');
  assert.equal(Object.hasOwn(background.root().collectionEntries[0], 'actualInvoice'), false);
  assert.ok(entryCard(page, 'Nero, denarius').textContent.includes('Invoice paid: none (your correction; the outcome records \u20ac625.00)'));
});

// Minor 6: typing only the invoice sends only the invoice.
test('an entry form that changes only the invoice sends no notes and no date', async () => {
  const background = await createWorkspaceBackground();
  await wonNero(background);
  const page = await mountWorkspace({ background, hash: '#history' });
  await editButton(page, 'Nero, denarius').click(); await settle();
  await page.type('entry-edit-form', 'invoice', '640');
  await page.submit('entry-edit-form');
  assert.deepEqual(page.commands.filter(({ type }) => type === 'collection.update').map(({ entry }) => entry),
    [{ actualInvoice: { currency: 'EUR', minor: 64000 } }]);
  assert.deepEqual(background.root().collectionEntries[0].editedFields, ['actualInvoice']);
});

// Minor 7: the keyboard goes back to the entry's Edit entry after Cancel or Save, and typed text is not dropped by
// opening another entry's form without asking.
test('focus returns to Edit entry, and opening another entry asks before dropping typed text', async () => {
  const background = await createWorkspaceBackground();
  await wonNero(background);
  await wonCoin(background, { title: 'Trajan, sestertius', hammer: { currency: 'EUR', minor: 20000 }, acquisitionDate: '2024-01-10' });
  const page = await mountWorkspace({ background, hash: '#history', confirmAnswers: [false, true] });
  await editButton(page, 'Nero, denarius').click(); await settle();
  const cancel = page.$('entry-edit-form').querySelectorAll('button').find((button) => button.textContent === 'Cancel');
  await cancel.click(); await settle();
  assert.ok(page.document.activeElement === editButton(page, 'Nero, denarius'), 'Cancel gives the keyboard back to Edit entry');

  await editButton(page, 'Nero, denarius').click(); await settle();
  await page.type('entry-edit-form', 'notes', 'Half typed');
  await editButton(page, 'Trajan, sestertius').click(); await settle();
  assert.deepEqual(page.prompts, ['Discard your changes to \u201cNero, denarius\u201d?']);
  assert.equal(page.$('entry-edit-form').elements.notes.value, 'Half typed', 'refused: the typing stays');
  assert.ok(entryCard(page, 'Nero, denarius').querySelector('#entry-edit-form'));
  await editButton(page, 'Trajan, sestertius').click(); await settle();
  assert.ok(entryCard(page, 'Trajan, sestertius').querySelector('#entry-edit-form'), 'accepted: the other entry opens');

  await page.type('entry-edit-form', 'notes', 'Cabinet 2');
  await page.submit('entry-edit-form');
  assert.ok(page.document.activeElement === editButton(page, 'Trajan, sestertius'), 'Save gives the keyboard back to Edit entry');
  // And it stays there when another view's write draws the route again.
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Unrelated coin', sourceLinks: [] } });
  await settle();
  assert.ok(page.document.activeElement === editButton(page, 'Trajan, sestertius'), 'a redraw keeps the keyboard on Edit entry');
});

// Q-01: a coin won without a bid recorded here gets its cost from the Outcome tab: the premium rate (offered from the
// house's preset) and a fees fold that opens by itself, in one save and without re-opening the coin.
test('a coin won without a recorded bid is costed from the premium and fees typed on its Outcome tab', async () => {
  const background = await createWorkspaceBackground();
  await background.send({ type: 'preferences.migrateIfAbsent', preferences: { currency: 'EUR', housePremiumPresets: [{ name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900 }] } });
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Hadrian, sestertius', sourceLinks: [], auctionContext: { pageUrl: 'https://house.test/1', house: 'Künker' } } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Hadrian, sestertius');
  await page.click('detail-tab-outcome');
  const f = page.$('outcome-form').elements;
  assert.equal(page.$('outcome-terms').hidden, false);
  assert.equal(f.premium.value, '25');
  assert.equal(page.$('outcome-premium-source').textContent, 'from your Künker preset');
  assert.equal(page.$('outcome-fees').open, true, 'no fee sheet on the lot: the fold opens by itself');
  assert.equal(f.premiumVat.value, '19.00');
  await page.type('outcome-form', 'hammer', '900');
  await page.type('outcome-form', 'shipping', '15');
  await page.submit('outcome-form');
  const [lot] = background.root().lots;
  assert.equal(lot.outcome.status, 'won');
  assert.deepEqual(lot.outcome.terms.buyerPremiumBps, 2500);
  // 900.00 + 225.00 premium + 42.75 VAT on it + 15.00 shipping.
  assert.equal(lot.outcome.cost.total.minor, 90000 + 22500 + 4275 + 1500);
  // Lost hides the terms: another bidder's hammer carries no premium of the collector's.
  page.$('outcome-form').elements.status.value = 'lost';
  await page.$('outcome-form').emit('change', { target: page.$('outcome-form').elements.status[1] ?? page.$('passed-outcome') });
  assert.equal(page.$('outcome-terms').hidden, true);
});

// G-05: a coin won on a planned 20 % with no fee sheet reads hammer + premium as its total, not "Incomplete", and
// Add fees opens the fees fold on its Outcome tab.
test('a won coin with no fees recorded shows hammer + premium, counts it in the totals, and offers Add fees', async () => {
  const background = await createWorkspaceBackground();
  const saved = await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Nero, as', sourceLinks: [] } });
  await background.send({ type: 'bid.plan', lotId: saved.value.id, expectedRevision: 0, plannedBid: { amount: { currency: 'USD', minor: 26000 }, buyerPremiumBps: 2000 } });
  await background.send({ type: 'lot.outcome.set', lotId: saved.value.id, expectedRevision: 1, outcome: { status: 'won', hammer: { currency: 'USD', minor: 24000 } }, addToCollection: { title: 'Nero, as', acquisitionDate: '2026-09-20', sourceLinks: [] } });
  const page = await mountWorkspace({ background, hash: '#history' });
  const card = page.$('history-list').children.find((item) => item.textContent.includes('Nero, as'));
  const line = card.querySelector('.money-line');
  assert.deepEqual(line.children.map((cell) => cell.textContent), ['USD', 'Hammer 240.00', 'Premium 48.00', 'Fees not recorded', 'Total 288.00hammer + premium']);
  assert.equal(line.dataset.tone, undefined, 'not a failure: nothing is in the warning tone');
  assert.equal(background.root().lots[0].outcome.cost.missing[0], 'fees', 'the data still names the gap');
  const [usd] = totalRows(page);
  assert.equal(usd[3], '$288.00 (1 without fees)');
  await card.querySelectorAll('button').find((button) => button.textContent === 'Add fees').click(); await settle();
  assert.equal(page.$('outcome-fees').open, true);
  assert.ok(page.document.activeElement === page.$('outcome-form').elements.premiumVat);
});

// Q-11: Active bids says what leaves the account if every bid wins, from the fees saved beside each bid.
test('Active bids shows the all-in figure of the bids with a fee sheet, and how many those are', async () => {
  const background = await createWorkspaceBackground();
  const saved = await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Leu lot', sourceLinks: [] } });
  await background.send({ type: 'bid.place', lotId: saved.value.id, expectedRevision: 0,
    activeBid: { amount: { currency: 'CHF', minor: 130000 }, buyerPremiumBps: 2000 },
    costEstimate: { currency: 'CHF', shippingMinor: 1500, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0, premiumVatBps: 810 } });
  const other = await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Nomos lot', sourceLinks: [] } });
  await background.send({ type: 'bid.place', lotId: other.value.id, expectedRevision: 0, activeBid: { amount: { currency: 'CHF', minor: 50000 }, buyerPremiumBps: 2000 } });
  const page = await mountWorkspace({ background, hash: '#bids' });
  const card = page.$('exposure-list').children[0];
  // 1,300 + 260 + 21.06 VAT on the premium + 15 shipping; the Nomos bid has no fee sheet.
  assert.ok(card.textContent.includes('All-in if every bid wins CHF\u00a01,596.06 (1 of 2 with fees)'), card.textContent);
});

// G-04: the medians the popup has on screen this session are offered on the Bid tab of the coin with the same
// reference - read by the catalogue rules, so a coin saved before 0.37 under the long edition name matches - in the
// bid's own currency, each provider on its own line, with Use as maximum; anything else shows nothing.
test('the popup’s session medians are offered as the maximum only for the same reference and currency', async () => {
  const background = await createWorkspaceBackground();
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Nero, as', reference: 'RIC I (second edition) Nero 306', sourceLinks: [] } });
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Nero, dupondius', reference: 'RIC I² Nero 306a', sourceLinks: [] } });
  const at = Date.now() - 3 * 60000;
  const entry = (provider, currency, median, count) => ({ reference: 'RIC I² Nero 306', provider, currency, median, count, at });
  await background.session.set({ 'giga-pinax-session-median': { acsearch: entry('acsearch', 'USD', 24000, 2), coinarchives: entry('coinarchives', 'USD', 26000, 7) } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, as');
  const sessions = () => page.$('bid-evidence').querySelectorAll('.bid-evidence-session').map((line) => line.textContent);
  assert.deepEqual(sessions(), [
    'acsearch median $240.00 from 2 sales · seen 3 min ago, session onlyUse as maximum',
    'CoinArchives median $260.00 from 7 sales · seen 3 min ago, session onlyUse as maximum',
  ], 'each provider on its own line, never pooled');
  await page.$('bid-evidence').querySelectorAll('button').find((button) => button.dataset.provider === 'acsearch').click(); await settle();
  assert.equal(page.$('bid-form').elements.amount.value, '240.00');
  assert.equal(page.blocksUnload(), true, 'the figure is typed into the form, not saved');
  assert.equal(Object.hasOwn(background.root().lots[0], 'plannedBid'), false);
  await page.type('bid-form', 'currency', 'EUR');
  assert.deepEqual(sessions(), [], 'another currency: nothing, never converted');
  await page.openCoin('Nero, dupondius');
  assert.deepEqual(sessions(), [], 'another reference: nothing');
  await page.openCoin('Nero, as');
  await background.session.set({ 'giga-pinax-session-median': { acsearch: { ...entry('acsearch', 'USD', 24000, 2), provider: 'somewhere' } } });
  await settle();
  assert.deepEqual(sessions(), [], 'a record out of shape is no median at all');
});

// Q-10: a raise planned while a bid is active is shown beside it - on the row and on the Bid tab - and can be cleared.
test('a plan saved beside the placed bid is shown on the row and the Bid tab, and Clear plan takes it off', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const lot = storedLot(background, 'Nero, denarius');
  await background.send({ type: 'bid.place', lotId: lot.id, expectedRevision: 0, activeBid: { amount: { currency: 'EUR', minor: 130000 }, buyerPremiumBps: 2000 } });
  await background.send({ type: 'bid.plan', lotId: lot.id, expectedRevision: 1, plannedBid: { amount: { currency: 'EUR', minor: 150000 }, buyerPremiumBps: 2000 } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  const row = page.$('lot-list').children.find((item) => item.textContent.includes('Nero, denarius'));
  assert.ok(row.textContent.includes('Placed €1,300.00 · plan €1,500.00'), row.textContent);
  await page.openCoin('Nero, denarius');
  assert.equal(page.$('bid-form').elements.amount.value, '1300.00', 'the form holds the terms in force');
  assert.equal(page.$('bid-plan-line').hidden, false);
  assert.equal(page.$('bid-plan-text').textContent, 'Plan to raise to €1,500.00 (20%)');
  await page.click('clear-plan');
  assert.equal(Object.hasOwn(storedLot(background, 'Nero, denarius'), 'plannedBid'), false);
  assert.equal(page.$('bid-plan-line').hidden, true);
  assert.deepEqual(storedLot(background, 'Nero, denarius').activeBid.amount, { currency: 'EUR', minor: 130000 });
});

// Q-09: a coin already in the collection says so on its Outcome tab and links to its entry, instead of offering a
// second entry the store would refuse; a first win goes into the collection by default, a loss never does.
test('the Outcome tab adds a first win to the collection by default and names an entry that exists', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const lot = storedLot(background, 'Nero, denarius');
  await background.send({ type: 'bid.plan', lotId: lot.id, expectedRevision: 0, plannedBid: { amount: { currency: 'EUR', minor: 2000000 } } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.click('detail-tab-outcome');
  const f = page.$('outcome-form').elements;
  assert.equal(f.hammer.placeholder, 'Your plan 20000.00');
  assert.equal(f.addToCollection.checked, true);
  assert.equal(page.$('outcome-collection').hidden, false);
  assert.equal(page.$('outcome-in-collection').hidden, true);
  f.status.value = 'lost'; await page.$('outcome-form').emit('change', { target: page.$('passed-outcome') });
  assert.equal(page.$('outcome-collection').hidden, true, 'a loss is never offered the collection');
  f.status.value = 'won'; await page.$('outcome-form').emit('change', { target: page.$('passed-outcome') });
  await page.type('outcome-form', 'hammer', '18000');
  await page.submit('outcome-form');
  const [entry] = background.root().collectionEntries;
  assert.ok(entry, 'saved into the collection without an extra click');
  assert.equal(page.$('outcome-in-collection').hidden, false);
  assert.match(page.$('outcome-in-collection-text').textContent, /^In your collection since /);
  assert.equal(page.$('outcome-collection').hidden, true, 'no second entry is offered');
  await page.click('outcome-edit-entry');
  assert.equal(page.location.hash, '#history');
  assert.ok(page.$('entry-edit-form'), 'the entry opens for correction');
});

// G-07: Save plan and Save outcome answer in their own action bar with the figure; a settled coin stays in the list
// beside its editor until another coin is chosen; Remove coin offers Undo, which puts the very coin back.
test('the Bid and Outcome forms say what was saved in their action bar, and the coin stays in its list', async () => {
  const background = await backgroundWithCoins('Nero, denarius', 'Trajan, sestertius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.type('bid-form', 'amount', '260');
  await page.type('bid-form', 'currency', 'USD');
  await page.type('bid-form', 'premium', '20');
  await page.submit('bid-form', { value: 'plan' });
  assert.equal(page.$('bid-action-status').textContent, 'Plan saved · $260.00 max · 20%');
  await page.submit('bid-form', { value: 'place' });
  assert.equal(page.$('bid-action-status').textContent, 'Placed bid recorded · $260.00 · 20%');
  await page.type('outcome-form', 'hammer', '240');
  await page.submit('outcome-form');
  assert.equal(page.$('outcome-action-status').textContent, 'Outcome saved · Won at $240.00 · in History · now under Completed Open');
  const rows = () => page.$('lot-list').children.map((row) => row.textContent);
  assert.ok(rows().some((row) => row.includes('Nero, denarius') && row.includes('Won')), 'the won coin is still listed, re-pilled');
  await page.openCoin('Trajan, sestertius');
  assert.ok(!rows().some((row) => row.includes('Nero, denarius')), 'gone from All open once another coin is chosen');
  assert.equal(page.$('outcome-action-status').textContent, '', 'another coin starts with a clean action bar');
});

test('Remove coin says so on the page with Undo, which puts back the coin with its bids', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const lot = storedLot(background, 'Nero, denarius');
  await background.send({ type: 'bid.plan', lotId: lot.id, expectedRevision: 0, plannedBid: { amount: { currency: 'EUR', minor: 50000 } } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.click('delete-lot');
  assert.equal(background.root().lots.length, 0);
  assert.equal(page.status(), 'Removed “Nero, denarius” · Undo');
  assert.ok(page.timers.some((timer) => timer.ms === 10000), 'Undo is offered for ten seconds');
  await page.click('undo-remove');
  const [back] = background.root().lots;
  assert.equal(back.id, lot.id, 'the very coin');
  assert.deepEqual(back.plannedBid.amount, { currency: 'EUR', minor: 50000 });
  assert.equal(page.status(), 'Put back “Nero, denarius”.');
  assert.equal(page.$('selected-title').textContent, 'Nero, denarius');
});

// X-01: past the storage bound the store removes the coin but keeps no copy to put back, and the page offers no Undo.
test('Remove coin past the storage bound says Undo is not available instead of offering it', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const commit = background.writer.commitCommand;
  background.writer.commitCommand = async (command) => {
    const reply = await commit(command);
    return command.type === 'lot.delete' && reply.ok ? { ...reply, value: { id: reply.value.id, undoAvailable: false } } : reply;
  };
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  await page.click('delete-lot');
  assert.equal(background.root().lots.length, 0);
  assert.equal(page.status(), 'Removed “Nero, denarius”. Undo is not available while your records fill the storage.');
  assert.equal(page.$('undo-remove'), null);
});

// X-02: records nothing can read put the recovery notice at the top of the workspace, and its rescue copy works.
test('the workspace over unreadable records offers the rescue copy and a fresh start at the top', async () => {
  const background = await createWorkspaceBackground();
  await background.storage.set({ [STORAGE_KEY]: 'not a root' });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  // The notice's module is loaded when it is needed, which takes the loader some turns.
  for (let turn = 0; turn < 200 && !page.$('store-recovery'); turn += 1) await new Promise((resolve) => { setTimeout(resolve, 1); });
  const notice = page.$('store-recovery');
  assert.ok(notice, 'the notice is drawn');
  assert.equal(page.document.querySelector('main').children[0], notice);
  assert.equal(page.$('store-recovery-download').textContent, 'Download the stored data');
  assert.equal(page.$('store-recovery-reset').textContent, 'Start fresh, keeping a copy');
  assert.equal(page.status(), 'Your records can’t be read. The notice at the top of this page has the ways out.');
});

// G-06: on a wide screen the detail panel is never an empty "Select a coin": the queue's first coin opens on arrival,
// one needing its outcome before any other; a phone keeps its list.
test('a wide workspace opens the coin the queue puts first, one needing its outcome before the rest', async () => {
  const background = await backgroundWithCoins('Nero, denarius', 'Trajan, sestertius');
  const past = await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Roma E-Sale 120', eventKind: 'lot-closes', precision: 'timed', localDate: '2026-09-01', localTime: '15:00', timeZone: 'Europe/London', reminderScope: 'linked-lots', reminders: [] } });
  const trajan = storedLot(background, 'Trajan, sestertius');
  await background.send({ type: 'lot.save', expectedRevision: trajan.revision, lot: { id: trajan.id, title: trajan.title, sourceLinks: [], auctionEventId: past.value.id } });
  // Every write is heard of before the page opens, as a browser that is not replaying old writes to a new page would.
  await settle(40);
  const wide = await mountWorkspace({ background, hash: '#watchlist', wide: true });
  assert.equal(wide.$('coin-editor').hidden, false);
  assert.equal(wide.$('selected-title').textContent, 'Trajan, sestertius', 'the coin whose sale ended without an outcome');
  const phone = await mountWorkspace({ background, hash: '#watchlist' });
  assert.equal(phone.$('coin-editor').hidden, true, 'a phone keeps its list');
  assert.equal(phone.status(), '', 'and nothing is said about loading');
});

// G-18: the Auctions route lists auctions as rows - name, when, how many coins - and the row opens the auction's form.
test('an auction is a row that says when it is and how many coins it holds, and opens its form', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const event = await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Roma E-Sale 130', eventKind: 'lot-closes', precision: 'timed', localDate: '2030-10-01', localTime: '15:00', timeZone: 'UTC', reminderScope: 'linked-lots', reminders: [] } });
  const lot = storedLot(background, 'Nero, denarius');
  await background.send({ type: 'lot.save', expectedRevision: lot.revision, lot: { id: lot.id, title: lot.title, sourceLinks: [], auctionEventId: event.value.id } });
  const page = await mountWorkspace({ background, hash: '#auctions' });
  const [row] = page.$('event-list').children;
  assert.equal(row.querySelector('.event-row-name').textContent, 'Roma E-Sale 130');
  assert.equal(row.querySelector('.event-row-coins').textContent, '1 coin');
  assert.equal(page.$('due-reminders').hidden, true);
  await row.click(); await settle();
  assert.equal(page.$('event-form').hidden, false);
  assert.equal(page.$('event-form').elements.name.value, 'Roma E-Sale 130');
});

// G-20: a coin opens on the tab its state calls for - Outcome when its sale ended without one, Bid when it closes
// within 48 hours with no bid - else the tab chosen last; a past auction offers no reminders to add.
test('a coin opens on the tab its state calls for, and a past auction offers no reminders', async () => {
  const background = await backgroundWithEndedSale();
  const soon = new Date(Date.now() + 5 * 3600000);
  const pad = (value) => String(value).padStart(2, '0');
  const closing = await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Leu Web 40', eventKind: 'lot-closes', precision: 'timed',
    localDate: `${soon.getUTCFullYear()}-${pad(soon.getUTCMonth() + 1)}-${pad(soon.getUTCDate())}`, localTime: `${pad(soon.getUTCHours())}:${pad(soon.getUTCMinutes())}`, timeZone: 'UTC', reminderScope: 'standalone', reminders: [] } });
  await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Closing soon', sourceLinks: [], auctionEventId: closing.value.id } });
  await settle(40);
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  const selected = () => ['details', 'bid', 'reminders', 'outcome'].find((tab) => page.$(`detail-tab-${tab}`).getAttribute('aria-selected') === 'true');
  await page.openCoin('Athens, owl');
  assert.equal(selected(), 'outcome', 'its sale ended without an outcome');
  await page.click('detail-tab-reminders');
  assert.ok(page.$('selected-reminders').textContent.includes('This auction has ended.'));
  assert.equal(page.$('add-standard-reminders'), null, 'nothing to add to a sale that is over');
  await page.openCoin('Closing soon');
  assert.equal(selected(), 'bid', 'it closes within 48 hours and has no bid');
  await page.openCoin('Watched, no sale');
  assert.equal(selected(), 'reminders', 'otherwise the tab chosen last');
});

// G-14 (W-09): Compare coins is a box in each coin row; ticking two to four opens the comparison from "Compare (n)".
test('coins are compared from boxes in their own rows, two to four at a time', async () => {
  const background = await backgroundWithCoins('Nero, denarius', 'Trajan, sestertius', 'Hadrian, as', 'Titus, denarius', 'Galba, as');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  assert.equal(page.$('comparison-picker'), null, 'no second list of the coins');
  const box = (title) => page.$('lot-list').children.find((row) => row.textContent.includes(title)).querySelector('.compare-box');
  const tick = async (title) => { box(title).checked = !box(title).checked; await box(title).emit('change'); };
  assert.equal(page.$('open-comparison').disabled, true);
  await tick('Nero, denarius');
  assert.equal(page.$('open-comparison').textContent, 'Compare (1)');
  assert.ok(page.$('lot-list').classList.contains('comparing'), 'the boxes show while one is ticked');
  await tick('Trajan, sestertius'); await tick('Hadrian, as'); await tick('Titus, denarius');
  assert.equal(page.$('open-comparison').disabled, false);
  assert.equal(box('Galba, as').disabled, true, 'four at most');
  assert.equal(box('Nero, denarius').getAttribute('aria-label'), 'Compare Nero, denarius');
  // The filter redraws the rows and keeps what was ticked.
  page.$('lot-filter').value = 'Nero';
  await page.$('lot-filter').emit('input');
  page.runTimers(); await settle();
  assert.equal(box('Nero, denarius').checked, true);
  assert.equal(page.$('open-comparison').textContent, 'Compare (4)');
});

// Merge with P1: the coin the popup's Open names wins over the queue's first coin on a wide screen.
test('a wide workspace opened on a named coin opens that coin, not the queue’s first', async () => {
  const background = await backgroundWithCoins('Nero, denarius', 'Trajan, sestertius');
  await settle(40);
  const trajan = storedLot(background, 'Trajan, sestertius');
  const page = await mountWorkspace({ background, hash: `#watchlist?lot=${trajan.id}`, wide: true });
  await settle(10);
  assert.equal(page.$('selected-title').textContent, 'Trajan, sestertius');
  const unknown = await mountWorkspace({ background, hash: '#watchlist?lot=00000000-0000-4000-8000-999999999999', wide: true });
  await settle(10);
  assert.equal(unknown.$('coin-editor').hidden, true, 'an id the store no longer holds opens nothing');
});

// Fix round, Important 2, on the page: blank keeps the bid's sheet, the checkbox says none, typed fees override.
test('the Outcome tab’s fees: blank keeps the bid’s sheet, the checkbox charges none, typed fees override', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const lot = storedLot(background, 'Nero, denarius');
  await background.send({ type: 'bid.place', lotId: lot.id, expectedRevision: 0, activeBid: { amount: { currency: 'EUR', minor: 150000 }, buyerPremiumBps: 2000 },
    costEstimate: { currency: 'EUR', shippingMinor: 1500, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0, premiumVatBps: 1900 } });
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const f = page.$('outcome-form').elements;
  const total = () => storedLot(background, 'Nero, denarius').outcome.cost.total.minor;
  assert.match(page.$('outcome-fees').textContent, /Left blank, the fees saved with the bid apply/);
  await page.type('outcome-form', 'hammer', '1000');
  for (const { name } of (await import('../extension/bid-tools.js')).FEE_SHEET_FIELDS) await page.type('outcome-form', name, '');
  await page.submit('outcome-form');
  assert.equal(total(), 100000 + 20000 + 3800 + 1500, 'blank: the bid’s sheet');
  f.noFees.checked = true; await page.$('outcome-form').emit('input', { target: f.noFees });
  await page.submit('outcome-form');
  assert.equal(total(), 100000 + 20000, 'ticked: none beyond the premium');
  assert.equal(f.noFees.checked, true, 'the form says so again');
  f.noFees.checked = false; await page.type('outcome-form', 'shipping', '30');
  await page.submit('outcome-form');
  assert.equal(total(), 100000 + 20000 + 3000, 'typed: the typed sheet');
});

// --- More currencies (G-23 / Q-15) ------------------------------------------------------------------------------

import { CURRENCIES } from '../extension/core/money.js';
import { validateBackup } from '../extension/core/backup.js';

test('every currency select in the workspace lists every currency', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const planned = await background.send({ type: 'bid.plan', lotId: storedLot(background, 'Nero, denarius').id, expectedRevision: 0,
    plannedBid: { amount: { currency: 'SEK', minor: 950000 }, buyerPremiumBps: 2000 } });
  assert.equal(planned.ok, true, planned.message);
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const codes = (select) => select.options.map((option) => option.value);
  for (const select of [page.$('evidence-currency'), page.$('bid-form').elements.currency, page.$('outcome-form').elements.hammerCurrency,
    page.$('outcome-form').elements.invoiceCurrency, page.$('evidence-form').elements.currency]) {
    assert.deepEqual(codes(select), [...CURRENCIES], select.name || select.id);
  }
  assert.equal(page.$('bid-form').elements.currency.value, 'SEK');
  assert.equal(page.$('bid-form').elements.amount.value, '9500.00');
  // The markup holds no list of its own: the page fills every select from money.js, the one list there is.
  const markup = parseHtmlFile(new URL('../extension/workspace.html', import.meta.url));
  for (const select of markup.querySelectorAll('select')) {
    if (/currency/i.test(select.id || select.getAttribute('name') || '')) assert.equal(select.querySelectorAll('option').length, 0, select.id || select.getAttribute('name'));
  }
  assert.equal(page.$('outcome-form').elements.hammerCurrency.value, 'SEK', 'the outcome opens in the bid’s currency');
});

// A yen sale from the bid to the History card, the CSV and the backup: whole yen everywhere, never a place added.
test('a JPY 1,200,000 hammer is whole yen in the bid form, the money line, the CSV and the backup', async () => {
  const background = await backgroundWithCoins('Taisei lot 88');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Taisei lot 88');
  const f = page.$('bid-form').elements;
  assert.deepEqual([f.increment.placeholder, f.minimum.placeholder], ['0.01', '0.00']);
  await page.type('bid-form', 'currency', 'JPY');
  // The budget fold's empty increment and minimum show whole yen.
  assert.deepEqual([f.increment.placeholder, f.minimum.placeholder], ['1', '0']);
  await page.type('bid-form', 'amount', '1,200,000');
  await page.type('bid-form', 'premium', '17.5');
  await page.type('bid-form', 'shipping', '3000');
  assert.equal(page.$('bid-live').textContent, '≈ ¥1,413,000 all-in · premium ¥210,000 · fees ¥3,000');
  await page.submit('bid-form', { value: 'place' });
  let stored = storedLot(background, 'Taisei lot 88');
  assert.deepEqual(stored.activeBid.amount, { currency: 'JPY', minor: 1200000 });
  assert.equal(stored.costEstimate.shippingMinor, 3000);
  assert.equal(f.amount.value, '1200000', 'the saved figure is written back in whole yen');
  assert.equal(f.shipping.value, '3000');
  await page.openCoin('Taisei lot 88');
  assert.deepEqual([f.increment.placeholder, f.minimum.placeholder], ['1', '0'], 'a coin opened on a yen bid shows whole yen');

  page.$('outcome-form').elements.status.value = 'won';
  await page.type('outcome-form', 'hammer', '1200000');
  await page.submit('outcome-form');
  stored = storedLot(background, 'Taisei lot 88');
  assert.deepEqual(stored.outcome.hammer, { currency: 'JPY', minor: 1200000 });
  assert.equal(page.$('outcome-form').elements.hammer.value, '1200000');

  await page.navigate('#history');
  const card = page.$('history-list').children.find((item) => item.textContent.includes('Taisei lot 88'));
  assert.deepEqual(card.querySelector('.money-line').children.map((cell) => cell.textContent),
    ['JPY', 'Hammer 1,200,000', 'Premium 210,000', 'Fees 3,000', 'Total 1,413,000']);

  const [lot] = csvFiles(background.root()).lots.split('\r\n').slice(1, 2).map((line) => line.split('","'));
  const header = csvFiles(background.root()).lots.slice(1).split('\r\n')[0].split('","').map((name) => name.replace(/"/g, ''));
  const cell = (name) => lot[header.indexOf(name)].replace(/"/g, '');
  assert.deepEqual([cell('hammer'), cell('hammer_currency'), cell('premium'), cell('fees'), cell('total_cost'), cell('total_cost_currency')],
    ['1200000', 'JPY', '210000', '3000', '1413000', 'JPY']);

  const file = exportBackup(background.root(), '2026-09-25T12:00:00.000Z');
  assert.equal(file.ok, true);
  const read = validateBackup(file.value);
  assert.equal(read.ok, true, read.error?.message);
  assert.deepEqual(read.value.lots.find((item) => item.title === 'Taisei lot 88').outcome.hammer, { currency: 'JPY', minor: 1200000 });
});

// --- Loop cycle 5: a load never speaks first (H-01, H-03) --------------------------------------------

// A page whose first snapshot is held until the test lets it land, as a slow worker or a busy laptop holds it.
async function mountBeforeSnapshot(background, options = {}) {
  const snapshot = background.holdReply('snapshot.get');
  const page = await mountWorkspace({ background, ...options });
  await snapshot.written;
  return Object.assign(page, { async land() { snapshot.release(); await settle(); } });
}
const typeFilter = async (page, value) => { page.$('lot-filter').value = value; await page.$('lot-filter').emit('input', { target: page.$('lot-filter') }); };
const STORE_CONTROLS = ['new-lot', 'new-event', 'new-want', 'new-group', 'enable-notifications'];

test('on every route, no control that reads the store acts before the first snapshot has landed', async () => {
  for (const hash of ['#search', '#watchlist', '#auctions', '#bids', '#history', '#wants']) {
    const background = await backgroundWithCoins('Nero, denarius');
    const page = await mountBeforeSnapshot(background, { hash, wide: true });
    for (const id of STORE_CONTROLS) assert.equal(page.$(id).disabled, true, `${id} waits on ${hash}`);
    assert.equal(page.$('evidence-form').querySelector('button[type="submit"]').disabled, true, `Save comparable waits on ${hash}`);
    await page.land();
    for (const id of STORE_CONTROLS) assert.equal(page.$(id).disabled, false, `${id} is ready on ${hash}`);
    assert.equal(page.$('evidence-form').querySelector('button[type="submit"]').disabled, false);
    assert.deepEqual(page.prompts, [], `nothing is asked on ${hash}`);
  }
});

test('a filter typed before the snapshot is kept: the wide workspace opens the first coin it lists, and asks nothing', async () => {
  const background = await backgroundWithCoins('Hadrian, denarius', 'Nero, denarius');
  const page = await mountBeforeSnapshot(background, { hash: '#watchlist', wide: true });
  await typeFilter(page, 'Nero');
  await page.land();
  assert.equal(page.$('lot-filter').value, 'Nero');
  assert.equal(page.$('selected-title').textContent, 'Nero, denarius', 'the coin the filtered list puts first');
  assert.deepEqual(page.prompts, []);
});

test('a coin form the collector opened is never replaced by the queue’s first coin, typed in or not', async () => {
  for (const typed of ['', 'My own coin']) {
    const background = await backgroundWithCoins('Hadrian, denarius');
    const page = await mountWorkspace({ background, hash: '#watchlist', wide: true });
    await page.click('new-lot');
    if (typed) await page.typeDetails('title', typed);
    // The collector comes back to the route from another, and another view writes: the queue's first coin is not opened over the form.
    await page.navigate('#auctions');
    await page.navigate('#watchlist');
    await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Trajan, sestertius', sourceLinks: [] } });
    await settle();
    assert.equal(page.$('selected-title').textContent, 'Add coin');
    assert.equal(page.$('lot-form').elements.title.value, typed);
    assert.deepEqual(page.prompts, [], 'and nothing is asked');
  }
});

test('a wide workspace opens the first coin only where nothing is open: never over an editor with unsaved input', async () => {
  const background = await backgroundWithCoins('Hadrian, denarius');
  const page = await mountWorkspace({ background, hash: '#wants', wide: true });
  await page.click('new-want');
  await page.type('want-form', 'notes', 'Half a thought');
  await page.navigate('#watchlist');
  assert.equal(page.$('coin-editor').hidden, true, 'the detail panel waits for the collector');
  assert.deepEqual(page.prompts, []);
});

test('a captured lot that arrives after the collector started a coin is offered beside it, never loaded over it', async () => {
  const { background, hash } = await backgroundWithDraft();
  const draft = background.holdReply('draft.get');
  const page = await mountWorkspace({ background, hash });
  await draft.written;
  await page.click('new-lot');
  await page.typeDetails('title', 'My own title');
  draft.release();
  await settle();
  assert.equal(page.$('lot-form').elements.title.value, 'My own title', 'what the collector typed stands');
  assert.equal(page.$('lot-action-status').textContent, 'A captured lot is waiting: Load it · Keep what I typed');
  assert.deepEqual(page.prompts, []);
  const [load] = page.$('lot-action-status').querySelectorAll('button');
  await load.click(); await settle();
  assert.equal(page.$('lot-form').elements.title.value, 'Captured coin', 'Load it puts the captured lot in the form');
  assert.equal(page.$('lot-action-status').textContent, '');
  await page.saveDetails();
  assert.deepEqual(background.root().drafts, [], 'the save that adds it consumes the draft');
});

test('a captured lot waiting beside a coin the collector opened is left when they keep their own', async () => {
  const { background, hash, draftId } = await backgroundWithDraft();
  const draft = background.holdReply('draft.get');
  const page = await mountWorkspace({ background, hash });
  await draft.written;
  await page.openCoin('Kept coin');
  draft.release();
  await settle();
  assert.equal(page.$('selected-title').textContent, 'Kept coin', 'the coin they opened stays open');
  const [, keep] = page.$('lot-action-status').querySelectorAll('button');
  await keep.click(); await settle();
  assert.equal(page.$('lot-action-status').textContent, '');
  assert.equal(page.$('lot-form').elements.title.value, 'Kept coin');
  assert.deepEqual(background.root().drafts.map(({ id }) => id), [draftId], 'the draft is still there for another time');
});

test('an untouched Add coin form is filled by the captured lot that arrives after it', async () => {
  const { background, hash } = await backgroundWithDraft();
  const draft = background.holdReply('draft.get');
  const page = await mountWorkspace({ background, hash });
  await draft.written;
  await page.click('new-lot');
  draft.release();
  await settle();
  assert.equal(page.$('lot-form').elements.title.value, 'Captured coin');
  assert.deepEqual(page.prompts, []);
});

test('a captured auction that arrives over an auction form the collector typed in is offered, not loaded', async () => {
  const background = await createWorkspaceBackground();
  const saved = await background.send({ type: 'draft.save', kind: 'auction-capture', payload: { rawText: 'Roma Numismatics Auction 31, 15 October', pageUrl: 'https://house.example/auction/31' } });
  assert.equal(saved.ok, true, saved.message);
  const draft = background.holdReply('draft.get');
  const page = await mountWorkspace({ background, hash: `#event-draft=${saved.value.id}` });
  await draft.written;
  await page.click('new-event');
  await page.type('event-form', 'name', 'My own auction');
  draft.release();
  await settle();
  assert.equal(page.$('event-form').elements.name.value, 'My own auction');
  assert.equal(page.$('event-action-status').textContent, 'A captured auction is waiting: Load it · Keep what I typed');
  const [load] = page.$('event-action-status').querySelectorAll('button');
  await load.click(); await settle();
  assert.equal(page.$('event-form').elements.name.value, 'Roma Numismatics Auction 31, 15 October');
});

test('captured research text never replaces a query the collector typed', async () => {
  const background = await createWorkspaceBackground();
  const saved = await background.send({ type: 'draft.save', kind: 'research-highlight', payload: { rawText: 'Nero As RIC 306' } });
  assert.equal(saved.ok, true, saved.message);
  const draft = background.holdReply('draft.get');
  const page = await mountWorkspace({ background, hash: `#research-draft=${saved.value.id}` });
  await draft.written;
  page.$('research-query').value = 'Trajan denarius';
  draft.release();
  await settle();
  assert.equal(page.$('research-query').value, 'Trajan denarius');
  // Review Minor 3: the offer has a line of its own under the query, which the page's passing notices do not overwrite.
  assert.equal(page.$('research-action-status').textContent, 'Captured research text is waiting: Load it · Keep what I typed');
  assert.equal(page.status(), '');
  await page.click('launch-ac');
  assert.equal(page.$('research-action-status').textContent, 'Captured research text is waiting: Load it · Keep what I typed', 'a notice leaves it standing');
  const [load] = page.$('research-action-status').querySelectorAll('button');
  await load.click(); await settle();
  assert.equal(page.$('research-query').value, 'Nero As RIC 306');
});

// H-03 / V-11: a want's currency is the collector's default, never the list's first currency written because the settings
// had not arrived; and a form nobody has touched follows a default changed in another view, while typing keeps its own.
test('Add want waits for the settings, opens on the default currency, and an untouched form follows a new default', async () => {
  const background = await createWorkspaceBackground();
  const created = await background.send({ type: 'preferences.migrateIfAbsent', preferences: { currency: 'GBP' } });
  assert.equal(created.ok, true, created.message);
  const page = await mountBeforeSnapshot(background, { hash: '#wants' });
  assert.equal(page.$('new-want').disabled, true, 'Add want waits for the settings');
  await page.land();
  await page.click('new-want');
  assert.equal(page.$('want-form').elements.currency.value, 'GBP');
  const euro = await background.send({ type: 'preferences.save', expectedRevision: created.value.revision, preferences: { ...created.value, currency: 'EUR' } });
  assert.equal(euro.ok, true, euro.message);
  await settle();
  assert.equal(page.$('want-form').elements.currency.value, 'EUR', 'an untouched form follows the new default');
  await page.type('want-form', 'maxPrice', '800');
  const franc = await background.send({ type: 'preferences.save', expectedRevision: euro.value.revision, preferences: { ...euro.value, currency: 'CHF' } });
  assert.equal(franc.ok, true, franc.message);
  await settle();
  assert.equal(page.$('want-form').elements.currency.value, 'EUR', 'a form the collector typed in keeps its currency');
  assert.equal(page.$('want-form').elements.maxPrice.value, '800');
});

// H-04 / V-10: one money rule on every workspace screen - the collector's language, and the short sign only where it names
// one currency there - so a coin row never reads "€1,300.00" beside "1.300,00 €" in the form, nor "¥" beside "JP¥".
test('every amount in the workspace is written in the collector’s language, with the short sign only where it names one currency', async () => {
  for (const [language, currency, minor, expected] of [['de-DE', 'EUR', 130000, '1.300,00 €'], ['en-GB', 'JPY', 1200000, '¥1,200,000'], ['en-GB', 'SEK', 1250000, 'SEK 12,500.00']]) {
    const said = (amount) => formatMoney(amount, language, { narrow: true });
    assert.equal(said({ currency, minor }).replace(/[\u00a0\u202f]/g, ' '), expected, 'the rule itself');
    const background = await backgroundWithCoins('Taisei lot 88', 'Won coin');
    const coin = storedLot(background, 'Taisei lot 88');
    const placed = await background.send({ type: 'bid.place', lotId: coin.id, expectedRevision: coin.revision, activeBid: { amount: { currency, minor }, buyerPremiumBps: 1750 } });
    assert.equal(placed.ok, true, placed.message);
    const won = storedLot(background, 'Won coin');
    assert.equal((await background.send({ type: 'lot.outcome.set', lotId: won.id, expectedRevision: won.revision, outcome: { status: 'won', hammer: { currency, minor }, terms: { buyerPremiumBps: 2000 } } })).ok, true);
    const page = await mountWorkspace({ background, hash: '#watchlist', language });
    const row = page.$('lot-list').querySelectorAll('.coin-row').find((item) => item.textContent.includes('Taisei lot 88'));
    assert.equal(row.querySelector('.coin-row-amount').textContent, said({ currency, minor }), `${language} coin row`);
    await page.openCoin('Taisei lot 88');
    assert.match(page.$('bid-live').textContent, new RegExp(`^≈ ${said({ currency, minor: minor * 1.175 }).replace(/[$.]/g, '\\$&')} all-in`), `${language} Bid tab line`);
    await page.navigate('#bids');
    assert.equal(page.$('exposure-list').querySelector('.exposure-total').textContent, said({ currency, minor }), `${language} Active bids`);
    await page.navigate('#history');
    assert.match(page.$('history-list').textContent, new RegExp(`Lost|Won`));
    assert.equal(page.$('collection-list').textContent.includes('$') && currency !== 'USD', false, 'no dollar sign where there is no dollar');
    // The Compare dialog writes its figures by the same rule, and a won coin's total cost as History works it out.
    await page.navigate('#watchlist');
    page.$('lot-queue').value = 'all-coins'; await page.$('lot-queue').emit('change');
    for (const box of page.$('lot-list').querySelectorAll('.compare-box')) { box.checked = true; await box.emit('change'); }
    await page.click('open-comparison');
    const text = page.$('comparison-grid').textContent;
    assert.ok(text.includes(`Active maximum ${said({ currency, minor })}`), `${language} Compare: ${text}`);
    assert.ok(text.includes(`Final hammer ${said({ currency, minor })}`), `${language} Compare final hammer`);
    assert.ok(text.includes(`Total cost ${said({ currency, minor: minor * 1.2 })} (hammer + premium)`), `${language} Compare total cost`);
  }
});

// H-06: the heading a route greets the collector with is the word they pressed in the nav.
test('every route is headed by its nav word', async () => {
  const page = await mountWorkspace({ background: await createWorkspaceBackground() });
  for (const link of page.document.querySelector('.workspace-nav').querySelectorAll('[data-route]')) {
    const heading = page.$(`route-${link.dataset.route}`).querySelector('h2');
    assert.equal(heading.textContent, link.textContent, link.dataset.route);
  }
  assert.deepEqual(page.document.querySelectorAll('.section-heading').filter((heading) => heading.querySelector('p')), [], 'no intro line sits in a heading to be cut');
});

// H-17: Alternatives is folded under the coin list, closed until a group exists, its count in the summary.
test('Alternatives is folded until a group exists, and says how many there are', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  assert.equal(page.$('group-fold').open, false);
  assert.equal(page.$('group-summary').textContent, 'Alternatives (0)');
  await page.click('new-group');
  assert.equal(page.$('group-fold').open, true, 'Add group opens it');
  await page.type('group-form', 'name', 'One Nero as');
  await page.submit('group-form');
  assert.equal(page.$('group-summary').textContent, 'Alternatives (1)');
  const later = await mountWorkspace({ background, hash: '#watchlist' });
  assert.equal(later.$('group-fold').open, true, 'a page with a group opens it');
});

// H-15: the zones of the houses a collector bids at come first, by their place; every zone follows.
test('the auction form lists the houses’ zones first, a saved auction’s own at the top, then every zone', async () => {
  const background = await createWorkspaceBackground();
  await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Taisei 70', eventKind: 'auction-day', precision: 'date-only', localDate: '2027-10-11', timeZone: 'Asia/Tokyo', reminderScope: 'standalone', reminders: [] } });
  const page = await mountWorkspace({ background, hash: '#auctions', language: 'en-GB' });
  await page.click('new-event');
  const select = page.$('event-form').elements.timeZoneChoice;
  const [houses, all] = select.children;
  assert.equal(houses.getAttribute('label'), 'Auction houses’ zones');
  assert.deepEqual(houses.children.map((option) => option.value).slice(0, 4), ['Asia/Tokyo', 'Europe/London', 'Europe/Zurich', 'Europe/Berlin']);
  assert.match(houses.children[2].textContent, /^Zurich \(CES?T\)$/);
  assert.match(houses.children[3].textContent, /^Berlin, Munich \(/);
  assert.equal(all.getAttribute('label'), 'All zones');
  assert.equal(all.children[0].value, 'Africa/Abidjan');
  assert.equal(select.children.at(-1).value, 'other');
  select.value = 'Europe/Zurich';
  await page.$('event-form').emit('change', { target: select });
  assert.equal(page.$('event-form').elements.timeZone.value, 'Europe/Zurich');
});

// H-13: one When for an auction's kind and precision, a heading with one action, and Remove auction.
test('the auction form asks When once, shows a time only for a timed sale, and keeps a saved auction’s own pair', async () => {
  const background = await createWorkspaceBackground();
  const page = await mountWorkspace({ background, hash: '#auctions' });
  assert.deepEqual(page.$('route-auctions').querySelector('.section-heading').querySelectorAll('button').map((button) => button.id), ['new-event']);
  assert.equal(page.$('enable-notifications').closest('details').querySelector('summary').textContent, 'How reminders are delivered');
  await page.click('new-event');
  const f = page.$('event-form').elements;
  assert.deepEqual(f.when.options.map((option) => option.textContent), ['Auction starts at', 'Lots close at', 'Sale day (date only)']);
  assert.equal(page.$('event-time-label').hidden, false);
  f.when.value = 'auction-day';
  await page.$('event-form').emit('change', { target: f.when });
  assert.equal(page.$('event-time-label').hidden, true, 'a sale day has no time to ask for');
  await page.type('event-form', 'name', 'Taisei 70');
  await page.type('event-form', 'localDate', '2030-10-11');
  assert.match(page.$('event-summary').textContent, /^Sale day /);
  await page.submit('event-form');
  const [day] = background.root().auctionEvents;
  assert.deepEqual([day.eventKind, day.precision], ['auction-day', 'date-only']);
  await page.click('new-event');
  f.when.value = 'lot-closes';
  await page.$('event-form').emit('change', { target: f.when });
  await page.type('event-form', 'name', 'Roma E-Sale 130');
  await page.type('event-form', 'localDate', '2030-10-15');
  await page.type('event-form', 'localTime', '15:00');
  await page.submit('event-form');
  const closes = background.root().auctionEvents.find(({ name }) => name === 'Roma E-Sale 130');
  assert.deepEqual([closes.eventKind, closes.precision], ['lot-closes', 'timed']);
  assert.equal(page.$('delete-event').textContent, 'Remove auction');
  // An auction an older form saved as a lot closing on a date only keeps that pair through an edit of its name.
  const odd = await background.send({ type: 'event.save', expectedRevision: null, event: { name: 'Odd pair', eventKind: 'lot-closes', precision: 'date-only', localDate: '2030-11-01', timeZone: 'Europe/London', reminderScope: 'standalone', reminders: [] } });
  await settle();
  await page.$('event-list').querySelectorAll('.event-row').find((row) => row.textContent.includes('Odd pair')).click(); await settle();
  assert.equal(f.when.value, 'auction-day');
  await page.type('event-form', 'name', 'Odd pair, renamed');
  await page.submit('event-form');
  const kept = background.root().auctionEvents.find(({ id }) => id === odd.value.id);
  assert.deepEqual([kept.name, kept.eventKind, kept.precision], ['Odd pair, renamed', 'lot-closes', 'date-only']);
});

// H-12: one filled button per form - the form's own save - and the rest secondary or quiet.
test('each workspace form has one filled button, its own save, and the search launchers are secondary', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  const filled = (root) => root.querySelectorAll('button').filter((button) => !['quiet', 'secondary', 'danger'].some((kind) => button.classList.contains(kind))).map((button) => button.textContent);
  assert.deepEqual(filled(page.$('research-form')), [], 'the launchers open a site; the page’s save is the comparable’s');
  assert.deepEqual(filled(page.$('evidence-form')), ['Save comparable']);
  assert.deepEqual(filled(page.$('bid-form')), ['Save plan']);
  for (const form of ['lot-form', 'outcome-form', 'event-form', 'want-form', 'group-form']) assert.equal(filled(page.$(form)).length, 1, form);
});

// H-14: the Search route as the coin sees it - the set named in the heading, the filters folded until one is set, a source
// nobody has kept out of sight, and the add form opened from a coin in the coin's bid currency.
test('the Search route names the set, folds its filters, and records a comparable in the coin’s currency', async () => {
  const background = await backgroundWithCoins('Taisei lot 88');
  const coin = storedLot(background, 'Taisei lot 88');
  await background.send({ type: 'lot.save', expectedRevision: coin.revision, lot: { id: coin.id, title: coin.title, reference: 'RIC I² Nero 306', sourceLinks: [] } });
  const saved = storedLot(background, 'Taisei lot 88');
  await background.send({ type: 'bid.plan', lotId: saved.id, expectedRevision: saved.revision, plannedBid: { amount: { currency: 'JPY', minor: 1200000 } } });
  const page = await mountWorkspace({ background, hash: '#search' });
  assert.deepEqual([page.$('launch-ac').textContent, page.$('launch-ca').textContent], ['acsearch \u2197', 'CoinArchives \u2197']);
  assert.equal(page.$('evidence-filter-fold').open, false, 'no filter is set, so none is shown');
  assert.equal(page.$('authorized-source').hidden, true, 'a source nobody has is not offered');
  assert.equal(page.$('statistics-heading').textContent, 'Saved comparables');
  await page.navigate('#watchlist');
  await page.openCoin('Taisei lot 88');
  await page.click('bid-add-comparable');
  assert.equal(page.location.hash, '#search');
  assert.equal(page.$('evidence-form').elements.currency.value, 'JPY', 'the sale is recorded in the bid’s currency');
  assert.equal(page.$('evidence-currency').value, 'JPY');
  // The fake DOM's select starts blank where a browser's starts on its first option, Hammer.
  page.$('evidence-form').elements.priceBasis.value = 'hammer';
  for (const [field, value] of [['auctionHouse', 'Taisei'], ['auctionDate', '2026-06-01'], ['lotNumber', '12'], ['amount', '900000']]) await page.type('evidence-form', field, value);
  await page.submit('evidence-form');
  assert.deepEqual(background.root().evidence[0].observations[0].amount, { currency: 'JPY', minor: 900000 });
  assert.equal(page.$('statistics-heading').textContent, 'Saved comparables · RIC I² Nero 306 (1)');
  page.$('evidence-from').value = '2020-01-01';
  await page.$('evidence-filters').emit('input', { target: page.$('evidence-from') });
  assert.equal(page.$('evidence-filter-fold').open, true, 'a filter that is set is shown');
});

// H-07: one empty state on every page - a serif heading of three words, one sentence, the page's Add button - and a
// watchlist with no coin is its list alone, with no "Select a coin" beside it.
test('every workspace page with nothing in it says so in one empty state', async () => {
  const page = await mountWorkspace({ background: await createWorkspaceBackground(), hash: '#watchlist', wide: true });
  const state = (root) => { const box = root.querySelector('.empty-state'); return box && [box.querySelector('h3').textContent, box.querySelector('p').textContent, box.querySelector('button')?.textContent ?? '']; };
  assert.deepEqual(state(page.$('lot-list')), ['No coins yet', 'Save a coin from the popup, or add one here.', 'Add coin']);
  assert.equal(page.$('coin-workspace').dataset.empty, 'true', 'no detail panel beside it');
  assert.deepEqual(state(page.$('event-list')), ['No auctions yet', 'An auction keeps a sale’s date, time zone and reminders for the coins attached to it.', 'Add auction']);
  assert.deepEqual(state(page.$('exposure-list')), ['No active bids', 'A bid you record as placed counts here, per currency.', '']);
  assert.deepEqual(state(page.$('history-list')), ['Nothing settled yet', 'A coin whose outcome you record appears here.', '']);
  assert.deepEqual(state(page.$('want-list')), ['No wants yet', 'A type you are looking for; a card, an upcoming lot or a captured lot of it says so.', 'Add want']);
  assert.deepEqual(state(page.$('statistics-output')), ['No saved comparables', 'Sales you record by hand, kept apart from acsearch.', '']);
  await page.$('lot-list').querySelector('.empty-state').querySelector('button').click(); await settle();
  assert.equal(page.$('coin-workspace').dataset.empty, 'false', 'Add coin opens the coin form beside the list');
  assert.equal(page.$('selected-title').textContent, 'Add coin');
});

// H-09: one word for one thing - buyer's premium, hammer, comparable, auction - on every workspace page.
test('the workspace says buyer’s premium, comparable and auction, never BP, evidence or event', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const coin = storedLot(background, 'Nero, denarius');
  await background.send({ type: 'bid.place', lotId: coin.id, expectedRevision: coin.revision, activeBid: { amount: { currency: 'EUR', minor: 50000 } } });
  const page = await mountWorkspace({ background, hash: '#bids' });
  await page.openCoin('Nero, denarius');
  const shown = (root) => root.querySelectorAll('label, legend, button, h2, h3, h4, p, summary, option, span').map((node) => node.textContent).join(' \u00b7 ');
  const everything = shown(page.document.querySelector('main'));
  for (const word of [/\bBP\b/, /[Bb]uyer premium/, /\bevidence\b/i, /\bevent\b/i]) assert.doesNotMatch(everything, word);
  assert.match(page.$('exposure-list').textContent, /Known hammer \+ buyer’s premium/);
  assert.match(page.$('exposure-list').textContent, /Incomplete — buyer’s premium unknown for 1 bid/);
  assert.equal(page.$('lot-form').elements.lotNumber.closest('label').childNodes[0].textContent, 'Lot number shown ');
});

// --- Fix round (s2-review) ---------------------------------------------------------------------------

// Important 1: a second click on a form's save while its first is in flight sends nothing, so a sale is never saved twice
// into the collector's own median, nor a coin added twice.
test('a second submit while the first save is in flight sends nothing more, on every form that saves through the page', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#search' });
  page.$('evidence-form').elements.priceBasis.value = 'hammer';
  page.$('evidence-form').elements.currency.value = 'EUR';
  for (const [field, value] of [['auctionHouse', 'Roma'], ['auctionDate', '2026-06-01'], ['lotNumber', '12'], ['amount', '600']]) await page.type('evidence-form', field, value);
  await Promise.all([page.startSubmit('evidence-form'), page.startSubmit('evidence-form')]);
  await settle();
  assert.equal(page.commands.filter(({ type }) => type === 'evidence.add').length, 1, 'one comparable');
  assert.equal(background.root().evidence.length, 1);

  await page.navigate('#watchlist');
  await page.click('new-lot');
  await page.typeDetails('title', 'Double coin');
  await Promise.all([page.startSubmit('lot-form'), page.startSubmit('lot-form')]);
  await settle();
  assert.equal(page.commands.filter(({ type }) => type === 'lot.save').length, 1, 'one coin');
  assert.equal(background.root().lots.filter(({ title }) => title === 'Double coin').length, 1);

  // The bid, outcome, auction and want forms go through the same send.
  await page.openCoin('Nero, denarius');
  await page.type('bid-form', 'amount', '250');
  const plan = { value: 'plan' };
  await Promise.all([page.startSubmit('bid-form', plan), page.startSubmit('bid-form', plan)]);
  await settle();
  assert.equal(page.commands.filter(({ type }) => type === 'bid.plan').length, 1, 'one plan');
  await page.navigate('#auctions');
  await page.click('new-event');
  for (const [field, value] of [['name', 'Roma 31'], ['localDate', '2030-10-15'], ['localTime', '14:00']]) await page.type('event-form', field, value);
  await Promise.all([page.startSubmit('event-form'), page.startSubmit('event-form')]);
  await settle();
  assert.equal(background.root().auctionEvents.length, 1, 'one auction');
});

// Important 1: an entry form saved twice sends one correction.
test('a collection entry form saved twice while its save is in flight sends one correction', async () => {
  const background = await createWorkspaceBackground();
  const saved = await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Won coin', sourceLinks: [] } });
  await background.send({ type: 'lot.outcome.set', lotId: saved.value.id, expectedRevision: 0, outcome: { status: 'won', hammer: { currency: 'EUR', minor: 10000 } }, addToCollection: { title: 'Won coin', acquisitionDate: '2026-09-01', sourceLinks: [] } });
  const page = await mountWorkspace({ background, hash: '#history' });
  await page.$('history-list').querySelectorAll('button').find((button) => button.textContent === 'Edit entry').click(); await settle();
  const form = page.$('entry-edit-form');
  form.elements.notes.value = 'Bought from Roma'; await form.emit('input', { target: form.elements.notes });
  await Promise.all([form.emit('submit'), form.emit('submit')]);
  await settle();
  assert.equal(page.commands.filter(({ type }) => type === 'collection.update').length, 1);
});

// Minor 2: the Search route's two currencies start on the collector's default, from every way in, and a choice stands.
test('the Search filter and the add form start on the default currency from every way in, until the collector chooses', async () => {
  const background = await createWorkspaceBackground();
  const created = await background.send({ type: 'preferences.migrateIfAbsent', preferences: { currency: 'GBP' } });
  const currencies = (page) => [page.$('evidence-currency').value, page.$('evidence-form').elements.currency.value];
  const direct = await mountWorkspace({ background, hash: '#search' });
  assert.deepEqual(currencies(direct), ['GBP', 'GBP'], 'opened on Search');
  const viaNav = await mountWorkspace({ background, hash: '#watchlist' });
  await viaNav.navigate('#search');
  assert.deepEqual(currencies(viaNav), ['GBP', 'GBP'], 'reached from the nav');
  const late = await mountBeforeSnapshot(background, { hash: '#search' });
  await late.land();
  assert.deepEqual(currencies(late), ['GBP', 'GBP'], 'with the snapshot late');
  direct.$('evidence-currency').value = 'CHF';
  await direct.$('evidence-filters').emit('input', { target: direct.$('evidence-currency') });
  const euro = await background.send({ type: 'preferences.save', expectedRevision: created.value.revision, preferences: { ...created.value, currency: 'EUR' } });
  assert.equal(euro.ok, true, euro.message);
  await settle();
  assert.deepEqual(currencies(direct), ['CHF', 'EUR'], 'the filter the collector chose stands; the untouched form follows the new default');
});
