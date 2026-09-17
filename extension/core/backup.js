import { LIMITS, SCHEMA_VERSION, migrateSnapshot, unusableRevisions, validateSnapshot } from './records.js';
import { sameEventKey } from './evidence.js';
import { findDuplicateLot } from './lot-context.js';
import { clone, failure, own } from './validate.js';

export const BACKUP_FORMAT = 'ancient-coin-auction-companion';
// Exports are compact, but backups written by earlier builds were indented: the import bound has to
// clear a pretty-printed copy of a full store, while the store's own 5 MiB bound still decides what
// the resulting snapshot may hold.
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
// The rescue file says on its face that it is one, so an import can turn it away by name rather
// than by whatever its unvalidated contents happen to trip over first.
export const RAW_EXPORT_KIND = 'raw-rescue';
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

export function validateBackup(document) {
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
  const valid = validateSnapshot(data);
  if (!valid.ok) return failure(valid.error.code, valid.error.message, `data.${valid.error.path ?? ''}`);
  // Validation accepts every revision a stored root may carry, including ones no export ever wrote. Those are turned
  // away here rather than restarted as a stored one is: a record taken in above the usable ceiling would be refused by
  // its own next save, and there is no reason to take it in at all.
  const unusable = unusableRevisions(data);
  if (unusable.length) {
    return failure(
      'invalid-record',
      'This backup carries a revision no Giga Pinax write could have produced, so the file is crafted or corrupt. Import a file made by Export backup.',
      `data.${unusable[0].collection}`,
    );
  }
  exportTimes.set(data, value.exportedAt);
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
    if (entryReviews.has(lot.id) && entry.reviewReason !== entryReviews.get(lot.id)) {
      const reason = entryReviews.get(lot.id);
      if (reason) entry.reviewReason = reason;
      else delete entry.reviewReason;
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

export function previewImport(current, incoming, mode, { exportedAt, now = new Date().toISOString() } = {}) {
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

  repairCollectionPairs(snapshot, conflicts, entryReviews);
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
  if (!valid.ok) return failure('merge-invalid', valid.error.message, valid.error.path);
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
  // A write time the export could not have followed is called out where it is read, so a line the
  // collector reads never rests on a number the file made up.
  const compared = ({ comparedAs }) =>
    (comparedAs ? `; backup time is later than the export itself; compared as ${comparedAs}` : '');
  return [
    ...(preview.updates ?? []).map((row) => {
      const alias = row.incomingTitle ? ` (in the backup: "${row.incomingTitle}")` : '';
      const fields = row.fields?.length ? `, differing in ${fieldsText(row.fields)}` : '';
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

// The last resort: whatever storage holds, verbatim and unvalidated, down to unsaved drafts. This
// is the collector's rescue copy when nothing else will load, so it strips nothing - a file that
// still holds everything is worth more than a tidy one that quietly leaves data behind.
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
export function backupFileName(prefix, now) {
  return `${prefix}-${now.replace(/:/g, '-')}.json`;
}
