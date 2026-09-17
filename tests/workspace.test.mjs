import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildExposureSections,
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
  WORKSPACE_EDITORS,
  COIN_REMOVED_NOTICE,
  editorsWithChangedBasis,
  conflictNoteMessage,
  planCommit,
  submissionContext,
  lotFormValues,
  bidFormValues,
  mergeRebasedFields,
  commandExpectedRevisions,
  commandReplacedRevisions,
  eventAttachDecision,
  selectionAfterSnapshot,
  removedCoinNotice,
  routeFromHash,
  applyActiveRoute,
  editorCompletion,
  sameEditorIdentity,
  chooseSelectedLot,
  filterWorkspaceLots,
  lotStatusLabel,
  buildLotUndoCommand,
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
  assert.deepEqual(commandReplacedRevisions({ type: 'lot.delete', lotId: 'lot-a', expectedRevision: 7 }, sent), { 'lot-a': 7 });
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

test('the bid calculator sits outside the bid form so Enter in it cannot save a plan', () => {
  const markup = readFileSync(new URL('../extension/workspace.html', import.meta.url), 'utf8');
  const bidForm = /<form id="bid-form"[\s\S]*?<\/form>/.exec(markup);
  assert.ok(bidForm, 'the bid form is present');
  assert.equal(bidForm[0].includes('workspace-calculator'), false);
  assert.ok(markup.includes('id="workspace-calculator"'), 'the calculator is still mounted');
});

test('workspace rejects malformed nonempty measurements instead of omitting them', () => {
  assert.throws(() => buildWorkspaceLotDraft({ id: 'lot-a' }, { title: 'Coin', weightGrams: 'heavy', diameterMm: '' }), /valid weight/);
  assert.throws(() => buildWorkspaceLotDraft({ id: 'lot-a' }, { title: 'Coin', weightGrams: '', diameterMm: 'wide' }), /valid diameter/);
});
