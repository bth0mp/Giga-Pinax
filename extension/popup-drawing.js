// Pieces of the popup's panels (popup.js) drawn from their arguments alone, holding none of a
// lookup's state: a specimen, a sale's link, the filter lines, the median by year and the CoinArchives
// counts.
import { yearText, yearsSentence } from './prices.js';
import { $ } from './popup-shell.js';

// One specimen: its two sides and, under them, the collection that holds it as a link to the specimen's own page. Every address is http(s),
// checked by fetchSpecimens; the attributes that keep the referrer back and defer the load are set before the source, so the first request obeys them.
function specimenItem({ page, collection, obverse, reverse }) {
  const item = document.createElement('li');
  const pair = document.createElement('div');
  pair.className = 'specimen-pair';
  for (const [side, source] of [['Obverse', obverse], ['Reverse', reverse]]) {
    const image = document.createElement('img');
    image.setAttribute('loading', 'lazy');
    image.setAttribute('referrerpolicy', 'no-referrer');
    image.alt = `${side}, ${collection}`;
    // A photo the museum no longer serves takes its specimen off the strip rather than leaving a broken image.
    image.addEventListener('error', () => { item.hidden = true; });
    image.src = source;
    pair.append(image);
  }
  const link = document.createElement('a');
  link.className = 'specimen-link';
  link.href = page;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = collection;
  link.setAttribute('aria-label', `${collection}: this specimen, opens a new tab`);
  item.append(pair, link);
  return item;
}

const sales = (count) => `${count} ${count === 1 ? 'sale' : 'sales'}`;
// Where an amount falls on the lowest–highest line, in percent; a single price has no span and sits in the middle.
const rangePercent = (summary, value) => (summary.max > summary.min ? ((value - summary.min) / (summary.max - summary.min)) * 100 : 50);

// A lot's title as the Upcoming list shows, speaks and hands it over: page text of any length, taken to the 200 characters a watchlist draft keeps.
const lotTitle = (sale) => String(sale.title || `Lot ${sale.id}`).trim().replace(/\s+/g, ' ').slice(0, 200);
// A link to one lot on acsearch, in a new tab.
const lotUrl = (sale) => `https://www.acsearch.info/search.html?id=${encodeURIComponent(sale.id)}`;
function lotLink(sale, text) {
  const link = document.createElement('a');
  link.href = lotUrl(sale);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  return link;
}

// What the filters left out of the statistics, in the panel's own words; nothing is said about a filter every row passes. Every figure is over the
// rows the median itself rests on — the period on show. N is how many of them pass the filter, and nothing else: a row the collector counted by hand
// still does not cite the reference. Where the median rests on other rows than those — his own decisions, or the other filter — the number it rests
// on follows ("1 of 3 results cite Price 23; 2 of 3 counted"). The line stays while any row fails the filter, counted by hand or not. A page that
// names the reference nowhere is counted whole instead, and says so.
// A search term edited to look for something else switches the citation filter off; that is said too, or the median would change without a word.
function filterLines(periodLots, curation, { name, denomination, citing, uncited, unsearched, passes }) {
  const total = periodLots.length;
  const all = `all ${total} ${total === 1 ? 'result is' : 'results are'} counted`;
  if (uncited) return [`No result text names ${name}, so ${all}.`];
  if (unsearched) return [`This search does not look for ${name}, so ${all}.`, ...filterLines(periodLots, curation, { name, denomination, passes })];
  const counted = periodLots.filter((sale) => curation.reasonFor(sale) === null).length;
  // Whether the rows counted are not the rows that pass, even where the two numbers happen to agree.
  const differs = (test) => periodLots.some((sale) => test(sale) !== (curation.reasonFor(sale) === null));
  const line = (test, verb) => `${periodLots.filter(test).length} of ${total} ${verb}${differs(test) ? `; ${counted} of ${total} counted` : ''}`;
  // A filter's line stays while any row fails it, whether the filter leaves that row out or the collector counts it by hand: a row that does not cite
  // the reference is no citation for being counted. A filter every row passes has nothing to say, whatever the other filter leaves out.
  const shown = (test) => periodLots.some((sale) => !test(sale));
  const lines = [];
  if (citing && shown(passes.citing)) lines.push(line(passes.citing, `${total === 1 ? 'result cites' : 'results cite'} ${name}`));
  if (denomination && shown(passes.denomination)) lines.push(line(passes.denomination, `${total === 1 ? 'result names' : 'results name'} “${denomination}”`));
  return lines;
}

// The filter lines as a screen reader hears them, each its own sentence.
const spokenFilters = (filters) => filters.map((line) => (line.endsWith('.') ? line : `${line}.`)).join(' ');

// A median per year as a strip of bars, the year and the number of sales under each and the median above it, drawn in SVG from the panel's own
// counted rows; its name is the whole of it in one sentence, and the same lines stand as text for a screen reader. prefix picks the panel ('' for
// acsearch, 'coinarchives-'): each provider draws its own, in its own currency, and nothing is pooled.
const SVG = 'http://www.w3.org/2000/svg';
const YEAR_COLUMN = 48;
const YEAR_BAR = 36;
function renderYears(prefix, years, format) {
  const strip = $(`${prefix}year-strip`);
  const node = (tag, attributes, text = '') => {
    const made = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, String(value));
    if (text) made.textContent = text;
    return made;
  };
  const top = Math.max(0, ...years.map(({ median }) => median));
  strip.setAttribute('viewBox', `0 0 ${Math.max(1, years.length) * YEAR_COLUMN} ${YEAR_BAR + 38}`);
  strip.setAttribute('aria-label', yearsSentence(years, format));
  strip.style.width = `${years.length * YEAR_COLUMN}px`;
  strip.style.height = `${YEAR_BAR + 38}px`;
  strip.replaceChildren(...years.flatMap(({ year, median, count }, index) => {
    const middle = index * YEAR_COLUMN + YEAR_COLUMN / 2;
    const height = Math.max(2, Math.round((YEAR_BAR * median) / top));
    const text = (y, className, value) => node('text', { x: middle, y, 'text-anchor': 'middle', class: className }, value);
    return [text(10, 'year-median', format(median)),
      node('rect', { x: middle - 10, y: 12 + YEAR_BAR - height, width: 20, height, rx: 2, class: 'year-bar' }),
      text(YEAR_BAR + 24, 'year-label', String(year)), text(YEAR_BAR + 35, 'year-count', `${count} ${count === 1 ? 'sale' : 'sales'}`)];
  }));
  $(`${prefix}year-lines`).replaceChildren(...years.map((entry) => {
    const line = document.createElement('li');
    line.textContent = yearText(entry, format);
    return line;
  }));
  $(`${prefix}year-medians`).hidden = years.length === 0;
}

const coinArchivesCounts = (outcome, currency) => {
  const otherCurrencies = Object.entries(outcome.availableCurrencyCounts ?? {}).filter(([code]) => code !== currency)
    .map(([code, count]) => `${count} ${code}`).join(', ');
  const excluded = outcome.excluded ?? {};
  return [`${outcome.matchedCount} public results matched · ${outcome.renderedCount} rendered`, `${outcome.selectedLots.length} completed ${currency} prices available`,
    otherCurrencies && `Other currencies not converted: ${otherCurrencies}`, excluded.unpriced && `${excluded.unpriced} unpriced`,
    excluded.upcoming && `${excluded.upcoming} upcoming`, excluded.toBePosted && `${excluded.toBePosted} price${excluded.toBePosted === 1 ? '' : 's'} to be posted`,
    excluded.malformedPrice && `${excluded.malformedPrice} unreadable price${excluded.malformedPrice === 1 ? '' : 's'}`,
    excluded.malformedDate && `${excluded.malformedDate} unreadable date${excluded.malformedDate === 1 ? '' : 's'}`,
    excluded.futureDate && `${excluded.futureDate} future-dated`, excluded.duplicateId && `${excluded.duplicateId} duplicate ${excluded.duplicateId === 1 ? 'row' : 'rows'}`,
    excluded.conflictingId && `${excluded.conflictingId} conflicting ${excluded.conflictingId === 1 ? 'row' : 'rows'}`].filter(Boolean).join(' · ');
};

export {
  coinArchivesCounts, filterLines, lotLink, lotTitle, lotUrl, rangePercent, renderYears, sales, specimenItem, spokenFilters,
};
