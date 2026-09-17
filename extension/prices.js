import { TIMEOUT_MS, bopSeries, kmNumber, referenceNumber, searchablePart, sgNumber } from './lookup.js';
import { canonicalRicPerson } from './catalogues.js';

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
        // The description comes along: it is what says whether a lot cites the reference at all, what it was graded and what it is called.
        return lots.filter((lot) => lot && typeof lot === 'object').map((lot) => ({
          id: String(lot.id ?? ''), title: String(lot.title ?? ''), date: String(lot.date ?? ''), price: String(lot.price ?? ''), description: String(lot.description ?? ''),
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

// One exact phrase, and the either-or group of several: acsearch's own (a b) for "any of these". A repeated spelling is offered once.
const phrase = (...words) => `"${squash(words.join(' '))}"`;
const group = (phrases) => {
  const offered = [...new Set(phrases)];
  return offered.length > 1 ? `(${offered.join(' ')})` : offered[0] ?? '';
};

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
  const phrases = parts.flatMap((part, index) => {
    const km = kms[index];
    if (km) return km.key === 'Y' ? [phrase('Y', km.number), phrase('Y#', km.number)] : [phrase('KM', km.number), phrase('Krause/Mishler', km.number)];
    const sg = SG_PART.exec(part);
    return sg ? [phrase('Sear', sg[1]), phrase('SG', sg[1])] : [phrase(part)];
  });
  const country = allKm(kms) && kms.every((km) => km.country === kms[0].country) ? kms[0].country : '';
  return squash(`${country} ${group(phrases)}`);
}

// Only a reference whose searchable parts are all Krause (KM or Y) is certainly modern; one mixed with an ancient catalogue stays in Ancients.
const allKm = (kms) => kms.length > 0 && kms.every(Boolean);
export function searchCategory(reference) {
  if (reference?.catalogue !== 'Other') return '1';
  return allKm(otherParts(reference.number).map(kmPart)) ? '2' : '1';
}

// The ruler or mint section is a plain required word, as it always was: dealers put it in the lot title, away from the citation. A RIC term drops
// OCRE's split-section parenthetical ("Leo I (East)", "Gallienus (joint reign)"), which acsearch would then require and dealers rarely write, while a
// number's own parenthetical ("266 (aureus)") is the word OCRE tells two types apart by and stays as a plain word too: acsearch finds nothing for a
// phrase holding a bracket. The number itself must sit next to a RIC key, so the volume numeral goes inside the phrases, without the edition mark
// dealers leave out ("RIC I²" is cited "RIC I"); with no volume there is only one phrase to offer.
function ricTerm({ number, section, volume, rulers }) {
  const people = Array.isArray(rulers) && rulers.length === 1 ? canonicalRicPerson(rulers[0]) : '';
  const [, digits = '', aside = ''] = /^(\S*)(?:\s*\(([^)]*)\))?$/.exec(squash(number)) ?? [];
  const numeral = /^[IVX]+/.exec(squash(volume))?.[0] ?? '';
  const keyed = digits ? group([phrase('RIC', digits), ...(numeral ? [phrase('RIC', numeral, digits), phrase(`RIC ${numeral},`, digits)] : [])]) : 'RIC';
  return squash(`${squash(section).replace(/\s*\([^)]*\)$/, '') || people} ${aside} ${keyed}`);
}

// acsearch ANDs bare words anywhere in a lot, so a bare "Price 23" matched "Price 3014" and "4.23 g" and medianed them as this type's sales. Every
// typed reference is the exact phrases dealers cite it with, offered either-or, as Bop, Sear Greek and Krause already were: Price is cited one way
// only (acsearch ignores a comma inside a phrase, so "Price, 23" needs no phrase of its own), Seleucid Coins is written short and spelled out, and
// Crawford's number is written under three keys.
export function defaultTerm(reference) {
  const { catalogue, number, section } = reference;
  if (catalogue === 'RIC') return ricTerm(reference);
  if (catalogue === 'Other') return otherTerm(number);
  if (catalogue === 'RRC') {
    const digits = referenceNumber('RRC', number);
    return group([phrase('Crawford', digits), phrase('Cr.', digits), phrase('RRC', digits)]);
  }
  if (catalogue === 'SC') {
    const digits = referenceNumber('SC', number);
    return group([phrase('SC', digits), phrase('Seleucid Coins', digits)]);
  }
  if (catalogue === 'Bop') return bopTerm(section, number);
  return phrase('Price', referenceNumber('Price', number));
}

// The exact phrases the default term looks for, bare, and the first of them as the panel names the reference ("Price 23", "RIC 306"). The citation
// filter judges the reference the card is about, so it may only judge a search that still looks for it: a collector who typed something else
// ("Müller 5") is looking for something else, and every row he found is counted.
export const citationPhrases = (reference) => (defaultTerm(reference).match(/"[^"]*"/g) ?? []).map((quoted) => quoted.slice(1, -1));
export const referenceName = (reference) => citationPhrases(reference)[0] ?? '';
export function searchesReference(term, reference) {
  const phrases = citationPhrases(reference).map((phrase) => phrase.toLowerCase());
  const text = squash(term).toLowerCase();
  return phrases.length === 0 || phrases.some((phrase) => text.includes(phrase));
}

// v0.12's Bop default ("Hermaeus Bopearachchi 20") was stored under the type whenever Get prices ran, so it would hide the new default for good;
// a remembered term that is exactly that old default counts as unsaved. Anything else the collector saved still wins.
const oldBopTerm = ({ section, number }) => squash(`${firstName(section)} Bopearachchi ${bopSeries(number)}`);
// The same for the unquoted defaults of 0.31 and before, which 0.32's exact phrases replace: the bare ruler and number, "Price 23", "Crawford 44/5",
// "SC 1266.2". An Other reference has searched as phrases since 0.19, so it has no old default to retire.
function oldDefaultTerm(reference) {
  const { catalogue, number, section, rulers } = reference;
  if (catalogue === 'Bop') return oldBopTerm(reference);
  if (catalogue === 'RIC') {
    const people = Array.isArray(rulers) && rulers.length === 1 ? canonicalRicPerson(rulers[0]) : '';
    return squash(`${squash(section).replace(/\s*\([^)]*\)$/, '') || people} ${squash(number)}`);
  }
  if (catalogue === 'RRC') return squash(`Crawford ${referenceNumber('RRC', number)}`);
  if (catalogue === 'SC') return squash(`SC ${referenceNumber('SC', number)}`);
  if (catalogue === 'Price') return squash(`Price ${referenceNumber('Price', number)}`);
  return '';
}
export function chooseTerm(reference, saved) {
  const term = squash(saved);
  // A term saved before 0.22 for text now read as prose is that whole sentence: it would search acsearch for it again, so it goes with the default.
  const none = reference.catalogue === 'Other' && !defaultTerm(reference);
  if (!term || none || term === oldDefaultTerm(reference)) return defaultTerm(reference);
  return term;
}

// CoinArchives honours a double-quoted phrase and echoes it back unchanged (checked live: '"Price 23"' matched 64 lots where the bare words matched
// 4,856 through "Starting price", and 'Nero "RIC 306"' matched 4), but it has no either-or group. So its term is the acsearch term with every group
// cut to its first member — the spelling dealers cite most, and the first searchable ";" part of an Other reference.
export const coinArchivesTerm = (reference) =>
  squash(defaultTerm(reference).replace(/\(([^()]*)\)/g, (whole, offered) => offered.match(/"[^"]*"|\S+/)?.[0] ?? ''));

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

const escaped = (value) => String(value).replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

// A word (or a number's letter suffix) read whatever its capitals: dealers cite RIC 22A as "RIC 22a" and Bop 24A as "Bopearachchi 24a". A full stop
// inside a number reads as the comma they write just as often ("SC 1266,2" is SC 1266.2).
const eitherCase = (text) => [...String(text)].map((char) => {
  if (char === '.') return '[.,]';
  const [lower, upper] = [char.toLowerCase(), char.toUpperCase()];
  return lower === upper ? escaped(char) : `[${lower}${upper}]`;
}).join('');

// The spellings dealers write each key in. A key ending in a full stop needs no entry of its own — the separator below already eats the stop, so
// "Cr" covers "Cr." and "Craw" covers "Craw." — and an Other reference is already searched as the exact citation, so every row it finds cites it.
const CITATION_KEYS = {
  Price: ['Price'], RIC: ['RIC', 'R.I.C'], RRC: ['Crawford', 'Crawf', 'Craw', 'Cr', 'RRC'], SC: ['SC', 'Seleucid Coins'], Bop: ['Bopearachchi'],
};
const citationNumber = ({ catalogue, number }) => {
  if (catalogue === 'RIC') return /^\S*/.exec(squash(number))[0];
  if (catalogue === 'Bop') return bopSeries(number);
  return referenceNumber(catalogue, number);
};
// Between the key and the number: the punctuation and the bracket dealers put there ("Cited as RIC I, 306", "RIC (306)"). No colon, no dash and no
// semicolon — those start the next citation on the line.
const SEP = String.raw`[\s.,(]*`;
// An edition or part mark, on the key or on the volume: "RIC² 306", "RIC2 306", "RIC I(2) 306", "RIC II.1 306".
const EDITION = String.raw`(?:[²³]|\(\d\)|\.\d|\d)?`;
// A ruler or an edition spelled out, between the volume and the number: plain words, or a bracketed phrase of them, each with an optional comma.
// A word holding a digit or ending in a full stop is another citation's, so "RIC -; C. 306" and "RIC 12; Cohen 306" stop here. A bare Roman numeral
// is never a word: it is a volume, and which volumes count is decided above.
const NUMERAL = String.raw`[IVXLC]+`;
const WORD = String.raw`(?:\([\p{L} ]+\)|(?!${NUMERAL}(?![\p{L}\d]))\p{L}+)`;
const RULERS = String.raw`(?:${WORD},?\s+){0,4}`;
// A full-number range that ends at the number ("RIC 305-306"); one that starts at it ("RIC 306-307") already ends at a character no number may hold.
const RANGE = String.raw`(?:\d+\s*[-–]\s*)?`;
// A line about money, not about a type: the key carries one of these words in front of it, or the number is an amount in a currency.
const PRICE_WORDS = ['starting', 'hammer', 'estimate', 'realized', 'realised'];
const CURRENCY = String.raw`(?!\s?(?:(?:USD|EUR|GBP|CHF)(?![\p{L}\d])|[$€£]))`;

// Only RIC carries a volume, and only its own: a card on volume I is not cited by "RIC II 306", while a card without a volume takes any numeral.
function between({ catalogue, volume }) {
  if (catalogue !== 'RIC') return SEP;
  const numeral = /^[IVXLC]+/.exec(squash(volume))?.[0] ?? '';
  return `${EDITION}${SEP}(?:(?:${numeral ? escaped(numeral) : NUMERAL})${EDITION}${SEP})?${RULERS}${SEP}`;
}

// Whether a lot's description cites the searched reference: the catalogue key in any spelling, at most a volume and a ruler between, then the number
// as a whole token — not inside a longer number, a weight or a measurement. "Price 3014", "RIC 3061" and "4.23 g" are not sales of Price 23 or RIC 306,
// nor is a line about the money ("Starting Price: 100 EUR", "Hammer Price 100", "Price 23 EUR"), nor another catalogue's prefixed number ("Price L23").
// A key is read as written or in full capitals, never in lower case. A lettered number is its own type, so "Price 23a" does not cite Price 23 and
// "Seleucid Coins 1266.2a" does not cite SC 1266.2, exactly as "RIC 306a" never cited RIC 306. A row with no description at all is never dropped: the
// page simply says nothing to judge it by. Every part is bounded, so the pattern reads a description once however long it is.
export function citesReference(description, reference) {
  const text = squash(description);
  const keys = Object.hasOwn(CITATION_KEYS, reference?.catalogue) ? CITATION_KEYS[reference.catalogue] : null;
  const number = keys ? citationNumber(reference) : '';
  if (!text || !number) return true;
  const spellings = [...new Set(keys.flatMap((key) => [key, key.toUpperCase()]))].sort((a, b) => b.length - a.length).map(escaped);
  const pattern = `(?<!(?:${PRICE_WORDS.map(eitherCase).join('|')})\\s)(?<![\\p{L}\\d])(?:${spellings.join('|')})`
    + `${between(reference)}${RANGE}(?<![\\p{L}\\d])${eitherCase(number)}(?![\\p{L}\\d])${CURRENCY}`;
  return new RegExp(pattern, 'u').test(text);
}

// The card's own denomination word in a description, whole and whatever its capitals; a plural is tolerated by the two endings that cover the Latin
// and English forms ("denarius"/"denarii", "drachm"/"drachms"). No table of denominations, no translation and nothing else guessed. The match is
// positive only: a row the page gives no description for does not name it, and a card without a denomination filters nothing.
export function namesDenomination(description, denomination) {
  const word = squash(denomination).toLowerCase();
  if (!word) return true;
  const forms = [word, `${word}s`, `${word}es`, ...(word.endsWith('us') ? [`${word.slice(0, -2)}i`] : [])];
  return new RegExp(`(?<![\\p{L}\\d])(?:${forms.map(escaped).join('|')})(?![\\p{L}\\d])`, 'iu').test(squash(description));
}

// The card's denomination as a filter word, or nothing when matching it would say more about English than about the coin: "as" is the conjunction far
// more often than the copper coin, and any short label reads the same way, while a label the catalogue never resolved ("266_aureus", "ae_unit") is no
// word at all. ponytail: short denominations (As, AE units) simply get no filter; telling the coin from the word needs the whole sentence read.
export function filterableDenomination(label) {
  const word = squash(label).toLowerCase();
  return word.length >= 4 && !/[\d_]/.test(word) ? word : '';
}

const FINE = 'Fine and below';
const MINT = 'FDC/Mint State';
export const GRADE_BUCKETS = Object.freeze([FINE, 'VF', 'EF', MINT]);
// The dealer's grade, in the four languages acsearch lists, as the four buckets a collector compares in, each spelled as its own trade writes it.
// A name may also open a sentence, so its first letter counts capitalised too, but nothing else does: a bare lower-case "fine" is the ordinary
// adjective ("a fine portrait", "as fine as any"), never a grade.
const GRADE_NAMES = {
  Fine: FINE, 'schön': FINE, 'très beau': FINE, 'molto bello': FINE,
  'Very Fine': 'VF', 'sehr schön': 'VF', 'très très beau': 'VF', bellissimo: 'VF',
  'Extremely Fine': 'EF', 'vorzüglich': 'EF', superbe: 'EF', splendido: 'EF',
  'Mint State': MINT, Stempelglanz: MINT, 'fleur de coin': MINT, 'fior di conio': MINT,
};
// Read exactly as written: capitals are all that tells "BB" the Italian grade from "BB" the collection, or "st" from the middle of "ist".
const GRADE_MARKS = {
  gF: FINE, aF: FINE, VG: FINE, TB: FINE, MB: FINE, s: FINE,
  VF: 'VF', gVF: 'VF', aVF: 'VF', ss: 'VF', TTB: 'VF', BB: 'VF',
  EF: 'EF', XF: 'EF', gEF: 'EF', aEF: 'EF', vz: 'EF', SUP: 'EF', SPL: 'EF',
  FDC: MINT, MS: MINT, UNC: MINT, st: MINT,
};
// "Good" and "About" qualify a grade without moving it to another bucket, exactly as the gVF and aEF they abbreviate; the name behind one needs no
// capital of its own ("Good very fine").
const GRADE_QUALIFIERS = ['Good', 'About'];
// A name as the pattern reads it: the first letter as the trade writes it or capitalised, every other letter in either case.
const namePattern = (name, opening) => [...name].map((char, index) => {
  const [lower, upper] = [char.toLowerCase(), char.toUpperCase()];
  if (lower === upper) return escaped(char);
  return index === 0 && opening ? (char === upper ? char : `[${lower}${upper}]`) : `[${lower}${upper}]`;
}).join('');
// Longest first, so "Extremely Fine" is one grade and not the word "Fine" inside it.
const alternation = (patterns) => [...patterns].sort((a, b) => b.length - a.length).join('|');
const names = (opening) => alternation(Object.keys(GRADE_NAMES).map((name) => namePattern(name, opening)));
const marks = alternation(Object.keys(GRADE_MARKS).map(escaped));
// A grade is a clause of its own, or it is not a grade: it opens the description or follows one of . ; , : ( / and it closes the description or runs
// into one of . ; , + - ) /. That is what tells the grade in "…with a fine portrait. Good very fine." from the prose in front of it, "ss." from
// "Kassel", and it is why a range reads as its lower grade ("ss-vz" stops at the dash, "VF/EF" gives both and the lower is taken).
const GRADE_PHRASE = new RegExp(`(?<=^|[.;,:(/]\\s?)(?:(?:${GRADE_QUALIFIERS.join('|')})\\s+(?:${names(false)}|${marks})|${names(true)}|${marks})(?=$|[.;,+\\-)/])`, 'gu');
const NAME_BUCKETS = new Map(Object.entries(GRADE_NAMES).map(([name, bucket]) => [name.toLowerCase(), bucket]));
const QUALIFIED = new RegExp(`^(?:${GRADE_QUALIFIERS.join('|')})\\s+`);
const bucketOf = (phrase) => {
  const graded = phrase.replace(QUALIFIED, '');
  return NAME_BUCKETS.get(graded.toLowerCase()) ?? (Object.hasOwn(GRADE_MARKS, graded) ? GRADE_MARKS[graded] : null);
};

// A dealer's grade stands in the first line or two of a description; past this the text is provenance and literature, and reading it only costs time.
const GRADE_LIMIT = 3000;
// The one grade a row is counted under: the lower of two ("VF/EF", "ss-vz"), and null when the description names none. One pass over the text, so a
// long description costs no more per character than a short one.
export function gradeOf(description) {
  const text = squash(description).slice(0, GRADE_LIMIT);
  const found = [...text.matchAll(GRADE_PHRASE)].map((match) => bucketOf(match[0])).filter(Boolean);
  return found.length ? GRADE_BUCKETS[Math.min(...found.map((bucket) => GRADE_BUCKETS.indexOf(bucket)))] : null;
}

// The grade the page read when it arrived; a row from elsewhere is read here, once, rather than once per bucket.
const gradeOfLot = (lot) => (lot.grade === undefined ? gradeOf(lot.description) : lot.grade);

const GRADE_MIN = 3;
// A median per grade, from the rows on show: a bucket resting on fewer than GRADE_MIN counted sales says nothing and is left out.
export function gradeMedians(lots, currency) {
  const graded = new Map(GRADE_BUCKETS.map((bucket) => [bucket, []]));
  for (const entry of lots) graded.get(gradeOfLot(entry))?.push(entry);
  return GRADE_BUCKETS.flatMap((bucket) => {
    const summary = summarise(graded.get(bucket), currency);
    return summary.count >= GRADE_MIN ? [{ bucket, median: summary.median, count: summary.count }] : [];
  });
}
export const gradeText = ({ bucket, median, count }, format) => `${bucket}: median ${format(median)} (${count})`;

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

// What the statistics rest on: the filters leave a row out by default and say why, and the collector's own decisions override them either way.
// Reset drops his decisions, so the default comes back rather than an empty set.
export function createPriceCuration() {
  const byHand = new Map();
  let byDefault = () => null;
  const reasonFor = (lot) => {
    const decided = byHand.get(stableResultId(lot));
    return decided === undefined ? byDefault(lot) ?? null : decided ? 'by-hand' : null;
  };
  return {
    // The filters the panel is drawing with; a redraw sets them before it asks anything.
    filter(reason) { byDefault = reason ?? (() => null); },
    reasonFor,
    exclude(lot) { byHand.set(stableResultId(lot), true); },
    include(lot) { byHand.set(stableResultId(lot), false); },
    isExcluded(lot) { return reasonFor(lot) !== null; },
    included(lots) { return lots.filter((lot) => reasonFor(lot) === null); },
    counts(lots) {
      const excluded = lots.reduce((count, lot) => count + Number(reasonFor(lot) !== null), 0);
      return { included: lots.length - excluded, excluded };
    },
    changed() { return byHand.size > 0; },
    reset() { byHand.clear(); },
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

// acsearch hides a hammer price behind a "*" from a visitor who is not signed in, but a lot that has not been sold yet shows one too, so the stars
// alone told a signed-in collector whose only hits are upcoming lots to sign in again. The page says which it is: its account menu offers the login
// page to a visitor. Only when no marker is there at all do the stars decide, and then only if every lot has already been sold.
// The menu links to the login page from wherever the collector is on the site, so the address is relative on one page and absolute on the next.
const LOGIN_MARKER = /<a\b[^>]*\bhref=["'](?:[^"']*\/)?login\.html(?:[?#][^"']*)?["']/i;
export function signedOutPage(html, lots, now = new Date()) {
  if (!lots.some((entry) => String(entry.price).trim() === '*')) return false;
  if (LOGIN_MARKER.test(String(html ?? ''))) return true;
  const today = localDay(now);
  return lots.every((entry) => {
    const date = saleDate(entry.date);
    return date !== null && date <= today;
  });
}

export async function fetchPrices({ term, currency, category }, options = {}) {
  const { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, now = new Date() } = options;
  try {
    const response = await fetchImpl(buildSearchUrl({ term, currency, category }), { signal: AbortSignal.timeout(timeoutMs), credentials: 'include', cache: 'no-store' });
    if (!response.ok) return { status: 'network' };
    const html = await response.text();
    const lots = extractLots(html);
    // A search without hits comes back as acsearch's "No results found" page, which has no results array at all.
    if (!lots) return /No results found/i.test(html) ? { status: 'empty', term } : { status: 'network' };
    if (lots.length === 0) return { status: 'empty', term };
    // One results page at most; the slice still has PAGE_SIZE entries whenever acsearch returned PAGE_SIZE or more, so `capped` holds. Each lot's
    // grade is read here, once, and travels with it: a redraw would otherwise read every description again, once per bucket.
    const page = lots.slice(0, PAGE_SIZE).map((entry) => ({ ...entry, grade: gradeOf(entry.description) }));
    const summary = summarise(page, currency);
    if (summary.count === 0 && signedOutPage(html, page, now)) return { status: 'signed-out' };
    if (summary.count === 0) return summary.uncounted.length ? { status: 'unpriced', term, examples: summary.uncounted } : { status: 'unpriced', term };
    // The page's lots stay with the result, in memory only, so the popup draws a period from them without another request.
    return { status: 'ok', summary, lots: page };
  } catch {
    return { status: 'network' };
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
export function summaryText(card, summary, currency, term, { period, last, trend, filters = [], grades = [] } = {}) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const { count } = summary;
  const named = period?.years ? ` (${period.label.toLowerCase()})` : '';
  let stats = `Median hammer ${money.format(summary.median)}${named} · middle 50% ${money.format(summary.lowerQuartile)}–${money.format(summary.upperQuartile)}`;
  stats += ` · range ${money.format(summary.min)}–${money.format(summary.max)} · ${count} recorded ${count === 1 ? 'sale' : 'sales'} matching “${term}”`;
  if (summary.earliest !== null) stats += ` · ${summary.earliest === summary.latest ? summary.earliest : `${summary.earliest}–${summary.latest}`}`;
  // What the filters left out, then the sales themselves, then the median of each grade the panel shows.
  const lines = [card.label, stats, ...filters];
  // The date is page text, squashed so a copied line never splits.
  if (last) lines.push(`Last sale ${squash(last.date)} · ${money.format(last.amount)}`);
  if (trend) lines.push(trendText(trend, money.format));
  lines.push(...grades.map((bucket) => gradeText(bucket, money.format)));
  if (summary.uncounted.length) lines.push(`Not counted: ${quoteList(summary.uncounted)}`);
  // A reference without type data has no type page to link to.
  if (card?.corpus && card.corpus !== 'other') lines.push(`https://numismatics.org/${card.corpus}/id/${encodeURIComponent(card.id)}`);
  // Plain text for pasting: Intl puts no-break spaces in amounts such as "CHF 500".
  return lines.join('\n').replace(/[\u00a0\u202f]/g, ' ');
}
