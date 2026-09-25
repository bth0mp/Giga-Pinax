// @ts-check
// What the workspace (workspace.js) shows, worked out from the records: its routes and detail tabs,
// the coin list, the auction queues, the comparison table, the exposure by currency and the saved
// comparables for a query.
import { calculateBidCost } from './core/money.js';
import { costFees, eventTiming, lotCost, projectExposure, shownCostTotal } from './core/projections.js';
import { sameZone, zonePlace } from './core/reminders.js';
import { moneyInputText } from './workspace-forms.js';
import { parseReference } from './lookup.js';
/**
 * @typedef {import('./core/types.js').Lot} Lot
 * @typedef {import('./core/types.js').AuctionEvent} AuctionEvent
 * @typedef {import('./core/types.js').Evidence} Evidence
 * @typedef {import('./core/types.js').Snapshot} Snapshot
 * @typedef {import('./core/types.js').ProvenanceNote} ProvenanceNote
 */
/** @typedef {{ selectedLotId: string | null, mode: 'list' | 'detail' }} Selection */

export const ROUTES = Object.freeze(['search', 'watchlist', 'auctions', 'bids', 'history']);

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

const OPEN_OUTCOME = (lot) => !lot?.outcome?.status || lot.outcome.status === 'open';
/** The collector's own time zone, as the browser reports it. */
export const viewerTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };
const VERB = { 'lot-closes': 'Closes', 'auction-starts': 'Starts', 'auction-day': 'Sale day' };
const PAST_WORD = { 'lot-closes': 'closed', 'auction-starts': 'started', 'auction-day': 'ended' };
// A format in the browser's language, or the ISO text the record holds where the language or zone cannot be used.
const formatWith = (locale, options, date, fallback) => {
  try { return new Intl.DateTimeFormat(locale, options).format(date); } catch { return fallback; }
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
  const verb = VERB[String(event.eventKind)] ?? 'Auction';
  const zone = event.timeZone && !sameZone(event.timeZone, timeZone) ? ` ${zonePlace(event.timeZone)}` : '';
  const timing = eventTiming(event, now);
  const timed = event.precision === 'timed' && Number.isFinite(Date.parse(String(event.startsAt)));
  const day = timed
    ? formatWith(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: event.timeZone }, new Date(String(event.startsAt)), event.localDate)
    : formatWith(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }, new Date(`${event.localDate}T12:00:00Z`), event.localDate);
  const time = timed ? `, ${formatWith(locale, { hour: 'numeric', minute: '2-digit', timeZone: event.timeZone }, new Date(String(event.startsAt)), event.localTime ?? '')}`
    : event.precision === 'timed' && event.localTime ? `, ${event.localTime}` : '';
  const when = `${verb} ${day}${time}${zone}`;
  if (timing.state === 'ended' || timing.state === 'started') return { when, relative: PAST_WORD[String(event.eventKind)] ?? 'past', tone: 'past' };
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
 * @param {Partial<AuctionEvent> | null | undefined} event
 * @param {{ now?: string, locale?: string, timeZone?: string }} [view]
 * @returns {string}
 */
export function auctionTimeLabel(event, view) {
  const { when, relative } = eventWhen(event, view);
  return relative ? `${when} · ${relative}` : when;
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
  const matches = ({ lot, event }) => {
    if (queue === 'all-coins') return true;
    if (queue === 'completed') return !OPEN_OUTCOME(lot);
    if (!OPEN_OUTCOME(lot)) return false;
    if (queue === 'closing-soon') return eventTiming(event, now).state === 'soon';
    if (queue === 'needs-outcome') return eventTiming(event, now).state === 'ended';
    if (queue === 'needs-research') return !String(lot.reference ?? '').trim();
    if (queue === 'planned') return Boolean(lot.plannedBid) && !lot.activeBid;
    if (queue === 'active') return Boolean(lot.activeBid);
    return true;
  };
  // A timed auction sorts at its instant and a date-only day at its own midnight, so the two interleave by time.
  const sortKey = ({ event }) => { const sortMs = eventTiming(event, now).sortMs; return sortMs === null ? [1, 0] : [0, sortMs]; };
  return entries.filter(matches).sort((left, right) => {
    const a = sortKey(left); const b = sortKey(right);
    return a[0] - b[0] || a[1] - b[1] || left.index - right.index;
  });
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
 * @param {*} lots
 * @param {string[] | null | undefined} selectedIds
 * @returns {Array<Lot & { amountLabel: string, estimateLabel: string, totalLabel: string, actualTotalLabel: string }>}
 */
export function comparisonRows(lots, selectedIds) {
  const byId = new Map((lots ?? []).map((lot) => [lot.id, lot]));
  return (selectedIds ?? []).map((id) => byId.get(id)).filter(Boolean).map((lot) => {
    const terminal = Boolean(lot.outcome?.status && lot.outcome.status !== 'open');
    const bid = terminal ? null : lot.activeBid ?? lot.plannedBid ?? null;
    const amount = terminal ? lot.outcome?.hammer ?? null : bid?.amount ?? null;
    const amountRole = terminal ? 'Final hammer' : lot.activeBid ? 'Active maximum' : lot.plannedBid ? 'Planned maximum' : 'Saved amount';
    const estimate = lot.costEstimate;
    const estimateLabel = terminal ? '' : !estimate ? 'No saved fee estimate' : !amount || estimate.currency !== amount.currency
      ? `Fee estimate unavailable for ${amount?.currency ?? 'this amount'}; recalculate`
      : [`${estimate.currency} fees: shipping ${((estimate.shippingMinor ?? 0) / 100).toFixed(2)} + fixed ${((estimate.paymentFeeMinor ?? 0) / 100).toFixed(2)} + ${((estimate.paymentFeeBps ?? 0) / 100).toFixed(2)}%`,
        estimate.premiumVatBps ? `VAT ${(estimate.premiumVatBps / 100).toFixed(2)}% on the premium` : '',
        estimate.platformFeeBps ? `platform fee ${(estimate.platformFeeBps / 100).toFixed(2)}% on the hammer` : '',
        estimate.importVatBps ? `import VAT ${(estimate.importVatBps / 100).toFixed(2)}% on hammer, premium and shipping` : ''].filter(Boolean).join(' · ');
    let totalLabel = terminal ? '' : Number.isInteger(bid?.buyerPremiumBps) ? 'Estimated total unknown; recalculate fees' : 'Estimated total unknown; buyer premium not recorded';
    if (!terminal && amount && Number.isInteger(bid?.buyerPremiumBps) && estimate?.currency === amount.currency) {
      const calculated = calculateBidCost(amount, bid.buyerPremiumBps, estimate);
      if (calculated.ok) totalLabel = `Estimated total ${calculated.value.total.currency} ${moneyInputText(calculated.value.total, 'en-US')}`;
    }
    const actualTotalLabel = terminal && lot.outcome?.actualInvoice ? `Actual invoice ${lot.outcome.actualInvoice.currency} ${moneyInputText(lot.outcome.actualInvoice, 'en-US')}` : '';
    return { ...lot, amountLabel: amount ? `${amountRole} ${amount.currency} ${moneyInputText(amount, 'en-US')}` : terminal ? 'Final hammer not recorded' : 'No saved amount', estimateLabel, totalLabel, actualTotalLabel };
  });
}

// A figure in the money line: the collector's own grouping and decimal mark, two places, no symbol - the line
// names its currency once.
function lineFigure(money, locale) {
  const whole = BigInt(money.minor) / 100n;
  const fraction = String(money.minor % 100).padStart(2, '0');
  let format;
  try { format = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch { format = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  return format.formatToParts(whole).map((part) => (part.type === 'fraction' ? fraction : part.value)).join('');
}
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
 * What a settled coin is and where it was won, as a ledger's first line (Q-12): its reference, the house, sale and lot
 * number, and the day of its auction - "RIC II Trajan 253 · Künker 341, lot 1234 · Sat 20 Sept 2026" - each part only
 * where it was recorded.
 * @param {Lot | null | undefined} lot
 * @param {Partial<AuctionEvent> | null | undefined} event
 * @param {string} [locale]
 * @returns {string}
 */
export function historyLine(lot, event, locale = 'en-US') {
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
  const rate = Number.isInteger(settled?.buyerPremiumBps) ? ` (${/** @type {number} */ (settled?.buyerPremiumBps) / 100}%)` : '';
  const hammer = lot?.outcome?.hammer ? format(lot.outcome.hammer) : '';
  if (status === 'won') return settled?.amount ? `Won on a ${format(settled.amount)} maximum${rate}` : 'Won · no bid recorded here';
  if (status === 'lost') return ['Lost', [settled?.amount ? `your bid ${format(settled.amount)}` : '', hammer ? `hammer ${hammer}` : ''].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  if (status === 'passed') return 'Passed';
  return '';
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
  const rate = Number.isInteger(lot.plannedBid.buyerPremiumBps) ? ` (${lot.plannedBid.buyerPremiumBps / 100}%)` : '';
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
  const auction = eventZone && !sameZone(eventZone, timeZone) ? ` · ${auctionDay}${time(eventZone)} ${zonePlace(eventZone)}` : '';
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
