import { buildQuery, formatDates, inGroup, otherVolumePart, pickMatch, pickRicEntries } from './lookup.js';
import { isRicPerson, ricPeople } from './catalogues.js';
import { RIC_PEOPLE } from './ric-people.js';

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
// Every corpus bundled inside the package, and the three things that differ between them: the URI its records are
// published under, the shard group an identifier falls in, and what a valid group name looks like. ANS writes CRRO,
// PELLA and SCO identifiers over http in both their RDF and their JSON-LD, so that is what a local card says and it is
// what the online card for the same record says; OCRE's card has written https since the bundle existed, and that is
// the one field where a local card and an online card of the same record differ.
export const LOCAL_CORPORA = Object.freeze({
  ocre: { uri: 'https://numismatics.org/ocre/id/', label: 'OCRE', group: (id) => String(id).split('.')[1] ?? '',
    groups: /^[0-9]+(?:_[0-9]+)?(?:\([0-9]+\))?$/, people: true },
  crro: { uri: 'http://numismatics.org/crro/id/', label: 'CRRO', group: () => 'rrc', groups: /^rrc$/ },
  pella: { uri: 'http://numismatics.org/pella/id/', label: 'PELLA', group: () => 'price', groups: /^price$/ },
  sco: { uri: 'http://numismatics.org/sco/id/', label: 'SCO', group: () => 'sc', groups: /^sc$/ },
});
// A volume too large for one file is split into parts named in id order, so every part's name is derived here and none is ever read from the data.
const shardFile = (prefix, parts, position) => `records-${prefix}${parts.length === 1 ? '' : `.${String.fromCharCode(97 + position)}`}.json`;
// The part a record lives in: the last one whose first id it has reached. The first part carries no lower bound, so an id before every record still
// asks a real file and comes back empty rather than throwing.
const shardPart = (parts, id) => parts.reduce((chosen, part) => (part.from <= id ? part : chosen), parts[0]);
// The key numbers.json lists an index position under: the leading integer of the RIC number, zeros stripped as the importer strips them. Null for a
// number no key can be taken from — pickRicEntries drops quotes and backslashes from anywhere in the number, which could uncover other digits, and
// such a lookup reads the whole index as it always did rather than the wrong part of it.
export const numberKey = (value) => {
  const text = String(value ?? '').trim();
  const digits = /["“”„\\]/.test(text) ? undefined : text.match(/^\d+/)?.[0];
  return digits ? digits.replace(/^0+(?=\d)/, '') : null;
};

// A JSON object and nothing else: a number or a string in place of a map has no entries and no keys, so it would read as a bundle that simply holds
// nothing, and a lookup would answer "not in RIC" from a file that is plainly not the one the package ships.
const isMap = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function labelFor(values, cache) {
  if (!Array.isArray(values) || values.length !== 1) return null;
  return cache?.get?.(values[0]) ?? values[0];
}

const PEOPLE_BY_ID = new Map(RIC_PEOPLE.map((person) => [person.id, person.name]));
// The checked-in Nomisma snapshot was filtered against OCRE's own authority and portrait concepts, so it names RIC's
// people and nobody else's. A Seleucid or Republican identifier it happens to carry would be a label taken from a
// source that was never asked about that corpus, so only OCRE reads it; every other corpus leaves an identifier the
// label cache cannot resolve exactly as unresolved as the online card leaves it.
const NO_PEOPLE = new Map();

export function packedRecordToCard(record, cache = new Map(), corpus = 'ocre') {
  if (!record || typeof record.i !== 'string' || typeof record.l !== 'string') return null;
  const people = LOCAL_CORPORA[corpus]?.people ? PEOPLE_BY_ID : NO_PEOPLE;
  const named = (id) => cache?.get?.(id) ?? people.get(id);
  const authority = labelFor(record.a, { get: named });
  const portraits = record.o?.p;
  const portrait = record.a?.length === 1 && portraits?.length === 1 ? named(portraits[0]) ?? null : null;
  const side = (value = {}) => ({ legend: typeof value.l === 'string' ? value.l : null, description: typeof value.d === 'string' ? value.d : null });
  return {
    id: record.i, uri: `${LOCAL_CORPORA[corpus].uri}${encodeURIComponent(record.i)}`, corpus, label: record.l,
    authority, denomination: labelFor(record.d, cache), mint: labelFor(record.m, cache), material: labelFor(record.x, cache),
    portrait, dates: formatDates(record.s, record.e), obverse: side(record.o), reverse: side(record.r), source: 'local',
  };
}

export function catalogueMetadataText(metadata) {
  const corpus = LOCAL_CORPORA[metadata?.corpus];
  if (!corpus || !Number.isInteger(metadata.recordCount) || !Number.isInteger(metadata.activeRecordCount)) return 'Local catalogue unavailable.';
  const count = (value) => new Intl.NumberFormat('en-GB').format(value);
  const generated = typeof metadata.generatedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metadata.generatedOn)
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${metadata.generatedOn}T00:00:00Z`)) : 'unknown';
  const publication = metadata.publicationDate ? `Source published ${metadata.publicationDate}.` : 'Source publication date unknown.';
  // Only a corpus bundled in part records what it left out, and then the panel says so in the source's own words.
  const left = Number.isInteger(metadata.excluded?.count) && typeof metadata.excluded.reason === 'string'
    ? `, leaving out ${count(metadata.excluded.count)} (${metadata.excluded.reason})` : '';
  return `${count(metadata.activeRecordCount)} active types from ${count(metadata.recordCount)} ${corpus.label} records${left}. Local files generated ${generated}. ${publication}`;
}

async function json(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 0}`);
  return response.json();
}

// One corpus's files, loaded on demand and never before: a popup that opens, or a lookup of another catalogue, reads
// nothing at all, and a lookup by identifier reads the metadata and one shard.
function createStore(name, fetchImpl, baseUrl) {
  const corpus = LOCAL_CORPORA[name];
  const base = new URL(`${name}/`, baseUrl);
  let metadataPromise;
  let indexPromise;
  let numbersPromise;
  const shardPromises = new Map();
  // A failed load is never remembered: one dropped request would otherwise leave a rejected promise in hand for the life of the page, and every later
  // lookup would fail on it without asking again. The slot is cleared as the rejection passes, so the next lookup retries.
  const retried = (load, forget) => {
    const promise = load();
    promise.catch(forget);
    return promise;
  };
  const metadata = async () => {
    const value = await json(fetchImpl, new URL('metadata.json', base));
    if (value?.schemaVersion !== 1 || value.corpus !== name || !isMap(value.shards) || !isMap(value.aliases)) throw new Error(`Invalid local ${corpus.label} metadata`);
    for (const [prefix, parts] of Object.entries(value.shards)) {
      if (!corpus.groups.test(prefix) || !Array.isArray(parts) || parts.length === 0) throw new Error(`Invalid local ${corpus.label} shard map`);
      // Past the twenty-sixth part there is no letter left to name one, and fromCharCode would carry on past "z".
      if (parts.length > 26) throw new Error(`Local ${corpus.label} group ${prefix} has more parts than there are letters to name them`);
      // The parts of a volume are its own files in id order: each named as it was written, the first taking everything before the second's first id.
      if (parts.some((part, position) => part?.file !== shardFile(prefix, parts, position) || typeof part.from !== 'string'
        || (position === 0 ? part.from !== '' : part.from <= parts[position - 1].from))) throw new Error(`Invalid local ${corpus.label} shard map`);
    }
    if (Object.entries(value.aliases).some(([oldId, canonicalId]) => typeof oldId !== 'string' || typeof canonicalId !== 'string')) throw new Error(`Invalid local ${corpus.label} aliases`);
    return value;
  };
  const loadMetadata = () => (metadataPromise ??= retried(metadata, () => { metadataPromise = undefined; }));
  const loadIndex = async () => {
    const value = await json(fetchImpl, new URL('index.json', base));
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.some((entry) => !Array.isArray(entry) || entry.length !== 2 || entry.some((part) => typeof part !== 'string'))) throw new Error(`Invalid local ${corpus.label} index`);
    return value.entries;
  };
  const indexEntries = () => (indexPromise ??= retried(loadIndex, () => { indexPromise = undefined; }));
  const loadNumbers = async () => {
    const value = await json(fetchImpl, new URL('numbers.json', base));
    if (value?.schemaVersion !== 1 || !Number.isInteger(value.entryCount) || !isMap(value.numbers)) throw new Error(`Invalid local ${corpus.label} number index`);
    return value;
  };
  const numberIndex = () => (numbersPromise ??= retried(loadNumbers, () => { numbersPromise = undefined; }));
  const shardRecords = async (url) => {
    const value = await json(fetchImpl, url);
    if (value?.schemaVersion !== 1 || !isMap(value.records)) throw new Error(`Invalid local ${corpus.label} shard`);
    return value.records;
  };
  const shard = (prefix, meta, id) => {
    const parts = meta.shards[prefix];
    if (!corpus.groups.test(prefix) || !Array.isArray(parts) || parts.length === 0) return null;
    const { file } = shardPart(parts, id);
    if (!shardPromises.has(file)) {
      shardPromises.set(file, retried(() => shardRecords(new URL(file, base)), () => shardPromises.delete(file)));
    }
    return shardPromises.get(file);
  };
  // The one path from an id to its packed record: the alias map, the shard part it lives in, and the record's own id checked against the one asked
  // for. The index is never read for it — the id names its group, and the metadata names the file that group's part of the alphabet is in.
  const recordById = async (id) => {
    const meta = await loadMetadata();
    const canonical = meta.aliases[id] ?? id;
    const record = (await shard(corpus.group(canonical), meta, canonical))?.[canonical];
    if (record && record.i !== canonical) throw new Error(`Invalid local ${corpus.label} record id`);
    return record ?? null;
  };
  return { loadMetadata, indexEntries, numberIndex, recordById };
}

export function createLocalCatalogue({ fetchImpl = fetch, baseUrl = new URL('./data/', import.meta.url), cache = new Map() } = {}) {
  const stores = new Map();
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, createStore(name, fetchImpl, baseUrl));
    return stores.get(name);
  };
  const byId = async (name, id) => {
    const card = packedRecordToCard(await store(name).recordById(id), cache, name);
    return card ? { status: 'ok', card } : { status: 'none', corpus: name };
  };
  // The entries a lookup compares titles against, as objects rather than the pairs the file stores.
  const entries = async (name) => (await store(name).indexEntries()).map(([id, title]) => ({ id, title }));
  // The entries carrying a RIC number: the positions numbers.json lists it under, in index order, so pickRicEntries parses a few dozen titles
  // instead of all 52,254. A number without a key, and a range without one, fall back to the whole index and the answer is the same either way.
  const numbered = async (reference) => {
    const keys = [reference.number, ...(reference.range ? [reference.range] : [])].map(numberKey);
    const wanted = keys.every((key) => key !== null);
    const ocre = store('ocre');
    const [meta, listed, index] = await Promise.all([ocre.loadMetadata(), entries('ocre'), wanted ? ocre.numberIndex() : null]);
    if (!index) return listed;
    // A number index built against another index still lists positions that resolve, and the lookup would quietly miss
    // whatever the two disagree about. The count it carries is what tells the two apart.
    if (index.entryCount !== listed.length || index.entryCount !== meta.activeRecordCount) throw new Error('Invalid local OCRE number index');
    const { numbers } = index;
    return [...new Set(keys.flatMap((key) => numbers[key] ?? []))].sort((a, b) => a - b).map((position) => {
      const entry = Number.isInteger(position) && position >= 0 ? listed[position] : undefined;
      if (!entry) throw new Error('Invalid local OCRE number index');
      return entry;
    });
  };
  const personIds = (reference) => {
    const names = isRicPerson(reference.section) ? [reference.section] : (Array.isArray(reference.rulers) ? reference.rulers : []);
    return new Set(names.flatMap((name) => ricPeople(name).map(({ id }) => id)));
  };
  const hasPerson = (record, ids) => [...(record?.a ?? []), ...(record?.o?.p ?? [])].some((id) => ids.has(id));
  const citationReference = (reference) => ({ ...reference, section: isRicPerson(reference.section) ? '' : reference.section, id: undefined, rulers: undefined });
  const local = (picked, name, query) => ({ ...picked, candidates: picked.candidates?.map((entry) => ({ ...entry, source: 'local' })), corpus: name, query });

  // A RIC reference is matched against OCRE's titles, which carry the volume and the section a collector typed as well
  // as the number, so it is the one corpus whose lookup is a search rather than an identifier.
  async function ricLookup(reference) {
    await store('ocre').loadMetadata();
    // The entries carrying this number, read once however many times the pick is retried: broadening changes the volume and the section, never
    // the number every candidate must have.
    let scoped;
    const candidateEntries = () => (scoped ??= numbered(reference));
    const people = personIds(reference);
    const recordById = (id) => store('ocre').recordById(id);
    if (typeof reference.id === 'string') {
      const hinted = await recordById(reference.id);
      const citation = hinted && pickRicEntries([{ id: hinted.i, title: hinted.l }], citationReference(reference));
      if (citation?.status === 'ok' && (people.size === 0 || hasPerson(hinted, people))) return await byId('ocre', reference.id);
    }
    if (people.size > 0) {
      const citationRef = citationReference(reference);
      const picked = pickRicEntries(await candidateEntries(), citationRef);
      const entries = picked.status === 'ok' ? [picked.entry] : (picked.candidates ?? []);
      const query = squash(`RIC ${reference.volume} ${reference.number}`);
      if (entries.length === 0) return { ...picked, corpus: 'ocre', query };
      // Candidates of one number spread across volumes, so across shards: they are fetched together, not one lookup's wait after another.
      const records = await Promise.all(entries.map((entry) => recordById(entry.id)));
      const matched = entries.filter((entry, index) => hasPerson(records[index], people));
      if (matched.length > 0) {
        let final = pickRicEntries(matched, citationRef);
        // A plain volume numeral reaches every part of its family, and those parts number the same ruler differently: such a hit is the answer
        // to a different book, so it is offered here exactly as pickRicEntries offers it when the section was typed out.
        if (final.status === 'ok' && !otherVolumePart(reference, final.entry.title)) return await byId('ocre', final.entry.id);
        if (final.status === 'ok') final = { status: 'candidates', candidates: [final.entry], partial: true };
        return local(final, 'ocre', query);
      }
      return { status: 'candidates', candidates: entries.map((entry) => ({ ...entry, source: 'local' })), partial: true, personMismatch: true, corpus: 'ocre', query };
    }
    let picked = pickRicEntries(await candidateEntries(), reference);
    let broadened = false;
    // The section the collector asked for is what he is looking at: a volume is broadened before it, so the same mint or ruler in another volume
    // comes before another section of the volume he typed. A section dropped altogether leaves other rulers' coins, which are choices, never the answer.
    if (picked.status === 'none' && reference.section && reference.volume) { picked = pickRicEntries(await candidateEntries(), { ...reference, volume: '' }); broadened = picked.status !== 'none'; }
    if (picked.status === 'none' && reference.section) { picked = pickRicEntries(await candidateEntries(), { ...reference, section: '' }); broadened = picked.status !== 'none'; }
    if (picked.status === 'ok' && (broadened || reference.rulers?.length)) picked = { status: 'candidates', candidates: [picked.entry], partial: true };
    if (picked.status !== 'ok') return local(picked, 'ocre', squash(`RIC ${reference.volume} ${reference.section} ${reference.number}`));
    return await byId('ocre', picked.entry.id);
  }

  // CRRO, PELLA and SCO title a type with the reference itself ("RRC 44/5", "Price 23"), so the local answer is the one
  // the online path builds from its own search: the record the reference names outright where it names one, else the
  // exact title, else the group's near misses that pickMatch is willing to offer. Anything short of that is no local
  // answer at all and the caller falls back online.
  async function titleLookup(built, reference) {
    const { corpus: name, query, id } = built;
    if (typeof id === 'string') {
      const found = await byId(name, id);
      if (found.status === 'ok') return found;
    }
    // The quoted phrase search first, which is exact over the whole corpus ("RRC 98B" is titled with no group slash),
    // then the loose search narrowed to the reference's own group, which is where the near misses come from.
    const listed = await entries(name);
    let picked = pickMatch(listed, query);
    if (picked.status !== 'ok') picked = pickMatch(inGroup(listed, name, reference), query);
    if (picked.status === 'ok') return await byId(name, picked.entry.id);
    return local(picked, name, query);
  }

  return {
    serves: (name) => Object.hasOwn(LOCAL_CORPORA, name),
    async lookupById(name, id) {
      if (!Object.hasOwn(LOCAL_CORPORA, name)) return null;
      try { return await byId(name, id); } catch { return { status: 'unavailable', source: 'local' }; }
    },
    async lookupType(reference) {
      if (!reference?.catalogue) return null;
      const built = buildQuery(reference);
      if (!Object.hasOwn(LOCAL_CORPORA, built.corpus)) return null;
      try { return built.corpus === 'ocre' ? await ricLookup(reference) : await titleLookup(built, reference); }
      catch { return { status: 'unavailable', source: 'local' }; }
    },
    metadata: async (name = 'ocre') => {
      if (!Object.hasOwn(LOCAL_CORPORA, name)) return null;
      try { return await store(name).loadMetadata(); } catch { return null; }
    },
  };
}

const extensionProtocol = /^(?:moz|chrome)-extension:$/.test(new URL(import.meta.url).protocol);
export const defaultLocalCatalogue = extensionProtocol ? createLocalCatalogue() : null;
