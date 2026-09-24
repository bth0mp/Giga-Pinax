import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHtmlFile } from './helpers/dom.mjs';
import {
  buildAttachEventCommand, buildBidSaveCommand, buildGroupReorderCommand, buildLotSaveCommand, buildLotUndoCommand,
  COIN_REMOVED_NOTICE, commandExpectedRevisions, commandReplacedRevisions, commandWasCommitted, conflictNoteMessage,
  draftToConsumeAfterLotSave, editorCompletion, editorsWithChangedBasis, eventAttachDecision, lotSaveFollowup,
  planCommit, removedCoinNotice, removedHereAfterDeleteReply, sameEditorIdentity, sameEventReturnContext,
  selectionAfterSnapshot, submissionContext, WORKSPACE_EDITORS,
} from '../extension/workspace-editing.js';
import {
  applyActiveRoute, auctionQueueForLots, auctionTimeLabel, buildExposureSections, chooseSelectedLot, eventWhen,
  comparisonPickerLabel, comparisonProvenanceRows, comparisonRows, comparisonSelectionAfterToggle, evidenceRowsForQuery,
  filterWorkspaceLots, lotStatusLabel, moveDetailTab, reminderAtLabel, routeFromHash,
} from '../extension/workspace-views.js';
import {
  bidFormValues, buildWorkspaceLotDraft, createEventDraft, estimateNoteText, lotDraftToEditor, lotFormValues,
  mergeEventReminders, mergeLotSourceLinks, mergeRebasedFields, moneyInputText, offeredEventFromDraft,
  lotFieldForPath, outcomeDraftForLot, premiumInputText, rememberedZone, reminderControlsForPrecision,
} from '../extension/workspace-forms.js';
import { parseMoney, parsePremiumPercent } from '../extension/core/money.js';
import { LIMITS, projectCollection } from '../extension/core/records.js';
import { eventTiming, lotComparables, lotsNeedingOutcome, reminderInstants } from '../extension/core/projections.js';

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
    status: 'won', hammer: '12.34', hammerCurrency: 'GBP', invoice: '16.00', invoiceCurrency: 'EUR', bindingActive: '', hammerPlaceholder: '', acquisitionDate: '',
  });
  assert.equal(moneyInputText({ currency: 'USD', minor: Number.MAX_SAFE_INTEGER }, 'en-US'), '90071992547409.91');
});

// A saved amount goes back into a field the collector saves again, and the parser reads ASCII digits
// with a point or a comma. ar-EG and fa-IR write ٫ and their own digits, bn-BD its own digits: a
// field written in any of them could never be saved again, so every field is written the one way.
test('saved bid and outcome amounts are written back so they save again in every locale', () => {
  const lot = {
    plannedBid: { amount: { currency: 'EUR', minor: 123456 }, buyerPremiumBps: 2250 },
    outcome: { status: 'won', hammer: { currency: 'EUR', minor: 150000 }, actualInvoice: { currency: 'EUR', minor: 184512 } },
  };
  for (const locale of ['ar-EG', 'fa-IR', 'bn-BD', 'de-DE', 'en-US']) {
    const bid = bidFormValues(lot, locale, 'USD');
    assert.deepEqual(bid, { amount: '1234.56', currency: 'EUR', premium: '22.5' }, locale);
    assert.deepEqual(parseMoney(bid.amount, 'EUR', locale), { ok: true, value: { currency: 'EUR', minor: 123456 } }, locale);
    assert.deepEqual(parsePremiumPercent(bid.premium, locale), { ok: true, value: 2250 }, locale);
    const outcome = outcomeDraftForLot(lot, locale);
    assert.equal(parseMoney(outcome.hammer, 'EUR', locale).value?.minor, 150000, locale);
    assert.equal(parseMoney(outcome.invoice, 'EUR', locale).value?.minor, 184512, locale);
    // "Use in bid" writes the calculator's premium the same way the bid form is populated.
    for (const bps of [0, 1, 2050, 2250, 10000]) {
      assert.deepEqual(parsePremiumPercent(premiumInputText(bps), locale), { ok: true, value: bps }, `${locale} ${bps}`);
    }
  }
  assert.equal(premiumInputText(null), '');
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

test('a committed update conflicts only with the dirty editors whose own record moved', () => {
  const snapshot = { lots: [{ id: 'lot-a', revision: 3 }], auctionEvents: [{ id: 'event-a', revision: 1 }], alternativeGroups: [] };
  const bases = new Map([
    ['lot', { id: 'lot-a', revision: 3 }],
    ['bid', { id: 'lot-a', revision: 2 }],
    ['outcome', { id: 'removed-elsewhere', revision: 1 }],
    ['event', { id: null, revision: null }],
  ]);
  assert.deepEqual(editorsWithChangedBasis(snapshot, new Set(WORKSPACE_EDITORS), bases), ['bid', 'outcome']);
  assert.deepEqual(editorsWithChangedBasis(snapshot, new Set(['lot', 'event', 'evidence']), bases), []);
  assert.deepEqual(editorsWithChangedBasis(snapshot, new Set(), bases), []);
  // A snapshot carrying this page's own in-flight write is not a conflict with the form that
  // produced it: that editor is judged when its reply is processed.
  assert.deepEqual(editorsWithChangedBasis(snapshot, new Set(WORKSPACE_EDITORS), bases, new Set(['bid'])), ['outcome']);
});

test('the conflict note names the editors it belongs to and stays hidden without one', () => {
  assert.equal(conflictNoteMessage([]), '');
  assert.equal(conflictNoteMessage(['lot']), 'Committed data changed while the coin details form has unsaved input.');
  assert.equal(conflictNoteMessage(['lot', 'bid']), 'Committed data changed while the coin details and bid forms have unsaved input.');
  assert.equal(conflictNoteMessage(['lot', 'bid', 'event']), 'Committed data changed while the coin details, bid and auction forms have unsaved input.');
});

const commitInput = ({ lots = [], auctionEvents = [], alternativeGroups = [], bases = [], dirty = [], versions = [], ...rest }) => ({
  snapshot: { lots, auctionEvents, alternativeGroups },
  bases: new Map(bases), dirty: new Set(dirty), versions: new Map(versions),
  ...rest,
});

test('a committed save repopulates its own editor without moving any edit version', () => {
  const plan = planCommit(commitInput({
    editor: 'lot', submittedBasis: { id: 'lot-a', revision: 3 }, submittedVersion: 7,
    value: { id: 'lot-a', revision: 4, title: 'Saved' },
    lots: [{ id: 'lot-a', revision: 4, title: 'Saved' }],
    bases: [['lot', { id: 'lot-a', revision: 3, record: { id: 'lot-a', revision: 3 } }]],
    dirty: ['lot'], versions: [['lot', 7]],
  }));
  assert.deepEqual(plan.repopulate, ['lot']);
  assert.deepEqual(plan.reset, []);
  assert.deepEqual([...plan.dirty], []);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.preserved, false);
  assert.equal(plan.bases.get('lot').revision, 4);
  assert.deepEqual(plan.bases.get('lot').record, { id: 'lot-a', revision: 4, title: 'Saved' });
  // The auction attach and every other after-save decision reads the version it submitted.
  assert.deepEqual([...plan.versions], [['lot', 7]]);
});

test('a save keeps input typed while it was in flight and rebases it onto the committed record', () => {
  const plan = planCommit(commitInput({
    editor: 'lot', submittedBasis: { id: 'lot-a', revision: 3 }, submittedVersion: 7,
    value: { id: 'lot-a', revision: 4 },
    lots: [{ id: 'lot-a', revision: 4 }],
    bases: [['lot', { id: 'lot-a', revision: 3 }]], dirty: ['lot'], versions: [['lot', 9]],
  }));
  assert.equal(plan.preserved, true);
  assert.deepEqual(plan.repopulate, []);
  assert.deepEqual([...plan.dirty], ['lot']);
  assert.equal(plan.bases.get('lot').revision, 4);
  assert.deepEqual(plan.conflicts, []);
});

// The merge exists for a form the collector was not saving: it follows a write from elsewhere in the fields they left alone.
// A form's own save is not such a write, and a field put back to what it was reads as untouched — so merging the save's own
// record into the form that submitted it silently undid the revert, and the next save stored the value the collector had
// just taken out.
test('a save never merges its own committed record back into the form that submitted it', () => {
  const before = { id: 'lot-a', revision: 3, title: 'A', notes: '', sourceLinks: [] };
  const saved = { ...before, revision: 4, title: 'B' };
  const plan = planCommit(commitInput({
    editor: 'lot', submittedBasis: { id: 'lot-a', revision: 3 }, submittedVersion: 7,
    value: saved, lots: [saved],
    bases: [['lot', { id: 'lot-a', revision: 3, record: before }]], dirty: ['lot'], versions: [['lot', 9]],
  }));
  assert.equal(plan.preserved, true, 'the form still keeps what was typed while the save was in flight');
  assert.deepEqual(plan.merge, [], 'and nothing is merged into it');
  // What the merge would have written: the title the collector typed back is indistinguishable from one they never touched.
  assert.deepEqual(mergeRebasedFields(lotFormValues(before), lotFormValues(saved), lotFormValues(before)), { title: 'B' });
});

test('an editor that moved to another coin is untouched by the reply it no longer owns', () => {
  const bases = [['bid', { id: 'lot-b', revision: 1 }]];
  const plan = planCommit(commitInput({
    editor: 'bid', submittedBasis: { id: 'lot-a', revision: 3 }, submittedVersion: 2,
    value: { id: 'lot-a', revision: 4 },
    lots: [{ id: 'lot-a', revision: 4 }, { id: 'lot-b', revision: 1 }],
    bases, dirty: [], versions: [['bid', 2]],
  }));
  assert.deepEqual(plan.bases.get('bid'), { id: 'lot-b', revision: 1 });
  assert.deepEqual([plan.repopulate, plan.reset, [...plan.dirty]], [[], [], []]);
});

test('a coin’s other editors follow a commit only when they were based on the replaced record', () => {
  const dirtyLot = (revision) => commitInput({
    editor: 'bid', submittedBasis: { id: 'lot-a', revision: 4 }, submittedVersion: 1,
    value: { id: 'lot-a', revision: 5 },
    lots: [{ id: 'lot-a', revision: 5 }],
    bases: [['lot', { id: 'lot-a', revision }], ['bid', { id: 'lot-a', revision: 4 }]],
    dirty: ['lot'], versions: [['bid', 1]],
  });
  const together = planCommit(dirtyLot(4));
  assert.equal(together.bases.get('lot').revision, 5);
  assert.deepEqual(together.conflicts, []);
  assert.deepEqual([...together.dirty], ['lot']);
  // The detail form was still on revision 3 because another view had already written revision 4:
  // rebasing it here would hide that conflict and let Save details overwrite the other view.
  const stale = planCommit(dirtyLot(3));
  assert.equal(stale.bases.get('lot').revision, 3);
  assert.deepEqual(stale.conflicts, ['lot']);
});

test('a dirty bid editor left behind by another view keeps its conflict when details are saved', () => {
  const plan = planCommit(commitInput({
    editor: 'lot', submittedBasis: { id: 'lot-a', revision: 4 }, submittedVersion: 1,
    value: { id: 'lot-a', revision: 5 },
    lots: [{ id: 'lot-a', revision: 5 }],
    bases: [['lot', { id: 'lot-a', revision: 4 }], ['bid', { id: 'lot-a', revision: 3 }]],
    dirty: ['bid'], versions: [['lot', 1]],
  }));
  assert.equal(plan.bases.get('bid').revision, 3);
  assert.deepEqual(plan.conflicts, ['bid']);
});

test('an editor-less commit moves the dirty editors it replaced instead of conflicting with itself', () => {
  const undone = (revision) => planCommit(commitInput({
    editor: null, submittedRevisions: { 'lot-a': 4 },
    value: { id: 'lot-a', revision: 5 },
    lots: [{ id: 'lot-a', revision: 5 }],
    bases: [['bid', { id: 'lot-a', revision }]], dirty: ['bid'],
  }));
  assert.deepEqual(undone(4).conflicts, []);
  assert.equal(undone(4).bases.get('bid').revision, 5);
  assert.deepEqual(undone(3).conflicts, ['bid']);
});

test('a group reorder carries every coin revision it claimed, so its own writes raise no banner', () => {
  const command = buildGroupReorderCommand({ id: 'group-a', revision: 2 }, ['lot-a'], {
    alternativeGroups: [{ id: 'group-a', revision: 2 }],
    lots: [{ id: 'lot-a', revision: 7, alternativeGroupId: 'group-a' }],
  }, () => 'req');
  assert.deepEqual(commandExpectedRevisions(command), { 'group-a': 2, 'lot-a': 7 });
  const plan = planCommit(commitInput({
    editor: null, submittedRevisions: commandExpectedRevisions(command),
    value: { id: 'group-a', revision: 3 },
    lots: [{ id: 'lot-a', revision: 8, alternativeGroupId: 'group-a' }],
    alternativeGroups: [{ id: 'group-a', revision: 3 }],
    bases: [['lot', { id: 'lot-a', revision: 7 }]], dirty: ['lot'],
  }));
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.bases.get('lot').revision, 8);
});

test('an auction attached while the details form is dirty survives that form’s next save', () => {
  const before = { id: 'lot-a', revision: 3, title: 'Nero denarius', notes: 'Check the mint', sourceLinks: [] };
  const attached = { ...before, revision: 4, auctionEventId: 'event-a' };
  // The collector was still typing in the details form when "Add auction" committed the attachment.
  const typed = { ...lotFormValues(before), notes: 'Check the mint mark and the reverse legend' };
  const plan = planCommit(commitInput({
    editor: null, submittedRevisions: { 'lot-a': 3 }, value: attached,
    lots: [attached], auctionEvents: [{ id: 'event-a', revision: 0 }],
    bases: [['lot', { id: 'lot-a', revision: 3, record: before }]], dirty: ['lot'], versions: [['lot', 4]],
  }));
  assert.deepEqual(plan.merge, ['lot'], 'the rebased dirty editor is named for the merge');
  assert.equal(plan.bases.get('lot').revision, 4);
  const rebased = plan.bases.get('lot').record;
  const fields = mergeRebasedFields(lotFormValues(before), lotFormValues(rebased), typed);
  assert.deepEqual(fields, { auctionEventId: 'event-a' });
  const draft = buildWorkspaceLotDraft(rebased, { ...typed, ...fields }, plan.bases.get('lot').originalManualUrl);
  assert.equal(draft.auctionEventId, 'event-a', 'the next save keeps the attachment');
  assert.equal(draft.notes, 'Check the mint mark and the reverse legend', 'and the unsaved edits');
});

test('a rebased form follows committed data only in the fields the collector left alone', () => {
  const before = { id: 'lot-a', revision: 3, title: 'Nero', reference: 'RIC 306', lotNumber: '12', notes: '', sourceLinks: [] };
  const committed = { ...before, revision: 4, reference: 'RIC 307', lotNumber: '15' };
  const typed = { ...lotFormValues(before), reference: 'RIC 306 var', notes: 'Mine' };
  // `reference` moved on both sides, so the collector's text stays; `notes` is theirs alone.
  assert.deepEqual(mergeRebasedFields(lotFormValues(before), lotFormValues(committed), typed), { lotNumber: '15' });
  assert.deepEqual(mergeRebasedFields(lotFormValues(before), lotFormValues(before), typed), {});
});

test('a settled outcome moves the bid form’s untouched fields but not the typed premium', () => {
  const bidding = { id: 'lot-a', revision: 3, activeBid: { amount: { currency: 'EUR', minor: 15000 }, buyerPremiumBps: 2000 } };
  const settled = { id: 'lot-a', revision: 4, outcome: { status: 'won' } };
  const typed = { ...bidFormValues(bidding, 'en-US', 'USD'), premium: '22.5' };
  const plan = planCommit(commitInput({
    editor: 'outcome', submittedBasis: { id: 'lot-a', revision: 3 }, submittedVersion: 1,
    value: settled, lots: [settled],
    bases: [['bid', { id: 'lot-a', revision: 3, record: bidding }], ['outcome', { id: 'lot-a', revision: 3 }]],
    dirty: ['bid'], versions: [['outcome', 1]],
  }));
  assert.deepEqual(plan.merge, ['bid']);
  assert.deepEqual(mergeRebasedFields(bidFormValues(bidding, 'en-US', 'USD'), bidFormValues(settled, 'en-US', 'USD'), typed), {
    amount: '', currency: 'USD',
  });
});

test('the details form reads the same values the merge compares', () => {
  const lot = {
    id: 'lot-a', revision: 2, title: 'Nero', reference: 'RIC 306', lotNumber: '12', notes: 'kept',
    auctionEventId: 'event-a', sourceLinks: [{ source: 'manual', url: 'https://example.test/lot' }],
    auctionContext: { pageUrl: 'https://house.test/lot/12', house: 'House' },
    coinDetails: { weightMg: 3400, diameterHundredthsMm: 1850, condition: 'VF', photoUrls: ['https://photo.test/a.jpg'] },
  };
  assert.deepEqual(lotFormValues(lot), {
    id: 'lot-a', title: 'Nero', reference: 'RIC 306', lotNumber: '12', notes: 'kept', auctionEventId: 'event-a',
    sourceUrl: 'https://example.test/lot', auctionPageUrl: 'https://house.test/lot/12', auctionCanonicalUrl: '',
    auctionHouse: 'House', auctionSaleId: '', auctionLotNumber: '', weightGrams: '3.4', diameterMm: '18.5',
    condition: 'VF', photoUrl1: 'https://photo.test/a.jpg', photoUrl2: '',
  });
  assert.deepEqual(bidFormValues({ plannedBid: { amount: { currency: 'GBP', minor: 1234 }, buyerPremiumBps: 2050 } }, 'en-US', 'USD'), {
    amount: '12.34', currency: 'GBP', premium: '20.5',
  });
  assert.deepEqual(bidFormValues(null, 'en-US', 'CHF'), { amount: '', currency: 'CHF', premium: '' });
});

test('a coin written again between the commit and the refresh conflicts instead of being followed', () => {
  // The reorder took lot-a from 5 to 6; the snapshot already holds 7, so another view wrote it in
  // between. Rebasing onto 7 would carry the dirty form past a change it never saw.
  const plan = planCommit(commitInput({
    editor: null, submittedRevisions: { 'group-a': 2, 'lot-a': 5 },
    value: { id: 'group-a', revision: 3 },
    lots: [{ id: 'lot-a', revision: 7 }], alternativeGroups: [{ id: 'group-a', revision: 3 }],
    bases: [['lot', { id: 'lot-a', revision: 5, record: { id: 'lot-a', revision: 5 } }]], dirty: ['lot'],
  }));
  assert.equal(plan.bases.get('lot').revision, 5, 'the basis is kept');
  assert.deepEqual(plan.conflicts, ['lot']);
  assert.deepEqual(plan.merge, []);
});

test('commands name the records they claim to replace', () => {
  assert.deepEqual(commandExpectedRevisions({ type: 'lot.save', expectedRevision: 8, lot: { id: 'lot-a' } }), { 'lot-a': 8 });
  assert.deepEqual(commandExpectedRevisions({ type: 'lot.delete', lotId: 'lot-a', expectedRevision: 2 }), { 'lot-a': 2 });
  assert.deepEqual(commandExpectedRevisions({ type: 'event.delete', eventId: 'event-a', expectedRevision: 1 }), { 'event-a': 1 });
  assert.deepEqual(commandExpectedRevisions({ type: 'lot.save', expectedRevision: null, lot: {} }), {});
  assert.deepEqual(commandExpectedRevisions({ type: 'alert.markAllRead' }), {});
});

test('deleting a group moves the dirty editors of its member coins instead of conflicting', () => {
  // The store clears the group from every member coin, bumping each one, but the command names
  // only the group; the members come from the snapshot the command was sent against.
  const sent = {
    lots: [{ id: 'lot-a', revision: 7, alternativeGroupId: 'group-a' }, { id: 'lot-b', revision: 2 }],
    alternativeGroups: [{ id: 'group-a', revision: 2 }],
  };
  const command = { type: 'group.delete', requestId: 'req', groupId: 'group-a', expectedRevision: 2 };
  assert.deepEqual(commandReplacedRevisions(command, sent), { 'group-a': 2, 'lot-a': 7 });
  // Deleting a coin that is in no group claims nothing but the coin itself.
  assert.deepEqual(commandReplacedRevisions({ type: 'lot.delete', lotId: 'lot-b', expectedRevision: 2 }, sent), { 'lot-b': 2 });
  const cleared = { id: 'lot-a', revision: 8, title: 'Nero', sourceLinks: [] };
  const plan = planCommit(commitInput({
    editor: null, submittedRevisions: commandReplacedRevisions(command, sent),
    value: { id: 'group-a', revision: 2 }, lots: [cleared, sent.lots[1]],
    bases: [['lot', { id: 'lot-a', revision: 7, record: { ...cleared, revision: 7, alternativeGroupId: 'group-a' } }]],
    dirty: ['lot'],
  }));
  assert.deepEqual(plan.conflicts, [], 'the collector never has to discard input over this page’s own delete');
  assert.equal(plan.bases.get('lot').revision, 8);
  assert.deepEqual(plan.merge, ['lot']);
});

test('deleting a coin carries the group it leaves and the coins renumbered behind it', () => {
  // The store stamps the group the coin leaves and renumbers the members ordered after it, but the
  // command names only the coin: a half-typed group name is this page's own doing, not a conflict.
  const sent = {
    lots: [
      { id: 'lot-a', revision: 7, alternativeGroupId: 'group-a', priority: 1 },
      { id: 'lot-b', revision: 2, alternativeGroupId: 'group-a', priority: 2 },
      { id: 'lot-c', revision: 4, alternativeGroupId: 'group-a', priority: 3 },
      { id: 'lot-d', revision: 9 },
    ],
    alternativeGroups: [{ id: 'group-a', revision: 5 }],
  };
  const command = { type: 'lot.delete', requestId: 'req', lotId: 'lot-b', expectedRevision: 2 };
  // `lot-a` keeps priority 1, so the store never writes it and nothing here claims it.
  assert.deepEqual(commandReplacedRevisions(command, sent), { 'lot-b': 2, 'group-a': 5, 'lot-c': 4 });
  const group = { id: 'group-a', revision: 5, name: 'Nero shortlist' };
  const plan = planCommit(commitInput({
    editor: 'lot', submittedBasis: { id: 'lot-b', revision: 2 }, submittedVersion: 1,
    submittedRevisions: commandReplacedRevisions(command, sent), value: { id: 'lot-b', revision: 2 },
    lots: [sent.lots[0], { id: 'lot-c', revision: 5, alternativeGroupId: 'group-a', priority: 2 }, sent.lots[3]],
    alternativeGroups: [{ ...group, revision: 6 }],
    bases: [
      ['lot', { id: 'lot-b', revision: 2 }],
      ['group', { id: 'group-a', revision: 5, record: group }],
      ['bid', { id: 'lot-c', revision: 4 }],
    ],
    dirty: ['group', 'bid'], versions: [['lot', 1], ['group', 3], ['bid', 2]],
  }));
  assert.deepEqual(plan.conflicts, [], 'the unsaved group name and the renumbered coin’s bid form follow the commit');
  assert.equal(plan.bases.get('group').revision, 6);
  assert.equal(plan.bases.get('bid').revision, 5);
  assert.deepEqual(plan.reset, ['lot'], 'only the deleted coin’s own form is blanked');
});

test('resolving a collection review carries the linked coin the command never names', () => {
  const sent = {
    lots: [{ id: 'lot-a', revision: 6, collectionEntryId: 'entry-a', collectionReviewReason: 'outcome-reopened' }],
    collectionEntries: [{ id: 'entry-a', revision: 1, lotId: 'lot-a', reviewReason: 'outcome-reopened' }],
  };
  const command = { type: 'collection.review.resolve', requestId: 'req', collectionEntryId: 'entry-a', expectedRevision: 1, decision: 'keep' };
  assert.deepEqual(commandReplacedRevisions(command, sent), { 'lot-a': 6 });
  assert.deepEqual(commandReplacedRevisions({ ...command, collectionEntryId: 'entry-gone' }, sent), {});
  const resolved = { id: 'lot-a', revision: 7, collectionEntryId: 'entry-a' };
  const plan = planCommit(commitInput({
    editor: null, submittedRevisions: commandReplacedRevisions(command, sent),
    value: resolved, lots: [resolved],
    bases: [['lot', { id: 'lot-a', revision: 6, record: sent.lots[0] }]], dirty: ['lot'],
  }));
  assert.deepEqual(plan.conflicts, [], 'the review decision is this page’s own write, not another view’s');
  assert.equal(plan.bases.get('lot').revision, 7);
});

test('a delete keeps its own removal until a reply proves nothing was written', () => {
  assert.equal(removedHereAfterDeleteReply('lot-a', 'lot-a', { ok: true }), 'lot-a');
  // The worker was unreachable, or the accepted write could not be verified: the delete may well
  // have committed, so the coin leaving a later snapshot is still this page's own doing.
  assert.equal(removedHereAfterDeleteReply('lot-a', 'lot-a', { ok: false, code: 'unreachable', outcome: 'unknown' }), 'lot-a');
  assert.equal(removedHereAfterDeleteReply('lot-a', 'lot-a', { ok: false, code: 'conflict', outcome: 'not-committed' }), null);
  assert.equal(removedHereAfterDeleteReply('lot-a', 'lot-a', undefined), null, 'a delete that was never sent removed nothing');
  assert.equal(removedHereAfterDeleteReply('lot-b', 'lot-a', { ok: false, outcome: 'not-committed' }), 'lot-b', 'another coin’s removal is left alone');
  // What the collector is spared: being told their own uncertain delete happened in another view.
  const uncertain = removedHereAfterDeleteReply('lot-a', 'lot-a', { ok: false, outcome: 'unknown' });
  assert.equal(removedCoinNotice({ selectedLotId: 'lot-a', mode: 'detail' }, { selectedLotId: null, mode: 'list' }, new Set(['lot']), uncertain), false);
});

test('a removed record blanks its editor, and a failed refresh never blanks a new one', () => {
  const deleted = planCommit(commitInput({
    editor: 'lot', submittedBasis: { id: 'lot-a', revision: 3 }, submittedVersion: 1,
    value: { id: 'lot-a', revision: 3 }, lots: [], bases: [['lot', { id: 'lot-a', revision: 3 }]],
    dirty: ['lot'], versions: [['lot', 1]],
  }));
  assert.deepEqual([deleted.reset, deleted.repopulate], [['lot'], []]);
  assert.equal(deleted.bases.has('lot'), false);
  // The coin was created; the snapshot that would confirm it never arrived.
  const draft = { id: null, revision: null, record: null };
  const created = planCommit(commitInput({
    editor: 'lot', submittedBasis: draft, submittedVersion: 1,
    value: { id: 'lot-new', revision: 0, title: 'Added' }, lots: [], snapshotFresh: false,
    bases: [['lot', draft]], dirty: ['lot'], versions: [['lot', 1]],
  }));
  assert.deepEqual([created.reset, created.repopulate], [[], ['lot']]);
  assert.deepEqual(created.bases.get('lot').record, { id: 'lot-new', revision: 0, title: 'Added' });
  assert.equal(created.conflicts, null, 'a stale snapshot decides no conflicts');
});

test('the comparable form is cleared after an add because it has no record to return to', () => {
  const plan = planCommit(commitInput({
    editor: 'evidence', submittedVersion: 3, value: { id: 'evidence-a', revision: 0 },
    dirty: ['evidence'], versions: [['evidence', 3]],
  }));
  assert.deepEqual([plan.reset, plan.repopulate], [['evidence'], []]);
});

test('retrying the same request keeps the version and basis the first attempt submitted', () => {
  const basis = { id: 'lot-a', revision: 4, record: { id: 'lot-a', revision: 4 } };
  const versions = new Map([['lot', 6]]);
  const bases = new Map([['lot', basis]]);
  const attempt = submissionContext(null, 'lot', versions, bases);
  assert.deepEqual(attempt, { submittedVersion: 6, submittedBasis: basis });
  assert.deepEqual(submissionContext(null, null, versions, bases), { submittedVersion: null, submittedBasis: null });
  // The collector kept typing while the outcome of the first attempt was unknown.
  versions.set('lot', 9);
  const retry = submissionContext(attempt, 'lot', versions, bases);
  assert.equal(retry.submittedVersion, 6);
  const plan = planCommit(commitInput({
    editor: 'lot', ...retry, value: { id: 'lot-a', revision: 5 }, lots: [{ id: 'lot-a', revision: 5 }],
    bases: [['lot', basis]], dirty: ['lot'], versions: [['lot', 9]],
  }));
  assert.equal(plan.preserved, true, 'typing after the failed attempt is not treated as saved');
  assert.deepEqual(plan.repopulate, []);
  assert.deepEqual([...plan.dirty], ['lot']);
});

test('a selected coin that left the snapshot clears the selection instead of editing a ghost', () => {
  const snapshot = { lots: [{ id: 'lot-a' }] };
  const selected = { selectedLotId: 'lot-a', mode: 'detail' };
  assert.equal(selectionAfterSnapshot(selected, snapshot), selected);
  assert.deepEqual(selectionAfterSnapshot({ selectedLotId: 'removed', mode: 'detail' }, snapshot), { selectedLotId: null, mode: 'list' });
  const draft = { selectedLotId: null, mode: 'detail' };
  assert.equal(selectionAfterSnapshot(draft, snapshot), draft);
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

test('an auction saved from a coin is attached to it, and never skipped in silence', () => {
  const lot = { id: 'lot-a', revision: 2 };
  const snapshot = { lots: [lot] };
  const context = { returnLot: lot, currentReturnLot: lot, submittedVersion: 3, currentVersion: 3, selectedLotId: 'lot-a', snapshot, eventId: 'event-a' };
  assert.deepEqual(eventAttachDecision(context), { action: 'attach', lot, eventId: 'event-a' });
  // The auction editor was not opened from a coin: nothing to attach, nothing to say.
  assert.deepEqual(eventAttachDecision({ ...context, returnLot: null }), { action: 'none' });
  for (const [name, changed] of [
    ['the collector typed in the auction form while it saved', { currentVersion: 4 }],
    ['another coin claimed the auction form', { currentReturnLot: { id: 'lot-b', revision: 1 } }],
  ]) {
    assert.deepEqual(eventAttachDecision({ ...context, ...changed }), {
      action: 'message',
      message: 'Auction saved. The auction form changed while it was saving, so it was not attached to the coin. Attach it from coin details.',
    }, name);
  }
  assert.deepEqual(eventAttachDecision({ ...context, selectedLotId: 'lot-b' }), {
    action: 'message', message: 'Auction saved, but the coin changed before it could be attached. Attach it from coin details.',
  });
  assert.deepEqual(eventAttachDecision({ ...context, snapshot: { lots: [{ id: 'lot-a', revision: 3 }] } }), {
    action: 'message', message: 'Auction saved, but the coin changed before it could be attached. Attach it from coin details.',
  });
  assert.deepEqual(eventAttachDecision({ ...context, eventId: undefined }), {
    action: 'message', message: 'Auction saved, but its confirmed identity was unavailable. Attach it from coin details.',
  });
});

test('a coin removed in another view is announced, not left to a hidden banner', () => {
  assert.equal(COIN_REMOVED_NOTICE, 'The coin you were editing was removed in another view. Unsaved input for it was discarded.');
  const selected = { selectedLotId: 'lot-a', mode: 'detail' };
  const cleared = { selectedLotId: null, mode: 'list' };
  assert.equal(removedCoinNotice(selected, cleared, new Set(['bid'])), true);
  // The collector confirmed this delete in this page, so nothing was removed behind their back.
  assert.equal(removedCoinNotice(selected, cleared, new Set(['bid']), 'lot-a'), false);
  assert.equal(removedCoinNotice(selected, cleared, new Set(['bid']), 'lot-b'), true);
  assert.equal(removedCoinNotice(selected, selected, new Set(['bid'])), false);
  assert.equal(removedCoinNotice(selected, cleared, new Set(['event'])), false);
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

// The collection view: the collector's own acquisitions and their own saved comparables, each
// currency on its own. Nothing is converted, nothing is added across currencies, and no figure here
// is an appraisal.
const collectionEntry = (id, lotId, acquisitionDate, amounts = {}) => ({
  id, lotId, title: `Coin ${id}`, acquisitionDate, sourceLinks: [], revision: 0, ...amounts,
});
const eur = (minor) => ({ currency: 'EUR', minor });
const usd = (minor) => ({ currency: 'USD', minor });
const comparable = (id, queryLabel, hammer, extra = {}) => ({
  id, dataClass: 'collector', inclusion: 'included',
  resolved: { priceBasis: 'hammer', resolution: 'source-agreement', hammer },
  observations: [{ id: `${id}-seen`, queryId: `query-${queryLabel}`, queryLabel, source: 'manual', auctionHouse: 'House', lotNumber: id, auctionDate: '2025-05-01', priceBasis: 'hammer', amount: hammer }],
  ...extra,
});

test('the collection is totalled within each currency, never across them', () => {
  const collection = projectCollection({
    lots: [{ id: 'lot-a', reference: 'RIC 27b' }, { id: 'lot-b' }, { id: 'lot-c' }, { id: 'lot-d' }],
    collectionEntries: [
      collectionEntry('a', 'lot-a', '2019-05-01', { hammer: eur(100000), actualInvoice: eur(125000) }),
      collectionEntry('b', 'lot-b', '2021-02-03', { hammer: usd(50000), actualInvoice: usd(62000) }),
      collectionEntry('c', 'lot-c', '2023-11-30', { hammer: eur(20000) }),
      // Paid in another currency than it was knocked down in: each amount stays in its own.
      collectionEntry('d', 'lot-d', '2020-07-07', { hammer: eur(30000), actualInvoice: { currency: 'CHF', minor: 40000 } }),
    ],
  });
  assert.deepEqual(Object.keys(collection.byCurrency), ['USD', 'EUR', 'CHF']);
  assert.deepEqual(collection.byCurrency.EUR, {
    entryCount: 3, hammerCount: 3, hammerMinor: 150000, invoiceCount: 1, invoiceMinor: 125000, firstYear: 2019, lastYear: 2023,
  });
  assert.deepEqual(collection.byCurrency.USD, {
    entryCount: 1, hammerCount: 1, hammerMinor: 50000, invoiceCount: 1, invoiceMinor: 62000, firstYear: 2021, lastYear: 2021,
  });
  assert.deepEqual(collection.byCurrency.CHF, {
    entryCount: 1, hammerCount: 0, hammerMinor: 0, invoiceCount: 1, invoiceMinor: 40000, firstYear: 2020, lastYear: 2020,
  });
  assert.deepEqual(collection.unpriced, { entryCount: 0, firstYear: null, lastYear: null });
  assert.deepEqual(collection.entries.map(({ id, currency, reference }) => [id, currency, reference]), [
    ['a', 'EUR', 'RIC 27b'], ['b', 'USD', ''], ['c', 'EUR', ''], ['d', 'EUR', ''],
  ]);
});

test('a collection total too large to hold exactly is withheld rather than rounded', () => {
  const collection = projectCollection({
    lots: [],
    collectionEntries: [
      collectionEntry('a', 'lot-a', '2019-05-01', { hammer: eur(Number.MAX_SAFE_INTEGER) }),
      collectionEntry('b', 'lot-b', '2020-05-01', { hammer: eur(1), actualInvoice: eur(5) }),
    ],
  });
  assert.equal(collection.byCurrency.EUR.hammerMinor, null);
  assert.equal(collection.byCurrency.EUR.hammerCount, 2);
  assert.equal(collection.byCurrency.EUR.invoiceMinor, 5);
});

// The view is projected on every snapshot in every open tab, so it has to stay quick at the store's
// own limits: a full collection against a full evidence list.
test('the collection view is projected quickly at the store’s limits', () => {
  const lots = []; const collectionEntries = []; const evidenceRows = [];
  for (let index = 0; index < LIMITS.collectionEntries; index += 1) {
    lots.push({ id: `lot-${index}`, reference: `RIC ${index}` });
    collectionEntries.push(collectionEntry(`c${index}`, `lot-${index}`, '2020-01-01', { hammer: eur(1000 + index) }));
  }
  for (let index = 0; index < LIMITS.evidenceObservations; index += 1) {
    evidenceRows.push(comparable(`e${index}`, `RIC ${index % (LIMITS.collectionEntries * 2)}`, eur(500 + index)));
  }
  const started = performance.now();
  const collection = projectCollection({ lots, collectionEntries, evidence: evidenceRows });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `took ${Math.round(elapsed)} ms`);
  assert.deepEqual(collection.entries[7].comparables, { status: 'median', currency: 'EUR', count: 5, median: eur(4507) });
});

test('an entry with no hammer is counted without one, and one with no amount at all has no currency', () => {
  const collection = projectCollection({
    lots: [{ id: 'lot-a', reference: 'Price 23' }, { id: 'lot-b', reference: 'Price 23' }],
    collectionEntries: [
      collectionEntry('a', 'lot-a', '2018-01-01', { actualInvoice: usd(9000) }),
      collectionEntry('b', 'lot-b', '2024-01-01'),
    ],
    evidence: [comparable('e1', 'Price 23', usd(8000))],
  });
  assert.deepEqual(collection.byCurrency.USD, {
    entryCount: 1, hammerCount: 0, hammerMinor: 0, invoiceCount: 1, invoiceMinor: 9000, firstYear: 2018, lastYear: 2018,
  });
  assert.deepEqual(collection.unpriced, { entryCount: 1, firstYear: 2024, lastYear: 2024 });
  const [invoiced, unpriced] = collection.entries;
  assert.equal(invoiced.currency, 'USD', 'the invoice gives the entry its currency');
  assert.deepEqual(invoiced.comparables, { status: 'too-few', currency: 'USD', count: 1, median: null });
  assert.equal(unpriced.currency, null);
  assert.deepEqual(unpriced.comparables, { status: 'no-currency', currency: null, count: 0, median: null });
});

test('an entry with no saved comparables for its reference says so', () => {
  const collection = projectCollection({
    lots: [{ id: 'lot-a', reference: 'RIC 27b' }, { id: 'lot-b' }],
    collectionEntries: [
      collectionEntry('a', 'lot-a', '2019-05-01', { hammer: eur(100000) }),
      collectionEntry('b', 'lot-b', '2019-05-01', { hammer: eur(100000) }),
    ],
    evidence: [comparable('e1', 'RIC 27', eur(1)), comparable('e2', 'RIC 27b Philip', eur(2))],
  });
  assert.deepEqual(collection.entries[0].comparables, { status: 'none', currency: 'EUR', count: 0, median: null },
    'a query that only starts or ends like the reference is not its evidence');
  assert.deepEqual(collection.entries[1].comparables, { status: 'no-reference', currency: 'EUR', count: 0, median: null });
});

test('an entry’s comparables are its own reference’s, in its own currency, from included rows only', () => {
  const collection = projectCollection({
    lots: [{ id: 'lot-a', reference: 'RIC  27b' }],
    collectionEntries: [collectionEntry('a', 'lot-a', '2019-05-01', { hammer: eur(100000) })],
    evidence: [
      comparable('e1', 'ric 27b', eur(10000)),
      comparable('e2', 'RIC 27b', eur(30000)),
      comparable('e3', 'RIC 27b', eur(20000)),
      comparable('u1', 'RIC 27b', usd(99999)),
      comparable('u2', 'RIC 27b', usd(99999)),
      comparable('x1', 'RIC 27b', eur(999999), { inclusion: 'excluded', exclusionReason: 'collector-excluded' }),
      comparable('o1', 'RIC 28', eur(1)),
    ],
  });
  assert.deepEqual(collection.entries[0].comparables, { status: 'median', currency: 'EUR', count: 3, median: eur(20000) });
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

test('auction queue classifies closing, research, bid and completed lots and sorts a date-only day by its day', () => {
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
  // N7: a sale day is closing soon from the day before through the day itself, and sorts at its own midnight among
  // the timed instants rather than after all of them.
  assert.deepEqual(auctionQueueForLots(lots, events, 'closing-soon', now).map(({ lot }) => lot.id), ['day', 'soon', 'later']);
  assert.deepEqual(auctionQueueForLots(lots, events, 'needs-research', now).map(({ lot }) => lot.id), ['soon', 'planned', 'active']);
  assert.deepEqual(auctionQueueForLots(lots, events, 'all-open', now).map(({ lot }) => lot.id), ['day', 'soon', 'later', 'unknown', 'planned', 'active']);
  assert.deepEqual(auctionQueueForLots(lots, events, 'planned', now).map(({ lot }) => lot.id), ['planned']);
  assert.deepEqual(auctionQueueForLots(lots, events, 'active', now).map(({ lot }) => lot.id), ['active']);
  assert.deepEqual(auctionQueueForLots(lots, events, 'completed', now).map(({ lot }) => lot.id), ['done']);
});

test('auction labels distinguish a timed lot deadline from a date-only auction day', () => {
  const view = { locale: 'en-GB', timeZone: 'UTC', now: '2026-09-01T00:00:00.000Z' };
  assert.equal(auctionTimeLabel({ eventKind: 'lot-closes', precision: 'timed', localDate: '2026-09-15', localTime: '12:00', timeZone: 'UTC', startsAt: '2026-09-15T12:00:00.000Z' }, view), 'Closes Tue 15 Sept, 12:00 · in 14 days');
  assert.equal(auctionTimeLabel({ eventKind: 'auction-starts', precision: 'timed', localDate: '2026-09-15', localTime: '12:00', timeZone: 'UTC', startsAt: '2026-09-15T12:00:00.000Z' }, view), 'Starts Tue 15 Sept, 12:00 · in 14 days');
  assert.equal(auctionTimeLabel({ eventKind: 'auction-day', precision: 'date-only', localDate: '2026-09-15', timeZone: 'UTC' }, view), 'Sale day Tue 15 Sept · in 14 days');
  // A timed record written without its instant still shows the wall time it holds.
  assert.equal(auctionTimeLabel({ eventKind: 'lot-closes', precision: 'timed', localDate: '2026-09-15', localTime: '12:00', timeZone: 'UTC' }, view), 'Closes Tue 15 Sept, 12:00 · in 14 days');
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

test('the bid calculator sits outside the bid form so Enter in it cannot save a plan', () => {
  const markup = parseHtmlFile(new URL('../extension/workspace.html', import.meta.url));
  const calculator = markup.getElementById('workspace-calculator');
  const bidForm = markup.getElementById('bid-form');
  assert.ok(calculator, 'the calculator is still mounted');
  assert.ok(bidForm, 'the bid form is present');
  // The control that is inside the form shows the reading is real before the one outside it is read.
  assert.equal(bidForm.querySelector('input').closest('form'), bidForm);
  assert.equal(calculator.closest('form'), null, 'and no form encloses the calculator');
});

test('workspace rejects malformed nonempty measurements instead of omitting them', () => {
  assert.throws(() => buildWorkspaceLotDraft({ id: 'lot-a' }, { title: 'Coin', weightGrams: 'heavy', diameterMm: '' }), /valid weight/);
  assert.throws(() => buildWorkspaceLotDraft({ id: 'lot-a' }, { title: 'Coin', weightGrams: '', diameterMm: 'wide' }), /valid diameter/);
});

// One coin read into the details form and saved straight back out again. The populate path and the
// save path are two readings of the same record, so a field added to one of them alone drops out of
// this round trip. Weights span the whole 0.001–1000 g range the form accepts, and every optional
// field appears both present and absent.
const COIN_WEIGHTS_MG = [1, 1000, 3405, 8123, 12345, 999999, 1000000];
const COIN_DIAMETERS_HUNDREDTHS_MM = [1, 100, 1850, 2033, 9999, 100000];
const COIN_DETAIL_VARIANTS = [
  {},
  ...COIN_WEIGHTS_MG.map((weightMg) => ({ coinDetails: { photoUrls: [], weightMg } })),
  ...COIN_DIAMETERS_HUNDREDTHS_MM.map((diameterHundredthsMm) => ({ coinDetails: { photoUrls: [], diameterHundredthsMm } })),
  { coinDetails: { photoUrls: [], condition: 'Good very fine, lightly toned' } },
  { coinDetails: { photoUrls: ['https://photo.test/obverse.jpg'] } },
  { coinDetails: { photoUrls: ['https://photo.test/obverse.jpg', 'https://photo.test/reverse.jpg'] } },
  { coinDetails: { photoUrls: ['https://photo.test/obverse.jpg', 'https://photo.test/reverse.jpg'], weightMg: 3405, diameterHundredthsMm: 1850, condition: 'Good very fine' } },
];
const GENERATED_LOTS = [
  [{}, { reference: 'RIC I 306' }],
  [{}, { lotNumber: '142' }],
  [{ notes: '' }, { notes: 'Toned; struck a little off centre' }],
  [{}, { auctionEventId: 'event-a' }],
  [
    { sourceLinks: [] },
    { sourceLinks: [{ source: 'manual', url: 'https://collector.test/lot/142' }] },
    { sourceLinks: [{ source: 'coinarchives', url: 'https://www.coinarchives.com/a/lotviewer.php?LotID=1' }] },
    { sourceLinks: [
      { source: 'coinarchives', url: 'https://www.coinarchives.com/a/lotviewer.php?LotID=1' },
      { source: 'manual', url: 'https://collector.test/lot/142', sourceRecordId: 'ticket-9' },
    ] },
  ],
  [
    {},
    { auctionContext: { pageUrl: 'https://house.test/sale/31/lot/142' } },
    { auctionContext: { pageUrl: 'https://house.test/sale/31/lot/142', canonicalUrl: 'https://house.test/lot/142', house: 'Roma Numismatics', saleId: '31', lotNumber: '142' } },
  ],
  COIN_DETAIL_VARIANTS,
].reduce((rows, axis) => rows.flatMap((row) => axis.map((fields) => ({ ...row, ...fields }))), [{}])
  .map((fields, index) => ({
    id: `lot-${index}`, revision: 4, dataClass: 'collector',
    createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-02-03T04:05:06.000Z',
    title: 'Nero, denarius', bidHistory: [], outcome: { status: 'open' }, outcomeHistory: [],
    ...fields,
  }));
// What the details form never shows, so the draft never carries it back. Provenance rows are a
// repeating subtree the form reads on its own rather than through `lotFormValues`, and a saved cost
// estimate rides along untouched, so neither belongs to this round trip.
const STORE_OWNED_LOT_FIELDS = ['revision', 'dataClass', 'createdAt', 'updatedAt', 'bidHistory', 'outcome', 'outcomeHistory'];
const formBackedLot = (lot) => {
  const expected = { ...lot, notes: lot.notes ?? '', sourceLinks: lot.sourceLinks ?? [] };
  for (const field of STORE_OWNED_LOT_FIELDS) delete expected[field];
  return expected;
};

test('every field the details form reads from a coin is written back by the draft it saves', () => {
  const filled = new Set();
  for (const lot of GENERATED_LOTS) {
    const values = lotFormValues(lot);
    for (const [field, value] of Object.entries(values)) if (value !== '') filled.add(field);
    assert.deepStrictEqual(buildWorkspaceLotDraft(lot, values), formBackedLot(lot), `the round trip changed ${lot.id}`);
  }
  // A form field no generated coin fills would let a one-sided addition slip through the round trip.
  assert.deepStrictEqual(Object.keys(lotFormValues({})).filter((field) => !filled.has(field)), []);
});

// The page's own behaviour — editors, drafts and the leave-page guard — is driven against the real
// store in tests/workspace-page.test.mjs.

// A live region around the whole coin pane read out every field the page filled in whenever a coin
// was opened or followed a save. What the page has to say goes through its two status lines.
test('only the status line and the announcement are live, not the coin pane', () => {
  const markup = parseHtmlFile(new URL('../extension/workspace.html', import.meta.url));
  assert.ok(markup.querySelector('.coin-detail'), 'the coin pane is present');
  assert.deepEqual(markup.querySelectorAll('[aria-live]').map((element) => element.id), ['announcement']);
  assert.equal(markup.getElementById('workspace-status').getAttribute('role'), 'status');
});

// 0.34 (W2a): the values a lot page stated about its sale reach the draft form as the page gave them, for the collector to keep or clear - the
// photo link in Photo URL 1, the estimate as a line of the notes (the lot has no estimate field of its own) and the closing as an offered auction.
test('a watchlist draft brings the page’s photo, estimate and closing into the editor, and nothing it cannot hold', () => {
  assert.deepEqual(lotDraftToEditor({ target: 'watchlist', title: 'Coin', pageUrl: 'https://auction.example/lot',
    estimate: { minor: 120000, currency: 'EUR' }, closesAt: '2026-10-15T14:00+02:00', photoUrl: 'https://images.auction.example/1.jpg' }), {
    title: 'Coin', reference: '', sourceUrl: 'https://auction.example/lot',
    photoUrl: 'https://images.auction.example/1.jpg', estimateNote: 'Estimate from page: EUR 1200.00', closesAt: '2026-10-15T14:00+02:00',
  });
  assert.deepEqual(lotDraftToEditor({ target: 'watchlist', title: 'Coin', estimate: { minor: 1.5, currency: 'EUR' }, closesAt: 'soon', photoUrl: 'javascript:alert(1)' }),
    { title: 'Coin', reference: '', sourceUrl: '' });
});

test('an estimate is written in its own currency and places, never converted', () => {
  assert.equal(estimateNoteText({ minor: 120000, currency: 'EUR' }), 'Estimate from page: EUR 1200.00');
  assert.equal(estimateNoteText({ minor: 500000, currency: 'JPY' }), 'Estimate from page: JPY 500000');
  assert.equal(estimateNoteText({ minor: 95005, currency: 'SEK' }), 'Estimate from page: SEK 950.05');
  assert.equal(estimateNoteText({ minor: 5, currency: 'KWD' }), 'Estimate from page: KWD 0.005');
  assert.equal(estimateNoteText({ minor: 5, currency: 'eur' }), '');
  assert.equal(estimateNoteText(null), '');
});

test('the offered auction keeps the page’s instant in the collector’s own zone, and a day stays a date-only auction day', () => {
  const timed = offeredEventFromDraft({ closesAt: '2026-10-15T14:00+02:00', pageUrl: 'https://auction.example/lot' }, 'America/New_York');
  assert.deepEqual(timed, {
    eventKind: 'lot-closes', precision: 'timed', localDate: '2026-10-15', localTime: '08:00', timeZone: 'America/New_York',
    reminderScope: 'linked-lots', reminders: createEventDraft('timed').reminders,
    capturedText: 'From the page: 2026-10-15T14:00+02:00', capturedFromUrl: 'https://auction.example/lot',
  });
  assert.equal(offeredEventFromDraft({ closesAt: '2026-10-15T23:30Z' }, 'Asia/Tokyo').localDate, '2026-10-16');
  assert.equal(offeredEventFromDraft({ closesAt: '2026-10-15T23:30Z' }, 'Asia/Tokyo').localTime, '08:30');
  assert.deepEqual(offeredEventFromDraft({ closesAt: '2026-10-15' }, 'Europe/Zurich'), {
    eventKind: 'auction-day', precision: 'date-only', localDate: '2026-10-15', timeZone: 'Europe/Zurich',
    reminderScope: 'linked-lots', reminders: createEventDraft('date-only').reminders, capturedText: 'From the page: 2026-10-15',
  });
  assert.equal(offeredEventFromDraft({ closesAt: '2026-10-15T14:00+14:00' }, 'UTC').localTime, '00:00');
  // A start the page's auction event gives is offered as the auction starting, and its day as the auction's day.
  assert.deepEqual(offeredEventFromDraft({ startsAt: '2026-10-15T10:00+02:00' }, 'Europe/Zurich'), {
    eventKind: 'auction-starts', precision: 'timed', localDate: '2026-10-15', localTime: '10:00', timeZone: 'Europe/Zurich',
    reminderScope: 'linked-lots', reminders: createEventDraft('timed').reminders, capturedText: 'From the page: 2026-10-15T10:00+02:00',
  });
  assert.equal(offeredEventFromDraft({ startsAt: '2026-10-15' }, 'Europe/Zurich').eventKind, 'auction-day');
  assert.equal(offeredEventFromDraft({ closesAt: '2026-10-16T12:00Z', startsAt: '2026-10-15' }, 'UTC').eventKind, 'lot-closes');
  for (const closesAt of [undefined, '', 'soon', '2026-10-15T14:00', '2026-02-30', '2026-10-15T14:00+14:30']) assert.equal(offeredEventFromDraft({ closesAt }, 'Europe/Zurich'), null, String(closesAt));
  assert.equal(offeredEventFromDraft({ closesAt: '2026-10-15T14:00Z' }, 'Not/AZone'), null);
});

// The workspace's stylesheet, read as rules: `{ media, selector, declarations }` for every rule, with the media query
// the rule sits in ('' at the top level). The file is written by hand, one rule after another, so this reads it.
function workspaceCssRules() {
  const css = readFileSync(new URL('../extension/workspace.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const read = (text, media) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf('{', index);
      if (open === -1) break;
      const head = text.slice(index, open).trim();
      let depth = 1; let close = open + 1;
      while (depth && close < text.length) { if (text[close] === '{') depth += 1; else if (text[close] === '}') depth -= 1; close += 1; }
      const body = text.slice(open + 1, close - 1);
      if (head.startsWith('@media')) read(body, head.replace(/\s+/g, ''));
      else for (const selector of head.split(',')) rules.push({ media, selector: selector.trim(), declarations: body });
      index = close;
    }
  };
  read(css, '');
  return rules;
}
const cssDeclarations = (selector, media = '') => workspaceCssRules()
  .filter((rule) => rule.selector === selector && rule.media === media).map((rule) => rule.declarations).join(';');

// W-06: at phone width the nav wraps onto a second line instead of hiding History and Settings off screen.
test('the workspace nav wraps at phone width, so no route is scrolled out of sight', () => {
  assert.match(cssDeclarations('.workspace-nav', '@media(max-width:760px)'), /flex-wrap:wrap/);
});

// W-05: a danger button is red on a transparent face, never red text on the accent's purple (1.46:1).
test('a danger button draws its red on a transparent face with a red border', () => {
  const danger = cssDeclarations('button.danger');
  assert.match(danger, /background:transparent/);
  assert.match(danger, /border-color:var\(--error\)/);
  assert.match(danger, /color:var\(--error\)/);
  const markup = parseHtmlFile(new URL('../extension/workspace.html', import.meta.url));
  for (const id of ['delete-event', 'delete-lot']) assert.ok(markup.getElementById(id).classList.contains('quiet'), id);
});

// W-01: an auction's time as a collector reads it - the day and time in the browser's language, the auction's zone
// named only when it is not the collector's own, and how soon: amber within 48 hours, muted once it has passed.
test('an auction’s time reads as a day, a time and how soon, in the collector’s language', () => {
  const closes = { eventKind: 'lot-closes', precision: 'timed', localDate: '2026-10-01', localTime: '15:00', timeZone: 'Europe/London', startsAt: '2026-10-01T14:00:00.000Z' };
  const view = { locale: 'en-GB', timeZone: 'Europe/London' };
  assert.deepEqual(eventWhen(closes, { ...view, now: '2026-09-24T14:00:00.000Z' }), { when: 'Closes Thu 1 Oct, 15:00', relative: 'in 7 days', tone: '' });
  assert.deepEqual(eventWhen(closes, { ...view, now: '2026-09-30T07:00:00.000Z' }), { when: 'Closes Thu 1 Oct, 15:00', relative: 'in 31 h', tone: 'soon' });
  assert.deepEqual(eventWhen(closes, { ...view, now: '2026-10-01T13:20:00.000Z' }), { when: 'Closes Thu 1 Oct, 15:00', relative: 'in 40 min', tone: 'soon' });
  assert.deepEqual(eventWhen(closes, { ...view, now: '2026-10-02T09:00:00.000Z' }), { when: 'Closes Thu 1 Oct, 15:00', relative: 'closed', tone: 'past' });
  // The auction's own zone is named by its place when the collector is elsewhere (M3 review), as the reminder rows name
  // it; the time stays the auction's. Two names of one zone are one zone.
  assert.equal(eventWhen(closes, { locale: 'en-GB', timeZone: 'America/New_York', now: '2026-09-24T14:00:00.000Z' }).when, 'Closes Thu 1 Oct, 15:00 London');
  assert.equal(eventWhen({ ...closes, timeZone: 'Etc/UTC' }, { locale: 'en-GB', timeZone: 'UTC', now: '2026-09-24T14:00:00.000Z' }).when, 'Closes Thu 1 Oct, 14:00');
  assert.equal(eventWhen(closes, { locale: 'en-US', timeZone: 'Europe/London', now: '2026-09-24T14:00:00.000Z' }).when, 'Closes Thu, Oct 1, 3:00 PM');
  const day = { eventKind: 'auction-day', precision: 'date-only', localDate: '2026-10-01', timeZone: 'Europe/London' };
  assert.deepEqual(eventWhen(day, { ...view, now: '2026-09-24T14:00:00.000Z' }), { when: 'Sale day Thu 1 Oct', relative: 'in 7 days', tone: '' });
  assert.deepEqual(eventWhen(day, { ...view, now: '2026-09-30T14:00:00.000Z' }), { when: 'Sale day Thu 1 Oct', relative: 'tomorrow', tone: 'soon' });
  assert.deepEqual(eventWhen(day, { ...view, now: '2026-10-01T22:00:00.000Z' }), { when: 'Sale day Thu 1 Oct', relative: 'today', tone: 'soon' });
  assert.deepEqual(eventWhen(day, { ...view, now: '2026-10-02T09:00:00.000Z' }), { when: 'Sale day Thu 1 Oct', relative: 'ended', tone: 'past' });
  const starts = { ...closes, eventKind: 'auction-starts' };
  assert.deepEqual(eventWhen(starts, { ...view, now: '2026-10-01T16:00:00.000Z' }), { when: 'Starts Thu 1 Oct, 15:00', relative: 'started', tone: 'past' });
  assert.deepEqual(eventWhen(null, view), { when: 'Time unknown', relative: '', tone: '' });
  assert.equal(auctionTimeLabel(closes, { ...view, now: '2026-09-24T14:00:00.000Z' }), 'Closes Thu 1 Oct, 15:00 · in 7 days');
});

// An auction event's standing against now, which the queues, the row badges and the popup all read the same way.
test('an event is soon within 48 hours or from the day before a sale day, and ended once its instant or day is past', () => {
  const timed = { eventKind: 'lot-closes', precision: 'timed', localDate: '2026-10-01', localTime: '15:00', timeZone: 'Europe/London', startsAt: '2026-10-01T14:00:00.000Z' };
  assert.equal(eventTiming(timed, '2026-09-24T14:00:00.000Z').state, 'upcoming');
  assert.equal(eventTiming(timed, '2026-09-29T14:00:00.000Z').state, 'soon');
  assert.equal(eventTiming(timed, '2026-10-01T14:00:00.001Z').state, 'ended');
  // A live sale that has started is still under way on its day, so it is not ended until the day is over.
  const starts = { ...timed, eventKind: 'auction-starts' };
  assert.equal(eventTiming(starts, '2026-10-01T20:00:00.000Z').state, 'started');
  assert.equal(eventTiming(starts, '2026-10-01T23:30:00.000Z').state, 'ended', 'midnight in London has passed');
  // A sale day is read in its own zone: 23:30 UTC on 30 September is already 1 October in Zurich.
  const day = { eventKind: 'auction-day', precision: 'date-only', localDate: '2026-10-01', timeZone: 'Europe/Zurich' };
  assert.equal(eventTiming(day, '2026-09-29T12:00:00.000Z').state, 'upcoming');
  assert.equal(eventTiming(day, '2026-09-30T12:00:00.000Z').state, 'soon');
  assert.equal(eventTiming(day, '2026-10-01T21:00:00.000Z').state, 'soon');
  assert.equal(eventTiming(day, '2026-10-01T22:30:00.000Z').state, 'ended');
  assert.equal(eventTiming(day, '2026-09-30T12:00:00.000Z').sortMs, Date.parse('2026-09-30T22:00:00.000Z'), 'a day sorts from its own midnight');
  assert.equal(eventTiming(null, '2026-09-30T12:00:00.000Z').state, 'unknown');
});

// N3: the outcome form opens on the action the collector is about to take - Won, in the bid's currency - and never on
// a no-op; the placed bid is a hint in the hammer box, never a value; and a won coin's acquisition date is offered.
test('the outcome form opens an open lot on Won, in its bid’s currency, with the bid only as a hint', () => {
  const eur = (minor) => ({ currency: 'EUR', minor });
  const open = { outcome: { status: 'open' }, activeBid: { amount: eur(130000) }, plannedBid: { amount: { currency: 'GBP', minor: 100 } } };
  assert.deepEqual(outcomeDraftForLot(open, 'en-US', { defaultCurrency: 'USD', event: { localDate: '2026-10-01' }, today: '2026-10-03' }), {
    status: 'won', hammer: '', hammerCurrency: 'EUR', invoice: '', invoiceCurrency: 'EUR', bindingActive: '', hammerPlaceholder: 'Your bid 1300.00', acquisitionDate: '2026-10-01',
  });
  const planned = { outcome: { status: 'open' }, plannedBid: { amount: { currency: 'CHF', minor: 50000 } } };
  assert.equal(outcomeDraftForLot(planned, 'en-US', { defaultCurrency: 'USD' }).hammerCurrency, 'CHF');
  assert.equal(outcomeDraftForLot(planned, 'en-US', { defaultCurrency: 'USD' }).hammerPlaceholder, '', 'a plan is not a bid');
  const watched = { outcome: { status: 'open' } };
  assert.deepEqual(outcomeDraftForLot(watched, 'en-US', { defaultCurrency: 'GBP', today: '2026-10-03' }).hammerCurrency, 'GBP');
  assert.equal(outcomeDraftForLot(watched, 'en-US', { defaultCurrency: 'GBP', today: '2026-10-03' }).acquisitionDate, '2026-10-03', 'no auction: today');
  // A settled lot opens on what was recorded.
  assert.equal(outcomeDraftForLot({ outcome: { status: 'lost', hammer: eur(900) } }, 'en-US', { defaultCurrency: 'USD' }).status, 'lost');
  assert.equal(outcomeDraftForLot({ outcome: { status: 'passed' } }, 'en-US', { defaultCurrency: 'GBP' }).status, 'passed');
});

// N4: the bid form shows the bid in force. A lot saved before placing cleared its plan can hold both, and the placed
// figure is the one that binds.
test('the bid form reads the placed bid before a plan', () => {
  const lot = { plannedBid: { amount: { currency: 'EUR', minor: 120000 } }, activeBid: { amount: { currency: 'EUR', minor: 130000 }, buyerPremiumBps: 2000 } };
  assert.deepEqual(bidFormValues(lot, 'en-US', 'USD'), { amount: '1300.00', currency: 'EUR', premium: '20' });
});

// N14: a reminder is shown as the moment it goes off, in the collector's own time, and at the auction's wall time too
// when the auction is in another zone.
test('a reminder reads as when it goes off in the collector’s time, and in the auction’s zone when that differs', () => {
  const view = { locale: 'en-GB', timeZone: 'America/New_York', now: '2026-10-14T12:00:00.000Z' };
  // 14:00 in Zurich on 16 October is 08:00 in New York.
  assert.deepEqual(reminderAtLabel('2026-10-15T12:00:00.000Z', 'Europe/Zurich', view), { text: 'Tomorrow 8:00 (your time) · 14:00 Zurich', tone: '' });
  assert.deepEqual(reminderAtLabel('2026-10-14T18:00:00.000Z', 'Europe/Zurich', view), { text: 'Today 14:00 (your time) · 20:00 Zurich', tone: 'soon' });
  assert.deepEqual(reminderAtLabel('2026-10-20T18:00:00.000Z', 'America/New_York', view), { text: 'Tue 20 Oct 14:00 (your time)', tone: '' });
  assert.deepEqual(reminderAtLabel('2026-10-13T18:00:00.000Z', 'America/New_York', view), { text: 'Yesterday 14:00 (your time) · passed', tone: 'past' });
  // N14 (M3): the auction's clock stays named once a reminder has passed, and its day is named where it is not the
  // collector's: 22:00 in New York is already 04:00 the next morning in Zurich.
  assert.deepEqual(reminderAtLabel('2026-10-13T18:00:00.000Z', 'Europe/Zurich', view), { text: 'Yesterday 14:00 (your time) · 20:00 Zurich · passed', tone: 'past' });
  assert.deepEqual(reminderAtLabel('2026-10-15T02:00:00.000Z', 'Europe/Zurich', view), { text: 'Today 22:00 (your time) · Thu 15 Oct 4:00 Zurich', tone: 'soon' });
  // Review Minor 1: two names of one zone are one zone, and the auction's clock is not repeated.
  assert.deepEqual(reminderAtLabel('2026-10-20T18:00:00.000Z', 'Etc/UTC', { ...view, timeZone: 'UTC' }), { text: 'Tue 20 Oct 18:00 (your time)', tone: '' });
  const event = { id: 'e', revision: 1, name: 'Leu', eventKind: 'lot-closes', precision: 'timed', localDate: '2026-10-16', localTime: '14:00', timeZone: 'Europe/Zurich', startsAt: '2026-10-16T12:00:00.000Z',
    reminders: [{ id: 'a', kind: 'offset', offsetMinutes: 1440 }, { id: 'b', kind: 'offset', offsetMinutes: 60 }] };
  assert.deepEqual([...reminderInstants(event)], [['a', '2026-10-15T12:00:00.000Z'], ['b', '2026-10-16T11:00:00.000Z']]);
});

// N14 (review Important 3): a new auction takes the zone of the house's last auction only when the house names are the
// same - the name cut before its sale number, `E-Sale N`, `Auction N` or Roman numeral, compared with case and spacing
// set aside. A near miss proposes nothing and the auction starts in the collector's own zone.
test('the zone last used for a house is offered only for the same house name', () => {
  const at = (id, name, timeZone, month) => ({ id, name, timeZone, updatedAt: `2026-0${month}-01T00:00:00.000Z` });
  const events = [
    at('1', 'Leu Web Auction 30', 'Europe/Zurich', 1), at('2', 'Leu Numismatik 31', 'Europe/Berlin', 3),
    at('3', 'Roma Numismatics E-Sale 130', 'Europe/London', 5), at('4', 'The New York Sale 61', 'America/New_York', 2),
    at('5', 'Heritage 3110', 'America/Chicago', 2), at('6', 'Spink 24001', 'Europe/London', 2), at('7', 'Numismatik Naumann 140', 'Europe/Vienna', 2),
  ];
  assert.deepEqual(rememberedZone(events, 'Leu Web Auction 32'), { timeZone: 'Europe/Zurich', from: 'Leu Web Auction 30' });
  assert.deepEqual(rememberedZone(events, 'Roma Numismatics Auction XXV'), { timeZone: 'Europe/London', from: 'Roma Numismatics E-Sale 130' });
  assert.deepEqual(rememberedZone(events, '  roma   NUMISMATICS e-sale 131'), { timeZone: 'Europe/London', from: 'Roma Numismatics E-Sale 130' });
  assert.deepEqual(rememberedZone(events, 'The New York Sale 62'), { timeZone: 'America/New_York', from: 'The New York Sale 61' });
  // The review's wrong proposals: another house sharing the first word, or a word too short to name a house.
  for (const name of ['The Coin Cabinet 12', 'Heritage Europe 78', 'Spink New York 390', 'Numismatik Lanz 170', 'the']) {
    assert.equal(rememberedZone(events, name), null, name);
  }
  assert.equal(rememberedZone(events, 'Nomos 30'), null);
  assert.equal(rememberedZone(events, ''), null);
  assert.equal(rememberedZone(events, 'XII'), null, 'a sale number alone names no house');
  assert.equal(rememberedZone(events, 'Leu Web Auction 33', '1'), null, 'the auction being edited is not its own precedent');
});

// N7: an open coin whose auction has passed needs its outcome recorded. It gets a queue of its own and is counted for
// the popup; a coin already settled, or whose auction is still to come or under way, does not.
test('open coins whose auction has passed are the ones needing an outcome', () => {
  const now = '2026-09-24T12:00:00.000Z';
  const events = [
    { id: 'closed', eventKind: 'lot-closes', precision: 'timed', localDate: '2026-09-20', localTime: '12:00', timeZone: 'UTC', startsAt: '2026-09-20T12:00:00.000Z' },
    { id: 'yesterday', eventKind: 'auction-day', precision: 'date-only', localDate: '2026-09-23', timeZone: 'UTC' },
    { id: 'today', eventKind: 'auction-day', precision: 'date-only', localDate: '2026-09-24', timeZone: 'UTC' },
    { id: 'live', eventKind: 'auction-starts', precision: 'timed', localDate: '2026-09-24', localTime: '09:00', timeZone: 'UTC', startsAt: '2026-09-24T09:00:00.000Z' },
  ];
  const lots = [
    { id: 'a', auctionEventId: 'closed', outcome: { status: 'open' } },
    { id: 'b', auctionEventId: 'yesterday', outcome: { status: 'open' } },
    { id: 'c', auctionEventId: 'today', outcome: { status: 'open' } },
    { id: 'd', auctionEventId: 'live', outcome: { status: 'open' } },
    { id: 'e', auctionEventId: 'closed', outcome: { status: 'won' } },
    { id: 'f', outcome: { status: 'open' } },
  ];
  assert.deepEqual(auctionQueueForLots(lots, events, 'needs-outcome', now).map(({ lot }) => lot.id), ['a', 'b']);
  assert.deepEqual(lotsNeedingOutcome({ lots, auctionEvents: events }, now).map((lot) => lot.id), ['a', 'b']);
  assert.equal(auctionQueueForLots(lots, events, 'closing-soon', now).some(({ lot }) => ['a', 'b'].includes(lot.id)), false, 'an ended sale is not closing soon');
});

// W-02: the coin's own saved comparables by currency - exactly its reference, each currency on its own, never pooled
// or converted - as the Bid tab shows them beside the maximum hammer.
test('a coin’s saved comparables are counted per currency for its exact reference', () => {
  const row = (id, queryLabel, currency, minor, auctionDate, inclusion = 'included') => ({
    id, inclusion, resolved: { priceBasis: 'hammer', hammer: { currency, minor } },
    observations: [{ id: `${id}-o`, queryId: `q-${queryLabel}`, queryLabel, source: 'manual', auctionDate, priceBasis: 'hammer', amount: { currency, minor } }],
  });
  const evidence = [
    row('a', 'RIC 27b', 'EUR', 15000, '2024-03-01'), row('b', 'ric  27B', 'EUR', 18000, '2025-01-01'), row('c', 'RIC 27b', 'EUR', 30000, '2026-02-01'),
    row('d', 'RIC 27b', 'USD', 99900, '2026-02-02'), row('e', 'RIC 27', 'EUR', 1, '2026-02-02'), row('f', 'RIC 27b', 'EUR', 5, '2026-02-03', 'excluded'),
  ];
  assert.deepEqual(lotComparables(evidence, 'RIC 27b'), [
    { currency: 'EUR', count: 3, median: { currency: 'EUR', minor: 18000 }, firstYear: 2024, lastYear: 2026 },
    { currency: 'USD', count: 1, median: null, firstYear: 2026, lastYear: 2026 },
  ]);
  assert.deepEqual(lotComparables(evidence, ''), []);
  assert.deepEqual(lotComparables(evidence, 'RIC 60'), []);
});

// Review Minor 3: a field the store refuses is named and opened on the form, from the path the store answers with.
test('a refused record path leads back to the form field that holds it', () => {
  assert.equal(lotFieldForPath('lots[0].coinDetails.photoUrls[0]'), 'photoUrl1');
  assert.equal(lotFieldForPath('lot.coinDetails.photoUrls[1]'), 'photoUrl2');
  assert.equal(lotFieldForPath('lots[3].coinDetails.weightMg'), 'weightGrams');
  assert.equal(lotFieldForPath('lots[3].auctionContext.lotNumber'), 'auctionLotNumber');
  assert.equal(lotFieldForPath('lots[3].auctionContext.canonicalUrl'), 'auctionCanonicalUrl');
  assert.equal(lotFieldForPath('lots[3].lotNumber'), 'lotNumber');
  assert.equal(lotFieldForPath('lots[3].sourceLinks[1].url'), 'sourceUrl');
  assert.equal(lotFieldForPath('lots[3].title'), 'title');
  assert.equal(lotFieldForPath('lots[3].provenanceNotes[0].text'), null);
  assert.equal(lotFieldForPath(undefined), null);
});

// Review Important 2: a control scrolled into view never lands under the sticky action bar.
test('the coin and outcome forms keep a focused control clear of the sticky bar', () => {
  for (const selector of ['#lot-form input', '#lot-form select', '#lot-form textarea', '#lot-form button', '#outcome-form input', '#outcome-form textarea']) {
    assert.match(cssDeclarations(selector), /scroll-margin-bottom:72px/, selector);
  }
});

// Review Minor 5: once a placed bid is cancelled the form is filled from the cancelled terms, for the collector to
// save again or change; nothing is written back to the store as a plan.
test('after a cancellation the bid form offers the cancelled terms, and only then', () => {
  const cancelled = { bidHistory: [
    { action: 'planned-revised', amount: { currency: 'EUR', minor: 120000 } },
    { action: 'placed', amount: { currency: 'EUR', minor: 130000 }, buyerPremiumBps: 2000 },
    { action: 'externally-cancelled', amount: { currency: 'EUR', minor: 130000 }, buyerPremiumBps: 2000 },
  ] };
  assert.deepEqual(bidFormValues(cancelled, 'en-US', 'USD'), { amount: '1300.00', currency: 'EUR', premium: '20' });
  const clearedSince = { bidHistory: [...cancelled.bidHistory, { action: 'planned-cleared', amount: { currency: 'EUR', minor: 1 } }] };
  assert.deepEqual(bidFormValues(clearedSince, 'en-US', 'USD'), { amount: '', currency: 'USD', premium: '' });
  assert.deepEqual(bidFormValues({ bidHistory: [] }, 'en-US', 'GBP'), { amount: '', currency: 'GBP', premium: '' });
});

// Review Minor 6: the limits come from the store through the page, so the markup carries none of its own to agree by.
test('the limited text boxes carry no maxlength of their own in the markup', () => {
  const markup = parseHtmlFile(new URL('../extension/workspace.html', import.meta.url));
  const limited = markup.querySelectorAll('[data-limit]');
  assert.ok(limited.length >= 9);
  assert.deepEqual(limited.filter((control) => control.hasAttribute('maxlength')).map((control) => control.name), []);
});

// Merge with L4: a coin's saved fee estimate names the VAT on the premium and the platform's fee on the hammer.
test('the comparison names VAT on the premium and the platform fee in a coin’s fees', () => {
  const estimate = { currency: 'EUR', shippingMinor: 1500, paymentFeeBps: 0, paymentFeeMinor: 0, premiumVatBps: 1900, platformFeeBps: 300, incrementMinor: 1, minimumBidMinor: 0 };
  const [row] = comparisonRows([{ id: 'a', title: 'A', outcome: { status: 'open' }, plannedBid: { amount: { currency: 'EUR', minor: 100000 }, buyerPremiumBps: 2500 }, costEstimate: estimate }], ['a']);
  assert.equal(row.estimateLabel, 'EUR fees: shipping 15.00 + fixed 0.00 + 0.00% · VAT 19.00% on the premium · platform fee 3.00% on the hammer');
  // 1,000 + 250 premium + 47.50 VAT + 30 platform fee + 15 shipping.
  assert.equal(row.totalLabel, 'Estimated total EUR 1342.50');
  const [plain] = comparisonRows([{ id: 'b', title: 'B', outcome: { status: 'open' }, plannedBid: { amount: { currency: 'EUR', minor: 100000 } }, costEstimate: { ...estimate, premiumVatBps: 0, platformFeeBps: 0 } }], ['b']);
  assert.equal(plain.estimateLabel, 'EUR fees: shipping 15.00 + fixed 0.00 + 0.00%');
});
