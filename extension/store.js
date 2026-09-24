// @ts-check
import {
  LIMITS, SCHEMA_VERSION, createEmptySnapshot, foldQuarantine, migrateSnapshot, quarantineEntryId,
  quarantineInvalidRecords, restartUnusableRevisions, setOutcome, validateDraftPayload,
  validateEventLocalTimes, validateSnapshot,
} from './core/records.js';
import { resolveZonedDateTime } from './core/reminders.js';
import { previewImport, validateBackup } from './core/backup.js';
import { deduplicateEvidence } from './core/evidence.js';
import { findDuplicateLot } from './core/lot-context.js';
import { TOO_DEEPLY_NESTED, clone, isRecursionError, own } from './core/validate.js';
import {
  appendBidHistory, baseRecord, compactGroupPriorities, eventFromDraft, fail, findRecord, getId, getNow, lotFromDraft, ok,
  preferenceFields,
} from './store-builders.js';
import { missingPartner, readyToRestore, restoreClearedReferences } from './store-restore.js';
import { reconcileIntoSnapshot } from './store-schedule.js';
/**
 * @typedef {import('./core/types.js').Snapshot} Snapshot
 * @typedef {import('./core/types.js').Command} Command
 * @typedef {import('./core/types.js').CommandContext} CommandContext
 * @typedef {import('./core/types.js').CommandResult} CommandResult
 * @typedef {import('./core/types.js').CommandFailure} CommandFailure
 * @typedef {import('./core/types.js').CommandSuccess} CommandSuccess
 * @typedef {import('./core/types.js').StorageArea} StorageArea
 */
/**
 * @template T
 * @typedef {import('./core/types.js').Result<T>} Result
 */
/**
 * A command applied to a copy of the root: the root it leaves, the value it answers with, the reply the
 * ledger keeps, and whether it wrote anything at all.
 * @typedef {{ snapshot: Snapshot, value: *, reply?: CommandSuccess, mutated: boolean }} Applied
 */

export const STORAGE_KEY = 'auctionCompanion:v1';
export const MAX_ROOT_BYTES = 5 * 1024 * 1024;
// The commands the background worker answers from an extension page; any other message gets no reply.
export const COMMAND_TYPES = new Set([
  'snapshot.get', 'snapshot.raw',
  'preferences.migrateIfAbsent', 'preferences.save',
  'lot.save', 'lot.delete',
  'group.save', 'group.delete', 'group.reorder',
  'bid.plan', 'bid.place', 'bid.cancel',
  'lot.outcome.set', 'collection.review.resolve',
  'event.save', 'event.delete',
  'evidence.add', 'evidence.include', 'evidence.resolve',
  'draft.save', 'draft.get', 'draft.consume',
  'alert.ack', 'alert.snooze', 'alert.markAllRead',
  'backup.import', 'quarantine.restore',
]);
const SCHEDULE_CHANGING_COMMANDS = new Set([
  'event.save', 'event.delete', 'lot.save', 'lot.delete', 'lot.outcome.set', 'backup.import',
  'quarantine.restore',
]);
const INTERNAL_COMMANDS = new Set(['scheduler.reconcile', 'alert.claim', 'alert.delivery.record']);
const RESERVED_INSTANT = '9999-12-31T23:59:59.999Z';
// What a command that no longer fits in local storage says, where the reminder preflight's own
// sentence would name the wrong thing: the message and the field it belongs to.
const OVER_THE_BOUND = new Map([
  ['backup.import', ['This backup does not fit in the 5 MiB local storage bound. Remove records here, or import a backup with fewer records.', 'document']],
  ['quarantine.restore', ['Putting this record back would exceed the 5 MiB local storage bound. Remove records you no longer need, then put it back.', 'entryId']],
]);
// What any other command says when its own result, before any reminder it schedules, does not fit.
const THIS_CHANGE_OVER_THE_BOUND = 'This change would exceed the 5 MiB local storage bound. Remove records you no longer need, then try again.';

/**
 * @param {Snapshot} snapshot
 * @param {boolean} [commandHeadroom]
 * @returns {number}
 */
function storageBytesWithReserve(snapshot, commandHeadroom = true) {
  const reserved = clone(snapshot);
  for (const alert of reserved.alerts) {
    alert.revision = Number.MAX_SAFE_INTEGER;
    alert.status = 'acknowledged';
    for (const field of ['attemptedAt', 'claimedAt', 'deliveredAt', 'acknowledgedAt', 'snoozedUntil', 'missedAt']) {
      alert[field] = RESERVED_INSTANT;
    }
  }
  return new TextEncoder().encode(JSON.stringify(reserved)).length + (commandHeadroom ? LIMITS.commandReplyBytes : 0);
}

/**
 * @param {Snapshot} snapshot
 * @param {Command} command
 * @param {CommandContext} context
 * @returns {Result<Applied>}
 */
function mutation(snapshot, command, context) {
  const next = clone(snapshot);
  const now = getNow(context);
  let value;
  // A capture draft is half-hour scratch holding the text of a page, and only saving another draft used to clear the
  // expired ones, so one capture kept its text for good. Every change clears them now; a read still leaves the root alone.
  next.drafts = next.drafts.filter(({ expiresAt }) => expiresAt > now);

  switch (command.type) {
    case 'preferences.migrateIfAbsent': {
      if (snapshot.preferences !== null) return ok({ snapshot, value: snapshot.preferences, mutated: false });
      const preferences = preferenceFields(command.preferences);
      if (!preferences) return fail('validation', 'Preferences are required.', 'preferences');
      // Held to its shape with the rest of the root before anything is written.
      next.preferences = /** @type {import('./core/types.js').Preferences} */ ({
        schemaVersion: SCHEMA_VERSION,
        revision: 0,
        ...clone(preferences),
        desktopAlertsEnabled: false,
        createdAt: now,
        updatedAt: now,
      });
      value = next.preferences;
      break;
    }
    case 'preferences.save': {
      if (!snapshot.preferences) return fail('conflict', 'Preferences have not been created.', 'preferences');
      if (snapshot.preferences.revision !== command.expectedRevision) {
        return fail('conflict', 'Preferences changed in another view.', 'preferences.revision');
      }
      const preferences = preferenceFields(command.preferences, true);
      if (!preferences) return fail('validation', 'Preferences are required.', 'preferences');
      next.preferences = {
        ...snapshot.preferences,
        ...clone(preferences),
        revision: snapshot.preferences.revision + 1,
        updatedAt: now,
      };
      value = next.preferences;
      break;
    }
    case 'lot.save': {
      if (!command.lot || typeof command.lot !== 'object') {
        return fail('validation', 'Lot draft is required.', 'lot');
      }
      if (command.expectedRevision === null) {
        if (own(command.lot, 'id')) return fail('validation', 'New lots cannot supply a durable ID.', 'lot.id');
        value = lotFromDraft(command.lot, null, context);
      } else {
        const found = findRecord(next.lots, command.lot?.id, command.expectedRevision, 'lot');
        if (!found.ok) return found;
        value = lotFromDraft(command.lot, found.value.record, context);
        const duplicate = findDuplicateLot(next.lots, value, value.id);
        if (duplicate) return fail('duplicate', 'This auction lot is already saved.', undefined, duplicate.id);
        next.lots[found.value.index] = value;
      }
      if (command.expectedRevision === null) {
        const duplicate = findDuplicateLot(next.lots, value);
        if (duplicate) return fail('duplicate', 'This auction lot is already saved.', undefined, duplicate.id);
        next.lots.push(value);
      }
      break;
    }
    case 'lot.delete': {
      const found = findRecord(next.lots, command.lotId, command.expectedRevision, 'lot');
      if (!found.ok) return found;
      if (found.value.record.collectionEntryId) {
        return fail('validation', 'Resolve linked collection history before deleting this lot.', 'lot.collectionEntryId');
      }
      if (found.value.record.activeBid) {
        return fail('validation', 'Record external cancellation or settlement before deleting this lot.', 'lot.activeBid');
      }
      value = found.value.record;
      next.lots.splice(found.value.index, 1);
      if (value.alternativeGroupId) {
        compactGroupPriorities(next.lots, value.alternativeGroupId, now);
        const group = next.alternativeGroups.find(({ id }) => id === value.alternativeGroupId);
        if (group) {
          group.revision += 1;
          group.updatedAt = now;
        }
      }
      break;
    }
    case 'group.save': {
      if (!command.group || typeof command.group !== 'object') {
        return fail('validation', 'Group draft is required.', 'group');
      }
      if (command.expectedRevision === null) {
        if (own(command.group, 'id')) return fail('validation', 'New groups cannot supply a durable ID.', 'group.id');
        value = baseRecord({ name: command.group.name }, context);
        next.alternativeGroups.push(value);
      } else {
        const found = findRecord(next.alternativeGroups, command.group?.id, command.expectedRevision, 'group');
        if (!found.ok) return found;
        value = { ...found.value.record, name: command.group.name, revision: found.value.record.revision + 1, updatedAt: now };
        next.alternativeGroups[found.value.index] = value;
      }
      break;
    }
    case 'group.delete': {
      const found = findRecord(next.alternativeGroups, command.groupId, command.expectedRevision, 'group');
      if (!found.ok) return found;
      next.alternativeGroups.splice(found.value.index, 1);
      for (const lot of next.lots) {
        if (lot.alternativeGroupId !== command.groupId) continue;
        delete lot.alternativeGroupId;
        delete lot.priority;
        lot.revision += 1;
        lot.updatedAt = now;
      }
      value = found.value.record;
      break;
    }
    case 'group.reorder': {
      const found = findRecord(next.alternativeGroups, command.groupId, command.expectedRevision, 'group');
      if (!found.ok) return found;
      if (!Array.isArray(command.orderedLotIds) || new Set(command.orderedLotIds).size !== command.orderedLotIds.length) {
        return fail('validation', 'Group order must contain unique lot IDs.', 'orderedLotIds');
      }
      // An ID naming no lot is refused on the next line, so what is left is lots.
      const selected = /** @type {import('./core/types.js').Lot[]} */ (command.orderedLotIds.map((id) => next.lots.find((lot) => lot.id === id)));
      if (selected.some((lot) => !lot)) return fail('validation', 'Group order contains an unknown lot.', 'orderedLotIds');
      const sourceGroupIds = new Set(selected.map((lot) => lot.alternativeGroupId).filter(Boolean));
      const affectedLots = new Set([
        ...selected,
        ...next.lots.filter(({ alternativeGroupId }) =>
          alternativeGroupId === command.groupId || sourceGroupIds.has(alternativeGroupId)),
      ]);
      const affectedGroups = new Set([command.groupId]);
      for (const lot of affectedLots) if (lot.alternativeGroupId) affectedGroups.add(lot.alternativeGroupId);
      if (!command.expectedGroupRevisions || !command.expectedLotRevisions) {
        return fail('validation', 'Group and lot revision maps are required.', 'expectedGroupRevisions');
      }
      for (const groupId of affectedGroups) {
        const group = next.alternativeGroups.find(({ id }) => id === groupId);
        if (!group || command.expectedGroupRevisions[groupId] !== group.revision) {
          return fail('conflict', 'An affected group changed in another view.', 'expectedGroupRevisions');
        }
      }
      for (const lot of affectedLots) {
        if (command.expectedLotRevisions[lot.id] !== lot.revision) {
          return fail('conflict', 'An affected lot changed in another view.', 'expectedLotRevisions');
        }
      }
      const oldGroups = /** @type {Set<string>} */ (new Set(selected.map((lot) => lot.alternativeGroupId).filter(Boolean)));
      for (const lot of next.lots) {
        if (lot.alternativeGroupId === command.groupId && !command.orderedLotIds.includes(lot.id)) {
          delete lot.alternativeGroupId;
          delete lot.priority;
          lot.revision += 1;
          lot.updatedAt = now;
        }
      }
      selected.forEach((lot, index) => {
        lot.alternativeGroupId = command.groupId;
        lot.priority = index + 1;
        lot.revision += 1;
        lot.updatedAt = now;
      });
      for (const groupId of oldGroups) {
        if (groupId === command.groupId) continue;
        compactGroupPriorities(next.lots, groupId, now);
        const sourceGroup = next.alternativeGroups.find(({ id }) => id === groupId);
        if (sourceGroup) {
          sourceGroup.revision += 1;
          sourceGroup.updatedAt = now;
        }
      }
      value = { ...found.value.record, revision: found.value.record.revision + 1, updatedAt: now };
      next.alternativeGroups[found.value.index] = value;
      break;
    }
    case 'bid.plan':
    case 'bid.place':
    case 'bid.cancel': {
      const found = findRecord(next.lots, command.lotId, command.expectedRevision, 'lot');
      if (!found.ok) return found;
      const lot = found.value.record;
      if (lot.outcome.status !== 'open') return fail('validation', 'Only an open lot can change bid declarations.', 'lot.outcome');
      if (command.type === 'bid.plan') {
        if (command.plannedBid === null) {
          if (!lot.plannedBid) return fail('validation', 'This lot has no planned bid to clear.', 'lot.plannedBid');
          appendBidHistory(lot, 'planned-cleared', lot.plannedBid, context);
          delete lot.plannedBid;
        } else {
          lot.plannedBid = clone(command.plannedBid);
          appendBidHistory(lot, 'planned-revised', command.plannedBid, context);
        }
      } else if (command.type === 'bid.place') {
        const action = lot.activeBid ? 'active-revised' : 'placed';
        // The placed bid carries the plan out: the plan is kept in the history, not beside the bid in force.
        if (lot.plannedBid) {
          appendBidHistory(lot, 'planned-cleared', lot.plannedBid, context);
          delete lot.plannedBid;
        }
        lot.activeBid = { ...clone(command.activeBid), placedAt: now };
        appendBidHistory(lot, action, command.activeBid, context);
      } else {
        if (!lot.activeBid) return fail('validation', 'This lot has no active bid to cancel.', 'lot.activeBid');
        appendBidHistory(lot, 'externally-cancelled', lot.activeBid, context);
        delete lot.activeBid;
      }
      if (command.type !== 'bid.cancel' && own(command, 'costEstimate')) {
        const bid = command.type === 'bid.plan' ? command.plannedBid : command.activeBid;
        if (command.costEstimate !== null && command.costEstimate?.currency !== bid?.amount?.currency) {
          return fail('validation', 'Cost estimate currency must match the bid currency.', 'costEstimate.currency');
        }
        if (command.costEstimate === null) delete lot.costEstimate;
        else lot.costEstimate = clone(command.costEstimate);
      }
      lot.revision += 1;
      lot.updatedAt = now;
      value = lot;
      break;
    }
    case 'lot.outcome.set': {
      const found = findRecord(next.lots, command.lotId, command.expectedRevision, 'lot');
      if (!found.ok) return found;
      const outcome = setOutcome(found.value.record, command.outcome, now);
      if (!outcome.ok) return fail('validation', outcome.error.message, outcome.error.path);
      value = outcome.value;
      next.lots[found.value.index] = value;
      if (command.addToCollection) {
        if (command.outcome.status !== 'won' || value.collectionEntryId) {
          return fail('validation', 'Collection history can be added only once for a won lot.', 'addToCollection');
        }
        const entry = baseRecord({
          lotId: value.id,
          title: command.addToCollection.title,
          acquisitionDate: command.addToCollection.acquisitionDate,
          sourceLinks: clone(command.addToCollection.sourceLinks ?? []),
          ...(own(command.addToCollection, 'notes') ? { notes: command.addToCollection.notes } : {}),
          ...(value.outcome.hammer ? { hammer: clone(value.outcome.hammer) } : {}),
          ...(value.outcome.actualInvoice ? { actualInvoice: clone(value.outcome.actualInvoice) } : {}),
        }, context);
        value.collectionEntryId = entry.id;
        next.collectionEntries.push(entry);
      }
      const reviewed = value.collectionEntryId
        ? next.collectionEntries.find(({ id }) => id === value.collectionEntryId) : undefined;
      if (reviewed && value.collectionReviewReason !== reviewed.reviewReason) {
        // The entry follows its lot, so a correction back to won withdraws the review as well.
        if (value.collectionReviewReason) reviewed.reviewReason = value.collectionReviewReason;
        else delete reviewed.reviewReason;
        reviewed.revision += 1;
        reviewed.updatedAt = now;
      }
      break;
    }
    case 'collection.review.resolve': {
      const found = findRecord(next.collectionEntries, command.collectionEntryId, command.expectedRevision, 'collectionEntry');
      if (!found.ok) return found;
      const lot = next.lots.find(({ id }) => id === found.value.record.lotId);
      if (!lot) return fail('validation', 'Linked lot was not found.', 'collectionEntry.lotId');
      if (command.decision === 'remove') {
        next.collectionEntries.splice(found.value.index, 1);
        delete lot.collectionEntryId;
      } else if (command.decision === 'keep') {
        delete found.value.record.reviewReason;
        found.value.record.revision += 1;
        found.value.record.updatedAt = now;
      } else return fail('validation', 'Decision must be keep or remove.', 'decision');
      delete lot.collectionReviewReason;
      lot.revision += 1;
      lot.updatedAt = now;
      value = lot;
      break;
    }
    case 'event.save': {
      const eventDraft = clone(command.event ?? {});
      if (eventDraft.precision === 'timed') {
        const resolved = resolveZonedDateTime({
          localDate: eventDraft.localDate,
          localTime: eventDraft.localTime,
          timeZone: eventDraft.timeZone,
          disambiguation: 'reject',
        });
        if (!resolved.ok) return fail('validation', resolved.error.message, `event.${resolved.error.path}`);
        eventDraft.startsAt = resolved.value.startsAt;
      } else {
        delete eventDraft.localTime;
        delete eventDraft.startsAt;
      }
      if (command.expectedRevision === null) {
        if (own(eventDraft, 'id')) return fail('validation', 'New events cannot supply a durable ID.', 'event.id');
        value = eventFromDraft(eventDraft, null, context);
        next.auctionEvents.push(value);
      } else {
        const found = findRecord(next.auctionEvents, eventDraft.id, command.expectedRevision, 'event');
        if (!found.ok) return found;
        value = eventFromDraft(eventDraft, found.value.record, context);
        next.auctionEvents[found.value.index] = value;
      }
      const localTimes = validateEventLocalTimes(value);
      if (!localTimes.ok) return fail('validation', localTimes.error.message, localTimes.error.path);
      const retainedReminderIds = new Set(value.reminders.map(({ id }) => id));
      next.alerts = next.alerts.filter((alert) =>
        alert.eventId !== value.id || retainedReminderIds.has(alert.reminderId));
      break;
    }
    case 'event.delete': {
      const found = findRecord(next.auctionEvents, command.eventId, command.expectedRevision, 'event');
      if (!found.ok) return found;
      if (next.lots.some(({ auctionEventId }) => auctionEventId === command.eventId)) {
        return fail('validation', 'Detach linked lots before deleting this event.', 'event.id');
      }
      next.auctionEvents.splice(found.value.index, 1);
      next.alerts = next.alerts.filter(({ eventId }) => eventId !== command.eventId);
      value = found.value.record;
      break;
    }
    case 'evidence.add': {
      if (!command.observation || typeof command.observation !== 'object') {
        return fail('validation', 'Evidence observation is required.', 'observation');
      }
      if (!['manual', 'authorized-import'].includes(command.observation.source)) {
        return fail('validation', 'Public evidence entry requires manual or authorized-import provenance.', 'observation.source');
      }
      const observation = clone(command.observation);
      delete observation.id;
      delete observation.dataClass;
      delete observation.retrievedAt;
      observation.id = getId(context);
      observation.dataClass = observation.source === 'authorized-import' ? 'authorized' : 'collector';
      observation.retrievedAt = now;
      const allObservations = next.evidence.flatMap((row) => row.observations).concat(observation);
      const regrouped = deduplicateEvidence(allObservations);
      if (!regrouped.ok) return fail('validation', regrouped.error.message, regrouped.error.path);
      const priorById = new Map(next.evidence.map((row) => [row.id, row]));
      next.evidence = regrouped.value.evidence.map((row) => {
        const prior = priorById.get(row.id);
        if (prior && JSON.stringify(prior.observations) === JSON.stringify(row.observations)) return prior;
        const merged = {
          ...row,
          revision: prior ? prior.revision + 1 : 0,
          createdAt: prior?.createdAt ?? now,
          updatedAt: now,
          ...(prior?.notes ? { notes: prior.notes } : {}),
        };
        if (prior?.resolved && ['collector-selected-observation', 'collector-entered'].includes(prior.resolved.resolution)) {
          merged.resolved = clone(prior.resolved);
          merged.inclusion = prior.inclusion;
          if (prior.inclusion === 'included') delete merged.exclusionReason;
          else merged.exclusionReason = prior.exclusionReason;
        } else if (prior?.inclusion === 'excluded' && prior.exclusionReason === 'collector-excluded') {
          merged.inclusion = 'excluded';
          merged.exclusionReason = 'collector-excluded';
        }
        return merged;
      });
      value = next.evidence.find((row) => row.observations.some(({ id }) => id === observation.id));
      break;
    }
    case 'evidence.include': {
      const found = findRecord(next.evidence, command.evidenceId, command.expectedRevision, 'evidence');
      if (!found.ok) return found;
      const row = found.value.record;
      if (command.inclusion === 'included') {
        if (!row.resolved) return fail('validation', 'Resolve a hammer claim before including this evidence.', 'evidence.resolved');
        row.inclusion = 'included';
        delete row.exclusionReason;
      } else if (command.inclusion === 'excluded') {
        row.inclusion = 'excluded';
        row.exclusionReason = command.exclusionReason ?? 'collector-excluded';
      } else return fail('validation', 'Evidence inclusion must be included or excluded.', 'inclusion');
      row.revision += 1;
      row.updatedAt = now;
      value = row;
      break;
    }
    case 'evidence.resolve': {
      const found = findRecord(next.evidence, command.evidenceId, command.expectedRevision, 'evidence');
      if (!found.ok) return found;
      const row = found.value.record;
      if (command.resolution?.kind === 'observation') {
        const selected = row.observations.find(({ id }) => id === command.resolution.observationId);
        if (!selected || selected.priceBasis !== 'hammer' || !selected.amount) {
          return fail('validation', 'Choose a retained hammer observation.', 'resolution.observationId');
        }
        row.resolved = {
          priceBasis: 'hammer', hammer: clone(selected.amount),
          resolution: 'collector-selected-observation', observationId: selected.id, resolvedAt: now,
        };
      } else if (command.resolution?.kind === 'entered') {
        row.resolved = {
          priceBasis: 'hammer', hammer: clone(command.resolution.hammer),
          resolution: 'collector-entered', resolvedAt: now,
        };
      } else return fail('validation', 'Evidence resolution is required.', 'resolution');
      row.inclusion = 'included';
      delete row.exclusionReason;
      row.revision += 1;
      row.updatedAt = now;
      value = row;
      break;
    }
    case 'draft.save': {
      const payload = validateDraftPayload(command.kind, command.payload);
      if (!payload.ok) return fail('validation', payload.error.message, payload.error.path);
      value = /** @type {import('./core/types.js').Draft} */ ({
        id: getId(context),
        revision: 0,
        dataClass: 'collector',
        kind: command.kind,
        payload: clone(payload.value),
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.parse(now) + 30 * 60 * 1000).toISOString(),
      });
      next.drafts.push(value);
      next.drafts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      next.drafts = next.drafts.slice(-20);
      break;
    }
    case 'draft.consume': {
      const index = next.drafts.findIndex(({ id }) => id === command.draftId);
      if (index < 0) return fail('validation', 'Draft was not found or expired.', 'draftId');
      [value] = next.drafts.splice(index, 1);
      break;
    }
    case 'alert.ack':
    case 'alert.snooze':
    case 'alert.markAllRead': {
      const ids = command.type === 'alert.markAllRead' ? null : new Set(command.triggerIds ?? []);
      let changed = 0;
      for (const alert of next.alerts) {
        if (ids && !ids.has(alert.triggerId)) continue;
        if (!['due', 'claimed', 'delivered', 'snoozed'].includes(alert.status)) continue;
        if (command.type === 'alert.snooze') {
          alert.status = 'snoozed';
          alert.snoozedUntil = command.snoozedUntil;
        } else {
          alert.status = 'acknowledged';
          alert.acknowledgedAt = now;
        }
        alert.revision += 1;
        alert.updatedAt = now;
        changed += 1;
      }
      if (ids && changed !== ids.size) return fail('validation', 'One or more alert IDs are not actionable.', 'triggerIds');
      value = { changed };
      break;
    }
    case 'alert.claim':
    case 'alert.delivery.record': {
      if (!Array.isArray(command.triggerIds) || command.triggerIds.length === 0 ||
          new Set(command.triggerIds).size !== command.triggerIds.length) {
        return fail('validation', 'Unique alert trigger IDs are required.', 'triggerIds');
      }
      const ids = new Set(command.triggerIds);
      let changed = 0;
      for (const alert of next.alerts) {
        if (!ids.has(alert.triggerId)) continue;
        if (command.type === 'alert.claim') {
          if (alert.status !== 'due' || alert.eventId !== command.eventId) continue;
          alert.status = 'claimed';
          alert.attemptedAt = now;
          alert.claimedAt = now;
        } else {
          if (alert.status !== 'claimed' || typeof command.delivered !== 'boolean') continue;
          alert.status = command.delivered ? 'delivered' : 'claimed';
          if (command.delivered) alert.deliveredAt = now;
        }
        alert.revision += 1;
        alert.updatedAt = now;
        changed += 1;
      }
      if (changed !== ids.size) {
        return fail('conflict', 'One or more alerts are no longer in the expected delivery state.', 'triggerIds');
      }
      value = { eventId: command.eventId, triggerIds: [...ids], changed };
      break;
    }
    case 'scheduler.reconcile': {
      const plan = reconcileIntoSnapshot(next, context);
      value = { nextWakeAt: plan.nextWakeAt, dueEventCount: Object.keys(plan.overdueByEvent).length };
      // Every service-worker wake reconciles. A reconcile that changes no alert and no wake time
      // must leave the root alone, or an idle worker would invalidate an import's expectedRevision.
      if (next.scheduler.nextWakeAt === snapshot.scheduler.nextWakeAt &&
          JSON.stringify(next.alerts) === JSON.stringify(snapshot.alerts)) {
        return ok({ snapshot, value, mutated: false });
      }
      break;
    }
    case 'quarantine.restore': {
      // The bin is a recovery bin, not a second copy of the store: a record put back has to be one
      // today's validator accepts, and it goes back where it was set aside from.
      const entries = Array.isArray(next.quarantine) ? next.quarantine : [];
      const index = entries.findIndex((entry) => quarantineEntryId(entry) === command.entryId);
      if (index < 0) {
        return fail('validation', 'That set-aside record is no longer in the list. Reload the page and try again.', 'entryId');
      }
      const chosen = entries[index];
      const first = readyToRestore(next, chosen);
      if (!first.ok) return first;
      const restoring = [{ entry: chosen, ...first.value }];
      const partner = missingPartner(next, chosen.collection, first.value.record);
      if (partner) {
        const held = entries.find((entry) => entry !== chosen &&
          entry.collection === partner.collection && entry.record?.id === partner.id);
        if (!held) {
          return fail('validation', `Putting this ${partner.self} back needs the ${partner.label} it is ` +
            `linked to (${partner.id}), which is neither saved here nor in this list to be put back with it.`, 'entryId');
        }
        const second = readyToRestore(next, held);
        if (!second.ok) return second;
        restoring.push({ entry: held, ...second.value });
      }
      const references = [];
      let placedLastInGroup = false;
      for (const { entry, home, record } of restoring) {
        // The bin is not the collection: a record coming back out of it is counted again from zero
        // rather than from wherever its last write left it. Nothing can be holding the old number -
        // the record was not there to be read - and a save composed before it was set aside is told.
        record.revision = 0;
        record.updatedAt = now;
        // A group closes up behind a member that leaves it, so the place this one held can be taken
        // by now. The order the collector has there since is theirs: this one goes in after it.
        if (entry.collection === 'lots' && own(record, 'alternativeGroupId') &&
            next.alternativeGroups.some(({ id }) => id === record.alternativeGroupId)) {
          const last = next.lots.filter(({ alternativeGroupId }) => alternativeGroupId === record.alternativeGroupId).length + 1;
          if (record.priority !== last) {
            record.priority = last;
            placedLastInGroup = true;
          }
        }
        // An entry follows its lot into the bin when the lot does not name it. Where that lot is still
        // saved and names no entry at all, the link goes back as a cleared one would: only into an
        // empty field, and named in the reply.
        if (entry.collection === 'collectionEntries') {
          const lot = next.lots.find(({ id }) => id === record.lotId);
          if (lot && !own(lot, 'collectionEntryId')) {
            references.push({ collection: 'lots', id: lot.id, field: 'collectionEntryId', value: record.id });
          }
        }
        home.push(record);
        references.push(...(entry.clearedReferences ?? []));
      }
      const links = restoreClearedReferences(next, references, now);
      let restoredReferences = links.restored;
      let keptReferences = links.kept;
      // A link can be one the rest of the root has no room for any more - a priority in a group
      // renumbered since. The record is what the collector asked for, so the links give way rather
      // than the whole restore failing over one of them, and each of them is named in the reply.
      let validated = validateSnapshot(next);
      if (!validated.ok) {
        links.undo();
        restoredReferences = [];
        keptReferences = [...links.restored, ...links.kept];
        validated = validateSnapshot(next);
      }
      // Without its links the root can still refuse the record itself, and that refusal is the
      // validator's own. It is not the reminder preflight's to repeat as a schedule that could not
      // be made: nothing here was ever about reminders.
      if (!validated.ok) return fail('validation', validated.error.message, validated.error.path);
      for (const { entry } of restoring) entries.splice(entries.indexOf(entry), 1);
      if (!entries.length) delete next.quarantine;
      value = {
        collection: chosen.collection,
        id: first.value.record.id,
        restoredReferences,
        keptReferences,
        ...(placedLastInGroup ? { placedLastInGroup } : {}),
        ...(restoring.length > 1
          ? { alsoRestored: restoring.slice(1).map(({ entry, record }) => ({ collection: entry.collection, id: record.id })) }
          : {}),
      };
      break;
    }
    case 'backup.import': {
      if (command.expectedRevision !== snapshot.revision) {
        return fail('conflict', 'Local data changed after the import preview.', 'expectedRevision');
      }
      const validated = validateBackup(command.document);
      if (!validated.ok) return fail('validation', validated.error.message, validated.error.path);
      const preview = previewImport(snapshot, validated.value, command.mode);
      if (!preview.ok) return fail('validation', preview.error.message, preview.error.path);
      // A conflict the merge could not settle keeps the local row and is reported in the preview;
      // it no longer holds back the records that did merge.
      if (!preview.value.snapshot) {
        return fail('conflict', 'Import conflicts must be resolved before committing.', 'document');
      }
      const imported = clone(preview.value.snapshot);
      imported.recentCommands = command.mode === 'merge' ? clone(snapshot.recentCommands) : [];
      // Quarantine is a recovery bin rather than live data, so no import discards what is in it. The
      // two bins fold together the way a repair folds one: a record set aside on both installs is
      // one entry with one Restore, not two differing only in the moment each install repaired it.
      const rescued = foldQuarantine(clone([...(snapshot.quarantine ?? []), ...(imported.quarantine ?? [])]));
      if (rescued.length) imported.quarantine = rescued;
      // Only the root keys the snapshot has are copied, one at a time: `Object.assign` would run a
      // backup's own `"__proto__"` key through the setter and replace the live root's prototype,
      // and any other key a hand-edited file carries would settle into storage unvalidated.
      const rootKeys = [
        'schemaVersion', 'revision', 'updatedAt', 'preferences', 'scheduler', 'quarantine',
        'lots', 'auctionEvents', 'alternativeGroups', 'evidence', 'collectionEntries',
        'drafts', 'alerts', 'recentCommands',
      ];
      for (const key of Object.keys(next)) delete next[key];
      for (const key of rootKeys) {
        if (Object.prototype.hasOwnProperty.call(imported, key)) next[key] = imported[key];
      }
      value = { mode: command.mode, counts: preview.value.counts };
      break;
    }
    default:
      return fail('unsupported', `Unsupported command: ${String(command.type)}`, 'type');
  }

  next.revision = snapshot.revision + 1;
  next.updatedAt = now;
  /** @type {CommandSuccess} */
  const reply = { ok: true, requestId: command.requestId, revision: next.revision, value: clone(value) };
  next.recentCommands.push({
    requestId: command.requestId,
    commandType: command.type,
    revision: next.revision,
    committedAt: now,
    reply: clone(reply),
  });
  next.recentCommands = next.recentCommands.slice(-200);
  // The command's own result is judged, and measured, before the schedule it leads to: a lot too many or a store
  // already at the bound is the command's own refusal, in its own words, and was reported as reminders that could not
  // be scheduled - with removing reminders offered as the way out.
  const validated = validateSnapshot(next);
  if (!validated.ok) return fail('validation', validated.error.message, validated.error.path);
  if (SCHEDULE_CHANGING_COMMANDS.has(command.type)) {
    // The bound is shared, but the way out of it is not: neither a backup that does not fit nor a record being put back
    // is answered by removing reminders, and each names what to change.
    const overTheBound = OVER_THE_BOUND.get(command.type);
    if (storageBytesWithReserve(next) > MAX_ROOT_BYTES) {
      const bounded = overTheBound ?? [THIS_CHANGE_OVER_THE_BOUND, 'type'];
      return fail('storage-bound', bounded[0], bounded[1]);
    }
    let projectedId = 0;
    const projected = clone(next);
    reconcileIntoSnapshot(projected, {
      now: () => now,
      newId: () => `ffffffff-ffff-4fff-8fff-${String(projectedId++).padStart(12, '0')}`,
    });
    projected.revision += 1;
    const reconcileRequestId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const reconcileValue = { nextWakeAt: projected.scheduler.nextWakeAt, dueEventCount: projected.alerts.filter(({ status }) => status === 'due').length };
    projected.recentCommands.push({
      requestId: reconcileRequestId, commandType: 'scheduler.reconcile', revision: projected.revision, committedAt: now,
      reply: { ok: true, requestId: reconcileRequestId, revision: projected.revision, value: reconcileValue },
    });
    projected.recentCommands = projected.recentCommands.slice(-200);
    // The reconcile that follows this command is a command of its own, so a projection that could not be validated used
    // to commit anyway and leave every later reconcile failing, with nobody to tell. Refused here, while there is. The
    // command itself has already passed, so what failed is the schedule it leads to.
    const projectedValid = validateSnapshot(projected);
    if (!projectedValid.ok) {
      return fail('validation', `These reminders could not be scheduled: ${projectedValid.error.message}`, projectedValid.error.path);
    }
    if (storageBytesWithReserve(projected) > MAX_ROOT_BYTES) {
      const bounded = overTheBound ??
        ['These reminders would exceed the 5 MiB local storage bound. Remove reminders or old auction events before saving.', 'reminders'];
      return fail('storage-bound', bounded[0], bounded[1]);
    }
  }
  return ok({ snapshot: next, value, reply, mutated: true });
}

/**
 * @param {Snapshot} snapshot
 * @param {Command} command
 * @param {CommandContext} context
 * @returns {Result<Applied>}
 */
export function applyCommand(snapshot, command, context) {
  if (!command || typeof command !== 'object' || typeof command.type !== 'string') {
    return fail('validation', 'Command type is required.', 'type');
  }
  if (typeof command.requestId !== 'string') return fail('validation', 'Request ID is required.', 'requestId');
  if (command.type === 'snapshot.get' || command.type === 'snapshot.raw') {
    return ok({ snapshot, value: snapshot, mutated: false });
  }
  if (command.type === 'draft.get') {
    const draft = snapshot.drafts.find((item) =>
      item.id === command.draftId && item.expiresAt > getNow(context));
    return draft ? ok({ snapshot, value: draft, mutated: false })
      : fail('validation', 'Draft was not found or expired.', 'draftId');
  }
  return mutation(snapshot, command, context);
}

/**
 * @param {*} command
 * @param {string} code
 * @param {'not-committed' | 'unknown'} outcome
 * @param {string} message
 * @returns {CommandFailure}
 */
function errorReply(command, code, outcome, message) {
  return {
    ok: false,
    requestId: typeof command?.requestId === 'string' ? command.requestId : '',
    code,
    outcome,
    message,
  };
}

/**
 * The one writer of the root: commands are applied one at a time, in the order they arrive.
 * @param {StorageArea} storageArea
 * @param {CommandContext} context
 * @returns {{ commitCommand: (command: *) => Promise<CommandResult> }}
 */
export function createCommandWriter(storageArea, context) {
  let queue = Promise.resolve();

  async function commit(command) {
    if (!command || typeof command !== 'object' || typeof command.type !== 'string' ||
        typeof command.requestId !== 'string') {
      return errorReply(command, 'validation', 'not-committed', 'Command type and request ID are required.');
    }
    let raw;
    try {
      const result = await storageArea.get(STORAGE_KEY);
      raw = result?.[STORAGE_KEY] ?? createEmptySnapshot(getNow(context));
    } catch (error) {
      return errorReply(command, 'storage', 'not-committed', error.message || 'Unable to read local storage.');
    }
    // A raw read never validates, so exporting the stored data stays possible whatever shape it is in.
    if (command.type === 'snapshot.raw') {
      return {
        ok: true,
        requestId: command.requestId,
        revision: Number.isSafeInteger(raw?.revision) ? raw.revision : 0,
        value: raw,
      };
    }
    let stored = migrateSnapshot(raw);
    // A revision above the usable ceiling has to be restarted before anything else looks at the root, because it is
    // valid: validation accepts it, so the repair pass below would never run, and the record would be locked at its
    // very next write. The scan walks the records already about to be validated, changes nothing when there is nothing
    // to change, and what it does change reaches storage with this command's own write. A root from a version this
    // build cannot read is left alone, as the repair leaves it: its records are not this build's to walk.
    const restarted = Number.isSafeInteger(stored?.schemaVersion) && stored.schemaVersion <= SCHEMA_VERSION
      ? restartUnusableRevisions(stored)
      : [];
    if (restarted.length) {
      console.warn('Giga Pinax: restarted a revision no write could have produced, at', restarted
        .map(({ collection, id, field }) => `${collection}${id ? ` ${id}` : ''} (${field})`).join(', '));
    }
    const current = validateSnapshot(stored);
    if (!current.ok) {
      // Continue with the records that still validate; the rest wait in quarantine for the
      // collector. The repair reaches storage with the next write, not with this read. A root
      // migration could not bring to this version is not a broken record: judging its records by
      // today's validators would condemn a shape they were never meant to read. Settings alone
      // claiming another version inside this version's root are damage like any other, and wait in
      // quarantine with the rest.
      const rescued = current.error.code === 'unsupported-schema' && current.error.path === 'schemaVersion'
        ? current
        : quarantineInvalidRecords(stored, getNow(context));
      if (!rescued.ok) return errorReply(command, 'storage', 'not-committed', `Stored data is invalid: ${current.error.message}`);
      stored = rescued.value;
    }

    if (command.type === 'snapshot.get') {
      return { ok: true, requestId: command.requestId, revision: stored.revision, value: stored };
    }
    const prior = stored.recentCommands.find(({ requestId }) => requestId === command.requestId);
    if (prior) return prior.reply;

    // Internal delivery commands are reproducible from authoritative alert state. Drop their
    // older ledger entries before each new write so they can spend, then replenish, the
    // command headroom without evicting public commands needed for retry idempotency.
    const working = clone(stored);
    working.recentCommands = working.recentCommands.filter(({ commandType }) => !INTERNAL_COMMANDS.has(commandType));
    const applied = applyCommand(working, command, context);
    if (!applied.ok) {
      if (applied.error.code === 'duplicate') return {
        ...errorReply(command, 'duplicate', 'not-committed', applied.error.message),
        error: clone(applied.error),
      };
      const code = ['conflict', 'unsupported'].includes(applied.error.code) ? applied.error.code : 'validation';
      return errorReply(command, code, 'not-committed', applied.error.message);
    }
    if (!applied.value.mutated) {
      return { ok: true, requestId: command.requestId, revision: stored.revision, value: applied.value.value };
    }
    const includeCommandHeadroom = !INTERNAL_COMMANDS.has(command.type);
    if (storageBytesWithReserve(applied.value.snapshot, includeCommandHeadroom) > MAX_ROOT_BYTES) {
      return errorReply(command, 'validation', 'not-committed', 'Local data plus reminder-delivery reserve exceeds the 5 MiB storage bound. Remove old auction events, reminders, or other saved data before retrying.');
    }
    try {
      await storageArea.set({ [STORAGE_KEY]: applied.value.snapshot });
    } catch (error) {
      return errorReply(command, 'storage', 'not-committed', error.message || 'Unable to write local storage.');
    }
    try {
      const verified = (await storageArea.get(STORAGE_KEY))?.[STORAGE_KEY];
      const ledger = verified?.recentCommands?.find(({ requestId }) => requestId === command.requestId);
      if (!verified || verified.revision !== applied.value.snapshot.revision || !ledger ||
          ledger.revision !== verified.revision) {
        return errorReply(command, 'storage', 'unknown', 'The accepted write could not be verified. Reload before retrying.');
      }
      return ledger.reply;
    } catch {
      return errorReply(command, 'storage', 'unknown', 'The accepted write could not be verified. Reload before retrying.');
    }
  }

  return {
    commitCommand(command) {
      // A stored root can be nested as deeply as a hand-made document, and every copy and every
      // measurement this writer makes of one recurses. Such a command is refused like any other
      // invalid shape: a page that asked for it is answered rather than left waiting on a throw.
      const result = queue.then(() => commit(command)).catch((error) => {
        if (!isRecursionError(error)) throw error;
        return errorReply(command, 'validation', 'not-committed', TOO_DEEPLY_NESTED);
      });
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
