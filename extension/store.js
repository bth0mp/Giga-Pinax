import {
  LIMITS, createEmptySnapshot, migrateSnapshot, quarantineInvalidRecords, setOutcome, validateDraftPayload,
  validateEventLocalTimes, validateSnapshot,
} from './core/records.js';
import { deriveReminderTriggers, reconcileScheduler, resolveZonedDateTime } from './core/reminders.js';
import { previewImport, validateBackup } from './core/backup.js';
import { deduplicateEvidence } from './core/evidence.js';
import { findDuplicateLot } from './core/lot-context.js';

export const STORAGE_KEY = 'auctionCompanion:v1';
export const MAX_ROOT_BYTES = 5 * 1024 * 1024;
const SCHEDULE_CHANGING_COMMANDS = new Set([
  'event.save', 'event.delete', 'lot.save', 'lot.delete', 'lot.outcome.set', 'backup.import',
]);
const INTERNAL_COMMANDS = new Set(['scheduler.reconcile', 'alert.claim', 'alert.delivery.record']);
const RESERVED_INSTANT = '9999-12-31T23:59:59.999Z';
const ALERT_STATE_RANK = {
  pending: 0, due: 1, claimed: 2, delivered: 3, missed: 4, snoozed: 5, acknowledged: 6,
};

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

const ok = (value) => ({ ok: true, value });
const fail = (code, message, path, existingLotId) => ({
  ok: false,
  error: { code, message, ...(path === undefined ? {} : { path }), ...(existingLotId === undefined ? {} : { existingLotId }) },
});
const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);

function clone(value) {
  return structuredClone(value);
}

function getNow(context) {
  return typeof context.now === 'function' ? context.now() : context.now;
}

function getId(context) {
  return context.newId();
}

function findRecord(records, id, expectedRevision, label) {
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return fail('validation', `${label} was not found.`, `${label}.id`);
  if (records[index].revision !== expectedRevision) {
    return fail('conflict', `${label} changed in another view. Reload and try again.`, `${label}.revision`);
  }
  return ok({ index, record: records[index] });
}

function baseRecord(draft, context) {
  const now = getNow(context);
  return {
    id: getId(context),
    revision: 0,
    dataClass: 'collector',
    createdAt: now,
    updatedAt: now,
    ...draft,
  };
}

function preferenceFields(value, includeAlerts = false) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of ['currency', 'catalogue', 'number', 'volume', 'section', 'sampleMode', 'housePremiumPresets']) {
    if (own(value, key)) result[key] = value[key];
  }
  if (includeAlerts && own(value, 'desktopAlertsEnabled')) {
    result.desktopAlertsEnabled = value.desktopAlertsEnabled;
  }
  return result;
}

function lotFromDraft(draft, existing, context) {
  const now = getNow(context);
  const optional = ['reference', 'auctionEventId', 'lotNumber'];
  const lot = existing ? clone(existing) : baseRecord({
    title: draft.title,
    sourceLinks: clone(draft.sourceLinks ?? []),
    bidHistory: [],
    outcome: { status: 'open' },
    outcomeHistory: [],
  }, context);
  lot.title = draft.title;
  lot.sourceLinks = clone(draft.sourceLinks ?? []);
  if (own(draft, 'notes')) lot.notes = draft.notes;
  for (const key of ['auctionContext', 'coinDetails', 'provenanceNotes', 'costEstimate']) {
    if (!own(draft, key)) continue;
    if (draft[key] === null) delete lot[key];
    else lot[key] = clone(draft[key]);
  }
  for (const key of optional) {
    if (own(draft, key)) lot[key] = draft[key];
    else delete lot[key];
  }
  if (existing) {
    lot.revision += 1;
    lot.updatedAt = now;
  }
  return lot;
}

function eventFromDraft(draft, existing, context) {
  const now = getNow(context);
  const event = existing ? clone(existing) : baseRecord({}, context);
  for (const key of [
    'name', 'eventKind', 'precision', 'localDate', 'localTime', 'timeZone', 'startsAt',
    'reminderScope', 'capturedText', 'capturedFromUrl', 'sourceUrl',
  ]) {
    if (own(draft, key)) event[key] = clone(draft[key]);
    else delete event[key];
  }
  event.reminders = (draft.reminders ?? []).map((reminder) => {
    const retained = existing?.reminders.find(({ id }) => id === reminder.id);
    const next = clone(reminder);
    next.id = retained?.id ?? getId(context);
    return next;
  });
  if (existing) {
    event.revision += 1;
    event.updatedAt = now;
  }
  return event;
}

function appendBidHistory(lot, action, terms, context) {
  const entry = {
    id: getId(context),
    action,
    recordedAt: getNow(context),
  };
  if (terms?.amount) entry.amount = clone(terms.amount);
  if (terms && own(terms, 'buyerPremiumBps')) entry.buyerPremiumBps = terms.buyerPremiumBps;
  lot.bidHistory.push(entry);
}

function compactGroupPriorities(lots, groupId, now) {
  lots.filter((lot) => lot.alternativeGroupId === groupId)
    .sort((left, right) => left.priority - right.priority)
    .forEach((lot, index) => {
      if (lot.priority === index + 1) return;
      lot.priority = index + 1;
      lot.revision += 1;
      lot.updatedAt = now;
    });
}

function adoptTriggerIds(alerts) {
  // Alerts written before 0.32 embed the event revision in their trigger ID, so an edited event
  // recreated every alert as pending. Rebuild the current identity from the alert's own fields
  // rather than by parsing the stored string, and keep the collector's decision if two legacy
  // alerts collapse onto one identity.
  const byTrigger = new Map();
  for (const alert of alerts) {
    alert.triggerId = `${alert.eventId}:${alert.reminderId}:${alert.triggerAt}`;
    const kept = byTrigger.get(alert.triggerId);
    if (!kept || ALERT_STATE_RANK[alert.status] > ALERT_STATE_RANK[kept.status]) {
      byTrigger.set(alert.triggerId, alert);
    }
  }
  return [...byTrigger.values()];
}

function reconcileIntoSnapshot(next, context) {
  const now = getNow(context);
  const events = next.auctionEvents.filter((event) => event.reminderScope === 'standalone' ||
    next.lots.some((lot) => lot.auctionEventId === event.id && lot.outcome.status === 'open'));
  const triggers = deriveReminderTriggers(events, now);
  const triggersById = new Map(triggers.map((trigger) => [trigger.id, trigger]));
  next.alerts = adoptTriggerIds(next.alerts).filter((alert) => triggersById.has(alert.triggerId));
  const existing = new Set(next.alerts.map(({ triggerId }) => triggerId));
  for (const trigger of triggers) {
    if (existing.has(trigger.id)) continue;
    next.alerts.push(baseRecord({
      triggerId: trigger.id,
      eventId: trigger.eventId,
      eventRevision: trigger.eventRevision,
      reminderId: trigger.reminderId,
      triggerAt: trigger.triggerAt,
      status: 'pending',
    }, context));
  }
  const plan = reconcileScheduler(events, { alerts: next.alerts }, now);
  const missed = new Set(plan.missedTriggerIds);
  const due = new Set(Object.values(plan.overdueByEvent).flat().map(({ id }) => id));
  for (const alert of next.alerts) {
    let status = alert.status;
    if (missed.has(alert.triggerId)) status = 'missed';
    else if (due.has(alert.triggerId) && (['pending', 'snoozed'].includes(status) ||
      (status === 'claimed' && Date.parse(alert.claimedAt) + 5 * 60 * 1000 <= Date.parse(now)))) status = 'due';
    // The event revision is copied onto the alert for display, so a surviving alert refreshes it.
    const eventRevision = triggersById.get(alert.triggerId)?.eventRevision ?? alert.eventRevision;
    if (status === alert.status && eventRevision === alert.eventRevision) continue;
    if (status !== alert.status && status === 'missed') alert.missedAt = now;
    alert.status = status;
    alert.eventRevision = eventRevision;
    alert.revision += 1;
    alert.updatedAt = now;
  }
  next.scheduler = {
    revision: next.scheduler.revision + 1,
    nextWakeAt: plan.nextWakeAt,
    lastReconciledAt: now,
  };
  return plan;
}

function mutation(snapshot, command, context) {
  const next = clone(snapshot);
  const now = getNow(context);
  let value;

  switch (command.type) {
    case 'preferences.migrateIfAbsent': {
      if (snapshot.preferences !== null) return ok({ snapshot, value: snapshot.preferences, mutated: false });
      const preferences = preferenceFields(command.preferences);
      if (!preferences) return fail('validation', 'Preferences are required.', 'preferences');
      next.preferences = {
        schemaVersion: 1,
        revision: 0,
        ...clone(preferences),
        desktopAlertsEnabled: false,
        createdAt: now,
        updatedAt: now,
      };
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
      const selected = command.orderedLotIds.map((id) => next.lots.find((lot) => lot.id === id));
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
      const oldGroups = new Set(selected.map((lot) => lot.alternativeGroupId).filter(Boolean));
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
      next.drafts = next.drafts.filter(({ expiresAt }) => expiresAt > now);
      value = {
        id: getId(context),
        revision: 0,
        dataClass: 'collector',
        kind: command.kind,
        payload: clone(payload.value),
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.parse(now) + 30 * 60 * 1000).toISOString(),
      };
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
      // Quarantine is a recovery bin rather than live data, so no import discards what is in it.
      const rescued = new Map([...(snapshot.quarantine ?? []), ...(imported.quarantine ?? [])]
        .map((entry) => [JSON.stringify(entry), entry]));
      if (rescued.size) imported.quarantine = [...rescued.values()];
      for (const key of Object.keys(next)) delete next[key];
      Object.assign(next, imported);
      value = { mode: command.mode, counts: preview.value.counts };
      break;
    }
    default:
      return fail('unsupported', `Unsupported command: ${String(command.type)}`, 'type');
  }

  if (SCHEDULE_CHANGING_COMMANDS.has(command.type)) {
    let projectedId = 0;
    const projected = clone(next);
    projected.revision = snapshot.revision + 1;
    projected.updatedAt = now;
    const projectedReply = { ok: true, requestId: command.requestId, revision: projected.revision, value: clone(value) };
    projected.recentCommands.push({
      requestId: command.requestId, commandType: command.type, revision: projected.revision, committedAt: now, reply: projectedReply,
    });
    projected.recentCommands = projected.recentCommands.slice(-200);
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
    if (storageBytesWithReserve(projected) > MAX_ROOT_BYTES) {
      return fail('storage-bound', 'These reminders would exceed the 5 MiB local storage bound. Remove reminders or old auction events before saving.', 'reminders');
    }
  }

  next.revision = snapshot.revision + 1;
  next.updatedAt = now;
  const reply = { ok: true, requestId: command.requestId, revision: next.revision, value: clone(value) };
  next.recentCommands.push({
    requestId: command.requestId,
    commandType: command.type,
    revision: next.revision,
    committedAt: now,
    reply: clone(reply),
  });
  next.recentCommands = next.recentCommands.slice(-200);
  const validated = validateSnapshot(next);
  if (!validated.ok) return fail('validation', validated.error.message, validated.error.path);
  return ok({ snapshot: next, value, reply, mutated: true });
}

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

function errorReply(command, code, outcome, message) {
  return {
    ok: false,
    requestId: typeof command?.requestId === 'string' ? command.requestId : '',
    code,
    outcome,
    message,
  };
}

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
    const current = validateSnapshot(stored);
    if (!current.ok) {
      // Continue with the records that still validate; the rest wait in quarantine for the
      // collector. The repair reaches storage with the next write, not with this read. A root
      // migration could not bring to this version is not a broken record: judging its records by
      // today's validators would condemn a shape they were never meant to read.
      const rescued = current.error.code === 'unsupported-schema'
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
      const result = queue.then(() => commit(command));
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
