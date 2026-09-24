// The workspace page itself, driven like a page against the real store: its markup in the fake DOM,
// the real command writer behind the real bridge, and a second view writing through the same
// background when a case needs one. These are the editor-state checks docs/MANUAL-TEST.md used to
// ask a person to click through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceBackground, mountWorkspace, settle } from './helpers/dom.mjs';
import { COIN_REMOVED_NOTICE } from '../extension/workspace-editing.js';

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
  assert.match(row.querySelector('.coin-row-when').textContent, /^Closes Tue, Oct 1, 3:00 PM( Europe\/London)? · in \d+ days$/);
  assert.equal(row.querySelector('.status-pill').textContent, 'Bid active');
  assert.equal(row.querySelector('.coin-row-event').textContent, 'Roma E-Sale 130');
  assert.equal(row.querySelector('.status-pill').dataset.tone, 'active');
  await page.openCoin('Nero, denarius');
  assert.match(page.$('attached-event').textContent, /^Roma E-Sale 130 · Closes Tue, Oct 1, 3:00 PM( Europe\/London)? · in \d+ days$/);
  await page.navigate('#auctions');
  assert.match(page.$('event-list').textContent, /Closes Tue, Oct 1, 3:00 PM( Europe\/London)? · in \d+ days/);
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

// N15: the inline calculator follows the bid just saved. It keeps what the collector typed in it for as long as the
// coin's saved terms stay the same, and takes the new terms once a save changes them.
test('the inline calculator follows a bid saved for the coin it shows', async () => {
  const { calculatorInputsForLot } = await import('../extension/bid-tools.js');
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  await page.openCoin('Nero, denarius');
  let loaded;
  const applied = () => page.calculatorValues.splice(0).map((values) => {
    const inputs = calculatorInputsForLot(values, { loadedLotId: loaded });
    if (inputs) loaded = values.lotId;
    return inputs;
  }).filter(Boolean);
  assert.equal(applied().length, 1, 'opening the coin fills the calculator once');

  await page.typeDetails('notes', 'Toned');
  await page.saveDetails();
  assert.deepEqual(applied(), [], 'a details save leaves what was typed in the calculator alone');

  await page.type('bid-form', 'amount', '1300');
  await page.type('bid-form', 'currency', 'EUR');
  await page.type('bid-form', 'premium', '20');
  await page.submit('bid-form', { value: 'place' });
  assert.deepEqual(storedLot(background, 'Nero, denarius').activeBid.amount, { currency: 'EUR', minor: 130000 });
  const [after] = applied().slice(-1);
  assert.equal(after?.currency, 'EUR');
  assert.equal(after?.amount, '1300.00');
  assert.equal(after?.premium, '20.00');
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
  await page.type('event-form', 'localDate', '2030-10-15');
  await page.type('event-form', 'localTime', '14:00');
  f.timeZoneChoice.value = 'Europe/Zurich';
  await page.$('event-form').emit('change', { target: f.timeZoneChoice });
  f.reminderSecond.value = 'custom';
  await page.$('event-form').emit('change', { target: f.reminderSecond });
  assert.equal(page.$('reminder-second-custom').hidden, false);
  await page.type('event-form', 'reminderSecondMinutes', '90');
  assert.equal(page.$('event-summary').textContent, 'Saves “Leu Web Auction 32”: auction starting Tue, Oct 15, 2030, 2:00 PM Europe/Zurich, with reminders 1 day and 90 minutes before.');
  await page.submit('event-form');
  assert.deepEqual(page.prompts, [], 'no confirm dialog');
  const [event] = background.root().auctionEvents;
  assert.equal(event.timeZone, 'Europe/Zurich');
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

// W-07: the saved comparables speak plainly - one sentence when there are none, and "3 comparables · median … · middle
// half … · years" when there are; the set list names each reference with how many it holds.
test('the saved comparables say plainly what they hold', async () => {
  const background = await createWorkspaceBackground();
  const empty = await mountWorkspace({ background, hash: '#search' });
  assert.equal(empty.$('statistics-output').textContent, 'No saved comparables yet. Add a sale you found under Add a comparable manually.');
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

// W-08: "Local records loaded." is said, then cleared after a moment, so it is not a permanent line above every route;
// a message that replaced it in the meantime stays.
test('the loaded notice clears itself, and a later message is left standing', async () => {
  const background = await backgroundWithCoins('Nero, denarius');
  const page = await mountWorkspace({ background, hash: '#watchlist' });
  assert.equal(page.status(), 'Local records loaded.');
  assert.ok(page.timers.some((timer) => timer.ms === 3000));
  page.runTimers();
  assert.equal(page.status(), '');
  await page.openCoin('Nero, denarius');
  await page.typeDetails('notes', 'Toned');
  await page.saveDetails();
  assert.equal(page.status(), 'Saved.');
  page.runTimers();
  assert.equal(page.status(), 'Saved.', 'only the loaded notice clears itself');
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
  assert.deepEqual(page.$('alert-list').children.map((item) => item.textContent), ['Missed · Nomos 30']);
  await page.click('ack-alerts');
  assert.equal(background.root().alerts[0].status, 'acknowledged');
  assert.deepEqual(page.$('alert-list').children.map((item) => item.textContent), []);
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
