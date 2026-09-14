import { TIMEOUT_MS, bopSeries, kmNumber, referenceNumber, searchablePart, sgNumber } from './lookup.js';

export const ACSEARCH_ORIGIN = 'https://www.acsearch.info/*';
const SEARCH_URL = 'https://www.acsearch.info/search.html';
const MARKER = 'acsearch.initSearchResults = ';

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// category is acsearch's own: '1' Ancient coins, '2' Modern coins. Ancients is the default, as it was before Krause.
export function buildSearchUrl({ term, currency, order = 1, category = '1' }) {
  const params = new URLSearchParams({
    term: squash(term),
    category: String(category),
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
// text. A part lookup calls unsearchable — no letter and digit ("BMC –", "Rare"), or more words than a citation has — would only match unrelated lots,
// so it is left out; with no part left the card has no term and the guided field says so. An SG part in any spelling takes SG's, so a chip saved
// before 0.19 ("SG6829v") and a "v" behind a remark ("SG 6829v (this coin)") still search as Sear.
const otherParts = (number) => String(number ?? '').replace(/["“”„]/g, '').split(';')
  .map((part) => squash(squash(part).replace(/(\S)\s*\([^)]*\)$/, '$1').replace(/[()[\]{}]/g, '')))
  .filter(searchablePart).map((part) => sgNumber(part) ?? part);

// A Sear Greek part as parseReference normalises it ("SG 6829", "SG 6829 var.", "SG 6829a"); dealers write "Sear 6829" as often as "SG 6829", and a
// variant is listed under its type's number, so both phrases go without "var.". The first group is N.
const SG_PART = /^SG (\d+[a-uw-z]?)(?: var\.)?$/i;

// A Krause part as lookup normalises it ("KM# 123.2a", "Y# 59.3"), with the country words a reference may keep in front ("German States Rostock KM#
// 123"); null when the part is no Krause reference. Y# is the same catalogue family in the same shape, so it takes this path too, keeping its own key.
// Up to 4 letter-only words, as lookup reads them: letters in any script, or Württemberg and México would fall out of the Krause path here while the
// card still showed them as KM.
const KM_PART = /^((?:\p{L}+ ){0,4})((?:KM|Y)\b.*)$/iu;
const kmPart = (part) => {
  const [, country = '', rest] = KM_PART.exec(squash(part)) ?? [];
  const number = rest ? kmNumber(rest) : null;
  const [, key, digits] = number?.match(/^(KM|Y)#\s*(.*)$/) ?? [];
  return digits ? { country: squash(country), key, number: digits } : null;
};

// acsearch ignores the "#" ("KM# 123" and "KM 123" find the same lots) but the Krause/Mishler spelling finds German sales the "KM" one misses, so a
// KM part is both phrases, either-or; Y is never spelled out that way, so it offers the two spellings dealers do write, "Y 31" and "Y# 31". A country
// narrows a number that repeats across countries (Netherlands, Rostock and Bolivia all have a 123), so it goes in front of the group — but only when
// every part is Krause and names the same country, since acsearch ANDs the bare word with the whole group: it would wrongly narrow the other
// catalogues' phrases, or the other country's number, too.
function otherTerm(number) {
  const parts = otherParts(number);
  const kms = parts.map(kmPart);
  const phrases = [...new Set(parts.flatMap((part, index) => {
    const km = kms[index];
    if (km) return km.key === 'Y' ? [`"Y ${km.number}"`, `"Y# ${km.number}"`] : [`"KM ${km.number}"`, `"Krause/Mishler ${km.number}"`];
    const sg = SG_PART.exec(part);
    return sg ? [`"Sear ${sg[1]}"`, `"SG ${sg[1]}"`] : [`"${part}"`];
  }))];
  const group = phrases.length > 1 ? `(${phrases.join(' ')})` : phrases[0] ?? '';
  const country = allKm(kms) && kms.every((km) => km.country === kms[0].country) ? kms[0].country : '';
  return squash(`${country} ${group}`);
}

// Only a reference whose searchable parts are all Krause (KM or Y) is certainly modern; one mixed with an ancient catalogue stays in Ancients.
const allKm = (kms) => kms.length > 0 && kms.every(Boolean);
export function searchCategory(reference) {
  if (reference?.catalogue !== 'Other') return '1';
  return allKm(otherParts(reference.number).map(kmPart)) ? '2' : '1';
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
  // A term saved before 0.22 for text now read as prose is that whole sentence: it would search acsearch for it again, so it goes with the default.
  const none = reference.catalogue === 'Other' && !defaultTerm(reference);
  if (!term || none || (reference.catalogue === 'Bop' && term === oldBopTerm(reference))) return defaultTerm(reference);
  return term;
}

// CoinArchives is only a link the collector opens (nothing is fetched), and its search takes plain words, so acsearch's quotes and either-or
// brackets never carry over: RRC, SC and Price already search as plain words; RIC is its acsearch term with a number's bracket opened, keeping
// the word OCRE tells types apart by ("266 (aureus)" as "266 aureus"); Bop is the king and series (the old v0.12 term); an Other reference is its
// first searchable ";" part, cleaned as for acsearch, an SG part as "Sear N", the way most dealers cite it.
export function coinArchivesTerm(reference) {
  if (reference.catalogue === 'Bop') return oldBopTerm(reference);
  if (reference.catalogue === 'RIC') return squash(defaultTerm(reference).replace(/[()[\]{}]/g, ' '));
  if (reference.catalogue !== 'Other') return defaultTerm(reference);
  const [first = ''] = otherParts(reference.number);
  const km = kmPart(first);
  if (km) return squash(`${km.country} ${km.key} ${km.number}`);
  const sg = SG_PART.exec(first);
  return sg ? `Sear ${sg[1]}` : first;
}

// CoinArchives keeps world and modern coins in its own section; ancients are /a/. The section follows the part coinArchivesTerm built the link from,
// not acsearch's stricter all-Krause rule: a mixed reference opening on KM searches "KM 123", which /a/ can never hold.
export const coinArchivesSection = (reference) =>
  (reference?.catalogue === 'Other' && kmPart(otherParts(reference.number)[0] ?? '') ? 'w' : 'a');

export const coinArchivesUrl = (term, section = 'a') => `https://www.coinarchives.com/${section}/results.php?search=${encodeURIComponent(squash(term))}&s=0`;

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

export function stableResultId(lot) {
  if (lot?.id !== undefined && lot?.id !== null && String(lot.id).trim()) return `acsearch:${String(lot.id).trim()}`;
  const source = [lot?.title, lot?.date, lot?.price].map((value) => String(value ?? '').trim()).join('\u001f');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `acsearch:derived:${(hash >>> 0).toString(36)}`;
}

export function createPriceCuration() {
  const excluded = new Set();
  return {
    exclude(lot) { excluded.add(stableResultId(lot)); },
    include(lot) { excluded.delete(stableResultId(lot)); },
    isExcluded(lot) { return excluded.has(stableResultId(lot)); },
    included(lots) { return lots.filter((lot) => !excluded.has(stableResultId(lot))); },
    counts(lots) {
      const excludedCount = lots.reduce((count, lot) => count + Number(excluded.has(stableResultId(lot))), 0);
      return { included: lots.length - excludedCount, excluded: excludedCount };
    },
    reset() { excluded.clear(); },
  };
}

export function pricePanelVisibility(includedCount, eligibleCount) {
  return { statistics: includedCount > 0, curation: eligibleCount > 0 };
}

// How far to trust a median, by the sales it rests on. Never "Fair", which would read as a verdict on a checked price.
// A bid or an asking price against the counted sales: how many sold strictly under it, and its multiple of the median.
export const priceCheck = (summary, amount) => ({ below: summary.priced.filter((sale) => sale.amount < amount).length, count: summary.count, ratio: amount / summary.median });

// acsearch dates a lot "08.07.2026", "28.07.2026 14:00" or "2024-05-01"; only the day counts, as midnight UTC. Date.UTC rolls 31.02 into March,
// so a day that doesn't read back unchanged is no date.
export function saleDate(text) {
  const raw = squash(text);
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s|$)/.exec(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:\s|$)/.exec(raw);
  const [year, month, day] = dotted ? [dotted[3], dotted[2], dotted[1]] : iso ? iso.slice(1) : [];
  if (!year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().startsWith(`${year}-${month}-${day}`) ? date : null;
}

// The sales periods the panel offers, all drawn from the one results page (at most the 100 most recent lots).
export const PERIODS = Object.freeze([{ value: 'all', label: 'All', years: null }, { value: '5y', label: 'Last 5 years', years: 5 }, { value: '2y', label: 'Last 2 years', years: 2 }]);

// A moment's local date as midnight UTC, the form saleDate gives a sale, so a period starts on the collector's own day: the UTC date is another day
// for part of every day away from UTC.
export const localDay = (now) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

// The same day and month N years before now, as midnight UTC like saleDate; 29 February falls back to the 28th in a year without one.
function yearsBefore(now, years) {
  const from = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  if (from.getUTCDate() !== now.getUTCDate()) from.setUTCDate(0);
  return from;
}

// A period keeps the lots sold on or after that day; a lot without a readable date can't be placed, so only All keeps it.
export function lotsInPeriod(lots, period, now) {
  const years = PERIODS.find((entry) => entry.value === period)?.years;
  if (!years) return lots;
  const from = yearsBefore(now, years);
  return lots.filter((entry) => {
    const date = saleDate(entry.date);
    return date !== null && date >= from;
  });
}

const TREND_MIN = 3;
// Recent sales against earlier ones, whatever period is on show: the counted sales of the last 2 years (the same boundary as its button) and those
// before, each median trusted only when it rests on at least TREND_MIN sales. A lot without a readable date belongs to neither side.
export function trendOf(lots, currency, now) {
  const recentLots = lotsInPeriod(lots, '2y', now);
  const recent = summarise(recentLots, currency);
  const earlier = summarise(lots.filter((entry) => saleDate(entry.date) && !recentLots.includes(entry)), currency);
  if (recent.count < TREND_MIN || earlier.count < TREND_MIN) return null;
  return { recent: recent.median, recentCount: recent.count, earlier: earlier.median, earlierCount: earlier.count, change: recent.median / earlier.median - 1 };
}

const FLAT_PERCENT = 5;
// The trend as the panel and the copy word it (format is an Intl.NumberFormat's format). The rule reads the rounded percent that would be shown, so a
// move is never worded "up 5%" while 5% counts as about the same. The percent comes from the difference, not from change, so an exact 5.5% rounds up
// whichever way it moves (105.5 / 100 - 1 is 5.4999…% in floating point).
export function trendText(trend, format) {
  const percent = Math.round(Math.abs(trend.recent - trend.earlier) * 100 / trend.earlier);
  const move = percent <= FLAT_PERCENT ? 'about the same as' : `${trend.change > 0 ? 'up' : 'down'} ${percent}% on`;
  return `Last 2 years: ${format(trend.recent)} median, ${move} earlier sales (${format(trend.earlier)})`;
}

// The counted sale with the latest readable date; a tie keeps the first in page order, the one acsearch lists as most recent.
export function lastSale(summary) {
  const dated = summary.priced.map((sale) => ({ sale, date: saleDate(sale.date) })).filter((entry) => entry.date);
  return dated.reduce((last, entry) => (entry.date > last.date ? entry : last), dated[0])?.sale ?? null;
}

export async function fetchPrices({ term, currency, category }, options = {}) {
  const { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(buildSearchUrl({ term, currency, category }), { signal: controller.signal, credentials: 'include', cache: 'no-store' });
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
    // The page's lots stay with the result, in memory only, so the popup draws a period from them without another request.
    return { status: 'ok', summary, lots: page };
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

// The copy follows the panel: a period other than All (a PERIODS entry) is named on the stats line, then come the last sale and the trend, which the
// popup takes from the whole page whatever the period.
export function summaryText(card, summary, currency, term, { period, last, trend } = {}) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const { count } = summary;
  const named = period?.years ? ` (${period.label.toLowerCase()})` : '';
  let stats = `Median hammer ${money.format(summary.median)}${named} · middle 50% ${money.format(summary.lowerQuartile)}–${money.format(summary.upperQuartile)}`;
  stats += ` · range ${money.format(summary.min)}–${money.format(summary.max)} · ${count} recorded ${count === 1 ? 'sale' : 'sales'} matching “${term}”`;
  if (summary.earliest !== null) stats += ` · ${summary.earliest === summary.latest ? summary.earliest : `${summary.earliest}–${summary.latest}`}`;
  const lines = [card.label, stats];
  // The date is page text, squashed so a copied line never splits.
  if (last) lines.push(`Last sale ${squash(last.date)} · ${money.format(last.amount)}`);
  if (trend) lines.push(trendText(trend, money.format));
  if (summary.uncounted.length) lines.push(`Not counted: ${quoteList(summary.uncounted)}`);
  // A reference without type data has no type page to link to.
  if (card.corpus !== 'other') lines.push(`https://numismatics.org/${card.corpus}/id/${encodeURIComponent(card.id)}`);
  // Plain text for pasting: Intl puts no-break spaces in amounts such as "CHF 500".
  return lines.join('\n').replace(/[\u00a0\u202f]/g, ' ');
}
