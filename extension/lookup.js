export const HOST_ORIGINS = Object.freeze(['https://numismatics.org/*', 'https://nomisma.org/*']);
export const TIMEOUT_MS = 15000;

const ORDINALS = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth' };
const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const norm = (value) => squash(value).toLowerCase();

// A typed catalogue prefix ("RRC 44/5", "Cr. 44/5", "Price 23", "SC 1266.2", "Bop. 24A") would otherwise be doubled in the query and the acsearch term.
// It is stripped only before the number itself, so "Crawf 44/5" or "Cr . 44/5" stay as typed.
const PREFIX = { RRC: /^(?:RRC|Crawford|Cr\.?)\s*(?=\d|$)/i, Price: /^Price\s*(?=\d|$)/i, SC: /^(?:SC|Seleucid Coins)\s*(?=\d|$)/i, Bop: /^(?:Bopearachchi|Bop\.?)[\s-]*(?=\d|$)/i };
// Every SCO record lives at sc.1.{number}, whatever the volume part of Seleucid Coins it belongs to.
const SCO_ID = 'sc.1.';
// Bopearachchi (1991) references resolve through BIGR, whose own numbering ("Euthydemus I 13.1") differs from Bopearachchi's series ("Euthydème I 24A");
// the series is read from each record's NUDS XML, which is where BIGR keeps the citation.
const BIGR = 'bigr';
const BIGR_TITLE = 'Bactrian and Indo-Greek Coinage ';
const BOP_KEY = 'http://nomisma.org/id/bopearachchi-1991';
// Hits verified per lookup (each costs one XML request inside the shared deadline); a bare series such as "9C" has 16 hits.
const VERIFY_LIMIT = 24;

// Stray quotes would unbalance the quoted phrase search; curly ones arrive when a reference is copied from prose.
const unquote = (value) => squash(String(value ?? '').replace(/["“”„]/g, ''));

export function referenceNumber(catalogue, number) {
  const value = unquote(number);
  return Object.hasOwn(PREFIX, catalogue) ? value.replace(PREFIX[catalogue], '') : value;
}

// Bopearachchi series letters are upper case in BIGR's citations ("24A"), so a typed "24a" is normalised before it is searched or compared.
export const bopSeries = (number) => referenceNumber('Bop', number).toUpperCase();

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
// SCO's own titles ("Seleucid Coins (part 1) 1266.2", as a Recent chip stores them) read as SC too, so a chip fills the fields like the others.
const SIMPLE_REFERENCE = {
  RRC: /^(?:RRC|Crawford|Cr\.?)\s*(\d\S*)$/i,
  Price: /^Price\s*(\d\S*)$/i,
  SC: /^(?:SC|Seleucid Coins(?: \(part \d+\))?)\s*(\d\S*)$/i,
};
// "Bop Euthydemus I 24A", "Bopearachchi 9C", "Bop-9C" (prefix first, king optional) or "Euthydemus I Bop. 24A", "Euthydemus I, Bop 24A" (king first).
// The king starts with a non-digit and holds no digit; the series is the last token and starts with a digit. "Bop" must end the word, so "Bopearachi 9C" fails.
const BOP = String.raw`(?:Bopearachchi|Bop\.?)(?![a-z])`;
const BOP_REFERENCE = new RegExp(String.raw`^(?:${BOP}[\s-]*(?:([^\d\s][^\d]*?)\s+)?|([^\d\s][^\d]*?)\s*,?\s*${BOP}[\s-]*)(\d\S*)$`, 'i');
// RIC, optional "vol.", volume I–X or 1–10 (not followed by a letter or digit, so "XI" fails), optional part (".3", "/3", ",3", ", Part 3", " part 3"),
// optional second-edition marker, then the ruler or mint section (starting with a non-digit, so "RIC I 2 Nero 306" fails)
// and finally the last token starting with a digit, with an optional parenthetical.
const RIC_REFERENCE = /^RIC\s*(?:vol\.?\s*)?(X|IX|VIII|VII|VI|V|IV|III|II|I|10|[1-9])(?![a-z\d])(?:\s*(?:[./,]\s*(?:part\s*)?|part\s*)(\d)(?!\d))?(\s*(?:²|\(2\)|\(2nd ed(?:ition|\.)?\)|2nd ed(?:ition|\.)?|\(second edition\)))?(?:\s*,\s*|\s+)([^\d\s].*?)\s+(\d\S*(?: \([^)]*\))?)$/i;
const MAX_REFERENCE = 120;

export function parseReference(text) {
  if (squash(text).length > MAX_REFERENCE) return null;
  const value = unquote(text);
  for (const [catalogue, pattern] of Object.entries(SIMPLE_REFERENCE)) {
    const number = value.match(pattern)?.[1];
    if (number) return { catalogue, number, volume: '', section: '' };
  }
  const bop = value.match(BOP_REFERENCE);
  if (bop) return { catalogue: 'Bop', number: bop[3], volume: '', section: squash(bop[1] ?? bop[2] ?? '') };
  const ric = value.match(RIC_REFERENCE);
  if (!ric) return null;
  const [, numeral, part, edition, section, number] = ric;
  const roman = /^\d/.test(numeral) ? ROMAN[Number(numeral) - 1] : numeral.toUpperCase();
  const volume = `${roman}${part ? `, Part ${part}` : ''}${edition ? ' (2nd edition)' : ''}`;
  return { catalogue: 'RIC', number, volume, section };
}

export function buildQuery({ catalogue, number, volume, section }) {
  if (catalogue === 'RIC') {
    const edition = unquote(volume).replace(/\b(1st|2nd|3rd|4th)\b/gi, (match) => ORDINALS[match.toLowerCase()]);
    return { corpus: 'ocre', query: squash(`RIC ${edition} ${unquote(section)} ${unquote(number)}`) };
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

// Fails closed: a missing or unreadable NUDS record is null (unverified). Only the deadline propagates, so a timed-out lookup is still a network error.
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

export async function lookupById(corpus, id, options = {}) {
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
// NUDS citation, in parallel: exact when the series matches. The verified hits keep their citation so the card needs no second XML request.
async function verifyBop(entries, series, fetchImpl, signal) {
  return Promise.all(entries.slice(0, VERIFY_LIMIT).map(async (entry) => {
    const citation = await fetchCitation(entry.id, fetchImpl, signal);
    return { ...entry, citation, exact: citation !== null && norm(seriesOf(citation)) === norm(series) };
  }));
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

export async function lookupType(reference, options = {}) {
  const { fetchImpl = fetch, cache = new Map(), timeoutMs = TIMEOUT_MS } = options;
  const built = buildQuery(reference);
  const { corpus, query, id } = built;
  const timer = withTimeout(timeoutMs);
  const search = async (q) => parseFeed(await getText(`${ORIGIN}/${corpus}/apis/search?q=${encodeURIComponent(q)}`, fetchImpl, timer.signal));
  try {
    let picked;
    if (corpus === BIGR) {
      picked = await pickBop(built, search, fetchImpl, timer.signal);
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
    if (picked.status !== 'ok') return { ...picked, corpus, query };
    return await lookupById(corpus, picked.entry.id, { ...options, signal: timer.signal, citation: picked.citation });
  } catch {
    return { status: 'network' };
  } finally {
    timer.done();
  }
}
