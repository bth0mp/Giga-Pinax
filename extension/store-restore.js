// @ts-check
// Putting back what a repair set aside: a record from the quarantine bin, with the partner it is
// linked to, and the links the repair had to clear.
import { LIMITS, validateQuarantinedRecord } from './core/records.js';
import { OWN_RECORD_FIELDS, recordProblems, restoreRefusalText } from './core/backup.js';
import { clone, own } from './core/validate.js';
import { fail, ok } from './store-builders.js';
/**
 * @typedef {import('./core/types.js').Snapshot} Snapshot
 * @typedef {import('./core/types.js').QuarantineEntry} QuarantineEntry
 * @typedef {import('./core/types.js').ClearedReference} ClearedReference
 */
/**
 * @template T
 * @typedef {import('./core/types.js').Result<T>} Result
 */
/** @typedef {{ collection: string, id: string, field: string }} ReferenceSite */

// A link the repair had to clear goes back only where nothing has taken its place: a field the
// collector has filled since is their own later work, and is left exactly as it is and named in the
// reply, as is one whose record is no longer there to carry it. The changes are handed back with an
// undo, because a link can be one the rest of the root has no room for any more.
/**
 * @param {Snapshot} snapshot changed in place
 * @param {ClearedReference[]} references
 * @param {string} now
 * @returns {{ restored: ReferenceSite[], kept: ReferenceSite[], undo: () => void }}
 */
function restoreClearedReferences(snapshot, references, now) {
  const restored = [];
  const kept = [];
  const applied = [];
  for (const reference of references) {
    const at = { collection: reference.collection, id: reference.id, field: reference.field };
    const host = Array.isArray(snapshot[reference.collection])
      ? snapshot[reference.collection].find((row) => row?.id === reference.id)
      : undefined;
    // A hand-edited bin can name "__proto__" as the field a record lost, and assigning that runs
    // the setter instead of writing a key. Nothing the repair clears is called that.
    if (!host || reference.field === '__proto__') {
      kept.push(at);
    } else if (own(host, reference.field)) {
      const unchanged = JSON.stringify(host[reference.field]) === JSON.stringify(reference.value);
      (unchanged ? restored : kept).push(at);
    } else {
      applied.push({ host, field: reference.field, revision: host.revision, updatedAt: host.updatedAt });
      host[reference.field] = clone(reference.value);
      host.revision += 1;
      host.updatedAt = now;
      restored.push(at);
    }
  }
  // Backwards, because each link wrote down the revision its host carried before that one link was
  // applied: replayed forwards, a host that took two of them would end one revision above where it
  // started, which is an alteration nobody asked for and a false conflict for an open editor.
  const undo = () => {
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      const { host, field, revision, updatedAt } = applied[index];
      delete host[field];
      host.revision = revision;
      host.updatedAt = updatedAt;
    }
  };
  return { restored, kept, undo };
}

// A lot and its collection entry name each other, and the validator insists both ways, so neither is
// a valid record without the other. A repair sets them aside one at a time - the lot for its own
// reason, its entry following as a foreign key - and until now neither could ever come back: each
// was refused over the one still in the bin. So the pair comes back in one command, or neither does.
const PAIRED_COLLECTIONS = new Map([
  ['lots', { self: 'lot', field: 'collectionEntryId', collection: 'collectionEntries', label: 'collection entry' }],
  ['collectionEntries', { self: 'collection entry', field: 'lotId', collection: 'lots', label: 'lot' }],
]);

// The record this one is linked to and the root does not hold, or null where it needs nothing that
// is not already there. A partner that is there but names another record is no pairing this command
// can settle: the ordinary validation refusal says so in the validator's own words.
/**
 * @param {Snapshot} snapshot
 * @param {string} collection
 * @param {*} record
 * @returns {{ self: string, field: string, collection: string, label: string, id: string } | null}
 */
function missingPartner(snapshot, collection, record) {
  const pair = PAIRED_COLLECTIONS.get(collection);
  if (!pair || typeof record[pair.field] !== 'string') return null;
  const home = snapshot[pair.collection];
  const held = Array.isArray(home) ? home.some(({ id }) => id === record[pair.field]) : false;
  return held ? null : { ...pair, id: record[pair.field] };
}

// Everything the store can judge about one entry before anything is written: it holds a record,
// today's validator accepts that record, its collection is one a record can go back to, and nothing
// with its ID is saved there already.
/**
 * @param {Snapshot} snapshot
 * @param {QuarantineEntry} entry
 * @returns {Result<{ home: any[], record: * }>}
 */
function readyToRestore(snapshot, entry) {
  if (entry.record === null || entry.record === undefined) {
    return fail('validation', 'This entry holds no record of its own: it lists links that were cleared while repairing local data.', 'entryId');
  }
  const candidate = validateQuarantinedRecord(entry.collection, entry.record);
  // Said in plain words: which field, and what is wrong with it (X-03).
  if (!candidate.ok) return fail('validation', restoreRefusalText(entry.collection, entry.record), candidate.error.path);
  // The want list is written with its first want, so a want set aside from the last list there was comes back into a new one.
  if (entry.collection === 'wants' && snapshot.wants === undefined) snapshot.wants = [];
  const home = snapshot[entry.collection];
  if (!Array.isArray(home)) {
    return fail('validation', 'This entry is not a record that can be put back.', 'entryId');
  }
  if (home.some(({ id }) => id === candidate.value.id)) {
    return fail('conflict', 'A record with this ID is already saved, so the copy set aside cannot be put back beside it.', `${entry.collection}.id`);
  }
  return ok({ home, record: clone(candidate.value) });
}

// The entry with fields of its record corrected, as text, or cleared (null) - never the entry itself, which stays in the
// bin as it was until a corrected copy goes back or is kept (X-03). Every correction is held to its shape first, and
// all of them are applied together, so a record with two bad fields can go back in one step (review Important 2).
/**
 * @param {QuarantineEntry} entry
 * @param {*} edits a list of `{ field, value }`, each value text or null
 * @returns {Result<{ entry: QuarantineEntry, fields: string[] }>}
 */
function editedEntry(entry, edits) {
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > 40) {
    return fail('validation', 'Corrections are a list of fields and their values.', 'edits');
  }
  if (!entry.record || typeof entry.record !== 'object' || Array.isArray(entry.record)) {
    return fail('validation', 'This entry holds no record whose fields can be corrected.', 'entryId');
  }
  const record = clone(entry.record);
  const fields = [];
  for (const edit of edits) {
    const field = edit?.field;
    if (typeof field !== 'string' || !/^[A-Za-z]{1,64}$/.test(field) || OWN_RECORD_FIELDS.includes(field) || fields.includes(field)) {
      return fail('validation', 'Only a field of the record itself can be corrected, once.', 'edits.field');
    }
    if (edit.value === null) delete record[field];
    else if (typeof edit.value === 'string' && edit.value.length <= LIMITS.notes) record[field] = edit.value.trim();
    else return fail('validation', `A correction is text of at most ${LIMITS.notes} characters.`, 'edits.value');
    fields.push(field);
  }
  return ok({ entry: { ...entry, record }, fields });
}

// The corrections that put a field right while others are still wrong (review Important 2): each one whose field the
// corrected record no longer fails on is kept, on the record as the bin held it; the rest are left out.
/**
 * @param {QuarantineEntry} entry
 * @param {QuarantineEntry} edited
 * @param {string[]} fields
 * @returns {{ record: *, corrected: string[], remaining: string[] }}
 */
function keptCorrections(entry, edited, fields) {
  const stillWrong = recordProblems(entry.collection, edited.record);
  const wrong = new Set(stillWrong.map(({ field }) => field));
  const record = clone(entry.record);
  const corrected = [];
  for (const field of fields) {
    if (wrong.has(field) || wrong.has(null)) continue;
    if (Object.prototype.hasOwnProperty.call(edited.record, field)) record[field] = clone(edited.record[field]);
    else delete record[field];
    corrected.push(field);
  }
  return { record, corrected, remaining: recordProblems(entry.collection, record).map(({ problem }) => problem) };
}

export { editedEntry, keptCorrections, missingPartner, readyToRestore, restoreClearedReferences };
