import { TIMEOUT_MS, bopSeries, referenceNumber } from './lookup.js';

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

// Dealers mostly spell an Indo-Greek king in Greek ("Hermaios", "Eukratides") where BIGR spells it in Latin; four rules, in this order, cover every
// BIGR first name (the table test lists them all): final -us to -os, ae to ai, c not before h to k, final -o to -on. Other names come back unchanged.
export const greekName = (latin) => String(latin ?? '').replace(/us$/, 'os').replace(/ae/g, 'ai').replace(/c(?!h)/g, 'k').replace(/o$/, 'on');

// The king's first name as BIGR spells it; the section field is the king ("Euthydemus I", "Diodotus I or Diodotus II").
const firstName = (section) => squash(section).split(' ')[0];

// acsearch ANDs every word anywhere in a lot ("20" matched "20 mm") and offers (a b) for either-or and "…" for an exact phrase, so the term is
// the king in both spellings, "(Hermaeus Hermaios)" (one word when they agree: Menander), and the series as the exact phrase "Bopearachchi 20".
// No series (an uncited BIGR type) leaves the bare word Bopearachchi; no king leaves the phrase alone.
function bopTerm(section, number) {
  const latin = firstName(section);
  const greek = greekName(latin);
  const king = latin && greek !== latin ? `(${latin} ${greek})` : latin;
  const series = bopSeries(number);
  return squash(`${king} ${series ? `"Bopearachchi ${series}"` : 'Bopearachchi'}`);
}

// A reference without type data is searched as dealers cite it: each ";" reference an exact phrase ("HGC 4, 1218" also finds "HGC 4 1218", since
// acsearch ignores the comma), several offered either-or, ("BCD Boiotia 174b" "HGC 4, 1218"). Quotes are stripped so none unbalances a phrase, and
// brackets too, since acsearch finds nothing for a phrase holding one: a trailing remark goes whole ("174b (this coin)"), a wrapping pair leaves its
// text. A part without a letter and a digit ("BMC –", "Rare") would only match unrelated lots, so it is left out.
function otherTerm(number) {
  const phrases = String(number ?? '').replace(/["“”„]/g, '').split(';')
    .map((part) => squash(squash(part).replace(/(\S)\s*\([^)]*\)$/, '$1').replace(/[()[\]{}]/g, '')))
    .filter((part) => /\p{L}/u.test(part) && /\d/.test(part)).map((part) => `"${part}"`);
  return phrases.length > 1 ? `(${phrases.join(' ')})` : phrases[0] ?? '';
}

// A RIC term drops OCRE's split-section parenthetical ("Leo I (East)", "Gallienus (joint reign)"): acsearch would require a word dealers rarely write.
export function defaultTerm({ catalogue, number, section }) {
  if (catalogue === 'RIC') return squash(`${squash(section).replace(/\s*\([^)]*\)$/, '')} ${squash(number)}`);
  if (catalogue === 'Other') return otherTerm(number);
  if (catalogue === 'RRC') return squash(`Crawford ${referenceNumber('RRC', number)}`);
  if (catalogue === 'SC') return squash(`SC ${referenceNumber('SC', number)}`);
  if (catalogue === 'Bop') return bopTerm(section, number);
  return squash(`Price ${referenceNumber('Price', number)}`);
}

// v0.12's Bop default ("Hermaeus Bopearachchi 20") was stored under the type whenever Get prices ran, so it would hide the new default for good;
// a remembered term that is exactly that old default counts as unsaved. Anything else the collector saved still wins.
const oldBopTerm = ({ section, number }) => squash(`${firstName(section)} Bopearachchi ${bopSeries(number)}`);
export function chooseTerm(reference, saved) {
  const term = squash(saved);
  if (!term || (reference.catalogue === 'Bop' && term === oldBopTerm(reference))) return defaultTerm(reference);
  return term;
}

const PAGE_SIZE = 100;
const EXAMPLE_LIMIT = 5;

export function summarise(lots, currency) {
  const parsed = lots.map((entry) => ({ ...entry, amount: parsePrice(entry.price, currency) }));
  const priced = parsed.filter((entry) => entry.amount !== null);
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
    // Lots with no price at all (unsold, unpriced: blank, "*" and "-" style markers), told apart from prices that could not be counted.
    unpriced: lots.filter((entry) => !/\d/.test(entry.price)).length,
    // Raw prices the strict parser (or the currency check) rejected, so the collector can report an unseen format; blank, "*" and "-" style markers are not prices.
    uncounted: parsed.filter((entry) => entry.amount === null && /\d/.test(entry.price)).slice(0, EXAMPLE_LIMIT).map((entry) => entry.price),
  };
}

// How far to trust a median, by the sales it rests on. Never "Fair", which would read as a verdict on a checked price.
export const medianStrength = (count) => (count >= 15 ? 'Solid' : count >= 5 ? 'Moderate' : 'Thin');

// A bid or an asking price against the counted sales: how many sold strictly under it, and its multiple of the median.
export const priceCheck = (summary, amount) => ({ below: summary.priced.filter((sale) => sale.amount < amount).length, count: summary.count, ratio: amount / summary.median });

export async function fetchPrices({ term, currency }, options = {}) {
  const { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(buildSearchUrl({ term, currency }), { signal: controller.signal, credentials: 'include', cache: 'no-store' });
    if (!response.ok) return { status: 'network' };
    const html = await response.text();
    const lots = extractLots(html);
    // A search without hits comes back as acsearch's "No results found" page, which has no results array at all.
    if (!lots) return /No results found/i.test(html) ? { status: 'empty', term } : { status: 'network' };
    if (lots.length === 0) return { status: 'empty', term };
    // One results page at most; the slice still has PAGE_SIZE entries whenever acsearch returned PAGE_SIZE or more, so `capped` holds.
    const page = lots.slice(0, PAGE_SIZE);
    const summary = summarise(page, currency);
    if (summary.signedOut) return { status: 'signed-out' };
    if (summary.count === 0) return summary.uncounted.length ? { status: 'unpriced', term, examples: summary.uncounted } : { status: 'unpriced', term };
    return { status: 'ok', summary };
  } catch {
    return { status: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

const QUOTE_LIMIT = 40;
// Raw prices are page text: each is squashed of whitespace and control characters, so a copied line never splits,
// and capped by characters (not UTF-16 units), so a surrogate pair is never cut in half.
const quote = (text) => {
  const chars = Array.from(String(text).replace(/[\s\p{Cc}]+/gu, ' ').trim());
  return `“${chars.length > QUOTE_LIMIT ? `${chars.slice(0, QUOTE_LIMIT).join('')}…` : chars.join('')}”`;
};
export const quoteList = (texts) => texts.map(quote).join(', ');

export function summaryText(card, summary, currency, term) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const { count } = summary;
  let stats = `Median hammer ${money.format(summary.median)} · middle 50% ${money.format(summary.lowerQuartile)}–${money.format(summary.upperQuartile)}`;
  stats += ` · range ${money.format(summary.min)}–${money.format(summary.max)} · ${count} ${count === 1 ? 'sale' : 'sales'} (${medianStrength(count).toLowerCase()}) matching “${term}”`;
  if (summary.earliest !== null) stats += ` · ${summary.earliest === summary.latest ? summary.earliest : `${summary.earliest}–${summary.latest}`}`;
  const lines = [card.label, stats];
  if (summary.uncounted.length) lines.push(`Not counted: ${quoteList(summary.uncounted)}`);
  // A reference without type data has no type page to link to.
  if (card.corpus !== 'other') lines.push(`https://numismatics.org/${card.corpus}/id/${encodeURIComponent(card.id)}`);
  // Plain text for pasting: Intl puts no-break spaces in amounts such as "CHF 500".
  return lines.join('\n').replace(/[\u00a0\u202f]/g, ' ');
}
