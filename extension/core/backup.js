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
  'same-sale-collision': 'is the same sale with different numbers, kept local',
  'lot-not-merged': 'is attached to a lot this merge did not take, skipped',
  'entry-kept-local': 'arrived for a lot that already has a collection entry here, kept local',
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
  // Only a backup from a later build is refused on sight, and it is told what would let it in. An
  // older one is migrated first and then judged on what the migration produced, so a version this
  // build can still read imports. Version one is the first there was: below it is not a backup.
  if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1) {
    return fail('unsupported-schema', 'Backup schema version is unsupported.', 'schemaVersion');
  }
  if (value.schemaVersion > SCHEMA_VERSION) {
    return fail(
      'unsupported-schema',
      'This backup was made by a newer version of Giga Pinax. Update the extension, then import it again.',
      'schemaVersion',
    );
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

// Revision counters are per install: each one starts at zero and counts that install's own writes,
// so "higher revision" says nothing about which body is later. The later write wins instead, and a
// tie keeps the collector's own row: a backup never silently overwrites what is in front of them.
function incomingWins(local, record) {
  return record.updatedAt > local.updatedAt;
}

// A row this merge replaced carries a revision stamped past both sides, so on a re-import the only
// difference left is that stamp. It is this install's own bookkeeping, not content the backup
// would restore, so it is not reported as a kept-local difference.
function sameExceptRevision(local, record) {
  return equal({ ...local, revision: 0 }, { ...record, revision: 0 });
}

// Every line the collector reads names the record, not only the collection it came from.
function recordLabel(record) {
  for (const key of ['title', 'name']) {
    if (typeof record?.[key] === 'string' && record[key].trim()) return record[key];
  }
  const sale = record?.saleIdentity;
  if (sale) return `${sale.auctionHouse} ${sale.houseSaleId} lot ${sale.lotNumber}`;
  return record?.id ?? 'unnamed record';
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

// A lot and its collection entry must name each other and no two lots may claim one entry, or the
// merged root is invalid and nothing at all imports. Local lots are first in the list, so a local
// pairing is the one that survives a clash.
function repairCollectionPairs(snapshot, conflicts, reviewEntries) {
  const entriesById = new Map(snapshot.collectionEntries.map((entry) => [entry.id, entry]));
  const claimed = new Set();
  for (const lot of snapshot.lots) {
    if (!own(lot, 'collectionEntryId')) continue;
    const entry = entriesById.get(lot.collectionEntryId);
    if (!entry || entry.lotId !== lot.id || claimed.has(entry.id)) {
      delete lot.collectionEntryId;
      delete lot.collectionReviewReason;
      continue;
    }
    claimed.add(entry.id);
    if (reviewEntries.has(entry.id) && entry.reviewReason !== 'source-lot-no-longer-won') {
      entry.reviewReason = 'source-lot-no-longer-won';
      // The review is a change to the entry, so a holder of the old row is asked again. The write
      // time stays: a preview has no clock, and this install's row is the later one either way.
      entry.revision += 1;
    }
  }
  snapshot.collectionEntries = snapshot.collectionEntries.filter((entry) => {
    if (claimed.has(entry.id)) return true;
    conflicts.push({
      collection: 'collectionEntries', id: entry.id, title: recordLabel(entry), reason: 'lot-not-merged',
    });
    return false;
  });
}

// Alerts are the collector's local schedule and are kept verbatim, but the merge can take an event
// that no longer carries the reminder one of them was derived from. The reconcile that follows an
// import derives the schedule again, so a stale alert is dropped rather than failing the merge and
// leaving the collector with no import at all.
function dropStaleAlerts(snapshot) {
  const remindersByEvent = new Map(snapshot.auctionEvents.map((event) =>
    [event.id, new Set(event.reminders.map(({ id }) => id))]));
  snapshot.alerts = snapshot.alerts.filter((alert) =>
    remindersByEvent.get(alert.eventId)?.has(alert.reminderId) === true);
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
  const updates = [];
  const keptLocal = [];
  const tally = { added: 0, updated: 0, keptLocal: 0, skippedDuplicate: 0, quarantine: 0 };
  // Entries only count once it is known which of them survived the pairing repair, or a re-merge
  // would report adding the same entry again every time.
  const entryOutcomes = new Map();
  const reviewEntries = new Set();
  const change = (key, record, local) => ({
    collection: key,
    id: record.id,
    title: recordLabel(record),
    localUpdatedAt: local.updatedAt,
    incomingUpdatedAt: record.updatedAt,
  });
  for (const key of MERGED_COLLECTIONS) {
    const rows = snapshot[key];
    const counted = key === 'collectionEntries'
      ? (id, outcome) => entryOutcomes.set(id, outcome)
      : (id, outcome) => { tally[outcome] += 1; };
    const indexById = new Map(rows.map((record, index) => [record.id, index]));
    const evidenceBySale = key === 'evidence'
      ? new Map(rows.flatMap((row) => {
        const sale = saleKey(row);
        return sale ? [[sale, row]] : [];
      }))
      : null;
    // Lots are merged before the entries that pair with them, so this map is already final.
    const lotsById = key === 'collectionEntries'
      ? new Map(snapshot.lots.map((lot) => [lot.id, lot])) : null;
    for (const record of incoming[key]) {
      const at = indexById.get(record.id);
      if (at !== undefined) {
        const local = rows[at];
        if (equal(local, record)) { counted(record.id, 'keptLocal'); continue; }
        // An entry that names another lot would leave both pairs half-linked, so it stays put.
        const moved = key === 'collectionEntries' && record.lotId !== local.lotId;
        if (moved) conflicts.push({ collection: key, id: record.id, title: recordLabel(record), reason: 'lot-not-merged' });
        // Everything else is settled by write time, then in the local row's favour.
        if (moved || !incomingWins(local, record)) {
          if (!moved && !sameExceptRevision(local, record)) keptLocal.push(change(key, local, record));
          counted(record.id, 'keptLocal');
          continue;
        }
        const merged = clone(record);
        // The replaced body is content this install never saw, so the row is stamped past both
        // counters: an open editor or a queued command holding the old one is answered with a
        // conflict instead of saving over what the backup brought.
        merged.revision = Math.max(local.revision, record.revision) + 1;
        if (key === 'lots' && own(local, 'collectionEntryId')) {
          // Collection history is the one link the other install cannot know about, so the local
          // pairing stays and the backup's own entry is listed rather than dropped in silence.
          merged.collectionEntryId = local.collectionEntryId;
          if (merged.outcome?.status !== 'won') {
            // The other install settled this lot away from won. `lot.outcome.set` would ask what to
            // do with the entry, so the merge raises exactly that review rather than deciding.
            merged.collectionReviewReason = 'source-lot-no-longer-won';
            reviewEntries.add(local.collectionEntryId);
          }
        }
        rows[at] = merged;
        updates.push(change(key, record, local));
        counted(record.id, 'updated');
        continue;
      }
      if (evidenceBySale) {
        const sale = saleKey(record);
        const sameSale = sale ? evidenceBySale.get(sale) : null;
        if (sameSale) {
          if (equal(evidenceBody(sameSale), evidenceBody(record))) tally.skippedDuplicate += 1;
          else {
            conflicts.push({ collection: key, id: record.id, title: recordLabel(record), reason: 'same-sale-collision' });
            tally.keptLocal += 1;
          }
          continue;
        }
      }
      if (key === 'lots') {
        // ponytail: one scan of the merged lots per incoming lot with a new ID. Lot identity lives
        // in lot-context.js and is not exposed as a key, so indexing it here would mean a second
        // copy of the rule. Ceiling: 2,500 local against 2,500 new lots takes about two seconds,
        // paid once in the settings page's preview and once again in the worker.
        const duplicate = findDuplicateLot(rows, record);
        if (duplicate) {
          duplicates.push({ id: record.id, title: recordLabel(record), duplicateOf: recordLabel(duplicate) });
          tally.skippedDuplicate += 1;
          continue;
        }
      }
      if (lotsById) {
        const lot = lotsById.get(record.lotId);
        if (lot && own(lot, 'collectionEntryId') && lot.collectionEntryId !== record.id) {
          conflicts.push({ collection: key, id: record.id, title: recordLabel(record), reason: 'entry-kept-local' });
          tally.keptLocal += 1;
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
      counted(copied.id, 'added');
    }
  }
  // Settings stay the collector's own. Two fresh installs write the same values at different times
  // with different revisions, which is bookkeeping rather than a disagreement worth reporting.
  if (current.preferences === null) snapshot.preferences = clone(incoming.preferences);

  repairCollectionPairs(snapshot, conflicts, reviewEntries);
  const survivors = new Set(snapshot.collectionEntries.map(({ id }) => id));
  for (const [id, outcome] of entryOutcomes) {
    if (survivors.has(id)) tally[outcome] += 1;
  }
  const attached = (row) => row.collection !== 'collectionEntries' || survivors.has(row.id);
  dropStaleAlerts(snapshot);
  compactPriorities(snapshot, new Set(current.lots.map(({ id }) => id)));
  tally.quarantine = mergeQuarantine(snapshot, current, incoming);

  const valid = validateSnapshot(snapshot);
  if (!valid.ok) return fail('merge-invalid', valid.error.message, valid.error.path);
  return {
    ok: true,
    value: {
      mode,
      counts: { ...summary, ...tally },
      conflicts,
      duplicates,
      updates: updates.filter(attached),
      keptLocal: keptLocal.filter(attached),
      snapshot,
      requiresConfirmation: true,
    },
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
    ...(preview.duplicates ?? []).map(({ title, duplicateOf }) =>
      `lots: "${title}" is a duplicate of "${duplicateOf}", skipped`),
    ...(preview.conflicts ?? []).map(({ collection, title, reason }) =>
      `${collection}: "${title}" ${CONFLICT_SENTENCES[reason] ?? reason}`),
  ];
}

// Nothing is replaced or passed over in silence: every record the import would take from the backup
// and every one it would keep is named, with the write time each side claims.
export function importChangeLines(preview) {
  return [
    ...(preview.updates ?? []).map(({ collection, title, localUpdatedAt, incomingUpdatedAt }) =>
      `${collection}: "${title}" is replaced by the backup's copy (backup ${incomingUpdatedAt}, local ${localUpdatedAt})`),
    ...(preview.keptLocal ?? []).map(({ collection, title, localUpdatedAt, incomingUpdatedAt }) =>
      `${collection}: "${title}" keeps the local copy (local ${localUpdatedAt}, backup ${incomingUpdatedAt})`),
  ];
}

// An import that overwrites a record puts a copy of the current data on disk first, and the command
// only goes out once that download has been handed to the browser. A copy that cannot be produced
// is replaced by the raw rescue file and the collector has to say so a second time; declining sends
// nothing. Every step is injected so the page's own sequence is the one under test.
export async function importWithSafetyCopy({ exportCopy, exportRaw, download, confirm, send }) {
  let copied = null;
  try {
    const file = await exportCopy();
    // A download the browser refuses is a copy that did not happen, whatever the export returned.
    download(file.text, file.name);
    copied = file.name;
  } catch (error) {
    let offered = 'A raw copy of the stored data could not be downloaded either.';
    try {
      const raw = await exportRaw();
      download(raw.text, raw.name);
      offered = `A raw copy of the stored data was downloaded instead: ${raw.name}`;
    } catch { /* the confirmation says so */ }
    const message = `A safety copy of your current records could not be saved: ${error.message}\n\n${offered}\n\nImport anyway?`;
    if (!confirm(message)) return { sent: false, copied: null };
  }
  return { sent: true, copied, reply: await send() };
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
