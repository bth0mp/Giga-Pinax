// @ts-check
// What every command of the store (store.js) is written with: the shape of its answers, the clock
// and the IDs of the context it runs in, the record it replaces, and the records it builds from a
// draft. Nothing here writes storage.
import { clone, failure, own } from './core/validate.js';
/**
 * @typedef {import('./core/types.js').Lot} Lot
 * @typedef {import('./core/types.js').AuctionEvent} AuctionEvent
 * @typedef {import('./core/types.js').RecordBase} RecordBase
 * @typedef {import('./core/types.js').Failure} Failure
 * @typedef {import('./core/types.js').CommandContext} CommandContext
 */
/**
 * @template T
 * @typedef {import('./core/types.js').Result<T>} Result
 */

/**
 * @template T
 * @param {T} value
 * @returns {{ ok: true, value: T }}
 */
const ok = (value) => ({ ok: true, value });
// The only failure shape with a fourth field: a lot identity that collided names the lot it collided with.
/**
 * @param {string} code
 * @param {string} message
 * @param {string} [path]
 * @param {string} [existingLotId]
 * @returns {Failure}
 */
const fail = (code, message, path, existingLotId) => failure(code, message, path, existingLotId === undefined ? undefined : { existingLotId });

/**
 * @param {CommandContext} context
 * @returns {string}
 */
function getNow(context) {
  return typeof context.now === 'function' ? context.now() : context.now;
}

/**
 * @param {CommandContext} context
 * @returns {string}
 */
function getId(context) {
  return context.newId();
}

/**
 * The record a command names, if it is still at the revision the command was sent against.
 * @template {{ id: string, revision: number }} R
 * @param {R[]} records
 * @param {*} id
 * @param {*} expectedRevision
 * @param {string} label
 * @returns {Result<{ index: number, record: R }>}
 */
function findRecord(records, id, expectedRevision, label) {
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return fail('validation', `${label} was not found.`, `${label}.id`);
  if (records[index].revision !== expectedRevision) {
    return fail('conflict', `${label} changed in another view. Reload and try again.`, `${label}.revision`);
  }
  return ok({ index, record: records[index] });
}

/**
 * A new record's common fields, with the draft's own on top. The record is still being built, and
 * validateSnapshot holds it to its shape before it is written, so it is typed as any here.
 * @param {Record<string, any>} draft
 * @param {CommandContext} context
 * @returns {any}
 */
function baseRecord(draft, context) {
  const now = getNow(context);
  return {
    id: getId(context),
    revision: 0,
    dataClass: 'collector',
    createdAt: now,
    updatedAt: now,
    ...draft,
  };
}

/**
 * @param {*} value
 * @param {boolean} [includeAlerts]
 * @returns {Record<string, any> | null}
 */
function preferenceFields(value, includeAlerts = false) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['currency', 'housePremiumPresets', 'importVatBps']) {
    if (own(value, key)) result[key] = value[key];
  }
  if (includeAlerts && own(value, 'desktopAlertsEnabled')) {
    result.desktopAlertsEnabled = value.desktopAlertsEnabled;
  }
  return result;
}

// A coin's text is kept as a set-aside correction keeps it: spaces at either end trimmed (review Minor 6). Anything
// else is left for the validator to refuse.
const trimmed = (value) => (typeof value === 'string' ? value.trim() : value);

/**
 * @param {*} draft
 * @param {Lot | null | undefined} existing
 * @param {CommandContext} context
 * @returns {Lot}
 */
function lotFromDraft(draft, existing, context) {
  const now = getNow(context);
  const optional = ['reference', 'auctionEventId', 'lotNumber'];
  const lot = existing ? clone(existing) : baseRecord({
    title: trimmed(draft.title),
    sourceLinks: clone(draft.sourceLinks ?? []),
    bidHistory: [],
    outcome: { status: 'open' },
    outcomeHistory: [],
  }, context);
  lot.title = trimmed(draft.title);
  lot.sourceLinks = clone(draft.sourceLinks ?? []);
  if (own(draft, 'notes')) lot.notes = trimmed(draft.notes);
  for (const key of ['auctionContext', 'coinDetails', 'provenanceNotes', 'costEstimate']) {
    if (!own(draft, key)) continue;
    if (draft[key] === null) delete lot[key];
    else lot[key] = clone(draft[key]);
  }
  for (const key of optional) {
    if (own(draft, key)) lot[key] = key === 'auctionEventId' ? draft[key] : trimmed(draft[key]);
    else delete lot[key];
  }
  if (existing) {
    lot.revision += 1;
    lot.updatedAt = now;
  }
  return lot;
}

/**
 * @param {*} draft
 * @param {AuctionEvent | null | undefined} existing
 * @param {CommandContext} context
 * @returns {AuctionEvent}
 */
function eventFromDraft(draft, existing, context) {
  const now = getNow(context);
  const event = existing ? clone(existing) : baseRecord({}, context);
  for (const key of [
    'name', 'eventKind', 'precision', 'localDate', 'localTime', 'timeZone', 'startsAt',
    'reminderScope', 'capturedText', 'capturedFromUrl', 'sourceUrl',
  ]) {
    if (own(draft, key)) event[key] = clone(draft[key]);
    else delete event[key];
  }
  event.reminders = (draft.reminders ?? []).map((reminder) => {
    const retained = existing?.reminders.find(({ id }) => id === reminder.id);
    const next = clone(reminder);
    next.id = retained?.id ?? getId(context);
    return next;
  });
  if (existing) {
    event.revision += 1;
    event.updatedAt = now;
  }
  return event;
}

/**
 * @param {Lot} lot changed in place
 * @param {import('./core/types.js').BidAction} action
 * @param {{ amount?: import('./core/types.js').Money, buyerPremiumBps?: number } | null | undefined} terms
 * @param {CommandContext} context
 * @returns {void}
 */
function appendBidHistory(lot, action, terms, context) {
  const entry = {
    id: getId(context),
    action,
    recordedAt: getNow(context),
  };
  if (terms?.amount) entry.amount = clone(terms.amount);
  if (terms && own(terms, 'buyerPremiumBps')) entry.buyerPremiumBps = terms.buyerPremiumBps;
  lot.bidHistory.push(entry);
}

/**
 * @param {Lot[]} lots changed in place
 * @param {string} groupId
 * @param {string} now
 * @returns {void}
 */
function compactGroupPriorities(lots, groupId, now) {
  lots.filter((lot) => lot.alternativeGroupId === groupId)
    // Every member of a group has a priority (records.js validates the two together).
    .sort((left, right) => /** @type {number} */ (left.priority) - /** @type {number} */ (right.priority))
    .forEach((lot, index) => {
      if (lot.priority === index + 1) return;
      lot.priority = index + 1;
      lot.revision += 1;
      lot.updatedAt = now;
    });
}

export {
  appendBidHistory, baseRecord, compactGroupPriorities, eventFromDraft, fail, findRecord, getId, getNow, lotFromDraft, ok,
  preferenceFields,
};
