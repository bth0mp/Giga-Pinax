export const HOST_ORIGINS = Object.freeze(['https://numismatics.org/*', 'https://nomisma.org/*']);
export const TIMEOUT_MS = 15000;

const ORDINALS = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth' };
const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const norm = (value) => squash(value).toLowerCase();

// A typed catalogue prefix ("RRC 44/5", "Cr. 44/5", "Price 23") would otherwise be doubled in the query and the acsearch term.
const PREFIX = { RRC: /^(?:RRC|Crawford|Cr\.?) ?/i, Price: /^Price ?/i };

export function referenceNumber(catalogue, number) {
  const value = squash(number);
  return Object.hasOwn(PREFIX, catalogue) ? value.replace(PREFIX[catalogue], '') : value;
}

export function buildQuery({ catalogue, number, volume, section }) {
  if (catalogue === 'RIC') {
    const edition = squash(volume).replace(/\b(1st|2nd|3rd|4th)\b/gi, (match) => ORDINALS[match.toLowerCase()]);
    return { corpus: 'ocre', query: squash(`RIC ${edition} ${squash(section)} ${squash(number)}`) };
  }
  if (catalogue === 'RRC') return { corpus: 'crro', query: squash(`RRC ${referenceNumber('RRC', number)}`) };
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

const ORIGIN = 'https://numismatics.org';

async function getText(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function getJson(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal, headers: { Accept: 'application/ld+json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export async function resolveLabels(slugs, { fetchImpl, cache, signal }) {
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

export async function lookupById(corpus, id, options = {}) {
  const { fetchImpl = fetch, cache = new Map(), timeoutMs = TIMEOUT_MS, signal } = options;
  const timer = signal ? { signal, done() {} } : withTimeout(timeoutMs);
  try {
    const jsonld = await getJson(`${ORIGIN}/${corpus}/id/${encodeURIComponent(id)}.jsonld`, fetchImpl, timer.signal);
    const labels = await resolveLabels(nomismaSlugs(jsonld), { fetchImpl, cache, signal: timer.signal });
    const card = toCard(jsonld, corpus, labels);
    return card ? { status: 'ok', card } : { status: 'network' };
  } catch {
    return { status: 'network' };
  } finally {
    timer.done();
  }
}

// CRRO's plain search also matches dates ("44/5a" finds "480/5a"), so its suggestions must share the typed Crawford group.
function sameGroup(picked, corpus, reference) {
  if (corpus !== 'crro' || picked.status !== 'candidates') return picked;
  const prefix = `rrc ${referenceNumber('RRC', reference.number).split('/')[0].trim()}/`;
  const candidates = picked.candidates.filter((entry) => norm(entry.title).startsWith(prefix));
  return candidates.length ? { status: 'candidates', candidates } : { status: 'none' };
}

export async function lookupType(reference, options = {}) {
  const { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = options;
  const { corpus, query } = buildQuery(reference);
  const timer = withTimeout(timeoutMs);
  const search = async (q) => parseFeed(await getText(`${ORIGIN}/${corpus}/apis/search?q=${encodeURIComponent(q)}`, fetchImpl, timer.signal));
  try {
    // A quoted phrase is exact on every corpus; the loose plain search runs only on a miss, for "Did you mean".
    let picked = pickMatch(await search(`"${query}"`), query);
    if (picked.status !== 'ok') picked = sameGroup(pickMatch(await search(query), query), corpus, reference);
    if (picked.status !== 'ok') return { ...picked, corpus, query };
    return await lookupById(corpus, picked.entry.id, { ...options, signal: timer.signal });
  } catch {
    return { status: 'network' };
  } finally {
    timer.done();
  }
}
