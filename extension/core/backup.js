// @ts-check
import {
  LIMITS, RECORDS_LIMIT_TEXT, SCHEMA_VERSION, boundVerdict, createEmptySnapshot, megabytesText, foldQuarantine, followOutcome, isRestorableCollection, migrateSnapshot,
  quarantineEntryId, unusableRevisions, validateQuarantinedRecord, validateSnapshot,
} from './records.js';
import { sameEventKey } from './evidence.js';

// How much of the bound a store takes, as Settings says it (K-13).
export { RECORDS_LIMIT_TEXT, megabytesText };
import { findDuplicateLot } from './lot-context.js';
import { clone, failure, isRecursionError, own, tooDeeplyNested } from './validate.js';
/**
 * @typedef {import('./types.js').Snapshot} Snapshot
 * @typedef {import('./types.js').QuarantineEntry} QuarantineEntry
 * @typedef {import('./types.js').Failure} Failure
 */
/**
 * @template T
 * @typedef {import('./types.js').Result<T>} Result
 */
/**
 * One record an import would replace, keep or pass over, named by its local copy.
 * @typedef {{ collection?: string, id?: string, title: string, incomingTitle?: string, comparedAs?: string, [field: string]: any }} ImportChange
 */
/**
 * What an import would do, shown to the collector before anything is written.
 * @typedef {object} ImportPreview
 * @property {'merge' | 'replace'} mode
 * @property {{ outgoing: Record<string, number>, incoming: Record<string, number>, added?: number, updated?: number,
 *   keptLocal?: number, skippedDuplicate?: number, quarantine?: number }} counts
 * @property {ImportChange[]} conflicts
 * @property {ImportChange[]} duplicates
 * @property {ImportChange[]} [updates]
 * @property {ImportChange[]} [keptLocal]
 * @property {Snapshot} snapshot
 * @property {true} requiresConfirmation
 */

export const BACKUP_FORMAT = 'ancient-coin-auction-companion';
// Exports are compact, but backups written by earlier builds were indented: the import bound has to
// clear a pretty-printed copy of a full store, while the store's own 5 MiB bound still decides what
// the resulting snapshot may hold.
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
// The rescue file says on its face that it is one, so an import can turn it away by name rather
// than by whatever its unvalidated contents happen to trip over first.
const RAW_EXPORT_KIND = 'raw-rescue';
const RAW_EXPORT_REFUSAL =
  'This is a raw rescue file, not a backup. Use Export backup to make a file that can be imported.';
// A write time beyond the export that carries it is a skewed clock or a hand-edited file, and a
// file that claims to have been exported in the future does not get to raise that ceiling either.
const MAX_EXPORT_SKEW_MS = 24 * 60 * 60 * 1000;
// How many differing field names a change line spells out before it counts the rest.
const NAMED_FIELDS = 8;
// Fields the merge writes itself: the revision stamp it puts on a replaced row, the collection
// link it always keeps local, and the review flag that follows the merged lot. A backup can never
// restore them, so a record differing in nothing else is not a difference worth reporting.
const MERGE_OWNED_FIELDS = ['revision', 'collectionEntryId', 'collectionReviewReason', 'reviewReason'];
// Named in the two write times the line already carries, or the same on both sides by construction.
const UNNAMED_FIELDS = new Set(['id', 'revision', 'updatedAt']);

const COLLECTIONS = [
  'lots', 'auctionEvents', 'alternativeGroups', 'evidence',
  'collectionEntries', 'alerts', 'wants',
];
// Preferences and alerts are never merged: the collector's own settings stay, and alerts are
// re-derived from the merged events by the next reconcile. Lots come after the records they point
// at, and collection entries after the lots they pair with; wants (G-22) after the lots they may
// name as found.
const MERGED_COLLECTIONS = ['auctionEvents', 'alternativeGroups', 'evidence', 'lots', 'collectionEntries', 'wants'];
// The want list is the one collection a root may leave out (records.js): read as an empty list.
const rowsOf = (snapshot, key) => snapshot[key] ?? [];
const CONFLICT_SENTENCES = {
  'same-sale-collision': 'is the same sale with different numbers, kept local',
  'lot-not-merged': 'is attached to a lot this merge did not take, skipped',
  'entry-kept-local': 'arrived for a lot that already has a collection entry here, kept local',
  'event-for-skipped-lot': 'is the auction of a lot this merge skipped as a duplicate, kept out',
};
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

/**
 * @param {Snapshot} snapshot
 * @param {string} now
 * @returns {Result<string>} the backup file's text
 */
export function exportBackup(snapshot, now) {
  if (!canonicalInstant(now)) return failure('invalid-timestamp', 'Export time must be a canonical UTC timestamp.', 'exportedAt');
  const data = exportableSnapshot(snapshot);
  const valid = validateSnapshot(data);
  if (!valid.ok) return failure('invalid-snapshot', valid.error.message, `data.${valid.error.path ?? ''}`);
  // Indentation doubled a full store's export past its own bound, so the file is written compact.
  const document = JSON.stringify({
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    data,
  });
  if (bytes(document) > MAX_BACKUP_BYTES) return failure('file-too-large', 'Backup exceeds the 16 MiB limit.');
  return { ok: true, value: document };
}

// Reading a file is the other boundary: parsing it, copying it and migrating it all recurse, so a
// document whose records are nested past what the stack holds is refused as an invalid file.
/**
 * @param {*} document the file's text, or its parsed value
 * @returns {Result<Snapshot>}
 */
export function validateBackup(document) {
  try {
    return readBackup(document);
  } catch (error) {
    if (!isRecursionError(error)) throw error;
    return tooDeeplyNested('data');
  }
}

/**
 * @param {*} document
 * @returns {Result<Snapshot>}
 */
function readBackup(document) {
  let value = document;
  if (typeof document === 'string') {
    if (bytes(document) > MAX_BACKUP_BYTES) return failure('file-too-large', 'Backup exceeds the 16 MiB limit.');
    try { value = JSON.parse(document); } catch { return failure('invalid-json', 'Backup is not valid JSON.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failure('invalid-document', 'Backup must be an object.');
  if (value.format !== BACKUP_FORMAT) return failure('invalid-format', 'Backup format is not recognized.', 'format');
  // Only a backup from a later build is refused on sight, and it is told what would let it in. An
  // older one is migrated first and then judged on what the migration produced, so a version this
  // build can still read imports. Version one is the first there was: below it is not a backup.
  if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1) {
    return failure('unsupported-schema', 'Backup schema version is unsupported.', 'schemaVersion');
  }
  // The header can lag the root it carries, and then it is the root that says where the file came
  // from: either way it was written by a build this one cannot read, and the answer is the same.
  if (value.schemaVersion > SCHEMA_VERSION || value.data?.schemaVersion > SCHEMA_VERSION) {
    return failure(
      'unsupported-schema',
      'This backup was made by a newer version of Giga Pinax. Update the extension, then import it again.',
      'schemaVersion',
    );
  }
  if (!canonicalInstant(value.exportedAt)) return failure('invalid-timestamp', 'Export time is invalid.', 'exportedAt');
  if (value.kind === RAW_EXPORT_KIND) return failure('raw-rescue-file', RAW_EXPORT_REFUSAL, 'kind');
  const data = migrateSnapshot(clone(value.data));
  if (!data || typeof data !== 'object') return failure('invalid-document', 'Backup data is missing.', 'data');
  // Only a raw copy of storage carries the request ledger, so a rescue file taken before the
  // marker existed is still turned away as one rather than for the IDs it happens to hold.
  if (Array.isArray(data.recentCommands) && data.recentCommands.length) {
    return failure('raw-rescue-file', RAW_EXPORT_REFUSAL, 'data.recentCommands');
  }
  data.recentCommands = [];
  data.drafts = [];
  // The set-aside list is folded into this install's own on import, so a crafted one is turned away by its length
  // before anything walks it. Only a document is held to this: a store that set more aside must still open.
  if (Array.isArray(data.quarantine) && data.quarantine.length > LIMITS.quarantine) {
    return failure(
      'collection-limit',
      `This backup lists more than ${LIMITS.quarantine.toLocaleString('en-US')} set-aside records, more than an import takes in, so nothing in it was imported.`,
      'data.quarantine',
    );
  }
  // Before validation, because validation says only that a revision is an integer within the ceiling a stored root may
  // carry: it cannot say that no run of writes produced it. A revision above the usable ceiling is turned away here
  // rather than restarted as a stored one is - a record taken in above it would be refused by its own next save - and
  // it is told what the file is, instead of being reported as an integer out of range.
  // The root's own revision is left out: an import never adopts it (the store counts on from its own), and v0.32.1
  // still exported from a root locked at 2^53-1, so that file is the collector's real backup, not a crafted one.
  const unusable = unusableRevisions(data).filter(({ collection }) => collection !== 'root');
  if (unusable.length) {
    return failure(
      'invalid-record',
      'This backup carries a revision no Giga Pinax write could have produced, so the file is crafted or corrupt. Import a file made by Export backup.',
      `data.${unusable[0].collection}`,
    );
  }
  const valid = validateSnapshot(data);
  if (!valid.ok) return failure(valid.error.code, valid.error.message, `data.${valid.error.path ?? ''}`);
  exportTimes.set(data, value.exportedAt);
  return { ok: true, value: data };
}

function counts(snapshot) {
  return Object.fromEntries(COLLECTIONS.map((key) => [key, rowsOf(snapshot, key).length]));
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evidenceBody(row) {
  const body = clone(row);
  for (const key of ['id', 'revision', 'createdAt', 'updatedAt']) delete body[key];
  return body;
}

// A record cannot have been written after the file that carries it was exported, so an incoming
// write time beyond the export is a skewed clock or a hand edit rather than a later edit, and is
// compared as the export time. That ceiling belongs to the file the records came out of rather
// than to the call, so it is remembered here for the snapshot `validateBackup` produced instead of
// being threaded through every caller; a snapshot from anywhere else has no file and no ceiling.
// The file's own claim is bounded in turn: an export more than a day ahead of now is read as now.
// The key is the object identity `validateBackup` returned, so a caller must pass that exact object or an explicit
// `{ exportedAt }`: a clone of it is a different object, finds no ceiling here and compares every record by the time it
// claims. That fails safe - a hand-edited write time then wins where it would have been capped - but it is a weaker
// merge than the one the file earns, so pass the snapshot through, not a copy of it.
const exportTimes = new WeakMap();

function comparisonCeiling(incoming, exportedAt, now) {
  const claimed = canonicalInstant(exportedAt) ? exportedAt : exportTimes.get(incoming);
  if (!canonicalInstant(claimed)) return null;
  const ahead = new Date(Date.parse(now) + MAX_EXPORT_SKEW_MS).toISOString();
  return claimed <= ahead ? claimed : now;
}

// A row this merge replaced carries a revision stamped past both sides, and a merged lot carries
// the local collection link and whatever review that lot's outcome asks for. On a re-import those
// are the only differences left: this install's own bookkeeping, not content the backup would
// restore, so they are not reported as kept-local differences.
function sameExceptMergeStamps(local, record) {
  const bare = (row) => {
    const copy = { ...row };
    for (const key of MERGE_OWNED_FIELDS) delete copy[key];
    return copy;
  };
  return equal(bare(local), bare(record));
}

// Which top-level fields disagree, by name only: a value from a backup is untrusted text and the
// listing is a summary, not a diff.
function differingFields(local, record) {
  const names = [...new Set([...Object.keys(local), ...Object.keys(record)])];
  return names.filter((key) => !UNNAMED_FIELDS.has(key) && !equal(local[key], record[key]));
}

function fieldsText(names) {
  if (names.length <= NAMED_FIELDS) return names.join(', ');
  return `${names.slice(0, NAMED_FIELDS).join(', ')} and ${names.length - NAMED_FIELDS} more`;
}

// Every line the collector reads names the record, not only the collection it came from.
function recordLabel(record) {
  for (const key of ['title', 'name', 'reference']) {
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
function repairCollectionPairs(snapshot, conflicts, entryReviews) {
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
    // The entry follows its lot, so a merge that settles the lot away from won raises the review
    // and one that corrects it back to won withdraws it, exactly as `lot.outcome.set` does.
    let changed = false;
    if (entryReviews.has(lot.id) && entry.reviewReason !== entryReviews.get(lot.id)) {
      const reason = entryReviews.get(lot.id);
      if (reason) entry.reviewReason = reason;
      else delete entry.reviewReason;
      changed = true;
    }
    // And a won lot's hammer and invoice follow into the entry, whichever row won the merge (records.js followOutcome).
    if (followOutcome(entry, lot)) changed = true;
    // Either is a change to the entry, so a holder of the old row is asked again. The write
    // time stays: a preview has no clock, and this install's row is the later one either way.
    if (changed) entry.revision += 1;
  }
  snapshot.collectionEntries = snapshot.collectionEntries.filter((entry) => {
    if (claimed.has(entry.id)) return true;
    conflicts.push({
      collection: 'collectionEntries', id: entry.id, title: recordLabel(entry), reason: 'lot-not-merged',
    });
    return false;
  });
}

// Auction events merge before the lots that point at them, so the event of a lot the merge then
// skipped as a duplicate had already been taken: the same sale stood here twice and its reminders
// fired twice. The event belongs to the skipped lot, so it follows that lot out - unless the local
// lot it duplicates tracks no sale at all, in which case the sale the backup knows about is worth
// keeping and the lot that stayed is linked to it, or unless a lot the merge did take is attached to
// it too. Only an event this merge itself brought in is ever taken back out: a local one stays.
function settleSkippedLotEvents(snapshot, skipped, localEventIds, conflicts, { attach, change, updates, counted, now }) {
  for (const { record, local } of skipped) {
    if (!own(record, 'auctionEventId') || own(local, 'auctionEventId')) continue;
    if (!snapshot.auctionEvents.some(({ id }) => id === record.auctionEventId)) continue;
    // The link is a body from before the export, so a lot written since wins over it exactly as
    // every other record does: an old backup merged again no longer puts the sale back on a lot the
    // collector had unlinked. The event then points at nothing here and goes out below.
    if (!attach(local)) continue;
    updates.push({ ...change('lots', record, local), reason: 'auction-attached', fields: ['auctionEventId'] });
    local.auctionEventId = record.auctionEventId;
    // The link is content this install never had, so the row is stamped: an editor holding the row
    // from before the import is answered with a conflict instead of saving the link away again, and
    // the write time says when the link was put on. A stamp never moves a write time backwards.
    local.revision += 1;
    if (now > local.updatedAt) local.updatedAt = now;
    counted();
  }
  const referenced = new Set(snapshot.lots.flatMap((row) =>
    (own(row, 'auctionEventId') ? [row.auctionEventId] : [])));
  const orphaned = new Set(skipped
    .map(({ record }) => (own(record, 'auctionEventId') ? record.auctionEventId : null))
    .filter((id) => id !== null && !referenced.has(id) && !localEventIds.has(id)));
  if (!orphaned.size) return 0;
  snapshot.auctionEvents = snapshot.auctionEvents.filter((event) => {
    if (!orphaned.has(event.id)) return true;
    conflicts.push({
      collection: 'auctionEvents', id: event.id, title: recordLabel(event), reason: 'event-for-skipped-lot',
    });
    return false;
  });
  return orphaned.size;
}

// A want found by a coin this merge skipped as a duplicate names the local copy of that coin instead, which is the one
// this install keeps; and a want list both sides left empty stays out of the root, as it was.
function followSkippedLots(snapshot, skipped) {
  const localOf = new Map(skipped.map(({ record, local }) => [record.id, local.id]));
  for (const want of snapshot.wants ?? []) {
    if (localOf.has(want.foundLotId)) want.foundLotId = localOf.get(want.foundLotId);
  }
  if (!snapshot.wants?.length) delete snapshot.wants;
}

// The identity of a trigger, rebuilt from the three things it is derived from, exactly as the reconcile rebuilds it.
const triggerKey = (alert) => `${alert.eventId}:${alert.reminderId}:${alert.triggerAt}`;

// Alerts are not merged record by record - the reconcile derives the schedule again from the merged events - but an
// acknowledgement or a snooze is the collector's own answer, not the other install's bookkeeping, and deriving the
// schedule again brought a reminder they had already answered there back as due here. An incoming alert whose trigger
// this install does not already hold is taken, provided the event and the reminder it names came through the merge; a
// trigger this install does hold keeps its own alert, which is the row in front of the collector.
function adoptIncomingAlerts(snapshot, incoming) {
  const held = new Set(snapshot.alerts.map(triggerKey));
  const ids = new Set(snapshot.alerts.map(({ id }) => id));
  const remindersByEvent = new Map(snapshot.auctionEvents.map((event) =>
    [event.id, new Set(event.reminders.map(({ id }) => id))]));
  let adopted = 0;
  for (const alert of incoming.alerts ?? []) {
    if (snapshot.alerts.length >= LIMITS.alerts) break;
    const key = triggerKey(alert);
    if (held.has(key) || ids.has(alert.id)) continue;
    if (remindersByEvent.get(alert.eventId)?.has(alert.reminderId) !== true) continue;
    snapshot.alerts.push({ ...clone(alert), triggerId: key });
    held.add(key);
    ids.add(alert.id);
    adopted += 1;
  }
  return adopted;
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

// Quarantine is a recovery bin rather than live data, so a merge unions both bins. Comparing whole
// entries let one record through twice, because two installs set the same record aside at the moment
// each of them repaired it and the dates differ; the union folds the way a repair does, by the
// record and the reason, so one record set aside for one reason stays one entry with one Restore.
function mergeQuarantine(snapshot, current, incoming) {
  const held = foldQuarantine(clone(current.quarantine ?? []));
  const entries = foldQuarantine([...held, ...clone(incoming.quarantine ?? [])]);
  if (entries.length) snapshot.quarantine = entries;
  return entries.length - held.length;
}

/**
 * @param {Snapshot} current
 * @param {Snapshot} incoming
 * @param {*} mode 'merge' or 'replace'
 * @param {{ exportedAt?: string, now?: string }} [options]
 * @returns {Result<ImportPreview>}
 */
export function previewImport(current, incoming, mode, options = {}) {
  try {
    return planImport(current, incoming, mode, options);
  } catch (error) {
    if (!isRecursionError(error)) throw error;
    return tooDeeplyNested('data');
  }
}

/**
 * @param {Snapshot} current
 * @param {Snapshot} incoming
 * @param {*} mode
 * @param {{ exportedAt?: string, now?: string }} [options]
 * @returns {Result<ImportPreview>}
 */
function planImport(current, incoming, mode, { exportedAt, now = new Date().toISOString() } = {}) {
  const currentValid = validateSnapshot(current);
  if (!currentValid.ok) return failure('invalid-current', currentValid.error.message, currentValid.error.path);
  const incomingValid = validateSnapshot(incoming);
  if (!incomingValid.ok) return failure('invalid-incoming', incomingValid.error.message, incomingValid.error.path);
  if (mode !== 'merge' && mode !== 'replace') return failure('invalid-mode', 'Import mode must be merge or replace.', 'mode');
  const summary = { outgoing: counts(current), incoming: counts(incoming) };
  if (mode === 'replace') {
    const snapshot = exportableSnapshot(incoming);
    // The schedule belongs to the install, not to the file: the reconcile that follows the import derives it again from
    // the events just taken, so the file's wake time and its revision - counted in a store this one no longer is - are
    // not adopted. The alerts stay, so an acknowledgement survives wherever its reminder came with the file.
    snapshot.scheduler = { revision: 0, nextWakeAt: null, lastReconciledAt: null };
    dropStaleAlerts(snapshot);
    return { ok: true, value: { mode, counts: summary, conflicts: [], duplicates: [], snapshot, requiresConfirmation: true } };
  }

  const snapshot = clone(current);
  snapshot.recentCommands = [];
  const conflicts = [];
  const duplicates = [];
  const updates = [];
  const keptLocal = [];
  // Each incoming lot passed over as a duplicate, with the local lot it duplicates: what becomes of
  // the auction event it carried is settled once the lots are merged and that map is final.
  const skippedLots = [];
  const localEventIds = new Set(current.auctionEvents.map(({ id }) => id));
  const tally = { added: 0, updated: 0, keptLocal: 0, skippedDuplicate: 0, quarantine: 0 };
  // Entries only count once it is known which of them survived the pairing repair, or a re-merge
  // would report adding the same entry again every time.
  const entryOutcomes = new Map();
  // Lot id -> the review reason its merged lot now carries, or undefined when the merge withdrew it.
  const entryReviews = new Map();
  const ceiling = comparisonCeiling(incoming, exportedAt, now);
  const beyondCeiling = (record) => ceiling !== null && record.updatedAt > ceiling;
  const asWritten = (record) => (beyondCeiling(record) ? ceiling : record.updatedAt);
  // Every line names the local record: it is the one the collector already knows. The backup's own
  // title is worth saying only when it calls the record something else.
  const change = (key, record, local) => ({
    collection: key,
    id: local.id,
    title: recordLabel(local),
    ...(recordLabel(record) === recordLabel(local) ? {} : { incomingTitle: recordLabel(record) }),
    localUpdatedAt: local.updatedAt,
    incomingUpdatedAt: record.updatedAt,
    ...(beyondCeiling(record) ? { comparedAs: ceiling } : {}),
    fields: differingFields(local, record),
  });
  for (const key of MERGED_COLLECTIONS) {
    const rows = (snapshot[key] ??= []);
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
    for (const record of rowsOf(incoming, key)) {
      const at = indexById.get(record.id);
      if (at !== undefined) {
        const local = rows[at];
        if (equal(local, record)) { counted(record.id, 'keptLocal'); continue; }
        // An entry that names another lot would leave both pairs half-linked, so it stays put.
        const moved = key === 'collectionEntries' && record.lotId !== local.lotId;
        if (moved) conflicts.push({ collection: key, id: record.id, title: recordLabel(record), reason: 'lot-not-merged' });
        // Everything else is settled by write time, then in the local row's favour.
        // Revision counters are per install: each one starts at zero and counts that install's own
        // writes, so "higher revision" says nothing about which body is later. The later write wins
        // instead, and a tie keeps the collector's own row: a backup never silently overwrites what
        // is in front of them.
        if (moved || asWritten(record) <= local.updatedAt) {
          if (!moved && !sameExceptMergeStamps(local, record)) keptLocal.push(change(key, record, local));
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
          if (merged.outcome?.status === 'won') {
            // The backup settled this lot back to won, so any review the local outcome raised on
            // the entry goes with it rather than outliving the reason for it.
            delete merged.collectionReviewReason;
          } else {
            // The other install settled this lot away from won. `lot.outcome.set` would ask what to
            // do with the entry, so the merge raises exactly that review rather than deciding.
            merged.collectionReviewReason = 'source-lot-no-longer-won';
          }
          entryReviews.set(merged.id, merged.collectionReviewReason);
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
          skippedLots.push({ record, local: duplicate });
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

  // An event kept out was counted as added when the collections loop took it.
  tally.added -= settleSkippedLotEvents(snapshot, skippedLots, localEventIds, conflicts, {
    attach: (local) => !beyondCeiling(local),
    change,
    updates,
    counted: () => { tally.updated += 1; },
    now,
  });
  repairCollectionPairs(snapshot, conflicts, entryReviews);
  followSkippedLots(snapshot, skippedLots);
  const survivors = new Set(snapshot.collectionEntries.map(({ id }) => id));
  for (const [id, outcome] of entryOutcomes) {
    if (survivors.has(id)) tally[outcome] += 1;
  }
  const attached = (row) => row.collection !== 'collectionEntries' || survivors.has(row.id);
  tally.added += adoptIncomingAlerts(snapshot, incoming);
  dropStaleAlerts(snapshot);
  compactPriorities(snapshot, new Set(current.lots.map(({ id }) => id)));
  tally.quarantine = mergeQuarantine(snapshot, current, incoming);

  const valid = validateSnapshot(snapshot);
  // The validator's own sentence is about a record or a limit, not about the file the collector
  // chose, so what happened is said first and the detail is kept after it.
  if (!valid.ok) {
    return failure('merge-invalid', `This backup cannot be merged with your local records. ${valid.error.message}`, valid.error.path);
  }
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

// A Replace import over records nothing can read (X-02): there is nothing local to count or merge with, so the preview is
// of the backup alone, as the store runs it over an empty root.
/**
 * @param {Snapshot} incoming
 * @param {string} [now]
 * @returns {Result<ImportPreview>}
 */
export function previewReplaceOverUnreadable(incoming, now = new Date().toISOString()) {
  return previewImport(createEmptySnapshot(now), incoming, 'replace');
}

// Whether the root an import leaves fits the storage bound, judged before Confirm as the store judges it after (X-13):
// the records the preview holds, with the request ledger a merge keeps, and the headroom every save leaves.
/**
 * @param {Snapshot | null} current null for records nothing can read, which an import replaces as if there were none
 * @param {ImportPreview} preview
 * @returns {{ ok: boolean, bytes: number, text: string }}
 */
export function importFit(current, preview) {
  const before = current ?? createEmptySnapshot(preview.snapshot.updatedAt);
  const after = { ...preview.snapshot, recentCommands: preview.mode === 'merge' ? before.recentCommands ?? [] : [] };
  const verdict = boundVerdict(before, after, LIMITS.commandReplyBytes);
  return {
    ok: verdict.ok,
    bytes: verdict.bytes,
    text: verdict.ok ? '' : `This import would not fit: your records would take ${megabytesText(verdict.bytes)}, more than the ${RECORDS_LIMIT_TEXT} ` +
      'Giga Pinax can keep in this browser. Remove old coins or auctions here first, or import a backup with fewer records.',
  };
}

// A merge that would write nothing says so, rather than a row of zeros and a Confirm that changes nothing (X-13).
/**
 * @param {ImportPreview} preview
 * @returns {string} empty when the merge would change something
 */
export function importNothingText(preview) {
  const tally = preview?.counts;
  if (preview?.mode !== 'merge' || !tally || tally.added || tally.updated || tally.quarantine) return '';
  const differs = (preview.keptLocal?.length ?? 0) + (preview.conflicts?.length ?? 0) + (preview.duplicates?.length ?? 0);
  return differs
    ? 'Nothing to import: every record in this backup is already here, and your own copies are kept.'
    : 'Nothing to import: every record in this backup is already here, unchanged.';
}

/**
 * @param {ImportPreview} preview
 * @returns {string}
 */
export function importCountsText(preview) {
  const { counts: tally } = preview;
  const total = (group) => Object.values(group).reduce((sum, count) => sum + count, 0);
  const head = `Local: ${total(tally.outgoing)} records. Backup: ${total(tally.incoming)} records.`;
  if (preview.mode !== 'merge') return `${head} Replaces everything local.`;
  const setAside = tally.quarantine ? `, sets aside ${tally.quarantine} more` : '';
  return `${head} Adds ${tally.added}, updates ${tally.updated}, keeps ${tally.keptLocal} local, ` +
    `skips ${tally.skippedDuplicate} duplicate${tally.skippedDuplicate === 1 ? '' : 's'}${setAside}.`;
}

/**
 * @param {ImportPreview} preview
 * @returns {string[]}
 */
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
/**
 * @param {ImportPreview} preview
 * @returns {string[]}
 */
export function importChangeLines(preview) {
  // A write time the export could not have followed is called out where it is read, so a line the
  // collector reads never rests on a number the file made up.
  /** @param {{ comparedAs?: string }} row */
  const compared = ({ comparedAs }) =>
    (comparedAs ? `; backup time is later than the export itself; compared as ${comparedAs}` : '');
  return [
    ...(preview.updates ?? []).map((row) => {
      const alias = row.incomingTitle ? ` (in the backup: "${row.incomingTitle}")` : '';
      const fields = row.fields?.length ? `, differing in ${fieldsText(row.fields)}` : '';
      // Nothing of the record is replaced when it only takes the sale of a duplicate the merge
      // skipped, so that line says what really happens to it.
      if (row.reason === 'auction-attached') {
        return `${row.collection}: "${row.title}" takes the auction of a duplicate this merge skipped ` +
          `(backup ${row.incomingUpdatedAt}, local ${row.localUpdatedAt})${compared(row)}`;
      }
      return `${row.collection}: "${row.title}"${alias} is replaced by the backup's copy ` +
        `(backup ${row.incomingUpdatedAt}, local ${row.localUpdatedAt})${fields}${compared(row)}`;
    }),
    ...(preview.keptLocal ?? []).map((row) =>
      `${row.collection}: "${row.title}" keeps the local copy ` +
      `(local ${row.localUpdatedAt}, backup ${row.incomingUpdatedAt})${compared(row)}`),
  ];
}

// An import that overwrites a record puts a copy of the current data on disk first, and the command
// only goes out once that download has been handed to the browser. A copy that cannot be produced
// is replaced by the raw rescue file and the collector has to say so a second time; declining sends
// nothing. A command that fails is handed back rather than thrown, so the file that did reach the
// browser is still named beside the failure instead of being lost with it. Every step is injected
// so the page's own sequence is the one under test.
/**
 * @param {{
 *   exportCopy: () => Promise<{ text: string, name: string }>,
 *   exportRaw: () => Promise<{ text: string, name: string }>,
 *   download: (text: string, name: string) => void,
 *   confirm: (message: string) => boolean,
 *   send: () => Promise<*>,
 * }} steps
 * @returns {Promise<{ sent: boolean, copied: string | null, reply?: *, error?: * }>}
 */
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
  try {
    return { sent: true, copied, reply: await send() };
  } catch (error) {
    return { sent: true, copied, error };
  }
}

// Settings set aside whole are never put back, so what the collector stands to lose there - their house presets - is
// counted and named, with the way to keep them, instead of being one more record that could not be read.
const isSetAsideSettings = (entry) => entry?.collection === 'preferences' && entry.record !== null;
const presetCount = (entry) =>
  (Array.isArray(entry.record?.housePremiumPresets) ? entry.record.housePremiumPresets.length : 0);
const presetsText = (count) => `${count} house preset${count === 1 ? '' : 's'}`;

function settingsSummaryText(settings) {
  const presets = settings.reduce((sum, entry) => sum + presetCount(entry), 0);
  if (!presets) return 'Your settings could not be read and were set aside. They held no house presets.';
  const them = presets === 1 ? 'it' : 'them';
  return `Your settings could not be read and were set aside, with ${presetsText(presets)}. ` +
    `Download set-aside records to keep ${them}, then enter ${them} again under House premiums.`;
}

/**
 * @param {*} entries
 * @returns {string}
 */
export function quarantineSummaryText(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return '';
  const settings = list.filter(isSetAsideSettings);
  // An entry with no record of its own exists only to carry links the repair had to clear.
  const records = list.filter((entry) => entry.record !== null && !isSetAsideSettings(entry)).length;
  const parts = [];
  if (records) {
    parts.push(records === 1
      ? '1 record could not be read and was set aside.'
      : `${records} records could not be read and were set aside.`);
  }
  if (settings.length) parts.push(settingsSummaryText(settings));
  return parts.length ? parts.join(' ') : 'Some links were cleared while repairing local data.';
}

// What a set-aside record is, as the collector calls it (X-03).
const RECORD_NOUNS = {
  lots: ['coin', 'coins'], auctionEvents: ['auction', 'auctions'], alternativeGroups: ['group', 'groups'],
  evidence: ['comparable', 'comparables'], collectionEntries: ['collection entry', 'collection entries'],
  alerts: ['reminder', 'reminders'], wants: ['want', 'wants'],
};
const recordNoun = (collection, count = 1) => (RECORD_NOUNS[collection] ?? ['record', 'records'])[count === 1 ? 0 : 1];
// A field as the collector knows it, by the name the record keeps it under.
const FIELD_WORDS = {
  id: 'ID', revision: 'revision', dataClass: 'record kind', createdAt: 'creation time', updatedAt: 'last-change time',
  title: 'title', name: 'name', reference: 'reference', lotNumber: 'lot number', notes: 'notes', sourceLinks: 'links',
  bidHistory: 'bid history', outcome: 'outcome', outcomeHistory: 'outcome history', auctionEventId: 'auction link',
  alternativeGroupId: 'group link', collectionEntryId: 'collection link', priority: 'place in its group',
  plannedBid: 'planned bid', activeBid: 'active bid', auctionContext: 'auction details', coinDetails: 'coin details',
  provenanceNotes: 'provenance', costEstimate: 'cost estimate', eventKind: 'kind of sale', precision: 'time precision',
  localDate: 'date', localTime: 'time', timeZone: 'time zone', reminderScope: 'reminder setting', reminders: 'reminders',
  lotId: 'coin link', acquisitionDate: 'acquisition date', hammer: 'hammer', actualInvoice: 'invoice paid',
  maxPrice: 'maximum price', minGrade: 'lowest grade', observations: 'sales',
};
const fieldWords = (field) => FIELD_WORDS[field] ?? String(field).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
// What a validator said, in plain words: never its own sentence, which names shapes rather than what is wrong.
function plainProblem(message, value) {
  const text = String(message ?? '');
  let match = /^Expected a string of at most (\d+) characters\.$/.exec(text);
  if (match) return typeof value === 'string' && !value.trim() ? 'is empty' : `is not text of up to ${match[1]} characters`;
  match = /^Expected an array with at most (\d+) entries\.$/.exec(text);
  if (match) return `is not a list of up to ${match[1]}`;
  if (/^Expected an integer/.test(text)) return 'is not a whole number in range';
  if (/UUID/.test(text)) return 'is not a valid link';
  if (/timestamp/i.test(text)) return 'is not a valid date and time';
  if (/date/i.test(text)) return 'is not a real date';
  if (/URL/.test(text)) return 'is not a web address';
  if (/object/i.test(text)) return 'is not in the right shape';
  if (/allowed set/.test(text)) return 'holds a value Giga Pinax does not know';
  return 'is not valid';
}
// A field and what is wrong with it, as one phrase: "title is empty", "notes are not text of up to 5000 characters".
const fieldProblem = (field, message, value) => {
  const words = fieldWords(field);
  const plain = plainProblem(message, value);
  return `${words} ${/s$/.test(words) ? plain.replace(/^is /, 'are ') : plain}`;
};
// The record's own top-level field a validator's path names: `lots.sourceLinks[0].url` is the coin's links.
const topField = (collection, path) => {
  const rest = String(path ?? '').startsWith(`${collection}.`) ? String(path).slice(collection.length + 1) : '';
  return /^[A-Za-z]+/.exec(rest)?.[0] ?? null;
};
const RECORD_REASONS = {
  'foreign-key': 'the record it belongs with is missing',
  'duplicate-id': 'another record has the same ID',
  'collection-limit': 'its list was over its limit',
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Fields a correction may never touch: what names the record and what counts its writes are the store's own.
export const OWN_RECORD_FIELDS = Object.freeze(['id', 'revision', 'dataClass', 'createdAt', 'updatedAt']);
// Values that stand in for a bad field while the rest of the record is judged, so each field wrong on its own is found.
const STAND_INS = [undefined, 'x', [], {}, 0, false];

/**
 * Every top-level field of a record that is wrong on its own, in the order the validator reaches them (review Important
 * 2): each with what is wrong in plain words, whether the record can go without it, and its value as text to correct.
 * A record the validator refuses as a whole, rather than for one field, gives one entry with no field.
 * @param {string} collection
 * @param {*} record
 * @returns {Array<{ field: string | null, fieldLabel: string, problem: string, clearable: boolean, editable: boolean, current: string }>}
 */
export function recordProblems(collection, record) {
  const problems = [];
  if (!isObject(record)) return [{ field: null, fieldLabel: '', problem: 'it is not in a shape Giga Pinax can read', clearable: false, editable: false, current: '' }];
  let working = { ...record };
  for (let round = 0; round < 40; round += 1) {
    const checked = validateQuarantinedRecord(collection, working);
    if (checked.ok) break;
    const field = topField(collection, checked.error.path);
    if (!field || problems.some((problem) => problem.field === field)) {
      if (!problems.length) problems.push({ field: null, fieldLabel: '', problem: 'it is not in a shape Giga Pinax can read', clearable: false, editable: false, current: '' });
      break;
    }
    const value = record[field];
    let clearable = false;
    let next = null;
    for (const standIn of STAND_INS) {
      const trial = { ...working };
      if (standIn === undefined) delete trial[field];
      else trial[field] = standIn;
      const again = validateQuarantinedRecord(collection, trial);
      if (again.ok || topField(collection, again.error.path) !== field) {
        clearable = standIn === undefined;
        next = trial;
        break;
      }
    }
    const editable = !OWN_RECORD_FIELDS.includes(field) &&
      (value === undefined || value === null || ['string', 'number', 'boolean'].includes(typeof value));
    problems.push({
      field, fieldLabel: fieldWords(field), problem: fieldProblem(field, checked.error.message, value),
      clearable: clearable && !OWN_RECORD_FIELDS.includes(field), editable,
      current: editable && value !== undefined && value !== null ? String(value) : '',
    });
    if (!next) break;
    working = next;
  }
  return problems;
}

/**
 * What is wrong with a set-aside entry, in plain words, and what can be done about it (X-03): every field that stops it,
 * each with whether the record goes back without it and its value as text where it has one to correct.
 * @param {*} entry
 * @returns {{ noun: string, label: string, problem: string, valid: boolean, problems: ReturnType<typeof recordProblems> }}
 */
export function quarantineProblem(entry) {
  const collection = entry?.collection;
  const record = entry?.record;
  const noun = recordNoun(collection);
  const label = isObject(record) ? (['title', 'name', 'reference']
    .map((key) => record[key]).find((value) => typeof value === 'string' && value.trim()) ?? '') : '';
  const checked = isRestorableCollection(collection) && record !== null && record !== undefined
    ? validateQuarantinedRecord(collection, record) : null;
  if (!checked || checked.ok) {
    return { noun, label, problem: RECORD_REASONS[entry?.reason] ?? 'it could not be read', valid: Boolean(checked?.ok), problems: [] };
  }
  const problems = recordProblems(collection, record);
  return { noun, label, problem: problems.map(({ problem }) => problem).join('; '), valid: false, problems };
}

/**
 * A record that cannot go back as it is, in plain words: every field that is wrong, and what is wrong with each.
 * @param {string} collection
 * @param {*} record
 * @returns {string}
 */
export function restoreRefusalText(collection, record) {
  const problems = recordProblems(collection, record);
  const noun = recordNoun(collection);
  if (!problems.length || problems[0].field === null) return `This ${noun} cannot go back as it is: it is not in a shape Giga Pinax can read.`;
  const phrases = problems.map(({ problem }) => `its ${problem}`);
  const listed = phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(', ')}, and ${phrases.at(-1)}`;
  return `This ${noun} cannot go back as it is: ${listed}. Correct ${problems.length === 1 ? 'it' : 'them'} or remove it under Set-aside records.`;
}

function quarantineLine(entry) {
  const cleared = entry.clearedReferences?.length ?? 0;
  const links = cleared ? `, ${cleared} link${cleared === 1 ? '' : 's'} cleared` : '';
  const date = String(entry.quarantinedAt).slice(0, 10);
  if (isSetAsideSettings(entry)) {
    const presets = presetCount(entry);
    return `settings with ${presets ? presetsText(presets) : 'no house presets'}: ${entry.reason} (${date})${links}`;
  }
  if (entry?.collection === 'quarantine') return `An entry of this list that could not be read (set aside ${date})`;
  if (entry?.record === null || entry?.record === undefined) {
    return `A missing ${recordNoun(entry?.collection)} other records pointed to (set aside ${date})${links}`;
  }
  const { noun, label, problem } = quarantineProblem(entry);
  const named = label ? ` “${label}”` : '';
  return `${noun[0].toUpperCase()}${noun.slice(1)}${named}: ${problem} (set aside ${date})${links}`;
}

/**
 * @param {*} entries
 * @returns {string[]}
 */
export function quarantineLines(entries) {
  return (Array.isArray(entries) ? entries : []).map(quarantineLine);
}

// One row per set-aside entry as the page draws it: the line to read, the identifier a restore names, whether the entry
// holds a record to put back at all, and what can be done about the field that stops it (X-03). An entry with no record
// of its own exists only to carry links the repair cleared, and there is nothing in it to restore; nor is there in one
// set aside from somewhere no record goes back to, such as the settings.
/**
 * @param {*} entries
 * @returns {Array<{ id: string, line: string, restorable: boolean, problem: ReturnType<typeof quarantineProblem> | null }>}
 */
export function quarantineRows(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const restorable = entry?.record !== null && entry?.record !== undefined && isRestorableCollection(entry?.collection);
    return { id: quarantineEntryId(entry), line: quarantineLine(entry), restorable, problem: restorable ? quarantineProblem(entry) : null };
  });
}

/**
 * The line a page shows where the collector already is while records are set aside: "1 coin set aside" (X-03).
 * @param {*} entries
 * @returns {string} empty while nothing is
 */
export function setAsideCountText(entries) {
  const records = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.record !== null && entry?.record !== undefined && isRestorableCollection(entry?.collection));
  if (!records.length) return '';
  const collections = new Set(records.map(({ collection }) => collection));
  const noun = collections.size === 1 ? recordNoun([...collections][0], records.length) : (records.length === 1 ? 'record' : 'records');
  return `${records.length} ${noun} set aside`;
}

// What the store answered a restore with, as a sentence: what went back, and what was left alone.
/**
 * @param {*} value the store's reply to quarantine.restore
 * @returns {string}
 */
export function quarantineRestoreText(value) {
  if (!value || typeof value !== 'object') return 'The record was put back.';
  // Corrections kept in the bin while another field is still wrong (review Important 2).
  if (value.restored === false) {
    const fields = (value.corrected ?? []).map((field) => `the ${fieldWords(field)}`);
    const named = fields.length > 1 ? `${fields.slice(0, -1).join(', ')} and ${fields.at(-1)}` : fields[0] ?? 'the record';
    return `Your correction${fields.length === 1 ? '' : 's'} to ${named} ${fields.length === 1 ? 'was' : 'were'} kept. ` +
      `Still to correct: ${(value.remaining ?? []).join('; ')}.`;
  }
  const restored = value.restoredReferences?.length ?? 0;
  const kept = value.keptReferences ?? [];
  const parts = [`The record was put back into ${value.collection}.`];
  // A lot and its collection entry are only valid together, so one of them going back takes the
  // other with it, and the reply says so rather than leaving a second entry seemingly untouched.
  for (const also of value.alsoRestored ?? []) {
    parts.push(`The record it is linked to went back into ${also.collection} with it.`);
  }
  if (value.placedLastInGroup) {
    parts.push('It now comes last in its alternative group, because its old place there has been taken since.');
  }
  if (restored) parts.push(`${restored} link${restored === 1 ? ' was' : 's were'} restored with it.`);
  if (kept.length) {
    parts.push(`${kept.length} link${kept.length === 1 ? '' : 's'} could not be put back, because what ` +
      `${kept.length === 1 ? 'it points' : 'they point'} from has changed since: ` +
      `${kept.map(({ collection, field }) => `${collection}.${field}`).join(', ')}.`);
  }
  return parts.join(' ');
}

/**
 * @param {QuarantineEntry[]} entries
 * @param {string} now
 * @returns {string}
 */
export function quarantineDocument(entries, now) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    quarantine: entries,
  });
}

// The last resort: whatever storage holds, verbatim and unvalidated, down to unsaved drafts. This
// is the collector's rescue copy when nothing else will load, so it strips nothing - a file that
// still holds everything is worth more than a tidy one that quietly leaves data behind.
/**
 * @param {*} raw whatever storage holds, unvalidated
 * @param {string} now
 * @returns {string}
 */
export function rawExportDocument(raw, now) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    kind: RAW_EXPORT_KIND,
    schemaVersion: Number.isSafeInteger(raw?.schemaVersion) ? raw.schemaVersion : SCHEMA_VERSION,
    exportedAt: now,
    data: raw,
  });
}

// Colons are not legal in a file name on every platform the extension runs on.
/**
 * @param {string} prefix
 * @param {string} now
 * @returns {string}
 */
export function backupFileName(prefix, now) {
  return `${prefix}-${now.replace(/:/g, '-')}.json`;
}
