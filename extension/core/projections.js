// @ts-check
// What the views draw from the records rather than store: the open bids' exposure per currency and
// event, and the collection's totals with each entry's own saved comparables. Nothing here writes a
// record, and nothing is converted or added across currencies.
import { CURRENCIES, calculateBidCost, calculatePremium, validateMoney } from './money.js';
import { computeStatistics } from './evidence.js';
import { dateParts } from './validate.js';
import { OWN } from './fields.js';
import { deriveReminderTriggers, localDateAtInstant, resolveZonedDateTime } from './reminders.js';
/**
 * @typedef {import('./types.js').Lot} Lot
 * @typedef {import('./types.js').Evidence} Evidence
 * @typedef {import('./types.js').CollectionEntry} CollectionEntry
 * @typedef {import('./types.js').Money} Money
 * @typedef {import('./types.js').AuctionEvent} AuctionEvent
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
 * @property {number} costCount entries with a total shown: a complete cost, or hammer and premium with no fees recorded
 * @property {number | null} costMinor
 * @property {number} costNoFeesCount of those, the ones whose fees were never recorded (counted as none)
 * @property {number | null} firstYear
 * @property {number | null} lastYear
 */
/**
 * @typedef {object} CollectionProjection
 * @property {Record<string, CollectionTotals>} byCurrency
 * @property {{ entryCount: number, firstYear: number | null, lastYear: number | null }} unpriced
 * @property {Array<{ id: string, lotId: string, title: string, acquisitionDate: string, reference: string,
 *   currency: string | null, comparables: OwnComparables, cost: import('./types.js').WonCost | null }>} entries
 */

/**
 * What stops a won coin's cost from being worked out: no hammer, no buyer's premium rate on its bid, no fees recorded
 * for it, or fees recorded in another currency than the hammer's (never converted).
 * @typedef {'hammer' | 'premium-rate' | 'fees' | 'fee-currency'} CostGap
 */
export const COST_GAPS = Object.freeze(['hammer', 'premium-rate', 'fees', 'fee-currency']);
const COST_PARTS = Object.freeze(['premium', 'premiumVat', 'platformFee', 'shipping', 'paymentFee']);
export const COST_FEE_PARTS = Object.freeze(['premiumVat', 'platformFee', 'shipping', 'paymentFee']);

// The buyer's premium rate on the coin's bids: the last bid settled or re-opened that carries a rate (settled won, or
// settled lost and then corrected to won, which is the same bid), else the plan the collector made for it. A plan
// revised after that entry - a coin re-opened and planned again - is newer, so its rate is the one it is won on now.
const SETTLED_ACTIONS = new Set(['settled-won', 'settled-lost', 'reopened-active', 'reopened-inactive']);
/**
 * @param {Lot | null | undefined} lot
 * @returns {number | null}
 */
export function bidPremiumRate(lot) {
  const history = lot?.bidHistory ?? [];
  const settledIndex = history.findLastIndex((entry) => SETTLED_ACTIONS.has(entry.action) && Number.isInteger(entry.buyerPremiumBps));
  const plan = Number.isInteger(lot?.plannedBid?.buyerPremiumBps) ? /** @type {number} */ (lot?.plannedBid?.buyerPremiumBps) : null;
  if (plan !== null && history.findLastIndex((entry) => entry.action === 'planned-revised') > settledIndex) return plan;
  return settledIndex >= 0 ? /** @type {number} */ (history[settledIndex].buyerPremiumBps) : plan;
}

// The terms a won coin is costed on: the premium rate and fee sheet its outcome states (the Outcome form's, for a coin
// won without a recorded bid or on other terms than its bid), else its bid's rate and the fee sheet saved with the lot.
/**
 * @param {Lot | null | undefined} lot
 * @returns {{ rate: number | null, estimate: import('./types.js').CostEstimate | undefined }}
 */
export function wonTerms(lot) {
  const terms = lot?.outcome?.terms;
  const rate = Number.isInteger(terms?.buyerPremiumBps) ? /** @type {number} */ (terms?.buyerPremiumBps) : bidPremiumRate(lot);
  return { rate, estimate: terms?.costEstimate ?? lot?.costEstimate };
}

/**
 * What a won coin really cost, worked out from what the collector recorded for it and nothing else: the hammer, the
 * premium at the rate its outcome states or else the rate on its bid, and the fees its outcome states or else the ones
 * saved with the lot (VAT on the premium, a platform's fee on the hammer,
 * shipping and the payment fee), all in the hammer's currency. A figure that was never recorded is not estimated: the
 * cost then keeps what could be worked out and names every gap, and it has no total. A fee sheet saved without VAT or
 * a platform fee charges none, as the calculator that saved it did. `null` only for a sum too large to hold exactly.
 * @param {Lot} lot
 * @param {Money | undefined} hammer
 * @returns {import('./types.js').WonCost | null}
 */
export function deriveWonCost(lot, hammer) {
  const hasHammer = validateMoney(hammer).ok;
  const { rate, estimate } = wonTerms(lot);
  /** @type {CostGap[]} */
  const missing = [];
  if (!hasHammer) missing.push('hammer');
  if (rate === null) missing.push('premium-rate');
  if (!estimate) missing.push('fees');
  else if (hasHammer && estimate.currency !== hammer?.currency) missing.push('fee-currency');
  if (!hasHammer || rate === null) return { missing };
  const money = /** @type {Money} */ (hammer);
  const fees = /** @type {import('./types.js').CostEstimate} */ (estimate);
  if (missing.length) {
    const premium = calculatePremium(money, rate);
    return premium.ok ? { buyerPremiumBps: rate, premium: premium.value.premium, missing } : null;
  }
  const worked = calculateBidCost(money, rate, {
    shippingMinor: fees.shippingMinor, paymentFeeBps: fees.paymentFeeBps, paymentFeeMinor: fees.paymentFeeMinor,
    premiumVatBps: fees.premiumVatBps ?? 0, platformFeeBps: fees.platformFeeBps ?? 0,
  });
  if (!worked.ok) return null;
  const cost = { buyerPremiumBps: rate };
  for (const part of COST_PARTS) cost[part] = worked.value[part];
  cost.total = worked.value.total;
  return cost;
}

/**
 * The cost a won coin is shown with: the one stored with its outcome, or for a coin won before costs were stored, the
 * same working over the same records. Anything but a won coin has none.
 * @param {Lot | null | undefined} lot
 * @returns {import('./types.js').WonCost | null}
 */
export function lotCost(lot) {
  if (lot?.outcome?.status !== 'won') return null;
  if (OWN(lot.outcome, 'cost')) return lot.outcome.cost ?? null;
  return deriveWonCost(lot, lot.outcome.hammer);
}

/**
 * The fees of a worked-out cost as one amount: VAT on the premium, platform fee, shipping and payment fee.
 * @param {import('./types.js').WonCost | null | undefined} cost
 * @returns {Money | null}
 */
export function costFees(cost) {
  if (!cost?.total) return null;
  let minor = 0;
  for (const part of COST_FEE_PARTS) minor += cost[part]?.minor ?? 0;
  return { currency: cost.total.currency, minor };
}

/**
 * The total a won coin is shown with (G-05). A complete cost shows its own. A fee sheet never saved means no fees were
 * recorded, not that the total is unknowable: with only that missing, the total shown is the hammer and premium, and
 * `partial` says so; the stored cost still names the gap, and nothing is estimated in the data. Any other gap - no
 * hammer, no premium rate, fees in another currency - leaves no total at all.
 * @param {import('./types.js').WonCost | null | undefined} cost
 * @param {Money | null | undefined} hammer
 * @returns {{ total: Money | null, partial: boolean }}
 */
export function shownCostTotal(cost, hammer) {
  if (cost?.total) return { total: cost.total, partial: false };
  const onlyFees = cost?.missing?.length === 1 && cost.missing[0] === 'fees';
  if (!onlyFees || !cost?.premium || !validateMoney(hammer).ok || hammer?.currency !== cost.premium.currency) return { total: null, partial: false };
  const minor = BigInt(/** @type {Money} */ (hammer).minor) + BigInt(cost.premium.minor);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return { total: null, partial: false };
  return { total: { currency: cost.premium.currency, minor: Number(minor) }, partial: true };
}

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
export const normalReference = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

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
// what was knocked down, what each coin really cost where every figure of that was recorded (the cost
// kept with its lot's won outcome), what was paid, and the years they were acquired in — every figure in the
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
    const lot = lots.get(entry.lotId);
    const cost = lotCost(lot);
    const shown = shownCostTotal(cost, lot?.outcome?.hammer);
    const amounts = /** @type {Array<[string, Money]>} */ ([['hammer', entry.hammer], ['cost', shown.total], ['invoice', entry.actualInvoice]]
      .filter(([, money]) => validateMoney(money).ok));
    const currencies = new Set(amounts.map(([, money]) => money.currency));
    if (!currencies.size) { unpriced.entryCount += 1; spreadYears(unpriced, year); }
    for (const currency of currencies) {
      const totals = byCurrency[currency] ??= {
        entryCount: 0, hammerCount: 0, hammerMinor: 0, costCount: 0, costMinor: 0, costNoFeesCount: 0, invoiceCount: 0, invoiceMinor: 0, firstYear: null, lastYear: null,
      };
      totals.entryCount += 1;
      spreadYears(totals, year);
    }
    for (const [kind, money] of amounts) {
      const totals = byCurrency[money.currency];
      totals[`${kind}Count`] += 1;
      totals[`${kind}Minor`] = addMinor(totals[`${kind}Minor`], money.minor);
      if (kind === 'cost' && shown.partial) totals.costNoFeesCount += 1;
    }
    const currency = amounts[0]?.[1].currency ?? null;
    const reference = String(lot?.reference ?? '').trim();
    entries.push({
      id: entry.id, lotId: entry.lotId, title: entry.title, acquisitionDate: entry.acquisitionDate,
      reference, currency, comparables: ownComparables(evidence, reference, currency), cost,
    });
  }
  /** @type {Record<string, CollectionTotals>} */
  const ordered = {};
  for (const currency of CURRENCIES) if (byCurrency[currency]) ordered[currency] = byCurrency[currency];
  return { byCurrency: ordered, unpriced, entries };
}

/**
 * Where an auction stands against now. `soon` is a timed instant within the next 48 hours, or a date-only sale day
 * from the day before through the day itself; `ended` is an instant that has passed, or a day that is over in the
 * auction's own zone. A live sale that has started (`auction-starts`) is `started` for the rest of its day: its lots
 * come up for hours afterwards, so it is not ended before its day is. `daysUntil` counts calendar days in the
 * auction's zone, and `sortMs` places a date-only day at its own midnight, among the timed instants.
 * @typedef {object} EventTiming
 * @property {'unknown' | 'upcoming' | 'soon' | 'started' | 'ended'} state
 * @property {number | null} msUntil
 * @property {number | null} daysUntil
 * @property {number | null} sortMs
 */
const SOON_MS = 48 * 60 * 60 * 1000;
const dayNumber = (localDate) => {
  const parts = dateParts(localDate);
  return parts ? Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000 : null;
};
/**
 * @param {Partial<AuctionEvent> | null | undefined} event
 * @param {string} [now]
 * @returns {EventTiming}
 */
export function eventTiming(event, now = new Date().toISOString()) {
  const nowMs = Date.parse(now);
  const eventDay = dayNumber(event?.localDate);
  if (!event || eventDay === null || !Number.isFinite(nowMs)) return { state: 'unknown', msUntil: null, daysUntil: null, sortMs: null };
  let today = null;
  try { today = dayNumber(localDateAtInstant(String(event.timeZone), nowMs)); } catch { today = null; }
  const daysUntil = today === null ? null : eventDay - today;
  const startsMs = event.precision === 'timed' ? Date.parse(String(event.startsAt)) : NaN;
  if (Number.isFinite(startsMs)) {
    const msUntil = startsMs - nowMs;
    /** @type {EventTiming['state']} */
    let state = msUntil > SOON_MS ? 'upcoming' : msUntil >= 0 ? 'soon' : 'ended';
    if (state === 'ended' && event.eventKind === 'auction-starts' && (daysUntil ?? -1) >= 0) state = 'started';
    return { state, msUntil, daysUntil, sortMs: startsMs };
  }
  const midnight = resolveZonedDateTime({ localDate: event.localDate, localTime: '00:00', timeZone: event.timeZone, disambiguation: 'reject' });
  const sortMs = midnight.ok ? Date.parse(midnight.value.startsAt) : eventDay * 86400000;
  if (daysUntil === null) return { state: 'unknown', msUntil: null, daysUntil, sortMs };
  return { state: daysUntil < 0 ? 'ended' : daysUntil <= 1 ? 'soon' : 'upcoming', msUntil: null, daysUntil, sortMs };
}

/**
 * When each of an auction's reminders goes off, by reminder id: the same instants the scheduler derives. A reminder
 * that resolves to no instant (a wall time that does not exist on that day in the auction's zone) is left out.
 * @param {AuctionEvent} event
 * @returns {Map<string, string>}
 */
export function reminderInstants(event) {
  return new Map(deriveReminderTriggers([event]).map((trigger) => [trigger.reminderId, trigger.triggerAt]));
}

/**
 * The open coins whose auction has passed with no outcome recorded: a closing or a sale day that is over, or a live
 * sale whose day is over. The workspace queues them and the popup can count them from the same reading.
 * @param {{ lots?: Lot[], auctionEvents?: AuctionEvent[] } | null | undefined} snapshot
 * @param {string} [now]
 * @returns {Lot[]}
 */
export function lotsNeedingOutcome(snapshot, now = new Date().toISOString()) {
  const events = new Map((snapshot?.auctionEvents ?? []).map((event) => [event.id, event]));
  return (snapshot?.lots ?? []).filter((lot) => (!lot?.outcome?.status || lot.outcome.status === 'open') && lot.auctionEventId
    && eventTiming(events.get(lot.auctionEventId), now).state === 'ended');
}

/**
 * One coin's own saved comparables, per currency: the rows saved under exactly its reference (spacing and case set
 * aside), through the same statistics the Search route shows, so excluded rows stay out and no row in another currency
 * is converted in. Fewer than three rows in a currency give a count without a median. Most rows first.
 * @param {Evidence[] | null | undefined} evidence
 * @param {*} reference
 * @returns {Array<{ currency: string, count: number, median: Money | null, firstYear: number | null, lastYear: number | null }>}
 */
export function lotComparables(evidence, reference) {
  const key = normalReference(reference);
  const rows = key ? indexByReference(evidence).get(key) ?? [] : [];
  const observations = rows.flatMap((row) => row.observations ?? []);
  const dates = observations.map((item) => item.auctionDate).filter((date) => typeof date === 'string').sort();
  if (!rows.length || !dates.length) return [];
  const sources = [...new Set(observations.map((item) => item.source))];
  const currencies = CURRENCIES.filter((currency) => rows.some((row) => row?.resolved?.hammer?.currency === currency));
  const found = [];
  for (const currency of currencies) {
    const stats = computeStatistics(rows, { currency, fromDate: dates[0], toDate: /** @type {string} */ (dates.at(-1)), sources });
    if (stats.validationError || !stats.count) continue;
    const included = new Set(stats.includedIds);
    const years = rows.filter((row) => included.has(row.id)).flatMap((row) => row.observations ?? [])
      .map((item) => dateParts(item.auctionDate)?.[0]).filter((year) => Number.isInteger(year));
    found.push({ currency, count: stats.count, median: stats.median, firstYear: years.length ? Math.min(...years) : null, lastYear: years.length ? Math.max(...years) : null });
  }
  return found.sort((left, right) => right.count - left.count);
}
