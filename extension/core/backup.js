import { SCHEMA_VERSION, migrateSnapshot, validateSnapshot } from './records.js';
import { sameEventKey } from './evidence.js';
import { findDuplicateLot } from './lot-context.js';

export const BACKUP_FORMAT = 'ancient-coin-auction-companion';
// Exports are compact, but backups written by earlier builds were indented: the import bound has to
// clear a pretty-printed copy of a full store, while the store's own 5 MiB bound still decides what
// the resulting snapshot may hold.
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

const COLLECTIONS = [
  'lots', 'auctionEvents', 'alternativeGroups', 'evidence',
  'collectionEntries', 'alerts',
];
// Preferences and alerts are never merged: the collector's own settings stay, and alerts are
// re-derived from the merged events by the next reconcile. Lots come after the records they point
// at, and collection entries after the lots they pair with.
const MERGED_COLLECTIONS = ['auctionEvents', 'alternativeGroups', 'evidence', 'lots', 'collectionEntries'];
const CONFLICT_SENTENCES = {
  'same-sale-collision': 'the same sale with different numbers, kept local',
  'lot-not-merged': 'attached to a lot this merge did not take, skipped',
};
const fail = (code, message, path) => ({ ok: false, error: { code, message, ...(path ? { path } : {}) } });
const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);

function clone(value) {
  return structuredClone(value);
}

function bytes(value) {
  return new TextEncoder().encode(value).length;
}

function canonicalInstant(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function exportableSnapshot(snapshot) {
  const data = clone(snapshot);
  data.recentCommands = [];
  data.drafts = [];
  return data;
}

export function exportBackup(snapshot, now) {
  if (!canonicalInstant(now)) return fail('invalid-timestamp', 'Export time must be a canonical UTC timestamp.', 'exportedAt');
  const data = exportableSnapshot(snapshot);
  const valid = validateSnapshot(data);
  if (!valid.ok) return fail('invalid-snapshot', valid.error.message, `data.${valid.error.path ?? ''}`);
  // Indentation doubled a full store's export past its own bound, so the file is written compact.
  const document = JSON.stringify({
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    data,
  });
  if (bytes(document) > MAX_BACKUP_BYTES) return fail('file-too-large', 'Backup exceeds the 16 MiB limit.');
  return { ok: true, value: document };
}

export function validateBackup(document) {
  let value = document;
  if (typeof document === 'string') {
    if (bytes(document) > MAX_BACKUP_BYTES) return fail('file-too-large', 'Backup exceeds the 16 MiB limit.');
    try { value = JSON.parse(document); } catch { return fail('invalid-json', 'Backup is not valid JSON.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid-document', 'Backup must be an object.');
  if (value.format !== BACKUP_FORMAT) return fail('invalid-format', 'Backup format is not recognized.', 'format');
  // Only a backup from a later build is refused on sight. An older one is migrated first and then
  // judged on what the migration produced, so a version this build can still read imports.
  if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion > SCHEMA_VERSION) {
    return fail('unsupported-schema', 'Backup schema version is unsupported.', 'schemaVersion');
  }
  if (!canonicalInstant(value.exportedAt)) return fail('invalid-timestamp', 'Export time is invalid.', 'exportedAt');
  const data = migrateSnapshot(clone(value.data));
  if (!data || typeof data !== 'object') return fail('invalid-document', 'Backup data is missing.', 'data');
  if (Array.isArray(data.recentCommands) && data.recentCommands.length) {
    return fail('private-ledger', 'Backup must not contain recent request IDs.', 'data.recentCommands');
  }
  data.recentCommands = [];
  data.drafts = [];
  const valid = validateSnapshot(data);
  if (!valid.ok) return fail(valid.error.code, valid.error.message, `data.${valid.error.path ?? ''}`);
  return { ok: true, value: data };
}

function counts(snapshot) {
  return Object.fromEntries(COLLECTIONS.map((key) => [key, snapshot[key].length]));
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evidenceBody(row) {
  const body = clone(row);
  for (const key of ['id', 'revision', 'createdAt', 'updatedAt']) delete body[key];
  return body;
}

// The collector's own row wins a tie: a backup never silently overwrites what is in front of them.
function incomingWins(local, record) {
  if (record.revision !== local.revision) return record.revision > local.revision;
  if (record.updatedAt !== local.updatedAt) return record.updatedAt > local.updatedAt;
  return false;
}

function saleKey(row) {
  if (!row?.saleIdentity) return null;
  const sale = sameEventKey(row.saleIdentity);
  return sale.ok ? sale.value : null;
}

// Two installs number the members of an alternative group from one independently, so a merged group
// can hold two lots at the same priority. Ordering is presentation rather than collector data: the
// local lots keep theirs and the merged-in lots follow, and only a group that validation would
// reject is renumbered at all.
function compactPriorities(snapshot, localLotIds) {
  const members = new Map();
  for (const lot of snapshot.lots) {
    if (!own(lot, 'alternativeGroupId')) continue;
    members.set(lot.alternativeGroupId, [...(members.get(lot.alternativeGroupId) ?? []), lot]);
  }
  for (const group of members.values()) {
    const priorities = group.map(({ priority }) => priority).sort((left, right) => left - right);
    if (priorities.every((priority, index) => priority === index + 1)) continue;
    group.sort((left, right) =>
      ((localLotIds.has(right.id) ? 1 : 0) - (localLotIds.has(left.id) ? 1 : 0)) ||
      (left.priority - right.priority) || left.id.localeCompare(right.id));
    group.forEach((lot, index) => { lot.priority = index + 1; });
  }
}

// Quarantine is a recovery bin rather than live data, so a merge unions both bins and drops only
// entries that are identical to one already there.
function mergeQuarantine(snapshot, current, incoming) {
  const entries = clone(current.quarantine ?? []);
  const seen = new Set(entries.map((entry) => JSON.stringify(entry)));
  let gained = 0;
  for (const entry of incoming.quarantine ?? []) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(clone(entry));
    gained += 1;
  }
  if (entries.length) snapshot.quarantine = entries;
  return gained;
}

export function previewImport(current, incoming, mode) {
  const currentValid = validateSnapshot(current);
  if (!currentValid.ok) return fail('invalid-current', currentValid.error.message, currentValid.error.path);
  const incomingValid = validateSnapshot(incoming);
  if (!incomingValid.ok) return fail('invalid-incoming', incomingValid.error.message, incomingValid.error.path);
  if (mode !== 'merge' && mode !== 'replace') return fail('invalid-mode', 'Import mode must be merge or replace.', 'mode');
  const summary = { outgoing: counts(current), incoming: counts(incoming) };
  if (mode === 'replace') {
    const snapshot = exportableSnapshot(incoming);
    return { ok: true, value: { mode, counts: summary, conflicts: [], duplicates: [], snapshot, requiresConfirmation: true } };
  }

  const snapshot = clone(current);
  snapshot.recentCommands = [];
  const conflicts = [];
  const duplicates = [];
  const tally = { added: 0, updated: 0, keptLocal: 0, skippedDuplicate: 0, quarantine: 0 };
  for (const key of MERGED_COLLECTIONS) {
    const rows = snapshot[key];
    const indexById = new Map(rows.map((record, index) => [record.id, index]));
    const evidenceBySale = key === 'evidence'
      ? new Map(rows.flatMap((row) => {
        const sale = saleKey(row);
        return sale ? [[sale, row]] : [];
      }))
      : null;
    for (const record of incoming[key]) {
      const at = indexById.get(record.id);
      if (at !== undefined) {
        const local = rows[at];
        if (equal(local, record)) { tally.keptLocal += 1; continue; }
        // An entry that names another lot would leave both pairs half-linked, so it stays put.
        const moved = key === 'collectionEntries' && record.lotId !== local.lotId;
        if (moved) conflicts.push({ collection: key, id: record.id, reason: 'lot-not-merged' });
        // Everything else is settled by revision, then date, then in the local row's favour.
        if (moved || !incomingWins(local, record)) { tally.keptLocal += 1; continue; }
        const merged = clone(record);
        // Which collection entry a lot is paired with is local bookkeeping the other install cannot
        // know about, so an incoming lot that wins still inherits the local pairing.
        if (key === 'lots') {
          if (own(local, 'collectionEntryId')) merged.collectionEntryId = local.collectionEntryId;
          else delete merged.collectionEntryId;
        }
        rows[at] = merged;
        tally.updated += 1;
        continue;
      }
      if (evidenceBySale) {
        const sale = saleKey(record);
        const sameSale = sale ? evidenceBySale.get(sale) : null;
        if (sameSale) {
          if (equal(evidenceBody(sameSale), evidenceBody(record))) tally.skippedDuplicate += 1;
          else {
            conflicts.push({ collection: key, id: record.id, reason: 'same-sale-collision' });
            tally.keptLocal += 1;
          }
          continue;
        }
      }
      if (key === 'lots') {
        const duplicate = findDuplicateLot(rows, record);
        if (duplicate) {
          duplicates.push({ id: record.id, title: duplicate.title });
          tally.skippedDuplicate += 1;
          continue;
        }
      }
      const copied = clone(record);
      rows.push(copied);
      indexById.set(copied.id, rows.length - 1);
      if (evidenceBySale) {
        const sale = saleKey(copied);
        if (sale) evidenceBySale.set(sale, copied);
      }
      tally.added += 1;
    }
  }
  // Settings stay the collector's own. Two fresh installs write the same values at different times
  // with different revisions, which is bookkeeping rather than a disagreement worth reporting.
  if (current.preferences === null) snapshot.preferences = clone(incoming.preferences);

  const lotsById = new Map(snapshot.lots.map((lot) => [lot.id, lot]));
  snapshot.collectionEntries = snapshot.collectionEntries.filter((entry) => {
    const lot = lotsById.get(entry.lotId);
    if (lot && lot.collectionEntryId === entry.id) return true;
    conflicts.push({ collection: 'collectionEntries', id: entry.id, reason: 'lot-not-merged' });
    return false;
  });
  compactPriorities(snapshot, new Set(current.lots.map(({ id }) => id)));
  tally.quarantine = mergeQuarantine(snapshot, current, incoming);

  const valid = validateSnapshot(snapshot);
  if (!valid.ok) return fail('merge-invalid', valid.error.message, valid.error.path);
  return {
    ok: true,
    value: { mode, counts: { ...summary, ...tally }, conflicts, duplicates, snapshot, requiresConfirmation: true },
  };
}

export function importCountsText(preview) {
  const { counts: tally } = preview;
  const total = (group) => Object.values(group).reduce((sum, count) => sum + count, 0);
  const head = `Local: ${total(tally.outgoing)} records. Backup: ${total(tally.incoming)} records.`;
  if (preview.mode !== 'merge') return `${head} Replaces everything local.`;
  const setAside = tally.quarantine ? `, sets aside ${tally.quarantine} more` : '';
  return `${head} Adds ${tally.added}, updates ${tally.updated}, keeps ${tally.keptLocal} local, ` +
    `skips ${tally.skippedDuplicate} duplicate${tally.skippedDuplicate === 1 ? '' : 's'}${setAside}.`;
}

export function importIssueLines(preview) {
  return [
    ...(preview.duplicates ?? []).map(({ title }) => `lots: duplicate of ${title}`),
    ...(preview.conflicts ?? []).map(({ collection, reason }) =>
      `${collection}: ${CONFLICT_SENTENCES[reason] ?? reason}`),
  ];
}

export function quarantineSummaryText(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return '';
  // An entry with no record of its own exists only to carry links the repair had to clear.
  const records = list.filter((entry) => entry.record !== null).length;
  if (!records) return 'Some links were cleared while repairing local data.';
  return records === 1
    ? '1 record could not be read and was set aside.'
    : `${records} records could not be read and were set aside.`;
}

export function quarantineLines(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const cleared = entry.clearedReferences?.length ?? 0;
    const links = cleared ? `, ${cleared} link${cleared === 1 ? '' : 's'} cleared` : '';
    return `${entry.collection}: ${entry.reason} (${String(entry.quarantinedAt).slice(0, 10)})${links}`;
  });
}

export function quarantineDocument(entries, now) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    quarantine: entries,
  });
}

// The last resort: whatever storage holds, unvalidated, minus the bookkeeping a backup never
// carries. A file the collector can keep is worth more than a refusal they cannot act on.
export function rawExportDocument(raw, now) {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw, recentCommands: [], drafts: [] }
    : raw;
  return JSON.stringify({
    format: BACKUP_FORMAT,
    schemaVersion: Number.isSafeInteger(data?.schemaVersion) ? data.schemaVersion : SCHEMA_VERSION,
    exportedAt: now,
    data,
  });
}

// Colons are not legal in a file name on every platform the extension runs on.
export function backupFileName(prefix, now) {
  return `${prefix}-${now.replace(/:/g, '-')}.json`;
}
