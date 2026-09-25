// @ts-check
// The workspace's editors (workspace.js) and the store's answers: the commands a save sends, what a
// committed command or a newer snapshot does to each open form, and when typed input is in conflict
// with a change made in another view.
/**
 * @typedef {import('./core/types.js').Lot} Lot
 * @typedef {import('./core/types.js').Snapshot} Snapshot
 * @typedef {import('./core/types.js').Command} Command
 */
/** @typedef {{ selectedLotId: string | null, mode: 'list' | 'detail' }} Selection */
/**
 * The record an open editor was filled from: its id and revision, a copy of it, and for the coin
 * details the manual source link it started with.
 * @typedef {{ id: string | null, revision: number | null, record?: *, originalManualUrl?: string }} EditorBasis
 */

/** @type {() => string} */
export const requestId = () => globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** @type {(submittedVersion: number, currentVersion: number) => 'reset' | 'preserve'} */
export const editorCompletion = (submittedVersion, currentVersion) =>
  submittedVersion === currentVersion ? 'reset' : 'preserve';
/** @type {(submitted: *, current: *) => boolean} */
export const sameEditorIdentity = (submitted, current) => {
  const submittedId = submitted?.id ?? null;
  const currentId = current?.id ?? null;
  return submittedId === null || currentId === null ? submitted === current : submittedId === currentId;
};

/**
 * The lot.save that puts back the coin a save replaced, or null when the undo no longer names it.
 * @param {*} undo
 * @param {() => string} [newRequestId]
 * @returns {Command | null}
 */
export function buildLotUndoCommand(undo, newRequestId = requestId) {
  if (!undo?.previous?.id || undo.previous.id !== undo?.saved?.id || !Number.isInteger(undo.saved.revision)) return null;
  const { revision, dataClass, createdAt, updatedAt, ...lot } = structuredClone(undo.previous);
  for (const key of ['auctionContext', 'coinDetails', 'provenanceNotes', 'costEstimate']) if (!Object.hasOwn(lot, key)) lot[key] = null;
  return buildLotSaveCommand({ ...lot, notes: lot.notes ?? '' }, undo.saved.revision, newRequestId);
}

/**
 * @param {Selection} current
 * @param {Selection} submitted
 * @param {*} saved
 * @param {boolean} editorPreserved
 * @param {boolean} [hasPrevious]
 * @param {boolean} [interactionChanged]
 * @returns {{ selection: Selection, offerUndo: boolean }}
 */
export function lotSaveFollowup(current, submitted, saved, editorPreserved, hasPrevious = true, interactionChanged = false) {
  const sameSelection = current.selectedLotId === submitted.selectedLotId && current.mode === submitted.mode;
  const savedMatches = submitted.selectedLotId === null || submitted.selectedLotId === saved?.id;
  const completed = !editorPreserved && !interactionChanged && sameSelection && savedMatches && Boolean(saved?.id);
  return { selection: completed && submitted.selectedLotId === null ? { selectedLotId: saved.id, mode: 'detail' } : current, offerUndo: completed && hasPrevious };
}

/**
 * @param {*} record
 * @param {string | null | undefined} auctionEventId
 * @param {() => string} [newRequestId]
 * @returns {Command | null}
 */
export function buildAttachEventCommand(record, auctionEventId, newRequestId = requestId) {
  if (!record?.id || !Number.isInteger(record.revision) || !auctionEventId) return null;
  const { revision, dataClass, createdAt, updatedAt, ...lot } = structuredClone(record);
  return buildLotSaveCommand({ ...lot, auctionEventId }, revision, newRequestId);
}

/** @type {(submitted: *, current: *, submittedVersion: *, currentVersion: *) => boolean} */
export const sameEventReturnContext = (submitted, current, submittedVersion, currentVersion) =>
  submitted === current && submittedVersion === currentVersion;

/**
 * @param {*} reply
 * @param {string | null | undefined} draftId
 * @returns {string | null}
 */
export function draftToConsumeAfterLotSave(reply, draftId) {
  return reply?.ok && draftId ? draftId : null;
}

export const WORKSPACE_EDITORS = Object.freeze(['lot', 'bid', 'outcome', 'event', 'group', 'evidence']);
// The comparable editor writes a new observation each time, so it has no basis record to compare.
const EDITOR_RECORDS = Object.freeze({ lot: 'lots', bid: 'lots', outcome: 'lots', event: 'auctionEvents', group: 'alternativeGroups' });
const EDITOR_LABELS = Object.freeze({ lot: 'coin details', bid: 'bid', outcome: 'outcome', event: 'auction', group: 'group', evidence: 'comparable' });

/** @type {(snapshot: *, editor: string, id: string | null | undefined) => * | null} */
export const editorRecord = (snapshot, editor, id) => {
  const collection = EDITOR_RECORDS[editor];
  return collection && id ? (snapshot?.[collection] ?? []).find((item) => item.id === id) ?? null : null;
};

// While a save for an editor is in flight the incoming snapshots may already carry this page's own
// write, so that editor is judged when its reply is processed, not by the snapshot that overtook it.
/**
 * @param {*} snapshot
 * @param {Set<string> | null | undefined} dirtyEditors
 * @param {Map<string, EditorBasis> | null | undefined} editorBases
 * @param {Set<string> | null} [pendingEditors]
 * @returns {string[]}
 */
export function editorsWithChangedBasis(snapshot, dirtyEditors, editorBases, pendingEditors = null) {
  return WORKSPACE_EDITORS.filter((editor) => {
    if (!dirtyEditors?.has(editor) || pendingEditors?.has(editor)) return false;
    const basis = editorBases?.get(editor);
    if (!basis?.id || !Number.isInteger(basis.revision) || !EDITOR_RECORDS[editor]) return false;
    const record = editorRecord(snapshot, editor, basis.id);
    return !record || record.revision !== basis.revision;
  });
}

/**
 * @param {string[] | null | undefined} editors
 * @returns {string}
 */
export function conflictNoteMessage(editors) {
  const labels = (editors ?? []).map((editor) => EDITOR_LABELS[editor] ?? editor);
  if (!labels.length) return '';
  const listed = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  return `Committed data changed while the ${listed} form${labels.length === 1 ? ' has' : 's have'} unsaved input.`;
}

const isStoredRecord = (value) => Boolean(value) && typeof value === 'object'
  && typeof value.id === 'string' && Number.isInteger(value.revision);

// Every command names the records it claims to replace, so a commit can tell the editors that were
// looking at exactly those records from the ones another view had already moved on.
/**
 * @param {*} command
 * @returns {Record<string, number>}
 */
export function commandExpectedRevisions(command) {
  /** @type {Record<string, number>} */
  const revisions = {};
  for (const map of [command?.expectedGroupRevisions, command?.expectedLotRevisions]) {
    for (const [id, revision] of Object.entries(map ?? {})) if (Number.isInteger(revision)) revisions[id] = revision;
  }
  const id = command?.lot?.id ?? command?.lotId ?? command?.groupId ?? command?.eventId ?? command?.evidenceId ?? null;
  if (id && Number.isInteger(command.expectedRevision)) revisions[id] = command.expectedRevision;
  return revisions;
}

// Losing a member renumbers a group's coins from 1, and the store writes only the ones whose
// priority actually moves: those ordered after the coin that left.
const renumberedGroupMembers = (lots, groupId, removedLotId) => lots
  .filter((lot) => lot.alternativeGroupId === groupId && lot.id !== removedLotId)
  .sort((left, right) => left.priority - right.priority)
  .filter((lot, index) => lot.priority !== index + 1);

// Some commands write records they never name: `group.delete` clears the group from every member
// coin, `lot.delete` stamps the group the coin leaves and renumbers the members after it, and
// `collection.review.resolve` clears the review from the linked coin while naming only the entry.
// Each of those records is read from the snapshot the command was sent against, so a dirty editor
// on one of them follows the commit instead of raising a false conflict.
/**
 * @param {*} command
 * @param {*} snapshot the snapshot the command was sent against
 * @returns {Record<string, number>}
 */
export function commandReplacedRevisions(command, snapshot) {
  const revisions = commandExpectedRevisions(command);
  const lots = snapshot?.lots ?? [];
  const claim = (record) => {
    if (record && Number.isInteger(record.revision)) revisions[record.id] = record.revision;
  };
  if (command?.type === 'group.delete' && command.groupId) {
    for (const lot of lots) if (lot.alternativeGroupId === command.groupId) claim(lot);
  }
  if (command?.type === 'lot.delete' && command.lotId) {
    const groupId = lots.find((lot) => lot.id === command.lotId)?.alternativeGroupId;
    if (groupId) {
      claim((snapshot?.alternativeGroups ?? []).find((group) => group.id === groupId));
      for (const member of renumberedGroupMembers(lots, groupId, command.lotId)) claim(member);
    }
  }
  if (command?.type === 'collection.review.resolve' && command.collectionEntryId) {
    const entry = (snapshot?.collectionEntries ?? []).find((item) => item.id === command.collectionEntryId);
    if (entry) claim(lots.find((lot) => lot.id === entry.lotId));
  }
  return revisions;
}

// What an attempt submitted. A retry of the same request replays the first attempt's context: the
// collector's typing since then is newer than the save, not part of it.
/**
 * @param {*} previousAttempt
 * @param {string | null} editor
 * @param {Map<string, number> | null | undefined} versions
 * @param {Map<string, EditorBasis> | null | undefined} bases
 * @returns {{ submittedVersion: number | null, submittedBasis: EditorBasis | null }}
 */
export function submissionContext(previousAttempt, editor, versions, bases) {
  if (previousAttempt) return { submittedVersion: previousAttempt.submittedVersion, submittedBasis: previousAttempt.submittedBasis };
  return {
    submittedVersion: editor ? versions?.get(editor) ?? 0 : null,
    submittedBasis: editor ? bases?.get(editor) ?? null : null,
  };
}

// What a committed command does to the open editors. One coin is edited through the details, bid
// and outcome forms at once, and a group reorder rewrites several coins, so a commit moves every
// editor that was based on a record it replaced onto the committed revision — and only those: an
// editor holding an older revision is looking at a change from another view, which is a conflict.
// Nothing here moves an edit version: repopulating a form is not the collector editing it.
/**
 * @param {{
 *   editor?: string | null, submittedBasis?: EditorBasis | null, submittedVersion?: number | null,
 *   submittedRevisions?: Record<string, number> | null, value?: *, snapshot?: *, snapshotFresh?: boolean,
 *   bases?: Map<string, EditorBasis>, versions?: Map<string, number>, dirty?: Set<string>, pending?: Set<string> | null,
 * }} [commit]
 * @returns {{ bases: Map<string, EditorBasis>, versions: Map<string, number>, dirty: Set<string>, repopulate: string[],
 *   reset: string[], merge: string[], preserved: boolean, conflicts: string[] | null }}
 */
export function planCommit({
  editor = null, submittedBasis = null, submittedVersion = null, submittedRevisions = null,
  value = null, snapshot = null, snapshotFresh = true,
  bases = new Map(), versions = new Map(), dirty = new Set(), pending = null,
} = {}) {
  const nextBases = new Map(bases);
  const nextDirty = new Set(dirty);
  const repopulate = [];
  const reset = [];
  const merge = [];
  const replaced = { ...(submittedRevisions ?? {}) };
  if (submittedBasis?.id && Number.isInteger(submittedBasis.revision)) replaced[submittedBasis.id] = /** @type {number} */ (submittedBasis.revision);

  const rebase = (target, record) => {
    const current = nextBases.get(target);
    const originalManualUrl = target === 'lot'
      ? record.sourceLinks?.find((link) => link.source === 'manual')?.url
      : current?.originalManualUrl;
    nextBases.set(target, {
      ...current, id: record.id, revision: record.revision, record: structuredClone(record),
      ...(target === 'lot' ? { originalManualUrl } : {}),
    });
  };
  const blank = (target) => { nextBases.delete(target); nextDirty.delete(target); reset.push(target); };

  for (const other of WORKSPACE_EDITORS) {
    if (other === editor || !EDITOR_RECORDS[other]) continue;
    const basis = nextBases.get(other);
    if (!basis?.id || replaced[basis.id] !== basis.revision) continue;
    const record = isStoredRecord(value) && value.id === basis.id ? value : editorRecord(snapshot, other, basis.id);
    // Only the revision this commit itself produced: a higher one in the refreshed snapshot is a
    // write from another view, and following it would carry the form past a change it never saw.
    if (record && record.revision !== basis.revision + 1) continue;
    if (record) {
      rebase(other, record);
      // A form with unsaved input cannot be repopulated, so it is merged field by field instead.
      if (nextDirty.has(other)) merge.push(other);
    } else if (snapshotFresh) blank(other);
  }

  let preserved = false;
  if (editor && sameEditorIdentity(submittedBasis ?? null, nextBases.get(editor) ?? null)) {
    preserved = editorCompletion(submittedVersion ?? 0, versions.get(editor) ?? 0) === 'preserve';
    if (preserved) {
      // The form keeps what the collector typed while the save was in flight, on top of the
      // committed record rather than on top of the revision it replaced. It is never merged with
      // the record it saved itself: a field typed back to what it was looks untouched, so the merge
      // would undo the collector's own revert and the next save would store the value they removed.
      if (isStoredRecord(value)) rebase(editor, value);
      nextDirty.add(editor);
    } else {
      nextDirty.delete(editor);
      // A record missing from a snapshot this page could not refresh proves nothing; a form is
      // blanked only when the record is really gone, which is a delete or a removal elsewhere.
      const stored = isStoredRecord(value) && EDITOR_RECORDS[editor]
        && (!snapshotFresh || Boolean(editorRecord(snapshot, editor, value.id)));
      if (stored) { rebase(editor, value); repopulate.push(editor); }
      else blank(editor);
    }
  }

  return {
    bases: nextBases, versions: new Map(versions), dirty: nextDirty, repopulate, reset, merge, preserved,
    conflicts: snapshotFresh ? editorsWithChangedBasis(snapshot, nextDirty, nextBases, pending) : null,
  };
}

// The auction editor opened from a coin's "Add auction" carries that coin back to the save. The
// attachment is a second write against the coin, so it only happens on exactly the context that
// was submitted — and when that context is gone the collector is told, never left guessing.
/**
 * @param {{ returnLot?: *, currentReturnLot?: *, submittedVersion?: *, currentVersion?: *, selectedLotId?: string | null,
 *   snapshot?: *, eventId?: string | null }} context
 * @returns {{ action: 'none' } | { action: 'message', message: string } | { action: 'attach', lot: *, eventId: string }}
 */
export function eventAttachDecision({
  returnLot = null, currentReturnLot = null, submittedVersion = null, currentVersion = null,
  selectedLotId = null, snapshot = null, eventId = null,
}) {
  if (!returnLot) return { action: 'none' };
  if (!sameEventReturnContext(returnLot, currentReturnLot, submittedVersion, currentVersion)) {
    return { action: 'message', message: 'Auction saved. The auction form changed while it was saving, so it was not attached to the coin. Attach it from coin details.' };
  }
  const current = (snapshot?.lots ?? []).find((lot) => lot.id === returnLot.id);
  if (selectedLotId !== returnLot.id || current?.revision !== returnLot.revision) {
    return { action: 'message', message: 'Auction saved, but the coin changed before it could be attached. Attach it from coin details.' };
  }
  if (!eventId) return { action: 'message', message: 'Auction saved, but its confirmed identity was unavailable. Attach it from coin details.' };
  return { action: 'attach', lot: returnLot, eventId };
}

export const COIN_REMOVED_NOTICE = 'The coin you were editing was removed in another view. Unsaved input for it was discarded.';

export const SELECTED_LOT_EDITORS = Object.freeze(['lot', 'bid', 'outcome']);

// Losing typed input is said out loud, but only when the coin went behind the collector's back: a
// delete they confirmed in this page clears its own forms without accusing another view.
/**
 * @param {Selection | null | undefined} selection
 * @param {Selection | null | undefined} nextSelection
 * @param {Set<string> | null | undefined} dirtyEditors
 * @param {string | null} [removedHere]
 * @returns {boolean}
 */
export function removedCoinNotice(selection, nextSelection, dirtyEditors, removedHere = null) {
  if (nextSelection === selection || selection?.selectedLotId === removedHere) return false;
  return SELECTED_LOT_EDITORS.some((editor) => dirtyEditors?.has(editor));
}

// Whether the page still owns the removal it started. Only a reply that proves nothing was written
// hands the coin back to the other views: a delete whose outcome is unknown may well have
// committed, and disowning it there would accuse another view of the collector's own delete.
/**
 * @param {string | null} removedHere
 * @param {string} lotId
 * @param {*} reply
 * @returns {string | null}
 */
export function removedHereAfterDeleteReply(removedHere, lotId, reply) {
  if (removedHere !== lotId || reply?.ok || reply?.outcome === 'unknown') return removedHere;
  return null;
}

/**
 * @param {Selection} selection
 * @param {*} snapshot
 * @returns {Selection}
 */
export function selectionAfterSnapshot(selection, snapshot) {
  if (!selection?.selectedLotId) return selection;
  if ((snapshot?.lots ?? []).some((lot) => lot.id === selection.selectedLotId)) return selection;
  return { selectedLotId: null, mode: 'list' };
}

/**
 * @param {Record<string, *>} lot
 * @param {number | null} expectedRevision
 * @param {() => string} [newRequestId]
 * @returns {Command}
 */
export function buildLotSaveCommand(lot, expectedRevision, newRequestId = requestId) {
  return { type: 'lot.save', requestId: newRequestId(), expectedRevision, lot };
}

/**
 * @param {'place' | 'plan'} action
 * @param {{ id: string, revision: number }} basis
 * @param {*} bid
 * @param {*} costEstimate
 * @param {() => string} [newRequestId]
 * @returns {Command}
 */
export function buildBidSaveCommand(action, basis, bid, costEstimate, newRequestId = requestId) {
  const command = { type: action === 'place' ? 'bid.place' : 'bid.plan', requestId: newRequestId(), lotId: basis.id, expectedRevision: basis.revision, [action === 'place' ? 'activeBid' : 'plannedBid']: bid };
  // A fee sheet cleared from the form (null) takes the lot's off; one in another currency is never sent.
  if (costEstimate === null) command.costEstimate = null;
  else if (costEstimate?.currency === bid?.amount?.currency) command.costEstimate = structuredClone(costEstimate);
  return command;
}

/**
 * @param {{ id: string, revision: number }} group
 * @param {string[]} orderedLotIds
 * @param {*} snapshot
 * @param {() => string} [newRequestId]
 * @returns {Command}
 */
export function buildGroupReorderCommand(group, orderedLotIds, snapshot, newRequestId = requestId) {
  const lotById = new Map((snapshot?.lots ?? []).map((lot) => [lot.id, lot]));
  const targetMemberIds = (snapshot?.lots ?? []).filter((lot) => lot.alternativeGroupId === group.id).map((lot) => lot.id);
  let affectedLotIds = [...new Set([...targetMemberIds, ...orderedLotIds])];
  const affectedGroupIds = new Set([group.id]);
  for (const lotId of affectedLotIds) { const sourceGroup = lotById.get(lotId)?.alternativeGroupId; if (sourceGroup) affectedGroupIds.add(sourceGroup); }
  affectedLotIds = [...new Set([...affectedLotIds, ...(snapshot?.lots ?? []).filter((lot) => affectedGroupIds.has(lot.alternativeGroupId)).map((lot) => lot.id)])];
  const groupById = new Map((snapshot?.alternativeGroups ?? []).map((item) => [item.id, item]));
  return {
    type: 'group.reorder', requestId: newRequestId(), groupId: group.id,
    expectedRevision: group.revision, orderedLotIds: [...orderedLotIds],
    expectedGroupRevisions: Object.fromEntries([...affectedGroupIds].map((id) => [id, groupById.get(id)?.revision]).filter(([, revision]) => Number.isInteger(revision))),
    expectedLotRevisions: Object.fromEntries(affectedLotIds.map((id) => [id, lotById.get(id)?.revision]).filter(([, revision]) => Number.isInteger(revision))),
  };
}

/**
 * @param {*} snapshot
 * @param {string} commandRequestId
 * @returns {boolean}
 */
export function commandWasCommitted(snapshot, commandRequestId) {
  return (snapshot?.recentCommands ?? []).some((item) => item.requestId === commandRequestId);
}
