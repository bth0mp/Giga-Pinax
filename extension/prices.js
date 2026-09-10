import { TIMEOUT_MS } from './lookup.js';

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

function normaliseNumber(digits) {
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(digits)) return digits.replace(/[.,]/g, '');
  const decimal = digits.lastIndexOf(',') > digits.lastIndexOf('.') ? ',' : '.';
  const other = decimal === ',' ? '.' : ',';
  return digits.split(other).join('').replace(decimal, '.');
}

// ponytail: acsearch's logged-in price format is unconfirmed; this accepts the usual separator styles and is checked on a real account.
export function parsePrice(text) {
  const raw = String(text ?? '').trim();
  if (!raw || raw === '*') return null;
  const digits = raw.replace(/[^\d.,' ]/g, '').replace(/[' ]/g, '');
  if (!/\d/.test(digits)) return null;
  const value = Number(normaliseNumber(digits));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function defaultTerm({ catalogue, number, section }) {
  return catalogue === 'RIC' ? squash(`${squash(section)} ${squash(number)}`) : squash(`Price ${squash(number)}`);
}

const PAGE_SIZE = 100;

export function summarise(lots) {
  const priced = lots.map((entry) => ({ ...entry, amount: parsePrice(entry.price) })).filter((entry) => entry.amount !== null);
  const amounts = priced.map((entry) => entry.amount).sort((a, b) => a - b);
  const at = (fraction) => {
    const position = fraction * (amounts.length - 1);
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return amounts[low] + (amounts[high] - amounts[low]) * (position - low);
  };
  const years = priced.map((entry) => Number.parseInt(entry.date.slice(-4), 10)).filter(Number.isFinite);
  const has = amounts.length > 0;
  return {
    total: lots.length,
    count: amounts.length,
    signedOut: lots.length > 0 && !has && lots.every((entry) => String(entry.price).trim() === '*'),
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
    const response = await fetchImpl(buildSearchUrl({ term, currency }), { signal: controller.signal, credentials: 'include' });
    if (!response.ok) return { status: 'network' };
    const lots = extractLots(await response.text());
    if (!lots) return { status: 'network' };
    if (lots.length === 0) return { status: 'empty', term };
    const summary = summarise(lots);
    if (summary.signedOut) return { status: 'signed-out' };
    if (summary.count === 0) return { status: 'unpriced', term };
    return { status: 'ok', summary };
  } catch {
    return { status: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
