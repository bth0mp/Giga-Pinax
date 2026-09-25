// @ts-check
// The collector's records as spreadsheet tables: one CSV text per table, one row per record.
//
// Every field is quoted (RFC 4180) and every record ends in CRLF, so a comma, a quote or a line break in a note
// survives. A title copied from an auction page is untrusted, and a spreadsheet runs a cell that opens with `=`, `+`,
// `-` or `@` (after any leading whitespace, and in full width too) as a formula, so such a cell is written with a leading
// apostrophe: the spreadsheet shows the text and runs nothing. Money is a plain decimal with a `.` and its currency in
// a column of its own - never formatted for a locale, and never added up across records, because the records hold
// four currencies and no rate between them. The one total written is a won coin's own cost (hammer, premium, fees),
// which the store worked out in its hammer's currency; where a figure was never recorded it is blank, and the
// `total_cost_missing` column names what is missing. Dates and instants are written as the ISO text the records keep. Each file opens with a
// byte order mark, which is what makes Excel read the file as UTF-8 rather than mangle an accented title.

import { FRACTION_DIGITS as MINOR_DIGITS } from './money.js';
import { costFees, costTotal, lotCost } from './projections.js';
/**
 * @typedef {import('./types.js').Money} Money
 * @typedef {import('./types.js').Snapshot} Snapshot
 */

const BOM = '\uFEFF';
// A tab or carriage return first, or a sign after any leading whitespace (a space, a no-break space, a stray byte order
// mark, a line break) - the ASCII signs and their full-width forms, which a spreadsheet may fold to the ASCII ones.
const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/;

/**
 * @param {*} value
 * @returns {string}
 */
export function csvCell(value) {
  let text = value === undefined || value === null ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

// Minor units as a decimal: 25050 GBP is "250.50". Anything that is not a whole non-negative amount writes nothing,
// since a figure in a spreadsheet is worse than a gap if it is not the one saved.
/**
 * @param {*} money
 * @returns {string}
 */
export function decimalAmount(money) {
  const minor = money?.minor;
  if (!Number.isSafeInteger(minor) || minor < 0) return '';
  const digits = String(minor).padStart(MINOR_DIGITS + 1, '0');
  return `${digits.slice(0, -MINOR_DIGITS)}.${digits.slice(-MINOR_DIGITS)}`;
}

const currencyOf = (money) => (decimalAmount(money) ? money.currency ?? '' : '');
// Basis points as the percent the collector typed: 2250 is "22.50".
const percentOf = (bps) => (Number.isSafeInteger(bps) && bps >= 0 ? decimalAmount({ minor: bps }) : '');

// The workspace's own words for where a lot stands, so the column reads as the watchlist does.
function lotStatus(lot) {
  const status = lot?.outcome?.status;
  if (status && status !== 'open') return ({ won: 'Won', lost: 'Lost', passed: 'Passed' })[status] ?? 'Closed';
  if (lot?.activeBid) return 'Bid active';
  if (lot?.plannedBid) return 'Bid planned';
  return 'Watching';
}

function csvText(columns, records) {
  const lines = [columns.map(([name]) => csvCell(name)).join(',')];
  for (const record of records) lines.push(columns.map(([, read]) => csvCell(read(record))).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

// A won coin's worked-out cost, read from its lot: the total and its currency when every figure was recorded,
// else what was missing, by the names the store keeps them under.
/** @type {Array<[string, (lot: *) => string]>} */
const COST_COLUMNS = [
  ['total_cost', (lot) => decimalAmount(costTotal(lotCost(lot)))],
  ['total_cost_currency', (lot) => currencyOf(costTotal(lotCost(lot)))],
  ['total_cost_missing', (lot) => (Array.isArray(lotCost(lot)?.missing) ? lotCost(lot)?.missing?.join(' ') : '')],
];

const LOT_COLUMNS = [
  ['lot_id', ({ lot }) => lot.id],
  ['title', ({ lot }) => lot.title],
  ['reference', ({ lot }) => lot.reference],
  ['auction_house', ({ lot }) => lot.auctionContext?.house],
  ['sale', ({ lot }) => lot.auctionContext?.saleId],
  ['lot_number', ({ lot }) => lot.auctionContext?.lotNumber ?? lot.lotNumber],
  ['auction', ({ event }) => event?.name],
  ['event_date', ({ event }) => event?.localDate],
  ['event_time', ({ event }) => event?.localTime],
  ['event_time_zone', ({ event }) => event?.timeZone],
  ['event_starts_at', ({ event }) => event?.startsAt],
  ['status', ({ lot }) => lotStatus(lot)],
  ['planned_bid', ({ lot }) => decimalAmount(lot.plannedBid?.amount)],
  ['planned_bid_currency', ({ lot }) => currencyOf(lot.plannedBid?.amount)],
  ['planned_premium_percent', ({ lot }) => percentOf(lot.plannedBid?.buyerPremiumBps)],
  ['placed_bid', ({ lot }) => decimalAmount(lot.activeBid?.amount)],
  ['placed_bid_currency', ({ lot }) => currencyOf(lot.activeBid?.amount)],
  ['placed_premium_percent', ({ lot }) => percentOf(lot.activeBid?.buyerPremiumBps)],
  ['placed_at', ({ lot }) => lot.activeBid?.placedAt],
  ['outcome', ({ lot }) => lot.outcome?.status],
  ['hammer', ({ lot }) => decimalAmount(lot.outcome?.hammer)],
  ['hammer_currency', ({ lot }) => currencyOf(lot.outcome?.hammer)],
  ['invoice', ({ lot }) => decimalAmount(lot.outcome?.actualInvoice)],
  ['invoice_currency', ({ lot }) => currencyOf(lot.outcome?.actualInvoice)],
  ['premium', ({ lot }) => decimalAmount(lotCost(lot)?.premium)],
  ['fees', ({ lot }) => decimalAmount(costFees(lotCost(lot)))],
  ['import_vat', ({ lot }) => decimalAmount(lotCost(lot)?.importVat)],
  ...COST_COLUMNS.map(([name, read]) => [name, ({ lot }) => read(lot)]),
  ['notes', ({ lot }) => lot.notes],
  ['created_at', ({ lot }) => lot.createdAt],
  ['updated_at', ({ lot }) => lot.updatedAt],
];

const COLLECTION_COLUMNS = [
  ['entry_id', ({ entry }) => entry.id],
  ['lot_id', ({ entry }) => entry.lotId],
  ['title', ({ entry }) => entry.title],
  ['acquisition_date', ({ entry }) => entry.acquisitionDate],
  ['hammer', ({ entry }) => decimalAmount(entry.hammer)],
  ['hammer_currency', ({ entry }) => currencyOf(entry.hammer)],
  ['invoice', ({ entry }) => decimalAmount(entry.actualInvoice)],
  ['invoice_currency', ({ entry }) => currencyOf(entry.actualInvoice)],
  ...COST_COLUMNS.map(([name, read]) => [name, ({ lot }) => read(lot)]),
  ['notes', ({ entry }) => entry.notes],
  ['source_urls', ({ entry }) => (Array.isArray(entry.sourceLinks) ? entry.sourceLinks.map((link) => link?.url).filter(Boolean).join(' ') : '')],
  ['created_at', ({ entry }) => entry.createdAt],
  ['updated_at', ({ entry }) => entry.updatedAt],
];

const BID_COLUMNS = [
  ['lot_id', ({ lot }) => lot.id],
  ['lot_title', ({ lot }) => lot.title],
  ['recorded_at', ({ item }) => item.recordedAt],
  ['action', ({ item }) => item.action],
  ['amount', ({ item }) => decimalAmount(item.amount)],
  ['currency', ({ item }) => currencyOf(item.amount)],
  ['premium_percent', ({ item }) => percentOf(item.buyerPremiumBps)],
];

const OUTCOME_COLUMNS = [
  ['lot_id', ({ lot }) => lot.id],
  ['lot_title', ({ lot }) => lot.title],
  ['recorded_at', ({ item }) => item.recordedAt],
  ['from', ({ item }) => item.from],
  ['to', ({ item }) => item.to],
];

// The want list (G-22): each want as the collector wrote it, and the coin it found once one was won. The most they would
// pay is one amount in its own currency, never converted.
const WANT_GRADE_NAMES = { F: 'Fine', VF: 'Very Fine', EF: 'Extremely Fine', AU: 'About Uncirculated' };
const WANT_COLUMNS = [
  ['want_id', ({ want }) => want.id],
  ['reference', ({ want }) => want.reference],
  ['max_price', ({ want }) => decimalAmount(want.maxPrice)],
  ['max_price_currency', ({ want }) => currencyOf(want.maxPrice)],
  ['min_grade', ({ want }) => WANT_GRADE_NAMES[want.minGrade] ?? ''],
  ['status', ({ want }) => (want.foundLotId ? 'Found' : 'Wanted')],
  ['found_lot_id', ({ want }) => want.foundLotId],
  ['found_lot_title', ({ lot }) => lot?.title],
  ['found_at', ({ want }) => want.foundAt],
  ['notes', ({ want }) => want.notes],
  ['created_at', ({ want }) => want.createdAt],
  ['updated_at', ({ want }) => want.updatedAt],
];

const list = (value) => (Array.isArray(value) ? value : []);

// The tables in the order the Settings page offers them, each with the label it is offered under.
export const CSV_TABLES = Object.freeze([
  Object.freeze({ key: 'lots', label: 'Watchlist lots' }),
  Object.freeze({ key: 'collection', label: 'Collection entries' }),
  Object.freeze({ key: 'bids', label: 'Bid history' }),
  Object.freeze({ key: 'outcomes', label: 'Outcome history' }),
  Object.freeze({ key: 'wants', label: 'Want list' }),
]);

/**
 * @param {Partial<Snapshot> | null | undefined} snapshot
 * @returns {{ lots: string, collection: string, bids: string, outcomes: string, wants: string }}
 */
export function csvFiles(snapshot) {
  const lots = list(snapshot?.lots);
  const events = new Map(list(snapshot?.auctionEvents).map((event) => [event.id, event]));
  const lotsById = new Map(lots.map((lot) => [lot.id, lot]));
  const history = (key) => lots.flatMap((lot) => list(lot[key]).map((item) => ({ lot, item })));
  return {
    lots: csvText(LOT_COLUMNS, lots.map((lot) => ({ lot, event: events.get(lot.auctionEventId) }))),
    collection: csvText(COLLECTION_COLUMNS, list(snapshot?.collectionEntries).map((entry) => ({ entry, lot: lotsById.get(entry.lotId) }))),
    bids: csvText(BID_COLUMNS, history('bidHistory')),
    outcomes: csvText(OUTCOME_COLUMNS, history('outcomeHistory')),
    wants: csvText(WANT_COLUMNS, list(snapshot?.wants).map((want) => ({ want, lot: lotsById.get(want.foundLotId) }))),
  };
}
