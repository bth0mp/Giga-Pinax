// @ts-check
// What the workspace (workspace.js) shows, worked out from the records: its routes and detail tabs,
// the coin list, the auction queues, the comparison table, the exposure by currency and the saved
// comparables for a query.
import { calculateBidCost } from './core/money.js';
import { eventTiming, projectExposure } from './core/projections.js';
import { moneyInputText } from './workspace-forms.js';
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
  const zone = event.timeZone && event.timeZone !== timeZone ? ` ${event.timeZone}` : '';
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
        estimate.platformFeeBps ? `platform fee ${(estimate.platformFeeBps / 100).toFixed(2)}% on the hammer` : ''].filter(Boolean).join(' · ');
    let totalLabel = terminal ? '' : Number.isInteger(bid?.buyerPremiumBps) ? 'Estimated total unknown; recalculate fees' : 'Estimated total unknown; buyer premium not recorded';
    if (!terminal && amount && Number.isInteger(bid?.buyerPremiumBps) && estimate?.currency === amount.currency) {
      const calculated = calculateBidCost(amount, bid.buyerPremiumBps, estimate);
      if (calculated.ok) totalLabel = `Estimated total ${calculated.value.total.currency} ${moneyInputText(calculated.value.total, 'en-US')}`;
    }
    const actualTotalLabel = terminal && lot.outcome?.actualInvoice ? `Actual invoice ${lot.outcome.actualInvoice.currency} ${moneyInputText(lot.outcome.actualInvoice, 'en-US')}` : '';
    return { ...lot, amountLabel: amount ? `${amountRole} ${amount.currency} ${moneyInputText(amount, 'en-US')}` : terminal ? 'Final hammer not recorded' : 'No saved amount', estimateLabel, totalLabel, actualTotalLabel };
  });
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
 * When a reminder goes off, in the collector's own time - `Tomorrow 08:00 (your time)` - and, when the auction is in
 * another zone, at the auction's wall time too: ` · 14:00 Europe/Zurich`. Amber within the next 24 hours, muted once
 * it has passed.
 * @param {string} instant
 * @param {string} eventZone
 * @param {{ now?: string, locale?: string, timeZone?: string }} [view]
 * @returns {{ text: string, tone: '' | 'soon' | 'past' }}
 */
export function reminderAtLabel(instant, eventZone, { now = new Date().toISOString(), locale = 'en-US', timeZone = viewerTimeZone() } = {}) {
  const at = new Date(instant);
  const dayOf = (date) => formatWith('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }, date, '');
  const days = (Date.parse(dayOf(at)) - Date.parse(dayOf(new Date(now)))) / 86400000;
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday'
    : formatWith(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone }, at, instant.slice(0, 10));
  const time = (zone) => formatWith(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }, at, instant.slice(11, 16));
  const auction = eventZone && eventZone !== timeZone ? ` · ${time(eventZone)} ${eventZone}` : '';
  const untilMs = at.getTime() - Date.parse(now);
  if (untilMs < 0) return { text: `${day} ${time(timeZone)} (your time) · passed`, tone: 'past' };
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
