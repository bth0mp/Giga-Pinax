// What every command of the store (store.js) is written with: the shape of its answers, the clock
// and the IDs of the context it runs in, the record it replaces, and the records it builds from a
// draft. Nothing here writes storage.
import { clone, failure, own } from './core/validate.js';

const ok = (value) => ({ ok: true, value });
// The only failure shape with a fourth field: a lot identity that collided names the lot it collided with.
const fail = (code, message, path, existingLotId) => failure(code, message, path, existingLotId === undefined ? undefined : { existingLotId });

function getNow(context) {
  return typeof context.now === 'function' ? context.now() : context.now;
}

function getId(context) {
  return context.newId();
}

function findRecord(records, id, expectedRevision, label) {
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return fail('validation', `${label} was not found.`, `${label}.id`);
  if (records[index].revision !== expectedRevision) {
    return fail('conflict', `${label} changed in another view. Reload and try again.`, `${label}.revision`);
  }
  return ok({ index, record: records[index] });
}

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

function preferenceFields(value, includeAlerts = false) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['currency', 'housePremiumPresets']) {
    if (own(value, key)) result[key] = value[key];
  }
  if (includeAlerts && own(value, 'desktopAlertsEnabled')) {
    result.desktopAlertsEnabled = value.desktopAlertsEnabled;
  }
  return result;
}

function lotFromDraft(draft, existing, context) {
  const now = getNow(context);
  const optional = ['reference', 'auctionEventId', 'lotNumber'];
  const lot = existing ? clone(existing) : baseRecord({
    title: draft.title,
    sourceLinks: clone(draft.sourceLinks ?? []),
    bidHistory: [],
    outcome: { status: 'open' },
    outcomeHistory: [],
  }, context);
  lot.title = draft.title;
  lot.sourceLinks = clone(draft.sourceLinks ?? []);
  if (own(draft, 'notes')) lot.notes = draft.notes;
  for (const key of ['auctionContext', 'coinDetails', 'provenanceNotes', 'costEstimate']) {
    if (!own(draft, key)) continue;
    if (draft[key] === null) delete lot[key];
    else lot[key] = clone(draft[key]);
  }
  for (const key of optional) {
    if (own(draft, key)) lot[key] = draft[key];
    else delete lot[key];
  }
  if (existing) {
    lot.revision += 1;
    lot.updatedAt = now;
  }
  return lot;
}

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

function compactGroupPriorities(lots, groupId, now) {
  lots.filter((lot) => lot.alternativeGroupId === groupId)
    .sort((left, right) => left.priority - right.priority)
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
