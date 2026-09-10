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
