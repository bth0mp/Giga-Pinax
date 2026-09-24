// @ts-check
// What the views draw from the records rather than store: the open bids' exposure per currency and
// event, and the collection's totals with each entry's own saved comparables. Nothing here writes a
// record, and nothing is converted or added across currencies.
import { CURRENCIES, calculatePremium, validateMoney } from './money.js';
import { computeStatistics } from './evidence.js';
import { dateParts } from './validate.js';
/**
 * @typedef {import('./types.js').Lot} Lot
 * @typedef {import('./types.js').Evidence} Evidence
 * @typedef {import('./types.js').CollectionEntry} CollectionEntry
 * @typedef {import('./types.js').Money} Money
 */
/**
 * What the open bids in one currency add up to: hammers, hammers with the premium where it is known,
 * how many bids, and how many carry no premium.
 * @typedef {object} ExposureTotals
 * @property {number} hammerMinor
 * @property {number} knownHammerPlusBpMinor
 * @property {number} bindingCount
 * @property {number} unknownPremiumCount
 */
/** @typedef {ExposureTotals & { byEvent: Record<string, ExposureTotals> }} CurrencyExposure */
/**
 * @typedef {object} OwnComparables
 * @property {'no-reference' | 'no-currency' | 'none' | 'too-few' | 'median'} status
 * @property {string | null} currency
 * @property {number} count
 * @property {Money | null} median
 */
/**
 * @typedef {object} CollectionTotals
 * @property {number} entryCount
 * @property {number} hammerCount
 * @property {number | null} hammerMinor
 * @property {number} invoiceCount
 * @property {number | null} invoiceMinor
 * @property {number | null} firstYear
 * @property {number | null} lastYear
 */
/**
 * @typedef {object} CollectionProjection
 * @property {Record<string, CollectionTotals>} byCurrency
 * @property {{ entryCount: number, firstYear: number | null, lastYear: number | null }} unpriced
 * @property {Array<{ id: string, lotId: string, title: string, acquisitionDate: string, reference: string,
 *   currency: string | null, comparables: OwnComparables }>} entries
 */

/** @type {(value: any, key: PropertyKey) => boolean} */
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function emptyExposure() {
  return {
    hammerMinor: 0,
    knownHammerPlusBpMinor: 0,
    bindingCount: 0,
    unknownPremiumCount: 0,
    byEvent: {},
  };
}

function addSafe(left, right) {
  const sum = BigInt(left) + BigInt(right);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('unsafe exposure');
  return Number(sum);
}

/**
 * @param {{ lots?: Lot[] }} snapshot
 * @returns {Record<string, CurrencyExposure>}
 */
export function projectExposure(snapshot) {
  const byCurrency = {};
  for (const lot of snapshot.lots ?? []) {
    if (lot?.outcome?.status !== 'open' || !lot.activeBid) continue;
    const money = validateMoney(lot.activeBid.amount);
    if (!money.ok) throw new TypeError(money.error.message);
    const currency = lot.activeBid.amount.currency;
    const eventId = lot.auctionEventId ?? 'unassigned';
    byCurrency[currency] ??= emptyExposure();
    byCurrency[currency].byEvent[eventId] ??= {
      hammerMinor: 0,
      knownHammerPlusBpMinor: 0,
      bindingCount: 0,
      unknownPremiumCount: 0,
    };
    const totals = [byCurrency[currency], byCurrency[currency].byEvent[eventId]];
    for (const total of totals) {
      total.hammerMinor = addSafe(total.hammerMinor, lot.activeBid.amount.minor);
      total.bindingCount += 1;
    }
    if (!OWN(lot.activeBid, 'buyerPremiumBps')) {
      for (const total of totals) total.unknownPremiumCount += 1;
      continue;
    }
    const premium = calculatePremium(lot.activeBid.amount, lot.activeBid.buyerPremiumBps);
    if (!premium.ok) throw new RangeError(premium.error.message);
    for (const total of totals) {
      total.knownHammerPlusBpMinor = addSafe(
        total.knownHammerPlusBpMinor,
        premium.value.hammerPlusPremium.minor,
      );
    }
  }
  /** @type {Record<string, CurrencyExposure>} */
  const ordered = {};
  for (const currency of CURRENCIES) if (byCurrency[currency]) ordered[currency] = byCurrency[currency];
  return ordered;
}

// A reference and a saved query are the same only when they read the same once spacing and case
// are set aside: a query that merely starts like the reference (`RIC 27` for `RIC 27b`) is another
// coin, and one median must never take in another coin's sales.
const normalReference = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

// Saved rows by each of their observations' normalised query labels, built once per projection:
// the view is drawn on every snapshot, and scanning every row for every entry did not scale.
function indexByReference(evidence) {
  const index = new Map();
  for (const row of evidence ?? []) {
    for (const key of new Set((row?.observations ?? []).map((item) => normalReference(item.queryLabel)))) {
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(row);
    }
  }
  return index;
}

// The median of the collector's own saved comparables for one reference, in one currency, through
// the same statistics the Search route shows: excluded rows stay out, a row in another currency is
// never converted in, and fewer than three rows give a count without a median.
/**
 * @param {Map<string, Evidence[]>} index
 * @param {string} reference
 * @param {string | null} currency
 * @returns {OwnComparables}
 */
function ownComparables(index, reference, currency) {
  const none = (status) => ({ status, currency, count: 0, median: null });
  const key = normalReference(reference);
  if (!key) return none('no-reference');
  if (!currency) return none('no-currency');
  const rows = index.get(key) ?? [];
  const observations = rows.flatMap((row) => row.observations ?? []);
  const dates = observations.map((item) => item.auctionDate).filter((date) => typeof date === 'string').sort();
  if (!rows.length || !dates.length) return none('none');
  const stats = computeStatistics(rows, {
    currency, fromDate: dates[0], toDate: dates.at(-1), sources: [...new Set(observations.map((item) => item.source))],
  });
  if (stats.validationError || !stats.count) return none('none');
  return { status: stats.median ? 'median' : 'too-few', currency, count: stats.count, median: stats.median };
}

const acquisitionYear = (entry) => dateParts(entry.acquisitionDate)?.[0] ?? null;
const spreadYears = (totals, year) => {
  if (year === null) return;
  totals.firstYear = totals.firstYear === null ? year : Math.min(totals.firstYear, year);
  totals.lastYear = totals.lastYear === null ? year : Math.max(totals.lastYear, year);
};
// A total too large to hold exactly is not shown rather than shown wrong.
const addMinor = (total, minor) => {
  if (total === null) return null;
  const sum = BigInt(total) + BigInt(minor);
  return sum > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(sum);
};

// The collection as the collector recorded it. Per currency: how many entries carry an amount in it,
// what was knocked down and what was paid, and the years they were acquired in — every figure in the
// currency it was recorded in, nothing converted and nothing added across currencies. An entry paid
// in another currency than its hammer counts under both. Per entry: its own saved comparables for
// the linked coin's reference, in the entry's currency (its hammer's, else its invoice's). These are
// the collector's own records and evidence, never an appraisal or a valuation.
/**
 * @param {{ lots?: Lot[], evidence?: Evidence[], collectionEntries?: CollectionEntry[] } | null | undefined} snapshot
 * @returns {CollectionProjection}
 */
export function projectCollection(snapshot) {
  const lots = new Map((snapshot?.lots ?? []).map((lot) => [lot.id, lot]));
  const evidence = indexByReference(snapshot?.evidence);
  const byCurrency = {};
  const unpriced = { entryCount: 0, firstYear: null, lastYear: null };
  const entries = [];
  for (const entry of snapshot?.collectionEntries ?? []) {
    const year = acquisitionYear(entry);
    // Only the amounts validateMoney accepts are left, so each is read as Money.
    const amounts = /** @type {Array<[string, Money]>} */ ([['hammer', entry.hammer], ['invoice', entry.actualInvoice]]
      .filter(([, money]) => validateMoney(money).ok));
    const currencies = new Set(amounts.map(([, money]) => money.currency));
    if (!currencies.size) { unpriced.entryCount += 1; spreadYears(unpriced, year); }
    for (const currency of currencies) {
      const totals = byCurrency[currency] ??= {
        entryCount: 0, hammerCount: 0, hammerMinor: 0, invoiceCount: 0, invoiceMinor: 0, firstYear: null, lastYear: null,
      };
      totals.entryCount += 1;
      spreadYears(totals, year);
    }
    for (const [kind, money] of amounts) {
      const totals = byCurrency[money.currency];
      totals[`${kind}Count`] += 1;
      totals[`${kind}Minor`] = addMinor(totals[`${kind}Minor`], money.minor);
    }
    const currency = amounts[0]?.[1].currency ?? null;
    const reference = String(lots.get(entry.lotId)?.reference ?? '').trim();
    entries.push({
      id: entry.id, lotId: entry.lotId, title: entry.title, acquisitionDate: entry.acquisitionDate,
      reference, currency, comparables: ownComparables(evidence, reference, currency),
    });
  }
  /** @type {Record<string, CollectionTotals>} */
  const ordered = {};
  for (const currency of CURRENCIES) if (byCurrency[currency]) ordered[currency] = byCurrency[currency];
  return { byCurrency: ordered, unpriced, entries };
}
