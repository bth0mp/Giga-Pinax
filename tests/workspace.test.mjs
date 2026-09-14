import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExposureSections,
  buildBackupImportCommand,
  buildGroupReorderCommand,
  buildLotSaveCommand,
  commandWasCommitted,
  createEventDraft,
  draftToConsumeAfterLotSave,
  evidenceRowsForQuery,
  mergeLotSourceLinks,
  mergeEventReminders,
  lotDraftToEditor,
  moneyInputText,
  reminderControlsForPrecision,
  outcomeDraftForLot,
  receiveWorkspaceSnapshot,
  routeFromHash,
  applyActiveRoute,
  editorCompletion,
  sameEditorIdentity,
  chooseSelectedLot,
  filterWorkspaceLots,
  lotStatusLabel,
  buildLotUndoCommand,
  selectionAfterLotSave,
  buildAttachEventCommand,
  moveDetailTab,
  sameEventReturnContext,
  auctionQueueForLots,
  auctionTimeLabel,
  buildWorkspaceLotDraft,
  comparisonSelectionAfterToggle,
  comparisonRows,
  buildBidSaveCommand,
  comparisonPickerLabel,
  comparisonProvenanceRows,
  lotSaveFollowup,
} from '../extension/workspace.js';

test('workspace chooses only supported direct routes', () => {
  assert.equal(routeFromHash('#watchlist'), 'watchlist');
  assert.equal(routeFromHash('#event-draft=abc'), 'auctions');
  assert.equal(routeFromHash('#lot-draft=abc'), 'watchlist');
  assert.equal(routeFromHash('#unknown'), 'search');
});

test('workspace marks only the active route with the aria-current page token', () => {
  const nodes = new Map(['search', 'watchlist'].map((route) => [route, {
    hidden: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  }]));
  const links = new Map(['search', 'watchlist'].map((route) => [route, {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  }]));
  applyActiveRoute(['search', 'watchlist'], 'watchlist', (route) => nodes.get(route), (route) => links.get(route));
  assert.equal(nodes.get('search').hidden, true);
  assert.equal(nodes.get('watchlist').hidden, false);
  assert.equal(links.get('search').attributes['aria-current'], undefined);
  assert.equal(links.get('watchlist').attributes['aria-current'], 'page');
});

test('watchlist draft is consumed only after the lot write is confirmed', () => {
  assert.equal(draftToConsumeAfterLotSave({ ok: true }, 'draft-1'), 'draft-1');
  assert.equal(draftToConsumeAfterLotSave({ ok: false, outcome: 'not-committed' }, 'draft-1'), null);
  assert.equal(draftToConsumeAfterLotSave({ ok: true }, null), null);
});

test('watchlist draft prefills only editable lot fields', () => {
  assert.deepEqual(lotDraftToEditor({ target: 'watchlist', title: 'Nero denarius', reference: 'RIC 306', pageUrl: 'https://numismatics.org/ocre/id/ric.1(2).ner.306', median: 180, lots: [{ price: 200 }] }), {
    title: 'Nero denarius', reference: 'RIC 306', sourceUrl: 'https://numismatics.org/ocre/id/ric.1(2).ner.306',
  });
});

test('comparable sets stay separate while retaining every observation in a matching deduplicated sale', () => {
  const rows = [
    { id: 'sale-1', observations: [{ queryId: 'nero', source: 'manual' }, { queryId: 'nero', source: 'coinarchives' }] },
    { id: 'sale-2', observations: [{ queryId: 'augustus', source: 'manual' }] },
  ];
  assert.deepEqual(evidenceRowsForQuery(rows, 'nero').map((row) => row.id), ['sale-1']);
  assert.equal(evidenceRowsForQuery(rows, '').length, 0);
});

test('title-only lot edits preserve all prior provenance links and replace only the edited manual URL', () => {
  const existing = [
    { source: 'coinarchives', url: 'https://www.coinarchives.com/a/lotviewer.php?LotID=1' },
    { source: 'manual', url: 'https://old.example/lot' },
    { source: 'manual', url: 'https://other.example/lot' },
  ];
  assert.deepEqual(mergeLotSourceLinks(existing, 'https://new.example/lot', existing[1].url), [
    existing[0], { source: 'manual', url: 'https://new.example/lot' }, existing[2],
  ]);
  assert.deepEqual(mergeLotSourceLinks(existing, '', existing[1].url), [existing[0], existing[2]]);
});

test('unknown writes are resolved from the request ledger and outcome editors preserve saved money', () => {
  assert.equal(commandWasCommitted({ recentCommands: [{ requestId: 'req-1' }] }, 'req-1'), true);
  assert.equal(commandWasCommitted({ recentCommands: [] }, 'req-1'), false);
  assert.deepEqual(outcomeDraftForLot({ outcome: { status: 'won', hammer: { currency: 'GBP', minor: 1234 }, actualInvoice: { currency: 'EUR', minor: 1600 } } }, 'de-DE'), {
    status: 'won', hammer: '12,34', hammerCurrency: 'GBP', invoice: '16,00', invoiceCurrency: 'EUR', bindingActive: '',
  });
  assert.equal(moneyInputText({ currency: 'USD', minor: Number.MAX_SAFE_INTEGER }, 'en-US'), '90071992547409.91');
});

test('event reminder edits retain actual slot IDs and unrepresented valid reminders', () => {
  const reminders = [
    { id: 'first', kind: 'offset', offsetMinutes: 60 },
    { id: 'second', kind: 'offset', offsetMinutes: 30 },
    { id: 'extra', kind: 'offset', offsetMinutes: 5 },
  ];
  assert.deepEqual(mergeEventReminders(reminders, 'timed', { firstEnabled: true, firstValue: 90, secondEnabled: true, secondValue: 15 }), [
    { id: 'first', kind: 'offset', offsetMinutes: 90 },
    { id: 'second', kind: 'offset', offsetMinutes: 15 },
    reminders[2],
  ]);
});

test('switching event precision initializes that reminder kind without changing a saved zero-reminder event', () => {
  assert.deepEqual(reminderControlsForPrecision(createEventDraft('date-only').reminders, 'date-only'), {
    firstEnabled: true, firstValue: '09:00', secondEnabled: true, secondValue: '09:00',
  });
  assert.deepEqual(reminderControlsForPrecision([], 'date-only'), {
    firstEnabled: false, firstValue: '09:00', secondEnabled: false, secondValue: '09:00',
  });
  assert.deepEqual(reminderControlsForPrecision(createEventDraft('timed').reminders, 'timed'), {
    firstEnabled: true, firstValue: 1440, secondEnabled: true, secondValue: 60,
  });
});

test('import confirmation uses the revision that was actually previewed', () => {
  const pending = { expectedRevision: 7, mode: 'merge', document: '{"schemaVersion":1}' };
  assert.deepEqual(buildBackupImportCommand(pending, () => 'req-import'), {
    type: 'backup.import', requestId: 'req-import', expectedRevision: 7, mode: 'merge', document: pending.document,
  });
});

test('dirty workspace editors survive committed updates and show conflict state', () => {
  const state = { snapshot: { revision: 2 }, dirtyEditors: new Set(['lot']), editorValues: { lot: { title: 'Unsaved' } }, conflict: null };
  const next = receiveWorkspaceSnapshot(state, { revision: 3 });
  assert.equal(next.snapshot.revision, 2);
  assert.equal(next.editorValues.lot.title, 'Unsaved');
  assert.equal(next.conflict.pendingSnapshot.revision, 3);
});

test('a save reply resets only the editor version that was submitted', () => {
  assert.equal(editorCompletion(4, 4), 'reset');
  assert.equal(editorCompletion(4, 5), 'preserve');
  assert.equal(editorCompletion(4, 9), 'preserve');
});

test('a late save reply rebases only the same editor record', () => {
  const sameNewDraft = { id: null };
  assert.equal(sameEditorIdentity(sameNewDraft, sameNewDraft), true);
  assert.equal(sameEditorIdentity({ id: null }, { id: null }), false);
  assert.equal(sameEditorIdentity({ id: 'lot-a' }, { id: 'lot-a' }), true);
  assert.equal(sameEditorIdentity({ id: null }, { id: 'lot-b' }), false);
  assert.equal(sameEditorIdentity({ id: 'lot-a' }, { id: 'lot-b' }), false);
});

test('selected coin routing preserves one record across related editors', () => {
  const lots = [{ id: 'lot-a' }, { id: 'lot-b' }];
  const selected = chooseSelectedLot({ selectedLotId: 'lot-a', mode: 'detail' }, 'lot-b', lots);
  assert.deepEqual(selected, { selectedLotId: 'lot-b', mode: 'detail' });
  assert.equal(chooseSelectedLot(selected, 'missing', lots), selected);
  assert.deepEqual(chooseSelectedLot(selected, null, lots), { selectedLotId: null, mode: 'list' });
  assert.deepEqual(chooseSelectedLot({ selectedLotId: 'lot-a', mode: 'list' }, 'lot-a', lots), { selectedLotId: 'lot-a', mode: 'detail' });
});

test('coin filtering keeps selection context independent of visible rows', () => {
  const lots = [
    { id: 'a', title: 'Nero denarius', reference: 'RIC 306', lotNumber: '18' },
    { id: 'b', title: 'Athens owl', reference: 'HGC 1597', lotNumber: '42' },
  ];
  assert.deepEqual(filterWorkspaceLots(lots, 'nero').map(({ id }) => id), ['a']);
  assert.deepEqual(filterWorkspaceLots(lots, '42').map(({ id }) => id), ['b']);
  assert.deepEqual(filterWorkspaceLots(lots, '  ').map(({ id }) => id), ['a', 'b']);
});

test('collector-facing lot status describes outcomes and bid state', () => {
  assert.equal(lotStatusLabel({ outcome: { status: 'won' } }), 'Won');
  assert.equal(lotStatusLabel({ outcome: { status: 'open' }, activeBid: { amount: { currency: 'GBP', minor: 100 } } }), 'Bid active');
  assert.equal(lotStatusLabel({ outcome: { status: 'open' }, plannedBid: { amount: { currency: 'GBP', minor: 100 } } }), 'Bid planned');
  assert.equal(lotStatusLabel({ outcome: { status: 'open' } }), 'Watching');
});

test('undo restores captured lot details only at the saved revision', () => {
  const previous = { id: 'lot-a', revision: 3, title: 'Before', notes: 'Old', sourceLinks: [] };
  const command = buildLotUndoCommand({ previous, saved: { id: 'lot-a', revision: 4 } }, () => 'undo-1');
  assert.deepEqual(command, {
    type: 'lot.save', requestId: 'undo-1', expectedRevision: 4,
    lot: { id: 'lot-a', title: 'Before', notes: 'Old', sourceLinks: [], auctionContext: null, coinDetails: null, provenanceNotes: null, costEstimate: null },
  });
  assert.equal(buildLotUndoCommand({ previous, saved: { id: 'lot-b', revision: 4 } }, () => 'undo-2'), null);
  assert.equal(buildLotUndoCommand({ previous: { id: 'lot-a', revision: 1, title: 'Old record', sourceLinks: [] }, saved: { id: 'lot-a', revision: 2 } }, () => 'undo-3').lot.notes, '');
  assert.deepEqual(buildLotUndoCommand({ previous: { id: 'lot-a', revision: 1, title: 'Before', sourceLinks: [] }, saved: { id: 'lot-a', revision: 2, auctionContext: { pageUrl: 'https://a.test/1' } } }, () => 'undo-4').lot, { id: 'lot-a', title: 'Before', sourceLinks: [], notes: '', auctionContext: null, coinDetails: null, provenanceNotes: null, costEstimate: null });
});

test('a delayed lot save never retargets a newer selection or new draft', () => {
  const submitted = { selectedLotId: 'lot-a', mode: 'detail' };
  assert.deepEqual(selectionAfterLotSave(submitted, submitted, 4, 4, 'lot-a'), submitted);
  assert.deepEqual(selectionAfterLotSave({ selectedLotId: 'lot-b', mode: 'detail' }, submitted, 4, 4, 'lot-a'), { selectedLotId: 'lot-b', mode: 'detail' });
  assert.deepEqual(selectionAfterLotSave({ selectedLotId: null, mode: 'detail' }, submitted, 4, 5, 'lot-a'), { selectedLotId: null, mode: 'detail' });
});

test('ordinary existing lot saves offer undo while preserved input and selection changes do not', () => {
  const submitted = { selectedLotId: 'lot-a', mode: 'detail' };
  assert.deepEqual(lotSaveFollowup(submitted, submitted, { id: 'lot-a' }, false), { selection: submitted, offerUndo: true });
  assert.deepEqual(lotSaveFollowup(submitted, submitted, { id: 'lot-a' }, true), { selection: submitted, offerUndo: false });
  assert.deepEqual(lotSaveFollowup({ selectedLotId: 'lot-b', mode: 'detail' }, submitted, { id: 'lot-a' }, false), { selection: { selectedLotId: 'lot-b', mode: 'detail' }, offerUndo: false });
  assert.deepEqual(lotSaveFollowup({ selectedLotId: null, mode: 'detail' }, { selectedLotId: null, mode: 'detail' }, { id: 'lot-new' }, false, false), { selection: { selectedLotId: 'lot-new', mode: 'detail' }, offerUndo: false });
  assert.deepEqual(lotSaveFollowup({ selectedLotId: null, mode: 'detail' }, { selectedLotId: null, mode: 'detail' }, { id: 'lot-a' }, false, false, true), { selection: { selectedLotId: null, mode: 'detail' }, offerUndo: false });
  assert.deepEqual(lotSaveFollowup(submitted, submitted, { id: 'lot-a' }, false, true, true), { selection: submitted, offerUndo: false });
});

test('new auction attachment uses the selected coin revision and preserves all details', () => {
  const lot = { id: 'lot-a', revision: 8, dataClass: 'collector', createdAt: 'then', updatedAt: 'now', title: 'Coin', notes: '', sourceLinks: [] };
  assert.deepEqual(buildAttachEventCommand(lot, 'event-b', () => 'attach-1'), {
    type: 'lot.save', requestId: 'attach-1', expectedRevision: 8,
    lot: { id: 'lot-a', title: 'Coin', notes: '', sourceLinks: [], auctionEventId: 'event-b' },
  });
});

test('coin detail tabs support arrow, Home and End keyboard movement', () => {
  assert.equal(moveDetailTab('details', 'ArrowRight'), 'bid');
  assert.equal(moveDetailTab('details', 'ArrowLeft'), 'outcome');
  assert.equal(moveDetailTab('reminders', 'Home'), 'details');
  assert.equal(moveDetailTab('bid', 'End'), 'outcome');
});

test('auction return context belongs only to the editor submission that captured it', () => {
  const lotA = { id: 'lot-a', revision: 2 };
  assert.equal(sameEventReturnContext(lotA, lotA, 3, 3), true);
  assert.equal(sameEventReturnContext(lotA, { id: 'lot-b', revision: 1 }, 3, 3), false);
  assert.equal(sameEventReturnContext(lotA, lotA, 3, 4), false);
});

test('command builders use the background contract and complete group order', () => {
  const create = buildLotSaveCommand({ title: 'Nero denarius', sourceLinks: [] }, null, () => 'req-1');
  assert.deepEqual(create, { type: 'lot.save', requestId: 'req-1', expectedRevision: null, lot: { title: 'Nero denarius', sourceLinks: [] } });
  const groups = [{ id: 'g', revision: 4 }, { id: 'source', revision: 2 }];
  const lots = [{ id: 'a', revision: 7, alternativeGroupId: 'g' }, { id: 'b', revision: 8, alternativeGroupId: 'source' }, { id: 'c', revision: 9, alternativeGroupId: 'source' }];
  assert.deepEqual(buildGroupReorderCommand(groups[0], ['a', 'b'], { alternativeGroups: groups, lots }, () => 'req-2'), {
    type: 'group.reorder', requestId: 'req-2', groupId: 'g', expectedRevision: 4, orderedLotIds: ['a', 'b'],
    expectedGroupRevisions: { g: 4, source: 2 }, expectedLotRevisions: { a: 7, b: 8, c: 9 },
  });
});

test('exposure view keeps currency and event totals distinct', () => {
  const sections = buildExposureSections({
    auctionEvents: [{ id: 'event-a', name: 'Auction A' }],
    lots: [
      { id: 'a', title: 'Coin A', auctionEventId: 'event-a', outcome: { status: 'open' }, activeBid: { amount: { currency: 'EUR', minor: 1000 }, buyerPremiumBps: 2000 } },
      { id: 'b', title: 'Coin B', auctionEventId: 'event-a', outcome: { status: 'open' }, activeBid: { amount: { currency: 'EUR', minor: 500 } } },
      { id: 'c', title: 'Coin C', outcome: { status: 'open' }, activeBid: { amount: { currency: 'USD', minor: 200 } } },
    ],
  });
  assert.deepEqual(sections.map((section) => section.currency), ['USD', 'EUR']);
  assert.equal(sections[1].hammerMinor, 1500);
  assert.equal(sections[1].knownHammerPlusBpMinor, 1200);
  assert.equal(sections[1].unknownPremiumCount, 1);
  assert.equal(sections[1].events[0].name, 'Auction A');
});

test('event drafts require explicit precision and supply editable reminder defaults', () => {
  const timed = createEventDraft('timed');
  assert.deepEqual(timed.reminders.map((item) => item.offsetMinutes), [1440, 60]);
  const dateOnly = createEventDraft('date-only');
  assert.deepEqual(dateOnly.reminders, [
    { id: 'previous-day', kind: 'wall-time', daysBefore: 1, localTime: '09:00' },
    { id: 'auction-day', kind: 'wall-time', daysBefore: 0, localTime: '09:00' },
  ]);
});

test('auction queue classifies closing, research, bid and completed lots and sorts timed before date-only', () => {
  const now = '2026-09-14T12:00:00.000Z';
  const events = [
    { id: 'later', eventKind: 'lot-closes', precision: 'timed', localDate: '2026-09-15', localTime: '12:00', timeZone: 'UTC', startsAt: '2026-09-15T12:00:00.000Z' },
    { id: 'soon', eventKind: 'auction-starts', precision: 'timed', localDate: '2026-09-14', localTime: '18:00', timeZone: 'UTC', startsAt: '2026-09-14T18:00:00.000Z' },
    { id: 'day', eventKind: 'auction-day', precision: 'date-only', localDate: '2026-09-14', timeZone: 'UTC' },
  ];
  const lots = [
    { id: 'unknown', title: 'Unknown', outcome: { status: 'open' }, reference: 'RIC 1' },
    { id: 'day', title: 'Day', auctionEventId: 'day', outcome: { status: 'open' }, reference: 'RIC 2' },
    { id: 'later', title: 'Later', auctionEventId: 'later', outcome: { status: 'open' }, reference: 'RIC 3' },
    { id: 'soon', title: 'Soon', auctionEventId: 'soon', outcome: { status: 'open' } },
    { id: 'planned', title: 'Plan', plannedBid: { amount: { currency: 'GBP', minor: 100 } }, outcome: { status: 'open' } },
    { id: 'active', title: 'Active', activeBid: { amount: { currency: 'GBP', minor: 100 } }, outcome: { status: 'open' } },
    { id: 'done', title: 'Done', outcome: { status: 'lost' } },
  ];
  assert.deepEqual(auctionQueueForLots(lots, events, 'closing-soon', now).map(({ lot }) => lot.id), ['soon', 'later']);
  assert.deepEqual(auctionQueueForLots(lots, events, 'needs-research', now).map(({ lot }) => lot.id), ['soon', 'planned', 'active']);
  assert.deepEqual(auctionQueueForLots(lots, events, 'all-open', now).map(({ lot }) => lot.id), ['soon', 'later', 'day', 'unknown', 'planned', 'active']);
  assert.deepEqual(auctionQueueForLots(lots, events, 'planned', now).map(({ lot }) => lot.id), ['planned']);
  assert.deepEqual(auctionQueueForLots(lots, events, 'active', now).map(({ lot }) => lot.id), ['active']);
  assert.deepEqual(auctionQueueForLots(lots, events, 'completed', now).map(({ lot }) => lot.id), ['done']);
});

test('auction labels distinguish a timed lot deadline from a date-only auction day', () => {
  assert.equal(auctionTimeLabel({ eventKind: 'lot-closes', precision: 'timed', localDate: '2026-09-15', localTime: '12:00', timeZone: 'UTC' }), 'Lot deadline · 2026-09-15 at 12:00 UTC');
  assert.equal(auctionTimeLabel({ eventKind: 'auction-starts', precision: 'timed', localDate: '2026-09-15', localTime: '12:00', timeZone: 'UTC' }), 'Event starts · 2026-09-15 at 12:00 UTC');
  assert.equal(auctionTimeLabel({ eventKind: 'auction-day', precision: 'date-only', localDate: '2026-09-15', timeZone: 'UTC' }), 'Auction day · 2026-09-15 (date only, UTC)');
});

test('workspace detail save replaces optional metadata while preserving calculator cost estimate', () => {
  const existing = {
    id: 'lot-a', title: 'Old', sourceLinks: [{ source: 'manual', url: 'https://old.example/lot' }],
    costEstimate: { currency: 'GBP', shippingMinor: 1200, paymentFeeBps: 250, paymentFeeMinor: 40, incrementMinor: 500, minimumBidMinor: 1000 },
  };
  const draft = buildWorkspaceLotDraft(existing, {
    title: 'Coin', reference: 'RIC 10', notes: 'toned', auctionEventId: '', sourceUrl: 'https://new.example/lot',
    auctionPageUrl: 'https://auction.example/lot/10', auctionCanonicalUrl: '', auctionHouse: 'Roma', auctionSaleId: '31', auctionLotNumber: '10',
    weightGrams: '3.45', diameterMm: '18.2', condition: 'Very fine', photoUrl1: 'https://img.example/a.jpg', photoUrl2: '',
    provenanceNotes: [{ id: 'p1', text: 'Collection A', sourceUrl: 'https://source.example/p1', recordedAt: '2026-09-14T12:00:00.000Z', auctionDate: '2010-01-02' }],
  }, 'https://old.example/lot');
  assert.deepEqual(draft.auctionContext, { pageUrl: 'https://auction.example/lot/10', house: 'Roma', saleId: '31', lotNumber: '10' });
  assert.deepEqual(draft.coinDetails, { photoUrls: ['https://img.example/a.jpg'], weightMg: 3450, diameterHundredthsMm: 1820, condition: 'Very fine' });
  assert.deepEqual(draft.provenanceNotes, [{ id: 'p1', text: 'Collection A', sourceUrl: 'https://source.example/p1', recordedAt: '2026-09-14T12:00:00.000Z', auctionDate: '2010-01-02' }]);
  assert.deepEqual(draft.costEstimate, existing.costEstimate);
});

test('comparison selection is session-only, unique and bounded to four coins', () => {
  assert.deepEqual(comparisonSelectionAfterToggle([], 'a'), ['a']);
  assert.deepEqual(comparisonSelectionAfterToggle(['a'], 'a'), []);
  assert.deepEqual(comparisonSelectionAfterToggle(['a', 'b', 'c', 'd'], 'e'), ['a', 'b', 'c', 'd']);
  const rows = comparisonRows([{ id: 'a', title: 'A', plannedBid: { amount: { currency: 'GBP', minor: 1000 }, buyerPremiumBps: 2000 }, costEstimate: { currency: 'GBP', shippingMinor: 200, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0 } }, { id: 'b', title: 'B', activeBid: { amount: { currency: 'EUR', minor: 2200 } }, costEstimate: { currency: 'GBP', shippingMinor: 300 } }], ['b', 'a']);
  assert.deepEqual(rows.map((row) => [row.id, row.amountLabel]), [['b', 'Active maximum EUR 22.00'], ['a', 'Planned maximum GBP 10.00']]);
  assert.deepEqual(rows.map((row) => row.estimateLabel), ['Fee estimate unavailable for EUR; recalculate', 'GBP fees: shipping 2.00 + fixed 0.00 + 0.00%']);
  assert.deepEqual(rows.map((row) => row.totalLabel), ['Estimated total unknown; buyer premium not recorded', 'Estimated total GBP 14.00']);
});

test('comparison prioritizes terminal results over preserved plans and labels actual invoices separately', () => {
  const rows = comparisonRows([
    { id: 'won', title: 'Won', outcome: { status: 'won', hammer: { currency: 'USD', minor: 8000 }, actualInvoice: { currency: 'USD', minor: 9500 } }, plannedBid: { amount: { currency: 'USD', minor: 10000 }, buyerPremiumBps: 2000 }, costEstimate: { currency: 'USD', shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0 } },
    { id: 'lost', title: 'Lost', outcome: { status: 'lost', hammer: { currency: 'GBP', minor: 12000 } }, activeBid: { amount: { currency: 'GBP', minor: 9000 }, buyerPremiumBps: 2000 } },
    { id: 'passed', title: 'Passed', outcome: { status: 'passed' }, plannedBid: { amount: { currency: 'EUR', minor: 7000 }, buyerPremiumBps: 1500 } },
    { id: 'open', title: 'Open', outcome: { status: 'open' }, plannedBid: { amount: { currency: 'CHF', minor: 6000 } }, costEstimate: { currency: 'CHF', shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0 } },
  ], ['won', 'lost', 'passed', 'open']);
  assert.deepEqual(rows.map((row) => row.amountLabel), ['Final hammer USD 80.00', 'Final hammer GBP 120.00', 'Final hammer not recorded', 'Planned maximum CHF 60.00']);
  assert.deepEqual(rows.map((row) => row.actualTotalLabel), ['Actual invoice USD 95.00', '', '', '']);
  assert.deepEqual(rows.map((row) => row.totalLabel), ['', '', '', 'Estimated total unknown; buyer premium not recorded']);
});

test('comparison picker identifies same-reference coins by title and auction lot identity', () => {
  assert.equal(comparisonPickerLabel({ title: 'Roman denarius · shortlist A', reference: 'Crawford 511/2b', auctionContext: { house: 'Roma', saleId: '31', lotNumber: '10' } }), 'Roman denarius · shortlist A · Crawford 511/2b · Roma sale 31 lot 10');
  assert.equal(comparisonPickerLabel({ title: 'Roman denarius · shortlist B', reference: 'Crawford 511/2b', lotNumber: '22' }), 'Roman denarius · shortlist B · Crawford 511/2b · lot 22');
  assert.equal(comparisonPickerLabel({ title: 'Athens owl' }), 'Athens owl');
});

test('comparison provenance distinguishes auction date from the date the collector recorded it', () => {
  assert.deepEqual(comparisonProvenanceRows([
    { id: 'p1', text: 'Ex Archer collection', sourceUrl: 'https://source.test/archer', recordedAt: '2026-09-14T12:00:00.000Z', auctionDate: '2012-05-03' },
    { id: 'p2', text: 'Dealer ticket', sourceUrl: 'https://source.test/ticket', recordedAt: '2026-09-13T22:00:00.000Z' },
  ]), [
    { id: 'p1', text: 'Ex Archer collection', sourceUrl: 'https://source.test/archer', dateLabel: 'Auction date 2012-05-03 · Recorded 2026-09-14' },
    { id: 'p2', text: 'Dealer ticket', sourceUrl: 'https://source.test/ticket', dateLabel: 'Recorded 2026-09-13' },
  ]);
});

test('watchlist draft carries captured auction context into the editor', () => {
  assert.deepEqual(lotDraftToEditor({ target: 'watchlist', title: 'Coin', reference: 'RIC 1', pageUrl: 'https://auction.example/lot', auctionContext: { pageUrl: 'https://auction.example/lot', house: 'Roma', saleId: '12', lotNumber: '4' } }), {
    title: 'Coin', reference: 'RIC 1', sourceUrl: 'https://auction.example/lot',
    auctionContext: { pageUrl: 'https://auction.example/lot', house: 'Roma', saleId: '12', lotNumber: '4' },
  });
});

test('workspace bid command carries only a matching calculator estimate atomically', () => {
  const bid = { amount: { currency: 'GBP', minor: 10000 }, buyerPremiumBps: 2000 };
  const estimate = { currency: 'GBP', shippingMinor: 500, paymentFeeBps: 300, paymentFeeMinor: 20, incrementMinor: 1000, minimumBidMinor: 2000 };
  assert.deepEqual(buildBidSaveCommand('plan', { id: 'lot-a', revision: 3 }, bid, estimate, () => 'bid-1'), { type: 'bid.plan', requestId: 'bid-1', lotId: 'lot-a', expectedRevision: 3, plannedBid: bid, costEstimate: estimate });
  assert.equal(buildBidSaveCommand('place', { id: 'lot-a', revision: 3 }, { amount: { currency: 'EUR', minor: 10000 } }, estimate, () => 'bid-2').costEstimate, undefined);
});

test('workspace rejects malformed nonempty measurements instead of omitting them', () => {
  assert.throws(() => buildWorkspaceLotDraft({ id: 'lot-a' }, { title: 'Coin', weightGrams: 'heavy', diameterMm: '' }), /valid weight/);
  assert.throws(() => buildWorkspaceLotDraft({ id: 'lot-a' }, { title: 'Coin', weightGrams: '', diameterMm: 'wide' }), /valid diameter/);
});
