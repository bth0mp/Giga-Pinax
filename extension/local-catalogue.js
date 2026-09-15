import { formatDates, pickRicEntries } from './lookup.js';
import { isRicPerson, ricPeople } from './catalogues.js';
import { RIC_PEOPLE } from './ric-people.js';

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const shardPrefix = (id) => String(id).split('.')[1] ?? '';
const validPrefix = (prefix) => /^[0-9]+(?:_[0-9]+)?(?:\([0-9]+\))?$/.test(prefix);

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
  const shardPromises = new Map();
  const metadata = async () => {
    const value = await json(fetchImpl, new URL('metadata.json', baseUrl));
    if (value?.schemaVersion !== 1 || value.corpus !== 'ocre' || !value.shards || Array.isArray(value.shards) || !value.aliases || Array.isArray(value.aliases)) throw new Error('Invalid local OCRE metadata');
    for (const [prefix, filename] of Object.entries(value.shards)) if (!validPrefix(prefix) || filename !== `records-${prefix}.json`) throw new Error('Invalid local OCRE shard map');
    if (Object.entries(value.aliases).some(([oldId, canonicalId]) => typeof oldId !== 'string' || typeof canonicalId !== 'string')) throw new Error('Invalid local OCRE aliases');
    return value;
  };
  const loadMetadata = () => (metadataPromise ??= metadata());
  const loadIndex = async () => {
    const value = await json(fetchImpl, new URL('index.json', baseUrl));
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.some((entry) => !Array.isArray(entry) || entry.length !== 2 || entry.some((part) => typeof part !== 'string'))) throw new Error('Invalid local OCRE index');
    return value.entries.map(([id, title]) => ({ id, title }));
  };
  const indexEntries = () => (indexPromise ??= loadIndex());
  const shard = async (prefix, meta) => {
    if (!validPrefix(prefix) || typeof meta.shards[prefix] !== 'string') return null;
    if (!shardPromises.has(prefix)) shardPromises.set(prefix, json(fetchImpl, new URL(meta.shards[prefix], baseUrl)));
    const value = await shardPromises.get(prefix);
    if (value?.schemaVersion !== 1 || !value.records || Array.isArray(value.records)) throw new Error('Invalid local OCRE shard');
    return value.records;
  };
  const byId = async (id) => {
    const meta = await loadMetadata();
    const canonical = meta.aliases[id] ?? id;
    const records = await shard(shardPrefix(canonical), meta);
    const record = records?.[canonical];
    if (record && record.i !== canonical) throw new Error('Invalid local OCRE record id');
    const card = packedRecordToCard(record, cache);
    return card ? { status: 'ok', card } : { status: 'none', corpus: 'ocre' };
  };
  const recordById = async (id) => {
    const meta = await loadMetadata();
    const canonical = meta.aliases[id] ?? id;
    const records = await shard(shardPrefix(canonical), meta);
    const record = records?.[canonical];
    if (record && record.i !== canonical) throw new Error('Invalid local OCRE record id');
    return record ?? null;
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
        const people = personIds(reference);
        if (typeof reference.id === 'string') {
          const hinted = await recordById(reference.id);
          const citation = hinted && pickRicEntries([{ id: hinted.i, title: hinted.l }], citationReference(reference));
          if (citation?.status === 'ok' && (people.size === 0 || hasPerson(hinted, people))) return await byId(reference.id);
        }
        if (people.size > 0) {
          const citationRef = citationReference(reference);
          const picked = pickRicEntries(await indexEntries(), citationRef);
          const entries = picked.status === 'ok' ? [picked.entry] : (picked.candidates ?? []);
          if (entries.length === 0) return { ...picked, corpus: 'ocre', query: squash(`RIC ${reference.volume} ${reference.number}`) };
          const matched = [];
          for (const entry of entries) if (hasPerson(await recordById(entry.id), people)) matched.push(entry);
          if (matched.length > 0) {
            const final = pickRicEntries(matched, citationRef);
            if (final.status === 'ok') return await byId(final.entry.id);
            return { ...final, candidates: final.candidates?.map((entry) => ({ ...entry, source: 'local' })), corpus: 'ocre', query: squash(`RIC ${reference.volume} ${reference.number}`) };
          }
          const candidates = entries.map((entry) => ({ ...entry, source: 'local' }));
          return { status: 'candidates', candidates, partial: true, personMismatch: true, corpus: 'ocre', query: squash(`RIC ${reference.volume} ${reference.number}`) };
        }
        let picked = pickRicEntries(await indexEntries(), reference);
        let broadened = false;
        if (picked.status === 'none' && reference.section) { picked = pickRicEntries(await indexEntries(), { ...reference, section: '' }); broadened = picked.status !== 'none'; }
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
