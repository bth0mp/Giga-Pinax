import { formatDates, otherVolumePart, pickRicEntries } from './lookup.js';
import { isRicPerson, ricPeople } from './catalogues.js';
import { RIC_PEOPLE } from './ric-people.js';

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const shardPrefix = (id) => String(id).split('.')[1] ?? '';
const validPrefix = (prefix) => /^[0-9]+(?:_[0-9]+)?(?:\([0-9]+\))?$/.test(prefix);
// A volume too large for one file is split into parts named in id order, so every part's name is derived here and none is ever read from the data.
const shardFile = (prefix, parts, position) => `records-${prefix}${parts.length === 1 ? '' : `.${String.fromCharCode(97 + position)}`}.json`;
// The part a record lives in: the last one whose first id it has reached. The first part carries no lower bound, so an id before every record still
// asks a real file and comes back empty rather than throwing.
const shardPart = (parts, id) => parts.reduce((chosen, part) => (part.from <= id ? part : chosen), parts[0]);
// The key numbers.json lists an index position under: the leading integer of the RIC number, zeros stripped as the importer strips them. Null for a
// number no key can be taken from — pickRicEntries drops quotes and backslashes from anywhere in the number, which could uncover other digits, and
// such a lookup reads the whole index as it always did rather than the wrong part of it.
const numberKey = (value) => {
  const text = String(value ?? '').trim();
  const digits = /["“”„\\]/.test(text) ? undefined : text.match(/^\d+/)?.[0];
  return digits ? digits.replace(/^0+(?=\d)/, '') : null;
};

function labelFor(values, cache) {
  if (!Array.isArray(values) || values.length !== 1) return null;
  return cache?.get?.(values[0]) ?? values[0];
}

const PEOPLE_BY_ID = new Map(RIC_PEOPLE.map((person) => [person.id, person.name]));

export function packedRecordToCard(record, cache = new Map()) {
  if (!record || typeof record.i !== 'string' || typeof record.l !== 'string') return null;
  const authority = labelFor(record.a, { get: (id) => cache?.get?.(id) ?? PEOPLE_BY_ID.get(id) });
  const portraits = record.o?.p;
  const portrait = record.a?.length === 1 && portraits?.length === 1 ? cache?.get?.(portraits[0]) ?? PEOPLE_BY_ID.get(portraits[0]) ?? null : null;
  const side = (value = {}) => ({ legend: typeof value.l === 'string' ? value.l : null, description: typeof value.d === 'string' ? value.d : null });
  return {
    id: record.i, uri: `https://numismatics.org/ocre/id/${encodeURIComponent(record.i)}`, corpus: 'ocre', label: record.l,
    authority, denomination: labelFor(record.d, cache), mint: labelFor(record.m, cache), material: labelFor(record.x, cache),
    portrait, dates: formatDates(record.s, record.e), obverse: side(record.o), reverse: side(record.r), source: 'local',
  };
}

export function catalogueMetadataText(metadata) {
  if (!metadata || !Number.isInteger(metadata.recordCount) || !Number.isInteger(metadata.activeRecordCount)) return 'Local OCRE catalogue unavailable.';
  const count = (value) => new Intl.NumberFormat('en-GB').format(value);
  const generated = typeof metadata.generatedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metadata.generatedOn)
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${metadata.generatedOn}T00:00:00Z`)) : 'unknown';
  const publication = metadata.publicationDate ? `Source published ${metadata.publicationDate}.` : 'Source publication date unknown.';
  return `${count(metadata.activeRecordCount)} active types from ${count(metadata.recordCount)} OCRE records. Local files generated ${generated}. ${publication}`;
}

async function json(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 0}`);
  return response.json();
}

export function createLocalCatalogue({ fetchImpl = fetch, baseUrl = new URL('./data/ocre/', import.meta.url), cache = new Map() } = {}) {
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
    const value = await json(fetchImpl, new URL('metadata.json', baseUrl));
    if (value?.schemaVersion !== 1 || value.corpus !== 'ocre' || !value.shards || Array.isArray(value.shards) || !value.aliases || Array.isArray(value.aliases)) throw new Error('Invalid local OCRE metadata');
    for (const [prefix, parts] of Object.entries(value.shards)) {
      if (!validPrefix(prefix) || !Array.isArray(parts) || parts.length === 0) throw new Error('Invalid local OCRE shard map');
      // The parts of a volume are its own files in id order: each named as it was written, the first taking everything before the second's first id.
      if (parts.some((part, position) => part?.file !== shardFile(prefix, parts, position) || typeof part.from !== 'string'
        || (position === 0 ? part.from !== '' : part.from <= parts[position - 1].from))) throw new Error('Invalid local OCRE shard map');
    }
    if (Object.entries(value.aliases).some(([oldId, canonicalId]) => typeof oldId !== 'string' || typeof canonicalId !== 'string')) throw new Error('Invalid local OCRE aliases');
    return value;
  };
  const loadMetadata = () => (metadataPromise ??= retried(metadata, () => { metadataPromise = undefined; }));
  const loadIndex = async () => {
    const value = await json(fetchImpl, new URL('index.json', baseUrl));
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.some((entry) => !Array.isArray(entry) || entry.length !== 2 || entry.some((part) => typeof part !== 'string'))) throw new Error('Invalid local OCRE index');
    return value.entries;
  };
  const indexEntries = () => (indexPromise ??= retried(loadIndex, () => { indexPromise = undefined; }));
  const loadNumbers = async () => {
    const value = await json(fetchImpl, new URL('numbers.json', baseUrl));
    if (value?.schemaVersion !== 1 || !value.numbers || Array.isArray(value.numbers)) throw new Error('Invalid local OCRE number index');
    return value.numbers;
  };
  const numberIndex = () => (numbersPromise ??= retried(loadNumbers, () => { numbersPromise = undefined; }));
  // The entries a number can possibly be in: the positions numbers.json lists it under, in index order, so pickRicEntries parses a few dozen titles
  // instead of all 52,254. A number without a key, and a range without one, fall back to the whole index and the answer is the same either way.
  const numbered = async (reference) => {
    const keys = [reference.number, ...(reference.range ? [reference.range] : [])].map(numberKey);
    const wanted = keys.every((key) => key !== null);
    const [entries, numbers] = await Promise.all([indexEntries(), wanted ? numberIndex() : null]);
    const asEntry = ([id, title]) => ({ id, title });
    if (!numbers) return entries.map(asEntry);
    return [...new Set(keys.flatMap((key) => numbers[key] ?? []))].sort((a, b) => a - b).map((position) => {
      const entry = Number.isInteger(position) && position >= 0 ? entries[position] : undefined;
      if (!entry) throw new Error('Invalid local OCRE number index');
      return asEntry(entry);
    });
  };
  const shardRecords = async (url) => {
    const value = await json(fetchImpl, url);
    if (value?.schemaVersion !== 1 || !value.records || Array.isArray(value.records)) throw new Error('Invalid local OCRE shard');
    return value.records;
  };
  const shard = (prefix, meta, id) => {
    const parts = meta.shards[prefix];
    if (!validPrefix(prefix) || !Array.isArray(parts) || parts.length === 0) return null;
    const { file } = shardPart(parts, id);
    if (!shardPromises.has(file)) {
      shardPromises.set(file, retried(() => shardRecords(new URL(file, baseUrl)), () => shardPromises.delete(file)));
    }
    return shardPromises.get(file);
  };
  // The one path from an id to its packed record: the alias map, the shard part it lives in, and the record's own id checked against the one asked
  // for. The index is never read for it — the id names its volume, and the metadata names the file that volume's part of the alphabet is in.
  const recordById = async (id) => {
    const meta = await loadMetadata();
    const canonical = meta.aliases[id] ?? id;
    const record = (await shard(shardPrefix(canonical), meta, canonical))?.[canonical];
    if (record && record.i !== canonical) throw new Error('Invalid local OCRE record id');
    return record ?? null;
  };
  const byId = async (id) => {
    const card = packedRecordToCard(await recordById(id), cache);
    return card ? { status: 'ok', card } : { status: 'none', corpus: 'ocre' };
  };
  const personIds = (reference) => {
    const names = isRicPerson(reference.section) ? [reference.section] : (Array.isArray(reference.rulers) ? reference.rulers : []);
    return new Set(names.flatMap((name) => ricPeople(name).map(({ id }) => id)));
  };
  const hasPerson = (record, ids) => [...(record?.a ?? []), ...(record?.o?.p ?? [])].some((id) => ids.has(id));
  const citationReference = (reference) => ({ ...reference, section: isRicPerson(reference.section) ? '' : reference.section, id: undefined, rulers: undefined });
  return {
    async lookupById(corpus, id) {
      if (corpus !== 'ocre') return null;
      try { return await byId(id); } catch { return { status: 'unavailable', source: 'local' }; }
    },
    async lookupType(reference) {
      if (reference?.catalogue !== 'RIC') return null;
      try {
        await loadMetadata();
        // The entries carrying this number, read once however many times the pick is retried: broadening changes the volume and the section, never
        // the number every candidate must have.
        let scoped;
        const candidateEntries = () => (scoped ??= numbered(reference));
        const people = personIds(reference);
        if (typeof reference.id === 'string') {
          const hinted = await recordById(reference.id);
          const citation = hinted && pickRicEntries([{ id: hinted.i, title: hinted.l }], citationReference(reference));
          if (citation?.status === 'ok' && (people.size === 0 || hasPerson(hinted, people))) return await byId(reference.id);
        }
        if (people.size > 0) {
          const citationRef = citationReference(reference);
          const picked = pickRicEntries(await candidateEntries(), citationRef);
          const entries = picked.status === 'ok' ? [picked.entry] : (picked.candidates ?? []);
          if (entries.length === 0) return { ...picked, corpus: 'ocre', query: squash(`RIC ${reference.volume} ${reference.number}`) };
          // Candidates of one number spread across volumes, so across shards: they are fetched together, not one lookup's wait after another.
          const records = await Promise.all(entries.map((entry) => recordById(entry.id)));
          const matched = entries.filter((entry, index) => hasPerson(records[index], people));
          if (matched.length > 0) {
            let final = pickRicEntries(matched, citationRef);
            // A plain volume numeral reaches every part of its family, and those parts number the same ruler differently: such a hit is the answer
            // to a different book, so it is offered here exactly as pickRicEntries offers it when the section was typed out.
            if (final.status === 'ok' && !otherVolumePart(reference, final.entry.title)) return await byId(final.entry.id);
            if (final.status === 'ok') final = { status: 'candidates', candidates: [final.entry], partial: true };
            return { ...final, candidates: final.candidates?.map((entry) => ({ ...entry, source: 'local' })), corpus: 'ocre', query: squash(`RIC ${reference.volume} ${reference.number}`) };
          }
          const candidates = entries.map((entry) => ({ ...entry, source: 'local' }));
          return { status: 'candidates', candidates, partial: true, personMismatch: true, corpus: 'ocre', query: squash(`RIC ${reference.volume} ${reference.number}`) };
        }
        let picked = pickRicEntries(await candidateEntries(), reference);
        let broadened = false;
        // The section the collector asked for is what he is looking at: a volume is broadened before it, so the same mint or ruler in another volume
        // comes before another section of the volume he typed. A section dropped altogether leaves other rulers' coins, which are choices, never the answer.
        if (picked.status === 'none' && reference.section && reference.volume) { picked = pickRicEntries(await candidateEntries(), { ...reference, volume: '' }); broadened = picked.status !== 'none'; }
        if (picked.status === 'none' && reference.section) { picked = pickRicEntries(await candidateEntries(), { ...reference, section: '' }); broadened = picked.status !== 'none'; }
        if (picked.status === 'ok' && (broadened || reference.rulers?.length)) picked = { status: 'candidates', candidates: [picked.entry], partial: true };
        if (picked.candidates) picked.candidates = picked.candidates.map((entry) => ({ ...entry, source: 'local' }));
        if (picked.status !== 'ok') return { ...picked, corpus: 'ocre', query: squash(`RIC ${reference.volume} ${reference.section} ${reference.number}`) };
        return await byId(picked.entry.id);
      } catch { return { status: 'unavailable', source: 'local' }; }
    },
    metadata: async () => {
      try { return await loadMetadata(); } catch { return null; }
    },
  };
}

const extensionProtocol = /^(?:moz|chrome)-extension:$/.test(new URL(import.meta.url).protocol);
export const defaultLocalCatalogue = extensionProtocol ? createLocalCatalogue() : null;
