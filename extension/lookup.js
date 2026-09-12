import { RIC_SECTIONS, RIC_VOLUMES, volumesOf } from './catalogues.js';

export const HOST_ORIGINS = Object.freeze(['https://numismatics.org/*', 'https://nomisma.org/*']);
export const TIMEOUT_MS = 15000;

const ORDINALS = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth' };
const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const norm = (value) => squash(value).toLowerCase();
// The hidden characters dealer pages add (soft hyphens, zero-width and direction marks, bidi controls, word joiners, a byte order mark) would split a
// copied reference inside a word; parseReference and a right-click selection drop them first. NBSP and other Unicode spaces are squashed as spaces.
export const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

// A typed catalogue prefix ("RRC 44/5", "Cr. 44/5", "Craw. 44/5", "Price 23", "SC 1266.2", "Bop. 24A") would otherwise be doubled in the query and
// the acsearch term. It is stripped only before the number itself, so "Crawfrd 44/5" or "Cr . 44/5" stay as typed.
const PREFIX = { RRC: /^(?:RRC|Craw(?:f|ford)?\.?|Cr\.?)\s*(?=\d|$)/i, Price: /^Price\s*(?=\d|$)/i, SC: /^(?:SC|Seleucid Coins)\s*(?=\d|$)/i, Bop: /^(?:Bopearachchi|Bop\.?)[\s-]*(?=\d|$)/i };
// Every SCO record lives at sc.1.{number}, whatever the volume part of Seleucid Coins it belongs to.
const SCO_ID = 'sc.1.';
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

export function referenceNumber(catalogue, number) {
  const value = unquote(number);
  return Object.hasOwn(PREFIX, catalogue) ? value.replace(PREFIX[catalogue], '') : value;
}

// Bopearachchi series letters are upper case in BIGR's citations ("24A"), so a typed "24a" is normalised before it is searched or compared.
export const bopSeries = (number) => referenceNumber('Bop', number).toUpperCase();

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
// SCO's own titles ("Seleucid Coins (part 1) 1266.2", as a Recent chip stores them) read as SC too, so a chip fills the fields like the others.
const SIMPLE_REFERENCE = {
  RRC: /^(?:RRC|Craw(?:f|ford)?\.?|Cr\.?)\s*(\d\S*)$/i,
  Price: /^Price\s*(\d\S*)$/i,
  SC: /^(?:SC|Seleucid Coins(?: \(part \d+\))?)\s*(\d\S*)$/i,
};
// "Bop Euthydemus I 24A", "Bopearachchi 9C", "Bop-9C" (prefix first, king optional) or "Euthydemus I Bop. 24A", "Euthydemus I, Bop 24A" (king first).
// The king starts with a non-digit and holds no digit; the series is the last token and starts with a digit. "Bop" must end the word, so "Bopearachi 9C" fails.
const BOP = String.raw`(?:Bopearachchi|Bop\.?)(?![a-z])`;
const BOP_REFERENCE = new RegExp(String.raw`^(?:${BOP}[\s-]*(?:([^\d\s][^\d]*?)\s+)?|([^\d\s][^\d]*?)\s*,?\s*${BOP}[\s-]*)(\d\S*)$`, 'i');
// RIC, optional "vol.", volume I–X or 1–10 (not followed by a letter or digit, so "XI" fails), optional part (".3", "/3", ",3", ", Part 3", " part 3"),
// optional second-edition marker, then the ruler or mint section if any (starting with a non-digit, so "RIC I 2 Nero 306" fails)
// and finally the last token starting with a digit, with an optional parenthetical.
const RIC_REFERENCE = /^RIC\s*(?:vol\.?\s*)?(X|IX|VIII|VII|VI|V|IV|III|II|I|10|[1-9])(?![a-z\d])(?:\s*(?:[./,]\s*(?:part\s*)?|part\s*)(\d)(?!\d))?(\s*(?:²|\(2\)|\(2nd ed(?:ition|\.)?\)|2nd ed(?:ition|\.)?|\(second edition\)))?(?:(?:\s*,\s*|\s+)([^\d\s].*?))?\s+(\d\S*(?: \([^)]*\))?)$/i;
// No volume: "RIC 972", "RIC Titus 123" or a bare "Titus 123", the number as above. The ruler must be one OCRE has, or the name of one it splits
// into sections ("Theodosius II" for its East and West), checked by volumesOf, so "RIC hello 5", "RIC XI Nero 1" and "Euthydemus I 24A" stay unread,
// and a number alone needs the RIC prefix.
const RIC_ANY_VOLUME = /^(?:RIC(?![a-z])\s*(?:([^\d\s].*?)\s+)?|([^\d\s].*?)\s+)(\d\S*(?: \([^)]*\))?)$/i;
const MAX_REFERENCE = 120;
// Text that begins like a supported catalogue, or like a title of one (BIGR's, which Recent chips and suggestions carry), is never Other: unread there it
// is a typo ("Bopearachi 9C", "Crawfrd 44/5", "RIC XI Nero 1") and stays an error, as does text without a letter or a digit ("hello", "Price", "972").
// A short name must end its word, so catalogues that only share its letters ("Ricci", "Schulten", "SCBI", Sydenham's "CRR", "Craig") are Other.
export const SUPPORTED = new RegExp(`^(?:(?:RIC|RRC|SC|SCO|Cr)(?![a-z])|Craw|Price|Seleucid|Bop|${BIGR_TITLE.trim()})`, 'i');
// Nor is a numbered part that names one after other words ("cf. RIC 972", "Lot 80: RIC 972", "cf. Craw. 44/5"), which would search a type as loose
// text; "RIC –" (not in RIC) has no number. The Crawford names are the ones PREFIX reads.
const NAMED = /(?:^|[^\p{L}])(?:RIC|RRC|Cr|Craw(?:f|ford)?|Price|SC|Seleucid|Bop|Bopearachchi)(?!\p{L})/iu;
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
// An Other text with its SG and KM parts in those spellings; any other text is kept as it is.
const otherPart = (part) => sgNumber(part) ?? kmNumber(part);
const otherNumber = (value, parts = value.split(';').map(unwrap)) => (parts.some(otherPart) ? parts.map((part) => otherPart(part) ?? part).join('; ') : value);

// References are ";"-separated ("SC 2195.5c; SNG Spaer 1712"): the first one a type rule reads is looked up, else the whole text is Other.
// The hidden characters go before anything else, the length cap included.
export function parseReference(text) {
  const visible = String(text ?? '').replace(INVISIBLE, '');
  if (squash(visible).length > MAX_REFERENCE) return null;
  const value = unwrap(unquote(visible));
  const parts = value.split(';').map(unwrap);
  for (const part of parts) {
    const type = readType(part);
    if (type) return type;
  }
  const supported = SUPPORTED.test(value) || parts.some((part) => /\d/.test(part) && NAMED.test(part));
  return /\p{L}/u.test(value) && /\d/.test(value) && !supported ? { catalogue: 'Other', number: otherNumber(value, parts), volume: '', section: '' } : null;
}

// One reference, read by the rules of the catalogues that have type data, or null.
function readType(value) {
  for (const [catalogue, pattern] of Object.entries(SIMPLE_REFERENCE)) {
    const number = value.match(pattern)?.[1];
    if (number) return { catalogue, number, volume: '', section: '' };
  }
  const bop = value.match(BOP_REFERENCE);
  if (bop) return { catalogue: 'Bop', number: bop[3], volume: '', section: squash(bop[1] ?? bop[2] ?? '') };
  const ric = value.match(RIC_REFERENCE);
  if (ric) {
    const [, numeral, part, edition, section = '', number] = ric;
    const roman = /^\d/.test(numeral) ? ROMAN[Number(numeral) - 1] : numeral.toUpperCase();
    const volume = `${roman}${part ? `, Part ${part}` : ''}${edition ? ' (2nd edition)' : ''}`;
    return { catalogue: 'RIC', number, volume, section };
  }
  const any = value.match(RIC_ANY_VOLUME);
  const ruler = any?.[1] ?? any?.[2] ?? '';
  if (!any || (ruler && volumesOf(ruler).length === 0)) return null;
  return { catalogue: 'RIC', number: any[3], volume: '', section: ruler };
}

// RPC has no open type data here, but RPC Online has a page per type, which only the user opens (Giga Pinax never fetches RPC): "RPC I 1234" and
// "RPC I, 1234" are coins/1/1234, "RPC V.2 1234" ("V/2", "V, Part 2") coins/5.2/1234, the volume in Arabic numerals. Null for anything else.
const RPC_REFERENCE = /^RPC\s*(X|IX|VIII|VII|VI|V|IV|III|II|I|10|[1-9])(?![a-z\d])(?:\s*(?:[./]|,?\s*part)\s*(\d)(?!\d))?\s*,?\s*(\d+)$/i;
export function rpcUrl(text) {
  const [, numeral, part, number] = String(text ?? '').trim().match(RPC_REFERENCE) ?? [];
  if (!number) return null;
  const volume = /^\d/.test(numeral) ? Number(numeral) : ROMAN.indexOf(numeral.toUpperCase()) + 1;
  return `https://rpc.ashmus.ox.ac.uk/coins/${volume}${part ? `.${part}` : ''}/${number}`;
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
  if (catalogue === 'RRC') return { corpus: 'crro', query: squash(`RRC ${referenceNumber('RRC', number)}`) };
  if (catalogue === 'SC') {
    const sc = referenceNumber('SC', number);
    return { corpus: 'sco', query: squash(`SC ${sc}`), id: `${SCO_ID}${sc}` };
  }
  if (catalogue === 'Bop') {
    // The section field is the king (English, as BIGR titles it); the query names the reference the way the popup reports a miss.
    const king = unquote(section);
    const series = bopSeries(number);
    return { corpus: BIGR, query: squash(`Bopearachchi ${king} ${series}`), king, series };
  }
  // Cleaned as parseReference cleans it, so the guided field and the Reference box give the same card, Recent chip and term.
  if (catalogue === 'Other') return { corpus: OTHER, query: otherNumber(unwrap(unquote(number))) };
  return { corpus: 'pella', query: squash(`Price ${referenceNumber('Price', number)}`) };
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

export function nomismaLabel(jsonld, slug) {
  const node = graphOf(jsonld).find((entry) => entry['@id'] === `nm:${slug}` || entry['@id'] === `${NOMISMA}${slug}` || entry['@id'] === `http://nomisma.org/id/${slug}`);
  return english(node?.['skos:prefLabel']);
}

export function toCard(jsonld, corpus, labels = {}) {
  const main = mainNode(jsonld);
  if (!main) return null;
  const uri = main['@id'];
  const id = uri.split('/').pop();
  const side = (name) => {
    const node = graphOf(jsonld).find((entry) => entry['@id'] === `${uri}#${name}`) ?? {};
    return { legend: english(node['nmo:hasLegend']), description: english(node['dcterms:description']) };
  };
  const [authority, denomination, mint, material] = namedSlugs(main).map((slug) => (slug ? labels[slug] ?? slug : null));
  return {
    id,
    uri,
    corpus,
    label: english(main['skos:prefLabel']) ?? id,
    authority,
    denomination,
    mint,
    material,
    dates: formatDates(main['nmo:hasStartDate']?.[0]?.['@value'], main['nmo:hasEndDate']?.[0]?.['@value']),
    obverse: side('obverse'),
    reverse: side('reverse'),
  };
}

// What a BIGR card carries beyond the record: the king as BIGR titles it and the Bopearachchi series, both null-safe when the citation was unreadable.
export const bopDetails = (title, citation) => ({ king: kingOf(title), series: citation ? seriesOf(citation) : null, citation: citation ?? null });

const ORIGIN = 'https://numismatics.org';
const recordUrl = (corpus, id) => `${ORIGIN}/${corpus}/id/${encodeURIComponent(id)}.jsonld`;
const nudsUrl = (corpus, id) => `${ORIGIN}/${corpus}/id/${encodeURIComponent(id)}.xml`;
// Many NUDS records in one <nudsGroup>. The "|" between ids is encoded too: the server refuses a bare one with HTTP 400.
const groupUrl = (corpus, ids) => `${ORIGIN}/${corpus}/apis/getNuds?identifiers=${encodeURIComponent(ids.join('|'))}`;

async function getText(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// The error carries the HTTP status so a caller can tell a missing record (404) from an outage.
async function getJson(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal, headers: { Accept: 'application/ld+json' } });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  return response.json();
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export async function resolveLabels(slugs, { fetchImpl = fetch, cache = new Map(), signal } = {}) {
  const labels = {};
  await Promise.all(slugs.map(async (slug) => {
    const cached = cache.get(slug);
    if (cached) { labels[slug] = cached; return; }
    try {
      const label = nomismaLabel(await getJson(`${NOMISMA}${slug}.jsonld`, fetchImpl, signal), slug);
      if (label) { labels[slug] = label; cache.set(slug, label); }
    } catch { /* unlabelled concepts fall back to their slug */ }
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
  const labels = await resolveLabels(nomismaSlugs(jsonld), { fetchImpl, cache, signal });
  const card = toCard(jsonld, corpus, labels);
  if (!card) return { status: 'network' };
  if (corpus === BIGR) card.bop = bopDetails(card.label, citation === undefined ? await fetchCitation(card.id, fetchImpl, signal) : citation);
  return { status: 'ok', card };
}

// No type data, so no request: the text is the id and the label (a Recent chip stores both).
const otherCard = (text) => ({ id: text, corpus: OTHER, label: text, authority: null, denomination: null, mint: null, material: null, dates: null,
  obverse: { legend: null, description: null }, reverse: { legend: null, description: null } });

export async function lookupById(corpus, id, options = {}) {
  // A chip saved before 0.19 ("SG6829v") takes the SG spelling; any other id stays as saved, so its remembered term still matches.
  if (corpus === OTHER) return { status: 'ok', card: otherCard(otherNumber(id)) };
  const { fetchImpl = fetch, cache = new Map(), timeoutMs = TIMEOUT_MS, signal, citation } = options;
  const timer = signal ? { signal, done() {} } : withTimeout(timeoutMs);
  try {
    const jsonld = await getJson(recordUrl(corpus, id), fetchImpl, timer.signal);
    return await cardOutcome(jsonld, corpus, { fetchImpl, cache, signal: timer.signal, citation });
  } catch {
    return { status: 'network' };
  } finally {
    timer.done();
  }
}

// The SC number up to its first "." ("1266.9" → "1266").
const scBase = (number) => referenceNumber('SC', number).split('.')[0];

// CRRO's plain search also matches dates ("44/5a" finds "480/5a"), so its suggestions must share the typed Crawford group;
// SCO's must share the typed base number ("1266.9" keeps sc.1.1266 and sc.1.1266.x, never sc.1.12660).
// Filtering before pickMatch lets a loose search with many hits still yield up to five in-group suggestions.
function inGroup(entries, corpus, reference) {
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
function ricSearch({ number, volume, section }, rulers = []) {
  const [, base, word] = ricNumber(number).match(/^(.*?)\s*(?:\(([^)]*)\))?$/);
  const clauses = [...new Set([base.toLowerCase(), base.toUpperCase()])].flatMap((form) => (word
    ? [...new Set([word, word.toLowerCase()])].map((typed) => `typeNumber:"${form}_${typed}"`)
    : [`typeNumber:"${form}"`, ...(/^\d+[a-z]*$/i.test(form) ? [`typeNumber:${form}_*`] : [])]));
  const group = (list) => (list.length > 1 ? `(${list.join(' OR ')})` : list[0]);
  const facets = rulers.flatMap((name) => [`portrait_facet:"${name}"`, `authority_facet:"${name}"`]);
  const narrow = [volumePhrase(unquote(volume)), phrase(section)].filter(Boolean).map((text) => ` AND "${text}"`).join('');
  return `${group(clauses)}${facets.length ? ` AND ${group(facets)}` : ''}${narrow}`;
}

// Kept: the RIC types with the typed number (with any word OCRE stores after it, unless a word is typed), in the typed volume and by the typed ruler
// when given, in RIC volume order. Only subtypes are dropped ("RIC V Gallienus 306: Subtype 1" reads as section "Gallienus 306: Subtype"); "Salonina
// (2)" is a real section. A listed volume matches exactly; one OCRE does not list matches by numeral, and by part where OCRE divides it ("I" finds I²,
// "V, Part 2" finds V). A ruler also keeps the sections OCRE splits it into ("Gallienus (joint reign)"). More hits than one page are too many to list.
function pickRic(xml, reference) {
  const entries = parseFeed(xml);
  if (Number(xml.match(/<opensearch:totalResults>(\d+)</)?.[1] ?? 0) > entries.length) return { status: 'too-many' };
  const [number, volume, ruler] = [spaced(ricNumber(reference.number)), unquote(reference.volume), norm(phrase(reference.section))];
  const exact = !volume || listed(volume);
  const [numeral, part] = shelf(volume);
  const onShelf = ([n, p]) => n === numeral && (!part || !DIVIDED.has(n) || p === part);
  const inVolume = (hit) => (exact ? !volume || norm(hit.volume) === norm(volume) : onShelf(shelf(hit.volume)));
  const byRuler = (section) => !ruler || norm(section) === ruler || norm(section).startsWith(`${ruler} (`);
  const rank = (hit) => RIC_VOLUMES.findIndex((option) => option.value === hit.volume);
  const kept = entries.map((entry) => ({ entry, hit: parseReference(entry.title) }))
    .filter(({ hit }) => hit?.catalogue === 'RIC' && !hit.section.includes(':') && [spaced(hit.number), bareNumber(hit.number)].includes(number)
      && inVolume(hit) && byRuler(hit.section))
    .sort((a, b) => rank(a.hit) - rank(b.hit) || byText(a.hit.section, b.hit.section) || byText(a.entry.title, b.entry.title));
  if (kept.length === 0) return { status: 'none' };
  // One hit is the type only when it is what was typed; a sibling section, or the edition of a volume typed another way, is offered, never opened.
  if (kept.length === 1 && exact && (!ruler || norm(kept[0].hit.section) === ruler)) return { status: 'ok', entry: kept[0].entry };
  return { status: 'candidates', candidates: kept.map(({ entry }) => entry), partial: true };
}

// The rulers a lot text names before its first reference, phrase-safe and deduplicated; only a RIC reference without a section uses them. The facets
// hold OCRE's names: "Gaius/Caligula" whole (either half finds nothing), and Claudius Gothicus as "Claudius II Gothicus".
const FACET_NAMES = Object.freeze({ 'Claudius Gothicus': 'Claudius II Gothicus' });
const rulersOf = (reference) => [...new Set((Array.isArray(reference.rulers) ? reference.rulers : [])
  .map((name) => phrase(FACET_NAMES[name] ?? String(name ?? ''))).filter(Boolean))];

// A RIC number with rulers read from a lot text: the facets already tie each hit to a ruler, and a Titus-as-Caesar coin sits in the Vespasian
// section, so pickRic runs without a section and one kept hit is the type, as pickRic decides it (a volume typed another way, "RIC I", is still only
// offered). A miss retries the plain number search once, and those hits are only offered, even a single one, since nothing tied them to the rulers.
async function pickRulers(reference, rulers, feed) {
  const picked = pickRic(await feed(ricSearch(reference, rulers)), reference);
  if (picked.status !== 'none') return picked;
  const retry = pickRic(await feed(ricSearch(reference)), reference);
  return retry.status === 'ok' ? { status: 'candidates', candidates: [retry.entry], partial: true } : retry;
}

export async function lookupType(reference, options = {}) {
  const { fetchImpl = fetch, cache = new Map(), timeoutMs = TIMEOUT_MS } = options;
  const built = buildQuery(reference);
  const { corpus, query, id } = built;
  if (corpus === OTHER) return { status: 'ok', card: otherCard(query) };
  const timer = withTimeout(timeoutMs);
  const feed = (q) => getText(`${ORIGIN}/${corpus}/apis/search?q=${encodeURIComponent(q)}`, fetchImpl, timer.signal);
  const search = async (q) => parseFeed(await feed(q));
  // A section typed or read from the reference itself ("RIC 268 (Elagabalus)") wins over rulers from the surrounding text.
  const rulers = corpus === 'ocre' && !phrase(reference.section) ? rulersOf(reference) : [];
  const shown = rulers.length ? `${query} (${rulers.join(', ')})` : query;
  try {
    let picked;
    if (corpus === BIGR) {
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
      const record = await getJson(recordUrl(corpus, id), fetchImpl, timer.signal).then((jsonld) => ({ jsonld }), (error) => {
        if (error?.status === 404) return null;
        throw error;
      });
      if (record) return await cardOutcome(record.jsonld, corpus, { fetchImpl, cache, signal: timer.signal });
      picked = pickMatch(inGroup(await search(`SC ${scBase(reference.number)}`), corpus, reference), query);
    } else {
      // A quoted phrase is exact on every corpus; the loose plain search runs only on a miss, for "Did you mean".
      picked = pickMatch(await search(`"${query}"`), query);
      if (picked.status !== 'ok') picked = pickMatch(inGroup(await search(query), corpus, reference), query);
    }
    if (picked.status !== 'ok') return { ...picked, corpus, query: shown };
    return await lookupById(corpus, picked.entry.id, { ...options, signal: timer.signal, citation: picked.citation });
  } catch {
    return { status: 'network' };
  } finally {
    timer.done();
  }
}
