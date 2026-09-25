import { squash } from './core/validate.js';
import { recordFetchFailure } from './core/diagnostics.js';
import { CATALOGUES, canonicalRicPerson, catalogueOf, isMintOnly, isRicPerson, isSectionOnly, RIC_SECTIONS, RIC_VOLUMES, ricMintSection, ricPeople, rulerKey, volumeFor, volumesOf } from './catalogues.js';

// The clean-up a lot row and a typed reference share, so both read the same text the same way. It lives here because lot.js is built on this module.
// Remarks a dealer adds that no search wants, rarity ("(R2)", "(RRR)", "(Very scarce)") and equivalence ("(= BMC 319)") too: no OCRE number ends in
// R to RRR, R2 or C, while a capital type letter ("509 (BB)") is one and stays.
export const REMARKS = /\s*\((?:this coin|misdescribed)[^()]*\)|\s+passim(?![\p{L}])|\s*\([^()]*(?:[$€£]|\b(?:EUR|USD|CHF|GBP)\b)[^()]*\)|\s*\((?:R{1,3}|R\d|C\d?|(?:very |extremely )?(?:rare|scarce))\)|\s*\(\s*=[^()]*\)/giu;
export const VARIANT = /\s*\bvar\.?(?:\s*\([^()]*\))?$/i;
// The edition a dealer brackets after the number ("Hendin 1243 (6th ed.)") is a remark on the book, not part of the number. Anchored to the end of the
// reference, since the same bracket inside one is a RIC volume ("RIC I (2nd ed.) Nero 306"), and OCRE lists no plain "I". The German houses write
// it "(2. Aufl.)", "(2. Auflage)" or unbracketed "2. Aufl." (Rauch, Frühwald), and the French "(2e éd.)". Only the second edition in those two
// languages: it is the one the bundle holds, and a first edition's number read as the second's would be another coin. The unbracketed one needs its
// space, so a number ending in 2 ("RIC 3062. Aufl.") keeps its figure.
export const EDITION = /(?:\s*\(\s*(?:\d+(?:st|nd|rd|th)\s+eds?\.?|2\.\s*Aufl(?:\.|age)|2(?:e|ème)\s+[ée]d\.?)\s*\)|\s+2\.\s*Aufl\.?)(?=\s*[.,;:]*\s*$)/i;
// On RIC the mark says which edition's numbers the citation uses, and RIC I, II.1 and II.3 are bundled in their second alone: a second-edition mark
// is carried onto such a volume (withEdition), and any other ("RIC I 306 (1st ed.)") stays on the number, which then finds nothing rather than the
// second edition's coin of that number.
export const SECOND_EDITION = /2nd|2\.|2e|2ème/i;
const ricEdition = (text, mark) => /^R\.?I\.?C/i.test(text) && !SECOND_EDITION.test(mark);
// A reference as a search reads it: glued keys spaced whatever the house's separator ("RIC.112", "Sear-734", "RIC:972"), "RIC²" as RIC, "V-1" as V.1,
// a range's first number, Pr as Price. Price alone is excluded from the colon spelling: it is the one typed key that is also the English word a
// dealer puts in front of a hammer amount ("Price:1,200"), and spacing that would turn a sold price into a PELLA type lookup.
// The range is the one step a caller may keep: the number as the dealer wrote it is what withRange carries to the index, since OCRE titles types
// over a range too. One fixed run at one position, as every other step here is.
const RANGE = /(\d+[a-z]?)-(?:\d+[a-z]?|[a-z])(?=$|\s)/i;
// Tauler & Fau and Áureo glue the volume on with the same hyphen, the key in capitals or in title case ("RIC-II 118", "(Ric-II 118)", "Ric-I 306"),
// never in lower case: only a volume numeral RIC has may follow it.
const GLUED_VOLUME = /^(?:RIC|Ric)[-–](?=(?:X|IX|VIII|VII|VI|V|IV|III|II|I)(?![\p{L}\d]))/u;
export const readable = (text, shortenRange = true) => {
  const spelled = text.replace(/^RIC²/, 'RIC').replace(GLUED_VOLUME, 'RIC ').replace(/^(?!Price:)(\p{L}[\p{L}/]*)[.:#-](?=\d)/u, '$1 ').replace(/(?<=\s)([IVX]+)-(\d)(?!\d)/, '$1.$2');
  return (shortenRange ? spelled.replace(RANGE, '$1') : spelled).replace(/^Pr\s+(?=\d)/, 'Price ');
};
// A bracket naming a section of some RIC volume ("(Elagabalus)", "(Vespasian)"), or null. On a RIC reference readType reads it as the section; on
// any other catalogue it is a remark the row drops.
export const sectionBracket = (text) => [...String(text).matchAll(/\s*\(([^()]+)\)/g)].find((match) => volumesOf(match[1]).length > 0) ?? null;

export const HOST_ORIGINS = Object.freeze(['https://numismatics.org/*', 'https://nomisma.org/*']);
export const TIMEOUT_MS = 15000;

const ORDINALS = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth' };
const norm = (value) => squash(value).toLowerCase();
// The hidden characters dealer pages add (soft hyphens, zero-width and direction marks, bidi controls, word joiners, a byte order mark) would split a
// copied reference inside a word; parseReference and a right-click selection drop them first. NBSP and other Unicode spaces are squashed as spaces.
export const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

// Every SCO record lives at sc.1.{number}, whatever the volume part of Seleucid Coins it belongs to.
const SCO_ID = 'sc.1.';
// The record a reference names outright, for the catalogues whose records are identified by the number itself: SC's above; a CPE number is part 1's
// (cpe.1_1.330) unless Lorber's B says it is part 2's (cpe.1_2.B549), a letter after it being part of the number and its case kept, since 506A and
// 506a are two types; a Newell number is its Demetrius Poliorcetes type (newell.demetrius.45).
const RECORD_IDS = Object.freeze({
  SC: (number) => `${SCO_ID}${number}`,
  CPE: (number) => (number.startsWith('B') ? `cpe.1_2.${number}` : `cpe.1_1.${number}`),
  Newell: (number) => `newell.demetrius.${number}`,
});
// The number as the corpus writes it: Lorber's B is a capital whoever typed it.
const catalogueNumber = (catalogue, number) => {
  const digits = referenceNumber(catalogue, number);
  return catalogue === 'CPE' ? digits.replace(/^b(?=\d)/, 'B') : digits;
};
// Bopearachchi (1991) references resolve through BIGR, whose own numbering ("Euthydemus I 13.1") differs from Bopearachchi's series ("Euthydème I 24A");
// the series is read from each record's NUDS XML, which is where BIGR keeps the citation.
const BIGR = 'bigr';
const BIGR_TITLE = 'Bactrian and Indo-Greek Coinage ';
const BOP_KEY = 'http://nomisma.org/id/bopearachchi-1991';
// Any other reference ("BCD Boiotia 174b; HGC 4, 1218") has no open type database: its card is its own text, and only acsearch is searched.
const OTHER = 'other';
// Hits verified per lookup, all in one getNuds request inside the shared deadline; a bare series such as "9C" has 16 hits.
const VERIFY_LIMIT = 24;

// Stray quotes would unbalance the quoted phrase search; curly ones arrive when a reference is copied from prose.
const unquote = (value) => squash(String(value ?? '').replace(/["“”„]/g, ''));
// A volume as OCRE titles it, the edition spelled out: "I (2nd edition)" is "I (second edition)".
const ocreVolume = (volume) => unquote(volume).replace(/\b(1st|2nd|3rd|4th)\b/gi, (match) => ORDINALS[match.toLowerCase()]);

// A typed catalogue prefix ("RRC 44/5", "Cr. 44/5", "Craw. 44/5", "Price 23", "SC 1266.2", "Bop. 24A") would otherwise be doubled in the query and
// the acsearch term. It is stripped only before the number itself, so "Crawfrd 44/5" or "Cr . 44/5" stay as typed.
export function referenceNumber(catalogue, number) {
  const value = unquote(number);
  const prefix = catalogueOf(catalogue)?.prefixPattern;
  return prefix ? value.replace(prefix, '') : value;
}

// Bopearachchi series letters are upper case in BIGR's citations ("24A"), so a typed "24a" is normalised before it is searched or compared.
export const bopSeries = (number) => referenceNumber('Bop', number).toUpperCase();

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
// "Bop Euthydemus I 24A", "Bopearachchi 9C", "Bop-9C" (prefix first, king optional) or "Euthydemus I Bop. 24A", "Euthydemus I, Bop 24A" (king first).
// The king starts with a non-digit and holds no digit; the series is the last token and starts with a digit. "Bop" must end the word, so "Bopearachi 9C" fails.
// A French dealer writes the word for series between the key and the number ("Bopearachchi Série 6C"), which is no king. Nor is anything a king that
// starts with the "&" or "and" a co-author is joined by: "Bopearachchi & Rahman 268" cites Pre-Kushana Coins in Pakistan, another book (below).
const BOP = String.raw`(?:Bopearachchi|Bop\.?)(?![a-z])`;
// "Séries" too, the plural a dealer writes over a run of them.
const SERIES_WORD = String.raw`S[ée]ries?\s+`;
const KING = String.raw`(?!&|and\s)([^\d\s][^\d]*?)`;
const BOP_REFERENCE = new RegExp(String.raw`^(?:${BOP}[\s-]*(?:${SERIES_WORD})?(?:${KING}\s+)?|${KING}\s*,?\s*${BOP}[\s-]*(?:${SERIES_WORD})?)(\d\S*)$`, 'i');
// Bopearachchi with a co-author joined on ("& Rahman", "and Rahman", "-Rahman") is another book with no type data here: an Other reference, its own
// citation searched for its prices, never a Bop type of the king "& Rahman". Read case-sensitively, since the co-author's name has its capital.
const BOP_COAUTHORED = /^(?:Bopearachchi|Bop\.?)(?:\s*&\s*|\s+and\s+|-)\p{Lu}\p{L}+/u;
// RIC, optional "vol.", volume I–X or 1–10 (not followed by a letter or digit, so "XI" fails), optional part (".3", "/3", ",3", ", Part 3", " part 3",
// or in Roman numerals after the word, ", part I"), optional second-edition marker, then the ruler or mint section if any (starting with a non-digit,
// so "RIC I 2 Nero 306" fails) and finally the last token starting with a digit, with an optional parenthetical. The number is separated as the section is, by spaces or by a
// comma: dealers punctuate a volume the way they punctuate HGC's ("RIC III, 394a" beside "HGC 4, 1218"). Both separators are a fixed run at one place,
// so neither alternative can be entered twice and the pattern stays linear.
const RIC_REFERENCE = /^RIC\s*(?:vol\.?\s*)?(X|IX|VIII|VII|VI|V|IV|III|II|I|10|[1-9])(?![a-z\d])(?:\s*(?:([./,])\s*(?:part\s*)?|part\s*)(\d(?!\d)|(?<=part\s*)(?:IX|VIII|VII|VI|V|IV|III|II|I)(?![a-z\d])))?(\s*(?:²|\(2\)|\(2nd ed(?:ition|\.)?\)|2nd ed(?:ition|\.)?|\(second edition\)))?(?:(?:\s*,\s*|\s+)([^\d\s].*?))?(?:\s*,\s*|\s+)(\d\S*(?: \([^)]*\))?)$/i;
// No volume: "RIC 972", "RIC Titus 123" or a bare "Titus 123", the number as above. The ruler must be one OCRE has, or the name of one it splits
// into sections ("Theodosius II" for its East and West), checked by volumesOf, so "RIC hello 5", "RIC XI Nero 1" and "Euthydemus I 24A" stay unread,
// and a number alone needs the RIC prefix.
const RIC_ANY_VOLUME = /^(?:RIC(?![a-z])\s*(?:([^\d\s].*?)\s+)?|([^\d\s].*?)\s+)(\d\S*(?: \([^)]*\))?)$/i;
const MAX_REFERENCE = 120;
// The parts RIC's own volume division gives a numeral, as this repository evidences it and no further: RIC_VOLUMES (catalogues.js) lists II, Part 1
// and II, Part 3 as volumes of their own, the bundled OCRE titles and ids carry a part for no other numeral, and nothing here says how the rest of
// the set is bound. RIC V is the one addition, settled before this table existed: dealers cite V.1 and V.2, and OCRE merges the two into one V, so
// both are read and the lookup asks for V entire. RIC IV is bound in three parts, cited IV.1, IV.2 and IV.3, and OCRE keeps that volume whole as it
// keeps V, so all three are read and the lookup asks for IV entire. A part outside the table is not this book's, so the citation carrying it is
// left unread.
const VOLUME_PARTS = new Map([['II', new Set(['1', '3'])], ['IV', new Set(['1', '2', '3'])], ['V', new Set(['1', '2'])]]);
export const realVolumePart = (numeral, part) => Boolean(VOLUME_PARTS.get(String(numeral).toUpperCase())?.has(part));
// Text that begins like a supported catalogue, or like a title of one (BIGR's, which Recent chips and suggestions carry), is never Other: unread there it
// is a typo ("Bopearachi 9C", "Crawfrd 44/5", "RIC XI Nero 1") and stays an error, as does text without a letter or a digit ("hello", "Price", "972").
// A short name must end its word, so catalogues that only share its letters ("Ricci", "Schulten", "SCBI", Sydenham's "CRR", "Craig") are Other.
const SUPPORTED = new RegExp(`^(?:(?:RIC|RRC|SC|SCO|Cr)(?![a-z])|Craw|Price|Seleucid|Bop|${BIGR_TITLE.trim()})`, 'i');
// Nor is a numbered part that names one after other words ("cf. RIC 972", "Lot 80: RIC 972", "cf. Craw. 44/5"), which would search a type as loose
// text; "RIC –" (not in RIC) has no number. The Crawford names are the ones RRC's prefixPattern reads.
const NAMED = /(?:^|[^\p{L}])(?:RIC|R\.I\.C|RRC|Cr|Craw(?:f|ford)?|Price|SC|Seleucid|Bop|Bopearachchi)(?!\p{L})/iu;
// K-02: whether text sets out to name a catalogue — it begins like one of the supported catalogues, or a part of it names one with a number — so that
// text the lookup cannot read is a misspelt reference, answered with the spellings, rather than free words a collector typed to find a coin.
export function namesCatalogue(text) {
  const value = String(text ?? '').replace(INVISIBLE, '').trim();
  return SUPPORTED.test(value) || value.split(';').some((part) => /\d/.test(part) && NAMED.test(part));
}

// Sentence punctuation a selection drags along ("RIC 972;", "Hadrian 12,"); no catalogue's number ends in it.
const unpunctuate = (value) => value.replace(/\s*[.,;:]+$/, '');
// A reference as read: without that punctuation, nor the brackets or single quotes a dealer wraps it in ("(RIC 972)", "‘Price 23’."); brackets that
// only end it stay ("266 (aureus)", "174b (this coin)").
const unwrap = (value) => unpunctuate(unpunctuate(value.trim()).replace(/^[(\[‘']([^()[\]‘’']*)[)\]’']$/, '$1').trim());

// Sear's Greek Coins and Their Values ("SG 6829", "SG6829v", "SGCV 6829", "GCV 6829", "Sear Greek 6829") has no type data, but one spelling, "SG n"
// with " var." for a variety's "v" or "var.", lets prices.js search it as dealers cite it ("Sear 6829"). A key must end at the number, so "SGI 123"
// (Sear Greek Imperial) is no SG; a letter other than v is the number's own ("SG 6829a"). unwrap has dropped a final "." ("var"), which comes back.
// SGCV's volume goes ("SGCV II 6829": the numbers run on across both) only before a space or comma, so "SGCV 26829" stays whole; a dot or dash may
// follow the key ("SG.6829", "SG–6829": the Reference box keeps the en dash). The author's name in front of his own abbreviation is redundant but
// common, and lot text joins the two keys ("Sear GCV 2757"), so it is read and dropped; "Sear 6829" alone is his Roman or Byzantine number, not SG.
const SG_REFERENCE = /^(?:Sear\s+)?(?:(?:SGCV|GCV)(?:\s+(?:II?|[12])(?=[\s,]))?,?|SG|Sear\s+Greek)[\s.\-–]*(\d+)([a-z]?)(\s*var\.?)?$/i;
export function sgNumber(value) {
  const [, digits, letter, varied] = String(value ?? '').match(SG_REFERENCE) ?? [];
  if (!digits) return null;
  const variety = letter.toLowerCase() === 'v';
  return `SG ${digits}${variety ? '' : letter.toLowerCase()}${variety || varied ? ' var.' : ''}`;
}
// Krause & Mishler's Standard Catalog of World Coins ("KM# 123", "KM 123", "KM#123", "KM-123", "KM.123") is the reference for world and modern coins.
// It has no open type data either, so a KM reference is prices only, like SG. The number is an optional letter prefix, digits, an optional ".n" and an
// optional letter ("123", "123.2", "123.2a", "A123"), normalised as the catalogue writes it. A separator after the key is required, so "KM123" and
// "KMS1" are no KM, and the lookahead-free word break falls out of it: "AKM 5" has no key at the start. A KM number repeats across countries, so a
// country typed in front ("Netherlands KM# 123", "German States Rostock KM# 123") is kept, as typed: up to four letter-only words, which narrow the search.
// Y# is Krause's own older numbering (Yeoman), the same catalogue family in the same shape, so it is read the same way and keeps its own key.
const KM_REFERENCE = /^((?:\p{L}+ ){0,4})(KM|Y)[#.\-–\s]+([a-z]?\d+(?:\.\d+)?[a-z]?)$/iu;
export function kmNumber(value) {
  const [, country = '', key = '', number] = squash(value).match(KM_REFERENCE) ?? [];
  if (!number) return null;
  // The key pattern matches case-insensitively over Unicode, so a letter that folds to ASCII (KELVIN SIGN, long s) reaches here: read it back the same
  // way and fail closed, never throwing on a Reference box the collector is typing into.
  const [, prefix = '', digits, suffix = ''] = number.match(/^(\p{L}?)([\d.]+)(\p{L}?)$/u) ?? [];
  if (!digits) return null;
  return `${country}${key.toUpperCase()}# ${prefix.toUpperCase()}${digits}${suffix.toLowerCase()}`;
}
// A real citation is short: a ";" part of more words than this is prose ("Good VF, 3.21 g, 6h, lot 42, ... bought in Vienna"), which acsearch would
// search as one exact phrase and median unrelated lots. A part still needs a letter and a digit to name anything; a trailing remark ("174b (this
// coin)") is prices.js's to drop, so it is dropped here too and its words go uncounted. prices.js filters the card's parts by the same rule, so the
// card, its search term and this box's error always agree.
const MAX_PART_WORDS = 7;
// A group lot cites several numbers under one key ("SNG von Aulock 5960, 5961, 5962, 5963, 5964", "HGC 4, 1218, 1219, 1220"): that trailing run is one
// citation, so it counts as one word. Prose is alphabetic where the run is not, so it is still counted whole and refused.
const oneCitation = (text) => text.replace(/(\d[\w.\/-]*)(?:\s*,\s*\d[\w.\/-]*)+$/, '$1');
export const searchablePart = (part) => {
  const text = squash(part).replace(/(\S)\s*\([^)]*\)$/, '$1');
  return /\p{L}/u.test(text) && /\d/.test(text) && oneCitation(text).split(' ').length <= MAX_PART_WORDS;
};

// An Other text with its SG and KM parts in those spellings; any other text is kept as it is.
const otherPart = (part) => sgNumber(part) ?? kmNumber(part);
const otherNumber = (value, parts = value.split(';').map(unwrap)) => (parts.some(otherPart) ? parts.map((part) => otherPart(part) ?? part).join('; ') : value);

// References are ";"-separated ("SC 2195.5c; SNG Spaer 1712"): the first one a type rule reads is looked up, else the whole text is Other.
// The hidden characters go before anything else, the length cap included.
// The clean-up belongs to text a person wrote: a dealer's row or a typed reference. An OCRE title is the catalogue's own spelling and is read with
// `clean` false — 653 of them are titled over a range ("RIC II.3² Hadrian 1009-1012"), and taking each down to its first number made it a second
// claim on a number some other type really carries.
export function parseReference(text, clean = true) {
  const visible = String(text ?? '').replace(INVISIBLE, '');
  if (squash(visible).length > MAX_REFERENCE) return null;
  const value = unwrap(unquote(visible));
  const parts = value.split(';').map(unwrap);
  for (const part of parts) {
    // An en or em dash is the hyphen prose writes a range with ("RIC II Hadrian 1009–1012"), and lot text has always read it so. Only the type rules
    // read it that way: an Other reference is its own card and keeps the dash it was written with.
    const type = readType(part.replace(/[–—]/g, '-'), clean);
    if (type) return type;
  }
  // A part that is Bopearachchi's co-authored book names no supported catalogue, however it begins, and with whatever dash it is joined: the type
  // rules above read an en dash as the hyphen, so this does too.
  const coauthored = (text) => BOP_COAUTHORED.test(text.replace(/[–—]/g, '-'));
  const supported = (SUPPORTED.test(value) && !coauthored(value)) || parts.some((part) => /\d/.test(part) && NAMED.test(part) && !coauthored(part));
  return parts.some(searchablePart) && !supported ? { catalogue: 'Other', number: otherNumber(value, parts), volume: '', section: '' } : null;
}

// The remark a dealer hangs on a corrected number ("RIC II 123 corr.") is no part of it. Its brothers "var." and the bracketed remarks are REMARKS
// and VARIANT above; unwrap has already taken the full stop off the end.
export const CORRECTION = /\s+corr\.?$/i;
// The marks the clean-up above reads: a bracket or sentence punctuation to drop, a house's own separator or a "²" to respell, a hyphen that opens a
// range, a word a dealer hangs on a number, or the "Pr" that is Price. One class, matched once, in place of running the whole chain.
const CLEANABLE = /[(),;:.#²-]|\b(?:var|corr|passim)\b|^Pr\s/i;

// The whole of that clean-up, in one place, so a lot row and a typed reference are cleaned once each and in the same way: the remarks, the variety,
// the edition and the correction a dealer hangs on a number, then the house's own separators, "RIC²", a hyphenated volume and a range's first number.
// Every part of it needs one of CLEANABLE's marks to change anything, so text carrying none ("RIC VII Antioch 1") skips the chain whole.
function cleanReference(text, shortenRange = true) {
  const written = String(text).trim();
  if (!CLEANABLE.test(written)) return written;
  const remarked = unpunctuate(written.replace(VARIANT, '').replace(REMARKS, '').replace(EDITION, (mark) => (ricEdition(written, mark) ? mark : ''))
    .replace(CORRECTION, ''));
  return CLEANABLE.test(remarked) ? readable(remarked, shortenRange) : remarked;
}

// The edition a RIC citation wrote after its number, carried onto the volume where OCRE holds that volume in its second edition alone: "RIC I 306
// (2nd ed.)", "(2. Aufl.)", "(2e éd.)" are RIC I² 306, which opens, and never an unedited "RIC I" the lookup can only offer.
export function withEdition(reference, written) {
  if (reference?.catalogue !== 'RIC') return reference;
  const mark = String(written ?? '').replace(VARIANT, '').replace(CORRECTION, '').replace(/[\s.,;:]+$/, '').match(EDITION)?.[0];
  const held = mark && SECOND_EDITION.test(mark) ? heldEdition(reference.volume) : '';
  return held ? { ...reference, volume: held } : reference;
}

// A RIC reference whose number the clean-up shortened out of a range, with the number as it was written kept beside it. OCRE titles 658 of its own
// types over a range and 654 of those first numbers are a type of their own as well, so the shortened citation answered a real but different record:
// the written number is tried against the index first and the first number is the fallback. Both readings come from the same text, and only a RIC
// reference pays for the second one.
export function withRange(shortened, readWhole) {
  if (shortened?.catalogue !== 'RIC') return shortened;
  const whole = readWhole();
  return whole?.catalogue === 'RIC' && whole.number !== shortened.number ? { ...shortened, range: whole.number } : shortened;
}

// One reference, read by the rules of the catalogues that have type data, or null. The lot path's clean-up runs first, so "RIC 268 (Elagabalus)",
// "RIC 972 var." and "RIC.112" read in the Reference box exactly as they read in a lot row. An Other reference never sees it: its text is its card.
// Two volumes are the same shelf when they carry the same numeral, and the same part where both name one: "II" is the shelf II.1² stands on.
const sameShelf = (one, other) => {
  const [numeral, part] = shelf(one);
  const [otherNumeral, otherPart] = shelf(other);
  return Boolean(numeral) && numeral === otherNumeral && (!part || !otherPart || part === otherPart);
};
// One RIC reference as the fields hold it. The section is kept as it was written — a mint's modern name is read as RIC's Latin one in lookupType,
// the one place every lookup passes through, since the guided fields never come through here. A bracket a dealer hangs on the number is read three ways: as the section, where RIC really heads a section of that volume with the name ("RIC 268 (Elagabalus)"); dropped,
// where the name heads a section of some other volume only, which is a mint remark and belongs in neither field ("RIC II Trajan 12 (Rome)"); and
// left in the number where it names no section at all, which is how OCRE titles its own types ("266 (aureus)").
function ricReference(number, volume, written) {
  const [, bare, trailing] = number.match(/^(\S+)\s+\(([^()]*)\)$/) ?? [];
  // A dealer brackets the section in either place: before the number ("RIC III (Antoninus Pius) 394a") or after it ("RIC 268 (Elagabalus)").
  const wrapped = squash(written).match(/^\(([^()]*)\)$/);
  const bracketed = wrapped?.[1] ?? (bare === undefined ? null : trailing);
  const plain = wrapped ? '' : squash(written);
  if (bracketed === null) return { catalogue: 'RIC', number, volume, section: plain };
  const name = squash(bracketed);
  const volumes = volumesOf(name);
  const here = volumes.length > 0 && (!volume || volumes.some((listed) => sameShelf(listed, volume)));
  // A bracket naming no section at all is how OCRE titles its own types ("266 (aureus)") and stays in the number; one naming a section of another
  // volume only is a mint remark ("RIC II Trajan 12 (Rome)") and belongs in neither field.
  const keep = !wrapped && volumes.length === 0;
  return { catalogue: 'RIC', number: keep ? number : bare ?? number, volume, section: plain || (here ? name : '') };
}

// One reference as a lot row and the Reference box both read it: the shared clean-up, then the catalogue rules over what it leaves, and the range a
// citation was written over kept beside the number the clean-up took it down to.
function readType(text, clean = true) {
  const written = String(text).trim();
  const type = readClean(clean ? cleanReference(written) : written);
  return clean ? withEdition(withRange(type, () => readClean(cleanReference(written, false))), written) : type;
}

// K-03: no keyboard has a "²" key, so RIC I's second edition is typed "RIC I2", "RIC I^2" or "RIC I2nd" (and "RIC I 2nd" without the "ed."
// that the edition group below already reads). Only volume I is read from a glued "2": it has no parts, so "I2" can be nothing else, while "V2"
// or "II.32" could be a part or a number. A caret is a written superscript on any volume or part ("RIC II.3^2"). One fixed run at the start each.
const GLUED_SECOND = /^(RIC\s*(?:vol\.?\s*)?I)(?:2(?:nd)?|\s+2nd)(?![\p{L}\d])(?!\s*ed)/iu;
const CARET_SECOND = /^(RIC\s*(?:vol\.?\s*)?(?:X|IX|VIII|VII|VI|V|IV|III|II|I|10|[1-9])(?:\s*[./]\s*\d)?)\s*\^\s*2(?!\d)/i;
const squared = (value) => value.replace(GLUED_SECOND, '$1²').replace(CARET_SECOND, '$1²');

// K-03: a ruler or a mint written after the number ("RIC 306 Nero", "RIC II 253 Trajan", "Ric 306, nero") reads exactly as the same name before it:
// only where the text before the number is RIC and a volume and nothing else, the text after it is one name the people or mint tables know, and
// reading it before the number really makes it the section. Anything else stays unread, as it was. Read by tokens, never by a pattern that could
// backtrack over the words.
function rulerAfterNumber(value) {
  const tokens = value.split(' ');
  const at = tokens.findLastIndex((token) => /^\d/.test(token));
  if (at < 1 || at === tokens.length - 1) return null;
  const head = tokens.slice(0, at).join(' ');
  const number = tokens[at].replace(/,$/, '');
  const name = tokens.slice(at + 1).join(' ').replace(/^,\s*/, '');
  if (!/^RIC(?![a-z])/i.test(head) || !number || /[\d,;]/.test(name) || !name) return null;
  if (volumesOf(name).length === 0 && !isRicPerson(name) && !ricMintSection(name)) return null;
  const bare = readClean(`${head} 1`, false);
  if (bare?.catalogue !== 'RIC' || bare.section) return null;
  const read = readClean(`${head} ${name} ${number}`, false);
  return read?.catalogue === 'RIC' && read.section === name && read.number === number ? read : null;
}

function readClean(written, turned = true) {
  const value = squared(written);
  // The catalogues whose whole reference is a key and a number; RIC and Bop carry a volume or a king and are read below.
  for (const [catalogue, { referencePattern }] of Object.entries(CATALOGUES)) {
    const number = referencePattern && value.match(referencePattern)?.[1];
    if (number) return { catalogue, number, volume: '', section: '' };
  }
  const bop = BOP_COAUTHORED.test(value) ? null : value.match(BOP_REFERENCE);
  if (bop) return { catalogue: 'Bop', number: bop[3], volume: '', section: squash(bop[1] ?? bop[2] ?? '') };
  const ric = value.match(RIC_REFERENCE);
  if (ric) {
    const [, numeral, mark, written, edition, section = '', number] = ric;
    const part = written && (/^\d/.test(written) ? written : String(ROMAN.indexOf(written.toUpperCase()) + 1));
    // A volume written in Arabic numerals takes no comma after it. The Roman spelling is the one RIC is bound and cited under, and it alone is
    // punctuated the way HGC's volume is; "RIC 5, 6" and "RIC 1,2" are two numbers a dealer listed under one key, not volume V number 6.
    if (/^\d/.test(numeral) && /^RIC\s*(?:vol\.?\s*)?\d+\s*,/i.test(value)) return null;
    const roman = /^\d/.test(numeral) ? ROMAN[Number(numeral) - 1] : numeral.toUpperCase();
    // A comma is also how a dealer lists numbers, so a part joined on with one is read only where RIC really divides that volume: "RIC III, 2, 3" is
    // two of RIC III's numbers. The volume's own punctuation ("IV.1", "II.3", "IV part 1") says part and nothing else, and is read whatever it names.
    if (part && mark === ',' && !realVolumePart(roman, part)) return null;
    const volume = `${roman}${part ? `, Part ${part}` : ''}${edition ? ' (2nd edition)' : ''}`;
    return ricReference(number, volume, section);
  }
  const any = value.match(RIC_ANY_VOLUME);
  const ruler = any?.[1] ?? any?.[2] ?? '';
  if (!any || (ruler && volumesOf(ruler).length === 0 && !isRicPerson(ruler))) return turned ? rulerAfterNumber(value) : null;
  return ricReference(any[3], '', ruler);
}

// RPC has no open type data here, but RPC Online has a page per type, which only the user opens (Giga Pinax never fetches RPC): "RPC I 1234" and
// "RPC I, 1234" are coins/1/1234, "RPC V.2 1234" ("V/2", "V, Part 2") coins/5.2/1234, the volume in Arabic numerals. Null for anything else.
// The volumes RPC Online publishes before print number their types provisionally, and every house writes that number its own way: "RPC IV.2 online
// 1234 (temporary)", "RPC IV.2, 1234 (temporary)", "RPC IV 1234 (temp.)". Such a number is the volume's, whatever part it is filed in, and RPC Online's
// own address for the type is the volume without the part (coins/4/1234 is the type URI of "RPC IV.2, 1234 (temporary)"). A capital letter behind the
// number is a supplement's type of its own ("RPC I 2317A"); a "var." or "corr." remark links the type it stands on.
const RPC_REFERENCE = /^RPC\s*(X|IX|VIII|VII|VI|V|IV|III|II|I|10|[1-9])(?![a-z\d])(?:\s*(?:[./]|,?\s*part)\s*(\d)(?!\d))?\s*,?\s*(online\s*,?\s*)?(\d+)([a-z]?)((?:\s*,?\s*(?:\((?:temporary|temp\.?)\)|var\.?|corr\.?)(?![a-z]))*)$/i;
export function rpcReference(text) {
  const [, numeral, part = '', online, digits, letter, remarks] = String(text ?? '').trim().match(RPC_REFERENCE) ?? [];
  if (!digits || letter !== letter.toUpperCase()) return null;
  const figure = /^\d/.test(numeral) ? Number(numeral) : ROMAN.indexOf(numeral.toUpperCase()) + 1;
  return { numeral: ROMAN[figure - 1], figure, part, number: `${digits}${letter}`, temporary: Boolean(online) || /\(temp/i.test(remarks) };
}
export function rpcUrl(text) {
  const rpc = rpcReference(text);
  if (!rpc) return null;
  return `https://rpc.ashmus.ox.ac.uk/coins/${rpc.figure}${rpc.part && !rpc.temporary ? `.${rpc.part}` : ''}/${rpc.number}`;
}

export function buildQuery({ catalogue, number, volume, section }) {
  if (catalogue === 'RIC') {
    const edition = ocreVolume(volume);
    const ruler = unquote(section);
    const query = squash(`RIC ${edition} ${ruler} ${unquote(number)}`);
    // A blank volume or ruler means any, so lookupType lists every type with the number instead of matching one title. So does a ruler the volume
    // also splits into sections ("Gallienus (joint reign)", "Zeno (East)", "Salonina (2)"): the popup fills in the volume a ruler implies, and the
    // sibling with the same number is a different coin, offered rather than skipped for the plain section's type.
    const siblings = Object.hasOwn(RIC_SECTIONS, unquote(volume)) && RIC_SECTIONS[unquote(volume)].some((name) => norm(name).startsWith(`${norm(ruler)} (`));
    return edition && ruler && !siblings ? { corpus: 'ocre', query } : { corpus: 'ocre', query, partial: true };
  }
  if (catalogue === 'Bop') {
    // The section field is the king (English, as BIGR titles it); the query names the reference the way the popup reports a miss.
    const king = unquote(section);
    const series = bopSeries(number);
    return { corpus: BIGR, query: squash(`Bopearachchi ${king} ${series}`), king, series };
  }
  // Cleaned as parseReference cleans it, so the guided field and the Reference box give the same card, Recent chip and term.
  if (catalogue === 'Other') return { corpus: OTHER, query: otherNumber(unwrap(unquote(number))) };
  // The rest are a key and a number: the key as the corpus titles its types, the number without the key a collector typed.
  const known = catalogueOf(catalogue) ? catalogue : 'Price';
  const { corpus, queryKey } = CATALOGUES[known];
  const digits = catalogueNumber(known, number);
  const query = squash(`${queryKey} ${digits}`);
  return Object.hasOwn(RECORD_IDS, known) ? { corpus, query, id: RECORD_IDS[known](digits) } : { corpus, query };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]);

// ponytail: regex over a fixed-shape Atom feed; switch to DOMParser if entries ever nest.
export function parseFeed(xml) {
  const entries = [];
  for (const [, body] of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const title = body.match(/<title>([^<]*)<\/title>/)?.[1];
    const id = body.match(/<id>([^<]*)<\/id>/)?.[1];
    if (title && id) entries.push({ id: unescape(id), title: unescape(title) });
  }
  return entries;
}

// ponytail: regex over the NUDS refDesc, like parseFeed. The Bopearachchi idno ("Euthydème I 24A") of the first reference keyed to Bopearachchi 1991,
// or null when the record has no readable one (Mitchiner-only records exist), which leaves the hit unverified.
export function bopCitation(xml) {
  for (const [, body] of String(xml).matchAll(/<reference(?:\s[^>]*)?>([\s\S]*?)<\/reference>/g)) {
    if (!body.includes(`key="${BOP_KEY}"`)) continue;
    const idno = squash(body.match(/<tei:idno(?:\s[^>]*)?>([^<]*)<\/tei:idno>/)?.[1]);
    if (idno) return unescape(idno);
  }
  return null;
}

// The series is the citation's last token ("Euthydème I 24A" → "24A"; the parent type "Euthydème I 24" → "24").
export const seriesOf = (citation) => squash(citation).split(' ').pop();

// BIGR titles minus the corpus name ("Euthydemus I 13.1"), and minus the trailing BIGR number too ("Euthydemus I"; "Diodotus I or Diodotus II 8A" → "Diodotus I or Diodotus II").
const shortTitle = (title) => {
  const text = squash(title);
  return text.startsWith(BIGR_TITLE) ? text.slice(BIGR_TITLE.length) : text;
};
export const kingOf = (title) => squash(shortTitle(title).replace(/\s+\d\S*$/, ''));

export function pickMatch(entries, query) {
  const wanted = norm(query);
  const exact = entries.find((entry) => norm(entry.title) === wanted);
  if (exact) return { status: 'ok', entry: exact };
  if (entries.length >= 1 && entries.length <= 5) return { status: 'candidates', candidates: entries };
  return { status: 'none' };
}

const NOMISMA = 'https://nomisma.org/id/';
// Card slots in display order; each lists fallbacks (CRRO names the issuer where OCRE/PELLA name the authority).
const NAMED_FIELDS = [['nmo:hasAuthority', 'nmo:hasIssuer'], ['nmo:hasDenomination'], ['nmo:hasMint'], ['nmo:hasMaterial']];

const graphOf = (jsonld) => (Array.isArray(jsonld?.['@graph']) ? jsonld['@graph'] : []);
const mainNode = (jsonld) => graphOf(jsonld).find((node) => typeof node['@id'] === 'string' && !node['@id'].includes('#')) ?? null;
const slugOf = (node) => (typeof node?.['@id'] === 'string' ? node['@id'].split('/').pop() : null);
const namedSlugs = (main) => NAMED_FIELDS.map((fields) => fields.map((field) => slugOf(main?.[field]?.[0])).find(Boolean) ?? null);

function english(values) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const hit = list.find((value) => value?.['@language'] === 'en') ?? list[0];
  return typeof hit?.['@value'] === 'string' ? hit['@value'] : null;
}

export function formatDates(start, end) {
  const years = [start, end].map((year) => Number.parseInt(year, 10)).filter(Number.isFinite);
  if (years.length === 0) return null;
  const [a, b] = years.length === 1 ? [years[0], years[0]] : years;
  const era = (year) => (year < 0 ? `${-year} BC` : `AD ${year}`);
  if (a === b) return era(a);
  if (a < 0 && b < 0) return `${-a}–${-b} BC`;
  if (a > 0 && b > 0) return `AD ${a}–${b}`;
  return `${era(a)}–${era(b)}`;
}

export function nomismaSlugs(jsonld) {
  const main = mainNode(jsonld);
  return namedSlugs(main).filter(Boolean);
}

// The concept the obverse portrays, and only the obverse: a reverse nmo:hasPortrait is the type's deity (Annona on Vespasian 972), never the person
// the coin is filed under. Null unless the side names exactly one, so a joint type (Leo II and Zeno) says nothing rather than half of it.
export function portraitSlug(jsonld) {
  const main = mainNode(jsonld);
  const obverse = main && graphOf(jsonld).find((entry) => entry['@id'] === `${main['@id']}#obverse`);
  const portraits = obverse?.['nmo:hasPortrait'] ?? [];
  return portraits.length === 1 ? slugOf(portraits[0]) : null;
}

export function nomismaLabel(jsonld, slug) {
  const node = graphOf(jsonld).find((entry) => entry['@id'] === `nm:${slug}` || entry['@id'] === `${NOMISMA}${slug}` || entry['@id'] === `http://nomisma.org/id/${slug}`);
  return english(node?.['skos:prefLabel']);
}

// The card's four named slots, in the order namedSlugs reads them.
const NAMED_SLOTS = Object.freeze(['authority', 'denomination', 'mint', 'material']);

// unreachable: the slugs nomisma.org did not answer for (X-10). Their slot is left empty rather than printed as an identifier
// ("euthydemus_i_bactria"), and the card lists them as unnamed, each with its slot, for a retry that asks for those alone. A slug nomisma answered
// for without an English name keeps the identifier, as the bundled catalogue does.
export function toCard(jsonld, corpus, labels = {}, unreachable = []) {
  const main = mainNode(jsonld);
  if (!main) return null;
  const uri = main['@id'];
  const id = uri.split('/').pop();
  const side = (name) => {
    const node = graphOf(jsonld).find((entry) => entry['@id'] === `${uri}#${name}`) ?? {};
    return { legend: english(node['nmo:hasLegend']), description: english(node['dcterms:description']) };
  };
  const slugs = namedSlugs(main);
  const missing = slugs.map((slug, index) => (slug && !Object.hasOwn(labels, slug) && unreachable.includes(slug) ? { field: NAMED_SLOTS[index], slug } : null)).filter(Boolean);
  const [authority, denomination, mint, material] = slugs.map((slug) => (!slug || missing.some((entry) => entry.slug === slug) ? null : labels[slug] ?? slug));
  // Only a type with one authority and one obverse portrait has a portrait to report, and the name never falls back to its slug: an unresolved label
  // would print as "cornelia_salonina", so it fails closed to null instead.
  const authorities = main['nmo:hasAuthority'] ?? main['nmo:hasIssuer'] ?? [];
  const portrait = authorities.length === 1 ? portraitSlug(jsonld) : null;
  return {
    id,
    uri,
    corpus,
    label: english(main['skos:prefLabel']) ?? id,
    authority,
    denomination,
    mint,
    material,
    portrait: portrait && Object.hasOwn(labels, portrait) ? labels[portrait] : null,
    dates: formatDates(main['nmo:hasStartDate']?.[0]?.['@value'], main['nmo:hasEndDate']?.[0]?.['@value']),
    obverse: side('obverse'),
    reverse: side('reverse'),
    ...(missing.length ? { unnamed: missing } : {}),
  };
}

// X-10: asks nomisma.org again for the names a card was drawn without, and those alone; answers the card with every name that came back, still
// listing the ones that did not. A card with nothing unnamed is answered as it is, with no request.
export async function nameCard(card, { fetchImpl = fetch, cache = new Map(), timeoutMs = TIMEOUT_MS } = {}) {
  const missing = Array.isArray(card?.unnamed) ? card.unnamed.filter((entry) => NAMED_SLOTS.includes(entry?.field) && typeof entry?.slug === 'string') : [];
  if (!missing.length) return card;
  const timer = withTimeout(timeoutMs);
  const unreachable = [];
  try {
    const labels = await resolveLabels([...new Set(missing.map(({ slug }) => slug))], { fetchImpl, cache, signal: timer.signal, unreachable });
    const { unnamed, ...named } = card;
    for (const { field, slug } of missing) if (!unreachable.includes(slug)) named[field] = labels[slug] ?? slug;
    const still = missing.filter(({ slug }) => unreachable.includes(slug));
    return still.length ? { ...named, unnamed: still } : named;
  } finally {
    timer.done();
  }
}

// The other sections of a volume that share this one's name before its parenthesis ("Zeno" and "Zeno (West)" for "Zeno (East)"), by the rulerKey rule
// volumesOf uses. Never the card's own section.
function siblingSections(volume, section) {
  const base = (name) => norm(name).split(' (')[0];
  const sections = Object.hasOwn(RIC_SECTIONS, volume) ? RIC_SECTIONS[volume] : [];
  return sections.filter((name) => base(name) === base(section) && norm(name) !== norm(section));
}

// RIC VI–IX are filed by mint, so their sections are city names: a name known only there is a place, not a person RIC files coins under.
const MINT_VOLUMES = new Set(['VI', 'VII', 'VIII', 'IX']);
const namesASection = (name) => volumesOf(name).some((volume) => !MINT_VOLUMES.has(volume));

const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(''));

// Why a card is filed where it is, in at most two sentences, or '' — the answer for the great majority of cards, which must stay silent.
// RIC files a Caesar's coins under the reigning emperor (Titus under Vespasian) and an empress's under her husband, which reads as a wrong result
// until the card says so. It reports only what the record holds: no rank, no claim that the search was wrong, and no name RIC does not use itself.
export function filingNote(card) {
  // A CPE card reached from a Svoronos number says where PCO files that number; the bundle wrote the sentence from PCO's own link.
  if (typeof card?.filedAs === 'string') return card.filedAs;
  if (card?.corpus !== 'ocre') return '';
  const reference = parseReference(card.label, false);
  if (reference?.catalogue !== 'RIC') return '';
  const [portrait, authority] = [squash(card.portrait), squash(card.authority)];
  const sentences = [];
  // Only a card whose own section is the authority is filed under a ruler at all: RIC VI–IX file by mint, so there the authority heads no section and
  // the claim would contradict the title above it. The section is also what is named — RIC's own spelling, never a slug nomisma failed to label.
  const section = squash(reference.section);
  const filedUnder = section && norm(section).split(' (')[0] === norm(authority);
  // namesASection is the second gate: a name RIC itself heads a section with, in a volume filed by ruler. Deities and personifications (Apollo,
  // Annona, Carthage), and names nomisma spells differently from RIC ("Cornelia Salonina"), fail it and stay off the card — never a guess.
  if (portrait && filedUnder && norm(portrait) !== norm(authority) && namesASection(portrait)) {
    sentences.push(`Portrait of ${portrait}, listed under ${section}.`);
  }
  if (portrait && authority && MINT_VOLUMES.has(unquote(reference.volume)) && norm(portrait) !== norm(authority)
    && isRicPerson(portrait) && isRicPerson(authority)) {
    sentences.push(`Portrait of ${portrait}; issuing authority ${authority}.`);
  }
  const siblings = siblingSections(unquote(reference.volume), reference.section);
  // Only on a card that already needs explaining. A volume splits a long reign into sections it names alike, so on its own this sentence would sit
  // under every one of RIC V's Gallienus types and say nothing the collector asked about; after the portrait sentence it answers his next question.
  // That the volume has another section is all it says: never that the section holds a coin with this number.
  if (siblings.length > 0 && sentences.length > 0) {
    const named = siblings.length > 1 ? `${andList(siblings)} sections` : `a ${siblings[0]} section`;
    sentences.push(`RIC ${ocreVolume(reference.volume)} also has ${named}.`);
  }
  return sentences.join(' ');
}

// What a BIGR card carries beyond the record: the king as BIGR titles it and the Bopearachchi series, both null-safe when the citation was unreadable.
export const bopDetails = (title, citation) => ({ king: kingOf(title), series: citation ? seriesOf(citation) : null, citation: citation ?? null });

const ORIGIN = 'https://numismatics.org';
const recordUrl = (corpus, id) => `${ORIGIN}/${corpus}/id/${encodeURIComponent(id)}.jsonld`;
const nudsUrl = (corpus, id) => `${ORIGIN}/${corpus}/id/${encodeURIComponent(id)}.xml`;
// Many NUDS records in one <nudsGroup>. The "|" between ids is encoded too: the server refuses a bare one with HTTP 400.
const groupUrl = (corpus, ids) => `${ORIGIN}/${corpus}/apis/getNuds?identifiers=${encodeURIComponent(ids.join('|'))}`;

// A response is read whole, so its size is the sender's to choose. Nothing numismatics.org or nomisma.org publishes for one lookup comes near this cap
// (a full search page or a 24-record NUDS group is a few hundred kilobytes): a declared length over it is refused before any of the body is read, and
// a body is counted as it arrives and dropped once past it. The same approach as boundedText in coinarchives-prices.js, copied rather than imported:
// that module imports prices.js, which imports this one. A refused body is a network failure, as a dropped connection is.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
async function boundedText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const tooLarge = () => new Error('too-large');
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > maxBytes) { await response.body?.cancel?.(); throw tooLarge(); }
  const decode = (bytes) => new TextDecoder('utf-8').decode(bytes);
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw tooLarge(); }
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
  if (typeof response.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw tooLarge();
    return decode(bytes);
  }
  // A stand-in response carrying text alone (a test's fake) is measured the same way once read.
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw tooLarge();
  return text;
}

async function getText(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  return boundedText(response);
}

// The error carries the HTTP status so a caller can tell a missing record (404) from an outage.
async function getJson(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal, headers: { Accept: 'application/ld+json' } });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  return JSON.parse(await boundedText(response));
}

// X-06: the deadline aborts with a TimeoutError of its own, so a lookup that ran out of time is told apart from one whose connection failed; a caller's
// cancel signal stops it too, with its own reason.
function withTimeout(ms, cancel) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('No answer within the lookup deadline.', 'TimeoutError')), ms);
  const stop = () => controller.abort(new DOMException('The lookup was cancelled.', 'AbortError'));
  if (cancel?.aborted) stop();
  cancel?.addEventListener?.('abort', stop);
  return { signal: controller.signal, done: () => { clearTimeout(timer); cancel?.removeEventListener?.('abort', stop); } };
}

// A request the deadline or a cancel stopped is said as that (X-06): "timeout" and "cancelled", never a failed connection.
const failureOutcome = (error, signal) => (signal?.aborted ? { status: signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' }
  : error?.status === 429 ? { status: 'rate-limited', httpStatus: 429 }
    : error?.status >= 500 && error.status <= 599 ? { status: 'unavailable', httpStatus: error.status }
      : { status: 'network' });
const stoppedByCaller = (signal) => signal?.aborted && signal.reason?.name !== 'TimeoutError';

// unreachable, when given, collects the slugs nomisma.org did not answer for (a failed connection, an outage, the deadline), as against a concept it
// answered for without an English name (404, or no label), which falls back to its slug as it always did.
export async function resolveLabels(slugs, { fetchImpl = fetch, cache = new Map(), signal, unreachable } = {}) {
  const labels = {};
  await Promise.all(slugs.map(async (slug) => {
    const cached = cache.get(slug);
    if (cached) { labels[slug] = cached; return; }
    try {
      const label = nomismaLabel(await getJson(`${NOMISMA}${slug}.jsonld`, fetchImpl, signal), slug);
      if (label) { labels[slug] = label; cache.set(slug, label); }
    } catch (error) {
      // Unlabelled concepts fall back to their slug; one nomisma.org never answered for is said to be unnamed instead.
      if (error?.status !== 404) unreachable?.push(slug);
    }
  }));
  return labels;
}

// A card's own NUDS record, for the citation when none was read while verifying (Recent chips, the pop-out's window): missing or unreadable, the card
// is uncited. Only the deadline propagates, so a timed-out lookup is still a network error.
async function fetchCitation(id, fetchImpl, signal) {
  try { return bopCitation(await getText(nudsUrl(BIGR, id), fetchImpl, signal)); }
  catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

// The one path from a fetched record to a card, shared by lookupById and the SC direct fetch.
// A BIGR card also carries its Bopearachchi citation: the one already read while verifying the hit, else fetched now (Recent chips, right-click).
async function cardOutcome(jsonld, corpus, { fetchImpl, cache, signal, citation }) {
  // Only OCRE files a type under an authority a portrait can differ from, so only OCRE asks for the portrait's name: no request at all when it is the
  // authority already asked for (the common case), one more parallel, cached, same-deadline one when it differs.
  const slugs = [...new Set([...nomismaSlugs(jsonld), ...(corpus === 'ocre' ? [portraitSlug(jsonld)] : [])].filter(Boolean))];
  const unreachable = [];
  const labels = await resolveLabels(slugs, { fetchImpl, cache, signal, unreachable });
  const card = toCard(jsonld, corpus, labels, unreachable);
  if (!card) return { status: 'network' };
  if (corpus === BIGR) card.bop = bopDetails(card.label, citation === undefined ? await fetchCitation(card.id, fetchImpl, signal) : citation);
  return { status: 'ok', card };
}

// No type data, so no request: the text is the id and the label (a Recent chip stores both).
const otherCard = (text) => ({ id: text, corpus: OTHER, label: text, authority: null, denomination: null, mint: null, material: null, portrait: null, dates: null,
  obverse: { legend: null, description: null }, reverse: { legend: null, description: null } });

export async function lookupById(corpus, id, options = {}) {
  // A chip saved before 0.19 ("SG6829v") takes the SG spelling; any other id stays as saved, so its remembered term still matches.
  if (corpus === OTHER) return { status: 'ok', card: otherCard(otherNumber(id)) };
  const { localProvider, online = true } = options;
  // A provider answers null for a corpus it does not bundle, and then this is an ordinary online lookup.
  const local = localProvider?.lookupById ? await localProvider.lookupById(corpus, id) : null;
  if (local) {
    if (local.status === 'ok') return local;
    if (!online) return { status: 'online-required', localStatus: local.status, corpus, id };
  }
  const { fetchImpl = fetch, cache = new Map(), timeoutMs = TIMEOUT_MS, signal, citation, cancel } = options;
  const timer = signal ? { signal, done() {} } : withTimeout(timeoutMs, cancel);
  try {
    const jsonld = await getJson(recordUrl(corpus, id), fetchImpl, timer.signal);
    return await cardOutcome(jsonld, corpus, { fetchImpl, cache, signal: timer.signal, citation });
  } catch (error) {
    if (!stoppedByCaller(timer.signal)) void recordFetchFailure('lookup', timer.signal.aborted ? timer.signal.reason : error);
    return failureOutcome(error, timer.signal);
  } finally {
    timer.done();
  }
}

// The SC number up to its first "." ("1266.9" → "1266").
const scBase = (number) => referenceNumber('SC', number).split('.')[0];

// CRRO's plain search also matches dates ("44/5a" finds "480/5a"), so its suggestions must share the typed Crawford group;
// SCO's must share the typed base number ("1266.9" keeps sc.1.1266 and sc.1.1266.x, never sc.1.12660).
// Filtering before pickMatch lets a loose search with many hits still yield up to five in-group suggestions.
// The bundled catalogue filters its own index by the same rule, so the near misses it offers are the ones this offers.
// A CPE or Newell number the corpus lacks keeps the records that carry its number with no letter, or with any letter after it ("466a" keeps 466,
// 466A and 466B, never 4660).
const LETTERED = Object.freeze({ pco: 'CPE', agco: 'Newell' });
export function inGroup(entries, corpus, reference) {
  if (Object.hasOwn(LETTERED, corpus)) {
    const catalogue = LETTERED[corpus];
    const base = RECORD_IDS[catalogue](catalogueNumber(catalogue, reference.number).replace(/[A-Za-z]+$/, ''));
    return entries.filter((entry) => entry.id === base || (entry.id.startsWith(base) && /^[A-Za-z]+$/.test(entry.id.slice(base.length))));
  }
  if (corpus === 'sco') {
    const base = `${SCO_ID}${scBase(reference.number)}`;
    return entries.filter((entry) => entry.id === base || entry.id.startsWith(`${base}.`));
  }
  if (corpus !== 'crro') return entries;
  const prefix = norm(`RRC ${referenceNumber('RRC', reference.number).split('/')[0].trim()}/`);
  return entries.filter((entry) => norm(entry.title).startsWith(prefix));
}

// BIGR's plain search matches the citation text ("Euthydemus I 24A" finds Euthydemus I 13.1 and its parent 13), so every hit is verified against its own
// NUDS citation: exact when the series matches. One getNuds request brings every hit's record, a <nuds> each in a <nudsGroup>, read by its recordId.
// Fails closed: a failed request throws, so the lookup is a network error and never "not found"; a record missing from the group, or without a Bop
// idno, leaves its hit unverified. The verified hits keep their citation so the card needs no second XML request.
// ponytail: the group is split by regex, like parseFeed.
async function verifyBop(entries, series, fetchImpl, signal) {
  const hits = entries.slice(0, VERIFY_LIMIT);
  if (hits.length === 0) return [];
  const group = await getText(groupUrl(BIGR, hits.map((hit) => hit.id)), fetchImpl, signal);
  const citations = new Map([...group.matchAll(/<nuds[\s>][\s\S]*?<\/nuds>/g)].map(([record]) => [record.match(/<recordId>([^<]*)<\/recordId>/)?.[1], bopCitation(record)]));
  return hits.map((entry) => {
    const citation = citations.get(entry.id) ?? null;
    return { ...entry, citation, exact: citation !== null && norm(seriesOf(citation)) === norm(series) };
  });
}

// Suggestions are labelled by citation, with BIGR's own number to tell three "Philoxène 9C" subtypes apart; an uncited hit keeps its BIGR title.
const bopCandidate = ({ id, title, citation }) => ({ id, title: citation ? `Bopearachchi ${citation} (${shortTitle(title)})` : title });

// With a king: "{king} {series}"; one exact hit is the type, several are offered, none leaves the (verified) hits as near misses like any other corpus.
// A king BIGR cannot find (a Greek spelling, say) or no king at all: the series alone, and every king with that exact series is offered,
// because Bopearachchi's series restart per king.
async function pickBop({ king, series }, search, fetchImpl, signal) {
  let hits = king ? await search(`${king} ${series}`) : [];
  const byKing = hits.length > 0;
  if (!byKing) hits = await search(series);
  const verified = await verifyBop(hits, series, fetchImpl, signal);
  const exact = verified.filter((hit) => hit.exact);
  if (byKing && exact.length === 1) return { status: 'ok', entry: exact[0], citation: exact[0].citation };
  if (exact.length > 0) return { status: 'candidates', candidates: exact.map(bopCandidate) };
  if (byKing && hits.length <= 5) return { status: 'candidates', candidates: verified.map(bopCandidate) };
  return { status: 'none' };
}

// Solr phrase text: a quote or backslash in user text would end or escape the phrase.
const phrase = (value) => unquote(String(value ?? '').replace(/\\/g, ''));
// A typed RIC number as searched and compared: phrase-safe, without the sentence punctuation a guided number may carry ("972.").
const ricNumber = (number) => unpunctuate(phrase(number));
// A number without its parenthetical or case, to compare a hit with the typed number.
const bareNumber = (number) => norm(number).replace(/\s*\([^)]*\)$/, '');
// A number with its parenthetical spaced as OCRE titles it, so a typed "266(aureus)" is the "266 (aureus)" its search found.
const spaced = (number) => norm(number).replace(/\s*\(/, ' (');
const byText = (a, b) => (a > b) - (a < b);
// A volume's numeral and part, lower-cased: "II, Part 3 (2nd edition)" is ['ii', '3'], "IV" is ['iv', undefined].
const shelf = (volume) => norm(volume).match(/^([ivx]+)(?:, part (\d))?/)?.slice(1) ?? [];
// The numerals OCRE divides into parts: only II (II.1², II.3²). IV and V are whole in OCRE, so a typed "IV, Part 1" or "V/2" is all of IV or V.
const DIVIDED = new Set(RIC_VOLUMES.map(({ value }) => shelf(value)).filter(([, part]) => part).map(([numeral]) => numeral));
const listed = (volume) => RIC_VOLUMES.some(({ value }) => norm(value) === norm(volume));

// The title words that narrow a search to a volume: OCRE's own for a listed one ("RIC I (second edition)", "RIC VII"); for one OCRE does not list,
// its numeral and any part OCRE divides it by ("RIC I", "RIC IV", "RIC II, Part 3"), since "IV, Part 1" is in no title.
function volumePhrase(volume) {
  if (listed(volume)) return phrase(`RIC ${ocreVolume(volume)}`);
  const [numeral, part] = shelf(volume);
  return numeral ? `RIC ${numeral.toUpperCase()}${part && DIVIDED.has(numeral) ? `, Part ${part}` : ''}` : '';
}

// A RIC reference without a volume or ruler is one search of OCRE's Solr index for its number, narrowed by the volume's title words or the ruler as a
// quoted phrase. typeNumber is case-sensitive ("56A" is in IX, "56a" in III, IV and VI), so a lettered number asks for both. OCRE stores a word after
// the number as "266_aureus", which a search for 266 does not find: a typed word is asked for as typed and in lower case (denominations are lower
// case, "509 (BB)" is not), and a plain number also asks for those types (266_*; unquoted, so digits and letters only).
// Rulers from a lot text ask OCRE's portrait and authority facets for any of them. Every OR group stays bracketed: unbracketed, "a OR b AND c" is
// read as "a OR (b AND c)" (394a_* OR 394A_* returned 51,853 hits).
// A citation written over a range asks for the range as well as for its first number, in the one search, so the record OCRE titles over it is among
// the hits pickRicEntries then prefers.
function ricSearch({ number, volume, section, range }, rulers = []) {
  const clauses = [...new Set([number, ...(range ? [range] : [])])].flatMap((written) => {
    const [, base, word] = ricNumber(written).match(/^(.*?)\s*(?:\(([^)]*)\))?$/);
    return [...new Set([base.toLowerCase(), base.toUpperCase()])].flatMap((form) => (word
      ? [...new Set([word, word.toLowerCase()])].map((typed) => `typeNumber:"${form}_${typed}"`)
      : [`typeNumber:"${form}"`, ...(/^\d+[a-z]*$/i.test(form) ? [`typeNumber:${form}_*`] : [])]));
  });
  const group = (list) => (list.length > 1 ? `(${list.join(' OR ')})` : list[0]);
  // A section name no person answers to ("Philip I" beside "Otacilia Severa") is in no facet, so it is asked for by its title words instead.
  const facets = rulers.flatMap((name) => (rulers.length > 1 && isSectionOnly(name) ? [`"${name}"`] : [`portrait_facet:"${name}"`, `authority_facet:"${name}"`]));
  const narrow = [volumePhrase(unquote(volume)), phrase(section)].filter(Boolean).map((text) => ` AND "${text}"`).join('');
  return `${group(clauses)}${facets.length ? ` AND ${group(facets)}` : ''}${narrow}`;
}

// Kept: the RIC types with the typed number (with any word OCRE stores after it, unless a word is typed), in the typed volume and by the typed ruler
// when given, in RIC volume order. Only subtypes are dropped ("RIC V Gallienus 306: Subtype 1" reads as section "Gallienus 306: Subtype"); "Salonina
// (2)" is a real section. A listed volume matches exactly; one OCRE does not list matches by numeral, and by part where OCRE divides it ("I" finds I²,
// "V, Part 2" finds V). A ruler also keeps the sections OCRE splits it into ("Gallienus (joint reign)"). More hits than one page are too many to list.
export function pickRicEntries(entries, reference, total = entries.length) {
  if (total > entries.length) return { status: 'too-many' };
  return pickRicHits(entries.map((entry) => ({ entry, hit: parseReference(entry.title, false) })), reference);
}

// The same pick over entries whose titles have already been read ({ entry, hit }, hit being parseReference(title, false)): the bundled catalogue
// keeps each reading for the life of the page, since a lookup that broadens its volume or its section reads the same titles again.
export function pickRicHits(read, reference) {
  const [number, volume, ruler] = [spaced(ricNumber(reference.number)), unquote(reference.volume), norm(phrase(reference.section))];
  const exact = !volume || listed(volume);
  const [numeral, part] = shelf(volume);
  // A dealer writes the numeral a volume is bound under, not the title OCRE splits it into: "RIC II" is II, II.1² and II.3², "RIC IV" only IV. So a
  // bare numeral asks for its whole family, and a volume that names a part or an edition asks for itself.
  const family = Boolean(numeral) && norm(volume) === numeral;
  const onShelf = ([n, p]) => n === numeral && (!part || !DIVIDED.has(n) || p === part);
  const inVolume = (hit) => (exact && !family ? !volume || norm(hit.volume) === norm(volume) : onShelf(shelf(hit.volume)));
  // A section written the way Nomisma spells the person ("Valerian I" for OCRE's "Valerian") is the same section: the aliases say so, and they are
  // read once into a set of keys, since this filter runs over every entry of the bundled index.
  const aliases = new Set(ricPeople(reference.section).flatMap((person) => [person.name, ...person.aliases].map(rulerKey)));
  const byRuler = (section) => !ruler || norm(section) === ruler || norm(section).startsWith(`${ruler} (`)
    || (aliases.size > 0 && aliases.has(rulerKey(section.split(' (')[0])));
  // A citation written over a range names the type OCRE titles over it, where OCRE has one: both numbers are kept in the one pass, and the range
  // answers alone when it hit anything, since the first number is a different record wherever it is a type of its own (654 of the 658 ranges).
  const range = reference.range ? spaced(ricNumber(reference.range)) : '';
  const numbered = (hit, wanted) => [spaced(hit.number), bareNumber(hit.number)].includes(wanted);
  const rank = (hit) => RIC_VOLUMES.findIndex((option) => option.value === hit.volume);
  const found = read
    .filter(({ hit }) => hit?.catalogue === 'RIC' && !hit.section.includes(':') && (numbered(hit, number) || (range && numbered(hit, range)))
      && inVolume(hit) && byRuler(hit.section))
    .sort((a, b) => rank(a.hit) - rank(b.hit) || byText(a.hit.section, b.hit.section) || byText(a.entry.title, b.entry.title));
  const written = range ? found.filter(({ hit }) => numbered(hit, range)) : [];
  const kept = written.length > 0 ? written : found;
  if (kept.length === 0) return { status: 'none' };
  // The volume as typed first: the rest of the family is only offered when that volume holds nothing the ruler asked for, and then it is offered,
  // since the coin is not in the volume the dealer wrote.
  const own = family && ruler ? kept.filter(({ hit }) => norm(hit.volume) === norm(volume)) : kept;
  const chosen = own.length > 0 ? own : kept;
  // One hit is the type only when it is what was typed; a sibling section, or the edition of a volume typed another way, is offered, never opened.
  if (own.length > 0 && chosen.length === 1 && exact && (!ruler || norm(chosen[0].hit.section) === ruler)) return { status: 'ok', entry: chosen[0].entry };
  return { status: 'candidates', candidates: chosen.map(({ entry }) => entry), partial: true };
}

// Whether a hit comes from another part of the volume family the reference names: "RIC II" reaches II.1² and II.3² too, and those parts number
// their rulers their own way, so such a hit answers a different book. pickRicEntries only ever offers one; the local person path, which blanks the
// section before its final pick, asks here rather than slipping past that rule.
export function otherVolumePart(reference, title) {
  const volume = unquote(reference.volume);
  const [numeral, part] = shelf(volume);
  if (!numeral || part || norm(volume) !== numeral) return false;
  const hit = parseReference(title, false);
  return Boolean(hit) && norm(hit.volume) !== norm(volume);
}

// Whether a hit is in the one edition OCRE holds of a volume the reference names without one: CNG and Roma cite "RIC I 306", Baldwin's "RIC II.3
// 2140", and OCRE holds RIC I, II.1 and II.3 in their second edition alone. Read from RIC_VOLUMES, never from a list of numerals: a shelf with any
// other volume on it ("RIC II", beside II.1² and II.3²) is no such shelf, and a volume typed with its edition is exact already.
function heldEdition(volume) {
  const typed = unquote(volume);
  const [numeral, part] = shelf(typed);
  if (!numeral || listed(typed)) return '';
  const held = RIC_VOLUMES.filter(({ value }) => {
    const [otherNumeral, otherPart] = shelf(value);
    return otherNumeral === numeral && (!part || otherPart === part);
  });
  return held.length === 1 && /\(2nd edition\)$/.test(held[0].value) ? held[0].value : '';
}
// X-04: a first-edition mark a RIC citation keeps on its number ("RIC I 306 (1st ed.)", "RIC 306 (1. Aufl.)", "(1re éd.)"): withEdition carries only a
// second-edition mark onto the volume. On a volume OCRE and the bundle hold in their second edition alone (RIC I, II.1 and II.3) no lookup can answer
// it: those numbers are the 1923 and 1926 books', not the ones held. The volume is the one written, else the one its ruler implies; with neither, it
// is any of the three. A volume held in another edition too ("RIC II", whose 1926 book is held) is left to the lookup, as is anything unmarked.
export const FIRST_EDITION = /\s*\((?:1st|first)\s+ed(?:ition|s)?\.?\)$|\s*\(1\.\s*Aufl(?:\.|age)?\)$|\s*\(1(?:re|ère|er)\s+[ée]d\.?\)$/i;
export function firstEditionCitation(reference) {
  if (reference?.catalogue !== 'RIC' || !FIRST_EDITION.test(String(reference.number ?? ''))) return null;
  const number = String(reference.number).replace(FIRST_EDITION, '').trim();
  const typed = unquote(reference.volume);
  const person = unquote(reference.section) || (Array.isArray(reference.rulers) && reference.rulers.length === 1 ? reference.rulers[0] : '');
  const implied = !typed && person ? volumeFor(person, '') : '';
  const volume = typed ? heldEdition(typed) : /\(2nd edition\)$/.test(implied) ? implied : '';
  if (typed && !volume) return null;
  const [numeral, part] = shelf(volume);
  return { number, volume, book: volume ? `RIC ${numeral.toUpperCase()}${part ? `.${part}` : ''}` : '' };
}

export function soleEdition(volume, title) {
  const held = heldEdition(volume);
  return Boolean(held) && norm(parseReference(title, false)?.volume ?? '') === norm(held);
}
// That hit as it is offered: never opened, since an unedited "RIC I 306" may be the 1923 first edition's number and so another coin, but named the
// way the collector writes it ("RIC I² Nero 306") with the reason he has to choose it himself. Null for any other hit.
export function soleEditionOffer(reference, title) {
  if (!soleEdition(reference?.volume, title)) return null;
  const hit = parseReference(title, false);
  const short = (RIC_VOLUMES.find(({ value }) => value === hit.volume)?.label ?? hit.volume).replace(/ \(2nd ed\.\)$/, '');
  const written = unquote(reference.volume).replace(/, Part (\d)/, '.$1');
  const lot = (Array.isArray(reference.rulers) && reference.rulers.length > 0) || Boolean(reference.headingMint) || Boolean(reference.struckAt);
  return { label: squash(`RIC ${short} ${hit.section} ${hit.number}`),
    note: `${lot ? 'the lot says' : 'the reference says'} RIC ${written} without an edition; the second edition is the one bundled` };
}

// Whether a coin OCRE titles as the answer was struck at a RIC VI–IX mint that is none of the ones the lot's heading names beside its ruler ("Constantius I.
// Follis. Trier. RIC VI 12." found only his Alexandria 12): the ruler's number there is not the dealer's coin, so it is offered, never opened.
export function strayMint(reference, title) {
  const struck = [].concat(reference?.struckAt ?? []).map(unquote).filter(Boolean).map((name) => norm(ricMintSection(name) || name));
  const section = parseReference(title, false)?.section ?? '';
  return struck.length > 0 && isMintOnly(section) && !struck.includes(norm(section));
}

function pickRic(xml, reference) {
  const entries = parseFeed(xml);
  const total = Number(xml.match(/<opensearch:totalResults>(\d+)</)?.[1] ?? entries.length);
  return pickRicEntries(entries, reference, total);
}

// The rulers a lot text names before its first reference, phrase-safe and deduplicated; only a RIC reference without a section uses them. The facets
// hold OCRE's names, which are the names the aliases resolve a heading's spelling to ("Claudius II" and "Claudius Gothicus" are both Claudius II
// Gothicus, "Gaius/Caligula" stays whole because either half alone finds nothing). A spelling the aliases cannot place ("Maximinus II", which no
// English or Latin label carries), or one two people share, is asked for as it was written rather than guessed at.
const facetName = (name) => phrase(canonicalRicPerson(name) || String(name ?? ''));
const rulersOf = (reference) => [...new Set((Array.isArray(reference.rulers) ? reference.rulers : [])
  .map(facetName).filter(Boolean))];

// A RIC number with rulers read from a lot text: the facets already tie each hit to a ruler, and a Titus-as-Caesar coin sits in the Vespasian
// section, so pickRic runs without a section and one kept hit is the type, as pickRic decides it (a volume typed another way, "RIC I", is still only
// offered). A miss retries the plain number search once, and those hits are only offered, even a single one, since nothing tied them to the rulers.
// A mint written with no volume ("Probus. RIC 490 (Ticinum)") is where the coin was struck, and the ruler's own volume may file him by name: the
// retry then asks for the rulers' coins with the number without the mint, and those too are only offered. A hit with the mint is weighed against
// that same search: a coin in one of the rulers' own sections ("Diocletian. RIC 15 (Lugdunum)" is his RIC V 15 as readily as RIC VI Lugdunum 15) is
// offered beside it, never passed over; their coins at other mints are not, since the lot says where it was struck.
async function pickRulers(reference, rulers, feed) {
  const picked = pickRic(await feed(ricSearch(reference, rulers)), reference);
  const struck = !unquote(reference.volume) && isMintOnly(unquote(reference.section));
  const loose = struck ? { ...reference, section: '' } : reference;
  if (picked.status === 'none') {
    const retry = pickRic(await feed(ricSearch(loose, struck ? rulers : [])), loose);
    return retry.status === 'ok' ? { status: 'candidates', candidates: [retry.entry], partial: true } : retry;
  }
  if (!struck || (picked.status !== 'ok' && picked.status !== 'candidates')) return picked;
  const found = picked.status === 'ok' ? [picked.entry] : picked.candidates;
  const own = pickRic(await feed(ricSearch(loose, rulers)), loose);
  const theirs = own.status === 'ok' ? [own.entry] : (own.candidates ?? []);
  const more = theirs.filter((entry) => !found.some(({ id }) => id === entry.id) && !isMintOnly(parseReference(entry.title, false)?.section ?? ''));
  // Too many of their coins to list is no evidence the mint's coin is the one: it is offered, not opened.
  if (more.length === 0 && own.status !== 'too-many') return picked;
  return { status: 'candidates', candidates: [...found, ...more], partial: true };
}

// The same search lot text makes, for a ruler typed into the guided field instead: the number with that name on OCRE's portrait and authority facets,
// and no section filter, which would throw the hits away again. Only a name RIC heads a ruler section with is worth asking for — a mint section
// (RIC VI–IX) has no portrait behind it — and the typed volume still narrows it.
async function pickPortrait(reference, feed) {
  const anyRuler = { ...reference, section: '' };
  return pickRic(await feed(ricSearch(anyRuler, [facetName(reference.section)])), anyRuler);
}

// A RIC number a lot row carries with a dotted letter behind it ("RIC 27 b.", lot.js DOTTED_LETTER) is read both ways: the plain number, and the
// lettered type. Where the lettered reading finds nothing of its own — no such type, or only other rulers' — the plain answer stands exactly as it
// always did ("Nero. RIC 306 f." is still Nero 306). Where it does, the text may mean either, so both are offered and neither is opened. A failed
// or too-broad plain lookup is returned as it is. An OCRE id the dealer linked settles it, and nothing else carries the letter.
const dottedLetterOf = (reference) => (reference?.catalogue === 'RIC' && typeof reference.dottedLetter === 'string' && /^[a-l]$/.test(reference.dottedLetter)
  && /^\d+$/.test(String(reference.number ?? '')) && typeof reference.id !== 'string' ? reference.dottedLetter : '');
// A lettered type the lookup marks as another person's still answers the row where it stands in the section the row names, or in one of its
// rulers' sections: RIC files a Caesar's coins in his Augustus's section ("RIC IV Trajan Decius 223C" carries Herennius's portrait). Another section's
// ("RIC V Gallienus 306f" behind a Nero heading) does not.
const ownSection = (entry, reference) => {
  const section = norm((parseReference(entry.title, false)?.section ?? '').split(' (')[0]);
  const named = [reference.section, ...(Array.isArray(reference.rulers) ? reference.rulers : [])].map((name) => norm(String(name ?? '').split(' (')[0]));
  return Boolean(section) && named.includes(section);
};
const readingHits = (result, reference = {}) => {
  if (result?.status === 'ok' && result.card?.id) return [{ id: result.card.id, title: result.card.label, ...(result.card.source === 'local' ? { source: 'local' } : {}) }];
  if (result?.status !== 'candidates') return [];
  return result.personMismatch ? (result.candidates ?? []).filter((entry) => ownSection(entry, reference)) : result.candidates ?? [];
};
// Whether a reading answered at all: a type, a choice, "not there" or "too many". A failed request (the network, a damaged bundle, a rate limit) says
// nothing about whether the lettered type exists.
const answered = (result) => ['ok', 'candidates', 'none', 'too-many'].includes(result?.status)
  || (result?.status === 'online-required' && ['none', 'too-many'].includes(result.localStatus));
export async function eitherReading(reference, look) {
  const letter = dottedLetterOf(reference);
  const { dottedLetter, ...plain } = reference ?? {};
  if (!letter) return look(dottedLetter === undefined ? reference : plain);
  const [one, other] = await Promise.all([look(plain), look({ ...plain, number: `${plain.number}${letter}`, range: undefined })]);
  // The lettered reading failed: the plain coin is offered alone, never opened on it; anything short of a coin is the failure, with its retry.
  if (other && !answered(other)) {
    return one?.status === 'ok' ? { status: 'candidates', candidates: readingHits(one), partial: true, corpus: one.card?.corpus ?? 'ocre', query: one.query ?? '' } : other;
  }
  const lettered = readingHits(other, plain);
  // A plain number the bundle does not hold, asked locally only, comes back as "online-required": it is still no answer beside the lettered one.
  const missing = one?.status === 'none' || (one?.status === 'online-required' && one.localStatus === 'none');
  if (lettered.length === 0 || !(missing || ['ok', 'candidates'].includes(one?.status))) return one;
  // The plain reading's choice goes in whole, other rulers' types included, as it was offered before the letter was read.
  const plainHits = one?.status === 'candidates' ? one.candidates ?? [] : readingHits(one);
  const offered = [...plainHits, ...lettered].filter((entry, index, all) => all.findIndex(({ id }) => id === entry.id) === index);
  return { status: 'candidates', candidates: offered, partial: true, corpus: one.corpus ?? other.corpus ?? 'ocre', query: one.query ?? other.query ?? '' };
}

export function lookupType(given, options = {}) {
  // Answered before any request: no catalogue here or online holds a first edition's numbers.
  const first = firstEditionCitation(given);
  if (first) return Promise.resolve({ status: 'first-edition', corpus: 'ocre', query: buildQuery(given).query, ...first });
  return eitherReading(given, (reference) => lookupOneType(reference, options));
}

async function lookupOneType(given, options = {}) {
  // A mint written by the name on the map today ("Trier") is RIC's own Latin section ("Treveri"). Every lookup arrives here — typed, guided or from a
  // lot row — so the name is read once, where the section is used, rather than in the parse the guided fields never run. The caller's own object is
  // left as it was.
  const mint = ricMintSection(given.section);
  const reference = mint ? { ...given, section: mint } : given;
  const { fetchImpl = fetch, cache = new Map(), timeoutMs = TIMEOUT_MS, cancel } = options;
  const built = buildQuery(reference);
  const { corpus, query, id } = built;
  const { localProvider, online = true } = options;
  // A reference without type data is its own card. The one exception is a Svoronos number PCO has replaced with the CPE type it became: the bundle
  // follows PCO's own link, and answers null for anything else, which is then the prices-only card it always was.
  if (corpus === OTHER) return (await localProvider?.lookupSvoronos?.(query)) ?? { status: 'ok', card: otherCard(query) };
  // A provider answers null for a corpus it does not bundle, and then this is an ordinary online lookup.
  const local = localProvider?.lookupType ? await localProvider.lookupType(reference) : null;
  if (local) {
    if (local.status === 'ok' || local.status === 'candidates' || local.status === 'too-many') return local;
    if (!online) return { status: 'online-required', localStatus: local.status, corpus, query };
  }
  const timer = withTimeout(timeoutMs, cancel);
  const feed = (q) => getText(`${ORIGIN}/${corpus}/apis/search?q=${encodeURIComponent(q)}`, fetchImpl, timer.signal);
  const search = async (q) => parseFeed(await feed(q));
  // A section typed or read from the reference itself ("RIC 268 (Elagabalus)") wins over rulers from the surrounding text. A mint is no ruler's
  // section, beside a mint volume or with no volume at all ("RIC 411 (Rome)" in a Nero lot), so there the rulers are still asked for.
  const byMint = MINT_VOLUMES.has(unquote(reference.volume)) || (!unquote(reference.volume) && isMintOnly(unquote(reference.section)));
  const rulers = corpus === 'ocre' && (!phrase(reference.section) || byMint) ? rulersOf(reference) : [];
  const shown = rulers.length ? `${query} (${rulers.join(', ')})` : query;
  try {
    let picked;
    let byPortrait = false;
    const mintPerson = corpus === 'ocre' && MINT_VOLUMES.has(unquote(reference.volume)) && isRicPerson(reference.section);
    if (mintPerson) {
      picked = await pickPortrait(reference, feed);
      byPortrait = picked.status === 'ok' || picked.status === 'candidates';
    } else if (corpus === BIGR) {
      picked = await pickBop(built, search, fetchImpl, timer.signal);
    } else if (rulers.length) {
      picked = await pickRulers(reference, rulers, feed);
    } else if (built.partial) {
      // One exact hit is the type, fetched like an exact pick; anything else kept is offered, all of it (one page holds at most 100).
      picked = pickRic(await feed(ricSearch(reference)), reference);
    } else if (id) {
      // SCO titles ("Seleucid Coins (part 1) 1266.2") never match "SC 1266.2", but the record id is predictable: fetch it directly,
      // and only when it is missing (404) run the plain search for "Did you mean"; any other failure is a network error.
      // The search is for the base number: SCO finds nothing for a missing "SC 1266.9" but finds sc.1.1266 for "SC 1266".
      // CPE and Newell numbers name their records the same way, and a missing one is a clean miss: nothing here says what a PCO or AGCO search
      // returns for a number, so no search is made for one, and the bundle offers the near misses of its own index before the lookup comes here.
      const record = await getJson(recordUrl(corpus, id), fetchImpl, timer.signal).then((jsonld) => ({ jsonld }), (error) => {
        if (error?.status === 404) return null;
        throw error;
      });
      if (record) return await cardOutcome(record.jsonld, corpus, { fetchImpl, cache, signal: timer.signal });
      picked = reference.catalogue === 'SC' ? pickMatch(inGroup(await search(`SC ${scBase(reference.number)}`), corpus, reference), query) : { status: 'none' };
    } else {
      // A quoted phrase is exact on every corpus; the loose plain search runs only on a miss, for "Did you mean".
      picked = pickMatch(await search(`"${query}"`), query);
      if (picked.status !== 'ok') picked = pickMatch(inGroup(await search(query), corpus, reference), query);
    }
    // A typed ruler and number that OCRE files under another emperor (Titus as Caesar under Vespasian) finds nothing by section, so ask the portrait
    // facet once before giving up — the answer the lot path has always had. Only its hits are taken: anything else leaves the original miss standing.
    // A section naming two people ("Leo II and Zeno") is skipped: no facet holds one, so the request could only ever come back empty.
    if (!mintPerson && picked.status === 'none' && corpus === 'ocre' && rulers.length === 0 && (namesASection(phrase(reference.section)) || isRicPerson(reference.section)) && !/\band\b/i.test(reference.section)) {
      // A second chance never downgrades the answer already in hand: a 5xx or a dropped connection here leaves the miss standing rather than turning a
      // clean "not found" into "couldn't reach numismatics.org".
      try {
        const retried = await pickPortrait(reference, feed);
        if (retried.status === 'ok' || retried.status === 'candidates') { picked = retried; byPortrait = true; }
      } catch { /* the miss already in hand stands */ }
    }
    if (picked.status !== 'ok') return { ...picked, corpus, query: shown };
    // A section read from a lot heading's mint alone says where the coin was struck, not whose it is: the heading may name a ruler the people table
    // cannot place ("Constantius I. Follis. Trier."), so the one type in that section is offered, never opened. A mint typed or chosen with no volume
    // and no rulers beside it ("RIC 411 (Rome)", "RIC Rome 411", Any volume) is the same case, with nothing at all to say whose coin it is.
    // Nor is a coin found for a joint heading one half of which is a section ("Philip I and Otacilia Severa"): that section is half of what it says.
    const halfHeading = rulers.length > 1 && rulers.some(isSectionOnly);
    if (reference.headingMint || (byMint && !unquote(reference.volume) && rulers.length === 0) || halfHeading || strayMint(reference, picked.entry.title)) return { status: 'candidates', candidates: [picked.entry], partial: true, corpus, query: shown };
    const found = await lookupById(corpus, picked.entry.id, { ...options, signal: timer.signal, citation: picked.citation });
    if (rulers.length && found.status === 'ok') {
      const asked = rulers.map(norm);
      if (![found.card.authority, found.card.portrait].some((name) => asked.includes(norm(name)))) {
        return { status: 'candidates', candidates: [picked.entry], partial: true, corpus, query: shown };
      }
    }
    // A coin from another ruler opens only when the card says why it is filed there AND the portrait it names is the ruler that was typed: the portrait
    // facet carries reverse portraits too, so a hit can be a third ruler's coin whose obverse happens to head the section. Anything else is offered.
    const typed = [reference.section, facetName(reference.section)].map((name) => norm(squash(name)));
    if (byPortrait && found.status === 'ok' && (!filingNote(found.card) || !typed.includes(norm(found.card.portrait)))) {
      return { status: 'candidates', candidates: [picked.entry], partial: true, corpus, query: shown };
    }
    return found;
  } catch (error) {
    if (!stoppedByCaller(timer.signal)) void recordFetchFailure('lookup', timer.signal.aborted ? timer.signal.reason : error);
    // X-04: what the bundle said before the request failed goes with the failure: "not in the bundle" is an answer the connection did not change.
    return local ? { ...failureOutcome(error, timer.signal), localStatus: local.status } : failureOutcome(error, timer.signal);
  } finally {
    timer.done();
  }
}

// Photographs of real coins of one type, for the card's opt-in specimen strip: at most three pairs, each an obverse and a reverse image, the specimen's
// own page and the collection that holds it, or [] for anything else. One SPARQL query to Nomisma, which harvests the museums' specimen records; the
// predicates are the ones Nomisma documents for a physical coin (https://nomisma.org/documentation/contribute/): nmo:hasTypeSeriesItem names the
// type, nmo:hasCollection the holder, nmo:hasObverse and nmo:hasReverse the sides, and foaf:thumbnail and foaf:depiction each side's images. The type
// is asked for under http and https alike, since the corpora publish it both ways. Nothing here is cached or stored: the caller draws the answer and
// forgets it. A failed, slow, oversized or unreadable answer is no specimens, never an error the card has to wait for.
export async function fetchSpecimens(card, { fetchImpl = fetch, timeoutMs = 8000, signal } = {}) {
  const TYPE_CORPORA = ['ocre', 'crro', 'pella', 'sco', 'bigr', 'pco', 'agco'];
  // An id is written into the query between angle brackets, so only the characters the corpora's ids use may reach it: none of them can end the
  // IRI or start another term. Nine bundled OCRE ids carry a "?" (a doubtful letter) or a "," (a list of numbers); both may stand in an IRI, and
  // whether Nomisma holds such a type as written or percent-encoded is not known, so both forms are asked for, as both schemes are.
  if (!TYPE_CORPORA.includes(card?.corpus) || !/^[A-Za-z0-9._~()+,?-]+$/.test(String(card.id ?? ''))) return [];
  const ids = [...new Set([card.id, card.id.replace(/[?,]/g, (character) => encodeURIComponent(character))])];
  const types = ids.flatMap((id) => ['http', 'https'].map((scheme) => `<${scheme}://numismatics.org/${card.corpus}/id/${id}>`));
  const query = [
    'PREFIX nmo: <http://nomisma.org/ontology#>',
    'PREFIX foaf: <http://xmlns.com/foaf/0.1/>',
    'PREFIX skos: <http://www.w3.org/2004/02/skos/core#>',
    'SELECT ?object (SAMPLE(?label) AS ?collection) (SAMPLE(?obverseThumb) AS ?obverseThumbnail) (SAMPLE(?obverseImage) AS ?obverseDepiction)',
    '  (SAMPLE(?reverseThumb) AS ?reverseThumbnail) (SAMPLE(?reverseImage) AS ?reverseDepiction) WHERE {',
    `  VALUES ?type { ${types.join(' ')} }`,
    '  ?object nmo:hasTypeSeriesItem ?type ; a nmo:NumismaticObject ; nmo:hasCollection ?holder ; nmo:hasObverse ?obverse ; nmo:hasReverse ?reverse .',
    '  ?holder skos:prefLabel ?label FILTER(langMatches(lang(?label), "en"))',
    '  OPTIONAL { ?obverse foaf:thumbnail ?obverseThumb } OPTIONAL { ?obverse foaf:depiction ?obverseImage }',
    '  OPTIONAL { ?reverse foaf:thumbnail ?reverseThumb } OPTIONAL { ?reverse foaf:depiction ?reverseImage }',
    '  FILTER((BOUND(?obverseThumb) || BOUND(?obverseImage)) && (BOUND(?reverseThumb) || BOUND(?reverseImage)))',
    '} GROUP BY ?object LIMIT 6',
  ].join('\n');
  const url = `https://nomisma.org/query?${new URLSearchParams({ query, output: 'json' })}`;
  // Only a page or an image the browser may follow as a web address: http(s), whatever else a record holds.
  const web = (binding) => {
    try {
      const value = String(binding?.value ?? '');
      return ['http:', 'https:'].includes(new URL(value).protocol) ? value : null;
    } catch { return null; }
  };
  // Its own deadline, and the caller's signal too: a card replaced before the answer stops the request rather than waiting it out.
  const stop = new AbortController();
  const cancel = () => stop.abort();
  const timer = setTimeout(cancel, timeoutMs);
  signal?.addEventListener('abort', cancel);
  try {
    const response = await fetchImpl(url, { signal: stop.signal, headers: { Accept: 'application/sparql-results+json' } });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    // Six short rows are a few kilobytes; a reply past this is not one.
    const bindings = JSON.parse(await boundedText(response, 256 * 1024))?.results?.bindings;
    if (!Array.isArray(bindings)) return [];
    const specimens = [];
    for (const row of bindings) {
      const specimen = {
        page: web(row?.object),
        collection: squash(row?.collection?.value ?? ''),
        obverse: web(row?.obverseThumbnail) ?? web(row?.obverseDepiction),
        reverse: web(row?.reverseThumbnail) ?? web(row?.reverseDepiction),
      };
      if (Object.values(specimen).some((value) => !value) || specimens.some((kept) => kept.page === specimen.page)) continue;
      specimens.push(specimen);
      if (specimens.length === 3) break;
    }
    return specimens;
  } catch (error) {
    if (!signal?.aborted) void recordFetchFailure('specimens', error);
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
