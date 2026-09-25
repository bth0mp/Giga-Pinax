// @ts-check
import { CURRENCIES } from './money.js';
import { validateDraftPayload } from './drafts.js';
import { validateSaleEvidence } from './evidence.js';
import {
  LIMITS, OWN, arrayResult, auctionContextResult, bpsResult, dateResult, housePresetResult, enumResult, firstFailure, instantResult, integerResult,
  isObject, moneyResult, objectResult, optionalString, optionalUrl, stringResult, urlResult, uuidResult,
} from './fields.js';
import { COST_GAPS, deriveWonCost, projectExposure } from './projections.js';
import { resolveZonedDateTime } from './reminders.js';
import { failure, isRecursionError, shiftDate, stableUuid, tooDeeplyNested } from './validate.js';
/**
 * @typedef {import('./types.js').Lot} Lot
 * @typedef {import('./types.js').AuctionEvent} AuctionEvent
 * @typedef {import('./types.js').CollectionEntry} CollectionEntry
 * @typedef {import('./types.js').Evidence} Evidence
 * @typedef {import('./types.js').Draft} Draft
 * @typedef {import('./types.js').Alert} Alert
 * @typedef {import('./types.js').Preferences} Preferences
 * @typedef {import('./types.js').Scheduler} Scheduler
 * @typedef {import('./types.js').Snapshot} Snapshot
 * @typedef {import('./types.js').QuarantineEntry} QuarantineEntry
 * @typedef {import('./types.js').Outcome} Outcome
 * @typedef {import('./types.js').Bid} Bid
 * @typedef {import('./types.js').BidHistoryEntry} BidHistoryEntry
 * @typedef {import('./types.js').SaleEvidence} SaleEvidence
 */
/**
 * @template T
 * @typedef {import('./types.js').Result<T>} Result
 */

// The record bounds live in fields.js, the draft payload's shape in drafts.js and the views' projections in
// projections.js; each is offered here too, for the callers that import it from records.
export { validateDraftPayload } from './drafts.js';
export { LIMITS } from './fields.js';
export { projectCollection, projectExposure } from './projections.js';

export const SCHEMA_VERSION = 2;

const LIVE_DATA_CLASSES = new Set(['collector', 'authorized']);
const OUTCOMES = new Set(['open', 'won', 'lost', 'passed']);
const SOURCES = new Set(['coinarchives', 'acsearch', 'manual', 'authorized-import']);
const BID_ACTIONS = new Set([
  'planned-revised',
  'planned-cleared',
  'placed',
  'active-revised',
  'externally-cancelled',
  'settled-won',
  'settled-lost',
  'reopened-active',
  'reopened-inactive',
]);
const ALERT_STATES = new Set([
  'pending', 'due', 'claimed', 'delivered', 'acknowledged', 'snoozed', 'missed',
]);
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** @returns {Result<any>} */
function commonRecord(record, path, { dataClass = true } = {}) {
  const object = objectResult(record, path);
  if (!object.ok) return object;
  const checks = [
    uuidResult(record.id, `${path}.id`),
    integerResult(record.revision, `${path}.revision`, { maximum: LIMITS.revision }),
    instantResult(record.createdAt, `${path}.createdAt`),
    instantResult(record.updatedAt, `${path}.updatedAt`),
  ];
  if (dataClass && !LIVE_DATA_CLASSES.has(record.dataClass)) {
    checks.push(failure(
      'invalid-data-class',
      'Durable live records must be collector or authorized data.',
      `${path}.dataClass`,
    ));
  }
  return firstFailure(...checks);
}

/** @returns {Result<any>} */
function sourceLinkResult(link, path) {
  const object = objectResult(link, path);
  if (!object.ok) return object;
  return firstFailure(
    enumResult(link.source, SOURCES, `${path}.source`),
    urlResult(link.url, `${path}.url`),
    optionalString(link, 'sourceRecordId', path, LIMITS.shortText),
  );
}

/** @returns {Result<any>} */
function sourceLinksResult(links, path) {
  const array = arrayResult(links, path, LIMITS.sourceLinks);
  if (!array.ok) return array;
  for (let index = 0; index < links.length; index += 1) {
    const result = sourceLinkResult(links[index], `${path}[${index}]`);
    if (!result.ok) return result;
  }
  return { ok: true, value: links };
}

/** @returns {Result<any>} */
function coinDetailsResult(value, path) {
  const object = objectResult(value, path); if (!object.ok) return object;
  if (OWN(value, 'photoUrls')) {
    const photos = arrayResult(value.photoUrls, `${path}.photoUrls`, 2); if (!photos.ok) return photos;
    for (let index = 0; index < value.photoUrls.length; index += 1) {
      const result = urlResult(value.photoUrls[index], `${path}.photoUrls[${index}]`); if (!result.ok) return result;
    }
  }
  return firstFailure(
    OWN(value, 'weightMg') ? integerResult(value.weightMg, `${path}.weightMg`, { minimum: 1, maximum: 1000000 }) : { ok: true },
    OWN(value, 'diameterHundredthsMm') ? integerResult(value.diameterHundredthsMm, `${path}.diameterHundredthsMm`, { minimum: 1, maximum: 100000 }) : { ok: true },
    optionalString(value, 'condition', path, 1000),
  );
}

/** @returns {Result<any>} */
function provenanceNotesResult(value, path) {
  const array = arrayResult(value, path, 20); if (!array.ok) return array;
  const ids = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const note = value[index], notePath = `${path}[${index}]`;
    const object = objectResult(note, notePath); if (!object.ok) return object;
    const result = firstFailure(uuidResult(note.id, `${notePath}.id`), stringResult(note.text, `${notePath}.text`, 1000),
      urlResult(note.sourceUrl, `${notePath}.sourceUrl`), instantResult(note.recordedAt, `${notePath}.recordedAt`),
      OWN(note, 'auctionDate') ? dateResult(note.auctionDate, `${notePath}.auctionDate`) : { ok: true });
    if (!result.ok) return result;
    if (ids.has(note.id)) return failure('duplicate-id', 'Provenance note IDs must be unique.', `${notePath}.id`);
    ids.add(note.id);
  }
  return { ok: true, value };
}

/** @returns {Result<any>} */
function costEstimateResult(value, path) {
  const object = objectResult(value, path); if (!object.ok) return object;
  if (!CURRENCIES.includes(value.currency)) return failure('unsupported-currency', 'Currency must be USD, EUR, GBP, or CHF.', `${path}.currency`);
  return firstFailure(
    integerResult(value.shippingMinor, `${path}.shippingMinor`),
    integerResult(value.paymentFeeBps, `${path}.paymentFeeBps`, { maximum: 10000 }),
    integerResult(value.paymentFeeMinor, `${path}.paymentFeeMinor`),
    integerResult(value.incrementMinor, `${path}.incrementMinor`, { minimum: 1 }),
    integerResult(value.minimumBidMinor, `${path}.minimumBidMinor`),
    bpsResult(value, 'premiumVatBps', path), bpsResult(value, 'platformFeeBps', path), bpsResult(value, 'importVatBps', path),
  );
}

/** @returns {Result<any>} */
function bidResult(bid, path, active) {
  const object = objectResult(bid, path);
  if (!object.ok) return object;
  /** @type {Array<Result<any>>} */
  const checks = [moneyResult(bid.amount, `${path}.amount`), bpsResult(bid, 'buyerPremiumBps', path)];
  if (active) checks.push(instantResult(bid.placedAt, `${path}.placedAt`));
  return firstFailure(...checks);
}

/** @returns {Result<any>} */
function bidHistoryResult(history, path) {
  const array = arrayResult(history, path, LIMITS.bidHistory);
  if (!array.ok) return array;
  const ids = new Set();
  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    const itemPath = `${path}[${index}]`;
    const object = objectResult(item, itemPath);
    if (!object.ok) return object;
    const checks = [
      uuidResult(item.id, `${itemPath}.id`),
      enumResult(item.action, BID_ACTIONS, `${itemPath}.action`),
      instantResult(item.recordedAt, `${itemPath}.recordedAt`),
    ];
    if (OWN(item, 'amount')) checks.push(moneyResult(item.amount, `${itemPath}.amount`));
    checks.push(bpsResult(item, 'buyerPremiumBps', itemPath));
    const result = firstFailure(...checks);
    if (!result.ok) return result;
    if (ids.has(item.id)) return failure('duplicate-id', 'Bid history IDs must be unique.', `${itemPath}.id`);
    ids.add(item.id);
    if (item.action !== 'reopened-inactive' && !OWN(item, 'amount')) {
      return failure('invalid-bid-history', 'This bid action requires its declared amount.', `${itemPath}.amount`);
    }
  }
  return { ok: true, value: history };
}

/** @returns {Result<any>} */
function outcomeResult(outcome, path) {
  const object = objectResult(outcome, path);
  if (!object.ok) return object;
  const status = enumResult(outcome.status, OUTCOMES, `${path}.status`);
  if (!status.ok) return status;
  const checks = [];
  if (OWN(outcome, 'hammer')) checks.push(moneyResult(outcome.hammer, `${path}.hammer`));
  if (OWN(outcome, 'actualInvoice')) checks.push(moneyResult(outcome.actualInvoice, `${path}.actualInvoice`));
  if (OWN(outcome, 'correctedAt')) checks.push(instantResult(outcome.correctedAt, `${path}.correctedAt`));
  if (OWN(outcome, 'verification')) {
    checks.push(enumResult(
      outcome.verification,
      new Set(['personal-unverified']),
      `${path}.verification`,
    ));
  }
  const result = firstFailure(...checks);
  if (!result.ok) return result;
  if ((outcome.status === 'open' || outcome.status === 'passed') &&
      (OWN(outcome, 'hammer') || OWN(outcome, 'actualInvoice') || OWN(outcome, 'verification'))) {
    return failure('invalid-outcome-price', 'Open and passed outcomes cannot carry final prices.', path);
  }
  if ((OWN(outcome, 'hammer') || OWN(outcome, 'actualInvoice')) &&
      outcome.verification !== 'personal-unverified') {
    return failure('missing-verification', 'User-entered outcome prices require a verification label.', `${path}.verification`);
  }
  if (OWN(outcome, 'terms')) {
    if (outcome.status !== 'won') return failure('invalid-outcome-terms', 'Only a won outcome carries premium and fee terms.', `${path}.terms`);
    const terms = outcomeTermsResult(outcome.terms, `${path}.terms`, outcome.hammer?.currency);
    if (!terms.ok) return terms;
  }
  if (OWN(outcome, 'cost')) return wonCostResult(outcome, `${path}.cost`);
  return { ok: true, value: outcome };
}

// The premium rate and fee sheet a won coin's outcome states (Q-01): an object with either or both, the fee sheet in
// the hammer's currency, since a cost is never converted.
/** @returns {Result<any>} */
function outcomeTermsResult(terms, path, hammerCurrency) {
  const object = objectResult(terms, path); if (!object.ok) return object;
  if (!OWN(terms, 'buyerPremiumBps') && !OWN(terms, 'costEstimate')) {
    return failure('invalid-outcome-terms', 'Outcome terms name a premium rate, a fee sheet or both.', path);
  }
  const checks = firstFailure(
    bpsResult(terms, 'buyerPremiumBps', path),
    // `null` is "no fees were charged beyond the premium" (the Outcome tab's checkbox).
    OWN(terms, 'costEstimate') && terms.costEstimate !== null ? costEstimateResult(terms.costEstimate, `${path}.costEstimate`) : { ok: true },
  );
  if (!checks.ok) return checks;
  if (OWN(terms, 'costEstimate') && terms.costEstimate !== null && hammerCurrency && terms.costEstimate.currency !== hammerCurrency) {
    return failure('invalid-outcome-terms', 'Fees are recorded in the hammer’s currency; nothing is converted.', `${path}.costEstimate.currency`);
  }
  return { ok: true, value: terms };
}

const COST_GAP_SET = new Set(COST_GAPS);
const COST_MONEY = ['premium', 'premiumVat', 'platformFee', 'shipping', 'paymentFee'];

// A won coin's cost as the store worked it out (projections.js deriveWonCost): in its hammer's currency, and either
// complete - every part and a total that is exactly the hammer and those parts - or incomplete, naming what was
// never recorded and carrying no total. A hand-made file cannot slip a total past its own parts.
/** @returns {Result<any>} */
function wonCostResult(outcome, path) {
  const cost = outcome.cost;
  const object = objectResult(cost, path); if (!object.ok) return object;
  if (outcome.status !== 'won') return failure('invalid-cost', 'Only a won outcome carries a cost.', path);
  /** @type {Array<Result<any>>} */
  const checks = [bpsResult(cost, 'buyerPremiumBps', path)];
  for (const key of [...COST_MONEY, 'total']) if (OWN(cost, key)) checks.push(moneyResult(cost[key], `${path}.${key}`));
  if (OWN(cost, 'missing')) {
    const gaps = arrayResult(cost.missing, `${path}.missing`, COST_GAPS.length); if (!gaps.ok) return gaps;
    cost.missing.forEach((gap, index) => checks.push(enumResult(gap, COST_GAP_SET, `${path}.missing[${index}]`)));
  }
  if (OWN(cost, 'importVat')) checks.push(moneyResult(cost.importVat, `${path}.importVat`));
  const shapes = firstFailure(...checks); if (!shapes.ok) return shapes;
  for (const key of [...COST_MONEY, 'total', 'importVat']) {
    if (OWN(cost, key) && cost[key].currency !== outcome.hammer?.currency) {
      return failure('invalid-cost', 'A cost is kept in its hammer’s currency.', `${path}.${key}`);
    }
  }
  const gapCount = OWN(cost, 'missing') ? new Set(cost.missing).size : 0;
  if (gapCount !== (cost.missing?.length ?? 0)) return failure('invalid-cost', 'A missing figure is named once.', `${path}.missing`);
  if (OWN(cost, 'total') === gapCount > 0) {
    return failure('invalid-cost', 'A cost has a total or names what is missing, never both or neither.', path);
  }
  // Import VAT (Q-04) is kept beside a complete cost's total, not in it: the total stays the hammer and the five parts
  // 0.36.0 checks, so a backup from this version still imports there.
  if (OWN(cost, 'importVat') && !OWN(cost, 'total')) return failure('invalid-cost', 'Import VAT belongs to a complete cost.', `${path}.importVat`);
  if (!OWN(cost, 'total')) return { ok: true, value: outcome };
  if (!OWN(cost, 'buyerPremiumBps') || !COST_MONEY.every((key) => OWN(cost, key))) {
    return failure('invalid-cost', 'A complete cost carries every part.', path);
  }
  const parts = COST_MONEY.reduce((sum, key) => sum + BigInt(cost[key].minor), BigInt(outcome.hammer.minor));
  return parts === BigInt(cost.total.minor)
    ? { ok: true, value: outcome }
    : failure('invalid-cost', 'A cost’s total must be its hammer and its parts.', `${path}.total`);
}

/** @returns {Result<any>} */
function outcomeHistoryResult(history, path) {
  const array = arrayResult(history, path, LIMITS.outcomeHistory);
  if (!array.ok) return array;
  const ids = new Set();
  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    const itemPath = `${path}[${index}]`;
    const object = objectResult(item, itemPath);
    if (!object.ok) return object;
    const result = firstFailure(
      uuidResult(item.id, `${itemPath}.id`),
      enumResult(item.from, OUTCOMES, `${itemPath}.from`),
      enumResult(item.to, OUTCOMES, `${itemPath}.to`),
      instantResult(item.recordedAt, `${itemPath}.recordedAt`),
      OWN(item, 'bindingActive') && typeof item.bindingActive !== 'boolean'
        ? failure('invalid-boolean', 'Expected a boolean.', `${itemPath}.bindingActive`)
        : { ok: true, value: item.bindingActive },
    );
    if (!result.ok) return result;
    if (ids.has(item.id)) return failure('duplicate-id', 'Outcome history IDs must be unique.', `${itemPath}.id`);
    ids.add(item.id);
  }
  return { ok: true, value: history };
}

/** @returns {Result<Lot>} */
function lotResult(lot, path) {
  const common = commonRecord(lot, path);
  if (!common.ok) return common;
  const checks = [
    stringResult(lot.title, `${path}.title`, LIMITS.title),
    optionalString(lot, 'reference', path, LIMITS.shortText),
    optionalString(lot, 'lotNumber', path, LIMITS.shortText),
    optionalString(lot, 'notes', path, LIMITS.notes, { nonEmpty: false }),
    sourceLinksResult(lot.sourceLinks, `${path}.sourceLinks`),
    bidHistoryResult(lot.bidHistory, `${path}.bidHistory`),
    outcomeResult(lot.outcome, `${path}.outcome`),
    outcomeHistoryResult(lot.outcomeHistory, `${path}.outcomeHistory`),
  ];
  if (OWN(lot, 'auctionEventId')) checks.push(uuidResult(lot.auctionEventId, `${path}.auctionEventId`));
  if (OWN(lot, 'alternativeGroupId')) checks.push(uuidResult(lot.alternativeGroupId, `${path}.alternativeGroupId`));
  if (OWN(lot, 'collectionEntryId')) checks.push(uuidResult(lot.collectionEntryId, `${path}.collectionEntryId`));
  if (OWN(lot, 'priority')) checks.push(integerResult(lot.priority, `${path}.priority`, { minimum: 1 }));
  if (OWN(lot, 'plannedBid')) checks.push(bidResult(lot.plannedBid, `${path}.plannedBid`, false));
  if (OWN(lot, 'activeBid')) checks.push(bidResult(lot.activeBid, `${path}.activeBid`, true));
  if (OWN(lot, 'auctionContext')) checks.push(auctionContextResult(lot.auctionContext, `${path}.auctionContext`));
  if (OWN(lot, 'coinDetails')) checks.push(coinDetailsResult(lot.coinDetails, `${path}.coinDetails`));
  if (OWN(lot, 'provenanceNotes')) checks.push(provenanceNotesResult(lot.provenanceNotes, `${path}.provenanceNotes`));
  if (OWN(lot, 'costEstimate')) checks.push(costEstimateResult(lot.costEstimate, `${path}.costEstimate`));
  if (OWN(lot, 'collectionReviewReason')) {
    checks.push(enumResult(
      lot.collectionReviewReason,
      new Set(['source-lot-no-longer-won']),
      `${path}.collectionReviewReason`,
    ));
  }
  const result = firstFailure(...checks);
  if (!result.ok) return result;
  if (OWN(lot, 'priority') !== OWN(lot, 'alternativeGroupId')) {
    return failure('invalid-priority', 'Alternative group and priority must be present together.', path);
  }
  if (lot.outcome.status !== 'open' && OWN(lot, 'activeBid')) {
    return failure('active-bid', 'A terminal lot cannot retain an active bid.', `${path}.activeBid`);
  }
  let declaredBindingState = null;
  for (const entry of lot.bidHistory) {
    if (['placed', 'active-revised', 'reopened-active'].includes(entry.action)) {
      declaredBindingState = 'active';
    } else if (['externally-cancelled', 'settled-won', 'settled-lost', 'reopened-inactive'].includes(entry.action)) {
      declaredBindingState = 'inactive';
    }
  }
  if (declaredBindingState === 'active' && !OWN(lot, 'activeBid')) {
    return failure(
      'invalid-bid-state',
      'An active external declaration requires active bid terms.',
      `${path}.activeBid`,
    );
  }
  if (declaredBindingState === 'inactive' && OWN(lot, 'activeBid')) {
    return failure(
      'invalid-bid-state',
      'Inactive bid history cannot retain active bid terms.',
      `${path}.activeBid`,
    );
  }
  return { ok: true, value: lot };
}

/** @returns {Result<any>} */
function timeZoneResult(value, path) {
  const text = stringResult(value, path, LIMITS.shortText);
  if (!text.ok) return text;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return { ok: true, value };
  } catch {
    return failure('invalid-time-zone', 'Expected an IANA time zone.', path);
  }
}

/** @returns {Result<any>} */
function reminderResult(reminder, path) {
  const object = objectResult(reminder, path);
  if (!object.ok) return object;
  const id = uuidResult(reminder.id, `${path}.id`);
  if (!id.ok) return id;
  if (reminder.kind === 'offset') {
    return integerResult(reminder.offsetMinutes, `${path}.offsetMinutes`, { maximum: 525600 });
  }
  if (reminder.kind === 'wall-time') {
    return firstFailure(
      integerResult(reminder.daysBefore, `${path}.daysBefore`, { maximum: 365 }),
      TIME.test(reminder.localTime)
        ? { ok: true, value: reminder.localTime }
        : failure('invalid-time', 'Expected HH:mm.', `${path}.localTime`),
    );
  }
  return failure('invalid-enum', 'Unknown reminder kind.', `${path}.kind`);
}

/** @returns {Result<AuctionEvent>} */
function eventResult(event, path) {
  const common = commonRecord(event, path);
  if (!common.ok) return common;
  const checks = [
    stringResult(event.name, `${path}.name`, LIMITS.title),
    enumResult(event.eventKind, new Set(['auction-starts', 'lot-closes', 'auction-day']), `${path}.eventKind`),
    enumResult(event.precision, new Set(['timed', 'date-only']), `${path}.precision`),
    dateResult(event.localDate, `${path}.localDate`),
    timeZoneResult(event.timeZone, `${path}.timeZone`),
    enumResult(event.reminderScope, new Set(['standalone', 'linked-lots']), `${path}.reminderScope`),
    arrayResult(event.reminders, `${path}.reminders`, LIMITS.reminders),
    optionalString(event, 'capturedText', path, 500),
    optionalUrl(event, 'capturedFromUrl', path),
    optionalUrl(event, 'sourceUrl', path),
  ];
  const initial = firstFailure(...checks);
  if (!initial.ok) return initial;
  const reminderIds = new Set();
  for (let index = 0; index < event.reminders.length; index += 1) {
    const result = reminderResult(event.reminders[index], `${path}.reminders[${index}]`);
    if (!result.ok) return result;
    const expectedKind = event.precision === 'timed' ? 'offset' : 'wall-time';
    if (event.reminders[index].kind !== expectedKind) {
      return failure('invalid-reminder-kind', 'Reminder kind must match the event precision.', `${path}.reminders[${index}].kind`);
    }
    if (reminderIds.has(event.reminders[index].id)) {
      return failure('duplicate-id', 'Reminder IDs must be unique in an event.', `${path}.reminders[${index}].id`);
    }
    reminderIds.add(event.reminders[index].id);
  }
  if (event.precision === 'timed') {
    if (!TIME.test(event.localTime)) return failure('invalid-time', 'Timed events require HH:mm.', `${path}.localTime`);
    const startsAt = instantResult(event.startsAt, `${path}.startsAt`);
    if (!startsAt.ok) return startsAt;
  } else if (OWN(event, 'localTime') || OWN(event, 'startsAt')) {
    return failure('invalid-event-precision', 'Date-only events cannot carry a time or instant.', path);
  }
  return { ok: true, value: event };
}

// Resolving a local date and time depends on the browser's time-zone data, which changes with
// the browser. These checks therefore belong to the event being written, never to stored data:
// a zone whose rules were revised must not lock the collector out of records saved under the
// older rules. Stored and imported instants stay authoritative.
/**
 * Whether an event's local date and times still name exactly one instant each in its zone, by the
 * browser's zone rules: checked on the event being written, never on stored data.
 * @param {*} event
 * @param {string} [path]
 * @returns {Result<AuctionEvent>}
 */
export function validateEventLocalTimes(event, path = 'event') {
  const object = objectResult(event, path);
  if (!object.ok) return object;
  const reminders = Array.isArray(event.reminders) ? event.reminders : [];
  for (let index = 0; index < reminders.length; index += 1) {
    const reminder = reminders[index];
    if (reminder?.kind !== 'wall-time' || !TIME.test(reminder.localTime) ||
        !Number.isSafeInteger(reminder.daysBefore)) continue;
    const shifted = dateResult(event.localDate, `${path}.localDate`).ok
      ? shiftDate(event.localDate, -reminder.daysBefore) : null;
    const resolved = shifted === null ? null : resolveZonedDateTime({
      localDate: shifted,
      localTime: reminder.localTime,
      timeZone: event.timeZone,
      disambiguation: 'reject',
    });
    if (resolved && !resolved.ok) {
      return failure(
        'invalid-reminder-time',
        'Reminder wall time must exist exactly once in the confirmed time zone.',
        `${path}.reminders[${index}].localTime`,
      );
    }
  }
  if (event.precision !== 'timed' || !TIME.test(event.localTime)) return { ok: true, value: event };
  const resolved = resolveZonedDateTime({
    localDate: event.localDate,
    localTime: event.localTime,
    timeZone: event.timeZone,
    disambiguation: 'reject',
  });
  if (!resolved.ok || resolved.value.startsAt !== event.startsAt) {
    return failure('inconsistent-instant', 'Stored start must match the confirmed local date, time, and zone.', `${path}.startsAt`);
  }
  return { ok: true, value: event };
}

/** @returns {Result<any>} */
function groupResult(group, path) {
  const common = commonRecord(group, path);
  if (!common.ok) return common;
  return stringResult(group.name, `${path}.name`, LIMITS.title);
}

/** @returns {Result<CollectionEntry>} */
function collectionEntryResult(entry, path) {
  const common = commonRecord(entry, path);
  if (!common.ok) return common;
  const checks = [
    uuidResult(entry.lotId, `${path}.lotId`),
    stringResult(entry.title, `${path}.title`, LIMITS.title),
    dateResult(entry.acquisitionDate, `${path}.acquisitionDate`),
    sourceLinksResult(entry.sourceLinks, `${path}.sourceLinks`),
    optionalString(entry, 'notes', path, LIMITS.notes, { nonEmpty: false }),
  ];
  if (OWN(entry, 'hammer')) checks.push(moneyResult(entry.hammer, `${path}.hammer`));
  if (OWN(entry, 'actualInvoice')) checks.push(moneyResult(entry.actualInvoice, `${path}.actualInvoice`));
  if (OWN(entry, 'reviewReason')) {
    checks.push(enumResult(
      entry.reviewReason,
      new Set(['source-lot-no-longer-won']),
      `${path}.reviewReason`,
    ));
  }
  if (OWN(entry, 'editedFields')) checks.push(editedFieldsResult(entry.editedFields, `${path}.editedFields`));
  return firstFailure(...checks);
}

// The fields the collector corrected on the entry itself, which an outcome correction then leaves alone: a closed
// list, each named once.
/** @type {ReadonlyArray<'acquisitionDate' | 'actualInvoice' | 'notes'>} */
export const ENTRY_EDITABLE_FIELDS = Object.freeze(['acquisitionDate', 'actualInvoice', 'notes']);
const ENTRY_EDITABLE_SET = new Set(ENTRY_EDITABLE_FIELDS);
// Two amounts that are the same whatever order their keys were written in; absent is absent.
const sameMoney = (left, right) => (left && right
  ? left.currency === right.currency && left.minor === right.minor : !left && !right);

/**
 * A collection entry brought in step with its lot's won outcome: the hammer is the outcome's always, and the invoice
 * too unless the collector corrected it on the entry, where theirs wins. An entry whose lot is not won is left as it
 * is (a review decides it). The one rule the store, a merged backup and a load all follow.
 * @param {Record<string, any>} entry changed in place
 * @param {Lot | null | undefined} lot
 * @returns {boolean} whether anything changed
 */
export function followOutcome(entry, lot) {
  if (lot?.outcome?.status !== 'won') return false;
  let changed = false;
  for (const field of /** @type {const} */ (['hammer', 'actualInvoice'])) {
    if (field === 'actualInvoice' && entry.editedFields?.includes(field)) continue;
    const recorded = lot.outcome[field];
    if (sameMoney(entry[field], recorded)) continue;
    if (recorded) entry[field] = { currency: recorded.currency, minor: recorded.minor };
    else delete entry[field];
    changed = true;
  }
  return changed;
}

/**
 * Every entry of a root brought in step with its won lot, in place, with no revision or write time changed: an entry
 * left behind by an outcome corrected before 0.36 reads as its lot does from the first load, and the next write keeps
 * it so. A read of an already consistent root changes nothing.
 * @param {{ lots: Lot[], collectionEntries: CollectionEntry[] }} root
 * @returns {number} how many entries followed
 */
export function healCollectionEntries(root) {
  const lots = new Map(root.lots.map((lot) => [lot.id, lot]));
  let healed = 0;
  for (const entry of root.collectionEntries) if (followOutcome(entry, lots.get(entry.lotId))) healed += 1;
  return healed;
}

/** @returns {Result<any>} */
function editedFieldsResult(fields, path) {
  const array = arrayResult(fields, path, ENTRY_EDITABLE_FIELDS.length); if (!array.ok) return array;
  for (let index = 0; index < fields.length; index += 1) {
    const field = enumResult(fields[index], ENTRY_EDITABLE_SET, `${path}[${index}]`); if (!field.ok) return field;
    if (fields.indexOf(fields[index]) !== index) return failure('duplicate-field', 'A corrected field is named once.', `${path}[${index}]`);
  }
  return { ok: true, value: fields };
}

/** @returns {Result<SaleEvidence>} */
function evidenceResult(evidence, path) {
  const common = commonRecord(evidence, path);
  if (!common.ok) return common;
  const observations = arrayResult(
    evidence.observations,
    `${path}.observations`,
    LIMITS.evidenceObservations,
  );
  if (!observations.ok) return observations;
  const validated = validateSaleEvidence(evidence);
  if (validated.ok) return validated;
  const nestedPath = validated.error.path ? `${path}.${validated.error.path}` : path;
  return { ok: false, error: { ...validated.error, path: nestedPath } };
}

/** @returns {Result<Preferences | null>} */
function preferencesResult(preferences, path) {
  if (preferences === null) return { ok: true, value: preferences };
  const object = objectResult(preferences, path);
  if (!object.ok) return object;
  const common = firstFailure(
    integerResult(preferences.revision, `${path}.revision`, { maximum: LIMITS.revision }),
    instantResult(preferences.createdAt, `${path}.createdAt`),
    instantResult(preferences.updatedAt, `${path}.updatedAt`),
    preferences.schemaVersion === SCHEMA_VERSION
      ? { ok: true, value: preferences.schemaVersion }
      : failure('unsupported-schema', 'Preferences schema version is unsupported.', `${path}.schemaVersion`),
    enumResult(preferences.currency, new Set(CURRENCIES), `${path}.currency`),
    typeof preferences.desktopAlertsEnabled === 'boolean'
      ? { ok: true, value: preferences.desktopAlertsEnabled }
      : failure('invalid-boolean', 'Expected a boolean.', `${path}.desktopAlertsEnabled`),
    bpsResult(preferences, 'importVatBps', path),
  );
  if (!common.ok) return common;
  if (!OWN(preferences, 'housePremiumPresets')) return { ok: true, value: preferences };
  const presets = arrayResult(preferences.housePremiumPresets, `${path}.housePremiumPresets`, 50);
  if (!presets.ok) return presets;
  const names = new Set();
  for (let index = 0; index < preferences.housePremiumPresets.length; index += 1) {
    const preset = preferences.housePremiumPresets[index];
    const presetPath = `${path}.housePremiumPresets[${index}]`;
    const valid = housePresetResult(preset, presetPath);
    if (!valid.ok) return valid;
    const normalized = preset.name.trim().toLocaleLowerCase();
    if (names.has(normalized)) return failure('duplicate-name', 'House premium names must be unique.', `${presetPath}.name`);
    names.add(normalized);
  }
  return { ok: true, value: preferences };
}

/** @returns {Result<Draft>} */
function draftResult(draft, path) {
  const common = commonRecord(draft, path);
  if (!common.ok) return common;
  const checks = [
    validateDraftPayload(draft.kind, draft.payload, path),
    instantResult(draft.createdAt, `${path}.createdAt`),
    instantResult(draft.expiresAt, `${path}.expiresAt`),
  ];
  const result = firstFailure(...checks);
  if (!result.ok) return result;
  let encoded;
  try { encoded = JSON.stringify(draft.payload); } catch { encoded = null; }
  if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).length > LIMITS.draftPayloadBytes) {
    return failure('draft-too-large', 'Draft payload exceeds its storage bound.', `${path}.payload`);
  }
  return { ok: true, value: draft };
}

/** @returns {Result<Alert>} */
function alertResult(alert, path) {
  const common = commonRecord(alert, path);
  if (!common.ok) return common;
  const checks = [
    stringResult(alert.triggerId, `${path}.triggerId`, 500),
    uuidResult(alert.eventId, `${path}.eventId`),
    integerResult(alert.eventRevision, `${path}.eventRevision`, { maximum: LIMITS.revision }),
    uuidResult(alert.reminderId, `${path}.reminderId`),
    instantResult(alert.triggerAt, `${path}.triggerAt`),
    enumResult(alert.status, ALERT_STATES, `${path}.status`),
  ];
  for (const field of ['attemptedAt', 'claimedAt', 'deliveredAt', 'acknowledgedAt', 'snoozedUntil', 'missedAt']) {
    if (OWN(alert, field)) checks.push(instantResult(alert[field], `${path}.${field}`));
  }
  const initial = firstFailure(...checks);
  if (!initial.ok) return initial;
  const requiredByStatus = {
    claimed: ['attemptedAt', 'claimedAt'],
    delivered: ['attemptedAt', 'claimedAt', 'deliveredAt'],
    acknowledged: ['acknowledgedAt'],
    snoozed: ['snoozedUntil'],
    missed: ['missedAt'],
  };
  for (const field of requiredByStatus[alert.status] ?? []) {
    if (!OWN(alert, field)) return failure('missing-state-time', `Alert status ${alert.status} requires ${field}.`, `${path}.${field}`);
  }
  return { ok: true, value: alert };
}

/** @returns {Result<Scheduler>} */
function schedulerResult(scheduler, path) {
  const object = objectResult(scheduler, path);
  if (!object.ok) return object;
  return firstFailure(
    integerResult(scheduler.revision, `${path}.revision`, { maximum: LIMITS.revision }),
    instantResult(scheduler.nextWakeAt, `${path}.nextWakeAt`, { nullable: true }),
    instantResult(scheduler.lastReconciledAt, `${path}.lastReconciledAt`, { nullable: true }),
  );
}

/** @returns {Result<any>} */
function recentCommandResult(command, path) {
  const object = objectResult(command, path);
  if (!object.ok) return object;
  const checks = [
    uuidResult(command.requestId, `${path}.requestId`),
    stringResult(command.commandType, `${path}.commandType`, LIMITS.shortText),
    integerResult(command.revision, `${path}.revision`),
    instantResult(command.committedAt, `${path}.committedAt`),
    objectResult(command.reply, `${path}.reply`),
  ];
  const result = firstFailure(...checks);
  if (!result.ok) return result;
  if (command.reply.ok !== true || command.reply.requestId !== command.requestId ||
      command.reply.revision !== command.revision) {
    return failure('invalid-reply', 'The ledger reply must match its committed request and revision.', `${path}.reply`);
  }
  let encoded;
  try { encoded = JSON.stringify(command.reply); } catch { encoded = null; }
  if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).length > LIMITS.commandReplyBytes) {
    return failure('reply-too-large', 'Ledger reply exceeds its storage bound.', `${path}.reply`);
  }
  return { ok: true, value: command };
}

const COLLECTIONS = [
  { key: 'lots', maximum: LIMITS.lots, validator: lotResult },
  { key: 'auctionEvents', maximum: LIMITS.auctionEvents, validator: eventResult },
  { key: 'alternativeGroups', maximum: LIMITS.alternativeGroups, validator: groupResult },
  { key: 'evidence', maximum: LIMITS.evidenceObservations, validator: evidenceResult },
  { key: 'collectionEntries', maximum: LIMITS.collectionEntries, validator: collectionEntryResult },
  { key: 'drafts', maximum: LIMITS.drafts, validator: draftResult },
  { key: 'alerts', maximum: LIMITS.alerts, validator: alertResult },
  // The ledger is appended to and trimmed from the front, and a retry is only answered from an
  // entry that is still there, so an overflowing one loses its oldest rows rather than its newest.
  { key: 'recentCommands', maximum: LIMITS.recentCommands, validator: recentCommandResult, keepNewest: true },
];

// A reference the repair had to clear is a link the collector made, so the entry that caused it
// keeps the value verbatim: which record lost which field, and what it pointed at.
/** @returns {Result<any>} */
function clearedReferenceResult(reference, path) {
  const object = objectResult(reference, path);
  if (!object.ok) return object;
  return firstFailure(
    stringResult(reference.collection, `${path}.collection`, LIMITS.shortText),
    stringResult(reference.id, `${path}.id`, LIMITS.shortText),
    stringResult(reference.field, `${path}.field`, LIMITS.shortText),
    OWN(reference, 'value') ? { ok: true, value: reference.value } : failure('missing-value', 'A cleared reference keeps the value it lost.', `${path}.value`),
  );
}

/** @returns {Result<any>} */
function clearedReferencesResult(references, path) {
  const array = arrayResult(references, path, LIMITS.clearedReferences);
  if (!array.ok) return array;
  for (let index = 0; index < references.length; index += 1) {
    const result = clearedReferenceResult(references[index], `${path}[${index}]`);
    if (!result.ok) return result;
  }
  return { ok: true, value: references };
}

/** @returns {Result<any>} */
function quarantineEntryResult(entry, path) {
  const object = objectResult(entry, path);
  if (!object.ok) return object;
  return firstFailure(
    stringResult(entry.collection, `${path}.collection`, LIMITS.shortText),
    stringResult(entry.reason, `${path}.reason`, LIMITS.shortText),
    instantResult(entry.quarantinedAt, `${path}.quarantinedAt`),
    OWN(entry, 'record') ? { ok: true, value: entry.record } : failure('missing-record', 'A quarantined entry keeps its record.', `${path}.record`),
    OWN(entry, 'clearedReferences')
      ? clearedReferencesResult(entry.clearedReferences, `${path}.clearedReferences`)
      : { ok: true, value: undefined },
  );
}

/** @returns {Result<any>} */
function quarantineResult(entries, path) {
  // The bin has no count of its own: the 5 MiB root bound is what caps it.
  const array = arrayResult(entries, path, Number.MAX_SAFE_INTEGER);
  if (!array.ok) return array;
  for (let index = 0; index < entries.length; index += 1) {
    const result = quarantineEntryResult(entries[index], `${path}[${index}]`);
    if (!result.ok) return result;
  }
  return { ok: true, value: entries };
}

/** @returns {Result<any>} */
function validateCollection(snapshot, key, maximum, validator) {
  const array = arrayResult(snapshot[key], key, maximum);
  if (!array.ok) return array;
  const ids = new Set();
  for (let index = 0; index < snapshot[key].length; index += 1) {
    const item = snapshot[key][index];
    const result = validator(item, `${key}[${index}]`);
    if (!result.ok) return result;
    const id = item.id ?? item.requestId;
    if (ids.has(id)) return failure('duplicate-id', `${key} IDs must be unique.`, `${key}[${index}].id`);
    ids.add(id);
  }
  return { ok: true, value: snapshot[key] };
}

/**
 * @param {string} now
 * @returns {Snapshot}
 */
export function createEmptySnapshot(now) {
  const instant = instantResult(now, 'now');
  if (!instant.ok) throw new TypeError(instant.error.message);
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: now,
    preferences: null,
    lots: [],
    auctionEvents: [],
    alternativeGroups: [],
    evidence: [],
    collectionEntries: [],
    drafts: [],
    alerts: [],
    scheduler: { revision: 0, nextWakeAt: null, lastReconciledAt: null },
    recentCommands: [],
  };
}

// Stored roots pass through here before validation, so one place brings an older stored shape up
// to the current one. Each step is keyed by the version it migrates from and never by
// SCHEMA_VERSION itself, which is what ends the walk.
// ponytail: a single linear chain of steps, each one hand-written; there is no down-migration.
// The settings carry no version of their own apart from the root's: validation requires `preferences.schemaVersion` to
// equal SCHEMA_VERSION, and a load repairs settings that fail by setting them aside whole. So a change to the settings'
// shape alone must still move the root's SCHEMA_VERSION, with a step here that rewrites `preferences.schemaVersion` as
// step 1 does; bumping only the settings' version would send every collector's settings and house presets to the bin.
const MIGRATIONS = new Map([
  // Version 2 took the research form out of the durable root. The catalogue, number, volume and
  // section belong to the popup's own form, which already keeps them in its local storage, and
  // sample mode is gone entirely; the currency, the house premiums and the alert switch stay,
  // because more than one view reads them. Nothing outside those five keys is touched, and a
  // nested version that does not read as the one being migrated is left for validation to judge.
  [1, (value) => {
    value.schemaVersion = 2;
    if (isObject(value.preferences)) {
      for (const key of ['catalogue', 'number', 'volume', 'section', 'sampleMode']) {
        delete value.preferences[key];
      }
      if (value.preferences.schemaVersion === 1) value.preferences.schemaVersion = 2;
    }
    return value;
  }],
]);

/**
 * A stored root brought up to the current schema; anything that is no object is handed back as it came.
 * @param {*} stored
 * @returns {*}
 */
export function migrateSnapshot(stored) {
  if (!isObject(stored)) return stored;
  let value = stored;
  for (let step = MIGRATIONS.get(value.schemaVersion); step; step = MIGRATIONS.get(value.schemaVersion)) {
    value = step(structuredClone(value));
  }
  return value;
}

const DISCARDED_ON_REPAIR = new Set(['recentCommands', 'drafts']);

// The bin keeps no identifier of its own, and entries written by older builds or by another install
// carry none either, so an entry is named by what it holds: the same bytes name the same entry on
// every device. The date it was set aside is left out of the name. A load repairs a root without
// writing it, and stamps what it sets aside with the moment of that load, so the date of an entry the
// repair made is a new one on every read until a write keeps it: named by it, the entry the page drew
// was never the one the store found, and Restore could only answer "reload". Two entries differing in
// nothing but the date are one entry anyway: the fold keeps the earlier date.
/**
 * @param {*} entry
 * @returns {string}
 */
export function quarantineEntryId(entry) {
  let encoded;
  try {
    const named = isObject(entry) ? { ...entry } : entry ?? null;
    if (isObject(named)) delete named.quarantinedAt;
    encoded = JSON.stringify(named);
  } catch { encoded = null; }
  return stableUuid(typeof encoded === 'string' ? encoded : 'unreadable-entry');
}

// One record set aside for one reason is one entry, however often it has been through a repair or
// arrived in a merged backup. Entries fold only when they carry the very same record, so two
// different duplicates of one ID keep both bodies: the record's own bytes are part of what an entry
// is found by. An entry that holds no record is the note of a cause that was never in storage, and
// has no ID to be named by: it is the same note as another naming the same cause with the same
// cleared links. Anything else is found by its own bytes less the date, which is what names it.
function quarantineFoldKey(entry) {
  const id = entry?.record?.id ?? entry?.record?.requestId;
  if (typeof id === 'string') return `${entry.collection}:${id}:${entry.reason}:${JSON.stringify(entry.record)}`;
  if (entry?.record === null || entry?.record === undefined) {
    return `${entry?.collection}::${entry?.reason}:${String(entry?.record)}:${JSON.stringify(entry?.clearedReferences ?? [])}`;
  }
  return `entry:${quarantineEntryId(entry)}`;
}

// A bin being folded. Each entry is looked up by its key and each link by its bytes, never searched
// for: a crafted backup whose bin held thousands of bodies under one ID, or thousands of links on one
// record, made every entry and every link compare itself with all the others, and an import of a
// 2 MiB file held the one command queue for minutes. `keep` answers with the entry that holds this
// one now - itself, or the one already there, having gained the earlier date and whatever links
// this one recorded - and `link` writes a cleared link down once however often it is cleared.
function quarantineFold() {
  const entries = [];
  const byKey = new Map();
  const links = new Map();
  const linksOf = (entry) => {
    if (!links.has(entry)) links.set(entry, new Set((entry.clearedReferences ?? []).map((kept) => JSON.stringify(kept))));
    return links.get(entry);
  };
  const link = (entry, reference) => {
    const held = linksOf(entry);
    const text = JSON.stringify(reference);
    if (held.has(text)) return;
    held.add(text);
    (entry.clearedReferences ??= []).push(reference);
  };
  const keep = (entry, { fold = true } = {}) => {
    const key = fold ? quarantineFoldKey(entry) : null;
    const held = key === null ? undefined : byKey.get(key);
    if (!held) {
      entries.push(entry);
      if (key !== null) byKey.set(key, entry);
      return entry;
    }
    if (entry.quarantinedAt < held.quarantinedAt) held.quarantinedAt = entry.quarantinedAt;
    for (const reference of entry.clearedReferences ?? []) link(held, reference);
    return held;
  };
  return { entries, keep, link };
}

// One bin, folded - so never two entries of identical bytes, which would answer to one entry ID and
// give Settings two Restore buttons that do the same thing.
/**
 * @param {QuarantineEntry[]} entries
 * @returns {QuarantineEntry[]}
 */
export function foldQuarantine(entries) {
  const fold = quarantineFold();
  for (const entry of entries) fold.keep(entry);
  return fold.entries;
}

const COLLECTION_VALIDATORS = new Map(COLLECTIONS.map(({ key, validator }) => [key, validator]));
// Where a record can go back to: the live collections. The bookkeeping the repair discards outright
// is never in the bin to be put back, and the bin itself is not a collection.
const RESTORABLE_COLLECTIONS = COLLECTIONS
  .map(({ key }) => key).filter((key) => !DISCARDED_ON_REPAIR.has(key));
// Whether an entry set aside from this collection has anywhere to go back to: settings set aside whole are made again
// in Settings rather than put back, and an unreadable entry of the bin itself was never a record.
/** @type {(collection: *) => boolean} */
export const isRestorableCollection = (collection) => RESTORABLE_COLLECTIONS.includes(collection);

// The bin keeps a record verbatim, so one set aside by an older build can predate today's shapes.
// Today's validator judges it first, and only a record that fails is offered the migration a stored
// root gets, from the first version there was: a record already in today's shape is never walked
// through a migration step a second time.
/**
 * @param {*} collection
 * @param {*} record
 * @returns {Result<any>}
 */
export function validateQuarantinedRecord(collection, record) {
  const validator = RESTORABLE_COLLECTIONS.includes(collection) ? COLLECTION_VALIDATORS.get(collection) : null;
  if (!validator) {
    return failure('invalid-record', 'This entry is not a record that can be put back.', 'entry.collection');
  }
  const asStored = validator(record, collection);
  if (asStored.ok) return { ok: true, value: record };
  let migrated;
  try { migrated = migrateSnapshot({ schemaVersion: 1, [collection]: [record] })?.[collection]?.[0]; }
  catch { migrated = undefined; }
  if (migrated === undefined) return asStored;
  const asMigrated = validator(migrated, collection);
  return asMigrated.ok ? { ok: true, value: migrated } : asStored;
}

// Every place a root keeps a revision, named as the collection and record that carries it so a warning can say which.
function* revisionSites(root) {
  if (isObject(root)) yield { host: root, key: 'revision', collection: 'root', id: null };
  if (isObject(root?.preferences)) yield { host: root.preferences, key: 'revision', collection: 'preferences', id: null };
  if (isObject(root?.scheduler)) yield { host: root.scheduler, key: 'revision', collection: 'scheduler', id: null };
  for (const { key } of COLLECTIONS) {
    if (!Array.isArray(root?.[key])) continue;
    for (const record of root[key]) {
      if (!isObject(record)) continue;
      yield { host: record, key: 'revision', collection: key, id: record.id ?? null };
      if (OWN(record, 'eventRevision')) yield { host: record, key: 'eventRevision', collection: key, id: record.id ?? null };
    }
  }
}

const unusableRevision = (value) => typeof value === 'number' && value > LIMITS.usableRevision;

// A revision above the usable ceiling is one no run of writes produced, so the file that carries it was hand-made or
// damaged. Nothing has to take such a file in: the caller refuses it whole and names what it found.
/**
 * @param {*} root
 * @returns {Array<{ collection: string, id: string | null, field: string }>}
 */
export function unusableRevisions(root) {
  const found = [];
  for (const { host, key, collection, id } of revisionSites(root)) {
    if (unusableRevision(host[key])) found.push({ collection, id, field: key });
  }
  return found;
}

// What is already in storage is the other case: an older build's root, or a file that got past an earlier import, must
// still open with all its records, and every later write has to count from somewhere the arithmetic can hold. So the
// revision is restarted in place rather than condemned, which the next write persists. Nothing else is touched, and a
// root with nothing to restart is left exactly as it came, so this can run on every load.
/**
 * @param {*} root changed in place
 * @returns {Array<{ collection: string, id: string | null, field: string }>}
 */
export function restartUnusableRevisions(root) {
  const restarted = [];
  for (const { host, key, collection, id } of revisionSites(root)) {
    if (!unusableRevision(host[key])) continue;
    host[key] = 0;
    restarted.push({ collection, id, field: key });
  }
  return restarted;
}

// One record that stops validating must never lock the collector out of the rest of their data.
// Each record is validated on its own; a failing one is set aside verbatim in `quarantine` and
// references to it are repaired by the cheapest step that keeps the root valid: an optional
// reference is cleared, while a record whose required reference is gone follows it into the bin.
// Only the bookkeeping in DISCARDED_ON_REPAIR is dropped outright, and a root that is unusable
// even then is reported as a failure so the caller can fall back to its existing storage error.
/**
 * @param {*} stored
 * @param {string} now
 * @returns {Result<Snapshot>}
 */
export function quarantineInvalidRecords(stored, now) {
  const instant = instantResult(now, 'now');
  if (!instant.ok) return instant;
  const object = objectResult(stored, 'snapshot');
  if (!object.ok) return object;
  let root;
  try { root = structuredClone(stored); } catch { return failure('invalid-record', 'Stored data cannot be copied.', 'snapshot'); }

  restartUnusableRevisions(root);

  const bin = quarantineFold();
  const hosts = new Map();
  // A repair running again over a bin it already wrote must not open a second entry beside the one
  // that is already there: the entry already held keeps the earlier date and gains whatever links
  // the other one recorded. An entry holding no record is folded at the end instead, because the
  // links that identify it are only pushed onto it once this repair has found them.
  const keep = (entry) => {
    const id = entry.record?.id ?? entry.record?.requestId;
    const held = bin.keep(entry, { fold: typeof id === 'string' });
    // A record in the bin is the cause of every reference to it the repair has to clear, whether it
    // was set aside just now or by an earlier one.
    if (held === entry && typeof id === 'string') hosts.set(`${entry.collection}:${id}`, entry);
    return held;
  };
  const setAside = (collection, record, reason) => keep({ collection, record, reason, quarantinedAt: now });
  // Clearing a reference alters a record the collector still holds, so the value goes on the
  // quarantine entry of whatever caused the clearing and the link can be put back. A cause that
  // was never in storage, or one that is itself kept, has no entry of its own, so an entry with a
  // null record is opened to carry the note.
  const noteCleared = (cause, causeId, reason, record, collection, field) => {
    const key = `${cause}:${causeId}`;
    const host = hosts.get(key) ?? setAside(cause, null, reason);
    hosts.set(key, host);
    host.clearedReferences ??= [];
    // The entry may have been carried in from an earlier repair with this very link on it, so a
    // link is written down once however often it is cleared, exactly as folding two entries does:
    // a root repaired, written, linked to the same broken record again and repaired again said
    // "2 links cleared" for one link, and offered to put it back twice.
    bin.link(host, { collection, id: record.id, field, value: record[field] });
  };
  if (OWN(root, 'quarantine')) {
    const entries = Array.isArray(root.quarantine) ? root.quarantine : [root.quarantine];
    for (const entry of entries) {
      if (quarantineEntryResult(entry, 'quarantine').ok) keep(entry);
      else setAside('quarantine', entry, 'invalid-entry');
    }
  }

  // What every record shares is never a reason to refuse them all. The root's own counter and write time, the
  // schedule, the half-hour scratch and the request ledger are bookkeeping the next write and the next reconcile build
  // again, so a damaged one starts again. The settings are the collector's own, so they are set aside whole rather than
  // dropped: the store runs as it did before any were made, and Settings makes them again.
  if (!integerResult(root.revision, 'revision').ok) root.revision = 0;
  if (!instantResult(root.updatedAt, 'updatedAt').ok) root.updatedAt = now;
  if (!schedulerResult(root.scheduler, 'scheduler').ok) root.scheduler = { revision: 0, nextWakeAt: null, lastReconciledAt: null };
  for (const key of DISCARDED_ON_REPAIR) if (!Array.isArray(root[key])) root[key] = [];
  const settings = preferencesResult(root.preferences ?? null, 'preferences');
  if (!settings.ok) setAside('preferences', root.preferences, settings.error.code);
  if (!settings.ok || root.preferences === undefined) root.preferences = null;

  for (const { key, maximum, validator, keepNewest } of COLLECTIONS) {
    if (!Array.isArray(root[key])) return failure('invalid-record', `Stored ${key} is not a list.`, key);
    const kept = [];
    const ids = new Set();
    for (const record of keepNewest ? root[key].slice(-maximum) : root[key]) {
      const id = record?.id ?? record?.requestId;
      const result = validator(record, key);
      let reason = null;
      if (!result.ok) reason = result.error.code;
      else if (ids.has(id)) reason = 'duplicate-id';
      else if (kept.length >= maximum) reason = 'collection-limit';
      if (reason) {
        // Ledger entries and drafts are bookkeeping and half-hour scratch, not collector records,
        // and backups strip them for privacy: a broken one is dropped rather than moved into the
        // quarantine bin, which is exported.
        if (!DISCARDED_ON_REPAIR.has(key)) setAside(key, record, reason);
        continue;
      }
      ids.add(id);
      kept.push(record);
    }
    root[key] = kept;
  }

  let observations = 0;
  root.evidence = root.evidence.filter((row) => {
    observations += row.observations.length;
    if (observations <= LIMITS.evidenceObservations) return true;
    setAside('evidence', row, 'collection-limit');
    return false;
  });

  const events = new Map(root.auctionEvents.map((event) => [event.id, event]));
  const groups = new Set(root.alternativeGroups.map((group) => group.id));
  for (const lot of root.lots) {
    if (OWN(lot, 'auctionEventId') && !events.has(lot.auctionEventId)) {
      noteCleared('auctionEvents', lot.auctionEventId, 'missing-record', lot, 'lots', 'auctionEventId');
      delete lot.auctionEventId;
    }
    if (OWN(lot, 'alternativeGroupId') && !groups.has(lot.alternativeGroupId)) {
      const groupId = lot.alternativeGroupId;
      noteCleared('alternativeGroups', groupId, 'missing-record', lot, 'lots', 'alternativeGroupId');
      noteCleared('alternativeGroups', groupId, 'missing-record', lot, 'lots', 'priority');
      delete lot.alternativeGroupId;
      delete lot.priority;
    }
  }
  const lots = new Map(root.lots.map((lot) => [lot.id, lot]));
  root.collectionEntries = root.collectionEntries.filter((entry) => {
    const lot = lots.get(entry.lotId);
    if (lot && lot.collectionEntryId === entry.id) return true;
    // A collection entry without its lot has no valid shape, so it follows the lot into the bin.
    setAside('collectionEntries', entry, 'foreign-key');
    return false;
  });
  const entries = new Map(root.collectionEntries.map((entry) => [entry.id, entry]));
  for (const lot of root.lots) {
    if (!OWN(lot, 'collectionEntryId')) continue;
    const entry = entries.get(lot.collectionEntryId);
    if (entry && entry.lotId === lot.id) continue;
    // An entry that names another lot as its own belongs to that lot; this one is a stale claim,
    // and clearing it keeps both lots rather than locking the whole store over one field.
    if (entry) noteCleared('collectionEntries', entry.id, 'entry-claimed-by-another-lot', lot, 'lots', 'collectionEntryId');
    else noteCleared('collectionEntries', lot.collectionEntryId, 'missing-record', lot, 'lots', 'collectionEntryId');
    delete lot.collectionEntryId;
  }
  root.alerts = root.alerts.filter((alert) => {
    const event = events.get(alert.eventId);
    if (event?.reminders.some(({ id }) => id === alert.reminderId)) return true;
    setAside('alerts', alert, 'foreign-key');
    return false;
  });

  // The collector's ordering is only rewritten where validation insists on it: a group left
  // non-compact by a rescued member, or one stored with duplicate priorities. A group that still
  // validates is left exactly as it was, and every priority that does move is written down.
  const members = new Map();
  for (const lot of root.lots) {
    if (!OWN(lot, 'alternativeGroupId')) continue;
    members.set(lot.alternativeGroupId, [...(members.get(lot.alternativeGroupId) ?? []), lot]);
  }
  for (const [groupId, group] of members) {
    group.sort((left, right) => (left.priority - right.priority) || left.id.localeCompare(right.id));
    if (group.every((lot, index) => lot.priority === index + 1)) continue;
    group.forEach((lot, index) => {
      if (lot.priority === index + 1) return;
      noteCleared('alternativeGroups', groupId, 'noncompact-priority', lot, 'lots', 'priority');
      lot.priority = index + 1;
    });
  }

  // Last, because a note of a cause is identified by the links it carries and those are only pushed
  // onto it as this repair finds them: two notes of one cause are one note by the time it is over.
  if (bin.entries.length) root.quarantine = foldQuarantine(bin.entries);
  const valid = validateSnapshot(root);
  return valid.ok ? { ok: true, value: root } : valid;
}

// Validation is the boundary a root has to cross, so a root too deeply nested to be walked is turned
// away here with an ordinary failure rather than throwing out of whatever command was being served.
/**
 * @param {*} value
 * @returns {Result<Snapshot>}
 */
export function validateSnapshot(value) {
  try {
    return validateRoot(value);
  } catch (error) {
    if (!isRecursionError(error)) throw error;
    return tooDeeplyNested('snapshot');
  }
}

/** @returns {Result<Snapshot>} */
function validateRoot(value) {
  const object = objectResult(value, 'snapshot');
  if (!object.ok) return object;
  if (value.schemaVersion !== SCHEMA_VERSION) {
    return failure('unsupported-schema', 'Snapshot schema version is unsupported.', 'schemaVersion');
  }
  const header = firstFailure(
    integerResult(value.revision, 'revision'),
    instantResult(value.updatedAt, 'updatedAt'),
    preferencesResult(value.preferences, 'preferences'),
    schedulerResult(value.scheduler, 'scheduler'),
    OWN(value, 'quarantine') ? quarantineResult(value.quarantine, 'quarantine') : { ok: true },
  );
  if (!header.ok) return header;

  const collectionFailure = firstFailure(...COLLECTIONS.map(({ key, maximum, validator }) =>
    validateCollection(value, key, maximum, validator)));
  if (!collectionFailure.ok) return collectionFailure;

  const events = new Map(value.auctionEvents.map((event) => [event.id, event]));
  const groups = new Set(value.alternativeGroups.map((group) => group.id));
  const entries = new Map(value.collectionEntries.map((entry) => [entry.id, entry]));
  const priorities = new Set();
  const prioritiesByGroup = new Map();
  for (let index = 0; index < value.lots.length; index += 1) {
    const lot = value.lots[index];
    if (OWN(lot, 'auctionEventId') && !events.has(lot.auctionEventId)) {
      return failure('foreign-key', 'Lot refers to an unknown auction event.', `lots[${index}].auctionEventId`);
    }
    if (OWN(lot, 'alternativeGroupId') && !groups.has(lot.alternativeGroupId)) {
      return failure('foreign-key', 'Lot refers to an unknown alternative group.', `lots[${index}].alternativeGroupId`);
    }
    if (OWN(lot, 'collectionEntryId')) {
      const entry = entries.get(lot.collectionEntryId);
      if (!entry || entry.lotId !== lot.id) {
        return failure(
          'foreign-key',
          'Lot and collection entry must refer to each other.',
          `lots[${index}].collectionEntryId`,
        );
      }
    }
    if (OWN(lot, 'alternativeGroupId')) {
      const key = `${lot.alternativeGroupId}:${lot.priority}`;
      if (priorities.has(key)) {
        return failure('duplicate-priority', 'Priorities must be unique within an alternative group.', `lots[${index}].priority`);
      }
      priorities.add(key);
      const groupPriorities = prioritiesByGroup.get(lot.alternativeGroupId) ?? [];
      groupPriorities.push(lot.priority);
      prioritiesByGroup.set(lot.alternativeGroupId, groupPriorities);
    }
  }
  for (const [groupId, groupPriorities] of prioritiesByGroup) {
    groupPriorities.sort((left, right) => left - right);
    for (let index = 0; index < groupPriorities.length; index += 1) {
      if (groupPriorities[index] !== index + 1) {
        return failure(
          'noncompact-priority',
          'Alternative priorities must be compact from one through group size.',
          `alternativeGroups.${groupId}`,
        );
      }
    }
  }
  const lotsById = new Map(value.lots.map((lot) => [lot.id, lot]));
  for (let index = 0; index < value.collectionEntries.length; index += 1) {
    const entry = value.collectionEntries[index];
    const lot = lotsById.get(entry.lotId);
    if (!lot || lot.collectionEntryId !== entry.id) {
      return failure(
        'foreign-key',
        'Collection entry and lot must refer to each other.',
        `collectionEntries[${index}].lotId`,
      );
    }
  }
  let observationCount = 0;
  for (const evidence of value.evidence) observationCount += evidence.observations.length;
  if (observationCount > LIMITS.evidenceObservations) {
    return failure('collection-limit', 'Evidence observation limit exceeded.', 'evidence');
  }
  for (let index = 0; index < value.alerts.length; index += 1) {
    const alert = value.alerts[index];
    const event = events.get(alert.eventId);
    if (!event) return failure('foreign-key', 'Alert refers to an unknown event.', `alerts[${index}].eventId`);
    if (!event.reminders.some((reminder) => reminder.id === alert.reminderId)) {
      return failure('foreign-key', 'Alert refers to an unknown event reminder.', `alerts[${index}].reminderId`);
    }
  }
  try { projectExposure(value); } catch {
    return failure('unsafe-exposure', 'Projected exposure exceeds the supported integer range.', 'lots');
  }
  return { ok: true, value };
}

function derivedUuid(seed) {
  const hash = (salt) => {
    let value = 14695981039346656037n ^ BigInt(salt);
    for (let index = 0; index < seed.length; index += 1) {
      value ^= BigInt(seed.charCodeAt(index));
      value = BigInt.asUintN(64, value * 1099511628211n);
    }
    return value.toString(16).padStart(16, '0');
  };
  const hex = `${hash(0)}${hash(1)}`.split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function lastSettlement(history) {
  return [...history].reverse().find(({ action }) => action === 'settled-won' || action === 'settled-lost');
}

/**
 * The lot with its outcome set, its bid history settled or reopened, and its outcome history extended.
 * @param {Lot} lot
 * @param {*} outcomeDraft
 * @param {string} now
 * @returns {Result<Lot>}
 */
export function setOutcome(lot, outcomeDraft, now) {
  const validLot = lotResult(lot, 'lot');
  if (!validLot.ok) return validLot;
  const instant = instantResult(now, 'now');
  if (!instant.ok) return instant;
  const draft = objectResult(outcomeDraft, 'outcome');
  if (!draft.ok) return draft;
  const status = enumResult(outcomeDraft.status, OUTCOMES, 'outcome.status');
  if (!status.ok) return status;
  if (outcomeDraft.status === 'passed' && OWN(lot, 'activeBid')) {
    return failure('active-bid', 'Record external cancellation before marking this lot passed.', 'activeBid');
  }
  if ((outcomeDraft.status === 'open' || outcomeDraft.status === 'passed') &&
      (OWN(outcomeDraft, 'hammer') || OWN(outcomeDraft, 'actualInvoice'))) {
    return failure('invalid-outcome-price', 'Open and passed outcomes cannot carry final prices.', 'outcome');
  }
  if (OWN(outcomeDraft, 'hammer')) {
    const hammer = moneyResult(outcomeDraft.hammer, 'outcome.hammer');
    if (!hammer.ok) return hammer;
  }
  if (OWN(outcomeDraft, 'actualInvoice')) {
    const invoice = moneyResult(outcomeDraft.actualInvoice, 'outcome.actualInvoice');
    if (!invoice.ok) return invoice;
  }
  // The terms a won coin is costed on when its bids carry none, or other ones (Q-01). Stated again, they replace the
  // ones kept; `null` takes them off; left out of a won correction, the ones kept stand.
  const statesTerms = OWN(outcomeDraft, 'terms') && outcomeDraft.terms !== null;
  if (statesTerms) {
    if (outcomeDraft.status !== 'won') return failure('invalid-outcome-terms', 'Only a won outcome carries premium and fee terms.', 'outcome.terms');
    const terms = outcomeTermsResult(outcomeDraft.terms, 'outcome.terms', outcomeDraft.hammer?.currency);
    if (!terms.ok) return terms;
  }

  const reopeningSettled = outcomeDraft.status === 'open' &&
    (lot.outcome.status === 'won' || lot.outcome.status === 'lost');
  if (reopeningSettled && typeof outcomeDraft.bindingActive !== 'boolean') {
    return failure(
      'reopen-decision-required',
      'Say whether the last settled binding terms are externally active again.',
      'outcome.bindingActive',
    );
  }

  const next = {
    ...lot,
    revision: lot.revision + 1,
    updatedAt: now,
    bidHistory: [...lot.bidHistory],
    outcomeHistory: [...lot.outcomeHistory],
  };
  const prices = {};
  if (OWN(outcomeDraft, 'hammer')) prices.hammer = { ...outcomeDraft.hammer };
  if (OWN(outcomeDraft, 'actualInvoice')) prices.actualInvoice = { ...outcomeDraft.actualInvoice };
  /** @type {Outcome} */
  const nextOutcome = { status: outcomeDraft.status, ...prices };
  if (Object.keys(prices).length > 0) nextOutcome.verification = 'personal-unverified';
  if (lot.outcome.status !== 'open') nextOutcome.correctedAt = now;
  if (statesTerms) {
    nextOutcome.terms = {
      ...(OWN(outcomeDraft.terms, 'buyerPremiumBps') ? { buyerPremiumBps: outcomeDraft.terms.buyerPremiumBps } : {}),
      ...(OWN(outcomeDraft.terms, 'costEstimate') ? { costEstimate: structuredClone(outcomeDraft.terms.costEstimate) } : {}),
    };
  } else if (!OWN(outcomeDraft, 'terms') && outcomeDraft.status === 'won' && lot.outcome.status === 'won' && lot.outcome.terms) {
    nextOutcome.terms = structuredClone(lot.outcome.terms);
  }
  next.outcome = nextOutcome;

  if ((outcomeDraft.status === 'won' || outcomeDraft.status === 'lost') && OWN(next, 'activeBid')) {
    const action = outcomeDraft.status === 'won' ? 'settled-won' : 'settled-lost';
    // The lot holds an active bid here (OWN above), so it is read as one.
    /** @type {BidHistoryEntry} */
    const entry = {
      id: derivedUuid(`${lot.id}|${lot.revision}|${now}|${action}`),
      action,
      amount: { .../** @type {Bid} */ (next.activeBid).amount },
      recordedAt: now,
    };
    if (OWN(next.activeBid, 'buyerPremiumBps')) entry.buyerPremiumBps = /** @type {Bid} */ (next.activeBid).buyerPremiumBps;
    next.bidHistory.push(entry);
    delete next.activeBid;
  }

  if (reopeningSettled) {
    const settled = lastSettlement(next.bidHistory);
    if (outcomeDraft.bindingActive && !settled?.amount) {
      return failure('missing-binding-terms', 'No settled binding terms are available to restore.', 'bidHistory');
    }
    const action = outcomeDraft.bindingActive ? 'reopened-active' : 'reopened-inactive';
    /** @type {BidHistoryEntry} */
    const declaration = {
      id: derivedUuid(`${lot.id}|${lot.revision}|${now}|${action}`),
      action,
      recordedAt: now,
    };
    if (settled?.amount) declaration.amount = { ...settled.amount };
    if (settled && OWN(settled, 'buyerPremiumBps')) {
      declaration.buyerPremiumBps = settled.buyerPremiumBps;
    }
    next.bidHistory.push(declaration);
    if (outcomeDraft.bindingActive) {
      next.activeBid = { amount: { ...settled.amount }, placedAt: now };
      if (OWN(settled, 'buyerPremiumBps')) next.activeBid.buyerPremiumBps = settled.buyerPremiumBps;
    } else {
      delete next.activeBid;
    }
  }

  if (next.bidHistory.length > LIMITS.bidHistory) {
    return failure('collection-limit', 'Bid history limit exceeded.', 'bidHistory');
  }
  // Worked out now, from the bid just settled and the fees saved with the lot, and kept: a preset or a fee changed
  // later never rewrites what a coin cost. A cost the caller sent is never read.
  if (outcomeDraft.status === 'won') {
    const cost = deriveWonCost(next, nextOutcome.hammer);
    if (cost) nextOutcome.cost = cost;
  }
  next.outcomeHistory.push({
    id: derivedUuid(`${lot.id}|${lot.revision}|${now}|outcome|${lot.outcome.status}|${outcomeDraft.status}`),
    from: lot.outcome.status,
    to: outcomeDraft.status,
    recordedAt: now,
    ...(reopeningSettled ? { bindingActive: outcomeDraft.bindingActive } : {}),
  });
  if (next.outcomeHistory.length > LIMITS.outcomeHistory) {
    return failure('collection-limit', 'Outcome history limit exceeded.', 'outcomeHistory');
  }
  if (lot.outcome.status === 'won' && outcomeDraft.status !== 'won' && OWN(lot, 'collectionEntryId')) {
    next.collectionReviewReason = 'source-lot-no-longer-won';
  } else if (outcomeDraft.status === 'won') {
    // Correcting the outcome back to won answers the review that the mistake raised.
    delete next.collectionReviewReason;
  }

  const validated = lotResult(next, 'lot');
  if (!validated.ok) return validated;
  return { ok: true, value: next };
}
