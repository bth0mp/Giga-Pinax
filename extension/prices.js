import { TIMEOUT_MS, referenceNumber } from './lookup.js';

export const ACSEARCH_ORIGIN = 'https://www.acsearch.info/*';
const SEARCH_URL = 'https://www.acsearch.info/search.html';
const MARKER = 'acsearch.initSearchResults = ';

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function buildSearchUrl({ term, currency, order = 1 }) {
  const params = new URLSearchParams({
    term: squash(term),
    category: '1',
    currency: String(currency ?? 'USD').toLowerCase(),
    order: String(order),
  });
  return `${SEARCH_URL}?${params}`;
}

// ponytail: the page inlines its lots as JSON; try each "];" until one parses, so a "];" inside a description can't truncate it.
export function extractLots(html) {
  const text = String(html ?? '');
  const start = text.indexOf(MARKER);
  if (start < 0) return null;
  const from = start + MARKER.length;
  let end = text.indexOf('];', from);
  while (end >= 0) {
    try {
      const lots = JSON.parse(text.slice(from, end + 1));
      if (Array.isArray(lots)) {
        return lots.filter((lot) => lot && typeof lot === 'object').map((lot) => ({
          id: String(lot.id ?? ''), title: String(lot.title ?? ''), date: String(lot.date ?? ''), price: String(lot.price ?? ''),
        }));
      }
      return null;
    } catch { /* a "];" inside a string; keep scanning */ }
    end = text.indexOf('];', end + 1);
  }
  return null;
}

const CURRENCY_MARKS = [['USD', /US\$|\$|\bUSD\b/i], ['EUR', /€|\bEUR\b/i], ['GBP', /£|\bGBP\b/i], ['CHF', /\bCHF\b|\bFr\./i]];
// Only one mark at the very start and one at the very end are stripped; a mark anywhere else fails AMOUNT, so "$200 $150" never becomes 200150.
const MARK = String.raw`(?:US\$|[$€£]|\b(?:USD|EUR|GBP|CHF)\b|\bFr\.)`;
const STRIP = new RegExp(`^${MARK}\\s*|\\s*${MARK}$`, 'gi');
// Every thousands group uses the first group's separator (\1); a decimal separator, if any, must differ from it (checked below).
const AMOUNT = /^(?:\d{1,3}([ '’.,\u00a0\u202f])\d{3}(?:\1\d{3})*|\d+)(?:([.,])\d{1,2})?$/;

// ponytail: acsearch's logged-in price format is unconfirmed; accept exactly one amount and fail closed on anything else.
export function parsePrice(text, currency) {
  const raw = String(text ?? '').trim();
  if (!raw || raw === '*') return null;
  const marks = CURRENCY_MARKS.filter(([, pattern]) => pattern.test(raw)).map(([code]) => code);
  if (marks.length > 1) return null;
  if (currency && marks.length === 1 && marks[0] !== String(currency).toUpperCase()) return null;
  const amount = raw.replace(STRIP, '').trim();
  const grammar = AMOUNT.exec(amount);
  if (!grammar || (grammar[1] && grammar[2] && grammar[1] === grammar[2])) return null;
  const decimals = amount.match(/[.,](\d{1,2})$/);
  const whole = (decimals ? amount.slice(0, -decimals[0].length) : amount).replace(/\D/g, '');
  const value = Number(decimals ? `${whole}.${decimals[1]}` : whole);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function defaultTerm({ catalogue, number, section }) {
  if (catalogue === 'RIC') return squash(`${squash(section)} ${squash(number)}`);
  if (catalogue === 'RRC') return squash(`Crawford ${referenceNumber('RRC', number)}`);
  return squash(`Price ${referenceNumber('Price', number)}`);
}

const PAGE_SIZE = 100;

export function summarise(lots, currency) {
  const priced = lots.map((entry) => ({ ...entry, amount: parsePrice(entry.price, currency) })).filter((entry) => entry.amount !== null);
  const amounts = priced.map((entry) => entry.amount).sort((a, b) => a - b);
  const at = (fraction) => {
    const position = fraction * (amounts.length - 1);
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return amounts[low] + (amounts[high] - amounts[low]) * (position - low);
  };
  const years = priced.flatMap((entry) => {
    const match = /\b(\d{4})\b/.exec(entry.date);
    return match ? [Number(match[1])] : [];
  });
  const has = amounts.length > 0;
  return {
    total: lots.length,
    count: amounts.length,
    signedOut: amounts.length === 0 && lots.some((entry) => String(entry.price).trim() === '*'),
    capped: lots.length >= PAGE_SIZE,
    priced,
    median: has ? at(0.5) : null,
    lowerQuartile: has ? at(0.25) : null,
    upperQuartile: has ? at(0.75) : null,
    min: has ? amounts[0] : null,
    max: has ? amounts[amounts.length - 1] : null,
    earliest: years.length ? Math.min(...years) : null,
    latest: years.length ? Math.max(...years) : null,
  };
}

export async function fetchPrices({ term, currency }, options = {}) {
  const { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(buildSearchUrl({ term, currency }), { signal: controller.signal, credentials: 'include', cache: 'no-store' });
    if (!response.ok) return { status: 'network' };
    const lots = extractLots(await response.text());
    if (!lots) return { status: 'network' };
    if (lots.length === 0) return { status: 'empty', term };
    // One results page at most; the slice still has PAGE_SIZE entries whenever acsearch returned PAGE_SIZE or more, so `capped` holds.
    const page = lots.slice(0, PAGE_SIZE);
    const summary = summarise(page, currency);
    if (summary.signedOut) return { status: 'signed-out' };
    if (summary.count === 0) return { status: 'unpriced', term };
    return { status: 'ok', summary };
  } catch {
    return { status: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
