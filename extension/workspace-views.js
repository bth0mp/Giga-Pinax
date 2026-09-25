// @ts-check
// What the workspace (workspace.js) shows, worked out from the records: its routes and detail tabs,
// the coin list, the auction queues, the comparison table, the exposure by currency and the saved
// comparables for a query.
//
// One word for one thing, on every page (H-09):
// - buyer’s premium: never "BP" or "buyer premium";
// - hammer: "Maximum hammer" where the collector sets a bid's figure, "Hammer" in an outcome and in History;
// - comparable: a sale the collector records to compare with, never "evidence" on the page;
// - auction: never "event" on the page ("Add auction", "Remove auction", "When");
// - want: a type on the want list;
// - collection: the coins the collector keeps; "Lot number shown" is the coin row's number, "Lot number" the house's.
// Money is written by formatMoney(amount, locale, { narrow: true }) (H-04), grades by their abbreviation ("VF or better").

import { calculateBidCost, formatAmount, formatMoney } from './core/money.js';
import { costFees, eventTiming, feeSheetOf, lotCost, projectExposure, shownCostTotal } from './core/projections.js';
import { sameZone, zonePlace } from './core/reminders.js';
import { parseReference } from './lookup.js';
import { wantTermsText, watchedLotsFor, wonCoinsFor } from './core/wantlist.js';
/**
 * @typedef {import('./core/types.js').Lot} Lot
 * @typedef {import('./core/types.js').AuctionEvent} AuctionEvent
 * @typedef {import('./core/types.js').Evidence} Evidence
 * @typedef {import('./core/types.js').Snapshot} Snapshot
 * @typedef {import('./core/types.js').ProvenanceNote} ProvenanceNote
 */
/** @typedef {{ selectedLotId: string | null, mode: 'list' | 'detail' }} Selection */

export const ROUTES = Object.freeze(['search', 'watchlist', 'auctions', 'bids', 'history', 'wants']);

/**
 * @param {*} hash
 * @returns {string}
 */
export function routeFromHash(hash) {
  if (typeof hash === 'string' && hash.startsWith('#event-draft=')) return 'auctions';
  if (typeof hash === 'string' && hash.startsWith('#lot-draft=')) return 'watchlist';
  const route = String(hash ?? '').replace(/^#/, '').split(/[?=]/, 1)[0];
  return ROUTES.includes(route) ? route : 'search';
}

/**
 * @param {readonly string[]} routes
 * @param {string} active
 * @param {(route: string) => HTMLElement} panelFor
 * @param {(route: string) => Element | null} linkFor
 * @returns {void}
 */
export function applyActiveRoute(routes, active, panelFor, linkFor) {
  for (const route of routes) {
    panelFor(route).hidden = route !== active;
    const link = linkFor(route);
    if (!link) continue;
    if (route === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/**
 * @param {Selection} state
 * @param {string | null} lotId
 * @param {Lot[] | null} [lots]
 * @returns {Selection}
 */
export function chooseSelectedLot(state, lotId, lots = []) {
  if (lotId === null) return { selectedLotId: null, mode: 'list' };
  if (!(lots ?? []).some((lot) => lot.id === lotId)) return state;
  return { selectedLotId: lotId, mode: 'detail' };
}

/**
 * @param {Lot[] | null | undefined} lots
 * @param {*} query
 * @returns {Lot[]}
 */
export function filterWorkspaceLots(lots, query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  if (!needle) return [...(lots ?? [])];
  return (lots ?? []).filter((lot) => [lot.title, lot.reference, lot.lotNumber]
    .some((value) => String(value ?? '').toLocaleLowerCase().includes(needle)));
}

// A zone's name and whether two names are one zone ask the browser each time; the answers never change while the page is
// open, so each is asked once (K-05).
const ZONE_ANSWERS = new Map();
const zoneAnswer = (key, work) => { if (!ZONE_ANSWERS.has(key)) { if (ZONE_ANSWERS.size >= 500) ZONE_ANSWERS.clear(); ZONE_ANSWERS.set(key, work()); } return ZONE_ANSWERS.get(key); };
const oneZone = (left, right) => (left === right ? true : zoneAnswer(`same|${left}|${right}`, () => sameZone(left, right)));
const placeOf = (zone) => zoneAnswer(`place|${zone}`, () => zonePlace(zone));

const OPEN_OUTCOME = (lot) => !lot?.outcome?.status || lot.outcome.status === 'open';
/** The collector's own time zone, as the browser reports it. */
export const viewerTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };
const VERB = { 'lot-closes': 'Closes', 'auction-starts': 'Starts', 'auction-day': 'Sale day' };
// A sale that has passed is written in the past tense once (K-07): the verb says it, so no relative word follows it,
// except a sale day, whose name has no tense.
const PAST_VERB = { 'lot-closes': 'Closed', 'auction-starts': 'Started', 'auction-day': 'Sale day' };
const PAST_WORD = { 'lot-closes': 'closed', 'auction-starts': 'started', 'auction-day': 'ended' };
// A format in the browser's language, or the ISO text the record holds where the language or zone cannot be used.
// Building a format is most of what writing a date costs, and a list of 800 coins writes thousands (K-05): each is built
// once per language and options, and kept.
const FORMATS = new Map();
const formatWith = (locale, options, date, fallback) => {
  try {
    const key = `${locale}|${JSON.stringify(options)}`;
    let format = FORMATS.get(key);
    if (!format) { if (FORMATS.size >= 500) FORMATS.clear(); format = new Intl.DateTimeFormat(locale, options); FORMATS.set(key, format); }
    return format.format(date);
  } catch { return fallback; }
};
/**
 * An auction's day and time as the collector reads it: in the browser's language, at the auction's own wall time,
 * with the auction's zone named only where it is not the collector's; and how soon, amber (`soon`) within 48 hours
 * or from the day before a sale day, muted (`past`) once it has passed.
 * @param {Partial<AuctionEvent> | null | undefined} event
 * @param {{ now?: string, locale?: string, timeZone?: string }} [view]
 * @returns {{ when: string, relative: string, tone: '' | 'soon' | 'past' }}
 */
export function eventWhen(event, { now = new Date().toISOString(), locale = 'en-US', timeZone = viewerTimeZone() } = {}) {
  if (!event?.localDate) return { when: 'Time unknown', relative: '', tone: '' };
  const timing = eventTiming(event, now);
  const past = timing.state === 'ended' || timing.state === 'started';
  const verb = (past ? PAST_VERB : VERB)[String(event.eventKind)] ?? 'Auction';
  const zone = event.timeZone && !oneZone(event.timeZone, timeZone) ? ` ${placeOf(event.timeZone)}` : '';
  const timed = event.precision === 'timed' && Number.isFinite(Date.parse(String(event.startsAt)));
  // The year is written whenever it is not this one (K-07): a 2021 sale never reads as this September's.
  const thisYear = formatWith('en-CA', { year: 'numeric', timeZone }, new Date(now), String(now).slice(0, 4));
  const year = String(event.localDate).slice(0, 4) !== thisYear ? { year: 'numeric' } : {};
  const day = timed
    ? formatWith(locale, { weekday: 'short', day: 'numeric', month: 'short', ...year, timeZone: event.timeZone }, new Date(String(event.startsAt)), event.localDate)
    : formatWith(locale, { weekday: 'short', day: 'numeric', month: 'short', ...year, timeZone: 'UTC' }, new Date(`${event.localDate}T12:00:00Z`), event.localDate);
  const time = timed ? `, ${formatWith(locale, { hour: 'numeric', minute: '2-digit', timeZone: event.timeZone }, new Date(String(event.startsAt)), event.localTime ?? '')}`
    : event.precision === 'timed' && event.localTime ? `, ${event.localTime}` : '';
  const when = `${verb} ${day}${time}${zone}`;
  if (past) return { when, relative: PAST_WORD[String(event.eventKind)] ?? 'past', tone: 'past' };
  if (timing.state === 'unknown') return { when, relative: '', tone: '' };
  const tone = timing.state === 'soon' ? 'soon' : '';
  if (timing.msUntil === null) {
    const days = /** @type {number} */ (timing.daysUntil);
    return { when, relative: days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`, tone };
  }
  const minutes = Math.floor(timing.msUntil / 60000);
  const relative = minutes < 60 ? `in ${minutes} min` : timing.msUntil <= 48 * 3600000 ? `in ${Math.floor(minutes / 60)} h` : `in ${timing.daysUntil ?? Math.round(timing.msUntil / 86400000)} days`;
  return { when, relative, tone };
}
/**
 * The month heading a long coin list puts where the auction month changes (K-06): "March 2026", or "No sale date" for a
 * coin with no auction.
 * @param {Partial<AuctionEvent> | null | undefined} event
 * @param {string} [locale]
 * @returns {string}
 */
export function monthHeading(event, locale = 'en-US') {
  if (!event?.localDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(event.localDate))) return 'No sale date';
  return formatWith(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }, new Date(`${event.localDate}T12:00:00Z`), String(event.localDate).slice(0, 7));
}

/**
 * @param {Partial<AuctionEvent> | null | undefined} event
 * @param {{ now?: string, locale?: string, timeZone?: string }} [view]
 * @returns {string}
 */
export function auctionTimeLabel(event, view) {
  const said = eventWhen(event, view);
  const relative = relativeToShow(event, said);
  return relative ? `${said.when} · ${relative}` : said.when;
}
/**
 * The relative word a line writes after eventWhen's `when`: none where the past verb already says it ("Closed Fri 8 Oct
 * 2021, 11:00"); a sale day, whose name has no tense, keeps "ended" (K-07).
 * @param {Partial<AuctionEvent> | null | undefined} event
 * @param {{ relative: string, tone: string }} said
 * @returns {string}
 */
export function relativeToShow(event, said) {
  return said.tone === 'past' && event?.eventKind !== 'auction-day' && Object.hasOwn(PAST_VERB, String(event?.eventKind)) ? '' : said.relative;
}

/**
 * The coins of one queue, soonest auction first.
 * @param {*} lots
 * @param {*} events
 * @param {string} [queue]
 * @param {string} [now]
 * @returns {Array<{ lot: Lot, event: AuctionEvent | null, index: number }>}
 */
export function auctionQueueForLots(lots, events, queue = 'all-open', now = new Date().toISOString()) {
  const eventById = new Map((events ?? []).map((event) => [event.id, event]));
  const entries = (lots ?? []).map((lot, index) => ({ lot, event: eventById.get(lot.auctionEventId) ?? null, index }));
  const matches = ({ lot, timing }) => {
    if (queue === 'all-coins') return true;
    if (queue === 'completed') return !OPEN_OUTCOME(lot);
    if (!OPEN_OUTCOME(lot)) return false;
    if (queue === 'closing-soon') return timing.state === 'soon';
    if (queue === 'needs-outcome') return timing.state === 'ended';
    if (queue === 'needs-research') return !String(lot.reference ?? '').trim();
    if (queue === 'planned') return Boolean(lot.plannedBid) && !lot.activeBid;
    if (queue === 'active') return Boolean(lot.activeBid);
    return true;
  };
  // A timed auction sorts at its instant and a date-only day at its own midnight, so the two interleave by time. Each
  // auction's timing is worked out once, however many coins it holds (K-05).
  const timings = new Map();
  const timingOf = (event) => { if (!timings.has(event)) timings.set(event, eventTiming(event, now)); return timings.get(event); };
  const keyed = entries.filter(({ lot, event }) => matches({ lot, event, timing: timingOf(event) }))
    .map((entry) => { const sortMs = timingOf(entry.event).sortMs; return { entry, rank: sortMs === null ? 1 : 0, at: sortMs ?? 0 }; });
  return keyed.sort((left, right) => left.rank - right.rank || left.at - right.at || left.entry.index - right.entry.index).map(({ entry }) => entry);
}

/**
 * The Auctions page's two lists (K-07): the sales still to come or under way, soonest first (one with no date last), and
 * those that have passed, newest first.
 * @param {*} events
 * @param {string} [now]
 * @returns {{ upcoming: AuctionEvent[], past: AuctionEvent[] }}
 */
export function splitAuctions(events, now = new Date().toISOString()) {
  const timed = (events ?? []).map((event, index) => ({ event, index, timing: eventTiming(event, now) }));
  const at = ({ timing }) => (timing.sortMs === null ? Number.POSITIVE_INFINITY : timing.sortMs);
  const upcoming = timed.filter(({ timing }) => timing.state !== 'ended').sort((left, right) => at(left) - at(right) || left.index - right.index);
  const past = timed.filter(({ timing }) => timing.state === 'ended').sort((left, right) => at(right) - at(left) || left.index - right.index);
  return { upcoming: upcoming.map(({ event }) => event), past: past.map(({ event }) => event) };
}

/**
 * @param {string[] | null | undefined} selectedIds
 * @param {string} lotId
 * @returns {string[]}
 */
export function comparisonSelectionAfterToggle(selectedIds, lotId) {
  const selected = [...new Set(selectedIds ?? [])];
  if (selected.includes(lotId)) return selected.filter((id) => id !== lotId);
  return selected.length >= 4 ? selected : [...selected, lotId];
}

/**
 * @param {*} lot
 * @returns {string}
 */
export function comparisonPickerLabel(lot) {
  const parts = [String(lot?.title ?? '').trim() || 'Untitled coin'];
  const reference = String(lot?.reference ?? '').trim(); if (reference && reference !== parts[0]) parts.push(reference);
  const context = lot?.auctionContext ?? {};
  const identity = [context.house, context.saleId ? `sale ${context.saleId}` : '', context.lotNumber ? `lot ${context.lotNumber}` : ''].filter(Boolean).join(' ');
  if (identity) parts.push(identity); else if (lot?.lotNumber) parts.push(`lot ${lot.lotNumber}`);
  return parts.join(' · ');
}

/**
 * @param {ProvenanceNote[] | null | undefined} notes
 * @returns {Array<{ id: string, text: string, sourceUrl: string, dateLabel: string }>}
 */
export function comparisonProvenanceRows(notes) {
  return (notes ?? []).map((note) => ({
    id: note.id, text: note.text, sourceUrl: note.sourceUrl,
    dateLabel: `${note.auctionDate ? `Auction date ${note.auctionDate} · ` : ''}Recorded ${String(note.recordedAt).slice(0, 10)}`,
  }));
}

/**
 * The Compare dialog's figures for each chosen coin, every amount written by the one money rule (V-10): the hammer or the
 * bid in force, the fee sheet saved with a bid and the total it works out to, and for a settled coin the invoice and the
 * total cost worked out with its outcome, as History shows it.
 * @param {*} lots
 * @param {string[] | null | undefined} selectedIds
 * @param {string} [locale]
 * @returns {Array<Lot & { amountLabel: string, estimateLabel: string, totalLabel: string, actualTotalLabel: string, costLabel: string }>}
 */
export function comparisonRows(lots, selectedIds, locale = 'en-US') {
  const byId = new Map((lots ?? []).map((lot) => [lot.id, lot]));
  const money = (amount) => formatMoney(amount, locale, { narrow: true });
  return (selectedIds ?? []).map((id) => byId.get(id)).filter(Boolean).map((lot) => {
    const terminal = Boolean(lot.outcome?.status && lot.outcome.status !== 'open');
    const bid = terminal ? null : lot.activeBid ?? lot.plannedBid ?? null;
    const amount = terminal ? lot.outcome?.hammer ?? null : bid?.amount ?? null;
    const amountRole = terminal ? 'Final hammer' : lot.activeBid ? 'Active maximum' : lot.plannedBid ? 'Planned maximum' : 'Saved amount';
    const estimate = feeSheetOf(lot.costEstimate);
    const inEstimate = (minor) => money({ currency: /** @type {string} */ (estimate?.currency), minor: minor ?? 0 });
    const estimateLabel = terminal ? '' : !estimate ? 'No saved fee estimate' : !amount || estimate.currency !== amount.currency
      ? `Fee estimate unavailable for ${amount?.currency ?? 'this amount'}; recalculate`
      : [`Fees: shipping ${inEstimate(estimate.shippingMinor)} + fixed ${inEstimate(estimate.paymentFeeMinor)} + ${((estimate.paymentFeeBps ?? 0) / 100).toFixed(2)}%`,
        estimate.premiumVatBps ? `VAT ${(estimate.premiumVatBps / 100).toFixed(2)}% on the premium` : '',
        estimate.platformFeeBps ? `platform fee ${(estimate.platformFeeBps / 100).toFixed(2)}% on the hammer` : '',
        estimate.importVatBps ? `import VAT ${(estimate.importVatBps / 100).toFixed(2)}% on hammer, premium and shipping` : ''].filter(Boolean).join(' · ');
    let totalLabel = terminal ? '' : Number.isInteger(bid?.buyerPremiumBps) ? 'Estimated total unknown; recalculate fees' : 'Estimated total unknown; buyer’s premium not recorded';
    if (!terminal && amount && Number.isInteger(bid?.buyerPremiumBps) && estimate?.currency === amount.currency) {
      const calculated = calculateBidCost(amount, bid.buyerPremiumBps, estimate);
      if (calculated.ok) totalLabel = `Estimated total ${money(calculated.value.total)}`;
    }
    const actualTotalLabel = terminal && lot.outcome?.actualInvoice ? `Actual invoice ${money(lot.outcome.actualInvoice)}` : '';
    // A won coin's total is the one History shows: hammer, premium and fees, or hammer and premium where no fees were recorded.
    const shown = lot.outcome?.status === 'won' ? shownCostTotal(lotCost(lot), lot.outcome.hammer) : { total: null, partial: false };
    const costLabel = shown.total ? `Total cost ${money(shown.total)}${shown.partial ? ' (hammer + premium)' : ''}` : '';
    return { ...lot, amountLabel: amount ? `${amountRole} ${money(amount)}` : terminal ? 'Final hammer not recorded' : 'No saved amount', estimateLabel, totalLabel, actualTotalLabel, costLabel };
  });
}

// A figure in the money line: the collector's own grouping and decimal mark, the currency's own places, no symbol -
// the line names its currency once.
const lineFigure = (money, locale) => formatAmount(money, locale);
// The gaps that leave a won coin with no total, in words; fees never recorded are not one of them (G-05).
const COST_GAP_WORDS = Object.freeze({
  hammer: 'no hammer recorded',
  'premium-rate': 'no buyer’s premium rate',
  'fee-currency': 'its fees were saved in another currency, and are never converted',
});
const FEE_WORDS = Object.freeze([['premiumVat', 'VAT on premium'], ['platformFee', 'platform fee'], ['importVat', 'import VAT'], ['shipping', 'shipping'], ['paymentFee', 'payment fee']]);

/**
 * A won coin's money line, as its History card and its collection entry show it: Hammer · Premium · Fees · Total in
 * the hammer's currency, named once. The cost is the one kept with the outcome (or, for a coin won before costs were
 * kept, the same working from its records). With no fees recorded the total is the hammer and premium, said so, and
 * the line offers to add them; a total that cannot be worked out at all reads "Incomplete" in the warning tone, and the
 * note says which figure was never recorded. `fix` is the one field that would complete the line - on the coin's
 * Outcome tab - and the words for the link to it. The detail line gives the premium rate and each fee that is not zero.
 * @param {Lot | null | undefined} lot
 * @param {string} [locale]
 * @returns {{ currency: string, cells: Array<{ label: string, figure: string, hint?: string }>, detail: string, note: string,
 *   tone: '' | 'warning', fix: { field: 'hammer' | 'premium' | 'fees', label: string } | null } | null}
 */
export function wonCostLine(lot, locale = 'en-US') {
  if (lot?.outcome?.status !== 'won') return null;
  const cost = lotCost(lot);
  const hammer = lot.outcome.hammer;
  const figure = (money) => (money ? lineFigure(money, locale) : '—');
  const fees = costFees(cost);
  const missing = cost?.missing ?? [];
  const shown = shownCostTotal(cost, hammer);
  const currency = hammer?.currency ?? cost?.premium?.currency ?? '';
  const totalCell = shown.total
    ? { label: 'Total', figure: figure(shown.total), ...(shown.partial ? { hint: 'hammer + premium' } : {}) }
    : { label: 'Total', figure: 'Incomplete' };
  const cells = [
    { label: 'Hammer', figure: figure(hammer) }, { label: 'Premium', figure: figure(cost?.premium) },
    { label: 'Fees', figure: fees ? figure(fees) : missing.includes('fees') ? 'not recorded' : '—' }, totalCell,
  ];
  const rate = Number.isInteger(cost?.buyerPremiumBps) ? `Premium ${Number(/** @type {number} */ (cost?.buyerPremiumBps) / 100)}%` : '';
  const detail = cost?.total
    ? [rate, ...FEE_WORDS.filter(([key]) => cost[key]?.minor > 0).map(([key, words]) => `${words} ${figure(cost[key])}`)].filter(Boolean).join(' · ')
    : shown.partial ? [rate, 'fees not recorded'].filter(Boolean).join(' · ') : '';
  const gaps = missing.filter((gap) => COST_GAP_WORDS[gap]).map((gap) => COST_GAP_WORDS[gap]).join('; ');
  const note = shown.total ? '' : cost ? `Total incomplete: ${gaps || 'no fees recorded'}.` : 'Total not worked out: the amounts are too large to add exactly.';
  /** @type {{ field: 'hammer' | 'premium' | 'fees', label: string } | null} */
  let fix = null;
  if (missing.includes('hammer')) fix = { field: 'hammer', label: 'Add the hammer' };
  else if (missing.includes('premium-rate')) fix = { field: 'premium', label: 'Add the premium rate' };
  else if (missing.includes('fee-currency')) fix = { field: 'fees', label: `Enter the fees in ${currency}` };
  else if (missing.includes('fees')) fix = { field: 'fees', label: 'Add fees' };
  return { currency, cells, detail, note, tone: shown.total ? '' : 'warning', fix };
}

/**
 * @param {Lot | null | undefined} lot
 * @returns {string}
 */
export function lotStatusLabel(lot) {
  const status = lot?.outcome?.status;
  if (status && status !== 'open') return ({ won: 'Won', lost: 'Lost', passed: 'Passed' })[status] ?? 'Closed';
  if (lot?.activeBid) return 'Bid active';
  if (lot?.plannedBid) return 'Bid planned';
  return 'Watching';
}

/**
 * The status pill's colour, one per state: grey watching, plum outline planned, plum fill active, and the three
 * outcomes.
 * @param {Lot | null | undefined} lot
 * @returns {'watching' | 'planned' | 'active' | 'won' | 'lost' | 'passed'}
 */
export function lotStatusTone(lot) {
  const status = lot?.outcome?.status;
  if (status === 'won' || status === 'lost' || status === 'passed') return status;
  return lot?.activeBid ? 'active' : lot?.plannedBid ? 'planned' : 'watching';
}

/**
 * The one amount a coin row shows beside its title: the final hammer of a settled coin, else the bid in force.
 * @param {Lot | null | undefined} lot
 * @returns {import('./core/types.js').Money | null}
 */
export function lotRowAmount(lot) {
  if (lot?.outcome?.status && lot.outcome.status !== 'open') return lot.outcome.hammer ?? null;
  return lot?.activeBid?.amount ?? lot?.plannedBid?.amount ?? null;
}

/**
 * Whether two written references name the same catalogue entry: both read by the lookup's own rules, and every part of
 * the reading - catalogue, volume, section, number - the same, so "RIC I (second edition) Nero 306" and "RIC I² Nero 306"
 * agree while "RIC I² Nero 306a" does not. Text either reading cannot parse matches nothing.
 * @param {*} left
 * @param {*} right
 * @returns {boolean}
 */
export function sameReference(left, right) {
  const read = (text) => { try { return parseReference(String(text ?? '')); } catch { return null; } };
  const one = read(left); const other = read(right);
  if (!one || !other) return false;
  return ['catalogue', 'volume', 'section', 'number'].every((key) => String(one[key] ?? '') === String(other[key] ?? ''));
}

/**
 * The Want list page's rows (G-22): the wants still wanted first, then the found ones, each in the order it was added,
 * with what it asks beyond its type, the coin that found it (null when that coin is no longer saved here) and where that
 * coin's outcome now stands - an outcome corrected away from won means the want is due again - and the won
 * coins of its type it could be marked found by; and, for a want still wanted, the open coins of its type on the watchlist (H-08).
 * @param {Partial<Snapshot> | null | undefined} snapshot
 * @param {string} [locale]
 * @returns {Array<{ want: import('./core/types.js').Want, terms: string, found: Lot | null, foundStatus: string | null, wonCoins: Lot[], watched: Lot[] }>}
 */
export function wantListRows(snapshot, locale = 'en-US') {
  const lots = snapshot?.lots ?? [];
  const rows = (snapshot?.wants ?? []).map((want) => ({
    want,
    terms: wantTermsText(want, locale),
    found: want.foundLotId ? lots.find(({ id }) => id === want.foundLotId) ?? null : null,
    foundStatus: want.foundLotId ? lots.find(({ id }) => id === want.foundLotId)?.outcome?.status ?? null : null,
    wonCoins: want.foundLotId ? [] : wonCoinsFor(want, lots),
    watched: want.foundLotId ? [] : watchedLotsFor(want, lots),
  }));
  return [...rows.filter(({ want }) => !want.foundLotId), ...rows.filter(({ want }) => want.foundLotId)];
}

/**
 * What a settled coin is and where it was won, as a ledger's first line (Q-12): its reference, the house, sale and lot
 * number, and the day of its auction - "RIC II Trajan 253 · Künker 341, lot 1234 · Sat 20 Sept 2026" - each part only
 * where it was recorded.
 * @param {Lot | null | undefined} lot
 * @param {Partial<AuctionEvent> | null | undefined} event
 * @param {string} [locale]
 * @returns {string}
 */
export function historyLine(lot, event, locale = 'en-US') {
  /** @type {Record<string, *>} */
  const context = lot?.auctionContext ?? {};
  const sale = [context.house, context.saleId].filter(Boolean).join(' ');
  const lotNumber = context.lotNumber ?? lot?.lotNumber;
  const where = [sale, lotNumber ? `lot ${lotNumber}` : ''].filter(Boolean).join(', ');
  const day = event?.localDate ? formatWith(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }, new Date(`${event.localDate}T12:00:00Z`), event.localDate) : '';
  return [String(lot?.reference ?? '').trim(), where, day].filter(Boolean).join(' · ');
}

/**
 * The bid that decided a settled coin, in place of a count of bid changes (Q-12): "Won on a €6,500.00 maximum (25%)",
 * "Lost · your bid €500.00, hammer €650.00", "Passed". The bid is the last one settled with the outcome.
 * @param {Lot | null | undefined} lot
 * @param {(money: import('./core/types.js').Money) => string} format
 * @returns {string}
 */
export function decidingBidLine(lot, format) {
  const status = lot?.outcome?.status;
  const settled = (lot?.bidHistory ?? []).findLast((entry) => entry.action === 'settled-won' || entry.action === 'settled-lost');
  // A coin never placed here may still have been planned: the plan is named as a plan, never as a bid.
  const plan = settled ? null : lot?.plannedBid;
  const terms = settled ?? plan;
  const rate = Number.isInteger(terms?.buyerPremiumBps) ? ` (${/** @type {number} */ (terms?.buyerPremiumBps) / 100}%)` : '';
  const hammer = lot?.outcome?.hammer ? format(lot.outcome.hammer) : '';
  if (status === 'won') return settled?.amount ? `Won on a ${format(settled.amount)} maximum${rate}` : plan?.amount ? `Won · your plan was ${format(plan.amount)}${rate}` : 'Won · no bid recorded here';
  if (status === 'lost') return ['Lost', [settled?.amount ? `your bid ${format(settled.amount)}` : plan?.amount ? `your plan ${format(plan.amount)}` : '', hammer ? `hammer ${hammer}` : ''].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  if (status === 'passed') return 'Passed';
  return '';
}

/**
 * The year a settled coin belongs to on the History page (K-08): its auction's, else the year its outcome was recorded.
 * @param {Lot | null | undefined} lot
 * @param {Partial<AuctionEvent> | null | undefined} event
 * @returns {string}
 */
export function settledYear(lot, event) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(event?.localDate ?? '')) ? String(event?.localDate)
    : String(lot?.outcomeHistory?.at(-1)?.recordedAt ?? lot?.updatedAt ?? '');
  return /^\d{4}/.test(day) ? day.slice(0, 4) : '';
}

/**
 * The settled coins the History page shows (K-08): those whose outcome is ticked, of the chosen year, and whose title,
 * reference, house or lot number holds the typed text, spacing and case aside.
 * @param {Lot[]} lots settled coins, in the order shown
 * @param {Map<string, AuctionEvent>} eventsById
 * @param {{ text?: string, year?: string, outcomes?: string[] }} filter
 * @returns {Lot[]}
 */
export function filterSettledLots(lots, eventsById, { text = '', year = '', outcomes = ['won', 'lost', 'passed'] } = {}) {
  const needle = String(text).trim().toLocaleLowerCase();
  return (lots ?? []).filter((lot) => {
    if (!outcomes.includes(String(lot?.outcome?.status))) return false;
    const event = eventsById.get(String(lot.auctionEventId));
    if (year && settledYear(lot, event) !== year) return false;
    if (!needle) return true;
    /** @type {Record<string, *>} */
    const context = lot.auctionContext ?? {};
    return [lot.title, lot.reference, lot.lotNumber, context.house, context.saleId, context.lotNumber, event?.name]
      .some((value) => String(value ?? '').toLocaleLowerCase().includes(needle));
  });
}

/**
 * The settled coins newest first: by when their outcome was last recorded, else when they were last written.
 * @param {Lot[] | null | undefined} lots
 * @returns {Lot[]}
 */
export function settledNewestFirst(lots) {
  const at = (lot) => String(lot.outcomeHistory?.at(-1)?.recordedAt ?? lot.updatedAt ?? '');
  return (lots ?? []).filter((lot) => lot?.outcome?.status && lot.outcome.status !== 'open').sort((left, right) => at(right).localeCompare(at(left)));
}

/**
 * The amount a coin row shows, in words where one figure would hide a record: a plan saved beside the bid in force is
 * named after it ("Placed £1,300.00 · plan £1,500.00", Q-10); otherwise the one amount lotRowAmount gives.
 * @param {Lot | null | undefined} lot
 * @param {(money: import('./core/types.js').Money) => string} format
 * @returns {string}
 */
export function lotRowAmountLabel(lot, format) {
  const amount = lotRowAmount(lot);
  if (!amount) return '';
  const open = !lot?.outcome?.status || lot.outcome.status === 'open';
  if (open && lot?.activeBid && lot.plannedBid) return `Placed ${format(lot.activeBid.amount)} · plan ${format(lot.plannedBid.amount)}`;
  return format(amount);
}

/**
 * The plan saved beside the bid in force, which the Bid tab shows the placed terms of (Q-10): "Plan to raise to
 * €1,500.00 (20%)". Empty when there is no such plan.
 * @param {Lot | null | undefined} lot
 * @param {(money: import('./core/types.js').Money) => string} format
 * @returns {string}
 */
export function raisePlanLine(lot, format) {
  if (!lot?.activeBid || !lot.plannedBid || (lot.outcome?.status && lot.outcome.status !== 'open')) return '';
  const bps = lot.plannedBid.buyerPremiumBps;
  const rate = Number.isInteger(bps) ? ` (${/** @type {number} */ (bps) / 100}%)` : '';
  return `Plan to raise to ${format(lot.plannedBid.amount)}${rate}`;
}

/**
 * When a reminder goes off, in the collector's own time - `Tomorrow 08:00 (your time)` - and, when the auction is in
 * another zone, at the auction's wall time too, named by its place: ` · 14:00 Zurich`, with the auction's day where it is
 * not the collector's. Amber within the next 24 hours, muted once it has passed, when the auction's time stays named.
 * @param {string} instant
 * @param {string} eventZone
 * @param {{ now?: string, locale?: string, timeZone?: string }} [view]
 * @returns {{ text: string, tone: '' | 'soon' | 'past' }}
 */
export function reminderAtLabel(instant, eventZone, { now = new Date().toISOString(), locale = 'en-US', timeZone = viewerTimeZone() } = {}) {
  const at = new Date(instant);
  const dayOf = (date, zone = timeZone) => formatWith('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }, date, '');
  const days = (Date.parse(dayOf(at)) - Date.parse(dayOf(new Date(now)))) / 86400000;
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday'
    : formatWith(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone }, at, instant.slice(0, 10));
  const time = (zone) => formatWith(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }, at, instant.slice(11, 16));
  // The auction's clock is named by its place, with its own day where that is not the collector's (M3, N14).
  const auctionDay = eventZone && dayOf(at, eventZone) !== dayOf(at)
    ? `${formatWith(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: eventZone }, at, '')} ` : '';
  const auction = eventZone && !oneZone(eventZone, timeZone) ? ` · ${auctionDay}${time(eventZone)} ${placeOf(eventZone)}` : '';
  const untilMs = at.getTime() - Date.parse(now);
  if (untilMs < 0) return { text: `${day} ${time(timeZone)} (your time)${auction} · passed`, tone: 'past' };
  return { text: `${day} ${time(timeZone)} (your time)${auction}`, tone: untilMs < 86400000 ? 'soon' : '' };
}

/**
 * A reminder as the collector set it, in words: `1 day before`, `90 minutes before`, `Previous day at 09:00`.
 * @param {Record<string, *> | null | undefined} reminder
 * @returns {string}
 */
export function reminderLabel(reminder) {
  if (reminder?.kind === 'offset') {
    const minutes = Number(reminder.offsetMinutes);
    const [count, unit] = minutes % 1440 === 0 ? [minutes / 1440, 'day'] : minutes % 60 === 0 ? [minutes / 60, 'hour'] : [minutes, 'minute'];
    return `${count} ${unit}${count === 1 ? '' : 's'} before`;
  }
  const days = Number(reminder?.daysBefore ?? 0);
  return `${days === 0 ? 'Auction day' : days === 1 ? 'Previous day' : `${days} days before`} at ${reminder?.localTime ?? ''}`;
}

export const DETAIL_TABS = Object.freeze(['details', 'bid', 'reminders', 'outcome']);

/**
 * The tab a coin opens on, the one its state calls for (G-20): Outcome when its sale ended with no outcome recorded,
 * Bid when it closes within 48 hours with no bid planned or placed, else the tab the collector last chose this session,
 * else Details.
 * @param {Lot | null | undefined} lot
 * @param {Partial<AuctionEvent> | null | undefined} event
 * @param {string | null} [remembered]
 * @param {string} [now]
 * @returns {string}
 */
export function openingTab(lot, event, remembered = null, now = new Date().toISOString()) {
  const open = !lot?.outcome?.status || lot.outcome.status === 'open';
  const state = eventTiming(event, now).state;
  if (open && event && state === 'ended') return 'outcome';
  if (open && state === 'soon' && !lot?.activeBid && !lot?.plannedBid) return 'bid';
  return remembered && DETAIL_TABS.includes(remembered) ? remembered : 'details';
}
/**
 * @param {string} active
 * @param {string} key
 * @returns {string}
 */
export function moveDetailTab(active, key) {
  const index = Math.max(0, DETAIL_TABS.indexOf(active));
  if (key === 'Home') return DETAIL_TABS[0];
  if (key === 'End') return /** @type {string} */ (DETAIL_TABS.at(-1));
  if (key === 'ArrowRight') return DETAIL_TABS[(index + 1) % DETAIL_TABS.length];
  if (key === 'ArrowLeft') return DETAIL_TABS[(index - 1 + DETAIL_TABS.length) % DETAIL_TABS.length];
  return active;
}

/**
 * @param {Partial<Snapshot> | null | undefined} snapshot
 * @returns {Array<import('./core/projections.js').CurrencyExposure & { currency: string,
 *   events: Array<import('./core/projections.js').ExposureTotals & { eventId: string, name: string }> }>}
 */
export function buildExposureSections(snapshot) {
  const exposure = projectExposure({ lots: snapshot?.lots ?? [] });
  const eventNames = new Map((snapshot?.auctionEvents ?? []).map((event) => [event.id, event.name]));
  return Object.entries(exposure).map(([currency, totals]) => ({
    currency,
    ...totals,
    events: Object.entries(totals.byEvent).map(([eventId, eventTotals]) => ({
      eventId,
      name: eventId === 'unassigned' ? 'Unassigned lots' : eventNames.get(eventId) ?? 'Unknown auction',
      ...eventTotals,
    })),
  }));
}

/**
 * @param {Evidence[] | null | undefined} rows
 * @param {string | null | undefined} queryId
 * @returns {Evidence[]}
 */
export function evidenceRowsForQuery(rows, queryId) {
  if (!queryId) return [];
  return (rows ?? []).filter((row) => row.observations?.some((observation) => observation.queryId === queryId));
}

// Why a saved comparable was left out of the figures, in the collector's words.
const LEFT_OUT = {
  currency: 'in another currency', date: 'outside the dates', 'source-filter': 'from a source not ticked', estimate: 'an estimate, not a hammer',
  unsold: 'unsold', 'missing-price': 'with no price', conflict: 'with records that disagree', 'not-comparable': 'not a hammer price', 'invalid-evidence': 'unreadable',
};
/**
 * What a set of saved comparables adds up to, in plain words: how many count, their median and middle half once there
 * are three, and the years they span; then what was left out and why. With nothing saved, one sentence says so.
 * @param {Evidence[]} rows the set's saved rows
 * @param {*} stats what computeStatistics answered for them
 * @param {(money: import('./core/types.js').Money) => string} format
 * @returns {{ headline: string, leftOut: string }}
 */
export function comparableSummary(rows, stats, format) {
  if (!rows.length) return { headline: 'No saved comparables yet. Add a sale you found under Add a comparable manually.', leftOut: '' };
  const parts = Object.entries(stats.coverage?.exclusionCounts ?? {}).map(([reason, count]) => `${count} ${LEFT_OUT[reason] ?? reason}`);
  const leftOut = parts.length ? `Left out: ${parts.join(', ')}.` : '';
  if (!stats.count) return { headline: `None of the ${rows.length} saved comparable${rows.length === 1 ? '' : 's'} in this set counts with these filters.`, leftOut };
  const included = new Set(stats.includedIds);
  const years = rows.filter((row) => included.has(row.id)).flatMap((row) => row.observations ?? [])
    .map((item) => Number(String(item.auctionDate).slice(0, 4))).filter(Number.isFinite);
  const span = !years.length ? '' : Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`;
  const figures = stats.median && stats.lowerQuartile && stats.upperQuartile
    ? [`median ${format(stats.median)}`, `middle half ${format(stats.lowerQuartile)}–${format(stats.upperQuartile)}`] : ['a median needs 3'];
  return { headline: [`${stats.count} comparable${stats.count === 1 ? '' : 's'}`, ...figures, span].filter(Boolean).join(' · '), leftOut };
}

/**
 * The comparable sets the Search route offers, each named by its reference with how many rows it holds; a set whose
 * reference repeats another's is numbered.
 * @param {Evidence[] | null | undefined} evidence
 * @param {{ id: string, text: string }} active the set the query box stands for
 * @returns {Array<{ id: string, label: string }>}
 */
export function comparableSetOptions(evidence, active) {
  const counts = new Map(); const labels = new Map();
  for (const row of evidence ?? []) {
    for (const id of new Set((row.observations ?? []).map((item) => item.queryId).filter(Boolean))) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const item of row.observations ?? []) if (item.queryLabel && item.queryId) labels.set(item.queryId, item.queryLabel);
  }
  const ids = [...counts.keys()];
  if (!ids.includes(active.id)) ids.unshift(active.id);
  const seen = new Map();
  return ids.map((id) => {
    const name = labels.get(id) ?? (id === active.id ? active.text : '');
    const count = counts.get(id) ?? 0;
    if (!name) return { id, label: id === active.id && !count ? 'New comparable set' : `Unnamed set (${count})` };
    const repeat = (seen.get(name) ?? 0) + 1; seen.set(name, repeat);
    return { id, label: `${name}${repeat > 1 ? ` · set ${repeat}` : ''}${count ? ` (${count})` : ''}` };
  });
}
