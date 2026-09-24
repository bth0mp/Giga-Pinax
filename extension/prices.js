import { TIMEOUT_MS, bopSeries, kmNumber, realVolumePart, referenceNumber, searchablePart, sgNumber } from './lookup.js';
import { recordFetchFailure } from './core/diagnostics.js';
import { canonicalRicPerson, CATALOGUES, catalogueOf, ricPeople } from './catalogues.js';
import { anyCase } from './lot.js';
import { fnv32, squash } from './core/validate.js';

export const ACSEARCH_ORIGIN = 'https://www.acsearch.info/*';
const SEARCH_URL = 'https://www.acsearch.info/search.html';
const MARKER = 'acsearch.initSearchResults = ';

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

// The most of a reply this ever reads. An acsearch result page is a few hundred kilobytes; the bound is a backstop, since the array's end is found in
// one pass whatever the page holds.
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const [QUOTE, BACKSLASH, OPEN_ARRAY, CLOSE_ARRAY, OPEN_OBJECT, CLOSE_OBJECT] = ['"', '\\', '[', ']', '{', '}'].map((char) => char.charCodeAt(0));

// Where the JSON array opening at `from` closes, read the way JSON writes it: a bracket inside a string is text, and a backslash escapes the character
// behind it, so a "];" in a dealer's description never ends the array. One pass, each character looked at once; -1 when the text ends first.
function arrayEnd(text, from) {
  let depth = 0;
  let quoted = false;
  for (let index = from; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (quoted) {
      if (code === BACKSLASH) index += 1;
      else if (code === QUOTE) quoted = false;
    } else if (code === QUOTE) quoted = true;
    else if (code === OPEN_ARRAY || code === OPEN_OBJECT) depth += 1;
    else if ((code === CLOSE_ARRAY || code === CLOSE_OBJECT) && --depth === 0) return index;
  }
  return -1;
}

// The page inlines its lots as a JSON array behind the marker; its real end is found by arrayEnd and the slice is parsed once.
export function extractLots(html) {
  const text = String(html ?? '').slice(0, MAX_RESULT_BYTES);
  const start = text.indexOf(MARKER);
  if (start < 0) return null;
  const opening = /\s*\[/y;
  opening.lastIndex = start + MARKER.length;
  if (!opening.test(text)) return null;
  const from = opening.lastIndex - 1;
  const end = arrayEnd(text, from);
  if (end < 0) return null;
  let lots;
  try { lots = JSON.parse(text.slice(from, end + 1)); } catch { return null; }
  if (!Array.isArray(lots)) return null;
  // The description comes along: it is what says whether a lot cites the reference at all, what it was graded and what it is called.
  return lots.filter((lot) => lot && typeof lot === 'object').map((lot) => ({
    id: String(lot.id ?? ''), title: String(lot.title ?? ''), date: String(lot.date ?? ''), price: String(lot.price ?? ''), description: String(lot.description ?? ''),
  }));
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
// the king in both spellings, "(Hermaeus Hermaios)" (one word when they agree: Menander), and the series as the exact phrases dealers cite it with,
// either-or: "Bopearachchi 20", the short "Bop. 20" (acsearch ignores the stop inside a phrase) and the French "Bopearachchi Série 20".
// No series (an uncited BIGR type) leaves the bare word Bopearachchi; no king leaves the phrases alone.
const bopKing = (section) => {
  const latin = firstName(section);
  const greek = greekName(latin);
  return latin && greek !== latin ? `(${latin} ${greek})` : latin;
};
function bopTerm(section, number) {
  const series = bopSeries(number);
  const cited = series ? group([phrase('Bopearachchi', series), phrase('Bop', series), phrase('Bopearachchi Série', series)]) : 'Bopearachchi';
  return squash(`${bopKing(section)} ${cited}`);
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
  if (catalogue === 'Bop') return bopTerm(section, number);
  // A catalogue name outside the table is Price's whole row, the typed prefix it strips included, exactly as buildQuery looks one up as Price.
  const name = catalogueOf(catalogue) ? catalogue : 'Price';
  const digits = referenceNumber(name, number);
  // A catalogue whose number other books by the same author also carry names its king beside it, in Latin and Greek, as a Bop search does:
  // "Newell 45" is only Demetrius Poliorcetes's coin in a lot that names Demetrius.
  const { king, termKeys } = CATALOGUES[name];
  return squash(`${king ? bopKing(king) : ''} ${group(termKeys.map((key) => phrase(key, digits)))}`);
}

// The exact phrases the default term looks for, bare, and the first of them as the panel names the reference ("Price 23", "RIC 306"). The citation
// filter judges the reference the card is about, so it may only judge a search that still looks for it: a collector who typed something else
// ("Müller 5") is looking for something else, and every row he found is counted.
export const citationPhrases = (reference) => (defaultTerm(reference).match(/"[^"]*"/g) ?? []).map((quoted) => quoted.slice(1, -1));
export const referenceName = (reference) => citationPhrases(reference)[0] ?? '';
// An edition mark the collector kept on the key or the volume ("RIC I² 306") still searches the card's own citation; the default term leaves it out.
// A stop the dealer wrote after an abbreviated key ("Bop. 24A") is the same citation.
const TERM_MARK = String.raw`(?:[²³.]|\(\d\)|\d)?`;
// A phrase as the term must still hold it: every word of it, the number last and whole. "Price 230" and "RIC 3061" are searches for another type,
// and so is a number a decimal part continues ("Price 23.5").
// The key another catalogue's number follows: what comes after "RIC I, Cohen" is Cohen's number, not RIC's. A small closed list — the keys dealers
// really write beside RIC on one line, and the words they join two citations with — so an unlisted ruler still reads as a ruler.
const OTHER_KEYS = ['Cohen', 'C', 'BMC', 'BMCRE', 'RSC', 'RCV', 'Sear', 'Calicó', 'Calico', 'Hunter', 'Cayón', 'Cayon', 'Not', 'Unlisted', 'unlisted', 'and', 'or'];
// Between a volume numeral and the number the collector may name the ruler, as dealers write it ("RIC I Nero 306", "RIC X Leo I 605"): a few words
// of letters, each with its own regnal numeral, and nothing a number or a sentence could hide in. Another catalogue's key is no ruler ("RIC I Cohen
// 306" searches Cohen 306), and the words are captured so the ruler they name can be held against the card's.
const RULER_WORDS = String.raw`((?:\s+(?!(?:${OTHER_KEYS.join('|')})(?![\p{L}\d]))\p{L}+(?:\s+[IVX]+(?![\p{L}\d]))?){0,3})`;
const searchPattern = (phrase) => {
  const words = squash(phrase).split(' ');
  const last = words.length - 1;
  const body = words.map((word, index) => {
    if (index === last) return escaped(word);
    const bare = word.replace(/,$/, '');
    const written = escaped(bare) + TERM_MARK + (word.endsWith(',') ? ',' : '');
    return index === last - 1 && /^[IVXLC]+$/.test(bare) ? written + RULER_WORDS : written;
  }).join('\\s*');
  return new RegExp(`(?<![\\p{L}\\d])${body}(?![\\p{L}\\d])(?!\\.\\d)`, 'giu');
};
// Whether the words between the volume and the number name another ruler than the card's: "RIC I Galba 306" searches Galba's coin, not Nero's. A
// run of them that names the card's own ruler settles it ("Nero Augustus", "Leo I"); otherwise a run naming anybody RIC knows is somebody else. A
// card without a section, and words that name nobody (a mint), have nothing to hold against each other.
function namesOtherRuler(words, section) {
  const card = squash(section);
  const tokens = squash(words).split(' ').filter(Boolean);
  if (!card || tokens.length === 0) return false;
  const own = new Set([...ricPeople(card), ...ricPeople(card.replace(/\s*\([^)]*\)$/, ''))].map(({ id }) => id));
  let other = false;
  for (let from = 0; from < tokens.length; from += 1) {
    for (let to = from + 1; to <= tokens.length; to += 1) {
      const people = ricPeople(tokens.slice(from, to).join(' '));
      if (people.some(({ id }) => own.has(id))) return false;
      if (people.length) other = true;
    }
  }
  return other;
}
export function searchesReference(term, reference) {
  const phrases = citationPhrases(reference);
  const text = squash(term);
  return phrases.length === 0 || phrases.some((phrase) => [...text.matchAll(searchPattern(phrase))]
    .some((match) => match[1] === undefined || !namesOtherRuler(match[1], reference.section)));
}

// v0.12's Bop default ("Hermaeus Bopearachchi 20") was stored under the type whenever Get prices ran, so it would hide the new default for good;
// a remembered term that is exactly that old default counts as unsaved, and so does 0.32's single phrase ("(Hermaeus Hermaios) "Bopearachchi 20"")
// now that the series is searched in every spelling. Anything else the collector saved still wins.
const oldBopTerms = ({ section, number }) => [squash(`${firstName(section)} Bopearachchi ${bopSeries(number)}`),
  squash(`${bopKing(section)} "Bopearachchi ${bopSeries(number)}"`)];
// The same for the unquoted defaults of 0.31 and before, which 0.32's exact phrases replace: the bare ruler and number, "Price 23", "Crawford 44/5",
// "SC 1266.2". An Other reference has searched as phrases since 0.19, so it has no old default to retire.
function oldDefaultTerms(reference) {
  const { catalogue, number, section, rulers } = reference;
  if (catalogue === 'Bop') return oldBopTerms(reference);
  if (catalogue === 'RIC') {
    const people = Array.isArray(rulers) && rulers.length === 1 ? canonicalRicPerson(rulers[0]) : '';
    return [squash(`${squash(section).replace(/\s*\([^)]*\)$/, '') || people} ${squash(number)}`)];
  }
  // The key each of the rest was written under, which is the first of the phrases the default term now offers.
  const [key] = catalogueOf(catalogue)?.termKeys ?? [];
  return key ? [squash(`${key} ${referenceNumber(catalogue, number)}`)] : [];
}
export function chooseTerm(reference, saved) {
  const term = squash(saved);
  // A term saved before 0.22 for text now read as prose is that whole sentence: it would search acsearch for it again, so it goes with the default.
  const none = reference.catalogue === 'Other' && !defaultTerm(reference);
  if (!term || none || oldDefaultTerms(reference).includes(term)) return defaultTerm(reference);
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
// What the coverage line and the copy say of the rows summarise left out for a sale day still ahead; nothing when there are none.
export const futureText = ({ future = 0 }) => (future ? `${future} future-dated ${future === 1 ? 'lot' : 'lots'} not counted` : '');
const EXAMPLE_LIMIT = 5;

// A row dated after the collector's own today has not been sold, whatever its price field holds (a starting price, an estimate): it is no sale and
// is never counted, only told apart as future. A row with no readable date is not placed in time, so it is counted as before.
export function summarise(lots, currency, now = new Date()) {
  const today = localDay(now);
  const parsed = lots.map((entry) => ({ ...entry, amount: parsePrice(entry.price, currency) }));
  const ahead = (entry) => (saleDate(entry.date) ?? today) > today;
  const priced = parsed.filter((entry) => entry.amount !== null && !ahead(entry));
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
    // Lots whose price reads but whose sale day is still ahead: not sales, so not counted, and said apart from both.
    future: parsed.filter((entry) => entry.amount !== null && ahead(entry)).length,
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

// The spellings dealers write each key in are the table's citationKeys. A key ending in a full stop needs no entry of its own — the separator below
// already eats the stop, so "Cr" covers "Cr." and "Craw" covers "Craw." — and an Other reference is already searched as the exact citation, so every
// row it finds cites it and the table gives it no keys.
// Bopearachchi is cited "Bop." as often as spelled out; the short key is read here beside the table's.
const citationKeys = (reference) => {
  const keys = catalogueOf(reference?.catalogue)?.citationKeys ?? null;
  return keys && reference.catalogue === 'Bop' ? [...keys, 'Bop'] : keys;
};
// Crawford writes a moneyer's issue and its type with a slash ("344/1a"); some German houses write a hyphen there. A hyphen is read as the slash only
// where it cannot be a range: in front of a lettered type ("344-1a"), or of one a shortened range would count down to ("385-4" would be 385 to 384).
// "44-5" and "344-5" are how a dealer shortens 44–45 and 344–345, which may be two types, so they keep citing nothing.
const CRAWFORD = /^(\d+)\/(\d+)([a-z]*)$/i;
function numberPattern(catalogue, number) {
  const [, issue, type, letter] = (catalogue === 'RRC' && CRAWFORD.exec(number)) || [];
  if (!issue) return eitherCase(number);
  const shortened = Number(`${issue.slice(0, Math.max(0, issue.length - type.length))}${type}`);
  return `${eitherCase(issue)}${letter || shortened <= Number(issue) ? '[/-]' : '\\/'}${eitherCase(`${type}${letter}`)}`;
}
const citationNumber = ({ catalogue, number }) => {
  if (catalogue === 'RIC') return /^\S*/.exec(squash(number))[0];
  if (catalogue === 'Bop') return bopSeries(number);
  return referenceNumber(catalogue, number);
};
// Between the key and the number: the punctuation dealers put there ("Cited as RIC I, 306", "R.I.C. 306"). No colon, no dash and no semicolon — those
// start the next citation on the line. One group, and never two of them side by side: two split a run of separators between themselves every way there
// is, which is what made 'RIC ' followed by 100,000 full stops cost seconds. The bracket of "RIC (306)" belongs to the number and is taken there.
const SEP = String.raw`[\s.,]*`;
// An edition mark, on the key or on the volume: "RIC² 306", "RIC2 306", "RIC I(2) 306", "RIC I (2) 306".
// "(2nd ed.)" is the bracket abbreviated ("RIC I (2nd ed.) 306"); "(second edition)" spelled out reads as a bracketed word below.
const EDITION = String.raw`(?:[²³]|\s?\(\d\)|\s?\(\d(?:st|nd|rd|th)\.?\s?ed(?:ition|n?\.)?\)|\d)?`;
// A ruler or an edition spelled out, between the volume and the number: plain words, or a bracketed phrase of them, each with an optional comma, and
// a ruler may carry his own regnal numeral ("RIC X Leo I 605"). A word holding a digit or ending in a full stop is another citation's, so
// "RIC -; C. 306" and "RIC 12; Cohen 306" stop here. A bare Roman numeral is never a word of its own: it is a volume, and which volumes count is
// decided above.
const NUMERAL = String.raw`[IVXLC]+`;
const WORD = String.raw`(?:\([\p{L} ]+\)|(?!(?:${NUMERAL}|${OTHER_KEYS.join('|')})(?![\p{L}\d]))\p{L}+)`;
const RULERS = String.raw`(?:${WORD}(?:\s+${NUMERAL}(?![\p{L}\d]))?,?\s+){0,4}`;
// A volume published in parts, as the dealer punctuates it: "RIC IV-1", "RIC IV/1", "RIC II.1", "RIC IV, part I,".
const PART_NUMERALS = Object.freeze({ 1: 'I', 2: 'II', 3: 'III', 4: 'IV' });
const partPattern = (forms) => String.raw`(?:[-/.](?:${forms})|,?\s*[Pp]art\s+(?:${forms}),?)?`;
// The types a dealer lists behind one key before the one being looked for ("RIC 305-306", "RIC 304, 305, 306"); a list that starts at the number
// ("RIC 306-307") already ends at a character no number may hold. Bounded, so a page of digits costs no more per character than a line of them.
const LIST = String.raw`(?:\d+[a-z]?\s*[-–,]\s*){0,8}`;
// A line about money, not about a type: the key carries one of these words in front of it, or the number is an amount, a measurement or a die axis.
const PRICE_WORDS = ['starting', 'start', 'opening', 'reserve', 'asking', 'sale', 'hammer', 'estimate', 'estimated', 'realized', 'realised'];
const CURRENCY = String.raw`(?:USD|EUR|GBP|CHF|AUD)(?![\p{L}\d])|[Ee]uros?(?![\p{L}\d])|US\$|[$€£]`;
// The weight, the diameter and the die axis a dealer prints beside a lot's number.
const UNIT = String.raw`(?:mm|cm|gr|g|h)(?![\p{L}\d])`;
// A decimal part, a "23,-", a currency or a unit behind the number says it is money or a measurement. A comma and three or more digits is the next
// type in the dealer's list rather than a decimal: no amount is written "23,307".
const NOT_AMOUNT = String.raw`(?![.,]-)(?!\.\d)(?!,\d{1,2}(?!\d))(?!\s?(?:${CURRENCY}))(?!\s(?:${UNIT}))`;

// The part of a volume the card names ("II, Part 1", "II.1"), which the dealer may write as a digit or as a numeral. A card whose volume names no
// part takes a citation with any part, but a card that names one takes only its own: volume II part 1's 123 is not part 3's.
function volumeParts(volume) {
  const part = /\bpart\s+([\dIVX]+)/i.exec(volume)?.[1] ?? /^[IVXLC]+[./-](\d)/.exec(volume)?.[1] ?? '';
  if (!part) return String.raw`\d|[IVX]{1,4}`;
  const other = PART_NUMERALS[part] ?? Object.keys(PART_NUMERALS).find((digit) => PART_NUMERALS[digit] === part.toUpperCase()) ?? '';
  return [...new Set([part, other].filter(Boolean))].map(escaped).join('|');
}

// Only RIC carries a volume, and only its own: a card on volume I is not cited by "RIC II 306", while a card without a volume takes any numeral.
// A ".1", "-1" or "/1" glued to the numeral is that volume's part and nothing else — the guard behind the part makes it impossible to leave one
// unread and answer with its digit, which is how "RIC IV.1 266" came to cite a card on RIC IV type 1. A volume RIC does not publish in parts has no
// part to leave unread, so there a full stop is only the separator CGB writes ("RIC.I.53"); a hyphen or a slash still is not.
// A volume published in parts may be written in Arabic figures with its part ("RIC 2.1 356"), and only with it: "RIC 2 306" is as likely to be the
// second edition of volume I spaced out as volume II.
const ROMAN_NUMERALS = Object.freeze(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);
const publishedInParts = (numeral) => ['1', '2', '3'].some((part) => realVolumePart(numeral, part));
function between({ catalogue, volume }) {
  // A French dealer puts the word for series between Bopearachchi and the number ("Bopearachchi Série 24A").
  if (catalogue === 'Bop') return `${SEP}(?:[Ss][ée]rie${SEP})?`;
  if (catalogue !== 'RIC') return SEP;
  const text = squash(volume);
  const numeral = /^[IVXLC]+/.exec(text)?.[0] ?? '';
  const part = partPattern(volumeParts(text));
  // The volume may be introduced as one ("RIC vol. I 306"), and volume I written as a digit ("RIC 1 306"). Only I: "RIC 2 306" is as likely to be the
  // second edition of volume I spaced out as volume II.
  const figure = ROMAN_NUMERALS.indexOf(numeral) + 1;
  const written = numeral === 'I' ? '(?:I|1)' : numeral && publishedInParts(numeral) ? `(?:${escaped(numeral)}|${figure}(?=[-/.]\\d))`
    : numeral ? escaped(numeral) : NUMERAL;
  const guard = numeral && !publishedInParts(numeral) ? '(?![-/]\\d)' : '(?![-/.]\\d)';
  return `${EDITION}${SEP}(?:(?:[Vv]ol\\.?\\s?)?${written}${EDITION}${part}${EDITION}${guard}${SEP})?${RULERS}`;
}

// A citation stands in the line or two a dealer describes the coin in; past this the text is a group lot's literature, and reading it only costs time.
const CITATION_LIMIT = 10000;

// Whether there is anything to judge a row by at all: an Other reference is already searched as the exact citation, and a reference without a number
// has no citation to look for, so their rows all count and the panel offers no filter to switch off.
export const filtersCitations = (reference) => Boolean(citationKeys(reference)) && Boolean(citationNumber(reference));

// Whether a lot's description cites the searched reference: the catalogue key in any spelling, at most a volume and a ruler between, then the number
// as a whole token — not inside a longer number, a weight or a measurement. "Price 3014", "RIC 3061" and "4.23 g" are not sales of Price 23 or RIC 306,
// nor is a line about the money ("Starting Price: 100 EUR", "Hammer Price 100", "Price 23 EUR"), nor another catalogue's prefixed number ("Price L23").
// A key is read as written or in full capitals, never in lower case. A lettered number is its own type, so "Price 23a" does not cite Price 23 and
// "Seleucid Coins 1266.2a" does not cite SC 1266.2, exactly as "RIC 306a" never cited RIC 306. A row with no description at all is never dropped: the
// page simply says nothing to judge it by. Every repetition is bounded and no two of them may consume the same characters, so the pattern reads a
// description once; the text is cut to CITATION_LIMIT first, as the grade reader cuts its own, so no page of literature is ever read whole.
export function citesReference(description, reference) {
  const text = squash(description).slice(0, CITATION_LIMIT);
  const keys = citationKeys(reference);
  const number = keys ? citationNumber(reference) : '';
  if (!text || !number) return true;
  const spellings = [...new Set(keys.flatMap((key) => [key, key.toUpperCase()]))].sort((a, b) => b.length - a.length).map(escaped);
  const pattern = `(?<!(?:${PRICE_WORDS.map(eitherCase).join('|')})\\s)(?<![\\p{L}\\d])(?:${spellings.join('|')})`
    + `${between(reference)}${LIST}\\(?(?<![\\p{L}\\d])${numberPattern(reference.catalogue, number)}(?![\\p{L}\\d])${NOT_AMOUNT}`;
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
// "AU" ("About Uncirculated") sits between EF and Mint State, which is a bucket the four do not have; the top bucket is where it counts, and the
// label says so. FDC, Stempelglanz and Uncirculated count there too — the label names the bucket, it does not list the grades in it.
const MINT = 'AU/Mint State';
export const GRADE_BUCKETS = Object.freeze([FINE, 'VF', 'EF', MINT]);

// Class 1. The English abbreviations, exactly as the trade writes them: nothing else in a lot description is spelled this way, so a closing edge is
// all they need. The British houses capitalise the qualifier ("GVF", "NEF") and NAC writes "Fdc" in mixed case; the capitals are still exact, so
// "gvf" and "fdc" stay prose.
const ABBREVIATIONS = { gF: FINE, aF: FINE, VG: FINE, VF: 'VF', gVF: 'VF', aVF: 'VF', EF: 'EF', XF: 'EF', gEF: 'EF', aEF: 'EF', FDC: MINT, UNC: MINT, AU: MINT,
  Fdc: MINT, GVF: 'VF', NVF: 'VF', nVF: 'VF', GEF: 'EF', NEF: 'EF', nEF: 'EF', aUNC: MINT, AUNC: MINT };
// Class 2. The names spelled out, a closing edge again enough — but the phrase must carry a capital somewhere: an all-lower-case "very fine" is the
// ordinary adjective, and only a range whose first half was read lends it a grade's standing.
const NAMES = {
  'Very Fine': 'VF', 'Extremely Fine': 'EF', 'Mint State': MINT, Uncirculated: MINT, 'Brilliant Uncirculated': MINT,
  Stempelglanz: MINT, 'fleur de coin': MINT, 'fior di conio': MINT, 'très très beau': 'VF',
};
// Class 3. Bare "Fine", the one name that is also an everyday adjective: it needs an opening edge (or one of a short list of qualifiers) as well, and
// never stands in front of the words a compliment carries on with. "Fair", the grade below it, is as ordinary a word ("a fair portrait") and is read
// by the same rule.
const BARE_FINE = { Fine: FINE, Fair: FINE };
// Class 4. The two-letter marks. Both edges, because each of them is also a monogram, a collection, a control mark or a pair of initials. The Spanish
// (BC, MBC, EBC, SC: bien, muy bien, extraordinariamente bien conservada, sin circular) and the Dutch (ZF zeer fraai, PR prachtig) are marks too.
// So are the other short spellings, for the same reason: the American "BU" and NGC's "Gem MS", the German "Stgl" (Stempelglanz), "prfr"
// (prägefrisch) and "sge" (sehr gut erhalten, below schön), the Italian "Spl" and the Spanish "S/C", which is SC with its slash.
const MARKS = { ss: 'VF', vz: 'EF', st: MINT, BB: 'VF', MB: FINE, TB: FINE, MS: MINT, SPL: 'EF', SUP: 'EF', TTB: 'VF',
  BC: FINE, MBC: 'VF', EBC: 'EF', SC: MINT, ZF: 'VF', PR: 'EF',
  BU: MINT, 'Gem MS': MINT, 'Gem BU': MINT, Stgl: MINT, prfr: MINT, Prfr: MINT, sge: FINE, Spl: 'EF', 'S/C': MINT };
// Class 5. The foreign adjectives that are also ordinary praise. Both edges, and the phrase must start its clause: "Patina sehr schön" and "Ritratto
// bellissimo" praise the coin, "Sehr schön." grades it.
// "prägefrisch" is the Austrian trade's Stempelglanz, written in lower case mid-sentence as "vorzüglich" is.
const PRAISE = { 'sehr schön': 'VF', 'vorzüglich': 'EF', superbe: 'EF', splendide: 'EF', splendido: 'EF', bellissimo: 'VF', 'molto bello': FINE, 'très beau': FINE, beau: FINE,
  'zeer fraai': 'VF', prachtig: 'EF', 'prägefrisch': MINT };
// Class 7. The marks that are a word of their own far more often than a grade: German "s." is "siehe", see; a lone "F" is an initial; and "schön" is
// what a dealer calls any pretty coin, as Dutch "fraai" is. Each is read only as a half of a range with another grade, or directly behind a grade
// label.
const RANGE_ONLY = { s: FINE, F: FINE, 'schön': FINE, fraai: FINE };
const EXACT = { ...ABBREVIATIONS, ...MARKS, s: RANGE_ONLY.s, F: RANGE_ONLY.F };
const SPELLED = { ...NAMES, ...BARE_FINE, ...PRAISE, 'schön': RANGE_ONLY['schön'], fraai: RANGE_ONLY.fraai };
const SPELLED_BUCKETS = new Map(Object.entries(SPELLED).map(([name, bucket]) => [name.toLowerCase(), bucket]));

// A qualifier in front of a grade keeps its bucket, exactly as the gVF and aEF it abbreviates, and gives a mark the opening edge it needs. Read in
// either case, since a dealer writes "fast vz" as readily as "Fast vorzüglich"; it is the capital rule above, not the qualifier, that keeps prose out.
const GRADE_QUALIFIERS = ['Near', 'Nearly', 'Almost', 'About', 'Good', 'Choice', 'Ch', 'Superb', 'Nice', 'Toned', 'otherwise', 'sonst',
  'Fast', 'Gutes', 'Knapp', 'Buon', 'Presque', 'Casi', 'NGC', 'PCGS'];
// The qualifiers bare "Fine" takes in place of an opening edge.
const FINE_QUALIFIERS = /^(?:About|Good|Near|Nearly|Almost|Choice)\b/i;
// The slabbers: only their line prints a score behind the grade.
const SLABBERS = /\b(?:NGC|PCGS)\b/;

// A word is read whatever its capitals with lot.js's anyCase, as a heading's names are. (eitherCase above reads a catalogue number, where a full stop
// is also the comma dealers write.)
// Longest first, so "Extremely Fine" is one grade and not the word "Fine" inside it, and "About Uncirculated" is not "Uncirculated".
const alternation = (patterns) => [...patterns].sort((a, b) => b.length - a.length).join('|');
const TOKENS = alternation([...Object.keys(EXACT).map(escaped), ...Object.keys(SPELLED).map(anyCase)]);
// The Italian "q" ("quasi") and "m" ("migliore di") bind straight onto the mark they qualify (qBB, qSPL, q.FDC, mBB); every other qualifier is a word
// of its own. Both keep the bucket, as a qualifier does. The "m" is read in lower case only and only in front of a capital, so the "mss" of a
// manuscript and a monogram's own capitals are never a qualified mark.
const QUALIFIER = `(?:(?:${alternation(GRADE_QUALIFIERS.map(anyCase))})[.,]?\\s+|[qQ]\\.?|m(?=\\p{Lu}))`;
// A slab prints its strike and surface scores behind the grade ("NGC Choice VF 5/5 - 4/5"), and a numeric grade its number ("MS 63"); a star marks the
// eye appeal. The number may be glued to the grade as often as spaced ("PCGS MS63", "NGC AU58"). Whether the tail may be read at all is decided
// below — behind a slabber, or at the very start of the text, and nowhere else; anywhere else a glued number leaves no closing edge.
const SLAB = String.raw`★?(?:\s?\d{1,2}(?:/\d{1,2})?)?`;
// The qualifiers are lazy, so a name a qualifier stands in front of is read as that name qualified ("About Uncirculated" is Uncirculated with the
// qualifier every qualifier keeps: the same bucket), whatever the dealer's capitals.
const GRADE_CANDIDATE = new RegExp(`(?<![\\p{L}\\d])((?:${QUALIFIER}){0,2}?)(${TOKENS})(\\+*)(${SLAB})(?![\\p{L}\\d])`, 'gu');

// How far to either side an edge is looked for. Both are bounded, so one pass over a description costs the same per character however long it is.
const EDGE = 24;
// The closing edge, which is what tells a grade from prose: "a fine portrait." and "the BB collection." run into a word, "Good very fine." does not.
// A quote the dealer wrapped the grade in, the asterisk or star he footnotes it with, and the "though" his reservation opens with all close one too.
// The weight, diameter or die axis a dealer prints behind the grade closes one too ("VF 3.41 g", "Fine 12 h."); the bare number that follows a grade
// in "Slg. vz 12." is a lot number, and without one of those units nothing closes there.
const CLOSES = new RegExp(String.raw`^$|^[.;,+\-)/!:"“”*★]|^\s[-–(+&/]|^\sà(?![\p{L}\d])|^\s\d{1,3}(?:[.,]\d{1,3})?\s?${UNIT}`
  + String.raw`|^\s(?:and|for|with|to|bis|but|though|or|details|obv|obverse|rev|reverse|revers|avers|rs|av|dritto|rovescio)(?![\p{L}\d])`, 'iu');
// "AU" is the chemical symbol for gold as often as it is "About Uncirculated", so a gold lot that never graded anything was counted in the top
// bucket. Three shapes say the metal is meant: the weight or diameter printed behind it ("Solidus. AU 4.45 g.", "Aureus. AU, 7.25 g.", "AU. 4.45g."), the
// bracket it stands in behind "Gold" ("Gold (AU) solidus"), and the denomination it follows ("Byzantine. Solidus. AU."). A die axis is no such tail —
// "AU 12 h." is the grade with the axis behind it — and a slab's own line is never read this way, since "Solidus. NGC AU 58" is what NGC graded.
// The weight may stand behind a comma, a full stop, an opening bracket or both ("AU. 4.45g.", "AU (4.45 g)", "AU. (4.45 g, 20 mm)"), and be spelled
// "grams" or "gm": the metal, then its measurements.
const METAL_TAIL = new RegExp(String.raw`^(?:[,.]?\s?\(?\s?)\d{1,3}(?:[.,]\d{1,3})?\s?(?:mm|cm|grams?|gr|gm|g)(?![\p{L}\d])`, 'u');
const GOLD_BRACKET = /(?<![\p{L}\d])gold\s*\(\s*$/iu;
// The denominations a dealer writes the metal behind. A closed list, as every other word list here is: any word at all would take the grade off a
// row that really was graded.
const DENOMINATION_BEFORE = new RegExp(String.raw`(?<![\p{L}\d])(?:solidus|aureus|tremissis|semissis|stater|nomisma|histamenon|hyperpyron|siliqua`
  + String.raw`|miliarense|denarius|antoninianus|sestertius|dupondius|follis|tetradrachm|didrachm|drachm|obol|quinarius|dinar)\.?[\s,]*$`, 'iu');
const metalAu = (before, tail) => METAL_TAIL.test(tail) || (GOLD_BRACKET.test(before) && tail.startsWith(')'))
  || DENOMINATION_BEFORE.test(before);

// The opening edge a mark needs, and the narrower one a praise adjective needs: it must start its clause, so a word of the same clause may not stand
// in front of it.
const OPENS = /[.;,:(/]\s*$/;
const PRAISE_OPENS = /[.;,:/]\s*$/;
// The side a dealer names before a grade, which opens a clause of its own ("Obverse VF, reverse Fine.", "Av. ss, Rs. s", "Vz. ZF, Kz. PR"). The
// Dutch voorzijde, "Vz.", is not one: it is spelled as the German grade vz.
const SIDE = String.raw`(?:obverse|obv|reverse|rev|avers|revers|av|rs|vs|kz|dritto|rovescio)`;
const SIDE_OPENS = new RegExp(String.raw`(?<![\p{L}\d])${SIDE}\.?\s+$`, 'iu');
const SIDE_GAP = new RegExp(String.raw`^[\s,.]*${SIDE}\.?[\s,.]*$`, 'iu');
// A grade behind an explicit label is the row's grade, whatever the text goes on to say ("Grade: VF. Notes: EF for the type").
// A Spanish house labels it "Conservación".
const LABEL = /(?:Erhaltung|Grade|Condition|Conservaci[oó]n)\s*:?\s*$/i;
// Two grades a range separator joins are one statement, read as the lower of the two.
const RANGE_GAP = /^\s*(?:[-–/]|to|bis|à)\s*$/i;
// So are two grades a plain "and" joins, which is how a group lot grades its coins ("Lot of 2 coins. VF and EF.", "BB e SPL", "MBC y EBC"): the
// lower one is what the lot is worth. The word lends the second grade neither a capital nor a range-only mark's standing, so "Good VF and fine for
// the type" and "vz und s. Anm." are not ranges; and only English "and" closes a grade by itself: "und", "e", "et" and "y" close one only where the
// next grade token follows them, since "AU y AR" is gold and silver.
const RANGE_WORD = /^\s+(?:and|und|e|et|y)\s+$/i;
const joins = (gap) => RANGE_GAP.test(gap) || RANGE_WORD.test(gap);
// A mark in brackets is a control mark or a catalogue's own aside ("Cohen 302 (MB)."), and one behind a colon that follows an all-lower-case word is a
// label's value ("control: TB."); neither is a grade. A capitalised label is the collector's own ("Erhaltung: ss", "Rev: MS").
const LOWER_COLON = /(?<![\p{L}\d])\p{Ll}+:\s*$/u;
// A mark a comma sets behind a place on the coin is the control letters struck there, not a grade: "in left field, MB.", "in exergue, TB.",
// "monogram below, TTB.", "below throne, MB.", "im Abschnitt, TB.", "in esergo, TB.". A comma behind anything else still opens a mark ("Patina
// verde, BB.", "Leicht korrodiert, ss."). "links" and "rechts" are not in the list, since a German dealer grades straight behind the bust's
// direction ("Kopf links, ss."), so "Im Feld links, MB." still reads as a grade.
const PLACE_COMMA = /(?<![\p{L}\d])(?:field|exergue|ex|left|right|below|above|beneath|under|monogram|control|controls|throne|wreath|Feld|Abschnitt|campo|esergo|champ)\.?\s*,\s*$/iu;
// What bare "Fine" may not stand in front of: the compliment a dealer pays the dies ("Fine Style", "Fine-style"), the "and" that joins it to one, and
// a comma opening an adjective and its noun ("Fine, high-relief portrait", "of Fine, elegant workmanship").
const FINE_PROSE = /^(?:\s+and(?![\p{L}\d])|[-\s][Ss]tyle(?![\p{L}\d])|,\s+\p{Ll}+[- ]\p{Ll}+)/u;
const CAPITAL = /\p{Lu}/u;
// "SC" is also the senate's mark on a Roman bronze ("Rev. SC, legend around.", "Minerva standing right; SC."), so as the Spanish sin circular it must
// open the text or a sentence (never one a side label opens, nor one behind a sentence ending in a lower-case word, which is the type described:
// "Rev. Spes advancing left. SC.", "Rev.: Roma sentada. SC."), or stand behind a qualifier, a grade label or another grade it joins. A spaced dash
// or a bracket behind it is a Seleucid Coins citation's own aside ("SC –; cf. ESM 123.", "SC (unlisted)"): the type is not in the book.
const DESCRIBED = /(?<![\p{L}\d])\p{Ll}\p{L}*\.\s*$/u;
// The Spanish spelling with its slash is the same mark, and a legend is split across the field the same way ("S/C").
const SENATE = new Set(['SC', 'S/C']);
const CITATION_ASIDE = /^\s[-–(]/;
// Áureo & Calicó close a lot with the weight or a remark and then the grade ("27,23 g. S/C.", "Brillo original. S/C."): a sentence ending in a
// measurement, or in one of a closed list of Spanish remark words, describes no type, so the Spanish spelling with its slash opens there. "SC" keeps
// the senate's rule, since a Roman bronze's weight is followed by its reverse as often.
const SPANISH_CLOSE = /(?:\d\s?(?:g|gr|mm)|(?<!\p{L})(?:original|bella|bello|pátina|patina|brillo|rara|escasa|atractiva))\.\s*$/iu;
const senateFree = (token, start, before, quals, joined, tail) => !CITATION_ASIDE.test(tail) && (start === 0
  || (/\.\s*$/.test(before) && !SIDE_OPENS.test(before) && (!DESCRIBED.test(before) || (token === 'S/C' && SPANISH_CLOSE.test(before))))
  || quals !== '' || joined || LABEL.test(before));
// A grade quoted from an earlier sale is the provenance's, not this lot's: "(where described as "Good VF")", "there graded VF", "catalogued as VF".
// It is no statement at all, so it can neither be the last one nor join a range, and the grade a range separator joins to it is the provenance's
// too ("there described as VF/EF"). "NGC graded AU" is the slab's own grade and stays.
const PROVENANCE_GRADE = /(?<![\p{L}\d])(?:(?:described|catalogued|cataloged|offered|sold|listed)\s+as|(?:there|where|previously|formerly)\s+graded|graded\s+there)\s*["“']?\s*$/iu;

const BARE_FINE_NAMES = new Set(Object.keys(BARE_FINE).map((name) => name.toLowerCase()));
const kindOf = (token) => {
  if (Object.hasOwn(RANGE_ONLY, token)) return 'range-only';
  if (Object.hasOwn(ABBREVIATIONS, token)) return 'abbreviation';
  if (Object.hasOwn(MARKS, token)) return 'mark';
  const spelled = token.toLowerCase();
  if (Object.hasOwn(RANGE_ONLY, spelled)) return 'range-only';
  if (BARE_FINE_NAMES.has(spelled)) return 'bare-fine';
  return Object.hasOwn(PRAISE, spelled) ? 'praise' : 'name';
};
const bucketOf = (token) => EXACT[token] ?? SPELLED_BUCKETS.get(token.toLowerCase()) ?? null;

// A dealer's grade stands in the first line or two of a description; past this the text is provenance and literature, and reading it only costs time.
const GRADE_LIMIT = 3000;
const lower = (buckets) => GRADE_BUCKETS[Math.min(...buckets.map((bucket) => GRADE_BUCKETS.indexOf(bucket)))];

// The one grade a row is counted under. Every token the four trades write is found in a single pass; each is then kept or dropped by the edges around
// it, read from a bounded window, so a long description costs no more per character than a short one. Grades a range separator or a named side joins
// are one statement, worth the lower of the two ("VF/EF", "ss-vz", "Obverse VF, reverse Fine."); of several separate statements the last one counts,
// since a dealer closes with his grade, unless one of them stands behind an explicit grade label. A row this cannot read comes out null.
export function gradeOf(description) {
  const text = squash(description).slice(0, GRADE_LIMIT);
  const candidates = [...text.matchAll(GRADE_CANDIDATE)];
  const ends = [];
  const statements = [];
  let previous = null;
  // The end of the last provenance grade passed over, so its range partner is passed over with it.
  let quoted = null;
  for (const [index, match] of candidates.entries()) {
    const start = match.index;
    const [, quals, token, plus, slab] = match;
    const before = text.slice(Math.max(0, start - EDGE), start);
    // The slab's own tail is read only where a slab prints one: behind NGC or PCGS in the same clause, or as the numeric Mint State grade opening the
    // text ("MS 63"). Anywhere else " 12" behind a grade is a lot number or a weight ("Slg. vz 12.", "Very Fine 17.23 g").
    const slabbed = SLABBERS.test(quals) || SLABBERS.test(before.split(/[.;:(]/).pop()) || (start === 0 && (token === 'MS' || token === 'Gem MS'));
    const end = start + quals.length + token.length + plus.length + (slabbed ? slab.length : 0);
    ends.push(end);
    const tail = text.slice(end, end + EDGE);
    // The metal, not the grade: the lot says what the coin is made of and grades nothing.
    if (token === 'AU' && !slabbed && metalAu(before, tail)) continue;
    if (PROVENANCE_GRADE.test(before) || (quoted !== null && start - quoted <= EDGE && joins(text.slice(quoted, start)))) {
      quoted = end;
      continue;
    }
    // On a slab "PR" is Proof, not the Dutch prachtig: no bucket here is a proof's.
    if (token === 'PR' && slabbed) continue;
    if (!CLOSES.test(tail) && !joinsNext(candidates, index, end, text)) continue;
    const gap = previous === null ? '' : text.slice(previous.end, start);
    const joinable = previous !== null && gap.length <= EDGE;
    const signed = joinable && RANGE_GAP.test(gap);
    const ranged = signed || (joinable && RANGE_WORD.test(gap));
    const sided = joinable && SIDE_GAP.test(gap);
    const opened = start === 0 || OPENS.test(before) || SIDE_OPENS.test(before);
    const capital = CAPITAL.test(quals + token) || signed;
    const kind = kindOf(token);
    const rest = text.slice(start + quals.length + token.length);
    let read = false;
    if (kind === 'abbreviation') read = true;
    // A qualifier stands in for the capitals: a dealer who writes "otherwise very fine" or "nearly extremely fine" all in lower case is grading the
    // coin, where the bare lower-case "very fine" is the ordinary adjective. The closing edge still has to be there.
    else if (kind === 'name') read = capital || quals !== '';
    else if (kind === 'bare-fine') read = capital && !FINE_PROSE.test(rest) && (opened || ranged || sided || FINE_QUALIFIERS.test(quals));
    else if (kind === 'mark') read = (opened || ranged || sided || quals !== '') && !(before.endsWith('(') && rest.startsWith(')')) && !LOWER_COLON.test(before)
      && !PLACE_COMMA.test(before) && (!SENATE.has(token) || senateFree(token, start, before, quals, ranged || sided, tail));
    // A foreign adjective and a class-7 mark are lower case wherever a German or Italian dealer writes them mid-sentence, so the capital rule cannot
    // reach them: what tells them from praise is the clause they open, and the range or label they stand in.
    else if (kind === 'praise') read = start === 0 || PRAISE_OPENS.test(before) || signed;
    else read = signed || sided || LABEL.test(before) || opensRange(candidates, ends, index, text);
    if (!read) continue;
    const bucket = bucketOf(token);
    previous = { end };
    // Every token the reader knows has a bucket, so a range or a named side always has the statement of its first half to join.
    if (ranged || sided) statements.at(-1).buckets.push(bucket);
    else statements.push({ buckets: [bucket], labelled: LABEL.test(before) });
  }
  const labelled = statements.filter((statement) => statement.labelled);
  const counted = (labelled.length ? labelled : statements).at(-1);
  return counted ? lower(counted.buckets) : null;
}

// Whether a class-7 mark opens a range: the next token a grade may be read as follows it across a range separator or a named side ("s-ss", "F/VF",
// "Av. s, Rs. ss"). Only the token beside it is looked at, so this stays one step per candidate.
function opensRange(candidates, ends, index, text) {
  const next = candidates[index + 1];
  if (!next || Object.hasOwn(RANGE_ONLY, next[2]) || Object.hasOwn(RANGE_ONLY, next[2].toLowerCase())) return false;
  const gap = text.slice(ends[index], next.index);
  return gap.length <= EDGE && (RANGE_GAP.test(gap) || SIDE_GAP.test(gap));
}

// Whether a joining word stands between this token and the next ("ss und vz"). Only the token beside it is looked at, as in opensRange.
function joinsNext(candidates, index, end, text) {
  const next = candidates[index + 1];
  return Boolean(next) && next.index - end <= EDGE && RANGE_WORD.test(text.slice(end, next.index));
}

// The grade the page read when it arrived; a row from elsewhere is read here, once, rather than once per bucket.
const gradeOfLot = (lot) => (lot.grade === undefined ? gradeOf(lot.description) : lot.grade);

const GRADE_MIN = 3;
// A median per grade, from the rows on show: a bucket resting on fewer than GRADE_MIN counted sales says nothing and is left out.
export function gradeMedians(lots, currency, now = new Date()) {
  const graded = new Map(GRADE_BUCKETS.map((bucket) => [bucket, []]));
  for (const entry of lots) graded.get(gradeOfLot(entry))?.push(entry);
  return GRADE_BUCKETS.flatMap((bucket) => {
    const summary = summarise(graded.get(bucket), currency, now);
    return summary.count >= GRADE_MIN ? [{ bucket, median: summary.median, count: summary.count }] : [];
  });
}
// One line per bucket or year, as the ledger reads it: the label, the median, the sales it rests on, one separator throughout ("VF · $260 · 3 sales").
const sales = (count) => `${count} ${count === 1 ? 'sale' : 'sales'}`;
export const gradeText = ({ bucket, median, count }, format) => `${bucket} · ${format(median)} · ${sales(count)}`;

// How much of the counted sample the buckets say nothing about: a bucket of three beside a median of forty is a thin reading unless the panel says
// how many rows carry no grade a dealer wrote. Nothing to say when every row is graded.
export function ungradedText(lots) {
  const without = lots.filter((entry) => gradeOfLot(entry) === null).length;
  return without ? `${without} of ${lots.length} ${lots.length === 1 ? 'result carries' : 'results carry'} no grade` : '';
}

// A row's id within one provider's results; both providers are curated now, so which one a row came from is the caller's to say.
export function stableResultId(lot, provider) {
  if (lot?.id !== undefined && lot?.id !== null && String(lot.id).trim()) return `${provider}:${String(lot.id).trim()}`;
  const source = [lot?.title, lot?.date, lot?.price].map((value) => String(value ?? '').trim()).join('\u001f');
  return `${provider}:derived:${fnv32(source).toString(36)}`;
}

// What the statistics rest on: the filters leave a row out by default and say why, and the collector's own decisions override them either way.
// Reset drops his decisions, so the default comes back rather than an empty set.
export function createPriceCuration(provider) {
  const byHand = new Map();
  let byDefault = () => null;
  const reasonFor = (lot) => {
    const decided = byHand.get(stableResultId(lot, provider));
    return decided === undefined ? byDefault(lot) ?? null : decided ? 'by-hand' : null;
  };
  return {
    // The filters the panel is drawing with; a redraw sets them before it asks anything.
    filter(reason) { byDefault = reason ?? (() => null); },
    reasonFor,
    exclude(lot) { byHand.set(stableResultId(lot, provider), true); },
    include(lot) { byHand.set(stableResultId(lot, provider), false); },
    isExcluded(lot) { return reasonFor(lot) !== null; },
    // Whether the collector himself counted this row, whatever a filter says of it: such a row counts in the filter's own "N of M".
    includedByHand(lot) { return byHand.get(stableResultId(lot, provider)) === false; },
    included(lots) { return lots.filter((lot) => reasonFor(lot) === null); },
    counts(lots) {
      const excluded = lots.reduce((count, lot) => count + Number(reasonFor(lot) !== null), 0);
      return { included: lots.length - excluded, excluded };
    },
    changed() { return byHand.size > 0; },
    // What Reset would leave counted: the panel only offers it as the way back when it would bring a sale back.
    defaultIncluded(lots) { return lots.filter((lot) => (byDefault(lot) ?? null) === null); },
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

// A sale's day as the workspace writes a date-only auction day, "2026-10-12"; nothing when the page gives no readable date. A time the page gives
// ("28.07.2026 14:00") is left out: the day is all that is carried.
export const isoDay = (text) => saleDate(text)?.toISOString().slice(0, 10) ?? '';

// The lots acsearch lists that have not been sold yet: a sale day after the collector's own today, whatever the price field holds (summarise never
// counts one), or today with no price at all (the same test summarise counts "without a price" by): a lot sold today already shows its price.
// Soonest first, the next sale at the top; a tie keeps page order.
export function upcomingLots(lots, now) {
  const today = localDay(now);
  return lots.map((entry, index) => ({ entry, index, date: saleDate(entry.date) }))
    .filter(({ entry, date }) => date !== null && date >= today && (date > today || !/\d/.test(entry.price)))
    .sort((a, b) => a.date - b.date || a.index - b.index)
    .map(({ entry }) => entry);
}

// How many lots are coming up and the first day one is sold, as the copy says it. Nothing when none is.
export function upcomingText(lots) {
  if (!lots.length) return '';
  const first = lots.map((entry) => isoDay(entry.date)).sort()[0];
  return `Upcoming: ${lots.length} ${lots.length === 1 ? 'lot' : 'lots'}, first on ${first}`;
}

const YEAR_MIN = 3;
// A median per calendar year of sale, over whatever rows the caller counts (the median's own: the same filters, hand decisions and period). A year
// resting on fewer than YEAR_MIN counted sales says nothing and is left out, as a thin grade bucket is; a lot without a readable date has no year.
// Oldest first. One provider and one currency per call: nothing here pools them.
export function mediansByYear(lots, currency, now = new Date()) {
  const byYear = new Map();
  for (const entry of lots) {
    const year = saleDate(entry.date)?.getUTCFullYear();
    if (year === undefined) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(entry);
  }
  return [...byYear.keys()].sort((a, b) => a - b).flatMap((year) => {
    const summary = summarise(byYear.get(year), currency, now);
    return summary.count >= YEAR_MIN ? [{ year, median: summary.median, count: summary.count }] : [];
  });
}
export const yearText = ({ year, median, count }, format) => `${year} · ${format(median)} · ${sales(count)}`;
// The strip's accessible name: one sentence, year by year.
export const yearsSentence = (years, format) => (years.length
  ? `Median by year: ${years.map(({ year, median, count }) => `${year}, ${format(median)} from ${count} ${count === 1 ? 'sale' : 'sales'}`).join('; ')}.` : '');

const TREND_MIN = 3;
// Recent sales against earlier ones, whatever period is on show: the counted sales of the last 2 years (the same boundary as its button) and those
// before, each median trusted only when it rests on at least TREND_MIN sales. A lot without a readable date belongs to neither side.
export function trendOf(lots, currency, now) {
  const recentLots = lotsInPeriod(lots, '2y', now);
  const recent = summarise(recentLots, currency, now);
  const earlier = summarise(lots.filter((entry) => saleDate(entry.date) && !recentLots.includes(entry)), currency, now);
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

// A provider's reply is untrusted, so it is read through a byte bound rather than whole: a declared length past it is refused unread, and a stream is
// cut off the moment it passes it. Either throws 'too-large'. CoinArchives decodes strictly; acsearch is read as the browser reads a page (fatal: false).
export async function boundedText(response, maxBytes, { fatal = true } = {}) {
  const decode = (bytes) => new TextDecoder('utf-8', { fatal }).decode(bytes);
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > maxBytes) { await response.body?.cancel?.(); throw new Error('too-large'); }
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('too-large');
    return decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('too-large'); }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return decode(bytes);
}

// The most of an acsearch reply read at all: twice the results text extractLots reads, and several times a real result page.
export const ACSEARCH_MAX_BYTES = 4 * 1024 * 1024;

export async function fetchPrices({ term, currency, category }, options = {}) {
  const { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, now = new Date(), maxBytes = ACSEARCH_MAX_BYTES } = options;
  try {
    const response = await fetchImpl(buildSearchUrl({ term, currency, category }), { signal: AbortSignal.timeout(timeoutMs), credentials: 'include', cache: 'no-store' });
    if (!response.ok) { void recordFetchFailure('acsearch', response); return { status: 'network' }; }
    let html;
    try { html = await boundedText(response, maxBytes, { fatal: false }); }
    catch (error) { if (error?.message === 'too-large') { void recordFetchFailure('acsearch', error, { bytes: maxBytes }); return { status: 'network', reason: 'too-large' }; } throw error; }
    const lots = extractLots(html);
    // A search without hits comes back as acsearch's "No results found" page, which has no results array at all.
    if (!lots) return /No results found/i.test(html) ? { status: 'empty', term } : { status: 'network' };
    if (lots.length === 0) return { status: 'empty', term };
    // One results page at most; the slice still has PAGE_SIZE entries whenever acsearch returned PAGE_SIZE or more, so `capped` holds. Each lot's
    // grade is read here, once, and travels with it: a redraw would otherwise read every description again, once per bucket.
    const page = lots.slice(0, PAGE_SIZE).map((entry) => ({ ...entry, grade: gradeOf(entry.description) }));
    const summary = summarise(page, currency, now);
    // A page without a counted price still lists the lots not sold yet, so its lots come back with it for the Upcoming list.
    if (summary.count === 0 && signedOutPage(html, page, now)) return { status: 'signed-out', lots: page };
    if (summary.count === 0) return { status: 'unpriced', term, ...(summary.uncounted.length ? { examples: summary.uncounted } : {}), lots: page };
    // The page's lots stay with the result, in memory only, so the popup draws a period from them without another request.
    return { status: 'ok', summary, lots: page };
  } catch (error) {
    void recordFetchFailure('acsearch', error);
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
// A search term as the panel and the copy say it: in curly quotes, unless the term already carries punctuation of its own. A default term is written
// in acsearch's own syntax — exact phrases in straight quotes, alternatives in brackets — and a second pair round it read as “"RIC 237"” and
// “Nero ("RIC 306" …)”. What the collector typed is quoted as any other phrase is.
export const quotedTerm = (term) => (/["()]/.test(term) ? term : `“${term}”`);

// The copy follows the panel: a period other than All (a PERIODS entry) is named on the stats line, then come the last sale and the trend, which the
// popup takes from the whole page whatever the period.
export function summaryText(card, summary, currency, term, { period, last, trend, filters = [], grades = [], ungraded = '', years = [], upcoming = [] } = {}) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const { count } = summary;
  const named = period?.years ? ` (${period.label.toLowerCase()})` : '';
  let stats = `Median hammer ${money.format(summary.median)}${named} · middle 50% ${money.format(summary.lowerQuartile)}–${money.format(summary.upperQuartile)}`;
  stats += ` · range ${money.format(summary.min)}–${money.format(summary.max)} · ${count} recorded ${count === 1 ? 'sale' : 'sales'} matching ${quotedTerm(term)}`;
  if (summary.earliest !== null) stats += ` · ${summary.earliest === summary.latest ? summary.earliest : `${summary.earliest}–${summary.latest}`}`;
  // What the filters left out, then the sales themselves, then the median of each grade the panel shows.
  const lines = [card.label, stats, ...filters];
  // The date is page text, squashed so a copied line never splits.
  if (last) lines.push(`Last sale ${squash(last.date)} · ${money.format(last.amount)}`);
  if (trend) lines.push(trendText(trend, money.format));
  lines.push(...grades.map((bucket) => gradeText(bucket, money.format)));
  if (ungraded) lines.push(ungraded);
  lines.push(...years.map((year) => yearText(year, money.format)));
  if (upcoming.length) lines.push(upcomingText(upcoming));
  if (summary.future) lines.push(futureText(summary));
  if (summary.uncounted.length) lines.push(`Not counted: ${quoteList(summary.uncounted)}`);
  // A reference without type data has no type page to link to.
  if (card?.corpus && card.corpus !== 'other') lines.push(`https://numismatics.org/${card.corpus}/id/${encodeURIComponent(card.id)}`);
  // Plain text for pasting: Intl puts no-break spaces in amounts such as "CHF 500".
  return lines.join('\n').replace(/[\u00a0\u202f]/g, ' ');
}
