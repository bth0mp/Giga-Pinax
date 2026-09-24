// Putting back what a repair set aside: a record from the quarantine bin, with the partner it is
// linked to, and the links the repair had to clear.
import { validateQuarantinedRecord } from './core/records.js';
import { clone, own } from './core/validate.js';
import { fail, ok } from './store-builders.js';

// A link the repair had to clear goes back only where nothing has taken its place: a field the
// collector has filled since is their own later work, and is left exactly as it is and named in the
// reply, as is one whose record is no longer there to carry it. The changes are handed back with an
// undo, because a link can be one the rest of the root has no room for any more.
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
function readyToRestore(snapshot, entry) {
  if (entry.record === null || entry.record === undefined) {
    return fail('validation', 'This entry holds no record of its own: it lists links that were cleared while repairing local data.', 'entryId');
  }
  const candidate = validateQuarantinedRecord(entry.collection, entry.record);
  if (!candidate.ok) return fail('validation', candidate.error.message, candidate.error.path);
  const home = snapshot[entry.collection];
  if (!Array.isArray(home)) {
    return fail('validation', 'This entry is not a record that can be put back.', 'entryId');
  }
  if (home.some(({ id }) => id === candidate.value.id)) {
    return fail('conflict', 'A record with this ID is already saved, so the copy set aside cannot be put back beside it.', `${entry.collection}.id`);
  }
  return ok({ home, record: clone(candidate.value) });
}

export { missingPartner, readyToRestore, restoreClearedReferences };
